// The numbers of the loop: how far a candidate picture is from the reference.
// They never say which one is right.
//
//   ssim, deltaE                    on the candidate as it is (what a person sees)
//   exposureEV, wb, contrast        the fit that brings the candidate to the reference's exposure and white balance
//   deltaENorm, edges, detailLog2   on the candidate after that fit, so they speak of colour, structure and
//                                   sharpness instead of repeating "it is brighter" three more times
import { deltaEMap, labPlanes, linearPlanes } from "./color.mjs";
import { gaussianFilter, laplace, maxFilter, sobel } from "./filters.mjs";

const f = Math.fround;
export const EDGE_THRESHOLD = 0.015; // gradient of L*/100 per pixel after a 1 px blur: a step of about 4 L* still counts
export const MIN_REGION_AREA = 0.002;

// ---- the rounding, percentile and median the numbers are defined with ----------

/** Python's round(): half to even. */
export function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r;
}

const sorted = (values) => Float64Array.from(values).sort();

/** numpy's percentile, linear method (q in 0..100), including its lerp from the far end past the midpoint. */
export function percentile(values, q, isSorted = false) {
  const a = isSorted ? values : sorted(values);
  const at = (a.length - 1) * (q / 100);
  const lo = Math.floor(at), hi = Math.min(lo + 1, a.length - 1), t = at - lo;
  const diff = a[hi] - a[lo];
  return t >= 0.5 ? a[hi] - diff * (1 - t) : a[lo] + diff * t;
}

/** numpy's median: the middle value, or the mean of the two middle values. */
export function median(values, round = (x) => x) {
  const a = sorted(values);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : round(round(a[m - 1] + a[m]) / 2);
}

const mean = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; };

function variance(arr) {
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += (arr[i] - m) ** 2;
  return s / arr.length;
}

// ---- normalisation -------------------------------------------------------------

const LUMA = [f(0.2126), f(0.7152), f(0.0722)];

/**
 * Per-channel gains (linear light) that bring the candidate to the reference.
 *
 * The median of log ratios over block means of the mid-tones. Block means, because
 * two renderers never agree to the pixel and a ratio across a misaligned edge means
 * nothing. A median, because a part that really differs (an object missing, a lamp
 * lit) must not be explained away as exposure. Mid-tones, because clipped and
 * near-black pixels have lost the ratio.
 */
export function fitExposure(ref, cand, width, height) {
  const block = Math.max(1, Math.min(pyRound(Math.max(height, width) / 256), height, width));
  const rows = Math.floor(height / block), cols = Math.floor(width / block);
  const cells = (planes) => planes.map((p) => {
    const out = new Float32Array(rows * cols);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let s = 0;
      for (let y = cy * block; y < (cy + 1) * block; y++) for (let x = cx * block; x < (cx + 1) * block; x++) s += p[y * width + x];
      out[cy * cols + cx] = s / (block * block);
    }
    return out;
  });
  const cr = cells(ref), cc = cells(cand), n = rows * cols;
  const lum = (c, i) => f(c[0][i] * LUMA[0] + c[1][i] * LUMA[1] + c[2][i] * LUMA[2]);
  const lr = Float32Array.from({ length: n }, (_, i) => lum(cr, i)), lc = Float32Array.from({ length: n }, (_, i) => lum(cc, i));
  const lo = f(0.01), hi = f(0.8), dark = f(0.002), bright = f(0.9);
  let mid = [];
  for (let i = 0; i < n; i++) {
    const rMin = Math.min(cr[0][i], cr[1][i], cr[2][i]), rMax = Math.max(cr[0][i], cr[1][i], cr[2][i]);
    const cMin = Math.min(cc[0][i], cc[1][i], cc[2][i]), cMax = Math.max(cc[0][i], cc[1][i], cc[2][i]);
    if (lr[i] > lo && lc[i] > lo && lr[i] < hi && lc[i] < hi && rMin > dark && cMin > dark && rMax < bright && cMax < bright) mid.push(i);
  }
  const rough = mid.length < 50;
  if (rough) mid = Array.from({ length: n }, (_, i) => i); // nearly black, white or pure colour: fit on everything
  const floor = f(1e-4);
  const logRatio = (a, b) => f(Math.log2(f(Math.max(a, floor) / Math.max(b, floor))));
  const ratio = [0, 1, 2].map((c) => {
    const r = f(2 ** median(mid.map((i) => logRatio(cc[c][i], cr[c][i])), f));
    return Math.min(16, Math.max(1 / 16, r));
  });
  const ev = median(mid.map((i) => logRatio(lc[i], lr[i])), f);
  // contrast: the candidate's tonal range next to the reference's, in stops, so exposure cancels out
  const spread = (l) => {
    const logs = sorted(Array.from(l, (v) => f(Math.log2(Math.max(v, floor)))));
    return f(percentile(logs, 95, true)) - f(percentile(logs, 5, true));
  };
  const spreadR = spread(lr), spreadC = spread(lc);
  return {
    gains: ratio.map((r) => f(1 / r)),
    exposureEV: ev,
    wb: ratio.map((r) => f(r / ratio[1])),
    contrast: spreadR > 1e-3 ? spreadC / spreadR : 1.0,
    rough,
  };
}

// ---- structure maps ------------------------------------------------------------------

/** SSIM per pixel on lightness in 0..1 (Wang et al. 2004: Gaussian window, sigma 1.5, truncate 3.5). */
export function ssimMap(x, y, width, height) {
  const g = (p) => gaussianFilter(p, width, height, 1.5, 3.5);
  const prod = (a, b) => Float32Array.from(a, (v, i) => v * b[i]);
  const mx = g(x), my = g(y), gxx = g(prod(x, x)), gyy = g(prod(y, y)), gxy = g(prod(x, y));
  const c1 = 0.01 ** 2, c2 = 0.03 ** 2;
  const out = new Float32Array(x.length);
  for (let i = 0; i < out.length; i++) {
    const ax = mx[i], ay = my[i];
    const sxx = f(gxx[i] - f(ax * ax)), syy = f(gyy[i] - f(ay * ay)), sxy = f(gxy[i] - f(ax * ay));
    out[i] = ((2 * ax * ay + c1) * (2 * sxy + c2)) / ((ax * ax + ay * ay + c1) * (sxx + syy + c2));
  }
  return out;
}

/** Thin edges of a lightness plane: Sobel/8 on a 1 px blur, kept where the gradient peaks along its dominant axis. */
export function edgeMap(light, width, height) {
  const s = gaussianFilter(light, width, height, 1.0, 4.0);
  const gx = sobel(s, width, height, 1), gy = sobel(s, width, height, 0);
  const mag = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) { gx[i] = gx[i] / 8; gy[i] = gy[i] / 8; mag[i] = Math.hypot(gx[i], gy[i]); }
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mag[y * width + x]); // zero-padded
  const out = new Uint8Array(s.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, m = mag[i];
    if (!(m > EDGE_THRESHOLD)) continue;
    const peak = Math.abs(gx[i]) >= Math.abs(gy[i])
      ? m >= at(x - 1, y) && m > at(x + 1, y)
      : m >= at(x, y - 1) && m > at(x, y + 1);
    if (peak) out[i] = 1;
  }
  return out;
}

/** Which edge pixels of each picture have an edge of the other within `tolerance` pixels. */
export function matchEdges(refEdge, candEdge, width, height, tolerance) {
  const nearCand = maxFilter(candEdge, width, height, tolerance), nearRef = maxFilter(refEdge, width, height, tolerance);
  return [refEdge.map((v, i) => v & nearCand[i]), candEdge.map((v, i) => v & nearRef[i])];
}

/** [F1, recall, precision]. No edges on either side is agreement (1); edges on one side only is 0. */
export function edgeScores(refHit, refTotal, candHit, candTotal) {
  if (!refTotal && !candTotal) return [1, 1, 1];
  const recall = refTotal ? refHit / refTotal : 1, precision = candTotal ? candHit / candTotal : 1;
  return [recall + precision ? (2 * recall * precision) / (recall + precision) : 0, recall, precision];
}

const count = (a, mask = null) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] && (!mask || mask[i])) n++; return n; };
const scaled = (p, k) => Float32Array.from(p, (v) => v / k);

/**
 * Frame metrics of a candidate against the reference, and the per-pixel maps
 * behind them (regions average the maps). Both images are RGB8 of one size.
 */
export function analyse(refImg, candImg, { edgeTolerance = 2, want = {} } = {}) {
  const w = { ssim: true, deltaE: true, edges: true, detail: true, ...want };
  const { width, height } = refImg;
  const refLin = linearPlanes(refImg), candLin = linearPlanes(candImg);
  const fit = fitExposure(refLin, candLin, width, height);
  const labR = labPlanes(refLin);
  const labN = labPlanes(candLin, fit.gains);
  const labC = w.ssim || w.deltaE ? labPlanes(candLin) : null;
  const lightR = scaled(labR[0], 100), lightN = scaled(labN[0], 100);
  const frame = {};
  const maps = { gains: fit.gains };
  if (w.ssim) {
    maps.ssim = ssimMap(lightR, scaled(labC[0], 100), width, height);
    frame.ssim = mean(maps.ssim);
  }
  if (w.deltaE) {
    frame.deltaE = mean(deltaEMap(labR, labC));
    maps.deltaENorm = deltaEMap(labR, labN);
    frame.deltaENorm = mean(maps.deltaENorm);
  }
  Object.assign(frame, { exposureEV: fit.exposureEV, wb: fit.wb, contrast: fit.contrast });
  if (w.edges) {
    const er = edgeMap(lightR, width, height), ec = edgeMap(lightN, width, height);
    const [hr, hc] = matchEdges(er, ec, width, height, edgeTolerance);
    Object.assign(maps, { refEdge: er, candEdge: ec, refHit: hr, candHit: hc });
    [frame.edgeF1, frame.edgeRecall, frame.edgePrecision] = edgeScores(count(hr), count(er), count(hc), count(ec));
  }
  if (w.detail) {
    // the variance of the Laplacian is the energy of the finest detail; after normalisation,
    // or a brighter picture would read as a sharper one
    const vr = variance(laplace(lightR, width, height)), vc = variance(laplace(lightN, width, height));
    frame.detailLog2 = Math.log2((vc + 1e-10) / (vr + 1e-10));
  }
  return { frame, maps, rough: fit.rough };
}

// ---- regions -----------------------------------------------------------------------

export const pack = (data, i) => (data[i * 3] << 16) | (data[i * 3 + 1] << 8) | data[i * 3 + 2];
// a region's name is one part of a flat key (`region.<name>.<metric>`): it holds neither '.' nor '/'
const safeName = (name) => name.replace(/[./]/g, "_");
const hex6 = (c) => c.toString(16).toUpperCase().padStart(6, "0");

/**
 * One region per flat colour of an id pass covering at least `minArea` of the
 * frame, in ascending packed-colour order. Anti-aliased borders make many tiny
 * colours; the area floor drops them, so they need no special case.
 */
export function regionsFromId(idImg, names, minArea) {
  const n = idImg.width * idImg.height;
  const counts = new Map();
  for (let i = 0; i < n; i++) { const c = pack(idImg.data, i); counts.set(c, (counts.get(c) ?? 0) + 1); }
  const byColour = new Map(Object.entries(names ?? {}).map(([name, [r, g, b]]) => [(r << 16) | (g << 8) | b, name]));
  const out = [];
  for (const colour of [...counts.keys()].sort((a, b) => a - b)) {
    if (counts.get(colour) / n < minArea) continue;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (pack(idImg.data, i) === colour) mask[i] = 1;
    out.push({ name: safeName(byColour.get(colour) ?? `id_${hex6(colour)}`), mask, colour });
  }
  return out;
}

/** A mask pass (L8): white is the subject, the rest the background. */
export function regionsFromMask(maskImg) {
  const subject = Uint8Array.from(maskImg.data, (v) => (v > 127 ? 1 : 0));
  return [{ name: "subject", mask: subject }, { name: "background", mask: subject.map((v) => 1 - v) }];
}

/** Boxes in 0..1 from shot.json, as masks of a w x h frame. */
export function regionsFromBoxes(boxes, width, height) {
  return Object.entries(boxes).map(([name, [x0, y0, x1, y1]]) => {
    const mask = new Uint8Array(width * height);
    const ya = Math.max(0, pyRound(y0 * height)), yb = Math.min(height, pyRound(y1 * height));
    const xa = Math.max(0, pyRound(x0 * width)), xb = Math.min(width, pyRound(x1 * width));
    for (let y = ya; y < yb; y++) mask.fill(1, y * width + xa, y * width + Math.max(xa, xb));
    return { name: safeName(name), mask };
  });
}

export const areaOf = (mask) => count(mask) / mask.length;

function maskedMean(map, mask) {
  let s = 0, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { s += map[i]; n++; }
  return n ? s / n : NaN;
}

/** A region's numbers: its area, and the maps averaged over it. */
export function regionMetrics(mask, maps) {
  const out = { area: areaOf(mask) };
  if (maps.ssim) out.ssim = maskedMean(maps.ssim, mask);
  if (maps.deltaENorm) out.deltaENorm = maskedMean(maps.deltaENorm, mask);
  if (maps.refEdge) out.edgeF1 = edgeScores(count(maps.refHit, mask), count(maps.refEdge, mask), count(maps.candHit, mask), count(maps.candEdge, mask))[0];
  return out;
}

export function iou(a, b) {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) union++; }
  return union ? inter / union : 1;
}


// ---- clips ---------------------------------------------------------------------------

export const PSNR_CAP = 99; // identical frames have an infinite PSNR, and JSON has no infinity

// Means of every k x k window that fits (no padding), from a summed-area table in float64.
function boxMeans(a, width, height, k) {
  const sw = width + 1, sat = new Float64Array(sw * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) { row += a[y * width + x]; sat[(y + 1) * sw + x + 1] = sat[y * sw + x + 1] + row; }
  }
  const ow = width - k + 1, oh = height - k + 1, out = new Float64Array(ow * oh), n = k * k;
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    out[y * ow + x] = (sat[(y + k) * sw + x + k] - sat[y * sw + x + k] - sat[(y + k) * sw + x] + sat[y * sw + x]) / n;
  }
  return out;
}

/**
 * Mean SSIM of two luma planes in 0..1 over uniform k x k windows (7 by default, smaller for a tiny frame),
 * with the constants of the original paper, and PSNR in dB capped at PSNR_CAP. Fast enough for every frame
 * of a clip, which is what it is for; a still is measured with the Gaussian SSIM of `analyse`.
 */
export function boxSsimPsnr(a, b, width, height, k = 7) {
  k = Math.max(1, Math.min(k, width, height));
  const n = a.length, aa = new Float64Array(n), bb = new Float64Array(n), ab = new Float64Array(n);
  let se = 0;
  for (let i = 0; i < n; i++) { aa[i] = a[i] * a[i]; bb[i] = b[i] * b[i]; ab[i] = a[i] * b[i]; se += (a[i] - b[i]) ** 2; }
  const ma = boxMeans(a, width, height, k), mb = boxMeans(b, width, height, k);
  const va = boxMeans(aa, width, height, k), vb = boxMeans(bb, width, height, k), cov = boxMeans(ab, width, height, k);
  const c1 = 0.01 ** 2, c2 = 0.03 ** 2;
  let s = 0;
  for (let i = 0; i < ma.length; i++) {
    const x = ma[i], y = mb[i];
    s += ((2 * x * y + c1) * (2 * (cov[i] - x * y) + c2)) / ((x * x + y * y + c1) * (va[i] - x * x + vb[i] - y * y + c2));
  }
  const mse = se / n;
  return { ssim: s / ma.length, psnr: mse < 1e-12 ? PSNR_CAP : Math.min(PSNR_CAP, 10 * Math.log10(1 / mse)) };
}
