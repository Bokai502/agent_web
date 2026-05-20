import fs from "fs/promises"
import path from "path"

const ROOT_CONFIG_JSON = path.resolve(process.cwd(), "..", "..", "config.json")
const DEFAULT_WORKSPACE_ROOT = path.resolve(process.cwd(), "..", "..", "FreeCAD_data")

type RootConfig = {
  freecad?: {
    workspaceDir?: unknown
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type FreecadWorkspaceItem = {
  name: string
  path: string
  valid: boolean
  missing: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== ""
}

async function readRootConfig() {
  const raw = await fs.readFile(ROOT_CONFIG_JSON, "utf-8")
  return JSON.parse(raw) as RootConfig
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

async function inspectWorkspace(root: string, name: string): Promise<FreecadWorkspaceItem> {
  const workspacePath = path.join(root, name)
  const required = ["00_inputs", "01_layout", "component_info", "logs"]
  const missing: string[] = []

  for (const dirname of required) {
    if (!await pathExists(path.join(workspacePath, dirname))) missing.push(dirname)
  }

  return {
    name,
    path: workspacePath,
    valid: missing.length === 0,
    missing,
  }
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
  const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const items = await Promise.all(
    dirents
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith("."))
      .map(dirent => inspectWorkspace(root, dirent.name)),
  )
  items.sort((left, right) => left.name.localeCompare(right.name))

  return {
    root,
    current: configuredWorkspaceDir,
    currentName: configuredWorkspaceDir && path.dirname(configuredWorkspaceDir) === root
      ? path.basename(configuredWorkspaceDir)
      : null,
    effective: effectiveWorkspaceDir,
    envOverride: false,
    items,
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

  const relative = path.relative(root, workspace.path)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("workspace must be under the configured FreeCAD_data root")
  }
  config.freecad = {
    ...(config.freecad ?? {}),
    workspaceDir: workspace.path,
  }

  const tmpPath = `${ROOT_CONFIG_JSON}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8")
  await fs.rename(tmpPath, ROOT_CONFIG_JSON)

  return {
    root,
    current: workspace.path,
    currentName: workspace.name,
    item: workspace,
  }
}
