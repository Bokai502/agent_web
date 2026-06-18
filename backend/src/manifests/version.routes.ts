import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"
import { getErrorMessage, getObject, getString, sendBadRequest } from "../shared/index.js"
import {
  branchVersion,
  checkoutVersion,
  commitVersion,
  deleteVersion,
  diffVersions,
  failVersion,
} from "./store.js"

export function registerVersionRoutes(
  fastify: FastifyInstance,
  logger: Logger,
) {
  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/branch",
    async (req, reply) => {
      const baseVersionId = getString(req.params.versionId)
      const body = getObject(req.body)
      const legacySessionId = getString(body?.sessionId)
      const workspaceId = getString(body?.workspaceId)
      const workspaceKey = getString(body?.workspaceKey)
      const workspaceDir = getString(body?.workspaceDir)
      const group = getString(body?.group)
      if (!workspaceId && !workspaceKey && !legacySessionId && !workspaceDir) return sendBadRequest(reply, "workspaceId, workspaceKey or workspaceDir is required")
      if (!baseVersionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await branchVersion({
          baseVersionId,
          group,
          label: getString(body?.label),
          parentVersionId: Object.prototype.hasOwnProperty.call(body ?? {}, "parentVersionId") ? getString(body?.parentVersionId) : undefined,
          sessionId: workspaceId ?? workspaceKey ?? legacySessionId ?? "workspace",
          workspaceDir,
        }))
      } catch (err) {
        logger.error("version branch failed", { err, baseVersionId, legacySessionId, workspaceDir, workspaceId, workspaceKey })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to branch version") })
      }
    }
  )

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/checkout",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body)
      const legacySessionId = getString(body?.sessionId)
      const workspaceId = getString(body?.workspaceId)
      const workspaceKey = getString(body?.workspaceKey)
      const workspaceDir = getString(body?.workspaceDir)
      if (!workspaceId && !workspaceKey && !legacySessionId && !workspaceDir) return sendBadRequest(reply, "workspaceId, workspaceKey or workspaceDir is required")
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await checkoutVersion(workspaceId ?? workspaceKey ?? legacySessionId ?? "workspace", versionId, workspaceDir))
      } catch (err) {
        logger.error("version checkout failed", { err, legacySessionId, versionId, workspaceDir, workspaceId, workspaceKey })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to checkout version") })
      }
    }
  )

  fastify.delete<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body)
      const legacySessionId = getString(body?.sessionId)
      const workspaceId = getString(body?.workspaceId)
      const workspaceKey = getString(body?.workspaceKey)
      const workspaceDir = getString(body?.workspaceDir)
      if (!workspaceId && !workspaceKey && !legacySessionId && !workspaceDir) return sendBadRequest(reply, "workspaceId, workspaceKey or workspaceDir is required")
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await deleteVersion(versionId, {
          sessionId: workspaceId ?? workspaceKey ?? legacySessionId ?? "workspace",
          workspaceDir,
        }))
      } catch (err) {
        logger.error("version delete failed", { err, legacySessionId, versionId, workspaceDir, workspaceId, workspaceKey })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to delete version") })
      }
    }
  )

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/commit",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body) ?? {}
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await commitVersion(versionId, body))
      } catch (err) {
        logger.error("version commit failed", { err, versionId })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to commit version") })
      }
    }
  )

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/fail",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body) ?? {}
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await failVersion(versionId, body))
      } catch (err) {
        logger.error("version fail failed", { err, versionId })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to fail version") })
      }
    }
  )

  fastify.get<{ Params: { a: string; b: string }; Querystring: { workspaceId?: string } }>(
    "/api/versions/:a/diff/:b",
    async (req, reply) => {
      const a = getString(req.params.a)
      const b = getString(req.params.b)
      const workspaceId = getString(req.query.workspaceId)
      if (!a || !b) return sendBadRequest(reply, "version ids are required")
      if (!workspaceId) return sendBadRequest(reply, "workspaceId is required")
      try {
        return reply.send(await diffVersions(a, b, workspaceId))
      } catch (err) {
        logger.error("version diff failed", { err, a, b, workspaceId })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to diff versions") })
      }
    }
  )
}
