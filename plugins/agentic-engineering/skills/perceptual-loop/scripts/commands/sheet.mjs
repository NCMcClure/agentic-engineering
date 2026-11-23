// sheet: pictures made for eyes. A number says that two pictures differ; a
// sheet shows how. Each kind writes one PNG (or a JPEG with --jpeg) and prints
// its path; the layouts are in lib/sheets.mjs.
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { findRoot, loadConfig, passFile, readJson, resolveShots, runsDir, shotPath, timestamp } from "../lib/project.mjs";
import { contactSheet, diffSheet, expandFrames, MAX_WIDTH, rowSheet, saveSheet, shotSheet } from "../lib/sheets.mjs";
import { loadPass } from "../lib/image.mjs";

const HELP = `usage: pl.mjs sheet <kind> ... [--out FILE] [--max-width PX] [--jpeg] [--quality Q] [--json]

  shot SHOT [--source ID] [--run RUN]      reference | before | after, then what the run changed, where the
                                           edges differ, and the colour difference (before: <run>/<shot>/before.<source>.png)
  triptych FILE... [--label TEXT]... [--box x0,y0,x1,y1] [--zoom K]
                                           pictures side by side at one height (reference | before | after)
  crop SHOT --box x0,y0,x1,y1 [--zoom K] [--source ID]... [--run RUN]
                                           one box of a shot from every source, zoomed with square pixels
  contact PATH... [--every N] [--cols C] [--fps F]
                                           a grid of frames (pictures, or folders of them) with numbers and times
  diff A B [--max-delta-e V]               the colour-difference heat map of B against A; exits 1 above V

  --out FILE       where to write it (default: under .agents/perceptual/runs/)
  --max-width PX   the sheet's largest width (default ${MAX_WIDTH}, read whole by a vision model)
  --jpeg           write a JPEG instead of a PNG; --quality Q sets it (default 90)
  --json           one JSON document: {"sheet": path}, plus the numbers for diff

A box is x0,y0,x1,y1 in 0..1 of each picture's frame, so pictures of different sizes show the same part.
The heat maps share one fixed scale (dE2000 0 to 20+), so two sheets made apart compare by eye.`;

const FLAGS = {
  out: { type: "string" }, "max-width": { type: "int", default: MAX_WIDTH }, jpeg: { type: "bool" }, quality: { type: "int", default: 90 },
  json: { type: "bool" }, source: { type: "string", multi: true }, run: { type: "string" }, label: { type: "string", multi: true },
  box: { type: "string" }, zoom: { type: "float", default: 1 }, every: { type: "int", default: 1 }, cols: { type: "int" }, fps: { type: "float" },
  "max-delta-e": { type: "float" }, "edge-tolerance": { type: "int", default: 2 },
};

/** x0,y0,x1,y1 in 0..1 with x0 < x1 and y0 < y1. */
export function parseBox(text) {
  const v = String(text).split(",").map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || !(v[0] >= 0 && v[0] < v[2] && v[2] <= 1 && v[1] >= 0 && v[1] < v[3] && v[3] <= 1)) {
    throw new PlError(`--box '${text}': write x0,y0,x1,y1 in 0..1 of the frame, with x0 < x1 and y0 < y1`);
  }
  return v;
}

const oneShot = (opts, root, config, kind) => {
  if (opts._.length !== 1) throw new PlError(`sheet ${kind} takes one shot name`);
  return resolveShots({ names: opts._ }, root, config)[0];
};

const existing = (files) => {
  const absent = files.filter((f) => !fs.existsSync(f));
  if (absent.length) throw new PlError(`no such picture: ${absent.join(", ")}`);
  return files;
};

/** The sheet of one shot and candidate, as iterate draws it: the before picture comes from the run when it kept one. */
export function drawShotSheet(root, config, shot, source, runDir, { maxWidth = MAX_WIDTH, jpeg = false, quality = 90, out = null, edgeTolerance = 2 } = {}) {
  const sd = shotPath(shot, root, config), reference = config.reference;
  const files = existing([passFile(sd, reference), passFile(sd, source)]);
  const kept = runDir ? path.join(runDir, shot, `before.${source}.png`) : null;
  const before = kept && fs.existsSync(kept) ? kept : null;
  const metrics = runDir ? readJson(path.join(runDir, shot, `metrics.${source}.json`)) : null;
  const sheet = shotSheet({ reference: files[0], before, after: files[1], names: { reference, after: source }, title: `${shot} | ${source} vs ${reference}`,
    frame: metrics?.frame ?? null, maxWidth, edgeTolerance });
  return saveSheet(sheet, out ?? path.join(runDir ?? path.join(runsDir(root), "sheets"), shot, `sheet.${source}.png`), { jpeg, quality });
}

export async function run(argv) {
  const [kind, ...rest] = argv;
  if (!kind) throw new PlError(HELP);
  if (kind === "--help" || kind === "-h") { emit(null, false, HELP); return 0; }
  const opts = parseArgs(rest, FLAGS);
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (opts.maxWidth < 200) throw new PlError("--max-width wants 200 or more");
  if (opts.quality < 1 || opts.quality > 100) throw new PlError("--quality wants 1 to 100");
  if (!(opts.zoom > 0)) throw new PlError("--zoom wants a number above 0");
  const root = findRoot();
  const box = opts.box ? parseBox(opts.box) : null;
  const save = (sheet, name) => saveSheet(sheet, opts.out ? path.resolve(opts.out) : path.join(runsDir(root), "sheets", `${name}-${timestamp()}.png`),
    { jpeg: opts.jpeg, quality: opts.quality });
  const doc = {};
  let code = 0, text;

  if (kind === "shot") {
    const config = loadConfig(root, { required: true });
    const shot = oneShot(opts, root, config, kind);
    const source = opts.source[0] ?? config.candidates[0];
    const runDir = opts.run ? path.join(runsDir(root), opts.run) : null;
    doc.sheet = drawShotSheet(root, config, shot, source, runDir, { maxWidth: opts.maxWidth, jpeg: opts.jpeg, quality: opts.quality,
      out: opts.out ? path.resolve(opts.out) : null, edgeTolerance: opts.edgeTolerance });
  } else if (kind === "triptych") {
    if (!opts._.length) throw new PlError("sheet triptych takes the pictures to put side by side");
    const sheet = rowSheet(existing(opts._), { labels: opts.label.length ? opts.label : null, box, zoom: opts.zoom, maxWidth: opts.maxWidth });
    doc.sheet = save(sheet, "triptych");
  } else if (kind === "crop") {
    if (!box) throw new PlError("sheet crop needs --box x0,y0,x1,y1");
    const config = loadConfig(root, { required: true });
    const shot = oneShot(opts, root, config, kind);
    const sd = shotPath(shot, root, config);
    const sources = opts.source.length ? opts.source : [config.reference, ...config.candidates].filter((s) => fs.existsSync(passFile(sd, s)));
    if (!sources.length) throw new PlError(`${shot} has no beauty pass of any source`);
    // the pictures as compare reads them: alpha dropped, every source at the reference's size when it has one
    const sheet = rowSheet(existing(sources.map((s) => passFile(sd, s))), { labels: sources, box, zoom: opts.zoom, maxWidth: opts.maxWidth, header: shot,
      load: (f) => loadPass(f).img });
    const name = `crop.${box.map((v) => Number(v.toFixed(4))).join("-")}.png`;
    doc.sheet = saveSheet(sheet, opts.out ? path.resolve(opts.out) : path.join(opts.run ? path.join(runsDir(root), opts.run) : path.join(runsDir(root), "sheets"), shot, name),
      { jpeg: opts.jpeg, quality: opts.quality });
  } else if (kind === "contact") {
    const frames = expandFrames(opts._);
    if (!frames.length) throw new PlError("sheet contact takes pictures, or a folder of them");
    if (opts.every < 1) throw new PlError("--every wants 1 or more");
    doc.sheet = save(contactSheet(existing(frames), { every: opts.every, cols: opts.cols ?? null, fps: opts.fps ?? null, maxWidth: opts.maxWidth }), "contact");
  } else if (kind === "diff") {
    if (opts._.length !== 2) throw new PlError("sheet diff takes two pictures, A and B");
    const { sheet, frame } = diffSheet(...existing(opts._), { maxWidth: opts.maxWidth });
    doc.sheet = save(sheet, "diff");
    // the numbers the heat map is drawn from, so a step can gate on them instead of reading a picture
    Object.assign(doc, { deltaE: Number(frame.deltaE.toFixed(5)), deltaENorm: Number(frame.deltaENorm.toFixed(5)), exposureEV: Number(frame.exposureEV.toFixed(5)) });
    const lines = [doc.sheet, `mean dE ${frame.deltaE.toFixed(3)}, after normalisation ${frame.deltaENorm.toFixed(3)}, exposure ${frame.exposureEV >= 0 ? "+" : ""}${frame.exposureEV.toFixed(3)} EV`];
    if (opts.maxDeltaE !== undefined) {
      doc.passed = frame.deltaENorm <= opts.maxDeltaE;
      code = doc.passed ? 0 : 1;
      lines.push(`gate (mean dE after normalisation <= ${opts.maxDeltaE}): ${doc.passed ? "passed" : "failed"}`);
    }
    text = lines.join("\n");
  } else throw new PlError(`unknown sheet kind '${kind}' (shot, triptych, crop, contact, diff)`);
  emit(doc, opts.json, text ?? doc.sheet);
  return code;
}
