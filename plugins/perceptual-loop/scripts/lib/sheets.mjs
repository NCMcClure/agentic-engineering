// Sheets: pictures made for eyes, the agent's and the owner's. A number says
// that two pictures differ; a sheet shows how. Every sheet fits a maximum width
// (1568 px by default, the largest a vision model reads without shrinking it
// first), labels each panel in the bitmap font, and draws colour difference on
// one fixed scale, so two sheets made a week apart compare by eye.
//
//   shot      reference | before | after, then what the run changed, where the edges differ, and the colour difference
//   triptych  any pictures side by side at one height, optionally one box of each, zoomed
//   crop      one box of a shot from every source, zoomed
//   contact   a grid of frames with their numbers and times
//   diff      the colour-difference heat map of two pictures, with its numbers
import fs from "node:fs";
import path from "node:path";
import { deltaEMap, labPlanes, linearPlanes } from "./color.mjs";
import { CELL_H, drawText, fitText, wrapText } from "./font.mjs";
import { loadPass, readImage } from "./image.mjs";
import { encodeJpeg } from "./jpeg.mjs";
import { analyse } from "./metrics.mjs";
import { encodePng } from "./png.mjs";
import { PlError } from "./args.mjs";
import { canvas, composite, cropBox, DIM, FG, GAP, pad, scaled, stack, thicken } from "./raster.mjs";

export const MAX_WIDTH = 1568;
export const DE_MAX = 20; // the heat map's fixed scale: dE2000 of 20 and above is the top colour
export const IMAGE_SUFFIXES = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"]);
const SCALE = 2; // text scale: a 12 x 16 px cell, readable by eye and by a vision model
const LINE_H = CELL_H * SCALE + 6;

// ---- text and layout ----------------------------------------------------------------------

/** One line of text on the sheet's background, cut to the width it has. */
export function bar(width, text, colour = FG) {
  const out = canvas(Math.max(1, width), LINE_H);
  drawText(out, 4, 3, fitText(text, width - 8, SCALE), colour, SCALE);
  return out;
}

/** Lines of text, each wrapped to the width. */
const block = (width, lines, colour = FG) => stack(lines.flatMap((l) => wrapText(l, width - 8, SCALE)).map((l) => bar(width, l, colour)), false, { gap: 0 });
const labelled = (img, label) => (label ? stack([bar(img.width, label), img], false, { gap: 0 }) : img);

/** The finished sheet: a header line over it and a border round it. */
function framed(sheet, header, footer = []) {
  const parts = [...(header ? [block(sheet.width, [header])] : []), sheet, ...(footer.length ? [block(sheet.width, footer, DIM)] : [])];
  return pad(stack(parts, false, { gap: GAP }));
}

const room = (maxWidth) => maxWidth - 2 * GAP;

// ---- the heat map ---------------------------------------------------------------------------

// black, indigo, magenta, orange, pale yellow: dark where nothing differs, so the eye goes to the light
const STOPS = [[0, [0, 0, 0]], [0.12, [30, 20, 110]], [0.35, [160, 30, 130]], [0.65, [245, 110, 30]], [1, [255, 250, 190]]];
const HEAT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255, k = STOPS.findIndex(([at]) => at >= x);
    const [a, ca] = STOPS[Math.max(0, k - 1)], [b, cb] = STOPS[k];
    const t = b === a ? 0 : (x - a) / (b - a);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(ca[c] + (cb[c] - ca[c]) * t);
  }
  return lut;
})();

/** The colour of a dE2000 value on the fixed scale. */
export const heatColour = (v) => { const i = Math.max(0, Math.min(255, Math.round((v / DE_MAX) * 255))) * 3; return [HEAT[i], HEAT[i + 1], HEAT[i + 2]]; };

/** A per-pixel dE2000 map as a picture on the fixed scale. */
export function heatImage(map, width, height) {
  const out = canvas(width, height);
  for (let i = 0; i < map.length; i++) out.data.set(heatColour(map[i]), i * 3);
  return out;
}

/** The scale under a heat map: the ramp, and ticks at 0, 1, 2, 5, 10 and 20+. */
export function heatLegend(width) {
  const ramp = canvas(width, 12);
  for (let x = 0; x < width; x++) {
    const c = heatColour((x / Math.max(1, width - 1)) * DE_MAX);
    for (let y = 0; y < 12; y++) ramp.data.set(c, (y * width + x) * 3);
  }
  const ticks = canvas(width, LINE_H);
  let free = 0;
  for (const v of [0, 1, 2, 5, 10, 20]) {
    const text = v === DE_MAX ? `${DE_MAX}+` : String(v);
    const mark = Math.round((v / DE_MAX) * (width - 1)), x = Math.max(0, Math.min(width - text.length * 12, mark));
    if (x < free) continue; // a tick whose label would overlap the last one is left out
    for (let y = 0; y < 4; y++) ticks.data.set(FG, (y * width + mark) * 3);
    free = drawText(ticks, x, 5, text, DIM, SCALE) + 6;
  }
  return stack([ramp, ticks], false, { gap: 0 });
}

/** White where both pictures have an edge, magenta where only the reference has it, green where only the candidate does. */
export function edgeOverlay(ref, maps, thickness) {
  const { width, height } = ref, out = canvas(width, height);
  for (let i = 0; i < width * height; i++) {
    const g = Math.round(((ref.data[i * 3] + ref.data[i * 3 + 1] + ref.data[i * 3 + 2]) / 3) * 0.22); // the reference, dark, behind the lines
    out.data[i * 3] = out.data[i * 3 + 1] = out.data[i * 3 + 2] = g;
  }
  const fat = (m) => thicken(m, width, height, thickness);
  const both = fat(maps.refHit.map((v, i) => v | maps.candHit[i]));
  const refOnly = fat(maps.refEdge.map((v, i) => v & (1 - maps.refHit[i])));
  const candOnly = fat(maps.candEdge.map((v, i) => v & (1 - maps.candHit[i])));
  for (let i = 0; i < width * height; i++) {
    if (candOnly[i]) out.data.set([0, 230, 60], i * 3);
    else if (refOnly[i]) out.data.set([255, 0, 255], i * 3);
    else if (both[i]) out.data.set([255, 255, 255], i * 3);
  }
  return out;
}

const lab = (img) => labPlanes(linearPlanes(img));

// ---- the sheets ------------------------------------------------------------------------------

/** A picture file as RGB8, with any alpha laid over grey 128. */
export function loadPicture(file) {
  if (!fs.existsSync(file)) throw new PlError(`no such picture: ${file}`);
  const img = readImage(file, { alpha: true });
  return composite(img, img.alpha);
}

/** The headline numbers of a frame, for a sheet's header. */
export function headline(frame) {
  const parts = [];
  for (const [key, label, fmt] of [["ssim", "ssim", (v) => v.toFixed(4)], ["deltaENorm", "dE norm", (v) => v.toFixed(2)],
    ["exposureEV", "EV", (v) => (v >= 0 ? "+" : "") + v.toFixed(2)], ["edgeF1", "edge F1", (v) => v.toFixed(3)]]) {
    if (typeof frame?.[key] === "number") parts.push(`${label} ${fmt(frame[key])}`);
  }
  return parts.join(" | ");
}

/**
 * One shot's sheet: reference | before | after on top (before only when given), and under them what this run
 * changed (dE2000 before to after, raw), where the edges differ from the reference, and the colour difference
 * from the reference after the exposure and white-balance fit. Pictures are brought to the reference's size.
 */
export function shotSheet({ reference, before = null, after, names = {}, title = "", frame = null, maxWidth = MAX_WIDTH, edgeTolerance = 2 }) {
  const n = { reference: "reference", before: "before", after: "after", ...names };
  const { img: ref, native } = loadPass(reference);
  const size = [ref.width, ref.height];
  const cand = loadPass(after, { size }).img;
  const prev = before ? loadPass(before, { size }).img : null;
  const an = analyse(ref, cand, { edgeTolerance, want: { ssim: false, detail: false } });
  const cols = prev ? 3 : 2;
  const pw = Math.min(native[0], Math.floor((room(maxWidth) - GAP * (cols - 1)) / cols));
  const k = pw / ref.width;
  const fit = (img) => scaled(img, k);
  const top = [labelled(fit(ref), n.reference), ...(prev ? [labelled(fit(prev), n.before)] : []), labelled(fit(cand), n.after)];
  const lower = [];
  if (prev) lower.push(labelled(fit(heatImage(deltaEMap(lab(prev), lab(cand)), ref.width, ref.height)), `${n.before} -> ${n.after}`));
  // two pixels wide on the finished sheet: at one pixel a line's colour cannot be told
  lower.push(labelled(fit(edgeOverlay(ref, an.maps, Math.ceil(2 / k))), `edges vs ${n.reference}`));
  lower.push(labelled(fit(heatImage(an.maps.deltaENorm, ref.width, ref.height)), `dE norm vs ${n.reference}`));
  const legend = heatLegend(pw);
  const grid = stack([stack(top, true), stack(lower, true), legend], false, { gap: GAP });
  const ev = an.frame.exposureEV;
  const footer = [
    `edges: white both, magenta ${n.reference} only, green ${n.after} only (within ${edgeTolerance} px)`,
    `dE2000 on a fixed scale of 0 to ${DE_MAX}+.${prev ? ` ${n.before} -> ${n.after}: what this run changed, as rendered.` : ""} dE norm: after removing ${ev >= 0 ? "+" : ""}${ev.toFixed(2)} EV and the white balance.`,
  ];
  return framed(grid, [title, headline(frame ?? an.frame)].filter(Boolean).join(" | "), footer);
}

/**
 * Pictures side by side at one height (or stacked at one width), each under its label. With a box (0..1 of each
 * frame) only that part of each is shown; zoom enlarges it with nearest-neighbour, so pixels stay square.
 */
export function rowSheet(files, { labels = null, box = null, zoom = 1, maxWidth = MAX_WIDTH, header = "", load = loadPicture } = {}) {
  if (labels && labels.length !== files.length) throw new PlError(`${files.length} pictures but ${labels.length} labels`);
  let images = files.map((f) => load(f));
  if (box) images = images.map((im) => cropBox(im, box));
  const names = labels ?? files.map((f) => path.basename(f).replace(/\.[^.]+$/, ""));
  const h = Math.min(...images.map((im) => im.height)) * zoom;
  const want = images.reduce((s, im) => s + (im.width * h) / im.height, 0);
  const fitK = Math.min(1, (room(maxWidth) - GAP * (images.length - 1)) / want);
  const tiles = images.map((im, i) => labelled(scaled(im, (h * fitK) / im.height), names[i]));
  const shown = (zoom * fitK);
  const note = [header, box ? `box ${box.join(",")}` : "", zoom !== 1 || box ? `zoom ${Number(shown.toPrecision(3))}x${fitK < 1 ? " (limited by the width)" : ""}` : ""];
  return framed(stack(tiles, true), note.filter(Boolean).join(" | "));
}

/** The width of one cell of a grid of `cols` columns that fits the sheet. */
export const cellWidth = (cols, maxWidth = MAX_WIDTH) => Math.floor((room(maxWidth) - GAP * (cols - 1)) / cols);

/**
 * Tiles in a grid, in reading order, each under its label: [{ img, label, colour }], where `img` may be a
 * function that loads the picture, so a long folder is read one picture at a time. A tile is shrunk to fit
 * its cell; with `grow`, a tile under half the cell is enlarged by a whole number with square pixels, so a
 * small frame is not lost on the sheet. Contact sheets, bursts, a clip's worst frames, and flow sheets are this grid.
 */
export function gridSheet(items, { cols = null, header = "", footer = [], maxWidth = MAX_WIDTH, grow = false } = {}) {
  const c = cols ?? Math.max(1, Math.min(items.length, Math.floor(room(maxWidth) / 320)));
  const cell = cellWidth(c, maxWidth);
  const tiles = items.map(({ img, label, colour = FG }) => {
    const im = typeof img === "function" ? img() : img;
    const fit = scaled(im, grow && im.width * 2 <= cell ? Math.floor(cell / im.width) : Math.min(1, cell / im.width));
    return label ? stack([bar(fit.width, label, colour), fit], false, { gap: 0 }) : fit;
  });
  const rows = [];
  for (let i = 0; i < tiles.length; i += c) rows.push(stack(tiles.slice(i, i + c), true));
  return framed(stack(rows, false), header, footer);
}

/** A grid of frames, every Nth, each labelled with its number (from the file name when it is one) and time. */
export function contactSheet(files, { every = 1, cols = null, fps = null, maxWidth = MAX_WIDTH } = {}) {
  const picked = files.map((f, i) => [i, f]).filter((_, i) => i % Math.max(1, every) === 0);
  const items = picked.map(([i, f]) => {
    const stem = path.basename(f).replace(/\.[^.]+$/, "");
    const label = (/^\d+$/.test(stem) ? `#${Number(stem)}` : `#${i} ${stem}`) + (fps ? `  ${(i / fps).toFixed(2)} s` : "");
    return { img: () => loadPicture(f), label };
  });
  const note = `${picked.length} of ${files.length} frames${every > 1 ? `, every ${every}` : ""}${fps ? `, ${fps} fps` : ""}`;
  return gridSheet(items, { cols, header: note, maxWidth });
}

/** The heat map of b against a after the exposure and white-balance fit, and the numbers it is drawn from. */
export function diffSheet(a, b, { maxWidth = MAX_WIDTH } = {}) {
  const { img: ref } = loadPass(a);
  const other = loadPass(b, { size: [ref.width, ref.height] }).img;
  const an = analyse(ref, other, { want: { ssim: false, edges: false, detail: false } });
  const heat = scaled(heatImage(an.maps.deltaENorm, ref.width, ref.height), Math.min(1, room(maxWidth) / ref.width));
  const ev = an.frame.exposureEV;
  const head = `dE2000 of ${path.basename(b)} against ${path.basename(a)}: mean ${an.frame.deltaENorm.toFixed(2)} after removing ${ev >= 0 ? "+" : ""}${ev.toFixed(2)} EV and white balance (before: ${an.frame.deltaE.toFixed(2)})`;
  return { sheet: framed(stack([heat, heatLegend(heat.width)], false, { gap: 0 }), head), frame: an.frame };
}

/** Pictures and folders of pictures, in order; a folder's pictures sorted by name. */
export function expandFrames(paths) {
  const out = [];
  for (const p of paths) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      out.push(...fs.readdirSync(p).filter((f) => IMAGE_SUFFIXES.has(path.extname(f).toLowerCase())).sort().map((f) => path.join(p, f)));
    } else out.push(p);
  }
  return out;
}

/** Write a sheet as PNG, or as JPEG (the extension becomes .jpg). Returns the path written. */
export function saveSheet(img, file, { jpeg = false, quality = 90 } = {}) {
  const out = jpeg ? file.replace(/\.[^./\\]*$/, "") + ".jpg" : file;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, jpeg ? encodeJpeg(img, { quality }) : encodePng(img));
  return out;
}
