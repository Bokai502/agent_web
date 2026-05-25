import { FastifyInstance } from "fastify"
import fs from "fs/promises"
import path from "path"
import { resolveProgressFromLatestSessionRun } from "./workspaceRegistry.js"
import { resolveScopedWorkspaceFilePath } from "./workspaceFiles.js"
import {
  isNonEmptyString,
  replyWithWorkspaceQueryError,
  resolveQueryWorkspaceContext,
  resolveQueryWorkspaceDir,
  WorkspaceQueryError,
} from "./workspaceQuery.js"

type WorkspaceQuery = {
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

type WorkspaceProgressQuery = WorkspaceQuery & {
  sessionId?: string
}

type WorkspaceProgressData = {
  data: unknown
  sourcePath: string
  sourceVersion: string
  updatedAt: string
}

const DEFAULT_GEOM_COMPONENT_INFO_RELATIVE_PATH = path.join("component_info", "geom_component_info.json")
const DEFAULT_BOM_INFO_RELATIVE_PATH = path.join("00_inputs", "bom_component_info.json")
const DEFAULT_REAL_BOM_RELATIVE_PATH = path.join("00_inputs", "real_bom.json")
const DEFAULT_PROGRESS_RELATIVE_PATH = path.join("logs", "progress.json")
const DEFAULT_TEMPERATURE_FIELD_RELATIVE_PATH = path.join("02_sim", "postprocess", "temperature_field_threejs.json")

async function readWorkspaceProgress(progressPath: string): Promise<WorkspaceProgressData | null> {
  const raw = await fs.readFile(progressPath, "utf-8").catch(() => null)
  if (raw === null) return null

  const stat = await fs.stat(progressPath)
  return {
    data: JSON.parse(raw) as unknown,
    sourcePath: progressPath,
    sourceVersion: [progressPath, stat.mtimeMs, stat.size].join(":"),
    updatedAt: stat.mtime.toISOString(),
  }
}

export function registerWorkspaceDataRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/component-info", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const componentInfoPath = path.join(workspaceDir, DEFAULT_GEOM_COMPONENT_INFO_RELATIVE_PATH)
      const raw = await fs.readFile(componentInfoPath, "utf-8").catch(() => null)

      if (raw === null) {
        return reply.status(404).send({ error: "component info data not found" })
      }

      const stat = await fs.stat(componentInfoPath)

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...JSON.parse(raw),
        source_path: componentInfoPath,
        source_version: [componentInfoPath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve component info data")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>("/api/workspace/bom", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const candidatePaths = [
        path.join(workspaceDir, DEFAULT_BOM_INFO_RELATIVE_PATH),
        path.join(workspaceDir, DEFAULT_REAL_BOM_RELATIVE_PATH),
      ]

      let bomInfoPath: string | null = null
      let raw: string | null = null
      for (const candidatePath of candidatePaths) {
        raw = await fs.readFile(candidatePath, "utf-8").catch(() => null)
        if (raw !== null) {
          bomInfoPath = candidatePath
          break
        }
      }

      if (!bomInfoPath || raw === null) {
        return reply.status(404).send({ error: "BOM data not found" })
      }

      const stat = await fs.stat(bomInfoPath)

      reply.header("Cache-Control", "no-cache")
      return reply.send({
        ...JSON.parse(raw),
        source_path: bomInfoPath,
        source_version: [bomInfoPath, stat.mtimeMs, stat.size].join(":"),
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve BOM data")
    }
  })

  fastify.get<{ Querystring: WorkspaceProgressQuery }>("/api/workspace/progress", async (req, reply) => {
    try {
      const workspaceDir = await resolveQueryWorkspaceDir(req.query)
      const progressPath = path.join(workspaceDir, DEFAULT_PROGRESS_RELATIVE_PATH)

      let workspaceProgress: WorkspaceProgressData | null = null
      try {
        workspaceProgress = await readWorkspaceProgress(progressPath)
      } catch {
        const stat = await fs.stat(progressPath).catch(() => null)
        reply.header("Cache-Control", "no-cache")
        return reply.send({
          exists: false,
          data: null,
          error: "progress json is not valid yet",
          source_path: progressPath,
          source_version: stat ? [progressPath, stat.mtimeMs, stat.size].join(":") : null,
          updated_at: stat?.mtime.toISOString() ?? null,
        })
      }

      reply.header("Cache-Control", "no-cache")
      if (!workspaceProgress) {
        if (isNonEmptyString(req.query.sessionId)) {
          const sessionProgress = await resolveProgressFromLatestSessionRun(req.query.sessionId, workspaceDir)
          if (sessionProgress) {
            return reply.send({
              exists: true,
              data: sessionProgress.data,
              source_path: sessionProgress.sourcePath,
              source_version: sessionProgress.sourceVersion,
            })
          }
        }
        return reply.send({
          exists: false,
          data: null,
          source_path: progressPath,
          source_version: null,
        })
      }

      return reply.send({
        exists: true,
        data: workspaceProgress.data,
        source_path: workspaceProgress.sourcePath,
        source_version: workspaceProgress.sourceVersion,
        updated_at: workspaceProgress.updatedAt,
      })
    } catch (err) {
      return replyWithWorkspaceQueryError(reply, err, "failed to resolve workspace progress data")
    }
  })

  fastify.get<{ Querystring: WorkspaceQuery }>(
    "/api/workspace/temperature-field",
    async (req, reply) => {
      try {
        const workspaceDir = (await resolveQueryWorkspaceContext(req.query)).workspaceDir
        const fieldPath = resolveScopedWorkspaceFilePath(DEFAULT_TEMPERATURE_FIELD_RELATIVE_PATH, workspaceDir)
        if (!fieldPath) {
          return reply.status(404).send({ error: "temperature field not found" })
        }

        const data = JSON.parse(await fs.readFile(fieldPath, "utf-8")) as unknown
        reply.header("Content-Type", "application/json; charset=utf-8")
        reply.header("Cache-Control", "no-cache")
        return reply.send(data)
      } catch (err) {
        if (err instanceof WorkspaceQueryError) {
          return reply.status(err.statusCode).send({ error: err.message })
        }
        return reply.status(404).send({ error: "temperature field not found" })
      }
    },
  )
}
