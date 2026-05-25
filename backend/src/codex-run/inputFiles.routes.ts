import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { FastifyInstance } from "fastify"
import type { Logger } from "../logger.js"

const UPLOADABLE_IMAGE_MIME_TYPES = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
])

function sanitizeUploadName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_")
  return base || "image"
}

export function registerInputFilesRoute(fastify: FastifyInstance, logger: Logger) {
  fastify.post("/api/run/input-files", async (req, reply) => {
    const body = req.body as { name?: unknown; mimeType?: unknown; dataBase64?: unknown } | null
    const name = typeof body?.name === "string" ? body.name : "image"
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : ""
    const dataBase64 = typeof body?.dataBase64 === "string" ? body.dataBase64 : ""
    const ext = UPLOADABLE_IMAGE_MIME_TYPES.get(mimeType)

    if (!ext || !dataBase64) {
      return reply.status(400).send({ error: "supported image data is required" })
    }

    const buffer = Buffer.from(dataBase64, "base64")
    if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
      return reply.status(400).send({ error: "image must be between 1 byte and 20 MB" })
    }

    const uploadDir = path.join(os.tmpdir(), "open-codex-web-inputs")
    await fs.mkdir(uploadDir, { recursive: true })
    const uploadPath = path.join(uploadDir, `${Date.now()}-${randomBytes(6).toString("hex")}-${sanitizeUploadName(name)}${ext}`)
    await fs.writeFile(uploadPath, buffer)

    logger.info("codex input image uploaded", { name, mimeType, bytes: buffer.length, path: uploadPath })
    return reply.send({ type: "local_image", path: uploadPath })
  })
}
