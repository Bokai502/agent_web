import { useEffect, useMemo, useState } from "react"
import {
  Background,
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
type FlowStepKind = "plan" | "run" | "analyze" | "output"

type FlowStep = {
  id: string
  kind?: FlowStepKind
  type?: "files" | "single" | "tasks" | "checks"
  items: string[]
  progress?: number
  summary: string
  output: string
  title: string
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
  relativePath?: string
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

function getNodePosition(index: number) {
  return { x: index * 360, y: 150 }
}

function getStepKind(step: FlowStep): FlowStepKind {
  if (step.kind) return step.kind
  if (step.type === "files" || step.type === "single") return "output"
  if (step.type === "checks") return "analyze"
  return "run"
}

function getStepProgress(step: FlowStep) {
  if (typeof step.progress !== "number" || !Number.isFinite(step.progress)) return 0
  const progress = step.progress <= 1 && step.progress >= 0 ? step.progress * 100 : step.progress
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function FlowCardNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { step } = data
  const progress = getStepProgress(step)

  return (
    <div className={`execution-flow-card kind-${getStepKind(step)}${selected ? " is-active" : ""}`}>
      <Handle className="execution-flow-handle" type="target" position={Position.Left} />
      <div className="execution-flow-node-head">
        <span className="execution-flow-status" />
        <div className="execution-flow-card-title">{step.title}</div>
        <span className="execution-flow-output">{step.output}</span>
      </div>
      <div className="execution-flow-progress" aria-label={`进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p className="execution-flow-summary">{step.summary}</p>
      <div className="execution-flow-card-body">
        {step.items.map(item => (
          <span key={item} className="execution-flow-chip">
            <span className="execution-flow-dot" />
            <span className="execution-flow-chip-label">{item}</span>
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
    position: getNodePosition(index),
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
  relativePath = DEFAULT_FLOW_RELATIVE_PATH,
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
          <strong>{flowError ? "任务规划中" : "正在加载执行流程"}</strong>
          <span>{flowError ? "执行流程将在规划完成后显示" : relativePath}</span>
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
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.45, maxZoom: 1.1 }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { strokeWidth: 2.2 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={18} size={1.2} />
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
