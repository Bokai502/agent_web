import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { imageRoutes } from "../artifacts/index.js"
import { taskRoutes } from "../codex-run/index.js"
import { gncConfigRoutes } from "../gnc_config/index.js"
import { manifestRoutes } from "../manifests/index.js"
import { sessionRoutes } from "../sessions/index.js"
import { healthRoutes, skillsRoutes } from "../system/index.js"
import { workspaceRoutes, stageLogsRoutes } from "../workspaces/index.js"

export async function registerApiRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger },
) {
  await fastify.register(taskRoutes, { config, logger })
  await fastify.register(sessionRoutes, { logger })
  await fastify.register(imageRoutes)
  await fastify.register(healthRoutes, { config, logger })
  await fastify.register(skillsRoutes)
  await fastify.register(workspaceRoutes)
  await fastify.register(gncConfigRoutes)
  await fastify.register(manifestRoutes, { logger })
  await fastify.register(stageLogsRoutes)
}
