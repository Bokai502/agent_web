import { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import {
  listWorkspaces,
  setWorkspace,
} from "./workspaceManager.js"
import { registerModelRoutes } from "./model.routes.js"
import { registerWorkspaceDataRoutes } from "./workspaceData.routes.js"
import { registerWorkspaceUploadRoutes } from "./workspaceUpload.routes.js"
import { registerDeratingConfigRoutes } from "./deratingConfig.routes.js"

export async function workspaceRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get("/api/workspace/workspaces", async (_req, reply) => {
    try {
      reply.header("Cache-Control", "no-cache")
      return reply.send(await listWorkspaces())
    } catch {
      return reply.status(500).send({ error: "failed to list workspaces" })
    }
  })

  fastify.post<{ Body: { name?: unknown } }>("/api/workspace/workspace", async (req, reply) => {
    try {
      reply.header("Cache-Control", "no-cache")
      return reply.send(await setWorkspace(req.body?.name))
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed to set workspace"
      return reply.status(400).send({ error: message })
    }
  })

  registerWorkspaceDataRoutes(fastify, { config })
  await registerDeratingConfigRoutes(fastify, { config })
  await registerWorkspaceUploadRoutes(fastify)
  registerModelRoutes(fastify)
}
