// The right details panel — a router over the current selection (node / variable
// / struct / edge / comment). Absorbs the old Inspector as NodeDetails.

import { catalogList, pinsOf } from './catalog';
import { dataTypeOptions, defaultValueFor, typeColorKey } from './types-registry';
import { ValueEditor } from './value/ValueEditor';
import type { DataType, DiagramEdge, DiagramNode, Group, NodeParam, Pin, StructDef, StructField, Variable } from './types';

const DATA_TYPES_BASE: DataType[] = ['string', 'number', 'bool', 'object', 'array', 'agent-result', 'schema', 'any'];
const rid = () => Math.random().toString(36).slice(2, 7);

export type Selection =
  | { kind: 'node'; node: DiagramNode }
  | { kind: 'variable'; variable: Variable }
  | { kind: 'struct'; struct: StructDef }
  | { kind: 'edge'; edge: DiagramEdge }
  | { kind: 'comment'; group: Group };

export interface DetailsHandlers {
  types: StructDef[];
  connectedKeys: Set<string>;
  onPatchNode: (patch: Partial<Pick<DiagramNode, 'label' | 'note' | 'kind'>>) => void;
  onPatchNodeData: (data: Record<string, unknown>) => void;
  onPatchPinDefault: (pinId: string, value: string) => void;
  onPatchVariable: (patch: Partial<Variable>) => void;
  onDeleteVariable: () => void;
  onPatchStruct: (patch: Partial<StructDef>) => void;
  onDeleteStruct: () => void;
  onPatchEdge: (patch: Partial<Pick<DiagramEdge, 'label'>>) => void;
  onPatchComment: (patch: Partial<Pick<Group, 'label' | 'body' | 'color'>>) => void;
  onSave: () => void;
}

function TypeSelect({ value, types, onChange }: { value: DataType; types: StructDef[]; onChange: (t: DataType) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as DataType)}>
      {dataTypeOptions(types).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Stepper({ value, min, onChange }: { value: number; min: number; onChange: (n: number) => void }) {
  return (
    <span className="stepper">
      <button className="icon-btn" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="stepper__value">{value}</span>
      <button className="icon-btn" onClick={() => onChange(value + 1)}>+</button>
    </span>
  );
}

// ── NodeDetails (was Inspector) ───────────────────────────────────────────

export function NodeDetails({ node, h }: { node: DiagramNode; h: DetailsHandlers }) {
  const { types, connectedKeys, onPatchNode, onPatchNodeData, onPatchPinDefault } = h;
  const data = node.data ?? {};
  const dataIns = pinsOf(node).filter((p) => p.direction === 'in' && p.role === 'data');
  const cases = (data.cases as string[] | undefined) ?? [];
  const isLit = node.kind.startsWith('lit');
  const params = (data.params as NodeParam[] | undefined) ?? [];
  const setParams = (p: NodeParam[]) => onPatchNodeData({ params: p });

  const isIO = node.kind === 'input' || node.kind === 'output';
  const ioDir: 'in' | 'out' = node.kind === 'input' ? 'out' : 'in';
  const ioPins = (data.pins as Pin[] | undefined) ?? pinsOf(node);
  const setPins = (pins: Pin[]) => onPatchNodeData({ pins });
  const setPinAt = (i: number, patch: Partial<Pin>) => setPins(ioPins.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setPinType = (i: number, val: string) =>
    setPinAt(i, val === 'exec' ? { role: 'exec', dataType: 'exec' } : { role: 'data', dataType: val as DataType });
  const addPin = (role: 'exec' | 'data') =>
    setPins([...ioPins, { id: `p-${rid()}`, name: role === 'exec' ? 'exec' : 'value', direction: ioDir, role, dataType: role === 'exec' ? 'exec' : 'any' }]);

  return (
    <>
      <label>
        kind
        <select value={node.kind} onChange={(e) => onPatchNode({ kind: e.target.value })}>
          {catalogList().map((d) => (
            <option key={d.kind} value={d.kind}>{d.kind}</option>
          ))}
        </select>
      </label>
      <label>
        label
        <input value={node.label ?? ''} onChange={(e) => onPatchNode({ label: e.target.value })} />
      </label>
      <label>
        note
        <textarea value={node.note ?? ''} onChange={(e) => onPatchNode({ note: e.target.value })} />
      </label>

      {node.kind === 'reroute' ? (
        <label>
          reroute type
          <select value={String(data.role ?? 'data')} onChange={(e) => onPatchNodeData({ role: e.target.value })}>
            <option value="data">data</option>
            <option value="exec">exec</option>
          </select>
        </label>
      ) : null}

      {node.kind === 'getField' ? (
        <label>
          field
          <input value={String(data.field ?? '')} placeholder="e.g. root" onChange={(e) => onPatchNodeData({ field: e.target.value })} />
        </label>
      ) : null}

      {isIO ? (
        <div className="panel__section">
          <span className="panel__section-title">{node.kind === 'input' ? 'function inputs' : 'function outputs'}</span>
          {ioPins.map((p, i) => (
            <div className="pinrow-edit" key={p.id}>
              <input value={p.name} placeholder="name" onChange={(e) => setPinAt(i, { name: e.target.value })} />
              <select value={p.role === 'exec' ? 'exec' : p.dataType} onChange={(e) => setPinType(i, e.target.value)}>
                <option value="exec">exec</option>
                {DATA_TYPES_BASE.map((t) => (<option key={t} value={t}>{t}</option>))}
              </select>
              <button className="icon-btn" onClick={() => setPins(ioPins.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <div className="stepper">
            <button className="icon-btn" onClick={() => addPin('exec')} title="add exec pin">+▶</button>
            <button className="icon-btn" onClick={() => addPin('data')} title="add data pin">+●</button>
          </div>
        </div>
      ) : null}

      {node.kind === 'sequence' || node.kind === 'multiGate' || node.kind === 'pipeline' ? (
        <div className="panel__section">
          <span className="panel__section-title">{node.kind === 'pipeline' ? 'stages' : 'outputs'}</span>
          <Stepper
            value={Number(node.kind === 'sequence' ? data.thenCount ?? 2 : node.kind === 'multiGate' ? data.outCount ?? 2 : data.stageCount ?? 1)}
            min={node.kind === 'pipeline' ? 0 : 1}
            onChange={(n) => onPatchNodeData(node.kind === 'sequence' ? { thenCount: n } : node.kind === 'multiGate' ? { outCount: n } : { stageCount: n })}
          />
        </div>
      ) : null}

      {node.kind === 'switch' ? (
        <div className="panel__section">
          <span className="panel__section-title">cases</span>
          {cases.map((c, i) => (
            <div className="pinrow-edit" key={i}>
              <input value={c} onChange={(e) => onPatchNodeData({ cases: cases.map((v, j) => (j === i ? e.target.value : v)) })} />
              <button className="icon-btn" onClick={() => onPatchNodeData({ cases: cases.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button className="icon-btn" onClick={() => onPatchNodeData({ cases: [...cases, `case ${cases.length}`] })}>+</button>
        </div>
      ) : null}

      {isLit ? (
        <div className="panel__section">
          <span className="panel__section-title">value</span>
          {node.kind === 'litBool' ? (
            <select value={String(data.value ?? 'true')} onChange={(e) => onPatchNodeData({ value: e.target.value })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : node.kind === 'litNumber' ? (
            <input type="number" value={String(data.value ?? '0')} onChange={(e) => onPatchNodeData({ value: e.target.value })} />
          ) : node.kind === 'litArray' || node.kind === 'litObject' ? (
            <textarea value={String(data.value ?? (node.kind === 'litArray' ? '[]' : '{}'))} onChange={(e) => onPatchNodeData({ value: e.target.value })} />
          ) : (
            <input value={String(data.value ?? '')} onChange={(e) => onPatchNodeData({ value: e.target.value })} />
          )}
        </div>
      ) : null}

      {/* parameters — named typed fields emitted into the node's options */}
      <div className="panel__section">
        <span className="panel__section-title">parameters</span>
        {params.map((p, i) => (
          <div className="param-row" key={i}>
            <div className="pinrow-edit">
              <input value={p.key} placeholder="key" onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <TypeSelect value={p.type} types={types} onChange={(t) => setParams(params.map((x, j) => (j === i ? { ...x, type: t, value: defaultValueFor(t, types) } : x)))} />
              <button className="icon-btn" onClick={() => setParams(params.filter((_, j) => j !== i))}>×</button>
            </div>
            <ValueEditor type={p.type} value={p.value} types={types} onChange={(v) => setParams(params.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
          </div>
        ))}
        <button className="icon-btn" onClick={() => setParams([...params, { key: `param${params.length}`, type: 'string', value: defaultValueFor('string', types) }])}>
          + param
        </button>
      </div>

      {dataIns.length ? (
        <div className="panel__section">
          <span className="panel__section-title">data inputs</span>
          {dataIns.map((p) => {
            const wired = connectedKeys.has(`${node.id}:${p.id}`);
            const current = node.pinOverrides?.[p.id]?.default ?? p.default ?? '';
            return (
              <label key={p.id}>
                {p.name || p.id} <span style={{ color: 'var(--type-' + typeColorKey(p.dataType) + ')' }}>·{p.dataType}</span>
                {wired ? (
                  <input value="(wired)" disabled />
                ) : (
                  <input value={current} onChange={(e) => onPatchPinDefault(p.id, e.target.value)} placeholder="literal value" />
                )}
              </label>
            );
          })}
        </div>
      ) : null}
    </>
  );
}

// ── Variable / Struct / Edge / Comment editors ────────────────────────────

function VariableDetails({ variable, h }: { variable: Variable; h: DetailsHandlers }) {
  const { types, onPatchVariable, onDeleteVariable } = h;
  return (
    <>
      <label>
        name
        <input value={variable.name} onChange={(e) => onPatchVariable({ name: e.target.value })} />
      </label>
      <label>
        type
        <TypeSelect value={variable.type} types={types} onChange={(t) => onPatchVariable({ type: t, value: defaultValueFor(t, types, variable.elementType) })} />
      </label>
      {variable.type === 'array' ? (
        <label>
          element type
          <TypeSelect
            value={variable.elementType ?? 'string'}
            types={types}
            onChange={(et) => onPatchVariable({ elementType: et, value: { kind: 'array', elementType: et, items: [] } })}
          />
        </label>
      ) : null}
      <div className="panel__section">
        <span className="panel__section-title">default value</span>
        <ValueEditor type={variable.type} elementType={variable.elementType} value={variable.value} types={types} onChange={(v) => onPatchVariable({ value: v })} />
      </div>
      <button className="btn btn--danger" onClick={onDeleteVariable}>Delete variable</button>
    </>
  );
}

function StructDetails({ struct, h }: { struct: StructDef; h: DetailsHandlers }) {
  const { types, onPatchStruct, onDeleteStruct } = h;
  const setFields = (fields: StructField[]) => onPatchStruct({ fields });
  return (
    <>
      <label>
        name
        <input value={struct.name} onChange={(e) => onPatchStruct({ name: e.target.value })} />
      </label>
      <div className="panel__section">
        <span className="panel__section-title">fields</span>
        {struct.fields.map((f, i) => (
          <div className="pinrow-edit" key={i}>
            <input value={f.name} placeholder="field" onChange={(e) => setFields(struct.fields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <TypeSelect value={f.type} types={types.filter((s) => s.id !== struct.id)} onChange={(t) => setFields(struct.fields.map((x, j) => (j === i ? { ...x, type: t } : x)))} />
            <button className="icon-btn" onClick={() => setFields(struct.fields.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="icon-btn" onClick={() => setFields([...struct.fields, { name: `field${struct.fields.length}`, type: 'string' }])}>+ field</button>
      </div>
      <button className="btn btn--danger" onClick={onDeleteStruct}>Delete struct</button>
    </>
  );
}

function EdgeDetails({ edge, h }: { edge: DiagramEdge; h: DetailsHandlers }) {
  return (
    <>
      <label>
        label
        <input value={edge.label ?? ''} placeholder="edge label" onChange={(e) => h.onPatchEdge({ label: e.target.value })} />
      </label>
      <div className="panel__section">
        <span className="panel__section-title">{edge.role} wire</span>
      </div>
    </>
  );
}

function CommentDetails({ group, h }: { group: Group; h: DetailsHandlers }) {
  const colors: Array<Group['color']> = ['gray', 'string', 'number', 'bool', 'object', 'array', 'schema'];
  return (
    <>
      <label>
        label
        <input value={group.label} onChange={(e) => h.onPatchComment({ label: e.target.value })} />
      </label>
      <label>
        body
        <textarea value={group.body ?? ''} onChange={(e) => h.onPatchComment({ body: e.target.value })} />
      </label>
      <label>
        color
        <select value={group.color ?? 'gray'} onChange={(e) => h.onPatchComment({ color: e.target.value as Group['color'] })}>
          {colors.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </label>
    </>
  );
}

// ── router ────────────────────────────────────────────────────────────────

export function DetailsPanel({ selection, h }: { selection: Selection; h: DetailsHandlers }) {
  const head =
    selection.kind === 'node' ? selection.node.id
    : selection.kind === 'variable' ? selection.variable.name
    : selection.kind === 'struct' ? selection.struct.name
    : selection.kind === 'edge' ? selection.edge.id
    : selection.group.id;

  return (
    <aside className="panel">
      <div className="panel__head">
        <span>{head}</span>
        <span>{selection.kind}</span>
      </div>
      {selection.kind === 'node' ? <NodeDetails node={selection.node} h={h} /> : null}
      {selection.kind === 'variable' ? <VariableDetails variable={selection.variable} h={h} /> : null}
      {selection.kind === 'struct' ? <StructDetails struct={selection.struct} h={h} /> : null}
      {selection.kind === 'edge' ? <EdgeDetails edge={selection.edge} h={h} /> : null}
      {selection.kind === 'comment' ? <CommentDetails group={selection.group} h={h} /> : null}
      <button className="btn btn--accent" onClick={h.onSave}>Save changes</button>
    </aside>
  );
}
