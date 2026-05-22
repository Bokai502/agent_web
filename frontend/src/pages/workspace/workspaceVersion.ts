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

export type VersionAction = "branch" | "checkout"

export type FreecadWorkspaceItem = {
  manifestRoot?: string
  missing?: string[]
  name: string
  path: string
  sourcePath?: string
  valid: boolean
  versionWorkspaceDir?: string
}

export type FreecadWorkspacesResponse = {
  current?: string | null
  currentName?: string | null
  effective?: string | null
  envOverride?: boolean
  items?: FreecadWorkspaceItem[]
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
  workspaceItem: FreecadWorkspaceItem | null
}

function getWorkspaceIdFromRoot(rootDir?: string | null) {
  if (!rootDir) return null
  return rootDir.split(/[\\/]/u).filter(Boolean).pop() ?? null
}

export function resolveWorkspaceVersionContext({
  branchManifest,
  fallbackWorkspaceName,
  workspaces,
}: {
  branchManifest: WorkspaceManifestSummary | null
  fallbackWorkspaceName: string
  workspaces: FreecadWorkspacesResponse | null
}): WorkspaceVersionContext {
  const workspaceItems = workspaces?.items ?? []
  const currentWorkspaceDir = workspaces?.current ?? workspaces?.effective ?? null
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
    workspaces?.effective?.split(/[\\/]/u).pop() ??
    fallbackWorkspaceName
  const currentWorkspaceItem = listedCurrentWorkspace ?? workspaceItems.find(item => item.name === currentWorkspaceName) ?? null
  const currentManifestLocatorDir = currentWorkspaceItem?.manifestRoot ?? currentWorkspaceItem?.versionWorkspaceDir ?? currentWorkspaceDir
  const activeVersion = getActiveVersion(branchManifest)
  const activeVersionWorkspaceDir = activeVersion?.workspaceDir ??
    currentWorkspaceItem?.versionWorkspaceDir ??
    currentWorkspaceDir
  const workspaceRoot = branchManifest?.rootDir ?? currentWorkspaceItem?.manifestRoot ?? null
  const workspaceId = branchManifest?.workspaceId ?? getWorkspaceIdFromRoot(workspaceRoot)
  const versionId = branchManifest?.activeVersionId ?? activeVersion?.id ?? null

  return {
    manifestRoot: currentManifestLocatorDir,
    manifestSessionId: branchManifest?.sessionId ?? null,
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

export function fetchFreecadWorkspaces() {
  return fetch("/api/freecad/workspaces", { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<FreecadWorkspacesResponse> : null)
}

export function fetchWorkspaceManifest({
  workspaceKey,
  workspaceId,
  manifestRoot,
  sourceWorkspaceDir,
}: {
  workspaceKey?: string | null
  workspaceId?: string | null
  manifestRoot: string
  sourceWorkspaceDir?: string | null
}) {
  const params = new URLSearchParams({ initialize: "1" })
  params.set("workspaceDir", manifestRoot)
  if (sourceWorkspaceDir) params.set("sourceWorkspaceDir", sourceWorkspaceDir)
  if (workspaceKey && !workspaceId) params.set("workspaceKey", workspaceKey)
  const path = workspaceId
    ? `/api/workspace-index/${encodeURIComponent(workspaceId)}/manifest`
    : "/api/workspace-manifest"
  return fetch(`${path}?${params.toString()}`, { cache: "no-store" })
    .then(response => response.ok ? response.json() as Promise<WorkspaceManifestSummary> : null)
}

export function checkoutWorkspaceVersion({
  versionId,
  workspaceKey,
  workspaceId,
  workspaceDir,
}: {
  versionId: string
  workspaceKey?: string | null
  workspaceId?: string | null
  workspaceDir?: string | null
}) {
  return fetch(`/api/versions/${encodeURIComponent(versionId)}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceDir, workspaceId, workspaceKey }),
  }).then(response => readJsonResponse<WorkspaceManifestSummary>(response, "version checkout failed"))
}

export function branchWorkspaceVersion({
  baseVersionId,
  label,
  workspaceKey,
  workspaceId,
  workspaceDir,
}: {
  baseVersionId: string
  label: string
  workspaceKey?: string | null
  workspaceId?: string | null
  workspaceDir?: string | null
}) {
  return fetch(`/api/versions/${encodeURIComponent(baseVersionId)}/branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, workspaceDir, workspaceId, workspaceKey }),
  }).then(response => readJsonResponse<{ manifest?: WorkspaceManifestSummary }>(response, "version branch failed"))
}

export function switchFreecadWorkspace(name: string) {
  return fetch("/api/freecad/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then(response => readJsonResponse<unknown>(response, "workspace switch failed"))
}
