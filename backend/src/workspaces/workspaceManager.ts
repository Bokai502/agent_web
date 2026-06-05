import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"
import { getRequestWorkspaceRootOverride } from "../server/requestContext.js"

const BACKEND_SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = path.basename(BACKEND_SRC_DIR) === "workspaces"
  ? path.resolve(BACKEND_SRC_DIR, "..", "..")
  : path.resolve(BACKEND_SRC_DIR, "..")
const APP_ROOT = path.resolve(BACKEND_ROOT, "..")
const APP_CONFIG_JSON = path.join(APP_ROOT, "config.json")
const DEFAULT_WORKSPACE_ROOT = path.join(APP_ROOT, "..", "data")
const WORKSPACES_DIR = "workspaces"
const CURRENT_WORKSPACE_FILE = ".current-workspace.json"
const LEGACY_CAD_CONFIG_KEY = ["free", "cad"].join("")
const WORKSPACE_CONFIG_KEY = "workspace"

type RootConfig = {
  workspace?: {
    workspaceDir?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type WorkspaceItem = {
  manifestRoot?: string
  name: string
  path: string
  sourcePath?: string
  valid: boolean
  versionWorkspaceDir?: string
  missing: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

async function readRootConfig() {
  const raw = await fs.readFile(APP_CONFIG_JSON, "utf-8")
  return JSON.parse(raw) as RootConfig
}

async function writeRootConfig(config: RootConfig) {
  const tmpPath = `${APP_CONFIG_JSON}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
  await fs.rename(tmpPath, APP_CONFIG_JSON)
}

function getConfiguredWorkspaceDir(config: RootConfig) {
  const workspaceConfig = getWorkspaceConfig(config)
  const configured = workspaceConfig?.workspaceDir
  return isNonEmptyString(configured) ? path.resolve(configured) : null
}

function getWorkspaceRootFromConfigured(configuredWorkspaceDir: string | null) {
  const workspaceRootOverride = getRequestWorkspaceRootOverride()
  if (workspaceRootOverride) return path.resolve(workspaceRootOverride)
  return configuredWorkspaceDir ?? DEFAULT_WORKSPACE_ROOT
}

function getWorkspaceConfig(config: RootConfig) {
  const current = config[WORKSPACE_CONFIG_KEY]
  if (typeof current === "object" && current !== null) return current as RootConfig["workspace"]
  const legacy = config[LEGACY_CAD_CONFIG_KEY]
  if (typeof legacy === "object" && legacy !== null) return legacy as RootConfig["workspace"]
  return null
}

function setConfiguredWorkspaceDir(config: RootConfig, workspaceDir: string) {
  config[WORKSPACE_CONFIG_KEY] = {
    ...(getWorkspaceConfig(config) ?? {}),
    workspaceDir,
  }
  delete config[LEGACY_CAD_CONFIG_KEY]
}

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function ensureWorkspaceRoot(root: string) {
  await fs.mkdir(path.join(root, WORKSPACES_DIR), { recursive: true })
}

async function readCurrentWorkspaceName(root: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, CURRENT_WORKSPACE_FILE), "utf-8")) as { name?: unknown }
    return isNonEmptyString(parsed.name) ? parsed.name.trim() : null
  } catch {
    return null
  }
}

async function writeCurrentWorkspaceName(root: string, name: string) {
  await ensureWorkspaceRoot(root)
  const filePath = path.join(root, CURRENT_WORKSPACE_FILE)
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, `${JSON.stringify({ name }, null, 2)}\n`, "utf-8")
  await fs.rename(tmpPath, filePath)
}

function isVersionWorkspaceDir(workspaceDir: string | null | undefined) {
  return !!workspaceDir && path.basename(path.dirname(workspaceDir)) === "versions"
}

async function inspectWorkspace(root: string, name: string): Promise<WorkspaceItem> {
  const workspacePath = path.join(root, name)
  const required = ["00_inputs"]
  const missing: string[] = []

  for (const dirname of required) {
    if (!await pathExists(path.join(workspacePath, dirname))) missing.push(dirname)
  }

  const versionedWorkspace = await findVersionedWorkspaceForName(root, name)

  return {
    ...(versionedWorkspace ? {
      manifestRoot: versionedWorkspace.rootDir,
      sourcePath: workspacePath,
      versionWorkspaceDir: versionedWorkspace.activeVersionDir,
    } : {}),
    name,
    path: versionedWorkspace?.activeVersionDir ?? workspacePath,
    valid: versionedWorkspace ? true : missing.length === 0,
    missing,
  }
}

async function readWorkspaceManifestSummary(manifestPath: string) {
  const raw = await fs.readFile(manifestPath, "utf-8")
  const parsed = JSON.parse(raw) as {
    activeVersionId?: unknown
    rootDir?: unknown
    versions?: unknown
  }
  const versions = Array.isArray(parsed.versions) ? parsed.versions as Array<{ id?: unknown; workspaceDir?: unknown }> : []
  const activeVersionDir = typeof parsed.activeVersionId === "string"
    ? versions.find(version => version.id === parsed.activeVersionId && typeof version.workspaceDir === "string")?.workspaceDir as string | undefined
    : undefined
  return {
    activeVersionDir: activeVersionDir && await pathExists(activeVersionDir) ? activeVersionDir : undefined,
    rootDir: typeof parsed.rootDir === "string" ? parsed.rootDir : path.dirname(manifestPath),
  }
}

async function findVersionedWorkspaceFromConfigured(configuredWorkspaceDir: string | null) {
  if (!configuredWorkspaceDir) return null
  const resolvedWorkspaceDir = path.resolve(configuredWorkspaceDir)
  let current = resolvedWorkspaceDir

  for (;;) {
    const manifestPath = path.join(current, "workspace_manifest.json")
    if (await pathExists(manifestPath)) {
      const summary = await readWorkspaceManifestSummary(manifestPath).catch(() => null)
      return {
        rootDir: summary?.rootDir ?? current,
        activeVersionDir: summary?.activeVersionDir,
      }
    }

    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function findVersionedWorkspaceForName(root: string, name: string) {
  const workspacesRoot = path.join(root, "workspaces")
  const directRoot = path.join(workspacesRoot, name)
  const sanitizedName = name.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "") || "workspace"
  const prefix = `ws_${sanitizedName}_`
  const dirents = await fs.readdir(workspacesRoot, { withFileTypes: true }).catch(() => [])
  const candidates = [
    directRoot,
    ...dirents
      .filter(dirent => dirent.isDirectory() && (dirent.name === `ws_${name}` || dirent.name.startsWith(prefix)))
      .map(dirent => path.join(workspacesRoot, dirent.name)),
  ]

  for (const candidate of candidates) {
    const manifestPath = path.join(candidate, "workspace_manifest.json")
    if (!await pathExists(manifestPath)) continue
    const summary = await readWorkspaceManifestSummary(manifestPath).catch(() => null)
    return {
      rootDir: summary?.rootDir ?? candidate,
      activeVersionDir: summary?.activeVersionDir,
    }
  }

  return null
}

export async function getWorkspaceRoot() {
  const config = await readRootConfig().catch(() => ({} as RootConfig))
  const root = getWorkspaceRootFromConfigured(getConfiguredWorkspaceDir(config))
  await ensureWorkspaceRoot(root).catch(() => {})
  return root
}

export async function getConfiguredWorkspaceDirFromConfig() {
  const config = await readRootConfig().catch(() => ({} as RootConfig))
  return getConfiguredWorkspaceDir(config)
}

export async function resolveWorkspaceDir() {
  const workspaceRootOverride = getRequestWorkspaceRootOverride()
  if (workspaceRootOverride) return path.resolve(workspaceRootOverride)
  return await getConfiguredWorkspaceDirFromConfig() ?? DEFAULT_WORKSPACE_ROOT
}

export async function listWorkspaces() {
  const config = await readRootConfig().catch(() => ({} as RootConfig))
  const configuredWorkspaceDir = getConfiguredWorkspaceDir(config)
  const workspaceRootOverride = getRequestWorkspaceRootOverride()
  const effectiveWorkspaceDir = await resolveWorkspaceDir()
  const root = getWorkspaceRootFromConfigured(configuredWorkspaceDir)
  await ensureWorkspaceRoot(root).catch(() => {})
  const configuredName = configuredWorkspaceDir && path.dirname(configuredWorkspaceDir) === root
    ? path.basename(configuredWorkspaceDir)
    : null
  const versionedWorkspace = configuredName
    ? await findVersionedWorkspaceForName(root, configuredName)
    : await findVersionedWorkspaceFromConfigured(configuredWorkspaceDir)
  const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const workspaceDirents = await fs.readdir(path.join(root, WORKSPACES_DIR), { withFileTypes: true }).catch(() => [])
  const candidateNames = new Set<string>()
  for (const dirent of dirents) {
    if (dirent.isDirectory() && !dirent.name.startsWith(".") && dirent.name !== WORKSPACES_DIR) {
      candidateNames.add(dirent.name)
    }
  }
  for (const dirent of workspaceDirents) {
    if (dirent.isDirectory() && !dirent.name.startsWith(".")) {
      candidateNames.add(dirent.name.startsWith("ws_") ? dirent.name.slice(3) : dirent.name)
    }
  }
  const items = await Promise.all(
    [...candidateNames].map(name => inspectWorkspace(root, name)),
  )
  const availableItems = items.filter(item => item.valid)
  availableItems.sort((left, right) => left.name.localeCompare(right.name))
  if (workspaceRootOverride) {
    const selectedWorkspaceName = await readCurrentWorkspaceName(root)
    const selectedWorkspace = selectedWorkspaceName
      ? availableItems.find(item => item.name === selectedWorkspaceName) ?? null
      : null
    const firstWorkspace = selectedWorkspace ?? availableItems[0] ?? null
    return {
      root,
      current: firstWorkspace?.path ?? null,
      currentName: firstWorkspace?.name ?? null,
      effective: firstWorkspace?.path ?? effectiveWorkspaceDir,
      envOverride: false,
      items: availableItems,
    }
  }
  const activeWorkspaceItem = versionedWorkspace
    ? availableItems.find(item => item.manifestRoot === versionedWorkspace.rootDir)
    : null
  const current = versionedWorkspace
    ? versionedWorkspace.activeVersionDir ??
      activeWorkspaceItem?.path ??
      (isVersionWorkspaceDir(configuredWorkspaceDir) ? null : configuredWorkspaceDir)
    : isVersionWorkspaceDir(configuredWorkspaceDir) ? null : configuredWorkspaceDir

  return {
    root,
    current,
    currentName: versionedWorkspace
      ? configuredName ?? activeWorkspaceItem?.name ?? path.basename(versionedWorkspace.rootDir)
      : configuredWorkspaceDir && path.dirname(configuredWorkspaceDir) === root
      ? path.basename(configuredWorkspaceDir)
      : null,
    effective: effectiveWorkspaceDir,
    envOverride: false,
    items: availableItems,
  }
}

function validateWorkspaceName(name: unknown) {
  if (!isNonEmptyString(name)) throw new Error("workspace name is required")
  const trimmed = name.trim()
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
    throw new Error("workspace name must be a direct child directory")
  }
  return trimmed
}

export async function setWorkspace(name: unknown) {
  const workspaceName = validateWorkspaceName(name)
  const config = await readRootConfig()
  const configuredWorkspaceDir = getConfiguredWorkspaceDir(config)
  const root = getWorkspaceRootFromConfigured(configuredWorkspaceDir)
  const workspace = await inspectWorkspace(root, workspaceName)
  if (!workspace.valid) {
    throw new Error(`workspace is missing required files: ${workspace.missing.join(", ")}`)
  }

  const relative = path.relative(root, workspace.path)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("workspace must be under the configured workspace data root")
  }
  if (getRequestWorkspaceRootOverride()) {
    await writeCurrentWorkspaceName(root, workspace.name)
  } else {
    setConfiguredWorkspaceDir(config, workspace.path)
    await writeRootConfig(config)
  }

  return {
    root,
    current: workspace.path,
    currentName: workspace.name,
    item: workspace,
  }
}

export async function setWorkspaceDir(workspaceDir: string) {
  const config = await readRootConfig()
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  setConfiguredWorkspaceDir(config, resolvedWorkspaceDir)
  await writeRootConfig(config)
  return {
    current: resolvedWorkspaceDir,
    currentName: path.basename(resolvedWorkspaceDir),
  }
}
