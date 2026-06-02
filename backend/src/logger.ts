import fs from "fs"
import path from "path"
import { Writable } from "stream"
import type { LogLevel } from "./config.js"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10, info: 20, warn: 30, error: 40,
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  /** Writable stream that fastify/pino can pipe to (writes raw pino JSON lines). */
  stream: Writable
}

function serialize(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: v.stack }
    } else {
      out[k] = v
    }
  }
  return out
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function shouldSkipFastifyAccessLog(msg: unknown) {
  return msg === "incoming request" || msg === "request completed"
}

export function createLogger(opts: {
  level: LogLevel
  file: string
  alsoStdout: boolean
}): Logger {
  const absFile = path.isAbsolute(opts.file)
    ? opts.file
    : path.resolve(process.cwd(), opts.file)

  fs.mkdirSync(path.dirname(absFile), { recursive: true })

  const fileStream = fs.createWriteStream(absFile, { flags: "a" })

  const threshold = LEVEL_ORDER[opts.level]

  function write(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_ORDER[level] < threshold) return
    const ts = new Date().toISOString()
    const metaStr = meta && Object.keys(meta).length ? " " + safeStringify(serialize(meta)) : ""
    const line = `[${ts}] ${level.toUpperCase()} ${msg}${metaStr}\n`
    fileStream.write(line)
    if (opts.alsoStdout) {
      const fn = level === "error" || level === "warn" ? process.stderr : process.stdout
      fn.write(line)
    }
  }

  // Fastify/pino 写的是 JSON 行，我们解析后走同一个格式化逻辑
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString("utf-8")
      for (const raw of text.split("\n")) {
        if (!raw) continue
        try {
          const obj = JSON.parse(raw) as { level?: number; time?: number; msg?: string; [k: string]: unknown }
          const level: LogLevel =
            (obj.level ?? 30) >= 50 ? "error" :
            (obj.level ?? 30) >= 40 ? "warn" :
            (obj.level ?? 30) >= 30 ? "info" : "debug"
          if (shouldSkipFastifyAccessLog(obj.msg)) continue
          const { level: _l, time: _t, msg, pid: _p, hostname: _h, ...rest } = obj
          write(level, typeof msg === "string" ? msg : "http", rest as Record<string, unknown>)
        } catch {
          // 不是 JSON 就原样记一行 info
          write("info", raw)
        }
      }
      cb()
    },
  })

  return {
    debug: (m, meta) => write("debug", m, meta),
    info:  (m, meta) => write("info", m, meta),
    warn:  (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    stream,
  }
}
