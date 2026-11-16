// baseline: gate a run against the accepted values, accept a run for named
// shots, show or set tolerances, and find what is stale on unchanged main.
// A gate compares a candidate with its own earlier run; whether the picture is
// better for a move is decided by looking, never here.
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { baselinePath, failed, gate, loadBaseline, readRun, rebuildEntries, reportText, shotsInRun } from "../lib/gate.mjs";
import { findRoot, hasSelection, loadConfig, runsDir, selected, selectionOf, SELECTION_FLAGS, splitKey, writeJson } from "../lib/project.mjs";

const HELP = `usage: pl.mjs baseline <check | stale | update | tolerances show | tolerances set PATTERN VALUE --note TEXT> [options] [--json]

  check --source ID (--run RUN | --dir DIR) [SELECTION]
        gate a run: every entry of the shots as ok, beyond, new or missing; exit 1 if any is beyond or missing.
        With no selection, the shots the run compared.
  stale --source ID (--run RUN | --dir DIR) [SELECTION]
        the same gate on a run made from the unchanged main branch: what is beyond there was already off.
  update --source ID (--run RUN | --dir DIR) (SHOTS | --shots a,b | --group NAME | --all-shots-of-run)
        accept a run's values for one source and the named shots; nothing else is rewritten.
  tolerances show | tolerances set PATTERN VALUE --note TEXT
        a pattern is '<source>/<metric>', where '*' matches one part: 'candidate/region.*.edgeF1'.
        A tolerance without a note saying what was measured is a guess.`;

function runDirOf(opts, root) {
  if (Boolean(opts.run) === Boolean(opts.dir)) throw new PlError("name the run: --run RUN (under runs/) or --dir DIR, one of them");
  const dir = opts.dir ? path.resolve(opts.dir) : path.join(runsDir(root), opts.run);
  if (!fs.existsSync(dir)) throw new PlError(`no run folder ${dir}`);
  return dir;
}

function check(opts, root, config, stale) {
  if (!opts.source) throw new PlError(`baseline ${stale ? "stale" : "check"} needs --source ID`);
  const runDir = runDirOf(opts, root);
  const sel = selectionOf(opts);
  // with no selection the run says which shots are meant: a gate is about what was just compared
  const shots = hasSelection(sel) ? selected(sel, root, config) : shotsInRun(runDir, opts.source);
  if (!shots.length) throw new PlError(`${runDir} holds no metrics.${opts.source}.json`);
  const baseline = loadBaseline(root);
  const { flat, problems } = readRun(runDir, shots, opts.source);
  const report = { ...gate(baseline, flat, shots, opts.source), problems };
  let text = reportText(report, problems);
  if (stale) {
    // this run was made from the unchanged main branch, so whatever is beyond tolerance moved before the current work began
    report.stale = report.entries.filter((e) => e.status === "beyond" || e.status === "missing").map((e) => e.key);
    if (report.stale.length) {
      const staleShots = [...new Set(report.stale.map((k) => splitKey(k)[0]))].sort().join(",");
      text += `\n${report.stale.length} entries are beyond tolerance on unchanged main: the baseline is stale for them. `
        + "Do not count them against the current work; refresh them in a separate, labelled step with\n"
        + `  pl.mjs baseline update --source ${opts.source} --shots ${staleShots} ${opts.run ? `--run ${opts.run}` : `--dir ${opts.dir}`}`;
    } else text += "\nnothing is stale: the baseline holds on unchanged main";
  }
  emit(report, opts.json, text);
  return failed(report, problems) ? 1 : 0;
}

function update(opts, root, config) {
  if (!opts.source) throw new PlError("baseline update needs --source ID: one candidate at a time");
  const runDir = runDirOf(opts, root);
  const sel = selectionOf(opts);
  if (sel.all) throw new PlError("update is always targeted: --all means every shot in the folder; say --all-shots-of-run for every shot this run compared");
  let shots;
  if (opts.allShotsOfRun) shots = shotsInRun(runDir, opts.source);
  else if (hasSelection(sel)) shots = selected(sel, root, config);
  else throw new PlError("update is always targeted: name the shots (--shots a,b), a --group, or say --all-shots-of-run");
  const { flat, problems } = readRun(runDir, shots, opts.source);
  if (Object.keys(problems).length || !shots.length) {
    const why = Object.entries(problems).map(([s, p]) => `${s}: ${p}`).join("; ") || `no metrics.${opts.source}.json in it`;
    throw new PlError(`nothing written: the run ${path.basename(runDir)} cannot update every selected shot (${why})`);
  }
  const baseline = loadBaseline(root);
  const { entries, changed, added, removed } = rebuildEntries(baseline.entries, flat, shots, opts.source);
  baseline.entries = entries;
  writeJson(baselinePath(root), baseline);
  emit({ source: opts.source, shots, changed, added, removed, run: runDir }, opts.json,
    `baseline.json: ${opts.source}, ${shots.length} shots from ${path.basename(runDir)}: ${changed} entries changed, ${added} added, ${removed} removed; everything else untouched`);
  return 0;
}

function tolerances(opts, root, action, args) {
  const baseline = loadBaseline(root);
  if (action === "set") {
    const [pattern, raw] = args;
    if (!pattern || !pattern.includes("/")) throw new PlError("a tolerance pattern is '<source>/<metric>', e.g. 'candidate/frame.ssim' or '*/region.*.edgeF1'");
    const value = Number(raw);
    if (raw === undefined || !Number.isFinite(value) || value < 0) throw new PlError(`a tolerance is a number of zero or more, got '${raw ?? ""}'`);
    if (!opts.note) throw new PlError("--note is required: say what was measured (runs, shots, date); a tolerance without one is a guess");
    baseline.tolerances[pattern] = value;
    baseline.notes[pattern] = opts.note;
    writeJson(baselinePath(root), baseline);
    emit({ pattern, tolerance: value, note: opts.note }, opts.json, `${pattern} = ${value}  (${opts.note})`);
    return 0;
  }
  if (action !== "show") throw new PlError("baseline tolerances wants show or set");
  const doc = { tolerances: baseline.tolerances, minRegionArea: baseline.minRegionArea, spread: baseline.spread, notes: baseline.notes };
  const width = Math.max(0, ...Object.keys(baseline.tolerances).map((p) => p.length));
  const lines = Object.entries(baseline.tolerances).map(([p, t]) => `${p.padEnd(width)}  ${String(t).padEnd(8)}  ${baseline.notes[p] ?? "(no note: where does this number come from?)"}`);
  lines.push(`minRegionArea ${baseline.minRegionArea ?? 0.002}; ${Object.keys(baseline.entries).length} entries`);
  for (const [k, v] of Object.entries(baseline.notes)) if (k.startsWith("_")) lines.push(`note: ${v}`);
  for (const [k, v] of Object.entries(baseline.spread)) lines.push(`spread  ${k}  ${v} (allowed 1.5x = ${Number((1.5 * v).toPrecision(6))})  ${baseline.notes[k] ?? ""}`.trimEnd());
  emit(doc, opts.json, lines.join("\n"));
  return 0;
}

export async function run(argv) {
  const opts = parseArgs(argv, { ...SELECTION_FLAGS, source: { type: "string" }, run: { type: "string" }, dir: { type: "string" },
    "all-shots-of-run": { type: "bool" }, note: { type: "string" }, json: { type: "bool" } });
  if (opts.help) { emit(null, false, HELP); return 0; }
  const [cmd, ...args] = opts._;
  const root = findRoot();
  const config = loadConfig(root, { required: true });
  const rest = { ...opts, _: args };
  if (cmd === "check" || cmd === "stale") return check(rest, root, config, cmd === "stale");
  if (cmd === "update") return update(rest, root, config);
  if (cmd === "tolerances") return tolerances(opts, root, args[0], args.slice(1));
  throw new PlError(`baseline wants check, stale, update or tolerances${cmd ? `, got '${cmd}'` : ""} (see --help)`);
}
