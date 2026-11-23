// calibrate: measure run-to-run noise from several runs of the same shots and
// turn it into tolerances. It renders nothing: make the runs first (the same
// shots, the same code: pl.mjs iterate --group smoke --run cal --repeat 6),
// then name them here. A tolerance is the largest spread seen in a class of
// metrics times a margin; an entry that flips between two values gets its own
// measured spread instead of widening its whole class.
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { baselinePath, loadBaseline, measure, readRun, shotsInRun, sourcesInRun } from "../lib/gate.mjs";
import { findRoot, runsDir, splitKey, writeJson } from "../lib/project.mjs";

const HELP = `usage: pl.mjs calibrate (--runs A,B,... | --dirs A,B,...) [--source ID]... [--margin X] [--write-tolerances] [--write-spread] [--json]

  --runs A,B,...        two or more runs under runs/ (six make a tolerance worth trusting); repeatable
  --dirs A,B,...        the same, as run folders anywhere
  --source ID           only these candidates (repeatable; default: every source in the runs)
  --margin X            tolerance = X times the class's largest spread (default 2.5)
  --write-tolerances    write the proposed tolerances, each with a dated note, into baseline.json
  --write-spread        write a per-entry spread for every bistable entry into baseline.json`;

const list = (values) => values.flatMap((v) => v.split(",")).filter(Boolean);

export async function run(argv) {
  const opts = parseArgs(argv, { runs: { type: "string", multi: true }, dirs: { type: "string", multi: true }, source: { type: "string", multi: true },
    margin: { type: "float", default: 2.5 }, "write-tolerances": { type: "bool" }, "write-spread": { type: "bool" }, json: { type: "bool" } }, { positionals: false });
  if (opts.help) { emit(null, false, HELP); return 0; }
  const root = findRoot();
  if (Boolean(opts.runs.length) === Boolean(opts.dirs.length)) throw new PlError("name the runs: --runs A,B,... or --dirs A,B,..., one of them");
  const dirs = opts.dirs.length ? list(opts.dirs).map((d) => path.resolve(d)) : list(opts.runs).map((r) => path.join(runsDir(root), r));
  if (dirs.length < 2) throw new PlError("a spread needs at least two runs of the same shots");
  const missing = dirs.filter((d) => !fs.existsSync(d));
  if (missing.length) throw new PlError(`no run folder: ${missing.join(", ")}`);
  const runs = [], shots = new Set();
  for (const d of dirs) {
    const flat = {};
    for (const source of opts.source.length ? opts.source : sourcesInRun(d)) Object.assign(flat, readRun(d, shotsInRun(d, source), source).flat);
    if (!Object.keys(flat).length) throw new PlError(`${d} holds no metrics${opts.source.length ? ` for ${opts.source.join(", ")}` : ""}`);
    runs.push(flat);
    for (const k of Object.keys(flat)) shots.add(splitKey(k)[0]);
  }
  const doc = measure(runs, opts.margin);
  Object.assign(doc, { runs: dirs.map((d) => path.basename(d)), shots: shots.size, margin: opts.margin });
  if (!doc.keys) throw new PlError("the runs share no metric: were they made of the same shots and source?");

  const today = new Date().toISOString().slice(0, 10);
  const written = [];
  if (opts.writeTolerances || opts.writeSpread) {
    const baseline = loadBaseline(root);
    if (opts.writeTolerances) {
      for (const [cls, c] of Object.entries(doc.classes)) {
        baseline.tolerances[cls] = c.tolerance;
        baseline.notes[cls] = `${runs.length} runs of ${shots.size} shots on ${today}: max spread ${c.maxSpread.toFixed(5)}, tolerance = ${opts.margin}x (floor ${c.floor})`;
      }
      written.push(`${Object.keys(doc.classes).length} tolerances`);
    }
    if (opts.writeSpread) {
      for (const [key, b] of Object.entries(doc.bistable)) {
        baseline.spread[key] = Number(b.spread.toFixed(5));
        baseline.notes[key] = `bistable in ${runs.length} runs on ${today}: takes ${b.values[0]} or ${b.values[1]}`;
      }
      written.push(`${Object.keys(doc.bistable).length} per-entry spreads`);
    }
    writeJson(baselinePath(root), baseline);
  }
  doc.written = written;

  const rows = [["class", "entries", "median", "max spread", "tolerance", "largest at"],
    ...Object.entries(doc.classes).map(([cls, c]) => [cls, String(c.entries), c.medianSpread.toFixed(5), c.maxSpread.toFixed(5), String(c.tolerance),
      (c.at ?? "-") + (c.bistable ? `  (+${c.bistable} bistable, left out)` : "")])];
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const lines = [`${runs.length} runs (${doc.runs.join(", ")}) of ${shots.size} shots, ${doc.keys} numbers each; tolerance = max(${opts.margin} x max spread, floor)`,
    ...rows.map((r) => r.map((c, i) => (i === 0 || i === 5 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ").trimEnd())];
  if (runs.length < 3) lines.push("with two runs a flip between two values cannot be told from noise: use three or more to find bistable entries");
  if (Object.keys(doc.bistable).length) {
    lines.push("bistable entries (two tight clusters, far apart for their class): give them a per-entry spread with --write-spread");
    for (const [k, b] of Object.entries(doc.bistable)) lines.push(`  ${k}  ${b.values[0]} or ${b.values[1]}  (spread ${b.spread.toFixed(5)})`);
  }
  if (doc.notInEveryRun.length) lines.push(`${doc.notInEveryRun.length} numbers are not in every run and were left out (first: ${doc.notInEveryRun[0]})`);
  lines.push(written.length ? `baseline.json: wrote ${written.join(" and ")}` : "nothing written (--write-tolerances and --write-spread apply this to baseline.json)");
  emit(doc, opts.json, lines.join("\n"));
  return 0;
}
