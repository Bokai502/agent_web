import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const BACKEND_SRC_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(BACKEND_SRC_DIR, "..", "..", "..")
const ROOT_CONFIG_JSON = path.join(PROJECT_ROOT, "config.json")
const DEFAULT_WORKSPACE_ROOT = path.join(PROJECT_ROOT, "FreeCAD_data")

type RootConfig = {
  freecad?: {
    workspaceDir?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type FreecadWorkspaceItem = {
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
  const raw = await fs.readFile(ROOT_CONFIG_JSON, "utf-8")
  return JSON.parse(raw) as RootConfig
}

async function writeRootConfig(config: RootConfig) {
  const tmpPath = `${ROOT_CONFIG_JSON}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
  await fs.rename(tmpPath, ROOT_CONFIG_JSON)
}

function getConfiguredWorkspaceDir(config: RootConfig) {
  const configured = config.freecad?.workspaceDir
  return isNonEmptyString(configured) ? path.resolve(configured) : null
}

function getWorkspaceRootFromConfigured(configuredWorkspaceDir: string | null) {
  if (!configuredWorkspaceDir) return DEFAULT_WORKSPACE_ROOT
  const parent = path.dirname(configuredWorkspaceDir)
  if (path.basename(parent) === "FreeCAD_data") return parent
  if (path.basename(configuredWorkspaceDir) === "FreeCAD_data") return configuredWorkspaceDir
  return DEFAULT_WORKSPACE_ROOT
}

async function pathExists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

function isVersionWorkspaceDir(workspaceDir: string | null | undefined) {
  return !!workspaceDir && path.basename(path.dirname(workspaceDir)) === "versions"
}

async function inspectWorkspace(root: string, name: string): Promise<FreecadWorkspaceItem> {
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
    valid: missing.length === 0,
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

export async function getFreecadWorkspaceRoot() {
  const config = await readRootConfig().catch(() => ({} as RootConfig))
  return getWorkspaceRootFromConfigured(getConfiguredWorkspaceDir(config))
}

export async function getConfiguredFreecadWorkspaceDir() {
  const config = await readRootConfig().catch(() => ({} as RootConfig))
  return getConfiguredWorkspaceDir(config)
}

export async function resolveFreecadWorkspaceDir() {
  return await getConfiguredFreecadWorkspaceDir() ?? DEFAULT_WORKSPACE_ROOT
}

export async function listFreecadWorkspaces() {
  const config = await readRootConfig().catch(() => ({} as RootConfig))
  const configuredWorkspaceDir = getConfiguredWorkspaceDir(config)
  const effectiveWorkspaceDir = await resolveFreecadWorkspaceDir()
  const root = getWorkspaceRootFromConfigured(configuredWorkspaceDir)
  const configuredName = configuredWorkspaceDir && path.dirname(configuredWorkspaceDir) === root
    ? path.basename(configuredWorkspaceDir)
    : null
  const versionedWorkspace = configuredName
    ? await findVersionedWorkspaceForName(root, configuredName)
    : await findVersionedWorkspaceFromConfigured(configuredWorkspaceDir)
  const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const items = await Promise.all(
    dirents
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith("."))
      .map(dirent => inspectWorkspace(root, dirent.name)),
  )
  const availableItems = items.filter(item => item.valid)
  availableItems.sort((left, right) => left.name.localeCompare(right.name))
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

export async function setFreecadWorkspace(name: unknown) {
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
    throw new Error("workspace must be under the configured FreeCAD_data root")
  }
  config.freecad = {
    ...(config.freecad ?? {}),
    workspaceDir: workspace.path,
  }

  await writeRootConfig(config)

  return {
    root,
    current: workspace.path,
    currentName: workspace.name,
    item: workspace,
  }
}

export async function setFreecadWorkspaceDir(workspaceDir: string) {
  const config = await readRootConfig()
  const resolvedWorkspaceDir = path.resolve(workspaceDir)
  config.freecad = {
    ...(config.freecad ?? {}),
    workspaceDir: resolvedWorkspaceDir,
  }
  await writeRootConfig(config)
  return {
    current: resolvedWorkspaceDir,
    currentName: path.basename(resolvedWorkspaceDir),
  }
}
