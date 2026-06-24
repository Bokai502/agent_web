import type { Edge, EdgeChange, Node, NodeChange, Viewport } from '@xyflow/react';
import { MarkerType, Position } from '@xyflow/react';
import { initialNodes } from './initialFlow';
import { defaultSwitchLogic } from './switchLogicDefaults';
import type {
  FlowDocument,
  FlowEdge,
  FlowEdgeData,
  FlowNode,
  FlowNodeData,
  FlowNodeKind,
  SavedFlow,
  SwitchLogicEntry,
  SwitchLogicKind,
  SwitchLogicTables,
} from './types';

export const STORAGE_KEY = 'satellite-flow-editor:v1';
export const FLOW_VERSION = 1;
export const SNAP_THRESHOLD = 8;
export const EDGE_LAYER = 20;
export const EDGE_INTERACTION_WIDTH = 34;

export type GuideLine = {
  id: string;
  type: 'vertical' | 'horizontal';
  offset: number;
  start: number;
  end: number;
};

type NodeRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type SnapCandidate = {
  delta: number;
  offset: number;
  ref: NodeRect;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const defaultSize: Record<FlowNodeKind, { width: number; height: number }> = {
  process: { width: 128, height: 42 },
  group: { width: 220, height: 150 },
  label: { width: 96, height: 40 },
};

const defaultFill: Record<FlowNodeKind, string> = {
  process: '#8bd63d',
  group: '#f3f3f3',
  label: '#f4bf8f',
};

const defaultStroke: Record<FlowNodeKind, string> = {
  process: '#336711',
  group: '#666666',
  label: '#333333',
};

const templateNodePositions = new Map(initialNodes.map((node) => [node.id, node.position]));

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function cleanPosition(node: FlowNode) {
  const fallback = templateNodePositions.get(node.id) || { x: 0, y: 0 };

  return {
    x: finiteNumber(node.position?.x) ?? fallback.x,
    y: finiteNumber(node.position?.y) ?? fallback.y,
  };
}

function cleanSize(node: FlowNode, kind: FlowNodeKind) {
  return {
    width:
      positiveNumber(node.style?.width) ??
      positiveNumber(node.width) ??
      positiveNumber(node.measured?.width) ??
      defaultSize[kind]?.width ??
      120,
    height:
      positiveNumber(node.style?.height) ??
      positiveNumber(node.height) ??
      positiveNumber(node.measured?.height) ??
      defaultSize[kind]?.height ??
      50,
  };
}

function isLockedInvisibleLabel(node: FlowNode, kind: FlowNodeKind) {
  return kind === 'label' && node.selectable === false;
}

function sanitizeNode(node: FlowNode): FlowNode {
  const kind = node.data.kind || (node.type as FlowNodeKind) || 'process';
  const size = cleanSize(node, kind);
  const locked = isLockedInvisibleLabel(node, kind);
  const cleanNode = { ...node } as FlowNode & Record<string, unknown>;

  delete cleanNode.selected;
  delete cleanNode.dragging;
  delete cleanNode.resizing;

  return {
    ...cleanNode,
    type: node.type || kind,
    position: cleanPosition(node),
    width: size.width,
    height: size.height,
    measured: {
      width: size.width,
      height: size.height,
    },
    zIndex: getNodeLayer(kind),
    connectable: kind !== 'group',
    draggable: locked ? false : true,
    selectable: locked ? false : (node.selectable ?? true),
    style: {
      ...node.style,
      width: size.width,
      height: size.height,
    },
    data: {
      ...node.data,
      kind,
      label: node.data.label || (locked ? '' : '未命名'),
    },
  } as FlowNode;
}

export function getNodeLayer(kind: FlowNodeKind) {
  if (kind === 'group') {
    return 0;
  }

  return kind === 'label' ? 3 : 2;
}

export function normalizeEdgeData(data: Partial<FlowEdgeData> | undefined): FlowEdgeData {
  return {
    condition: data?.condition || '',
    reverseCondition: data?.reverseCondition || '',
    direction: data?.direction || 'single',
    pathType: data?.pathType || 'smoothstep',
    route: data?.route,
    labelOffset: data?.labelOffset,
    reverseLabelOffset: data?.reverseLabelOffset,
  };
}

function normalizeSwitchLogicRows(kind: SwitchLogicKind, rows: unknown, fallback: SwitchLogicEntry[]): SwitchLogicEntry[] {
  const source = Array.isArray(rows) ? rows : fallback;

  return source.map((row, index) => {
    const entry = row && typeof row === 'object' ? (row as Partial<SwitchLogicEntry>) : {};
    const code = typeof entry.code === 'string' ? entry.code : '';

    return {
      id: typeof entry.id === 'string' && entry.id ? entry.id : `${kind}-${index}-${code || 'row'}`,
      code,
      description: typeof entry.description === 'string' ? entry.description : '',
    };
  });
}

export function normalizeSwitchLogic(value: unknown): SwitchLogicTables {
  const candidate = value && typeof value === 'object' ? (value as Partial<SwitchLogicTables>) : {};

  return {
    autonomous: normalizeSwitchLogicRows('autonomous', candidate.autonomous, defaultSwitchLogic.autonomous),
    command: normalizeSwitchLogicRows('command', candidate.command, defaultSwitchLogic.command),
    note: typeof candidate.note === 'string' ? candidate.note : defaultSwitchLogic.note,
  };
}

export function createNode(kind: FlowNodeKind, position: { x: number; y: number }): FlowNode {
  const size = defaultSize[kind];
  const label = {
    process: '新建模块',
    group: '分组',
    label: '文本',
  }[kind];

  return {
    id: `${kind}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type: kind,
    position,
    width: size.width,
    height: size.height,
    measured: {
      width: size.width,
      height: size.height,
    },
    style: { width: size.width, height: size.height },
    zIndex: getNodeLayer(kind),
    connectable: kind !== 'group',
    draggable: true,
    selectable: true,
    data: {
      label,
      kind,
      fill: defaultFill[kind],
      stroke: defaultStroke[kind],
    },
  };
}

export function makeConditionEdge(edge: Edge<FlowEdgeData>, condition: string): FlowEdge {
  const data = normalizeEdgeData({ ...edge.data, condition });
  const direction = data.direction || 'single';
  const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : '#333333';
  const strokeWidth = typeof edge.style?.strokeWidth === 'number' ? edge.style.strokeWidth : 1.5;
  const marker = { type: MarkerType.ArrowClosed, width: 18, height: 18, color: stroke };

  return {
    ...edge,
    id: edge.id || `edge-${edge.source}-${edge.target}-${Date.now()}`,
    type: 'condition',
    zIndex: EDGE_LAYER,
    interactionWidth: EDGE_INTERACTION_WIDTH,
    markerStart: direction === 'double' ? marker : undefined,
    markerEnd: marker,
    style: { ...edge.style, stroke, strokeWidth },
    data,
  };
}

function nodeCenter(node: FlowNode) {
  const kind = node.data.kind || (node.type as FlowNodeKind) || 'process';
  const position = cleanPosition(node);
  const size = cleanSize(node, kind);

  return {
    x: position.x + size.width / 2,
    y: position.y + size.height / 2,
  };
}

function handleId(type: 'source' | 'target', position: Position) {
  return `${type}-${position}`;
}

function positionFromHandle(handle: string | null | undefined): Position | undefined {
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

function defaultLabelOffset(sourcePosition: Position, targetPosition: Position) {
  const isVertical =
    (sourcePosition === Position.Bottom && targetPosition === Position.Top) ||
    (sourcePosition === Position.Top && targetPosition === Position.Bottom);
  const isHorizontal =
    (sourcePosition === Position.Left && targetPosition === Position.Right) ||
    (sourcePosition === Position.Right && targetPosition === Position.Left);

  if (isVertical) {
    return { x: 42, y: 0 };
  }

  if (isHorizontal) {
    return { x: 0, y: -18 };
  }

  return undefined;
}

function withDefaultEdgeLayout(edge: FlowEdge, nodeMap: Map<string, FlowNode>): FlowEdge {
  const source = nodeMap.get(edge.source);
  const target = nodeMap.get(edge.target);

  if (!source || !target) {
    return edge;
  }

  const sourceCenter = nodeCenter(source);
  const targetCenter = nodeCenter(target);
  const isHorizontal = Math.abs(targetCenter.x - sourceCenter.x) >= Math.abs(targetCenter.y - sourceCenter.y);
  let sourcePosition: Position;
  let targetPosition: Position;

  if (isHorizontal) {
    sourcePosition = targetCenter.x >= sourceCenter.x ? Position.Right : Position.Left;
    targetPosition = targetCenter.x >= sourceCenter.x ? Position.Left : Position.Right;
  } else {
    sourcePosition = targetCenter.y >= sourceCenter.y ? Position.Bottom : Position.Top;
    targetPosition = targetCenter.y >= sourceCenter.y ? Position.Top : Position.Bottom;
  }

  const data = normalizeEdgeData(edge.data);
  const normalizedSourcePosition = positionFromHandle(edge.sourceHandle) || sourcePosition;
  const normalizedTargetPosition = positionFromHandle(edge.targetHandle) || targetPosition;

  return {
    ...edge,
    sourceHandle: handleId('source', normalizedSourcePosition),
    targetHandle: handleId('target', normalizedTargetPosition),
    data: {
      ...data,
      labelOffset: data.labelOffset || defaultLabelOffset(normalizedSourcePosition, normalizedTargetPosition),
    },
  };
}

export function normalizeFlow(flow: SavedFlow): SavedFlow {
  const groupNodeIds = new Set(flow.nodes.filter((node) => node.data.kind === 'group' || node.type === 'group').map((node) => node.id));
  const nodes = flow.nodes.map(sanitizeNode);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return {
    version: FLOW_VERSION,
    nodes,
    edges: flow.edges
      .filter((edge) => !groupNodeIds.has(edge.source) && !groupNodeIds.has(edge.target))
      .map((edge) => makeConditionEdge(withDefaultEdgeLayout(edge, nodeMap), edge.data?.condition || '')),
    viewport: flow.viewport || { x: 0, y: 0, zoom: 1 },
    switchLogic: normalizeSwitchLogic(flow.switchLogic),
  };
}

export function isSavedFlow(value: unknown): value is SavedFlow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SavedFlow>;
  return (
    candidate.version === FLOW_VERSION &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    !!candidate.viewport &&
    typeof candidate.viewport.x === 'number' &&
    typeof candidate.viewport.y === 'number' &&
    typeof candidate.viewport.zoom === 'number'
  );
}

export function isFlowDocument(value: unknown): value is FlowDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<FlowDocument>;
  return (
    candidate.version === FLOW_VERSION &&
    Array.isArray(candidate.nodes) &&
    candidate.nodes.every(
      (node) =>
        !!node &&
        typeof node.name === 'string' &&
        typeof node.group === 'string' &&
        Array.isArray(node.relatedNodes) &&
        node.relatedNodes.every(
          (related) =>
            !!related &&
            typeof related.name === 'string' &&
            (related.arrowDirection === 'single' || related.arrowDirection === 'double') &&
            typeof related.condition === 'string' &&
            (related.reverseCondition === undefined || typeof related.reverseCondition === 'string'),
        ),
    )
  );
}

function normalizeFlowDocument(document: FlowDocument): FlowDocument {
  return {
    version: FLOW_VERSION,
    nodes: document.nodes.map((node) => ({
      name: node.name || '',
      group: node.group || '',
      relatedNodes: node.relatedNodes.map((related) => ({
        name: related.name || '',
        arrowDirection: related.arrowDirection || 'single',
        condition: related.condition || '',
        ...(related.reverseCondition ? { reverseCondition: related.reverseCondition } : {}),
      })),
    })),
    switchLogic: normalizeSwitchLogic(document.switchLogic),
  };
}

function uniqueNodeId(base: string, usedIds: Set<string>) {
  const cleanBase = base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  const fallback = cleanBase || `node-${usedIds.size + 1}`;
  let id = fallback;
  let index = 1;

  while (usedIds.has(id)) {
    index += 1;
    id = `${fallback}-${index}`;
  }

  usedIds.add(id);
  return id;
}

function layoutNodeFromReference(reference: FlowNode, id: string, label: string): FlowNode {
  return sanitizeNode({
    ...reference,
    id,
    data: {
      ...reference.data,
      label,
      kind: 'process',
    },
  });
}

export function flowFromDocument(document: FlowDocument, fallbackFlow: SavedFlow): SavedFlow {
  const normalizedDocument = normalizeFlowDocument(document);
  const fallback = normalizeFlow(fallbackFlow);
  const fallbackNodesByName = new Map(fallback.nodes.map((node) => [node.data.label, node]));
  const usedIds = new Set<string>();
  const groupsByName = new Map<string, FlowNode>();
  const nextNodes: FlowNode[] = [];

  normalizedDocument.nodes.forEach((documentNode, index) => {
    if (documentNode.group && !groupsByName.has(documentNode.group)) {
      const referenceGroup = fallbackNodesByName.get(documentNode.group);
      const group = sanitizeNode({
        ...(referenceGroup || createNode('group', { x: 80 + groupsByName.size * 260, y: 80 })),
        id: uniqueNodeId(`group-${documentNode.group}`, usedIds),
        type: 'group',
        data: {
          ...(referenceGroup?.data || {}),
          label: documentNode.group,
          kind: 'group',
        },
        connectable: false,
      } as FlowNode);

      groupsByName.set(documentNode.group, group);
      nextNodes.push(group);
    }

    const referenceNode = fallbackNodesByName.get(documentNode.name);
    const group = groupsByName.get(documentNode.group);
    const generatedPosition = group
      ? { x: group.position.x + 40 + (index % 2) * 160, y: group.position.y + 46 + Math.floor(index / 2) * 62 }
      : { x: 120 + (index % 4) * 170, y: 120 + Math.floor(index / 4) * 72 };
    const node = referenceNode
      ? layoutNodeFromReference(referenceNode, uniqueNodeId(referenceNode.id, usedIds), documentNode.name)
      : createNode('process', generatedPosition);

    nextNodes.push({
      ...node,
      id: node.id,
      data: {
        ...node.data,
        label: documentNode.name,
        kind: 'process',
      },
      position: referenceNode ? node.position : generatedPosition,
    } as FlowNode);
  });

  const nodesByName = new Map(nextNodes.filter((node) => node.data.kind !== 'group').map((node) => [node.data.label, node]));
  const nextEdges: FlowEdge[] = [];

  normalizedDocument.nodes.forEach((documentNode) => {
    const source = nodesByName.get(documentNode.name);

    if (!source) {
      return;
    }

    documentNode.relatedNodes.forEach((related, index) => {
      const target = nodesByName.get(related.name);

      if (!target) {
        return;
      }

      const handles = withDefaultEdgeLayout(
        makeConditionEdge(
          {
            id: `edge-${source.id}-${target.id}-${index}`,
            source: source.id,
            target: target.id,
            data: {
              condition: related.condition,
              reverseCondition: related.reverseCondition || '',
              direction: related.arrowDirection,
              pathType: 'smoothstep',
            },
          },
          related.condition,
        ),
        new Map(nextNodes.map((node) => [node.id, node])),
      );

      nextEdges.push(makeConditionEdge(handles, related.condition));
    });
  });

  return normalizeFlow({
    version: FLOW_VERSION,
    nodes: nextNodes,
    edges: nextEdges,
    viewport: fallback.viewport,
    switchLogic: normalizedDocument.switchLogic,
  });
}

export function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function collectPageStyles() {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');
}

export async function exportElementAsPng(element: HTMLElement, filename: string) {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const clone = element.cloneNode(true) as HTMLElement;

  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.margin = '0';
  clone.style.background = '#f6f7f9';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          <style>${collectPageStyles()}</style>
          ${clone.outerHTML}
        </div>
      </foreignObject>
    </svg>`;

  const image = new Image();
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = reject;
  });

  image.src = svgUrl;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = width * window.devicePixelRatio;
  canvas.height = height * window.devicePixelRatio;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is not available.');
  }

  context.scale(window.devicePixelRatio, window.devicePixelRatio);
  context.fillStyle = '#f6f7f9';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('PNG export failed.');
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function readSavedFlow(): SavedFlow | null {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isSavedFlow(parsed) ? normalizeFlow(parsed) : null;
  } catch {
    return null;
  }
}

export function writeSavedFlow(flow: SavedFlow) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flow));
}

function nodeRect(node: Node<FlowNodeData>): NodeRect {
  const kind = node.data.kind || (node.type as FlowNodeKind) || 'process';
  const flowNode = node as FlowNode;
  const position = cleanPosition(flowNode);
  const size = cleanSize(flowNode, kind);

  return {
    id: node.id,
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

function axes(rect: NodeRect) {
  return {
    x: [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    y: [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
  };
}

export function getSnapResult(nodes: FlowNode[], movingNode: FlowNode): {
  position: { x: number; y: number };
  lines: GuideLine[];
} {
  const moving = nodeRect(movingNode);
  const movingAxes = axes(moving);
  const snapXCandidates: SnapCandidate[] = [];
  const snapYCandidates: SnapCandidate[] = [];

  nodes
    .filter((node) => node.id !== movingNode.id)
    .map(nodeRect)
    .forEach((rect) => {
      const referenceAxes = axes(rect);

      movingAxes.x.forEach((movingOffset) => {
        referenceAxes.x.forEach((referenceOffset) => {
          const delta = referenceOffset - movingOffset;
          if (Math.abs(delta) <= SNAP_THRESHOLD) {
            snapXCandidates.push({ delta, offset: referenceOffset, ref: rect });
          }
        });
      });

      movingAxes.y.forEach((movingOffset) => {
        referenceAxes.y.forEach((referenceOffset) => {
          const delta = referenceOffset - movingOffset;
          if (Math.abs(delta) <= SNAP_THRESHOLD) {
            snapYCandidates.push({ delta, offset: referenceOffset, ref: rect });
          }
        });
      });
    });

  const snapX = snapXCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
  const snapY = snapYCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];

  const nextPosition = {
    x: moving.x + (snapX?.delta ?? 0),
    y: moving.y + (snapY?.delta ?? 0),
  };

  const movedRect = {
    ...moving,
    x: nextPosition.x,
    y: nextPosition.y,
  };

  const lines: GuideLine[] = [];

  if (snapX) {
    lines.push({
      id: `v-${moving.id}-${snapX.ref.id}`,
      type: 'vertical',
      offset: snapX.offset,
      start: Math.min(movedRect.y, snapX.ref.y) - 28,
      end: Math.max(movedRect.y + movedRect.height, snapX.ref.y + snapX.ref.height) + 28,
    });
  }

  if (snapY) {
    lines.push({
      id: `h-${moving.id}-${snapY.ref.id}`,
      type: 'horizontal',
      offset: snapY.offset,
      start: Math.min(movedRect.x, snapY.ref.x) - 28,
      end: Math.max(movedRect.x + movedRect.width, snapY.ref.x + snapY.ref.width) + 28,
    });
  }

  return { position: nextPosition, lines };
}

export function shouldCommitHistory(changes: NodeChange[]) {
  return changes.some((change) => {
    if (change.type === 'select') {
      return false;
    }

    if (change.type === 'position') {
      return !change.dragging;
    }

    return change.type !== 'dimensions';
  });
}

export function shouldCommitEdgeHistory(changes: EdgeChange[]) {
  return changes.some((change) => change.type !== 'select');
}

export function makeSavedFlow(nodes: FlowNode[], edges: FlowEdge[], viewport: Viewport, switchLogic: SwitchLogicTables): SavedFlow {
  const cleanNodes = nodes.map((node) => {
    const cleanNode = { ...sanitizeNode(node) } as FlowNode & Record<string, unknown>;

    delete cleanNode.measured;
    delete cleanNode.selected;
    delete cleanNode.dragging;
    delete cleanNode.resizing;

    return cleanNode as FlowNode;
  });
  const groupNodeIds = new Set(cleanNodes.filter((node) => node.data.kind === 'group' || node.type === 'group').map((node) => node.id));
  const nodeMap = new Map(cleanNodes.map((node) => [node.id, node]));

  return {
    version: FLOW_VERSION,
    nodes: cleanNodes,
    edges: edges
      .filter((edge) => !groupNodeIds.has(edge.source) && !groupNodeIds.has(edge.target))
      .map((edge) => {
        const cleanEdge = makeConditionEdge(withDefaultEdgeLayout(edge, nodeMap), edge.data?.condition || '');
        const edgeForSave = { ...cleanEdge } as FlowEdge & Record<string, unknown>;

        delete edgeForSave.selected;

        return {
          ...edgeForSave,
          data: normalizeEdgeData(cleanEdge.data),
        } as FlowEdge;
      }),
    viewport,
    switchLogic: normalizeSwitchLogic(switchLogic),
  };
}

function nodeBounds(node: FlowNode): Bounds {
  const kind = node.data.kind || (node.type as FlowNodeKind) || 'process';
  const position = cleanPosition(node);
  const size = cleanSize(node, kind);

  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  };
}

function containsNode(group: FlowNode, node: FlowNode) {
  const groupRect = nodeBounds(group);
  const nodeRect = nodeBounds(node);
  const center = {
    x: nodeRect.x + nodeRect.width / 2,
    y: nodeRect.y + nodeRect.height / 2,
  };

  return (
    center.x >= groupRect.x &&
    center.x <= groupRect.x + groupRect.width &&
    center.y >= groupRect.y &&
    center.y <= groupRect.y + groupRect.height
  );
}

function groupNameForNode(node: FlowNode, groups: FlowNode[]) {
  const containingGroups = groups.filter((group) => containsNode(group, node));

  if (!containingGroups.length) {
    return '';
  }

  return containingGroups
    .sort((a, b) => {
      const aBounds = nodeBounds(a);
      const bBounds = nodeBounds(b);
      return aBounds.width * aBounds.height - bBounds.width * bBounds.height;
    })[0].data.label;
}

export function makeFlowDocument(nodes: FlowNode[], edges: FlowEdge[], switchLogic: SwitchLogicTables): FlowDocument {
  const cleanNodes = nodes.map(sanitizeNode);
  const visibleNodes = cleanNodes.filter((node) => node.data.kind !== 'group' && node.data.kind !== 'label' && node.data.label.trim());
  const groups = cleanNodes.filter((node) => node.data.kind === 'group' && node.data.label.trim());
  const nodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
  const connectionsBySource = new Map<string, FlowDocument['nodes'][number]['relatedNodes']>();

  edges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);

    if (!source || !target) {
      return;
    }

    const data = normalizeEdgeData(edge.data);
    const direction = data.direction || 'single';
    const connections = connectionsBySource.get(edge.source) || [];

    connections.push({
      name: target.data.label,
      arrowDirection: direction,
      condition: data.condition,
      ...(direction === 'double' && data.reverseCondition ? { reverseCondition: data.reverseCondition } : {}),
    });
    connectionsBySource.set(edge.source, connections);
  });

  return {
    version: FLOW_VERSION,
    nodes: visibleNodes.map((node) => ({
      name: node.data.label,
      group: groupNameForNode(node, groups),
      relatedNodes: connectionsBySource.get(node.id) || [],
    })),
    switchLogic: normalizeSwitchLogic(switchLogic),
  };
}
