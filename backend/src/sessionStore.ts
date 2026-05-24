import fs from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { getFreecadWorkspaceRoot } from "./freecadWorkspace.js"

export const WORKSPACE_CONVERSATION_HISTORY_FILE = "conversation-history.json"

export type SessionRecordLike = {
  id?: unknown
  turns?: unknown
  workspaceDir?: unknown
  [key: string]: unknown
}

function getSessionId(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function getTurnId(value: unknown) {
  if (!value || typeof value !== "object") return null
  const id = (value as { id?: unknown }).id
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.${randomBytes(4).toString("hex")}.tmp`
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmp, content, "utf-8")
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

function mergeTurns(existing: unknown, incoming: unknown) {
  const result: unknown[] = []
  const indexById = new Map<string, number>()

  const appendOrReplace = (turn: unknown) => {
    const turnId = getTurnId(turn)
    if (!turnId) {
      result.push(turn)
      return
    }

    const existingIndex = indexById.get(turnId)
    if (existingIndex === undefined) {
      indexById.set(turnId, result.length)
      result.push(turn)
      return
    }

    result[existingIndex] = turn
  }

  if (Array.isArray(existing)) existing.forEach(appendOrReplace)
  if (Array.isArray(incoming)) incoming.forEach(appendOrReplace)

  return result
}

function mergeSession(existing: unknown, incoming: unknown) {
  if (!existing || typeof existing !== "object") return incoming
  if (!incoming || typeof incoming !== "object") return existing

  return {
    ...(existing as Record<string, unknown>),
    ...(incoming as Record<string, unknown>),
    turns: mergeTurns((existing as SessionRecordLike).turns, (incoming as SessionRecordLike).turns),
  }
}

async function resolveWorkspaceHistoryPath(workspaceDir: unknown) {
  if (typeof workspaceDir !== "string" || workspaceDir.trim() === "") return null
  const freecadRoot = path.resolve(await getFreecadWorkspaceRoot())
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  if (!isPathInside(freecadRoot, resolvedWorkspaceDir)) return null
  return path.join(resolvedWorkspaceDir, "logs", WORKSPACE_CONVERSATION_HISTORY_FILE)
}

async function readWorkspaceSessions(filePath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function listWorkspaceHistoryFiles() {
  const freecadRoot = path.resolve(await getFreecadWorkspaceRoot())
  const files: string[] = []

  const visit = async (dir: string) => {
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (dirent.isFile() && dirent.name === WORKSPACE_CONVERSATION_HISTORY_FILE && path.basename(dir) === "logs") {
        files.push(fullPath)
      }
    }
  }

  await visit(freecadRoot)
  return files
}

function sortSessionsByCreatedAt(sessions: SessionRecordLike[]) {
  return [...sessions].sort((left, right) => {
    const leftCreatedAt = typeof (left as { createdAt?: unknown }).createdAt === "number"
      ? (left as { createdAt: number }).createdAt
      : 0
    const rightCreatedAt = typeof (right as { createdAt?: unknown }).createdAt === "number"
      ? (right as { createdAt: number }).createdAt
      : 0
    return rightCreatedAt - leftCreatedAt
  })
}

export async function readWorkspaceSessionHistory(workspaceDir: unknown) {
  const filePath = await resolveWorkspaceHistoryPath(workspaceDir)
  return filePath ? await readWorkspaceSessions(filePath) as SessionRecordLike[] : []
}

export async function readAllWorkspaceSessionHistories() {
  const files = await listWorkspaceHistoryFiles()
  const bySessionId = new Map<string, SessionRecordLike>()

  for (const filePath of files) {
    const sessions = await readWorkspaceSessions(filePath) as SessionRecordLike[]
    for (const session of sessions) {
      const sessionId = getSessionId(session.id)
      if (!sessionId) continue
      bySessionId.set(sessionId, bySessionId.has(sessionId) ? mergeSession(bySessionId.get(sessionId), session) as SessionRecordLike : session)
    }
  }

  return sortSessionsByCreatedAt([...bySessionId.values()])
}

export async function findWorkspaceSession(sessionId: string, workspaceDir?: unknown) {
  const sessions = workspaceDir
    ? await readWorkspaceSessionHistory(workspaceDir)
    : await readAllWorkspaceSessionHistories()
  return sessions.find(session => getSessionId(session.id) === sessionId) ?? null
}

export async function upsertWorkspaceSessionHistory(session: SessionRecordLike) {
  const sessionId = getSessionId(session.id)
  if (!sessionId) return

  const filePath = await resolveWorkspaceHistoryPath(session.workspaceDir)
  if (!filePath) return

  const existing = await readWorkspaceSessions(filePath)
  const index = existing.findIndex((item: SessionRecordLike) => getSessionId(item?.id) === sessionId)
  const nextSessions = index >= 0
    ? existing.map((item: unknown, itemIndex: number) => itemIndex === index ? mergeSession(item, session) : item)
    : [...existing, session]

  await atomicWrite(filePath, `${JSON.stringify(nextSessions, null, 2)}\n`)
}

export async function removeWorkspaceSessionHistory(session: SessionRecordLike) {
  const sessionId = getSessionId(session.id)
  if (!sessionId) return

  const filePath = await resolveWorkspaceHistoryPath(session.workspaceDir)
  if (!filePath) return

  const existing = await readWorkspaceSessions(filePath)
  const nextSessions = existing.filter((item: SessionRecordLike) => getSessionId(item?.id) !== sessionId)
  await atomicWrite(filePath, `${JSON.stringify(nextSessions, null, 2)}\n`)
}

export async function removeWorkspaceSessionHistoryById(sessionId: string) {
  const trimmedSessionId = getSessionId(sessionId)
  if (!trimmedSessionId) return

  const files = await listWorkspaceHistoryFiles()
  for (const filePath of files) {
    const existing = await readWorkspaceSessions(filePath)
    const nextSessions = existing.filter((item: SessionRecordLike) => getSessionId(item?.id) !== trimmedSessionId)
    if (nextSessions.length !== existing.length) {
      await atomicWrite(filePath, `${JSON.stringify(nextSessions, null, 2)}\n`)
    }
  }
}

export async function replaceWorkspaceSessionHistories(sessions: SessionRecordLike[]) {
  const nextSessionIds = new Set(sessions.map(session => getSessionId(session.id)).filter((id): id is string => !!id))
  const existing = await readAllWorkspaceSessionHistories()
  for (const session of existing) {
    const sessionId = getSessionId(session.id)
    if (sessionId && !nextSessionIds.has(sessionId)) {
      await removeWorkspaceSessionHistoryById(sessionId)
    }
  }

  for (const session of sessions) {
    await upsertWorkspaceSessionHistory(session)
  }
}
