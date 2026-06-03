import { spawn } from "node:child_process"
import net from "node:net"
import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"

const DESKTOP_LAUNCHER = "/usr/local/bin/start-remote-cad-desktop"
const COMSOL_LAUNCHER = "/usr/local/bin/start-comsol-remote"
const REMOTE_DESKTOP_TOOLS = ["freecad", "paraview", "comsol"] as const
const REMOTE_TOOL_PORTS = [
  { tool: "freecad", label: "FreeCAD", host: "127.0.0.1", port: 6080 },
  { tool: "paraview", label: "ParaView", host: "127.0.0.1", port: 6081 },
  { tool: "comsol", label: "COMSOL", host: "127.0.0.1", port: 6082 },
] as const
const TCP_CHECK_TIMEOUT_MS = 1200

type RemoteDesktopTool = typeof REMOTE_DESKTOP_TOOLS[number]

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

function runLauncher(tool: RemoteDesktopTool): Promise<LauncherResult> {
  const executable = tool === "comsol" ? COMSOL_LAUNCHER : DESKTOP_LAUNCHER
  const args = tool === "comsol" ? [] : [tool, "start"]
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

function checkTcpPort(tool: typeof REMOTE_TOOL_PORTS[number]): Promise<RemoteToolPortStatus> {
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
  { logger }: { logger: Logger },
) {
  fastify.get("/api/remote-tools/port-status", async (_req, reply) => {
    const ports = await Promise.all(REMOTE_TOOL_PORTS.map(tool => checkTcpPort(tool)))
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
      const result = await runLauncher(tool)
      results.push(result)
      if (result.ok) {
        logger.info("remote desktop ensured", { tool, command: result.command })
      } else {
        logger.warn("remote desktop ensure failed", {
          tool,
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
