import fs from "node:fs/promises"
import path from "node:path"
import { Codex } from "@openai/codex-sdk"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { getWorkspaceManifestSnapshotByLocator } from "../manifests/store.js"
import { resolveModelBackend, type ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserId } from "../server/requestContext.js"
import { findWorkspaceSession, upsertWorkspaceSessionHistory } from "../sessions/sessionStore.js"
import { readManagedPrompt, type SkillScope } from "../system/skills.js"
import { resolveProgressFromLatestSessionRun } from "../workspaces/workspaceRegistry.js"
import { executeCodexTurn, prepareCodexTurn, type RunCodexTurnResult } from "./codexTurn.js"
import { buildCodexConfig, getCodexBaseUrl } from "./codexConfig.js"
import { routeManagedRunIntent } from "./intentRouter.js"
import type { RunRequestBody } from "./runTypes.js"

export type ManagedRouting = {
  selectedSkills?: string[]
  skillScopes: string[]
}

export type ManagedRunResponse = {
  artifacts: Array<{ exists: boolean; kind: string; path: string }>
  error?: string
  eventCounts: Record<string, number>
  issues: string[]
  managedRunId: string
  manifestRun: unknown
  progress: unknown
  routing: ManagedRouting
  sessionId: string
  sessionTurn: unknown
  spokenSummary: string
  status: "completed" | "failed" | "cancelled" | "partial"
  summary: string
  threadId: string | null
  turnId: string
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
}

export type ManagedStartResponse = {
  managedRunId: string
  routing: ManagedRouting
  sessionId: string
  spokenSummary: string
  status: "started"
  summary: string
  threadId: string | null
  turnId: string
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
}

export type ManagedRunStatusResponse = {
  error?: string
  managedRunId: string
  routing: ManagedRouting
  sessionId: string
  spokenSummary: string
  status: "running" | ManagedRunResponse["status"]
  summary: string
  threadId: string | null
  turnId: string
  userId?: string | null
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
}

export type ManagedDispatchResponse = ManagedRunResponse | ManagedStartResponse

export type ManagedRunEvent =
  | { type: "accepted"; managedRunId: string; inputType: "text" | "voice"; requestId?: string }
  | { type: "routing"; managedRunId: string; routing: ManagedRouting }
  | { type: "started"; managedRunId: string; status: ManagedRunStatusResponse }
  | { type: "status"; managedRunId: string; status: ManagedRunStatusResponse }
  | { type: "final"; managedRunId: string; status: ManagedRunStatusResponse }
  | { type: "failed"; managedRunId: string; status: ManagedRunStatusResponse }

export type AgentTurnInput = {
  body: RunRequestBody
  inputType?: "text" | "voice"
}

const managedRunStatuses = new Map<string, ManagedRunStatusResponse>()
const managedRunStatusExpiries = new Map<string, number>()
const managedRunEventBacklog = new Map<string, ManagedRunEvent[]>()
const managedRunEventSubscribers = new Map<string, Set<(event: ManagedRunEvent) => void>>()
const managedRunAbortControllers = new Map<string, AbortController>()
const managedSessionStates = new Map<string, ManagedSessionState>()
const managedSessionStateExpiries = new Map<string, number>()
const MANAGED_RUN_STATUS_TTL_MS = 1000 * 60 * 60
const MANAGED_SESSION_STATE_TTL_MS = 1000 * 60 * 60 * 12
const MANAGED_RUN_STATUS_DIR = path.resolve(process.cwd(), "logs", "managed-runs")
const MANAGED_RUN_ID_PATTERN = /^managed_[a-z0-9]+_[a-z0-9]+$/iu
const MANAGED_SUMMARY_TIMEOUT_MS = 10_000
const MANAGED_GENERAL_ANSWER_TIMEOUT_MS = Number(process.env.CODEX_MANAGED_GENERAL_ANSWER_TIMEOUT_MS ?? 18_000)
const MANAGED_PROGRESS_ANSWER_TIMEOUT_MS = Number(process.env.CODEX_MANAGED_PROGRESS_ANSWER_TIMEOUT_MS ?? 18_000)
const MANAGED_CHAT_OUTPUT_TOKENS = Number(process.env.CODEX_MANAGED_CHAT_OUTPUT_TOKENS ?? 512)
const MANAGED_START_SUMMARY = "当前任务已接收，正在分析。"
const RESPONSES_API_TEXT_MAX_CHARS = 20_000

function buildManagedAnswerCodexEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
}

type ManagedSessionState = {
  sessionId: string
  threadId: string | null
  updatedAt: number
  userId?: string | null
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
}

type ManagedResponsePurpose = "managed-general-answer" | "managed-progress-answer"

function makeManagedId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function makeManagedRunId() {
  return makeManagedId("managed")
}

function makeManagedSessionId() {
  return makeManagedId("managed_session")
}

function makeManagedTurnId() {
  return makeManagedId("managed_turn")
}

function getOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function getOptionalWorkspaceDir(value: unknown) {
  const workspaceDir = getOptionalString(value)
  return workspaceDir ? path.resolve(workspaceDir) : null
}

function buildManagedSessionKey(body: RunRequestBody) {
  const userId = getRequestUserId() ?? "anonymous"
  const workspaceDir = getOptionalWorkspaceDir(body.workspaceDir)
  const workspaceId = getOptionalString(body.workspaceId)
  const versionId = getOptionalString(body.versionId)
  const workspaceName = getOptionalString(body.workspaceName)
  if (workspaceDir) return `user:${userId}:dir:${path.resolve(workspaceDir)}`
  if (workspaceId && versionId) return `user:${userId}:workspace:${workspaceId}:version:${versionId}`
  if (versionId) return `user:${userId}:version:${versionId}`
  if (workspaceId) return `user:${userId}:workspace:${workspaceId}`
  if (workspaceName) return `user:${userId}:name:${workspaceName}`
  return `user:${userId}:default`
}

function rememberManagedSessionState(sessionKey: string, state: Omit<ManagedSessionState, "updatedAt">) {
  const existing = managedSessionStates.get(sessionKey)
  const next: ManagedSessionState = {
    sessionId: state.sessionId,
    threadId: state.threadId ?? existing?.threadId ?? null,
    updatedAt: Date.now(),
    userId: getRequestUserId(),
    versionId: state.versionId ?? existing?.versionId ?? null,
    workspaceDir: state.workspaceDir ?? existing?.workspaceDir ?? null,
    workspaceId: state.workspaceId ?? existing?.workspaceId ?? null,
  }
  managedSessionStates.set(sessionKey, next)
  const expiresAt = Date.now() + MANAGED_SESSION_STATE_TTL_MS
  managedSessionStateExpiries.set(sessionKey, expiresAt)
  setTimeout(() => {
    if (managedSessionStateExpiries.get(sessionKey) !== expiresAt) return
    managedSessionStateExpiries.delete(sessionKey)
    managedSessionStates.delete(sessionKey)
  }, MANAGED_SESSION_STATE_TTL_MS).unref()
}

export async function getLatestManagedStatusForWorkspace(body: RunRequestBody) {
  const workspaceDir = getOptionalWorkspaceDir(body.workspaceDir)
  const workspaceId = getOptionalString(body.workspaceId)
  const versionId = getOptionalString(body.versionId)
  if (!workspaceDir && !workspaceId && !versionId) return null
  const matches = (await listRecentManagedRunStatuses()).filter(status => {
    if (workspaceDir) return getOptionalWorkspaceDir(status.workspaceDir) === workspaceDir
    if (workspaceId && versionId) return status.workspaceId === workspaceId && status.versionId === versionId
    if (workspaceId) return status.workspaceId === workspaceId
    return versionId ? status.versionId === versionId : false
  })
  return matches.sort((a, b) => b.managedRunId.localeCompare(a.managedRunId))[0] ?? null
}

async function normalizeManagedRunBody(body: RunRequestBody) {
  const sessionKey = buildManagedSessionKey(body)
  const existingState = managedSessionStates.get(sessionKey)
  const recoveredStatus = existingState || getOptionalString(body.sessionId)
    ? null
    : await getLatestManagedStatusForWorkspace(body)
  const sessionId = getOptionalString(body.sessionId)
    ?? existingState?.sessionId
    ?? recoveredStatus?.sessionId
    ?? makeManagedSessionId()
  const threadId = getOptionalString(body.threadId)
    ?? existingState?.threadId
    ?? recoveredStatus?.threadId
    ?? null
  const turnId = getOptionalString(body.turnId) ?? makeManagedTurnId()
  const normalizedBody = {
    ...body,
    sessionId,
    threadId,
    turnId,
  }
  rememberManagedSessionState(sessionKey, {
    sessionId,
    threadId,
    versionId: getOptionalString(body.versionId),
    workspaceDir: getOptionalWorkspaceDir(body.workspaceDir),
    workspaceId: getOptionalString(body.workspaceId),
  })
  return { body: normalizedBody, sessionKey }
}

function getManagedRunStatusPath(managedRunId: string) {
  if (!MANAGED_RUN_ID_PATTERN.test(managedRunId)) return null
  return path.join(MANAGED_RUN_STATUS_DIR, `${managedRunId}.json`)
}

function formatManagedAnswerError(err: unknown) {
  if (err instanceof Error && /operation timed out after \d+ms/u.test(err.message)) {
    return "回答生成超时，请稍后重试。"
  }
  if (err instanceof Error && err.message.trim()) {
    return `回答生成失败：${err.message.trim()}`
  }
  return "回答生成失败，请稍后重试。"
}

async function persistManagedRunStatus(status: ManagedRunStatusResponse) {
  const statusPath = getManagedRunStatusPath(status.managedRunId)
  if (!statusPath) return
  await fs.mkdir(path.dirname(statusPath), { recursive: true })
  const tempPath = `${statusPath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, `${JSON.stringify({ ...status, updatedAt: Date.now() }, null, 2)}\n`, "utf-8")
  await fs.rename(tempPath, statusPath)
}

function normalizePersistedManagedStatus(value: unknown): ManagedRunStatusResponse | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const status = record.status
  const validStatus = status === "running" || status === "completed" || status === "failed" || status === "cancelled" || status === "partial"
  if (!validStatus) return null
  if (typeof record.managedRunId !== "string" || !MANAGED_RUN_ID_PATTERN.test(record.managedRunId)) return null
  if (typeof record.sessionId !== "string" || record.sessionId.trim() === "") return null
  if (typeof record.turnId !== "string" || record.turnId.trim() === "") return null

  const routingRecord = record.routing && typeof record.routing === "object" ? record.routing as { selectedSkills?: unknown; skillScopes?: unknown } : null
  const skillScopes = Array.isArray(routingRecord?.skillScopes)
    ? routingRecord.skillScopes.filter((item): item is string => typeof item === "string")
    : ["public"]
  const selectedSkills = Array.isArray(routingRecord?.selectedSkills)
    ? routingRecord.selectedSkills.filter((item): item is string => typeof item === "string")
    : []

  return {
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    managedRunId: record.managedRunId,
    routing: { selectedSkills, skillScopes },
    sessionId: record.sessionId.trim(),
    spokenSummary: typeof record.spokenSummary === "string" ? record.spokenSummary : "",
    status,
    summary: typeof record.summary === "string" ? record.summary : "",
    threadId: typeof record.threadId === "string" && record.threadId.trim() !== "" ? record.threadId.trim() : null,
    turnId: record.turnId.trim(),
    userId: typeof record.userId === "string" && record.userId.trim() !== "" ? record.userId.trim() : null,
    versionId: typeof record.versionId === "string" && record.versionId.trim() !== "" ? record.versionId.trim() : null,
    workspaceDir: typeof record.workspaceDir === "string" && record.workspaceDir.trim() !== "" ? record.workspaceDir.trim() : null,
    workspaceId: typeof record.workspaceId === "string" && record.workspaceId.trim() !== "" ? record.workspaceId.trim() : null,
  }
}

async function readPersistedManagedRunStatus(managedRunId: string) {
  const statusPath = getManagedRunStatusPath(managedRunId)
  if (!statusPath) return null
  try {
    const stat = await fs.stat(statusPath)
    if (Date.now() - stat.mtimeMs > MANAGED_RUN_STATUS_TTL_MS) {
      await fs.unlink(statusPath).catch(() => {})
      return null
    }
    return normalizePersistedManagedStatus(JSON.parse(await fs.readFile(statusPath, "utf-8")))
  } catch {
    return null
  }
}

async function readPersistedManagedRunStatuses() {
  const entries = await fs.readdir(MANAGED_RUN_STATUS_DIR, { withFileTypes: true }).catch(() => [])
  const statuses = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => readPersistedManagedRunStatus(entry.name.slice(0, -".json".length))))
  return statuses.filter((status): status is ManagedRunStatusResponse => status !== null)
}

async function listRecentManagedRunStatuses() {
  const currentUserId = getRequestUserId()
  const byId = new Map<string, ManagedRunStatusResponse>()
  for (const status of await readPersistedManagedRunStatuses()) byId.set(status.managedRunId, status)
  for (const status of managedRunStatuses.values()) byId.set(status.managedRunId, status)
  return [...byId.values()].filter(status => !currentUserId || !status.userId || status.userId === currentUserId)
}

function rememberManagedRunStatus(status: ManagedRunStatusResponse, logger?: Logger) {
  const nextStatus = { ...status, userId: status.userId ?? getRequestUserId() }
  managedRunStatuses.set(nextStatus.managedRunId, nextStatus)
  const expiresAt = Date.now() + MANAGED_RUN_STATUS_TTL_MS
  managedRunStatusExpiries.set(nextStatus.managedRunId, expiresAt)
  setTimeout(() => {
    if (managedRunStatusExpiries.get(nextStatus.managedRunId) !== expiresAt) return
    managedRunStatusExpiries.delete(nextStatus.managedRunId)
    managedRunStatuses.delete(nextStatus.managedRunId)
  }, MANAGED_RUN_STATUS_TTL_MS).unref()
  void persistManagedRunStatus(nextStatus).catch(err => {
    logger?.error("managed run status persist failed", { err, managedRunId: nextStatus.managedRunId })
  })
  publishManagedRunEvent({ type: "status", managedRunId: nextStatus.managedRunId, status: nextStatus })
  if (nextStatus.status !== "running") {
    publishManagedRunEvent({
      type: nextStatus.status === "failed" ? "failed" : "final",
      managedRunId: nextStatus.managedRunId,
      status: nextStatus,
    })
  }
}

function publishManagedRunEvent(event: ManagedRunEvent) {
  const backlog = managedRunEventBacklog.get(event.managedRunId) ?? []
  backlog.push(event)
  if (backlog.length > 50) backlog.splice(0, backlog.length - 50)
  managedRunEventBacklog.set(event.managedRunId, backlog)
  for (const subscriber of managedRunEventSubscribers.get(event.managedRunId) ?? []) {
    subscriber(event)
  }
}

function eventTypeOf(event: unknown) {
  return event && typeof event === "object" && typeof (event as { type?: unknown }).type === "string"
    ? (event as { type: string }).type
    : "unknown"
}

function getAgentMessageTextFromEvent(event: unknown) {
  if (!event || typeof event !== "object") return ""
  const item = (event as { item?: unknown }).item
  if (!item || typeof item !== "object") return ""
  const record = item as { text?: unknown; type?: unknown }
  const eventType = (event as { type?: unknown }).type
  if ((eventType !== "item.completed" && eventType !== "agent_message") || record.type !== "agent_message") return ""
  return typeof record.text === "string" && record.text.trim() !== "" ? record.text.trim() : ""
}

function getTurnSource(turn: unknown) {
  if (!turn || typeof turn !== "object") return "codex"
  const source = (turn as { source?: unknown }).source
  return typeof source === "string" && source.trim() !== "" ? source.trim() : "codex"
}

function getTurnResponsePurpose(turn: unknown) {
  if (!turn || typeof turn !== "object") return null
  const responsePurpose = (turn as { responsePurpose?: unknown }).responsePurpose
  return typeof responsePurpose === "string" && responsePurpose.trim() !== "" ? responsePurpose.trim() : null
}

function getLatestAgentMessage(events: unknown[]) {
  for (const event of [...events].reverse()) {
    const text = getAgentMessageTextFromEvent(event)
    if (text) return text
  }
  return ""
}

function getAgentMessages(events: unknown[]) {
  return events
    .map((event, index) => {
      const text = getAgentMessageTextFromEvent(event)
      return text ? { index, text: text.slice(0, 1200) } : null
    })
    .filter((item): item is { index: number; text: string } => item !== null)
}

function getLatestSessionAgentMessage(session: unknown) {
  if (!session || typeof session !== "object") return ""
  const turns = Array.isArray((session as { turns?: unknown }).turns) ? (session as { turns: unknown[] }).turns : []
  for (const turn of [...turns].reverse()) {
    if (!turn || typeof turn !== "object") continue
    const events = Array.isArray((turn as { events?: unknown }).events) ? (turn as { events: unknown[] }).events : []
    const text = getLatestAgentMessage(events)
    if (text) return text
  }
  return ""
}

function getSessionConversationDigest(session: unknown, maxTurns = 4) {
  if (!session || typeof session !== "object") return []
  const turns = Array.isArray((session as { turns?: unknown }).turns) ? (session as { turns: unknown[] }).turns : []
  return turns.slice(-maxTurns).map(turn => {
    if (!turn || typeof turn !== "object") return null
    const record = turn as { events?: unknown; id?: unknown; userPrompt?: unknown }
    const events = Array.isArray(record.events) ? record.events : []
    return {
      agentMessage: getLatestAgentMessage(events).slice(0, 600),
      eventCounts: countEventTypes(events),
      responsePurpose: getTurnResponsePurpose(turn),
      source: getTurnSource(turn),
      turnId: typeof record.id === "string" ? record.id : null,
      userPrompt: typeof record.userPrompt === "string" ? record.userPrompt.slice(0, 300) : "",
    }
  }).filter((item): item is { agentMessage: string; eventCounts: Record<string, number>; responsePurpose: string | null; source: string; turnId: string | null; userPrompt: string } => item !== null)
}

async function persistManagedResponseTurn({
  answer,
  logger,
  purpose,
  question,
  sessionId,
  threadId,
  turnId,
  versionId,
  workspaceDir,
  workspaceId,
  workspaceName,
}: {
  answer: string
  logger: Logger
  purpose: ManagedResponsePurpose
  question: string
  sessionId: string | null
  threadId: string | null
  turnId: string
  versionId: string | null
  workspaceDir: string | null
  workspaceId: string | null
  workspaceName: string | null
}) {
  const trimmedAnswer = answer.trim()
  if (!trimmedAnswer || !sessionId || !workspaceDir) return
  const now = Date.now()
  const event = {
    type: "item.completed",
    source: "managed-response",
    responsePurpose: purpose,
    item: {
      id: `managed_response:${turnId}`,
      type: "agent_message",
      text: trimmedAnswer,
    },
    createdAt: now,
  }
  const terminalEvent = {
    type: "turn.completed",
    source: "managed-response",
    responsePurpose: purpose,
    createdAt: now,
  }
  const existing = await findWorkspaceSession(sessionId, workspaceDir).catch(() => null) as Record<string, unknown> | null
  const existingTurns = existing && Array.isArray(existing.turns) ? existing.turns : []
  await upsertWorkspaceSessionHistory({
    ...(existing ?? {}),
    id: sessionId,
    title: typeof existing?.title === "string" && existing.title.trim() !== "" ? existing.title : question.slice(0, 60),
    threadId,
    turns: [
      ...existingTurns,
      {
        id: turnId,
        userPrompt: question,
        source: "managed-response",
        responsePurpose: purpose,
        events: [event, terminalEvent],
      },
    ],
    createdAt: typeof existing?.createdAt === "number" ? existing.createdAt : now,
    dismissedAskUserId: existing?.dismissedAskUserId ?? null,
    workspaceId,
    versionId,
    workspaceDir,
    workspaceName,
  }).catch(err => logger.error("managed response session persist failed", {
    err,
    purpose,
    sessionId,
    turnId,
    workspaceDir,
  }))
}

function getUserQuestion(body: RunRequestBody) {
  if (typeof body.prompt === "string" && body.prompt.trim() !== "") return body.prompt.trim()
  if (!Array.isArray(body.input)) return ""
  return body.input
    .filter(item => item && typeof item === "object" && (item as { type?: unknown }).type === "text")
    .map(item => typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text.trim() : "")
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function getProgressDigest(progress: unknown) {
  if (!progress || typeof progress !== "object") return null
  const record = progress as Record<string, unknown>
  const directPercentages = record.progress_percentages
  const progressPercentages = directPercentages && typeof directPercentages === "object"
    ? directPercentages
    : Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value === "number"))
  return {
    output_files: record.output_files ?? null,
    progress_percentages: progressPercentages,
    schema_version: record.schema_version ?? null,
    status: record.status ?? null,
    updated_at: record.updated_at ?? null,
  }
}

function getManifestRunDigest(run: unknown) {
  if (!run || typeof run !== "object") return null
  const record = run as Record<string, unknown>
  return {
    id: record.id ?? null,
    kind: record.kind ?? null,
    routingIntent: record.routingIntent ?? null,
    sessionId: record.sessionId ?? null,
    skillNames: record.skillNames ?? null,
    status: record.status ?? null,
    threadId: record.threadId ?? null,
    turnId: record.turnId ?? null,
    updatedAt: record.updatedAt ?? null,
    versionId: record.versionId ?? null,
  }
}

function countEventTypes(events: unknown[]) {
  return events.reduce<Record<string, number>>((counts, event) => {
    const type = eventTypeOf(event)
    counts[type] = (counts[type] ?? 0) + 1
    return counts
  }, {})
}

function collectIssues(result: RunCodexTurnResult) {
  const issues: string[] = []
  for (const event of result.events) {
    if (!event || typeof event !== "object") continue
    const record = event as { error?: { message?: unknown }; message?: unknown; type?: unknown }
    if (record.type === "turn.failed" && typeof record.error?.message === "string") {
      issues.push(record.error.message)
    } else if (record.type === "error" && typeof record.message === "string") {
      issues.push(record.message)
    }
  }
  return [...new Set(issues)]
}

export function getProgressPercent(progress: unknown) {
  if (!progress || typeof progress !== "object") return null
  const direct = (progress as { progress_percentages?: unknown }).progress_percentages
  const candidates = direct && typeof direct === "object"
    ? Object.values(direct as Record<string, unknown>)
    : Object.values(progress as Record<string, unknown>)
  const values = candidates.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (values.length === 0) return null
  return Math.max(...values)
}

export function getProgressOutputFiles(progress: unknown) {
  if (!progress || typeof progress !== "object") return []
  const outputFiles = (progress as { output_files?: unknown }).output_files
  if (!outputFiles || typeof outputFiles !== "object") return []
  return Object.entries(outputFiles as Record<string, unknown>)
    .map(([kind, value]) => {
      if (!value || typeof value !== "object") return null
      const record = value as { exists?: unknown; path?: unknown }
      if (typeof record.path !== "string") return null
      return {
        exists: record.exists === true,
        kind,
        path: record.path,
      }
    })
    .filter((item): item is { exists: boolean; kind: string; path: string } => item !== null)
}

export async function getFallbackArtifacts(workspaceDir: string | null) {
  if (!workspaceDir) return []
  const relativePaths = [
    path.join("01_cad", "geometry_after.glb"),
    path.join("01_cad", "geometry_after.step"),
    path.join("02_sim", "simulation", "status.json"),
    path.join("reports", "report.md"),
    path.join("reports", "summary.json"),
  ]
  const artifacts = await Promise.all(relativePaths.map(async relativePath => {
    const fullPath = path.join(workspaceDir, relativePath)
    const stat = await fs.stat(fullPath).catch(() => null)
    return stat ? { exists: true, kind: path.extname(relativePath).slice(1) || "file", path: fullPath } : null
  }))
  return artifacts.filter((item): item is { exists: boolean; kind: string; path: string } => item !== null)
}

export function buildCompletionFallbackSummary({
  artifacts,
  issues,
  latestMessage,
  manifestRun,
  progress,
  status,
}: {
  artifacts: Array<{ exists: boolean; kind: string; path: string }>
  issues: string[]
  latestMessage: string
  manifestRun: unknown
  progress: unknown
  status: ManagedRunResponse["status"]
}) {
  if (issues.length > 0) {
    const issue = compactIssueForSummary(issues[0])
    if (status === "failed") return issue ? `任务执行失败：${issue}` : "任务执行失败，请查看详情。"
    return issue ? `任务已结束，但有问题需要查看：${issue}` : "任务已结束，但有问题需要查看。"
  }
  if (status === "failed") return "任务执行失败，请查看详情。"

  const runStatus = manifestRun && typeof manifestRun === "object" ? (manifestRun as { status?: unknown }).status : null
  const skillNames = manifestRun && typeof manifestRun === "object" && Array.isArray((manifestRun as { skillNames?: unknown }).skillNames)
    ? (manifestRun as { skillNames: unknown[] }).skillNames.filter((item): item is string => typeof item === "string")
    : []
  const progressPercent = getProgressPercent(progress)
  const artifactCount = artifacts.filter(item => item.exists).length
  const compactMessage = compactForSpeech(latestMessage)

  if (compactMessage) return compactMessage
  if (progressPercent !== null) {
    if (progressPercent >= 100) return artifactCount > 0 ? "任务已完成，结果文件已生成。" : "任务已完成，进度已更新。"
    return `任务已结束，当前进度约${Math.round(progressPercent)}%。`
  }
  if (artifactCount > 0) return "任务已结束，已有结果文件生成。"
  if (runStatus === "completed" || status === "completed") {
    return skillNames.length > 0 ? `任务已完成，执行了${skillNames.slice(0, 2).join("、")}。` : "任务已完成。"
  }
  return "任务已结束，详情已更新。"
}

function compactIssueForSummary(text: string) {
  return text
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[[^\]]*?\]\([^)]*?\)/gu, "")
    .replace(/[#*_>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180)
}

function compactForSpeech(text: string) {
  const normalized = text
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[[^\]]*?\]\([^)]*?\)/gu, "")
    .replace(/[#*_>\-]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
  if (!normalized) return ""
  const withoutPrefix = normalized.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/gu, "")
  const firstLine = withoutPrefix.split(/\n/u).find(item => item.trim())?.trim() ?? withoutPrefix
  return firstLine.replace(/\s+/gu, "")
}

function isLikelyTruncatedSummary(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (/[。！？.!?）)\]】]$/u.test(trimmed)) return false

  const tail = trimmed.split(/\s+/u).at(-1) ?? trimmed
  if (/^[a-z_]{1,24}$/iu.test(tail)) return true
  if (/[=:：-]$/u.test(trimmed)) return true
  if (/[，、；;]$/u.test(trimmed)) return true

  return false
}

export function getResponseOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return ""
  const outputText = (payload as { output_text?: unknown }).output_text
  if (typeof outputText === "string" && outputText.trim()) return outputText.trim()

  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) return ""
  const parts: string[] = []
  const fallbackParts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const itemType = (item as { type?: unknown }).type
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") continue
      const contentType = (contentItem as { type?: unknown }).type
      const text = (contentItem as { text?: unknown }).text
      if (typeof text !== "string" || !text.trim()) continue
      if (itemType === "reasoning" || contentType === "reasoning_text") {
        fallbackParts.push(text.trim())
      } else {
        parts.push(text.trim())
      }
    }
  }
  return (parts.length > 0 ? parts : fallbackParts).join("\n").trim()
}

export async function createResponseText({
  config,
  logger,
  maxOutputTokens,
  modelBackend,
  prompt,
  purpose,
  requestId,
  signal,
}: {
  config: AppConfig
  logger: Logger
  maxOutputTokens: number
  modelBackend?: ResolvedModelBackend
  prompt: string
  purpose: string
  requestId?: string
  signal: AbortSignal
}) {
  const resolvedBackend = modelBackend ?? resolveModelBackend(config)
  const baseUrl = resolvedBackend.baseUrl.replace(/\/+$/u, "")
  const model = resolvedBackend.model
  const startedAt = process.hrtime.bigint()
  logger.info("responses api request started", {
    apiKind: "responses",
    apiRoute: "/responses",
    maxOutputTokens,
    model,
    promptLength: prompt.length,
    purpose,
    requestId,
  })
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolvedBackend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: prompt.slice(0, RESPONSES_API_TEXT_MAX_CHARS),
      max_output_tokens: maxOutputTokens,
      ...(model ? { model } : {}),
    }),
    signal,
  })
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    logger.warn("responses api request failed", {
      apiKind: "responses",
      apiRoute: "/responses",
      latencyMs,
      model,
      purpose,
      requestId,
      status: response.status,
    })
    throw new Error(`responses api failed: HTTP ${response.status}${body ? `\n${body.slice(0, 1000)}` : ""}`)
  }

  const payload = await response.json() as unknown
  const outputText = getResponseOutputText(payload)
  logger.info("responses api request completed", {
    apiKind: "responses",
    apiRoute: "/responses",
    latencyMs,
    model,
    outputLength: outputText.length,
    purpose,
    requestId,
    status: response.status,
  })
  return outputText
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout()
          reject(new Error(`operation timed out after ${ms}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function answerProgressQuestion({
  artifacts,
  body,
  config,
  latestStatus,
  logger,
  manifest,
  modelBackend,
  progress,
  requestId,
  session,
}: {
  artifacts: Array<{ exists: boolean; kind: string; path: string }>
  body: RunRequestBody
  config: AppConfig
  latestStatus: ManagedRunStatusResponse | null
  logger: Logger
  manifest: unknown
  modelBackend: ResolvedModelBackend
  progress: unknown
  requestId?: string
  session: unknown
}) {
  const question = getUserQuestion(body) || "请总结当前或上一个任务具体完成了什么。"
  const manifestRuns = manifest && typeof manifest === "object" && Array.isArray((manifest as { runs?: unknown }).runs)
    ? (manifest as { runs: unknown[] }).runs.slice(-5).map(getManifestRunDigest).filter(Boolean)
    : []
  const context = {
    artifacts,
    conversation: getSessionConversationDigest(session),
    latestStatus,
    manifestRuns,
    progress: getProgressDigest(progress),
    workspace: {
      versionId: getOptionalString(body.versionId),
      workspaceDir: getOptionalWorkspaceDir(body.workspaceDir),
      workspaceId: getOptionalString(body.workspaceId),
      workspaceName: getOptionalString(body.workspaceName),
    },
  }

  try {
    const prompt = [
      `用户问题：${question}`,
      "",
      "Workspace 信息：",
      JSON.stringify(context.workspace, null, 2),
      "",
      "上下文 JSON：",
      JSON.stringify(context, null, 2).slice(0, 6000),
    ].join("\n")
    const abort = new AbortController()
    const responseText = await withTimeout(
      createResponseText({
        config,
        logger,
        maxOutputTokens: Math.max(240, MANAGED_CHAT_OUTPUT_TOKENS),
        modelBackend,
        prompt,
        purpose: "managed-progress-answer",
        requestId,
        signal: abort.signal,
      }),
      MANAGED_PROGRESS_ANSWER_TIMEOUT_MS,
      () => abort.abort(),
    )
    const answer = responseText
      .replace(/```[\s\S]*?```/gu, "")
      .replace(/\s+/gu, " ")
      .trim()
    if (answer) {
      logger.info("managed progress answer generated", {
        requestId,
        answerLength: answer.length,
      })
      return answer.slice(0, 240)
    }
  } catch (err) {
    logger.warn("managed progress answer fallback", { err, requestId })
  }

  const latestMessage = getLatestSessionAgentMessage(session)
  return buildFastProgressSummary({ latestMessage, latestStatus, progress })
}

async function createCodexManagedAnswer({
  config,
  input,
  logger,
  modelBackend,
  requestId,
  signal,
  threadId,
  workspaceDir,
}: {
  config: AppConfig
  input: string
  logger: Logger
  modelBackend: ResolvedModelBackend
  requestId?: string
  signal: AbortSignal
  threadId: string | null
  workspaceDir: string | null
}) {
  const startedAt = process.hrtime.bigint()
  const codexConfig = buildCodexConfig(config, modelBackend)
  const codex = new Codex({
    apiKey: modelBackend.apiKey,
    baseUrl: getCodexBaseUrl(config, modelBackend),
    config: codexConfig,
    env: buildManagedAnswerCodexEnv(),
  })
  const threadOptions = {
    ...(modelBackend.model ? { model: modelBackend.model } : {}),
    workingDirectory: workspaceDir ?? process.cwd(),
    approvalPolicy: modelBackend.approvalPolicy,
    skipGitRepoCheck: modelBackend.skipGitRepoCheck,
    modelReasoningEffort: modelBackend.modelReasoningEffort,
    sandboxMode: modelBackend.sandboxMode,
  }
  const thread = threadId
    ? codex.resumeThread(threadId, threadOptions)
    : codex.startThread(threadOptions)
  const streamed = await thread.runStreamed([{ type: "text", text: input }], { signal })
  let resolvedThreadId = threadId
  let answer = ""
  let eventCount = 0

  for await (const event of streamed.events) {
    if (signal.aborted) break
    eventCount += 1
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      resolvedThreadId = event.thread_id
    }
    if (event.type === "item.completed" && event.item.type === "agent_message") {
      answer = event.item.text.trim()
    }
    if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") {
      break
    }
  }

  logger.info("managed general codex answer completed", {
    answerLength: answer.length,
    eventCount,
    latencyMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    model: modelBackend.model,
    modelBackend: modelBackend.id,
    requestId,
    threadId: resolvedThreadId,
  })
  return { answer, threadId: resolvedThreadId }
}

async function summarizePipelineCompletion({
  artifacts,
  config,
  issues,
  latestMessage,
  logger,
  manifestRun,
  modelBackend,
  progress,
  requestId,
  sessionTurn,
  status,
}: {
  artifacts: Array<{ exists: boolean; kind: string; path: string }>
  config: AppConfig
  issues: string[]
  latestMessage: string
  logger: Logger
  manifestRun: unknown
  modelBackend: ResolvedModelBackend
  progress: unknown
  requestId?: string
  sessionTurn: unknown
  status: ManagedRunResponse["status"]
}) {
  const managedPrompt = readManagedPrompt("pipeline-progress-summarizer")
  if (!managedPrompt) {
    return buildCompletionFallbackSummary({ artifacts, issues, latestMessage, manifestRun, progress, status })
  }

  const sessionEvents = sessionTurn && typeof sessionTurn === "object" && Array.isArray((sessionTurn as { events?: unknown }).events)
    ? (sessionTurn as { events: unknown[] }).events
    : []
  const prompt = [
    managedPrompt.content,
    "",
    "## User task context",
    JSON.stringify({
      agentMessages: getAgentMessages(sessionEvents),
      artifacts,
      issues,
      manifestRun: getManifestRunDigest(manifestRun),
      progress: getProgressDigest(progress),
      status,
    }, null, 2).slice(0, 5000),
  ].join("\n")

  try {
    const abort = new AbortController()
    const summary = await withTimeout(
      createResponseText({
        config,
        logger,
        maxOutputTokens: Math.max(360, MANAGED_CHAT_OUTPUT_TOKENS),
        modelBackend,
        prompt,
        purpose: "managed-pipeline-completion-summary",
        requestId,
        signal: abort.signal,
      }),
      Math.min(MANAGED_SUMMARY_TIMEOUT_MS, 5_000),
      () => abort.abort(),
    )
    const cleanedSummary = summary
      .replace(/```[\s\S]*?```/gu, "")
      .replace(/\s+/gu, " ")
      .trim()
    if (cleanedSummary) {
      if (isLikelyTruncatedSummary(cleanedSummary)) {
        logger.warn("managed pipeline completion summary discarded", {
          model: modelBackend.model,
          modelBackend: modelBackend.id,
          requestId,
          managedPrompt: managedPrompt.name,
          summaryLength: cleanedSummary.length,
          tail: cleanedSummary.slice(-80),
        })
        return buildCompletionFallbackSummary({ artifacts, issues, latestMessage, manifestRun, progress, status })
      }
      logger.info("managed pipeline completion summary generated", {
        model: modelBackend.model,
        modelBackend: modelBackend.id,
        requestId,
        managedPrompt: managedPrompt.name,
        summaryLength: cleanedSummary.length,
      })
      return cleanedSummary.slice(0, 240)
    }
  } catch (err) {
    logger.warn("managed pipeline completion summary fallback", { err, requestId, managedPrompt: managedPrompt.name })
  }

  return buildCompletionFallbackSummary({ artifacts, issues, latestMessage, manifestRun, progress, status })
}

async function getLatestManagedStatusForSession(
  sessionId: string | null | undefined,
  {
    versionId,
    workspaceDir,
    workspaceId,
  }: {
    versionId?: string | null
    workspaceDir?: string | null
    workspaceId?: string | null
  } = {},
) {
  if (!sessionId) return null
  const normalizedWorkspaceDir = getOptionalWorkspaceDir(workspaceDir)
  const normalizedWorkspaceId = getOptionalString(workspaceId)
  const normalizedVersionId = getOptionalString(versionId)
  const matches = (await listRecentManagedRunStatuses()).filter(status =>
    status.sessionId === sessionId &&
    (!normalizedWorkspaceDir || getOptionalWorkspaceDir(status.workspaceDir) === normalizedWorkspaceDir) &&
    (!normalizedWorkspaceId || status.workspaceId === normalizedWorkspaceId) &&
    (!normalizedVersionId || status.versionId === normalizedVersionId)
  )
  return matches.sort((a, b) => b.managedRunId.localeCompare(a.managedRunId))[0] ?? null
}

export function buildFastProgressSummary({
  latestStatus,
  latestMessage,
  progress,
}: {
  latestStatus: ManagedRunStatusResponse | null
  latestMessage?: string
  progress: unknown
}) {
  const compactMessage = compactForSpeech(latestMessage ?? "")
  if (compactMessage) return compactMessage

  if (latestStatus?.status && latestStatus.status !== "running") {
    return latestStatus.spokenSummary || latestStatus.summary || (
      latestStatus.status === "failed" ? "任务执行失败，请查看详情。" : "任务已完成。"
    )
  }

  const progressPercent = getProgressPercent(progress)
  if (progressPercent !== null) {
    if (progressPercent >= 100) return "任务已完成，结果已生成。"
    return `任务正在运行，进度约${Math.round(progressPercent)}%。`
  }

  const artifacts = getProgressOutputFiles(progress)
  if (artifacts.some(item => item.exists)) return "已有结果文件生成。"

  if (latestStatus?.status === "running") return "任务正在处理中。"

  return "当前任务已接收，正在分析。"
}

async function buildManagedSummary(
  result: RunCodexTurnResult,
  {
    config,
    logger,
    modelBackend,
    requestId,
  }: {
    config: AppConfig
    logger: Logger
    modelBackend: ResolvedModelBackend
    requestId?: string
  },
) {
  const progressRecord = result.runContext.workspaceDir
    ? await resolveProgressFromLatestSessionRun(result.runContext.sessionId, result.runContext.workspaceDir).catch(() => null)
    : null
  const progress = progressRecord?.data ?? null
  const manifest = result.runContext.workspaceId || result.runContext.workspaceDir
    ? await getWorkspaceManifestSnapshotByLocator({
      sessionId: result.runContext.workspaceId ?? result.runContext.sessionId,
      workspaceDir: result.runContext.workspaceDir,
    }).catch(() => null)
    : null
  const manifestRun = manifest?.runs.find(run => run.id === result.manifestRunId || run.turnId === result.turnId) ?? null
  const session = await findWorkspaceSession(result.runContext.sessionId, result.runContext.workspaceDir).catch(() => null)
  const sessionTurns = Array.isArray(session?.turns) ? session.turns : []
  const sessionTurn = sessionTurns.find(turn => turn && typeof turn === "object" && (turn as { id?: unknown }).id === result.turnId) ?? null
  const outputArtifacts = getProgressOutputFiles(progress)
  const fallbackArtifacts = await getFallbackArtifacts(result.runContext.workspaceDir)
  const artifacts = outputArtifacts.length > 0 ? outputArtifacts : fallbackArtifacts
  const issues = collectIssues(result)
  const latestMessage = getLatestAgentMessage(result.events)
  const status: ManagedRunResponse["status"] = result.status === "completed" && issues.length > 0 ? "partial" : result.status
  const spokenSummary = await summarizePipelineCompletion({
    artifacts,
    config,
    issues,
    latestMessage,
    logger,
    manifestRun,
    modelBackend,
    progress,
    requestId,
    sessionTurn,
    status,
  })

  return {
    artifacts,
    eventCounts: countEventTypes(result.events),
    issues,
    manifestRun,
    progress,
    sessionTurn,
    spokenSummary,
    status,
    summary: spokenSummary,
  }
}

export async function getManagedRunStatus(managedRunId: string) {
  const status = managedRunStatuses.get(managedRunId) ?? await readPersistedManagedRunStatus(managedRunId)
  const currentUserId = getRequestUserId()
  if (!status || !currentUserId || !status.userId || status.userId === currentUserId) return status
  return null
}

export async function cancelManagedRunAndSummarize(
  managedRunId: string,
  { config, logger, requestId }: { config: AppConfig; logger: Logger; requestId?: string },
) {
  const modelBackend = resolveModelBackend(config)
  const latestStatus = await getManagedRunStatus(managedRunId)
  if (!latestStatus) return null

  const abort = managedRunAbortControllers.get(managedRunId)
  if (abort) {
    abort.abort()
    managedRunAbortControllers.delete(managedRunId)
  }

  if (latestStatus.status !== "running") return latestStatus

  const session = await findWorkspaceSession(latestStatus.sessionId, latestStatus.workspaceDir).catch(() => null)
  const progressRecord = latestStatus.workspaceDir
    ? await resolveProgressFromLatestSessionRun(latestStatus.sessionId, latestStatus.workspaceDir).catch(() => null)
    : null
  const progress = progressRecord?.data ?? null
  const latestMessage = getLatestSessionAgentMessage(session)
  const artifacts = getProgressOutputFiles(progress)
  const manifest = latestStatus.workspaceId || latestStatus.workspaceDir
    ? await getWorkspaceManifestSnapshotByLocator({
      sessionId: latestStatus.workspaceId ?? latestStatus.sessionId,
      workspaceDir: latestStatus.workspaceDir,
    }).catch(() => null)
    : null
  const manifestRun = manifest && typeof manifest === "object" && Array.isArray((manifest as { runs?: unknown }).runs)
    ? (manifest as { runs: unknown[] }).runs.find(run => run && typeof run === "object" && (
      (run as { turnId?: unknown }).turnId === latestStatus.turnId ||
      (run as { sessionId?: unknown }).sessionId === latestStatus.sessionId
    )) ?? null
    : null
  const sessionTurns = session && typeof session === "object" && Array.isArray((session as { turns?: unknown }).turns)
    ? (session as { turns: unknown[] }).turns
    : []
  const sessionTurn = sessionTurns.find(turn => turn && typeof turn === "object" && (turn as { id?: unknown }).id === latestStatus.turnId) ?? null
  const spokenSummary = await summarizePipelineCompletion({
    artifacts,
    config,
    issues: latestStatus.error ? [latestStatus.error] : [],
    latestMessage,
    logger,
    manifestRun,
    modelBackend,
    progress,
    requestId: `${requestId ?? "request"}:${managedRunId}:cancel-summary`,
    sessionTurn,
    status: "cancelled",
  }) || buildFastProgressSummary({ latestMessage, latestStatus, progress })
  const cancelledStatus: ManagedRunStatusResponse = {
    ...latestStatus,
    spokenSummary,
    status: "cancelled",
    summary: spokenSummary,
  }
  rememberManagedRunStatus(cancelledStatus, logger)
  logger.info("managed run cancelled and summarized", {
    managedRunId,
    requestId,
    sessionId: latestStatus.sessionId,
    workspaceDir: latestStatus.workspaceDir,
  })
  return cancelledStatus
}

export async function summarizeManagedProgress(
  body: RunRequestBody,
  { config, logger, requestId }: { config: AppConfig; logger: Logger; requestId?: string },
) {
  const modelBackend = resolveModelBackend(config, body.modelBackend)
  const sessionId = getOptionalString(body.sessionId)
  const workspaceDir = getOptionalWorkspaceDir(body.workspaceDir)
  const workspaceId = getOptionalString(body.workspaceId)
  const versionId = getOptionalString(body.versionId)
  const turnId = getOptionalString(body.turnId) ?? makeManagedTurnId()
  const latestStatus = await getLatestManagedStatusForSession(sessionId, { versionId, workspaceDir, workspaceId })
    ?? await getLatestManagedStatusForWorkspace(body)
  const resolvedSessionId = sessionId ?? latestStatus?.sessionId ?? null
  const resolvedWorkspaceDir = workspaceDir ?? latestStatus?.workspaceDir ?? null
  const resolvedWorkspaceId = workspaceId ?? latestStatus?.workspaceId ?? null
  const resolvedVersionId = versionId ?? latestStatus?.versionId ?? null
  const progressRecord = resolvedSessionId && resolvedWorkspaceDir
    ? await resolveProgressFromLatestSessionRun(resolvedSessionId, resolvedWorkspaceDir).catch(() => null)
    : null
  const progress = progressRecord?.data ?? null
  const latestSession = resolvedSessionId ? await findWorkspaceSession(resolvedSessionId, resolvedWorkspaceDir).catch(() => null) : null
  const latestMessage = getLatestSessionAgentMessage(latestSession)
  const artifacts = getProgressOutputFiles(progress)
  const manifest = resolvedWorkspaceId || resolvedWorkspaceDir
    ? await getWorkspaceManifestSnapshotByLocator({
      sessionId: resolvedWorkspaceId ?? resolvedSessionId ?? "workspace",
      workspaceDir: resolvedWorkspaceDir,
    }).catch(() => null)
    : null
  const spokenSummary = await answerProgressQuestion({
    artifacts,
    body,
    config,
    latestStatus,
    logger,
    manifest,
    modelBackend,
    progress,
    requestId: `${requestId ?? "request"}:managed-progress-summary`,
    session: latestSession,
  }) || buildFastProgressSummary({ latestMessage, latestStatus, progress })

  return {
    artifacts,
    eventCounts: {},
    issues: latestStatus?.error ? [latestStatus.error] : [],
    managedRunId: makeManagedRunId(),
    manifestRun: manifest && typeof manifest === "object" && Array.isArray((manifest as { runs?: unknown }).runs)
      ? (manifest as { runs: unknown[] }).runs.slice(-1)[0] ?? null
      : null,
    progress,
    routing: { selectedSkills: ["progress-summarizer"], skillScopes: ["public"] as SkillScope[] },
    sessionId: resolvedSessionId ?? "",
    sessionTurn: null,
    spokenSummary,
    status: latestStatus?.status === "running" ? "partial" as const : latestStatus?.status ?? "partial" as const,
    summary: spokenSummary,
    threadId: latestStatus?.threadId ?? getOptionalString(body.threadId),
    turnId,
    versionId: resolvedVersionId,
    workspaceDir: resolvedWorkspaceDir,
    workspaceId: resolvedWorkspaceId,
  }
}

export function subscribeManagedRunStatus(
  managedRunId: string,
  subscriber: (event: ManagedRunEvent) => void,
) {
  const subscribers = managedRunEventSubscribers.get(managedRunId) ?? new Set<(event: ManagedRunEvent) => void>()
  subscribers.add(subscriber)
  managedRunEventSubscribers.set(managedRunId, subscribers)
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) managedRunEventSubscribers.delete(managedRunId)
  }
}

export function getManagedRunEvents(managedRunId: string) {
  return managedRunEventBacklog.get(managedRunId) ?? []
}

async function answerManagedProgressFromDispatch({
  body,
  config,
  inputType,
  latestStatus,
  logger,
  managedRunId,
  modelBackend,
  requestId,
  routing,
}: {
  body: RunRequestBody
  config: AppConfig
  inputType: "text" | "voice"
  latestStatus?: ManagedRunStatusResponse | null
  logger: Logger
  managedRunId: string
  modelBackend: ResolvedModelBackend
  requestId?: string
  routing: ManagedRouting
}): Promise<ManagedRunResponse> {
  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() !== "" ? body.sessionId.trim() : latestStatus?.sessionId ?? null
  const workspaceDir = getOptionalWorkspaceDir(body.workspaceDir) ?? latestStatus?.workspaceDir ?? null
  const workspaceId = typeof body.workspaceId === "string" && body.workspaceId.trim() !== "" ? body.workspaceId.trim() : latestStatus?.workspaceId ?? null
  const versionId = typeof body.versionId === "string" && body.versionId.trim() !== "" ? body.versionId.trim() : latestStatus?.versionId ?? null
  const turnId = typeof body.turnId === "string" && body.turnId.trim() !== "" ? body.turnId.trim() : managedRunId
  const resolvedLatestStatus = latestStatus
    ?? await getLatestManagedStatusForSession(sessionId, { versionId, workspaceDir, workspaceId })
    ?? await getLatestManagedStatusForWorkspace(body)
  const resolvedSessionId = sessionId ?? resolvedLatestStatus?.sessionId ?? null
  const resolvedWorkspaceDir = workspaceDir ?? resolvedLatestStatus?.workspaceDir ?? null
  const resolvedWorkspaceId = workspaceId ?? resolvedLatestStatus?.workspaceId ?? null
  const resolvedVersionId = versionId ?? resolvedLatestStatus?.versionId ?? null
  const progressRecord = resolvedSessionId && resolvedWorkspaceDir
    ? await resolveProgressFromLatestSessionRun(resolvedSessionId, resolvedWorkspaceDir).catch(() => null)
    : null
  const progress = progressRecord?.data ?? null
  const latestSession = resolvedSessionId ? await findWorkspaceSession(resolvedSessionId, resolvedWorkspaceDir).catch(() => null) : null
  const artifacts = getProgressOutputFiles(progress)
  const manifest = resolvedWorkspaceId || resolvedWorkspaceDir
    ? await getWorkspaceManifestSnapshotByLocator({
      sessionId: resolvedWorkspaceId ?? resolvedSessionId ?? "workspace",
      workspaceDir: resolvedWorkspaceDir,
    }).catch(() => null)
    : null
  const spokenSummary = await answerProgressQuestion({
    artifacts,
    body,
    config,
    latestStatus: resolvedLatestStatus,
    logger,
    manifest,
    modelBackend,
    progress,
    requestId: `${requestId ?? "request"}:${managedRunId}:progress-answer`,
    session: latestSession,
  })
  await persistManagedResponseTurn({
    answer: spokenSummary,
    logger,
    purpose: "managed-progress-answer",
    question: getUserQuestion(body) || "请总结当前或上一个任务具体完成了什么。",
    sessionId: resolvedSessionId,
    threadId: resolvedLatestStatus?.threadId ?? (typeof body.threadId === "string" && body.threadId.trim() !== "" ? body.threadId.trim() : null),
    turnId,
    versionId: resolvedVersionId,
    workspaceDir: resolvedWorkspaceDir,
    workspaceId: resolvedWorkspaceId,
    workspaceName: getOptionalString(body.workspaceName),
  })
  const response: ManagedRunResponse = {
    artifacts,
    eventCounts: {},
    issues: resolvedLatestStatus?.error ? [resolvedLatestStatus.error] : [],
    managedRunId,
    manifestRun: manifest && typeof manifest === "object" && Array.isArray((manifest as { runs?: unknown }).runs)
      ? (manifest as { runs: unknown[] }).runs.slice(-1)[0] ?? null
      : null,
    progress,
    routing,
    sessionId: resolvedSessionId ?? "",
    sessionTurn: null,
    spokenSummary,
    status: resolvedLatestStatus?.status === "running" ? "partial" : resolvedLatestStatus?.status ?? "partial",
    summary: spokenSummary,
    threadId: resolvedLatestStatus?.threadId ?? (typeof body.threadId === "string" && body.threadId.trim() !== "" ? body.threadId.trim() : null),
    turnId,
    versionId: resolvedVersionId,
    workspaceDir: resolvedWorkspaceDir,
    workspaceId: resolvedWorkspaceId,
  }
  publishManagedRunEvent({
    type: response.status === "failed" ? "failed" : "final",
    managedRunId,
    status: {
      managedRunId,
      routing: response.routing,
      sessionId: response.sessionId,
      spokenSummary: response.spokenSummary,
      status: response.status,
      summary: response.summary,
      threadId: response.threadId,
      turnId,
      versionId: resolvedVersionId,
      workspaceDir: resolvedWorkspaceDir,
      workspaceId: resolvedWorkspaceId,
    },
  })
  logger.info("managed dispatch returned progress response", {
    inputType,
    lockedByManagedRunId: resolvedLatestStatus?.status === "running" ? resolvedLatestStatus.managedRunId : null,
    managedRunId,
    requestId,
    sessionId: resolvedSessionId,
    status: response.status,
    workspaceDir: resolvedWorkspaceDir,
  })
  return response
}

async function answerGeneralQuestionFromDispatch({
  body,
  config,
  inputType,
  logger,
  managedRunId,
  modelBackend,
  normalized,
  requestId,
  routing,
}: {
  body: RunRequestBody
  config: AppConfig
  inputType: "text" | "voice"
  logger: Logger
  managedRunId: string
  modelBackend: ResolvedModelBackend
  normalized: { sessionKey: string }
  requestId?: string
  routing: ManagedRouting
}): Promise<ManagedRunResponse> {
  const question = getUserQuestion(body)
  const sessionId = getOptionalString(body.sessionId) ?? makeManagedSessionId()
  const threadId = getOptionalString(body.threadId)
  const turnId = getOptionalString(body.turnId) ?? makeManagedTurnId()
  const workspaceDir = getOptionalWorkspaceDir(body.workspaceDir)
  const workspaceId = getOptionalString(body.workspaceId)
  const versionId = getOptionalString(body.versionId)
  const workspaceName = getOptionalString(body.workspaceName)
  let answer = ""
  let answerError = ""
  let resolvedThreadId = threadId
  const workspaceContext = {
    versionId,
    workspaceDir,
    workspaceId,
    workspaceName,
  }

  try {
    const prompt = [
      `用户问题：${question}`,
      "",
      "Workspace 信息：",
      JSON.stringify(workspaceContext, null, 2),
    ].join("\n")
    const abort = new AbortController()
    const result = await withTimeout(
      createCodexManagedAnswer({
        config,
        input: prompt,
        logger,
        modelBackend,
        requestId: `${requestId ?? "request"}:${managedRunId}:general-answer`,
        signal: abort.signal,
        threadId,
        workspaceDir,
      }),
      MANAGED_GENERAL_ANSWER_TIMEOUT_MS,
      () => abort.abort(),
    )
    answer = result.answer
    resolvedThreadId = result.threadId
    answer = answer
      .replace(/```[\s\S]*?```/gu, "")
      .replace(/\s+/gu, " ")
      .trim()
    if (!answer) answerError = "回答生成失败：模型返回了空内容。"
  } catch (err) {
    answerError = formatManagedAnswerError(err)
    logger.warn("managed general answer fallback", { err, managedRunId, requestId })
  }

  const responseStatus: ManagedRunResponse["status"] = answer ? "completed" : "failed"
  const spokenSummary = answer || answerError
  await persistManagedResponseTurn({
    answer,
    logger,
    purpose: "managed-general-answer",
    question,
    sessionId,
    threadId: resolvedThreadId,
    turnId,
    versionId,
    workspaceDir,
    workspaceId,
    workspaceName,
  })
  const response: ManagedRunResponse = {
    artifacts: [],
    eventCounts: {},
    ...(answer ? {} : { error: answerError }),
    issues: answer ? [] : [answerError],
    managedRunId,
    manifestRun: null,
    progress: null,
    routing,
    sessionId,
    sessionTurn: null,
    spokenSummary,
    status: responseStatus,
    summary: spokenSummary,
    threadId: resolvedThreadId,
    turnId,
    versionId,
    workspaceDir,
    workspaceId,
  }
  rememberManagedRunStatus({
    managedRunId,
    routing,
    sessionId,
    spokenSummary,
    status: responseStatus,
    summary: response.summary,
    threadId: resolvedThreadId,
    turnId,
    versionId,
    workspaceDir,
    workspaceId,
  }, logger)
  rememberManagedSessionState(normalized.sessionKey, {
    sessionId,
    threadId: resolvedThreadId,
    versionId,
    workspaceDir,
    workspaceId,
  })
  publishManagedRunEvent({
    type: "final",
    managedRunId,
    status: {
      managedRunId,
      routing,
      sessionId,
      spokenSummary,
      status: responseStatus,
      summary: response.summary,
      threadId: resolvedThreadId,
      turnId,
      versionId,
      workspaceDir,
      workspaceId,
    },
  })
  logger.info("managed dispatch returned general response", {
    answerLength: spokenSummary.length,
    inputType,
    managedRunId,
    requestId,
    sessionId,
    workspaceDir,
    workspaceId,
  })
  return response
}

export async function runAgentTurn(
  { body, inputType = "text" }: AgentTurnInput,
  { config, logger, requestId }: { config: AppConfig; logger: Logger; requestId?: string },
): Promise<ManagedDispatchResponse> {
  const managedRunId = makeManagedRunId()
  const normalized = await normalizeManagedRunBody(body)
  body = normalized.body
  const modelBackend = resolveModelBackend(config, body.modelBackend)
  publishManagedRunEvent({ type: "accepted", managedRunId, inputType, requestId })

  const lockedStatus = await getLatestManagedStatusForWorkspace(body)
  if (lockedStatus?.status === "running") {
    const routing: ManagedRouting = { selectedSkills: ["progress-summarizer"], skillScopes: ["public"] }
    publishManagedRunEvent({ type: "routing", managedRunId, routing })
    logger.info("managed dispatch downgraded by active pipeline lock", {
      inputType,
      lockedByManagedRunId: lockedStatus.managedRunId,
      managedRunId,
      requestId,
      sessionId: lockedStatus.sessionId,
      workspaceDir: lockedStatus.workspaceDir,
      workspaceId: lockedStatus.workspaceId,
    })
    return answerManagedProgressFromDispatch({
      body: {
        ...body,
        sessionId: body.sessionId ?? lockedStatus.sessionId,
        threadId: body.threadId ?? lockedStatus.threadId,
        versionId: body.versionId ?? lockedStatus.versionId,
        workspaceDir: body.workspaceDir ?? lockedStatus.workspaceDir,
        workspaceId: body.workspaceId ?? lockedStatus.workspaceId,
      },
      config,
      inputType,
      latestStatus: lockedStatus,
      logger,
      managedRunId,
      modelBackend,
      requestId,
      routing,
    })
  }

  const routing = await routeManagedRunIntent(body, {
    config,
    logger,
    requestId: `${requestId ?? "request"}:${managedRunId}:dispatch`,
  })
  publishManagedRunEvent({
    type: "routing",
    managedRunId,
    routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
  })

  if (routing.managedSkills.includes("progress-summarizer")) {
    return answerManagedProgressFromDispatch({
      body,
      config,
      inputType,
      logger,
      managedRunId,
      modelBackend,
      requestId,
      routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
    })
  }

  if (routing.intent === "general") {
    return answerGeneralQuestionFromDispatch({
      body,
      config,
      inputType,
      logger,
      managedRunId,
      modelBackend,
      normalized,
      requestId,
      routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
    })
  }

  const prepared = await prepareCodexTurn(body, {
    config,
    forcedSkillScopes: routing.skillScopes,
    logger,
    requestId: `${requestId ?? "request"}:${managedRunId}:dispatch`,
    routingIntent: routing.intent,
    selectedSkillNames: routing.selectedSkills,
  })

  const abort = new AbortController()
  managedRunAbortControllers.set(managedRunId, abort)
  const spokenSummary = MANAGED_START_SUMMARY
  rememberManagedRunStatus({
    managedRunId,
    routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
    sessionId: prepared.runContext.sessionId,
    spokenSummary,
    status: "running",
    summary: spokenSummary,
    threadId: prepared.runContext.threadId,
    turnId: prepared.runContext.turnId,
    versionId: prepared.runContext.versionId,
    workspaceDir: prepared.runContext.workspaceDir,
    workspaceId: prepared.runContext.workspaceId,
  }, logger)
  rememberManagedSessionState(normalized.sessionKey, {
    sessionId: prepared.runContext.sessionId,
    threadId: prepared.runContext.threadId,
    versionId: prepared.runContext.versionId,
    workspaceDir: prepared.runContext.workspaceDir,
    workspaceId: prepared.runContext.workspaceId,
  })
  publishManagedRunEvent({
    type: "started",
    managedRunId,
    status: {
      managedRunId,
      routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
      sessionId: prepared.runContext.sessionId,
      spokenSummary,
      status: "running",
      summary: spokenSummary,
      threadId: prepared.runContext.threadId,
      turnId: prepared.runContext.turnId,
      versionId: prepared.runContext.versionId,
      workspaceDir: prepared.runContext.workspaceDir,
      workspaceId: prepared.runContext.workspaceId,
    },
  })

  void (async () => {
    try {
      const result = await executeCodexTurn(prepared, { signal: abort.signal })
      managedRunAbortControllers.delete(managedRunId)
      const summary = await buildManagedSummary(result, {
        config,
        logger,
        modelBackend: prepared.modelBackend,
        requestId: `${requestId ?? "request"}:${managedRunId}:final-summary`,
      })
      const currentStatus = await getManagedRunStatus(managedRunId)
      if (currentStatus?.status === "cancelled") {
        logger.info("managed dispatch background final skipped after cancel", {
          inputType,
          managedRunId,
          requestId,
          resultStatus: summary.status,
          turnId: prepared.runContext.turnId,
        })
        return
      }
      rememberManagedRunStatus({
        managedRunId,
        routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
        sessionId: prepared.runContext.sessionId,
        spokenSummary: summary.spokenSummary,
        status: summary.status,
        summary: summary.summary,
        threadId: result.threadId,
        turnId: result.turnId,
        versionId: result.runContext.versionId,
        workspaceDir: result.runContext.workspaceDir,
        workspaceId: result.runContext.workspaceId,
      }, logger)
      rememberManagedSessionState(normalized.sessionKey, {
        sessionId: result.runContext.sessionId,
        threadId: result.threadId,
        versionId: result.runContext.versionId,
        workspaceDir: result.runContext.workspaceDir,
        workspaceId: result.runContext.workspaceId,
      })
      logger.info("managed dispatch background run completed", {
        inputType,
        managedRunId,
        requestId,
        status: summary.status,
        turnId: prepared.runContext.turnId,
      })
    } catch (err) {
      managedRunAbortControllers.delete(managedRunId)
      if (abort.signal.aborted) return
      const errorSummary = "任务执行失败，请查看详情。"
      rememberManagedRunStatus({
        error: err instanceof Error ? err.message : "managed dispatch background run failed",
        managedRunId,
        routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
        sessionId: prepared.runContext.sessionId,
        spokenSummary: errorSummary,
        status: "failed",
        summary: errorSummary,
        threadId: prepared.runContext.threadId,
        turnId: prepared.runContext.turnId,
        versionId: prepared.runContext.versionId,
        workspaceDir: prepared.runContext.workspaceDir,
        workspaceId: prepared.runContext.workspaceId,
      }, logger)
      rememberManagedSessionState(normalized.sessionKey, {
        sessionId: prepared.runContext.sessionId,
        threadId: prepared.runContext.threadId,
        versionId: prepared.runContext.versionId,
        workspaceDir: prepared.runContext.workspaceDir,
        workspaceId: prepared.runContext.workspaceId,
      })
      logger.error("managed dispatch background run failed", {
        err,
        inputType,
        managedRunId,
        requestId,
        turnId: prepared.runContext.turnId,
      })
    }
  })()

  const response: ManagedStartResponse = {
    managedRunId,
    routing: { selectedSkills: routing.selectedSkills, skillScopes: routing.skillScopes },
    sessionId: prepared.runContext.sessionId,
    spokenSummary,
    status: "started",
    summary: spokenSummary,
    threadId: prepared.runContext.threadId,
    turnId: prepared.runContext.turnId,
    versionId: prepared.runContext.versionId,
    workspaceDir: prepared.runContext.workspaceDir,
    workspaceId: prepared.runContext.workspaceId,
  }
  logger.info("managed dispatch started task", {
    inputType,
    managedRunId,
    requestId,
    sessionId: prepared.runContext.sessionId,
    selectedSkills: routing.selectedSkills,
    skillScopes: routing.skillScopes,
    turnId: prepared.runContext.turnId,
  })
  return response
}
