// iterate: one turn of the loop. Render the candidate for a few shots, compare,
// gate against the baseline, draw each shot's sheet, and say where the time
// went. It prints, per shot, before and after for the headline numbers, the
// gate for exactly those shots, and the sheet to open. It never writes the
// baseline: accepting a result is a separate, deliberate `pl.mjs baseline update`.
//
// Rendering more shots than config.budget.free needs its reason in the environment:
//   PL_RUN="verify: <what already works, what this checks>"   a group, once the change works
//   PL_RUN="full: <what is finished>"                         everything, once, when done
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { failed, gate, loadBaseline, num, readRun, reportText, totalsLine } from "../lib/gate.mjs";
import { findRoot, loadConfig, passFile, runsDir, selected, selectionOf, SELECTION_FLAGS, shotPath, shotsDir } from "../lib/project.mjs";
import { renderCommand, startFailure } from "../lib/render.mjs";
import { runCompare } from "./compare.mjs";
import { drawShotSheet } from "./sheet.mjs";

const HEADLINE = ["frame.ssim", "frame.deltaENorm", "frame.exposureEV", "frame.edgeF1"];

const HELP = `usage: pl.mjs iterate SELECTION [--source ID]... [--run NAME] [--dry-run] [--skip-render] [--render-reference]
                       [--edge-tolerance PX] [--no-sheets] [--repeat N] [--json]

Render the selected shots (names or globs, --shots a,b, --group, --match, --all), compare them,
gate them against the baseline, draw a sheet per shot (reference | before | after, then what the
run changed, the edges, and the colour difference), and print before and after, the gate, the time,
and the sheets to open.

  --source ID          a candidate to render and compare (repeatable; default: every candidate)
  --run NAME           the run folder under runs/ (default: iterate, reused each time)
  --dry-run            print the shots and the commands, start nothing
  --skip-render        compare the pictures that are there (free: the budget is about renders)
  --render-reference   also render the reference (only when the reference itself must change)
  --edge-tolerance PX  as in compare (default 2)
  --no-sheets          draw nothing; print the three picture paths instead
  --repeat N           render and compare N times with no change in between, into <run>1 ... <run>N,
                       without sheets: the input of pl.mjs calibrate
  --json               one JSON document on stdout; the renderer's output goes to stderr

More shots than budget.free (config.json) need a reason in PL_RUN, "verify: ..." or "full: ...".`;

function budgetRefusal(count, free) {
  return `${count} shots selected, and one command renders at most ${free} without a reason.\n`
    + "Narrow it first:\n"
    + "  - pick the 1-3 shots that show the thing you changed, and name them\n"
    + "  - or cut a group down with --match '<glob>'\n"
    + "  - --dry-run lists what a selection means and starts nothing\n"
    + "A larger run is for after the change works, with its reason in the environment:\n"
    + '  PL_RUN="verify: <what already works, what this checks>"   (a group, once)\n'
    + '  PL_RUN="full: <what is finished>"                         (everything, once)';
}

function once(opts, runName, { sheets = true } = {}) {
  const root = findRoot();
  const config = loadConfig(root, { required: true });
  const shots = selected(selectionOf(opts), root, config);
  const sources = opts.source.length ? opts.source : [...config.candidates];
  const reference = config.reference;
  if (sources.includes(reference)) throw new PlError(`'${reference}' is the reference; --render-reference renders it, --source names candidates`);
  const dir = shotsDir(root, config);
  const toRender = opts.skipRender ? [] : [...(opts.renderReference ? [reference] : []), ...sources];
  const commands = Object.fromEntries(toRender.map((s) => [s, renderCommand(config, s, shots, dir)]));
  const reason = (process.env.PL_RUN ?? "").trim();
  const free = Number(config.budget?.free ?? 3);
  const runDir = path.join(runsDir(root), runName);
  const rendering = Object.keys(commands).length > 0;

  if (opts.dryRun) {
    const doc = { shots, sources, render: Object.fromEntries(Object.entries(commands).map(([s, c]) => [s, c.text])), run: runDir, withinBudget: shots.length <= free || !rendering };
    const lines = [`${shots.length} shots:`, ...shots.map((s) => `  ${s}`)];
    lines.push(...(rendering ? Object.entries(doc.render).map(([s, c]) => `render ${s}: ${c}`) : ["render: nothing (--skip-render)"]));
    if (rendering && shots.length > free) lines.push(`over the budget of ${free}: this needs PL_RUN="verify: ..." or PL_RUN="full: ..."`);
    return { code: 0, doc, text: lines.join("\n") };
  }
  // The budget is about renders, which are what cost minutes. Comparing what is there is free.
  if (rendering && shots.length > free && !/^(verify|full):\s*\S/.test(reason)) throw new PlError(budgetRefusal(shots.length, free));

  const seconds = { render: 0, compare: 0, sheets: 0 };
  // Keep each candidate's picture as it was before this render: once the render ran, it is gone.
  const before = [];
  for (const source of Object.keys(commands).filter((s) => s !== reference)) {
    for (const shot of shots) {
      const old = passFile(path.join(dir, shot), source);
      if (!fs.existsSync(old)) continue;
      const keep = path.join(runDir, shot, `before.${source}.png`);
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.copyFileSync(old, keep);
      before.push(keep);
    }
  }
  let t0 = performance.now();
  for (const [source, c] of Object.entries(commands)) {
    if (!opts.json) process.stdout.write(`render ${source}: ${c.text}\n`);
    // the project's own command from config.json, started as a program and its arguments, never through
    // a shell; with --json its output goes to stderr
    const stdio = ["ignore", opts.json ? 2 : "inherit", "inherit"];
    const r = spawnSync(c.argv[0], c.argv.slice(1), { shell: false, cwd: root, stdio, env: { ...process.env, ...c.env } });
    if (r.error) throw new PlError(startFailure(source, c.argv, r.error));
    if (r.status !== 0) throw new PlError(`the render of '${source}' exited with ${r.status ?? r.signal}: nothing was compared`);
  }
  seconds.render = (performance.now() - t0) / 1000;

  t0 = performance.now();
  const docs = runCompare(root, config, shots, sources, runDir, { edgeTolerance: opts.edgeTolerance });
  seconds.compare = (performance.now() - t0) / 1000;
  const by = new Map(docs.map((d) => [`${d.shot}\0${d.source}`, d]));
  const baseline = loadBaseline(root);
  const reports = Object.fromEntries(sources.map((s) => {
    const { flat, problems } = readRun(runDir, shots, s);
    return [s, { report: gate(baseline, flat, shots, s), problems, flat }];
  }));

  // one sheet per shot and candidate; a sheet that cannot be drawn is a note, never a failed run
  t0 = performance.now();
  const drawn = new Map(), sheetErrors = new Map();
  if (sheets) {
    for (const source of sources) for (const shot of shots) {
      if (by.get(`${shot}\0${source}`)?.error) continue;
      try { drawn.set(`${shot}\0${source}`, drawShotSheet(root, config, shot, source, runDir, { edgeTolerance: opts.edgeTolerance })); }
      catch (e) { sheetErrors.set(`${shot}\0${source}`, e.message); }
    }
  }
  seconds.sheets = (performance.now() - t0) / 1000;
  for (const k of Object.keys(seconds)) seconds[k] = Number(seconds[k].toFixed(2));
  seconds.total = Number((seconds.render + seconds.compare + seconds.sheets).toFixed(2));
  const gateFailed = Object.values(reports).some((r) => failed(r.report, r.problems));

  // one line per run, so what the loop costs can itself be measured
  const line = { when: new Date().toISOString(), run: runName, shots: shots.length, sources, rendered: Object.keys(commands), seconds,
    reason: reason || null, cached: docs.filter((d) => d.cached).length, gate: Object.fromEntries(Object.entries(reports).map(([s, r]) => [s, r.report.totals])) };
  fs.mkdirSync(runsDir(root), { recursive: true });
  fs.appendFileSync(path.join(runsDir(root), "timing.jsonl"), JSON.stringify(line) + "\n");

  const out = [], shotsDoc = [];
  for (const source of sources) {
    const { report, problems, flat } = reports[source];
    for (const shot of shots) {
      const head = `${shot}  [${source}]`;
      if (shot in problems) { out.push(`${head}  no metrics: ${problems[shot]}`); shotsDoc.push({ shot, source, error: problems[shot] }); continue; }
      out.push(head);
      const rows = {};
      for (const metric of HEADLINE) {
        const key = `${shot}/${source}/${metric}`;
        const was = baseline.entries[key] ?? null, now = flat[key];
        if (now === undefined) continue;
        rows[metric] = { before: was, after: now };
        out.push(`  ${metric.padEnd(17)} ${was === null ? `(no baseline) ${num(now)}` : `${num(was)} → ${num(now)}`}`);
      }
      for (const note of by.get(`${shot}\0${source}`)?.notes ?? []) out.push(`  note: ${note}`);
      const sd = shotPath(shot, root, config);
      const look = { reference: passFile(sd, reference), after: passFile(sd, source) };
      const kept = path.join(runDir, shot, `before.${source}.png`);
      if (before.includes(kept)) look.before = kept;
      const sheet = drawn.get(`${shot}\0${source}`) ?? null;
      if (sheet) out.push(`  sheet: ${sheet}`);
      else {
        if (sheetErrors.has(`${shot}\0${source}`)) out.push(`  no sheet: ${sheetErrors.get(`${shot}\0${source}`)}`);
        out.push(`  look: ${look.reference}`, ...(look.before ? [`        ${look.before}`] : []), `        ${look.after}`);
      }
      shotsDoc.push({ shot, source, headline: rows, look, sheet });
    }
    const verdict = failed(report, problems) ? "beyond tolerance: open the sheets, the number is not the judgement" : "within tolerance";
    out.push(`gate [${source}, ${shots.length} shots]: ${totalsLine(report.totals)}  (${verdict})`);
    out.push(...reportText(report, {}).split("\n").slice(0, -1).map((l) => "  " + l));
  }
  out.push(`time: render ${seconds.render.toFixed(1)} s${rendering ? "" : " (skipped)"} · compare ${seconds.compare.toFixed(1)} s · sheets ${seconds.sheets.toFixed(1)} s${sheets ? "" : " (off)"} · total ${seconds.total.toFixed(1)} s`);
  if (before.length) out.push(`before: ${before.length} picture(s) kept as <run>/<shot>/before.<source>.png`);
  const doc = {
    run: runDir, shots: shotsDoc, passed: !gateFailed, seconds, reason: reason || null, before,
    gate: Object.fromEntries(Object.entries(reports).map(([s, r]) => [s, { totals: r.report.totals, entries: r.report.entries.filter((e) => e.status !== "ok"), problems: r.problems }])),
  };
  return { code: gateFailed ? 1 : 0, doc, text: out.join("\n") };
}

export async function run(argv) {
  const opts = parseArgs(argv, { ...SELECTION_FLAGS, source: { type: "string", multi: true }, run: { type: "string", default: "iterate" },
    "dry-run": { type: "bool" }, "skip-render": { type: "bool" }, "render-reference": { type: "bool" },
    "edge-tolerance": { type: "int", default: 2 }, "no-sheets": { type: "bool" }, repeat: { type: "int", default: 1 }, json: { type: "bool" } });
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (opts.repeat < 1) throw new PlError("--repeat wants 1 or more");
  if (opts.repeat === 1) {
    const { code, doc, text } = once(opts, opts.run, { sheets: !opts.noSheets });
    emit(doc, opts.json, text);
    return code;
  }
  // Calibration: the same shots N times, each into its own run, with no change in between.
  const runs = Array.from({ length: opts.repeat }, (_, i) => `${opts.run}${i + 1}`);
  const docs = [];
  for (const name of runs) {
    const { doc, text } = once(opts, name, { sheets: false });
    docs.push(doc);
    if (!opts.json) process.stdout.write(text + "\n\n");
  }
  const next = `pl.mjs calibrate --runs ${runs.join(",")}`;
  emit({ runs, next, results: docs }, opts.json, `${opts.repeat} runs: ${runs.join(" ")}\nnext: ${next}`);
  return 0;
}
