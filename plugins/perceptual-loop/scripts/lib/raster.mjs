// Drawing on RGB8 pictures, for sheets: a blank canvas, rectangles, pasting,
// crops by a box in 0..1 of the frame, scaling (smooth to shrink, nearest to
// enlarge, so a zoomed crop shows the pixels that are there), stacking with a
// gap, and laying a picture with alpha over flat grey.
import { maxFilter } from "./filters.mjs";
import { resize } from "./image.mjs";

export const BG = [22, 22, 24];
export const FG = [236, 236, 236];
export const DIM = [150, 150, 155];
export const GAP = 6;

/** A width x height RGB8 picture filled with one colour. */
export function canvas(width, height, colour = BG) {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 3) { data[i] = colour[0]; data[i + 1] = colour[1]; data[i + 2] = colour[2]; }
  return { width, height, channels: 3, data };
}

/** Fill a rectangle in place, clipped to the picture. */
export function fillRect(img, x, y, w, h, colour) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(img.width, x + w), y1 = Math.min(img.height, y + h);
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = (yy * img.width + xx) * 3;
    img.data[i] = colour[0]; img.data[i + 1] = colour[1]; img.data[i + 2] = colour[2];
  }
}

/** Copy src into dst with its top-left corner at (x, y), clipped. */
export function paste(dst, src, x, y) {
  const s = toRgb(src);
  for (let yy = Math.max(0, -y); yy < s.height && y + yy < dst.height; yy++) {
    const from = yy * s.width, to = (y + yy) * dst.width;
    const x0 = Math.max(0, -x), x1 = Math.min(s.width, dst.width - x);
    if (x1 > x0) dst.data.set(s.data.subarray((from + x0) * 3, (from + x1) * 3), (to + x + x0) * 3);
  }
}

/** L8 as RGB8; RGB8 as it is. */
export function toRgb(img) {
  if (img.channels === 3) return img;
  const data = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = img.data[i];
  return { width: img.width, height: img.height, channels: 3, data };
}

/** A box in 0..1 of the frame to whole pixels, at least one pixel each way, so pictures of any size show the same part. */
export function boxPixels(img, [x0, y0, x1, y1]) {
  const px = Math.round(x0 * img.width), py = Math.round(y0 * img.height);
  return [px, py, Math.min(img.width, Math.max(px + 1, Math.round(x1 * img.width))), Math.min(img.height, Math.max(py + 1, Math.round(y1 * img.height)))];
}

/** The pixels x0 <= x < x1, y0 <= y < y1. */
export function crop(img, x0, y0, x1, y1) {
  const s = toRgb(img), w = x1 - x0, h = y1 - y0;
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) data.set(s.data.subarray(((y0 + y) * s.width + x0) * 3, ((y0 + y) * s.width + x1) * 3), y * w * 3);
  return { width: w, height: h, channels: 3, data };
}

export const cropBox = (img, box) => crop(img, ...boxPixels(img, box));

/** The picture scaled by k: Lanczos when it shrinks, nearest when it grows. */
export function scaled(img, k) {
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  if (w === img.width && h === img.height) return img;
  return resize(img, w, h, { nearest: k > 1 });
}

/** Tiles side by side (top-aligned) or stacked (left-aligned), GAP apart, on the background. */
export function stack(tiles, horizontal, { gap = GAP, bg = BG } = {}) {
  const w = horizontal ? tiles.reduce((s, t) => s + t.width, 0) + gap * (tiles.length - 1) : Math.max(...tiles.map((t) => t.width));
  const h = horizontal ? Math.max(...tiles.map((t) => t.height)) : tiles.reduce((s, t) => s + t.height, 0) + gap * (tiles.length - 1);
  const out = canvas(w, h, bg);
  let at = 0;
  for (const t of tiles) {
    paste(out, t, horizontal ? at : 0, horizontal ? 0 : at);
    at += (horizontal ? t.width : t.height) + gap;
  }
  return out;
}

/** A border of n pixels of the background around the picture. */
export function pad(img, n = GAP, bg = BG) {
  const out = canvas(img.width + 2 * n, img.height + 2 * n, bg);
  paste(out, img, n, n);
  return out;
}

/** RGB with its alpha laid over a flat grey (128 by default), where both light and dark pictures read. */
export function composite(img, alpha, grey = 128) {
  if (!alpha) return img;
  const data = new Uint8Array(img.data.length);
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.round((img.data[i * 3 + c] * a + grey * (255 - a)) / 255);
  }
  return { width: img.width, height: img.height, channels: 3, data };
}

/** A 0/1 mask with each set pixel grown to a square of `size` pixels, so a thin line survives shrinking. */
export function thicken(mask, width, height, size) {
  return size > 1 ? maxFilter(mask, width, height, Math.floor(size / 2)) : mask;
}
