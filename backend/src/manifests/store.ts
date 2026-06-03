import fs from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { loadConfig } from "../config.js"
import { getString, isPathInside } from "../shared/index.js"
import { getWorkspaceRoot, resolveWorkspaceDir, setWorkspaceDir } from "../workspaces/workspaceManager.js"
import type {
  ArtifactRecord,
  CheckpointRecord,
  RunRecord,
  RunStatus,
  ScoreRecord,
  VersionRecord,
  VersionStatus,
  WorkspaceManifest,
} from "./schema.js"

const MANIFEST_FILE = "workspace_manifest.json"
const WORKSPACES_DIR = "workspaces"
const DEFAULT_WORKSPACE_GROUP = "xieteam"
const execFileAsync = promisify(execFile)
const WORKSPACE_FILESYSTEM_GROUP = loadConfig().workspace.filesystemGroup

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

function getStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function getWorkspaceId(sessionId: string) {
  const sanitized = sanitizeIdPart(sessionId).slice(0, 96)
  return sanitized.startsWith("ws_") ? sanitized : `ws_${sanitized}`
}

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

async function atomicWrite(filePath: string, content: string) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await applyWorkspaceFilesystemGroup(path.dirname(filePath), { recursive: false })
  await fs.writeFile(tmp, content, "utf-8")
  await applyWorkspaceFilesystemGroup(tmp, { recursive: false })
  await fs.rename(tmp, filePath)
  await applyWorkspaceFilesystemGroup(filePath, { recursive: false })
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
  await applyWorkspaceFilesystemGroup(destinationWorkspace, { recursive: false })
  await fs.cp(sourceInputs, destinationInputs, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  })
  await applyWorkspaceFilesystemGroup(destinationWorkspace)
}

async function applyWorkspaceFilesystemGroup(targetPath: string, options: { recursive?: boolean } = {}) {
  const group = WORKSPACE_FILESYSTEM_GROUP.trim()
  if (!group) return

  const args = options.recursive === false ? [group, targetPath] : ["-R", group, targetPath]
  await execFileAsync("chgrp", args)

  const stat = await fs.stat(targetPath).catch(() => null)
  if (!stat) return
  if (stat.isDirectory()) {
    await execFileAsync("find", [targetPath, "-type", "d", "-exec", "chmod", "g+s", "{}", "+"])
  } else {
    const parentDir = path.dirname(targetPath)
    await execFileAsync("chmod", ["g+s", parentDir])
  }
}

async function getVersionRoot(sessionId: string) {
  const root = await getWorkspaceRoot()
  const sanitized = sanitizeIdPart(sessionId).slice(0, 96)
  const directWorkspaceIdRoot = path.join(root, WORKSPACES_DIR, sanitized)
  if (sanitized.startsWith("ws_")) {
    if (await pathExists(manifestPath(directWorkspaceIdRoot))) {
      return directWorkspaceIdRoot
    }
    const legacyDoublePrefixedRoot = path.join(root, WORKSPACES_DIR, `ws_${sanitized}`)
    if (await pathExists(manifestPath(legacyDoublePrefixedRoot))) {
      return legacyDoublePrefixedRoot
    }
    return directWorkspaceIdRoot
  }
  return path.join(root, WORKSPACES_DIR, getWorkspaceId(sessionId))
}

function manifestPath(rootDir: string) {
  return path.join(rootDir, MANIFEST_FILE)
}

async function getAllowedWorkspaceRoot() {
  return path.resolve(await getWorkspaceRoot())
}

async function assertPathInsideWorkspaceRoot(filePath: string, field: string) {
  const workspaceRoot = await getAllowedWorkspaceRoot()
  const resolvedPath = path.resolve(filePath)
  if (!isPathInside(workspaceRoot, resolvedPath)) {
    throw new Error(`${field} must be under the workspace data root`)
  }
  return resolvedPath
}

async function assertManifestRootAllowed(rootDir: string) {
  const workspaceRoot = await getAllowedWorkspaceRoot()
  const resolvedRootDir = path.resolve(rootDir)
  const workspacesRoot = path.join(workspaceRoot, WORKSPACES_DIR)
  if (!isPathInside(workspacesRoot, resolvedRootDir)) {
    throw new Error("workspace manifest must be under workspace data root/workspaces")
  }
  return resolvedRootDir
}

function normalizeVersionRecords(versions: unknown, rootDir: string): VersionRecord[] {
  if (!Array.isArray(versions)) return []
  const versionsRoot = path.join(rootDir, "versions")
  return versions.filter((item): item is VersionRecord => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    if (typeof record.id !== "string" || !record.id.trim()) return false
    if (record.parentVersionId !== null && record.parentVersionId !== undefined && typeof record.parentVersionId !== "string") return false
    if (typeof record.workspaceDir !== "string" || !record.workspaceDir.trim()) return false
    const resolvedWorkspaceDir = path.resolve(record.workspaceDir)
    if (!isPathInside(versionsRoot, resolvedWorkspaceDir)) return false
    return true
  })
}

function normalizeRecordArray<T extends { id: string }>(value: unknown): T[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is T => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false
    return typeof (item as Record<string, unknown>).id === "string"
  })
}

async function readManifestFile(rootDir: string, sessionIdFallback: string) {
  const resolvedRootDir = await assertManifestRootAllowed(rootDir)
  return await pruneMissingVersionWorkspaces(normalizeManifest(
    JSON.parse(await fs.readFile(manifestPath(resolvedRootDir), "utf-8")),
    sessionIdFallback,
    resolvedRootDir,
  ))
}

async function pruneMissingVersionWorkspaces(manifest: WorkspaceManifest) {
  const versions: VersionRecord[] = []
  for (const version of manifest.versions) {
    if (await pathExists(version.workspaceDir)) versions.push(version)
  }

  const activeVersionId = versions.some(version => version.id === manifest.activeVersionId)
    ? manifest.activeVersionId
    : null

  if (versions.length === manifest.versions.length && activeVersionId === manifest.activeVersionId) {
    return manifest
  }

  return { ...manifest, activeVersionId, versions }
}

async function findManifestRootFromPath(workspaceDir: string) {
  let current = await assertPathInsideWorkspaceRoot(workspaceDir, "workspaceDir")
  const workspaceRoot = await getAllowedWorkspaceRoot()
  for (;;) {
    if (await pathExists(manifestPath(current))) return current
    const parent = path.dirname(current)
    if (parent === current || !isPathInside(workspaceRoot, parent)) return null
    current = parent
  }
}

async function findManifestRootForWorkspaceName(workspaceName: string) {
  const workspaceRoot = await getWorkspaceRoot()
  const workspacesRoot = path.join(workspaceRoot, WORKSPACES_DIR)
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
    const resolvedWorkspaceDir = await assertPathInsideWorkspaceRoot(workspaceDir, "workspaceDir")
    const directManifestRoot = await findManifestRootFromPath(resolvedWorkspaceDir)
    if (directManifestRoot) return directManifestRoot

    const workspaceRoot = await getAllowedWorkspaceRoot()
    if (isPathInside(workspaceRoot, resolvedWorkspaceDir)) {
      const relativeParts = path.relative(workspaceRoot, resolvedWorkspaceDir).split(path.sep).filter(Boolean)
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
    group: DEFAULT_WORKSPACE_GROUP,
    sessionId,
    rootDir,
    activeVersionId: null,
    versions: [],
    artifacts: [],
    checkpoints: [],
    createdAt: timestamp,
    runs: [],
    scores: [],
    updatedAt: timestamp,
  }
}

function normalizeManifest(value: unknown, sessionId: string, rootDir: string): WorkspaceManifest {
  const resolvedRootDir = path.resolve(rootDir)
  const fallback = emptyManifest(sessionId, rootDir)
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback
  const record = value as Record<string, unknown>
  return {
    ...fallback,
    ...record,
    schemaVersion: "1.0",
    workspaceId: typeof record.workspaceId === "string" && record.workspaceId ? record.workspaceId : fallback.workspaceId,
    group: typeof record.group === "string" && record.group ? record.group : fallback.group,
    sessionId: typeof record.sessionId === "string" && record.sessionId ? record.sessionId : sessionId,
    rootDir: resolvedRootDir,
    activeVersionId: typeof record.activeVersionId === "string" && record.activeVersionId ? record.activeVersionId : null,
    versions: normalizeVersionRecords(record.versions, resolvedRootDir),
    artifacts: normalizeRecordArray<ArtifactRecord>(record.artifacts),
    checkpoints: normalizeRecordArray<CheckpointRecord>(record.checkpoints),
    createdAt: typeof record.createdAt === "string" ? record.createdAt : fallback.createdAt,
    runs: normalizeRecordArray<RunRecord>(record.runs),
    scores: normalizeRecordArray<ScoreRecord>(record.scores),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : fallback.updatedAt,
  }
}

async function writeManifest(manifest: WorkspaceManifest) {
  const rootDir = await assertManifestRootAllowed(manifest.rootDir)
  const next = { ...manifest, rootDir, updatedAt: nowIso() }
  await atomicWrite(manifestPath(next.rootDir), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export async function getWorkspaceManifest(sessionId: string) {
  const trimmedSessionId = normalizeDirectChildName(sessionId, "sessionId")
  const rootDir = await getVersionRoot(trimmedSessionId)
  await fs.mkdir(rootDir, { recursive: true })
  await applyWorkspaceFilesystemGroup(rootDir, { recursive: false })
  const file = manifestPath(rootDir)
  try {
    return await readManifestFile(rootDir, trimmedSessionId)
  } catch {
    return await writeManifest(emptyManifest(trimmedSessionId, rootDir))
  }
}

export async function getWorkspaceManifestSnapshotByLocator(options: {
  sessionId?: string | null
  workspaceDir?: string | null
}) {
  const rootDir = await resolveManifestRoot(options)
  if (await pathExists(manifestPath(rootDir))) {
    return await readManifestFile(rootDir, options.sessionId ?? path.basename(rootDir))
  }
  const sessionId = normalizeDirectChildName(options.sessionId ?? path.basename(rootDir), "sessionId")
  return emptyManifest(sessionId, rootDir)
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
  await applyWorkspaceFilesystemGroup(rootDir, { recursive: false })
  return await writeManifest(emptyManifest(sessionId, rootDir))
}

async function syncConfigToActiveVersion(manifest: WorkspaceManifest) {
  const activeVersion = manifest.versions.find(version => version.id === manifest.activeVersionId) ?? null
  if (activeVersion) await setWorkspaceDir(activeVersion.workspaceDir)
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

  const sourceWorkspace = sourceWorkspaceDir
    ? await assertPathInsideWorkspaceRoot(sourceWorkspaceDir, "sourceWorkspaceDir")
    : await assertPathInsideWorkspaceRoot(await resolveWorkspaceDir(), "sourceWorkspaceDir")
  const versionId = "v0001"
  const workspaceDir = path.join(manifest.rootDir, "versions", versionId)
  await copyWorkspaceInputs(sourceWorkspace, workspaceDir)
  const timestamp = nowIso()
  const version: VersionRecord = {
    id: versionId,
    parentVersionId: null,
    group: manifest.group ?? DEFAULT_WORKSPACE_GROUP,
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
  group,
  label,
  sessionId,
  workspaceDir: locatorWorkspaceDir,
}: {
  baseVersionId?: string | null
  group?: string | null
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
    group: group?.trim() || baseVersion.group || manifest.group || DEFAULT_WORKSPACE_GROUP,
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

function getManifestByWorkspaceId(workspaceId: string) {
  return getWorkspaceManifestByLocator({ sessionId: workspaceId })
}

async function getManifestForBody(body: Record<string, unknown>) {
  const workspaceDir = getString(body.workspaceDir)
  const workspaceId = getString(body.workspaceId)
  const sessionId = workspaceId ?? getString(body.sessionId)
  return await getWorkspaceManifestSnapshotByLocator({ sessionId, workspaceDir })
}

function assertMatchingWorkspaceDir(requestedWorkspaceDir: string | null, version: VersionRecord) {
  if (!requestedWorkspaceDir) return
  const requested = path.resolve(requestedWorkspaceDir)
  const expected = path.resolve(version.workspaceDir)
  if (requested !== expected) {
    throw new Error(`workspaceDir does not match version ${version.id}`)
  }
}

function getVersionForRun(manifest: WorkspaceManifest, requestedVersionId: string | null, requestedWorkspaceDir: string | null) {
  if (requestedVersionId) {
    const version = manifest.versions.find(item => item.id === requestedVersionId)
    if (!version) throw new Error(`version not found: ${requestedVersionId}`)
    assertMatchingWorkspaceDir(requestedWorkspaceDir, version)
    return version
  }
  if (requestedWorkspaceDir) {
    const requested = path.resolve(requestedWorkspaceDir)
    const version = manifest.versions.find(item => path.resolve(item.workspaceDir) === requested)
    if (!version) throw new Error("workspaceDir does not match any manifest version")
    return version
  }
  const versionId = manifest.activeVersionId
  if (versionId) {
    const version = manifest.versions.find(item => item.id === versionId)
    if (!version) throw new Error(`version not found: ${versionId}`)
    return version
  }
  return null
}

export async function resolveRunWorkspaceContext(body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  const requestedWorkspaceId = getString(body.workspaceId)
  const requestedVersionId = getString(body.versionId)
  const requestedWorkspaceDir = getString(body.workspaceDir)
  if (requestedWorkspaceId && manifest.workspaceId !== requestedWorkspaceId) {
    throw new Error(`workspaceId does not match resolved manifest: ${requestedWorkspaceId}`)
  }
  const version = getVersionForRun(manifest, requestedVersionId, requestedWorkspaceDir)
  if ((requestedWorkspaceId || requestedVersionId || requestedWorkspaceDir) && !version) {
    throw new Error("workspace has no active version")
  }
  return {
    manifest,
    version,
    versionId: version?.id ?? null,
    workspaceDir: version?.workspaceDir ?? requestedWorkspaceDir,
    workspaceId: manifest.workspaceId,
  }
}

function updateVersionStatus(manifest: WorkspaceManifest, versionId: string, status: VersionStatus) {
  const timestamp = nowIso()
  let found = false
  const versions = manifest.versions.map(version => {
    if (version.id !== versionId) return version
    found = true
    return { ...version, status, updatedAt: timestamp }
  })
  if (!found) throw new Error(`version not found: ${versionId}`)
  return writeManifest({ ...manifest, versions })
}

export async function commitVersion(versionId: string, body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  return await updateVersionStatus(manifest, versionId, "committed")
}

export async function failVersion(versionId: string, body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  return await updateVersionStatus(manifest, versionId, "failed")
}

export async function diffVersions(a: string, b: string, workspaceId: string) {
  const manifest = await getManifestByWorkspaceId(workspaceId)
  const left = manifest.versions.find(version => version.id === a)
  const right = manifest.versions.find(version => version.id === b)
  if (!left) throw new Error(`version not found: ${a}`)
  if (!right) throw new Error(`version not found: ${b}`)
  const leftFiles = await listWorkspaceFiles(left.workspaceDir)
  const rightFiles = await listWorkspaceFiles(right.workspaceDir)
  const allPaths = new Set([...leftFiles.keys(), ...rightFiles.keys()])
  const added: string[] = []
  const removed: string[] = []
  const changed: string[] = []
  const unchanged: string[] = []
  for (const filePath of [...allPaths].sort()) {
    const leftMeta = leftFiles.get(filePath)
    const rightMeta = rightFiles.get(filePath)
    if (!leftMeta && rightMeta) added.push(filePath)
    else if (leftMeta && !rightMeta) removed.push(filePath)
    else if (leftMeta && rightMeta && (leftMeta.size !== rightMeta.size || leftMeta.mtimeMs !== rightMeta.mtimeMs)) changed.push(filePath)
    else unchanged.push(filePath)
  }
  return { a, added, b, changed, removed, unchanged, workspaceId }
}

async function listWorkspaceFiles(workspaceDir: string) {
  const root = await assertPathInsideWorkspaceRoot(workspaceDir, "workspaceDir")
  const files = new Map<string, { mtimeMs: number; size: number }>()
  const visit = async (dir: string) => {
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      if (dirent.name.startsWith(".")) continue
      const fullPath = path.join(dir, dirent.name)
      const relativePath = path.relative(root, fullPath)
      if (dirent.isDirectory()) {
        await visit(fullPath)
      } else if (dirent.isFile()) {
        const stat = await fs.stat(fullPath)
        files.set(relativePath, { mtimeMs: stat.mtimeMs, size: stat.size })
      }
    }
  }
  await visit(root)
  return files
}

export async function createRun(body: Record<string, unknown>) {
  const { manifest, versionId, workspaceDir } = await resolveRunWorkspaceContext(body)
  const timestamp = nowIso()
  const run: RunRecord = {
    ...body,
    id: getString(body.id) ?? makeId("run"),
    baseVersionId: getString(body.baseVersionId),
    createdAt: timestamp,
    kind: getString(body.kind) ?? undefined,
    outputVersionId: getString(body.outputVersionId),
    retryOfRunId: getString(body.retryOfRunId),
    sessionId: getString(body.sessionId),
    skillNames: getStringArray(body.skillNames),
    status: (getString(body.status) as RunStatus | null) ?? "queued",
    threadId: getString(body.threadId),
    turnId: getString(body.turnId),
    updatedAt: timestamp,
    versionId,
    workspaceDir,
    workspaceId: manifest.workspaceId,
  }
  const next = await writeManifest({ ...manifest, runs: [...manifest.runs, run] })
  return { manifest: next, run }
}

export async function getRun(runId: string, workspaceId: string) {
  const manifest = await getManifestByWorkspaceId(workspaceId)
  const run = manifest.runs.find(item => item.id === runId)
  if (!run) throw new Error(`run not found: ${runId}`)
  return { manifest, run }
}

export async function patchRun(runId: string, body: Record<string, unknown>) {
  const { manifest, versionId, workspaceDir } = await resolveRunWorkspaceContext(body)
  const timestamp = nowIso()
  let patched: RunRecord | null = null
  const runs = manifest.runs.map(run => {
    if (run.id !== runId) return run
    patched = { ...run, ...body, id: run.id, updatedAt: timestamp, versionId, workspaceDir, workspaceId: manifest.workspaceId }
    return patched
  })
  if (!patched) throw new Error(`run not found: ${runId}`)
  const next = await writeManifest({ ...manifest, runs })
  return { manifest: next, run: patched }
}

export async function setRunStatus(runId: string, body: Record<string, unknown>, status: RunStatus) {
  return await patchRun(runId, { ...body, status })
}

export async function retryRun(runId: string, body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  const original = manifest.runs.find(item => item.id === runId)
  if (!original) throw new Error(`run not found: ${runId}`)
  return await createRun({
    ...original,
    ...body,
    id: undefined,
    retryOfRunId: original.id,
    status: "queued",
  })
}

function assertRelativeArtifactPath(filePath: string) {
  if (path.isAbsolute(filePath) || filePath.includes("..")) throw new Error("artifact path must be relative to the version workspace")
  return filePath
}

export async function registerArtifact(body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  const timestamp = nowIso()
  const artifactPath = assertRelativeArtifactPath(getString(body.path) ?? "")
  if (!artifactPath) throw new Error("artifact path is required")
  const artifact: ArtifactRecord = {
    ...body,
    id: getString(body.id) ?? makeId("artifact"),
    createdAt: timestamp,
    kind: getString(body.kind) ?? "file",
    path: artifactPath,
    updatedAt: timestamp,
    versionId: getString(body.versionId),
    workspaceId: manifest.workspaceId,
  }
  const next = await writeManifest({ ...manifest, artifacts: [...manifest.artifacts, artifact] })
  return { artifact, manifest: next }
}

export async function registerExistingArtifacts(versionId: string, body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  const version = manifest.versions.find(item => item.id === versionId)
  if (!version) throw new Error(`version not found: ${versionId}`)
  const common = [
    "01_cad/geometry_after.step",
    "01_cad/geometry_after.glb",
    "01_cad/simulation_input.json",
    "01_cad/cad_agent_output.json",
    "02_sim/run_manifest.json",
    "02_sim/simulation/status.json",
    "02_sim/simulation/simulation_manifest.json",
    "02_sim/simulation/native.vtu",
    "02_sim/simulation/interface_temperature_diagnostics.json",
    "02_sim/analysis/metrics_summary.json",
    "02_sim/analysis/anomaly_candidates.json",
    "02_sim/analysis/diagnosis.json",
    "AIGNC_Workflow/loop_progress.json",
    "logs/progress.json",
  ]
  const artifacts: ArtifactRecord[] = []
  for (const relativePath of common) {
    if (!await pathExists(path.join(version.workspaceDir, relativePath))) continue
    const timestamp = nowIso()
    artifacts.push({
      id: makeId("artifact"),
      createdAt: timestamp,
      kind: path.extname(relativePath).slice(1) || "file",
      path: relativePath,
      updatedAt: timestamp,
      versionId,
      workspaceId: manifest.workspaceId,
    })
  }
  const next = await writeManifest({ ...manifest, artifacts: [...manifest.artifacts, ...artifacts] })
  return { artifacts, manifest: next }
}

export async function registerCheckpoint(body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  const timestamp = nowIso()
  const checkpoint: CheckpointRecord = {
    ...body,
    id: getString(body.id) ?? makeId("checkpoint"),
    artifactIds: getStringArray(body.artifactIds),
    createdAt: timestamp,
    kind: getString(body.kind) ?? "checkpoint",
    runId: getString(body.runId),
    stateRefs: getStringArray(body.stateRefs),
    status: getString(body.status) ?? undefined,
    updatedAt: timestamp,
    versionId: getString(body.versionId),
    workspaceId: manifest.workspaceId,
  }
  const next = await writeManifest({ ...manifest, checkpoints: [...manifest.checkpoints, checkpoint] })
  return { checkpoint, manifest: next }
}

export async function registerScore(body: Record<string, unknown>) {
  const manifest = await getManifestForBody(body)
  const value = typeof body.value === "number" && Number.isFinite(body.value) ? body.value : null
  if (value === null) throw new Error("score value is required")
  const timestamp = nowIso()
  const score: ScoreRecord = {
    ...body,
    id: getString(body.id) ?? makeId("score"),
    createdAt: timestamp,
    metric: getString(body.metric) ?? "score",
    runId: getString(body.runId),
    updatedAt: timestamp,
    value,
    versionId: getString(body.versionId),
    workspaceId: manifest.workspaceId,
  }
  const next = await writeManifest({ ...manifest, scores: [...manifest.scores, score] })
  return { manifest: next, score }
}
