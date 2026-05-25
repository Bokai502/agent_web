import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"
import { getErrorMessage, getObject, getString, sendBadRequest } from "../shared/index.js"
import {
  createRun,
  getRun,
  patchRun,
  retryRun,
  setRunStatus,
} from "./store.js"

export function registerRunRoutes(
  fastify: FastifyInstance,
  logger: Logger,
) {
  fastify.post<{ Body: unknown }>("/api/runs", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await createRun(body))
    } catch (err) {
      logger.error("run create failed", { err })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to create run") })
    }
  })

  fastify.get<{ Params: { runId: string }; Querystring: { workspaceId?: string } }>(
    "/api/runs/:runId",
    async (req, reply) => {
      const runId = getString(req.params.runId)
      const workspaceId = getString(req.query.workspaceId)
      if (!runId) return sendBadRequest(reply, "runId is required")
      if (!workspaceId) return sendBadRequest(reply, "workspaceId is required")
      try {
        return reply.send(await getRun(runId, workspaceId))
      } catch (err) {
        logger.error("run read failed", { err, runId, workspaceId })
        return reply.status(404).send({ error: getErrorMessage(err, "failed to read run") })
      }
    }
  )

  fastify.patch<{ Params: { runId: string }; Body: unknown }>("/api/runs/:runId", async (req, reply) => {
    const runId = getString(req.params.runId)
    const body = getObject(req.body) ?? {}
    if (!runId) return sendBadRequest(reply, "runId is required")
    try {
      return reply.send(await patchRun(runId, body))
    } catch (err) {
      logger.error("run patch failed", { err, runId })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to patch run") })
    }
  })

  fastify.post<{ Params: { runId: string }; Body: unknown }>("/api/runs/:runId/cancel", async (req, reply) => {
    const runId = getString(req.params.runId)
    const body = getObject(req.body) ?? {}
    if (!runId) return sendBadRequest(reply, "runId is required")
    try {
      return reply.send(await setRunStatus(runId, body, "cancelled"))
    } catch (err) {
      logger.error("run cancel failed", { err, runId })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to cancel run") })
    }
  })

  fastify.post<{ Params: { runId: string }; Body: unknown }>("/api/runs/:runId/retry", async (req, reply) => {
    const runId = getString(req.params.runId)
    const body = getObject(req.body) ?? {}
    if (!runId) return sendBadRequest(reply, "runId is required")
    try {
      return reply.send(await retryRun(runId, body))
    } catch (err) {
      logger.error("run retry failed", { err, runId })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to retry run") })
    }
  })
}
