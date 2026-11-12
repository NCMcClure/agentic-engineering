// perceptual-loop's pictures for eyes: the bitmap font draws the glyphs it was
// given, the raster helpers crop and scale exactly, every sheet fits its width
// and decodes, the heat scale is fixed, and the JPEG encoder writes a baseline
// file that another decoder (ffmpeg, when present) reads back close to the input.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { scene, tempDir, u8 } from "./perceptual-loop-fixtures.mjs";

import * as font from "../../../plugins/perceptual-loop/scripts/lib/font.mjs";
import * as raster from "../../../plugins/perceptual-loop/scripts/lib/raster.mjs";
import * as sheets from "../../../plugins/perceptual-loop/scripts/lib/sheets.mjs";
import { encodeJpeg, quantTable } from "../../../plugins/perceptual-loop/scripts/lib/jpeg.mjs";
import { decodePng, encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

const bits = (rows) => rows.map((r) => parseInt(r, 2));
const writePng = (dir, name, img) => { const f = path.join(dir, name); fs.writeFileSync(f, encodePng(img)); return f; };

// ---- the font ------------------------------------------------------------------------------

test("the font has a 5-column glyph for every printable ASCII character, seven rows or eight with a descender", () => {
  for (let c = 32; c < 127; c++) {
    const ch = String.fromCharCode(c), rows = font.glyphRows(ch);
    assert.ok(rows, `no glyph for ${JSON.stringify(ch)}`);
    assert.equal(rows.length, "gjpqy".includes(ch) ? 8 : 7, ch);
    assert.ok(rows.every((r) => r < 32), `${ch} is wider than five columns`);
  }
  assert.equal(font.glyphRows(" ").every((r) => r === 0), true);
  assert.equal(font.glyphRows("é"), undefined, "the font itself is ASCII; text is transliterated first");
});

test("known glyphs have their hand-drawn bitmaps", () => {
  assert.deepEqual([...font.glyphRows("A")], bits(["01110", "10001", "10001", "10001", "11111", "10001", "10001"]));
  assert.deepEqual([...font.glyphRows("0")], bits(["01110", "10001", "10011", "10101", "11001", "10001", "01110"]));
  assert.deepEqual([...font.glyphRows("|")], bits(["00100", "00100", "00100", "00100", "00100", "00100", "00100"]));
  assert.deepEqual([...font.glyphRows("g")], bits(["00000", "00000", "01111", "10001", "10001", "01111", "00001", "01110"]));
  // the distinctions a sheet's numbers and names depend on
  for (const [a, b] of [["0", "O"], ["1", "l"], ["1", "I"], ["5", "S"], ["8", "B"], ["9", "g"], ["9", "q"], ["U", "V"], ["p", "P"], ["-", "_"]]) {
    assert.notDeepEqual([...font.glyphRows(a)], [...font.glyphRows(b)], `${a} and ${b}`);
  }
});

test("drawText lays the bitmap down at a whole-number scale, and nothing else", () => {
  for (const scale of [1, 2, 3]) {
    const img = raster.canvas(20, 30, [0, 0, 0]);
    const end = font.drawText(img, 1, 2, "A", [255, 255, 255], scale);
    assert.equal(end, 1 + font.CELL_W * scale);
    const rows = font.glyphRows("A");
    for (let y = 0; y < 30; y++) for (let x = 0; x < 20; x++) {
      const gx = Math.floor((x - 1) / scale), gy = Math.floor((y - 2) / scale);
      const ink = x >= 1 && y >= 2 && gx < 5 && gy < 7 && Boolean(rows[gy] & (16 >> gx));
      assert.equal(img.data[(y * 20 + x) * 3], ink ? 255 : 0, `scale ${scale} at ${x},${y}`);
    }
  }
});

test("text outside ASCII is transliterated, never drawn as a box", () => {
  assert.equal(font.ascii("ΔE → 3·4 × 2 − 1 … ≤ ± °"), "dE -> 3|4 x 2 - 1 ... <= +/- deg");
  assert.equal(font.ascii("café naïve Ångström façade"), "cafe naive Angstrom facade");
  assert.equal(font.ascii("Straße æ ø"), "Strasse ae o");
  assert.equal(font.ascii("日本 \u2014 ok"), "?? - ok");
  assert.equal(font.textWidth("ΔE", 2), 2 * 12);
  assert.equal(font.fitText("a long label that will not fit", 12 * 10, 2), "a long ...");
  assert.deepEqual(font.wrapText("one two three four", 12 * 9, 2), ["one two", "three", "four"]);
  assert.deepEqual(font.wrapText("abcdefghij", 12 * 4, 2), ["abcd", "efgh", "ij"]);
});

// ---- raster ------------------------------------------------------------------------------

test("crops by a box in 0..1, scales up with square pixels, and lays alpha on grey 128", () => {
  const img = { width: 10, height: 4, channels: 3, data: Uint8Array.from({ length: 120 }, (_, i) => i) };
  assert.deepEqual(raster.boxPixels(img, [0.2, 0.25, 0.5, 1]), [2, 1, 5, 4]);
  assert.deepEqual(raster.boxPixels(img, [0.5, 0.5, 0.5001, 0.5001]), [5, 2, 6, 3], "at least one pixel");
  const c = raster.cropBox(img, [0.2, 0.25, 0.5, 1]);
  assert.equal(c.width, 3);
  assert.deepEqual([...c.data.subarray(0, 3)], [...img.data.subarray((1 * 10 + 2) * 3, (1 * 10 + 2) * 3 + 3)]);
  const z = raster.scaled(c, 3);
  assert.deepEqual([z.width, z.height], [9, 9]);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const s = (Math.floor(y / 3) * 3 + Math.floor(x / 3)) * 3, d = (y * 9 + x) * 3;
    assert.deepEqual([...z.data.subarray(d, d + 3)], [...c.data.subarray(s, s + 3)]);
  }
  const flat = raster.composite({ width: 3, height: 1, channels: 3, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 0, 0) }, Uint8Array.of(0, 128, 255));
  assert.deepEqual([...flat.data], [128, 128, 128, 192, 64, 64, 255, 0, 0]);
  const st = raster.stack([raster.canvas(4, 2, [1, 1, 1]), raster.canvas(3, 5, [2, 2, 2])], true);
  assert.deepEqual([st.width, st.height], [4 + raster.GAP + 3, 5]);
});

// ---- sheets ------------------------------------------------------------------------------

test("the heat map's scale is fixed: black at 0, the top colour from 20 up", () => {
  assert.deepEqual(sheets.heatColour(0), [0, 0, 0]);
  assert.deepEqual(sheets.heatColour(sheets.DE_MAX), sheets.heatColour(500));
  assert.deepEqual(sheets.heatColour(sheets.DE_MAX), [255, 250, 190]);
  const ramp = [0, 2, 5, 10, 20].map((v) => sheets.heatColour(v).reduce((a, b) => a + b, 0));
  assert.deepEqual([...ramp].sort((a, b) => a - b), ramp, "brighter as the difference grows");
  assert.equal(sheets.heatLegend(300).width, 300);
});

test("a shot sheet fits its width, decodes, and is drawn with and without a before picture", () => {
  const dir = tempDir("pl-sheet-");
  const ref = writePng(dir, "ref.png", u8(scene(320, 240)));
  const before = writePng(dir, "before.png", u8(scene(320, 240), (c, v) => v * 1.1));
  const after = writePng(dir, "after.png", u8(scene(320, 240), (c, v) => v * 2 ** 0.5));
  for (const [maxWidth, withBefore] of [[sheets.MAX_WIDTH, true], [600, true], [600, false]]) {
    const sheet = sheets.shotSheet({ reference: ref, before: withBefore ? before : null, after, title: "sky_0 | candidate vs reference", maxWidth });
    assert.ok(sheet.width <= maxWidth, `${sheet.width} > ${maxWidth}`);
    const file = sheets.saveSheet(sheet, path.join(dir, `shot-${maxWidth}-${withBefore}.png`));
    const back = decodePng(fs.readFileSync(file));
    assert.deepEqual([back.width, back.height], [sheet.width, sheet.height]);
    assert.deepEqual(back.data, sheet.data);
  }
  const jpg = sheets.saveSheet(sheets.shotSheet({ reference: ref, after }), path.join(dir, "shot.png"), { jpeg: true });
  assert.equal(path.extname(jpg), ".jpg");
  assert.deepEqual([...fs.readFileSync(jpg).subarray(0, 2)], [0xff, 0xd8]);
});

test("a triptych zooms a box of each picture by whole pixels, under its label", () => {
  const dir = tempDir("pl-trip-");
  const files = [0, 1, 2].map((k) => writePng(dir, `p${k}.png`, u8(scene(300, 150), (c, v) => v * (1 + k / 10))));
  const box = [0.1, 0.2, 0.3, 0.6], zoom = 3;
  const sheet = sheets.rowSheet(files, { box, zoom });
  const tileW = 60 * zoom, tileH = 60 * zoom, lineH = font.CELL_H * 2 + 6; // wide enough that the header is one line
  assert.equal(sheet.width, 3 * tileW + 2 * raster.GAP + 2 * raster.GAP);
  assert.equal(sheet.height, raster.GAP + lineH + raster.GAP + lineH + tileH + raster.GAP);
  // the first tile's first 3x3 block is the box's first source pixel
  const src = decodePng(fs.readFileSync(files[0]));
  const s = (Math.round(0.2 * 150) * 300 + Math.round(0.1 * 300)) * 3;
  const top = raster.GAP + lineH + raster.GAP + lineH;
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const d = ((top + y) * sheet.width + raster.GAP + x) * 3;
    assert.deepEqual([...sheet.data.subarray(d, d + 3)], [...src.data.subarray(s, s + 3)]);
  }
  const wide = sheets.rowSheet(files, { zoom: 8, maxWidth: 400 });
  assert.ok(wide.width <= 400, "a zoom that would not fit is limited by the width");
  assert.throws(() => sheets.rowSheet(files, { labels: ["A"] }), /3 pictures but 1 labels/);
});

test("a contact sheet takes every Nth frame in name order, and diff returns the numbers it drew", () => {
  const dir = tempDir("pl-contact-");
  fs.mkdirSync(path.join(dir, "frames"));
  for (let i = 0; i < 7; i++) writePng(path.join(dir, "frames"), `${String(i * 10).padStart(6, "0")}.png`, u8(scene(64, 48), (c, v) => v * (1 + i / 20)));
  fs.writeFileSync(path.join(dir, "frames", "notes.txt"), "not a picture");
  const frames = sheets.expandFrames([path.join(dir, "frames")]);
  assert.equal(frames.length, 7);
  const sheet = sheets.contactSheet(frames, { every: 3, cols: 2, fps: 24, maxWidth: 400 });
  assert.ok(sheet.width <= 400);
  decodePng(encodePng(sheet));
  const a = writePng(dir, "a.png", u8(scene(160, 120)));
  const b = writePng(dir, "b.png", u8(scene(160, 120), (c, v) => v * 2 ** 0.5));
  const { sheet: heat, frame } = sheets.diffSheet(a, b, { maxWidth: 400 });
  assert.ok(Math.abs(frame.exposureEV - 0.5) < 0.02, `EV ${frame.exposureEV}`);
  assert.ok(frame.deltaENorm < frame.deltaE, "normalising removes the exposure");
  assert.ok(heat.width <= 400);
});

// ---- JPEG ----------------------------------------------------------------------------------

/** The markers of a JPEG file, walking the segments up to the scan, then the last two bytes. */
function markers(buf) {
  const out = [];
  let at = 2;
  assert.deepEqual([buf[0], buf[1]], [0xff, 0xd8], "SOI");
  while (at < buf.length) {
    assert.equal(buf[at], 0xff, `a marker at ${at}`);
    const m = buf[at + 1], len = buf.readUInt16BE(at + 2);
    out.push({ m, at, body: buf.subarray(at + 4, at + 2 + len) });
    at += 2 + len;
    if (m === 0xda) break;
  }
  return { segments: out, scan: buf.subarray(at, buf.length - 2), end: [...buf.subarray(buf.length - 2)] };
}

test("JPEG output is baseline JFIF: SOI, APP0, DQT, SOF0 with the size and 4:4:4, DHT, SOS, and EOI", () => {
  const img = u8(scene(37, 21));
  const jpg = encodeJpeg(img, { quality: 90 });
  const { segments, scan, end } = markers(jpg);
  assert.deepEqual(segments.map((s) => s.m), [0xe0, 0xdb, 0xc0, 0xc4, 0xda]);
  assert.equal(segments[0].body.subarray(0, 5).toString("latin1"), "JFIF\0");
  const sof = segments[2].body;
  assert.deepEqual([sof[0], sof.readUInt16BE(1), sof.readUInt16BE(3), sof[5]], [8, 21, 37, 3]);
  assert.deepEqual([sof[7], sof[10], sof[13]], [0x11, 0x11, 0x11], "no chroma subsampling");
  assert.equal(segments[1].body.length, 2 * 65, "two quantisation tables");
  assert.deepEqual(end, [0xff, 0xd9], "EOI");
  for (let i = 0; i < scan.length; i++) if (scan[i] === 0xff) assert.equal(scan[i + 1], 0, "every 0xFF in the scan is stuffed");
  const grey = markers(encodeJpeg({ width: 9, height: 9, channels: 1, data: new Uint8Array(81).fill(77) }));
  assert.equal(grey.segments[2].body[5], 1, "grey is one component");
  assert.throws(() => encodeJpeg({ width: 2, height: 2, channels: 4, data: new Uint8Array(16) }), /4 channels/);
});

test("quality scales the standard tables: 50 is the table as printed, 100 is all ones, 1 is the coarsest", () => {
  const base = [16, 11, 10, 16, 24, 40, 51, 61];
  assert.deepEqual(quantTable(base, 50), base);
  assert.deepEqual(quantTable(base, 100), base.map(() => 1));
  assert.ok(quantTable(base, 1).every((v, i) => v >= base[i] && v <= 255));
  assert.ok(encodeJpeg(u8(scene(64, 48)), { quality: 30 }).length < encodeJpeg(u8(scene(64, 48)), { quality: 95 }).length);
});

test("JPEG output decodes in ffmpeg close to the input", { skip: !hasFfmpeg && "ffmpeg is not installed" }, () => {
  for (const [w, h, q, floor] of [[320, 240, 90, 36], [37, 21, 100, 40], [64, 48, 75, 30]]) {
    const img = u8(scene(w, h));
    const r = spawnSync("ffmpeg", ["-v", "error", "-i", "-", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { input: encodeJpeg(img, { quality: q }), maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(r.stdout.length, img.data.length);
    let se = 0;
    for (let i = 0; i < img.data.length; i++) se += (img.data[i] - r.stdout[i]) ** 2;
    const psnr = 10 * Math.log10(255 ** 2 / (se / img.data.length));
    assert.ok(psnr > floor, `${w}x${h} at quality ${q}: ${psnr.toFixed(1)} dB`);
  }
});
