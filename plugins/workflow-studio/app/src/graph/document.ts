// Pure graph-document operations over the React Flow state arrays. No React,
// no side effects: state in, state out — unit-testable, and the single place
// node/edge structural rules live (spawn shape, deletion semantics, dangling-
// edge pruning, comment-frame drag shifts, clipboard cloning).

import type { Edge, Node, NodeChange } from '@xyflow/react';
import { defOf, pinsOf } from '../catalog';
import { emptyFunctionSubgraph } from '../collapse';
import { edgeClass } from '../edges';
import type { WfNodeData } from '../nodes/BaseNode';
import { nodeOf } from '../nodes/BaseNode';
import type { DataType, DiagramNode, PinRole } from '../types';

export const shortId = () => Math.random().toString(36).slice(2, 8);

export const isComment = (n: Node) => n.type === 'comment';

/** A fresh node of the given kind, seeded from the catalog. A function gets an
 *  empty Input/Output subgraph so it's valid and enterable immediately. */
export function makeNode(kind: string, position: { x: number; y: number }): DiagramNode {
  const def = defOf(kind);
  const node: DiagramNode = { id: `n-${shortId()}`, kind, label: def.tag || kind, position };
  if (kind === 'function') node.subgraph = emptyFunctionSubgraph();
  return node;
}

/** Wrap a DiagramNode as its React Flow node. */
export const toRFNode = (node: DiagramNode): Node => ({
  id: node.id,
  type: node.kind,
  position: node.position,
  data: { node } as WfNodeData,
});

/** A validated, typed RF edge record (validation happens in the caller via
 *  canConnect; this just materializes the shape). */
export function buildEdge(
  c: { source: string; sourceHandle: string; target: string; targetHandle: string },
  role: PinRole,
  dataType: DataType,
): Edge {
  return {
    id: `e-${shortId()}`,
    source: c.source,
    sourceHandle: c.sourceHandle,
    target: c.target,
    targetHandle: c.targetHandle,
    data: { role },
    className: edgeClass(role, dataType),
    type: 'default',
  };
}

/** Delete nodes+edges: selected edges, selected nodes with their incident
 *  edges, and (for comment frames) membership cleared on surviving members. */
export function removeElements(
  nodes: Node[],
  edges: Edge[],
  nodeIds: Set<string>,
  edgeIds: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  return {
    edges: edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.source) && !nodeIds.has(e.target)),
    nodes: nodes
      .filter((n) => !nodeIds.has(n.id))
      .map((n) => {
        if (isComment(n)) return n;
        const dn = nodeOf(n.data);
        return dn.group && nodeIds.has(dn.group) ? { ...n, data: { node: { ...dn, group: undefined } } as WfNodeData } : n;
      }),
  };
}

/** Drop edges attached to pins that no longer exist on the node (kind change,
 *  variadic count lowered, function I/O pin removed). */
export function pruneDanglingEdges(nodeId: string, nextNode: DiagramNode, edges: Edge[]): Edge[] {
  const valid = new Set(pinsOf(nextNode).map((p) => p.id));
  return edges.filter(
    (e) =>
      (e.source !== nodeId || (e.sourceHandle != null && valid.has(e.sourceHandle))) &&
      (e.target !== nodeId || (e.targetHandle != null && valid.has(e.targetHandle))),
  );
}

/** Dragging a comment frame translates its members. Computes the member shifts
 *  for this change batch; `prevPos` is the caller-held last-seen frame
 *  positions (mutated here so per-pixel deltas accumulate correctly). */
export function commentDragShifts(
  nodes: Node[],
  changes: NodeChange[],
  prevPos: Map<string, { x: number; y: number }>,
): Array<{ members: string[]; dx: number; dy: number }> {
  const shifts: Array<{ members: string[]; dx: number; dy: number }> = [];
  for (const c of changes) {
    if (c.type !== 'position' || !c.position) continue;
    const cn = nodes.find((n) => n.id === c.id);
    if (!cn || !isComment(cn)) continue;
    const prev = prevPos.get(c.id) ?? cn.position;
    const dx = c.position.x - prev.x;
    const dy = c.position.y - prev.y;
    prevPos.set(c.id, c.position);
    if (dx || dy) {
      shifts.push({
        members: nodes.filter((n) => !isComment(n) && nodeOf(n.data).group === c.id).map((n) => n.id),
        dx,
        dy,
      });
    }
  }
  return shifts;
}

export const applyShifts = (nodes: Node[], shifts: Array<{ members: string[]; dx: number; dy: number }>): Node[] =>
  nodes.map((n) => {
    const s = shifts.find((sh) => sh.members.includes(n.id));
    return s ? { ...n, position: { x: n.position.x + s.dx, y: n.position.y + s.dy } } : n;
  });

/** In-app clipboard payload: the selected non-comment nodes and the edges
 *  fully inside the selection. */
export interface ClipboardPayload {
  nodes: DiagramNode[];
  edges: Edge[];
}

export function copySelection(nodes: Node[], edges: Edge[], selectedNodeIds: string[]): ClipboardPayload | null {
  const ids = new Set(selectedNodeIds);
  const picked = nodes.filter((n) => ids.has(n.id) && !isComment(n)).map((n) => nodeOf(n.data));
  if (!picked.length) return null;
  return {
    nodes: picked,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

/** Clone a clipboard payload with fresh ids at an offset; returns RF nodes and
 *  remapped edges, ready to concat. Group membership is dropped (the frame
 *  wasn't copied) and clones spawn selected. */
export function clonePayload(payload: ClipboardPayload, offset: { x: number; y: number }): { nodes: Node[]; edges: Edge[] } {
  const idMap = new Map(payload.nodes.map((n) => [n.id, `n-${shortId()}`]));
  const nodes = payload.nodes.map((n) => {
    const clone: DiagramNode = structuredClone(n);
    clone.id = idMap.get(n.id)!;
    clone.position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
    delete clone.group;
    return { ...toRFNode(clone), selected: true };
  });
  const edges = payload.edges.map((e) => ({
    ...e,
    id: `e-${shortId()}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));
  return { nodes, edges };
}
