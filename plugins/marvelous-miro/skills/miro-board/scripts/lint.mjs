// The legibility lint: the checks the board's legibility passes kept doing by eye, as
// geometry. build.mjs runs it on what it is about to publish (predicted geometry: the
// board's layout plus the generator's, connectors routed the way Miro routes them), and
// live.mjs runs it on a dump of the board (board-dump.js) with the routes and captions
// Miro actually drew, so a publish is checked without anyone zooming in on the board.
//
// Each check encodes a rule about how Miro draws; the rules, and which check enforces
// each, are in ../references/how-miro-draws.md. The constants below are the measured ones.
//
// A finding on a predicted route is estimated (est) only where the predictor is known to
// miss Miro's router (routeEst); every other finding is firm. lint(model, { strict })
// marks the ones that block a build: the firm ones, and every one on a strict frame.

import { tw } from "./scene-kit.mjs";
import { LH, PAD, measureHtml } from "./measure.mjs";

export { LH, PAD } from "./measure.mjs";
export const GAP = 10, LINE_CLEAR = 6;
// An auto-height text widget is 1.143 of its font size tall per line (live dumps).
const TEXT_LH = 1.143;
const CAP_PADX = 4, CAP_H = 1.45;
// line_parallel: closer than PARALLEL_D for longer than PARALLEL_RUN. Runs within
// COLLINEAR_TOL are line_line's, so each defect has one name.
const PARALLEL_D = 20, PARALLEL_RUN = 20, COLLINEAR_TOL = 3;
// direction: on a strict frame, the share of main edges that point right or down. The
// hand-laid reference frames sit at 85% and up; a generated one has to keep up.
const FORWARD = 0.8;
// A legend entry: a swatch (a box at most 40 by 30 with no text) or a line sample (a
// divider at most 60 long), with its label starting within 24px to its right.
const SAMPLE_LINE = 60, SAMPLE_LABEL = 24;

// ── geometry ─────────────────────────────────────────────────────────────────
const inter = (a, b, m = 0) => a[0] < b[2] - m && b[0] < a[2] - m && a[1] < b[3] - m && b[1] < a[3] - m;
const contains = (o, i, pad = 2) => i[0] >= o[0] - pad && i[1] >= o[1] - pad && i[2] <= o[2] + pad && i[3] <= o[3] + pad;
const area = (r) => (r[2] - r[0]) * (r[3] - r[1]);
const dist = (a, b) => Math.hypot(Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2])), Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3])));
const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const center = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];

// Does segment p-q pass through the interior of r (shrunk by inset)? Liang-Barsky.
function segRect(p, q, r, inset = 1) {
  const [x0, y0, x1, y1] = [r[0] + inset, r[1] + inset, r[2] - inset, r[3] - inset];
  if (x0 >= x1 || y0 >= y1) return false;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return (t1 - t0) * Math.hypot(dx, dy) > 2;
}
const segs = (P) => P.slice(1).map((q, i) => [P[i], q]);
// The point a fraction f along a route, and the segment [p, q] it is on.
function locate(P, f) {
  const L = segs(P).map(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]));
  let d = f * L.reduce((a, b) => a + b, 0);
  for (let i = 0; i < L.length; i++) {
    if (d <= L[i] || i === L.length - 1) {
      const t = L[i] ? Math.min(1, d / L[i]) : 0, [p, q] = [P[i], P[i + 1]];
      return [[p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])], p, q];
    }
    d -= L[i];
  }
  return [P[0], P[0], [P[0][0] + 1, P[0][1]]];
}
// The point a fraction f along a route, and the vector of the segment it is on.
export function pointAt(P, f) {
  const [pt, p, q] = locate(P, f);
  return [pt, [q[0] - p[0], q[1] - p[1]]];
}
// Drop legs shorter than tol and points a route runs straight through: Miro draws a
// facing elbow whose ends line up as one straight segment, two points, not four.
function simplify(P, tol = 0.5) {
  if (P.length < 2) return P;
  const out = [P[0]];
  for (const pt of P.slice(1)) if (Math.abs(pt[0] - out.at(-1)[0]) >= tol || Math.abs(pt[1] - out.at(-1)[1]) >= tol) out.push(pt);
  if (out.length === 1) out.push(P.at(-1));
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((Math.abs(a[0] - b[0]) < tol && Math.abs(b[0] - c[0]) < tol) || (Math.abs(a[1] - b[1]) < tol && Math.abs(b[1] - c[1]) < tol)) out.splice(i, 1);
  }
  return out;
}
function collinear(p, q, r, s, tol = COLLINEAR_TOL) {
  const span = (a0, a1, b0, b1) => Math.max(0, Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1)));
  if (Math.abs(p[1] - q[1]) < 0.5 && Math.abs(r[1] - s[1]) < 0.5 && Math.abs(p[1] - r[1]) <= tol) return span(p[0], q[0], r[0], s[0]);
  if (Math.abs(p[0] - q[0]) < 0.5 && Math.abs(r[0] - s[0]) < 0.5 && Math.abs(p[0] - r[0]) <= tol) return span(p[1], q[1], r[1], s[1]);
  return 0;
}
// How many times route A crosses route B, counted as it reads: once wherever A passes to
// the other side of B, including through a bend or out of a short stretch the two share,
// and not at all where a bend only touches B and turns back. A is shifted by a small
// offset in three directions that lie on both sides of any line, which turns every
// contact into a proper crossing or none: a pass-through stays one crossing whichever
// way A moves, and a touch becomes none for at least one of the three, so the fewest is
// the count. Contacts under about half a pixel apart count as contacts.
// debt: one pair touching a run from both sides counts 2 too many, upgrade to a per-contact side test when a board shows it.
const NUDGES = [[0.4137, 0.2719], [-0.3391, 0.5113], [0.2087, -0.4523]];
function crossings(A, B) {
  const proper = (P) => {
    let n = 0;
    for (const [p, q] of segs(P)) for (const [r, s] of segs(B)) {
      const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [s[0] - r[0], s[1] - r[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) <= 1e-9 * Math.hypot(...d1) * Math.hypot(...d2)) continue;
      const t = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den, u = ((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) n++;
    }
    return n;
  };
  return Math.min(...NUDGES.map(([dx, dy]) => proper(A.map(([x, y]) => [x + dx, y + dy]))));
}
// Two axis-aligned segments running the same way: [distance apart, length of shared run].
function parallelRun(p, q, r, s) {
  const span = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const H = (a, b) => Math.abs(a[1] - b[1]) < 0.5 && Math.abs(a[0] - b[0]) > 0.5, V = (a, b) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) > 0.5;
  if (H(p, q) && H(r, s)) return [Math.abs(p[1] - r[1]), span(p[0], q[0], r[0], s[0])];
  if (V(p, q) && V(r, s)) return [Math.abs(p[0] - r[0]), span(p[1], q[1], r[1], s[1])];
  return null;
}

// ── text, as Miro draws it ───────────────────────────────────────────────────
const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const label = (s) => decode((s ?? "").replace(/<br\s*\/?>/g, " | ").replace(/<[^>]+>/g, "")).slice(0, 40);

// ── models: what is drawn, as boxes and lines in board coordinates ───────────
// box: { id, frame, type: shape|text, r, content, fs, meas: [h, w], style }
// line: { id, frame, start, end, sides: [s, e], P: points, captions: [{ text, r, run }], est, dashed, both, live }
// divider: { id, frame, P, dashed }
// style is a shape's fill/stroke, known only in a predicted model (a dump carries none).

// From a live dump (board-dump.js) and the board's frames ({ key: id }).
export function liveModel(dump, frameIds) {
  const keyOf = new Map(Object.entries(frameIds).map(([k, id]) => [id, k]));
  const W = new Map(dump.map((w) => [w.id, w]));
  const R = (b) => [b.left, b.top, b.left + b.width, b.top + b.height];
  const frames = dump.filter((w) => w.type === "frame" && keyOf.has(w.id)).map((w) => ({ key: keyOf.get(w.id), r: R(w.b) }));
  const boxes = [];
  for (const w of dump) {
    if (w.type !== "shape" && w.type !== "text") continue;
    const r = R(w.b);
    if (w.type === "text" && w.textH) r[3] = r[1] + Math.min(w.textH, w.b.height);
    boxes.push({ id: w.id, frame: keyOf.get(w.parentId) ?? null, type: w.type, r, content: w.content, fs: w.fs, meas: w.meas, rhombus: w.shape === "rhombus" });
  }
  const lines = dump.filter((w) => w.type === "line").map((w) => {
    const P = (w.pts || []).map((p) => [p.x, p.y]);
    const frame = keyOf.get(W.get(w.start)?.parentId) ?? keyOf.get(W.get(w.end)?.parentId) ?? null;
    const captions = (w.captions || []).map((c) => caption(P, c.position, c.text, c.w, c.fs, w.aligned, c.tav));
    return { id: w.id, frame, start: w.start, end: w.end, sides: [w.startSide, w.endSide], P, captions, est: false, dashed: false, both: false, live: true };
  });
  return { frames, boxes, lines, dividers: [] };
}

// The caption box Miro draws on a route: at position pos along it (0.5 unless set by
// hand), tw(text, fs) + 8 wide and 1.45 fs tall, turned with a vertical segment when
// aligned; aligned top or bottom (Miro's text-align-vertical for captions), it sits
// beside the line instead of on it. textW defaults to tw(text, fs). run is the length of
// the straight run of the route that holds it, over how far the box reaches past either
// end of that run, along it; a jog under 1px does not break a run.
export function caption(P, pos = 0.5, text = "", textW, fs = 14, aligned = true, tav = "middle") {
  let [[cx, cy], p, q] = locate(simplify(P, 1), pos);
  const dx = q[0] - p[0], dy = q[1] - p[1], vertical = Math.abs(dy) > Math.abs(dx), k = vertical ? 1 : 0;
  let w = (textW ?? tw(text, fs)) + 2 * CAP_PADX, h = CAP_H * fs;
  if (aligned && vertical) [w, h] = [h, w];
  if (tav === "top" || tav === "bottom") {
    const n = Math.hypot(dx, dy) || 1;
    let [ox, oy] = [dy / n, -dx / n];
    if (tav === "bottom") [ox, oy] = [-ox, -oy];
    const ext = (Math.abs(ox) > 0.5 ? w : h) / 2 + 2;
    [cx, cy] = [cx + ox * ext, cy + oy * ext];
  }
  const r = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  const over = Math.max(0, Math.min(p[k], q[k]) - r[k], r[k + 2] - Math.max(p[k], q[k]));
  return { text, r, run: Math.hypot(dx, dy), over, vertical };
}

// From what build.mjs is about to publish: per view, the frame rect and its items after
// layout. Connector routes are Miro's default elbow; findings on the routes the
// predictor is known to miss (routeEst) are marked estimated.
export function predictedModel(views) {
  const frames = [], boxes = [], lines = [], dividers = [];
  for (const { key, frame, items } of views) {
    frames.push({ key, r: [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height] });
    const at = (x, y) => [frame.x + x, frame.y + y];
    const rects = new Map(), shapeRects = [];
    for (const it of items) {
      const a = it.attrs;
      if (it.kind === "connector") continue;
      if (it.kind === "divider") { dividers.push({ id: it.key, frame: key, P: [at(a.x1, a.y1), at(a.x2, a.y2)], dashed: a["data-line-style"] === "dashed" }); continue; }
      const [x, y] = at(a.x, a.y);
      if (it.kind === "text") {
        // The widget's top is its y; its text is 1.143 fs per line, and a widget sized
        // taller than its text (a pulled height) still draws only the text's lines.
        const fs = +a["font-size"];
        const n = Math.round(measureHtml(it.body, a.width, fs)[0] / (fs * LH));
        const h = n * TEXT_LH * fs;
        const r = [x, y, x + a.width, y + (a.height ? Math.min(a.height, h) : h)];
        rects.set(it.key, r);
        boxes.push({ id: it.key, frame: key, type: "text", r, content: it.body, fs });
      } else {
        const r = [x, y, x + a.width, y + a.height];
        rects.set(it.key, r);
        shapeRects.push(r);
        const fs = +a["data-font-size"] || 14;
        boxes.push({ id: it.key, frame: key, type: "shape", r, content: a["data-content"], fs, rhombus: a["data-shape"] === "rhombus",
          meas: a["data-content"] ? measureHtml(a["data-content"], a.width - 2 * PAD, fs) : null, style: `${a.fill ?? "none"}/${a.stroke ?? "none"}` });
      }
    }
    for (const it of items.filter((i) => i.kind === "connector")) {
      const a = it.attrs, s = rects.get(it.refs.start), e = rects.get(it.refs.end);
      if (!s || !e) continue;
      const sides = [a["data-start-side"], a["data-end-side"]], shape = a["data-shape"];
      const P = route(s, e, sides, shape);
      const text = a["data-content"];
      const captions = text ? [caption(P, 0.5, text, tw(text, 14), 14)] : [];
      // What Miro's router steers around: both ends, and every other shape that holds
      // neither end (a band or zone the connector sits inside is not in its way).
      const obstacles = shapeRects.filter((r) => r !== s && r !== e && !contains(r, s) && !contains(r, e));
      lines.push({ id: it.key, frame: key, start: it.refs.start, end: it.refs.end, sides, P, captions,
        est: routeEst(s, e, sides, shape, P, obstacles), dashed: !!a["stroke-dasharray"], both: a["data-arrow"] === "both", live: false });
    }
  }
  return { frames, boxes, lines, dividers };
}

const mid = (r, side) => ({ left: [r[0], (r[1] + r[3]) / 2], right: [r[2], (r[1] + r[3]) / 2], top: [(r[0] + r[2]) / 2, r[1]], bottom: [(r[0] + r[2]) / 2, r[3]] })[side];
const horiz = (d) => d === "left" || d === "right";
// Miro's route between two side midpoints: straight as drawn; elbowed with one bend in the
// middle for facing sides, one corner for perpendicular ones, and a 30px detour for
// sides facing the same way. Zero-length legs are dropped. Miro never leaves or enters a
// side on a leg under 30px: it takes a 30px stub instead and crosses over through the
// middle of the gap between the boxes on the other axis.
const STUB = 30;
const NORMAL = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
export function route(s, e, [ss, es], shape) {
  const p = mid(s, ss), q = mid(e, es);
  if (shape === "straight") return [p, q];
  let P;
  if (horiz(ss) && horiz(es)) {
    const x = ss !== es ? (p[0] + q[0]) / 2 : ss === "left" ? Math.min(p[0], q[0]) - STUB : Math.max(p[0], q[0]) + STUB;
    P = simplify([p, [x, p[1]], [x, q[1]], q]);
  } else if (!horiz(ss) && !horiz(es)) {
    const y = ss !== es ? (p[1] + q[1]) / 2 : ss === "top" ? Math.min(p[1], q[1]) - STUB : Math.max(p[1], q[1]) + STUB;
    P = simplify([p, [p[0], y], [q[0], y], q]);
  } else P = simplify(horiz(ss) ? [p, [q[0], p[1]], q] : [p, [p[0], q[1]], q]);
  return stubbed(s, e, ss, es, P) ?? P;
}
// The detour for a route whose first or last leg runs outward under STUB, or null. Only
// when the boxes have a gap on the other axis to cross through; a 2-point route has no bend.
function stubbed(s, e, ss, es, P) {
  if (P.length < 3) return null;
  const out = (a, b, side) => (b[0] - a[0]) * NORMAL[side][0] + (b[1] - a[1]) * NORMAL[side][1];
  const first = out(P[0], P[1], ss), last = out(P[P.length - 1], P[P.length - 2], es);
  const short = (first > 0.5 && first < STUB - 0.5 && horiz(ss)) || (last > 0.5 && last < STUB - 0.5 && horiz(es)) ? "x"
    : (first > 0.5 && first < STUB - 0.5) || (last > 0.5 && last < STUB - 0.5) ? "y" : null;
  if (!short) return null;
  const p = P[0], q = P[P.length - 1];
  const a = [p[0] + STUB * NORMAL[ss][0], p[1] + STUB * NORMAL[ss][1]], b = [q[0] + STUB * NORMAL[es][0], q[1] + STUB * NORMAL[es][1]];
  if (short === "x") {
    const [hi, lo] = s[3] <= e[1] ? [s, e] : e[3] <= s[1] ? [e, s] : [];
    if (!hi) return null;
    const y = (hi[3] + lo[1]) / 2;
    return simplify([p, a, [a[0], y], [b[0], y], b, q]);
  }
  const [l, r] = s[2] <= e[0] ? [s, e] : e[2] <= s[0] ? [e, s] : [];
  if (!l) return null;
  const x = (l[2] + r[0]) / 2;
  return simplify([p, a, [x, a[1]], [x, b[1]], b, q]);
}
// Is the predicted route P an estimate? Only where the predictor misses, judged per leg:
// - a degenerate elbow, with a leg under 1px that runs along the boxes' sides: either leg
//   of a perpendicular elbow, the run along the side of a same-side elbow (its 30px
//   detour legs never degenerate), or the bend of a facing elbow whose ends sit on one
//   line across (ends that line up the other way make the straight line Miro draws);
// - a default path back through one of its own end boxes, which Miro never draws;
// - a perpendicular elbow whose one-corner path meets an obstacle, where Miro detours.
// Facing and same-side elbows otherwise route as predicted around whatever is in the way.
function routeEst(s, e, [ss, es], shape, P, obstacles) {
  if (shape === "straight") return false;
  const p = mid(s, ss), q = mid(e, es);
  const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
  const [along, across] = horiz(ss) ? [dx, dy] : [dy, dx];
  const perp = horiz(ss) !== horiz(es);
  if (perp ? dx < 1 || dy < 1 : ss === es ? across < 1 : along < 1) return true;
  const S = segs(P), hits = (r) => S.some(([a, b]) => segRect(a, b, r));
  return hits(s) || hits(e) || (perp && obstacles.some(hits));
}

// ── the checks ───────────────────────────────────────────────────────────────
// Every finding: { check, frame, a, b, extra, ids, est, blocking }. strict is true (every
// frame) or a list of frame keys: on those frames every finding blocks, estimated or
// not, and the direction check runs. Elsewhere only firm findings block.
export function lint({ frames, boxes, lines, dividers = [] }, { strict = false } = {}) {
  const strictKeys = new Set(Array.isArray(strict) || strict instanceof Set ? strict : []);
  const isStrict = (frame) => strict === true || strictKeys.has(frame);
  const out = [];
  const add = (check, frame, a, b = "", extra = "", ids = [], est = false) => out.push({ check, frame, a, b, extra, ids, est: !!est, blocking: isStrict(frame) || !est });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const shapes = boxes.filter((b) => b.type === "shape"), texts = boxes.filter((b) => b.type === "text");
  for (const s of shapes) {
    const inner = shapes.filter((o) => o !== s && contains(s.r, o.r));
    s.kind = inner.length >= 2 || inner.some((o) => area(o.r) > 0.25 * area(s.r)) ? "container" : null;
  }
  // Find every host before naming any kind: a card drawn before its pill would
  // otherwise already be a "card" when the pill looks for it.
  const loose = shapes.filter((x) => !x.kind);
  for (const s of loose) s.host = loose.find((o) => o !== s && contains(o.r, s.r))?.id;
  for (const s of loose) s.kind = s.host ? "badge" : "card";
  const cards = shapes.filter((s) => s.kind === "card"), badges = shapes.filter((s) => s.kind === "badge");
  const containers = shapes.filter((s) => s.kind === "container");
  const swatch = (s) => s.r[2] - s.r[0] <= 40 && s.r[3] - s.r[1] <= 30 && !s.content;
  const pair = (list, f) => { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (list[i].frame === list[j].frame) f(list[i], list[j]); };
  const near = (check, a, b, an, bn, ids) => {
    if (inter(a, b, 0.5)) add(check, ids.frame, an, bn, "", ids.list, ids.est);
    else if (dist(a, b) < GAP && dist(a, b) > 0.5) add("gap", ids.frame, an, bn, `${Math.round(dist(a, b))}px`, ids.list, ids.est);
  };
  const T = (b) => `T:${label(b.content)}`, C = (b) => `C:${label(b.content) || b.id.slice(-4)}`;
  const X = (ln) => `X:${label(byId.get(ln.start)?.content).slice(0, 18)}→${label(byId.get(ln.end)?.content).slice(0, 18)}`;

  pair(texts, (a, b) => near("text_text", a.r, b.r, T(a), T(b), { frame: a.frame, list: [a.id, b.id] }));
  for (const t of texts) for (const c of [...cards, ...badges]) if (t.frame === c.frame && !swatch(c)) near("text_card", t.r, c.r, T(t), C(c), { frame: t.frame, list: [t.id, c.id] });
  pair(cards.filter((c) => !swatch(c)), (a, b) => near("card_card", a.r, b.r, C(a), C(b), { frame: a.frame, list: [a.id, b.id] }));
  for (const bd of badges) {
    const h = byId.get(bd.host);
    if (!h?.meas) continue;
    const tb = [h.r[0] + PAD, h.r[1] + PAD, h.r[0] + PAD + Math.min(h.meas[1], h.r[2] - h.r[0] - 2 * PAD), h.r[1] + PAD + h.meas[0]];
    if (inter(tb, grow(bd.r, 2))) add("badge_text", bd.frame, `B:${label(bd.content)}`, C(h), "", [bd.id, h.id]);
  }
  for (const c of cards) {
    if (!c.meas) continue;
    const ht = c.r[3] - c.r[1];
    const availH = ht < 40 ? ht - 2 : (ht - 2 * PAD) * (c.rhombus ? 0.55 : 1), availW = c.r[2] - c.r[0] - 2 * PAD;
    if (c.meas[0] > availH + 1 || c.meas[1] > availW + 1) add("overflow", c.frame, C(c), "", `text ${c.meas[0]}px in ${Math.round(availH)}px`, [c.id]);
  }
  for (const f of frames) for (const b of boxes.filter((x) => x.frame === f.key)) if (!contains(f.r, b.r, 0)) add("outside_frame", f.key, b.type === "text" ? T(b) : C(b), "", "", [b.id]);
  pair(frames.map((f) => ({ ...f, frame: "board" })), (a, b) => {
    if (inter(a.r, b.r)) add("frame_frame", "board", a.key, b.key, "overlap");
    else if (dist(a.r, b.r) < 60) add("frame_frame", "board", a.key, b.key, `${Math.round(dist(a.r, b.r))}px apart`);
  });
  // A card half in a band or group box: the border runs through it.
  for (const c of cards) for (const k of containers) if (c.frame === k.frame && inter(c.r, k.r, 0.5) && !contains(k.r, c.r, 0.5)) add("card_border", c.frame, C(c), C(k), "", [c.id, k.id]);

  // A legend lists exactly the styles in use: the stroke colors of cards and pills that
  // carry text by its swatches (a lighter fill of a listed stroke is that style; a
  // borderless tint, stroke the same as its fill, is a backdrop), solid and dashed
  // connectors by its line samples, each kind only when the legend shows one. Needs
  // styles, so it runs on a predicted model only.
  const labelled = (frame, r) => texts.some((t) => t.frame === frame && t.r[0] >= r[2] - 1 && t.r[0] <= r[2] + SAMPLE_LABEL && t.r[1] < r[3] && r[1] < t.r[3]);
  const dash = (x) => (x.dashed ? "dashed" : "solid"), stroke = (x) => x.style.split("/")[1];
  const styled = (c) => c.content && stroke(c) !== c.style.split("/")[0];
  for (const f of frames) {
    const swatches = cards.filter((c) => c.frame === f.key && c.style && swatch(c) && labelled(f.key, c.r));
    const samples = dividers.filter((d) => d.frame === f.key && Math.hypot(d.P[1][0] - d.P[0][0], d.P[1][1] - d.P[0][1]) <= SAMPLE_LINE
      && labelled(f.key, [Math.min(d.P[0][0], d.P[1][0]), Math.min(d.P[0][1], d.P[1][1]) - 9, Math.max(d.P[0][0], d.P[1][0]), Math.max(d.P[0][1], d.P[1][1]) + 9]));
    const cover = (listed, used, styleOf) => {
      for (const st of new Set(used.map(styleOf))) if (!listed.some((x) => styleOf(x) === st)) add("legend_coverage", f.key, "legend", st, "in use, not listed", used.filter((x) => styleOf(x) === st).map((x) => x.id));
      for (const st of new Set(listed.map(styleOf))) if (!used.some((x) => styleOf(x) === st)) add("legend_coverage", f.key, "legend", st, "listed, not in use", listed.filter((x) => styleOf(x) === st).map((x) => x.id));
    };
    if (swatches.length) cover(swatches, [...cards, ...badges].filter((c) => c.frame === f.key && styled(c)), stroke);
    if (samples.length) cover(samples, lines.filter((l) => l.frame === f.key), dash);
  }

  // Connectors: their captions, their routes, and each other. A caption on a predicted
  // route is checked against other connectors by caption_collision; one Miro drew (live)
  // by line_label and label_label, so each defect has one name per model.
  const labels = lines.flatMap((ln) => ln.captions.map((c) => ({ ...c, line: ln })));
  for (const lb of labels) {
    const { line: ln } = lb, L = `L:${lb.text}`;
    for (const c of [...cards, ...badges]) if (c.frame === ln.frame) near("label_card", lb.r, c.r, L, C(c), { frame: ln.frame, list: [ln.id, c.id], est: ln.est });
    for (const t of texts) if (t.frame === ln.frame) near("label_text", lb.r, t.r, L, T(t), { frame: ln.frame, list: [ln.id, t.id], est: ln.est });
    for (const k of containers) if (k.frame === ln.frame && inter(lb.r, k.r) && !contains(k.r, lb.r, 0)) add("label_border", ln.frame, L, C(k), "", [ln.id, k.id], ln.est);
    // A caption reaching past either end of its straight run hangs over the bend: too
    // long for the run, or centered (at the route's midpoint) too near its end.
    const len = lb.vertical ? lb.r[3] - lb.r[1] : lb.r[2] - lb.r[0];
    if (lb.over > 0.5) add("caption_run", ln.frame, L, X(ln), `${Math.round(len)}px on a ${Math.round(lb.run)}px run, ${Math.round(lb.over)}px past its end`, [ln.id], ln.est);
  }
  pair(labels.map((l) => ({ ...l, frame: l.line.frame })), (a, b) => {
    if (a.line !== b.line && !a.line.live && inter(a.r, b.r, 0.5)) return;
    near("label_label", a.r, b.r, `L:${a.text}`, `L:${b.text}`, { frame: a.frame, list: [a.line.id, b.line.id], est: a.line.est || b.line.est });
  });
  for (const ln of lines) {
    const ends = new Set([ln.start, ln.end]), S = segs(ln.P), XL = X(ln);
    for (const c of [...cards, ...badges]) {
      if (c.frame !== ln.frame || ends.has(c.id) || ends.has(c.host)) continue;
      if (S.some(([p, q]) => segRect(p, q, c.r))) add("line_card", ln.frame, XL, C(c), "", [ln.id, c.id], ln.est);
      else if (S.some(([p, q]) => segRect(p, q, grow(c.r, LINE_CLEAR), 0))) add("line_near", ln.frame, XL, C(c), "", [ln.id, c.id], ln.est);
    }
    for (const t of texts) if (t.frame === ln.frame && S.some(([p, q]) => segRect(p, q, t.r, 2))) add("line_text", ln.frame, XL, T(t), "", [ln.id, t.id], ln.est);
    for (const lb of labels) if (lb.line.live && lb.line !== ln && lb.line.frame === ln.frame && S.some(([p, q]) => segRect(p, q, lb.r, 1))) add("line_label", ln.frame, XL, `L:${lb.text}`, "", [ln.id, lb.line.id], ln.est || lb.line.est);
    if (S.some(([p, q]) => Math.abs(p[0] - q[0]) > 0.5 && Math.abs(p[1] - q[1]) > 0.5)) add("diagonal", ln.frame, XL, "", "", [ln.id]);
  }
  // caption_collision: a predicted caption box crossed by another connector's route or
  // overlapping its caption. Sharing a side is fine while the boxes stay disjoint.
  lines.forEach((ln, i) => {
    if (ln.live) return;
    for (const c of ln.captions) lines.forEach((o, j) => {
      if (o === ln || o.frame !== ln.frame) return;
      const crossed = segs(o.P).some(([p, q]) => segRect(p, q, c.r, 1));
      const cap = j > i && o.captions.some((oc) => inter(c.r, oc.r, 0.5));
      if (crossed || cap) add("caption_collision", ln.frame, `L:${c.text}`, X(o), crossed && cap ? "route and caption" : crossed ? "route" : "caption", [ln.id, o.id], ln.est || o.est);
    });
  });
  // Between connectors that share no endpoint: collinear overlap (line_line), crossings
  // (line_cross, one finding per pair with its count), and the closest parallel run
  // under PARALLEL_D for over PARALLEL_RUN (line_parallel).
  pair(lines, (a, b) => {
    if (new Set([a.start, a.end, b.start, b.end]).size < 4) return;
    const est = a.est || b.est, SA = segs(a.P), SB = segs(b.P);
    const ov = Math.max(0, ...SA.flatMap(([p, q]) => SB.map(([r, s]) => collinear(p, q, r, s))));
    if (ov > 20) add("line_line", a.frame, a.id, b.id, `${Math.round(ov)}px shared`, [a.id, b.id], est);
    const n = crossings(a.P, b.P);
    let run = null;
    for (const [p, q] of SA) for (const [r, s] of SB) {
      const pr = parallelRun(p, q, r, s);
      if (pr && pr[0] > COLLINEAR_TOL && pr[0] < PARALLEL_D && pr[1] > PARALLEL_RUN && (!run || pr[0] < run[0] || (pr[0] === run[0] && pr[1] > run[1]))) run = pr;
    }
    if (n) add("line_cross", a.frame, X(a), X(b), `${n} crossing${n > 1 ? "s" : ""}`, [a.id, b.id], est);
    if (run) add("line_parallel", a.frame, X(a), X(b), `${Math.round(run[0])}px apart for ${Math.round(run[1])}px`, [a.id, b.id], est);
  });
  // direction, strict frames only: main edges (solid, one arrowhead) read right or down.
  // An edge reads backward only when its end box's center is up, left, or up and to the
  // left of its start box's: a fan-out down to a box far to the left still reads down.
  for (const f of frames.filter((x) => isStrict(x.key))) {
    const main = lines.filter((l) => l.frame === f.key && !l.dashed && !l.both && byId.has(l.start) && byId.has(l.end));
    const back = main.filter((l) => {
      const [p, q] = [center(byId.get(l.start).r), center(byId.get(l.end).r)];
      return q[0] - p[0] <= 0.5 && q[1] - p[1] <= 0.5;
    });
    const fwd = main.length - back.length;
    if (main.length && fwd / main.length < FORWARD - 1e-9) add("direction", f.key, `${fwd} of ${main.length} main edges point right or down`, "", `under ${FORWARD * 100}%`, back.map((l) => l.id));
  }
  const seen = new Set();
  return out.filter((f) => { const k = `${f.check}|${f.frame}|${f.a}|${f.b}|${[...f.ids].sort().join(",")}`; return !seen.has(k) && seen.add(k); });
}

export const CHECKS = ["overflow", "text_text", "text_card", "card_card", "badge_text", "gap", "outside_frame", "frame_frame", "card_border",
  "legend_coverage", "label_card", "label_text", "label_label", "label_border", "caption_collision", "caption_run", "line_card", "line_near",
  "line_text", "line_label", "line_line", "line_cross", "line_parallel", "diagonal", "direction"];

export function report(findings, frames, { verbose = false } = {}) {
  const cols = [...frames, "board"].filter((f) => f === "board" ? findings.some((x) => x.frame === "board") : true);
  const lines = [`${"check".padEnd(18)}${cols.map((f) => f.slice(0, 8).padStart(9)).join("")}`];
  for (const c of CHECKS) {
    const n = cols.map((f) => findings.filter((x) => x.check === c && x.frame === f).length);
    if (n.some(Boolean)) lines.push(`${c.padEnd(18)}${n.map((v) => String(v).padStart(9)).join("")}`);
  }
  if (verbose) for (const f of findings) lines.push(`  [${f.frame}] ${f.check}${f.est ? " (est)" : ""}  ${f.a}${f.b ? `  x  ${f.b}` : ""}  ${f.extra}`);
  return lines.join("\n");
}
