// Isometric projection. Ground coordinates are (x, y, z): x runs down to the
// right, y down to the left, z straight up. Screen coordinates are SVG's: x
// right, y down. One ground unit is `unit` px along an axis.

export type P3 = readonly [number, number, number];
export type P2 = readonly [number, number];

const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

/** A ground point on the screen. */
export function project([x, y, z]: P3, unit = 1): P2 {
  return [round((x - y) * COS * unit), round(((x + y) * SIN - z) * unit)];
}

/** The four corners of a flat rectangle at height z, from its far corner, clockwise as seen. */
export function plate(x: number, y: number, z: number, w: number, d: number, unit = 1): P2[] {
  const corners: P3[] = [[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]];
  return corners.map((p) => project(p, unit));
}

/** The three faces of a box that an isometric view shows. */
export function block(x: number, y: number, z: number, w: number, d: number, h: number, unit = 1): { top: P2[]; left: P2[]; right: P2[] } {
  const at = (px: number, py: number, pz: number): P2 => project([px, py, pz], unit);
  return {
    top: plate(x, y, z + h, w, d, unit),
    left: [at(x, y + d, z + h), at(x + w, y + d, z + h), at(x + w, y + d, z), at(x, y + d, z)],
    right: [at(x + w, y, z + h), at(x + w, y + d, z + h), at(x + w, y + d, z), at(x + w, y, z)],
  };
}

/** Points as an SVG `points` attribute. */
export function points(ps: readonly P2[]): string {
  return ps.map(([x, y]) => `${x},${y}`).join(" ");
}

/**
 * A path through screen points with each corner rounded by `radius`. The wire
 * a pulse travels: give it `pathLength={1}` and the pulse is a dash offset.
 */
export function route(ps: readonly P2[], radius = 0): string {
  if (ps.length < 2) return "";
  let d = `M ${ps[0][0]} ${ps[0][1]}`;
  for (let i = 1; i < ps.length; i++) {
    const [x, y] = ps[i];
    const next = ps[i + 1];
    if (!next || radius <= 0) { d += ` L ${x} ${y}`; continue; }
    const [px, py] = ps[i - 1];
    const before = Math.hypot(x - px, y - py), after = Math.hypot(next[0] - x, next[1] - y);
    const r = Math.min(radius, before / 2, after / 2);
    if (r <= 0) { d += ` L ${x} ${y}`; continue; }
    const ax = round(x - ((x - px) / before) * r), ay = round(y - ((y - py) / before) * r);
    const bx = round(x + ((next[0] - x) / after) * r), by = round(y + ((next[1] - y) / after) * r);
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  return d;
}

/** The point a fraction p (0 to 1) of the way along a polyline, by length. */
export function along(ps: readonly P2[], p: number): P2 {
  if (ps.length === 1) return ps[0];
  const lengths = ps.slice(1).map(([x, y], i) => Math.hypot(x - ps[i][0], y - ps[i][1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.min(1, Math.max(0, p)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : Math.min(1, left / lengths[i]);
      return [round(ps[i][0] + (ps[i + 1][0] - ps[i][0]) * f), round(ps[i][1] + (ps[i + 1][1] - ps[i][1]) * f)];
    }
    left -= lengths[i];
  }
  return ps[ps.length - 1];
}

/** The centre of a set of points: where a plate's label leader starts. */
export function centre(ps: readonly P2[]): P2 {
  const n = ps.length || 1;
  return [round(ps.reduce((a, [x]) => a + x, 0) / n), round(ps.reduce((a, [, y]) => a + y, 0) / n)];
}

/** The box that holds every point: what a figure's viewBox is fitted to. */
export function bounds(ps: readonly P2[]): { x: number; y: number; width: number; height: number } {
  const xs = ps.map(([x]) => x), ys = ps.map(([, y]) => y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: round(Math.max(...xs) - x), height: round(Math.max(...ys) - y) };
}

/** Two decimals: enough for a hairline, and the same string on every machine. */
function round(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}
