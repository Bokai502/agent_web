import { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"

export interface HealthResult {
  ok: boolean
  baseUrl: string
  model: string | null
  latencyMs?: number
  reason?: "auth_failed" | "unreachable" | "bad_status"
  status?: number
  error?: string
}

export async function checkCodexEndpoint(config: AppConfig): Promise<HealthResult> {
  const baseUrl = config.openai.baseUrl.replace(/\/+$/, "")
  const url = `${baseUrl}/models`
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.openai.apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - t0
    if (res.status === 401 || res.status === 403) {
      return { ok: false, baseUrl, model: config.openai.model, latencyMs, reason: "auth_failed", status: res.status }
    }
    if (!res.ok) {
      return { ok: false, baseUrl, model: config.openai.model, latencyMs, reason: "bad_status", status: res.status }
    }
    return { ok: true, baseUrl, model: config.openai.model, latencyMs }
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      model: config.openai.model,
      reason: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function healthRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  fastify.get("/api/health", async (_req, reply) => {
    const result = await checkCodexEndpoint(config)
    if (result.ok) {
      logger.info("health check ok", { latencyMs: result.latencyMs, baseUrl: result.baseUrl })
    } else {
      logger.warn("health check failed", result as unknown as Record<string, unknown>)
    }
    return reply.status(result.ok ? 200 : 503).send(result)
  })
}
