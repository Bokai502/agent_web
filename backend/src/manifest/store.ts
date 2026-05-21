import fs from "node:fs/promises"
import path from "node:path"
import { getFreecadWorkspaceRoot, resolveFreecadWorkspaceDir, setFreecadWorkspaceDir } from "../freecadWorkspace.js"
import type { VersionRecord, WorkspaceManifest } from "./schema.js"

const MANIFEST_FILE = "workspace_manifest.json"
const WORKSPACES_DIR = "workspaces"

function nowIso() {
  return new Date().toISOString()
}

function sanitizeIdPart(value: string) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "")
  return sanitized || "workspace"
}

function normalizeDirectChildName(value: string, field: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error(`${field} must be a direct child name`)
  }
  return trimmed
}

function getWorkspaceId(sessionId: string) {
  return `ws_${sanitizeIdPart(sessionId).slice(0, 96)}`
}

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(tmp, content, "utf-8")
  await fs.rename(tmp, filePath)
}

async function copyWorkspaceInputs(sourceWorkspace: string, destinationWorkspace: string) {
  const sourceInputs = path.join(sourceWorkspace, "00_inputs")
  const destinationInputs = path.join(destinationWorkspace, "00_inputs")
  if (!await pathExists(sourceInputs)) {
    throw new Error(`source workspace 00_inputs does not exist: ${sourceInputs}`)
  }
  if (await pathExists(destinationWorkspace)) {
    throw new Error(`destination already exists: ${destinationWorkspace}`)
  }
  await fs.mkdir(destinationWorkspace, { recursive: true })
  await fs.cp(sourceInputs, destinationInputs, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  })
}

async function getVersionRoot(sessionId: string) {
  const root = await getFreecadWorkspaceRoot()
  return path.join(root, WORKSPACES_DIR, getWorkspaceId(sessionId))
}

function manifestPath(rootDir: string) {
  return path.join(rootDir, MANIFEST_FILE)
}

function isPathInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

async function readManifestFile(rootDir: string, sessionIdFallback: string) {
  return normalizeManifest(
    JSON.parse(await fs.readFile(manifestPath(rootDir), "utf-8")),
    sessionIdFallback,
    rootDir,
  )
}

async function findManifestRootFromPath(workspaceDir: string) {
  let current = path.resolve(workspaceDir)
  for (;;) {
    if (await pathExists(manifestPath(current))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function findManifestRootForWorkspaceName(workspaceName: string) {
  const freecadRoot = await getFreecadWorkspaceRoot()
  const workspacesRoot = path.join(freecadRoot, WORKSPACES_DIR)
  const directRoot = path.join(workspacesRoot, workspaceName)
  if (await pathExists(manifestPath(directRoot))) return directRoot

  const dirents = await fs.readdir(workspacesRoot, { withFileTypes: true }).catch(() => [])
  const prefix = `ws_${sanitizeIdPart(workspaceName)}_`
  const candidates = dirents
    .filter(dirent => dirent.isDirectory() && (dirent.name === `ws_${workspaceName}` || dirent.name.startsWith(prefix)))
    .map(dirent => path.join(workspacesRoot, dirent.name))

  for (const candidate of candidates) {
    if (await pathExists(manifestPath(candidate))) return candidate
  }

  return null
}

async function resolveManifestRoot(options: {
  sessionId?: string | null
  workspaceDir?: string | null
}) {
  const workspaceDir = options.workspaceDir?.trim()
  if (workspaceDir) {
    const resolvedWorkspaceDir = path.resolve(workspaceDir)
    const directManifestRoot = await findManifestRootFromPath(resolvedWorkspaceDir)
    if (directManifestRoot) return directManifestRoot

    const freecadRoot = await getFreecadWorkspaceRoot()
    if (isPathInside(freecadRoot, resolvedWorkspaceDir)) {
      const relativeParts = path.relative(freecadRoot, resolvedWorkspaceDir).split(path.sep).filter(Boolean)
      const workspaceName = relativeParts[0] ?? path.basename(resolvedWorkspaceDir)
      const matchedRoot = await findManifestRootForWorkspaceName(workspaceName)
      if (matchedRoot) return matchedRoot
    }
  }

  if (options.sessionId) return await getVersionRoot(normalizeDirectChildName(options.sessionId, "sessionId"))
  throw new Error("workspaceDir or sessionId is required")
}

function emptyManifest(sessionId: string, rootDir: string): WorkspaceManifest {
  const timestamp = nowIso()
  return {
    schemaVersion: "1.0",
    workspaceId: getWorkspaceId(sessionId),
    sessionId,
    rootDir,
    activeVersionId: null,
    versions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function normalizeManifest(value: unknown, sessionId: string, rootDir: string): WorkspaceManifest {
  const fallback = emptyManifest(sessionId, rootDir)
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback
  const record = value as Record<string, unknown>
  return {
    ...fallback,
    ...record,
    schemaVersion: "1.0",
    workspaceId: typeof record.workspaceId === "string" && record.workspaceId ? record.workspaceId : fallback.workspaceId,
    sessionId: typeof record.sessionId === "string" && record.sessionId ? record.sessionId : sessionId,
    rootDir,
    activeVersionId: typeof record.activeVersionId === "string" && record.activeVersionId ? record.activeVersionId : null,
    versions: Array.isArray(record.versions) ? record.versions as VersionRecord[] : [],
    createdAt: typeof record.createdAt === "string" ? record.createdAt : fallback.createdAt,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt,
  }
}

async function writeManifest(manifest: WorkspaceManifest) {
  const next = { ...manifest, updatedAt: nowIso() }
  await atomicWrite(manifestPath(next.rootDir), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export async function getWorkspaceManifest(sessionId: string) {
  const trimmedSessionId = normalizeDirectChildName(sessionId, "sessionId")
  const rootDir = await getVersionRoot(trimmedSessionId)
  await fs.mkdir(rootDir, { recursive: true })
  const file = manifestPath(rootDir)
  try {
    return normalizeManifest(JSON.parse(await fs.readFile(file, "utf-8")), trimmedSessionId, rootDir)
  } catch {
    return await writeManifest(emptyManifest(trimmedSessionId, rootDir))
  }
}

export async function getWorkspaceManifestByLocator(options: {
  sessionId?: string | null
  workspaceDir?: string | null
}) {
  const rootDir = await resolveManifestRoot(options)
  if (await pathExists(manifestPath(rootDir))) {
    return await readManifestFile(rootDir, options.sessionId ?? path.basename(rootDir))
  }
  const sessionId = normalizeDirectChildName(options.sessionId ?? path.basename(rootDir), "sessionId")
  await fs.mkdir(rootDir, { recursive: true })
  return await writeManifest(emptyManifest(sessionId, rootDir))
}

async function syncConfigToActiveVersion(manifest: WorkspaceManifest) {
  const activeVersion = manifest.versions.find(version => version.id === manifest.activeVersionId) ?? null
  if (activeVersion) await setFreecadWorkspaceDir(activeVersion.workspaceDir)
  return manifest
}

async function ensureInitialVersion(manifest: WorkspaceManifest, sourceWorkspaceDir?: string | null) {
  if (manifest.activeVersionId && manifest.versions.some(version => version.id === manifest.activeVersionId)) {
    return await syncConfigToActiveVersion(manifest)
  }
  if (manifest.versions.length > 0) {
    const active = manifest.versions.find(version => version.status === "active") ?? manifest.versions[0]
    return await syncConfigToActiveVersion(await writeManifest({ ...manifest, activeVersionId: active.id }))
  }

  const sourceWorkspace = sourceWorkspaceDir ? path.resolve(sourceWorkspaceDir) : await resolveFreecadWorkspaceDir()
  const versionId = "v0001"
  const workspaceDir = path.join(manifest.rootDir, "versions", versionId)
  await copyWorkspaceInputs(sourceWorkspace, workspaceDir)
  const timestamp = nowIso()
  const version: VersionRecord = {
    id: versionId,
    parentVersionId: null,
    label: "Initial import",
    status: "active",
    workspaceDir,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  return await syncConfigToActiveVersion(await writeManifest({
    ...manifest,
    activeVersionId: versionId,
    versions: [version],
  }))
}

export async function getOrCreateWorkspaceManifest(sessionId: string, options: { sourceWorkspaceDir?: string | null } = {}) {
  return await ensureInitialVersion(await getWorkspaceManifest(sessionId), options.sourceWorkspaceDir)
}

export async function getOrCreateWorkspaceManifestByLocator(options: {
  sessionId?: string | null
  sourceWorkspaceDir?: string | null
  workspaceDir?: string | null
}) {
  return await ensureInitialVersion(
    await getWorkspaceManifestByLocator({
      sessionId: options.sessionId,
      workspaceDir: options.workspaceDir ?? options.sourceWorkspaceDir,
    }),
    options.sourceWorkspaceDir,
  )
}

function nextVersionId(manifest: WorkspaceManifest) {
  const max = manifest.versions.reduce((currentMax, version) => {
    const match = version.id.match(/^v(\d+)$/)
    return match ? Math.max(currentMax, Number(match[1])) : currentMax
  }, 0)
  return `v${String(max + 1).padStart(4, "0")}`
}

export async function branchVersion({
  baseVersionId,
  label,
  sessionId,
  workspaceDir: locatorWorkspaceDir,
}: {
  baseVersionId?: string | null
  label?: string | null
  sessionId: string
  workspaceDir?: string | null
}) {
  let manifest = await getOrCreateWorkspaceManifestByLocator({ sessionId, workspaceDir: locatorWorkspaceDir })
  const baseId = baseVersionId ?? manifest.activeVersionId
  if (!baseId) throw new Error("base version is required")
  const baseVersion = manifest.versions.find(version => version.id === baseId)
  if (!baseVersion) throw new Error(`base version not found: ${baseId}`)

  const versionId = nextVersionId(manifest)
  const newWorkspaceDir = path.join(manifest.rootDir, "versions", versionId)
  await copyWorkspaceInputs(baseVersion.workspaceDir, newWorkspaceDir)
  const timestamp = nowIso()
  const version: VersionRecord = {
    id: versionId,
    parentVersionId: baseVersion.id,
    ...(label ? { label } : {}),
    status: "active",
    workspaceDir: newWorkspaceDir,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const versions = manifest.versions.map(item =>
    item.status === "active"
      ? { ...item, status: "archived" as const, updatedAt: timestamp }
      : item
  )
  manifest = await syncConfigToActiveVersion(await writeManifest({
    ...manifest,
    activeVersionId: version.id,
    versions: [...versions, version],
  }))
  return { manifest, version }
}

export async function checkoutVersion(sessionId: string, versionId: string, workspaceDir?: string | null) {
  const manifest = await getOrCreateWorkspaceManifestByLocator({ sessionId, workspaceDir })
  const version = manifest.versions.find(item => item.id === versionId)
  if (!version) throw new Error(`version not found: ${versionId}`)
  const timestamp = nowIso()
  const versions = manifest.versions.map(item => ({
    ...item,
    status: item.id === versionId ? "active" as const : item.status === "active" ? "archived" as const : item.status,
    updatedAt: item.id === versionId || item.status === "active" ? timestamp : item.updatedAt,
  }))
  return await syncConfigToActiveVersion(await writeManifest({ ...manifest, activeVersionId: version.id, versions }))
}
