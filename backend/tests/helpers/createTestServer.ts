import Fastify from "fastify"
import cors from "@fastify/cors"
import path from "node:path"
import type { AppConfig } from "../../src/config.js"
import type { Logger } from "../../src/logger.js"
import { registerApiRoutes } from "../../src/server/routes.js"
import { resolveRequestUser } from "../../src/server/auth.js"
import { enterRequestContext } from "../../src/server/requestContext.js"
import { resolveWorkspaceTemplateRoot } from "../../src/workspaces/workspacePaths.js"
import { createTestConfig } from "./testConfig.js"
import { createTestLogger } from "./testLogger.js"

export async function createTestServer({
  config = createTestConfig(),
  logger = createTestLogger(),
}: {
  config?: AppConfig
  logger?: Logger
} = {}) {
  const configuredWorkspaceRoot = resolveWorkspaceTemplateRoot(config)
  const fastify = Fastify({
    logger: false,
    rewriteUrl(request) {
      const url = request.url ?? "/"
      if (url.startsWith("/api/gnc/")) return `/api/${url.slice("/api/gnc/".length)}`
      if (url.startsWith("/api/region/")) return `/api/${url.slice("/api/region/".length)}`
      return url
    },
  })

  fastify.addHook("onRequest", async (request) => {
    const originalUrl = request.originalUrl ?? request.raw.url ?? request.url
    const isAuthRequest = originalUrl?.startsWith("/api/auth/") === true
    const isInternalCodexRequest = originalUrl?.startsWith("/internal/codex/") === true
    const isGncRequest = originalUrl?.startsWith("/api/gnc/") === true
    const isRegionRequest = originalUrl?.startsWith("/api/region/") === true
    const user = resolveRequestUser(request, config, configuredWorkspaceRoot)
    if (config.auth.enabled && !user.authenticated && !isAuthRequest && !isInternalCodexRequest) {
      throw Object.assign(new Error("authentication required"), { statusCode: 401 })
    }

    enterRequestContext({
      isGncRequest: isGncRequest || isRegionRequest,
      userId: user.userId,
      userWorkspaceRoot: user.workspaceRoot,
      workspaceRootOverride: path.resolve(user.workspaceRoot),
    })
  })

  await fastify.register(cors, {
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
    origin: config.server.corsOrigin,
  })
  await registerApiRoutes(fastify, { config, logger })
  await fastify.ready()

  return fastify
}
