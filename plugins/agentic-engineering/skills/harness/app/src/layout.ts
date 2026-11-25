import dagre from '@dagrejs/dagre';
import { type Node, type Edge } from '@xyflow/react';
import { footprint } from './catalog';
import { nodeOf } from './nodes/BaseNode';

// Single owner of flow orientation. Blueprint graphs read left-to-right.
// Flip to 'TB' here and the auto-arrange follows.
export const FLOW_DIRECTION: 'TB' | 'LR' = 'LR';

/**
 * On-demand "Auto-arrange". Free-drag is the default — positions live on nodes
 * and the canvas never lays out on load. This runs only when the user asks, and
 * ranks the flat graph by its EXEC spine (data wires are ignored, like a UE
 * graph), so the result reads as control flow. Dagre returns centers; React Flow
 * wants top-left, so we subtract half w/h. Comment frames are left in place.
 */
export function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: FLOW_DIRECTION, nodesep: 48, ranksep: 96, marginx: 40, marginy: 40 });

  const ranked = nodes.filter((n) => n.type !== 'comment');
  for (const n of ranked) {
    const { w, h } = footprint(nodeOf(n.data));
    g.setNode(n.id, { width: w, height: h });
  }
  const rankable = new Set(ranked.map((n) => n.id));
  for (const e of edges) {
    if ((e.data?.role ?? 'exec') !== 'exec') continue; // rank by the exec spine only
    if (rankable.has(e.source) && rankable.has(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    const d = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined;
    return d ? { ...n, position: { x: d.x - d.width / 2, y: d.y - d.height / 2 } } : n;
  });
}
