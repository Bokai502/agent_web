import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import crypto from "node:crypto"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"

const BACKEND_ROOT = path.resolve(process.cwd())
const COSYVOICE_ROOT = path.join(BACKEND_ROOT, "cosyvoice3", "CosyVoice")
const PREGENERATED_TASK_ACCEPTED_AUDIO = path.join(BACKEND_ROOT, "..", "docs", "agent-task-accepted.wav")
const DEFAULT_COSYVOICE_URL = "http://127.0.0.1:50000/inference_zero_shot"
const DEFAULT_PROMPT_TEXT = "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。"
const DEFAULT_PROMPT_WAV = path.join(COSYVOICE_ROOT, "asset", "zero_shot_prompt.wav")
const MAX_TTS_TEXT_LENGTH = 5000
const TTS_STREAM_CACHE_TTL_MS = Number(process.env.COSYVOICE_TTS_CACHE_TTL_MS ?? 1000 * 60 * 10)
const TTS_STREAM_CACHE_MAX_ITEMS = Number(process.env.COSYVOICE_TTS_CACHE_MAX_ITEMS ?? 64)

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

function resolvePromptText(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim()
  return process.env.COSYVOICE_PROMPT_TEXT || DEFAULT_PROMPT_TEXT
}

async function readErrorBody(response: Response) {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

function parseTtsBody(body: TtsBody | undefined) {
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  const promptText = resolvePromptText(body?.promptText)
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

function rememberCachedTtsAudio(cacheKey: string, audio: Buffer) {
  if (TTS_STREAM_CACHE_TTL_MS <= 0 || TTS_STREAM_CACHE_MAX_ITEMS <= 0) return
  ttsStreamCache.set(cacheKey, {
    audio,
    expiresAt: Date.now() + TTS_STREAM_CACHE_TTL_MS,
  })
  while (ttsStreamCache.size > TTS_STREAM_CACHE_MAX_ITEMS) {
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

export async function cosyVoiceRoutes(fastify: FastifyInstance, { logger }: { logger: Logger }) {
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
      endpoint: process.env.COSYVOICE_API_URL || DEFAULT_COSYVOICE_URL,
      promptWav: process.env.COSYVOICE_PROMPT_WAV || DEFAULT_PROMPT_WAV,
      outputDir: COSYVOICE_ROOT,
      maxTextLength: MAX_TTS_TEXT_LENGTH,
    })
  })

  fastify.get<{ Params: AudioParams }>("/api/cosyvoice/audio/:fileName", async (req, reply) => {
    const fileName = sanitizeWavFileName(req.params.fileName)
    if (!fileName) {
      return reply.status(400).send({ error: "invalid audio file name" })
    }

    const audioPath = path.join(COSYVOICE_ROOT, fileName)
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
    const { text, promptText } = parseTtsBody(req.body)

    if (!text) {
      return reply.status(400).send({ error: "text is required" })
    }

    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return reply.status(413).send({ error: `text is too long; max ${MAX_TTS_TEXT_LENGTH} characters` })
    }

    const endpoint = process.env.COSYVOICE_API_URL || DEFAULT_COSYVOICE_URL
    const promptWav = process.env.COSYVOICE_PROMPT_WAV || DEFAULT_PROMPT_WAV
    const outputName = makeOutputName(req.body?.outputName)
    const outputPath = path.join(COSYVOICE_ROOT, outputName)

    logger.info("cosyvoice tts request received", {
      requestId,
      endpoint,
      textLength: text.length,
      promptWav,
      outputPath,
    })

    try {
      await fs.mkdir(COSYVOICE_ROOT, { recursive: true })
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
    const { text, promptText } = parseTtsBody(req.body)

    if (!text) {
      return reply.status(400).send({ error: "text is required" })
    }

    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return reply.status(413).send({ error: `text is too long; max ${MAX_TTS_TEXT_LENGTH} characters` })
    }

    const endpoint = process.env.COSYVOICE_API_URL || DEFAULT_COSYVOICE_URL
    const promptWav = process.env.COSYVOICE_PROMPT_WAV || DEFAULT_PROMPT_WAV
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
      rememberCachedTtsAudio(cacheKey, audio)

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
