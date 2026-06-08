import { Codex } from "@openai/codex-sdk"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { getString } from "../shared/index.js"
import { initializeWorkspaceProgressForSession } from "../workspaces/workspaceProgressInit.js"
import { resolveWorkspaceDir } from "../workspaces/workspaceManager.js"
import { resolveWorkspaceTemplateRoot } from "../workspaces/workspacePaths.js"
import { createRun, patchRun, resolveRunWorkspaceContext } from "../manifests/store.js"
import { isGncRequestContext } from "../server/requestContext.js"
import { getWorkspaceSkillScopes, readScopedSkillInstructions, readSkillInstructions, type SkillInstruction, type SkillScope } from "../system/skills.js"
import { ASK_USER_TAG_START, extractAskUserPayload } from "./askUserProtocol.js"
import { buildCodexConfig } from "./codexConfig.js"
import { buildSdkInput, readAgentGuide, shouldInjectPromptPrefixForSession } from "./promptPrefix.js"
import { getInputTextLength, normalizeRunInput, summarizeInput } from "./runInput.js"
import { completeRunSessionTurn, ensureRunSession, persistRunSessionTurn } from "./runSessionStore.js"
import { elapsedMs, summarizeCodexEvent } from "./runTelemetry.js"
import type { RunContext, RunInputItem, RunRequestBody } from "./runTypes.js"

export class RunRequestError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = "RunRequestError"
    this.statusCode = statusCode
  }
}

type PreparedRun = {
  config: AppConfig
  enabledSkills: string[]
  effectiveWorkingDirectory: string
  logger: Logger
  manifestRunId: string | null
  normalizedInput: RunInputItem[]
  promptTextForHistory: string
  requestedWorkspaceName: string | null
  requestId?: string
  requestStartedAt: bigint
  runContext: RunContext
  sdkInput: string | RunInputItem[]
  threadIdForResume: string | null
}

const CODEX_RUN_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_BUILD_DIR = path.resolve(CODEX_RUN_DIR, "..")
const BACKEND_ROOT = ["src", "dist"].includes(path.basename(BACKEND_BUILD_DIR))
  ? path.resolve(BACKEND_BUILD_DIR, "..")
  : path.resolve(process.cwd())

function getBundledAgentCliSrcDirs() {
  return [
    path.join(BACKEND_ROOT, "workflow_agents", "agents", "freecad_cli_tools", "src"),
    path.join(BACKEND_ROOT, "workflow_agents", "agents", "sim_cli_tools", "src"),
  ].filter(dir => fs.existsSync(dir))
}

function prependPathList(existing: string | undefined, entries: string[]) {
  const seen = new Set<string>()
  const values = [...entries, ...(existing ? existing.split(path.delimiter) : [])]
    .map(value => value.trim())
    .filter(value => value.length > 0)
    .filter(value => {
      const key = path.resolve(value)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return values.join(path.delimiter)
}

function buildCodexEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
  const bundledCliSrcDirs = getBundledAgentCliSrcDirs()
  if (bundledCliSrcDirs.length > 0) {
    env.PYTHONPATH = prependPathList(env.PYTHONPATH, bundledCliSrcDirs)
    env.CODEX_WEB_AGENT_PYTHONPATH = bundledCliSrcDirs.join(path.delimiter)
  }
  return env
}

export type RunCodexTurnResult = {
  eventCount: number
  events: unknown[]
  manifestRunId: string | null
  prompt: string
  runContext: RunContext
  status: "completed" | "failed" | "cancelled"
  threadId: string | null
  totalElapsedMs: number
  turnId: string
}

function getPromptTextForHistory(prompt: unknown, input: RunInputItem[]) {
  if (typeof prompt === "string" && prompt.trim() !== "") return prompt.trim()
  return input
    .filter(item => item.type === "text")
    .map(item => item.text)
    .join("\n\n")
    .trim() || "[input]"
}

function hasTerminalEvent(events: unknown[]) {
  return events.some(event =>
    event && typeof event === "object" &&
    ["turn.completed", "turn.failed", "error"].includes(String((event as { type?: unknown }).type ?? ""))
  )
}

function getTerminalStatus(events: unknown[], aborted: boolean): RunCodexTurnResult["status"] {
  if (aborted) return "cancelled"
  if (events.some(event => event && typeof event === "object" && (event as { type?: unknown }).type === "turn.failed")) return "failed"
  if (events.some(event => event && typeof event === "object" && (event as { type?: unknown }).type === "error")) return "failed"
  return "completed"
}

function appendTerminalIfMissing(events: unknown[], message: string) {
  if (events.length === 0 || hasTerminalEvent(events)) return
  events.push({
    type: "turn.failed",
    error: { message },
  })
}

export async function prepareCodexTurn(
  body: RunRequestBody,
  {
    config,
    extraSkillInstructions,
    forcedSkillScopes,
    logger,
    requestId,
    routingIntent,
    selectedSkillNames,
  }: {
    config: AppConfig
    extraSkillInstructions?: SkillInstruction[]
    forcedSkillScopes?: SkillScope[]
    logger: Logger
    requestId?: string
    routingIntent?: string | null
    selectedSkillNames?: string[]
  },
): Promise<PreparedRun> {
  const { prompt, input, sessionId, threadId, turnId, enabledSkills } = body
  const skillNames = (enabledSkills ?? [])
    .filter(s => typeof s === "string" && s.trim() !== "")
    .map(s => s.trim())
  const normalizedInput = normalizeRunInput(input, prompt)
  const hasTextOrFileInput = normalizedInput !== null
  const sdkInputBase = normalizedInput ?? (skillNames.length > 0 ? [] : null)
  if (!sdkInputBase) throw new RunRequestError(400, "prompt or input is required")
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new RunRequestError(400, "sessionId is required")
  }
  if (!turnId || typeof turnId !== "string" || turnId.trim() === "") {
    throw new RunRequestError(400, "turnId is required")
  }

  const trimmedSessionId = sessionId.trim()
  const trimmedTurnId = turnId.trim()
  const requestedWorkspaceDir = getString(body.workspaceDir)
  const requestedWorkspaceId = getString(body.workspaceId)
  const requestedVersionId = getString(body.versionId)
  const requestedWorkspaceName = getString(body.workspaceName)
  let resolvedWorkspaceContext: Awaited<ReturnType<typeof resolveRunWorkspaceContext>> | null = null
  if (requestedWorkspaceDir || requestedWorkspaceId || requestedVersionId) {
    try {
      resolvedWorkspaceContext = await resolveRunWorkspaceContext({
        workspaceDir: requestedWorkspaceDir,
        workspaceId: requestedWorkspaceId,
        versionId: requestedVersionId,
      })
    } catch (err) {
      throw new RunRequestError(409, err instanceof Error ? err.message : "workspace context mismatch")
    }
  }

  const workspaceContextRequested = !!(requestedWorkspaceDir || requestedWorkspaceId || requestedVersionId)
  const threadIdForResume = typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null
  const runContext = {
    workspaceDir: resolvedWorkspaceContext?.workspaceDir ?? (workspaceContextRequested ? null : await resolveWorkspaceDir().catch(() => null)),
    workspaceId: resolvedWorkspaceContext?.workspaceId ?? requestedWorkspaceId,
    sessionId: trimmedSessionId,
    threadId: threadIdForResume,
    turnId: trimmedTurnId,
    versionId: resolvedWorkspaceContext?.versionId ?? requestedVersionId,
  }
  const effectiveWorkingDirectory = runContext.workspaceDir ?? resolveWorkspaceTemplateRoot(config)
  const promptTextForHistory = getPromptTextForHistory(prompt, sdkInputBase)
  const injectSessionPrefix = await shouldInjectPromptPrefixForSession(trimmedSessionId, runContext.workspaceDir)
  const skillScopes = forcedSkillScopes ?? getWorkspaceSkillScopes(isGncRequestContext())
  const bundledCliSrcDirs = getBundledAgentCliSrcDirs()
  const selectedAutoSkillNames = (selectedSkillNames ?? [])
    .filter(s => typeof s === "string" && s.trim() !== "")
    .map(s => s.trim())
  const explicitSkillInstructions = readSkillInstructions(skillNames, skillScopes)
  const selectedSkillInstructions = readSkillInstructions(selectedAutoSkillNames, skillScopes)
  const scopedSkillInstructions = selectedAutoSkillNames.length > 0 ? [] : readScopedSkillInstructions(skillScopes)
  const explicitSkillNames = new Set(explicitSkillInstructions.map(skill => skill.name.toLowerCase()))
  const selectedSkillNamesFound = new Set(selectedSkillInstructions.map(skill => skill.name.toLowerCase()))
  const missingSkillNames = skillNames.filter(name => !explicitSkillNames.has(name.toLowerCase()))
  const missingSelectedSkillNames = selectedAutoSkillNames.filter(name => !selectedSkillNamesFound.has(name.toLowerCase()))
  const skillInstructions = [...scopedSkillInstructions, ...selectedSkillInstructions, ...explicitSkillInstructions, ...(extraSkillInstructions ?? [])].filter((skill, index, all) =>
    all.findIndex(item => item.name.toLowerCase() === skill.name.toLowerCase()) === index
  )
  if (missingSkillNames.length > 0) {
    throw new RunRequestError(400, `enabled skill not found: ${missingSkillNames.join(", ")}`)
  }
  if (missingSelectedSkillNames.length > 0) {
    throw new RunRequestError(500, `selected skill not found: ${missingSelectedSkillNames.join(", ")}`)
  }
  if (!hasTextOrFileInput && skillInstructions.length === 0) {
    throw new RunRequestError(400, "prompt, input, or enabled skill is required")
  }
  const resolvedSkillNames = skillInstructions.map(skill => skill.name)

  const injectPromptPrefix = injectSessionPrefix || skillInstructions.length > 0
  const agentGuide = injectSessionPrefix ? await readAgentGuide() : ""
  const sdkInput = buildSdkInput(sdkInputBase, runContext, injectPromptPrefix, agentGuide, skillInstructions)
  const requestStartedAt = process.hrtime.bigint()

  await ensureRunSession({
    prompt: promptTextForHistory,
    sessionId: trimmedSessionId,
    threadId: threadIdForResume,
    versionId: runContext.versionId,
    workspaceDir: runContext.workspaceDir,
    workspaceId: runContext.workspaceId,
    workspaceName: requestedWorkspaceName,
  }).catch(err => logger.error("run session ensure failed", { err, sessionId: trimmedSessionId }))

  let manifestRunId: string | null = null
  if (runContext.workspaceDir || runContext.workspaceId) {
    await createRun({
      kind: "agent",
      routingIntent,
      sessionId: trimmedSessionId,
      skillNames: resolvedSkillNames,
      status: "running",
      threadId: runContext.threadId,
      turnId: trimmedTurnId,
      versionId: runContext.versionId,
      workspaceDir: runContext.workspaceDir,
      workspaceId: runContext.workspaceId,
    })
      .then(({ run }) => {
        manifestRunId = run.id
      })
      .catch(err => logger.error("manifest run create failed", {
        err,
        sessionId: trimmedSessionId,
        turnId: trimmedTurnId,
        workspaceDir: runContext.workspaceDir,
        workspaceId: runContext.workspaceId,
        versionId: runContext.versionId,
      }))
  }

  logger.info("codex run accepted", {
    requestId,
    manifestRunId,
    sessionId: trimmedSessionId,
    threadId: threadIdForResume,
    turnId: trimmedTurnId,
    workspaceId: runContext.workspaceId,
    versionId: runContext.versionId,
    baseUrl: config.openai.baseUrl,
    model: config.openai.model,
    modelProvider: config.openai.modelProvider,
    wireApi: config.openai.wireApi,
    supportsWebsockets: config.openai.supportsWebsockets,
    modelReasoningEffort: config.codex.modelReasoningEffort,
    workingDirectory: effectiveWorkingDirectory,
    workspaceDir: runContext.workspaceDir,
    workspaceName: requestedWorkspaceName,
    approvalPolicy: config.codex.approvalPolicy,
    sandboxMode: config.codex.sandboxMode,
    bundledCliSrcDirs,
    promptChars: typeof prompt === "string" ? prompt.length : 0,
    sdkInputTextChars: getInputTextLength(Array.isArray(sdkInput) ? sdkInput : sdkInputBase),
    promptPrefixInjected: injectPromptPrefix,
    agentGuideInjected: injectSessionPrefix && agentGuide.trim() !== "",
    skillInstructionsInjected: skillInstructions.map(skill => skill.name),
    input: summarizeInput(sdkInputBase),
    enabledSkills: skillNames,
    selectedSkillNames: selectedAutoSkillNames,
    routingIntent: routingIntent ?? null,
    skillScopes,
  })

  const progressStartedAt = process.hrtime.bigint()
  await initializeWorkspaceProgressForSession(trimmedSessionId)
  logger.info("codex run progress directory ensured", {
    requestId,
    sessionId: trimmedSessionId,
    turnId: trimmedTurnId,
    elapsedMs: elapsedMs(progressStartedAt),
    totalElapsedMs: elapsedMs(requestStartedAt),
  })

  return {
    config,
    enabledSkills: skillNames,
    effectiveWorkingDirectory,
    logger,
    manifestRunId,
    normalizedInput: sdkInputBase,
    promptTextForHistory,
    requestedWorkspaceName,
    requestId,
    requestStartedAt,
    runContext,
    sdkInput,
    threadIdForResume,
  }
}

export async function executeCodexTurn(
  prepared: PreparedRun,
  {
    signal,
    onClientEvent,
  }: {
    signal: AbortSignal
    onClientEvent?: (event: unknown) => void | Promise<void>
  },
): Promise<RunCodexTurnResult> {
  const {
    config,
    enabledSkills,
    effectiveWorkingDirectory,
    logger,
    manifestRunId,
    normalizedInput,
    promptTextForHistory,
    requestedWorkspaceName,
    requestId,
    requestStartedAt,
    runContext,
    sdkInput,
    threadIdForResume,
  } = prepared
  const streamedEvents: unknown[] = []
  let resolvedThreadId = runContext.threadId
  let eventCount = 0
  let lastEventAt = requestStartedAt
  let lastPersistedEventCount = 0
  let lastPersistedAt = 0

  const persistLiveTurn = async (force = false) => {
    if (streamedEvents.length === 0) return
    const now = Date.now()
    if (!force && streamedEvents.length === lastPersistedEventCount) return
    if (!force && now - lastPersistedAt < 1000) return
    lastPersistedEventCount = streamedEvents.length
    lastPersistedAt = now
    await persistRunSessionTurn({
      events: streamedEvents,
      prompt: promptTextForHistory,
      sessionId: runContext.sessionId,
      threadId: resolvedThreadId,
      turnId: runContext.turnId,
      versionId: runContext.versionId,
      workspaceDir: runContext.workspaceDir,
      workspaceId: runContext.workspaceId,
      workspaceName: requestedWorkspaceName,
    }).catch(err => logger.error("run session live persist failed", {
      err,
      sessionId: runContext.sessionId,
      turnId: runContext.turnId,
    }))
  }

  const emitClientEvent = async (event: unknown) => {
    if (onClientEvent) await onClientEvent(event)
  }

  try {
    const codexConfig = buildCodexConfig(config)
    const bundledCliSrcDirs = getBundledAgentCliSrcDirs()
    const codex = new Codex({
      apiKey: config.openai.apiKey,
      baseUrl: config.openai.baseUrl,
      config: codexConfig,
      env: buildCodexEnv(),
    })

    const threadOptions = {
      ...(config.openai.model ? { model: config.openai.model } : {}),
      ...(bundledCliSrcDirs.length > 0 ? { additionalDirectories: bundledCliSrcDirs } : {}),
      workingDirectory: effectiveWorkingDirectory,
      approvalPolicy: config.codex.approvalPolicy,
      skipGitRepoCheck: config.codex.skipGitRepoCheck,
      modelReasoningEffort: config.codex.modelReasoningEffort,
      sandboxMode: config.codex.sandboxMode,
    }

    const thread = threadIdForResume
      ? codex.resumeThread(threadIdForResume, threadOptions)
      : codex.startThread(threadOptions)

    const runStreamedStartedAt = process.hrtime.bigint()
    const streamed = await thread.runStreamed(sdkInput, { signal })
    logger.info("codex run stream opened", {
      requestId,
      sessionId: runContext.sessionId,
      turnId: runContext.turnId,
      elapsedMs: elapsedMs(runStreamedStartedAt),
      totalElapsedMs: elapsedMs(requestStartedAt),
    })

    const suppressedAgentMessageIds = new Set<string>()

    for await (const event of streamed.events) {
      if (signal.aborted) break
      streamedEvents.push(event)
      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        resolvedThreadId = event.thread_id
      }
      const now = process.hrtime.bigint()
      eventCount += 1
      logger.info("codex run event", {
        requestId,
        sessionId: runContext.sessionId,
        turnId: runContext.turnId,
        eventIndex: eventCount,
        sincePreviousEventMs: Number(now - lastEventAt) / 1_000_000,
        totalElapsedMs: Number(now - requestStartedAt) / 1_000_000,
        ...summarizeCodexEvent(event),
      })
      lastEventAt = now

      if (
        (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") &&
        event.item.type === "agent_message"
      ) {
        if (event.type === "item.started" && event.item.text.trim() === "") {
          await persistLiveTurn()
          continue
        }

        const askUser = extractAskUserPayload(event.item.text)

        if (askUser) {
          suppressedAgentMessageIds.add(event.item.id)
          if (event.type === "item.completed") {
            await emitClientEvent({
              type: "item.completed",
              item: {
                id: `ask_user:${event.item.id}`,
                type: "ask_user",
                question: askUser.question,
                options: askUser.options,
              },
            })
          }
          await persistLiveTurn()
          continue
        }

        if (suppressedAgentMessageIds.has(event.item.id)) {
          if (event.type === "item.completed") {
            suppressedAgentMessageIds.delete(event.item.id)
            await emitClientEvent(event)
          }
          await persistLiveTurn()
          continue
        }

        if (event.type !== "item.completed" && ASK_USER_TAG_START.test(event.item.text)) {
          suppressedAgentMessageIds.add(event.item.id)
          await persistLiveTurn()
          continue
        }
      }

      await emitClientEvent(event)
      await persistLiveTurn()
      if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") {
        break
      }
    }
  } catch (err) {
    if (!signal.aborted) {
      const errorEvent = {
        type: "error",
        message: "服务端发生错误，请查看后端日志 logs/app.log",
      }
      streamedEvents.push(errorEvent)
      logger.error("codex run failed", {
        err,
        requestBody: {
          input: summarizeInput(normalizedInput),
          sessionId: runContext.sessionId,
          threadId: runContext.threadId,
          turnId: runContext.turnId,
          enabledSkills,
          workspaceDir: runContext.workspaceDir,
          workspaceId: runContext.workspaceId,
          versionId: runContext.versionId,
        },
      })
      await emitClientEvent(errorEvent)
    }
  } finally {
    if (signal.aborted) {
      appendTerminalIfMissing(streamedEvents, "运行连接已中断，已保存中断前的对话事件。")
    }
    const terminalStatus = getTerminalStatus(streamedEvents, signal.aborted)

    if (manifestRunId) {
      await patchRun(manifestRunId, {
        sessionId: runContext.sessionId,
        status: terminalStatus,
        threadId: resolvedThreadId,
        turnId: runContext.turnId,
        versionId: runContext.versionId,
        workspaceDir: runContext.workspaceDir,
        workspaceId: runContext.workspaceId,
      }).catch(err => logger.error("manifest run patch failed", {
        err,
        runId: manifestRunId,
        sessionId: runContext.sessionId,
        turnId: runContext.turnId,
      }))
    }

    if (streamedEvents.length > 0) {
      await completeRunSessionTurn({
        events: streamedEvents,
        prompt: promptTextForHistory,
        sessionId: runContext.sessionId,
        threadId: resolvedThreadId,
        turnId: runContext.turnId,
        versionId: runContext.versionId,
        workspaceDir: runContext.workspaceDir,
        workspaceId: runContext.workspaceId,
        workspaceName: requestedWorkspaceName,
      }).catch(err => logger.error("run session completion failed", {
        err,
        sessionId: runContext.sessionId,
        turnId: runContext.turnId,
      }))
      await persistLiveTurn(true)
    }

    logger.info("codex run finished", {
      requestId,
      sessionId: runContext.sessionId,
      turnId: runContext.turnId,
      aborted: signal.aborted,
      eventCount,
      totalElapsedMs: elapsedMs(requestStartedAt),
    })
  }

  return {
    eventCount,
    events: streamedEvents,
    manifestRunId,
    prompt: promptTextForHistory,
    runContext,
    status: getTerminalStatus(streamedEvents, signal.aborted),
    threadId: resolvedThreadId,
    totalElapsedMs: elapsedMs(requestStartedAt),
    turnId: runContext.turnId,
  }
}
