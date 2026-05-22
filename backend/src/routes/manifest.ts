import { FastifyInstance, FastifyReply } from "fastify"
import {
  branchVersion,
  checkoutVersion,
  commitVersion,
  createRun,
  diffVersions,
  failVersion,
  getRun,
  getOrCreateWorkspaceManifest,
  getOrCreateWorkspaceManifestByLocator,
  getWorkspaceManifestByLocator,
  getWorkspaceManifest,
  getWorkspaceManifestSnapshotByLocator,
  patchRun,
  registerArtifact,
  registerCheckpoint,
  registerExistingArtifacts,
  registerScore,
  retryRun,
  setRunStatus,
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
            ? await getWorkspaceManifestSnapshotByLocator({ sessionId, workspaceDir })
            : await getWorkspaceManifestSnapshotByLocator({ sessionId })
        return reply.send(manifest)
      } catch (err) {
        logger.error("manifest read failed", { err, sessionId, workspaceDir })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to read workspace manifest" })
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
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to read workspace manifest" })
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
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to read workspace manifest" })
      }
    }
  )

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/branch",
    async (req, reply) => {
      const baseVersionId = getString(req.params.versionId)
      const body = getObject(req.body)
      const legacySessionId = getString(body?.sessionId)
      const workspaceId = getString(body?.workspaceId)
      const workspaceKey = getString(body?.workspaceKey)
      const workspaceDir = getString(body?.workspaceDir)
      if (!workspaceId && !workspaceKey && !legacySessionId && !workspaceDir) return sendBadRequest(reply, "workspaceId, workspaceKey or workspaceDir is required")
      if (!baseVersionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await branchVersion({
          baseVersionId,
          label: getString(body?.label),
          sessionId: workspaceId ?? workspaceKey ?? legacySessionId ?? "workspace",
          workspaceDir,
        }))
      } catch (err) {
        logger.error("version branch failed", { err, baseVersionId, legacySessionId, workspaceDir, workspaceId, workspaceKey })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to branch version" })
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
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to checkout version" })
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
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to commit version" })
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
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to fail version" })
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
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to diff versions" })
      }
    }
  )

  fastify.post<{ Body: unknown }>("/api/runs", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await createRun(body))
    } catch (err) {
      logger.error("run create failed", { err })
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to create run" })
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
        return reply.status(404).send({ error: err instanceof Error ? err.message : "failed to read run" })
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
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to patch run" })
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
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to cancel run" })
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
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to retry run" })
    }
  })

  fastify.post<{ Body: unknown }>("/api/artifacts/register", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await registerArtifact(body))
    } catch (err) {
      logger.error("artifact register failed", { err })
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to register artifact" })
    }
  })

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/artifacts/register-existing",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body) ?? {}
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await registerExistingArtifacts(versionId, body))
      } catch (err) {
        logger.error("existing artifact register failed", { err, versionId })
        return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to register existing artifacts" })
      }
    }
  )

  fastify.post<{ Body: unknown }>("/api/checkpoints/register", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await registerCheckpoint(body))
    } catch (err) {
      logger.error("checkpoint register failed", { err })
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to register checkpoint" })
    }
  })

  fastify.post<{ Body: unknown }>("/api/scores/register", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await registerScore(body))
    } catch (err) {
      logger.error("score register failed", { err })
      return reply.status(400).send({ error: err instanceof Error ? err.message : "failed to register score" })
    }
  })
}
