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
  onCancelDeleteVersion: () => void
  onConfirmDeleteVersion: () => Promise<void>
  onCreateChildBranch: (baseVersionId?: string) => void
  onCreateInitialVersion: () => void
  onCreateSiblingBranch: () => void
  onRequestDeleteVersion: (versionId: string) => void
  onSelectWorkspace: (name: string) => void
  onToggleVersionList: () => void
  onToggleWorkspaceList: () => void
  versionAction: VersionAction | null
  versionDeleteTarget: string | null
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
  onCancelDeleteVersion,
  onConfirmDeleteVersion,
  onCreateChildBranch,
  onCreateInitialVersion,
  onCreateSiblingBranch,
  onRequestDeleteVersion,
  onSelectWorkspace,
  onToggleVersionList,
  onToggleWorkspaceList,
  versionAction,
  versionDeleteTarget,
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
    const canDelete = !!versionId && versionAction !== "delete"
    return (
      <div className="wa-version-branch" key={versionId}>
        <div className={`wa-version-node${isActive ? " active" : ""}`}>
          <button
            type="button"
            className={`wa-version-row${isActive ? " active" : ""}`}
            disabled={!versionId || isActive || versionAction !== null}
            onClick={() => onCheckoutVersion(versionId)}
            title={isActive ? `${versionId} 为当前版本` : `切换到 ${versionId}`}
          >
            <strong>{versionId || "-"}</strong>
          </button>
          <button
            type="button"
            className="wa-version-delete"
            disabled={!canDelete || versionAction !== null}
            onClick={() => onRequestDeleteVersion(versionId)}
            title={`删除 ${versionId}`}
            aria-label={`删除 ${versionId}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5h6" />
              <path d="M10 5l1-2h2l1 2" />
              <path d="M5 7h14" />
              <path d="M7 7l1 14h8l1-14" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        </div>
        {node.children.length > 0 && (
          <div className="wa-version-children">
            {node.children.map(child => renderVersionNode(child))}
          </div>
        )}
      </div>
    )
  }, [branchManifest?.activeVersionId, onCheckoutVersion, onRequestDeleteVersion, versionAction])

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
              <div className="wa-version-empty-state">
                <span className="wa-version-empty">暂无版本</span>
                <button
                  type="button"
                  disabled={versionAction !== null || manifestLoading}
                  onClick={onCreateInitialVersion}
                >
                  {versionAction === "branch" ? "创建中..." : "新建版本"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {versionDeleteTarget && (
        <div className="wa-version-delete-dialog-backdrop" role="presentation" onClick={() => versionAction !== "delete" && onCancelDeleteVersion()}>
          <section
            aria-labelledby="wa-version-delete-title"
            aria-modal="true"
            className="wa-version-delete-dialog"
            role="dialog"
            onClick={event => event.stopPropagation()}
          >
            <div className="wa-version-delete-dialog-body">
              <div className="wa-version-delete-dialog-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5h6" />
                  <path d="M10 5l1-2h2l1 2" />
                  <path d="M5 7h14" />
                  <path d="M7 7l1 14h8l1-14" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </div>
              <h3 id="wa-version-delete-title">删除版本？</h3>
              <p>版本 {versionDeleteTarget} 的工作区文件和版本记录会被删除。若这是最后一个版本，任务会暂时进入暂无版本状态。</p>
              {versionError && <span className="wa-version-delete-dialog-error">{versionError}</span>}
            </div>
            <div className="wa-version-delete-dialog-actions">
              <button type="button" className="wa-version-delete-dialog-cancel" disabled={versionAction === "delete"} onClick={onCancelDeleteVersion}>
                取消
              </button>
              <button
                type="button"
                className="wa-version-delete-dialog-danger"
                disabled={versionAction === "delete"}
                onClick={onConfirmDeleteVersion}
              >
                {versionAction === "delete" ? "正在删除..." : "删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
