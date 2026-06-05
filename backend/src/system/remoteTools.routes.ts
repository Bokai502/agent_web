import { spawn } from "node:child_process"
import net from "node:net"
import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

const REMOTE_DESKTOP_TOOLS = ["freecad", "paraview", "comsol"] as const
const TCP_CHECK_TIMEOUT_MS = 1200

type RemoteDesktopTool = typeof REMOTE_DESKTOP_TOOLS[number]
type RemoteToolConfigKey = "cad" | "paraview" | "comsol"

type RemoteToolPortConfig = {
  tool: RemoteDesktopTool
  label: string
  host: string
  port: number
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
  latencyMs: number | null
  message: string
}

function toolConfigKey(tool: RemoteDesktopTool): RemoteToolConfigKey {
  return tool === "freecad" ? "cad" : tool
}

function buildRemoteToolPorts(config: AppConfig): RemoteToolPortConfig[] {
  return [
    { tool: "freecad", label: "FreeCAD", host: "127.0.0.1", port: config.tools.cad.noVncPort },
    { tool: "paraview", label: "ParaView", host: "127.0.0.1", port: config.tools.paraview.noVncPort },
    { tool: "comsol", label: "COMSOL", host: "127.0.0.1", port: config.tools.comsol.noVncPort },
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

function checkTcpPort(tool: RemoteToolPortConfig): Promise<RemoteToolPortStatus> {
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
        tool: tool.tool,
        label: tool.label,
        host: tool.host,
        port: tool.port,
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

export async function remoteToolsRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger },
) {
  fastify.get("/api/remote-tools/port-status", async (_req, reply) => {
    const ports = await Promise.all(buildRemoteToolPorts(config).map(tool => checkTcpPort(tool)))
    const ok = ports.every(port => port.ok)

    if (!ok) {
      logger.warn("remote tool port check failed", {
        ports: ports.map(port => ({
          tool: port.tool,
          port: port.port,
          ok: port.ok,
          message: port.message,
        })),
      })
    }

    return reply.status(ok ? 200 : 503).send({
      ok,
      checkedAt: new Date().toISOString(),
      timeoutMs: TCP_CHECK_TIMEOUT_MS,
      ports,
    })
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
