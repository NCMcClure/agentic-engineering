// perceptual-loop's sound: the WAV reader over every sample format it claims,
// the DSP pieces pinned by known answers (K-weighting coefficients, loudness of
// the EBU reference tone, resampling, YIN, spectral-flux onsets, the peak and
// median semantics, lag by windowed cross-correlation), and the audio command
// on synthetic sounds. The WAV files are written here by code independent of
// the reader. The ffmpeg cases encode in the test and skip when ffmpeg is missing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PL, mulberry32, runNode, tempDir } from "./perceptual-loop-fixtures.mjs";

import * as wav from "../../../plugins/perceptual-loop/scripts/lib/wav.mjs";
import * as dsp from "../../../plugins/perceptual-loop/scripts/lib/dsp.mjs";
import { decodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ENV = { PL_DIR: "", PL_SHOTS_DIR: "", PL_FFMPEG: "", PL_FFPROBE: "" };

const pl = (dir, args, env = {}) => runNode(PL, args, { cwd: dir, env: { ...ENV, ...env } });
const json = (r) => { assert.equal(r.stderr.includes("internal error"), false, r.stderr); return JSON.parse(r.stdout); };
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got}, want ${want} +- ${tol}`);

// ---- a WAV writer, independent of the reader ---------------------------------------------------

const GUID_TAIL = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]);
const WIDTH = { u8: 1, s16: 2, s24: 3, s32: 4, f32: 4, f64: 8 };

function chunk(id, body) {
  const head = Buffer.alloc(8);
  head.write(id, 0, "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

/**
 * A WAV file of `channels` (arrays of floats in -1..1) at `rate`. `container` widens an integer sample's
 * slot (24 valid bits in 4 bytes); `dataSize` overrides the data chunk's size field; `before` and
 * `after` are chunks around the fmt and data chunks; `tail` is stray bytes at the very end.
 */
function wavFile(channels, rate, { format = "s16", extensible = false, container = null, dataSize = null, before = [], after = [], tail = 0 } = {}) {
  const width = container ?? WIDTH[format], n = channels[0].length, ch = channels.length;
  const float = format[0] === "f";
  const data = Buffer.alloc(n * ch * width);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = channels[c][i], at = (i * ch + c) * width;
    if (format === "f32") data.writeFloatLE(v, at);
    else if (format === "f64") data.writeDoubleLE(v, at);
    else if (format === "u8") data.writeUInt8(Math.max(0, Math.min(255, Math.round(v * 128 + 128))), at);
    else {
      const bits = 8 * WIDTH[format], full = 2 ** (bits - 1);
      const q = Math.max(-full, Math.min(full - 1, Math.round(v * full)));
      // left-justified in a wider container, as the format says
      const word = q * 2 ** (8 * (width - WIDTH[format]));
      data.writeIntLE(word, at, width);
    }
  }
  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : float ? 3 : 1, 0);
  fmt.writeUInt16LE(ch, 2);
  fmt.writeUInt32LE(rate, 4);
  fmt.writeUInt32LE(rate * ch * width, 8);
  fmt.writeUInt16LE(ch * width, 12);
  fmt.writeUInt16LE(8 * width, 14);
  if (extensible) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(8 * WIDTH[format], 18);
    fmt.writeUInt32LE(ch === 2 ? 3 : 4, 20);
    fmt.writeUInt16LE(float ? 3 : 1, 24);
    GUID_TAIL.copy(fmt, 26);
  }
  const dataChunk = chunk("data", data);
  if (dataSize !== null) dataChunk.writeUInt32LE(dataSize, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), ...before, chunk("fmt ", fmt), dataChunk, ...after, Buffer.alloc(tail, 7)]);
  const head = Buffer.alloc(8);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(dataSize === null ? body.length : 0xffffffff, 4);
  return Buffer.concat([head, body]);
}

const sine = (hz, seconds, rate, amp = 1, phase = 0) => Float64Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / rate + phase));

function gaussian(n, seed, amp = 1) {
  const rnd = mulberry32(seed), out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - rnd())), t = 2 * Math.PI * rnd();
    out[i] = amp * r * Math.cos(t);
    if (i + 1 < n) out[i + 1] = amp * r * Math.sin(t);
  }
  return out;
}

function put(dir, name, channels, rate, opts) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, wavFile(Array.isArray(channels) ? channels : [channels], rate, { format: "f32", ...opts }));
  return file;
}

// ---- the WAV reader ------------------------------------------------------------------------------

const PROBE = [0, 0.5, -0.5, 0.25, -1, 0.75];
const STEP = { u8: 1 / 128, s16: 1 / 32768, s24: 1 / 8388608, s32: 1 / 2147483648, f32: 1e-7, f64: 0 };

test("the reader takes PCM u8, s16, s24, s32 and float32, float64, scaled as libsndfile does", () => {
  for (const format of Object.keys(WIDTH)) {
    const left = PROBE, right = PROBE.map((v) => -v / 2);
    const s = wav.parseWav(wavFile([left, right], 44100, { format }), format);
    assert.deepEqual([s.rate, s.channels, s.frames], [44100, 2, PROBE.length], format);
    assert.match(s.format, new RegExp(format === "f32" ? "float32" : format === "f64" ? "float64" : format));
    for (const [c, want] of [[0, left], [1, right]]) {
      want.forEach((v, i) => near(s.data[c][i], v, STEP[format] + 1e-12, `${format} channel ${c} sample ${i}`));
    }
  }
  // u8 is offset binary: 128 is zero, 0 is -1
  const u8 = wav.parseWav(wavFile([[-1, 0]], 8000, { format: "u8" }));
  assert.deepEqual([...u8.data[0]], [-1, 0]);
});

test("WAVE_FORMAT_EXTENSIBLE: the sub-format GUID says PCM or float, and a wide container holds left-justified samples", () => {
  for (const format of ["s16", "s24", "f32"]) {
    const s = wav.parseWav(wavFile([PROBE, PROBE, PROBE], 48000, { format, extensible: true }));
    assert.equal(s.channels, 3);
    PROBE.forEach((v, i) => near(s.data[2][i], v, STEP[format] + 1e-12, `extensible ${format}`));
  }
  const wide = wav.parseWav(wavFile([PROBE], 48000, { format: "s24", extensible: true, container: 4 }));
  PROBE.forEach((v, i) => near(wide.data[0][i], v, STEP.s24 + 1e-12, "24 bits in a 32-bit container"));
});

test("a data size of 0 or 0xFFFFFFFF (a stream) reads to the end of the file, in whole frames", () => {
  for (const dataSize of [0, 0xffffffff]) {
    const s = wav.parseWav(wavFile([PROBE, PROBE], 16000, { format: "s16", dataSize, tail: 3 }));
    // the 3 stray bytes are one frame and a byte of another: 6 + 0.75 frames, so 6
    assert.equal(s.frames, PROBE.length, `size ${dataSize}`);
    near(s.data[1][1], 0.5, STEP.s16, "a sample read past the declared size");
  }
});

test("odd-sized chunks are padded to an even length, before and after the data", () => {
  const junk = chunk("JUNK", Buffer.from("abcde"));
  assert.equal(junk.length, 8 + 6, "the writer pads too");
  const s = wav.parseWav(wavFile([[0.5, -0.5, 0.25]], 8000, { format: "u8", before: [junk], after: [chunk("LIST", Buffer.from("xyz"))] }));
  assert.equal(s.frames, 3);
  assert.deepEqual([...s.data[0]], [0.5, -0.5, 0.25]);
});

test("a file that is not a WAV, or a WAV in a codec the reader does not know, is marked for ffmpeg; a broken WAV is an error", () => {
  assert.equal(wav.isWav(Buffer.from("fLaC\0\0\0\0\0\0\0\0")), false);
  const notWav = (() => { try { wav.parseWav(Buffer.from("ID3 not a wave file at all")); } catch (e) { return e; } })();
  assert.equal(notWav?.unsupported, true);
  const mulaw = wavFile([PROBE], 8000, { format: "u8" });
  mulaw.writeUInt16LE(7, 20); // the fmt tag: mu-law
  const codec = (() => { try { wav.parseWav(mulaw); } catch (e) { return e; } })();
  assert.equal(codec?.unsupported, true);
  assert.match(codec.message, /tag 7/);
  const noFmt = Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WAVE"), chunk("data", Buffer.alloc(8))]);
  const broken = (() => { try { wav.parseWav(noFmt); } catch (e) { return e; } })();
  assert.equal(broken?.unsupported, undefined);
  assert.match(broken.message, /no fmt chunk/);
});

// ---- DSP: the pieces, by known answers -------------------------------------------------------------

test("the FFT agrees with a direct DFT, and its inverse returns the input", () => {
  const n = 64, rnd = mulberry32(5);
  const xr = Float64Array.from({ length: n }, rnd), xi = Float64Array.from({ length: n }, rnd);
  const re = Float64Array.from(xr), im = Float64Array.from(xi);
  dsp.fft(re, im);
  for (const k of [0, 1, 17, 63]) {
    let sr = 0, si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      sr += xr[t] * Math.cos(a) - xi[t] * Math.sin(a);
      si += xr[t] * Math.sin(a) + xi[t] * Math.cos(a);
    }
    near(re[k], sr, 1e-9, `bin ${k} real`);
    near(im[k], si, 1e-9, `bin ${k} imaginary`);
  }
  dsp.fft(re, im, true);
  for (let t = 0; t < n; t++) near(re[t], xr[t], 1e-12, "round trip");
});

test("K-weighting at 48 kHz has the coefficients ITU-R BS.1770-4 prints", () => {
  const [shelf, highpass] = dsp.kWeighting(48000);
  const want = [
    [[1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]],
    [[1, -2, 1], [1, -1.99004745483398, 0.99007225036621]],
  ];
  for (const [stage, [b, a]] of [[shelf, want[0]], [highpass, want[1]]]) {
    stage.b.forEach((v, i) => near(v, b[i], 1e-7, `b${i}`));
    stage.a.forEach((v, i) => near(v, a[i], 1e-7, `a${i}`));
  }
});

test("loudness: a stereo 1 kHz sine at -23 dBFS reads -23 LUFS, at 48 and 44.1 kHz; too short is null, silence is -Infinity", () => {
  const amp = 10 ** (-23 / 20);
  for (const rate of [48000, 44100]) {
    const tone = sine(1000, 3, rate, amp);
    near(dsp.loudness([tone, tone], rate), -23, 0.1, `${rate} Hz`);
  }
  // one channel of the same tone is 3 dB quieter: the channels sum as power
  const tone = sine(1000, 3, 48000, amp);
  near(dsp.loudness([tone], 48000), -26.01, 0.1, "mono");
  assert.equal(dsp.loudness([new Float64Array(1000)], 48000), null);
  assert.equal(dsp.loudness([new Float64Array(48000)], 48000), -Infinity);
});

test("polyphase resampling keeps a tone in band, removes one above the new Nyquist, and keeps its timing", () => {
  const x = sine(440, 1, 48000, 0.5);
  const y = dsp.resamplePoly(x, 1, 3);
  assert.equal(y.length, 16000);
  const want = sine(440, 1, 16000, 0.5);
  let worst = 0;
  for (let i = 200; i < y.length - 200; i++) worst = Math.max(worst, Math.abs(y[i] - want[i]));
  assert.ok(worst < 2e-3, `in band, no delay: largest error ${worst}`);
  const alias = dsp.resamplePoly(sine(12000, 1, 48000, 0.5), 1, 3);
  const rms = Math.sqrt(alias.slice(200, -200).reduce((s, v) => s + v * v, 0) / (alias.length - 400));
  assert.ok(20 * Math.log10(rms / (0.5 / Math.SQRT2)) < -40, `12 kHz falls above 8 kHz and is removed: ${rms}`);
  // up by 3, and a ratio that is not whole: lengths round up as scipy's do
  assert.equal(dsp.resamplePoly(new Float64Array(10), 3, 1).length, 30);
  assert.equal(dsp.resamplePoly(new Float64Array(1001), 160, 147).length, Math.ceil((1001 * 160) / 147));
  const up = dsp.resamplePoly(sine(440, 0.5, 16000, 0.5), 3, 1), upWant = sine(440, 0.5, 48000, 0.5);
  for (let i = 600; i < up.length - 600; i += 97) near(up[i], upWant[i], 2e-3, `up by 3 at ${i}`);
  assert.deepEqual([...dsp.resamplePoly([1, 2, 3], 2, 2)], [1, 2, 3], "the same rate is a copy");
});

test("YIN finds a pure tone and a fundamental weaker than its harmonics within 0.5 %", () => {
  const rate = 48000;
  for (const hz of [82.41, 220, 440, 880]) {
    const { hz: track, confidence } = dsp.yin(sine(hz, 1, rate, 0.5), rate, { fmin: 50, fmax: 1000 });
    const voiced = [...track].filter((v, i) => confidence[i] >= 0.8 && Number.isFinite(v));
    assert.ok(voiced.length > 80, `${hz} Hz: ${voiced.length} periodic frames`);
    const med = voiced.sort((a, b) => a - b)[voiced.length >> 1];
    assert.ok(Math.abs(med / hz - 1) < 0.005, `${hz} Hz read as ${med}`);
  }
  // an engine-like sound: the second and third harmonics louder than the fundamental
  const t = (i) => i / rate;
  const x = Float64Array.from({ length: rate }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 120 * t(i)) + 0.35 * Math.sin(4 * Math.PI * 120 * t(i)) + 0.25 * Math.sin(6 * Math.PI * 120 * t(i)));
  const { hz } = dsp.yin(x, rate, { fmin: 50, fmax: 600 });
  const good = [...hz].filter(Number.isFinite).filter((v) => Math.abs(v / 120 - 1) < 0.005).length;
  assert.ok(good / hz.length > 0.95, `${good} of ${hz.length} frames at 120 Hz`);
  // silence has no pitch
  assert.ok([...dsp.yin(new Float64Array(rate / 2), rate, { fmin: 50, fmax: 1000 }).hz].every(Number.isNaN));
});

test("peaks follow scipy's find_peaks: plateau midpoints, no edge peaks, height inclusive, distance keeps the higher", () => {
  assert.deepEqual(dsp.findPeaks([0, 1, 0, 2, 2, 2, 0, 3, 0]), [1, 4, 7]);
  assert.deepEqual(dsp.findPeaks([5, 0, 1, 0, 2, 2]), [2], "neither the first sample nor a plateau running to the end");
  assert.deepEqual(dsp.findPeaks([0, 2, 0, 3, 0], { height: [0, 2, 0, 3.5, 0] }), [1], "height as an array, compared with >=");
  assert.deepEqual(dsp.findPeaks([0, 1, 0, 3, 0, 0, 0, 0, 0, 2, 0], { distance: 3 }), [3, 9]);
  assert.deepEqual(dsp.findPeaks([0, 1, 0, 3, 0, 2, 0], { distance: 3 }), [3], "the two lower ones are within 3 of the highest");
});

test("the median filter follows scipy's: nearest at the edges, and an even size takes the upper middle", () => {
  assert.deepEqual([...dsp.medianFilter([1, 5, 2, 8, 3], 3)], [1, 2, 5, 3, 3]);
  assert.deepEqual([...dsp.medianFilter([1, 5, 2, 8, 3], 4)], [1, 2, 5, 5, 3]);
});

test("onsets: three decaying hits in light noise are found within 5 ms, at 48 and 44.1 kHz", () => {
  for (const rate of [48000, 44100]) {
    const hits = gaussian(2 * rate, 11, 0.001), at = [0.25, 0.8, 1.31];
    for (const s of at) {
      const i0 = Math.round(s * rate);
      for (let i = 0; i < 0.1 * rate; i++) hits[i0 + i] += 0.5 * Math.sin((2 * Math.PI * 660 * i) / rate) * Math.exp((-30 * i) / rate);
    }
    const { times } = dsp.onsets(hits, rate);
    assert.equal(times.length, 3, `${rate} Hz: ${times}`);
    times.forEach((t, k) => near(t, at[k], 0.005, `${rate} Hz onset ${k}`));
  }
});

test("the windowed cross-correlation equals the direct sum, and a lag is recovered within 0.1 ms either way", () => {
  const rnd = mulberry32(9);
  const a = Float64Array.from({ length: 300 }, () => rnd() - 0.5), b = Float64Array.from({ length: 260 }, () => rnd() - 0.5);
  const c = dsp.correlateWindow(a, b, 20, { block: 64 });
  for (const lag of [-20, -7, 0, 3, 20]) {
    let s = 0;
    for (let n = 0; n < a.length; n++) if (n + lag >= 0 && n + lag < b.length) s += a[n] * b[n + lag];
    near(c[20 + lag], s, 1e-9, `lag ${lag}`);
  }
  const rate = 48000, noise = gaussian(2 * rate, 3, 0.2);
  for (const shift of [1234, -517]) {
    const later = new Float64Array(noise.length).map((_, i) => (i - shift >= 0 && i - shift < noise.length ? 0.5 * noise[i - shift] : 0));
    const { lag, from, corr } = dsp.findLag(noise, later, rate, 2);
    assert.equal(from, "waveform");
    assert.ok(corr > 0.9, `correlation ${corr}`);
    near(lag * 1000, (shift / rate) * 1000, 0.1, `lag of ${shift} samples in ms`);
  }
});

// ---- the command ---------------------------------------------------------------------------------------

test("audio probe: rate, channels, duration, peak and RMS in dBFS, and the EBU reference tone at -23 LUFS", () => {
  const dir = tempDir("pl-audio-");
  const tone = sine(1000, 3, 48000, 10 ** (-23 / 20));
  fs.writeFileSync(path.join(dir, "tone.wav"), wavFile([tone, tone], 48000, { format: "s16" }));
  const r = pl(dir, ["audio", "probe", "tone.wav", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const d = json(r);
  assert.deepEqual([d.rate, d.channels, d.samples, d.duration], [48000, 2, 144000, 3]);
  near(d.lufs, -23, 0.1, "LUFS");
  near(d.peakDb, -23, 0.01, "peak");
  near(d.rmsDb, -26.01, 0.02, "RMS");
  const text = pl(dir, ["audio", "probe", "tone.wav"]);
  assert.match(text.stdout, /-23\.\d LUFS/);
});

test("audio silence finds digital silence, clipping, and a DC offset, and passes ordinary sound", () => {
  const dir = tempDir("pl-audio-"), rate = 48000;
  const cases = {
    "zero.wav": [new Float64Array(rate), 1, (d) => d.silent],
    "clip.wav": [sine(200, 1, rate, 1.5).map((v) => Math.max(-1, Math.min(1, v))), 1, (d) => d.clipped && d.clippedSamples > 100],
    "dc.wav": [sine(200, 1, rate, 0.1).map((v) => v + 0.05), 1, (d) => Math.abs(d.dcOffset[0] - 0.05) < 1e-3],
    "fine.wav": [sine(200, 1, rate, 0.3), 0, (d) => d.problems.length === 0],
  };
  for (const [name, [x, code, check]] of Object.entries(cases)) {
    put(dir, name, x, rate);
    const r = pl(dir, ["audio", "silence", name, "--json"]);
    assert.equal(r.status, code, `${name}: ${r.stdout}${r.stderr}`);
    assert.ok(check(json(r)), `${name}: ${r.stdout}`);
  }
  const gap = Float64Array.from([...new Float64Array(rate / 4), ...sine(300, 0.5, rate, 0.3), ...new Float64Array(rate / 2)]);
  put(dir, "gap.wav", gap, rate);
  const d = json(pl(dir, ["audio", "silence", "gap.wav", "--json"]));
  near(d.leadingSilence, 0.25, 0.021, "leading silence");
  near(d.trailingSilence, 0.5, 0.021, "trailing silence");
  assert.equal(pl(dir, ["audio", "silence", "zero.wav", "--expect-silent"]).status, 0);
  assert.equal(pl(dir, ["audio", "silence", "fine.wav", "--expect-silent"]).status, 1);
});

test("audio pitch gates against a frequency or a time,hz curve, and a wrong expectation fails", () => {
  const dir = tempDir("pl-audio-"), rate = 48000, seconds = 3;
  // a sweep from 60 to 240 Hz whose second and third harmonics are louder than the fundamental
  const f0 = (i) => 60 * 4 ** (i / rate / seconds);
  let ph = 0;
  const x = new Float64Array(seconds * rate);
  for (let i = 0; i < x.length; i++) { ph += (2 * Math.PI * f0(i)) / rate; x[i] = 0.2 * Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph); }
  put(dir, "engine.wav", x, rate);
  fs.writeFileSync(path.join(dir, "f0.csv"), "time,hz\n" + Array.from({ length: 301 }, (_, k) => `${(k / 100).toFixed(2)},${f0(k * 480).toFixed(4)}`).join("\n") + "\n");
  const r = pl(dir, ["audio", "pitch", "engine.wav", "--expect-csv", "f0.csv", "--tolerance", "2", "--max-error-pct", "0.5", "--min-share", "0.95", "--fmax", "600", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = json(r);
  assert.ok(d.expected.medianErrorPct < 0.5, `median error ${d.expected.medianErrorPct} %`);
  assert.equal(d.gate.passed, true);
  put(dir, "a220.wav", sine(220, 1, rate, 0.5), rate);
  const tone = json(pl(dir, ["audio", "pitch", "a220.wav", "--expect-hz", "220", "--max-error-pct", "0.5", "--json"]));
  near(tone.medianHz, 220, 1.1, "median of a 220 Hz tone");
  const wrong = pl(dir, ["audio", "pitch", "engine.wav", "--expect-hz", "500", "--max-error-pct", "1", "--fmax", "600"]);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /GATE FAILED/);
});

test("audio onsets matches expected times and gates on the missed and the extra", () => {
  const dir = tempDir("pl-audio-"), rate = 48000;
  const hits = gaussian(2 * rate, 4, 0.001);
  for (const s of [0.25, 0.8, 1.31]) {
    const i0 = Math.round(s * rate);
    for (let i = 0; i < 4800; i++) hits[i0 + i] += 0.5 * Math.sin((2 * Math.PI * 660 * i) / rate) * Math.exp((-30 * i) / rate);
  }
  put(dir, "hits.wav", hits, rate);
  const ok = pl(dir, ["audio", "onsets", "hits.wav", "--expect-times", "0.25,0.8,1.31", "--max-offset-ms", "5", "--max-missed", "0", "--max-extra", "0", "--json"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(json(ok).expected.matched, 3);
  const bad = json(pl(dir, ["audio", "onsets", "hits.wav", "--expect-times", "0.25,0.5,0.8", "--max-missed", "0", "--json"]));
  assert.deepEqual(bad.expected.missed, [0.5]);
  assert.equal(bad.expected.extra.length, 1);
  assert.equal(bad.gate.passed, false);
});

test("audio compare: lag, level, spectral distance, octave bands, envelope, and the envelope fallback", () => {
  const dir = tempDir("pl-audio-"), rate = 48000, n = 2 * rate;
  const swell = (i, shift = 0) => 0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * (i / rate - shift));
  const noise = gaussian(n, 3, 0.2).map((v, i) => v * swell(i));
  put(dir, "a.wav", noise, rate);
  const late = new Float64Array(n).map((_, i) => (i >= 2400 ? 0.5 * noise[i - 2400] : 0));
  put(dir, "b.wav", late, rate);
  const r = pl(dir, ["audio", "compare", "a.wav", "b.wav", "--max-lsd", "1", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const d = json(r);
  near(d.lagMs, 50, 0.1, "lag");
  near(d.levelDb, -6.02, 0.1, "level");
  assert.equal(d.lagFrom, "waveform");
  assert.ok(d.lsdDb < 0.5, `LSD ${d.lsdDb}`);
  assert.ok(d.envelopeCorrelation > 0.99, `envelope ${d.envelopeCorrelation}`);
  const gated = json(pl(dir, ["audio", "compare", "a.wav", "b.wav", "--max-lag-ms", "10", "--max-level-db", "1", "--json"]));
  assert.equal(gated.gate.failed.length, 2);

  // a low-passed copy: the high octaves fall away, the low ones stay, and the timbre is far
  const dull = new Float64Array(n);
  const k = Math.tan((Math.PI * 1000) / rate), q = Math.SQRT1_2, norm = 1 / (1 + k / q + k * k);
  const [b0, b1, b2, a1, a2] = [k * k * norm, 2 * k * k * norm, k * k * norm, 2 * (k * k - 1) * norm, (1 - k / q + k * k) * norm];
  let z1 = 0, z2 = 0;
  for (let i = 0; i < n; i++) { const y = b0 * noise[i] + z1; z1 = b1 * noise[i] - a1 * y + z2; z2 = b2 * noise[i] - a2 * y; dull[i] = y; }
  put(dir, "dull.wav", dull, rate);
  const lp = json(pl(dir, ["audio", "compare", "a.wav", "dull.wav", "--json"]));
  assert.ok(lp.bandsDb["8000"] < -20, `8 kHz ${lp.bandsDb["8000"]}`);
  assert.ok(Math.abs(lp.bandsDb["250"]) < 1, `250 Hz ${lp.bandsDb["250"]}`);
  assert.ok(lp.lsdDb > 5, `LSD ${lp.lsdDb}`);

  // different noise with the same swell 30 ms later: the waveforms do not correlate, the envelopes do
  const other = gaussian(n, 4, 0.2).map((v, i) => v * swell(i, 0.03));
  put(dir, "other.wav", other, rate);
  const env = json(pl(dir, ["audio", "compare", "a.wav", "other.wav", "--json"]));
  assert.equal(env.lagFrom, "envelope");
  near(env.lagMs, 30, 8, "envelope lag");

  // B at another rate is resampled to A's first
  put(dir, "b16.wav", dsp.resamplePoly(late, 1, 3), 16000);
  const rs = json(pl(dir, ["audio", "compare", "a.wav", "b16.wav", "--json"]));
  near(rs.lagMs, 50, 0.1, "lag after resampling");
  assert.ok(rs.notes.some((x) => /resampled from 16000 to 48000/.test(x)), rs.notes.join("; "));
});

test("audio spectrogram draws one panel per sound on one time and level scale, with the pitch track", () => {
  const dir = tempDir("pl-audio-"), rate = 48000;
  // on bin centres of the 4096-point frames (48000 / 4096 = 11.71875 Hz), so neither loses level between bins
  put(dir, "a.wav", sine(468.75, 1.5, rate, 0.5), rate);
  put(dir, "b.wav", sine(703.125, 1, rate, 0.25), rate);
  const r = pl(dir, ["audio", "spectrogram", "a.wav", "b.wav", "--pitch", "--out", "out", "--max-width", "1200", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const d = json(r);
  assert.equal(d.panels.length, 2);
  const img = decodePng(fs.readFileSync(d.sheet));
  assert.ok(img.width <= 1200 && img.height > 600, `${img.width}x${img.height}`);
  assert.equal(fs.realpathSync(path.dirname(d.sheet)), fs.realpathSync(path.join(dir, "out")));
  // one level scale: the quieter tone's loudest bin sits 6 dB under the louder one's
  near(d.panels[0].loudestBinDb, 0, 1e-9, "the louder sound");
  near(d.panels[1].loudestBinDb, -6.02, 0.1, "half the amplitude");
  const one = json(pl(dir, ["audio", "spectrogram", "a.wav", "--json"]));
  assert.equal(path.basename(one.sheet), "a.spectrogram.png");
  assert.equal(path.basename(path.dirname(one.sheet)), "sounds", "a file given by path goes to runs/audio/sounds/");
});

test("the spectrogram draws a click at its own time: frames sit at their centres", () => {
  const dir = tempDir("pl-audio-"), rate = 48000;
  const x = gaussian(2 * rate, 8, 1e-4);
  for (let i = 0; i < 4; i++) x[rate + i] += 0.8 * (i % 2 ? -1 : 1);
  put(dir, "click.wav", x, rate);
  const d = json(pl(dir, ["audio", "spectrogram", "click.wav", "--out", "out", "--max-width", "1000", "--json"]));
  const img = decodePng(fs.readFileSync(d.sheet)), { plot } = d.panels[0];
  // the brightest column over the top third of the plot (above about 2 kHz), where only the click has energy
  let best = -1, at = -1;
  for (let c = 0; c < plot.width; c++) {
    let s = 0;
    for (let yy = plot.y; yy < plot.y + plot.height / 3; yy++) { const i = (yy * img.width + plot.x + c) * img.channels; s += img.data[i] + img.data[i + 1] + img.data[i + 2]; }
    if (s > best) { best = s; at = c; }
  }
  near(at * d.secondsPerPixel, 1, 2 * d.secondsPerPixel, "the click's column in seconds");
});

test("a sound that is not a WAV needs ffmpeg: exit 2 naming the remedies when it is missing", () => {
  const dir = tempDir("pl-audio-");
  fs.writeFileSync(path.join(dir, "x.flac"), Buffer.from("fLaC\0\0\0\x22 not really"));
  const r = pl(dir, ["audio", "probe", "x.flac"], { PL_FFMPEG: path.join(dir, "no-ffmpeg-here") });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /brew install ffmpeg/);
  assert.match(r.stderr, /PL_FFMPEG/);
  assert.match(r.stderr, /WAV/);
});

test("a FLAC file and a video's sound track are read through ffmpeg", { skip: !hasFfmpeg }, () => {
  const dir = tempDir("pl-audio-"), rate = 44100;
  const tone = sine(1000, 2, rate, 10 ** (-23 / 20));
  fs.writeFileSync(path.join(dir, "src.wav"), wavFile([tone, tone], rate, { format: "s16" }));
  const enc = (args) => spawnSync("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args], { cwd: dir });
  assert.equal(enc(["-i", "src.wav", "tone.flac"]).status, 0);
  const d = json(pl(dir, ["audio", "probe", "tone.flac", "--json"]));
  assert.deepEqual([d.rate, d.channels], [rate, 2]);
  near(d.duration, 2, 0.001, "duration");
  near(d.lufs, -23, 0.1, "LUFS through ffmpeg");
  assert.equal(enc(["-f", "lavfi", "-i", "color=c=gray:s=64x48:r=10:d=2", "-i", "src.wav", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", "clip.mp4"]).status, 0);
  const v = json(pl(dir, ["audio", "probe", "clip.mp4", "--json"]));
  near(v.lufs, -23, 0.3, "LUFS of a video's AAC track");
});

test("a shot's sound is <source>.wav in the shot folder", () => {
  const dir = tempDir("pl-audio-");
  assert.equal(pl(dir, ["init", "--candidate", "build", "--reference", "ref"]).status, 0);
  assert.equal(pl(dir, ["new-shot", "engine"]).status, 0);
  const shot = path.join(dir, ".agents", "perceptual", "shots", "engine");
  put(shot, "ref.wav", sine(220, 1, 48000, 0.5), 48000);
  put(shot, "build.wav", sine(220, 1, 48000, 0.25), 48000);
  const d = json(pl(dir, ["audio", "compare", "--shot", "engine", "--json"]));
  near(d.levelDb, -6.02, 0.05, "build against ref");
  const missing = pl(dir, ["audio", "probe", "--shot", "engine", "--source", "nope"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /no sound of source 'nope'/);
});
