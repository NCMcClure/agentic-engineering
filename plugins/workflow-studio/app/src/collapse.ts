// Function construction: collapse a selection into a `function` node, seed an
// empty function, and normalize legacy functions. The function's boundary is
// materialized as `input`/`output` nodes inside the subgraph (UE Tunnel nodes):
// the `input` node's OUT pins are the function's inputs; the `output` node's IN
// pins are its outputs. The function's external pins derive from them (catalog).

import { FN_IN_PREFIX, FN_OUT_PREFIX, pinOf } from './catalog';
import type { DiagramEdge, DiagramNode, Pin, PinRef, PinRole, SubGraph } from './types';

const rand = () => Math.random().toString(36).slice(2, 8);

const execOutPin = (): Pin => ({ id: 'exec', name: '', direction: 'out', role: 'exec', dataType: 'exec' });
const execInPin = (): Pin => ({ id: 'exec', name: '', direction: 'in', role: 'exec', dataType: 'exec' });

export interface CollapseResult {
  fn: DiagramNode;
  /** node ids absorbed into the function (removed from the parent graph) */
  removedIds: string[];
  /** edges to drop from the parent (internal + crossing) */
  droppedIds: string[];
  /** new parent edges that reconnect the outside world to the function pins */
  rewired: DiagramEdge[];
}

/** A fresh empty function: just an Input and Output node (one exec pin each), so
 *  it's a valid passthrough and can be entered immediately. */
export function emptyFunctionSubgraph(): SubGraph {
  return {
    nodes: [
      { id: `input-${rand()}`, kind: 'input', label: 'Inputs', position: { x: 0, y: 80 }, data: { pins: [execOutPin()] } },
      { id: `output-${rand()}`, kind: 'output', label: 'Outputs', position: { x: 420, y: 80 }, data: { pins: [execInPin()] } },
    ],
    edges: [],
  };
}

/** Collapse the selection into a function node with Input/Output boundary nodes. */
export function collapseToFunction(
  selIds: string[],
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  label = 'function',
): CollapseResult | null {
  const sel = new Set(selIds);
  const inner = nodes.filter((n) => sel.has(n.id));
  if (!inner.length) return null;

  const internal = edges.filter((e) => sel.has(e.source.node) && sel.has(e.target.node));
  const crossingIn = edges.filter((e) => !sel.has(e.source.node) && sel.has(e.target.node));
  const crossingOut = edges.filter((e) => sel.has(e.source.node) && !sel.has(e.target.node));

  const fnId = `fn-${rand()}`;
  const inputId = `input-${rand()}`;
  const outputId = `output-${rand()}`;
  const inputPins: Pin[] = [];
  const outputPins: Pin[] = [];
  const innerWires: DiagramEdge[] = [];
  const rewired: DiagramEdge[] = [];

  // crossing-in: an Input-node OUT pin wired to the inner target; the function
  // gains a matching IN pin (prefixed).
  const inByKey = new Map<string, string>();
  let pi = 0;
  for (const e of crossingIn) {
    const key = `${e.target.node}:${e.target.pin}`;
    let pid = inByKey.get(key);
    if (!pid) {
      pid = `p${pi++}`;
      inputPins.push(boundaryPinDef(pid, 'out', e.target, e.role, nodes));
      innerWires.push({ id: `e-${rand()}`, source: { node: inputId, pin: pid }, target: e.target, role: e.role });
      inByKey.set(key, pid);
    }
    rewired.push({ ...e, id: `e-${rand()}`, target: { node: fnId, pin: `${FN_IN_PREFIX}${pid}` } });
  }

  // crossing-out: the inner source wired to an Output-node IN pin; the function
  // gains a matching OUT pin (prefixed).
  const outByKey = new Map<string, string>();
  let po = 0;
  for (const e of crossingOut) {
    const key = `${e.source.node}:${e.source.pin}`;
    let pid = outByKey.get(key);
    if (!pid) {
      pid = `p${po++}`;
      outputPins.push(boundaryPinDef(pid, 'in', e.source, e.role, nodes));
      innerWires.push({ id: `e-${rand()}`, source: e.source, target: { node: outputId, pin: pid }, role: e.role });
      outByKey.set(key, pid);
    }
    rewired.push({ ...e, id: `e-${rand()}`, source: { node: fnId, pin: `${FN_OUT_PREFIX}${pid}` } });
  }

  // Always give the boundary an exec pin so the function has an exec spine.
  if (!inputPins.some((p) => p.role === 'exec')) inputPins.unshift(execOutPin());
  if (!outputPins.some((p) => p.role === 'exec')) outputPins.unshift(execInPin());

  const xs = inner.map((n) => n.position.x);
  const ys = inner.map((n) => n.position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const midY = Math.round(ys.reduce((s, y) => s + y, 0) / ys.length);
  const midX = Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);

  const inputNode: DiagramNode = { id: inputId, kind: 'input', label: 'Inputs', position: { x: minX - 240, y: midY }, data: { pins: inputPins } };
  const outputNode: DiagramNode = { id: outputId, kind: 'output', label: 'Outputs', position: { x: maxX + 240, y: midY }, data: { pins: outputPins } };

  const subgraph: SubGraph = { nodes: [inputNode, ...inner, outputNode], edges: [...internal, ...innerWires] };
  const fn: DiagramNode = { id: fnId, kind: 'function', label, position: { x: midX, y: midY }, subgraph };

  return {
    fn,
    removedIds: inner.map((n) => n.id),
    droppedIds: [...internal, ...crossingIn, ...crossingOut].map((e) => e.id),
    rewired,
  };
}

/** Upgrade an iteration-1 function (boundary mapping, no Input/Output nodes) to
 *  the node-based model so old diagrams keep working. Returns the node unchanged
 *  if it's already normalized or not a function. The parent edges are remapped
 *  separately (migrateDiagram in App), since legacy function pin ids gain the
 *  i_/o_ prefix here. */
export function normalizeFunction(node: DiagramNode): DiagramNode {
  if (node.kind !== 'function' || !node.subgraph) return node;
  const sg = node.subgraph;
  const hasIO = sg.nodes.some((n) => n.kind === 'input' || n.kind === 'output');
  if (hasIO || !sg.boundary) return node;

  const inputId = `input-${rand()}`;
  const outputId = `output-${rand()}`;
  const inputPins: Pin[] = [];
  const outputPins: Pin[] = [];
  const wires: DiagramEdge[] = [];
  for (const b of sg.boundary) {
    if (b.pin.direction === 'in') {
      inputPins.push({ ...b.pin, direction: 'out' });
      wires.push({ id: `e-${rand()}`, source: { node: inputId, pin: b.pin.id }, target: b.inner, role: b.pin.role });
    } else {
      outputPins.push({ ...b.pin, direction: 'in' });
      wires.push({ id: `e-${rand()}`, source: b.inner, target: { node: outputId, pin: b.pin.id }, role: b.pin.role });
    }
  }
  if (!inputPins.some((p) => p.role === 'exec')) inputPins.unshift(execOutPin());
  if (!outputPins.some((p) => p.role === 'exec')) outputPins.unshift(execInPin());

  const inputNode: DiagramNode = { id: inputId, kind: 'input', label: 'Inputs', position: { x: -240, y: 60 }, data: { pins: inputPins } };
  const outputNode: DiagramNode = { id: outputId, kind: 'output', label: 'Outputs', position: { x: 420, y: 60 }, data: { pins: outputPins } };
  return { ...node, subgraph: { nodes: [inputNode, ...sg.nodes, outputNode], edges: [...sg.edges, ...wires] } };
}

function boundaryPinDef(id: string, direction: 'in' | 'out', innerRef: PinRef, role: PinRole, nodes: DiagramNode[]): Pin {
  const innerNode = nodes.find((n) => n.id === innerRef.node);
  const innerPin = innerNode && pinOf(innerNode, innerRef.pin);
  return {
    id,
    name: innerNode ? `${innerNode.label}${innerPin?.name ? ` · ${innerPin.name}` : ''}` : id,
    direction,
    role,
    dataType: innerPin?.dataType ?? (role === 'exec' ? 'exec' : 'any'),
  };
}
