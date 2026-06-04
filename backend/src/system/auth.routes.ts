import type { FastifyInstance } from "fastify"
import fs from "node:fs/promises"
import path from "node:path"
import type { AppConfig } from "../config.js"
import { buildUserCookie, sanitizeUserId } from "../server/auth.js"
import { getRequestUserId, getRequestWorkspaceRootOverride } from "../server/requestContext.js"

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

const INPUT_DATA_ROOT = "/data/lbk/codex_web/data/input_data"
const USER_TEMPLATE_DIRS = [
  { name: "derating", sessionId: "derating", workspaceId: "ws_derating" },
  { name: "gnc", sessionId: "gnc", workspaceId: "ws_gnc" },
  { name: "thermal", sessionId: "thermal", workspaceId: "ws_thermal" },
] as const

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function seedUserData(userId: string, usersDir: string): Promise<UserSeedStatus[]> {
  const userRoot = path.join(INPUT_DATA_ROOT, usersDir, userId)
  await fs.mkdir(userRoot, { recursive: true })

  const statuses: UserSeedStatus[] = []
  for (const { name } of USER_TEMPLATE_DIRS) {
    const source = path.join(INPUT_DATA_ROOT, name)
    const target = path.join(userRoot, name)

    if (!await pathExists(source)) {
      statuses.push({ copied: false, name, reason: "template-missing" })
      continue
    }
    if (await pathExists(target)) {
      statuses.push({ copied: false, name, reason: "already-exists" })
      continue
    }

    await fs.cp(source, target, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    })
    statuses.push({ copied: true, name })
  }

  return statuses
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

async function seedUserWorkspaceVersions(userId: string, usersDir: string): Promise<WorkspaceSeedStatus[]> {
  const userRoot = path.join(INPUT_DATA_ROOT, usersDir, userId)
  const statuses: WorkspaceSeedStatus[] = []

  for (const { name, sessionId, workspaceId } of USER_TEMPLATE_DIRS) {
    const source = path.join(userRoot, name)
    const workspaceRoot = path.join(userRoot, "workspaces", workspaceId)
    const versionDir = path.join(workspaceRoot, "versions", "v0001")
    const manifestPath = path.join(workspaceRoot, "workspace_manifest.json")

    if (!await pathExists(source)) {
      statuses.push({ copied: false, name, reason: "source-missing", workspaceId })
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
    const seeded = await seedUserData(userId, config.auth.usersDir)
    const workspaces = await seedUserWorkspaceVersions(userId, config.auth.usersDir)
    reply.header("Set-Cookie", buildUserCookie(config, userId))
    return reply.send({ seeded, userId, workspaces })
  })

  fastify.post("/api/auth/logout", async (_req, reply) => {
    reply.header("Set-Cookie", `${config.auth.cookieName}=; Path=/; SameSite=Lax; Max-Age=0`)
    return reply.send({ ok: true })
  })
}
