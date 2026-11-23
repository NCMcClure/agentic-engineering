// Sound as numbers, in Node with no dependency: a radix-2 FFT and the short-
// time power spectrum, integrated loudness after ITU-R BS.1770-4, polyphase
// resampling, the fundamental by YIN, onsets by spectral flux, the lag between
// two sounds by cross-correlation, and the spectral comparison of two aligned
// sounds. Where scipy defines the operation (stft, resample_poly, find_peaks,
// median_filter), its definition is followed, and the unit
// tests pin the behaviour with known answers. A long sound is never held as a
// spectrogram: frames are computed one at a time and folded as they arrive.

const TAU = 2 * Math.PI;

export const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

const TWIDDLES = new Map();
function twiddles(n) {
  let t = TWIDDLES.get(n);
  if (!t) {
    t = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let k = 0; k < n / 2; k++) { t.cos[k] = Math.cos((TAU * k) / n); t.sin[k] = Math.sin((TAU * k) / n); }
    TWIDDLES.set(n, t);
  }
  return t;
}

/** In-place complex FFT of (re, im), a power of two long; with `inverse`, the inverse scaled by 1/n. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (n & (n - 1)) throw new Error(`fft: length ${n} is not a power of two`);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const { cos, sin } = twiddles(n), sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sign * sin[k * step], a = i + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** The periodic Hann window of n samples, as scipy's get_window("hann", n) gives it. */
export const hann = (n) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / n));

/** How many frames of nfft samples, hop apart, fit whole in n samples (one, padded, when n < nfft). */
export const frameCount = (n, nfft, hop) => (n < nfft ? 1 : Math.floor((n - nfft) / hop) + 1);

/**
 * The power spectrum of a frame of nfft samples of x from `start` (zeros past the end), as scipy's
 * stft(window="hann", boundary=None, padded=False) gives it: |FFT(window * frame) / sum(window)|^2 for
 * bins 0..nfft/2. Returns a function (x, start) => power; `power` is reused between calls.
 */
export function framePower(nfft) {
  const win = hann(nfft), scale = win.reduce((s, v) => s + v, 0) ** 2;
  const re = new Float64Array(nfft), im = new Float64Array(nfft), power = new Float64Array(nfft / 2 + 1);
  return (x, start) => {
    for (let i = 0; i < nfft; i++) { re[i] = start + i < x.length ? x[start + i] * win[i] : 0; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b <= nfft / 2; b++) power[b] = (re[b] * re[b] + im[b] * im[b]) / scale;
    return power;
  };
}

/** Calls fn(power, k) for each frame k of x, which starts at k * hop and sits at time (k * hop + nfft / 2) / rate. */
export function stftPower(x, nfft, hop, fn) {
  const at = framePower(nfft), frames = frameCount(x.length, nfft, hop);
  for (let k = 0; k < frames; k++) fn(at(x, k * hop), k);
  return frames;
}

// ---- loudness ----------------------------------------------------------------------------------------

/**
 * The two K-weighting stages of BS.1770-4 for a sample rate, as { b, a } biquads: a high shelf, then a
 * high-pass. The standard prints coefficients for 48 kHz only; these come from the analogue prototypes
 * those were made from, so every rate gets the same curve and 48 kHz gets the printed numbers.
 */
export function kWeighting(rate) {
  const stage = (fc, q, gainDb) => {
    const k = Math.tan((Math.PI * fc) / rate), a0 = 1 + k / q + k * k;
    const a = [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
    if (gainDb === null) return { b: [1, -2, 1], a };
    const vh = 10 ** (gainDb / 20), vb = vh ** 0.4996667741545416;
    return { b: [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0], a };
  };
  return [stage(1681.974450955533, 0.7071752369554196, 3.999843853973347), stage(38.13547087602444, 0.5003270373238773, null)];
}

/** BS.1770 channel weights: 1 for left, right and centre, none for LFE, 1.41 for the surrounds of 5.1 and up. */
const channelWeight = (c, count) => (count < 5 ? 1 : [1, 1, 1, 0, 1.41, 1.41][c] ?? 1.41);

/**
 * Integrated loudness in LUFS after ITU-R BS.1770-4: K-weighting, the mean square in 400 ms blocks every
 * 100 ms, the absolute gate at -70 LUFS and the relative gate 10 LU under the mean of the blocks above it.
 * null when shorter than one block, -Infinity when every block is under the absolute gate. Sample peak,
 * not true peak, is what goes beside it.
 */
export function loudness(channels, rate) {
  const n = channels[0].length, block = Math.floor(0.4 * rate), hop = Math.floor(0.1 * rate);
  if (n < block) return null;
  const blocks = Math.floor((n - block) / hop) + 1;
  const z = new Float64Array(blocks);
  const [s1, s2] = kWeighting(rate);
  channels.forEach((x, c) => {
    const g = channelWeight(c, channels.length);
    if (!g) return;
    // a running sum of squares, read at every block's start and end, so nothing as long as the sound is kept
    const startSum = new Float64Array(blocks), endSum = new Float64Array(blocks);
    let sum = 0, bs = 0, be = 0, p1 = 0, p2 = 0, q1 = 0, q2 = 0;
    for (let i = 0; i <= n; i++) {
      while (bs < blocks && bs * hop === i) startSum[bs++] = sum;
      while (be < blocks && be * hop + block === i) endSum[be++] = sum;
      if (i === n) break;
      // two biquads in transposed direct form II, as scipy's lfilter runs them
      const y1 = s1.b[0] * x[i] + p1;
      p1 = s1.b[1] * x[i] - s1.a[1] * y1 + p2;
      p2 = s1.b[2] * x[i] - s1.a[2] * y1;
      const y2 = s2.b[0] * y1 + q1;
      q1 = s2.b[1] * y1 - s2.a[1] * y2 + q2;
      q2 = s2.b[2] * y1 - s2.a[2] * y2;
      sum += y2 * y2;
    }
    for (let b = 0; b < blocks; b++) z[b] += (g * (endSum[b] - startSum[b])) / block;
  });
  const lufs = (v) => -0.691 + 10 * Math.log10(v);
  const meanOf = (keep) => { let s = 0, k = 0; for (let b = 0; b < blocks; b++) if (keep(b)) { s += z[b]; k++; } return [s / k, k]; };
  const loud = Float64Array.from(z, (v) => lufs(Math.max(v, 1e-20)));
  const [absMean, kept] = meanOf((b) => loud[b] > -70);
  if (!kept) return -Infinity;
  const relative = lufs(absMean) - 10;
  return lufs(meanOf((b) => loud[b] > -70 && loud[b] > relative)[0]);
}

// ---- resampling ------------------------------------------------------------------------------------------

function besselI0(x) {
  let sum = 1, term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 500 && term > sum * 1e-17; k++) { term *= q / (k * k); sum += term; }
  return sum;
}

/** scipy's firwin(numtaps, cutoff, window=("kaiser", beta)): a windowed-sinc low-pass, cutoff in 0..1 of Nyquist, unit gain at 0 Hz. */
export function firwinKaiser(numtaps, cutoff, beta = 5) {
  const h = new Float64Array(numtaps), mid = (numtaps - 1) / 2, norm = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < numtaps; i++) {
    const x = cutoff * (i - mid), r = (i - mid) / mid;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    h[i] = cutoff * sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / norm);
    sum += h[i];
  }
  for (let i = 0; i < numtaps; i++) h[i] /= sum;
  return h;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/**
 * x resampled by up/down as scipy's resample_poly does it: a Kaiser (beta 5) low-pass of 20 x max(up, down) + 1
 * taps at the lower Nyquist, applied as upsample, filter, downsample, with the output centred so there is no
 * delay. The output has ceil(n * up / down) samples.
 */
export function resamplePoly(x, up, down) {
  const g = gcd(up, down);
  up /= g; down /= g;
  if (up === 1 && down === 1) return Float64Array.from(x);
  const nIn = x.length, nOut = Math.floor((nIn * up) / down) + ((nIn * up) % down ? 1 : 0);
  const maxRate = Math.max(up, down), halfLen = 10 * maxRate;
  const taps = firwinKaiser(2 * halfLen + 1, 1 / maxRate);
  const pre = down - (halfLen % down), skip = Math.floor((halfLen + pre) / down);
  const h = new Float64Array(pre + taps.length);
  for (let i = 0; i < taps.length; i++) h[pre + i] = taps[i] * up;
  const y = new Float64Array(nOut);
  for (let k = 0; k < nOut; k++) {
    // output k is sample (k + skip) * down of the filtered upsampled signal, where only every up-th input is non-zero
    const m = (k + skip) * down;
    let acc = 0;
    for (let j = m % up; j < h.length; j += up) {
      const idx = (m - j) / up;
      if (idx < 0) break;
      if (idx < nIn) acc += h[j] * x[idx];
    }
    y[k] = acc;
  }
  return y;
}

// ---- pitch -------------------------------------------------------------------------------------------------

/**
 * The fundamental per frame by YIN (de Cheveigne and Kawahara, 2002): the lag at which the signal best repeats,
 * from the cumulative-mean-normalised difference function, refined by a parabola. It does not favour the octave
 * below as a plain autocorrelation peak does, and it finds a fundamental weaker than its harmonics, which a
 * spectral peak does not. Returns { times, hz, confidence } per frame, every `hop` seconds; confidence is
 * 1 - the normalised difference at the lag chosen, near 1 for a cleanly periodic frame, and hz is NaN in silence.
 */
export function yin(x, rate, { fmin = 50, fmax = 1000, hop: hopS = 0.01, threshold = 0.15 } = {}) {
  // at 16 kHz the lags are long enough; the parabola gives the rest
  const dec = fmax <= 2500 ? Math.max(1, Math.floor(rate / 16000)) : 1;
  if (dec > 1) { x = resamplePoly(x, 1, dec); rate = Math.floor(rate / dec); }
  const tmax = Math.floor(rate / fmin) + 2, tmin = Math.max(2, Math.floor(rate / fmax));
  const w = 2 * tmax, length = w + tmax, hop = Math.max(1, Math.floor(hopS * rate));
  if (x.length < length + 1) { const padded = new Float64Array(length + 1); padded.set(x); x = padded; }
  const count = Math.ceil((x.length - length) / hop);
  const nfft = nextPow2(length);
  const times = new Float64Array(count), hz = new Float64Array(count).fill(NaN), confidence = new Float64Array(count);
  const fr = new Float64Array(nfft), fi = new Float64Array(nfft), gr = new Float64Array(nfft), gi = new Float64Array(nfft);
  const cs = new Float64Array(length + 1), d = new Float64Array(tmax + 1), cm = new Float64Array(tmax + 1);
  for (let k = 0; k < count; k++) {
    const s = k * hop;
    times[k] = (s + w / 2) / rate;
    for (let j = 0; j < length; j++) cs[j + 1] = cs[j] + x[s + j] * x[s + j];
    if (cs[w] / w < 1e-9) continue;
    // corr[lag] = sum over the window of x[j] x[j + lag], by FFT
    fr.fill(0); fi.fill(0); gr.fill(0); gi.fill(0);
    for (let j = 0; j < length; j++) fr[j] = x[s + j];
    for (let j = 0; j < w; j++) gr[j] = x[s + j];
    fft(fr, fi); fft(gr, gi);
    for (let b = 0; b < nfft; b++) {
      const r = fr[b] * gr[b] + fi[b] * gi[b], i = fi[b] * gr[b] - fr[b] * gi[b];
      fr[b] = r; fi[b] = i;
    }
    fft(fr, fi, true);
    // d[lag] = sum over the window of (x[j] - x[j + lag])^2
    let running = 0;
    cm[0] = 1;
    for (let lag = 0; lag <= tmax; lag++) {
      d[lag] = cs[w] + (cs[w + lag] - cs[lag]) - 2 * fr[lag];
      if (lag) { running += d[lag]; cm[lag] = (d[lag] * lag) / Math.max(running, 1e-12); }
    }
    // the first dip under the threshold, followed to its bottom; else the lowest point
    let i = -1;
    for (let t = tmin; t < tmax; t++) if (cm[t] < threshold) { i = t; break; }
    if (i < 0) { i = tmin; for (let t = tmin; t < tmax; t++) if (cm[t] < cm[i]) i = t; }
    while (i + 1 < tmax && cm[i + 1] < cm[i]) i++;
    let t = i;
    if (t >= 1 && t < tmax) {
      const a = cm[t - 1], b = cm[t], c = cm[t + 1], den = a - 2 * b + c;
      const off = Math.abs(den) > 1e-12 ? (0.5 * (a - c)) / den : 0;
      t += Math.max(-1, Math.min(1, off));
    }
    hz[k] = rate / t;
    confidence[k] = Math.max(0, 1 - cm[i]);
  }
  return { times, hz, confidence };
}

// ---- onsets ------------------------------------------------------------------------------------------------------

/**
 * scipy's find_peaks(x, height, distance): local maxima, a flat top counted once at its middle (rounded down),
 * never the first or last sample; then those at or above `height` (a number or one value per sample); then,
 * highest first, each kept peak removes the others closer than `distance` samples (ties: the later one wins).
 */
export function findPeaks(x, { height = null, distance = null } = {}) {
  let peaks = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (!(x[i - 1] < x[i])) continue;
    let ahead = i + 1;
    while (ahead < x.length - 1 && x[ahead] === x[i]) ahead++;
    if (x[ahead] < x[i]) { peaks.push((i + ahead - 1) >> 1); i = ahead; }
  }
  if (height !== null) peaks = peaks.filter((p) => x[p] >= (typeof height === "number" ? height : height[p]));
  if (distance !== null && distance > 1 && peaks.length > 1) {
    const dist = Math.ceil(distance), keep = peaks.map(() => true);
    const order = peaks.map((p, i) => i).sort((a, b) => x[peaks[a]] - x[peaks[b]] || a - b);
    for (let o = order.length - 1; o >= 0; o--) {
      const j = order[o];
      if (!keep[j]) continue;
      for (let k = j - 1; k >= 0 && peaks[j] - peaks[k] < dist; k--) keep[k] = false;
      for (let k = j + 1; k < peaks.length && peaks[k] - peaks[j] < dist; k++) keep[k] = false;
    }
    peaks = peaks.filter((_, i) => keep[i]);
  }
  return peaks;
}

/** scipy's median_filter(x, size, mode="nearest") in one dimension: an even size takes the upper of the two middle values. */
export function medianFilter(x, size) {
  const out = new Float64Array(x.length), win = new Float64Array(size), lo = size >> 1;
  for (let i = 0; i < x.length; i++) {
    for (let k = 0; k < size; k++) win[k] = x[Math.min(x.length - 1, Math.max(0, i - lo + k))];
    win.sort();
    out[i] = win[lo];
  }
  return out;
}

/**
 * When sounds start, by spectral flux: the summed rise of the log-compressed magnitude spectrum between
 * consecutive frames of about 23 ms, normalised to 1, and its peaks above a moving median of 0.2 s plus
 * `sensitivity`, at least `minGap` seconds apart. A peak is refined by a parabola through its neighbours,
 * and its time is where the start of the sound sat in the window when the flux rose most: three quarters
 * into it, half a hop before the later frame. A slow swell, or a change of pitch at a constant level, has
 * no onset in this sense. Returns { times, strength }.
 */
export function onsets(x, rate, { sensitivity = 0.1, minGap = 0.05 } = {}) {
  const nfft = 2 ** Math.round(Math.log2(rate * 0.023)), hop = nfft / 4;
  let top = 0;
  stftPower(x, nfft, hop, (p) => { for (const v of p) if (v > top) top = v; });
  const peak = Math.sqrt(top);
  if (peak <= 1e-9) return { times: [], strength: [] };
  const frames = frameCount(x.length, nfft, hop), flux = new Float64Array(frames);
  let prev = null;
  stftPower(x, nfft, hop, (p, k) => {
    const c = Float64Array.from(p, (v) => Math.log1p((100 * Math.sqrt(v)) / peak));
    if (prev) { let s = 0; for (let b = 0; b < c.length; b++) s += Math.max(c[b] - prev[b], 0); flux[k] = s; }
    prev = c;
  });
  // a loop, not Math.max(...flux): an hour of sound is more frames than a call takes arguments
  let fmax = 1e-12;
  for (const v of flux) if (v > fmax) fmax = v;
  for (let k = 0; k < frames; k++) flux[k] /= fmax;
  const threshold = medianFilter(flux, Math.max(3, Math.floor((0.2 * rate) / hop))).map((v) => v + sensitivity);
  const found = findPeaks(flux, { height: threshold, distance: Math.max(1, Math.floor((minGap * rate) / hop)) });
  const times = found.map((k) => {
    const a = flux[k - 1], b = flux[k], c = flux[k + 1], den = a - 2 * b + c;
    const off = Math.abs(den) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
    return Math.max(0, ((k + off) * hop + nfft / 2 + nfft / 4 - hop / 2) / rate);
  });
  return { times, strength: found.map((k) => flux[k]) };
}

// ---- lag and comparison ---------------------------------------------------------------------------------------------

/**
 * c[maxLag + lag] = sum over n of (a[n] - meanA) (b[n + lag] - meanB), for lag in -maxLag..maxLag only. A runs
 * through in blocks, each correlated by FFT against the stretch of B it can reach, and the means come off as the
 * blocks are filled, so the memory is a few times the lag window whatever the length of the sounds.
 */
export function correlateWindow(a, b, maxLag, { block = null, meanA = 0, meanB = 0 } = {}) {
  const L = maxLag, size = block ? nextPow2(block + 2 * L) : nextPow2(Math.max(4096, 4 * L + 2)), m = size - 2 * L;
  const out = new Float64Array(2 * L + 1);
  const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
  for (let s = 0; s < a.length; s += m) {
    ar.fill(0); ai.fill(0); br.fill(0); bi.fill(0);
    for (let n = 0; n < m && s + n < a.length; n++) ar[n] = a[s + n] - meanA;
    for (let j = 0; j < m + 2 * L; j++) { const at = s - L + j; if (at >= 0 && at < b.length) br[j] = b[at] - meanB; }
    fft(ar, ai); fft(br, bi);
    for (let k = 0; k < size; k++) {
      const r = ar[k] * br[k] + ai[k] * bi[k], i = ar[k] * bi[k] - ai[k] * br[k];
      ar[k] = r; ai[k] = i;
    }
    fft(ar, ai, true);
    for (let j = 0; j <= 2 * L; j++) out[j] += ar[j];
  }
  return out;
}

const meanOf = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s / x.length; };
const energy = (x, m) => { let s = 0; for (let i = 0; i < x.length; i++) { const d = x[i] - m; s += d * d; } return s; };

/** The lag (in samples, sub-sample by a parabola) at which v best matches u, within +-limit, and its normalised correlation, both centred. */
function bestLag(u, v, limit) {
  const mu = meanOf(u), mv = meanOf(v);
  const c = correlateWindow(u, v, limit, { meanA: mu, meanB: mv });
  let i = 0;
  for (let j = 1; j < c.length; j++) if (c[j] > c[i]) i = j;
  let off = 0;
  if (i > 0 && i < c.length - 1) {
    const den = c[i - 1] - 2 * c[i] + c[i + 1];
    off = Math.abs(den) > 1e-20 ? (0.5 * (c[i - 1] - c[i + 1])) / den : 0;
  }
  return { lag: i - limit + off, corr: c[i] / Math.max(Math.sqrt(energy(u, mu) * energy(v, mv)), 1e-20) };
}

/** RMS per window of `seconds`, and the rate of the windows. */
export function envelope(x, rate, seconds = 0.01) {
  const win = Math.max(1, Math.floor(seconds * rate)), n = Math.floor(x.length / win), out = new Float64Array(n);
  for (let k = 0; k < n; k++) { let s = 0; for (let i = k * win; i < (k + 1) * win; i++) s += x[i] * x[i]; out[k] = Math.sqrt(s / win); }
  return { values: out, rate: rate / win };
}

/**
 * How much later B is than A, in seconds (negative: earlier), its normalised correlation, and what it was read
 * from: the waveforms (sample-accurate, needs the same signal) or, when those correlate under 0.3, the 1 ms
 * loudness envelopes (works between two renderings of the same event, to a few ms).
 */
export function findLag(a, b, rate, maxSeconds) {
  const limit = (n) => Math.max(1, Math.min(Math.round(maxSeconds * n), Math.max(a.length, b.length) - 1));
  const wave = bestLag(a, b, limit(rate));
  if (wave.corr >= 0.3) return { lag: wave.lag / rate, corr: wave.corr, from: "waveform" };
  const ea = envelope(a, rate, 0.001), eb = envelope(b, rate, 0.001);
  const env = bestLag(ea.values, eb.values, Math.max(1, Math.min(Math.round(maxSeconds * ea.rate), Math.max(ea.values.length, eb.values.length) - 1)));
  return { lag: env.lag / ea.rate, corr: env.corr, from: "envelope" };
}

/** Pearson's correlation, null when either side is flat. */
export function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (Math.sqrt(sxx / n) <= 1e-9 || Math.sqrt(syy / n) <= 1e-9) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/**
 * Two aligned, level-matched sounds of one rate compared by their spectra, 2048-sample Hann frames every 512:
 * the log-spectral distance (per frame the RMS over bins of the dB difference, floored 80 dB under A's loudest
 * bin so differences in the noise floor are not the sound, then the mean over frames), and per octave band
 * B over A in dB with `levelDb` added back, so the bands carry the level difference too.
 */
export function spectralCompare(a, b, rate, levelDb = 0) {
  const nfft = 2048, hop = 512, bins = nfft / 2 + 1;
  let top = 0;
  stftPower(a, nfft, hop, (p) => { for (const v of p) if (v > top) top = v; });
  const floor = top * 1e-8, db = (v) => 10 * Math.log10(Math.max(v, floor));
  // A and B frame by frame in step, so neither spectrogram is ever kept whole
  const pa = framePower(nfft), pb = framePower(nfft), frames = frameCount(Math.min(a.length, b.length), nfft, hop);
  const ma = new Float64Array(bins), mb = new Float64Array(bins);
  let lsd = 0;
  for (let k = 0; k < frames; k++) {
    const sa = pa(a, k * hop), sb = pb(b, k * hop);
    let s = 0;
    for (let j = 0; j < bins; j++) { const d = db(sa[j]) - db(sb[j]); s += d * d; ma[j] += sa[j] / frames; mb[j] += sb[j] / frames; }
    lsd += Math.sqrt(s / bins);
  }
  const scale = 10 ** (levelDb / 10), bands = {};
  for (const c of OCTAVES) {
    const lo = c / Math.SQRT2, hi = c * Math.SQRT2;
    if (hi > (rate / 2) * 1.01) continue;
    let sa = 0, sb = 0, any = false;
    for (let j = 0; j < bins; j++) {
      const f = (j * rate) / nfft;
      if (f >= lo && f < hi) { sa += ma[j]; sb += mb[j] * scale; any = true; }
    }
    if (any && sa > floor) bands[String(c)] = 10 * Math.log10(Math.max(sb, 1e-30) / sa);
  }
  return { lsd: lsd / frames, bands };
}
