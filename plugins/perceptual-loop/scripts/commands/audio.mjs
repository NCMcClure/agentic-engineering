// audio: sound as numbers and pictures an agent can check. An agent cannot
// listen, but it can measure, and it can look: a spectrogram is a picture of
// a sound. A sound is a file (a WAV read directly; anything else, a video's
// sound track included, through ffmpeg) or a shot's sound, <source>.wav in the
// shot folder. Only the spectrogram writes a file; the rest print, or --json.
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { envelope, findLag, frameCount, loudness, onsets, pearson, resamplePoly, spectralCompare, stftPower, yin } from "../lib/dsp.mjs";
import { CELL_H, drawText, fitText, textWidth } from "../lib/font.mjs";
import { median } from "../lib/metrics.mjs";
import { findRoot, loadConfig, runsDir, shotPath } from "../lib/project.mjs";
import { canvas, DIM, FG, fillRect, GAP, pad, stack } from "../lib/raster.mjs";
import { bar, MAX_WIDTH, saveSheet } from "../lib/sheets.mjs";
import { mono, readSound, soundOf } from "../lib/wav.mjs";
import { readTable } from "./sweep.mjs";

const HELP = `usage: pl.mjs audio <command> [SOUND ...] [--json]

  probe SOUND                       rate, channels, duration, peak and RMS in dBFS, integrated loudness in LUFS
  silence SOUND [--silence-db DB] [--clip-level V] [--max-dc V] [--expect-silent]
                                    the cheap checks first: silent, clipped, a DC offset, leading and trailing silence
  pitch SOUND [--fmin HZ] [--fmax HZ] [--min-confidence C] [--expect-hz F | --expect-csv FILE]
        [--tolerance PCT] [--max-error-pct P] [--min-share S]
                                    the fundamental every 10 ms by YIN, against a frequency or a time,hz curve
  onsets SOUND [--sensitivity V] [--min-gap S] [--expect-times T,T,... | --expect-csv FILE]
         [--tolerance-ms MS] [--max-offset-ms MS] [--max-missed N] [--max-extra N]
                                    when sounds start (spectral flux), against the times they should
  compare [A B] [--max-search-ms MS] [--max-lag-ms MS] [--max-level-db DB] [--max-lsd DB] [--min-envelope-corr V]
                                    B against A: lag, level, log-spectral distance, octave bands, envelope
  spectrogram [SOUND ...] [--pitch] [--lowest HZ] [--range DB] [--name FILE]
                                    one panel per sound on one time and one level scale, log frequency, with axes

A SOUND is a WAV file (PCM or float), anything ffmpeg reads (a FLAC, an MP3, a video's sound track), or a
shot's sound with --shot NAME [--source ID]: <source>.wav in the shot folder (default source: the first
candidate). compare --shot measures --source (B) against --against (A, default the reference);
spectrogram --shot draws --source, under --against when one is given.

  --out DIR        where the spectrogram goes (default runs/<run>/<shot>/, or runs/<run>/sounds/)
  --run NAME       the run folder under runs/ (default audio)
  --max-width PX   the sheet's largest width (default ${MAX_WIDTH}); --jpeg, --quality Q as for sheets

What the numbers mean:
  LUFS      integrated loudness after ITU-R BS.1770-4: K-weighting, 400 ms blocks, the -70 LUFS and -10 LU
            gates. Peak is the largest sample, not the true peak between samples. Loudness says nothing of the mix.
  pitch     one fundamental per frame by YIN, with a confidence (1 is cleanly periodic). A chord, two engines,
            or noise give a low confidence or a wrong value; octaveErrors says how often the track sat an
            octave from the expectation. An engine fires at rpm / 60 x cylinders / 2 (four-stroke).
  onsets    starts that add energy somewhere in the spectrum, to a few ms; not slow swells, not pitch changes.
  lag       how much later B is than A, by cross-correlation: sub-sample from the waveforms, or a few ms from
            the 1 ms loudness envelopes when the waveforms do not correlate (two renderings of one event).
  level     RMS of B over RMS of A in dB (-6.02 is half the amplitude).
  LSD       log-spectral distance in dB after aligning and level matching, floored 80 dB under A's loudest
            bin: 0 is the same spectrum over time, about 1 is hard to hear, above 3 a different timbre. Two
            recordings of noise never reach 0: compare runs with runs, not with zero.
  bands     B - A per octave band in dB, level included: where a difference in tone sits.
  envelope  correlation of the 10 ms loudness envelopes after alignment: does it swell and fall alike.
None of them says which sound is right or whether a listener would mind. Look at the spectrogram, and
queue the listening for the owner.

Exit codes: 0 done (gates passed, silence found nothing), 1 a gate failed or silence found a problem,
2 usage or environment (no ffmpeg, no such file).`;

const FLAGS = {
  shot: { type: "string" }, source: { type: "string" }, against: { type: "string" },
  out: { type: "string" }, run: { type: "string", default: "audio" },
  "max-width": { type: "int", default: MAX_WIDTH }, jpeg: { type: "bool" }, quality: { type: "int", default: 90 }, json: { type: "bool" },
  "silence-db": { type: "float", default: -60 }, "clip-level": { type: "float", default: 0.999 }, "max-dc": { type: "float", default: 0.005 },
  "expect-silent": { type: "bool" },
  fmin: { type: "float", default: 50 }, fmax: { type: "float", default: 1000 }, "min-confidence": { type: "float", default: 0.8 },
  "expect-hz": { type: "float" }, "expect-csv": { type: "string" }, tolerance: { type: "float", default: 3 },
  "max-error-pct": { type: "float" }, "min-share": { type: "float" },
  sensitivity: { type: "float", default: 0.1 }, "min-gap": { type: "float", default: 0.05 }, "expect-times": { type: "string" },
  "tolerance-ms": { type: "float", default: 50 }, "max-offset-ms": { type: "float" }, "max-missed": { type: "int" }, "max-extra": { type: "int" },
  "max-search-ms": { type: "float", default: 2000 }, "max-lag-ms": { type: "float" }, "max-level-db": { type: "float" },
  "max-lsd": { type: "float" }, "min-envelope-corr": { type: "float" },
  pitch: { type: "bool" }, lowest: { type: "float", default: 30 }, range: { type: "float", default: 80 }, name: { type: "string" },
};

const safe = (name) => String(name).replace(/[^A-Za-z0-9_.-]/g, "_");
const stemOf = (p) => safe(path.basename(String(p)).replace(/\.[^.]+$/, "") || "sound");
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const r = (v, n = 3) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(n)));
const signed = (v, n) => `${v >= 0 ? "+" : ""}${v.toFixed(n)}`;

/** The sound a command reads: a file given by path, or a shot's sound of --source (role "against": --against, default the reference). */
function soundInput(opts, given = null, role = "source") {
  const root = findRoot();
  if (given) return { file: path.resolve(given), name: path.basename(given), shot: null, stem: stemOf(given), root };
  if (!opts.shot) throw new PlError("give a sound file, or --shot NAME [--source ID]");
  const config = loadConfig(root, { required: true });
  const source = role === "against" ? opts.against ?? config.reference : opts.source ?? config.candidates[0];
  const dir = shotPath(opts.shot, root, config);
  if (!fs.existsSync(dir)) throw new PlError(`no such shot: ${opts.shot} (looked in ${path.dirname(dir)})`);
  const file = soundOf(dir, source);
  if (!file) throw new PlError(`shot '${opts.shot}' has no sound of source '${source}' (looked for ${source}.wav in ${dir})`);
  return { file, name: `${opts.shot} ${source}`, shot: opts.shot, stem: safe(source), root };
}

/** The one sound of probe, silence, pitch, and onsets. */
function oneSound(opts, what) {
  if (opts._.length > 1) throw new PlError(`audio ${what} takes one sound`);
  const input = soundInput(opts, opts._[0] ?? null);
  return { input, sound: readSound(input.file) };
}

function peakRms(data) {
  let peak = 0, sum = 0, n = 0;
  for (const ch of data) for (const v of ch) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; n++; }
  return { peak, rms: Math.sqrt(sum / n) };
}

// ---- probe and silence ------------------------------------------------------------------------

function cmdProbe(opts) {
  const { input, sound } = oneSound(opts, "probe");
  const { peak, rms } = peakRms(sound.data);
  const loud = loudness(sound.data, sound.rate);
  const doc = {
    file: input.file, rate: sound.rate, channels: sound.channels, samples: sound.frames, duration: r(sound.frames / sound.rate, 4), format: sound.format,
    peakDb: r(db(peak), 2), rmsDb: r(db(rms), 2), lufs: r(loud, 2),
    ...(loud === null ? { lufsNote: "shorter than one 0.4 s block" } : loud === -Infinity ? { lufsNote: "every block under -70 LUFS: silent" } : {}),
    loudnessMethod: "ITU-R BS.1770-4, K-weighted, gated; sample peak, not true peak",
  };
  const loudText = loud === null ? "n/a (shorter than 0.4 s)" : loud === -Infinity ? "below -70 (silent)" : `${loud.toFixed(1)} LUFS`;
  const text = `${input.file}\n  ${sound.rate} Hz  ${sound.channels} ch  ${(sound.frames / sound.rate).toFixed(3)} s  ${sound.format}`
    + `\n  peak ${db(peak).toFixed(2)} dBFS   RMS ${db(rms).toFixed(2)} dBFS   integrated loudness ${loudText}`;
  return [doc, text, 0];
}

function cmdSilence(opts) {
  const { input, sound } = oneSound(opts, "silence");
  const { rate, data } = sound, m = mono(sound);
  const win = Math.max(1, Math.floor(0.02 * rate)), n = Math.floor(m.length / win);
  const quiet = [];
  for (let k = 0; k < Math.max(1, n); k++) {
    const end = n ? (k + 1) * win : m.length;
    let s = 0;
    for (let i = k * win; i < end; i++) s += m[i] * m[i];
    quiet.push(db(Math.sqrt(s / (end - k * win))) < opts.silenceDb);
  }
  const loudIdx = quiet.flatMap((q, k) => (q ? [] : [k]));
  // a run of full-scale samples is a flat top; a single one is a peak that touches the ceiling
  let hot = 0, clipped = false;
  for (const ch of data) {
    let run = 0;
    for (const v of ch) { if (Math.abs(v) >= opts.clipLevel) { hot++; if (++run >= 3) clipped = true; } else run = 0; }
  }
  const dc = data.map((ch) => { let s = 0; for (const v of ch) s += v; return s / ch.length; });
  const { peak, rms } = peakRms(data);
  const silent = db(rms) < opts.silenceDb;
  let problems = [];
  if (silent) problems.push(`silent (RMS ${db(rms).toFixed(1)} dBFS < ${opts.silenceDb})`);
  if (clipped) problems.push(`clipped (${hot} samples at full scale, in runs of 3 or more)`);
  const worstDc = dc.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  if (Math.abs(worstDc) > opts.maxDc) problems.push(`DC offset ${signed(worstDc, 4)} (> ${opts.maxDc})`);
  if (opts.expectSilent) problems = silent ? [] : [`expected silence, but RMS is ${db(rms).toFixed(1)} dBFS`];
  const frames = quiet.length, quietShare = quiet.filter(Boolean).length / frames;
  const doc = {
    file: input.file, rmsDb: r(db(rms), 2), peakDb: r(db(peak), 2), silent, silentShare: r(quietShare, 4),
    leadingSilence: r(((loudIdx.length ? loudIdx[0] : frames) * win) / rate, 3), trailingSilence: r(((loudIdx.length ? frames - 1 - loudIdx.at(-1) : frames) * win) / rate, 3),
    clipped, clippedSamples: hot, dcOffset: dc.map((v) => r(v, 5)), problems, gate: { passed: !problems.length, failed: problems },
  };
  const text = [
    `${input.file}`,
    `  RMS ${db(rms).toFixed(1)} dBFS   peak ${doc.peakDb} dBFS   quiet ${Math.round(quietShare * 100)} % of the time (under ${opts.silenceDb} dBFS)`
      + `   leading ${doc.leadingSilence} s   trailing ${doc.trailingSilence} s`,
    `  samples at full scale: ${hot}   DC offset: ${doc.dcOffset.join(", ")}`,
    ...(problems.length ? problems.map((p) => `  FOUND: ${p}`) : [`  ok: ${opts.expectSilent ? "silent, as expected" : "not silent, not clipped, no DC offset"}`]),
  ].join("\n");
  return [doc, text, problems.length ? 1 : 0];
}

// ---- pitch and onsets ----------------------------------------------------------------------------

/** Rows of time,hz from a CSV or JSONL file, sorted by time. */
function readCurve(file) {
  const [t, hz] = Object.values(readTable(path.resolve(file)));
  if (!hz) throw new PlError(`${file}: expected rows of time,hz`);
  const rows = t.map((v, i) => [v, hz[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
  if (!rows.length) throw new PlError(`${file}: expected rows of time,hz`);
  return rows;
}

/** numpy's interp: linear between the points, the end values outside them. */
function interp(t, rows) {
  if (t <= rows[0][0]) return rows[0][1];
  if (t >= rows.at(-1)[0]) return rows.at(-1)[1];
  let i = 1;
  while (rows[i][0] < t) i++;
  const [t0, v0] = rows[i - 1], [t1, v1] = rows[i];
  return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

function cmdPitch(opts) {
  const { input, sound } = oneSound(opts, "pitch");
  if (opts.expectHz !== undefined && opts.expectCsv) throw new PlError("give one of --expect-hz and --expect-csv");
  if (!(opts.fmin > 0 && opts.fmax > opts.fmin && opts.fmax < sound.rate / 2)) throw new PlError(`--fmin and --fmax want 0 < fmin < fmax < ${sound.rate / 2} Hz`);
  const { times, hz, confidence } = yin(mono(sound), sound.rate, { fmin: opts.fmin, fmax: opts.fmax });
  const voiced = [...hz].map((v, i) => Number.isFinite(v) && confidence[i] >= opts.minConfidence);
  const vhz = [...hz].filter((_, i) => voiced[i]);
  const doc = {
    file: input.file, method: "YIN, 10 ms hop", frames: times.length, voicedShare: r(times.length ? vhz.length / times.length : 0, 4),
    medianHz: vhz.length ? r(median(vhz), 3) : null, minHz: vhz.length ? r(vhz.reduce((a, b) => Math.min(a, b)), 3) : null,
    maxHz: vhz.length ? r(vhz.reduce((a, b) => Math.max(a, b)), 3) : null,
  };
  const failed = [];
  const lines = [`${input.file}`, `  pitch (YIN): ${vhz.length} of ${times.length} frames periodic (confidence >= ${opts.minConfidence})`
    + (vhz.length ? `   median ${doc.medianHz} Hz   range ${doc.minHz}..${doc.maxHz} Hz` : "")];
  if (opts.expectHz !== undefined || opts.expectCsv) {
    const curve = opts.expectCsv ? readCurve(opts.expectCsv) : null;
    const ratios = [];
    times.forEach((t, i) => {
      if (!voiced[i] || (curve && (t < curve[0][0] || t > curve.at(-1)[0]))) return;
      ratios.push(hz[i] / (curve ? interp(t, curve) : opts.expectHz));
    });
    if (!ratios.length) {
      failed.push("no periodic frame to compare with the expected pitch");
      doc.expected = { frames: 0 };
    } else {
      const err = ratios.map((q) => Math.abs(q - 1) * 100);
      // an octave off: the usual way a pitch tracker is wrong
      const octave = ratios.filter((q) => Math.abs(Math.abs(Math.log2(q)) - 1) < 0.06).length / ratios.length;
      const e = doc.expected = {
        frames: ratios.length, medianErrorPct: r(median(err), 3), withinTolerance: r(err.filter((v) => v <= opts.tolerance).length / err.length, 4),
        tolerancePct: opts.tolerance, octaveErrors: r(octave, 4), medianRatio: r(median(ratios), 5),
      };
      lines.push(`  against the expected pitch: median error ${e.medianErrorPct} %   ${(e.withinTolerance * 100).toFixed(1)} % of ${e.frames} frames within +-${opts.tolerance} %`
        + `   median ratio ${e.medianRatio}${octave > 0.05 ? `   (${Math.round(octave * 100)} % of frames an octave off: the tracker, or the signal?)` : ""}`);
      if (opts.maxErrorPct !== undefined && e.medianErrorPct > opts.maxErrorPct) failed.push(`median pitch error ${e.medianErrorPct} % > --max-error-pct ${opts.maxErrorPct}`);
      if (opts.minShare !== undefined && e.withinTolerance < opts.minShare) {
        failed.push(`only ${(e.withinTolerance * 100).toFixed(1)} % of frames within +-${opts.tolerance} % (< --min-share ${opts.minShare})`);
      }
    }
  }
  doc.gate = { passed: !failed.length, failed };
  doc.track = { t: [...times].map((v) => r(v, 3)), hz: [...hz].map((v) => r(v, 2)), confidence: [...confidence].map((v) => r(v, 3)) };
  return [doc, [...lines, ...failed.map((f) => `  GATE FAILED: ${f}`)].join("\n"), failed.length ? 1 : 0];
}

function expectedTimes(opts) {
  if (opts.expectTimes !== undefined && opts.expectCsv) throw new PlError("give one of --expect-times and --expect-csv");
  if (opts.expectTimes !== undefined) {
    const want = opts.expectTimes.split(",").map((v) => Number(v.trim()));
    if (want.some((v) => !Number.isFinite(v))) throw new PlError(`--expect-times '${opts.expectTimes}': write seconds, comma separated`);
    return want;
  }
  return opts.expectCsv ? Object.values(readTable(path.resolve(opts.expectCsv)))[0].filter(Number.isFinite) : null;
}

function cmdOnsets(opts) {
  const { input, sound } = oneSound(opts, "onsets");
  const want = expectedTimes(opts);
  const { times, strength } = onsets(mono(sound), sound.rate, { sensitivity: opts.sensitivity, minGap: opts.minGap });
  const doc = { file: input.file, method: "spectral flux", onsets: times.map((v) => r(v, 4)), strength: strength.map((v) => r(v, 3)) };
  const lines = [`${input.file}`, `  ${times.length} onsets at (s): ${times.map((v) => v.toFixed(3)).join(", ") || "none"}`];
  const failed = [];
  if (want) {
    const free = [...times], matched = [], missed = [];
    for (const w of want) {
      // each expected time takes the nearest free onset within the tolerance
      let best = -1;
      free.forEach((v, i) => { if (best < 0 || Math.abs(v - w) < Math.abs(free[best] - w)) best = i; });
      if (best >= 0 && Math.abs(free[best] - w) * 1000 <= opts.toleranceMs) matched.push([w, free.splice(best, 1)[0]]);
      else missed.push(w);
    }
    const off = matched.map(([a, b]) => Math.abs(b - a) * 1000), mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
    const e = doc.expected = {
      matched: matched.length, missed: missed.map((v) => r(v, 4)), extra: free.map((v) => r(v, 4)),
      meanOffsetMs: off.length ? r(mean(off), 2) : null, maxOffsetMs: off.length ? r(Math.max(...off), 2) : null,
      meanSignedOffsetMs: off.length ? r(mean(matched.map(([a, b]) => (b - a) * 1000)), 2) : null, toleranceMs: opts.toleranceMs,
    };
    lines.push(`  against ${want.length} expected: ${matched.length} matched within +-${opts.toleranceMs} ms`
      + (off.length ? ` (mean offset ${e.meanOffsetMs} ms, largest ${e.maxOffsetMs} ms, signed mean ${signed(e.meanSignedOffsetMs, 2)} ms: + is late)` : "")
      + `   missed ${missed.length ? e.missed.join(", ") : "none"}   extra ${free.length ? e.extra.join(", ") : "none"}`);
    if (opts.maxOffsetMs !== undefined && off.length && Math.max(...off) > opts.maxOffsetMs) failed.push(`largest onset offset ${Math.max(...off).toFixed(1)} ms > --max-offset-ms ${opts.maxOffsetMs}`);
    if (opts.maxMissed !== undefined && missed.length > opts.maxMissed) failed.push(`${missed.length} expected onsets missed (> --max-missed ${opts.maxMissed})`);
    if (opts.maxExtra !== undefined && free.length > opts.maxExtra) failed.push(`${free.length} onsets not expected (> --max-extra ${opts.maxExtra})`);
  }
  doc.gate = { passed: !failed.length, failed };
  return [doc, [...lines, ...failed.map((f) => `  GATE FAILED: ${f}`)].join("\n"), failed.length ? 1 : 0];
}

// ---- compare ----------------------------------------------------------------------------------------

function rmsOf(x) { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); }

function cmdCompare(opts) {
  let ia, ib;
  if (opts._.length === 2) [ia, ib] = opts._.map((p) => soundInput(opts, p));
  else if (!opts._.length && opts.shot) [ia, ib] = [soundInput(opts, null, "against"), soundInput(opts, null)];
  else throw new PlError("audio compare: give two sounds (A the reference, B the candidate), or --shot NAME [--source ID] [--against ID]");
  const sa = readSound(ia.file), sb = readSound(ib.file);
  const notes = [], rate = sa.rate, a = mono(sa);
  let b = mono(sb);
  if (sb.rate !== rate) { b = resamplePoly(b, rate, sb.rate); notes.push(`B resampled from ${sb.rate} to ${rate} Hz`); }
  const level = db(rmsOf(b)) - db(rmsOf(a));
  const { lag, corr, from } = findLag(a, b, rate, opts.maxSearchMs / 1000);
  if (from === "envelope") notes.push("the waveforms do not correlate (different renderings?): lag read from the loudness envelopes, good to a few ms");
  const s = Math.round(lag * rate);
  // Math.max: a negative end would count from the far end of the array, not mean "nothing"
  const a2 = s >= 0 ? a.subarray(0, Math.max(0, a.length - s)) : a.subarray(-s), b2 = s >= 0 ? b.subarray(s) : b.subarray(0, Math.max(0, b.length + s));
  const n = Math.min(a2.length, b2.length);
  if (n < 2048) throw new PlError("audio compare: less than 2048 samples overlap after alignment");
  // aligned and level-matched: what is left is the shape of the sound
  const gain = 10 ** (-level / 20), an = a2.subarray(0, n), bn = new Float32Array(n);
  for (let i = 0; i < n; i++) bn[i] = b2[i] * gain;
  const { lsd, bands } = spectralCompare(an, bn, rate, level);
  const env = pearson(envelope(an, rate).values, envelope(bn, rate).values);
  if (env === null) notes.push("an envelope is flat: no envelope correlation");
  const failed = [["|lag| ms", Math.abs(lag * 1000), opts.maxLagMs], ["|level difference| dB", Math.abs(level), opts.maxLevelDb], ["log-spectral distance dB", lsd, opts.maxLsd]]
    .filter(([, got, want]) => want !== undefined && got > want).map(([name, got, want]) => `${name} ${got.toFixed(3)} > ${want}`);
  if (opts.minEnvelopeCorr !== undefined && (env === null || env < opts.minEnvelopeCorr)) failed.push(`envelope correlation ${env === null ? "n/a" : env.toFixed(3)} < ${opts.minEnvelopeCorr}`);
  const doc = {
    a: ia.file, b: ib.file, lagMs: r(lag * 1000, 3), lagFrom: from, lagCorrelation: r(corr, 4), levelDb: r(level, 3), lsdDb: r(lsd, 3),
    bandsDb: Object.fromEntries(Object.entries(bands).map(([k, v]) => [k, r(v, 2)])), envelopeCorrelation: r(env, 4), overlapSeconds: r(n / rate, 3),
    notes, gate: { passed: !failed.length, failed },
  };
  const text = [
    `B = ${ib.file}`, `A = ${ia.file}   (B is measured against A)`,
    `  lag ${signed(lag * 1000, 2)} ms (+ is B later; from the ${from}, correlation ${corr.toFixed(3)})   level ${signed(level, 2)} dB (+ is B louder)`,
    `  after aligning and level matching: log-spectral distance ${lsd.toFixed(2)} dB   envelope correlation ${env === null ? "n/a" : env.toFixed(3)}`,
    `  octave bands, B - A (dB): ${Object.entries(bands).sort(([p], [q]) => p - q).map(([k, v]) => `${k}: ${signed(v, 1)}`).join("  ")}`,
    ...notes.map((x) => `  note: ${x}`), ...failed.map((x) => `  GATE FAILED: ${x}`),
    `  look: pl.mjs audio spectrogram ${JSON.stringify(ia.file)} ${JSON.stringify(ib.file)}`,
  ].join("\n");
  return [doc, text, failed.length ? 1 : 0];
}

// ---- spectrogram --------------------------------------------------------------------------------------

const ROWS = 380, SCALE = 2, LINE_H = CELL_H * SCALE + 6;
const LEFT = 12 + textWidth("20k Hz", SCALE), RIGHT = 14, TOP = LINE_H + 4, BOTTOM = 2 * LINE_H + 6;
const MAGMA = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
const TRACK = [90, 255, 235];
const FREQ_TICKS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const TIME_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, Infinity];

/**
 * Level in dB per pixel row (log frequency from `lowest` to 20 kHz or Nyquist) and column (time) of x, with the
 * loudest bin of the whole sound. About 85 ms frames, 12 Hz bins, enough to part low harmonics. A row wider than
 * a bin keeps its loudest bin, so a thin harmonic is not skipped; a column of several frames keeps the loudest.
 * A frame belongs to the column its centre falls in, so a click is drawn at its own time, not 40 ms early; a
 * column no centre falls in (the first and last half frame, or more columns than frames) shows the nearest frame.
 */
function levels(x, rate, { columns, lowest }) {
  const nfft = 2 ** Math.round(Math.log2(rate * 0.085)), bins = nfft / 2 + 1;
  const hop = Math.max(1, Math.min(nfft / 8, Math.floor(x.length / 1200) || 1));
  const frames = frameCount(x.length, nfft, hop), fmax = Math.min(rate / 2, 20000), binHz = rate / nfft;
  const edges = Float64Array.from({ length: ROWS + 1 }, (_, i) => (lowest * (fmax / lowest) ** (i / ROWS)) / binHz);
  const target = Array.from({ length: frames }, () => []), dur = x.length / rate;
  const frameAt = (t) => (t * rate - nfft / 2) / hop; // the frame whose centre is at t, as a fraction
  for (let c = 0; c < columns; c++) {
    const t0 = (c * dur) / columns, t1 = ((c + 1) * dur) / columns;
    const f0 = Math.max(0, Math.ceil(frameAt(t0))), f1 = Math.min(frames - 1, Math.ceil(frameAt(t1)) - 1);
    if (f1 >= f0) for (let f = f0; f <= f1; f++) target[f].push(c);
    else target[Math.max(0, Math.min(frames - 1, Math.round(frameAt((t0 + t1) / 2))))].push(c);
  }
  const img = new Float64Array(ROWS * columns).fill(-Infinity), row = new Float64Array(ROWS), level = new Float64Array(bins);
  let top = -Infinity;
  stftPower(x, nfft, hop, (p, f) => {
    for (let k = 0; k < bins; k++) { level[k] = 10 * Math.log10(Math.max(p[k], 1e-20)); if (level[k] > top) top = level[k]; }
    for (let i = 0; i < ROWS; i++) {
      const lo = edges[i], hi = edges[i + 1];
      if (hi - lo >= 1) {
        let m = -Infinity;
        for (let k = Math.floor(lo); k <= Math.min(bins - 1, Math.ceil(hi)); k++) if (level[k] > m) m = level[k];
        row[i] = m;
      } else {
        const c = (lo + hi) / 2, j = Math.min(Math.floor(c), bins - 2);
        row[i] = level[j] * (1 - (c - j)) + level[j + 1] * (c - j);
      }
    }
    for (const c of target[f]) for (let i = 0; i < ROWS; i++) if (row[i] > img[i * columns + c]) img[i * columns + c] = row[i];
  });
  return { img, top, columns, fmax };
}

function magma(v, range) {
  const t = ((Math.max(-range, Math.min(0, v)) + range) / range) * (MAGMA.length - 1);
  const i = Math.min(MAGMA.length - 2, Math.floor(t)), f = t - i;
  return MAGMA[i].map((c, k) => Math.floor(c * (1 - f) + MAGMA[i + 1][k] * f));
}

const tickText = (hz) => (hz >= 1000 ? `${hz / 1000}k Hz` : `${hz} Hz`);

function panel(lv, { title, plotWidth, maxDur, dur, lowest, range, top, track }) {
  const img = canvas(LEFT + plotWidth + RIGHT, TOP + ROWS + BOTTOM);
  for (let i = 0; i < ROWS; i++) for (let c = 0; c < lv.columns; c++) {
    // row 0 is the lowest frequency, drawn at the bottom
    fillRect(img, LEFT + c, TOP + ROWS - 1 - i, 1, 1, magma(lv.img[i * lv.columns + c] - top, range));
  }
  const X = (s) => Math.round(LEFT + (plotWidth * s) / maxDur);
  const Y = (hz) => Math.round(TOP + ROWS * (1 - Math.log(hz / lowest) / Math.log(lv.fmax / lowest)));
  drawText(img, LEFT, 4, fitText(title, plotWidth, SCALE), FG, SCALE);
  for (const hz of FREQ_TICKS) {
    if (hz < lowest || hz > lv.fmax) continue;
    fillRect(img, LEFT - 5, Y(hz), 5, 1, DIM);
    drawText(img, 6, Math.min(TOP + ROWS - CELL_H * SCALE, Math.max(TOP, Y(hz) - CELL_H)), tickText(hz), FG, SCALE);
  }
  const step = TIME_STEPS.find((s) => maxDur / s <= 12);
  for (let k = 0; k * step <= dur + 1e-9; k++) {
    const x = X(k * step), label = String(Number((k * step).toPrecision(6)));
    fillRect(img, x, TOP + ROWS, 1, 5, DIM);
    drawText(img, Math.min(x - textWidth(label, SCALE) / 2, img.width - textWidth(label, SCALE) - 2), TOP + ROWS + 7, label, FG, SCALE);
  }
  drawText(img, LEFT + plotWidth - textWidth("seconds", SCALE), TOP + ROWS + 7 + LINE_H, "seconds", DIM, SCALE);
  if (track) {
    track.times.forEach((t, i) => {
      const hz = track.hz[i];
      if (!Number.isFinite(hz) || track.confidence[i] < track.minConfidence || hz < lowest || hz > lv.fmax) return;
      fillRect(img, X(t) - 1, Y(hz) - 1, 3, 3, TRACK);
    });
  }
  return img;
}

function cmdSpectrogram(opts) {
  if (opts.maxWidth < 400) throw new PlError("audio spectrogram: --max-width wants 400 or more");
  if (!(opts.range > 0)) throw new PlError("--range wants a positive number of dB");
  if (!(opts.lowest > 0)) throw new PlError("--lowest wants a positive frequency");
  const inputs = opts._.length ? opts._.map((p) => soundInput(opts, p))
    : opts.shot ? [...(opts.against ? [soundInput(opts, null, "against")] : []), soundInput(opts, null)] : [];
  if (!inputs.length) throw new PlError("audio spectrogram: give one or more sounds, or --shot NAME [--source ID] [--against ID]");
  const sounds = inputs.map((input) => {
    const sound = readSound(input.file);
    if (opts.lowest >= Math.min(sound.rate / 2, 20000)) throw new PlError(`--lowest ${opts.lowest} Hz is above what ${input.file} holds`);
    return { input, sound, x: mono(sound), dur: sound.frames / sound.rate };
  });
  const plotWidth = opts.maxWidth - LEFT - RIGHT - 2 * GAP, maxDur = Math.max(...sounds.map((s) => s.dur));
  const measured = sounds.map((s) => ({ ...s, lv: levels(s.x, s.sound.rate, { columns: Math.max(1, Math.round((plotWidth * s.dur) / maxDur)), lowest: opts.lowest }) }));
  const top = Math.max(...measured.map((m) => m.lv.top));
  const panels = measured.map(({ input, sound, x, dur, lv }) => {
    const track = opts.pitch ? { ...yin(x, sound.rate, { fmin: opts.fmin, fmax: Math.min(opts.fmax, sound.rate / 2 - 1) }), minConfidence: opts.minConfidence } : null;
    return panel(lv, { title: `${input.name}   ${sound.rate} Hz, ${dur.toFixed(2)} s`, plotWidth, maxDur, dur, lowest: opts.lowest, range: opts.range, top, track });
  });
  const width = panels[0].width;
  const head = [bar(width, `0 dB = the loudest bin of ${sounds.length > 1 ? "these sounds" : "the sound"}, black = -${opts.range} dB or less; frequency on a log scale`, DIM),
    ...(opts.pitch ? [bar(width, `dots: the fundamental (YIN, confidence >= ${opts.minConfidence})`, TRACK)] : [])];
  const sheet = pad(stack([...head, ...panels], false, { gap: GAP }));
  // where each panel's plot sits on the sheet, so a crop or a check can find a time and a frequency
  let y = GAP + head.reduce((s, h) => s + h.height + GAP, 0);
  const plots = panels.map((p, i) => { const box = { x: GAP + LEFT, y: y + TOP, width: measured[i].lv.columns, height: ROWS }; y += p.height + GAP; return box; });
  const first = inputs[0], dir = opts.out ? path.resolve(opts.out) : path.join(runsDir(first.root), opts.run, first.shot ?? "sounds");
  const file = path.join(dir, opts.name ?? `${inputs.map((i) => i.stem).join("-vs-")}.spectrogram.png`);
  const written = saveSheet(sheet, file, { jpeg: opts.jpeg, quality: opts.quality });
  const doc = {
    sheet: written, lowestHz: opts.lowest, rangeDb: opts.range, secondsPerPixel: maxDur / plotWidth,
    panels: measured.map(({ input, sound, dur, lv }, i) => ({ file: input.file, rate: sound.rate, duration: r(dur, 4), loudestBinDb: r(lv.top - top, 2), plot: plots[i] })),
  };
  return [doc, `spectrogram: ${written}`, 0];
}

const SUB = { probe: cmdProbe, silence: cmdSilence, pitch: cmdPitch, onsets: cmdOnsets, compare: cmdCompare, spectrogram: cmdSpectrogram };

export async function run(argv) {
  const [kind, ...rest] = argv;
  if (!kind) throw new PlError(HELP);
  if (kind === "--help" || kind === "-h") { emit(null, false, HELP); return 0; }
  if (!SUB[kind]) throw new PlError(`unknown audio command '${kind}' (${Object.keys(SUB).join(", ")})`);
  const opts = parseArgs(rest, FLAGS);
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (opts.quality < 1 || opts.quality > 100) throw new PlError("--quality wants 1 to 100");
  const [doc, text, code] = SUB[kind](opts);
  emit(doc, opts.json, text);
  return code;
}
