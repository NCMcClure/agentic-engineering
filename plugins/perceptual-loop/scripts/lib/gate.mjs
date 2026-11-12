// The gate and its tolerances. A gate compares a candidate with its own earlier
// run: it reports that a number moved and in which direction, never that the
// picture got better or worse. Calibration turns run-to-run noise into the
// tolerances the gate uses.
import fs from "node:fs";
import path from "node:path";
import { PlError } from "./args.mjs";
import { flattenMetrics, readJson, splitKey, stateDir, toleranceFor } from "./project.mjs";

// The value a metric has when candidate and reference are the same picture. It gives a move a
// direction (toward or away from the reference) and nothing more: toward the reference is not
// "better" when the candidate is the more correct of the two.
const IDEAL = { ssim: 1, edgeF1: 1, edgeRecall: 1, edgePrecision: 1, iou: 1, contrast: 1, deltaE: 0, deltaENorm: 0, exposureEV: 0, detailLog2: 0 };
const EPS = 1e-9; // values are rounded when written: equal numbers must not fail a zero tolerance on float dust
export const STATUSES = ["ok", "beyond", "new", "missing"];

export const baselinePath = (root) => path.join(stateDir(root), "baseline.json");

export function loadBaseline(root) {
  const doc = readJson(baselinePath(root));
  if (!doc) throw new PlError(`no ${baselinePath(root)}: run pl.mjs init first`);
  for (const k of ["tolerances", "spread", "entries", "notes"]) doc[k] ??= {};
  return doc;
}

const metricFiles = (runDir) => {
  let shots = [];
  try { shots = fs.readdirSync(runDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; }
  return shots.flatMap((shot) => fs.readdirSync(path.join(runDir, shot)).filter((f) => /^metrics\..+\.json$/.test(f)).map((f) => [shot, f.slice(8, -5)]));
};
export const shotsInRun = (runDir, source) => metricFiles(runDir).filter(([, s]) => s === source).map(([shot]) => shot).sort();
export const sourcesInRun = (runDir) => [...new Set(metricFiles(runDir).map(([, s]) => s))].sort();

/** Flat metrics of the shots, and for each shot that has none, why (not compared, or its error). */
export function readRun(runDir, shots, source) {
  const flat = {}, problems = {};
  for (const shot of shots) {
    const doc = readJson(path.join(runDir, shot, `metrics.${source}.json`));
    if (!doc) problems[shot] = "not in this run";
    else if ("error" in doc) problems[shot] = doc.error;
    else Object.assign(flat, flattenMetrics(doc));
  }
  return { flat, problems };
}

export function direction(metric, before, now) {
  const ideal = IDEAL[metric.split(".").at(-1)];
  if (ideal === undefined || Math.abs(now - ideal) === Math.abs(before - ideal)) return null;
  return Math.abs(now - ideal) < Math.abs(before - ideal) ? "toward" : "away from";
}

/** Every entry of the shots and source as ok, beyond, new, or missing. */
export function gate(baseline, flat, shots, source) {
  const wanted = new Set(shots);
  const mine = (key) => { const [shot, src] = splitKey(key); return src === source && wanted.has(shot); };
  const keys = [...Object.keys(baseline.entries).filter(mine), ...Object.keys(flat).filter((k) => !(k in baseline.entries))];
  const entries = keys.map((key) => {
    const [shot, , metric] = splitKey(key);
    const before = baseline.entries[key] ?? null, now = flat[key] ?? null;
    const e = { key, shot, metric, baseline: before, now };
    if (before === null) e.status = "new";
    else if (now === null) e.status = "missing";
    else {
      e.tolerance = toleranceFor(key, baseline);
      e.moved = now - before;
      e.status = Math.abs(e.moved) > e.tolerance + EPS ? "beyond" : "ok";
      e.direction = direction(metric, before, now);
    }
    return e;
  });
  const totals = Object.fromEntries(STATUSES.map((s) => [s, entries.filter((e) => e.status === s).length]));
  return { source, shots, totals, entries };
}

export const num = (v) => v.toFixed(4);
const signed = (v) => (v >= 0 ? "+" : "") + v.toFixed(4);

export function describe(e) {
  if (e.status === "missing") return `${e.metric}  ${num(e.baseline)} → (missing from the run)`;
  if (e.status === "new") return `${e.metric}  (new) ${num(e.now)}`;
  const where = e.direction ? `, ${e.direction} the reference` : "";
  return `${e.metric}  ${num(e.baseline)} → ${num(e.now)}  (moved by ${signed(e.moved)}, tolerance ${num(e.tolerance)}${where})`;
}

export const totalsLine = (totals) => STATUSES.map((k) => `${k} ${totals[k]}`).join(" / ");

export function reportText(report, problems, show = ["beyond", "missing"]) {
  const lines = [];
  for (const shot of report.shots) {
    if (shot in problems) { lines.push(`${shot}: no metrics (${problems[shot]})`); continue; }
    const rows = report.entries.filter((e) => e.shot === shot && show.includes(e.status));
    if (rows.length) lines.push(shot);
    const width = Math.max(0, ...rows.map((e) => e.metric.length));
    for (const e of rows) lines.push("  " + describe(e).replace(e.metric, e.metric.padEnd(width)));
  }
  lines.push(`${report.source}, ${report.shots.length} shots: ${totalsLine(report.totals)}`);
  return lines.join("\n");
}

export const failed = (report, problems) => Boolean(report.totals.beyond || report.totals.missing || Object.keys(problems).length);

/**
 * Accept a run's values for one source and the named shots, rebuilding in place:
 * an entry that stays keeps its position, a shot's new entries follow its old
 * ones, and nothing outside the selection is touched, so the diff of
 * baseline.json shows exactly what was accepted.
 */
export function rebuildEntries(old, flat, shots, source) {
  const wanted = new Set(shots);
  const newByShot = new Map();
  for (const [key, v] of Object.entries(flat)) {
    const shot = splitKey(key)[0];
    if (!newByShot.has(shot)) newByShot.set(shot, []);
    newByShot.get(shot).push([key, v]);
  }
  const out = new Map();
  let changed = 0, added = 0, removed = 0;
  const placed = new Set();
  const placeRest = (shot) => {
    if (placed.has(shot)) return;
    placed.add(shot);
    for (const [key, v] of newByShot.get(shot) ?? []) if (!out.has(key)) { out.set(key, v); added++; }
  };
  const lastOfShot = new Map();
  for (const key of Object.keys(old)) {
    const [shot, src] = splitKey(key);
    if (src === source && wanted.has(shot)) lastOfShot.set(shot, key);
  }
  for (const [key, v] of Object.entries(old)) {
    const [shot, src] = splitKey(key);
    if (src === source && wanted.has(shot)) {
      if (key in flat) { out.set(key, flat[key]); if (flat[key] !== v) changed++; }
      else removed++;
      if (lastOfShot.get(shot) === key) placeRest(shot);
    } else out.set(key, v);
  }
  for (const shot of shots) placeRest(shot);
  return { entries: Object.fromEntries(out), changed, added, removed };
}

// ---- calibration ------------------------------------------------------------------------

// No tolerance goes under these, however quiet the runs were: metrics are stored to 5 decimals,
// and six quiet runs do not promise a seventh. In the unit of each metric.
export const FLOORS = { ssim: 0.002, edgeF1: 0.002, edgeRecall: 0.002, edgePrecision: 0.002, iou: 0.002, deltaE: 0.05, deltaENorm: 0.05, exposureEV: 0.005, contrast: 0.005, detailLog2: 0.01 };
const DEFAULT_FLOOR = 0.001;

/** `shot/candidate/region.glass.edgeF1` to `candidate/region.*.edgeF1`: the pattern a tolerance is written for. */
export function metricClass(key) {
  const [, source, metric] = splitKey(key);
  const parts = metric.split(".");
  if (parts[0] === "region" && parts.length === 3) parts[1] = "*";
  return `${source}/${parts.join(".")}`;
}

export const floorOf = (cls) => FLOORS[cls.split(".").at(-1)] ?? DEFAULT_FLOOR;

/** Up to two significant digits, rounding up: a tolerance is read by people and must not drop below what was measured. */
export function roundUp(v, digits = 2) {
  if (v <= 0) return 0;
  const scale = 10 ** (digits - 1 - Math.floor(Math.log10(v)));
  return Math.ceil(v * scale - 1e-9) / scale;
}

const fmean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round5 = (v) => Number(v.toFixed(5));

/** If the values fall into two tight groups far apart, the groups' centres; else null. */
export function twoClusters(values) {
  const v = [...values].sort((a, b) => a - b);
  let gap = -Infinity, at = 0;
  for (let i = 0; i < v.length - 1; i++) if (v[i + 1] - v[i] >= gap) { gap = v[i + 1] - v[i]; at = i; }
  const low = v.slice(0, at + 1), high = v.slice(at + 1);
  if (gap > 0 && Math.max(low.at(-1) - low[0], high.at(-1) - high[0]) <= gap / 4) return [fmean(low), fmean(high)];
  return null;
}

/** Spread per entry over the runs, per metric class the largest steady spread and the tolerance it gives. */
export function measure(runs, margin = 2.5) {
  const keys = Object.keys(runs[0]).filter((k) => runs.every((r) => k in r));
  const shared = new Set(keys);
  const partial = [...new Set(runs.flatMap((r) => Object.keys(r)))].filter((k) => !shared.has(k)).sort();
  const spread = Object.fromEntries(keys.map((k) => { const vs = runs.map((r) => r[k]); return [k, Math.max(...vs) - Math.min(...vs)]; }));
  const byClass = new Map();
  for (const k of keys) {
    const cls = metricClass(k);
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(k);
  }
  const classes = {}, bistable = {};
  for (const cls of [...byClass.keys()].sort()) {
    const members = byClass.get(cls), floor = floorOf(cls);
    const typical = median(members.map((k) => spread[k]));
    const steady = [];
    for (const k of members) {
      // Bistable: two tight clusters whose distance stands far out of the class's ordinary noise.
      // It takes three runs to tell a flip from plain spread (two values are always "two clusters").
      const centres = runs.length >= 3 ? twoClusters(runs.map((r) => r[k])) : null;
      if (centres && spread[k] > Math.max(2 * floor, 4 * typical)) bistable[k] = { spread: spread[k], values: centres.map(round5), class: cls };
      else steady.push(k);
    }
    const largest = steady.length ? Math.max(...steady.map((k) => spread[k])) : 0;
    const where = steady.length ? steady.reduce((best, k) => (spread[k] > spread[best] ? k : best)) : null;
    classes[cls] = { entries: members.length, maxSpread: largest, at: where, medianSpread: typical, tolerance: roundUp(Math.max(floor, margin * largest)), floor, bistable: members.length - steady.length };
  }
  return { keys: keys.length, notInEveryRun: partial, classes, bistable };
}
