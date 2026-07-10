// Pure node-finder logic: which items the palette offers (catalog + Get/Set
// per variable), how compatibility against a drag origin is probed, and which
// pin a spawned node auto-wires to. No React — the Canvas supplies state.

import { catalogList, pinsOf } from './catalog';
import { typeCompatible } from './edges';
import { snapshotOf } from './variables';
import type { PaletteItem } from './Palette';
import type { DataType, DiagramNode, PinDirection, PinRole, Variable } from './types';

export type SpawnAction = { type: 'catalog'; kind: string } | { type: 'getVar' | 'setVar'; varId: string };

export interface PaletteEntry extends PaletteItem {
  action: SpawnAction;
}

/** Where a drag-off-a-pin started, so the palette can filter to compatible
 *  kinds and auto-wire the spawned node. */
export interface DragOrigin {
  node: string;
  pin: string;
  role: PinRole;
  dataType: DataType;
  /** the handle we dragged FROM: 'source' needs a compatible 'in' on the new
   *  node, 'target' needs a compatible 'out'. */
  from: 'source' | 'target';
}

/** The full finder list: catalog nodes + Get/Set for each declared variable. */
export function paletteCatalog(variables: Variable[]): PaletteEntry[] {
  const cat = catalogList().map((d) => ({
    key: d.kind,
    label: d.kind,
    category: d.category,
    blurb: d.blurb,
    action: { type: 'catalog' as const, kind: d.kind },
  }));
  const vars = variables.flatMap((v) => [
    { key: `get:${v.id}`, label: `Get ${v.name}`, category: 'variable', blurb: `Read ${v.name} · ${v.type}`, action: { type: 'getVar' as const, varId: v.id } },
    { key: `set:${v.id}`, label: `Set ${v.name}`, category: 'variable', blurb: `Assign ${v.name} · ${v.type}`, action: { type: 'setVar' as const, varId: v.id } },
  ]);
  return [...cat, ...vars];
}

/** A throwaway node for an action, used to test pin compatibility. */
export function probeFor(action: SpawnAction, variables: Variable[], origin?: DragOrigin): DiagramNode {
  if (action.type === 'catalog') {
    return { id: '_', kind: action.kind, label: '', position: { x: 0, y: 0 }, data: origin ? { role: origin.role } : undefined };
  }
  const v = variables.find((x) => x.id === action.varId);
  return { id: '_', kind: action.type, label: '', position: { x: 0, y: 0 }, data: v ? { ...snapshotOf(v) } : undefined };
}

/** The first pin on a node that can connect back to the drag origin. */
export function firstCompatPin(n: DiagramNode, origin: DragOrigin): string | undefined {
  const want: PinDirection = origin.from === 'source' ? 'in' : 'out';
  return pinsOf(n).find(
    (p) => p.direction === want && p.role === origin.role && (origin.role === 'exec' || typeCompatible(origin.dataType, p.dataType)),
  )?.id;
}

/** Narrow the full list to origin-compatible entries (reroute always offered). */
export function filterCompatible(all: PaletteEntry[], variables: Variable[], origin?: DragOrigin): PaletteEntry[] {
  if (!origin) return all;
  const want: PinDirection = origin.from === 'source' ? 'in' : 'out';
  return all.filter((it) => {
    if (it.action.type === 'catalog' && it.action.kind === 'reroute') return true;
    return pinsOf(probeFor(it.action, variables, origin)).some(
      (p) => p.direction === want && p.role === origin.role && (origin.role === 'exec' || typeCompatible(origin.dataType, p.dataType)),
    );
  });
}
