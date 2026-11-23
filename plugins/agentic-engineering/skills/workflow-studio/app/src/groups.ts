// Comment frames: pure visual grouping. A Group is a labelled rectangle whose
// membership is by node.group === group.id; dragging the frame translates its
// members (handled in App). This replaces v1's phase container — no React Flow
// parentId, just data + a frame.

import { footprint } from './catalog';
import type { DiagramNode, Group } from './types';

const rand = () => Math.random().toString(36).slice(2, 8);

const PAD = 28;
const HEADER = 26;

/** A frame sized to wrap the selected nodes, with room for its header label. */
export function groupFromSelection(selIds: string[], nodes: DiagramNode[], label = 'Comment'): Group | null {
  const sel = nodes.filter((n) => selIds.includes(n.id));
  if (!sel.length) return null;
  const minX = Math.min(...sel.map((n) => n.position.x)) - PAD;
  const minY = Math.min(...sel.map((n) => n.position.y)) - PAD - HEADER;
  const maxX = Math.max(...sel.map((n) => n.position.x + footprint(n).w)) + PAD;
  const maxY = Math.max(...sel.map((n) => n.position.y + footprint(n).h)) + PAD;
  return { id: `g-${rand()}`, label, rect: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
