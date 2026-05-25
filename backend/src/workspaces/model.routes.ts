import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import { normalizeModelVariant, resolveModel } from "./workspaceRegistry.js"
import {
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
  WorkspaceQueryError,
} from "./workspaceQuery.js"

type ModelQuery = {
  sessionId?: string
  runId?: string
  variant?: string
  glbPath?: string
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

export function registerModelRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: ModelQuery }>(
    "/api/workspace/model",
    async (req, reply) => {
      try {
        const variant = normalizeModelVariant(req.query.variant)
        const workspaceContext = await resolveQueryWorkspaceContext(req.query)
        const workspaceDir = workspaceContext.workspaceDir
        const model = await resolveModel(req.query.sessionId, req.query.runId, variant, req.query.glbPath, workspaceDir)
        if (!model) {
          return reply.status(404).send({ error: "model not found" })
        }

        const modelParams = new URLSearchParams({
          ...(req.query.glbPath ? { glbPath: model.glbPath } : {}),
          ...(model.sessionId ? { sessionId: model.sessionId } : {}),
          ...(model.runId ? { runId: model.runId } : {}),
          ...(workspaceDir ? { workspaceDir } : {}),
          ...(workspaceContext.workspaceId ? { workspaceId: workspaceContext.workspaceId } : {}),
          ...(workspaceContext.versionId ? { versionId: workspaceContext.versionId } : {}),
          variant,
          v: model.version,
        })
        return reply.send({
          ...model,
          modelUrl: `/api/workspace/model/file?${modelParams.toString()}`,
        })
      } catch (err) {
        return replyWithWorkspaceQueryError(reply, err, "failed to resolve workspace model")
      }
    },
  )

  fastify.get<{ Querystring: ModelQuery }>(
    "/api/workspace/model/file",
    async (req, reply) => {
      try {
        const workspaceDir = (await resolveQueryWorkspaceContext(req.query)).workspaceDir
        const model = await resolveModel(
          req.query.sessionId,
          req.query.runId,
          normalizeModelVariant(req.query.variant),
          req.query.glbPath,
          workspaceDir,
        )
        if (!model) {
          return reply.status(404).send({ error: "model not found" })
        }

        const data = await fs.readFile(model.glbPath)
        reply.header("Content-Type", "model/gltf-binary")
        reply.header("Cache-Control", "no-cache")
        return reply.send(data)
      } catch (err) {
        if (err instanceof WorkspaceQueryError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        return reply.status(404).send({ error: "glb file not found" })
      }
    },
  )
}
