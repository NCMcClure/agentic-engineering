// Turns a generator's scene into Miro canvas-composer SVG items, applies the layout
// pulled from the board, and serializes them for a fresh board or for an update.
//
// A scene is the element list a gen-*.mjs script writes (rectangles, diamonds, text,
// and arrows with bindings). Each item gets a stable key from its scene id, so the
// board ids and the layout can be keyed by it across rebuilds.

import { createHash } from "node:crypto";

const xa = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const xt = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r = (n) => Math.round(n);
const fill = (c) => (!c || c === "transparent" ? "#ffffff" : c);
const contains = (o, i, pad = 2) => i.x >= o.x - pad && i.y >= o.y - pad && i.x + i.width <= o.x + o.width + pad && i.y + i.height <= o.y + o.height + pad;
const area = (e) => e.width * e.height;
const keyOf = (prefix, id) => `${prefix}-${id}`.replace(/[^\w-]/g, "_");

// The layout fields each kind of item takes from the board.
export const LAYOUT_FIELDS = {
  container: ["x", "y", "width", "height"],
  shape: ["x", "y", "width", "height"],
  text: ["x", "y", "width", "height"],
  divider: ["x1", "y1", "x2", "y2"],
  connector: ["data-shape", "data-start-side", "data-end-side"],
};

// Scene elements to items, in z-order: containers, connectors, shapes, then loose text.
export function sceneItems(elements, prefix) {
  const els = elements.filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  const boxes = els.filter((e) => e.type === "rectangle" || e.type === "diamond");
  // A box is a container (band, group box, legend) when it holds two or more boxes, or one
  // sizeable one; a card holding only its small pill stays a card.
  const isContainer = (b) => {
    const inner = boxes.filter((o) => o !== b && contains(b, o));
    return inner.length >= 2 || inner.some((o) => area(o) > area(b) * 0.25);
  };
  const leaves = boxes.filter((b) => !isContainer(b));
  const arrowLabel = new Map();
  const content = new Map();
  const loose = [];
  for (const t of els.filter((e) => e.type === "text")) {
    if (t.containerId && byId.get(t.containerId)?.type === "arrow") { arrowLabel.set(t.containerId, t.text); continue; }
    // The generators name an arrow's free-floating label l-<arrow id>.
    const owner = t.id.replace(/^l-/, "");
    if (owner !== t.id && byId.get(owner)?.type === "arrow") { arrowLabel.set(owner, t.text); continue; }
    const host = leaves.filter((b) => contains(b, t)).sort((a, b) => area(a) - area(b))[0];
    if (host) (content.get(host.id) ?? content.set(host.id, []).get(host.id)).push(t);
    else loose.push(t);
  }
  const stroke = (e) => ({ stroke: e.strokeColor, "stroke-width": "2", ...(e.strokeStyle === "dashed" ? { "stroke-dasharray": "5,5" } : {}) });
  const items = [];

  for (const b of boxes.filter(isContainer)) {
    items.push({ key: keyOf(prefix, b.id), kind: "container", tag: "rect",
      attrs: { x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height), rx: "12", fill: fill(b.backgroundColor), ...stroke(b) } });
  }
  for (const a of els.filter((e) => e.type === "arrow")) {
    const pts = a.points.map(([px, py]) => [a.x + px, a.y + py]);
    const [p0, p1] = [pts[0], pts.at(-1)];
    const s = a.startBinding && byId.get(a.startBinding.elementId);
    const t = a.endBinding && byId.get(a.endBinding.elementId);
    if (!s || !t) {
      items.push({ key: keyOf(prefix, a.id), kind: "divider", tag: "line",
        attrs: { "data-type": "divider", x1: r(p0[0]), y1: r(p0[1]), x2: r(p1[0]), y2: r(p1[1]), stroke: a.strokeColor, "stroke-width": "2",
          ...(a.strokeStyle === "dashed" ? { "data-line-style": "dashed" } : {}) } });
      continue;
    }
    const side = (b, p) => {
      const d = { left: Math.abs(p[0] - b.x), right: Math.abs(p[0] - (b.x + b.width)), top: Math.abs(p[1] - b.y), bottom: Math.abs(p[1] - (b.y + b.height)) };
      return Object.entries(d).sort((u, v) => u[1] - v[1])[0][0];
    };
    // Straight only when it really is horizontal or vertical. Miro attaches a connector at
    // the middle of a side, so that means the two boxes' centers line up, not just the
    // sketch's end points; anything else is orthogonal.
    const [ss, es] = [side(s, p0), side(t, p1)];
    const across = (ss === "left" || ss === "right") && (es === "left" || es === "right");
    const along = (ss === "top" || ss === "bottom") && (es === "top" || es === "bottom");
    const centered = (across && Math.abs((s.y + s.height / 2) - (t.y + t.height / 2)) < 1) || (along && Math.abs((s.x + s.width / 2) - (t.x + t.width / 2)) < 1);
    const straight = pts.length === 2 && centered;
    const label = arrowLabel.get(a.id);
    items.push({ key: keyOf(prefix, a.id), kind: "connector", tag: "line",
      refs: { start: keyOf(prefix, s.id), end: keyOf(prefix, t.id) },
      attrs: { x1: r(p0[0]), y1: r(p0[1]), x2: r(p1[0]), y2: r(p1[1]), stroke: a.strokeColor, "stroke-width": "2",
        ...(a.strokeStyle === "dashed" ? { "stroke-dasharray": "5,5" } : {}),
        "data-arrow": a.startArrowhead ? "both" : "end", "data-shape": straight ? "straight" : "elbowed",
        "data-start-side": ss, "data-end-side": es,
        ...(label ? { "data-content": label.replace(/\n/g, " ") } : {}) } });
  }
  for (const b of leaves) {
    const ts = (content.get(b.id) ?? []).sort((u, v) => u.y - v.y || u.x - v.x);
    const diamond = b.type === "diamond";
    // A card's first text is its title; a decision's title is the first line of its label.
    const html = ts.map((t, i) => {
      const lines = t.text.split("\n").map(xt);
      if (diamond && lines.length > 1) return `<b>${lines[0]}</b><br>${lines.slice(1).join("<br>")}`;
      return i === 0 && ts.length > 1 ? `<b>${lines.join("<br>")}</b>` : lines.join("<br>");
    }).join("<br>");
    const centered = diamond || ts.length <= 1;
    // A card the generator placed for the board directly keeps its scene position for
    // grouping its text, and starts at that board position until the board has a layout.
    const at = b.customData?.boardAt ?? b;
    items.push({ key: keyOf(prefix, b.id), kind: "shape", tag: "rect",
      attrs: { x: r(at.x), y: r(at.y), width: r(b.width), height: r(b.height),
        ...(diamond ? { "data-shape": "rhombus" } : b.roundness ? { rx: "12" } : {}),
        fill: fill(b.backgroundColor), ...stroke(b),
        ...(html ? { "data-content": html, "data-text-color": ts[0].strokeColor, "data-font-family": "arial",
          "data-font-size": String(Math.max(10, r(Math.min(...ts.map((t) => t.fontSize))))),
          "data-text-align": centered ? "center" : "left", "data-text-align-vertical": centered ? "middle" : "top" } : {}) } });
  }
  for (const t of loose) {
    const lines = t.text.split("\n").map(xt).join("<br/>");
    const bold = t.fontSize >= 18;
    // Sent at Miro's own text height, 1.143 fs per line: without one the canvas tool
    // guesses a height and Miro centres the text in it, off the y the lint measures from.
    items.push({ key: keyOf(prefix, t.id), kind: "text", tag: "textArea",
      attrs: { x: r(t.x), y: r(t.y), width: r(t.width * 1.3 + 24), height: r(t.text.split("\n").length * 1.143 * t.fontSize), "font-family": "arial", "font-size": String(r(t.fontSize)), fill: t.strokeColor,
        ...(bold ? { "font-weight": "bold" } : {}) },
      body: bold ? `<b>${lines}</b>` : lines });
  }
  return items;
}

// The scene's own extent, for a frame no layout has placed yet.
export function sceneFrame(items, pad = 40) {
  let x1 = 0, y1 = 0;
  for (const it of items) {
    const a = it.attrs;
    if (a.width) { x1 = Math.max(x1, a.x + a.width); y1 = Math.max(y1, a.y + (a.height ?? 40)); }
    if (a.x2 !== undefined && it.kind === "divider") { x1 = Math.max(x1, a.x2); y1 = Math.max(y1, a.y2); }
  }
  return { x: 0, y: 0, width: r(x1 + pad), height: r(y1 + pad) };
}

// Board geometry wins over the generator's for every field the layout carries.
export function applyLayout(items, layout = {}) {
  return items.map((it) => {
    const l = layout[it.key];
    if (!l) return it;
    const attrs = { ...it.attrs };
    for (const f of LAYOUT_FIELDS[it.kind]) if (l[f] !== undefined) attrs[f] = l[f];
    return { ...it, attrs };
  });
}

// What an item is, independent of its board id: the publish diff compares these. A
// connector's end points are only a sketch (Miro routes it between its ends), so they
// are left out, or every connector would look changed whenever a card moved.
export const fingerprint = (it) => {
  const attrs = it.kind === "connector" ? Object.fromEntries(Object.entries(it.attrs).filter(([k]) => !["x1", "y1", "x2", "y2"].includes(k))) : it.attrs;
  return createHash("sha1").update(JSON.stringify([it.tag, attrs, it.body ?? "", it.refs ?? null])).digest("hex").slice(0, 16);
};

function serialize(it, idOf) {
  const attrs = { ...it.attrs };
  if (it.refs) { attrs["data-start"] = idOf(it.refs.start).local; attrs["data-end"] = idOf(it.refs.end).local; }
  const { local, miro } = idOf(it.key);
  // An edit restates a connector whole, so an unlabeled one says so, or the board keeps its old caption.
  if (it.refs && miro && attrs["data-content"] === undefined) attrs["data-content"] = "";
  const head = `id="${local}"${miro ? ` data-miro-id="${miro}"` : ""}`;
  const rest = Object.entries(attrs).map(([k, v]) => `${k}="${xa(v)}"`).join(" ");
  return it.tag === "textArea" ? `<textArea ${head} ${rest}>${it.body}</textArea>` : `<${it.tag} ${head} ${rest} />`;
}

// One frame as canvas-composer SVG. ids maps keys to board ids: an item with one is
// written as an edit (local id m<board id>), one without is created. Pass `only` to
// write just those keys (an update); the frame wrapper is always written.
export function frameSvg({ key, title, frame, items, ids = {}, only }) {
  const idOf = (k) => (ids[k] ? { local: `m${ids[k]}`, miro: ids[k] } : { local: k, miro: null });
  const f = idOf(key);
  const body = items.filter((it) => !only || only.has(it.key)).map((it) => serialize(it, idOf));
  const head = `<g id="${f.local}"${f.miro ? ` data-miro-id="${f.miro}"` : ""} transform="translate(${frame.x},${frame.y})" data-frame="${xa(title)}">`;
  const rect = `<rect data-type="frame" x="0" y="0" width="${frame.width}" height="${frame.height}" fill="#ffffff" data-title="${xa(title)}" />`;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg">\n${head}\n${rect}\n${body.join("\n")}\n</g>\n</svg>\n`, count: body.length };
}
