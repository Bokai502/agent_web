import fs from "node:fs/promises"
import path from "node:path"

const appRoot = path.resolve(import.meta.dirname, "..", "..")
const configPath = path.join(appRoot, "config.json")

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
}

function sanitizeIdPart(value) {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "")
  return sanitized || "workspace"
}

function getWorkspaceId(workspaceName) {
  const sanitized = sanitizeIdPart(workspaceName).slice(0, 96)
  return sanitized.startsWith("ws_") ? sanitized : `ws_${sanitized}`
}

async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

function resolveTemplateRoot(config) {
  return path.resolve(config?.workspace?.templateDir ?? path.join(appRoot, "data", "input_data"))
}

function resolveUsersRoot(config) {
  const configured = config?.workspace?.usersRoot ?? config?.auth?.usersDir ?? "users"
  return path.isAbsolute(configured)
    ? path.resolve(configured)
    : path.resolve(resolveTemplateRoot(config), configured)
}

async function findManifestFiles(root) {
  const results = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const dirents = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      const fullPath = path.join(current, dirent.name)
      if (dirent.isDirectory()) {
        if (!dirent.name.startsWith(".")) stack.push(fullPath)
        continue
      }
      if (dirent.isFile() && dirent.name === "workspace_manifest.json") results.push(fullPath)
    }
  }
  return results.sort()
}

async function findTextFiles(root) {
  const textExtensions = new Set([
    ".42",
    ".csv",
    ".json",
    ".log",
    ".md",
    ".py",
    ".txt",
    ".yaml",
    ".yml",
  ])
  const results = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const dirents = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const dirent of dirents) {
      const fullPath = path.join(current, dirent.name)
      if (dirent.isDirectory()) {
        if (!dirent.name.startsWith(".")) stack.push(fullPath)
        continue
      }
      if (dirent.isFile() && textExtensions.has(path.extname(dirent.name).toLowerCase())) {
        results.push(fullPath)
      }
    }
  }
  return results.sort()
}

function remapVersionDir(value, manifestRoot, versionId) {
  const id = typeof versionId === "string" && versionId.trim()
    ? versionId.trim()
    : typeof value === "string"
      ? path.basename(value)
      : "v0001"
  const expected = path.join(manifestRoot, "versions", id)
  if (typeof value !== "string" || !value.trim()) return expected
  const resolved = path.resolve(value)
  const versionsRoot = path.join(manifestRoot, "versions")
  const relative = path.relative(versionsRoot, resolved)
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? resolved
    : expected
}

function migrateManifest(manifest, manifestPath) {
  const manifestRoot = path.dirname(manifestPath)
  const next = {
    ...manifest,
    rootDir: manifestRoot,
  }
  let changed = manifest.rootDir !== manifestRoot
  const versionDirById = new Map()

  next.versions = Array.isArray(manifest.versions)
    ? manifest.versions.filter(isRecord).map(version => {
        const workspaceDir = remapVersionDir(version.workspaceDir, manifestRoot, version.id)
        if (workspaceDir !== version.workspaceDir) changed = true
        if (typeof version.id === "string") versionDirById.set(version.id, workspaceDir)
        return {
          ...version,
          workspaceDir,
        }
      })
    : []

  if (Array.isArray(manifest.runs)) {
    next.runs = manifest.runs.filter(isRecord).map(run => {
      const workspaceDir = versionDirById.get(run.versionId) ?? remapVersionDir(run.workspaceDir, manifestRoot, run.versionId)
      if (workspaceDir !== run.workspaceDir) changed = true
      return {
        ...run,
        workspaceDir,
      }
    })
  }

  if (changed) next.updatedAt = new Date().toISOString()
  return { changed, manifest: next }
}

async function findUserRoots(root) {
  const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  return dirents
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith("."))
    .map(dirent => path.join(root, dirent.name))
    .sort()
}

async function findDirectWorkspaceDirs(userRoot) {
  const dirents = await fs.readdir(userRoot, { withFileTypes: true }).catch(() => [])
  const results = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith(".") || dirent.name === "workspaces" || dirent.name === "logs") continue
    const fullPath = path.join(userRoot, dirent.name)
    if (await pathExists(path.join(fullPath, "00_inputs"))) results.push(fullPath)
  }
  return results.sort()
}

async function ensureWorkspaceManifestForDirectDir(userRoot, sourceWorkspaceDir) {
  const workspaceName = path.basename(sourceWorkspaceDir)
  const workspaceId = getWorkspaceId(workspaceName)
  const workspaceRoot = path.join(userRoot, "workspaces", workspaceId)
  const versionId = "v0001"
  const versionDir = path.join(workspaceRoot, "versions", versionId)
  const manifestFile = path.join(workspaceRoot, "workspace_manifest.json")
  const now = new Date().toISOString()
  let changed = false

  if (!await pathExists(versionDir)) {
    await fs.mkdir(path.dirname(versionDir), { recursive: true })
    await fs.cp(sourceWorkspaceDir, versionDir, {
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      recursive: true,
    })
    changed = true
  }

  const currentManifest = await pathExists(manifestFile)
    ? JSON.parse(await fs.readFile(manifestFile, "utf-8"))
    : null
  const manifest = isRecord(currentManifest)
    ? currentManifest
    : {
        artifacts: [],
        checkpoints: [],
        createdAt: now,
        runs: [],
        scores: [],
        schemaVersion: "1.0",
        sessionId: workspaceName,
        versions: [],
        workspaceId,
      }

  const versions = Array.isArray(manifest.versions)
    ? manifest.versions.filter(isRecord)
    : []
  const existingVersion = versions.find(version => version.id === versionId)
  if (existingVersion) {
    if (existingVersion.workspaceDir !== versionDir) {
      existingVersion.workspaceDir = versionDir
      changed = true
    }
    if (!existingVersion.status) {
      existingVersion.status = "active"
      changed = true
    }
  } else {
    versions.push({
      createdAt: now,
      id: versionId,
      label: "Initial import",
      parentVersionId: null,
      status: "active",
      updatedAt: now,
      workspaceDir: versionDir,
    })
    changed = true
  }

  const nextManifest = {
    ...manifest,
    activeVersionId: typeof manifest.activeVersionId === "string" ? manifest.activeVersionId : versionId,
    artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts : [],
    checkpoints: Array.isArray(manifest.checkpoints) ? manifest.checkpoints : [],
    createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : now,
    rootDir: workspaceRoot,
    runs: Array.isArray(manifest.runs) ? manifest.runs : [],
    scores: Array.isArray(manifest.scores) ? manifest.scores : [],
    schemaVersion: "1.0",
    sessionId: typeof manifest.sessionId === "string" ? manifest.sessionId : workspaceName,
    updatedAt: changed ? now : typeof manifest.updatedAt === "string" ? manifest.updatedAt : now,
    versions,
    workspaceId: typeof manifest.workspaceId === "string" ? manifest.workspaceId : workspaceId,
  }

  if (JSON.stringify(manifest) !== JSON.stringify(nextManifest) || !currentManifest) {
    await fs.mkdir(workspaceRoot, { recursive: true })
    await fs.writeFile(manifestFile, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf-8")
    changed = true
  }

  return changed
}

const config = JSON.parse(await fs.readFile(configPath, "utf-8"))
const usersRoot = resolveUsersRoot(config)

if (!await pathExists(usersRoot)) {
  console.error(`usersRoot not found: ${usersRoot}`)
  process.exit(1)
}

const manifestFiles = await findManifestFiles(usersRoot)
let changedCount = 0
for (const filePath of manifestFiles) {
  const manifest = JSON.parse(await fs.readFile(filePath, "utf-8"))
  const migrated = migrateManifest(manifest, filePath)
  if (!migrated.changed) continue
  await fs.writeFile(filePath, `${JSON.stringify(migrated.manifest, null, 2)}\n`, "utf-8")
  changedCount += 1
  console.log(`Migrated ${filePath}`)
}

console.log(`Checked ${manifestFiles.length} manifests, migrated ${changedCount}.`)

const userRoots = await findUserRoots(usersRoot)
let workspaceManifestCount = 0
let workspaceManifestChangedCount = 0
for (const userRoot of userRoots) {
  const directWorkspaceDirs = await findDirectWorkspaceDirs(userRoot)
  for (const sourceWorkspaceDir of directWorkspaceDirs) {
    workspaceManifestCount += 1
    if (await ensureWorkspaceManifestForDirectDir(userRoot, sourceWorkspaceDir)) {
      workspaceManifestChangedCount += 1
      console.log(`Ensured versioned workspace for ${sourceWorkspaceDir}`)
    }
  }
}
console.log(`Checked ${workspaceManifestCount} direct workspaces, ensured ${workspaceManifestChangedCount}.`)

const legacyUsersPrefixes = [
  path.join(resolveTemplateRoot(config), "users"),
  path.join(path.dirname(usersRoot), "input_data", "users"),
]
const uniqueLegacyUsersPrefixes = [...new Set(legacyUsersPrefixes.map(item => path.resolve(item)))]
let contentChangedCount = 0
if (uniqueLegacyUsersPrefixes.some(prefix => prefix !== usersRoot)) {
  const textFiles = await findTextFiles(usersRoot)
  for (const filePath of textFiles) {
    const raw = await fs.readFile(filePath, "utf-8").catch(() => null)
    if (raw === null) continue
    let next = raw
    for (const legacyUsersPrefix of uniqueLegacyUsersPrefixes) {
      if (legacyUsersPrefix === usersRoot) continue
      next = next.split(legacyUsersPrefix).join(usersRoot)
    }
    if (next === raw) continue
    await fs.writeFile(filePath, next, "utf-8")
    contentChangedCount += 1
  }
  console.log(`Checked ${textFiles.length} text files, rewrote ${contentChangedCount}.`)
}
