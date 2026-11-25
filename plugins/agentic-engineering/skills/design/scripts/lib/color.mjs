// Colour: 8-bit sRGB to linear light through a 256-entry table, linear light
// to CIE L*a*b* (D65), and CIEDE2000. Planes are Float32Array, one per channel,
// and every stored value is rounded to float32, which is where the numbers the
// gate holds were defined.
const f = Math.fround;

/** sRGB level 0..255 to linear light: a file holds 256 levels, so the power function runs 256 times. */
export const SRGB_LUT = Float32Array.from({ length: 256 }, (_, i) => {
  const a = f(i / 255);
  return a <= f(0.04045) ? f(a / f(12.92)) : f(Math.pow(f(f(a + f(0.055)) / f(1.055)), f(2.4)));
});

/** An RGB8 image to three linear-light planes. */
export function linearPlanes({ width, height, data }) {
  const n = width * height;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    r[i] = SRGB_LUT[data[j]]; g[i] = SRGB_LUT[data[j + 1]]; b[i] = SRGB_LUT[data[j + 2]];
  }
  return [r, g, b];
}

const M = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
const WHITE = [0.95047, 1.0, 1.08883];
// the matrix with the white point divided out, per row, in float32
const K = M.map((row, i) => row.map((v) => f(f(v) / f(WHITE[i]))));
const EPS = f(216 / 24389), KAPPA = f(24389 / 27);
const lab = (t) => (t > EPS ? f(Math.cbrt(Math.max(t, 0))) : f(f(f(KAPPA * t) + 16) / 116));

/** Linear planes (each times its gain) to L*, a*, b* planes. */
export function labPlanes([r, g, b], gains = null) {
  const n = r.length;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  const [gr, gg, gb] = gains ?? [1, 1, 1];
  for (let i = 0; i < n; i++) {
    const R = gains ? f(r[i] * gr) : r[i], G = gains ? f(g[i] * gg) : g[i], Bl = gains ? f(b[i] * gb) : b[i];
    const fx = lab(f(R * K[0][0] + G * K[0][1] + Bl * K[0][2]));
    const fy = lab(f(R * K[1][0] + G * K[1][1] + Bl * K[1][2]));
    const fz = lab(f(R * K[2][0] + G * K[2][1] + Bl * K[2][2]));
    L[i] = f(f(116 * fy) - 16);
    A[i] = f(500 * f(fx - fy));
    B[i] = f(200 * f(fy - fz));
  }
  return [L, A, B];
}

const TAU = 2 * Math.PI, P7 = 25 ** 7, RAD = Math.PI / 180;
const pow7 = (x) => { const x2 = x * x; return x2 * x2 * x2 * x; };

/**
 * CIEDE2000 of one pair (Sharma, Wu, Dalal 2005), in radians. When either
 * chroma is zero the hue is undefined and takes no part: its difference is
 * zero and the mean hue is the plain sum, as the paper's note says.
 */
export function ciede2000(l1, a1, b1, l2, a2, b2) {
  const cb7 = pow7((Math.hypot(a1, b1) + Math.hypot(a2, b2)) * 0.5);
  const g = 1 + 0.5 * (1 - Math.sqrt(cb7 / (cb7 + P7)));
  const a1p = a1 * g, a2p = a2 * g;
  const c1 = Math.hypot(a1p, b1), c2 = Math.hypot(a2p, b2);
  let h1 = Math.atan2(b1, a1p), h2 = Math.atan2(b2, a2p);
  if (h1 < 0) h1 += TAU;
  if (h2 < 0) h2 += TAU;
  const grey = c1 * c2 === 0;
  let dh = h2 - h1;
  if (dh > Math.PI) dh -= TAU;
  else if (dh < -Math.PI) dh += TAU;
  if (grey) dh = 0;
  const hs = h1 + h2;
  const hb = grey ? hs : (Math.abs(h1 - h2) > Math.PI ? (hs < TAU ? hs + TAU : hs - TAU) : hs) * 0.5;
  const t = 1 - 0.17 * Math.cos(hb - 30 * RAD) + 0.24 * Math.cos(2 * hb)
    + 0.32 * Math.cos(3 * hb + 6 * RAD) - 0.2 * Math.cos(4 * hb - 63 * RAD);
  const cb = (c1 + c2) * 0.5;
  const lq = ((l1 + l2) * 0.5 - 50) ** 2;
  const sl = 1 + (0.015 * lq) / Math.sqrt(20 + lq);
  const sc = 1 + 0.045 * cb;
  const sh = 1 + 0.015 * cb * t;
  const cbp7 = pow7(cb);
  const rt = -Math.sin(60 * RAD * Math.exp(-(((hb / RAD - 275) / 25) ** 2))) * 2 * Math.sqrt(cbp7 / (cbp7 + P7));
  const dl = (l2 - l1) / sl, dc = (c2 - c1) / sc, dhh = (2 * Math.sqrt(c1 * c2) * Math.sin(dh * 0.5)) / sh;
  return Math.sqrt(Math.max(dl * dl + dc * dc + dhh * dhh + rt * dc * dhh, 0));
}

/** CIEDE2000 per pixel of two Lab plane triples, as a Float32Array. */
export function deltaEMap([L1, A1, B1], [L2, A2, B2]) {
  const out = new Float32Array(L1.length);
  for (let i = 0; i < out.length; i++) out[i] = ciede2000(L1[i], A1[i], B1[i], L2[i], A2[i], B2[i]);
  return out;
}
