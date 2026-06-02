import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { getManagedRunEvents, getManagedRunStatus, runAgentTurn, subscribeManagedRunStatus, type ManagedRunEvent } from "./agentOrchestrator.js"
import { RunRequestError } from "./codexTurn.js"
import type { RunRequestBody } from "./runTypes.js"

export async function managedRunRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger }
) {
  fastify.get<{ Params: { managedRunId: string } }>("/api/run/managed/status/:managedRunId", async (req, reply) => {
    const status = await getManagedRunStatus(req.params.managedRunId)
    if (!status) return reply.status(404).send({ error: "managed run not found" })
    return reply.send(status)
  })

  fastify.get<{ Params: { managedRunId: string } }>("/api/run/managed/events/:managedRunId", async (req, reply) => {
    const managedRunId = req.params.managedRunId
    let closed = false
    let unsubscribe = () => {}
    let ping: ReturnType<typeof setInterval> | null = null
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })

    const close = () => {
      if (closed) return
      closed = true
      if (ping) clearInterval(ping)
      unsubscribe()
      reply.raw.end()
    }

    const writeEvent = (event: ManagedRunEvent) => {
      if (closed) return
      reply.raw.write(`event: ${event.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      if ((event.type === "final" || event.type === "failed") || (event.type === "status" && event.status.status !== "running")) close()
    }

    unsubscribe = subscribeManagedRunStatus(managedRunId, writeEvent)
    ping = setInterval(() => reply.raw.write(": ping\n\n"), 15000)
    for (const event of getManagedRunEvents(managedRunId)) writeEvent(event)
    const existing = await getManagedRunStatus(managedRunId)
    if (existing) writeEvent({ type: "status", managedRunId, status: existing })
    req.raw.socket?.on("close", close)
  })

  fastify.post<{ Body: RunRequestBody }>("/api/run/managed/dispatch", async (req, reply) => {
    try {
      return reply.send(await runAgentTurn({
        body: req.body,
        inputType: "text",
      }, {
        config,
        logger,
        requestId: String(req.id),
      }))
    } catch (err) {
      if (err instanceof RunRequestError) return reply.status(err.statusCode).send({ error: err.message })
      logger.error("managed dispatch failed", { err, requestId: req.id })
      return reply.status(500).send({ error: "failed to dispatch managed run" })
    }
  })
}
