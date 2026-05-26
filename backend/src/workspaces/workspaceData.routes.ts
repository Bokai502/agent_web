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
const DEFAULT_TEMPERATURE_FIELD_RELATIVE_PATH = path.join("02_sim", "simulation", "data1.txt")

type TemperaturePoint = {
  temperature: number
  x: number
  y: number
  z: number
}

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

function parseComsolTemperatureData(data: string, sourcePath: string) {
  const points: TemperaturePoint[] = []

  for (const line of data.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("%")) continue

    const values = trimmed.split(/[,\s]+/u).map((token) => Number.parseFloat(token))
    if (values.length < 4 || values.slice(0, 4).some((value) => !Number.isFinite(value))) {
      continue
    }

    points.push({
      x: values[0],
      y: values[1],
      z: values[2],
      temperature: values[3],
    })
  }

  if (points.length === 0) {
    throw new Error("temperature field has no finite COMSOL samples")
  }

  const tempMin = Math.min(...points.map((point) => point.temperature))
  const tempMax = Math.max(...points.map((point) => point.temperature))

  return {
    schema_version: "1.0",
    format: "threejs_temperature_point_cloud",
    source: {
      comsol_data: sourcePath,
      temperature_array: "T",
    },
    units: {
      position: "m",
      temperature: "K",
    },
    point_count: points.length,
    bounds: {
      min: [
        Math.min(...points.map((point) => point.x)),
        Math.min(...points.map((point) => point.y)),
        Math.min(...points.map((point) => point.z)),
      ],
      max: [
        Math.max(...points.map((point) => point.x)),
        Math.max(...points.map((point) => point.y)),
        Math.max(...points.map((point) => point.z)),
      ],
    },
    temperature_range_K: {
      min: tempMin,
      max: tempMax,
    },
    attributes: {
      position: points.flatMap((point) => [point.x, point.y, point.z]),
      temperature_K: points.map((point) => point.temperature),
      color_rgb: points.flatMap((point) => temperatureColor(point.temperature, tempMin, tempMax)),
    },
    threejs_hint: {
      geometry: "THREE.BufferGeometry",
      position_attribute: "position",
      color_attribute: "color_rgb",
      temperature_attribute: "temperature_K",
      material: "THREE.PointsMaterial({ vertexColors: true })",
    },
  }
}

function temperatureColor(temperature: number, tempMin: number, tempMax: number) {
  const value = tempMax <= tempMin
    ? 0
    : Math.max(0, Math.min(1, (temperature - tempMin) / (tempMax - tempMin)))
  if (value < 0.5) {
    const t = value / 0.5
    return [0, t, 1 - t]
  }
  const t = (value - 0.5) / 0.5
  return [t, 1 - t, 0]
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

        const data = parseComsolTemperatureData(await fs.readFile(fieldPath, "utf-8"), fieldPath)
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
