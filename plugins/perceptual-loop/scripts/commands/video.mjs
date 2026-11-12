// video: clips as things an agent can look at and measure. A clip is a video
// file (through ffmpeg) or a folder of frames (no ffmpeg needed), or a shot's
// clip. Also the plumbing sweep and flow share: which clip, which regions, and
// where the sheet and report go.
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { probe, selectFilter, writePngAt, writePngFrames } from "../lib/ffmpeg.mjs";
import { boxSsimPsnr, PSNR_CAP } from "../lib/metrics.mjs";
import { findRoot, loadConfig, readJson, runsDir, shotPath, writeJson } from "../lib/project.mjs";
import { FG } from "../lib/raster.mjs";
import { clipOf, collect, fitSize, frameCaption, lumaPlane, openSequence } from "../lib/sequence.mjs";
import { cellWidth, gridSheet, IMAGE_SUFFIXES, MAX_WIDTH, saveSheet } from "../lib/sheets.mjs";
import { parseBox } from "./sheet.mjs";

const HELP = `usage: pl.mjs video <command> ... [--json]

  probe FILE                          duration, rate, size, frame count, codec, and whether it has sound
  frames FILE [--every N | --fps F | --times T,T,...]
                                      a video's frames as PNG files named by frame number, and frames.json
  contact [CLIP] [--every N] [--max-tiles N] [--cols C]
                                      a contact sheet: tiles in time order, the number and time under each
  burst [CLIP] (--frame N | --at SECONDS) [--count N] [--step N] [--cols C]
                                      the frames around one moment, left to right
  compare [A B] [--align [--max-lag N]] [--size PX] [--worst N] [--min-ssim V] [--min-mean-ssim V] [--min-psnr DB]
                                      per-frame SSIM and PSNR of luma between two clips of the same instants,
                                      and the worst frames side by side

A CLIP is a video file or a folder of frames (read in name order), or a shot's clip with --shot NAME
[--source ID]: frames/<source>/ or <source>.mp4 in the shot folder (default source: the first candidate).
compare --shot measures --source (A) against --against (B, default the reference).

  --rate F         frames per second of a folder of frames, for times (a video has its own)
  --out DIR        where the sheet, report, or frames go (default runs/<run>/<shot>/, or runs/<run>/clips/)
  --run NAME       the run folder under runs/ (default motion)
  --max-width PX   the sheet's largest width (default ${MAX_WIDTH}); --jpeg, --quality Q as for sheets

What the numbers mean: SSIM is the mean structural similarity of luma over 7x7 windows, 1 identical,
computed at --size pixels on the long side (default 480), so it speaks of structure at that scale. PSNR
is 10 log10(1 / mean squared luma error) in dB, ${PSNR_CAP} for identical frames; it is sensitive to brightness
offsets and to sub-pixel shifts the eye does not see. --align finds the frame offset from brightness over
time in a 4x4 grid (B[i + lag] shows what A[i] shows), so clips that never change brightness cannot be
aligned. Neither number says which clip is right: open the sheet of the worst frames.

Exit codes: 0 done (gates passed), 1 a gate failed, 2 usage or environment (no ffmpeg, no such file).`;

/** The flags every motion command shares: where the clip is, and where the output goes. */
export const CLIP_FLAGS = {
  shot: { type: "string" }, source: { type: "string" }, rate: { type: "float" },
  out: { type: "string" }, run: { type: "string", default: "motion" },
  "max-width": { type: "int", default: MAX_WIDTH }, jpeg: { type: "bool" }, quality: { type: "int", default: 90 }, json: { type: "bool" },
};

const FLAGS = {
  ...CLIP_FLAGS, every: { type: "int" }, fps: { type: "float" }, times: { type: "string" }, "max-tiles": { type: "int", default: 24 },
  cols: { type: "int" }, frame: { type: "int" }, at: { type: "float" }, count: { type: "int", default: 9 }, step: { type: "int", default: 1 },
  against: { type: "string" }, align: { type: "bool" }, "max-lag": { type: "int", default: 5 }, size: { type: "int", default: 480 },
  worst: { type: "int", default: 4 }, "min-ssim": { type: "float" }, "min-mean-ssim": { type: "float" }, "min-psnr": { type: "float" },
};

const safe = (name) => String(name).replace(/[^A-Za-z0-9_.-]/g, "_");
const stemOf = (p) => safe(path.basename(String(p)).replace(/\.[^.]+$/, "") || "clip");

/**
 * The clip a motion command reads, from its positional path or from --shot: { input, name (for headers),
 * shot, source, stem (for file names), root, config }. `role` "against" picks the comparison source of a shot (default the reference).
 */
export function clipInput(opts, { path: given = null, role = "source", what = "input" } = {}) {
  const root = findRoot();
  if (given) return { input: path.resolve(given), name: path.basename(path.resolve(given)), shot: null, source: null, stem: stemOf(given), root, config: null };
  if (!opts.shot) throw new PlError(`${what}: give a video file or a folder of frames, or --shot NAME [--source ID]`);
  const config = loadConfig(root, { required: true });
  const source = role === "against" ? opts.against ?? config.reference : opts.source ?? config.candidates[0];
  const dir = shotPath(opts.shot, root, config);
  if (!fs.existsSync(dir)) throw new PlError(`no such shot: ${opts.shot} (looked in ${path.dirname(dir)})`);
  const input = clipOf(dir, source);
  if (!input) throw new PlError(`shot '${opts.shot}' has no clip of source '${source}' (looked for frames/${source}/ and ${source}.mp4 in ${dir})`);
  return { input, name: `${opts.shot} ${source}`, shot: opts.shot, source, stem: safe(source), root, config };
}

/** The folder a command writes into: --out, else runs/<run>/<shot>/, else runs/<run>/clips/. */
export function outputDir(opts, clip) {
  if (opts.out) return path.resolve(opts.out);
  return path.join(runsDir(clip.root), opts.run, clip.shot ?? "clips");
}

/** Named boxes from --region NAME=x0,y0,x1,y1, over the shot's own shot.json regions. */
export function parseRegions(specs, clip) {
  const regions = {};
  if (clip?.shot) {
    const doc = readJson(path.join(shotPath(clip.shot, clip.root, clip.config), "shot.json"), {}) ?? {};
    for (const [name, box] of Object.entries(doc.regions ?? {})) regions[name] = box;
  }
  for (const spec of specs ?? []) {
    const at = spec.indexOf("=");
    const name = at > 0 ? spec.slice(0, at).trim() : "";
    if (!name || name === "frame" || /[./]/.test(name)) throw new PlError(`--region '${spec}': write NAME=x0,y0,x1,y1, a name other than 'frame' with no '.' or '/'`);
    regions[name] = parseBox(spec.slice(at + 1));
  }
  return regions;
}

/** Write a sheet as the --jpeg and --quality flags say. */
export const writeSheet = (img, file, opts) => saveSheet(img, file, { jpeg: opts.jpeg, quality: opts.quality });

const checkWidth = (opts) => {
  if (opts.maxWidth < 200) throw new PlError("--max-width wants 200 or more");
  if (opts.quality < 1 || opts.quality > 100) throw new PlError("--quality wants 1 to 100");
};

// ---- probe and frames ------------------------------------------------------------------------

function cmdProbe(opts) {
  if (opts._.length !== 1) throw new PlError("video probe takes one video file");
  const info = probe(path.resolve(opts._[0]));
  const text = `${info.file}\n  ${info.size[0]}x${info.size[1]}  ${info.fps} fps  ${info.duration} s  ${info.frames} frames`
    + `${info.frameCountEstimated ? " (estimated)" : ""}  codec ${info.codec}${info.hasAudio ? "  with sound" : ""}`;
  return [info, text, 0];
}

function cmdFrames(opts) {
  if (opts._.length !== 1) throw new PlError("video frames takes one video file");
  const file = path.resolve(opts._[0]);
  if (IMAGE_SUFFIXES.has(path.extname(file).toLowerCase()) || (fs.existsSync(file) && fs.statSync(file).isDirectory())) {
    throw new PlError("video frames reads a video file; a picture or a folder of frames is already frames");
  }
  if ([opts.every, opts.fps, opts.times].filter((v) => v !== undefined).length > 1) throw new PlError("give one of --every, --fps, --times");
  const info = probe(file);
  const clip = { root: findRoot(), shot: null };
  const dir = opts.out ? path.resolve(opts.out) : path.join(outputDir(opts, clip), `${stemOf(file)}.frames`);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => IMAGE_SUFFIXES.has(path.extname(f).toLowerCase()))) {
    throw new PlError(`${dir} already holds pictures: give an empty folder, so the frames of two extractions never mix`);
  }
  const name = (index) => path.join(dir, `${String(index).padStart(6, "0")}.png`);
  let frames;
  if (opts.times !== undefined) {
    const times = opts.times.split(",").map((t) => Number(t.trim()));
    if (times.some((t) => !Number.isFinite(t) || t < 0)) throw new PlError(`--times '${opts.times}': write seconds, comma separated`);
    const indices = times.map((t) => Math.round(t * info.fps));
    if (new Set(indices).size !== indices.length) throw new PlError(`--times '${opts.times}': two of the times are the same frame at ${info.fps} fps`);
    frames = times.map((t, k) => ({ file: writePngAt(file, t, name(indices[k])), index: indices[k], t }));
  } else {
    const every = Math.max(1, opts.every ?? 1);
    if (opts.fps !== undefined && !(opts.fps > 0)) throw new PlError("--fps wants a rate above 0");
    const files = writePngFrames(file, dir, { filter: opts.fps ? `fps=${opts.fps}` : every > 1 ? selectFilter({ every }) : null });
    const index = (k) => (opts.fps ? Math.round((k / opts.fps) * info.fps) : k * every);
    const indices = files.map((_, k) => index(k));
    // named by frame number, so the folder reads back with the numbers the video has; from the last down,
    // since a frame's number is never below its place and no rename can land on a file not yet moved
    const renamed = indices.every((v, k) => v >= k && (k === 0 || v > indices[k - 1]));
    if (renamed) for (let k = files.length - 1; k >= 0; k--) if (indices[k] !== k) fs.renameSync(files[k], name(indices[k]));
    frames = files.map((f, k) => ({ file: renamed ? name(indices[k]) : f, index: indices[k], t: info.fps ? indices[k] / info.fps : null }));
  }
  const listed = frames.map((f) => ({ file: path.basename(f.file), index: f.index, t: f.t === null ? null : Number(f.t.toFixed(4)) }));
  writeJson(path.join(dir, "frames.json"), { source: file, fps: info.fps, frames: listed });
  return [{ out: dir, count: frames.length, frames: listed }, `${frames.length} frames -> ${dir} (frames.json gives each file's frame number and time)`, 0];
}

// ---- contact and burst ---------------------------------------------------------------------

/** Decoding at the cell's width: a long clip's tiles never pass through memory at full size. */
const tileDims = (seq, cols, maxWidth) => {
  const cell = cellWidth(cols, maxWidth);
  return seq.width > cell ? [cell, Math.max(1, Math.round((seq.height * cell) / seq.width))] : [seq.width, seq.height];
};

async function cmdContact(opts) {
  if (opts._.length > 1) throw new PlError("video contact takes one clip");
  const clip = clipInput(opts, { path: opts._[0], what: "contact" });
  const seq = openSequence(clip.input, { rate: opts.rate ?? null, what: "contact" });
  if (opts.maxTiles < 1) throw new PlError("--max-tiles wants 1 or more");
  if (opts.every !== undefined && opts.every < 1) throw new PlError("--every wants 1 or more");
  // never more tiles than --max-tiles: a longer clip is thinned evenly, whatever --every says
  const every = Math.max(opts.every ?? 1, Math.ceil(seq.total / opts.maxTiles));
  const count = Math.ceil(seq.total / every);
  const cols = opts.cols ?? Math.max(1, Math.min(count, Math.floor((opts.maxWidth - 12) / 320)));
  const frames = (await collect(seq, { every, dims: tileDims(seq, cols, opts.maxWidth) })).slice(0, opts.maxTiles);
  const header = `${clip.name}  ${frames.length} of ${seq.total} frames${every > 1 ? `, every ${every}` : ""}${seq.fps ? `, ${seq.fps} fps` : ""}`;
  const sheet = gridSheet(frames.map((f) => ({ img: f.img, label: frameCaption(f) })), { cols, header, maxWidth: opts.maxWidth, grow: true });
  const file = writeSheet(sheet, path.join(outputDir(opts, clip), `contact.${clip.stem}.png`), opts);
  return [{ sheet: file, tiles: frames.length, of: seq.total, frames: frames.map((f) => f.index) },
    `contact sheet (${frames.length} of ${seq.total} frames): ${file}`, 0];
}

async function cmdBurst(opts) {
  if (opts._.length > 1) throw new PlError("video burst takes one clip");
  if ((opts.frame === undefined) === (opts.at === undefined)) throw new PlError("video burst wants the moment: --frame N or --at SECONDS");
  if (opts.count < 1 || opts.step < 1) throw new PlError("--count and --step want 1 or more");
  const clip = clipInput(opts, { path: opts._[0], what: "burst" });
  const seq = openSequence(clip.input, { rate: opts.rate ?? null, what: "burst" });
  if (opts.frame === undefined && !seq.fps) throw new PlError("burst --at needs the frame rate: give --rate for a folder of frames, or use --frame N");
  const centre = opts.frame ?? Math.round(opts.at * seq.fps);
  const first = Math.max(0, centre - Math.floor(opts.count / 2) * opts.step);
  const at = Array.from({ length: opts.count }, (_, k) => first + k * opts.step);
  const cols = opts.cols ?? at.length;
  const frames = await collect(seq, { at, dims: tileDims(seq, cols, opts.maxWidth) });
  if (!frames.length) throw new PlError(`burst: the clip has no frame from ${at[0]} to ${at.at(-1)}`);
  const header = `${clip.name}  around frame ${centre}${seq.fps ? ` (${(centre / seq.fps).toFixed(2)} s)` : ""}, left to right`;
  const items = frames.map((f) => ({ img: f.img, label: frameCaption(f) + (f.index === centre ? " <" : ""), colour: f.index === centre ? [255, 210, 90] : FG }));
  const file = writeSheet(gridSheet(items, { cols, header, maxWidth: opts.maxWidth, grow: true }), path.join(outputDir(opts, clip), `burst.${clip.stem}.png`), opts);
  return [{ sheet: file, centre, frames: frames.map((f) => f.index) }, `burst around frame ${centre} (${frames.length} frames, left to right): ${file}`, 0];
}

// ---- compare ---------------------------------------------------------------------------------

/** Mean luma of a 4 x 4 grid: brightness over time, kept per cell, so motion that leaves the mean alone still aligns. */
export function signature(img, n = 4) {
  const y = lumaPlane(img), { width: w, height: h } = img, out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0, c = 0;
    for (let yy = Math.floor((i * h) / n); yy < Math.floor(((i + 1) * h) / n); yy++) {
      for (let xx = Math.floor((j * w) / n); xx < Math.floor(((j + 1) * w) / n); xx++) { s += y[yy * w + xx]; c++; }
    }
    out[i * n + j] = c ? s / c : 0;
  }
  return out;
}

/** The lag (frames) with the largest correlation of two signature series: B[i + lag] shows what A[i] shows. Ties go to the smaller lag. */
export function bestLag(sa, sb, maxLag) {
  let best = [0, null];
  const lags = Array.from({ length: 2 * maxLag + 1 }, (_, k) => k - maxLag).sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const lag of lags) {
    const a = lag >= 0 ? sa.slice(0, sa.length - lag) : sa.slice(-lag), b = lag >= 0 ? sb.slice(lag) : sb.slice(0, sb.length + lag);
    const n = Math.min(a.length, b.length);
    if (n < 3) continue;
    const cells = a[0].length, ma = new Float64Array(cells), mb = new Float64Array(cells);
    for (let i = 0; i < n; i++) for (let c = 0; c < cells; c++) { ma[c] += a[i][c] / n; mb[c] += b[i][c] / n; }
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < n; i++) for (let c = 0; c < cells; c++) {
      const x = a[i][c] - ma[c], y = b[i][c] - mb[c];
      xy += x * y; xx += x * x; yy += y * y;
    }
    const den = Math.sqrt(xx * yy);
    if (den < 1e-9) continue;
    const corr = xy / den;
    if (best[1] === null || corr > best[1] + 1e-9) best = [lag, corr];
  }
  return best;
}

/** |A - B| x 4 per channel: where two frames differ, bright enough to see. */
function diffImage(a, b) {
  const data = new Uint8Array(a.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, Math.abs(a.data[i] - b.data[i]) * 4);
  return { width: a.width, height: a.height, channels: 3, data };
}

const round = (v, n) => Number(v.toFixed(n));

/**
 * Two clips frame by frame: luma box SSIM and PSNR per pair, B brought to A's analysed size, the worst pairs
 * that differ at all kept with their pictures for the sheet. Returns { rows, lag, corr, worst, first }.
 */
export async function compareClips(seqA, seqB, { size = 480, align = false, maxLag = 5, worst = 4 } = {}) {
  const dims = fitSize(seqA.width, seqA.height, size);
  let lag = 0, corr = null;
  if (align) {
    const sig = async (seq) => (await collect(seq, { size: 160 })).map((f) => signature(f.img));
    [lag, corr] = bestLag(await sig(seqA), await sig(seqB), maxLag);
  }
  const ia = seqA.frames({ dims })[Symbol.asyncIterator](), ib = seqB.frames({ dims })[Symbol.asyncIterator]();
  const rows = [], kept = [];
  let first = null;
  try {
    for (let k = 0; k < Math.abs(lag); k++) await (lag > 0 ? ib : ia).next();
    for (;;) {
      const [x, y] = await Promise.all([ia.next(), ib.next()]);
      if (x.done || y.done) break;
      const { ssim, psnr } = boxSsimPsnr(lumaPlane(x.value.img), lumaPlane(y.value.img), dims[0], dims[1]);
      const row = { index: x.value.index, indexB: y.value.index, t: x.value.t === null ? null : round(x.value.t, 4), ssim: round(ssim, 5), psnr: round(psnr, 3) };
      rows.push(row);
      first ??= { row, a: x.value, b: y.value };
      if (row.ssim >= 1 && row.psnr >= PSNR_CAP) continue;
      if (kept.length < worst || row.ssim < kept.at(-1).row.ssim) {
        kept.push({ row, a: x.value, b: y.value });
        kept.sort((p, q) => p.row.ssim - q.row.ssim || p.row.index - q.row.index);
        if (kept.length > worst) kept.pop();
      }
    }
  } finally {
    await ia.return?.();
    await ib.return?.();
  }
  return { rows, lag, corr, worst: kept, first };
}

async function cmdCompare(opts) {
  if (opts._.length !== 2 && opts._.length !== 0) throw new PlError("video compare takes two clips, A and B, or --shot NAME");
  if (opts.size < 16) throw new PlError("--size wants 16 or more");
  if (opts.worst < 1) throw new PlError("--worst wants 1 or more");
  const ca = clipInput(opts, { path: opts._[0], what: "compare A" });
  const cb = clipInput(opts, { path: opts._[1], role: "against", what: "compare B" });
  const rate = opts.rate ?? null;
  const seqA = openSequence(ca.input, { rate, what: "A" }), seqB = openSequence(cb.input, { rate, what: "B" });
  const notes = [];
  const { rows, lag, corr, worst, first } = await compareClips(seqA, seqB, { size: opts.size, align: opts.align, maxLag: opts.maxLag, worst: opts.worst });
  if (!rows.length) throw new PlError("compare: the clips have no frame in common");
  if (opts.align && corr === null) notes.push("--align: brightness does not change over the clips, so there was nothing to align on; lag 0 used");
  if (seqA.total !== seqB.total) notes.push(`A has ${seqA.total} frames and B ${seqB.total}: ${rows.length} pairs compared`);
  const ss = rows.map((r) => r.ssim), ps = rows.map((r) => r.psnr);
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const argmin = (v) => v.indexOf(Math.min(...v));
  const doc = {
    a: seqA.label, b: seqB.label, pairs: rows.length, lag, lagCorrelation: corr === null ? null : round(corr, 4),
    ssim: { mean: round(mean(ss), 5), min: Math.min(...ss), worstFrame: rows[argmin(ss)].index },
    psnr: { mean: round(mean(ps), 3), min: Math.min(...ps), worstFrame: rows[argmin(ps)].index },
    worst: worst.map((w) => w.row), notes,
  };
  const failed = [["worst-frame SSIM", doc.ssim.min, opts.minSsim], ["mean SSIM", doc.ssim.mean, opts.minMeanSsim], ["worst-frame PSNR", doc.psnr.min, opts.minPsnr]]
    .filter(([, got, want]) => want !== undefined && got < want).map(([name, got, want]) => `${name} ${Number(got.toPrecision(4))} < ${want}`);
  doc.gate = { passed: !failed.length, failed };

  const stem = ca.shot ? ca.stem : `${ca.stem}-vs-${cb.stem}`;
  const dir = outputDir(opts, ca);
  // time order reads better than badness order; when every pair is identical, the first one shows that
  const shown = worst.length ? [...worst].sort((p, q) => p.row.index - q.row.index) : [first];
  const tiles = shown.flatMap(({ row, a, b }) => [
    { img: a.img, label: `A ${frameCaption(a)}  ssim ${row.ssim.toFixed(3)}  psnr ${row.psnr.toFixed(1)}` }, { img: b.img, label: `B ${frameCaption(b)}` },
    { img: diffImage(a.img, b.img), label: "|A-B| x4", colour: [255, 210, 90] },
  ]);
  const head = worst.length ? `worst ${worst.length} of ${rows.length} frames` : `all ${rows.length} frames identical`;
  const sheet = gridSheet(tiles, { cols: 3, header: `${head}  A = ${ca.name}  B = ${cb.name}`, grow: true,
    footer: [`SSIM of luma over 7x7 windows at ${fitSize(seqA.width, seqA.height, opts.size).join("x")}; PSNR in dB, ${PSNR_CAP} means identical`], maxWidth: opts.maxWidth });
  doc.sheet = writeSheet(sheet, path.join(dir, `video.${stem}.worst.png`), opts);
  doc.report = path.join(dir, `video.${stem}.json`);
  writeJson(doc.report, { ...doc, perFrame: rows });
  const text = [
    `${rows.length} frame pairs  A = ${seqA.label}  B = ${seqB.label}${corr !== null ? `  lag ${lag >= 0 ? "+" : ""}${lag} frames (correlation ${corr.toFixed(3)})` : ""}`,
    `  SSIM  mean ${doc.ssim.mean.toFixed(4)}  worst ${doc.ssim.min.toFixed(4)} at frame ${doc.ssim.worstFrame}`,
    `  PSNR  mean ${doc.psnr.mean.toFixed(2)} dB  worst ${doc.psnr.min.toFixed(2)} dB at frame ${doc.psnr.worstFrame}${Math.max(...ps) >= PSNR_CAP ? `  (${PSNR_CAP} = identical)` : ""}`,
    ...notes.map((n) => `  note: ${n}`),
    `  worst frames: ${doc.sheet}`, `  report: ${doc.report}`,
    ...failed.map((f) => `  GATE FAILED: ${f}`),
  ].join("\n");
  return [doc, text, failed.length ? 1 : 0];
}

const SUB = { probe: cmdProbe, frames: cmdFrames, contact: cmdContact, burst: cmdBurst, compare: cmdCompare };

export async function run(argv) {
  const [kind, ...rest] = argv;
  if (!kind) throw new PlError(HELP);
  if (kind === "--help" || kind === "-h") { emit(null, false, HELP); return 0; }
  if (!SUB[kind]) throw new PlError(`unknown video command '${kind}' (probe, frames, contact, burst, compare)`);
  const opts = parseArgs(rest, FLAGS);
  if (opts.help) { emit(null, false, HELP); return 0; }
  checkWidth(opts);
  const [doc, text, code] = await SUB[kind](opts);
  emit(doc, opts.json, text);
  return code;
}

