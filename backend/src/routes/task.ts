import { FastifyInstance } from "fastify"
import { Codex } from "@openai/codex-sdk"
import type { UserInput } from "@openai/codex-sdk"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { initializeFreecadProgressForSession } from "../freecadProgress.js"
import { resolveFreecadWorkspaceDir } from "../freecadWorkspace.js"

const ASK_USER_PROTOCOL = [
  "You can ask the user for one missing piece of information through the application's ask-user-question capability.",
  "Use it only when a required detail is missing and you cannot proceed safely or accurately without it.",
  "When you need that capability, respond with exactly this XML block and nothing else:",
  "<ask-user-question>",
  "<question>your concise question here</question>",
  "<option>first short option</option>",
  "<option>second short option</option>",
  "<option>third short option</option>",
  "</ask-user-question>",
  "Rules:",
  "- Ask exactly one concise question.",
  "- Include 2 or 3 short, mutually exclusive <option> entries whenever possible.",
  "- Do not include an \"Other\" option. The UI will provide a free-text Other field automatically.",
  "- Do not add explanations, markdown fences, or any other text outside the XML block.",
  "- Do not guess the missing detail if it is necessary.",
].join("\n")

const ASK_USER_TAG_START = /^\s*<ask-user-question>/i
const ASK_USER_BLOCK_RE = /^\s*<ask-user-question>\s*([\s\S]*?)\s*<\/ask-user-question>\s*$/i
const ASK_USER_QUESTION_RE = /<question>\s*([\s\S]*?)\s*<\/question>/i
const ASK_USER_OPTION_RE = /<option>\s*([\s\S]*?)\s*<\/option>/gi

interface AskUserPayload {
  question: string
  options: string[]
}

interface RunContext {
  freecadWorkspaceDir: string | null
  sessionId: string
  threadId: string | null
  turnId: string
}

type RunInputItem = UserInput
type SessionRecord = {
  createdAt?: number
  dismissedAskUserId?: string | null
  id?: string
  threadId?: string | null
  title?: string
  turns?: Array<{ id?: string; userPrompt?: string; events?: unknown[] }>
  workspaceDir?: string | null
  workspaceName?: string | null
}

interface RunRequestBody {
  prompt?: string | null
  input?: unknown
  sessionId?: string | null
  threadId?: string | null
  turnId?: string | null
  enabledSkills?: string[]
}

const UPLOADABLE_IMAGE_MIME_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
])
const SESSIONS_FILE = path.resolve(process.cwd(), "sessions.json")

function sanitizeUploadName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")
  return base || "image"
}

function elapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

function summarizeCodexEvent(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== "object") return { eventType: typeof event }

  const record = event as {
    type?: unknown
    item?: {
      id?: unknown
      type?: unknown
      status?: unknown
      command?: unknown
      exit_code?: unknown
      text?: unknown
    }
    thread_id?: unknown
  }

  const summary: Record<string, unknown> = {
    eventType: record.type,
  }

  if (typeof record.thread_id === "string") {
    summary.threadId = record.thread_id
  }

  if (record.item && typeof record.item === "object") {
    summary.itemId = record.item.id
    summary.itemType = record.item.type
    summary.itemStatus = record.item.status
    summary.exitCode = record.item.exit_code

    if (typeof record.item.command === "string") {
      summary.command = record.item.command.length > 180
        ? `${record.item.command.slice(0, 177)}...`
        : record.item.command
    }

    if (typeof record.item.text === "string") {
      summary.textLength = record.item.text.length
    }
  }

  return summary
}

function buildPromptPrefix(skillNames: string[], context: RunContext) {
  const skillPrefix = skillNames.length > 0
    ? `Please use the following skills if applicable: ${skillNames.join(", ")}.\n\n`
    : ""
  const executionContext = [
    "Execution context:",
    `- session_id: ${context.sessionId}`,
    `- thread_id: ${context.threadId ?? "null"}`,
    `- turn_id: ${context.turnId}`,
    `- freecad_workspace_dir: ${context.freecadWorkspaceDir ?? "null"}`,
    "",
    "When invoking any freecad-* CLI command, pass these values through environment variables:",
    `- FREECAD_SESSION_ID=${context.sessionId}`,
    `- FREECAD_THREAD_ID=${context.threadId ?? ""}`,
    `- FREECAD_TURN_ID=${context.turnId}`,
    "- FREECAD_CALLER=open_codex_web",
    "- FREECAD_AGENT_NAME=codex",
    context.freecadWorkspaceDir
      ? `- FREECAD_WORKSPACE_DIR=${context.freecadWorkspaceDir}`
      : "- FREECAD_WORKSPACE_DIR=",
    context.freecadWorkspaceDir
      ? `Also pass --workspace ${context.freecadWorkspaceDir} to freecad-* CLI commands whenever the command supports it.`
      : "No FreeCAD workspace is currently configured; ask before running FreeCAD CLI commands.",
  ].join("\n")
  return `${ASK_USER_PROTOCOL}\n\n${skillPrefix}${executionContext}`
}

function buildPrompt(prompt: string, skillNames: string[], context: RunContext) {
  return `${buildPromptPrefix(skillNames, context)}\n\n${prompt.trim()}`
}

function isRunInputItem(item: unknown): item is RunInputItem {
  if (!item || typeof item !== "object") return false
  const record = item as { type?: unknown; text?: unknown; path?: unknown }
  if (record.type === "text") return typeof record.text === "string" && record.text.trim() !== ""
  if (record.type === "local_image") return typeof record.path === "string" && record.path.trim() !== ""
  return false
}

function normalizeRunInput(input: unknown, prompt: unknown): RunInputItem[] | null {
  if (Array.isArray(input)) {
    const items = input
      .filter(isRunInputItem)
      .map(item => item.type === "text"
        ? { type: "text" as const, text: item.text.trim() }
        : { type: "local_image" as const, path: item.path.trim() })
    return items.length > 0 ? items : null
  }

  if (typeof prompt === "string" && prompt.trim() !== "") {
    return [{ type: "text", text: prompt.trim() }]
  }

  return null
}

function buildSdkInput(input: RunInputItem[], skillNames: string[], context: RunContext): string | RunInputItem[] {
  const prefix = buildPromptPrefix(skillNames, context)
  const firstTextIndex = input.findIndex(item => item.type === "text")

  if (firstTextIndex === -1) {
    return [{ type: "text", text: prefix }, ...input]
  }

  return input.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") return item
    return { type: "text", text: `${prefix}\n\n${item.text.trim()}` }
  })
}

function getInputTextLength(input: RunInputItem[]) {
  return input.reduce((total, item) => total + (item.type === "text" ? item.text.length : 0), 0)
}

function getWorkspaceName(workspaceDir: string | null) {
  return workspaceDir ? path.basename(workspaceDir) : null
}

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmp, content, "utf-8")
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

async function readSessionsFile(): Promise<SessionRecord[]> {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf-8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeSessionsFile(sessions: SessionRecord[]) {
  await atomicWrite(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
}

async function ensureRunSession({
  prompt,
  sessionId,
  threadId,
  workspaceDir,
}: {
  prompt: string
  sessionId: string
  threadId: string | null
  workspaceDir: string | null
}) {
  const sessions = await readSessionsFile()
  const index = sessions.findIndex(session => session.id === sessionId)
  const workspaceName = getWorkspaceName(workspaceDir)

  if (index >= 0) {
    const existing = sessions[index]
    sessions[index] = {
      ...existing,
      threadId: existing.threadId ?? threadId,
      workspaceDir: existing.workspaceDir ?? workspaceDir,
      workspaceName: existing.workspaceName ?? workspaceName,
    }
  } else {
    sessions.push({
      id: sessionId,
      title: prompt.slice(0, 60),
      threadId,
      turns: [],
      createdAt: Date.now(),
      dismissedAskUserId: null,
      workspaceDir,
      workspaceName,
    })
  }

  await writeSessionsFile(sessions)
}

async function completeRunSessionTurn({
  events,
  prompt,
  sessionId,
  threadId,
  turnId,
  workspaceDir,
}: {
  events: unknown[]
  prompt: string
  sessionId: string
  threadId: string | null
  turnId: string
  workspaceDir: string | null
}) {
  const sessions = await readSessionsFile()
  const index = sessions.findIndex(session => session.id === sessionId)
  const workspaceName = getWorkspaceName(workspaceDir)
  const turn = { id: turnId, userPrompt: prompt, events }

  if (index >= 0) {
    const existing = sessions[index]
    const turns = Array.isArray(existing.turns) ? existing.turns : []
    const hasTurn = turns.some(item => item.id === turnId)
    sessions[index] = {
      ...existing,
      threadId: threadId ?? existing.threadId ?? null,
      turns: hasTurn ? turns : [...turns, turn],
      workspaceDir: existing.workspaceDir ?? workspaceDir,
      workspaceName: existing.workspaceName ?? workspaceName,
    }
  } else {
    sessions.push({
      id: sessionId,
      title: prompt.slice(0, 60),
      threadId,
      turns: [turn],
      createdAt: Date.now(),
      dismissedAskUserId: null,
      workspaceDir,
      workspaceName,
    })
  }

  await writeSessionsFile(sessions)
}

function summarizeInput(input: RunInputItem[]) {
  return {
    itemCount: input.length,
    textItemCount: input.filter(item => item.type === "text").length,
    localImageItemCount: input.filter(item => item.type === "local_image").length,
    textChars: getInputTextLength(input),
  }
}

function hasPersistableTerminalEvent(events: unknown[]) {
  return events.some(event => {
    if (!event || typeof event !== "object") return false
    const type = (event as { type?: unknown }).type
    return type === "turn.completed" || type === "turn.failed" || type === "error"
  })
}

function normalizeXmlText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function extractAskUserPayload(text: string): AskUserPayload | null {
  const match = text.match(ASK_USER_BLOCK_RE)
  if (!match) return null
  const body = match[1]
  const questionMatch = body.match(ASK_USER_QUESTION_RE)
  const question = questionMatch
    ? normalizeXmlText(questionMatch[1])
    : normalizeXmlText(body.replace(/<[^>]+>/g, " "))

  if (!question) return null

  const options = Array.from(body.matchAll(ASK_USER_OPTION_RE))
    .map(optionMatch => normalizeXmlText(optionMatch[1]))
    .filter(Boolean)
    .filter((option, index, all) => all.indexOf(option) === index)
    .slice(0, 3)

  return { question, options }
}

export async function taskRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  fastify.post("/api/run/input-files", async (req, reply) => {
    const body = req.body as { name?: unknown; mimeType?: unknown; dataBase64?: unknown } | null
    const name = typeof body?.name === "string" ? body.name : "image"
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : ""
    const dataBase64 = typeof body?.dataBase64 === "string" ? body.dataBase64 : ""
    const ext = UPLOADABLE_IMAGE_MIME_TYPES.get(mimeType)

    if (!ext || !dataBase64) {
      return reply.status(400).send({ error: "supported image data is required" })
    }

    const buffer = Buffer.from(dataBase64, "base64")
    if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
      return reply.status(400).send({ error: "image must be between 1 byte and 20 MB" })
    }

    const uploadDir = path.join(os.tmpdir(), "open-codex-web-inputs")
    await fs.mkdir(uploadDir, { recursive: true })
    const uploadPath = path.join(uploadDir, `${Date.now()}-${randomBytes(6).toString("hex")}-${sanitizeUploadName(name)}${ext}`)
    await fs.writeFile(uploadPath, buffer)

    logger.info("codex input image uploaded", { name, mimeType, bytes: buffer.length, path: uploadPath })
    return reply.send({ type: "local_image", path: uploadPath })
  })

  fastify.post<{ Body: RunRequestBody }>(
    "/api/run",
    async (req, reply) => {
      const { prompt, input, sessionId, threadId, turnId, enabledSkills } = req.body
      const sdkInputBase = normalizeRunInput(input, prompt)
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
      const requestStartedAt = process.hrtime.bigint()
      let lastEventAt = requestStartedAt
      let eventCount = 0

      // 如果指定了 skills，把提示注入到 prompt 前面
      const skillNames = (enabledSkills ?? [])
        .filter(s => typeof s === "string" && s.trim() !== "")
        .map(s => s.trim())
      const runContext = {
        freecadWorkspaceDir: await resolveFreecadWorkspaceDir().catch(() => null),
        sessionId: trimmedSessionId,
        threadId: typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null,
        turnId: trimmedTurnId,
      }
      const promptTextForHistory = typeof prompt === "string" && prompt.trim() !== ""
        ? prompt.trim()
        : sdkInputBase
          .filter(item => item.type === "text")
          .map(item => item.text)
          .join("\n\n")
          .trim() || "[input]"
      const finalPrompt = typeof prompt === "string" && prompt.trim() !== ""
        ? buildPrompt(prompt, skillNames, runContext)
        : null
      const sdkInput = buildSdkInput(sdkInputBase, skillNames, runContext)
      const streamedEvents: unknown[] = []
      let resolvedThreadId = runContext.threadId

      await ensureRunSession({
        prompt: promptTextForHistory,
        sessionId: trimmedSessionId,
        threadId: resolvedThreadId,
        workspaceDir: runContext.freecadWorkspaceDir,
      }).catch(err => logger.error("run session ensure failed", { err, sessionId: trimmedSessionId }))

      logger.info("codex run accepted", {
        requestId: req.id,
        sessionId: trimmedSessionId,
        threadId: typeof threadId === "string" && threadId.trim() !== "" ? threadId.trim() : null,
        turnId: trimmedTurnId,
        baseUrl: config.openai.baseUrl,
        model: config.openai.model,
        modelReasoningEffort: config.codex.modelReasoningEffort,
        workingDirectory: config.codex.workingDirectory,
        freecadWorkspaceDir: runContext.freecadWorkspaceDir,
        approvalPolicy: config.codex.approvalPolicy,
        sandboxMode: config.codex.sandboxMode,
        promptChars: typeof prompt === "string" ? prompt.length : 0,
        finalPromptChars: finalPrompt?.length ?? getInputTextLength(Array.isArray(sdkInput) ? sdkInput : sdkInputBase),
        input: summarizeInput(sdkInputBase),
        enabledSkills: skillNames,
      })

      const progressStartedAt = process.hrtime.bigint()
      await initializeFreecadProgressForSession(trimmedSessionId)
      logger.info("codex run progress initialized", {
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
        const codex = new Codex({
          apiKey: config.openai.apiKey,
          baseUrl: config.openai.baseUrl,
          config: {
            show_raw_agent_reasoning: true,
          },
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

        if (shouldPersistRun) {
          await completeRunSessionTurn({
            events: streamedEvents,
            prompt: promptTextForHistory,
            sessionId: trimmedSessionId,
            threadId: resolvedThreadId,
            turnId: trimmedTurnId,
            workspaceDir: runContext.freecadWorkspaceDir,
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
