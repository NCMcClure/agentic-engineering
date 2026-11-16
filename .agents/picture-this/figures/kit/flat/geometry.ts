// Flat space: the page's own coordinates, x right and y down, in px. What
// the flat shapes are laid out with: boxes, right-angled routes between two
// points, grids of cells, values as tints. Pure: numbers in, numbers out, so
// a figure can ask where something is before it draws anything.

export type P2 = readonly [number, number];
export type Box = { x: number; y: number; width: number; height: number };

const round = (v: number): number => { const r = Math.round(v * 100) / 100; return r === 0 ? 0 : r; };

/**
 * A right-angled route from one point to another, as its corners. It leaves
 * along `first` ("h": sideways, "v": up or down), turns at `via` (an x for
 * "h", a y for "v"; half-way unless said), and arrives along the same axis it
 * left on. `via` equal to the far point's own x or y gives a single turn.
 * Two points already level are a straight line.
 */
export function elbow(from: P2, to: P2, { first = "h", via }: { first?: "h" | "v"; via?: number } = {}): P2[] {
  const [x1, y1] = from, [x2, y2] = to;
  const corners: P2[] = first === "h"
    ? [[x1, y1], [via ?? round((x1 + x2) / 2), y1], [via ?? round((x1 + x2) / 2), y2], [x2, y2]]
    : [[x1, y1], [x1, via ?? round((y1 + y2) / 2)], [x2, via ?? round((y1 + y2) / 2)], [x2, y2]];
  // A corner that sits on the one before it, or on the line through its neighbours, is no corner.
  const out: P2[] = [];
  for (const p of corners) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const before = out[out.length - 2];
    if (before && ((before[0] === last[0] && last[0] === p[0]) || (before[1] === last[1] && last[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out;
}

/** One cell of a box cut into `columns` by `rows` equal cells: a stage at a tick, a square of a board. */
export function slotIn(box: Box, columns: number, rows: number, column: number, row: number): Box {
  const w = box.width / columns, h = box.height / rows;
  return { x: round(box.x + column * w), y: round(box.y + row * h), width: round(w), height: round(h) };
}

/** The box of one cell in a grid of square cells, `gap` apart, from an origin. */
export function cell(column: number, row: number, size: number, gap = 0, origin: P2 = [0, 0]): Box {
  return { x: round(origin[0] + column * (size + gap)), y: round(origin[1] + row * (size + gap)), width: size, height: size };
}

/** The middle of a box. */
export function middle(box: Box): P2 {
  return [round(box.x + box.width / 2), round(box.y + box.height / 2)];
}

/** A point `p` (0 to 1) of the way from one point to another. */
export function between(from: P2, to: P2, p: number): P2 {
  return [round(from[0] + (to[0] - from[0]) * p), round(from[1] + (to[1] - from[1]) * p)];
}

/** `n` places evenly spaced from `from` to `to`, both ends included. One place sits in the middle. */
export function spread(n: number, from: number, to: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [round((from + to) / 2)];
  return Array.from({ length: n }, (_, i) => round(from + ((to - from) * i) / (n - 1)));
}

/** A value between `lo` and `hi` as one of `steps` even tints, 0 to 1: a reader can tell five tints apart, not fifty. */
export function tint(value: number, lo: number, hi: number, steps = 5): number {
  if (hi <= lo) return 0;
  const share = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return steps <= 1 ? share : round(Math.round(share * (steps - 1)) / (steps - 1));
}

/** The smallest and largest value in a grid. */
export function range(values: readonly (readonly number[])[]): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const row of values) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo === Infinity ? { lo: 0, hi: 0 } : { lo, hi };
}

/** One colour part of the way to another, for a fill or a line that changes with the frame. Both are tokens. */
export function mix(a: string, b: string, p: number): string {
  return `color-mix(in oklab, ${a} ${Math.round(Math.min(1, Math.max(0, p)) * 100)}%, ${b})`;
}
