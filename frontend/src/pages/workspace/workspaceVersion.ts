import { joinApiPath } from "../../app/apiBase"

export type WorkspaceManifestSummary = {
  activeVersionId: string | null
  rootDir?: string
  sessionId?: string
  versions?: VersionSummary[]
  workspaceId?: string
}

export type VersionSummary = {
  id?: string
  parentVersionId?: string | null
  status?: string
  workspaceDir?: string
}

export type VersionTreeNode = {
  children: VersionTreeNode[]
  version: VersionSummary
}

export type VersionAction = "branch" | "checkout" | "delete"

export type WorkspaceItem = {
  manifestRoot?: string
  missing?: string[]
  name: string
  path: string
  sourcePath?: string
  valid: boolean
  versionWorkspaceDir?: string
}

export type WorkspacesResponse = {
  current?: string | null
  currentName?: string | null
  effective?: string | null
  envOverride?: boolean
  items?: WorkspaceItem[]
  root?: string
}

export type WorkspaceVersionContext = {
  manifestRoot: string | null
  manifestSessionId: string | null
  sourceWorkspaceDir: string | null
  versionId: string | null
  versionDir: string | null
  workspaceId: string | null
  workspaceKey: string | null
  workspaceName: string
  workspaceRoot: string | null
  workspaceItem: WorkspaceItem | null
}

export type WorkspaceIdentity = {
  manifestRoot?: string | null
  sourceWorkspaceDir?: string | null
  versionDir?: string | null
  workspaceId?: string | null
  workspaceKey?: string | null
  workspaceName?: string | null
  workspaceRoot?: string | null
}

function isVersionWorkspaceDir(value?: string | null) {
  return /[\\/]versions[\\/][^\\/]+$/u.test(value ?? "")
}

function getWorkspaceIdFromRoot(rootDir?: string | null) {
  if (!rootDir) return null
  return rootDir.split(/[\\/]/u).filter(Boolean).pop() ?? null
}

function getWorkspaceIdentitySegments(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .split(/[\\/]+/u)
    .map(segment => segment.replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, ""))
    .flatMap(segment => [segment, segment.replace(/^ws_/u, "")])
    .filter(Boolean)
}

export function isThermalCadWorkspace(context: WorkspaceIdentity) {
  const segments = [
    context.workspaceName,
    context.workspaceId,
    context.workspaceKey,
    context.workspaceRoot,
    context.manifestRoot,
    context.sourceWorkspaceDir,
    context.versionDir,
  ].flatMap(getWorkspaceIdentitySegments)

  return segments.some(segment => segment === "thermal" || segment === "thermal_catch")
}

export function resolveWorkspaceVersionContext({
  branchManifest,
  fallbackWorkspaceName,
  workspaces,
}: {
  branchManifest: WorkspaceManifestSummary | null
  fallbackWorkspaceName: string
  workspaces: WorkspacesResponse | null
}): WorkspaceVersionContext {
  const workspaceItems = workspaces?.items ?? []
  const hasCurrentWorkspace = workspaces ? Object.prototype.hasOwnProperty.call(workspaces, "current") : false
  const currentWorkspaceDir = hasCurrentWorkspace ? workspaces?.current ?? null : workspaces?.effective ?? null
  const listedCurrentWorkspace = workspaceItems.find(item =>
    (!!workspaces?.currentName && item.name === workspaces.currentName) ||
    (!!currentWorkspaceDir && (
      item.path === currentWorkspaceDir ||
      item.versionWorkspaceDir === currentWorkspaceDir ||
      item.manifestRoot === currentWorkspaceDir
    )),
  ) ?? null
  const currentWorkspaceName = listedCurrentWorkspace?.name ??
    workspaces?.currentName ??
    (!hasCurrentWorkspace ? workspaces?.effective?.split(/[\\/]/u).pop() : null) ??
    fallbackWorkspaceName
  const currentWorkspaceItem = listedCurrentWorkspace ?? workspaceItems.find(item => item.name === currentWorkspaceName) ?? null
  const currentManifestLocatorDir = currentWorkspaceItem?.manifestRoot ?? currentWorkspaceItem?.versionWorkspaceDir ?? currentWorkspaceDir
  const manifestMatchesCurrentWorkspace = !!branchManifest && (
    (!!currentWorkspaceItem?.manifestRoot && branchManifest.rootDir === currentWorkspaceItem.manifestRoot) ||
    (!!currentManifestLocatorDir && branchManifest.rootDir === currentManifestLocatorDir) ||
    (!!currentWorkspaceItem?.manifestRoot && branchManifest.workspaceId === getWorkspaceIdFromRoot(currentWorkspaceItem.manifestRoot))
  )
  const currentManifest = manifestMatchesCurrentWorkspace ? branchManifest : null
  const activeVersion = getActiveVersion(currentManifest)
  const activeVersionWorkspaceDir = activeVersion?.workspaceDir ??
    (isVersionWorkspaceDir(currentWorkspaceItem?.versionWorkspaceDir) ? currentWorkspaceItem?.versionWorkspaceDir : null) ??
    (isVersionWorkspaceDir(currentWorkspaceDir) ? currentWorkspaceDir : null)
  const workspaceRoot = currentManifest?.rootDir ?? currentWorkspaceItem?.manifestRoot ?? null
  const workspaceId = currentManifest?.workspaceId ?? getWorkspaceIdFromRoot(workspaceRoot)
  const versionId = activeVersion?.id ?? null

  return {
    manifestRoot: currentManifestLocatorDir,
    manifestSessionId: currentManifest?.sessionId ?? null,
    sourceWorkspaceDir: currentWorkspaceDir,
    versionId,
    versionDir: activeVersionWorkspaceDir,
    workspaceId,
    workspaceKey: workspaceId ?? currentWorkspaceName,
    workspaceItem: currentWorkspaceItem,
    workspaceName: currentWorkspaceName,
    workspaceRoot,
  }
}

export function getActiveVersion(manifest: WorkspaceManifestSummary | null) {
  return manifest?.versions?.find(version => version.id === manifest.activeVersionId) ?? null
}

export function getVersionWorkspaceKey(
  manifest: WorkspaceManifestSummary | null,
  currentWorkspaceName: string,
) {
  return manifest?.workspaceId ?? currentWorkspaceName
}

export function buildVersionTree(manifest: WorkspaceManifestSummary | null): VersionTreeNode[] {
  const versions = manifest?.versions ?? []
  const nodes = new Map<string, VersionTreeNode>()
  const roots: VersionTreeNode[] = []

  versions.forEach(version => {
    if (version.id) nodes.set(version.id, { children: [], version })
  })
  versions.forEach(version => {
    const node = version.id ? nodes.get(version.id) : null
    if (!node) return
    const parentNode = version.parentVersionId ? nodes.get(version.parentVersionId) : null
    if (parentNode) parentNode.children.push(node)
    else roots.push(node)
  })

  const sortNodes = (items: VersionTreeNode[]) => {
    items.sort((left, right) => (left.version.id ?? "").localeCompare(right.version.id ?? ""))
    items.forEach(item => sortNodes(item.children))
  }
  sortNodes(roots)
  return roots
}

async function readJsonResponse<T>(response: Response, fallbackMessage: string) {
  if (!response.ok) throw new Error(fallbackMessage)
  return response.json() as Promise<T>
}

export function fetchWorkspaces(apiBase?: string) {
  return fetch(joinApiPath(apiBase, "/workspace/workspaces"), { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<WorkspacesResponse> : null)
}

export function fetchWorkspaceManifest({
  workspaceKey,
  workspaceId,
  manifestRoot,
  sourceWorkspaceDir,
  initialize = false,
  apiBase,
}: {
  apiBase?: string
  initialize?: boolean
  workspaceKey?: string | null
  workspaceId?: string | null
  manifestRoot: string
  sourceWorkspaceDir?: string | null
}) {
  const params = new URLSearchParams()
  if (initialize) params.set("initialize", "1")
  params.set("workspaceDir", manifestRoot)
  if (sourceWorkspaceDir) params.set("sourceWorkspaceDir", sourceWorkspaceDir)
  if (workspaceKey && !workspaceId) params.set("workspaceKey", workspaceKey)
  const path = workspaceId
    ? joinApiPath(apiBase, `/workspace-index/${encodeURIComponent(workspaceId)}/manifest`)
    : joinApiPath(apiBase, "/workspace-manifest")
  return fetch(`${path}?${params.toString()}`, { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<WorkspaceManifestSummary> : null)
}

export function checkoutWorkspaceVersion({
  versionId,
  workspaceKey,
  workspaceId,
  workspaceDir,
  apiBase,
}: {
  apiBase?: string
  versionId: string
  workspaceKey?: string | null
  workspaceId?: string | null
  workspaceDir?: string | null
}) {
  return fetch(joinApiPath(apiBase, `/versions/${encodeURIComponent(versionId)}/checkout`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceDir, workspaceId, workspaceKey }),
  }).then(response => readJsonResponse<WorkspaceManifestSummary>(response, "version checkout failed"))
}

export function branchWorkspaceVersion({
  baseVersionId,
  group = "xieteam",
  label,
  workspaceKey,
  workspaceId,
  workspaceDir,
  apiBase,
}: {
  apiBase?: string
  baseVersionId: string
  group?: string
  label: string
  workspaceKey?: string | null
  workspaceId?: string | null
  workspaceDir?: string | null
}) {
  return fetch(joinApiPath(apiBase, `/versions/${encodeURIComponent(baseVersionId)}/branch`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group, label, workspaceDir, workspaceId, workspaceKey }),
  }).then(response => readJsonResponse<{ manifest?: WorkspaceManifestSummary }>(response, "version branch failed"))
}

export function deleteWorkspaceVersion({
  versionId,
  workspaceKey,
  workspaceId,
  workspaceDir,
  apiBase,
}: {
  apiBase?: string
  versionId: string
  workspaceKey?: string | null
  workspaceId?: string | null
  workspaceDir?: string | null
}) {
  return fetch(joinApiPath(apiBase, `/versions/${encodeURIComponent(versionId)}`), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceDir, workspaceId, workspaceKey }),
  }).then(response => readJsonResponse<{ manifest?: WorkspaceManifestSummary }>(response, "version delete failed"))
}

export function switchWorkspace(name: string, apiBase?: string) {
  return fetch(joinApiPath(apiBase, "/workspace/workspace"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(response => readJsonResponse<unknown>(response, "workspace switch failed"))
}
