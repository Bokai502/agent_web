import { useEffect, useMemo, useState } from "react"
import type {
  WorkspaceItem,
  VersionAction,
  VersionSummary,
  WorkspaceManifestSummary,
} from "./workspaceVersion"
import { normalizeWorkspaceDisplayKey } from "./workspaceVersion"
import { INPUT_DATA_NODE_ID, WorkspaceVersionFlow } from "./WorkspaceVersionFlow"

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
  versionAction: VersionAction | null
  versionDeleteTarget: string | null
  versionError: string
  workspaceChanging: boolean
  workspaceItems: WorkspaceItem[]
}

function getThermalOptionLabel(name: string) {
  return normalizeWorkspaceDisplayKey(name) === "thermal_catch" ? "catch" : "立方形"
}

function getWorkspaceNodeKey(name: string) {
  const key = normalizeWorkspaceDisplayKey(name)
  if (key === "gnc") return "gnc"
  if (key === "derating") return "derating"
  if (key === "thermal" || key === "thermal_catch") return key
  return key
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
  versionAction,
  versionDeleteTarget,
  versionError,
  workspaceChanging,
  workspaceItems,
}: CurrentWorkspaceCardProps) {
  const [thermalMenuOpen, setThermalMenuOpen] = useState(false)
  const [selectedVersionFlowNodeId, setSelectedVersionFlowNodeId] = useState<string | null>(null)
  const hasVersions = (branchManifest?.versions?.length ?? 0) > 0
  const inputDataSelected = selectedVersionFlowNodeId === INPUT_DATA_NODE_ID
  const selectedVersionId = !inputDataSelected && branchManifest?.versions?.some(version => version.id === selectedVersionFlowNodeId)
    ? selectedVersionFlowNodeId
    : null
  const canCreateFromInput = !!branchManifest && !hasVersions && inputDataSelected && versionAction === null && !manifestLoading
  const canCreateVersion = ((!!selectedVersionId && hasVersions) || canCreateFromInput) && versionAction === null
  const canCreateSibling = !!activeManifestVersion?.id && versionAction === null
  const { itemByNodeKey, thermalItems } = useMemo(() => {
    const byKey = new Map<string, WorkspaceItem>()
    const thermal: WorkspaceItem[] = []
    workspaceItems.forEach(item => {
      const key = getWorkspaceNodeKey(item.name)
      byKey.set(key, item)
      if (key === "thermal" || key === "thermal_catch") thermal.push(item)
    })
    thermal.sort((left, right) => {
      const leftKey = normalizeWorkspaceDisplayKey(left.name)
      const rightKey = normalizeWorkspaceDisplayKey(right.name)
      if (leftKey === rightKey) return left.name.localeCompare(right.name)
      if (leftKey === "thermal") return -1
      if (rightKey === "thermal") return 1
      return left.name.localeCompare(right.name)
    })
    return { itemByNodeKey: byKey, thermalItems: thermal }
  }, [workspaceItems])
  const activeThermalItem = thermalItems.find(item => item.name === currentWorkspaceName) ?? null
  const hasThermalGroup = thermalItems.length > 0
  useEffect(() => {
    if (!branchManifest) {
      setSelectedVersionFlowNodeId(null)
      return
    }
    const versionIds = new Set((branchManifest.versions ?? []).map(version => version.id).filter(Boolean))
    if (versionIds.size === 0) {
      setSelectedVersionFlowNodeId(INPUT_DATA_NODE_ID)
      return
    }
    setSelectedVersionFlowNodeId(current =>
      current && versionIds.has(current)
        ? current
        : branchManifest.activeVersionId ?? (branchManifest.versions?.find(version => version.id)?.id ?? null)
    )
  }, [branchManifest])
  const sourceNodes = [
    { key: "gnc", label: "姿轨控设计" },
    { key: "thermal_group", label: "力热设计" },
    { key: "derating", label: "合规性检查" },
    { key: "structure", label: "结构设计", disabled: true },
    { key: "power", label: "电源设计", disabled: true },
    { key: "communication", label: "通信设计", disabled: true },
  ]
  const renderWorkspaceSourceButton = (item: WorkspaceItem, label: string, className = "") => {
    const isActive = item.name === currentWorkspaceName
    return (
      <button
        type="button"
        className={`wa-source-flow-node is-selectable${isActive ? " active" : ""}${className ? ` ${className}` : ""}`}
        disabled={isActive || workspaceChanging || !item.valid}
        key={item.name}
        onClick={() => onSelectWorkspace(item.name)}
        title={item.path}
      >
        <strong>{label}</strong>
      </button>
    )
  }

  return (
    <>
      {manifestLoading && <p>正在加载版本状态...</p>}
      <div className="wa-task-layout">
        <section className="wa-task-container wa-task-source-pane" aria-label="数据源">
          <div className="wa-section-title">
            <span>数据源</span>
          </div>
          <div className="wa-source-flow">
            <div className="wa-source-flow-root">
              <strong>卫星设计</strong>
            </div>
            <div className="wa-source-flow-trunk" aria-hidden="true" />
            <div className="wa-source-flow-grid">
              {sourceNodes.map(node => {
                const item = itemByNodeKey.get(node.key)
                if (node.key === "thermal_group") {
                  return (
                    <div className={`wa-source-flow-group${activeThermalItem ? " active" : ""}`} key={node.key}>
                      <button
                        type="button"
                        className="wa-source-flow-node is-group"
                        disabled={!hasThermalGroup || workspaceChanging}
                        onClick={() => setThermalMenuOpen(open => !open)}
                        aria-expanded={thermalMenuOpen}
                      >
                        <strong>{node.label}</strong>
                        <span aria-hidden="true">{thermalMenuOpen ? "⌃" : "⌄"}</span>
                      </button>
                      {thermalMenuOpen && (
                        <div className="wa-source-flow-children">
                          {thermalItems.map(thermalItem => renderWorkspaceSourceButton(
                            thermalItem,
                            getThermalOptionLabel(thermalItem.name),
                            "is-child",
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                if (item) return renderWorkspaceSourceButton(item, node.label)
                return (
                  <button
                    type="button"
                    className="wa-source-flow-node is-disabled"
                    disabled
                    key={node.key}
                  >
                    <strong>{node.label}</strong>
                  </button>
                )
              })}
            </div>
          </div>
        </section>
        <section className="wa-task-container wa-task-version-pane" aria-label="版本流">
          {versionError && <p className="wa-version-error">{versionError}</p>}
          <div className="wa-version-flow-header">
            <span>版本流</span>
            <div className="wa-version-header-actions">
              <button
                type="button"
                disabled={!canCreateVersion}
                onClick={() => {
                  if (canCreateFromInput) onCreateInitialVersion()
                  else onCreateChildBranch(selectedVersionId ?? undefined)
                }}
              >
                {versionAction === "branch" ? "创建中..." : "基于当前新建"}
              </button>
              <button
                type="button"
                disabled={!canCreateSibling}
                onClick={onCreateSiblingBranch}
              >
                新建并列版本
              </button>
            </div>
          </div>
          <div className="wa-version-flow-shell">
            <WorkspaceVersionFlow
              manifest={branchManifest}
              onCheckoutVersion={onCheckoutVersion}
              onCreateInitialVersion={versionAction === null && !manifestLoading ? onCreateInitialVersion : undefined}
              onRequestDeleteVersion={onRequestDeleteVersion}
              onSelectNode={setSelectedVersionFlowNodeId}
              selectedNodeId={selectedVersionFlowNodeId}
              versionAction={versionAction}
            />
          </div>
        </section>
      </div>
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
              <p>版本 {versionDeleteTarget} 的工作区文件和版本记录会被删除。</p>
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
    </>
  )
}
