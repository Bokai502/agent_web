import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"
import { getErrorMessage, getObject, getString, sendBadRequest } from "../shared/index.js"
import {
  registerArtifact,
  registerCheckpoint,
  registerExistingArtifacts,
  registerScore,
} from "./store.js"

export function registerRegistrationRoutes(
  fastify: FastifyInstance,
  logger: Logger,
) {
  fastify.post<{ Body: unknown }>("/api/artifacts/register", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await registerArtifact(body))
    } catch (err) {
      logger.error("artifact register failed", { err })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to register artifact") })
    }
  })

  fastify.post<{ Params: { versionId: string }; Body: unknown }>(
    "/api/versions/:versionId/artifacts/register-existing",
    async (req, reply) => {
      const versionId = getString(req.params.versionId)
      const body = getObject(req.body) ?? {}
      if (!versionId) return sendBadRequest(reply, "versionId is required")
      try {
        return reply.send(await registerExistingArtifacts(versionId, body))
      } catch (err) {
        logger.error("existing artifact register failed", { err, versionId })
        return reply.status(400).send({ error: getErrorMessage(err, "failed to register existing artifacts") })
      }
    }
  )

  fastify.post<{ Body: unknown }>("/api/checkpoints/register", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await registerCheckpoint(body))
    } catch (err) {
      logger.error("checkpoint register failed", { err })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to register checkpoint") })
    }
  })

  fastify.post<{ Body: unknown }>("/api/scores/register", async (req, reply) => {
    const body = getObject(req.body) ?? {}
    try {
      return reply.send(await registerScore(body))
    } catch (err) {
      logger.error("score register failed", { err })
      return reply.status(400).send({ error: getErrorMessage(err, "failed to register score") })
    }
  })
}
