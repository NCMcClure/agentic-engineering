// Pictures in memory: { width, height, channels: 3 (RGB8) | 1 (L8), data }.
// Read from PNG, or from anything else through ffmpeg; brought to a size with
// Lanczos for pictures, nearest for id and mask passes, and the area mean for
// the frames of a clip (what ffmpeg's area scaler does); written as PNG.
import fs from "node:fs";
import path from "node:path";
import { transcodeToPng } from "./ffmpeg.mjs";
import { decodePng, encodePng, isPng } from "./png.mjs";

/** RGB8 to L8 with the integer luma most image libraries use: (R*19595 + G*38470 + B*7471 + 0x8000) >> 16. */
export function toLuma({ width, height, data }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = (data[j] * 19595 + data[j + 1] * 38470 + data[j + 2] * 7471 + 0x8000) >> 16;
  return { width, height, channels: 1, data: out };
}

/** A picture from a file: PNG decoded here, anything else through ffmpeg. `alpha: true` keeps a PNG's alpha (see decodePng). */
export function readImage(file, { alpha = false } = {}) {
  const buf = fs.readFileSync(file);
  return decodePng(isPng(buf) ? buf : transcodeToPng(file), { alpha });
}

export function writePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(img));
}

function resizeNearest(img, w, h) {
  const { width, height, channels, data } = img;
  const out = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / w));
      for (let c = 0; c < channels; c++) out[(y * w + x) * channels + c] = data[(sy * width + sx) * channels + c];
    }
  }
  return { width: w, height: h, channels, data: out };
}

const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
const lanczos = (x) => (x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0);

// Per output index: the first input index and the normalised weights, with the support widened when shrinking.
function coefficients(inSize, outSize) {
  const scale = inSize / outSize, filterScale = Math.max(scale, 1), support = 3 * filterScale;
  return Array.from({ length: outSize }, (_, o) => {
    const centre = (o + 0.5) * scale;
    const lo = Math.max(0, Math.trunc(centre - support + 0.5)), hi = Math.min(inSize, Math.trunc(centre + support + 0.5));
    const w = [];
    for (let i = lo; i < hi; i++) w.push(lanczos((i - centre + 0.5) / filterScale));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    return [lo, w.map((v) => v / sum)];
  });
}

function resample(img, w, h, axis, weights = coefficients) {
  const { width, height, channels, data } = img;
  const ow = axis ? w : width, oh = axis ? height : h;
  const out = new Uint8Array(ow * oh * channels);
  const coeffs = weights(axis ? width : height, axis ? w : h);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const [lo, k] = coeffs[axis ? x : y];
    for (let c = 0; c < channels; c++) {
      let s = 0;
      for (let t = 0; t < k.length; t++) {
        const sx = axis ? lo + t : x, sy = axis ? y : lo + t;
        s += data[(sy * width + sx) * channels + c] * k[t];
      }
      out[(y * ow + x) * channels + c] = Math.min(255, Math.max(0, Math.round(s)));
    }
  }
  return { width: ow, height: oh, channels, data: out };
}

// Per output index: the first input index and the share of each input pixel its footprint covers.
function areaCoefficients(inSize, outSize) {
  const scale = inSize / outSize;
  return Array.from({ length: outSize }, (_, o) => {
    const a = o * scale, b = (o + 1) * scale, lo = Math.floor(a), hi = Math.min(inSize, Math.ceil(b));
    const w = [];
    for (let i = lo; i < hi; i++) w.push((Math.min(b, i + 1) - Math.max(a, i)) / scale);
    return [lo, w];
  });
}

/** The image at w x h: Lanczos (horizontal, then vertical), nearest for passes whose values are labels, or the area mean. */
export function resize(img, w, h, { nearest = false, area = false } = {}) {
  if (img.width === w && img.height === h) return img;
  if (nearest) return resizeNearest(img, w, h);
  if (area) return resample(resample(img, w, h, 1, areaCoefficients), w, h, 0, areaCoefficients);
  return resample(resample(img, w, h, 1), w, h, 0);
}

/**
 * A pass as RGB8 or L8, brought to `size` ([w, h]) when it has another, and its
 * native size: Lanczos for pictures, nearest for id and mask passes.
 */
export function loadPass(file, { size = null, mode = "RGB", nearest = false } = {}) {
  let img = readImage(file);
  const native = [img.width, img.height];
  if (size && (img.width !== size[0] || img.height !== size[1])) img = resize(img, size[0], size[1], { nearest });
  return { img: mode === "L" ? toLuma(img) : img, native };
}
