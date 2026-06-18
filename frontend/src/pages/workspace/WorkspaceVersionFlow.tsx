import { memo, useCallback, useEffect, useMemo } from "react"
import {
  Background,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { VersionAction, VersionSummary, WorkspaceManifestSummary } from "./workspaceVersion"

type VersionNodeData = {
  canDelete: boolean
  disabled: boolean
  isActive: boolean
  isInput?: boolean
  isSelected: boolean
  onCreateInitialVersion?: () => void
  onCheckoutVersion: (versionId: string) => void
  onRequestDeleteVersion: (versionId: string) => void
  onSelectNode?: (nodeId: string) => void
  versionId: string
} & Record<string, unknown>

type VersionFlowNode = Node<VersionNodeData, "versionNode">

type VersionFlowProps = {
  manifest: WorkspaceManifestSummary | null
  onCheckoutVersion: (versionId: string) => void
  onCreateInitialVersion?: () => void
  onRequestDeleteVersion: (versionId: string) => void
  onSelectNode?: (nodeId: string) => void
  selectedNodeId: string | null
  versionAction: VersionAction | null
}

const NODE_WIDTH = 104
const NODE_HEIGHT = 40
const INPUT_NODE_WIDTH = 156
const INPUT_NODE_HEIGHT = 44
const X_GAP = 202
const ROOT_X_GAP = 236
const Y_GAP = 64
export const INPUT_DATA_NODE_ID = "__input_data__"

function getInputDataModuleKey(manifest: WorkspaceManifestSummary | null) {
  const marker = [manifest?.workspaceId, manifest?.rootDir, manifest?.sessionId]
    .filter(Boolean)
    .join("/")
    .toLowerCase()
  if (marker.includes("thermal_catch")) return "thermal_catch"
  if (marker.includes("derating")) return "derating"
  if (marker.includes("thermal")) return "thermal"
  if (marker.includes("gnc")) return "gnc"
  return null
}

function getInputDataLabel(moduleKey: string | null) {
  if (moduleKey === "thermal_catch") return "输入数据 · catch"
  if (moduleKey === "thermal") return "输入数据 · 立方形"
  if (moduleKey === "gnc") return "输入数据 · 姿轨控"
  if (moduleKey === "derating") return "输入数据 · 合规性"
  return "输入数据"
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5h6" />
      <path d="M10 5l1-2h2l1 2" />
      <path d="M5 7h14" />
      <path d="M7 7l1 14h8l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

const VersionNode = memo(function VersionNode({ data }: NodeProps<VersionFlowNode>) {
  const { canDelete, disabled, isActive, isInput, isSelected, onCheckoutVersion, onRequestDeleteVersion, onSelectNode, versionId } = data
  if (isInput) {
    return (
      <div className={`wa-flow-version-node is-input${isSelected ? " selected" : ""}`}>
        <button
          type="button"
          className="wa-flow-version-main"
          disabled={disabled}
          onClick={() => onSelectNode?.(INPUT_DATA_NODE_ID)}
          title="选择输入数据"
        >
          <strong>{versionId}</strong>
        </button>
        <Handle type="source" position={Position.Right} isConnectable={false} />
      </div>
    )
  }
  return (
    <div className={`wa-flow-version-node${isActive ? " active" : ""}${isSelected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <button
        type="button"
        className="wa-flow-version-main"
        disabled={disabled}
        onClick={() => {
          onSelectNode?.(versionId)
          if (!isActive) onCheckoutVersion(versionId)
        }}
        title={isActive ? `${versionId} 为当前版本` : `切换到 ${versionId}`}
      >
        <strong>{versionId}</strong>
      </button>
      {canDelete && (
        <button
          type="button"
          className="wa-version-delete"
          disabled={disabled}
          onClick={event => {
            event.stopPropagation()
            onRequestDeleteVersion(versionId)
          }}
          title={`删除 ${versionId}`}
          aria-label={`删除 ${versionId}`}
        >
          <DeleteIcon />
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})

const nodeTypes = { versionNode: VersionNode }

function buildVersionFlowElements(
  manifest: WorkspaceManifestSummary | null,
  selectedNodeId: string | null,
  versionAction: VersionAction | null,
  onCheckoutVersion: (versionId: string) => void,
  onCreateInitialVersion: (() => void) | undefined,
  onRequestDeleteVersion: (versionId: string) => void,
  onSelectNode: ((nodeId: string) => void) | undefined,
) {
  const versions = (manifest?.versions ?? []).filter((version): version is VersionSummary & { id: string } => !!version.id)
  const childrenByParent = new Map<string, typeof versions>()
  const versionIds = new Set(versions.map(version => version.id))
  const roots: typeof versions = []

  versions.forEach(version => {
    const parentId = version.parentVersionId
    if (parentId && versionIds.has(parentId)) {
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), version])
    } else {
      roots.push(version)
    }
  })

  const orderedRoots = roots.sort((left, right) => left.id.localeCompare(right.id))
  const placed = new Map<string, { depth: number; order: number }>()
  const moduleKey = getInputDataModuleKey(manifest)
  const hasInputNode = !!manifest
  let row = 0
  const walk = (version: VersionSummary & { id: string }, depth: number) => {
    placed.set(version.id, { depth, order: row })
    row += 1
    const children = (childrenByParent.get(version.id) ?? []).sort((left, right) => left.id.localeCompare(right.id))
    children.forEach(child => walk(child, depth + 1))
  }
  orderedRoots.forEach(root => walk(root, hasInputNode ? 1 : 0))

  const nodes: VersionFlowNode[] = versions.map(version => {
    const position = placed.get(version.id) ?? { depth: 0, order: row++ }
    const isActive = version.id === manifest?.activeVersionId
    return {
      id: version.id,
      type: "versionNode",
      position: {
        x: hasInputNode && position.depth > 0
          ? ROOT_X_GAP + (position.depth - 1) * X_GAP
          : position.depth * X_GAP,
        y: position.order * Y_GAP,
      },
      data: {
        canDelete: version.id !== "v0001",
        disabled: versionAction !== null,
        isActive,
        isSelected: selectedNodeId === version.id,
        onCheckoutVersion,
        onCreateInitialVersion: undefined,
        onRequestDeleteVersion,
        onSelectNode,
        versionId: version.id,
      },
      draggable: false,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }
  })

  if (hasInputNode) {
    nodes.push({
      id: INPUT_DATA_NODE_ID,
      type: "versionNode",
      position: {
        x: 0,
        y: (NODE_HEIGHT - INPUT_NODE_HEIGHT) / 2,
      },
      data: {
        canDelete: false,
        disabled: versionAction !== null || !onCreateInitialVersion,
        isActive: false,
        isInput: true,
        isSelected: selectedNodeId === INPUT_DATA_NODE_ID,
        onCheckoutVersion,
        onCreateInitialVersion: versions.length === 0 ? onCreateInitialVersion : undefined,
        onRequestDeleteVersion,
        onSelectNode,
        versionId: getInputDataLabel(moduleKey),
      },
      draggable: false,
      width: INPUT_NODE_WIDTH,
      height: INPUT_NODE_HEIGHT,
    })
  }

  const edges: Edge[] = versions
    .filter(version => version.parentVersionId && versionIds.has(version.parentVersionId))
    .map(version => ({
      id: `${version.parentVersionId}-${version.id}`,
      source: version.parentVersionId as string,
      target: version.id,
      type: "smoothstep",
      animated: version.id === manifest?.activeVersionId,
      className: version.id === manifest?.activeVersionId ? "active" : undefined,
    }))

  if (hasInputNode) {
    orderedRoots.forEach(root => {
      edges.push({
        id: `${INPUT_DATA_NODE_ID}-${root.id}`,
        source: INPUT_DATA_NODE_ID,
        target: root.id,
        type: "straight",
        className: "input-edge",
      })
    })
  }

  return { edges, nodes }
}

function WorkspaceVersionFlowInner({
  manifest,
  onCheckoutVersion,
  onCreateInitialVersion,
  onRequestDeleteVersion,
  onSelectNode,
  selectedNodeId,
  versionAction,
}: VersionFlowProps) {
  const reactFlow = useReactFlow<VersionFlowNode, Edge>()
  const elements = useMemo(
    () => buildVersionFlowElements(manifest, selectedNodeId, versionAction, onCheckoutVersion, onCreateInitialVersion, onRequestDeleteVersion, onSelectNode),
    [manifest, onCheckoutVersion, onCreateInitialVersion, onRequestDeleteVersion, onSelectNode, selectedNodeId, versionAction],
  )
  const layoutSignature = useMemo(
    () => elements.nodes
      .map(node => `${node.id}:${Math.round(node.position.x)},${Math.round(node.position.y)}`)
      .join("|"),
    [elements.nodes],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState<VersionFlowNode>(elements.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges)

  useEffect(() => {
    setNodes(elements.nodes)
    setEdges(elements.edges)
  }, [elements, setEdges, setNodes])

  const onConnect = useCallback(() => undefined, [])

  useEffect(() => {
    if (elements.nodes.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      reactFlow.fitView({ duration: 220, maxZoom: 1.08, padding: 0.22 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [elements.nodes.length, layoutSignature, reactFlow])

  if (elements.nodes.length === 0) return null

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.22, maxZoom: 1.08 }}
      minZoom={0.18}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={18} size={1} />
    </ReactFlow>
  )
}

export function WorkspaceVersionFlow(props: VersionFlowProps) {
  return (
    <ReactFlowProvider>
      <WorkspaceVersionFlowInner {...props} />
    </ReactFlowProvider>
  )
}
