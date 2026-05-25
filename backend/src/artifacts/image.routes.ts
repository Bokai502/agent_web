import { FastifyInstance } from "fastify"
import fs from "fs"
import path from "path"

const ALLOWED_EXTS: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
}

export async function imageRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { path: string } }>("/api/image", async (req, reply) => {
    const filePath = req.query.path
    if (!filePath || typeof filePath !== "string") {
      return reply.status(400).send({ error: "path is required" })
    }

    const ext = path.extname(filePath).toLowerCase()
    const mime = ALLOWED_EXTS[ext]
    if (!mime) {
      return reply.status(400).send({ error: "unsupported file type" })
    }

    try {
      const data = await fs.promises.readFile(filePath)
      reply.header("Content-Type", mime)
      reply.header("Cache-Control", "public, max-age=3600")
      return reply.send(data)
    } catch {
      return reply.status(404).send({ error: "file not found" })
    }
  })
}
