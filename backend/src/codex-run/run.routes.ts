import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { executeCodexTurn, prepareCodexTurn, RunRequestError } from "./codexTurn.js"
import { registerInputFilesRoute } from "./inputFiles.routes.js"
import type { RunRequestBody } from "./runTypes.js"

export async function taskRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  registerInputFilesRoute(fastify, logger)

  fastify.post<{ Body: RunRequestBody }>(
    "/api/run",
    async (req, reply) => {
      let prepared: Awaited<ReturnType<typeof prepareCodexTurn>>
      try {
        prepared = await prepareCodexTurn(req.body, { config, logger, requestId: req.id })
      } catch (err) {
        if (err instanceof RunRequestError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        logger.error("codex run prepare failed", { err, requestId: req.id })
        return reply.status(500).send({ error: "failed to prepare codex run" })
      }

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      })

      const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15000)
      const abort = new AbortController()
      req.raw.socket?.on("close", () => abort.abort())

      try {
        await executeCodexTurn(prepared, {
          signal: abort.signal,
          onClientEvent: event => {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
          },
        })
      } finally {
        clearInterval(ping)
        reply.raw.end()
      }
    }
  )
}
