// The left "My Blueprint" panel: declared variables and struct types, each with
// declare/delete. Selecting one opens the right DetailsPanel. Pure UI.

import type { StructDef, Variable } from './types';
import { typeColorKey } from './types-registry';

export function VariablesPanel({
  variables,
  types,
  selectedId,
  onSelectVariable,
  onSelectStruct,
  onAddVariable,
  onAddStruct,
}: {
  variables: Variable[];
  types: StructDef[];
  selectedId: string | null;
  onSelectVariable: (id: string) => void;
  onSelectStruct: (id: string) => void;
  onAddVariable: () => void;
  onAddStruct: () => void;
}) {
  return (
    <aside className="panel panel--left">
      <div className="vp-section">
        <div className="vp-section__head">
          <span className="panel__section-title">variables</span>
          <button className="icon-btn" onClick={onAddVariable} title="declare variable">+</button>
        </div>
        {variables.length === 0 ? <div className="vp-empty">none yet</div> : null}
        {variables.map((v) => (
          <button
            key={v.id}
            className={`vp-item${selectedId === v.id ? ' is-active' : ''}`}
            onClick={() => onSelectVariable(v.id)}
          >
            <span className="vp-dot" style={{ background: `var(--type-${typeColorKey(v.type)})` }} />
            <span className="vp-name">{v.name}</span>
            <span className="vp-type">{v.type}</span>
          </button>
        ))}
      </div>

      <div className="vp-section">
        <div className="vp-section__head">
          <span className="panel__section-title">struct types</span>
          <button className="icon-btn" onClick={onAddStruct} title="define struct">+</button>
        </div>
        {types.length === 0 ? <div className="vp-empty">none yet</div> : null}
        {types.map((s) => (
          <button
            key={s.id}
            className={`vp-item${selectedId === s.id ? ' is-active' : ''}`}
            onClick={() => onSelectStruct(s.id)}
          >
            <span className="vp-dot" style={{ background: 'var(--type-struct)' }} />
            <span className="vp-name">{s.name}</span>
            <span className="vp-type">{s.fields.length}f</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
