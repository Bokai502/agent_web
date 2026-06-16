import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { runAgentTurn } from "../codex-run/agentOrchestrator.js"
import { RunRequestError } from "../codex-run/runErrors.js"

type CommandResult = {
  stdout: string
  stderr: string
}

const BACKEND_ROOT = path.resolve(process.cwd())
const DEFAULT_WHISPER_BIN = path.join(BACKEND_ROOT, "whisper_cpp", "whisper.cpp", "build-cuda", "bin", "whisper-cli")
const WHISPER_BIN_CANDIDATES = [
  DEFAULT_WHISPER_BIN,
  path.join(BACKEND_ROOT, "whisper_cpp", "whisper.cpp", "build-cuda", "bin", "main"),
  path.join(BACKEND_ROOT, "whisper_cpp", "whisper.cpp", "build", "bin", "whisper-cli"),
  path.join(BACKEND_ROOT, "whisper_cpp", "whisper.cpp", "build", "bin", "main"),
]
const DEFAULT_MODEL_PATH = "/data/llm_models/Whisper/ggml-large-v3-turbo.bin"
const DEFAULT_FFMPEG_BIN = "ffmpeg"
const DEFAULT_CUDA_VISIBLE_DEVICES = "1"
const MAX_AUDIO_BYTES = 50 * 1024 * 1024
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/iu

type WhisperStage = {
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

function commandExists(command: string) {
  if (path.isAbsolute(command)) {
    return fs.access(command).then(() => true, () => false)
  }

  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore" })
    child.once("error", () => resolve(false))
    child.once("exit", (code) => resolve(code === 0))
  })
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`${path.basename(command)} timed out`))
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.once("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      const result = {
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
      }
      if (code === 0) {
        resolve(result)
      } else {
        reject(new Error(result.stderr || `${path.basename(command)} exited with code ${code ?? "unknown"}`))
      }
    })
  })
}

function getExtension(contentType: string | undefined) {
  if (!contentType) return ".webm"
  if (contentType.includes("wav")) return ".wav"
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return ".mp3"
  if (contentType.includes("ogg")) return ".ogg"
  if (contentType.includes("mp4")) return ".m4a"
  return ".webm"
}

function parseWhisperText(stdout: string, fallback: string) {
  const text = fallback.trim()
  if (text) return text

  return stdout
    .split("\n")
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/u, "").trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

function isWavContent(contentType: string | undefined) {
  return contentType?.toLowerCase().includes("wav") === true
}

function normalizeLanguage(value: unknown, config: AppConfig) {
  const requestedLanguage = typeof value === "string" ? value.trim().toLowerCase() : getDefaultLanguage(config)
  if (!requestedLanguage || requestedLanguage === "auto") return { requestedLanguage: "auto", whisperLanguage: "auto" }
  if (requestedLanguage === "zh-en") return { requestedLanguage, whisperLanguage: "zh" }
  return LANGUAGE_PATTERN.test(requestedLanguage)
    ? { requestedLanguage, whisperLanguage: requestedLanguage }
    : null
}

function getDefaultLanguage(config?: AppConfig) {
  const language = (config?.whisper.defaultLanguage || "zh-en").trim().toLowerCase()
  if (!language || language === "auto") return "auto"
  if (language === "zh-en") return "zh-en"
  return LANGUAGE_PATTERN.test(language) ? language : "zh"
}

async function resolveWhisperBin(config?: AppConfig) {
  if (config?.whisper.bin) return config.whisper.bin

  for (const candidate of WHISPER_BIN_CANDIDATES) {
    if (await commandExists(candidate)) return candidate
  }

  return DEFAULT_WHISPER_BIN
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

export async function whisperRoutes(fastify: FastifyInstance, { config, logger }: { config: AppConfig; logger: Logger }) {
  fastify.addContentTypeParser(/^audio\/.*/u, { parseAs: "buffer", bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body)
  })
  fastify.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: MAX_AUDIO_BYTES }, (_req, body, done) => {
    done(null, body)
  })

  fastify.get("/api/whisper/models", async (_req, reply) => {
    const modelPath = config.whisper.modelPath || DEFAULT_MODEL_PATH
    const whisperBin = await resolveWhisperBin(config)
    const ffmpegBin = config.whisper.ffmpegBin || DEFAULT_FFMPEG_BIN
    const cudaVisibleDevices = config.whisper.cudaVisibleDevices || DEFAULT_CUDA_VISIBLE_DEVICES

    return reply.send({
      selected: "large-v3-turbo",
      modelPath,
      whisperBin,
      ffmpegBin,
      cudaVisibleDevices,
      defaultLanguage: getDefaultLanguage(config),
      availableDownloads: [
        {
          name: "large-v3-turbo",
          file: "ggml-large-v3-turbo.bin",
          url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        },
      ],
    })
  })

  fastify.post("/api/whisper/transcribe", async (req, reply) => {
    const requestStartedAt = process.hrtime.bigint()
    const stages: WhisperStage[] = []
    let stageStartedAt = requestStartedAt
    const requestId = req.id

    const markStage = (name: string, meta?: Record<string, unknown>) => {
      const now = process.hrtime.bigint()
      const stage = { name, ms: elapsedMs(stageStartedAt), ...(meta ? { meta } : {}) }
      stages.push(stage)
      logger.info("whisper stage completed", {
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

    const whisperBin = await resolveWhisperBin(config)
    const modelPath = config.whisper.modelPath || DEFAULT_MODEL_PATH
    const ffmpegBin = config.whisper.ffmpegBin || DEFAULT_FFMPEG_BIN
    const languageConfig = normalizeLanguage(req.headers["x-whisper-language"], config)
    const cudaVisibleDevices = config.whisper.cudaVisibleDevices || DEFAULT_CUDA_VISIBLE_DEVICES
    const whisperEnv = { ...process.env, CUDA_VISIBLE_DEVICES: cudaVisibleDevices }
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-whisper-"))
    const inputPath = path.join(tmpDir, `input${getExtension(contentType)}`)
    const shouldConvert = !isWavContent(contentType)
    const wavPath = shouldConvert ? path.join(tmpDir, "audio.wav") : inputPath
    const outputBase = path.join(tmpDir, "transcript")
    const outputTextPath = `${outputBase}.txt`

    logger.info("whisper request received", {
      requestId,
      bytes: body.byteLength,
      contentType,
      cudaVisibleDevices,
      requestedLanguage: languageConfig?.requestedLanguage ?? null,
      whisperLanguage: languageConfig?.whisperLanguage ?? null,
      modelPath,
      whisperBin,
    })

    if (languageConfig === null) {
      return reply.status(400).send({ error: "invalid whisper language" })
    }

    try {
      const [hasWhisper, hasModel, hasFfmpeg] = await Promise.all([
        commandExists(whisperBin),
        fs.access(modelPath).then(() => true, () => false),
        shouldConvert ? commandExists(ffmpegBin) : Promise.resolve(true),
      ])
      markStage("dependency-check", { hasWhisper, hasModel, hasFfmpeg, shouldConvert })

      if (!hasWhisper) {
        return reply.status(503).send({ error: `whisper.cpp binary not found: ${whisperBin}` })
      }
      if (!hasModel) {
        return reply.status(503).send({ error: `whisper model not found: ${modelPath}` })
      }
      if (!hasFfmpeg) {
        return reply.status(503).send({ error: `ffmpeg not found: ${ffmpegBin}` })
      }

      await fs.writeFile(inputPath, body)
      markStage("write-upload", { inputPath })
      if (shouldConvert) {
        await runCommand(ffmpegBin, [
          "-y",
          "-i", inputPath,
          "-ar", "16000",
          "-ac", "1",
          "-c:a", "pcm_s16le",
          wavPath,
        ], 60_000)
        markStage("convert-audio", { ffmpegBin, wavPath })
      } else {
        markStage("use-uploaded-wav", { wavPath })
      }

      const whisperArgs = [
        "-m", modelPath,
        "-f", wavPath,
        "-otxt",
        "-of", outputBase,
        "-nt",
      ]
      if (languageConfig.whisperLanguage !== "auto") {
        whisperArgs.push("-l", languageConfig.whisperLanguage)
      }

      const result = await runCommand(whisperBin, whisperArgs, 10 * 60_000, whisperEnv)
      markStage("run-whisper", { stderrBytes: result.stderr.length, stdoutBytes: result.stdout.length })
      const transcript = await fs.readFile(outputTextPath, "utf-8").catch(() => "")
      const text = parseWhisperText(result.stdout, transcript)
      markStage("read-transcript", { outputTextPath, textLength: text.length })

      logger.info("whisper transcription completed", {
        requestId,
        bytes: body.byteLength,
        cudaVisibleDevices,
        requestedLanguage: languageConfig.requestedLanguage,
        whisperLanguage: languageConfig.whisperLanguage,
        textLength: text.length,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
        stages: stages.map((stage) => ({
          ...stage,
          ms: Number(stage.ms.toFixed(2)),
        })),
      })
      return reply.send({
        text,
        model: "large-v3-turbo",
        language: languageConfig.requestedLanguage,
        whisperLanguage: languageConfig.whisperLanguage,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to transcribe audio"
      logger.error("whisper transcription failed", {
        requestId,
        err,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
        stages: stages.map((stage) => ({
          ...stage,
          ms: Number(stage.ms.toFixed(2)),
        })),
      })
      return reply.status(500).send({ error: message })
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  fastify.post<{ Body: CodexTextBody }>("/api/whisper/codex", async (req, reply) => {
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
      logger.error("whisper codex request failed", {
        requestId,
        err,
        totalDurationMs: Number(elapsedMs(requestStartedAt).toFixed(2)),
      })
      return reply.status(500).send({ error: err instanceof Error ? err.message : "failed to run codex" })
    }
  })
}
