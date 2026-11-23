// Dense optical flow between two frames: pyramidal Lucas-Kanade, in the
// coarse-to-fine form Bouguet describes. Each level is the one below blurred
// and taken at every second pixel (4 levels, 0.5 apart). At each level the
// structure tensor of the first frame's gradient is summed over a Gaussian
// window (sigma 2.5); then, 3 times, the second frame is warped back by the
// flow so far (bilinear) and the 2 x 2 system gives the correction. The flow
// found at one level, doubled, is where the next finer level starts.
//
// The tensor's smaller eigenvalue is the confidence: it is large only where
// the window holds gradient in two directions. In a flat area, or along a
// straight edge (the aperture problem), the flow cannot be measured, so such
// a pixel is unknown. It is never reported as still.
import { gaussianFilter, sobel } from "./filters.mjs";

export const FLOW = { levels: 4, sigma: 2.5, iterations: 3, minConfidence: 1e-5 };
const WINDOW_TRUNCATE = 3; // the window reaches 3 sigma, 8 pixels at sigma 2.5

/** The next level of a pyramid: a sigma 1 blur, then every second pixel. */
function down(plane, w, h) {
  const b = gaussianFilter(plane, w, h, 1, 2);
  const ow = Math.ceil(w / 2), oh = Math.ceil(h / 2), out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) out[y * ow + x] = b[2 * y * w + 2 * x];
  return { plane: out, w: ow, h: oh };
}

/** The plane at a fractional position, bilinear, with the border repeated. */
export function bilinear(p, w, h, x, y) {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), fx = x - x0, fy = y - y0;
  return (p[y0 * w + x0] * (1 - fx) + p[y0 * w + x1] * fx) * (1 - fy) + (p[y1 * w + x0] * (1 - fx) + p[y1 * w + x1] * fx) * fy;
}

const times = (a, b) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * b[i]; return o; };

/** The smaller eigenvalue of [[a, b], [b, c]]. */
const minEigen = (a, b, c) => (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);

/** One level: the flow (u, v) refined in place from where it starts; returns the confidence map. */
function level(I, J, w, h, u, v, { sigma, iterations, minConfidence }) {
  const window = (p) => gaussianFilter(p, w, h, sigma, WINDOW_TRUNCATE);
  const gx = sobel(I, w, h, 1).map((g) => g / 8), gy = sobel(I, w, h, 0).map((g) => g / 8);
  const sxx = window(times(gx, gx)), sxy = window(times(gx, gy)), syy = window(times(gy, gy));
  const conf = new Float32Array(w * h);
  for (let i = 0; i < conf.length; i++) conf[i] = minEigen(sxx[i], sxy[i], syy[i]);
  const it = new Float32Array(w * h);
  for (let k = 0; k < iterations; k++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      it[i] = bilinear(J, w, h, x + u[i], y + v[i]) - I[i];
    }
    const bx = window(times(gx, it)), by = window(times(gy, it));
    for (let i = 0; i < conf.length; i++) {
      if (conf[i] < minConfidence) continue; // nothing to solve with: the flow stays what the coarser level said
      const det = sxx[i] * syy[i] - sxy[i] * sxy[i];
      u[i] -= (syy[i] * bx[i] - sxy[i] * by[i]) / det;
      v[i] -= (sxx[i] * by[i] - sxy[i] * bx[i]) / det;
    }
  }
  return conf;
}

/**
 * The flow from frame a to frame b (two luma planes of one size, 0..1): { u, v, confidence, width, height },
 * u and v in pixels of these planes, so a point at (x, y) in a is at (x + u, y + v) in b.
 */
export function denseFlow(a, b, width, height, opts = {}) {
  const o = { ...FLOW, ...opts };
  const pyr = [{ I: a, J: b, w: width, h: height }];
  while (pyr.length < o.levels) {
    const top = pyr.at(-1);
    if (Math.min(top.w, top.h) < 16) break; // a level under 8 pixels has nothing left to say
    const I = down(top.I, top.w, top.h), J = down(top.J, top.w, top.h);
    pyr.push({ I: I.plane, J: J.plane, w: I.w, h: I.h });
  }
  let u = new Float32Array(pyr.at(-1).w * pyr.at(-1).h), v = new Float32Array(u.length), conf = null;
  for (let l = pyr.length - 1; l >= 0; l--) {
    const { I, J, w, h } = pyr[l];
    if (l < pyr.length - 1) {
      // the coarser level's flow, doubled, at this level's pixels: pixel (x, y) here is (x / 2, y / 2) there
      const { w: cw, h: ch } = pyr[l + 1], nu = new Float32Array(w * h), nv = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        nu[y * w + x] = 2 * bilinear(u, cw, ch, x / 2, y / 2);
        nv[y * w + x] = 2 * bilinear(v, cw, ch, x / 2, y / 2);
      }
      u = nu; v = nv;
    }
    conf = level(I, J, w, h, u, v, o);
  }
  return { u, v, confidence: conf, width, height };
}
