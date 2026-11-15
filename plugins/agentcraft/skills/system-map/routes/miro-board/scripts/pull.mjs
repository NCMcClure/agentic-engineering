#!/usr/bin/env node
// Pulls the board's layout into the repo, so positions and connector routing changed
// in Miro survive the next build. Feed it a canvas_read_as_svg result covering the
// frames, or the result of publishing an update (whose newly created items carry
// their generator key as id, so their board ids get recorded too). Either the saved
// tool-result JSON or its svg string in a file.
//
// Usage: node pull.mjs <result.json|result.svg> [--config <miro.config.mjs>] [--adopt <frame>...]
// --adopt takes a frame created from <frame>.svg whose create result was not kept: its
// items in the read are matched to the generator's by position (shapes, text) and by
// their two ends (connectors), and their board ids recorded.
// Merges into miro/<frame>.layout.json and miro/board.json beside the config, and
// reports board items the generators do not know (added by hand in Miro) and generator
// items missing from the board.

import { readFileSync } from "node:fs";
import { LAYOUT_FIELDS, sceneItems } from "./miro.mjs";
import { list, loadProject } from "./project.mjs";

const P = await loadProject();
const raw = readFileSync(process.argv[2], "utf8");
// The svg itself, or a saved tool result: JSON with an svg field, possibly inside text blocks.
const svgOf = (j) => {
  if (typeof j === "string") return !j.trim() ? "" : j.trimStart().startsWith("<") ? j : svgOf(JSON.parse(j));
  if (j.svg) return j.svg;
  return (Array.isArray(j) ? j : j.content ?? []).map((c) => svgOf(c.text ?? "")).join("");
};
const svg = svgOf(raw);
const { board } = P;
const keyOf = new Map(Object.entries(board.ids).map(([k, id]) => [id, k]));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const num = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Math.round(Number(v)) : v);
// Miro single-quotes a value that holds double quotes.
const attrsOf = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]));

// Item kind from the tag, as miro.mjs assigns it; containers and shapes take the same fields.
const kindOf = (tag, a) => (tag === "textArea" ? "text" : tag === "line" ? (a["data-type"] === "divider" ? "divider" : "connector") : "shape");

let recorded = 0;
// Miro escapes a label's entities once more than we wrote them ("&amp;#39;").
const decode = (v = "") => { let p; do { p = v; v = v.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'); } while (v !== p); return v; };
for (const fkey of list(process.argv, "--adopt")) {
  const v = P.views.find((x) => x.key === fkey);
  if (!v) { console.log(`${fkey}: not a view in ${P.file}`); continue; }
  const g = svg.match(new RegExp(`<g ([^>]*data-frame="${esc(v.title)}"[^>]*)>([\\s\\S]*?)</g>`));
  if (!g) { console.log(`${fkey}: no frame titled "${v.title}" in the read`); continue; }
  board.frames[fkey] = { id: attrsOf(g[1])["data-miro-id"] };
  const items = sceneItems(await P.scene(v), fkey);
  const at = (a) => `${Math.round(a.x)},${Math.round(a.y)}`;
  const byPlace = new Map(items.filter((it) => it.kind !== "connector" && it.kind !== "divider").map((it) => [`${it.tag}@${at(it.attrs)}`, it.key]));
  for (const t of g[2].matchAll(/<(rect|textArea)\b([^>]*?)\/?>/g)) {
    const a = attrsOf(t[2]);
    if (a["data-type"] === "frame" || !a["data-miro-id"]) continue;
    const key = byPlace.get(`${t[1]}@${at(a)}`);
    if (key) { board.ids[key] = a["data-miro-id"]; keyOf.set(a["data-miro-id"], key); recorded++; }
  }
  // Connectors are not children of their frame in a read; they belong to it by their ends.
  for (const t of svg.matchAll(/<line\b([^>]*?)\/?>/g)) {
    const a = attrsOf(t[1]);
    const [s0, e0] = [keyOf.get(a["data-start"]?.slice(1)), keyOf.get(a["data-end"]?.slice(1))];
    const it = items.find((x) => x.refs?.start === s0 && x.refs?.end === e0 && decode(x.attrs["data-content"]) === decode(a["data-content"]) && !board.ids[x.key]);
    if (it) { board.ids[it.key] = a["data-miro-id"]; keyOf.set(a["data-miro-id"], it.key); recorded++; }
  }
  const left = items.filter((it) => !board.ids[it.key]).map((it) => it.key);
  console.log(`${fkey}: adopted ${items.length - left.length} of ${items.length} items${left.length ? `; unmatched: ${left.join(", ")}` : ""}`);
}

// Newly created items come back carrying their generator key as id and a board id,
// in any attribute order; a new frame as id="<frame key>-frame", which makes it a
// frame the build updates from now on.
for (const t of svg.matchAll(/<(?:g|rect|textArea|line)\b([^>]*)>/g)) {
  const a = attrsOf(t[1]);
  const [key, id] = [a.id, a["data-miro-id"]];
  if (!key || !id || /^m\d+$/.test(key) || board.ids[key] === id || Object.values(board.frames).some((f) => f.id === id)) continue;
  const frame = key.match(/^(\w+)-frame$/);
  if (frame) board.frames[frame[1]] = { id };
  else { board.ids[key] = id; keyOf.set(id, key); }
  recorded++;
}
if (recorded || !P.read("board.json", null)) P.write("board.json", JSON.stringify(board, null, 2) + "\n");

const prior = (fkey) => P.read(`${fkey}.layout.json`, { items: {} });
const layouts = {};
const unknown = [];
for (const [fkey, f] of Object.entries(board.frames)) {
  const g = svg.match(new RegExp(`<g [^>]*data-miro-id="${f.id}" transform="translate\\(([-\\d.]+),([-\\d.]+)\\)"`));
  const rect = g && svg.slice(g.index).match(/<rect data-type="frame" x="0" y="0" width="([\d.]+)" height="([\d.]+)"/);
  if (!g) continue;
  const p = prior(fkey);
  layouts[fkey] = { frame: rect ? { x: num(g[1]), y: num(g[2]), width: num(rect[1]), height: num(rect[2]) } : p.frame, items: { ...p.items } };
}
for (const m of svg.matchAll(/<(rect|textArea|line)\b([^>]*?)\/?>/g)) {
  const a = attrsOf(m[2]);
  if (!a["data-miro-id"] || a["data-type"] === "frame") continue;
  const key = keyOf.get(a["data-miro-id"]);
  if (!key) { unknown.push(`${m[1]} ${a["data-miro-id"]}${a["data-content"] ? ` "${a["data-content"].slice(0, 40)}"` : ""}`); continue; }
  const fkey = key.split("-")[0];
  if (!layouts[fkey]) continue;
  const entry = {};
  for (const fld of LAYOUT_FIELDS[kindOf(m[1], a)]) if (a[fld] !== undefined) entry[fld] = num(a[fld]);
  layouts[fkey].items[key] = { ...layouts[fkey].items[key], ...entry };
}

for (const [fkey, l] of Object.entries(layouts)) {
  P.write(`${fkey}.layout.json`, JSON.stringify(l, null, 2) + "\n");
  const missing = Object.keys(board.ids).filter((k) => k.startsWith(`${fkey}-`) && !l.items[k]);
  console.log(`${fkey}: layout holds ${Object.keys(l.items).length} items${missing.length ? `; ${missing.length} without a layout yet: ${missing.join(", ")}` : ""}`);
}
if (recorded) console.log(`recorded board ids for ${recorded} new item(s)`);
if (unknown.length) console.log(`On the board but not in any generator (${unknown.length}):\n  ${unknown.join("\n  ")}`);
