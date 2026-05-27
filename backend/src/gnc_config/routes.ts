import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import type { FastifyInstance, FastifyReply } from "fastify"
import { getErrorMessage } from "../shared/index.js"
import {
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceDir,
} from "../workspaces/index.js"

const execFileAsync = promisify(execFile)
const BACKEND_SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(BACKEND_SRC_DIR, "..", "..", "..", "..")
const CONFIG_SCRIPT_DIR = path.join(PROJECT_ROOT, "AIGNC_layered_workspace", "config_scripts")
const PARSER_SCRIPT = path.join(CONFIG_SCRIPT_DIR, "parse_sim_orb_sc.py")
const WRITER_SCRIPT = path.join(CONFIG_SCRIPT_DIR, "write_sim_orb_sc.py")
const VALIDATOR_SCRIPT = path.join(CONFIG_SCRIPT_DIR, "validate_written_sim_orb_sc.py")
const GNC_INPUTS_DIRNAME = "00_inputs"

type WorkspaceQuery = {
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

type SaveBody = WorkspaceQuery & {
  payload?: unknown
}

function getInputsDir(workspaceDir: string) {
  return path.join(workspaceDir, GNC_INPUTS_DIRNAME)
}

function getExecErrorMessage(err: unknown, fallbackMessage: string) {
  if (err && typeof err === "object") {
    const detail = [
      "stderr" in err && typeof err.stderr === "string" ? err.stderr.trim() : "",
      "stdout" in err && typeof err.stdout === "string" ? err.stdout.trim() : "",
      err instanceof Error ? err.message : "",
    ].filter(Boolean).join("\n")
    if (detail) return detail
  }
  return getErrorMessage(err, fallbackMessage)
}

async function parseConfig(inputsDir: string) {
  const tempPath = path.join(inputsDir, `.sim_orb_sc_parsed.${process.pid}.${Date.now()}.json`)
  try {
    try {
      await execFileAsync("python3", [PARSER_SCRIPT, "--inout", inputsDir, "--output", tempPath], {
        maxBuffer: 20 * 1024 * 1024,
      })
    } catch (err) {
      throw new Error(getExecErrorMessage(err, "failed to parse GNC config files"))
    }
    const raw = await fs.readFile(tempPath, "utf-8")
    return JSON.parse(raw) as unknown
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {})
  }
}

async function writeConfig(inputsDir: string, payload: unknown) {
  const payloadPath = path.join(inputsDir, `.edited_payload.${process.pid}.${Date.now()}.json`)
  await fs.writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
  try {
    let stdout = ""
    try {
      const result = await execFileAsync("python3", [WRITER_SCRIPT, "--payload", payloadPath, "--output-dir", inputsDir], {
        maxBuffer: 20 * 1024 * 1024,
      })
      stdout = result.stdout
    } catch (err) {
      throw new Error(getExecErrorMessage(err, "failed to write GNC config files"))
    }
    try {
      await execFileAsync("python3", [
        VALIDATOR_SCRIPT,
        "--config-dir",
        inputsDir,
        "--expected-payload",
        payloadPath,
        "--report",
        path.join(inputsDir, "gnc_config_validation_report.json"),
      ], {
        maxBuffer: 20 * 1024 * 1024,
      })
    } catch (err) {
      throw new Error(getExecErrorMessage(err, "failed to validate written GNC config files"))
    }
    return JSON.parse(stdout) as unknown
  } finally {
    await fs.rm(payloadPath, { force: true }).catch(() => {})
  }
}

async function loadGncConfig(req: { query: WorkspaceQuery }, reply: FastifyReply) {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const inputsDir = getInputsDir(workspaceDir)
      const payload = await parseConfig(inputsDir)
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        payload,
        source_dir: inputsDir,
        workspace_dir: workspaceDir,
      })
    } catch (err) {
      if (err instanceof Error) {
        return reply.status(500).send({ error: err.message })
      }
      return replyWithWorkspaceQueryError(reply, err, "failed to load GNC config")
    }
}

async function saveGncConfig(req: { body?: SaveBody }, reply: FastifyReply) {
    try {
      if (!req.body || typeof req.body !== "object" || !("payload" in req.body)) {
        return reply.status(400).send({ error: "payload is required" })
      }
      const workspaceDir = await resolveQueryWorkspaceDir(req.body)
      const inputsDir = getInputsDir(workspaceDir)
      const manifest = await writeConfig(inputsDir, req.body.payload)
      const payload = await parseConfig(inputsDir)
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        manifest,
        payload,
        source_dir: inputsDir,
        workspace_dir: workspaceDir,
      })
    } catch (err) {
      return reply.status(500).send({ error: getErrorMessage(err, "failed to save GNC config") })
    }
}

export async function gncConfigRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: WorkspaceQuery }>("/api/gnc-config", loadGncConfig)
  fastify.get<{ Querystring: WorkspaceQuery }>("/api/gnc/gnc-config", loadGncConfig)
  fastify.put<{ Body: SaveBody }>("/api/gnc-config", saveGncConfig)
  fastify.put<{ Body: SaveBody }>("/api/gnc/gnc-config", saveGncConfig)
}
