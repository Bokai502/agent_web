import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { runAgentTurn } from "../codex-run/agentOrchestrator.js"
import { RunRequestError } from "../codex-run/runErrors.js"

const DEFAULT_LANGUAGE = "zh-en"
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/iu
const REMOTE_TRANSCRIBE_TIMEOUT_MS = 10 * 60_000

type FunASRStage = {
  name: string
  ms: number
  meta?: Record<string, unknown>
}

type CodexTextBody = {
  enabledSkills?: unknown
  sessionId?: unknown
  text?: unknown
  threadId?: unknown
  turnId?: unknown
  versionId?: unknown
  workspaceDir?: unknown
  workspaceId?: unknown
  workspaceName?: unknown
}

function getExtension(contentType: string | undefined) {
  if (!contentType) return ".webm"
  if (contentType.includes("wav")) return ".wav"
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return ".mp3"
  if (contentType.includes("ogg")) return ".ogg"
  if (contentType.includes("mp4")) return ".m4a"
  return ".webm"
}

function normalizeLanguage(value: unknown) {
  const requestedLanguage = typeof value === "string" ? value.trim().toLowerCase() : DEFAULT_LANGUAGE
  if (!requestedLanguage || requestedLanguage === "auto") return { requestedLanguage: "auto", funasrLanguage: "auto" }
  if (requestedLanguage === "zh-en") return { requestedLanguage, funasrLanguage: "zh" }
  return LANGUAGE_PATTERN.test(requestedLanguage)
    ? { requestedLanguage, funasrLanguage: requestedLanguage }
    : null
}

function getRemoteLanguage(languageConfig: NonNullable<ReturnType<typeof normalizeLanguage>>) {
  if (languageConfig.requestedLanguage === "zh-en") return "auto"
  return languageConfig.requestedLanguage
}

function parseRemoteText(payload: unknown) {
  if (typeof payload === "object" && payload !== null && "text" in payload) {
    const text = (payload as { text?: unknown }).text
    if (typeof text === "string") return text.trim()
  }
  return null
}

function elapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function getEnabledSkills(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map(item => item.trim())
}

export async function funasrRoutes(fastify: FastifyInstance, { config, logger }: { config: AppConfig; logger: Logger }) {
  fastify.addContentTypeParser(/^audio\/.*/u, { parseAs: "buffer", bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body)
  })
  fastify.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body)
  })

  fastify.get("/api/funasr/models", async (_req, reply) => {
    return reply.send({
      selected: "funasr-sensevoice",
      apiUrl: config.funasr.apiUrl,
    })
  })

  fastify.post("/api/funasr/transcribe", async (req, reply) => {
    const requestStartedAt = process.hrtime.bigint()
    const stages: FunASRStage[] = []
    let stageStartedAt = requestStartedAt
    const requestId = req.id

    const markStage = (name: string, meta?: Record<string, unknown>) => {
      const now = process.hrtime.bigint()
      const stage = { name, ms: elapsedMs(stageStartedAt), ...(meta ? { meta } : {}) }
      stages.push(stage)
      logger.info("funasr stage completed", {
        requestId,
        stage: name,
        durationMs: Number(stage.ms.toFixed(2)),
        ...(meta ?? {}),
      })
      stageStartedAt = now
    }

    const contentType = req.headers["content-type"]
    const body = await req.body

    if (!Buffer.isBuffer(body)) {
      return reply.status(400).send({ error: "expected raw audio bytes" })
    }

    if (body.byteLength === 0) {
      return reply.status(400).send({ error: "audio is empty" })
    }

    if (body.byteLength > MAX_AUDIO_BYTES) {
      return reply.status(413).send({ error: "audio is too large" })
    }

    const languageConfig = normalizeLanguage(req.headers["x-funasr-language"])
    const apiUrl = config.funasr.apiUrl

    logger.info("funasr request received", {
      requestId,
      bytes: body.byteLength,
      contentType,
      apiUrl,
      requestedLanguage: languageConfig?.requestedLanguage ?? null,
      funasrLanguage: languageConfig?.funasrLanguage ?? null,
    })

    if (languageConfig === null) {
      return reply.status(400).send({ error: "invalid funasr language" })
    }
    if (!apiUrl) {
      return reply.status(503).send({ error: "funasr apiUrl is not configured" })
    }

    try {
      const remoteLanguage = getRemoteLanguage(languageConfig)
      const form = new FormData()
      const audioBytes = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
      form.set("file", new Blob([audioBytes], { type: contentType || "application/octet-stream" }), `audio${getExtension(contentType)}`)
      form.set("language", remoteLanguage)
      form.set("response_format", "json")
      markStage("build-request", { remoteLanguage })

      const response = await fetch(apiUrl, {
        body: form,
        method: "POST",
        signal: AbortSignal.timeout(REMOTE_TRANSCRIBE_TIMEOUT_MS),
      })
      markStage("remote-transcribe", { statusCode: response.status })
      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        throw new Error(`remote funasr service returned ${response.status}${errorText ? `: ${errorText}` : ""}`)
      }

      const payload = await response.json() as unknown
      const text = parseRemoteText(payload)
      if (text === null) {
        throw new Error("remote funasr service returned an invalid transcription payload")
      }
      markStage("read-transcript", { textLength: text.length })

      logger.info("funasr transcription completed", {
        requestId,
        bytes: body.byteLength,
        apiUrl,
        requestedLanguage: languageConfig.requestedLanguage,
        funasrLanguage: languageConfig.funasrLanguage,
        textLength: text.length,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
        stages: stages.map((stage) => ({
          ...stage,
          ms: Number(stage.ms.toFixed(2)),
        })),
      })
      return reply.send({
        text,
        model: "funasr-sensevoice",
        language: languageConfig.requestedLanguage,
        funasrLanguage: languageConfig.funasrLanguage,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to transcribe audio"
      logger.error("funasr transcription failed", {
        requestId,
        err,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
        stages: stages.map((stage) => ({
          ...stage,
          ms: Number(stage.ms.toFixed(2)),
        })),
      })
      return reply.status(500).send({ error: message })
    }
  })

  fastify.post<{ Body: CodexTextBody }>("/api/funasr/codex", async (req, reply) => {
    const requestStartedAt = process.hrtime.bigint()
    const requestId = String(req.id)
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : ""

    if (!text) {
      return reply.status(400).send({ error: "text is required" })
    }

    try {
      const managed = await runAgentTurn({
        body: {
          enabledSkills: getEnabledSkills(req.body?.enabledSkills),
          prompt: text,
          sessionId: getOptionalString(req.body?.sessionId),
          threadId: getOptionalString(req.body?.threadId),
          turnId: getOptionalString(req.body?.turnId),
          versionId: getOptionalString(req.body?.versionId),
          workspaceDir: getOptionalString(req.body?.workspaceDir),
          workspaceId: getOptionalString(req.body?.workspaceId),
          workspaceName: getOptionalString(req.body?.workspaceName),
        },
        inputType: "voice",
      }, { config, logger, requestId })
      return reply.send({
        codexResponse: managed.spokenSummary || managed.summary,
        elapsedMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
        managedRunId: managed.managedRunId,
        routing: managed.routing,
        sessionId: managed.sessionId,
        spokenSummary: managed.spokenSummary,
        status: managed.status,
        summary: managed.summary,
        threadId: managed.threadId,
        turnId: managed.turnId,
        workspaceDir: managed.workspaceDir,
        workspaceId: managed.workspaceId,
      })
    } catch (err) {
      if (err instanceof RunRequestError) return reply.status(err.statusCode).send({ error: err.message })
      logger.error("funasr codex request failed", {
        requestId,
        err,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })
      return reply.status(500).send({ error: err instanceof Error ? err.message : "failed to run codex" })
    }
  })
}
