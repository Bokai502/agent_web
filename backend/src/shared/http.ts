import type { FastifyReply } from "fastify"

export function sendBadRequest(reply: FastifyReply, message: string) {
  return reply.status(400).send({ error: message })
}

export function getErrorMessage(err: unknown, fallbackMessage: string) {
  return err instanceof Error ? err.message : fallbackMessage
}
