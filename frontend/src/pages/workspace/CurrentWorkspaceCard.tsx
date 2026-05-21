import { useCallback } from "react"

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

type CurrentWorkspaceCardProps = {
  activeManifestVersion: VersionSummary | null
  branchManifest: WorkspaceManifestSummary | null
  currentWorkspaceName: string
  manifestLoading: boolean
  onCheckoutVersion: (versionId: string) => void
  onCreateChildBranch: (baseVersionId?: string) => void
  onCreateSiblingBranch: () => void
  onSelectWorkspace: (name: string) => void
  onToggleVersionList: () => void
  onToggleWorkspaceList: () => void
  versionAction: VersionAction | null
  versionError: string
  versionListOpen: boolean
  versionTreeRoots: VersionTreeNode[]
  workspaceChanging: boolean
  workspaceItems: FreecadWorkspaceItem[]
  workspaceListOpen: boolean
}

export function CurrentWorkspaceCard({
  activeManifestVersion,
  branchManifest,
  currentWorkspaceName,
  manifestLoading,
  onCheckoutVersion,
  onCreateChildBranch,
  onCreateSiblingBranch,
  onSelectWorkspace,
  onToggleVersionList,
  onToggleWorkspaceList,
  versionAction,
  versionError,
  versionListOpen,
  versionTreeRoots,
  workspaceChanging,
  workspaceItems,
  workspaceListOpen,
}: CurrentWorkspaceCardProps) {
  const renderVersionNode = useCallback((node: VersionTreeNode) => {
    const versionId = node.version.id ?? ""
    const isActive = versionId === branchManifest?.activeVersionId
    return (
      <div className="wa-version-branch" key={versionId}>
        <button
          type="button"
          className={`wa-version-row${isActive ? " active" : ""}`}
          disabled={!versionId || isActive || versionAction !== null}
          onClick={() => onCheckoutVersion(versionId)}
          title={isActive ? `${versionId} is active` : `Switch to ${versionId}`}
        >
          <strong>{versionId || "-"}</strong>
        </button>
        {node.children.length > 0 && (
          <div className="wa-version-children">
            {node.children.map(child => renderVersionNode(child))}
          </div>
        )}
      </div>
    )
  }, [branchManifest?.activeVersionId, onCheckoutVersion, versionAction])

  return (
    <section className="wa-info-card">
      <div className="wa-version-card-header">
        <h3>当前工作区</h3>
      </div>
      {manifestLoading && <p>Loading branch state...</p>}
      <div className="wa-current-context">
        <div>
          <span>Workspace</span>
          <strong>{currentWorkspaceName}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{branchManifest?.activeVersionId ?? "-"}</strong>
        </div>
      </div>
      <button
        type="button"
        className="wa-version-toggle"
        disabled={workspaceChanging}
        onClick={onToggleWorkspaceList}
        aria-expanded={workspaceListOpen}
        aria-label={workspaceListOpen ? "Collapse workspaces" : "Expand workspaces"}
      >
        <span>Workspaces</span>
        <strong>{workspaceItems.length}</strong>
        <em>{workspaceListOpen ? "-" : "+"}</em>
      </button>
      {workspaceListOpen && (
        <div className="wa-branch-workspaces">
          {workspaceItems.length > 0 ? workspaceItems.map(item => (
            <button
              type="button"
              className={`wa-branch-workspace-row${item.name === currentWorkspaceName ? " active" : ""}`}
              disabled={item.name === currentWorkspaceName || workspaceChanging}
              key={item.name}
              onClick={() => onSelectWorkspace(item.name)}
              title={item.path}
            >
              <span>
                <strong>{item.name}</strong>
                <small>{item.valid ? "Ready" : item.missing?.length ? `Missing ${item.missing.join(", ")}` : "Unavailable"}</small>
              </span>
              <em>{item.name === currentWorkspaceName ? "Active" : "Switch"}</em>
            </button>
          )) : (
            <span className="wa-version-empty">No workspaces</span>
          )}
        </div>
      )}
      {versionError && <p className="wa-version-error">{versionError}</p>}
      <button
        type="button"
        className="wa-version-toggle"
        onClick={onToggleVersionList}
        aria-expanded={versionListOpen}
        aria-label={versionListOpen ? "Collapse branches" : "Expand branches"}
      >
        <span>Branches</span>
        <strong>{branchManifest?.versions?.length ?? 0}</strong>
        <em>{versionListOpen ? "-" : "+"}</em>
      </button>
      {versionListOpen && (
        <div className="wa-version-branches">
          <div className="wa-version-create-actions">
            <button
              type="button"
              disabled={!branchManifest?.activeVersionId || versionAction !== null}
              onClick={() => onCreateChildBranch(branchManifest?.activeVersionId ?? undefined)}
            >
              {versionAction === "branch" ? "Creating..." : "New branch"}
            </button>
            <button
              type="button"
              disabled={!activeManifestVersion?.parentVersionId || versionAction !== null}
              onClick={onCreateSiblingBranch}
            >
              {activeManifestVersion?.parentVersionId ? "Sibling branch" : "No parent"}
            </button>
          </div>
          <div className="wa-version-tree">
            {versionTreeRoots.map(root => renderVersionNode(root))}
            {versionTreeRoots.length === 0 && (
              <span className="wa-version-empty">No branches</span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
