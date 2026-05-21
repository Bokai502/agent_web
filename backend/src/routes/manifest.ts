import { FastifyInstance, FastifyReply } from "fastify"
import {
  branchVersion,
  checkoutVersion,
  getOrCreateWorkspaceManifest,
  getOrCreateWorkspaceManifestByLocator,
  getWorkspaceManifestByLocator,
  getWorkspaceManifest,
} from "../manifest/store.js"
import type { Logger } from "../logger.js"

function getString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function sendBadRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: message })
}

export async function manifestRoutes(
  fastify: FastifyInstance,
  { logger }: { logger: Logger }
) {
  fastify.get<{ Params: { sessionId: string }; Querystring: { initialize?: string; sourceWorkspaceDir?: string; workspaceDir?: string } }>(
    "/api/workspaces/:sessionId/manifest",
    async (req, reply) => {
      const sessionId = getString(req.params.sessionId)
      if (!sessionId) return sendBadRequest(reply, "sessionId is required")
      const workspaceDir = getString(req.query.workspaceDir) ?? getString(req.query.sourceWorkspaceDir)
      try {
        const manifest = req.query.initialize === "1" || req.query.initialize === "true"
          ? workspaceDir
            ? await getOrCreateWorkspaceManifestByLocator({
                sessionId,
                sourceWorkspaceDir: getString(req.query.sourceWorkspaceDir) ?? workspaceDir,
                workspaceDir,
              })
            : await getOrCreateWorkspaceManifest(sessionId, { sourceWorkspaceDir: getString(req.query.sourceWorkspaceDir) })
          : workspaceDir
            ? await getWorkspaceManifestByLocator({ sessionId, workspaceDir })
            : await getWorkspaceManifest(sessionId)
        return reply.send(manifest)
      } catch (err) {
        logger.error("manifest read failed", { err, sessionId, workspaceDir })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to read workspace manifest" })
      }
    }
  )

  fastify.get<{ Querystring: { initialize?: string; sessionId?: string; sourceWorkspaceDir?: string; workspaceDir?: string } }>(
    "/api/workspace-manifest",
    async (req, reply) => {
      const sessionId = getString(req.query.sessionId)
      const workspaceDir = getString(req.query.workspaceDir) ?? getString(req.query.sourceWorkspaceDir)
      try {
        const manifest = req.query.initialize === "1" || req.query.initialize === "true"
          ? await getOrCreateWorkspaceManifestByLocator({
              sessionId,
              sourceWorkspaceDir: getString(req.query.sourceWorkspaceDir) ?? workspaceDir,
              workspaceDir,
            })
          : await getWorkspaceManifestByLocator({ sessionId, workspaceDir })
        return reply.send(manifest)
      } catch (err) {
        logger.error("manifest read failed", { err, sessionId, workspaceDir })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to read workspace manifest" })
      }
    }
  )

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/branch",
    async (req, reply) => {
      const baseVersionId = getString(req.params.versionId)
      const body = getObject(req.body)
      const sessionId = getString(body?.sessionId)
      const workspaceDir = getString(body?.workspaceDir)
      if (!sessionId) return sendBadRequest(reply, "sessionId is required")
      if (!baseVersionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await branchVersion({
          baseVersionId,
          label: getString(body?.label),
          sessionId,
          workspaceDir,
        }))
      } catch (err) {
        logger.error("version branch failed", { err, sessionId, baseVersionId, workspaceDir })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to branch version" })
      }
    }
  )

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/checkout",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body)
      const sessionId = getString(body?.sessionId)
      const workspaceDir = getString(body?.workspaceDir)
      if (!sessionId) return sendBadRequest(reply, "sessionId is required")
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await checkoutVersion(sessionId, versionId, workspaceDir))
      } catch (err) {
        logger.error("version checkout failed", { err, sessionId, versionId, workspaceDir })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to checkout version" })
      }
    }
  )
}
