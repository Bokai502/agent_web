import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import type { AppConfig } from "../config.js"
import {
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
} from "./workspaceQuery.js"
import { resolveWorkspaceTemplateRoot } from "./workspacePaths.js"

type WorkspaceQuery = {
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

type DeratingInputConfigBody = {
  config?: unknown
}

const INPUTS_DIRNAME = "00_inputs"
const INPUT_CONFIG_FILENAME = "input_config.json"

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function getFileType(filename: string) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === ".xlsx" || ext === ".xls") return "excel"
  if (ext === ".csv") return "csv"
  if (ext === ".md" || ext === ".markdown") return "markdown"
  if (ext === ".json") return "json"
  if (ext === ".pdf") return "pdf"
  return ext.replace(/^\./u, "") || "file"
}

async function listInputFileOptions(inputsDir: string) {
  const dirents = await fs.readdir(inputsDir, { withFileTypes: true }).catch(() => [])
  return dirents
    .filter(dirent => dirent.isFile() && dirent.name !== INPUT_CONFIG_FILENAME)
    .map(dirent => ({
      label: dirent.name,
      value: dirent.name,
      relative_path: dirent.name,
      type: getFileType(dirent.name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
}

async function readConfig(configPath: string) {
  const raw = await fs.readFile(configPath, "utf-8")
  if (!raw.trim()) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!isJsonRecord(parsed)) throw new Error("input_config.json root must be an object")
  return parsed
}

async function readConfigWithFallback(configPath: string, fallbackConfigPath: string) {
  try {
    return {
      config: await readConfig(configPath),
      configSource: configPath,
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "ENOENT") throw err
    return {
      config: await readConfig(fallbackConfigPath),
      configSource: fallbackConfigPath,
    }
  }
}

function normalizeInputFileSelections(config: Record<string, unknown>, fileOptions: Awaited<ReturnType<typeof listInputFileOptions>>) {
  const inputFiles = isJsonRecord(config.input_files) ? config.input_files : null
  if (!inputFiles) return config

  const optionByName = new Map(fileOptions.map(option => [option.value, option]))
  const normalizedEntries = Object.entries(inputFiles).map(([key, rawValue]) => {
    if (!isJsonRecord(rawValue)) return [key, rawValue] as const
    const relativePath = typeof rawValue.relative_path === "string" ? path.basename(rawValue.relative_path) : ""
    const option = optionByName.get(relativePath)
    if (!option) return [key, { ...rawValue, relative_path: relativePath }] as const
    return [
      key,
      {
        ...rawValue,
        relative_path: option.relative_path,
        type: typeof rawValue.type === "string" && rawValue.type.trim() ? rawValue.type : option.type,
      },
    ] as const
  })

  return {
    ...config,
    input_files: Object.fromEntries(normalizedEntries),
  }
}

export async function registerDeratingConfigRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  const fallbackConfigPath = path.join(resolveWorkspaceTemplateRoot(config), "derating", INPUTS_DIRNAME, INPUT_CONFIG_FILENAME)

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/derating/input-config", async (req, reply) => {
    try {
      const context = await resolveQueryWorkspaceContext(req.query)
      const inputsDir = path.join(context.workspaceDir, INPUTS_DIRNAME)
      const configPath = path.join(inputsDir, INPUT_CONFIG_FILENAME)
      const [configPayload, inputFileOptions] = await Promise.all([
        readConfigWithFallback(configPath, fallbackConfigPath),
        listInputFileOptions(inputsDir),
      ])
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        config: configPayload.config,
        config_path: configPath,
        config_source_path: configPayload.configSource,
        input_file_options: inputFileOptions,
        workspace_dir: context.workspaceDir,
      })
    } catch (err) {
      if (err instanceof SyntaxError) return reply.status(400).send({ error: "input_config.json is not valid JSON" })
      if (err instanceof Error && err.message.includes("input_config.json")) return reply.status(400).send({ error: err.message })
      return replyWithWorkspaceQueryError(reply, err, "failed to read derating input config")
    }
  })

  fastify.put<{ Body: DeratingInputConfigBody; Querystring: WorkspaceQuery }>("/api/workspace/derating/input-config", async (req, reply) => {
    try {
      const context = await resolveQueryWorkspaceContext(req.query)
      if (!isJsonRecord(req.body?.config)) {
        return reply.status(400).send({ error: "config must be a JSON object" })
      }
      const inputsDir = path.join(context.workspaceDir, INPUTS_DIRNAME)
      await fs.mkdir(inputsDir, { recursive: true })
      const inputFileOptions = await listInputFileOptions(inputsDir)
      const config = normalizeInputFileSelections(req.body.config, inputFileOptions)
      const configPath = path.join(inputsDir, INPUT_CONFIG_FILENAME)
      await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
      reply.header("Cache-Control", "no-cache")
      return reply.send({
        config,
        config_path: configPath,
        input_file_options: inputFileOptions,
        ok: true,
        workspace_dir: context.workspaceDir,
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to save derating input config")
    }
  })
}
