import { FastifyInstance } from "fastify"
import { Codex } from "@openai/codex-sdk"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { getString } from "../shared/index.js"
import { initializeWorkspaceProgressForSession } from "../workspaces/workspaceProgressInit.js"
import { resolveWorkspaceDir } from "../workspaces/workspaceManager.js"
import { createRun, patchRun, resolveRunWorkspaceContext } from "../manifests/store.js"
import { isGncRequestContext } from "../server/requestContext.js"
import { getWorkspaceSkillScopes, readScopedSkillInstructions, readSkillInstructions } from "../system/skills.js"
import { ASK_USER_TAG_START, extractAskUserPayload } from "./askUserProtocol.js"
import { buildCodexConfig } from "./codexConfig.js"
import { registerInputFilesRoute } from "./inputFiles.routes.js"
import { buildSdkInput, readAgentGuide, shouldInjectPromptPrefixForSession } from "./promptPrefix.js"
import { getInputTextLength, normalizeRunInput, summarizeInput } from "./runInput.js"
import { completeRunSessionTurn, ensureRunSession } from "./runSessionStore.js"
import { elapsedMs, hasPersistableTerminalEvent, summarizeCodexEvent } from "./runTelemetry.js"
import type { RunRequestBody } from "./runTypes.js"

export async function taskRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  registerInputFilesRoute(fastify, logger)

  fastify.post<{ Body: RunRequestBody }>(
    "/api/run",
    async (req, reply) => {
      const { prompt, input, sessionId, threadId, turnId, enabledSkills } = req.body
      const skillNames = (enabledSkills ?? [])
        .filter(s => typeof s === "string" && s.trim() !== "")
        .map(s => s.trim())
      const normalizedInput = normalizeRunInput(input, prompt)
      const hasTextOrFileInput = normalizedInput !== null
      const sdkInputBase = normalizedInput ?? (skillNames.length > 0 ? [] : null)
      if (!sdkInputBase) {
        return reply.status(400).send({ error: "prompt or input is required" })
      }
      if (!sessionId || typeof sessionId !== "string" || sessionId.trim() === "") {
        return reply.status(400).send({ error: "sessionId is required" })
      }
      if (!turnId || typeof turnId !== "string" || turnId.trim() === "") {
        return reply.status(400).send({ error: "turnId is required" })
      }

      const trimmedSessionId = sessionId.trim()
      const trimmedTurnId = turnId.trim()
      const requestedWorkspaceDir = getString(req.body.workspaceDir)
      const requestedWorkspaceId = getString(req.body.workspaceId)
      const requestedVersionId = getString(req.body.versionId)
      const requestedWorkspaceName = getString(req.body.workspaceName)
      let resolvedWorkspaceContext: Awaited<ReturnType<typeof resolveRunWorkspaceContext>> | null = null
      if (requestedWorkspaceDir || requestedWorkspaceId || requestedVersionId) {
        try {
          resolvedWorkspaceContext = await resolveRunWorkspaceContext({
            workspaceDir: requestedWorkspaceDir,
            workspaceId: requestedWorkspaceId,
            versionId: requestedVersionId,
          })
        } catch (err) {
          return reply.status(409).send({ error: err instanceof Error ? err.message : "workspace context mismatch" })
        }
      }
      const workspaceContextRequested = !!(requestedWorkspaceDir || requestedWorkspaceId || requestedVersionId)
      const requestStartedAt = process.hrtime.bigint()
      let lastEventAt = requestStartedAt
      let eventCount = 0

      // Always inject execution context and the agent guide on the first recorded turn.
      // Public skills are injected for every workspace; workspace requests receive thermal skills,
      // and GNC requests receive AIGNC skills.
      const runContext = {
        workspaceDir: resolvedWorkspaceContext?.workspaceDir ?? (workspaceContextRequested ? null : await resolveWorkspaceDir().catch(() => null)),
        workspaceId: resolvedWorkspaceContext?.workspaceId ?? requestedWorkspaceId,
        sessionId: trimmedSessionId,
        threadId: typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null,
        turnId: trimmedTurnId,
        versionId: resolvedWorkspaceContext?.versionId ?? requestedVersionId,
      }
      const promptTextForHistory = typeof prompt === "string" && prompt.trim() !== ""
        ? prompt.trim()
        : sdkInputBase
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n\n")
          .trim() || "[input]"
      const injectSessionPrefix = await shouldInjectPromptPrefixForSession(trimmedSessionId, runContext.workspaceDir)
      const skillScopes = getWorkspaceSkillScopes(isGncRequestContext())
      const explicitSkillInstructions = readSkillInstructions(skillNames, skillScopes)
      const scopedSkillInstructions = readScopedSkillInstructions(skillScopes)
      const explicitSkillNames = new Set(explicitSkillInstructions.map(skill => skill.name.toLowerCase()))
      const missingSkillNames = skillNames.filter(name => !explicitSkillNames.has(name.toLowerCase()))
      const skillInstructions = [...scopedSkillInstructions, ...explicitSkillInstructions].filter((skill, index, all) =>
        all.findIndex(item => item.name.toLowerCase() === skill.name.toLowerCase()) === index
      )
      if (missingSkillNames.length > 0) {
        return reply.status(400).send({ error: `enabled skill not found: ${missingSkillNames.join(", ")}` })
      }
      if (!hasTextOrFileInput && skillInstructions.length === 0) {
        return reply.status(400).send({ error: "prompt, input, or enabled skill is required" })
      }
      const injectPromptPrefix = injectSessionPrefix || skillInstructions.length > 0
      const agentGuide = injectSessionPrefix ? await readAgentGuide() : ""
      const sdkInput = buildSdkInput(sdkInputBase, runContext, injectPromptPrefix, agentGuide, skillInstructions)
      const streamedEvents: unknown[] = []
      let resolvedThreadId = runContext.threadId
      let manifestRunId: string | null = null

      await ensureRunSession({
        prompt: promptTextForHistory,
        sessionId: trimmedSessionId,
        threadId: resolvedThreadId,
        versionId: runContext.versionId,
        workspaceDir: runContext.workspaceDir,
        workspaceId: runContext.workspaceId,
        workspaceName: requestedWorkspaceName,
      }).catch(err => logger.error("run session ensure failed", { err, sessionId: trimmedSessionId }))

      if (runContext.workspaceDir || runContext.workspaceId) {
        await createRun({
          kind: "agent",
          sessionId: trimmedSessionId,
          skillNames,
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
        requestId: req.id,
        manifestRunId,
        sessionId: trimmedSessionId,
        threadId: typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null,
        turnId: trimmedTurnId,
        workspaceId: runContext.workspaceId,
        versionId: runContext.versionId,
        baseUrl: config.openai.baseUrl,
        model: config.openai.model,
        modelProvider: config.openai.modelProvider,
        wireApi: config.openai.wireApi,
        supportsWebsockets: config.openai.supportsWebsockets,
        modelReasoningEffort: config.codex.modelReasoningEffort,
        workingDirectory: config.codex.workingDirectory,
        workspaceDir: runContext.workspaceDir,
        workspaceName: requestedWorkspaceName,
        approvalPolicy: config.codex.approvalPolicy,
        sandboxMode: config.codex.sandboxMode,
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        sdkInputTextChars: getInputTextLength(Array.isArray(sdkInput) ? sdkInput : sdkInputBase),
        promptPrefixInjected: injectPromptPrefix,
        agentGuideInjected: injectSessionPrefix && agentGuide.trim() !== "",
        skillInstructionsInjected: skillInstructions.map(skill => skill.name),
        input: summarizeInput(sdkInputBase),
        enabledSkills: skillNames,
      })

      const progressStartedAt = process.hrtime.bigint()
      await initializeWorkspaceProgressForSession(trimmedSessionId)
      logger.info("codex run progress directory ensured", {
        requestId: req.id,
        sessionId: trimmedSessionId,
        turnId: trimmedTurnId,
        elapsedMs: elapsedMs(progressStartedAt),
        totalElapsedMs: elapsedMs(requestStartedAt),
      })

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })

      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15000)

      const abort = new AbortController()
      req.raw.socket?.on("close", () => abort.abort())

      try {
        const codexConfig = buildCodexConfig(config)
        const codex = new Codex({
          apiKey: config.openai.apiKey,
          baseUrl: config.openai.baseUrl,
          config: codexConfig,
        })

        const threadOptions = {
          ...(config.openai.model ? { model: config.openai.model } : {}),
          workingDirectory: config.codex.workingDirectory,
          approvalPolicy: config.codex.approvalPolicy,
          skipGitRepoCheck: config.codex.skipGitRepoCheck,
          modelReasoningEffort: config.codex.modelReasoningEffort,
          sandboxMode: config.codex.sandboxMode,
        }

        const thread = threadId
          ? codex.resumeThread(threadId, threadOptions)
          : codex.startThread(threadOptions)

        const runStreamedStartedAt = process.hrtime.bigint()
        const streamed = await thread.runStreamed(
          sdkInput,
          { signal: abort.signal }
        )
        logger.info("codex run stream opened", {
          requestId: req.id,
          sessionId: trimmedSessionId,
          turnId: trimmedTurnId,
          elapsedMs: elapsedMs(runStreamedStartedAt),
          totalElapsedMs: elapsedMs(requestStartedAt),
        })

        const suppressedAgentMessageIds = new Set<string>()

        for await (const event of streamed.events) {
          if (abort.signal.aborted) break
          streamedEvents.push(event)
          const now = process.hrtime.bigint()
          eventCount += 1
          logger.info("codex run event", {
            requestId: req.id,
            sessionId: trimmedSessionId,
            turnId: trimmedTurnId,
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
              continue
            }

            const askUser = extractAskUserPayload(event.item.text)

            if (askUser) {
              suppressedAgentMessageIds.add(event.item.id)
              if (event.type === "item.completed") {
                reply.raw.write(`data: ${JSON.stringify({
                  type: "item.completed",
                  item: {
                    id: `ask_user:${event.item.id}`,
                    type: "ask_user",
                    question: askUser.question,
                    options: askUser.options,
                  },
                })}\n\n`)
              }
              continue
            }

            if (suppressedAgentMessageIds.has(event.item.id)) {
              if (event.type === "item.completed") {
                suppressedAgentMessageIds.delete(event.item.id)
                reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
              }
              continue
            }

            if (event.type !== "item.completed" && ASK_USER_TAG_START.test(event.item.text)) {
              suppressedAgentMessageIds.add(event.item.id)
              continue
            }
          }

          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
          if (event.type === "thread.started" && typeof event.thread_id === "string") {
            resolvedThreadId = event.thread_id
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          logger.error("codex run failed", {
            err,
            requestBody: {
              prompt: prompt ?? null,
              input: summarizeInput(sdkInputBase),
              sessionId: sessionId ?? null,
              threadId: threadId ?? null,
              turnId: turnId ?? null,
              enabledSkills: skillNames,
              workspaceDir: runContext.workspaceDir,
              workspaceId: runContext.workspaceId,
              versionId: runContext.versionId,
            },
          })
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "error",
              message: "服务端发生错误，请查看后端日志 logs/app.log",
            })}\n\n`
          )
        }
      } finally {
        const shouldPersistRun = streamedEvents.length > 0 &&
          (!abort.signal.aborted || hasPersistableTerminalEvent(streamedEvents))
        const terminalStatus = abort.signal.aborted
          ? "cancelled"
          : streamedEvents.some(event => event && typeof event === "object" && (event as { type?: unknown }).type === "turn.failed")
            ? "failed"
            : streamedEvents.some(event => event && typeof event === "object" && (event as { type?: unknown }).type === "error")
              ? "failed"
              : "completed"

        if (manifestRunId) {
          await patchRun(manifestRunId, {
            sessionId: trimmedSessionId,
            status: terminalStatus,
            threadId: resolvedThreadId,
            turnId: trimmedTurnId,
            versionId: runContext.versionId,
            workspaceDir: runContext.workspaceDir,
            workspaceId: runContext.workspaceId,
          }).catch(err => logger.error("manifest run patch failed", {
            err,
            runId: manifestRunId,
            sessionId: trimmedSessionId,
            turnId: trimmedTurnId,
          }))
        }

        if (shouldPersistRun) {
          await completeRunSessionTurn({
            events: streamedEvents,
            prompt: promptTextForHistory,
            sessionId: trimmedSessionId,
            threadId: resolvedThreadId,
            turnId: trimmedTurnId,
            versionId: runContext.versionId,
            workspaceDir: runContext.workspaceDir,
            workspaceId: runContext.workspaceId,
            workspaceName: requestedWorkspaceName,
          }).catch(err => logger.error("run session completion failed", { err, sessionId: trimmedSessionId, turnId: trimmedTurnId }))
        }
        logger.info("codex run finished", {
          requestId: req.id,
          sessionId: trimmedSessionId,
          turnId: trimmedTurnId,
          aborted: abort.signal.aborted,
          eventCount,
          totalElapsedMs: elapsedMs(requestStartedAt),
        })
        clearInterval(ping)
        reply.raw.end()
      }
    }
  )
}
