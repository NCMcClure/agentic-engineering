// Normalize a loaded diagram to the current schema: v2→v3 (rename `subtitle`→
// `note`, default the `variables`/`types` arrays) and upgrade iteration-1
// functions (boundary mapping, no Input/Output nodes) to the node-based model,
// remapping parent edges to the prefixed function pins. Used by the loader AND
// by importGraph, so a v2 sidecar round-trips through current codegen.

import { FN_IN_PREFIX, FN_OUT_PREFIX } from './catalog';
import { normalizeFunction } from './collapse';
import { SCHEMA_VERSION, type Diagram, type DiagramNode } from './types';

export function migrateDiagram(d: Diagram): Diagram {
  const renamed = d.nodes.map((n) => {
    const legacy = (n as { subtitle?: string }).subtitle;
    if (legacy === undefined) return n;
    const rest = { ...n } as DiagramNode & { subtitle?: string };
    delete rest.subtitle;
    rest.note = rest.note ?? legacy;
    return rest as DiagramNode;
  });

  const remaps = new Map<string, Map<string, string>>();
  const nodes = renamed.map((n) => {
    if (n.kind === 'function' && n.subgraph?.boundary && !n.subgraph.nodes.some((x) => x.kind === 'input' || x.kind === 'output')) {
      const m = new Map<string, string>();
      n.subgraph.boundary.forEach((b) => m.set(b.pin.id, (b.pin.direction === 'in' ? FN_IN_PREFIX : FN_OUT_PREFIX) + b.pin.id));
      remaps.set(n.id, m);
      return normalizeFunction(n);
    }
    return n;
  });

  const base: Diagram = { ...d, schemaVersion: SCHEMA_VERSION, nodes, variables: d.variables ?? [], types: d.types ?? [] };
  if (!remaps.size) return base;
  const edges = d.edges.map((e) => {
    const sm = remaps.get(e.source.node);
    const tm = remaps.get(e.target.node);
    return {
      ...e,
      source: sm?.has(e.source.pin) ? { ...e.source, pin: sm.get(e.source.pin)! } : e.source,
      target: tm?.has(e.target.pin) ? { ...e.target, pin: tm.get(e.target.pin)! } : e.target,
    };
  });
  return { ...base, edges };
}
