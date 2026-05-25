import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { replyWithWorkspaceQueryError, resolveQueryWorkspaceContext } from "./workspaceQuery.js"

type StageLogEntry = {
  detail?: string
  fields?: Record<string, string>
  id: string
  raw?: unknown
  source: string
  status: string
  stage_name: string
  time: string
}

const MAX_FILES = 100
const MAX_ENTRIES = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function getTime(value: Record<string, unknown>, fallbackTime: string) {
  return asString(value.time) ??
    asString(value.timestamp) ??
    asString(value.started_at) ??
    asString(value.finished_at) ??
    asString(value.created_at) ??
    asString(value.updated_at) ??
    asString(value.datetime) ??
    fallbackTime
}

function formatFieldValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return value.join(", ")
    }
    return `array(${value.length})`
  }
  if (isRecord(value)) {
    return `object(${Object.keys(value).length})`
  }
  return null
}

function pickDetail(value: Record<string, unknown>) {
  const result = isRecord(value.result) ? value.result : value
  return asString(value.message) ??
    asString(value.detail) ??
    asString(value.error) ??
    asString(result.error) ??
    asString(result.summary) ??
    asString(result.message) ??
    null
}

function collectFields(value: Record<string, unknown>) {
  const result = isRecord(value.result) ? value.result : null
  const candidates: Array<[string, unknown]> = [
    ["ok", result?.ok ?? value.ok],
    ["sample_id", result?.sample_id ?? value.sample_id],
    ["seed", result?.seed ?? value.seed],
    ["run_dir", result?.run_dir ?? value.run_dir],
    ["layout_dir", result?.layout_dir ?? value.layout_dir],
    ["bom", result?.bom ?? value.bom],
    ["n_parts", isRecord(result?.stats) ? result.stats.n_parts : value.n_parts],
    ["n_placed", isRecord(result?.stats) ? result.stats.n_placed : value.n_placed],
    ["n_unplaced", isRecord(result?.stats) ? result.stats.n_unplaced : value.n_unplaced],
    ["placement_rate", isRecord(result?.stats) ? result.stats.placement_rate : value.placement_rate],
    ["total_mass", isRecord(result?.stats) ? result.stats.total_mass : value.total_mass],
    ["total_power", isRecord(result?.stats) ? result.stats.total_power : value.total_power],
    ["outer_size_mm", result?.outer_size_mm ?? (isRecord(result?.stats) ? result.stats.outer_size : value.outer_size_mm)],
  ]

  const fields: Record<string, string> = {}
  for (const [key, rawValue] of candidates) {
    const formatted = formatFieldValue(rawValue)
    if (formatted !== null && formatted !== "") fields[key] = formatted
  }
  return fields
}

function addStageEntry(value: Record<string, unknown>, source: string, fallbackTime: string, entries: StageLogEntry[]) {
  if (entries.length >= MAX_ENTRIES) return
  const stageName = asString(value.stage_name)
  const status = asString(value.status)
  if (stageName && status) {
    entries.push({
      detail: pickDetail(value) ?? undefined,
      fields: collectFields(value),
      id: `${source}:${entries.length}`,
      raw: value,
      source,
      status,
      stage_name: stageName,
      time: getTime(value, fallbackTime),
    })
  }
}

function collectStageEntries(value: unknown, source: string, fallbackTime: string, entries: StageLogEntry[]) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) addStageEntry(item, source, fallbackTime, entries)
    }
    return
  }

  if (isRecord(value)) addStageEntry(value, source, fallbackTime, entries)
}

async function listTopLevelJsonFiles(dir: string): Promise<string[]> {
  let dirents: Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const files: string[] = []
  for (const dirent of dirents) {
    if (files.length >= MAX_FILES) break
    const fullPath = path.join(dir, dirent.name)
    if (dirent.isFile() && dirent.name.endsWith("_stage_result.json")) {
      files.push(fullPath)
    }
  }

  return files.slice(0, MAX_FILES)
}

function sortEntries(entries: StageLogEntry[]) {
  return [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.time)
    const rightTime = Date.parse(right.time)
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) return rightTime - leftTime
    return right.id.localeCompare(left.id)
  })
}

export async function stageLogsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { versionId?: string; workspaceDir?: string; workspaceId?: string } }>("/api/logs/stages", async (req, reply) => {
    let configuredWorkspaceDir: string
    try {
      configuredWorkspaceDir = (await resolveQueryWorkspaceContext(req.query)).workspaceDir
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve stage log workspace")
    }

    const logDir = configuredWorkspaceDir ? path.join(configuredWorkspaceDir, "logs") : null
    const jsonFiles = logDir ? await listTopLevelJsonFiles(logDir) : []
    const entries: StageLogEntry[] = []

    for (const filePath of jsonFiles) {
      try {
        const raw = await fs.readFile(filePath, "utf-8")
        const parsed = JSON.parse(raw)
        const stat = await fs.stat(filePath)
        collectStageEntries(parsed, path.relative(process.cwd(), filePath), stat.mtime.toISOString(), entries)
      } catch {
        // Skip malformed or transient log files.
      }
    }

    return reply.send(sortEntries(entries).slice(0, MAX_ENTRIES))
  })
}
