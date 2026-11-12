// The drawing kit a generator receives: a palette, text measuring, and a scene that
// collects cards, text, and arrows in z-order layers. A generator never imports this
// file; build.mjs passes it in (generate(kit, ...args)), so a project's generators keep
// working when the plugin moves on update. miro.mjs turns the scene into Miro items.

import { randomInt } from "node:crypto";

export const PAL = {
  blue: { bg: "#d0ebff", stroke: "#1971c2" },
  green: { bg: "#d3f9d8", stroke: "#2f9e44" },
  purple: { bg: "#e5dbff", stroke: "#7048e8" },
  yellow: { bg: "#fff3bf", stroke: "#f08c00" },
  gray: { bg: "#f1f3f5", stroke: "#868e96" },
  teal: { bg: "#e3fafc", stroke: "#0c8599" },
  orange: { bg: "#ffe8cc", stroke: "#e8590c" },
};
export const INK = "#1e1e1e";
export const MUTED = "#495057";

// Helvetica advance widths (per 1000 em), close enough to size boxes.
const HW = {
  " ": 278, "!": 278, '"': 355, "$": 556, "'": 191, "(": 333, ")": 333, ",": 278, "-": 333,
  ".": 278, "/": 278, ":": 278, ";": 278, "?": 556, "·": 278, "→": 1000,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667,
  L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667,
  W: 944, X: 667, Y: 667, Z: 611, a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556,
  h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
for (const d of "0123456789") HW[d] = 556;
export const tw = (s, size) => ([...s].reduce((a, ch) => a + (HW[ch] ?? 600), 0) / 1000) * size;
export const LH = 1.25;
export const TS = 19, BS = 14, PAD = 16;

// Greedy word wrap to a pixel width at a font size.
export function wrap(str, width, size) {
  const out = [];
  for (const para of str.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && tw(next, size) > width) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function createScene() {
  const layers = [[], [], [], []]; // background, shapes+text, arrows, arrow labels
  const nodes = {};
  const seed = () => randomInt(1, 2147483646);
  const base = (o) => ({
    angle: 0, strokeColor: INK, backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 0, opacity: 100, seed: seed(), version: 1, versionNonce: seed(),
    isDeleted: false, groupIds: [], frameId: null, roundness: null, boundElements: [],
    updated: Date.now(), link: null, locked: false, ...o,
  });

  function rect(id, x, y, w, h, o = {}) {
    const el = base({
      id, type: o.diamond ? "diamond" : "rectangle", x, y, width: w, height: h, strokeColor: o.stroke ?? INK,
      backgroundColor: o.bg ?? "transparent", strokeStyle: o.dashed ? "dashed" : "solid",
      strokeWidth: o.strokeWidth ?? 2, groupIds: o.groupIds ?? [], roundness: o.diamond ? null : { type: 3 },
    });
    layers[o.layer ?? 1].push(el);
    return el;
  }

  function text(id, x, y, str, o = {}) {
    const size = o.size ?? 16;
    const lines = str.split("\n");
    const width = Math.ceil(Math.max(...lines.map((l) => tw(l, size))));
    const height = Math.ceil(lines.length * size * LH);
    const el = base({
      id, type: "text", x: o.align === "center" ? x - width / 2 : x, y, width, height,
      strokeColor: o.color ?? INK, strokeWidth: 1, groupIds: o.groupIds ?? [], text: str,
      originalText: str, fontSize: size, fontFamily: 2, textAlign: o.align ?? "left",
      verticalAlign: "top", containerId: null, autoResize: true, lineHeight: LH,
    });
    layers[o.layer ?? 1].push(el);
    return el;
  }

  // A card: a colored box with a title, an optional subtitle and pill, and body lines.
  // c.body is an array of lines; c.color names a PAL entry. c.boardAt places a card the
  // board has no layout for yet, in board coordinates, without moving it in the scene.
  function card(id, x, y, w, h, c) {
    const col = PAL[c.color];
    const gid = [`g-${id}`];
    const el = rect(`r-${id}`, x, y, w, h, { bg: c.bg ?? col.bg, stroke: col.stroke, dashed: c.dashed, groupIds: gid });
    if (c.boardAt) el.customData = { boardAt: c.boardAt };
    text(`t-${id}`, x + PAD, y + 14, c.title, { size: TS, groupIds: gid });
    if (c.sub) text(`s-${id}`, x + PAD, y + 40, c.sub, { size: 12, color: col.stroke, groupIds: gid });
    const by = y + (c.sub ? 60 : 44);
    if (c.body?.length) text(`b-${id}`, x + PAD, by, c.body.join("\n"), { size: BS, color: MUTED, groupIds: gid });
    if (c.pill) {
      const pw = Math.ceil(tw(c.pill, 12) + 18);
      // Bottom-right: in a narrow card a top-right pill sits on the title.
      const pill = rect(`p-${id}`, x + w - pw - 10, y + h - 32, pw, 22, { bg: PAL.purple.bg, stroke: PAL.purple.stroke, strokeWidth: 1, groupIds: gid });
      if (c.boardAt) pill.customData = { boardAt: { x: c.boardAt.x + w - pw - 10, y: c.boardAt.y + h - 32 } };
      text(`pt-${id}`, x + w - pw - 10 + pw / 2, y + h - 28, c.pill, { size: 12, align: "center", groupIds: gid });
    }
    return (nodes[id] = { el, x, y, w, h, r: x + w, b: y + h, cx: x + w / 2, cy: y + h / 2 });
  }

  // A decision: a diamond whose label's first line becomes its bold title.
  function decision(id, x, y, w, h, label, o = {}) {
    const col = PAL[o.color ?? "yellow"];
    const el = rect(`r-${id}`, x, y, w, h, { diamond: true, bg: col.bg, stroke: col.stroke });
    const size = o.size ?? 14;
    text(`t-${id}`, x + w / 2, y + (h - label.split("\n").length * size * LH) / 2, label, { size, align: "center" });
    return (nodes[id] = { el, x, y, w, h, r: x + w, b: y + h, cx: x + w / 2, cy: y + h / 2 });
  }

  // Register a box drawn with rect() as a node arrows can bind to.
  function box(id, el) {
    return (nodes[id] = { el, x: el.x, y: el.y, w: el.width, h: el.height, r: el.x + el.width, b: el.y + el.height, cx: el.x + el.width / 2, cy: el.y + el.height / 2 });
  }

  // An arrow from one node to another through pts (scene coordinates). Its end points
  // pick the sides Miro attaches to; the route between them is Miro's.
  function arrow(id, from, to, pts, o = {}) {
    const [x0, y0] = pts[0];
    const rel = pts.map(([px, py]) => [px - x0, py - y0]);
    const xs = rel.map((p) => p[0]);
    const ys = rel.map((p) => p[1]);
    const el = base({
      id, type: "arrow", x: x0, y: y0, width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys), strokeColor: o.color ?? MUTED,
      strokeStyle: o.dashed ? "dashed" : "solid", strokeWidth: 2, points: rel, lastCommittedPoint: null,
      startBinding: { elementId: nodes[from].el.id, focus: 0, gap: 4 },
      endBinding: { elementId: nodes[to].el.id, focus: 0, gap: 4 },
      startArrowhead: o.both ? "arrow" : null, endArrowhead: "arrow", elbowed: false,
    });
    layers[2].push(el);
    nodes[from].el.boundElements.push({ id, type: "arrow" });
    nodes[to].el.boundElements.push({ id, type: "arrow" });
    if (o.label) text(`l-${id}`, ...(o.at ?? pts[0]), o.label, { size: 12, color: o.color ?? MUTED, layer: 3 });
    return el;
  }

  // Anchor points on a node's sides, 4px off the edge.
  const R = (n, dy = 0) => [n.r + 4, n.cy + dy];
  const L = (n, dy = 0) => [n.x - 4, n.cy + dy];
  const T = (n, dx = 0) => [n.cx + dx, n.y - 4];
  const B = (n, dx = 0) => [n.cx + dx, n.b + 4];

  const elements = () => layers.flat();

  return { nodes, rect, text, card, decision, box, arrow, R, L, T, B, elements };
}

export const kit = { PAL, INK, MUTED, TS, BS, PAD, LH, tw, wrap, createScene };
