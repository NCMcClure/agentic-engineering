import type { CSSProperties } from 'react';
import { type NodeProps } from '@xyflow/react';
import { defOf, footprint, pinsOf, ROW_H } from '../catalog';
import { useConnected, pinKey } from '../connected';
import { PinRow } from './Pin';
import type { DiagramNode } from '../types';

/** The React Flow node `data` payload: we stash the whole DiagramNode so the
 *  renderer, the side panel, and serialization all read one object. */
export interface WfNodeData {
  node: DiagramNode;
  [key: string]: unknown;
}

export const nodeOf = (data: unknown): DiagramNode => (data as WfNodeData).node;

/** Shared node shell, driven entirely by the catalog. Renders a header (tag +
 *  label + subtitle) and two pin columns whose handles are aligned per row. The
 *  accent comes from a per-kind CSS variable so the theme flips for free. */
export function BaseNode({ data, selected }: NodeProps) {
  const node = nodeOf(data);
  const def = defOf(node.kind);
  const connected = useConnected();
  const pins = pinsOf(node);
  const ins = pins.filter((p) => p.direction === 'in');
  const outs = pins.filter((p) => p.direction === 'out');
  const { w, h } = footprint(node);

  const style = {
    '--accent': `var(${def.accentVar})`,
    '--row-h': `${ROW_H}px`,
    minWidth: w,
    minHeight: h,
  } as CSSProperties;

  return (
    <div className={`wf-node${selected ? ' is-selected' : ''}`} style={style}>
      <div className="wf-node__head">
        <span className="wf-node__tag">{def.tag}</span>
        <div className="wf-node__label">{node.label}</div>
        {node.note ? <div className="wf-node__subtitle">{node.note}</div> : null}
      </div>
      <div className="wf-node__pins">
        <div className="wf-node__col wf-node__col--in">
          {ins.map((p) => (
            <PinRow key={p.id} pin={p} connected={connected.has(pinKey(node.id, p.id))} />
          ))}
        </div>
        <div className="wf-node__col wf-node__col--out">
          {outs.map((p) => (
            <PinRow key={p.id} pin={p} connected={connected.has(pinKey(node.id, p.id))} />
          ))}
        </div>
      </div>
    </div>
  );
}
