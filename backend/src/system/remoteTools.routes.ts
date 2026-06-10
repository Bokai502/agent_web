import { execFile, spawn } from "node:child_process"
import net from "node:net"
import path from "node:path"
import { promisify } from "node:util"
import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

const REMOTE_DESKTOP_TOOLS = ["freecad", "paraview", "comsol"] as const
const TCP_CHECK_TIMEOUT_MS = 1200
const HTTP_CHECK_TIMEOUT_MS = 1800
const INTERFACE_CHECK_CACHE_MS = 60_000
const INTERFACE_CHECK_TIMEOUT_MS = 360_000
const execFileAsync = promisify(execFile)

type RemoteDesktopTool = typeof REMOTE_DESKTOP_TOOLS[number]
type RemoteToolConfigKey = "cad" | "paraview" | "comsol"

type RemoteToolPortConfig = {
  tool: RemoteDesktopTool
  label: string
  host: string
  port: number
  url: string
}

type LauncherResult = {
  ok: boolean
  tool: RemoteDesktopTool
  command: string[]
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: string
}

type RemoteToolPortStatus = {
  ok: boolean
  tool: RemoteDesktopTool
  label: string
  host: string
  port: number
  url: string
  latencyMs: number | null
  message: string
  tcpOk: boolean
  httpOk: boolean
  httpStatus: number | null
}

type InterfaceCheckResult = {
  group: string
  name: string
  target: string
  required: boolean
  ok: boolean
  skipped: boolean
  durationMs: number
  message?: string
  error?: string
  status?: number
  bytes?: number
}

type InterfaceCheckSummary = {
  ok: boolean
  checkedAt: string
  cacheTtlMs: number
  command: string[]
  results: InterfaceCheckResult[]
  requiredFailureCount: number
  optionalFailureCount: number
  skippedCount: number
}

type CachedInterfaceCheck = {
  value: InterfaceCheckSummary
  cachedAt: number
}

function toolConfigKey(tool: RemoteDesktopTool): RemoteToolConfigKey {
  return tool === "freecad" ? "cad" : tool
}

function buildRemoteToolPorts(config: AppConfig): RemoteToolPortConfig[] {
  return [
    { tool: "freecad", label: "FreeCAD", host: "127.0.0.1", port: config.tools.cad.noVncPort, url: `http://127.0.0.1:${config.tools.cad.noVncPort}/` },
    { tool: "paraview", label: "ParaView", host: "127.0.0.1", port: config.tools.paraview.noVncPort, url: `http://127.0.0.1:${config.tools.paraview.noVncPort}/` },
    { tool: "comsol", label: "COMSOL", host: "127.0.0.1", port: config.tools.comsol.noVncPort, url: `http://127.0.0.1:${config.tools.comsol.noVncPort}/` },
  ]
}

function runLauncher(tool: RemoteDesktopTool, config: AppConfig): Promise<LauncherResult> {
  let executable = config.tools.remoteDesktopLauncher
  let args: string[] = [tool, "start"]
  if (tool === "comsol") {
    const sudoCommand = config.tools.comsol.sudo.trim()
    executable = sudoCommand || config.tools.comsol.launcher
    args = sudoCommand ? [config.tools.comsol.launcher] : []
  }
  const command = [executable, ...args]

  return new Promise(resolve => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.stdout.on("data", chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderrChunks.push(Buffer.from(chunk)))

    child.on("error", error => {
      resolve({
        ok: false,
        tool,
        command,
        code: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        error: error.message,
      })
    })

    child.on("close", (code, signal) => {
      resolve({
        ok: code === 0,
        tool,
        command,
        code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      })
    })
  })
}

type TcpCheckResult = {
  ok: boolean
  latencyMs: number
  message: string
}

type HttpCheckResult = {
  ok: boolean
  status: number | null
  message: string
}

function checkTcpPort(tool: RemoteToolPortConfig): Promise<TcpCheckResult> {
  const startedAt = process.hrtime.bigint()

  return new Promise(resolve => {
    const socket = net.createConnection({ host: tool.host, port: tool.port })
    let resolved = false

    const finish = (ok: boolean, message: string) => {
      if (resolved) return
      resolved = true
      socket.removeAllListeners()
      socket.destroy()
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      resolve({
        ok,
        latencyMs: Math.round(latencyMs),
        message,
      })
    }

    socket.setTimeout(TCP_CHECK_TIMEOUT_MS)
    socket.once("connect", () => finish(true, "listening"))
    socket.once("timeout", () => finish(false, "connection timeout"))
    socket.once("error", error => finish(false, error.message))
  })
}

async function checkHttpEndpoint(url: string): Promise<HttpCheckResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    })
    return {
      ok: response.status >= 200 && response.status < 500,
      status: response.status,
      message: `http ${response.status}`,
    }
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "http timeout"
      : error instanceof Error
        ? error.message
        : String(error)
    return { ok: false, status: null, message }
  } finally {
    clearTimeout(timeout)
  }
}

async function checkRemoteTool(tool: RemoteToolPortConfig): Promise<RemoteToolPortStatus> {
  const tcp = await checkTcpPort(tool)
  const http = tcp.ok ? await checkHttpEndpoint(tool.url) : { ok: false, status: null, message: "tcp unavailable" }

  return {
    ok: tcp.ok && http.ok,
    tool: tool.tool,
    label: tool.label,
    host: tool.host,
    port: tool.port,
    url: tool.url,
    latencyMs: tcp.latencyMs,
    message: tcp.ok ? http.message : tcp.message,
    tcpOk: tcp.ok,
    httpOk: http.ok,
    httpStatus: http.status,
  }
}

function resolveProjectRoot() {
  const cwd = process.cwd()
  const parent = path.resolve(cwd, "..")
  return path.basename(cwd) === "backend" ? parent : cwd
}

function parseInterfaceCheckOutput(stdout: string) {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error("interface check script returned no output")
  return JSON.parse(trimmed) as { ok: boolean; results: InterfaceCheckResult[] }
}

async function runInterfaceCheck(): Promise<InterfaceCheckSummary> {
  const projectRoot = resolveProjectRoot()
  const scriptPath = path.join(projectRoot, "scripts", "check_function_interfaces.mjs")
  const configPath = path.join(projectRoot, "config.json")
  const command = [process.execPath, scriptPath, "--json"]

  try {
    const { stdout } = await execFileAsync(command[0], command.slice(1), {
      cwd: projectRoot,
      timeout: INTERFACE_CHECK_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 5,
    })
    const payload = parseInterfaceCheckOutput(stdout)
    const results = Array.isArray(payload.results) ? payload.results : []
    return buildInterfaceCheckSummary(payload.ok, command, results)
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown }).stdout === "string"
      ? (error as { stdout: string }).stdout
      : ""
    if (stdout.trim()) {
      const payload = parseInterfaceCheckOutput(stdout)
      const results = Array.isArray(payload.results) ? payload.results : []
      return buildInterfaceCheckSummary(payload.ok, command, results)
    }
    return buildInterfaceCheckSummary(false, command, [{
      group: "interface-check",
      name: "Interface check script",
      target: `${scriptPath} --config ${configPath}`,
      required: true,
      ok: false,
      skipped: false,
      durationMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }])
  }
}

function buildInterfaceCheckSummary(ok: boolean, command: string[], results: InterfaceCheckResult[]): InterfaceCheckSummary {
  const requiredFailureCount = results.filter(item => item.required && !item.ok).length
  const optionalFailureCount = results.filter(item => !item.required && !item.ok).length
  const skippedCount = results.filter(item => item.skipped).length
  return {
    ok: ok && requiredFailureCount === 0,
    checkedAt: new Date().toISOString(),
    cacheTtlMs: INTERFACE_CHECK_CACHE_MS,
    command,
    results,
    requiredFailureCount,
    optionalFailureCount,
    skippedCount,
  }
}

export async function remoteToolsRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger },
) {
  let interfaceCheckCache: CachedInterfaceCheck | null = null
  let interfaceCheckInflight: Promise<InterfaceCheckSummary> | null = null

  async function getInterfaceCheckSummary({ force = false } = {}) {
    const now = Date.now()
    if (!force && interfaceCheckCache && now - interfaceCheckCache.cachedAt < INTERFACE_CHECK_CACHE_MS) {
      return interfaceCheckCache.value
    }
    if (!interfaceCheckInflight) {
      interfaceCheckInflight = runInterfaceCheck()
        .then(summary => {
          interfaceCheckCache = { value: summary, cachedAt: Date.now() }
          if (!summary.ok) {
            logger.warn("functional interface check failed", {
              requiredFailureCount: summary.requiredFailureCount,
              optionalFailureCount: summary.optionalFailureCount,
              failed: summary.results
                .filter(item => !item.ok)
                .map(item => ({ group: item.group, name: item.name, target: item.target, error: item.error })),
            })
          }
          return summary
        })
        .finally(() => {
          interfaceCheckInflight = null
        })
    }
    return interfaceCheckInflight
  }

  fastify.get("/api/remote-tools/port-status", async (_req, reply) => {
    const summary = await getInterfaceCheckSummary()
    return reply.status(summary.ok ? 200 : 503).send(summary)
  })

  fastify.get("/api/remote-tools/interface-status", async (req, reply) => {
    const force = typeof req.query === "object" && req.query != null && "force" in req.query
    const summary = await getInterfaceCheckSummary({ force })
    return reply.status(summary.ok ? 200 : 503).send(summary)
  })

  fastify.post("/api/remote-tools/ensure-desktops", async (_req, reply) => {
    const results: LauncherResult[] = []

    for (const tool of REMOTE_DESKTOP_TOOLS) {
      const result = await runLauncher(tool, config)
      results.push(result)
      const configKey = toolConfigKey(tool)
      if (result.ok) {
        logger.info("remote desktop ensured", { tool, configKey, command: result.command })
      } else {
        logger.warn("remote desktop ensure failed", {
          tool,
          configKey,
          command: result.command,
          code: result.code,
          signal: result.signal,
          error: result.error,
          stderr: result.stderr.slice(0, 1000),
        })
      }
    }

    const ok = results.every(result => result.ok)
    return reply.status(ok ? 200 : 503).send({ ok, results })
  })
}
