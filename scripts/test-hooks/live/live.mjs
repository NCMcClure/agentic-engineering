#!/usr/bin/env node
// The live lane: real headless Claude Code sessions with this checkout's
// plugins, read back through the context lens, checked structurally against
// the baseline. Opt-in only: `npm run test:live`. It spends model quota (a few
// cents a fixture on haiku), so `npm test` and CI never select it; the file
// names here deliberately do not match *.test.mjs.
//
//   npm run test:live                         run, check, print the before/after table
//   npm run test:live -- --write-baseline     the same, then record this run as baseline.json
//   npm run test:live -- --keep               leave the temp fixtures and transcripts for a look
//   npm run test:live -- --only adopted       one fixture (no baseline is written from a partial run)
//
// The lane runs under the person's own login and keeps their config clean:
// each session's transcripts are moved out of ~/.claude/projects into the
// run's temp lens directory before the lens reads them (Claude Code still
// records the temp folders in ~/.claude.json's project list, as any session
// does). The child gets a scrubbed environment (session.mjs childEnv), so a
// lane started from inside Claude Code does not inherit that host's settings.
//
// Per fixture (fixtures.mjs KINDS): one prompt, a forced /compact on the same
// session (--resume), then a prompt that starts each subagent type in
// session.mjs SUBAGENTS. Every call is capped by --max-budget-usd and
// --max-turns.
//
// The checks are a ratchet (measure.mjs ratchet): baseline.json lists the
// failures it expects by their exact text, the lane fails only on one it does
// not list, and it prints `fixed:` when a listed one stops happening.
//
// Extension point: one file per check in checks/, see measure.mjs loadChecks.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { compareTable, loadChecks, measureFixture, ratchet, runChecks } from "./measure.mjs";
import { FIXTURES, MODEL, REPO, claudeVersion, collect, makeFixture, makeLensDir, readTranscripts, runSession, tempRoot } from "./session.mjs";

const BASELINE = path.join(import.meta.dirname, "baseline.json");
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

function readBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch { return null; }
}

async function main() {
  const version = claudeVersion();
  const root = tempRoot();
  const lensDir = makeLensDir(root);
  console.log(`live lane: Claude Code ${version}, model ${MODEL}, fixtures in ${root}`);

  const fixtures = {};
  let cost = 0;
  try {
    for (const kind of FIXTURES.filter((k) => !only || k === only)) {
      const dir = makeFixture(root, kind);
      let session = null;
      let folder = null;
      try {
        session = runSession(dir);
      } finally {
        // Even a failed session leaves transcripts; never leave them in ~/.claude.
        try { folder = collect(dir, lensDir); } catch { /* nothing was written */ }
      }
      cost += session.cost;
      const reports = readTranscripts(folder, session.id, lensDir);
      fixtures[kind] = { ...reports, measure: measureFixture(reports) };
      console.log(`  ${kind}: session ${session.id}, $${session.cost.toFixed(4)}, subagents ${reports.subagents.map((s) => s.agentType).join(", ") || "none"}`);
    }
  } finally {
    if (!argv.includes("--keep")) fs.rmSync(root, { recursive: true, force: true });
  }

  const baseline = readBaseline();
  const run = { version, fixtures };
  const now = Object.fromEntries(Object.entries(fixtures).map(([k, f]) => [k, f.measure]));
  console.log(`\nbefore/after (baseline: ${baseline ? `Claude Code ${baseline.claudeCodeVersion}, ${baseline.date}` : "none"}; now: Claude Code ${version})`);
  console.log(compareTable(baseline, now));

  const results = ratchet(runChecks(await loadChecks(), run, baseline), baseline?.expectedFailures);
  console.log("\nchecks");
  for (const r of results) {
    console.log(`  ${r.fresh.length ? "FAIL" : r.expected.length ? "known" : "ok   "} ${r.name}`);
    for (const f of r.fresh) console.log(`         new:      ${f}`);
    for (const f of r.expected) console.log(`         expected: ${f}`);
    for (const f of r.fixed) console.log(`         fixed:    ${f}`);
  }
  console.log(`\ncost: $${cost.toFixed(4)}`);

  if (argv.includes("--write-baseline")) {
    if (only) throw new Error("--write-baseline needs every fixture; drop --only");
    const record = {
      claudeCodeVersion: version,
      date: new Date().toISOString().slice(0, 10),
      model: MODEL,
      pluginsTree: execFileSync("git", ["-C", REPO, "rev-parse", "HEAD:plugins"], { encoding: "utf8" }).trim(),
      costUsd: Number(cost.toFixed(4)),
      expectedFailures: Object.fromEntries(results.filter((r) => r.failures.length).map((r) => [r.file, [...r.failures].sort()])),
      fixtures: now,
    };
    fs.writeFileSync(BASELINE, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`wrote ${path.relative(REPO, BASELINE)}`);
  } else if (results.some((r) => r.fresh.length)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`live lane: ${error.message}`);
  process.exitCode = 1;
});
