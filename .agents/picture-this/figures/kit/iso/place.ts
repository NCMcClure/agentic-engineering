// Where things stand on the ground, and how a wire gets from one to another.
// A starting layout: a figure moves its boxes by hand once it sees them.
import type { P3 } from "./project";

export type Box = { at: P3; size: readonly [number, number]; height: number };

/** Boxes in a line along x, in the order given, `gap` apart. */
export function row(ids: readonly string[], { gap = 2.4, size = [1.6, 1.6] as readonly [number, number], height = 0.7, x = 0, y = 0, z = 0 } = {}): Record<string, Box> {
  const out: Record<string, Box> = {};
  ids.forEach((id, i) => { out[id] = { at: [x + i * (size[0] + gap), y, z], size, height }; });
  return out;
}

/**
 * Boxes in rows of `columns`, each row in front of the last: a longer story
 * folded so it stays wide. Every other row runs back the other way, so the
 * last thing in one row stands right behind the first in the next.
 */
export function grid(ids: readonly string[], { columns = 3, gap = 2.4, size = [1.6, 1.6] as readonly [number, number], height = 0.7 } = {}): Record<string, Box> {
  const out: Record<string, Box> = {};
  ids.forEach((id, i) => {
    const r = Math.floor(i / columns), c = r % 2 ? columns - 1 - (i % columns) : i % columns;
    out[id] = { at: [c * (size[0] + gap), r * (size[1] + gap), 0], size, height };
  });
  return out;
}

/**
 * The ground points of a wire from one box to another, starting at the face
 * it leaves. Side by side, it crosses the gap straight; otherwise it leaves by
 * the front or back and turns once. `shift` moves it sideways, so two wires
 * between the same pair run beside each other.
 */
export function hop(a: Box, b: Box, shift = 0): P3[] {
  const [ax, ay, az] = a.at, [bx, by] = b.at;
  const [aw, ad] = a.size, [bw, bd] = b.size;
  const overlapY = ay < by + bd && by < ay + ad;
  const overlapX = ax < bx + bw && bx < ax + aw;
  if (overlapY && !overlapX) {
    const y = (Math.max(ay, by) + Math.min(ay + ad, by + bd)) / 2 + shift;
    return bx > ax ? [[ax + aw, y, az], [bx, y, az]] : [[ax, y, az], [bx + bw, y, az]];
  }
  if (overlapX && !overlapY) {
    const x = (Math.max(ax, bx) + Math.min(ax + aw, bx + bw)) / 2 + shift;
    return by > ay ? [[x, ay + ad, az], [x, by, az]] : [[x, ay, az], [x, by + bd, az]];
  }
  // Neither beside nor in front: out of the front or back face, along, and in at the side.
  const x = ax + aw / 2 + shift, y = by + bd / 2 + shift;
  return [[x, by > ay ? ay + ad : ay, az], [x, y, az], [bx > ax ? bx : bx + bw, y, az]];
}

/** Does a box stand between two others that are side by side in a row? */
export function between(a: Box, b: Box, c: Box): boolean {
  const lo = Math.min(a.at[0] + a.size[0], b.at[0] + b.size[0]), hi = Math.max(a.at[0], b.at[0]);
  const inRow = (p: Box, q: Box) => p.at[1] < q.at[1] + q.size[1] && q.at[1] < p.at[1] + p.size[1];
  return inRow(a, b) && inRow(a, c) && c.at[0] >= lo && c.at[0] + c.size[0] <= hi;
}

/**
 * A wire that goes round what stands between two boxes: out of the front of
 * one, along a lane in front of the row, and in at the front of the other.
 */
export function around(a: Box, b: Box, lane: number): P3[] {
  const ax = a.at[0] + a.size[0] / 2, bx = b.at[0] + b.size[0] / 2;
  return [[ax, a.at[1] + a.size[1], a.at[2]], [ax, lane, a.at[2]], [bx, lane, a.at[2]], [bx, b.at[1] + b.size[1], a.at[2]]];
}

/** The ground corners around a set of boxes, `margin` out, plus their tallest top: what a viewBox is fitted to. */
export function extent(boxes: readonly Box[], margin = 0.7): { at: P3; size: readonly [number, number]; points: P3[] } {
  const x0 = Math.min(...boxes.map((b) => b.at[0])) - margin, y0 = Math.min(...boxes.map((b) => b.at[1])) - margin;
  const x1 = Math.max(...boxes.map((b) => b.at[0] + b.size[0])) + margin, y1 = Math.max(...boxes.map((b) => b.at[1] + b.size[1])) + margin;
  const top = Math.max(...boxes.map((b) => b.at[2] + b.height));
  return { at: [x0, y0, 0], size: [x1 - x0, y1 - y0], points: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [x0, y0, top], [x1, y0, top]] };
}
