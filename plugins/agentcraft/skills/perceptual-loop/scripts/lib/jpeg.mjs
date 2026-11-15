// A baseline JPEG encoder (ITU T.81: sequential DCT, Huffman coding), for the
// review page and `sheet --jpeg`. It uses the example tables of the standard's
// Annex K, scaled to a quality from 1 to 100 the way libjpeg scales them,
// keeps every chroma sample (4:4:4, because colour is often the question), and
// frames the stream as JFIF. Nothing here decodes a JPEG.
import { PlError } from "./args.mjs";

// The natural (row-major) index of each coefficient in zigzag order.
const ZIGZAG = Uint8Array.of(
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63);

// Annex K.1, in natural order.
const LUMA_Q = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array(32).fill(99)];

// Annex K.3: the number of codes of each length 1 to 16, then the symbols in code order.
const COUNT = (n) => Array.from({ length: n }, (_, i) => i);
const DC_LUMA = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], COUNT(12)];
const DC_CHROMA = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], COUNT(12)];
const AC_LUMA = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa]];
const AC_CHROMA = [[0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa]];

/** The quantisation table for a quality: 50 is the table as printed, 100 all ones, lower values coarser. */
export function quantTable(base, quality) {
  const q = Math.min(100, Math.max(1, Math.round(quality)));
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - 2 * q;
  return base.map((b) => Math.min(255, Math.max(1, Math.floor((b * scale + 50) / 100))));
}

/** Code and length per symbol from a table's counts and symbols (T.81 Annex C). */
function huffman([counts, symbols]) {
  const code = new Uint16Array(256), size = new Uint8Array(256);
  let k = 0, c = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < counts[len - 1]; i++, k++, c++) { code[symbols[k]] = c; size[symbols[k]] = len; }
    c <<= 1;
  }
  return { code, size };
}

// The DCT basis with its normalisation folded in: F = C f C^T.
const BASIS = Float64Array.from({ length: 64 }, (_, i) => {
  const u = i >> 3, x = i & 7;
  return (u === 0 ? Math.sqrt(1 / 8) : 0.5) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
});

/** The entropy-coded segment, with a 0x00 stuffed after every 0xFF byte. */
class BitWriter {
  constructor(size) { this.buf = new Uint8Array(Math.max(1024, size)); this.len = 0; this.acc = 0; this.n = 0; }
  byte(b) {
    if (this.len + 2 > this.buf.length) { const grown = new Uint8Array(this.buf.length * 2); grown.set(this.buf); this.buf = grown; }
    this.buf[this.len++] = b;
    if (b === 0xff) this.buf[this.len++] = 0;
  }
  put(bits, count) {
    this.acc = (this.acc << count) | bits;
    this.n += count;
    while (this.n >= 8) { this.n -= 8; this.byte((this.acc >>> this.n) & 255); }
    this.acc &= (1 << this.n) - 1;
  }
  /** Pad the last byte with ones, as the standard asks. */
  flush() { if (this.n) this.put((1 << (8 - this.n)) - 1, 8 - this.n); return this.buf.subarray(0, this.len); }
}

const category = (v) => (v === 0 ? 0 : 32 - Math.clz32(Math.abs(v)));
const roundHalfAway = (x) => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5));

function encodeBlock(out, block, quant, prevDc, dc, ac, tmp, coef, zz) {
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let x = 0; x < 8; x++) s += BASIS[u * 8 + x] * block[y * 8 + x];
    tmp[y * 8 + u] = s;
  }
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let y = 0; y < 8; y++) s += BASIS[v * 8 + y] * tmp[y * 8 + u];
    coef[v * 8 + u] = s;
  }
  for (let k = 0; k < 64; k++) zz[k] = roundHalfAway(coef[ZIGZAG[k]] / quant[ZIGZAG[k]]);
  const diff = zz[0] - prevDc, dcCat = category(diff);
  out.put(dc.code[dcCat], dc.size[dcCat]);
  if (dcCat) out.put(diff < 0 ? diff + (1 << dcCat) - 1 : diff, dcCat);
  let run = 0;
  for (let k = 1; k < 64; k++) {
    const v = zz[k];
    if (v === 0) { run++; continue; }
    for (; run > 15; run -= 16) out.put(ac.code[0xf0], ac.size[0xf0]);
    const c = category(v), sym = (run << 4) | c;
    out.put(ac.code[sym], ac.size[sym]);
    out.put(v < 0 ? v + (1 << c) - 1 : v, c);
    run = 0;
  }
  if (run) out.put(ac.code[0], ac.size[0]);
  return zz[0];
}

const u16 = (v) => [(v >> 8) & 255, v & 255];
const segment = (marker, body) => [0xff, marker, ...u16(body.length + 2), ...body];

/** Encode { width, height, channels: 1 | 3, data } as a baseline JPEG at a quality from 1 to 100 (default 90). */
export function encodeJpeg({ width, height, channels, data }, { quality = 90 } = {}) {
  if (channels !== 1 && channels !== 3) throw new PlError(`cannot encode ${channels} channels as JPEG`);
  if (data.length !== width * height * channels) throw new PlError("pixel data does not match the size");
  if (!width || !height || width > 65535 || height > 65535) throw new PlError(`a ${width}x${height} picture does not fit in a JPEG`);
  const colour = channels === 3;
  const quants = colour ? [quantTable(LUMA_Q, quality), quantTable(CHROMA_Q, quality)] : [quantTable(LUMA_Q, quality)];
  const tables = colour ? [[0, 0, DC_LUMA], [1, 0, AC_LUMA], [0, 1, DC_CHROMA], [1, 1, AC_CHROMA]] : [[0, 0, DC_LUMA], [1, 0, AC_LUMA]];
  const comps = colour ? [[1, 0, 0], [2, 1, 1], [3, 1, 1]] : [[1, 0, 0]]; // id, quant table, Huffman table pair

  const head = [0xff, 0xd8];
  head.push(...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])); // JFIF 1.01, no density, no thumbnail
  head.push(...segment(0xdb, quants.flatMap((q, id) => [id, ...Array.from(ZIGZAG, (n) => q[n])])));
  head.push(...segment(0xc0, [8, ...u16(height), ...u16(width), comps.length, ...comps.flatMap(([id, tq]) => [id, 0x11, tq])]));
  head.push(...segment(0xc4, tables.flatMap(([cls, id, [counts, symbols]]) => [(cls << 4) | id, ...counts, ...symbols])));
  head.push(...segment(0xda, [comps.length, ...comps.flatMap(([id, , th]) => [id, (th << 4) | th]), 0, 63, 0]));

  const huff = comps.map(([, , th]) => [huffman(th ? DC_CHROMA : DC_LUMA), huffman(th ? AC_CHROMA : AC_LUMA)]);
  const out = new BitWriter((width * height * channels) >> 2);
  const blocks = comps.map(() => new Float64Array(64)), prev = comps.map(() => 0);
  const tmp = new Float64Array(64), coef = new Float64Array(64), zz = new Int32Array(64);
  for (let by = 0; by < height; by += 8) for (let bx = 0; bx < width; bx += 8) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      // past the edge, the last row and column repeat: no ringing from a black border
      const i = Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x), k = y * 8 + x;
      if (!colour) { blocks[0][k] = data[i] - 128; continue; }
      const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
      blocks[0][k] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      blocks[1][k] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      blocks[2][k] = 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    for (let c = 0; c < comps.length; c++) prev[c] = encodeBlock(out, blocks[c], quants[comps[c][1]], prev[c], huff[c][0], huff[c][1], tmp, coef, zz);
  }
  const body = out.flush();
  const file = Buffer.alloc(head.length + body.length + 2);
  file.set(head, 0);
  file.set(body, head.length);
  file.set([0xff, 0xd9], head.length + body.length);
  return file;
}
