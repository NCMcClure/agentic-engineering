// The ONE place a TypedValue becomes JS source. Deterministic (struct fields in
// the StructDef's declared order, object/array entries in array order) so the
// emitted code — and thus the sidecar round-trip — stays byte-stable.

import type { SchemaNode, StructDef, TypedValue } from '../types';

const isIdent = (k: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
export const jsKey = (k: string) => (isIdent(k) ? k : JSON.stringify(k));

function objLiteral(pairs: Array<[string, string]>): string {
  if (!pairs.length) return '{}';
  return `{ ${pairs.map(([k, val]) => `${jsKey(k)}: ${val}`).join(', ')} }`;
}

export function valueToJs(v: TypedValue, types: StructDef[]): string {
  switch (v.kind) {
    case 'string': return JSON.stringify(v.value);
    case 'number': return Number.isFinite(v.value) ? String(v.value) : '0';
    case 'bool': return v.value ? 'true' : 'false';
    case 'expr': return v.expr.trim() || 'undefined';
    case 'array': return `[${v.items.map((it) => valueToJs(it, types)).join(', ')}]`;
    case 'object': return objLiteral(v.entries.map((e) => [e.key, valueToJs(e.value, types)]));
    case 'struct': {
      const def = types.find((s) => s.id === v.structId);
      const keys = def ? def.fields.map((f) => f.name) : Object.keys(v.fields);
      return objLiteral(keys.map((k) => [k, v.fields[k] ? valueToJs(v.fields[k], types) : 'undefined']));
    }
    case 'schema': return schemaToJs(v.root);
  }
}

/** A TypedValue's `schema` branch → a JSON-Schema object literal. */
export function schemaToJs(n: SchemaNode): string {
  if (n.type === 'object') {
    const props = n.fields.map((f) => `${jsKey(f.name)}: ${schemaToJs(f.node)}`);
    const required = n.fields.filter((f) => f.required).map((f) => JSON.stringify(f.name));
    const parts = [`type: 'object'`, `properties: ${props.length ? `{ ${props.join(', ')} }` : '{}'}`];
    if (required.length) parts.push(`required: [${required.join(', ')}]`);
    if (n.description) parts.push(`description: ${JSON.stringify(n.description)}`);
    return `{ ${parts.join(', ')} }`;
  }
  if (n.type === 'array') {
    const parts = [`type: 'array'`, `items: ${schemaToJs(n.items)}`];
    if (n.description) parts.push(`description: ${JSON.stringify(n.description)}`);
    return `{ ${parts.join(', ')} }`;
  }
  const parts = [`type: ${JSON.stringify(n.type)}`];
  if (n.description) parts.push(`description: ${JSON.stringify(n.description)}`);
  return `{ ${parts.join(', ')} }`;
}

/** A short, human one-liner for a value (node body / inspector chips). */
export function valuePreview(v: TypedValue): string {
  switch (v.kind) {
    case 'string': return JSON.stringify(v.value);
    case 'number': return String(v.value);
    case 'bool': return String(v.value);
    case 'expr': return v.expr.slice(0, 24) || '∅';
    case 'array': return `[${v.items.length}]`;
    case 'object': return `{${v.entries.length}}`;
    case 'struct': return '{…}';
    case 'schema': return 'schema';
  }
}
