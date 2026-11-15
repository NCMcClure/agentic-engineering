#!/usr/bin/env node
// The live lane: real headless Claude Code sessions with this checkout's
// plugins, read back through the context lens, checked structurally against
// the baseline. Opt-in only: `npm run test:live`. It spends model quota (a few
// cents a fixture on haiku, about a cent a trigger session, and three times
// the trigger sessions when their baseline is recorded), so `npm test` and CI
// never select it; the file names here deliberately do not match *.test.mjs.
//
//   npm run test:live                              run, check, print the before/after tables
//   npm run test:live -- --write-baseline          the same over three passes, then record both parts of baseline.json
//   npm run test:live -- --write-baseline=skills   record the skills part alone, and leave the token sizes as they are
//   npm run test:live -- --write-baseline=fixtures the token sizes alone, from one pass, and leave what each prompt reached
//   npm run test:live -- --keep                    leave the temp fixtures and transcripts for a look
//   npm run test:live -- --only adopted            one fixture (no baseline is written from a partial run)
//
// The lane runs under the person's own login and keeps their config clean:
// each session's transcripts are moved out of ~/.claude/projects into the
// run's temp lens directory before the lens reads them (Claude Code still
// records the temp folders in ~/.claude.json's project list, as any session
// does). The child gets a scrubbed environment (session.mjs childEnv), so a
// lane started from inside Claude Code does not inherit that host's settings.
//
// baseline.json has two parts, each with its own stamp. `fixtures` is the
// token sizes; `skills` is whether a prompt reaches its skill.
//
// Per fixture (fixtures.mjs KINDS): one prompt, a forced /compact on the same
// session (--resume), then a prompt that starts each subagent type in
// session.mjs SUBAGENTS. Every call is capped by --max-budget-usd and
// --max-turns.
//
// The skills part runs in the fixtures where the plugins speak. Each prompt in
// triggers.mjs is its own session at each context window (session.mjs
// WINDOWS), read back by reach.mjs for whether it reached its skill; one more
// session works inside a skill, compacts, and carries on. The first trigger
// session read at each window also gives each plugin's share of the skill
// listing there (reach.mjs listingSizes): its entries, how many kept a
// description, and their characters.
// One session is one sample, so a baseline is three passes over the prompts
// and a plain run is one, and the check compares "reached in every baseline
// pass" with "reached in none now". A plain run that misses such a prompt
// runs it twice more before the check may fail it. These sessions are given
// four read-only tools and no MCP server (session.mjs SKILL_SESSION_ARGS), and
// run a few at a time. A session that was cut off or errored before it reached
// anything is run again, three sessions in all; if every one is cut off the
// cell is not measured, which is not a miss, and no baseline is written from
// such a run. (One retry was not enough: about one cell in thirty is cut off,
// one retry in five is too, and a recording is 180 cells.)
// None is written either from a run where a prompt the old baseline reached in
// every pass was reached in none: the new one would hold those misses, and the
// check could never fail that prompt again. Every session that did not reach
// its skill is printed with what it did.
// Two things these sessions do not isolate: the host drops listing
// descriptions least-invoked first from the login's own skill counts, so the
// numbers belong to the machine that recorded them, and each skill a session
// invokes adds one to those counts.
//
// The checks are a ratchet (measure.mjs ratchet): baseline.json lists the
// failures it expects by their exact text, the lane fails only on one it does
// not list, and it prints `fixed:` when a listed one stops happening.
//
// Extension point: one file per check in checks/, see measure.mjs loadChecks.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { auditLines, baselineRecord, compareTable, isMeasured, loadChecks, measureCell, measureFixture, measureTriggers, ratchet, readBaseline, regressions, runChecks, skillsRefusal, skillsTable, stopOf, suspects, unlockedLines } from "./measure.mjs";
import { acrossCompaction, listingSizes } from "./reach.mjs";
import { FIXTURES, MODEL, REPO, SKILL_TOOLS, WINDOWS, claudeVersion, collect, makeFixture, makeLensDir, pool, readTranscripts, runSession, runSkillSession, runTrigger, sessionEntries, tempRoot } from "./session.mjs";
import { COMPACTION, TRIGGERS, labelOf } from "./triggers.mjs";

const BASELINE = path.join(import.meta.dirname, "baseline.json");
const BASELINE_PASSES = 3; // over the trigger prompts, when the skills part is recorded
const AT_ONCE = 4; // trigger sessions running together
const ATTEMPTS = 3; // sessions a cell may take before it is left not measured
const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

/** The baseline parts this run records: both for a bare --write-baseline, one alone for --write-baseline=skills or --write-baseline=fixtures. */
function partsToWrite() {
  const flag = argv.find((a) => a === "--write-baseline" || a.startsWith("--write-baseline="));
  if (!flag) return [];
  if (only) throw new Error("--write-baseline needs every fixture; drop --only");
  if (flag === "--write-baseline") return ["fixtures", "skills"];
  if (flag === "--write-baseline=skills") return ["skills"];
  if (flag === "--write-baseline=fixtures") return ["fixtures"];
  throw new Error(`${flag}: --write-baseline records both parts, --write-baseline=skills or --write-baseline=fixtures one of them`);
}

/**
 * One trigger cell: the prompt's session at one window, read back before the
 * transcripts are collected. A session that was not measured is run again,
 * up to ATTEMPTS in all. Never throws.
 */
async function triggerCell(dir, row, window, tally) {
  for (let attempt = 1; ; attempt += 1) {
    tally.triggers += 1;
    const session = await runTrigger(dir, row.prompt, window);
    tally.cost += session.cost;
    const [model, usage] = Object.entries(session.result?.modelUsage ?? {})[0] ?? [];
    tally.model ??= model;
    tally.windows[window] ??= usage?.contextWindow ?? null;
    const entries = session.id ? sessionEntries(dir, session.id) : null;
    tally.listing[window] ??= entries ? listingSizes(entries) : null;
    const cell = measureCell(row, entries, stopOf(session.result));
    if (isMeasured(cell.outcome) || attempt === ATTEMPTS) return cell;
  }
}

/**
 * One fixture's share of the skills part: every pass of its trigger prompts
 * at each window, a few sessions at a time, and the compaction scenario where
 * it lives. A failed skill session is named and left out, and its check fails
 * it; it does not end the lane.
 */
async function skillSessions(dir, kind, passes, tally, before) {
  const jobs = [];
  for (let pass = 1; pass <= passes; pass += 1) {
    for (const row of TRIGGERS.filter((t) => t.fixture === kind)) {
      for (const window of Object.keys(WINDOWS)) jobs.push(async () => ({ row, window, pass, cell: await triggerCell(dir, row, window, tally) }));
    }
  }
  const cells = await pool(AT_ONCE, jobs);
  // One miss is one sample. A prompt the baseline reached in every pass is
  // run again, up to a baseline's passes in all, before the check may call
  // it a regression; the first rerun that is not a miss ends it.
  for (const { row, window } of suspects(cells, before)) {
    for (let pass = passes + 1; pass <= BASELINE_PASSES; pass += 1) {
      const cell = { ...(await triggerCell(dir, row, window, tally)), confirm: true };
      cells.push({ row, window, pass, cell });
      if (cell.outcome !== "miss") break;
    }
  }
  let compaction = null;
  if (COMPACTION.fixture === kind) {
    tally.compaction += 1;
    try {
      const session = await runSkillSession(dir, COMPACTION);
      tally.cost += session.cost;
      const entries = sessionEntries(dir, session.id);
      if (entries) compaction = { skill: labelOf(COMPACTION), ...acrossCompaction(entries, COMPACTION) };
    } catch (error) { console.log(`  ${kind}: ${error.message}`); }
  }
  return { cells, compaction };
}

const clock = (ms) => `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`;

async function main() {
  const started = Date.now();
  let writing = partsToWrite(); // before a session spends anything
  const passes = writing.includes("skills") ? BASELINE_PASSES : 1;
  const baseline = readBaseline(BASELINE); // throws before a session spends anything when it is there and unreadable
  const version = claudeVersion();
  const root = tempRoot();
  const lensDir = makeLensDir(root);
  console.log(`live lane: Claude Code ${version}, model ${MODEL}, fixtures in ${root}`);

  const kinds = FIXTURES.filter((k) => !only || k === only);
  const fixtures = {};
  const cells = []; // { row, window, pass, cell } for every trigger session
  const perWindow = () => Object.fromEntries(Object.keys(WINDOWS).map((w) => [w, null]));
  const tally = { cost: 0, triggers: 0, compaction: 0, model: null, windows: perWindow(), listing: perWindow() };
  let compaction = null;
  let cost = 0;
  try {
    for (const kind of kinds) {
      const dir = makeFixture(root, kind);
      let session = null;
      let skills = { cells: [], compaction: null };
      let folder = null;
      try {
        session = runSession(dir);
        skills = await skillSessions(dir, kind, passes, tally, baseline?.skills?.triggers);
      } finally {
        // Even a failed session leaves transcripts; never leave them in ~/.claude.
        try { folder = collect(dir, lensDir); } catch { /* nothing was written */ }
      }
      cost += session.cost;
      const reports = readTranscripts(folder, session.id, lensDir);
      fixtures[kind] = { ...reports, measure: measureFixture(reports) };
      cells.push(...skills.cells);
      compaction ??= skills.compaction;
      console.log(`  ${kind}: session ${session.id}, $${session.cost.toFixed(4)}, subagents ${reports.subagents.map((s) => s.agentType).join(", ") || "none"}${skills.cells.length ? `, ${skills.cells.length} trigger cells` : ""}`);
    }
  } finally {
    if (!argv.includes("--keep")) fs.rmSync(root, { recursive: true, force: true });
  }

  // With --only, a prompt whose fixture was left out has no session to read.
  const rows = TRIGGERS.filter((t) => kinds.includes(t.fixture));
  const skills = {
    windows: tally.windows,
    listing: tally.listing,
    triggers: measureTriggers(rows, Object.keys(WINDOWS), (skill, window) => cells.filter((c) => c.row.skill === skill && c.window === window).map((c) => c.cell)),
    ...(compaction ? { compaction } : {}),
  };
  const unlocked = unlockedLines(cells, SKILL_TOOLS);
  const run = { version, fixtures, skills: { ...skills, unlocked, partial: Boolean(only) } };
  const now = Object.fromEntries(Object.entries(fixtures).map(([k, f]) => [k, f.measure]));
  console.log(`\nbefore/after (baseline: ${baseline ? `Claude Code ${baseline.claudeCodeVersion}, ${baseline.date}` : "none"}; now: Claude Code ${version})`);
  console.log(compareTable(baseline, now));
  console.log(`\nskills, ${passes} pass${passes > 1 ? "es" : ""} (baseline: ${baseline?.skills ? `Claude Code ${baseline.skills.claudeCodeVersion}, ${baseline.skills.date}, ${baseline.skills.passes} passes` : "none"}; now: Claude Code ${version}, ${tally.model ?? MODEL})`);
  console.log(skillsTable(baseline?.skills ?? null, skills));
  const audit = auditLines(cells);
  console.log(`\nnot reached: ${audit.length} of ${cells.length} sessions`);
  for (const line of audit) console.log(`  ${line}`);

  const results = ratchet(runChecks(await loadChecks(), run, baseline), baseline?.expectedFailures);
  console.log("\nchecks");
  for (const r of results) {
    console.log(`  ${r.fresh.length ? "FAIL" : r.expected.length ? "known" : "ok   "} ${r.name}`);
    for (const f of r.fresh) console.log(`         new:      ${f}`);
    for (const f of r.expected) console.log(`         expected: ${f}`);
    for (const f of r.fixed) console.log(`         fixed:    ${f}`);
  }
  console.log(`\ncost: $${(cost + tally.cost).toFixed(4)} ($${cost.toFixed(4)} fixtures, $${tally.cost.toFixed(4)} skills)`);
  const reruns = cells.filter((c) => c.cell.confirm).length;
  console.log(`sessions started: ${kinds.length + tally.triggers + tally.compaction} (${kinds.length} fixture, ${tally.triggers - reruns} trigger, ${reruns} rerun to confirm a miss, ${tally.compaction} compaction)`);
  console.log(`wall time: ${clock(Date.now() - started)}`);

  // A recording becomes what later runs are held to, so it is written only
  // from a run fit to be one (measure.mjs skillsRefusal). A prompt that
  // stopped reaching its skill refuses it: written anyway, the baseline holds
  // the misses and that prompt can never fail again.
  const refusal = writing.includes("skills") ? skillsRefusal({
    lost: cells.filter((c) => !isMeasured(c.cell.outcome)).length,
    compaction: Boolean(compaction),
    unlocked: unlocked.length,
    regressed: regressions(skills.triggers, Object.keys(WINDOWS), baseline?.skills?.triggers),
  }) : [];
  if (refusal.length) {
    console.log(`not writing the skills part: ${refusal.join("; ")}`);
    writing = writing.filter((part) => part !== "skills");
    process.exitCode = 1;
  }
  if (writing.length) {
    const stamp = {
      claudeCodeVersion: version,
      date: new Date().toISOString().slice(0, 10),
      model: tally.model ?? MODEL,
      pluginsTree: execFileSync("git", ["-C", REPO, "rev-parse", "HEAD:plugins"], { encoding: "utf8" }).trim(),
    };
    const record = baselineRecord(baseline, writing, stamp, {
      fixtures: now,
      fixturesCostUsd: Number(cost.toFixed(4)),
      skills: { passes, sessions: tally.triggers + tally.compaction, costUsd: Number(tally.cost.toFixed(4)), ...skills },
    });
    // A check's expected failures are recorded with the part it reads, and kept as they were with the other.
    const expected = { ...(baseline?.expectedFailures ?? {}) };
    for (const r of results.filter((x) => writing.includes(x.part))) {
      if (r.failures.length) expected[r.file] = [...r.failures].sort(); else delete expected[r.file];
    }
    record.expectedFailures = Object.fromEntries(Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(BASELINE, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`wrote the ${writing.join(" and ")} part${writing.length > 1 ? "s" : ""} of ${path.relative(REPO, BASELINE)}`);
  }
  // A failure of a part just recorded is now one the baseline expects.
  if (results.some((r) => r.fresh.length && !writing.includes(r.part))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`live lane: ${error.message}`);
  process.exitCode = 1;
});
