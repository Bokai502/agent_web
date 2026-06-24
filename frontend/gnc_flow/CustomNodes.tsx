import { Handle, NodeResizer, Position, useReactFlow } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import type { FlowNode } from './types';

const positions = [Position.Top, Position.Right, Position.Bottom, Position.Left];

function NodeHandles() {
  return (
    <>
      {positions.map((position) => (
        <Handle
          key={`target-${position}`}
          id={`target-${position}`}
          type="target"
          position={position}
          className="node-handle"
        />
      ))}
      {positions.map((position) => (
        <Handle
          key={`source-${position}`}
          id={`source-${position}`}
          type="source"
          position={position}
          className="node-handle"
        />
      ))}
    </>
  );
}

function InlineNodeLabel({
  id,
  value,
  selected,
  className,
  placeholder = '输入文字',
}: {
  id: string;
  value: string;
  selected: boolean;
  className: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { updateNodeData } = useReactFlow();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!selected) {
      setEditing(false);
    }
  }, [selected]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const updateLabel = (nextValue: string) => {
    setDraft(nextValue);
    updateNodeData(id, { label: nextValue });
  };

  const stopCanvasEvent = (event: MouseEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateLabel(event.target.value);
  };

  const startEditing = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setEditing(true);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      inputRef.current?.blur();
    }
  };

  if (!editing) {
    return (
      <div className={className} onDoubleClick={startEditing} title="双击编辑文字">
        {value || placeholder}
      </div>
    );
  }

  return (
    <textarea
      ref={inputRef}
      value={draft}
      placeholder={placeholder}
      onChange={handleChange}
      onClick={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      onBlur={() => setEditing(false)}
      onKeyDown={handleKeyDown}
      className={`${className} inline-node-input nodrag nopan`}
      rows={Math.max(1, draft.split('\n').length)}
    />
  );
}

function BaseNode({ id, data, selected }: NodeProps<FlowNode>) {
  const style = {
    '--node-fill': data.fill || '#ffffff',
    '--node-stroke': data.stroke || '#333333',
    '--node-text': data.textColor || '#111111',
    '--node-border-style': data.borderStyle || 'solid',
  } as CSSProperties;

  return (
    <div className={`flow-node flow-node-${data.kind}`} style={style}>
      <NodeHandles />
      <NodeResizer color="#1677ff" isVisible={selected} minWidth={48} minHeight={32} />
      <InlineNodeLabel id={id} value={data.label} selected={!!selected} className="flow-node-label" />
    </div>
  );
}

function GroupNode({ id, data, selected }: NodeProps<FlowNode>) {
  const style = {
    '--node-fill': data.fill || '#f3f3f3',
    '--node-stroke': data.stroke || '#666666',
    '--node-text': data.textColor || '#222222',
    '--node-border-style': data.borderStyle || 'solid',
  } as CSSProperties;

  return (
    <div className="flow-node flow-node-group" style={style}>
      <NodeResizer color="#1677ff" isVisible={selected} minWidth={120} minHeight={80} />
      {(data.label || selected) && (
        <InlineNodeLabel id={id} value={data.label} selected={!!selected} className="group-title" placeholder="分组名称" />
      )}
    </div>
  );
}

function LabelNode({ id, data, selected }: NodeProps<FlowNode>) {
  const style = {
    '--node-fill': data.fill || 'transparent',
    '--node-stroke': data.stroke || 'transparent',
    '--node-text': data.textColor || '#111111',
    '--node-border-style': data.borderStyle || 'solid',
  } as CSSProperties;

  return (
    <div className="flow-node flow-node-label-box" style={style}>
      <NodeHandles />
      <NodeResizer color="#1677ff" isVisible={selected} minWidth={36} minHeight={24} />
      <InlineNodeLabel id={id} value={data.label} selected={!!selected} className="flow-node-label" />
    </div>
  );
}

export const nodeTypes = {
  process: BaseNode,
  group: GroupNode,
  label: LabelNode,
};
