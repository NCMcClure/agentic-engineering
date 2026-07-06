import { Handle, Position } from '@xyflow/react';
import { typeColorKey } from '../types-registry';
import type { Pin } from '../types';

/** One pin row: a label plus a React Flow Handle centered on the node edge at the
 *  row's height (the row is positioned, so RF's built-in 50% offset lands the
 *  handle on this row — robust to header wrapping). Inputs sit on the left,
 *  outputs on the right. Exec pins are white triangles; data pins are circles
 *  colored by type. A wired pin fills with its color (`connected`). */
export function PinRow({ pin, connected }: { pin: Pin; connected: boolean }) {
  const isIn = pin.direction === 'in';
  const cls = `wf-pin wf-pin--${pin.role}${pin.role === 'data' ? ` wf-pin--${typeColorKey(pin.dataType)}` : ''}${connected ? ' is-connected' : ''}`;
  return (
    <div className={`wf-pinrow wf-pinrow--${isIn ? 'in' : 'out'}`}>
      <Handle type={isIn ? 'target' : 'source'} position={isIn ? Position.Left : Position.Right} id={pin.id} className={cls} />
      {pin.name ? <span className="wf-pin__name">{pin.name}</span> : null}
    </div>
  );
}
