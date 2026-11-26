// A visual JSON-schema builder. Recursive over object / array / scalar nodes;
// compiles (via schemaToJs in valueToJs.ts) to a standard JSON Schema. v1 scope:
// no $ref / oneOf / enum.

import type { SchemaNode, SchemaProp, SchemaScalar } from '../types';

type NodeType = SchemaScalar | 'object' | 'array';
const NODE_TYPES: NodeType[] = ['string', 'number', 'boolean', 'object', 'array'];

function changeType(node: SchemaNode, t: NodeType): SchemaNode {
  if (t === 'object') return { type: 'object', description: node.description, fields: node.type === 'object' ? node.fields : [] };
  if (t === 'array') return { type: 'array', description: node.description, items: node.type === 'array' ? node.items : { type: 'string' } };
  return { type: t, description: node.description };
}
function setField(node: SchemaNode, i: number, f: SchemaProp): SchemaNode {
  if (node.type !== 'object') return node;
  return { ...node, fields: node.fields.map((x, j) => (j === i ? f : x)) };
}

function SchemaNodeEditor({ node, onChange }: { node: SchemaNode; onChange: (n: SchemaNode) => void }) {
  return (
    <div className="sb-node">
      <div className="sb-node__head">
        <select value={node.type} onChange={(e) => onChange(changeType(node, e.target.value as NodeType))}>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className="sb-desc"
          placeholder="description"
          value={node.description ?? ''}
          onChange={(e) => onChange({ ...node, description: e.target.value || undefined })}
        />
      </div>

      {node.type === 'object' ? (
        <div className="sb-fields">
          {node.fields.map((f, i) => (
            <div className="sb-field" key={i}>
              <div className="sb-field__head">
                <input className="sb-fname" value={f.name} placeholder="field" onChange={(e) => onChange(setField(node, i, { ...f, name: e.target.value }))} />
                <label className="sb-req">
                  <input type="checkbox" checked={f.required} onChange={(e) => onChange(setField(node, i, { ...f, required: e.target.checked }))} /> req
                </label>
                <button className="icon-btn" onClick={() => onChange({ ...node, fields: node.fields.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
              <div className="sb-child">
                <SchemaNodeEditor node={f.node} onChange={(n) => onChange(setField(node, i, { ...f, node: n }))} />
              </div>
            </div>
          ))}
          <button
            className="icon-btn"
            onClick={() => onChange({ ...node, fields: [...node.fields, { name: `field${node.fields.length}`, required: false, node: { type: 'string' } }] })}
          >
            + field
          </button>
        </div>
      ) : null}

      {node.type === 'array' ? (
        <div className="sb-child">
          <span className="sb-label">items</span>
          <SchemaNodeEditor node={node.items} onChange={(n) => onChange({ ...node, items: n })} />
        </div>
      ) : null}
    </div>
  );
}

export function SchemaBuilder({ node, onChange }: { node: SchemaNode; onChange: (n: SchemaNode) => void }) {
  return <SchemaNodeEditor node={node} onChange={onChange} />;
}
