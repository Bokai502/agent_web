import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { randomBytes } from "crypto"
import type { Logger } from "../logger.js"
import { initializeFreecadProgressForSession } from "../freecadProgress.js"

const SESSIONS_FILE = path.resolve(process.cwd(), "sessions.json")
const DELETED_SESSIONS_FILE = path.resolve(process.cwd(), "deleted-sessions.json")

type SessionLike = {
  id?: unknown
  threadId?: unknown
  turns?: unknown
  versionId?: unknown
  workspaceDir?: unknown
  workspaceId?: unknown
  workspaceName?: unknown
}

function getSessionId(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function getTurnId(value: unknown) {
  if (!value || typeof value !== "object") return null
  const id = (value as { id?: unknown }).id
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null
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

  if (Array.isArray(existing)) {
    existing.forEach(appendOrReplace)
  }
  if (Array.isArray(incoming)) {
    incoming.forEach(appendOrReplace)
  }

  return result
}

function mergeSession(existing: unknown, incoming: unknown) {
  if (!existing || typeof existing !== "object") return incoming
  if (!incoming || typeof incoming !== "object") return existing

  const existingSession = existing as SessionLike
  const incomingSession = incoming as SessionLike
  const merged: Record<string, unknown> = {
    ...(existing as Record<string, unknown>),
    ...(incoming as Record<string, unknown>),
    turns: mergeTurns(existingSession.turns, incomingSession.turns),
  }

  if (incomingSession.threadId == null && existingSession.threadId != null) {
    merged.threadId = existingSession.threadId
  }
  if (incomingSession.workspaceId == null && existingSession.workspaceId != null) {
    merged.workspaceId = existingSession.workspaceId
  }
  if (incomingSession.versionId == null && existingSession.versionId != null) {
    merged.versionId = existingSession.versionId
  }
  if (incomingSession.workspaceDir == null && existingSession.workspaceDir != null) {
    merged.workspaceDir = existingSession.workspaceDir
  }
  if (incomingSession.workspaceName == null && existingSession.workspaceName != null) {
    merged.workspaceName = existingSession.workspaceName
  }

  return merged
}

// 先写临时文件再 rename，避免并发写入导致文件截断
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

function extractSessionIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set()

  return new Set(
    value
      .map((session: SessionLike) => session?.id)
      .filter((id): id is string => typeof id === "string" && id.trim() !== "")
      .map(id => id.trim()),
  )
}

async function readExistingSessions() {
  try {
    const raw = await fs.readFile(SESSIONS_FILE, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function readDeletedSessionIds() {
  try {
    const raw = await fs.readFile(DELETED_SESSIONS_FILE, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data)
      ? new Set(data.filter((id): id is string => typeof id === "string" && id.trim() !== ""))
      : new Set<string>()
  } catch {
    return new Set<string>()
  }
}

async function writeDeletedSessionIds(ids: Set<string>) {
  await atomicWrite(DELETED_SESSIONS_FILE, JSON.stringify([...ids], null, 2))
}

async function markSessionDeleted(sessionId: string) {
  const ids = await readDeletedSessionIds()
  ids.add(sessionId)
  await writeDeletedSessionIds(ids)
}

async function writeMergedSession(session: unknown, expectedId: string) {
  if (!session || typeof session !== "object") {
    throw new Error("session must be an object")
  }

  const sessionId = getSessionId((session as SessionLike).id)
  if (!sessionId || sessionId !== expectedId) {
    throw new Error("session id mismatch")
  }

  if ((await readDeletedSessionIds()).has(sessionId)) {
    return
  }

  const existing = await readExistingSessions()
  const index = existing.findIndex((item: SessionLike) => item?.id === sessionId)
  const nextSessions = index >= 0
    ? existing.map((item: SessionLike, itemIndex: number) => itemIndex === index ? mergeSession(item, session) : item)
    : [...existing, session]

  if (index < 0) {
    await initializeFreecadProgressForSession(sessionId, true)
  }

  await atomicWrite(SESSIONS_FILE, JSON.stringify(nextSessions, null, 2))
}

async function deleteSession(sessionId: string) {
  await markSessionDeleted(sessionId)
  const existing = await readExistingSessions()
  const nextSessions = existing.filter((item: SessionLike) => item?.id !== sessionId)
  await atomicWrite(SESSIONS_FILE, JSON.stringify(nextSessions, null, 2))
}

export async function sessionRoutes(
  fastify: FastifyInstance,
  { logger }: { logger: Logger }
) {
  // GET /api/sessions — 读取所有 sessions
  fastify.get("/api/sessions", async (_req, reply) => {
    try {
      const raw = await fs.readFile(SESSIONS_FILE, "utf-8")
      const data = JSON.parse(raw)
      if (!Array.isArray(data)) return reply.send([])
      const deletedSessionIds = await readDeletedSessionIds()
      return reply.send(data.filter((session: SessionLike) => {
        const id = getSessionId(session?.id)
        return !id || !deletedSessionIds.has(id)
      }))
    } catch {
      return reply.send([])
    }
  })

  // PUT /api/sessions/:id — 增量写入单个 session，避免多客户端整包覆盖
  fastify.put<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
      const sessionId = getSessionId(req.params.id)
      if (!sessionId) {
        return reply.status(400).send({ error: "session id is required" })
      }

      try {
        await writeMergedSession(req.body, sessionId)
        return reply.status(204).send()
      } catch (err) {
        logger.error("session write failed", { err, sessionId })
        return reply.status(400).send({ error: "invalid session payload" })
      }
    }
  )

  // POST /api/sessions/:id — sendBeacon 只能发 POST，语义同单 session 写入
  fastify.post<{ Params: { id: string }; Body: unknown }>(
    "/api/sessions/:id",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req, reply) => {
      const sessionId = getSessionId(req.params.id)
      if (!sessionId) {
        return reply.status(400).send({ error: "session id is required" })
      }

      try {
        await writeMergedSession(req.body, sessionId)
        return reply.status(204).send()
      } catch (err) {
        logger.error("session beacon write failed", { err, sessionId })
        return reply.status(400).send({ error: "invalid session payload" })
      }
    }
  )

  // DELETE /api/sessions/:id — 删除单个 session
  fastify.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    async (req, reply) => {
      const sessionId = getSessionId(req.params.id)
      if (!sessionId) {
        return reply.status(400).send({ error: "session id is required" })
      }

      try {
        await deleteSession(sessionId)
        logger.info("session deleted", { sessionId })
        return reply.status(204).send()
      } catch (err) {
        logger.error("session delete failed", { err, sessionId })
        return reply.status(500).send({ error: "internal error, see backend log" })
      }
    }
  )

  // POST /api/sessions/:id/delete — 某些浏览器/代理环境会拦截 DELETE，提供等价 POST 入口
  fastify.post<{ Params: { id: string } }>(
    "/api/sessions/:id/delete",
    async (req, reply) => {
      const sessionId = getSessionId(req.params.id)
      if (!sessionId) {
        return reply.status(400).send({ error: "session id is required" })
      }

      try {
        await deleteSession(sessionId)
        logger.info("session deleted", { sessionId })
        return reply.status(204).send()
      } catch (err) {
        logger.error("session delete failed", { err, sessionId })
        return reply.status(500).send({ error: "internal error, see backend log" })
      }
    }
  )

  // POST /api/sessions — 覆盖写入所有 sessions（5MB 限制 + 数组校验）
  fastify.post<{ Body: unknown }>(
    "/api/sessions",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) => {
      if (!Array.isArray(req.body)) {
        return reply.status(400).send({ error: "Body must be a JSON array" })
      }
      if ((req.body as unknown[]).length > 1000) {
        return reply.status(400).send({ error: "Too many sessions (max 1000)" })
      }
      try {
        const deletedSessionIds = await readDeletedSessionIds()
        const sessions = req.body.filter((session: SessionLike) => {
          const id = getSessionId(session?.id)
          return !id || !deletedSessionIds.has(id)
        })
        const beforeSessionIds = extractSessionIds(await readExistingSessions())
        const afterSessionIds = extractSessionIds(sessions)
        const newSessionIds = [...afterSessionIds].filter(id => !beforeSessionIds.has(id))
        const removedSessionIds = [...beforeSessionIds].filter(id => !afterSessionIds.has(id))

        for (const sessionId of newSessionIds) {
          await initializeFreecadProgressForSession(sessionId, true)
        }
        if (removedSessionIds.length > 0) {
          const deletedSessionIds = await readDeletedSessionIds()
          removedSessionIds.forEach(id => deletedSessionIds.add(id))
          await writeDeletedSessionIds(deletedSessionIds)
        }
        await atomicWrite(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
        return reply.status(204).send()
      } catch (err) {
        logger.error("sessions write failed", { err })
        return reply.status(500).send({ error: "internal error, see backend log" })
      }
    }
  )
}
