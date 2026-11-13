"use client";
// Quantities, drawn. A meter is one number against its limit, filling and
// emptying with the frame. Cells are a grid of numbers, each tinted by how
// large it is. Lanes are the ruled ground of a time grid: one row per stage,
// one column per tick.
import { cell, mix, range, slotIn, tint } from "./geometry";
import type { Box, P2 } from "./geometry";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * One number against its limit. `value` and `threshold` are shares of the
 * meter's length, 0 to 1. It fills upward, or to the right. `accent` (0 to 1)
 * takes the fill to the accent: the moment it reaches the line. `ticks` rules
 * it into that many parts.
 */
export function Meter({ box, value, threshold, dir = "up", accent = 0, lit = 1, ticks = 0 }: {
  box: Box;
  value: number;
  threshold?: number;
  dir?: "up" | "right";
  accent?: number;
  lit?: number;
  ticks?: number;
}) {
  const v = Math.min(1, Math.max(0, value));
  const { x, y, width, height } = box;
  const up = dir === "up";
  const base = mix("var(--pt-ink)", "var(--pt-top)", 0.2 + 0.3 * lit);
  const fill = accent > 0 ? mix("var(--pt-accent)", base, accent) : base;
  const filled = up ? { x, y: r3(y + height * (1 - v)), width, height: r3(height * v) } : { x, y, width: r3(width * v), height };
  const mark = (share: number) => (up ? `M ${x - 4} ${r3(y + height * (1 - share))} L ${x + width + 4} ${r3(y + height * (1 - share))}` : `M ${r3(x + width * share)} ${y - 4} L ${r3(x + width * share)} ${y + height + 4}`);
  const rule = (share: number) => (up ? `M ${x} ${r3(y + height * (1 - share))} L ${x + width} ${r3(y + height * (1 - share))}` : `M ${r3(x + width * share)} ${y} L ${r3(x + width * share)} ${y + height}`);
  const r = Math.min(3, width / 2, height / 2);
  return (
    <g>
      <rect className="pt-meter" x={x} y={y} width={width} height={height} rx={r} />
      {filled.width > 0 && filled.height > 0 ? <rect className="pt-bar" {...filled} rx={r} style={{ fill }} /> : null}
      {Array.from({ length: Math.max(0, ticks - 1) }, (_, i) => <path key={i} className="pt-rule" d={rule((i + 1) / ticks)} />)}
      <rect className="pt-meter" x={x} y={y} width={width} height={height} rx={r} style={{ fill: "none" }} />
      {threshold !== undefined ? <path className="pt-edge" d={mark(threshold)} style={{ stroke: accent > 0 ? mix("var(--pt-accent)", "var(--pt-line)", accent) : "var(--pt-line)" }} /> : null}
    </g>
  );
}

/**
 * A grid of square cells, each tinted by its value in a few even steps.
 * `shown` says how much of a cell is there (0 to 1), for a table being filled
 * in; `mark` names the cell the beat is about, which takes the accent;
 * `numbers` writes each value in its cell. Tints are of the ink unless
 * `accent` is set, which tints in the accent: use that when the whole field
 * is the subject and nothing else in the figure is orange.
 */
export function Cells({ at, values, size = 28, gap = 2, steps = 5, lo, hi, shown, mark, marked = 1, numbers = false, accent = false, format }: {
  at: P2;
  values: readonly (readonly number[])[];
  size?: number;
  gap?: number;
  steps?: number;
  lo?: number;
  hi?: number;
  shown?: (row: number, column: number) => number;
  mark?: readonly [number, number];
  marked?: number;
  numbers?: boolean;
  accent?: boolean;
  format?: (value: number) => string;
}) {
  const spanOf = range(values);
  const from = lo ?? spanOf.lo, to = hi ?? spanOf.hi;
  return (
    <g>
      {values.map((row, r) => row.map((value, c) => {
        const here = shown ? Math.min(1, Math.max(0, shown(r, c))) : 1;
        const box = cell(c, r, size, gap, at);
        const share = tint(value, from, to, steps);
        const isMark = mark !== undefined && mark[0] === r && mark[1] === c ? marked : 0;
        const base = accent ? mix("var(--pt-accent)", "var(--pt-top)", share * 0.85) : mix("var(--pt-ink)", "var(--pt-top)", 0.06 + share * 0.5);
        const fill = here <= 0 ? "var(--pt-top)" : isMark > 0 ? mix("var(--pt-accent)", base, isMark) : base;
        const dark = isMark > 0.5 || share > 0.7;
        return (
          <g key={`${r}-${c}`}>
            <rect className="pt-cell" x={box.x} y={box.y} width={size} height={size} rx={2} style={{ fill: here < 1 && here > 0 ? mix(fill, "var(--pt-top)", here) : fill }} />
            {numbers && here > 0 ? (
              <text className="pt-num" x={box.x + size / 2} y={box.y + size / 2 + 3.5} textAnchor="middle" opacity={r3(here)} style={{ fill: dark ? "var(--pt-bg)" : undefined }}>
                {format ? format(value) : String(value)}
              </text>
            ) : null}
          </g>
        );
      }))}
    </g>
  );
}

/**
 * The ground of a time grid, inside `box`: a rule under each of `rows` rows,
 * each named at the left, and a tick above each of `columns` columns, named
 * or numbered. `now` (a column, and it may be a fraction) draws the accent
 * line where the clock is. `slotIn` (in geometry) gives a cell's box, for
 * what is drawn in it.
 */
export function Lanes({ box, rows, columns, ticks, now, gutter = 10 }: {
  box: Box;
  rows: readonly string[];
  columns: number;
  /** The words over the columns. Left out, they are numbered from 1. */
  ticks?: readonly string[];
  now?: number;
  gutter?: number;
}) {
  const { x, y, width, height } = box;
  return (
    <g>
      {rows.map((name, r) => {
        const slot = slotIn(box, columns, rows.length, 0, r);
        return (
          <g key={r}>
            <rect className="pt-lane" x={x} y={slot.y + 2} width={width} height={slot.height - 4} rx={4} />
            <text className="pt-label" x={x - gutter} y={r3(slot.y + slot.height / 2 + 3.5)} textAnchor="end">{name}</text>
          </g>
        );
      })}
      {Array.from({ length: columns }, (_, c) => {
        const slot = slotIn(box, columns, rows.length, c, 0);
        return (
          <g key={c}>
            {c > 0 ? <path className="pt-rule" d={`M ${slot.x} ${y} L ${slot.x} ${y + height}`} /> : null}
            <text className="pt-tag" x={r3(slot.x + slot.width / 2)} y={y - 8} textAnchor="middle">{ticks ? ticks[c] ?? "" : String(c + 1)}</text>
          </g>
        );
      })}
      {now !== undefined ? <path className="pt-edge" d={`M ${r3(x + (width / columns) * now)} ${y - 3} L ${r3(x + (width / columns) * now)} ${y + height + 3}`} style={{ stroke: "var(--pt-accent)" }} /> : null}
    </g>
  );
}
