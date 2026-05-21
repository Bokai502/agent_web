#!/usr/bin/env node
import fs from "node:fs/promises"
import path from "node:path"

const VERSION_DIR_PATTERN = /^v\d{4,}$/u

function usage() {
  console.error(`Usage:
  node scripts/reconcile-workspace-versions.mjs --workspace-id <workspaceId> [--active latest|keep|v0007]
  node scripts/reconcile-workspace-versions.mjs --workspace-root <rootDir> [--active latest|keep|v0007]

Options:
  --data-root <dir>       Defaults to /data/lbk/codex_web/FreeCAD_data
  --workspace-id <id>     Workspace id from workspaces/index.json
  --workspace-root <dir>  Workspace root containing workspace_manifest.json
  --active <value>        latest (default), keep, or an explicit version id
  --dry-run               Print the planned changes without writing files
`)
}

function parseArgs(argv) {
  const args = {
    active: "latest",
    dataRoot: "/data/lbk/codex_web/FreeCAD_data",
    dryRun: false,
    workspaceId: null,
    workspaceRoot: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--dry-run") {
      args.dryRun = true
      continue
    }
    if (arg === "--active" || arg === "--data-root" || arg === "--workspace-id" || arg === "--workspace-root") {
      const value = argv[index + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      index += 1
      if (arg === "--active") args.active = value
      if (arg === "--data-root") args.dataRoot = path.resolve(value)
      if (arg === "--workspace-id") args.workspaceId = value
      if (arg === "--workspace-root") args.workspaceRoot = path.resolve(value)
      continue
    }
    if (arg === "-h" || arg === "--help") {
      usage()
      process.exit(0)
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

async function pathExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false)
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf-8"))
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
}

async function readWorkspaceIndex(dataRoot) {
  const indexPath = path.join(dataRoot, "workspaces", "index.json")
  const index = await readJson(indexPath)
  if (!Array.isArray(index.workspaces)) throw new Error(`invalid workspace index: ${indexPath}`)
  return { index, indexPath }
}

async function resolveWorkspace(args) {
  if (args.workspaceRoot) {
    return { workspace: null, workspaceRoot: args.workspaceRoot, index: null, indexPath: null }
  }
  if (!args.workspaceId) throw new Error("--workspace-id or --workspace-root is required")
  const { index, indexPath } = await readWorkspaceIndex(args.dataRoot)
  const workspace = index.workspaces.find(item => item?.id === args.workspaceId)
  if (!workspace) throw new Error(`workspace not found in index: ${args.workspaceId}`)
  if (!workspace.rootDir) throw new Error(`workspace has no rootDir: ${args.workspaceId}`)
  return { workspace, workspaceRoot: path.resolve(workspace.rootDir), index, indexPath }
}

function chooseActiveVersion({ active, currentActiveVersionId, versionIds }) {
  if (active === "keep") return currentActiveVersionId
  if (active === "latest") return versionIds.at(-1) ?? currentActiveVersionId
  if (!VERSION_DIR_PATTERN.test(active)) throw new Error("--active must be latest, keep, or a version id like v0007")
  if (!versionIds.includes(active)) throw new Error(`active version directory does not exist: ${active}`)
  return active
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { workspace, workspaceRoot, index, indexPath } = await resolveWorkspace(args)
  const manifestPath = path.join(workspaceRoot, "workspace_manifest.json")
  const versionsDir = path.join(workspaceRoot, "versions")
  const manifest = await readJson(manifestPath)
  if (!await pathExists(versionsDir)) throw new Error(`versions directory does not exist: ${versionsDir}`)

  const dirents = await fs.readdir(versionsDir, { withFileTypes: true })
  const versionIds = dirents
    .filter(dirent => dirent.isDirectory() && VERSION_DIR_PATTERN.test(dirent.name))
    .map(dirent => dirent.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const knownIds = new Set(Array.isArray(manifest.versions) ? manifest.versions.map(item => item.id) : [])
  const missingIds = versionIds.filter(id => !knownIds.has(id))
  const timestamp = new Date().toISOString()
  const importedParentId = manifest.activeVersionId && knownIds.has(manifest.activeVersionId)
    ? manifest.activeVersionId
    : (Array.isArray(manifest.versions) && manifest.versions[0]?.id) || null
  const importedVersions = []

  for (const versionId of missingIds) {
    const workspaceDir = path.join(workspaceRoot, "versions", versionId)
    const stat = await fs.stat(workspaceDir)
    importedVersions.push({
      id: versionId,
      parentVersionId: importedParentId,
      label: "Imported existing version directory",
      status: "archived",
      workspaceDir,
      createdByRunId: null,
      createdAt: stat.birthtime?.toISOString?.() ?? timestamp,
      updatedAt: stat.mtime?.toISOString?.() ?? timestamp,
      artifactRefs: {},
      checkpointIds: [],
    })
  }

  const nextActiveVersionId = chooseActiveVersion({
    active: args.active,
    currentActiveVersionId: manifest.activeVersionId ?? null,
    versionIds,
  })
  const nextVersions = [...(Array.isArray(manifest.versions) ? manifest.versions : []), ...importedVersions]
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
    .map(version => ({
      ...version,
      status: version.id === nextActiveVersionId ? "active" : (version.status === "failed" ? "failed" : "archived"),
      updatedAt: version.id === nextActiveVersionId ? timestamp : version.updatedAt,
    }))
  const nextManifest = {
    ...manifest,
    activeVersionId: nextActiveVersionId,
    versions: nextVersions,
    updatedAt: timestamp,
  }

  let nextIndex = null
  if (workspace && index) {
    nextIndex = {
      ...index,
      updatedAt: timestamp,
      workspaces: index.workspaces.map(item => item.id === workspace.id
        ? { ...item, defaultVersionId: nextActiveVersionId, updatedAt: timestamp }
        : item),
    }
  }

  const result = {
    activeVersionId: nextActiveVersionId,
    dryRun: args.dryRun,
    importedVersionIds: missingIds,
    manifestPath,
    versionIds,
    workspaceId: manifest.workspaceId ?? workspace?.id ?? path.basename(workspaceRoot),
    workspaceRoot,
  }

  if (!args.dryRun) {
    await writeJson(manifestPath, nextManifest)
    if (nextIndex && indexPath) await writeJson(indexPath, nextIndex)
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err))
  usage()
  process.exit(1)
})
