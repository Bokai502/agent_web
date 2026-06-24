import { constants } from "node:fs"
import { access } from "node:fs/promises"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import type { AppConfig } from "../config.js"

type ProcessResult = {
  ok: boolean
  command: string[]
  stdout: string
  stderr: string
  code: number | null
  error?: string
}

export type SimulationGuiLoadResult = {
  ok: boolean
  workspaceDir: string
  nativeVtu: string
  workMph: string
  paraviewUrl: string
  comsolUrl: string
  paraview: ProcessResult
  comsolDesktop: ProcessResult
  comsol: { ok: boolean; command: string[]; pid?: number; skipped?: boolean; reason?: string; error?: string }
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))

async function readable(filePath: string) {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

async function requireReadable(filePath: string, label: string) {
  if (await readable(filePath)) return
  const error = new Error(`${label} file not found or not readable: ${filePath}`)
  ;(error as Error & { statusCode?: number }).statusCode = 404
  throw error
}

async function paraviewScriptPath() {
  const srcPath = path.resolve(MODULE_DIR, "..", "..", "src", "system", "open_native_vtu_in_paraview.py")
  const distPath = path.join(MODULE_DIR, "open_native_vtu_in_paraview.py")
  return await readable(distPath) ? distPath : srcPath
}

function firstHostIp() {
  for (const values of Object.values(os.networkInterfaces())) {
    const found = values?.find(item => item.family === "IPv4" && !item.internal)
    if (found) return found.address
  }
  return "127.0.0.1"
}

function noVncUrl(port: number) {
  return `http://${firstHostIp()}:${port}/vnc.html?autoconnect=true&resize=scale&path=websockify`
}

function run(command: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<ProcessResult> {
  return new Promise(resolve => {
    const child = spawn(command[0], command.slice(1), { env: options.env, stdio: ["ignore", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timeout = options.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs) : null

    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)))
    child.on("error", error => {
      if (timeout) clearTimeout(timeout)
      resolve({ ok: false, command, stdout: Buffer.concat(stdout).toString("utf-8"), stderr: Buffer.concat(stderr).toString("utf-8"), code: null, error: error.message })
    })
    child.on("close", code => {
      if (timeout) clearTimeout(timeout)
      resolve({ ok: code === 0, command, stdout: Buffer.concat(stdout).toString("utf-8"), stderr: Buffer.concat(stderr).toString("utf-8"), code })
    })
  })
}

async function comsolAlreadyOpened(workMph: string) {
  const result = await run(["pgrep", "-u", os.userInfo().username, "-af", "comsol|comsollauncher"])
  return result.stdout.split(/\r?\n/u).some(line => line.includes(" -open ") && line.includes(workMph))
}

async function resolveComsolBin() {
  if (await readable("/usr/local/bin/comsol")) return "/usr/local/bin/comsol"
  const result = await run(["bash", "-lc", "command -v comsol"])
  return result.ok ? result.stdout.trim() : ""
}

async function openComsol(workMph: string, config: AppConfig): Promise<SimulationGuiLoadResult["comsol"]> {
  if (await comsolAlreadyOpened(workMph)) return { ok: true, command: [], skipped: true, reason: "already_open" }

  const comsolBin = await resolveComsolBin()
  const command = [comsolBin || "comsol", "-open", workMph]
  if (!comsolBin) return { ok: false, command, reason: "missing_comsol_executable" }

  try {
    const child = spawn(command[0], command.slice(1), {
      detached: true,
      env: { ...process.env, DISPLAY: config.tools.comsol.displayNum, LIBGL_ALWAYS_SOFTWARE: "1", MESA_GL_VERSION_OVERRIDE: "3.3" },
      stdio: "ignore",
    })
    child.unref()
    return { ok: true, command, pid: child.pid }
  } catch (error) {
    return { ok: false, command, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function loadSimulationGuiData(workspaceDir: string, config: AppConfig): Promise<SimulationGuiLoadResult> {
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  const nativeVtu = path.join(resolvedWorkspaceDir, "02_sim", "simulation", "native.vtu")
  const workMph = path.join(resolvedWorkspaceDir, "02_sim", "simulation", "work.mph")
  const scriptPath = await paraviewScriptPath()

  await requireReadable(nativeVtu, "VTU")
  await requireReadable(workMph, "MPH")
  await requireReadable(scriptPath, "ParaView loader script")

  const paraview = await run(
    [config.tools.paraview.launcher, `--script=${scriptPath}`, "--geometry=1600x1000+20+20"],
    { env: { ...process.env, PARAVIEW_VTU_PATH: nativeVtu }, timeoutMs: 60_000 },
  )
  const comsolDesktop = await run([config.tools.comsol.launcher], { timeoutMs: 60_000 })
  const comsol = comsolDesktop.ok
    ? await openComsol(workMph, config)
    : { ok: false, command: ["comsol", "-open", workMph], reason: "desktop_launcher_failed" }

  return {
    ok: paraview.ok && comsolDesktop.ok && comsol.ok,
    workspaceDir: resolvedWorkspaceDir,
    nativeVtu,
    workMph,
    paraviewUrl: noVncUrl(config.tools.paraview.noVncPort),
    comsolUrl: noVncUrl(config.tools.comsol.noVncPort),
    paraview,
    comsolDesktop,
    comsol,
  }
}
