import type { FastifyInstance } from "fastify"
import fs from "node:fs/promises"
import path from "node:path"
import type { AppConfig } from "../config.js"
import { buildUserCookie, resolveUsersRoot, sanitizeUserId } from "../server/auth.js"
import { getRequestUserId, getRequestWorkspaceRootOverride } from "../server/requestContext.js"
import { resolveWorkspaceTemplateRoot } from "../workspaces/workspacePaths.js"

type SwitchUserBody = {
  userId?: unknown
}

type UserSeedStatus = {
  copied: boolean
  name: string
  reason?: string
}

type WorkspaceSeedStatus = UserSeedStatus & {
  workspaceId: string
}

const USER_TEMPLATE_DIRS = [
  { name: "derating", sessionId: "derating", workspaceId: "ws_derating" },
  { name: "gnc", sessionId: "gnc", workspaceId: "ws_gnc" },
  { name: "thermal", sessionId: "thermal", workspaceId: "ws_thermal" },
  { name: "thermal_catch", sessionId: "thermal_catch", workspaceId: "ws_thermal_catch" },
] as const

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function readJsonObject(filePath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

async function writeJsonObject(filePath: string, value: Record<string, unknown>) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
  await fs.rename(tmpPath, filePath)
}

async function seedUserWorkspaceVersions(inputDataRoot: string, usersRoot: string, userId: string): Promise<WorkspaceSeedStatus[]> {
  const userRoot = path.join(usersRoot, userId)
  const statuses: WorkspaceSeedStatus[] = []
  await fs.mkdir(userRoot, { recursive: true })

  for (const { name, sessionId, workspaceId } of USER_TEMPLATE_DIRS) {
    const source = path.join(inputDataRoot, name)
    const workspaceRoot = path.join(userRoot, "workspaces", workspaceId)
    const versionDir = path.join(workspaceRoot, "versions", "v0001")
    const manifestPath = path.join(workspaceRoot, "workspace_manifest.json")

    if (!await pathExists(source)) {
      statuses.push({ copied: false, name, reason: "template-missing", workspaceId })
      continue
    }

    const versionExists = await pathExists(versionDir)
    if (!versionExists) {
      await fs.mkdir(path.dirname(versionDir), { recursive: true })
      await fs.cp(source, versionDir, {
        errorOnExist: true,
        force: false,
        preserveTimestamps: true,
        recursive: true,
      })
    }

    const now = new Date().toISOString()
    const manifest = await readJsonObject(manifestPath) ?? {
      artifacts: [],
      checkpoints: [],
      createdAt: now,
      runs: [],
      scores: [],
      schemaVersion: "1.0",
      sessionId,
      versions: [],
      workspaceId,
    }
    const versions = Array.isArray(manifest.versions)
      ? manifest.versions.filter(item => item && typeof item === "object") as Record<string, unknown>[]
      : []
    const existingVersion = versions.find(version => version.id === "v0001")
    if (existingVersion) {
      existingVersion.status = existingVersion.status ?? "active"
      existingVersion.workspaceDir = versionDir
      existingVersion.updatedAt = existingVersion.updatedAt ?? now
    } else {
      versions.push({
        createdAt: now,
        id: "v0001",
        label: "Initial import",
        parentVersionId: null,
        status: "active",
        updatedAt: now,
        workspaceDir: versionDir,
      })
    }

    await writeJsonObject(manifestPath, {
      ...manifest,
      activeVersionId: typeof manifest.activeVersionId === "string" ? manifest.activeVersionId : "v0001",
      artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts : [],
      checkpoints: Array.isArray(manifest.checkpoints) ? manifest.checkpoints : [],
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : now,
      rootDir: workspaceRoot,
      runs: Array.isArray(manifest.runs) ? manifest.runs : [],
      scores: Array.isArray(manifest.scores) ? manifest.scores : [],
      schemaVersion: "1.0",
      sessionId: typeof manifest.sessionId === "string" ? manifest.sessionId : sessionId,
      updatedAt: now,
      versions,
      workspaceId,
    })

    statuses.push({
      copied: !versionExists,
      name,
      reason: versionExists ? "already-exists" : undefined,
      workspaceId,
    })
  }

  return statuses
}

export async function authRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  const inputDataRoot = resolveWorkspaceTemplateRoot(config)
  const usersRoot = resolveUsersRoot(config)

  fastify.get("/api/auth/me", async (_req, reply) => {
    return reply.send({
      authEnabled: config.auth.enabled,
      cookieName: config.auth.cookieName,
      userId: getRequestUserId() ?? sanitizeUserId(config.auth.devUserId, "default"),
      workspaceRoot: getRequestWorkspaceRootOverride(),
    })
  })

  fastify.post<{ Body: SwitchUserBody }>("/api/auth/user", async (req, reply) => {
    if (config.auth.enabled) {
      return reply.status(403).send({ error: "user switching is disabled when auth is enabled" })
    }
    const rawUserId = typeof req.body?.userId === "string" ? req.body.userId : null
    const userId = sanitizeUserId(rawUserId, config.auth.devUserId)
    const workspaces = await seedUserWorkspaceVersions(inputDataRoot, usersRoot, userId)
    reply.header("Set-Cookie", buildUserCookie(config, userId))
    return reply.send({ seeded: workspaces, userId, workspaces })
  })

  fastify.post("/api/auth/logout", async (_req, reply) => {
    reply.header("Set-Cookie", `${config.auth.cookieName}=; Path=/; SameSite=Lax; Max-Age=0`)
    return reply.send({ ok: true })
  })
}
