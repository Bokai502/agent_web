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

type ConversationLogEntry = {
  detail: string
  id: string
  raw: unknown
  source: string
  status: string
  time: string
  title: string
}

type LatestConversationText = {
  id: string
  source: string
  text: string
  time: string
}

const MAX_FILES = 100
const MAX_ENTRIES = 300
const DEFAULT_CONVERSATION_SESSION_LIMIT = 4
const DEFAULT_CONVERSATION_TURN_LIMIT = 40
const DEFAULT_CONVERSATION_EVENT_LIMIT = 120
const MARKDOWN_REPORTS = [
  {
    detail: "reports/report.md",
    idSuffix: "report",
    relativePath: path.join("reports", "report.md"),
    title: "总结报告",
  },
  {
    detail: "reports/modifications.md",
    idSuffix: "modifications",
    relativePath: path.join("reports", "modifications.md"),
    title: "修改建议",
  },
  {
    detail: "reports/cad_sim_report/report.md",
    idSuffix: "cad-sim-report",
    relativePath: path.join("reports", "cad_sim_report", "report.md"),
    title: "CAD/仿真报告",
  },
  {
    detail: "reports/cad_sim_report/modifications.md",
    idSuffix: "cad-sim-modifications",
    relativePath: path.join("reports", "cad_sim_report", "modifications.md"),
    title: "CAD/仿真修改建议",
  },
]
const MARKDOWN_LINK_OR_IMAGE_RE = /(!?\[[^\]]*\]\()([^)\s]+)(\))/gu

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parsePositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
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

function findLatestConversationText(sessions: unknown[], source: string, fallbackTime: string): LatestConversationText | null {
  for (let sessionIndex = sessions.length - 1; sessionIndex >= 0; sessionIndex -= 1) {
    const session = sessions[sessionIndex]
    if (!isRecord(session) || !Array.isArray(session.turns)) continue

    for (let turnIndex = session.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const turn = session.turns[turnIndex]
      if (!isRecord(turn) || !Array.isArray(turn.events)) continue

      for (let eventIndex = turn.events.length - 1; eventIndex >= 0; eventIndex -= 1) {
        const event = turn.events[eventIndex]
        if (!isRecord(event) || !isRecord(event.item)) continue
        const text = asString(event.item.text)
        if (!text) continue
        const itemId = asString(event.item.id) ?? `event-${eventIndex}`
        const turnId = asString(turn.id) ?? `turn-${turnIndex}`
        const sessionId = asString(session.id) ?? `session-${sessionIndex}`
        return {
          id: `${sessionId}:${turnId}:${itemId}`,
          source,
          text,
          time: getTime(event, fallbackTime),
        }
      }
    }
  }

  return null
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

function countConversationTurns(sessions: unknown[]) {
  return sessions.reduce<number>((count, session) => {
    const value = isRecord(session) ? session : {}
    return count + (Array.isArray(value.turns) ? value.turns.length : 0)
  }, 0)
}

function trimConversationSessions(
  sessions: unknown[],
  {
    eventLimit,
    sessionLimit,
    turnLimit,
  }: {
    eventLimit: number
    sessionLimit: number
    turnLimit: number
  },
) {
  return sessions
    .filter(isRecord)
    .slice(-sessionLimit)
    .map(session => {
      const turns = Array.isArray(session.turns)
        ? session.turns
            .filter(isRecord)
            .slice(-turnLimit)
            .map(turn => ({
              ...turn,
              events: Array.isArray(turn.events) ? turn.events.slice(-eventLimit) : [],
            }))
        : []
      return {
        ...session,
        turns,
      }
    })
}

function rewriteReportMarkdownLinks(markdown: string, reportPath: string) {
  const reportDir = path.dirname(reportPath)
  return markdown.replace(MARKDOWN_LINK_OR_IMAGE_RE, (_match, prefix: string, link: string, suffix: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/iu.test(link)) return `${prefix}${link}${suffix}`
    const absolutePath = path.resolve(reportDir, link)
    const ext = path.extname(absolutePath).toLowerCase()
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return `${prefix}${link}${suffix}`
    return `${prefix}/api/image?path=${encodeURIComponent(absolutePath)}${suffix}`
  })
}

async function addMarkdownReportEntry(
  workspaceDir: string,
  report: typeof MARKDOWN_REPORTS[number],
  entries: StageLogEntry[],
) {
  const reportPath = path.join(workspaceDir, report.relativePath)
  const raw = await fs.readFile(reportPath, "utf-8").catch(() => null)
  if (raw === null) return

  const stat = await fs.stat(reportPath)
  entries.push({
    detail: report.detail,
    fields: {
      path: path.relative(process.cwd(), reportPath),
      size_bytes: String(stat.size),
    },
    id: `${path.relative(process.cwd(), reportPath)}:${report.idSuffix}`,
    raw: {
      format: "markdown",
      content: rewriteReportMarkdownLinks(raw, reportPath),
    },
    source: path.relative(process.cwd(), reportPath),
    status: "completed",
    stage_name: report.title,
    time: stat.mtime.toISOString(),
  })
}

async function addMarkdownReportEntries(workspaceDir: string, entries: StageLogEntry[]) {
  for (const report of MARKDOWN_REPORTS) {
    await addMarkdownReportEntry(workspaceDir, report, entries)
  }
}

export async function stageLogsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { limit?: string; versionId?: string; workspaceDir?: string; workspaceId?: string } }>("/api/logs/stages", async (req, reply) => {
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
    await addMarkdownReportEntries(configuredWorkspaceDir, entries)

    const limit = parsePositiveInt(req.query.limit, MAX_ENTRIES, MAX_ENTRIES)
    return reply.send(sortEntries(entries).slice(0, limit))
  })

  fastify.get<{
    Querystring: {
      eventLimit?: string
      sessionLimit?: string
      turnLimit?: string
      versionId?: string
      workspaceDir?: string
      workspaceId?: string
    }
  }>("/api/logs/conversation", async (req, reply) => {
    let configuredWorkspaceDir: string
    try {
      configuredWorkspaceDir = (await resolveQueryWorkspaceContext(req.query)).workspaceDir
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve conversation history workspace")
    }

    const historyPath = path.join(configuredWorkspaceDir, "logs", "conversation-history.json")
    const raw = await fs.readFile(historyPath, "utf-8").catch(() => null)
    if (raw === null) return reply.send([])

    try {
      const parsed = JSON.parse(raw)
      const sessions = Array.isArray(parsed) ? parsed : []
      const stat = await fs.stat(historyPath)
      const turnCount = countConversationTurns(sessions)
      const trimmedSessions = trimConversationSessions(sessions, {
        eventLimit: parsePositiveInt(req.query.eventLimit, DEFAULT_CONVERSATION_EVENT_LIMIT, 500),
        sessionLimit: parsePositiveInt(req.query.sessionLimit, DEFAULT_CONVERSATION_SESSION_LIMIT, 25),
        turnLimit: parsePositiveInt(req.query.turnLimit, DEFAULT_CONVERSATION_TURN_LIMIT, 200),
      })
      const entries: ConversationLogEntry[] = [{
        detail: `${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${turnCount} turn${turnCount === 1 ? "" : "s"}`,
        id: "conversation:history",
        raw: {
          sessions: trimmedSessions,
        },
        source: path.relative(process.cwd(), historyPath),
        status: "completed",
        time: stat.mtime.toISOString(),
        title: "历史对话",
      }]
      return reply.send(entries)
    } catch {
      return reply.send([])
    }
  })

  fastify.get<{ Querystring: { versionId?: string; workspaceDir?: string; workspaceId?: string } }>("/api/logs/conversation/latest", async (req, reply) => {
    let configuredWorkspaceDir: string
    try {
      configuredWorkspaceDir = (await resolveQueryWorkspaceContext(req.query)).workspaceDir
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve conversation history workspace")
    }

    const historyPath = path.join(configuredWorkspaceDir, "logs", "conversation-history.json")
    const raw = await fs.readFile(historyPath, "utf-8").catch(() => null)
    if (raw === null) return reply.send({ text: null })

    try {
      const parsed = JSON.parse(raw)
      const sessions = Array.isArray(parsed) ? parsed : []
      const stat = await fs.stat(historyPath)
      const latest = findLatestConversationText(
        sessions,
        path.relative(process.cwd(), historyPath),
        stat.mtime.toISOString(),
      )
      return reply.send(latest ?? { text: null })
    } catch {
      return reply.send({ text: null })
    }
  })
}
