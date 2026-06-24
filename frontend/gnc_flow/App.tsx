import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange, NodePositionChange, ReactFlowInstance, Viewport } from '@xyflow/react';
import { MarkerType, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { fetchRemoteFlow, saveRemoteFlow, type SaveStatus } from './api';
import { joinApiPath } from '../src/app/apiBase';
import type { WorkspaceVersionContext } from '../src/pages/workspace/workspaceVersion';
import { edgeTypes } from './ConditionEdge';
import { nodeTypes } from './CustomNodes';
import { initialFlow } from './initialFlow';
import {
  createNode,
  downloadTextFile,
  exportElementAsPng,
  getNodeLayer,
  getSnapResult,
  flowFromDocument,
  isFlowDocument,
  isSavedFlow,
  makeFlowDocument,
  makeConditionEdge,
  makeSavedFlow,
  normalizeFlow,
  readSavedFlow,
  shouldCommitEdgeHistory,
  shouldCommitHistory,
  writeSavedFlow,
} from './flowUtils';
import type { GuideLine } from './flowUtils';
import type {
  FlowEdge,
  FlowNode,
  FlowNodeKind,
  SavedFlow,
  SelectionState,
  SwitchLogicEntry,
  SwitchLogicKind,
  SwitchLogicTables,
} from './types';

const nodePalette: Array<{ kind: FlowNodeKind; title: string; hint: string }> = [
  { kind: 'process', title: '流程模块', hint: '矩形状态或动作' },
  { kind: 'group', title: '阶段分组', hint: '框选区域容器' },
  { kind: 'label', title: '文字标注', hint: '标题或说明' },
];

const standardColors = [
  { name: '白色', value: '#ffffff' },
  { name: '黑色', value: '#000000' },
  { name: '深灰', value: '#666666' },
  { name: '浅灰', value: '#f3f3f3' },
  { name: '红色', value: '#ff0000' },
  { name: '橙色', value: '#f4b183' },
  { name: '黄色', value: '#ffc000' },
  { name: '绿色', value: '#92d050' },
  { name: '青色', value: '#00b0f0' },
  { name: '蓝色', value: '#4472c4' },
  { name: '深蓝', value: '#002060' },
  { name: '紫色', value: '#7030a0' },
];

const defaultViewport = { x: 0, y: 0, zoom: 0.95 };

function cloneFlow(flow: SavedFlow): SavedFlow {
  return JSON.parse(JSON.stringify(flow)) as SavedFlow;
}

function flowSignature(flow: SavedFlow) {
  return JSON.stringify(flow);
}

function isDraggingPositionChange(change: NodeChange): change is NodePositionChange {
  return change.type === 'position' && change.dragging === true && !!change.position;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

function isHexColor(value: string | undefined) {
  return /^#[0-9a-f]{6}$/i.test(value || '');
}

function colorDisplay(value: string | undefined, fallback: string) {
  if (value === 'transparent') {
    return '透明';
  }

  return value || fallback;
}

function handlePosition(handle: string | null | undefined): Position | undefined {
  if (!handle) {
    return undefined;
  }

  if (handle.endsWith(Position.Top)) {
    return Position.Top;
  }

  if (handle.endsWith(Position.Right)) {
    return Position.Right;
  }

  if (handle.endsWith(Position.Bottom)) {
    return Position.Bottom;
  }

  if (handle.endsWith(Position.Left)) {
    return Position.Left;
  }

  return undefined;
}

function handleId(type: 'source' | 'target', position: Position) {
  return `${type}-${position}`;
}

function nodeCenter(node: FlowNode) {
  const width = Number(node.style?.width || node.width || node.measured?.width || 120);
  const height = Number(node.style?.height || node.height || node.measured?.height || 50);

  return {
    x: node.position.x + width / 2,
    y: node.position.y + height / 2,
  };
}

function inferConnectionHandles(sourceNode: FlowNode, targetNode: FlowNode) {
  const sourceCenter = nodeCenter(sourceNode);
  const targetCenter = nodeCenter(targetNode);
  const isHorizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);

  if (isHorizontal) {
    const sourcePosition = targetCenter.x >= sourceCenter.x ? Position.Right : Position.Left;
    const targetPosition = targetCenter.x >= sourceCenter.x ? Position.Left : Position.Right;
    return { sourcePosition, targetPosition };
  }

  const sourcePosition = targetCenter.y >= sourceCenter.y ? Position.Bottom : Position.Top;
  const targetPosition = targetCenter.y >= sourceCenter.y ? Position.Top : Position.Bottom;
  return { sourcePosition, targetPosition };
}

function normalizeConnection(connection: Connection, nodes: FlowNode[]): Connection | null {
  if (!connection.source || !connection.target) {
    return null;
  }

  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);

  if (!sourceNode || !targetNode) {
    return null;
  }

  const inferred = inferConnectionHandles(sourceNode, targetNode);
  const sourcePosition = handlePosition(connection.sourceHandle) || inferred.sourcePosition;
  const targetPosition = handlePosition(connection.targetHandle) || inferred.targetPosition;

  return {
    ...connection,
    sourceHandle: handleId('source', sourcePosition),
    targetHandle: handleId('target', targetPosition),
  };
}

function ColorControl({
  label,
  value,
  fallback,
  onChange,
  allowTransparent = false,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (value: string) => void;
  allowTransparent?: boolean;
}) {
  const customValue = isHexColor(value) ? value : fallback;

  return (
    <div className="color-control">
      <div className="color-control-header">
        <span>{label}</span>
        <small>{colorDisplay(value, fallback)}</small>
      </div>
      <div className="standard-color-grid" aria-label={`${label}标准色`}>
        {allowTransparent && (
          <button
            type="button"
            className={`standard-color-swatch transparent-swatch${value === 'transparent' ? ' active' : ''}`}
            title="透明"
            aria-label={`${label}透明`}
            onClick={() => onChange('transparent')}
          />
        )}
        {standardColors.map((color) => (
          <button
            key={color.value}
            type="button"
            className={`standard-color-swatch${value === color.value ? ' active' : ''}`}
            style={{ backgroundColor: color.value }}
            title={color.name}
            aria-label={`${label}${color.name}`}
            onClick={() => onChange(color.value)}
          />
        ))}
      </div>
      <label className="custom-color-picker">
        <span>自定义</span>
        <input type="color" value={customValue} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}

function SwitchLogicTable({
  title,
  rows,
  onAdd,
  onUpdate,
  onDelete,
}: {
  title: string;
  rows: SwitchLogicEntry[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Pick<SwitchLogicEntry, 'code' | 'description'>>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="logic-table-card">
      <div className="logic-table-header">
        <div>
          <span>{title}</span>
          <small>{rows.length} 条</small>
        </div>
        <button type="button" className="logic-add-button" onClick={onAdd}>
          新增
        </button>
      </div>
      <div className="logic-table-grid">
        <div className="logic-table-row logic-table-head">
          <span>序号</span>
          <span>切换逻辑</span>
          <span />
        </div>
        {rows.map((row) => (
          <div className="logic-table-row" key={row.id}>
            <input
              value={row.code}
              aria-label={`${title}序号`}
              onChange={(event) => onUpdate(row.id, { code: event.target.value })}
            />
            <textarea
              value={row.description}
              rows={2}
              aria-label={`${title}切换逻辑`}
              onChange={(event) => onUpdate(row.id, { description: event.target.value })}
            />
            <button type="button" className="logic-delete-button" onClick={() => onDelete(row.id)} title="删除">
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SwitchLogicPanel({
  switchLogic,
  onAdd,
  onUpdate,
  onDelete,
  onNoteChange,
}: {
  switchLogic: SwitchLogicTables;
  onAdd: (kind: SwitchLogicKind) => void;
  onUpdate: (kind: SwitchLogicKind, id: string, patch: Partial<Pick<SwitchLogicEntry, 'code' | 'description'>>) => void;
  onDelete: (kind: SwitchLogicKind, id: string) => void;
  onNoteChange: (value: string) => void;
}) {
  return (
    <div className="logic-section">
      <div className="logic-section-heading">
        <span>模式切换条件</span>
        <small>随 JSON 与后端同步保存</small>
      </div>
      <SwitchLogicTable
        title="自主切换逻辑"
        rows={switchLogic.autonomous}
        onAdd={() => onAdd('autonomous')}
        onUpdate={(id, patch) => onUpdate('autonomous', id, patch)}
        onDelete={(id) => onDelete('autonomous', id)}
      />
      <SwitchLogicTable
        title="指令切换逻辑"
        rows={switchLogic.command}
        onAdd={() => onAdd('command')}
        onUpdate={(id, patch) => onUpdate('command', id, patch)}
        onDelete={(id) => onDelete('command', id)}
      />
      <label className="logic-note">
        <span>注</span>
        <textarea value={switchLogic.note} rows={3} onChange={(event) => onNoteChange(event.target.value)} />
      </label>
    </div>
  );
}

type GncFlowEditorProps = {
  activeContext: WorkspaceVersionContext;
  apiBase?: string;
};

function buildWorkspaceQuery(activeContext: WorkspaceVersionContext) {
  const workspaceDir = activeContext.versionDir ?? activeContext.sourceWorkspaceDir ?? activeContext.workspaceItem?.path;
  const params = new URLSearchParams();
  if (workspaceDir) params.set('workspaceDir', workspaceDir);
  if (activeContext.workspaceId) params.set('workspaceId', activeContext.workspaceId);
  if (activeContext.versionId) params.set('versionId', activeContext.versionId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function FlowEditor({ activeContext, apiBase }: GncFlowEditorProps) {
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportAreaRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | null>(null);
  const restoringRef = useRef(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SaveStatus>('local');
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const restoredFlow = useMemo(() => readSavedFlow() || normalizeFlow(initialFlow), []);
  const [nodes, setNodes] = useState<FlowNode[]>(() => cloneFlow(restoredFlow).nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(() => cloneFlow(restoredFlow).edges);
  const [viewport, setViewport] = useState<Viewport>(() => cloneFlow(restoredFlow).viewport || defaultViewport);
  const [switchLogic, setSwitchLogic] = useState<SwitchLogicTables>(() => cloneFlow(restoredFlow).switchLogic);
  const [selection, setSelection] = useState<SelectionState>(null);
  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
  const [history, setHistory] = useState<SavedFlow[]>(() => [cloneFlow(restoredFlow)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [notice, setNotice] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const workspaceDir = activeContext.versionDir ?? activeContext.sourceWorkspaceDir ?? activeContext.workspaceItem?.path ?? '';
  const workspaceQuery = useMemo(() => buildWorkspaceQuery(activeContext), [activeContext]);
  const flowEndpoint = useMemo(() => `${joinApiPath(apiBase, '/flow')}${workspaceQuery}`, [apiBase, workspaceQuery]);
  const flowSaveEndpoint = useMemo(() => joinApiPath(apiBase, '/flow'), [apiBase]);

  const selectedNode = selection?.type === 'node' ? nodes.find((node) => node.id === selection.id) : undefined;
  const selectedEdge = selection?.type === 'edge' ? edges.find((edge) => edge.id === selection.id) : undefined;
  const selectedName =
    selectedNode?.data.label ||
    selectedEdge?.data?.condition ||
    selectedEdge?.data?.reverseCondition ||
    (selectedEdge ? '连线' : '未选择');
  const syncLabel = {
    local: '本地已保存',
    syncing: '同步中',
    synced: '后端已同步',
    offline: '后端未连接',
    error: '同步失败',
  }[syncStatus];

  const pushHistory = useCallback(
    (nextNodes = nodes, nextEdges = edges, nextViewport = viewport, nextSwitchLogic = switchLogic) => {
      if (restoringRef.current) {
        return;
      }

      const snapshot = makeSavedFlow(nextNodes, nextEdges, nextViewport, nextSwitchLogic);
      setHistory((current) => {
        const base = current.slice(0, historyIndex + 1);
        const previous = base[base.length - 1];

        if (previous && flowSignature(previous) === flowSignature(snapshot)) {
          return current;
        }

        const nextHistory = [...base, cloneFlow(snapshot)].slice(-80);
        setHistoryIndex(nextHistory.length - 1);
        return nextHistory;
      });
    },
    [edges, historyIndex, nodes, switchLogic, viewport],
  );

  const applyFlowSnapshot = useCallback(
    (snapshot: SavedFlow) => {
      restoringRef.current = true;
      const normalized = normalizeFlow(snapshot);
      setNodes(normalized.nodes);
      setEdges(normalized.edges);
      setViewport(normalized.viewport);
      setSwitchLogic(normalized.switchLogic);
      reactFlow.setViewport(normalized.viewport, { duration: 160 });
      window.setTimeout(() => {
        restoringRef.current = false;
      }, 0);
    },
    [reactFlow],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((currentNodes) => {
        const changedNodes = applyNodeChanges(changes, currentNodes) as FlowNode[];
        const movingChange = changes.find(isDraggingPositionChange);

        if (!movingChange || !movingChange.position) {
          if (shouldCommitHistory(changes)) {
            window.setTimeout(() => pushHistory(changedNodes, edges), 0);
          }
          return changedNodes;
        }

        const movingNode = changedNodes.find((node) => node.id === movingChange.id);

        if (!movingNode) {
          return changedNodes;
        }

        const snap = getSnapResult(changedNodes, movingNode);
        setGuideLines(snap.lines);

        return changedNodes.map((node) =>
          node.id === movingNode.id
            ? {
                ...node,
                position: snap.position,
              }
            : node,
        );
      });
    },
    [edges, pushHistory],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((currentEdges) => {
        const changedEdges = applyEdgeChanges(changes, currentEdges) as FlowEdge[];
        if (shouldCommitEdgeHistory(changes)) {
          window.setTimeout(() => pushHistory(nodes, changedEdges), 0);
        }
        return changedEdges;
      });
    },
    [nodes, pushHistory],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const normalizedConnection = normalizeConnection(connection, nodes);
      const sourceNode = nodes.find((node) => node.id === normalizedConnection?.source);
      const targetNode = nodes.find((node) => node.id === normalizedConnection?.target);

      if (!normalizedConnection || !sourceNode || !targetNode) {
        setNotice('连线端点无效，请重新连接');
        return;
      }

      if (sourceNode?.data.kind === 'group' || targetNode?.data.kind === 'group') {
        setNotice('阶段分组仅作为容器，不能配置连线');
        return;
      }

      setEdges((currentEdges) => {
        const edge = makeConditionEdge(
          {
            ...normalizedConnection,
            id: `edge-${normalizedConnection.source}-${normalizedConnection.target}-${Date.now()}`,
          },
          '',
        );
        const nextEdges = [...currentEdges, edge] as FlowEdge[];
        window.setTimeout(() => pushHistory(nodes, nextEdges), 0);
        setSelection({ type: 'edge', id: edge.id });
        return nextEdges;
      });
    },
    [nodes, pushHistory],
  );

  const handleReconnect = useCallback(
    (oldEdge: FlowEdge, newConnection: Connection) => {
      const normalizedConnection = normalizeConnection(newConnection, nodes);
      const sourceNode = nodes.find((node) => node.id === normalizedConnection?.source);
      const targetNode = nodes.find((node) => node.id === normalizedConnection?.target);

      if (!normalizedConnection || !sourceNode || !targetNode) {
        setNotice('连线端点无效，请重新连接');
        return;
      }

      if (sourceNode?.data.kind === 'group' || targetNode?.data.kind === 'group') {
        setNotice('阶段分组仅作为容器，不能配置连线');
        return;
      }

      setEdges((currentEdges) => {
        const nextEdges = reconnectEdge(oldEdge, normalizedConnection, currentEdges) as FlowEdge[];
        window.setTimeout(() => pushHistory(nodes, nextEdges), 0);
        return nextEdges;
      });
    },
    [nodes, pushHistory],
  );

  const addPaletteNode = useCallback(
    (kind: FlowNodeKind, position?: { x: number; y: number }) => {
      const basePosition =
        position ||
        reactFlow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        });
      const nextNode = createNode(kind, basePosition);
      setNodes((currentNodes) => {
        const nextNodes = [...currentNodes, nextNode];
        window.setTimeout(() => pushHistory(nextNodes, edges), 0);
        return nextNodes;
      });
      setSelection({ type: 'node', id: nextNode.id });
    },
    [edges, pushHistory, reactFlow],
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData('application/satellite-flow-node') as FlowNodeKind;

      if (!kind) {
        return;
      }

      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      addPaletteNode(kind, position);
    },
    [addPaletteNode, reactFlow],
  );

  const updateSelectedNode = useCallback(
    (patch: Partial<FlowNode['data']> & { width?: number; height?: number }) => {
      if (!selectedNode) {
        return;
      }

      setNodes((currentNodes) => {
        const nextNodes = currentNodes.map((node) => {
          if (node.id !== selectedNode.id) {
            return node;
          }

          const width = patch.width ?? node.width ?? node.measured?.width;
          const height = patch.height ?? node.height ?? node.measured?.height;

          return {
            ...node,
            zIndex: getNodeLayer(node.data.kind),
            width,
            height,
            measured: {
              width,
              height,
            },
            style: {
              ...node.style,
              width,
              height,
            },
            data: {
              ...node.data,
              ...patch,
            },
          };
        }) as FlowNode[];
        window.setTimeout(() => pushHistory(nextNodes, edges), 0);
        return nextNodes;
      });
    },
    [edges, pushHistory, selectedNode],
  );

  const updateSelectedEdge = useCallback(
    (patch: Partial<NonNullable<FlowEdge['data']>>) => {
      if (!selectedEdge) {
        return;
      }

      setEdges((currentEdges) => {
        const nextEdges = currentEdges.map((edge) => {
          if (edge.id !== selectedEdge.id) {
            return edge;
          }

          const nextDirection = patch.direction || edge.data?.direction || 'single';
          const marker = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#333333' };

          return {
            ...edge,
            markerStart: nextDirection === 'double' ? marker : undefined,
            markerEnd: marker,
            data: {
              ...edge.data,
              ...patch,
              direction: nextDirection,
            },
          };
        }) as FlowEdge[];
        window.setTimeout(() => pushHistory(nodes, nextEdges), 0);
        return nextEdges;
      });
    },
    [nodes, pushHistory, selectedEdge],
  );

  const updateSwitchLogic = useCallback(
    (updater: (current: SwitchLogicTables) => SwitchLogicTables) => {
      setSwitchLogic((current) => {
        const next = updater(current);
        window.setTimeout(() => pushHistory(nodes, edges, viewport, next), 0);
        return next;
      });
    },
    [edges, nodes, pushHistory, viewport],
  );

  const addSwitchLogicRow = useCallback(
    (kind: SwitchLogicKind) => {
      updateSwitchLogic((current) => ({
        ...current,
        [kind]: [
          ...current[kind],
          {
            id: `${kind}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
            code: '',
            description: '',
          },
        ],
      }));
    },
    [updateSwitchLogic],
  );

  const updateSwitchLogicRow = useCallback(
    (kind: SwitchLogicKind, id: string, patch: Partial<Pick<SwitchLogicEntry, 'code' | 'description'>>) => {
      updateSwitchLogic((current) => ({
        ...current,
        [kind]: current[kind].map((row) => (row.id === id ? { ...row, ...patch } : row)),
      }));
    },
    [updateSwitchLogic],
  );

  const deleteSwitchLogicRow = useCallback(
    (kind: SwitchLogicKind, id: string) => {
      updateSwitchLogic((current) => ({
        ...current,
        [kind]: current[kind].filter((row) => row.id !== id),
      }));
    },
    [updateSwitchLogic],
  );

  const updateSwitchLogicNote = useCallback(
    (note: string) => {
      updateSwitchLogic((current) => ({
        ...current,
        note,
      }));
    },
    [updateSwitchLogic],
  );

  const deleteSelection = useCallback(() => {
    if (!selection) {
      return;
    }

    if (selection.type === 'node') {
      const nextNodes = nodes.filter((node) => node.id !== selection.id);
      const nextEdges = edges.filter((edge) => edge.source !== selection.id && edge.target !== selection.id);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelection(null);
      pushHistory(nextNodes, nextEdges);
      setNotice('已删除节点');
      return;
    }

    const nextEdges = edges.filter((edge) => edge.id !== selection.id);
    setEdges(nextEdges);
    setSelection(null);
    pushHistory(nodes, nextEdges);
    setNotice('已删除连线');
  }, [edges, nodes, pushHistory, selection]);

  const doResetFlow = useCallback(() => {
    const flow = normalizeFlow(initialFlow);
    setNodes(flow.nodes);
    setEdges(flow.edges);
    setViewport(flow.viewport);
    setSwitchLogic(flow.switchLogic);
    setSelection(null);
    reactFlow.setViewport(flow.viewport, { duration: 160 });
    setHistory([cloneFlow(flow)]);
    setHistoryIndex(0);
    setConfirmReset(false);
    setNotice('已恢复星箭分离模板');
  }, [reactFlow]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) {
      return;
    }

    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    applyFlowSnapshot(history[nextIndex]);
  }, [applyFlowSnapshot, history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) {
      return;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    applyFlowSnapshot(history[nextIndex]);
  }, [applyFlowSnapshot, history, historyIndex]);

  const exportJson = useCallback(() => {
    const saved = makeFlowDocument(nodes, edges, switchLogic);
    downloadTextFile(`satellite-flow-${Date.now()}.json`, JSON.stringify(saved, null, 2), 'application/json');
  }, [edges, nodes, switchLogic]);

  const importJson = useCallback(async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!isSavedFlow(parsed) && !isFlowDocument(parsed)) {
      setNotice('JSON 格式不正确，需要包含 version 和 nodes。');
      return;
    }

    const currentFlow = makeSavedFlow(nodes, edges, viewport, switchLogic);
    const normalized = isSavedFlow(parsed) ? normalizeFlow(parsed) : flowFromDocument(parsed, currentFlow);
    setNodes(normalized.nodes);
    setEdges(normalized.edges);
    setViewport(normalized.viewport);
    setSwitchLogic(normalized.switchLogic);
    reactFlow.setViewport(normalized.viewport, { duration: 160 });
    setSelection(null);
    setHistory([cloneFlow(normalized)]);
    setHistoryIndex(0);
  }, [edges, nodes, reactFlow, switchLogic, viewport]);

  const exportPng = useCallback(async () => {
    const area = exportAreaRef.current?.querySelector('.react-flow') as HTMLElement | null;

    if (!area) {
      setNotice('没有找到可导出的流程图区域。');
      return;
    }

    const currentViewport = reactFlow.getViewport();
    await reactFlow.fitView({ padding: 0.08, duration: 0 });
    await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    await exportElementAsPng(area, `satellite-flow-${Date.now()}.png`);
    await reactFlow.setViewport(currentViewport, { duration: 0 });
  }, [reactFlow]);

  const fitView = useCallback(() => {
    reactFlow.fitView({ padding: 0.12, duration: 180 });
  }, [reactFlow]);

  useEffect(() => {
    let cancelled = false;

    fetchRemoteFlow(flowEndpoint)
      .then((remoteFlow) => {
        if (cancelled) {
          return;
        }

        if (remoteFlow && (isSavedFlow(remoteFlow) || isFlowDocument(remoteFlow))) {
          const currentFlow = makeSavedFlow(nodes, edges, viewport, switchLogic);
          const normalized = isSavedFlow(remoteFlow) ? normalizeFlow(remoteFlow) : flowFromDocument(remoteFlow, currentFlow);
          setNodes(normalized.nodes);
          setEdges(normalized.edges);
          setViewport(normalized.viewport);
          setSwitchLogic(normalized.switchLogic);
          setSelection(null);
          setHistory([cloneFlow(normalized)]);
          setHistoryIndex(0);
          writeSavedFlow(normalized);
          reactFlow.setViewport(normalized.viewport, { duration: 0 });
        }

        setSyncStatus('synced');
      })
      .catch(() => {
        if (!cancelled) {
          setSyncStatus('offline');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRemoteReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [flowEndpoint, reactFlow]);

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      const snapshot = makeSavedFlow(nodes, edges, viewport, switchLogic);
      writeSavedFlow(snapshot);

      if (!remoteReady) {
        setSyncStatus('local');
        return;
      }

    setSyncStatus('syncing');
      saveRemoteFlow(flowSaveEndpoint, makeFlowDocument(nodes, edges, switchLogic), {
        versionId: activeContext.versionId,
        workspaceDir,
        workspaceId: activeContext.workspaceId,
      })
        .then(() => setSyncStatus('synced'))
        .catch(() => setSyncStatus('offline'));
    }, 600);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [activeContext.versionId, activeContext.workspaceId, edges, flowSaveEndpoint, nodes, remoteReady, switchLogic, viewport, workspaceDir]);

  useEffect(() => {
    if (flowInstance) {
      flowInstance.setViewport(viewport, { duration: 0 });
    }
  }, [flowInstance]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !isTypingTarget(event.target)) {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !isTypingTarget(event.target)) {
        event.preventDefault();
        redo();
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (!selection || isTypingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelection, redo, selection, undo]);

  return (
    <div className="gnc-flow-editor">
      <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">RF</div>
          <div>
            <h1>星箭分离流程图编辑器</h1>
            <p>React Flow 可视化编辑器</p>
          </div>
        </div>
        <div className="toolbar" aria-label="编辑工具栏">
          <span className={`sync-pill sync-${syncStatus}`}>{syncLabel}</span>
          <button type="button" className="icon-button" onClick={undo} disabled={historyIndex <= 0} title="撤销">
            ↶
          </button>
          <button type="button" className="icon-button" onClick={redo} disabled={historyIndex >= history.length - 1} title="重做">
            ↷
          </button>
          <button type="button" onClick={() => setConfirmReset(true)}>
            新建/清空
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            导入 JSON
          </button>
          <button type="button" onClick={exportJson}>
            导出 JSON
          </button>
          <button type="button" className="primary-action" onClick={exportPng}>
            导出 PNG
          </button>
          <button type="button" className="ghost-action" onClick={fitView}>
            适配视图
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              importJson(file).catch(() => setNotice('导入失败，请检查 JSON 文件。'));
            }
            event.currentTarget.value = '';
          }}
        />
      </header>

      <aside className="palette-panel">
        <div className="panel-heading">
          <span>节点库</span>
          <small>点击或拖拽创建</small>
        </div>
        <div className="palette-list">
          {nodePalette.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={`palette-item palette-${item.kind}`}
              draggable
              onClick={() => addPaletteNode(item.kind)}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/satellite-flow-node', item.kind);
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span>{item.title}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      </aside>

      <main className="canvas-shell" ref={exportAreaRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={setFlowInstance}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onReconnect={handleReconnect}
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          selectNodesOnDrag
          connectionMode={ConnectionMode.Loose}
          onNodeClick={(_, node) => setSelection({ type: 'node', id: node.id })}
          onEdgeClick={(_, edge) => setSelection({ type: 'edge', id: edge.id })}
          onPaneClick={() => setSelection(null)}
          onNodeDragStop={() => {
            setGuideLines([]);
          }}
          onViewportChange={setViewport}
          minZoom={0.2}
          maxZoom={2.5}
          deleteKeyCode={null}
          selectionMode={SelectionMode.Partial}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect
          connectionRadius={48}
          reconnectRadius={24}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#cfd5dd" gap={24} variant={BackgroundVariant.Dots} />
          <Controls />
          <MiniMap pannable zoomable nodeStrokeWidth={3} />
          <Panel position="top-left" className="status-panel">
            {nodes.length} 节点 / {edges.length} 连线
          </Panel>
          {(notice || confirmReset) && (
            <Panel position="top-center" className="notice-panel">
              {confirmReset ? (
                <div className="inline-confirm">
                  <span>清空当前画布并恢复模板？</span>
                  <button type="button" onClick={doResetFlow}>
                    确认
                  </button>
                  <button type="button" onClick={() => setConfirmReset(false)}>
                    取消
                  </button>
                </div>
              ) : (
                notice
              )}
            </Panel>
          )}
          <ViewportPortal>
            <GuideLines lines={guideLines} />
          </ViewportPortal>
        </ReactFlow>
      </main>

      <aside className="property-panel">
        <div className="panel-heading">
          <span>属性</span>
          <small>{selection ? selectedName : '未选择对象'}</small>
        </div>
        {!selection && (
          <div className="empty-state">
            <strong>未选择对象</strong>
            <span>点击节点或连线后，可在这里调整名称、颜色、尺寸和条件。</span>
          </div>
        )}

        {selectedNode && (
          <div className="form-stack">
            <label>
              名称
              <textarea value={selectedNode.data.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} />
            </label>
            <ColorControl
              label="填充色"
              value={selectedNode.data.fill}
              fallback="#ffffff"
              allowTransparent
              onChange={(value) => updateSelectedNode({ fill: value })}
            />
            <ColorControl
              label="边框色"
              value={selectedNode.data.stroke}
              fallback="#333333"
              onChange={(value) => updateSelectedNode({ stroke: value })}
            />
            <ColorControl
              label="文字颜色"
              value={selectedNode.data.textColor}
              fallback="#111111"
              onChange={(value) => updateSelectedNode({ textColor: value })}
            />
            <label>
              宽度
              <input
                type="number"
                min={36}
                value={Math.round(selectedNode.measured?.width || Number(selectedNode.style?.width) || selectedNode.width || 120)}
                onChange={(event) => updateSelectedNode({ width: Number(event.target.value) })}
              />
            </label>
            <label>
              高度
              <input
                type="number"
                min={28}
                value={Math.round(selectedNode.measured?.height || Number(selectedNode.style?.height) || selectedNode.height || 48)}
                onChange={(event) => updateSelectedNode({ height: Number(event.target.value) })}
              />
            </label>
            <button type="button" className="danger" onClick={deleteSelection}>
              删除节点
            </button>
          </div>
        )}

        {selectedEdge && (
          <div className="form-stack">
            <div className="field-note">双向连线会显示两个箭头，并分别编辑正向与反向条件。</div>
            <label>
              方向
              <select
                value={selectedEdge.data?.direction || 'single'}
                onChange={(event) =>
                  updateSelectedEdge({ direction: event.target.value as NonNullable<FlowEdge['data']>['direction'] })
                }
              >
                <option value="single">单向</option>
                <option value="double">双向</option>
              </select>
            </label>
            <label>
              正向条件
              <input value={selectedEdge.data?.condition || ''} onChange={(event) => updateSelectedEdge({ condition: event.target.value })} />
            </label>
            {(selectedEdge.data?.direction || 'single') === 'double' && (
              <label>
                反向条件
                <input
                  value={selectedEdge.data?.reverseCondition || ''}
                  onChange={(event) => updateSelectedEdge({ reverseCondition: event.target.value })}
                />
              </label>
            )}
            <label>
              线型
              <select
                value={selectedEdge.data?.pathType || 'smoothstep'}
                onChange={(event) =>
                  updateSelectedEdge({ pathType: event.target.value as NonNullable<FlowEdge['data']>['pathType'] })
                }
              >
                <option value="smoothstep">折线</option>
                <option value="straight">直线</option>
                <option value="bezier">曲线</option>
              </select>
            </label>
            <button type="button" className="danger" onClick={deleteSelection}>
              删除连线
            </button>
          </div>
        )}

        <SwitchLogicPanel
          switchLogic={switchLogic}
          onAdd={addSwitchLogicRow}
          onUpdate={updateSwitchLogicRow}
          onDelete={deleteSwitchLogicRow}
          onNoteChange={updateSwitchLogicNote}
        />
      </aside>
      </div>
    </div>
  );
}

function GuideLines({ lines }: { lines: GuideLine[] }) {
  if (!lines.length) {
    return null;
  }

  return (
    <div className="guide-layer">
      {lines.map((line) => {
        if (line.type === 'vertical') {
          return (
            <div
              key={line.id}
              className="guide-line vertical"
              style={{
                transform: `translate(${line.offset}px, ${line.start}px)`,
                height: line.end - line.start,
              }}
            />
          );
        }

        return (
          <div
            key={line.id}
            className="guide-line horizontal"
            style={{
              transform: `translate(${line.start}px, ${line.offset}px)`,
              width: line.end - line.start,
            }}
          />
        );
      })}
    </div>
  );
}

export default function GncFlowEditor(props: GncFlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditor {...props} />
    </ReactFlowProvider>
  );
}
