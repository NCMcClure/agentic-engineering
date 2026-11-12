// perceptual-loop's PNG codec. The fixtures are built here with an encoder of
// their own (scanline packing, the five filters, Adam7, a bit-by-bit CRC), so
// a bug in the plugin's decoder cannot hide behind the same bug in its encoder.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import { decodePng, encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";

// ---- an independent encoder ------------------------------------------------

function crcSlow(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crcSlow(body), body.length + 4);
  return out;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

// One row of samples (already at the target depth) packed into bytes.
function packRow(samples, depth) {
  if (depth === 8) return Uint8Array.from(samples);
  if (depth === 16) return Uint8Array.from(samples.flatMap((s) => [s >> 8, s & 255]));
  const out = new Uint8Array(Math.ceil((samples.length * depth) / 8));
  samples.forEach((s, i) => { const bit = i * depth; out[bit >> 3] |= s << (8 - depth - (bit & 7)); });
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function filterRow(type, row, prev, bpp) {
  const out = new Uint8Array(row.length + 1);
  out[0] = type;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
    const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][type];
    out[i + 1] = (row[i] - pred) & 255;
  }
  return out;
}

// pixels[y][x] is an array of samples for one pixel. Filters cycle 0..4 by row.
function buildPng({ width, height, type, depth, pixels, palette, trns, interlace = false, filters = [0, 1, 2, 3, 4] }) {
  const ch = CHANNELS[type];
  const bpp = Math.max(1, (ch * depth) >> 3);
  const rows = [];
  let n = 0;
  const encodeImage = (xs, ys) => {
    let prev = null;
    for (const y of ys) {
      const row = packRow(xs.flatMap((x) => pixels[y][x]), depth);
      rows.push(filterRow(filters[n++ % filters.length], row, prev, bpp));
      prev = row;
    }
  };
  const range = (start, end, step) => { const r = []; for (let i = start; i < end; i += step) r.push(i); return r; };
  if (interlace) for (const [x0, y0, dx, dy] of ADAM7) {
    const xs = range(x0, width, dx), ys = range(y0, height, dy);
    if (xs.length && ys.length) encodeImage(xs, ys);
  }
  else encodeImage(range(0, width, 1), range(0, height, 1));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([depth, type, 0, 0, interlace ? 1 : 0], 8);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (palette) parts.push(chunk("PLTE", palette.flat()));
  if (trns) parts.push(chunk("tRNS", trns));
  const idat = zlib.deflateSync(Buffer.concat(rows.map((r) => Buffer.from(r))));
  // split IDAT in two, which a decoder must concatenate
  const cut = idat.length >> 1;
  parts.push(chunk("IDAT", idat.subarray(0, cut)), chunk("IDAT", idat.subarray(cut)), chunk("IEND", []));
  return Buffer.concat(parts);
}

// ---- fixtures and what they decode to ----------------------------------------

const W = 13, H = 11; // odd sizes, so every Adam7 pass is partial
const sample = (x, y, c, max) => ((x * 7 + y * 13 + c * 5) * 2654435761 >>> 0) % (max + 1);
const scale8 = (v, depth) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / ((1 << depth) - 1)));

function greyCase(depth, interlace) {
  const max = (1 << depth) - 1;
  const pixels = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => [sample(x, y, 0, max)]));
  const want = pixels.flatMap((row) => row.flatMap(([v]) => { const g = scale8(v, depth); return [g, g, g]; }));
  return { png: buildPng({ width: W, height: H, type: 0, depth, pixels, interlace }), want };
}

function colourCase(type, depth, interlace) {
  const ch = CHANNELS[type], max = (1 << depth) - 1;
  const pixels = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => Array.from({ length: ch }, (_, c) => sample(x, y, c, max))));
  const want = pixels.flatMap((row) => row.flatMap((p) => {
    const s = p.map((v) => scale8(v, depth));
    return type === 4 ? [s[0], s[0], s[0]] : s.slice(0, 3);
  }));
  return { png: buildPng({ width: W, height: H, type, depth, pixels, interlace }), want };
}

function paletteCase(depth, interlace) {
  const size = 1 << depth;
  const palette = Array.from({ length: size }, (_, i) => [(i * 37) & 255, (i * 91 + 7) & 255, (255 - i * 13) & 255]);
  const trns = Array.from({ length: Math.min(size, 3) }, (_, i) => i * 100);
  const pixels = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => [sample(x, y, 0, size - 1)]));
  const want = pixels.flatMap((row) => row.flatMap(([i]) => palette[i]));
  return { png: buildPng({ width: W, height: H, type: 3, depth, pixels, palette, trns, interlace }), want };
}

const cases = [];
for (const interlace of [false, true]) {
  for (const depth of [1, 2, 4, 8, 16]) cases.push([`grey ${depth}-bit`, () => greyCase(depth, interlace), interlace]);
  for (const depth of [1, 2, 4, 8]) cases.push([`palette ${depth}-bit with tRNS`, () => paletteCase(depth, interlace), interlace]);
  for (const [type, name] of [[2, "rgb"], [4, "grey+alpha"], [6, "rgba"]]) {
    for (const depth of [8, 16]) cases.push([`${name} ${depth}-bit`, () => colourCase(type, depth, interlace), interlace]);
  }
}

for (const [name, make, interlace] of cases) {
  test(`decodes ${name}${interlace ? ", Adam7" : ""} to RGB with alpha dropped`, () => {
    const { png, want } = make();
    const img = decodePng(png);
    assert.equal(img.width, W);
    assert.equal(img.height, H);
    assert.equal(img.channels, 3);
    assert.deepEqual([...img.data], want);
  });
}

test("every filter type decodes, alone and mixed", () => {
  for (const filters of [[0], [1], [2], [3], [4], [4, 3, 2, 1, 0]]) {
    const pixels = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => [sample(x, y, 0, 255), sample(x, y, 1, 255), sample(x, y, 2, 255)]));
    const img = decodePng(buildPng({ width: W, height: H, type: 2, depth: 8, pixels, filters }));
    assert.deepEqual([...img.data], pixels.flat(2), `filters ${filters}`);
  }
});

test("a 1x1 Adam7 image has six empty passes and still decodes", () => {
  const img = decodePng(buildPng({ width: 1, height: 1, type: 2, depth: 8, pixels: [[[10, 20, 30]]], interlace: true }));
  assert.deepEqual([...img.data], [10, 20, 30]);
});

test("the plugin's encoder round-trips RGB, grey, and RGBA", () => {
  const rgb = { width: 17, height: 9, channels: 3, data: Uint8Array.from({ length: 17 * 9 * 3 }, (_, i) => (i * 31) & 255) };
  assert.deepEqual([...decodePng(encodePng(rgb)).data], [...rgb.data]);
  const grey = { width: 5, height: 4, channels: 1, data: Uint8Array.from({ length: 20 }, (_, i) => i * 12) };
  assert.deepEqual([...decodePng(encodePng(grey)).data], [...grey.data].flatMap((g) => [g, g, g]));
  const rgba = { width: 3, height: 2, channels: 4, data: Uint8Array.from({ length: 24 }, (_, i) => i * 10) };
  const back = [...decodePng(encodePng(rgba)).data];
  assert.deepEqual(back, [...rgba.data].filter((_, i) => i % 4 !== 3));
});

test("the encoder's CRC matches an independent bit-by-bit CRC", () => {
  const png = encodePng({ width: 2, height: 2, channels: 3, data: new Uint8Array(12).fill(200) });
  let at = 8;
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    const body = png.subarray(at + 4, at + 8 + len);
    assert.equal(png.readUInt32BE(at + 8 + len), crcSlow(body), body.subarray(0, 4).toString("latin1"));
    at += 12 + len;
  }
});

test("malformed input is refused with a message, never a crash", () => {
  const good = encodePng({ width: 4, height: 4, channels: 3, data: new Uint8Array(48).fill(9) });
  const broken = {
    "not a PNG": Buffer.from("GIF89a, not a png at all"),
    "truncated": good.subarray(0, good.length - 20),
    "bad CRC": (() => { const b = Buffer.from(good); b[20] ^= 0xff; return b; })(),
    "empty": Buffer.alloc(0),
    "no IDAT": Buffer.concat([good.subarray(0, 33), chunk("IEND", [])]),
  };
  const ihdr = (w, h, depth, type) => { const d = Buffer.alloc(13); d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4); d.set([depth, type, 0, 0, 0], 8); return d; };
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  broken["bad depth"] = Buffer.concat([sig, chunk("IHDR", ihdr(1, 1, 3, 2)), chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2, 3]))), chunk("IEND", [])]);
  broken["zero width"] = Buffer.concat([sig, chunk("IHDR", ihdr(0, 1, 8, 2)), chunk("IDAT", zlib.deflateSync(Buffer.from([0]))), chunk("IEND", [])]);
  broken["palette without PLTE"] = Buffer.concat([sig, chunk("IHDR", ihdr(1, 1, 8, 3)), chunk("IDAT", zlib.deflateSync(Buffer.from([0, 0]))), chunk("IEND", [])]);
  broken["bad filter byte"] = Buffer.concat([sig, chunk("IHDR", ihdr(1, 1, 8, 2)), chunk("IDAT", zlib.deflateSync(Buffer.from([9, 1, 2, 3]))), chunk("IEND", [])]);
  broken["short image data"] = Buffer.concat([sig, chunk("IHDR", ihdr(4, 4, 8, 2)), chunk("IDAT", zlib.deflateSync(Buffer.from([0, 1, 2]))), chunk("IEND", [])]);
  broken["not zlib"] = Buffer.concat([sig, chunk("IHDR", ihdr(1, 1, 8, 2)), chunk("IDAT", [1, 2, 3, 4]), chunk("IEND", [])]);
  for (const [name, buf] of Object.entries(broken)) {
    assert.throws(() => decodePng(buf), (e) => e.name === "PlError" && /PNG/.test(e.message), name);
  }
});

test("alpha on request: the alpha channel, a palette's tRNS, and a colour key, at every depth that has one", () => {
  for (const interlace of [false, true]) {
    for (const [type, depth] of [[4, 8], [4, 16], [6, 8], [6, 16]]) {
      const { png } = colourCase(type, depth, interlace);
      const max = (1 << depth) - 1, ch = CHANNELS[type];
      const want = Array.from({ length: W * H }, (_, i) => scale8(sample(i % W, Math.floor(i / W), ch - 1, max), depth));
      const img = decodePng(png, { alpha: true });
      assert.deepEqual([...img.alpha], want, `type ${type}, ${depth}-bit${interlace ? ", Adam7" : ""}`);
      assert.deepEqual([...img.data], [...decodePng(png).data], "the colour is the same with or without alpha");
    }
    for (const depth of [1, 2, 4, 8]) {
      const { png } = paletteCase(depth, interlace);
      const size = 1 << depth, trns = Array.from({ length: Math.min(size, 3) }, (_, i) => i * 100);
      const want = Array.from({ length: W * H }, (_, i) => { const p = sample(i % W, Math.floor(i / W), 0, size - 1); return p < trns.length ? trns[p] : 255; });
      assert.deepEqual([...decodePng(png, { alpha: true }).alpha], want, `palette ${depth}-bit`);
    }
  }
  const pixels = [[[10, 20, 30], [1, 2, 3]], [[10, 20, 30], [10, 20, 31]]];
  const keyed = buildPng({ width: 2, height: 2, type: 2, depth: 8, pixels, trns: [0, 10, 0, 20, 0, 30] });
  assert.deepEqual([...decodePng(keyed, { alpha: true }).alpha], [0, 255, 0, 255]);
  const grey16 = buildPng({ width: 2, height: 1, type: 0, depth: 16, pixels: [[[0x1234], [0x1235]]], trns: [0x12, 0x34] });
  assert.deepEqual([...decodePng(grey16, { alpha: true }).alpha], [0, 255], "a 16-bit key is compared whole, not by its high byte");
  assert.equal(decodePng(encodePng({ width: 1, height: 1, channels: 3, data: Uint8Array.of(1, 2, 3) }), { alpha: true }).alpha, null, "no alpha in the file: null");
  assert.equal("alpha" in decodePng(keyed), false, "without the option nothing changes");
});
