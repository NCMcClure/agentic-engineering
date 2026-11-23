// Separable filters on float32 planes, defined the way scipy.ndimage defines
// them so a number means the same thing as in the literature that uses it:
// Gaussian with radius int(truncate * sigma + 0.5), half-sample symmetric
// reflection at the border ("reflect": d c b a | a b c d | d c b a), each 1-D
// pass summed in float64 and stored as float32, axis 0 (rows) before axis 1.

/** The index a reflected border reads, for a line of length n. */
function reflect(i, n) {
  if (n === 1) return 0;
  const period = 2 * n;
  let k = i % period;
  if (k < 0) k += period;
  return k < n ? k : period - 1 - k;
}

export function gaussianWeights(sigma, truncate = 4.0) {
  const radius = Math.trunc(truncate * sigma + 0.5);
  const w = [];
  for (let x = -radius; x <= radius; x++) w.push(Math.exp((-0.5 / (sigma * sigma)) * x * x));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}

/**
 * Correlate every line of a plane along one axis with odd-length weights.
 * Symmetric and antisymmetric weights are summed as scipy sums them (the centre
 * tap, then mirrored pairs from the outside in), which keeps ties as they are.
 */
export function correlate1d(src, width, height, weights, axis, out = new Float32Array(src.length)) {
  const r = (weights.length - 1) >> 1;
  let sym = 1, anti = 1;
  for (let j = 1; j <= r; j++) {
    if (weights[r - j] !== weights[r + j]) sym = 0;
    if (weights[r - j] !== -weights[r + j]) anti = 0;
  }
  const len = axis === 0 ? height : width, lines = axis === 0 ? width : height;
  const step = axis === 0 ? width : 1, lineStep = axis === 0 ? 1 : width;
  const line = new Float64Array(len + 2 * r);
  const res = new Float64Array(len);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let i = -r; i < len + r; i++) line[i + r] = src[base + reflect(i, len) * step];
    for (let i = 0; i < len; i++) {
      const c = i + r;
      let acc = line[c] * weights[r];
      if (sym) for (let j = r; j >= 1; j--) acc += (line[c - j] + line[c + j]) * weights[r - j];
      else if (anti) for (let j = r; j >= 1; j--) acc += (line[c - j] - line[c + j]) * weights[r - j];
      else { acc = 0; for (let j = -r; j <= r; j++) acc += line[c + j] * weights[r + j]; }
      res[i] = acc;
    }
    for (let i = 0; i < len; i++) out[base + i * step] = res[i];
  }
  return out;
}

export function gaussianFilter(src, width, height, sigma, truncate = 4.0) {
  const w = gaussianWeights(sigma, truncate);
  const tmp = correlate1d(src, width, height, w, 0);
  return correlate1d(tmp, width, height, w, 1);
}

/** Sobel along `axis` (1 = x, 0 = y): the derivative along it, then [1, 2, 1] across. */
export function sobel(src, width, height, axis) {
  const d = correlate1d(src, width, height, [-1, 0, 1], axis);
  return correlate1d(d, width, height, [1, 2, 1], axis === 0 ? 1 : 0);
}

/** The discrete Laplacian: [1, -2, 1] along each axis, summed in float32. */
export function laplace(src, width, height) {
  const out = correlate1d(src, width, height, [1, -2, 1], 0);
  const tmp = correlate1d(src, width, height, [1, -2, 1], 1);
  for (let i = 0; i < out.length; i++) out[i] = out[i] + tmp[i];
  return out;
}

/** Binary dilation by a (2t+1) square: a separable max filter over a 0/1 Uint8Array. */
export function maxFilter(src, width, height, t) {
  if (t <= 0) return Uint8Array.from(src);
  const pass = (from, along) => {
    const out = new Uint8Array(from.length);
    const len = along === 0 ? height : width, lines = along === 0 ? width : height;
    const step = along === 0 ? width : 1, lineStep = along === 0 ? 1 : width;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStep;
      // a cell is set when a set cell lies within t of it: the nearest one behind, or the nearest ahead
      const ahead = new Int32Array(len);
      for (let i = len - 1, near = Infinity; i >= 0; i--) { if (from[base + i * step]) near = i; ahead[i] = Math.min(near, 2 ** 30); }
      for (let i = 0, behind = -Infinity; i < len; i++) {
        if (from[base + i * step]) behind = i;
        out[base + i * step] = i - behind <= t || ahead[i] - i <= t ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(src, 0), 1);
}
