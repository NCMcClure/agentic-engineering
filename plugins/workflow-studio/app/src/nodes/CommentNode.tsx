import type { CSSProperties } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';

/** A comment frame: a labelled rectangle drawn behind the graph that visually
 *  groups its members. It carries no pins and never participates in the flow;
 *  dragging it translates its members (handled in App). Resizable when selected. */
export function CommentNode({ data, selected }: NodeProps) {
  const d = data as { label?: string; color?: string; body?: string };
  const style = { '--accent': `var(--type-${d.color ?? 'gray'}, var(--gray))` } as CSSProperties;
  return (
    <div className={`wf-comment${selected ? ' is-selected' : ''}`} style={style}>
      <NodeResizer minWidth={140} minHeight={90} isVisible={!!selected} color="var(--accent)" />
      <div className="wf-comment__label">{d.label ?? 'Comment'}</div>
      {d.body ? <div className="wf-comment__body">{d.body}</div> : null}
    </div>
  );
}
