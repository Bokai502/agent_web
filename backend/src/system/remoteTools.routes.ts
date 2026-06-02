import { spawn } from "node:child_process"
import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"

const DESKTOP_LAUNCHER = "/usr/local/bin/start-remote-cad-desktop"
const COMSOL_LAUNCHER = "/usr/local/bin/start-comsol-remote"
const REMOTE_DESKTOP_TOOLS = ["freecad", "paraview", "comsol"] as const

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

export async function remoteToolsRoutes(
  fastify: FastifyInstance,
  { logger }: { logger: Logger },
) {
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
