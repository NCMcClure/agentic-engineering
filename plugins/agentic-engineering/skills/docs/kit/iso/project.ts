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
 * The same polyline with each corner rounded by `radius`, as points: every
 * corner becomes a short arc of `steps` segments. A wire is drawn through
 * these, and a pulse is a slice of them, so the pulse stays on the wire.
 */
export function smooth(ps: readonly P2[], radius = 0, steps = 6): P2[] {
  if (ps.length < 3 || radius <= 0) return ps.map(([x, y]) => [x, y] as P2);
  const out: P2[] = [ps[0]];
  for (let i = 1; i < ps.length - 1; i++) {
    const [px, py] = ps[i - 1], [x, y] = ps[i], [nx, ny] = ps[i + 1];
    const before = Math.hypot(x - px, y - py), after = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, before / 2, after / 2);
    if (r <= 0) { out.push([x, y]); continue; }
    const ax = x - ((x - px) / before) * r, ay = y - ((y - py) / before) * r;
    const bx = x + ((nx - x) / after) * r, by = y + ((ny - y) / after) * r;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push([round(u * u * ax + 2 * u * t * x + t * t * bx), round(u * u * ay + 2 * u * t * y + t * t * by)]);
    }
  }
  out.push(ps[ps.length - 1]);
  return out;
}

/** Points as an SVG path: a move, then lines. */
export function line(ps: readonly P2[]): string {
  return ps.map(([x, y], i) => `${i ? "L" : "M"} ${x} ${y}`).join(" ");
}

/** The part of a polyline between two fractions of its length (0 to 1), as points. */
export function slice(ps: readonly P2[], from: number, to: number): P2[] {
  const a = Math.min(1, Math.max(0, from)), b = Math.min(1, Math.max(0, to));
  if (ps.length < 2 || b <= a) return [];
  const lengths = ps.slice(1).map(([x, y], i) => Math.hypot(x - ps[i][0], y - ps[i][1]));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  const out: P2[] = [along(ps, a)];
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    walked += lengths[i];
    const at = total === 0 ? 0 : walked / total;
    if (at > a && at < b) out.push(ps[i + 1]);
  }
  out.push(along(ps, b));
  return out;
}

/** The direction a polyline is heading as it ends, in degrees: 0 is right, 90 is down. */
export function heading(ps: readonly P2[]): number {
  for (let i = ps.length - 1; i > 0; i--) {
    const dx = ps[i][0] - ps[i - 1][0], dy = ps[i][1] - ps[i - 1][1];
    if (dx || dy) return round((Math.atan2(dy, dx) * 180) / Math.PI);
  }
  return 0;
}

/** A circle lying on the ground, as the ellipse an isometric view shows. */
export function disc(x: number, y: number, z: number, r: number, unit = 1): { cx: number; cy: number; rx: number; ry: number } {
  const [cx, cy] = project([x, y, z], unit);
  return { cx, cy, rx: round(Math.SQRT2 * COS * r * unit), ry: round(Math.SQRT2 * SIN * r * unit) };
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

/**
 * A viewBox that holds these ground points with room around them, in px:
 * [top, right, bottom, left]. Leave room for labels, which sit outside the shapes.
 */
export function fitBox(ps: readonly P3[], unit = 1, pad: readonly [number, number, number, number] = [0, 0, 0, 0]): { x: number; y: number; width: number; height: number } {
  const b = bounds(ps.map((p) => project(p, unit)));
  return { x: Math.floor(b.x - pad[3]), y: Math.floor(b.y - pad[0]), width: Math.ceil(b.width + pad[1] + pad[3]), height: Math.ceil(b.height + pad[0] + pad[2]) };
}

/** Two decimals: enough for a hairline, and the same string on every machine. */
function round(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}
