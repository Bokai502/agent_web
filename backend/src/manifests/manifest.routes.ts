import { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"
import { registerRegistrationRoutes } from "./registration.routes.js"
import { registerRunRoutes } from "./run.routes.js"
import { registerVersionRoutes } from "./version.routes.js"
import { registerWorkspaceManifestRoutes } from "./workspaceManifest.routes.js"

export async function manifestRoutes(
  fastify: FastifyInstance,
  { logger }: { logger: Logger }
) {
  registerWorkspaceManifestRoutes(fastify, logger)
  registerVersionRoutes(fastify, logger)
  registerRunRoutes(fastify, logger)
  registerRegistrationRoutes(fastify, logger)
}
