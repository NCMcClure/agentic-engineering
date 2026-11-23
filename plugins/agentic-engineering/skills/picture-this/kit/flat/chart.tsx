"use client";
// Quantities, drawn. A meter is one number against its limit, filling and
// emptying with the frame. An axis is a ruled line with named ticks: a
// scale, a ruler, a threshold. Cells are a grid of numbers, each tinted by
// how large it is. Lanes are the ruled ground of a time grid: one row per
// stage, one column per tick.
import { between, cell, mix, range, slotIn, tint } from "./geometry";
import type { Box, P2 } from "./geometry";
import { Tile } from "./panel";

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
        const isMark = mark !== undefined && mark[0] === r && mark[1] === c ? marked : 0;
        // A cell not filled in yet is a blank face, so the table's shape is there before its numbers.
        if (here <= 0) return <rect key={`${r}-${c}`} className="pt-cell" x={box.x} y={box.y} width={size} height={size} rx={2} style={{ fill: "var(--pt-top)" }} />;
        return (
          <g key={`${r}-${c}`}>
            <rect className="pt-cell" x={box.x} y={box.y} width={size} height={size} rx={2} style={{ fill: "var(--pt-top)" }} />
            <Tile box={box} label={numbers ? (format ? format(value) : String(value)) : undefined} share={tint(value, from, to, steps)} accent={isMark} here={here} tintAccent={accent} />
          </g>
        );
      }))}
    </g>
  );
}

/**
 * A ruled line from one point to another with ticks on it: a scale, a
 * ruler, the edge of a chart, a threshold. Each tick sits `at` a share of
 * the line (0 to 1) and may carry a `label` and a quieter `sub` under it;
 * `lit` (0 to 1) dims a tick the story has not reached, and `accent` takes
 * one to the accent. `fill` draws the accent along the line between two
 * shares: the stretch the story is on. `side` puts the words below or above
 * a level line, right or left of an upright one.
 */
export function Axis({ from, to, ticks = [], fill, side = "after", tick = 5, dashed = false, lit = 1 }: {
  from: P2;
  to: P2;
  ticks?: readonly { at: number; label?: string; sub?: string; lit?: number; accent?: number }[];
  fill?: readonly [number, number];
  side?: "after" | "before";
  /** A tick's length, in px. */
  tick?: number;
  dashed?: boolean;
  lit?: number;
}) {
  const level = Math.abs(to[0] - from[0]) >= Math.abs(to[1] - from[1]);
  const sign = side === "after" ? 1 : -1;
  const ink = mix("var(--pt-line)", "var(--pt-line-2)", lit);
  const [fa, fb] = fill ? [between(from, to, fill[0]), between(from, to, fill[1])] : [from, from];
  return (
    <g>
      <path className={dashed ? "pt-guide" : "pt-edge"} d={`M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}`} style={dashed ? undefined : { stroke: ink }} />
      {fill && fill[1] > fill[0] ? <path className="pt-pulse" d={`M ${fa[0]} ${fa[1]} L ${fb[0]} ${fb[1]}`} /> : null}
      {ticks.map((t, i) => {
        const [x, y] = between(from, to, t.at);
        const on = t.lit ?? 1;
        const stroke = (t.accent ?? 0) > 0 ? mix("var(--pt-accent)", ink, t.accent ?? 0) : mix("var(--pt-line)", "var(--pt-line-2)", on * lit);
        const mark = level ? `M ${x} ${y - tick} L ${x} ${y + tick}` : `M ${x - tick} ${y} L ${x + tick} ${y}`;
        const tx = level ? x : x + sign * (tick + 6), ty = level ? y + (sign > 0 ? tick + 13 : -tick - (t.sub ? 18 : 6)) : y + 3.5;
        const anchor = level ? "middle" : sign > 0 ? "start" : "end";
        return (
          <g key={i} opacity={r3(0.45 + 0.55 * on)}>
            <path className="pt-edge" d={mark} style={{ stroke }} />
            {t.label ? <text className="pt-label" x={r3(tx)} y={r3(ty)} textAnchor={anchor}>{t.label}</text> : null}
            {t.sub ? <text className="pt-tag" x={r3(tx)} y={r3(ty + 12)} textAnchor={anchor}>{t.sub}</text> : null}
          </g>
        );
      })}
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
