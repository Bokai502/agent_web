import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"
import { getErrorMessage, getString, sendBadRequest } from "../shared/index.js"
import {
  getOrCreateWorkspaceManifest,
  getOrCreateWorkspaceManifestByLocator,
  getWorkspaceManifestSnapshotByLocator,
} from "./store.js"

export function registerWorkspaceManifestRoutes(
  fastify: FastifyInstance,
  logger: Logger,
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
            ? await getWorkspaceManifestSnapshotByLocator({ sessionId, workspaceDir })
            : await getWorkspaceManifestSnapshotByLocator({ sessionId })
        return reply.send(manifest)
      } catch (err) {
        logger.error("manifest read failed", { err, sessionId, workspaceDir })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to read workspace manifest") })
      }
    }
  )

  fastify.get<{ Querystring: { initialize?: string; sessionId?: string; sourceWorkspaceDir?: string; workspaceDir?: string; workspaceKey?: string } }>(
    "/api/workspace-manifest",
    async (req, reply) => {
      const legacySessionId = getString(req.query.sessionId)
      const workspaceKey = getString(req.query.workspaceKey)
      const manifestKey = workspaceKey ?? legacySessionId
      const workspaceDir = getString(req.query.workspaceDir) ?? getString(req.query.sourceWorkspaceDir)
      try {
        const manifest = req.query.initialize === "1" || req.query.initialize === "true"
          ? await getOrCreateWorkspaceManifestByLocator({
              sessionId: manifestKey,
              sourceWorkspaceDir: getString(req.query.sourceWorkspaceDir) ?? workspaceDir,
              workspaceDir,
            })
          : await getWorkspaceManifestSnapshotByLocator({ sessionId: manifestKey, workspaceDir })
        return reply.send(manifest)
      } catch (err) {
        logger.error("manifest read failed", { err, legacySessionId, workspaceDir, workspaceKey })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to read workspace manifest") })
      }
    }
  )

  fastify.get<{ Params: { workspaceId: string }; Querystring: { initialize?: string; sourceWorkspaceDir?: string; workspaceDir?: string } }>(
    "/api/workspace-index/:workspaceId/manifest",
    async (req, reply) => {
      const workspaceId = getString(req.params.workspaceId)
      if (!workspaceId) return sendBadRequest(reply, "workspaceId is required")
      const workspaceDir = getString(req.query.workspaceDir) ?? getString(req.query.sourceWorkspaceDir)
      try {
        const manifest = req.query.initialize === "1" || req.query.initialize === "true"
          ? await getOrCreateWorkspaceManifestByLocator({
              sessionId: workspaceId,
              sourceWorkspaceDir: getString(req.query.sourceWorkspaceDir) ?? workspaceDir,
              workspaceDir,
            })
          : await getWorkspaceManifestSnapshotByLocator({ sessionId: workspaceId, workspaceDir })
        return reply.send(manifest)
      } catch (err) {
        logger.error("workspace index manifest read failed", { err, workspaceId, workspaceDir })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to read workspace manifest") })
      }
    }
  )
}
