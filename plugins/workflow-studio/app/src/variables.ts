// Variable helpers: the Get/Set node kinds, the denormalized snapshot the catalog
// reads, and small constructors. The catalog owns the getVar/setVar NodeDefs
// (here would create an import cycle); this module owns everything around them.

import { defaultValueFor } from './types-registry';
import type { DataType, StructDef, Variable } from './types';

export const GETVAR_KIND = 'getVar';
export const SETVAR_KIND = 'setVar';

const rid = () => Math.random().toString(36).slice(2, 8);

export function makeVariable(name: string, type: DataType, types: StructDef[]): Variable {
  return { id: `var-${rid()}`, name, type, value: defaultValueFor(type, types) };
}

/** The snapshot written onto a getVar/setVar node's `data` so its pins derive
 *  purely from the node. Re-synced when the variable is renamed/retyped. */
export interface VarSnapshot {
  varId: string;
  varName: string;
  varType: DataType;
  varElementType?: DataType;
}

export const snapshotOf = (v: Variable): VarSnapshot => ({
  varId: v.id,
  varName: v.name,
  varType: v.type,
  ...(v.elementType ? { varElementType: v.elementType } : {}),
});
