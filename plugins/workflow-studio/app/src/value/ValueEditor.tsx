// A recursive, type-driven value editor. Reads/writes a TypedValue against a
// declared DataType: primitives, arrays (element-type picker + per-item editor),
// objects (key/type/value rows), structs (a form from the StructDef), and the
// `schema` type (the visual SchemaBuilder). The single editor reused for
// variables, lit-node values, and node params.

import { dataTypeOptions, defaultValueFor, isStructRef, structOf, structRef } from '../types-registry';
import { SchemaBuilder } from './SchemaBuilder';
import type { DataType, StructDef, TypedValue } from '../types';

/** The TypedValue kind a declared type expects. */
function wantKind(type: DataType): TypedValue['kind'] {
  if (isStructRef(type)) return 'struct';
  switch (type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'bool': return 'bool';
    case 'array': return 'array';
    case 'object': return 'object';
    case 'schema': return 'schema';
    default: return 'expr'; // agent-result, any, exec
  }
}

/** The declared DataType implied by an existing value (for untyped object entries). */
function valueType(v: TypedValue): DataType {
  switch (v.kind) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'bool': return 'bool';
    case 'array': return 'array';
    case 'object': return 'object';
    case 'schema': return 'schema';
    case 'struct': return structRef(v.structId);
    default: return 'any';
  }
}

export function ValueEditor({
  type,
  elementType,
  value,
  types,
  onChange,
}: {
  type: DataType;
  elementType?: DataType;
  value: TypedValue;
  types: StructDef[];
  onChange: (v: TypedValue) => void;
}) {
  // render against a value coerced to the declared type (a safety net; callers
  // seed correct-kind values via defaultValueFor)
  const v = value && value.kind === wantKind(type) ? value : defaultValueFor(type, types, elementType);

  if (v.kind === 'string') {
    return <input className="ve-input" value={v.value} onChange={(e) => onChange({ kind: 'string', value: e.target.value })} />;
  }
  if (v.kind === 'number') {
    return <input className="ve-input" type="number" value={v.value} onChange={(e) => onChange({ kind: 'number', value: Number(e.target.value) })} />;
  }
  if (v.kind === 'bool') {
    return (
      <label className="ve-bool">
        <input type="checkbox" checked={v.value} onChange={(e) => onChange({ kind: 'bool', value: e.target.checked })} /> {String(v.value)}
      </label>
    );
  }
  if (v.kind === 'expr') {
    return <input className="ve-input" value={v.expr} placeholder="raw JS expression" onChange={(e) => onChange({ kind: 'expr', expr: e.target.value })} />;
  }
  if (v.kind === 'schema') {
    return <SchemaBuilder node={v.root} onChange={(root) => onChange({ kind: 'schema', root })} />;
  }

  if (v.kind === 'array') {
    return (
      <div className="ve-array">
        <div className="ve-array__head">
          <span className="ve-label">element</span>
          <select
            value={v.elementType}
            onChange={(e) => {
              const et = e.target.value as DataType;
              onChange({ kind: 'array', elementType: et, items: v.items.map(() => defaultValueFor(et, types)) });
            }}
          >
            {dataTypeOptions(types).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {v.items.map((it, i) => (
          <div className="ve-row" key={i}>
            <span className="ve-row__idx">{i}</span>
            <ValueEditor type={v.elementType} value={it} types={types} onChange={(nv) => onChange({ ...v, items: v.items.map((x, j) => (j === i ? nv : x)) })} />
            <button className="icon-btn" onClick={() => onChange({ ...v, items: v.items.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button className="icon-btn" onClick={() => onChange({ ...v, items: [...v.items, defaultValueFor(v.elementType, types)] })}>
          +
        </button>
      </div>
    );
  }

  if (v.kind === 'object') {
    return (
      <div className="ve-object">
        {v.entries.map((entry, i) => {
          const et = valueType(entry.value);
          return (
            <div className="ve-row" key={i}>
              <input
                className="ve-key"
                value={entry.key}
                placeholder="key"
                onChange={(e) => onChange({ ...v, entries: v.entries.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })}
              />
              <select
                value={et}
                onChange={(e) => {
                  const nt = e.target.value as DataType;
                  onChange({ ...v, entries: v.entries.map((x, j) => (j === i ? { ...x, value: defaultValueFor(nt, types) } : x)) });
                }}
              >
                {dataTypeOptions(types).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <ValueEditor type={et} value={entry.value} types={types} onChange={(nv) => onChange({ ...v, entries: v.entries.map((x, j) => (j === i ? { ...x, value: nv } : x)) })} />
              <button className="icon-btn" onClick={() => onChange({ ...v, entries: v.entries.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          );
        })}
        <button className="icon-btn" onClick={() => onChange({ ...v, entries: [...v.entries, { key: `field${v.entries.length}`, value: defaultValueFor('string', types) }] })}>
          +
        </button>
      </div>
    );
  }

  // struct
  const def = structOf(types, type) ?? types.find((s) => s.id === v.structId);
  if (!def) return <div className="ve-note">unknown struct</div>;
  return (
    <div className="ve-struct">
      {def.fields.map((f) => (
        <div className="ve-field" key={f.name}>
          <span className="ve-field__name">
            {f.name} <span className="ve-field__type">·{f.type}</span>
          </span>
          <ValueEditor
            type={f.type}
            elementType={f.elementType}
            value={v.fields[f.name] ?? defaultValueFor(f.type, types, f.elementType)}
            types={types}
            onChange={(nv) => onChange({ ...v, fields: { ...v.fields, [f.name]: nv } })}
          />
        </div>
      ))}
    </div>
  );
}
