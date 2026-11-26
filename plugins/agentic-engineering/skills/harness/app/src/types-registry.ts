// The single owner of the `struct:<id>` convention and type→default-value logic.
// Nothing else parses the prefix or branches on struct-ness — route through here.

import type { DataType, PrimitiveDataType, StructDef, StructRef, TypedValue } from './types';

export const STRUCT_PREFIX = 'struct:';

export const isStructRef = (t: DataType): t is StructRef => t.startsWith(STRUCT_PREFIX);
export const structIdOf = (t: DataType): string => t.slice(STRUCT_PREFIX.length);
export const structRef = (id: string): StructRef => `${STRUCT_PREFIX}${id}`;
export const structOf = (types: StructDef[], t: DataType): StructDef | undefined =>
  isStructRef(t) ? types.find((s) => s.id === structIdOf(t)) : undefined;

/** The CSS color key for any DataType — every struct shares one key. */
export const typeColorKey = (t: DataType): string => (isStructRef(t) ? 'struct' : t);

const PRIMITIVE_OPTIONS: PrimitiveDataType[] = ['string', 'number', 'bool', 'object', 'array', 'agent-result', 'schema', 'any'];

/** The type choices for any type-picker: primitives + one per declared struct. */
export function dataTypeOptions(types: StructDef[]): Array<{ value: DataType; label: string }> {
  return [
    ...PRIMITIVE_OPTIONS.map((t) => ({ value: t as DataType, label: t })),
    ...types.map((s) => ({ value: structRef(s.id), label: s.name })),
  ];
}

/** A sensible empty TypedValue for a declared type (element type matters for arrays). */
export function defaultValueFor(type: DataType, types: StructDef[], elementType: DataType = 'string'): TypedValue {
  if (isStructRef(type)) {
    const def = structOf(types, type);
    return def ? emptyStructValue(def, types) : { kind: 'expr', expr: 'undefined' };
  }
  switch (type) {
    case 'string': return { kind: 'string', value: '' };
    case 'number': return { kind: 'number', value: 0 };
    case 'bool': return { kind: 'bool', value: false };
    case 'array': return { kind: 'array', elementType, items: [] };
    case 'object': return { kind: 'object', entries: [] };
    case 'schema': return { kind: 'schema', root: { type: 'object', fields: [] } };
    case 'agent-result': return { kind: 'expr', expr: 'undefined' };
    default: return { kind: 'expr', expr: 'null' };
  }
}

export function emptyStructValue(def: StructDef, types: StructDef[]): TypedValue {
  const fields: Record<string, TypedValue> = {};
  for (const f of def.fields) fields[f.name] = defaultValueFor(f.type, types, f.elementType ?? 'string');
  return { kind: 'struct', structId: def.id, fields };
}
