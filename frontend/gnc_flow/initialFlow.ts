import { MarkerType, Position } from '@xyflow/react';
import { defaultSwitchLogic } from './switchLogicDefaults';
import type { FlowEdge, FlowEdgeData, FlowNode, SavedFlow } from './types';

const BLUE = '#5b9bd5';
const GROUP_RED = '#ff8a8a';

const edgeDefaults = {
  type: 'condition',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: BLUE },
  style: { stroke: BLUE, strokeWidth: 1.25 },
};

const handles = {
  sourcePosition: Position.Bottom,
  targetPosition: Position.Top,
};

function sourceHandle(position: Position) {
  return `source-${position}`;
}

function targetHandle(position: Position) {
  return `target-${position}`;
}

function groupNode(id: string, label: string, x: number, y: number, width: number, height: number): FlowNode {
  return {
    id,
    type: 'group',
    position: { x, y },
    data: {
      label,
      kind: 'group',
      fill: 'rgba(255,255,255,0.02)',
      stroke: GROUP_RED,
      textColor: '#2f8fd6',
      borderStyle: 'dashed',
    },
    width,
    height,
    style: { width, height },
    selectable: true,
    draggable: true,
    connectable: false,
  };
}

function processNode(id: string, label: string, x: number, y: number, width = 132, height = 36): FlowNode {
  return {
    id,
    type: 'process',
    position: { x, y },
    data: {
      label,
      kind: 'process',
      fill: '#f9fcff',
      stroke: BLUE,
      textColor: '#111111',
    },
    width,
    height,
    style: { width, height },
    ...handles,
  };
}

function anchorNode(id: string, x: number, y: number): FlowNode {
  return {
    id,
    type: 'label',
    position: { x, y },
    data: {
      label: '',
      kind: 'label',
      fill: 'transparent',
      stroke: 'transparent',
      textColor: 'transparent',
    },
    width: 1,
    height: 1,
    style: { width: 1, height: 1, opacity: 0 },
    selectable: false,
    draggable: false,
  };
}

function conditionEdge(
  id: string,
  source: string,
  target: string,
  condition: string,
  options: Partial<Omit<FlowEdge, 'data'>> & { data?: Partial<FlowEdgeData> } = {},
): FlowEdge {
  const { data, ...rest } = options;

  return {
    ...edgeDefaults,
    id,
    source,
    target,
    data: {
      condition,
      pathType: 'smoothstep',
      ...data,
    },
    ...rest,
  };
}

export const initialNodes: FlowNode[] = [
  groupNode('group-safe', '安全模式', 42, 225, 168, 230),
  groupNode('group-orbit', '入轨模式', 230, 28, 380, 350),
  groupNode('group-task', '任务模式', 230, 390, 380, 210),
  groupNode('group-orbit-control', '轨控模式', 125, 615, 400, 92),

  processNode('orbit-rate-damping-1', '入轨速率阻尼1', 335, 52),
  processNode('orbit-panel-deploy', '入轨帆板展开', 335, 122),
  processNode('orbit-rate-damping-2', '入轨速率阻尼2', 335, 192),
  processNode('orbit-sun-capture', '入轨太阳捕获', 335, 262),
  processNode('orbit-sun-pointing', '入轨对日定向', 335, 332),

  processNode('safe-rate-damping', '安全速率阻尼', 68, 270, 124),
  processNode('safe-sun-capture', '安全太阳捕获', 68, 340, 124),
  processNode('safe-sun-pointing', '安全对日定向', 68, 410, 124),

  processNode('task-sun-pointing', '任务对日定向', 335, 405),
  processNode('task-attitude-maneuver', '任务姿态机动', 335, 472),
  processNode('task-normal-pointing', '任务常规指向', 250, 545, 138),
  processNode('task-stable-pointing', '任务高稳定度指向', 445, 545, 148),

  processNode('orbit-control-ready', '轨控姿态准备', 160, 640, 124),
  processNode('orbit-control-thruster', '轨控推力器工作', 350, 640, 138),

  anchorNode('anchor-left-a13', 22, 520),
  anchorNode('anchor-left-a14', 22, 658),
];

export const initialEdges: FlowEdge[] = [
  conditionEdge('edge-a1', 'orbit-rate-damping-1', 'orbit-panel-deploy', 'A1', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-a2', 'orbit-panel-deploy', 'orbit-rate-damping-2', 'A2', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-a3', 'orbit-rate-damping-2', 'orbit-sun-capture', 'A3', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-a4', 'orbit-sun-capture', 'orbit-sun-pointing', 'A4', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-c1', 'orbit-sun-pointing', 'task-sun-pointing', 'C1', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),

  conditionEdge('edge-a10', 'safe-rate-damping', 'safe-sun-capture', 'A10', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-a11', 'safe-sun-capture', 'safe-sun-pointing', 'A11', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-a12', 'orbit-sun-capture', 'safe-rate-damping', 'A12', {
    sourceHandle: sourceHandle(Position.Left),
    targetHandle: targetHandle(Position.Right),
    data: { labelOffset: { x: -4, y: -18 } },
  }),
  conditionEdge('edge-c8', 'safe-sun-pointing', 'task-sun-pointing', 'C8', {
    sourceHandle: sourceHandle(Position.Right),
    targetHandle: targetHandle(Position.Left),
    data: { labelOffset: { x: 0, y: -16 } },
  }),

  conditionEdge('edge-c2', 'task-sun-pointing', 'task-attitude-maneuver', 'C2', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 42, y: 0 } },
  }),
  conditionEdge('edge-a5', 'task-attitude-maneuver', 'task-normal-pointing', 'A5', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: -20, y: -14 } },
  }),
  conditionEdge('edge-c5', 'task-normal-pointing', 'task-attitude-maneuver', 'C5', {
    sourceHandle: sourceHandle(Position.Top),
    targetHandle: targetHandle(Position.Bottom),
    data: { labelOffset: { x: 22, y: 10 } },
  }),
  conditionEdge('edge-c6', 'task-attitude-maneuver', 'task-stable-pointing', 'C6', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: -20, y: -14 } },
  }),
  conditionEdge('edge-a6', 'task-stable-pointing', 'task-attitude-maneuver', 'A6', {
    sourceHandle: sourceHandle(Position.Top),
    targetHandle: targetHandle(Position.Bottom),
    data: { labelOffset: { x: 24, y: 10 } },
  }),
  conditionEdge('edge-c3-c4', 'task-normal-pointing', 'task-stable-pointing', 'C3', {
    sourceHandle: sourceHandle(Position.Right),
    targetHandle: targetHandle(Position.Left),
    data: {
      direction: 'double',
      reverseCondition: 'C4',
      labelOffset: { x: 0, y: -8 },
      reverseLabelOffset: { x: 0, y: 8 },
    },
  }),

  conditionEdge('edge-c7', 'task-normal-pointing', 'orbit-control-ready', 'C7', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: -34, y: -16 } },
  }),
  conditionEdge('edge-a9', 'orbit-control-ready', 'task-normal-pointing', 'A9', {
    sourceHandle: sourceHandle(Position.Top),
    targetHandle: targetHandle(Position.Bottom),
    data: { labelOffset: { x: -12, y: 18 } },
  }),
  conditionEdge('edge-a8', 'task-normal-pointing', 'orbit-control-thruster', 'A8', {
    sourceHandle: sourceHandle(Position.Bottom),
    targetHandle: targetHandle(Position.Top),
    data: { labelOffset: { x: 30, y: -16 } },
  }),
  conditionEdge('edge-a7', 'orbit-control-ready', 'orbit-control-thruster', 'A7', {
    sourceHandle: sourceHandle(Position.Right),
    targetHandle: targetHandle(Position.Left),
  }),

  conditionEdge('edge-a13', 'task-normal-pointing', 'anchor-left-a13', 'A13', {
    sourceHandle: sourceHandle(Position.Left),
    targetHandle: targetHandle(Position.Right),
    data: { labelOffset: { x: 0, y: -18 } },
  }),
  conditionEdge('edge-a14', 'anchor-left-a14', 'orbit-control-ready', 'A14', {
    sourceHandle: sourceHandle(Position.Right),
    targetHandle: targetHandle(Position.Left),
    data: { labelOffset: { x: 0, y: -18 } },
  }),
];

export const initialFlow: SavedFlow = {
  version: 1,
  nodes: initialNodes,
  edges: initialEdges,
  viewport: { x: 32, y: 8, zoom: 0.95 },
  switchLogic: defaultSwitchLogic,
};
