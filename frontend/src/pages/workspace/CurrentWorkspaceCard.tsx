import { useCallback } from "react"
import type {
  WorkspaceItem,
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
  workspaceItems: WorkspaceItem[]
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

  const activeVersionId = branchManifest?.activeVersionId ?? "-"

  return (
    <section className="wa-info-card wa-task-card">
      <div className="wa-version-card-header wa-task-card-header">
        <div>
          <h3>当前任务</h3>
          <p>{currentWorkspaceName} · {activeVersionId}</p>
        </div>
      </div>
      {manifestLoading && <p>正在加载版本状态...</p>}
      <div className="wa-current-context">
        <button
          type="button"
          disabled={workspaceChanging}
          onClick={onToggleWorkspaceList}
          aria-expanded={workspaceListOpen}
          aria-label={workspaceListOpen ? "收起任务" : "选择任务"}
        >
          <span>任务</span>
          <strong>{currentWorkspaceName}</strong>
          <em>{workspaceListOpen ? "⌃" : "⌄"}</em>
        </button>
        <button
          type="button"
          onClick={onToggleVersionList}
          aria-expanded={versionListOpen}
          aria-label={versionListOpen ? "收起版本" : "选择版本"}
        >
          <span>当前版本</span>
          <strong>{activeVersionId}</strong>
          <em>{versionListOpen ? "⌃" : "⌄"}</em>
        </button>
      </div>
      {workspaceListOpen && (
        <div className="wa-context-popover wa-task-picker">
          <div className="wa-context-popover-header">
            <span>选择任务</span>
            <strong>{workspaceItems.length}</strong>
          </div>
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
            <span className="wa-version-empty">暂无任务</span>
          )}
        </div>
      )}
      {versionError && <p className="wa-version-error">{versionError}</p>}
      {versionListOpen && (
        <div className="wa-context-popover wa-version-picker">
          <div className="wa-context-popover-header">
            <span>选择版本</span>
            <div className="wa-version-header-actions">
              <strong>{branchManifest?.versions?.length ?? 0}</strong>
              <button
                type="button"
                disabled={!branchManifest?.activeVersionId || versionAction !== null}
                onClick={() => onCreateChildBranch(branchManifest?.activeVersionId ?? undefined)}
              >
                {versionAction === "branch" ? "创建中..." : "基于当前新建"}
              </button>
              <button
                type="button"
                disabled={!activeManifestVersion?.parentVersionId || versionAction !== null}
                onClick={onCreateSiblingBranch}
              >
                {activeManifestVersion?.parentVersionId ? "新建并列版本" : "无父版本"}
              </button>
            </div>
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
