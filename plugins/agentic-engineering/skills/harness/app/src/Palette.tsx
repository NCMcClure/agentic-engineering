import { useEffect, useMemo, useRef, useState } from 'react';

/** A searchable entry in the node finder. Pure presentation — the App owns what
 *  each key spawns (a catalog node, or a Get/Set variable node). */
export interface PaletteItem {
  key: string;
  label: string;
  category: string;
  blurb: string;
}

/** The right-click context node finder. Renders a given, pre-filtered list and
 *  reports the chosen key. */
export function Palette({
  screen,
  items,
  onPick,
  onClose,
}: {
  screen: { x: number; y: number };
  items: PaletteItem[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (d) => d.key.toLowerCase().includes(needle) || d.label.toLowerCase().includes(needle) || d.blurb.toLowerCase().includes(needle),
    );
  }, [q, items]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  return (
    <div className="palette" style={{ left: screen.x, top: screen.y }} onContextMenu={(e) => e.preventDefault()}>
      <input
        ref={inputRef}
        className="palette__search"
        placeholder="Search nodes…"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-listbox"
        aria-activedescendant={results[active] ? `palette-opt-${results[active].key}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const d = results[active];
            if (d) onPick(d.key);
          }
        }}
      />
      <div className="palette__list" id="palette-listbox" role="listbox" aria-label="Node kinds">
        {results.length === 0 ? <div className="palette__empty">No matches</div> : null}
        {results.map((d, i) => (
          <button
            key={d.key}
            id={`palette-opt-${d.key}`}
            role="option"
            aria-selected={i === active}
            className={`palette__item${i === active ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(d.key)}
          >
            <span className="palette__kind">{d.label}</span>
            <span className="palette__cat">{d.category}</span>
            <span className="palette__blurb">{d.blurb}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
