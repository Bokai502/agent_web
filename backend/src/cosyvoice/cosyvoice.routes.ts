import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import crypto from "node:crypto"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

const BACKEND_ROOT = path.resolve(process.cwd())
const DEFAULT_COSYVOICE_ROOT = path.join(BACKEND_ROOT, "cosyvoice3", "CosyVoice")
const PREGENERATED_TASK_ACCEPTED_AUDIO = path.join(BACKEND_ROOT, "..", "data", "agent-task-accepted.wav")
const DEFAULT_COSYVOICE_URL = "http://127.0.0.1:50000/inference_zero_shot"
const DEFAULT_PROMPT_TEXT = "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。"
const defaultPromptWav = (root: string) => path.join(root, "asset", "zero_shot_prompt.wav")

type TtsBody = {
  text?: unknown
  promptText?: unknown
  outputName?: unknown
}

type AudioParams = {
  fileName?: string
}

type TtsCacheEntry = {
  audio: Buffer
  expiresAt: number
}

const ttsStreamCache = new Map<string, TtsCacheEntry>()

function elapsedMs(startedAt: bigint) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000
}

function makeOutputName(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed) {
      const baseName = path.basename(trimmed).replace(/[^\w.-]/gu, "_")
      return baseName.toLowerCase().endsWith(".wav") ? baseName : `${baseName}.wav`
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/gu, "-")
  return `cosyvoice_${stamp}.wav`
}

function sanitizeWavFileName(value: unknown) {
  if (typeof value !== "string") return null
  const baseName = path.basename(value.trim())
  if (!baseName || baseName !== value.trim()) return null
  if (!/^[\w.-]+\.wav$/iu.test(baseName)) return null
  return baseName
}

function resolvePromptText(value: unknown, config: AppConfig) {
  if (typeof value === "string" && value.trim()) return value.trim()
  return config.cosyvoice.promptText || DEFAULT_PROMPT_TEXT
}

async function readErrorBody(response: Response) {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

function parseTtsBody(body: TtsBody | undefined, config: AppConfig) {
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  const promptText = resolvePromptText(body?.promptText, config)
  return { text, promptText }
}

function getTtsCacheKey({
  endpoint,
  promptText,
  promptWav,
  text,
}: {
  endpoint: string
  promptText: string
  promptWav: string
  text: string
}) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ endpoint, promptText, promptWav, text }))
    .digest("hex")
}

function getCachedTtsAudio(cacheKey: string) {
  const entry = ttsStreamCache.get(cacheKey)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    ttsStreamCache.delete(cacheKey)
    return null
  }
  ttsStreamCache.delete(cacheKey)
  ttsStreamCache.set(cacheKey, entry)
  return entry.audio
}

function rememberCachedTtsAudio(cacheKey: string, audio: Buffer, config: AppConfig) {
  if (config.cosyvoice.streamCacheTtlMs <= 0 || config.cosyvoice.streamCacheMaxItems <= 0) return
  ttsStreamCache.set(cacheKey, {
    audio,
    expiresAt: Date.now() + config.cosyvoice.streamCacheTtlMs,
  })
  while (ttsStreamCache.size > config.cosyvoice.streamCacheMaxItems) {
    const oldestKey = ttsStreamCache.keys().next().value
    if (typeof oldestKey !== "string") break
    ttsStreamCache.delete(oldestKey)
  }
}

async function requestCosyVoiceAudio({
  endpoint,
  promptText,
  promptWav,
  text,
}: {
  endpoint: string
  promptText: string
  promptWav: string
  text: string
}) {
  const promptBytes = await fs.readFile(promptWav)

  const form = new FormData()
  form.set("tts_text", text)
  form.set("prompt_text", promptText)
  form.set("prompt_wav", new Blob([promptBytes], { type: "audio/wav" }), "prompt.wav")

  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(300_000),
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new Error(`cosyvoice upstream failed: HTTP ${response.status}${body ? `\n${body}` : ""}`)
  }

  if (!response.body) {
    throw new Error("cosyvoice upstream returned an empty body")
  }

  return Buffer.from(await response.arrayBuffer())
}

export async function cosyVoiceRoutes(fastify: FastifyInstance, { config, logger }: { config: AppConfig; logger: Logger }) {
  const cosyvoiceRoot = config.cosyvoice.root || DEFAULT_COSYVOICE_ROOT
  const cosyvoiceEndpoint = config.cosyvoice.apiUrl || DEFAULT_COSYVOICE_URL
  const promptWavPath = config.cosyvoice.promptWav || defaultPromptWav(cosyvoiceRoot)

  fastify.get("/api/agent/audio/task-accepted", async (_req, reply) => {
    const stat = await fs.stat(PREGENERATED_TASK_ACCEPTED_AUDIO).catch(() => null)
    if (!stat?.isFile()) return reply.status(404).send({ error: "pregenerated audio not found" })
    return reply
      .header("Content-Type", "audio/wav")
      .header("Content-Length", String(stat.size))
      .header("Cache-Control", "public, max-age=86400")
      .send(createReadStream(PREGENERATED_TASK_ACCEPTED_AUDIO))
  })

  fastify.get("/api/cosyvoice/config", async (_req, reply) => {
    return reply.send({
      endpoint: cosyvoiceEndpoint,
      promptWav: promptWavPath,
      outputDir: cosyvoiceRoot,
      maxTextLength: config.cosyvoice.ttsMaxTextLength,
    })
  })

  fastify.get<{ Params: AudioParams }>("/api/cosyvoice/audio/:fileName", async (req, reply) => {
    const fileName = sanitizeWavFileName(req.params.fileName)
    if (!fileName) {
      return reply.status(400).send({ error: "invalid audio file name" })
    }

    const audioPath = path.join(cosyvoiceRoot, fileName)
    const stat = await fs.stat(audioPath).catch(() => null)

    if (!stat?.isFile()) {
      return reply.status(404).send({ error: "audio file not found" })
    }

    return reply
      .header("Content-Type", "audio/wav")
      .header("Content-Length", String(stat.size))
      .send(createReadStream(audioPath))
  })

  fastify.post<{ Body: TtsBody }>("/api/cosyvoice/tts", async (req, reply) => {
    const requestStartedAt = process.hrtime.bigint()
    const requestId = String(req.id)
    const { text, promptText } = parseTtsBody(req.body, config)

    if (!text) {
      return reply.status(400).send({ error: "text is required" })
    }

    if (text.length > config.cosyvoice.ttsMaxTextLength) {
      return reply.status(413).send({ error: `text is too long; max ${config.cosyvoice.ttsMaxTextLength} characters` })
    }

    const endpoint = cosyvoiceEndpoint
    const promptWav = promptWavPath
    const outputName = makeOutputName(req.body?.outputName)
    const outputPath = path.join(cosyvoiceRoot, outputName)

    logger.info("cosyvoice tts request received", {
      requestId,
      endpoint,
      textLength: text.length,
      promptWav,
      outputPath,
    })

    try {
      await fs.mkdir(cosyvoiceRoot, { recursive: true })
      const audio = await requestCosyVoiceAudio({ endpoint, promptText, promptWav, text })
      await fs.writeFile(outputPath, audio)
      const stat = await fs.stat(outputPath)

      logger.info("cosyvoice tts completed", {
        requestId,
        outputPath,
        bytes: stat.size,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })

      return reply.send({
        ok: true,
        fileName: outputName,
        outputPath,
        bytes: stat.size,
        elapsedMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })
    } catch (err) {
      logger.error("cosyvoice tts failed", {
        requestId,
        err,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })
      return reply.status(500).send({ error: err instanceof Error ? err.message : "failed to synthesize speech" })
    }
  })

  fastify.post<{ Body: TtsBody }>("/api/cosyvoice/tts-stream", async (req, reply) => {
    const requestStartedAt = process.hrtime.bigint()
    const requestId = String(req.id)
    const { text, promptText } = parseTtsBody(req.body, config)

    if (!text) {
      return reply.status(400).send({ error: "text is required" })
    }

    if (text.length > config.cosyvoice.ttsMaxTextLength) {
      return reply.status(413).send({ error: `text is too long; max ${config.cosyvoice.ttsMaxTextLength} characters` })
    }

    const endpoint = cosyvoiceEndpoint
    const promptWav = promptWavPath
    const cacheKey = getTtsCacheKey({ endpoint, promptText, promptWav, text })

    logger.info("cosyvoice tts stream request received", {
      requestId,
      endpoint,
      textLength: text.length,
      promptWav,
    })

    try {
      const cachedAudio = getCachedTtsAudio(cacheKey)
      if (cachedAudio) {
        logger.info("cosyvoice tts stream cache hit", {
          requestId,
          bytes: cachedAudio.byteLength,
          totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
        })
        return reply
          .header("Content-Type", "audio/wav")
          .header("Content-Length", String(cachedAudio.byteLength))
          .header("X-CosyVoice-Cache", "hit")
          .send(cachedAudio)
      }

      const audio = await requestCosyVoiceAudio({ endpoint, promptText, promptWav, text })
      rememberCachedTtsAudio(cacheKey, audio, config)

      logger.info("cosyvoice tts stream completed", {
        requestId,
        bytes: audio.byteLength,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })

      return reply
        .header("Content-Type", "audio/wav")
        .header("Content-Length", String(audio.byteLength))
        .header("X-CosyVoice-Cache", "miss")
        .send(audio)
    } catch (err) {
      logger.error("cosyvoice tts stream failed", {
        requestId,
        err,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })
      return reply.status(500).send({ error: err instanceof Error ? err.message : "failed to synthesize speech" })
    }
  })
}
