import { useEffect, useMemo, useState } from "react"
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { joinApiPath } from "../../app/apiBase"
import "./ExecutionFlow.css"

type FlowTheme = "dark" | "light"

type FlowStep = {
  id: string
  title: string
  tone: "teal" | "blue" | "slate" | "amber" | "indigo"
  type: "files" | "single" | "tasks" | "checks"
  items: string[]
  summary: string
  output: string
}

type FlowConnection = {
  from: string
  to: string
}

type FlowData = {
  connections: FlowConnection[]
  defaultActiveId?: string
  nodes: FlowStep[]
}

type FlowNodeData = {
  step: FlowStep
}

type ExecutionFlowProps = {
  apiBase?: string
  className?: string
  height?: number | string
  interactive?: boolean
  relativePath?: string
  showControls?: boolean
  showThemeSwitch?: boolean
  theme?: FlowTheme
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}

const DEFAULT_FLOW_RELATIVE_PATH = "00_inputs/workflow_diagram/executionFlowData.json"

type WorkspaceFileContentResponse = {
  content?: string
}

function isFlowData(value: unknown): value is FlowData {
  const candidate = value as Partial<FlowData> | null
  return Boolean(candidate && Array.isArray(candidate.nodes) && Array.isArray(candidate.connections))
}

function buildWorkspaceFileQuery({
  relativePath,
  versionId,
  workspaceDir,
  workspaceId,
}: {
  relativePath: string
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}) {
  if (!workspaceDir) return ""
  const params = new URLSearchParams({ relativePath, workspaceDir })
  if (workspaceId) params.set("workspaceId", workspaceId)
  if (versionId) params.set("versionId", versionId)
  params.set("maxBytes", String(512 * 1024))
  return `?${params.toString()}`
}

async function fetchFlowData({
  apiBase,
  relativePath,
  versionId,
  workspaceDir,
  workspaceId,
}: {
  apiBase?: string
  relativePath: string
  versionId?: string
  workspaceDir?: string
  workspaceId?: string
}) {
  const query = buildWorkspaceFileQuery({ relativePath, versionId, workspaceDir, workspaceId })
  if (!query) throw new Error("当前工作区未就绪")
  const response = await fetch(`${joinApiPath(apiBase, "/workspace/files/text")}${query}`, { cache: "no-store" })
  const payload = await response.json().catch(() => null) as WorkspaceFileContentResponse | { error?: string } | null
  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : "执行流程配置读取失败")
  }
  if (!payload || !("content" in payload) || typeof payload.content !== "string") {
    throw new Error("执行流程配置为空")
  }
  const parsed = JSON.parse(payload.content) as unknown
  if (!isFlowData(parsed)) {
    throw new Error("执行流程配置格式无效")
  }
  return parsed
}

function getNodeWidth(type: FlowStep["type"]) {
  if (type === "checks") return 390
  if (type === "files") return 300
  if (type === "tasks") return 280
  return 190
}

function getNodePosition(index: number, steps: FlowStep[]) {
  const x = steps.slice(0, index).reduce((sum, item) => sum + getNodeWidth(item.type) + 90, 0)
  const lane = index % 3
  const y = lane === 0 ? 110 : lane === 1 ? 230 : 150
  return { x, y }
}

function FlowCardNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { step } = data

  return (
    <div className={`execution-flow-card tone-${step.tone} type-${step.type}${selected ? " is-active" : ""}`}>
      <Handle className="execution-flow-handle" type="target" position={Position.Left} />
      <div className="execution-flow-node-head">
        <span className="execution-flow-status" />
        <div className="execution-flow-card-title">{step.title}</div>
        <span className="execution-flow-output">{step.output}</span>
      </div>
      <p className="execution-flow-summary">{step.summary}</p>
      <div className="execution-flow-card-body">
        {step.items.map(item => (
          <span key={item} className="execution-flow-chip">
            <span className="execution-flow-dot" />
            {item}
          </span>
        ))}
      </div>
      <Handle className="execution-flow-handle" type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = {
  flowCard: FlowCardNode,
}

function buildNodes(data: FlowData): Node<FlowNodeData>[] {
  return data.nodes.map((step, index) => ({
    id: step.id,
    type: "flowCard",
    position: getNodePosition(index, data.nodes),
    data: { step },
    selected: step.id === data.defaultActiveId,
  }))
}

function buildEdges(data: FlowData): Edge[] {
  return data.connections.map(connection => ({
    id: `${connection.from}-${connection.to}`,
    source: connection.from,
    target: connection.to,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
    },
  }))
}

function ExecutionFlowCanvas({
  apiBase,
  className,
  height = "100vh",
  interactive = true,
  relativePath = DEFAULT_FLOW_RELATIVE_PATH,
  showControls = true,
  showThemeSwitch = true,
  theme,
  versionId,
  workspaceDir,
  workspaceId,
}: ExecutionFlowProps) {
  const [localTheme, setLocalTheme] = useState<FlowTheme>("dark")
  const [flowData, setFlowData] = useState<FlowData | null>(null)
  const [flowError, setFlowError] = useState("")
  const [flowLoading, setFlowLoading] = useState(false)
  const effectiveTheme = theme ?? localTheme
  const initialNodes = useMemo(() => flowData ? buildNodes(flowData) : [], [flowData])
  const initialEdges = useMemo(() => flowData ? buildEdges(flowData) : [], [flowData])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  useEffect(() => {
    let cancelled = false
    setFlowLoading(true)
    setFlowError("")
    fetchFlowData({ apiBase, relativePath, versionId, workspaceDir, workspaceId })
      .then(data => {
        if (!cancelled) setFlowData(data)
      })
      .catch(error => {
        if (!cancelled) {
          setFlowData(null)
          setFlowError(error instanceof Error ? error.message : "执行流程配置读取失败")
        }
      })
      .finally(() => {
        if (!cancelled) setFlowLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [apiBase, relativePath, versionId, workspaceDir, workspaceId])

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialEdges, initialNodes, setEdges, setNodes])

  return (
    <div className={`execution-flow-page theme-${effectiveTheme}${className ? ` ${className}` : ""}`} style={{ height }}>
      {showThemeSwitch ? (
        <div className="execution-flow-theme-switch" aria-label="主题切换">
          <button type="button" className={effectiveTheme === "dark" ? "is-active" : ""} onClick={() => setLocalTheme("dark")}>
            深色
          </button>
          <button type="button" className={effectiveTheme === "light" ? "is-active" : ""} onClick={() => setLocalTheme("light")}>
            浅色
          </button>
        </div>
      ) : null}

      {flowLoading || flowError ? (
        <div className={`execution-flow-state${flowError ? " is-error" : ""}`}>
          <strong>{flowError ? "执行流程配置不可用" : "正在加载执行流程"}</strong>
          <span>{flowError || relativePath}</span>
        </div>
      ) : null}

      <ReactFlow
        className="execution-flow-reactflow"
        colorMode={effectiveTheme}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnDrag={interactive}
        zoomOnDoubleClick={interactive}
        zoomOnPinch={interactive}
        zoomOnScroll={interactive}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.45, maxZoom: 1.1 }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { strokeWidth: 2.2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1.2} />
        {showControls ? <Controls position="bottom-right" showInteractive={false} /> : null}
      </ReactFlow>
    </div>
  )
}

export function ExecutionFlow(props: ExecutionFlowProps) {
  return (
    <ReactFlowProvider>
      <ExecutionFlowCanvas {...props} />
    </ReactFlowProvider>
  )
}
