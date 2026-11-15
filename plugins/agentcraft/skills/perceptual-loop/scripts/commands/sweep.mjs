// sweep: is a sequence smooth over time? One series per quantity, from a
// clip (mean luma and R, G, B of the frame and of each region) or from a table
// of per-frame values, and what an eye catches in motion but no single frame
// shows: a jump far above the local rate of change, flicker, a value going the
// wrong way, and uneven steps of a motion that should be even (judder).
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { readImage, resize, toLuma } from "../lib/image.mjs";
import { median, regionsFromBoxes } from "../lib/metrics.mjs";
import { plotPanels } from "../lib/plot.mjs";
import { findRoot, fnmatch, writeJson } from "../lib/project.mjs";
import { fitSize, lumaPlane, openSequence } from "../lib/sequence.mjs";
import { CLIP_FLAGS, clipInput, outputDir, parseRegions, writeSheet } from "./video.mjs";

const HELP = `usage: pl.mjs sweep [CLIP] [--values FILE] [--positions FILE | --track] [options] [--json]

Series, one per quantity and frame: from a CLIP (a video file, a folder of frames, or --shot NAME
[--source ID]) the mean luma and R, G, B of the frame and of each region (frame.luma, sky.r, ...); from
--values the columns of a CSV (header optional) or JSONL file, one row per frame. Writes a plot and a report.

  --region NAME=x0,y0,x1,y1   a named box in 0..1 of the frame (repeatable; a shot's own regions count too)
  --mask FILE                 a picture whose white pixels are one more region, named mask
  --columns A,B               the --values columns to use (default: every numeric column)
  --series GLOB               report, plot, and gate only these series (repeatable), e.g. '*.luma'
  --size PX                   frames are reduced to this long side before averaging (default 256)
  --every N                   every Nth frame of the clip

  --positions FILE            per-frame positions for judder: columns x,y[,z] (or --position-columns)
  --track                     take the motion from the pixels instead: per frame, the centroid of what
                              differs from the clip's median picture by --track-threshold (default 0.08
                              of luma), in the frame or in --track-region NAME

  --window N                  steps on each side that define the local rate of change (default 5)
  --floor V                   the smallest step that can be a jump, and the stand-in for a local rate of 0
                              (default 0.002 for frames, half an 8-bit level; a millionth of a column's range)
  --flag-ratio R              flag a frame whose step is more than R x its local step (default 6)
  --expect [SERIES=]KIND      rising, falling, or steady (SERIES may be a glob; repeatable)
  --steady-range V            the largest max - min of a series expected steady (default 0.01)

  gates, exit 1 when one is exceeded: --max-step V, --max-ratio R, --max-flicker F, --max-judder J
  and --rate, --shot, --source, --out, --run, --max-width, --jpeg, --quality as for video.

What the numbers mean
  max step    the largest change between consecutive frames, in the series' units (0..1 for luma and
              colour, so 0.004 is one 8-bit level)
  worst jump  the step with the largest ratio to the median |step| of the --window steps on each side of
              it (itself left out); the frame named is the one the jump lands on. A fast change is
              allowed to be fast: only a step far above its neighbours is a jump.
  flicker     the root mean square of the second difference: 0 for a constant or a straight ramp, large
              for a value that alternates. It grows with honest curvature too, so compare it between runs.
  judder      std / mean of the per-frame step length of a motion, 0 at constant speed; judderLocal
              divides each step by the median of its 9 neighbours first, which forgives acceleration.
              A step under 10 % of the median is a repeated frame, over 175 % a dropped one.
A mean over a region hides anything moving inside it that leaves the mean alone: use a tighter region,
--track, or values read back from the system. A flagged frame is a place to look (video burst --frame N),
not a verdict: a cut or a light switched on is a jump that is meant.

Exit codes: 0 done (gates and expectations passed), 1 one failed, 2 usage or environment.`;

const FLAGS = {
  ...CLIP_FLAGS, values: { type: "string" }, columns: { type: "string" }, region: { type: "string", multi: true }, mask: { type: "string" },
  series: { type: "string", multi: true }, size: { type: "int", default: 256 }, every: { type: "int", default: 1 },
  positions: { type: "string" }, "position-columns": { type: "string" }, track: { type: "bool" }, "track-region": { type: "string" },
  "track-threshold": { type: "float", default: 0.08 }, window: { type: "int", default: 5 }, floor: { type: "float" }, "flag-ratio": { type: "float", default: 6 },
  expect: { type: "string", multi: true }, "steady-range": { type: "float", default: 0.01 },
  "max-step": { type: "float" }, "max-ratio": { type: "float" }, "max-flicker": { type: "float" }, "max-judder": { type: "float" },
};

const PICTURE_FLOOR = 0.002; // half an 8-bit level: below it a step is rounding, not a jump
const finite = (v) => v !== null && Number.isFinite(v);

// ---- inputs ------------------------------------------------------------------------------------

/** A CSV (header row optional) or JSONL file (objects or arrays) as { column: values }; what is not a number is NaN. */
export function readTable(file) {
  if (!fs.existsSync(file)) throw new PlError(`no such file: ${file}`);
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
  if (!text) throw new PlError(`${file} is empty`);
  const num = (x) => (x === null || x === "" || typeof x === "boolean" ? NaN : Number(x));
  const cols = {};
  const put = (k, v) => (cols[k] ??= []).push(num(v));
  if (text[0] === "{" || text[0] === "[") {
    for (const [n, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let row;
      try { row = JSON.parse(line); } catch (e) { throw new PlError(`${file} line ${n + 1} is not JSON: ${e.message}`); }
      for (const [k, v] of Array.isArray(row) ? row.map((v, i) => [`c${i}`, v]) : Object.entries(row)) {
        if (Array.isArray(v)) v.forEach((e, j) => put(`${k}.${j}`, e)); // {"pos": [x, y, z]} becomes pos.0, pos.1, pos.2
        else put(k, v);
      }
    }
  } else {
    const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(",").map((c) => c.trim()));
    const header = rows[0].some((c) => Number.isNaN(num(c)));
    const names = header ? rows[0] : rows[0].map((_, i) => `c${i}`);
    for (const r of rows.slice(header ? 1 : 0)) names.forEach((name, i) => put(name, r[i]));
  }
  const n = Math.max(...Object.values(cols).map((v) => v.length));
  return Object.fromEntries(Object.entries(cols).filter(([, v]) => v.length === n && v.some((x) => !Number.isNaN(x))));
}

function pickColumns(table, wanted, flag) {
  if (!wanted) return Object.keys(table);
  const names = wanted.split(",").map((c) => c.trim()).filter(Boolean);
  const missing = names.filter((c) => !(c in table));
  if (missing.length) throw new PlError(`${flag}: no column ${missing.join(", ")} (have: ${Object.keys(table).join(", ")})`);
  return names;
}

/**
 * The series of a clip: per frame, the mean luma and R, G, B (0..1, display-encoded) of the frame and of each
 * region; the frames identical to the one before; and with `track`, the centroid of what differs from the
 * clip's median picture, in frame widths so a step has one unit.
 */
export async function clipSeries(seq, { regions = {}, mask = null, size = 256, every = 1, track = false, trackRegion = null, threshold = 0.08 } = {}) {
  const [w, h] = fitSize(seq.width, seq.height, size);
  const areas = [{ name: "frame", mask: null }, ...regionsFromBoxes(regions, w, h)];
  if (mask) {
    const m = toLuma(resize(readImage(mask), w, h, { nearest: true }));
    const sel = Uint8Array.from(m.data, (v) => (v > 127 ? 1 : 0));
    if (!sel.some(Boolean)) throw new PlError(`--mask ${mask} has no white pixel`);
    areas.push({ name: "mask", mask: sel });
  }
  const series = {}, frames = [], identical = [], lumas = [];
  let prev = null;
  for await (const f of seq.frames({ every, dims: [w, h] })) {
    frames.push(f.index);
    const d = f.img.data;
    for (const { name, mask: sel } of areas) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < w * h; i++) {
        if (sel && !sel[i]) continue;
        r += d[i * 3]; g += d[i * 3 + 1]; b += d[i * 3 + 2]; n++;
      }
      r /= n * 255; g /= n * 255; b /= n * 255;
      for (const [key, v] of [["luma", 0.2126 * r + 0.7152 * g + 0.0722 * b], ["r", r], ["g", g], ["b", b]]) (series[`${name}.${key}`] ??= []).push(v);
    }
    const y = lumaPlane(f.img);
    if (prev) {
      let s = 0;
      for (let i = 0; i < y.length; i++) s += Math.abs(y[i] - prev[i]);
      if (s / y.length < 1e-5) identical.push(f.index);
    }
    prev = y;
    // debt: --track keeps every frame's luma for the median picture (about 150 KB a frame at --size 256), add a streamed median when a tracked clip runs to thousands of frames
    if (track) lumas.push(y);
  }
  let positions = null;
  const notes = [];
  if (track) {
    let keep = null;
    if (trackRegion && trackRegion !== "frame") {
      if (!(trackRegion in regions)) throw new PlError(`--track-region ${trackRegion}: no such region (have: frame${Object.keys(regions).map((r) => `, ${r}`).join("")})`);
      keep = regionsFromBoxes({ [trackRegion]: regions[trackRegion] }, w, h)[0].mask;
    }
    const med = new Float32Array(w * h), column = new Float64Array(lumas.length);
    for (let i = 0; i < w * h; i++) {
      for (let k = 0; k < lumas.length; k++) column[k] = lumas[k][i];
      med[i] = median(column);
    }
    positions = lumas.map((y) => {
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < w * h; i++) {
        if ((keep && !keep[i]) || Math.abs(y[i] - med[i]) <= threshold) continue;
        sx += i % w; sy += Math.floor(i / w); n++;
      }
      return n >= 4 ? [sx / n / w, sy / n / w] : [NaN, NaN];
    });
    const lost = positions.filter((p) => Number.isNaN(p[0])).length;
    if (lost) notes.push(`--track: nothing stood out from the background in ${lost} of ${lumas.length} frames (raise or lower --track-threshold?)`);
  }
  return { series, frames, identical, positions, notes };
}

// ---- analysis ----------------------------------------------------------------------------------

/**
 * The steps of one series. A jump is a step measured against the median |step| of the `window` steps on each
 * side of it, itself left out: the series' own local rate of change, so a fast sweep is not a jump and a
 * small pop in a still passage is. `floor` stands in for a local rate of zero and is the smallest step that counts.
 */
export function analyseSeries(values, frames, { window = 5, floor = PICTURE_FLOOR, flagRatio = 6 } = {}) {
  const keep = values.map(finite);
  const v = values.filter((_, i) => keep[i]), fr = frames.filter((_, i) => keep[i]);
  const out = { n: v.length, floor };
  if (v.length < 3) return { ...out, note: "fewer than 3 values: nothing to measure" };
  const d = v.slice(1).map((x, i) => x - v[i]), ad = d.map(Math.abs);
  const local = ad.map((_, i) => {
    if (ad.length < 2) return 0;
    const lo = Math.max(0, i - window), win = ad.slice(lo, i + window + 1);
    win.splice(i - lo, 1);
    return median(win);
  });
  const ratio = ad.map((a, i) => (a > floor ? a / Math.max(local[i], floor) : 0));
  const argmax = (a) => a.reduce((best, x, i) => (x > a[best] ? i : best), 0);
  const i = argmax(ad), j = argmax(ratio);
  const d2 = v.slice(2).map((x, k) => x - 2 * v[k + 1] + v[k]);
  return {
    ...out, min: Math.min(...v), max: Math.max(...v),
    maxStep: { step: d[i], frame: fr[i + 1] },
    worstJump: { step: d[j], localMedianStep: local[j], ratio: ratio[j], frame: fr[j + 1] },
    flagged: ratio.flatMap((r, k) => (r > flagRatio ? [fr[k + 1]] : [])),
    flicker: Math.sqrt(d2.reduce((s, x) => s + x * x, 0) / d2.length),
  };
}

/** Whether a series rises, falls, or holds as expected: a step the other way beyond `floor` fails rising and falling. */
export function expectation(values, frames, kind, { floor = PICTURE_FLOOR, steadyRange = 0.01 } = {}) {
  const keep = values.map(finite), v = values.filter((_, i) => keep[i]), fr = frames.filter((_, i) => keep[i]);
  if (kind === "steady") {
    const range = v.length ? Math.max(...v) - Math.min(...v) : 0;
    return { expect: kind, range, allowed: steadyRange, ok: range <= steadyRange };
  }
  const d = v.slice(1).map((x, i) => x - v[i]), sign = kind === "rising" ? 1 : -1;
  const against = d.filter((x) => sign * x < -floor).length;
  let worst = 0;
  d.forEach((x, i) => { if (sign * x < sign * d[worst]) worst = i; });
  return { expect: kind, against, of: d.length, worstReversal: against ? d[worst] : 0, frame: against ? fr[worst + 1] : null, ok: !against };
}

const std = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };

/**
 * How evenly a motion steps. judder = std / mean of the step length: 0 at constant speed, and it grows with
 * real acceleration too, so judderLocal (each step over the median of its 9 neighbours) is the one to read
 * when the speed is meant to change. A step under 10 % of the median is a repeated frame, over 175 % a dropped one.
 */
export function judder(positions, frames) {
  const keep = positions.map((p) => p.every(finite));
  const p = positions.filter((_, i) => keep[i]), fr = frames.filter((_, i) => keep[i]);
  if (p.length < 4) return { n: p.length, note: "fewer than 4 positions: nothing to measure" };
  const s = p.slice(1).map((q, i) => Math.hypot(...q.map((c, k) => c - p[i][k])));
  const med = median(s), mean = s.reduce((a, b) => a + b, 0) / s.length;
  if (med <= 0) return { n: p.length, meanStep: mean, note: "the subject does not move in most frames: judder is undefined" };
  const roll = s.map((_, i) => median(s.slice(Math.max(0, i - 4), i + 5)));
  return {
    n: p.length, meanStep: mean, stdStep: std(s), judder: std(s) / mean, judderLocal: std(s.map((x, i) => x / Math.max(roll[i], 0.1 * med))),
    repeated: s.flatMap((x, i) => (x < 0.1 * med ? [fr[i + 1]] : [])), dropped: s.flatMap((x, i) => (x > 1.75 * med ? [fr[i + 1]] : [])),
  };
}

/** Rounded to 6 significant digits, with NaN and infinities as null: a report anything can read. */
export function clean(o) {
  if (typeof o === "number") return Number.isFinite(o) ? Number(o.toPrecision(6)) : null;
  if (Array.isArray(o)) return o.map(clean);
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)]));
  return o;
}

// ---- the command -------------------------------------------------------------------------------

const fmt = (v) => Number(v.toPrecision(4));
const signed = (v) => `${v >= 0 ? "+" : ""}${fmt(v)}`;

export async function run(argv) {
  const opts = parseArgs(argv, FLAGS);
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (opts._.length > 1) throw new PlError("sweep takes one clip (see --help)");
  if (opts.window < 1 || opts.every < 1 || opts.size < 8) throw new PlError("--window and --every want 1 or more, --size 8 or more");
  if (opts.maxWidth < 400) throw new PlError("--max-width wants 400 or more for a plot");
  const haveClip = Boolean(opts._[0] || opts.shot);
  if (!haveClip && !opts.values && !opts.positions) throw new PlError("sweep: give a clip (a video file, a folder of frames, or --shot NAME), --values FILE, or --positions FILE");
  if (opts.track && !haveClip) throw new PlError("--track reads the motion from a clip: give one");

  const notes = [], label = [], series = {}, floors = {};
  let frames = [], positions = null, identical = null;
  const clip = haveClip ? clipInput(opts, { path: opts._[0], what: "sweep" })
    : { root: findRoot(), shot: null, stem: path.basename(opts.values ?? opts.positions).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_.-]/g, "_") };
  if (haveClip) {
    const seq = openSequence(clip.input, { rate: opts.rate ?? null, what: "sweep" });
    const regions = parseRegions(opts.region, clip);
    const got = await clipSeries(seq, { regions, mask: opts.mask ? path.resolve(opts.mask) : null, size: opts.size, every: opts.every,
      track: opts.track, trackRegion: opts.trackRegion ?? null, threshold: opts.trackThreshold });
    for (const [k, v] of Object.entries(got.series)) { series[k] = v; floors[k] = opts.floor ?? PICTURE_FLOOR; }
    ({ frames, identical, positions } = got);
    notes.push(...got.notes);
    label.push(clip.name);
  }
  if (opts.values) {
    const table = readTable(path.resolve(opts.values));
    for (const c of pickColumns(table, opts.columns, "--columns")) {
      series[c] = table[c];
      const v = table[c].filter(finite), span = v.length ? Math.max(...v) - Math.min(...v) : 0;
      floors[c] = opts.floor ?? Math.max(1e-12, 1e-6 * span);
    }
    label.push(path.basename(opts.values));
  }
  if (opts.positions) {
    const table = readTable(path.resolve(opts.positions));
    const cols = opts.positionColumns ? pickColumns(table, opts.positionColumns, "--position-columns")
      : "x" in table && "y" in table ? ["x", "y", "z"].filter((c) => c in table) : Object.keys(table).slice(0, 3);
    positions = table[cols[0]].map((_, i) => cols.map((c) => table[c][i]));
    label.push(`${path.basename(opts.positions)}[${cols.join(",")}]`);
  }
  const rows = Math.max(0, ...Object.values(series).map((v) => v.length), positions?.length ?? 0);
  if (!frames.length) frames = Array.from({ length: rows }, (_, i) => i);
  const globs = opts.series.length ? opts.series : ["*"];
  for (const k of Object.keys(series)) if (!globs.some((g) => fnmatch(k, g))) delete series[k];
  if (!positions && !Object.keys(series).length) throw new PlError(`no series matches --series ${globs.join(" ")}`);

  const stats = {};
  for (const [name, v] of Object.entries(series)) {
    stats[name] = analyseSeries(v, frames.slice(0, v.length), { window: opts.window, floor: floors[name], flagRatio: opts.flagRatio });
  }
  const failed = [];
  for (const spec of opts.expect) {
    const at = spec.lastIndexOf("="), glob = at === -1 ? "*" : spec.slice(0, at), kind = spec.slice(at + 1);
    if (!["rising", "falling", "steady"].includes(kind)) throw new PlError(`--expect '${spec}': write rising, falling, or steady, optionally as SERIES=KIND`);
    const hits = Object.keys(series).filter((n) => fnmatch(n, glob));
    if (!hits.length) throw new PlError(`--expect '${spec}': no series matches (have: ${Object.keys(series).join(", ")})`);
    for (const name of hits) {
      const e = (stats[name].expect = expectation(series[name], frames, kind, { floor: floors[name], steadyRange: opts.steadyRange }));
      if (!e.ok) failed.push(`${name} expected ${kind}: ${kind === "steady" ? `range ${fmt(e.range)} > ${e.allowed}` : `${e.against} of ${e.of} steps go the other way (worst ${signed(e.worstReversal)} at frame ${e.frame})`}`);
    }
  }
  for (const [name, st] of Object.entries(stats)) {
    if (!st.maxStep) continue;
    if (opts.maxStep !== undefined && Math.abs(st.maxStep.step) > opts.maxStep) failed.push(`${name}: step ${signed(st.maxStep.step)} at frame ${st.maxStep.frame} > --max-step ${opts.maxStep}`);
    if (opts.maxRatio !== undefined && st.worstJump.ratio > opts.maxRatio) failed.push(`${name}: jump at frame ${st.worstJump.frame} is ${st.worstJump.ratio.toFixed(1)}x the local step > --max-ratio ${opts.maxRatio}`);
    if (opts.maxFlicker !== undefined && st.flicker > opts.maxFlicker) failed.push(`${name}: flicker ${fmt(st.flicker)} > --max-flicker ${opts.maxFlicker}`);
  }
  let motion = null;
  const extra = [];
  if (positions) {
    motion = judder(positions, frames.slice(0, positions.length));
    const steps = [NaN, ...positions.slice(1).map((q, i) => Math.hypot(...q.map((c, k) => c - positions[i][k])))];
    extra.push({ name: "motion: step length per frame", values: steps, flagged: [...new Set([...(motion.repeated ?? []), ...(motion.dropped ?? [])])].sort((a, b) => a - b) });
    if (opts.maxJudder !== undefined) {
      if (motion.judder === undefined) failed.push(`motion: ${motion.note}`);
      else if (motion.judder > opts.maxJudder) failed.push(`motion: judder ${motion.judder.toFixed(3)} > --max-judder ${opts.maxJudder}`);
    }
  } else if (opts.maxJudder !== undefined) throw new PlError("--max-judder needs a motion: --positions FILE or --track");

  const doc = { input: label.join(" + "), frames: frames.length, window: opts.window, flagRatio: opts.flagRatio, series: stats, motion,
    identicalFrames: identical, notes, gate: { passed: !failed.length, failed } };
  const dir = outputDir(opts, clip), stem = `sweep.${clip.stem}`;
  const panels = [
    ...Object.entries(series).map(([name, values]) => {
      const st = stats[name], j = st.worstJump;
      return { name, values, flagged: st.flagged ?? [], alert: Boolean(st.flagged?.length),
        head: !j ? st.note : j.ratio === 0 ? `no step above the floor ${fmt(st.floor)}` : `largest jump ${signed(j.step)} at frame ${j.frame} = ${j.ratio.toFixed(1)}x the local step   flicker ${fmt(st.flicker)}` };
    }),
    ...extra.map((e) => ({ ...e, alert: e.flagged.length > 0, head: motion.judder !== undefined ? `judder ${motion.judder.toFixed(3)}` : motion.note })),
  ].sort((a, b) => Number(b.alert) - Number(a.alert));
  const shown = panels.slice(0, 12);
  const plot = plotPanels(shown, { title: `sweep  ${doc.input}  ${frames.length} frames`, frames, width: Math.min(opts.maxWidth, 1500) - 12,
    floor: Math.min(...Object.values(floors), PICTURE_FLOOR), more: panels.length - shown.length });
  doc.plot = writeSheet(plot, path.join(dir, `${stem}.png`), opts);
  doc.report = path.join(dir, `${stem}.json`);
  writeJson(doc.report, clean({ ...doc, values: series }));

  const w = Math.max(4, ...Object.keys(stats).map((n) => n.length));
  const lines = [`sweep of ${doc.input}: ${frames.length} frames, ${Object.keys(series).length} series  (jump = step / median |step| of the ${opts.window} steps each side)`];
  for (const [name, st] of Object.entries(stats)) {
    if (!st.maxStep) { lines.push(`  ${name.padEnd(w)}  ${st.note}`); continue; }
    const j = st.worstJump;
    if (j.ratio === 0) { lines.push(`  ${name.padEnd(w)}  no step above the floor ${fmt(st.floor)}`); continue; }
    lines.push(`  ${name.padEnd(w)}  max step ${signed(st.maxStep.step)} @ ${st.maxStep.frame}  worst jump ${signed(j.step)} @ ${j.frame} = ${j.ratio.toFixed(1)}x local ${fmt(j.localMedianStep)}`
      + `  flicker ${fmt(st.flicker)}${st.flagged.length ? `  FLAGGED frames ${st.flagged.join(", ")}` : ""}`);
  }
  if (motion) {
    lines.push(`  motion  ${motion.judder !== undefined ? `judder ${motion.judder.toFixed(3)} (local ${motion.judderLocal.toFixed(3)})  mean step ${fmt(motion.meanStep)}`
      + `  repeated frames ${motion.repeated.join(", ") || "none"}  dropped ${motion.dropped.join(", ") || "none"}` : motion.note}`);
  }
  if (identical?.length) lines.push(`  frames identical to the one before: ${identical.join(", ")}`);
  lines.push(...notes.map((n) => `  note: ${n}`), `  plot: ${doc.plot}`, `  report: ${doc.report}`, ...failed.map((f) => `  GATE FAILED: ${f}`));
  emit(clean(doc), opts.json, lines.join("\n"));
  return failed.length ? 1 : 0;
}
