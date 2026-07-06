// Pin-based edges. An edge endpoint is a (node, pin) pair: React Flow carries it
// as sourceHandle / targetHandle = the pin id. Exec wires are white; data wires
// are colored by the source pin's data type. This module owns the DiagramEdge ⇄
// React Flow mapping and connection validation.

import type { Connection, Edge } from '@xyflow/react';
import { pinOf } from './catalog';
import { isStructRef, typeColorKey } from './types-registry';
import type { DataType, DiagramEdge, DiagramNode, PinRole } from './types';

const nodeById = (nodes: DiagramNode[], id: string | null): DiagramNode | undefined =>
  nodes.find((n) => n.id === id);

/** Whether a value of type `a` can flow into a pin of type `b`. Deliberately a
 *  small allow-list, not a structural type system (see plan's scope lines). */
export function typeCompatible(a: DataType, b: DataType): boolean {
  if (a === b) return true; // same struct ref string ⇒ equal ⇒ OK
  if (a === 'any' || b === 'any') return true;
  if ((a === 'agent-result' && b === 'object') || (a === 'object' && b === 'agent-result')) return true;
  // a struct flows into a generic object sink (and vice-versa)
  if (isStructRef(a) && b === 'object') return true;
  if (a === 'object' && isStructRef(b)) return true;
  return false;
}

/** Validate a proposed connection against the live nodes: source must be an
 *  output, target an input, roles must match (exec↔exec, data↔data), and data
 *  wires must be type-compatible. Used as React Flow's `isValidConnection`. */
export function canConnect(c: Connection | Edge, nodes: DiagramNode[]): boolean {
  if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return false;
  if (c.source === c.target) return false;
  const sNode = nodeById(nodes, c.source);
  const tNode = nodeById(nodes, c.target);
  if (!sNode || !tNode) return false;
  const sp = pinOf(sNode, c.sourceHandle);
  const tp = pinOf(tNode, c.targetHandle);
  if (!sp || !tp) return false;
  if (sp.direction !== 'out' || tp.direction !== 'in') return false;
  if (sp.role !== tp.role) return false;
  if (sp.role === 'data' && !typeCompatible(sp.dataType, tp.dataType)) return false;
  return true;
}

/** The CSS class that colors an edge: white exec wire, or a data wire tinted by
 *  its value type. */
export function edgeClass(role: PinRole, dataType?: DataType): string {
  return role === 'exec' ? 'edge-exec' : `edge-data edge-type-${typeColorKey(dataType ?? 'any')}`;
}

/** The role + source data type of a connection, read from the catalog pins. */
export function edgeRoleOf(c: Connection, nodes: DiagramNode[]): { role: PinRole; dataType: DataType } {
  const sp = c.source && c.sourceHandle ? pinOf(nodeById(nodes, c.source) ?? ({} as DiagramNode), c.sourceHandle) : undefined;
  return { role: sp?.role ?? 'exec', dataType: sp?.dataType ?? 'exec' };
}

// ── DiagramEdge ⇄ React Flow Edge ─────────────────────────────────────────

export function toRFEdge(e: DiagramEdge, nodes: DiagramNode[]): Edge {
  const srcNode = nodeById(nodes, e.source.node);
  const dataType = srcNode ? pinOf(srcNode, e.source.pin)?.dataType : undefined;
  return {
    id: e.id,
    source: e.source.node,
    sourceHandle: e.source.pin,
    target: e.target.node,
    targetHandle: e.target.pin,
    label: e.label,
    data: { role: e.role },
    className: edgeClass(e.role, dataType),
    type: 'default', // bezier — UE-style curvy wires for both exec and data
  };
}

export function fromRFEdge(e: Edge): DiagramEdge {
  return {
    id: e.id,
    source: { node: e.source, pin: e.sourceHandle ?? '' },
    target: { node: e.target, pin: e.targetHandle ?? '' },
    role: (e.data?.role as PinRole) ?? 'exec',
    label: (e.label as string) || undefined,
  };
}
