import { FastifyInstance } from "fastify"
import { readSkillsCache } from "./skills.js"

export async function skillsRoutes(fastify: FastifyInstance) {
  // GET /api/skills — 返回后端启动时扫描到的 skills 列表
  fastify.get("/api/skills", async (_req, reply) => {
    return reply.send(readSkillsCache())
  })
}
