import { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"
import { initializeWorkspaceProgressForSession } from "../workspaces/workspaceProgressInit.js"
import {
  findWorkspaceSession,
  readAllWorkspaceSessionHistories,
  removeWorkspaceSessionHistoryById,
  replaceWorkspaceSessionHistories,
  upsertWorkspaceSessionHistory,
} from "./sessionStore.js"

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

function getEventCount(value: unknown) {
  if (!value || typeof value !== "object") return 0
  const events = (value as { events?: unknown }).events
  return Array.isArray(events) ? events.length : 0
}

function mergeTurn(existing: unknown, incoming: unknown) {
  if (!existing || typeof existing !== "object") return incoming
  if (!incoming || typeof incoming !== "object") return existing
  return getEventCount(incoming) >= getEventCount(existing) ? incoming : existing
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

    result[existingIndex] = mergeTurn(result[existingIndex], turn)
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

async function writeMergedSession(session: unknown, expectedId: string) {
  if (!session || typeof session !== "object") {
    throw new Error("session must be an object")
  }

  const sessionId = getSessionId((session as SessionLike).id)
  if (!sessionId || sessionId !== expectedId) {
    throw new Error("session id mismatch")
  }

  const existing = await findWorkspaceSession(sessionId, (session as SessionLike).workspaceDir)
  const nextSession = existing ? mergeSession(existing, session) : session

  if (!existing) {
    await initializeWorkspaceProgressForSession(sessionId, true)
  }

  await upsertWorkspaceSessionHistory(nextSession as SessionLike)
}

async function deleteSession(sessionId: string) {
  await removeWorkspaceSessionHistoryById(sessionId)
}

export async function sessionRoutes(
  fastify: FastifyInstance,
  { logger }: { logger: Logger }
) {
  // GET /api/sessions — 读取所有 sessions
  fastify.get("/api/sessions", async (_req, reply) => {
    try {
      return reply.send(await readAllWorkspaceSessionHistories())
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
        const sessions = req.body.filter((session: SessionLike) => getSessionId(session?.id))
        const existingSessionIds = new Set((await readAllWorkspaceSessionHistories()).map((session: SessionLike) => getSessionId(session?.id)).filter((id): id is string => !!id))

        for (const session of sessions) {
          const sessionId = getSessionId((session as SessionLike).id)
          if (!sessionId || existingSessionIds.has(sessionId)) continue
          await initializeWorkspaceProgressForSession(sessionId, true)
        }
        await replaceWorkspaceSessionHistories(sessions)
        return reply.status(204).send()
      } catch (err) {
        logger.error("sessions write failed", { err })
        return reply.status(500).send({ error: "internal error, see backend log" })
      }
    }
  )
}
