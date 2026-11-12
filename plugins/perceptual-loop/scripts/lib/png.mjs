// PNG decode and encode, stdlib only (zlib for the deflate stream).
//
// Decode reads every colour type (grey, RGB, palette, grey+alpha, RGBA) at every
// depth the format allows, palettes with tRNS, all five row filters, and Adam7
// interlacing. The result is always 8-bit RGB: alpha is dropped (not composited)
// unless the caller asks for it, a 16-bit sample keeps its high byte, and a grey
// sample under 8 bits is scaled to 0..255. Encode writes 8-bit grey, RGB, or RGBA
// with an adaptive filter per row.
import zlib from "node:zlib";
import { PlError } from "./args.mjs";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const MAX_PIXELS = 1 << 28;

// The CRC table by hand: zlib.crc32 arrived in Node 22.2, and the plugin runs on any 22.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const bad = (why) => new PlError(`not a readable PNG: ${why}`);

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Undo the row filters of one (sub)image in place; returns the raw scanlines without filter bytes.
function unfilter(src, at, rowBytes, rows, bpp) {
  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const type = src[at++];
    const row = y * rowBytes, prev = row - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = src[at++];
      const a = i >= bpp ? out[row + i - bpp] : 0;
      const b = y ? out[prev + i] : 0;
      let v;
      if (type === 0) v = x;
      else if (type === 1) v = x + a;
      else if (type === 2) v = x + b;
      else if (type === 3) v = x + ((a + b) >> 1);
      else if (type === 4) v = x + paeth(a, b, i >= bpp && y ? out[prev + i - bpp] : 0);
      else throw bad(`row filter ${type} is not one of the five`);
      out[row + i] = v & 255;
    }
  }
  return { rows: out, next: at };
}

/**
 * Decode a PNG buffer to { width, height, channels: 3, data: Uint8Array RGB }. Throws PlError.
 * With `alpha: true` it also returns `alpha`, one byte per pixel from the alpha channel or tRNS,
 * or null when the file has neither.
 */
export function decodePng(buf, { alpha: wantAlpha = false } = {}) {
  if (!buf || buf.length < 8 || !SIGNATURE.equals(buf.subarray(0, 8))) throw bad("the signature is missing");
  let at = 8, header = null, palette = null, trns = null, ended = false;
  const idat = [];
  while (at + 12 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (at + 12 + len > buf.length) throw bad(`chunk ${type} runs past the end of the file`);
    if (crc32(buf, at + 4, at + 8 + len) !== buf.readUInt32BE(at + 8 + len)) throw bad(`chunk ${type} fails its CRC`);
    const data = buf.subarray(at + 8, at + 8 + len);
    at += 12 + len;
    if (!header && type !== "IHDR") throw bad("the first chunk is not IHDR");
    if (type === "IHDR") {
      if (len !== 13) throw bad("IHDR has the wrong length");
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
      if (data[10] !== 0 || data[11] !== 0) throw bad("unknown compression or filter method");
    } else if (type === "PLTE") {
      if (len % 3 || len === 0 || len > 768) throw bad("PLTE has the wrong length");
      palette = data;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "tRNS") trns = data;
    else if (type === "IEND") { ended = true; break; }
    // every other ancillary chunk is read past
  }
  if (!header) throw bad("there is no IHDR");
  if (!ended) throw bad("the file is truncated (no IEND)");
  const { width, height, depth, colour, interlace } = header;
  if (!DEPTHS[colour]) throw bad(`colour type ${colour} does not exist`);
  if (!DEPTHS[colour].includes(depth)) throw bad(`bit depth ${depth} is not allowed for colour type ${colour}`);
  if (!width || !height || width * height > MAX_PIXELS) throw bad(`a ${width}x${height} image is not decodable`);
  if (interlace > 1) throw bad(`interlace method ${interlace} does not exist`);
  if (colour === 3 && !palette) throw bad("a palette image has no PLTE");
  if (!idat.length) throw bad("there is no IDAT");

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { throw bad(`the image data does not inflate (${e.code ?? e.message})`); }

  const ch = CHANNELS[colour];
  const bitsPerPixel = ch * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 3);
  const hasAlpha = wantAlpha && (colour === 4 || colour === 6 || Boolean(trns));
  const alpha = hasAlpha ? new Uint8Array(width * height) : null;
  const grey = depth < 8 && colour === 0 ? 255 / ((1 << depth) - 1) : 1;
  const mask = (1 << depth) - 1;

  // one sample of a raw scanline: sample index s (pixel * channels + channel)
  const sampleAt = (rows, rowStart, s) => {
    if (depth === 8) return rows[rowStart + s];
    if (depth === 16) return rows[rowStart + 2 * s];
    const bit = s * depth;
    return (rows[rowStart + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask;
  };
  // a tRNS key is compared at the file's own depth, so a 16-bit sample is read whole here
  const fullAt = (rows, rowStart, s) => (depth === 16 ? (rows[rowStart + 2 * s] << 8) | rows[rowStart + 2 * s + 1] : sampleAt(rows, rowStart, s));
  const keyAt = (k) => (trns.length >= 2 * k + 2 ? trns.readUInt16BE(2 * k) : -1);
  const opacity = (rows, rowStart, s) => {
    if (colour === 4) return sampleAt(rows, rowStart, s + 1);
    if (colour === 6) return sampleAt(rows, rowStart, s + 3);
    if (colour === 3) { const i = sampleAt(rows, rowStart, s); return i < trns.length ? trns[i] : 255; }
    if (colour === 0) return fullAt(rows, rowStart, s) === keyAt(0) ? 0 : 255;
    return [0, 1, 2].every((c) => fullAt(rows, rowStart, s + c) === keyAt(c)) ? 0 : 255;
  };
  const put = (rows, rowStart, xi, dst) => {
    const s = xi * ch;
    if (alpha) alpha[dst / 3] = opacity(rows, rowStart, s);
    if (colour === 3) {
      const i = sampleAt(rows, rowStart, s);
      if (3 * i + 2 >= palette.length) throw bad(`palette index ${i} is past the palette's end`);
      out[dst] = palette[3 * i]; out[dst + 1] = palette[3 * i + 1]; out[dst + 2] = palette[3 * i + 2];
    } else if (ch <= 2) {
      const g = Math.round(sampleAt(rows, rowStart, s) * grey);
      out[dst] = out[dst + 1] = out[dst + 2] = g;
    } else {
      out[dst] = sampleAt(rows, rowStart, s);
      out[dst + 1] = sampleAt(rows, rowStart, s + 1);
      out[dst + 2] = sampleAt(rows, rowStart, s + 2);
    }
  };

  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]];
  let pos = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const rowBytes = Math.ceil((pw * bitsPerPixel) / 8);
    if (pos + (rowBytes + 1) * ph > raw.length) throw bad("the image data is shorter than the header says");
    const { rows, next } = unfilter(raw, pos, rowBytes, ph, bpp);
    pos = next;
    for (let y = 0; y < ph; y++) {
      const dstRow = (y0 + y * dy) * width;
      for (let x = 0; x < pw; x++) put(rows, y * rowBytes, x, (dstRow + x0 + x * dx) * 3);
    }
  }
  return wantAlpha ? { width, height, channels: 3, data: out, alpha } : { width, height, channels: 3, data: out };
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

/** Encode { width, height, channels: 1|3|4, data } as an 8-bit PNG buffer. */
export function encodePng({ width, height, channels, data }) {
  const colour = { 1: 0, 3: 2, 4: 6 }[channels];
  if (colour === undefined) throw new PlError(`cannot encode ${channels} channels as PNG`);
  if (data.length !== width * height * channels) throw new PlError("pixel data does not match the size");
  const rowBytes = width * channels;
  const raw = new Uint8Array((rowBytes + 1) * height);
  const trial = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes, prev = row - rowBytes, dst = y * (rowBytes + 1);
    let best = Infinity;
    // the usual heuristic: the filter whose output has the smallest sum of signed magnitudes
    for (let type = 0; type < 5; type++) {
      let cost = 0;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= channels ? data[row + i - channels] : 0;
        const b = y ? data[prev + i] : 0;
        const c = y && i >= channels ? data[prev + i - channels] : 0;
        const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (data[row + i] - pred) & 255;
        trial[i] = v;
        cost += v < 128 ? v : 256 - v;
      }
      if (cost < best) { best = cost; raw[dst] = type; raw.set(trial, dst + 1); }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, colour, 0, 0, 0], 8);
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

export const isPng = (buf) => buf.length >= 8 && SIGNATURE.equals(buf.subarray(0, 8));
