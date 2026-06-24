import type { Edge, Node, Viewport } from '@xyflow/react';

export type FlowNodeKind = 'process' | 'group' | 'label';

export type FlowNodeData = {
  label: string;
  kind: FlowNodeKind;
  fill?: string;
  stroke?: string;
  textColor?: string;
  borderStyle?: 'solid' | 'dashed';
};

export type FlowEdgeData = {
  condition: string;
  reverseCondition?: string;
  direction?: 'single' | 'double';
  pathType?: 'smoothstep' | 'straight' | 'bezier';
  route?: FlowEdgeRoute;
  labelOffset?: FlowPoint;
  reverseLabelOffset?: FlowPoint;
};

export type FlowEdgeRoute = {
  orientation: 'horizontal' | 'vertical';
  offset: number;
};

export type FlowPoint = {
  x: number;
  y: number;
};

export type SwitchLogicKind = 'autonomous' | 'command';

export type SwitchLogicEntry = {
  id: string;
  code: string;
  description: string;
};

export type SwitchLogicTables = Record<SwitchLogicKind, SwitchLogicEntry[]> & {
  note: string;
};

export type FlowNode = Node<FlowNodeData>;

export type FlowEdge = Edge<FlowEdgeData>;

export type FlowDocumentConnection = {
  name: string;
  arrowDirection: 'single' | 'double';
  condition: string;
  reverseCondition?: string;
};

export type FlowDocumentNode = {
  name: string;
  group: string;
  relatedNodes: FlowDocumentConnection[];
};

export type FlowDocument = {
  version: 1;
  nodes: FlowDocumentNode[];
  switchLogic: SwitchLogicTables;
};

export type SavedFlow = {
  version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport: Viewport;
  switchLogic: SwitchLogicTables;
};

export type SelectionState =
  | { type: 'node'; id: string }
  | { type: 'edge'; id: string }
  | null;
