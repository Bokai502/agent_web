import {
  EdgeLabelRenderer,
  Position,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
} from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { EDGE_INTERACTION_WIDTH, normalizeEdgeData } from './flowUtils';
import type { FlowEdge, FlowEdgeRoute, FlowNode } from './types';

type ConditionField = 'condition' | 'reverseCondition';
type RoutePoint = { x: number; y: number };
type RouteSegment = {
  id: string;
  index: number;
  orientation: FlowEdgeRoute['orientation'];
  start: RoutePoint;
  end: RoutePoint;
};

const SEGMENT_EPSILON = 0.5;
const ROUTE_SNAP_THRESHOLD = 16;
const TARGET_APPROACH_LENGTH = 24;
const EDGE_ENDPOINT_POINTER_GAP = 28;

function getConditionPath(props: EdgeProps<FlowEdge>) {
  switch (props.data?.pathType) {
    case 'straight':
      return getStraightPath(props);
    case 'bezier':
      return getBezierPath(props);
    default:
      return getSmoothStepPath({
        ...props,
        borderRadius: 8,
      });
  }
}

function inputWidth(value: string) {
  return `${Math.max(42, Math.min(140, value.length * 12 + 26))}px`;
}

function snapCoordinate(value: number, candidates: number[]) {
  const closest = candidates
    .map((candidate) => ({ candidate, distance: Math.abs(candidate - value) }))
    .sort((a, b) => a.distance - b.distance)[0];

  return closest && closest.distance <= ROUTE_SNAP_THRESHOLD ? closest.candidate : value;
}

function simplifyPoints(points: RoutePoint[]) {
  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    return distance(point, points[index - 1]) > SEGMENT_EPSILON;
  });
}

function targetApproachPoint(props: EdgeProps<FlowEdge>) {
  switch (props.targetPosition) {
    case Position.Left:
      return { x: props.targetX - TARGET_APPROACH_LENGTH, y: props.targetY };
    case Position.Right:
      return { x: props.targetX + TARGET_APPROACH_LENGTH, y: props.targetY };
    case Position.Bottom:
      return { x: props.targetX, y: props.targetY + TARGET_APPROACH_LENGTH };
    case Position.Top:
    default:
      return { x: props.targetX, y: props.targetY - TARGET_APPROACH_LENGTH };
  }
}

function routePoints(props: EdgeProps<FlowEdge>, route?: FlowEdgeRoute): RoutePoint[] {
  const source = { x: props.sourceX, y: props.sourceY };
  const target = { x: props.targetX, y: props.targetY };
  const targetApproach = targetApproachPoint(props);
  const orientation = route?.orientation || 'vertical';
  const isDirectVertical =
    Math.abs(source.x - target.x) <= SEGMENT_EPSILON &&
    ((props.sourcePosition === Position.Bottom && props.targetPosition === Position.Top && source.y <= target.y) ||
      (props.sourcePosition === Position.Top && props.targetPosition === Position.Bottom && source.y >= target.y));
  const isDirectHorizontal =
    Math.abs(source.y - target.y) <= SEGMENT_EPSILON &&
    ((props.sourcePosition === Position.Right && props.targetPosition === Position.Left && source.x <= target.x) ||
      (props.sourcePosition === Position.Left && props.targetPosition === Position.Right && source.x >= target.x));

  if (isDirectVertical || isDirectHorizontal) {
    return [source, target];
  }

  if (orientation === 'vertical') {
    const baseX = (props.sourceX + props.targetX) / 2;
    const centerX = snapCoordinate(baseX + (route?.offset || 0), [props.sourceX, targetApproach.x, baseX]);
    return simplifyPoints([source, { x: centerX, y: props.sourceY }, { x: centerX, y: targetApproach.y }, targetApproach, target]);
  }

  const baseY = (props.sourceY + props.targetY) / 2;
  const centerY = snapCoordinate(baseY + (route?.offset || 0), [props.sourceY, targetApproach.y, baseY]);
  return simplifyPoints([source, { x: props.sourceX, y: centerY }, { x: targetApproach.x, y: centerY }, targetApproach, target]);
}

function defaultRoute(props: EdgeProps<FlowEdge>): FlowEdgeRoute {
  const horizontalDistance = Math.abs(props.targetX - props.sourceX);
  const verticalDistance = Math.abs(props.targetY - props.sourceY);

  return {
    orientation: horizontalDistance >= verticalDistance ? 'vertical' : 'horizontal',
    offset: 0,
  };
}

function pointsToPath(points: RoutePoint[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function distance(a: RoutePoint, b: RoutePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointAtPolylineDistance(points: RoutePoint[], targetDistance: number) {
  let walked = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const length = distance(start, end);

    if (walked + length >= targetDistance) {
      const ratio = length ? (targetDistance - walked) / length : 0;

      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }

    walked += length;
  }

  return points[points.length - 1];
}

function trimPolyline(points: RoutePoint[], startTrim: number, endTrim: number) {
  if (points.length < 2) {
    return points;
  }

  const segmentLengths = points.slice(0, -1).map((point, index) => distance(point, points[index + 1]));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);

  if (totalLength <= startTrim + endTrim + 8) {
    return points;
  }

  const startDistance = Math.max(0, startTrim);
  const endDistance = Math.min(totalLength, totalLength - endTrim);
  const trimmed = [pointAtPolylineDistance(points, startDistance)];
  let walked = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    walked += segmentLengths[index - 1];

    if (walked > startDistance && walked < endDistance) {
      trimmed.push(points[index]);
    }
  }

  trimmed.push(pointAtPolylineDistance(points, endDistance));
  return simplifyPoints(trimmed);
}

function midpoint(a: RoutePoint, b: RoutePoint) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function polylineLabelPoint(points: RoutePoint[]) {
  const segmentLengths = points.slice(0, -1).map((point, index) => distance(point, points[index + 1]));
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);

  if (!totalLength) {
    return midpoint(points[0], points[points.length - 1]);
  }

  let walked = 0;
  const halfway = totalLength / 2;

  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index];

    if (walked + length >= halfway) {
      const ratio = length ? (halfway - walked) / length : 0;
      const start = points[index];
      const end = points[index + 1];

      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }

    walked += length;
  }

  return midpoint(points[0], points[points.length - 1]);
}

function routeSegments(points: RoutePoint[]) {
  return points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1];
    const isVertical = Math.abs(start.x - end.x) <= SEGMENT_EPSILON;
    const isHorizontal = Math.abs(start.y - end.y) <= SEGMENT_EPSILON;

    if (!isVertical && !isHorizontal) {
      return [];
    }

    if (index === points.length - 2 || distance(start, end) < 18) {
      return [];
    }

    return [
      {
        id: `${index}-${isVertical ? 'vertical' : 'horizontal'}`,
        index,
        orientation: isVertical ? 'vertical' : 'horizontal',
        start,
        end,
      } satisfies RouteSegment,
    ];
  });
}

function distanceToSegment(segment: RouteSegment, point: RoutePoint) {
  const minX = Math.min(segment.start.x, segment.end.x);
  const maxX = Math.max(segment.start.x, segment.end.x);
  const minY = Math.min(segment.start.y, segment.end.y);
  const maxY = Math.max(segment.start.y, segment.end.y);

  if (segment.orientation === 'vertical') {
    const clampedY = Math.max(minY, Math.min(maxY, point.y));
    return Math.hypot(point.x - segment.start.x, point.y - clampedY);
  }

  const clampedX = Math.max(minX, Math.min(maxX, point.x));
  return Math.hypot(point.x - clampedX, point.y - segment.start.y);
}

function nearestSegment(segments: RouteSegment[], point: RoutePoint) {
  return segments
    .map((segment) => ({ segment, distance: distanceToSegment(segment, point) }))
    .sort((a, b) => a.distance - b.distance)[0]?.segment;
}

function routeFromSegmentDrag(props: EdgeProps<FlowEdge>, segment: RouteSegment, point: RoutePoint): FlowEdgeRoute {
  const targetApproach = targetApproachPoint(props);

  if (segment.orientation === 'vertical') {
    const baseX = (props.sourceX + props.targetX) / 2;
    const x = snapCoordinate(point.x, [props.sourceX, targetApproach.x, baseX]);

    return {
      orientation: 'vertical',
      offset: x - baseX,
    };
  }

  const baseY = (props.sourceY + props.targetY) / 2;
  const y = snapCoordinate(point.y, [props.sourceY, targetApproach.y, baseY]);

  return {
    orientation: 'horizontal',
    offset: y - baseY,
  };
}

export function ConditionEdge(props: EdgeProps<FlowEdge>) {
  const [autoPath, autoLabelX, autoLabelY] = getConditionPath(props);
  const isRoutable = (props.data?.pathType || 'smoothstep') === 'smoothstep';
  const route = isRoutable ? props.data?.route || defaultRoute(props) : undefined;
  const points = route ? routePoints(props, route) : null;
  const edgePath = points ? pointsToPath(points) : autoPath;
  const interactionPoints = points ? trimPolyline(points, EDGE_ENDPOINT_POINTER_GAP, EDGE_ENDPOINT_POINTER_GAP) : null;
  const interactionPath = interactionPoints ? pointsToPath(interactionPoints) : autoPath;
  const labelPoint = points ? polylineLabelPoint(points) : { x: autoLabelX, y: autoLabelY };
  const segments = props.selected && interactionPoints ? routeSegments(interactionPoints) : [];
  const isDouble = props.data?.direction === 'double';
  const condition = props.data?.condition || '';
  const reverseCondition = props.data?.reverseCondition || '';
  const labelOffset = props.data?.labelOffset || { x: 0, y: 0 };
  const reverseLabelOffset = props.data?.reverseLabelOffset || { x: 0, y: 0 };
  const [draft, setDraft] = useState(condition);
  const [reverseDraft, setReverseDraft] = useState(reverseCondition);
  const [draggedSegment, setDraggedSegment] = useState<string | null>(null);
  const forwardInputRef = useRef<HTMLInputElement>(null);
  const reverseInputRef = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition, setEdges } = useReactFlow<FlowNode, FlowEdge>();
  const stroke = typeof props.style?.stroke === 'string' ? props.style.stroke : '#333333';
  const strokeWidth = typeof props.style?.strokeWidth === 'number' ? props.style.strokeWidth : 1.5;

  useEffect(() => {
    setDraft(condition);
  }, [condition]);

  useEffect(() => {
    setReverseDraft(reverseCondition);
  }, [reverseCondition]);

  const updateEdgeData = (patch: Partial<NonNullable<FlowEdge['data']>>) => {
    setEdges((edges) =>
      edges.map((edge) =>
        edge.id === props.id
          ? {
              ...edge,
              data: {
                ...normalizeEdgeData(edge.data),
                ...patch,
              },
            }
          : edge,
      ),
    );
  };

  const updateCondition = (field: ConditionField, value: string) => {
    if (field === 'condition') {
      setDraft(value);
    } else {
      setReverseDraft(value);
    }

    updateEdgeData({ [field]: value });
  };

  const flowPointFromEvent = (event: Pick<PointerEvent | ReactPointerEvent, 'clientX' | 'clientY'>) =>
    screenToFlowPosition({ x: event.clientX, y: event.clientY });

  const updateRoute = (segment: RouteSegment, point: RoutePoint) => {
    updateEdgeData({ route: routeFromSegmentDrag(props, segment, point) });
  };

  const startSegmentDrag = (segment: RouteSegment) => (event: ReactPointerEvent<SVGPathElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggedSegment(segment.id);
    updateRoute(segment, flowPointFromEvent(event));

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRoute(segment, flowPointFromEvent(moveEvent));
    };

    const handlePointerUp = () => {
      setDraggedSegment(null);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const startPathDrag = (event: ReactPointerEvent<SVGPathElement>) => {
    if (!props.selected || !isRoutable || !interactionPoints) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = flowPointFromEvent(event);
    const segment = nearestSegment(routeSegments(interactionPoints), point);

    if (!segment) {
      return;
    }

    setDraggedSegment(segment.id);
    updateRoute(segment, point);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRoute(segment, flowPointFromEvent(moveEvent));
    };

    const handlePointerUp = () => {
      setDraggedSegment(null);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const stopCanvasEvent = (event: ReactMouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  };

  const handleChange = (field: ConditionField) => (event: ChangeEvent<HTMLInputElement>) => {
    updateCondition(field, event.target.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.key === 'Enter') {
      (event.currentTarget as HTMLInputElement).blur();
    }
  };

  const renderLabel = (
    field: ConditionField,
    value: string,
    inputRef: RefObject<HTMLInputElement | null>,
    className: string,
    placeholder: string,
    yOffset: number,
    extraOffset = { x: 0, y: 0 },
  ) => (
    <div
      className={`edge-condition-label ${className}${props.selected ? ' selected' : ''}`}
      style={{
        transform: `translate(-50%, -50%) translate(${labelPoint.x + extraOffset.x}px, ${
          labelPoint.y + yOffset + extraOffset.y
        }px)`,
      }}
    >
      {props.selected ? (
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          style={{ width: inputWidth(value) }}
          onChange={handleChange(field)}
          onClick={stopCanvasEvent}
          onMouseDown={stopCanvasEvent}
          onKeyDown={handleKeyDown}
          className="edge-condition-input"
        />
      ) : (
        value || placeholder
      )}
    </div>
  );

  return (
    <>
      <path
        id={props.id}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path"
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={{
          ...props.style,
          stroke: props.selected ? '#1677ff' : stroke,
          strokeWidth: props.selected ? Math.max(strokeWidth, 2.25) : strokeWidth,
        }}
      />
      <path
        d={interactionPath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={props.selected ? (props.interactionWidth ?? EDGE_INTERACTION_WIDTH) : 10}
        className="react-flow__edge-interaction"
        onPointerDown={startPathDrag}
      />
      {segments.map((segment) => (
        <path
          key={segment.id}
          d={`M ${segment.start.x} ${segment.start.y} L ${segment.end.x} ${segment.end.y}`}
          fill="none"
          strokeOpacity={0}
          strokeWidth={Math.max(props.interactionWidth ?? EDGE_INTERACTION_WIDTH, 42)}
          className={`edge-segment-dragger ${segment.orientation}${draggedSegment === segment.id ? ' dragging' : ''}`}
          onPointerDown={startSegmentDrag(segment)}
        />
      ))}
      <EdgeLabelRenderer>
        {renderLabel(
          'condition',
          draft,
          forwardInputRef,
          isDouble ? 'forward' : 'single',
          isDouble ? '正向' : '条件',
          isDouble ? -16 : 0,
          labelOffset,
        )}
        {isDouble &&
          renderLabel(
            'reverseCondition',
            reverseDraft,
            reverseInputRef,
            'reverse',
            '反向',
            16,
            reverseLabelOffset,
          )}
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = {
  condition: ConditionEdge,
};
