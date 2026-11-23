// timing: where the iteration time went, and whether the render budget is
// kept. Reads runs/timing.jsonl (one line per iterate) and runs/budget.log
// (the large runs the guard let through) and reports, per phase, the median
// and 90th percentile, seconds per shot, iterations per active hour, the runs
// above the free budget with their reasons, and advice where a line is crossed.
// A report, not a gate: it exits 0 whatever it finds.
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { findRoot, loadConfig, runsDir } from "../lib/project.mjs";

const HELP = `usage: pl.mjs timing [--since 90m|2h|3d|2026-01-10|2026-01-10T14:00] [--json]

Where the iteration time went, from .agents/perceptual/runs/timing.jsonl and runs/budget.log:
per phase (render, compare, sheets) the count, median, 90th percentile and total; seconds per
shot; iterations per active hour; the runs above the free budget and their reasons; and advice.
Exit 0 always (a report, not a gate), 2 on a usage error.`;

export const PHASES = ["render", "compare", "sheets"];
const SLOW_ITERATION_S = 60; // past this an agent stops iterating and starts waiting
const FULL_RUNS_PER_DAY = 3; // the full suite is for finished work: this many in a day is a habit
const OVER_BUDGET_SHARE = 0.3;

/** An ISO time; one without a zone is local time. */
function parseTime(text) {
  const t = new Date(String(text ?? "").trim());
  return Number.isNaN(t.getTime()) ? null : t;
}

/** 90m, 2h, 3d, a date, or an ISO time, to the moment it names. */
export function parseSince(text, now = new Date()) {
  const m = String(text).match(/^(\d+(?:\.\d+)?)([mhd])$/i);
  if (m) return new Date(now.getTime() - Number(m[1]) * { m: 60e3, h: 3600e3, d: 86400e3 }[m[2].toLowerCase()]);
  const t = /^\d{4}-\d\d-\d\d$/.test(text) ? parseTime(`${text}T00:00`) : parseTime(text);
  if (!t) throw new PlError(`--since '${text}': use 90m, 2h, 3d, a date (2026-01-10) or a time (2026-01-10T14:00)`);
  return t;
}

const median = (v) => { const s = [...v].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
/** Nearest rank: a value that was measured. */
const p90 = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1))]; };
const r1 = (x) => Math.round(x * 10) / 10;

function readLines(file) {
  try { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()); } catch { return []; }
}

export function readTiming(file, since = null) {
  const rows = [];
  let bad = 0;
  for (const line of readLines(file)) {
    let doc;
    try { doc = JSON.parse(line); } catch { bad++; continue; }
    const at = parseTime(doc.when ?? doc.at);
    if (!at) { bad++; continue; }
    if (since && at < since) continue;
    const shots = Array.isArray(doc.shots) ? doc.shots.length : Number(doc.shots) || 0;
    const seconds = Object.fromEntries(PHASES.map((p) => [p, Number(doc.seconds?.[p]) || 0]));
    rows.push({ at, shots, seconds, total: PHASES.reduce((s, p) => s + seconds[p], 0), reason: doc.reason || "" });
  }
  return { rows, bad };
}

/** budget.log: time, kind, shots, reason, command, tab-separated. */
export function readBudget(file, since = null) {
  return readLines(file).map((l) => l.split("\t")).filter((p) => p.length >= 5).map((p) => ({ at: parseTime(p[0]), kind: p[1], shots: Number(p[2]) || p[2], reason: p[3], command: p[4] }))
    .filter((r) => r.at && (!since || r.at >= since));
}

export function report(timing, budget, free) {
  const doc = { iterations: timing.length, free, phases: {}, advice: [] };
  const advice = doc.advice;
  if (timing.length) {
    for (const p of PHASES) {
      const v = timing.map((r) => r.seconds[p]).filter((s) => s > 0);
      if (v.length) doc.phases[p] = { count: v.length, median: r1(median(v)), p90: r1(p90(v)), total: r1(v.reduce((a, b) => a + b, 0)) };
    }
    const totals = timing.map((r) => r.total);
    const perShot = timing.filter((r) => r.shots > 0).map((r) => r.total / r.shots);
    const hours = new Set(timing.map((r) => r.at.toISOString().slice(0, 13)));
    doc.iteration = { median: r1(median(totals)), p90: r1(p90(totals)), total: r1(totals.reduce((a, b) => a + b, 0)) };
    doc.secondsPerShot = perShot.length ? r1(median(perShot)) : null;
    doc.medianShots = median(timing.map((r) => r.shots));
    doc.activeHours = hours.size;
    doc.iterationsPerHour = r1(timing.length / hours.size);
    const over = timing.filter((r) => r.shots > free);
    doc.overBudget = { count: over.length, share: Math.round((over.length / timing.length) * 100) / 100,
      runs: over.map((r) => ({ at: r.at.toISOString().slice(0, 19) + "Z", shots: r.shots, seconds: r1(r.total), reason: r.reason })) };
    const med = Object.fromEntries(PHASES.map((p) => [p, doc.phases[p]?.median ?? 0]));
    if (doc.iteration.median > SLOW_ITERATION_S) {
      advice.push(`The median iteration takes ${doc.iteration.median} s (above ${SLOW_ITERATION_S}): narrow it to the 1 to ${free} shots that show the thing, or render fewer passes (beauty only while only the look changes).`);
    }
    if (med.compare > med.render && med.render > 0 && med.compare > 5) {
      advice.push(`Comparing (median ${med.compare} s) is slower than rendering (${med.render} s): is the cache defeated? An unchanged shot is skipped; look for --force, a new --run each time, or inputs rewritten on every run.`);
    }
    if (med.sheets > Math.max(med.render, 5)) advice.push(`Drawing sheets (median ${med.sheets} s) costs more than rendering: --no-sheets while only the numbers matter, then one run with sheets.`);
    if (timing.length >= 5 && doc.overBudget.share > OVER_BUDGET_SHARE) {
      advice.push(`${over.length} of ${timing.length} iterations rendered more than ${free} shots: an iteration answers one question with the shots that show it; a group once the change works; the suite once at the end.`);
    }
  } else advice.push("No iterations recorded in this period (iterate writes runs/timing.jsonl).");
  doc.budgetLog = { count: budget.length, byKind: {}, runs: budget.map((r) => ({ ...r, at: r.at.toISOString().slice(0, 19) + "Z" })) };
  const perDay = {};
  for (const r of budget) {
    doc.budgetLog.byKind[r.kind] = (doc.budgetLog.byKind[r.kind] ?? 0) + 1;
    if (r.kind === "full") { const day = r.at.toISOString().slice(0, 10); perDay[day] = (perDay[day] ?? 0) + 1; }
  }
  for (const [day, n] of Object.entries(perDay).sort()) {
    if (n >= FULL_RUNS_PER_DAY) advice.push(`${n} full runs on ${day}: the full suite is for finished work, once. Batch the fixes, then one full run.`);
  }
  return doc;
}

function asText(doc, since) {
  const out = [`iterations: ${doc.iterations}${since ? ` since ${since.toISOString().slice(0, 16)}Z` : ""}`];
  if (doc.iterations) {
    out.push(`  ${"phase".padEnd(9)}${"count".padStart(6)}${"median".padStart(9)}${"p90".padStart(9)}${"total".padStart(10)}`);
    for (const [p, s] of Object.entries(doc.phases)) out.push(`  ${p.padEnd(9)}${String(s.count).padStart(6)}${`${s.median}s`.padStart(9)}${`${s.p90}s`.padStart(9)}${`${s.total}s`.padStart(10)}`);
    const it = doc.iteration;
    out.push(`  ${"all".padEnd(9)}${String(doc.iterations).padStart(6)}${`${it.median}s`.padStart(9)}${`${it.p90}s`.padStart(9)}${`${it.total}s`.padStart(10)}`);
    out.push(`  median shots per iteration: ${doc.medianShots}; seconds per shot: ${doc.secondsPerShot ?? "-"}`);
    out.push(`  iterations per active hour: ${doc.iterationsPerHour} (${doc.activeHours} hour(s) with work)`);
    out.push(`  above the free budget of ${doc.free} shots: ${doc.overBudget.count} of ${doc.iterations}`);
    for (const r of doc.overBudget.runs.slice(-10)) out.push(`    ${r.at}  ${r.shots} shots, ${r.seconds} s  ${r.reason || "(no reason recorded)"}`);
  }
  const bl = doc.budgetLog;
  if (bl.count) {
    out.push(`large runs the guard let through: ${bl.count} (${Object.entries(bl.byKind).sort().map(([k, n]) => `${n} ${k}`).join(", ")})`);
    for (const r of bl.runs.slice(-10)) out.push(`    ${r.at}  ${r.kind}, ${r.shots} shots: ${r.reason}`);
  }
  out.push(...(doc.advice.length ? doc.advice.map((a) => `advice: ${a}`) : ["advice: none; the loop is fast and within its budget"]));
  return out.join("\n");
}

export async function run(argv) {
  const opts = parseArgs(argv, { since: { type: "string" }, json: { type: "bool" } }, { positionals: false });
  if (opts.help) { emit(null, false, HELP); return 0; }
  const since = opts.since ? parseSince(opts.since) : null;
  const root = findRoot();
  const config = loadConfig(root);
  const { rows, bad } = readTiming(path.join(runsDir(root), "timing.jsonl"), since);
  const doc = report(rows, readBudget(path.join(runsDir(root), "budget.log"), since), Number(config.budget?.free ?? 3));
  if (bad) doc.advice.push(`${bad} line(s) of timing.jsonl could not be read and were left out.`);
  emit(doc, opts.json, asText(doc, since));
  return 0;
}
