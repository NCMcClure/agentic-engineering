// compare: each candidate's beauty pass against the reference's, per shot.
// Writes one metrics.<source>.json per shot and candidate into the run folder.
// The numbers say how far two pictures are apart; they never say which is right.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { loadPass } from "../lib/image.mjs";
import { analyse, areaOf, iou, MIN_REGION_AREA, pack, regionMetrics, regionsFromBoxes, regionsFromId, regionsFromMask } from "../lib/metrics.mjs";
import { findRoot, loadConfig, passFile, readJson, runsDir, selected, selectionOf, SELECTION_FLAGS, shotPath, stateDir, timestamp, writeJson } from "../lib/project.mjs";

const HELP = `usage: pl.mjs compare SELECTION [--source ID]... [--run NAME | --out DIR] [--edge-tolerance PX] [--force] [--json]

Measure each candidate against the reference for the selected shots (names or globs, --shots a,b,
--group, --match, --all) into <run>/<shot>/metrics.<source>.json.

  --source ID          a candidate to compare (repeatable; default: every candidate of the config)
  --run NAME           the run folder under runs/ (default: a timestamp)
  --out DIR            write the run here instead
  --edge-tolerance PX  how far apart two edges may be and still match (default 2)
  --force              compare even when inputs, options and the code are unchanged

What is measured on what: ssim and deltaE on the candidate as it is; exposureEV, wb and contrast
are the fit to the reference's exposure and white balance; deltaENorm, the edge numbers and
detailLog2 on the candidate after that fit.`;

const LIB = path.join(import.meta.dirname, "..", "lib");
let codeHash = null;
// the code that defines the numbers: a change to any of it makes every cached result stale
const code = () => (codeHash ??= crypto.createHash("sha1")
  .update(["metrics.mjs", "color.mjs", "filters.mjs", "png.mjs", "image.mjs"].map((f) => fs.readFileSync(path.join(LIB, f))).join("\0"))
  .update(fs.readFileSync(import.meta.filename)).digest("hex").slice(0, 12));

function cacheKey(files, options) {
  const stamp = files.map((f) => { try { const st = fs.statSync(f); return [path.basename(f), st.size, Number(st.mtimeMs)]; } catch { return [path.basename(f), null, null]; } });
  return crypto.createHash("sha1").update(JSON.stringify([stamp, options, code()])).digest("hex");
}

/** Every float rounded to 5 decimals, the precision metrics are stored at. */
const rounded = (v) => (typeof v === "number" && !Number.isInteger(v) ? Number(v.toFixed(5))
  : Array.isArray(v) ? v.map(rounded) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)])) : v);

/** The regions of a shot, cut once from one source so every run and every candidate measures the same pixels. */
function cutRegions(shotDir, shotDoc, source, size, minArea) {
  const idFile = passFile(shotDir, source, "id"), maskFile = passFile(shotDir, source, "mask");
  if (fs.existsSync(idFile)) {
    const names = readJson(path.join(shotDir, "ids.json"), {}) ?? {};
    return ["id", regionsFromId(loadPass(idFile, { size, nearest: true }).img, names, minArea)];
  }
  let kind, regions;
  if (fs.existsSync(maskFile)) { kind = "mask"; regions = regionsFromMask(loadPass(maskFile, { size, mode: "L", nearest: true }).img); }
  else if (shotDoc.regions) { kind = "boxes"; regions = regionsFromBoxes(shotDoc.regions, size[0], size[1]); }
  else return [null, []];
  return [kind, regions.filter((r) => areaOf(r.mask) >= minArea)];
}

export const metricsFile = (runDir, shot, source) => path.join(runDir, shot, `metrics.${source}.json`);

/** One shot, one candidate. A failure is a document with `error`, never a throw, so one bad shot never stops the run. */
export function compareOne(task) {
  const { shot, source, reference, shotDir, out, regionsFrom } = task;
  const head = { shot, source, against: reference };
  const passes = [...new Set([reference, source, regionsFrom])].flatMap((s) => ["beauty", "id", "mask"].map((p) => passFile(shotDir, s, p)));
  const key = cacheKey([...passes, path.join(shotDir, "shot.json"), path.join(shotDir, "ids.json")],
    { reference, regionsFrom, edgeTolerance: task.edgeTolerance, minRegionArea: task.minRegionArea, want: task.want });
  if (!task.force) {
    const old = readJson(out);
    if (old?.cacheKey === key) return { ...old, cached: true };
  }
  let doc;
  try {
    const refFile = passFile(shotDir, reference), candFile = passFile(shotDir, source);
    const absent = [refFile, candFile].filter((f) => !fs.existsSync(f)).map((f) => path.basename(f));
    if (absent.length) throw new PlError(`missing pass: ${absent.join(", ")}`);
    const notes = [];
    const { img: ref, native: [w, h] } = loadPass(refFile);
    const { img: cand, native: [cw, ch] } = loadPass(candFile, { size: [w, h] });
    if (cw !== w || ch !== h) {
      if (Math.abs(cw / ch / (w / h) - 1) > 0.01) throw new PlError(`${source} is ${cw}x${ch}, ${reference} is ${w}x${h}: the aspect differs by more than 1 %`);
      notes.push(`${source} resized from ${cw}x${ch} to the reference's ${w}x${h}`);
    }
    const an = analyse(ref, cand, { edgeTolerance: task.edgeTolerance, want: task.want });
    if (an.rough) notes.push("few mid-tone pixels: the exposure and white-balance fit used the whole frame and is rough");
    const shotDoc = readJson(path.join(shotDir, "shot.json"), {}) ?? {};
    const [kind, regions] = cutRegions(shotDir, shotDoc, regionsFrom, [w, h], task.minRegionArea);
    // iou needs the candidate's own cut of the same thing; when the candidate is the regions' source it would be 1
    let own = null;
    const ownFile = kind === "id" || kind === "mask" ? passFile(shotDir, source, kind) : null;
    if (source !== regionsFrom && ownFile && fs.existsSync(ownFile)) {
      const img = loadPass(ownFile, { size: [w, h], mode: kind === "id" ? "RGB" : "L", nearest: true }).img;
      own = kind === "id" ? Int32Array.from({ length: w * h }, (_, i) => pack(img.data, i)) : Uint8Array.from(img.data, (v) => (v > 127 ? 1 : 0));
    }
    const outRegions = {};
    for (const r of regions) {
      const m = regionMetrics(r.mask, an.maps);
      if (own) {
        const theirs = kind === "id" ? Uint8Array.from(own, (c) => (c === r.colour ? 1 : 0)) : r.name === "subject" ? own : own.map((v) => 1 - v);
        m.iou = iou(r.mask, theirs);
      }
      outRegions[r.name] = m;
    }
    doc = { ...head, size: [w, h], regionsFrom: kind ? regionsFrom : null, regionsKind: kind, frame: an.frame, regions: outRegions, notes };
  } catch (e) {
    doc = { ...head, error: e instanceof PlError || e.code ? e.message : `${e.name}: ${e.message}`, notes: [] };
  }
  doc = rounded(doc);
  doc.cacheKey = key;
  writeJson(out, doc);
  return doc;
}

/** Compare every (shot, source) against the reference; documents come back in the order asked. */
export function runCompare(root, config, shots, sources, runDir, { force = false, edgeTolerance = 2 } = {}) {
  const baseline = readJson(path.join(stateDir(root), "baseline.json"), {}) ?? {};
  const common = {
    reference: config.reference, regionsFrom: config.regionsFrom || config.reference, edgeTolerance, force,
    minRegionArea: Number(baseline.minRegionArea ?? MIN_REGION_AREA),
    want: Object.fromEntries(["ssim", "deltaE", "edges", "detail"].map((k) => [k, config.metrics?.[k] !== false])),
  };
  // debt: one comparison at a time on the main thread, move to worker_threads when a smoke run spends more than a minute comparing
  return shots.flatMap((shot) => sources.map((source) => compareOne({ ...common, shot, source, shotDir: shotPath(shot, root, config), out: metricsFile(runDir, shot, source) })));
}

export function table(docs) {
  const cell = (d, k, digits, sign = false) => { const v = d.frame?.[k]; return v === undefined ? "-" : (sign && v >= 0 ? "+" : "") + v.toFixed(digits); };
  const rows = [["shot", "source", "ssim", "ΔE norm", "EV", "edge F1", ""],
    ...docs.map((d) => [d.shot, d.source, cell(d, "ssim", 4), cell(d, "deltaENorm", 2), cell(d, "exposureEV", 2, true), cell(d, "edgeF1", 3),
      d.error ? `ERROR: ${d.error}` : d.cached ? "(cached)" : ""])];
  const widths = [0, 1, 2, 3, 4, 5].map((i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : i < 6 ? c.padStart(widths[i]) : c)).join("  ").trimEnd()).join("\n");
}

export async function run(argv) {
  const opts = parseArgs(argv, { ...SELECTION_FLAGS, source: { type: "string", multi: true }, run: { type: "string" }, out: { type: "string" },
    "edge-tolerance": { type: "int", default: 2 }, force: { type: "bool" }, json: { type: "bool" } });
  if (opts.help) { emit(null, false, HELP); return 0; }
  const root = findRoot();
  const config = loadConfig(root, { required: true });
  const shots = selected(selectionOf(opts), root, config);
  const sources = opts.source.length ? opts.source : [...config.candidates];
  if (sources.includes(config.reference)) throw new PlError(`'${config.reference}' is the reference: compare candidates against it, not itself`);
  const runDir = opts.out ? path.resolve(opts.out) : path.join(runsDir(root), opts.run ?? timestamp());
  const started = performance.now();
  const docs = runCompare(root, config, shots, sources, runDir, { force: opts.force, edgeTolerance: opts.edgeTolerance });
  for (const d of docs) delete d.cacheKey;
  emit(docs, opts.json, `${table(docs)}\n${docs.length} comparisons in ${((performance.now() - started) / 1000).toFixed(1)} s -> ${runDir}`);
  return docs.some((d) => d.error) ? 1 : 0;
}
