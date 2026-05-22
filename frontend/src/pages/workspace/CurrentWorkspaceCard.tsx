import { useCallback } from "react"
import type {
  FreecadWorkspaceItem,
  VersionAction,
  VersionSummary,
  VersionTreeNode,
  WorkspaceManifestSummary,
} from "./workspaceVersion"

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
          title={isActive ? `${versionId} 为当前版本` : `切换到 ${versionId}`}
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
      {manifestLoading && <p>正在加载版本状态...</p>}
      <div className="wa-current-context">
        <div>
          <span>工作区</span>
          <strong>{currentWorkspaceName}</strong>
        </div>
        <div>
          <span>版本</span>
          <strong>{branchManifest?.activeVersionId ?? "-"}</strong>
        </div>
      </div>
      <button
        type="button"
        className="wa-version-toggle"
        disabled={workspaceChanging}
        onClick={onToggleWorkspaceList}
        aria-expanded={workspaceListOpen}
        aria-label={workspaceListOpen ? "收起工作区" : "展开工作区"}
      >
        <span>工作区</span>
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
                {!item.valid && (
                  <small>{item.missing?.length ? `缺少 ${item.missing.join(", ")}` : "不可用"}</small>
                )}
              </span>
              <em>{item.name === currentWorkspaceName ? "当前" : "切换"}</em>
            </button>
          )) : (
            <span className="wa-version-empty">暂无工作区</span>
          )}
        </div>
      )}
      {versionError && <p className="wa-version-error">{versionError}</p>}
      <button
        type="button"
        className="wa-version-toggle"
        onClick={onToggleVersionList}
        aria-expanded={versionListOpen}
        aria-label={versionListOpen ? "收起版本" : "展开版本"}
      >
        <span>版本</span>
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
              {versionAction === "branch" ? "创建中..." : "新建子版本"}
            </button>
            <button
              type="button"
              disabled={!activeManifestVersion?.parentVersionId || versionAction !== null}
              onClick={onCreateSiblingBranch}
            >
              {activeManifestVersion?.parentVersionId ? "新建同级版本" : "无父版本"}
            </button>
          </div>
          <div className="wa-version-tree">
            {versionTreeRoots.map(root => renderVersionNode(root))}
            {versionTreeRoots.length === 0 && (
              <span className="wa-version-empty">暂无版本</span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
