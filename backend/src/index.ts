import Fastify from "fastify"
import cors from "@fastify/cors"
import path from "node:path"
import { loadConfig } from "./config.js"
import { createLogger } from "./logger.js"
import { resolveRequestUser } from "./server/auth.js"
import { registerApiRoutes } from "./server/routes.js"
import { enterRequestContext } from "./server/requestContext.js"
import { checkCodexEndpoint, refreshSkillsCache } from "./system/index.js"

const config = loadConfig()
const logger = createLogger(config.logging)
const GNC_WORKSPACE_ROOT = "/data/lbk/codex_web/data/input_data"
const REGION_WORKSPACE_ROOT = "/data/lbk/codex_web/data_jiange"
const DEFAULT_WORKSPACE_ROOT = "/data/lbk/codex_web/data/input_data"

logger.info("backend starting", {
  baseUrl: config.openai.baseUrl,
  model: config.openai.model,
  port: config.server.port,
})

// 启动时扫描 ~/.codex/skills 并缓存到 skills.json
refreshSkillsCache(logger)

const fastify = Fastify({
  logger: {
    level: config.logging.level,
    stream: logger.stream,
  },
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
  const isGncRequest = originalUrl?.startsWith("/api/gnc/") === true
  const isRegionRequest = originalUrl?.startsWith("/api/region/") === true
  const baseWorkspaceRoot = isRegionRequest ? REGION_WORKSPACE_ROOT : isGncRequest ? GNC_WORKSPACE_ROOT : DEFAULT_WORKSPACE_ROOT
  const user = resolveRequestUser(request, config, baseWorkspaceRoot)
  if (config.auth.enabled && !user.authenticated && !isAuthRequest) {
    throw Object.assign(new Error("authentication required"), { statusCode: 401 })
  }
  const workspaceRootOverride = path.resolve(user.workspaceRoot)

  enterRequestContext({
    userId: user.userId,
    userWorkspaceRoot: workspaceRootOverride,
    isGncRequest: isGncRequest || isRegionRequest,
    workspaceRootOverride,
  })
})

await fastify.register(cors, {
  origin: config.server.corsOrigin,
  methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"],
})
await registerApiRoutes(fastify, { config, logger })

// 启动时做一次连接自检（不阻塞启动）
void checkCodexEndpoint(config).then(result => {
  if (result.ok) {
    logger.info("codex endpoint reachable", { latencyMs: result.latencyMs, baseUrl: result.baseUrl })
  } else {
    logger.error("startup connectivity check failed", result as unknown as Record<string, unknown>)
  }
})

try {
  await fastify.listen({ port: config.server.port, host: config.server.host })
  logger.info(`backend running on http://localhost:${config.server.port}`)
} catch (err) {
  logger.error("fastify listen failed", { err })
  process.exit(1)
}
