import Fastify from "fastify"
import cors from "@fastify/cors"
import { loadConfig } from "./config.js"
import { createLogger } from "./logger.js"
import { registerApiRoutes } from "./server/routes.js"
import { checkCodexEndpoint, refreshSkillsCache } from "./system/index.js"

const config = loadConfig()
const logger = createLogger(config.logging)

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
