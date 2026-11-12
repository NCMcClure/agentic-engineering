// but-first-planning's status funnel (plan-status.mjs), run from a workspace
// the way a project runs it: one `set` rewrites six markdown surfaces and then
// moves the tracker's ticket, and `check` says where the surfaces disagree.
//
// The markdown half runs as a child process against a local-markdown
// workspace. The tracker half imports the workspace's copy and hands it a fake
// runner in place of gh, glab and git, on both forges.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const { scaffold } = await import(pathToFileURL(path.join(REPO, "plugins", "but-first-planning", "skills", "spec-init", "scaffold.mjs")).href);

const P = ".agents/plan";
const LOCAL = "# Issue tracker: local markdown\n\nThe plan tree is the only source of truth.\n";
const GITHUB = "# Issue tracker: GitHub\n\n| Role | Label | Meaning |\n|---|---|---|\n| ready-for-agent | `ready-for-agent` | AFK |\n";
const GITLAB = "# Issue tracker: GitLab\n\n- **Project**: `group/thing`\n- **Project ID**: `77`\n- **Host**: `gitlab.example.com`\n";

const issue = (title, type, status, ref = "<unassigned>", field = "Tracker") => `# ${title}

**Sprint**: [sprint](../sprint.md)
**Type**: ${type}
**${field}**: ${ref}
**Status**: ${status}

## Parent

[sprint](../sprint.md)

## What to build

Build ${title}.

**User-facing**: no - internal

## Acceptance criteria

- [ ] it works
- [ ] it is tested

## Testing checkpoint

\`echo ok\`

## Blocked by

- None
`;

/**
 * A two-epic plan tree. Epic 02 carries a deliberate drift: the sprint's table
 * cell and the epic's field both say done while the one issue says in-progress.
 * `refs` gives an issue a tracker ref by its coordinates.
 */
function fixture(t, { tracker = LOCAL, refs = {}, field = "Tracker" } = {}) {
  const root = tempDir(t, "bfp-status-");
  const ref = (coords) => refs[coords] ?? "<unassigned>";
  write(root, `${P}/tracker.md`, tracker);
  write(root, `${P}/plan/index.md`, `# Plan

<!-- plan-format: 5.0 -->

## Epics

| Epic | Title | Sprints | Status |
|------|-------|---------|--------|
| 01 | [Foundations](01-foundations/epic.md) | 2 | not-started |
| 02 | [Features](02-features/epic.md) | 1 | in-progress |
`);
  write(root, `${P}/plan/01-foundations/epic.md`, `# Foundations

**Status**: not-started

## Sprints

| Sprint | Title | Issues | Status |
|--------|-------|--------|--------|
| 01 | [Skeleton](01-skeleton/sprint.md) | 2 | not-started |
| 02 | [Polish](02-polish/sprint.md) | 1 | not-started |
`);
  write(root, `${P}/plan/01-foundations/01-skeleton/sprint.md`, `# Skeleton

**Status**: not-started

## Issues

| Issue | Type | Title | ${field} | Status |
|-------|------|-------|---------|--------|
| 01 | AFK | [Setup](issues/01_issue_SETUP.md) | ${ref("01-01-01")} | not-started |
| 02 | AFK | [Wiring](issues/02_issue_WIRING.md) | ${ref("01-01-02")} | not-started |
`);
  write(root, `${P}/plan/01-foundations/01-skeleton/issues/01_issue_SETUP.md`, issue("Setup", "AFK", "not-started", ref("01-01-01"), field));
  write(root, `${P}/plan/01-foundations/01-skeleton/issues/02_issue_WIRING.md`, issue("Wiring", "AFK", "not-started", ref("01-01-02"), field));
  write(root, `${P}/plan/01-foundations/02-polish/sprint.md`, `# Polish

**Status**: not-started

## Issues

| Issue | Type | Title | ${field} | Status |
|-------|------|-------|---------|--------|
| 01 | HITL | [Tidy](issues/01_issue_TIDY.md) | <unassigned> | not-started |
`);
  write(root, `${P}/plan/01-foundations/02-polish/issues/01_issue_TIDY.md`, issue("Tidy", "HITL", "not-started", "<unassigned>", field));
  write(root, `${P}/plan/02-features/epic.md`, `# Features

**Status**: done

## Sprints

| Sprint | Title | Issues | Status |
|--------|-------|--------|--------|
| 01 | [Alpha](01-alpha/sprint.md) | 1 | done |
`);
  write(root, `${P}/plan/02-features/01-alpha/sprint.md`, `# Alpha

**Status**: in-progress

## Issues

| Issue | Type | Title | ${field} | Status |
|-------|------|-------|---------|--------|
| 01 | AFK | [Alpha](issues/01_issue_ALPHA.md) | ${ref("02-01-01")} | done |
`);
  write(root, `${P}/plan/02-features/01-alpha/issues/01_issue_ALPHA.md`, issue("Alpha", "AFK", "in-progress", ref("02-01-01"), field));
  scaffold(root);
  return { root, script: path.join(root, P, "plan", "plan-status.mjs") };
}

const run = (f, args) => runNode(f.script, args, { cwd: f.root });
const read = (f, rel) => fs.readFileSync(path.join(f.root, P, rel), "utf8");

/** A runner answering `answers` in order: `{ json }`, `{ stdout }`, or a failure `{ status, stderr, code }`. */
function fake(...answers) {
  const calls = [];
  const runner = (cmd, argv, { input } = {}) => {
    const a = answers[calls.length] ?? {};
    calls.push({ cmd, argv, input });
    return { status: "status" in a ? a.status : 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "", code: a.code };
  };
  return { calls, lines: () => calls.map((c) => [c.cmd, ...c.argv]), sent: (i) => JSON.parse(calls[i].input), io: { run: runner, env: {} } };
}

/** Run the workspace's funnel in this process with a fake runner; returns its exit code and what it printed. */
async function inProcess(f, args, io) {
  const mod = await import(pathToFileURL(f.script).href);
  const out = [], err = [];
  const log = console.log, writeErr = process.stderr.write;
  console.log = (line) => out.push(String(line));
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  try {
    return { status: await mod.run(args, io), stdout: out.join("\n"), stderr: err.join("") };
  } finally {
    console.log = log;
    process.stderr.write = writeErr;
  }
}

const ORIGIN_GH = { stdout: "https://github.com/someone/thing.git\n" };
const ORIGIN_GL = { stdout: "https://gitlab.example.com/group/thing.git\n" };

// ---- the markdown surfaces --------------------------------------------------

test("check on the whole tree rolls up and names every drifted surface", (t) => {
  const r = run(fixture(t), ["check"]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, [
    "plan tree: in-progress",
    "DRIFT: 01-alpha: table cell 'done' != 01_issue_ALPHA.md field 'in-progress'",
    "DRIFT: 02-features: Sprints-table cell 'done' for 01-alpha != rolled-up in-progress",
    "DRIFT: 02-features/epic.md `**Status**: done` != rolled-up in-progress",
    "",
  ].join("\n"));
});

test("check on a clean but unfinished epic is exit 1 with no drift", (t) => {
  const r = run(fixture(t), ["check", "01"]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "01-foundations: not-started\nNOT DONE: 01-foundations is 'not-started'\n");
});

test("set propagates through all six surfaces and ticks the acceptance boxes", (t) => {
  const f = fixture(t);
  const r = run(f, ["set", "01-01-01", "done"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "OK: 01-01-01 -> done; sprint 01-01 -> in-progress; epic 01 -> in-progress\n");
  assert.equal(r.stderr, "", "a local-markdown workspace touches no tracker and warns about none");

  const issueMd = read(f, "plan/01-foundations/01-skeleton/issues/01_issue_SETUP.md");
  assert.match(issueMd, /\*\*Status\*\*: done/);
  assert.match(issueMd, /- \[x\] it works\n- \[x\] it is tested/);
  assert.match(read(f, "plan/01-foundations/01-skeleton/sprint.md"), /01_issue_SETUP\.md\) \| <unassigned> \| done \|/);
  assert.match(read(f, "plan/01-foundations/01-skeleton/sprint.md"), /\*\*Status\*\*: in-progress/);
  assert.match(read(f, "plan/01-foundations/epic.md"), /01-skeleton\/sprint\.md\) \| 2 \| in-progress \|/);
  assert.match(read(f, "plan/01-foundations/epic.md"), /\*\*Status\*\*: in-progress/);
  assert.match(read(f, "plan/index.md"), /01-foundations\/epic\.md\) \| 2 \| in-progress \|/);
});

test("reopening a done issue unticks its boxes and rolls the parents back", (t) => {
  const f = fixture(t);
  run(f, ["set", "02-01-01", "done"]);
  assert.equal(run(f, ["set", "02-01-01", "in-progress"]).stdout, "OK: 02-01-01 -> in-progress; sprint 02-01 -> in-progress; epic 02 -> in-progress\n");
  assert.match(read(f, "plan/02-features/01-alpha/issues/01_issue_ALPHA.md"), /- \[ \] it works\n- \[ \] it is tested/);
});

test("a done with evidence writes the completed ledger and escapes the pipe", (t) => {
  const f = fixture(t);
  assert.equal(run(f, ["set", "02-01-01", "done", "--evidence", "checkpoint green | 12 tests"]).stdout,
    "OK: 02-01-01 -> done; sprint 02-01 -> done; epic 02 -> done\n");
  const ledger = read(f, "progress/completed/02-features.md");
  assert.match(ledger, /^# Completed - Features$/m);
  assert.match(ledger, /\| 02-01\/01 \| Alpha \| - \| \d{4}-\d{2}-\d{2} \| checkpoint green \\\| 12 tests \|/);

  // Idempotent: a second verified done replaces the row rather than appending.
  run(f, ["set", "02-01-01", "done", "--evidence", "re-verified"]);
  const rows = read(f, "progress/completed/02-features.md").split("\n").filter((l) => l.startsWith("| 02-01/01 |"));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /re-verified/);
});

test("--cancelled marks a dropped issue done without a ledger row, and applies to done only", (t) => {
  const f = fixture(t);
  const r = run(f, ["set", "02-01-01", "done", "--cancelled", "--evidence", "descoped in review"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "OK: 02-01-01 -> done; sprint 02-01 -> done; epic 02 -> done\n");
  assert.equal(fs.existsSync(path.join(f.root, P, "progress/completed/02-features.md")), false);

  const wrong = run(f, ["set", "01-01-01", "blocked", "--cancelled"]);
  assert.equal(wrong.status, 2);
  assert.match(wrong.stderr, /--cancelled only applies to done/);
  assert.match(read(f, "plan/01-foundations/01-skeleton/issues/01_issue_SETUP.md"), /\*\*Status\*\*: not-started/);
});

test("a blocked issue rolls its sprint up to blocked without touching the ledger", (t) => {
  const f = fixture(t);
  assert.equal(run(f, ["set", "01-02-01", "blocked", "--evidence", "waiting on design"]).stdout,
    "OK: 01-02-01 -> blocked; sprint 01-02 -> blocked; epic 01 -> blocked\n");
  assert.equal(fs.existsSync(path.join(f.root, P, "progress/completed")), true, "the scaffold made the folder");
  assert.deepEqual(fs.readdirSync(path.join(f.root, P, "progress/completed")), [".gitkeep"]);
});

test("a bad status and bad coordinates both exit 2 without writing", (t) => {
  const f = fixture(t);
  const bad = run(f, ["set", "01-01-01", "bogus"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /status must be one of/);
  assert.match(read(f, "plan/01-foundations/01-skeleton/issues/01_issue_SETUP.md"), /\*\*Status\*\*: not-started/);

  const coords = run(f, ["set", "1-1-1", "done"]);
  assert.equal(coords.status, 2);
  assert.match(coords.stderr, /coordinate part '1' is not a two-digit number/);
  assert.equal(run(f, ["frobnicate"]).status, 2);
});

test("check exits 0 only when every issue is done and the surfaces agree", (t) => {
  const f = fixture(t);
  for (const c of ["01-01-01", "01-01-02", "01-02-01", "02-01-01"]) run(f, ["set", c, "done"]);
  const r = run(f, ["check"]);
  assert.equal(r.stdout, "plan tree: done\n");
  assert.equal(r.status, 0);
  assert.equal(run(f, ["check", "01-01"]).stdout, "01-foundations/01-skeleton: done\n");
});

test("a tree that still names its tracker field `**GitHub**:` is read the same way", (t) => {
  const f = fixture(t, { refs: { "02-01-01": "#12" }, field: "GitHub" });
  run(f, ["set", "02-01-01", "done", "--evidence", "green"]);
  assert.match(read(f, "progress/completed/02-features.md"), /\| 02-01\/01 \| Alpha \| #12 \|/);
});

// ---- the tracker ------------------------------------------------------------

test("GitHub: done closes the published issue's ticket after the markdown is written", async (t) => {
  const f = fixture(t, { tracker: GITHUB, refs: { "02-01-01": "#42" } });
  const gh = fake(ORIGIN_GH, { json: { number: 42, title: "Alpha", state: "OPEN", labels: [], url: "u" } }, {}, { json: { number: 42, state: "CLOSED", labels: [], url: "u" } });
  const r = await inProcess(f, ["set", "02-01-01", "done"], gh.io);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.match(read(f, "plan/02-features/01-alpha/issues/01_issue_ALPHA.md"), /\*\*Status\*\*: done/);
  assert.deepEqual(gh.lines()[0], ["git", "remote", "get-url", "origin"]);
  assert.deepEqual(gh.lines()[1].slice(0, 6), ["gh", "issue", "view", "42", "-R", "someone/thing"]);
  assert.deepEqual(gh.lines()[2], ["gh", "issue", "close", "42", "-R", "someone/thing"]);
});

test("GitHub: --cancelled closes the ticket as not planned", async (t) => {
  const f = fixture(t, { tracker: GITHUB, refs: { "02-01-01": "#42" } });
  const gh = fake(ORIGIN_GH, { json: { number: 42, state: "OPEN", labels: [], url: "u" } }, { json: { number: 42 } });
  assert.equal((await inProcess(f, ["set", "02-01-01", "done", "--cancelled"], gh.io)).status, 0);
  assert.deepEqual(gh.lines()[2].slice(0, 5), ["gh", "api", "-X", "PATCH", "repos/someone/thing/issues/42"]);
  assert.deepEqual(gh.sent(2), { state: "closed", state_reason: "not_planned" });
});

test("GitLab: blocked swaps the status label and posts the reason", async (t) => {
  const f = fixture(t, { tracker: GITLAB, refs: { "01-01-01": "#12" } });
  const gl = fake(ORIGIN_GL,
    { json: { iid: 12, title: "Setup", state: "opened", labels: ["status::in-progress"], web_url: "u" } },
    { json: { iid: 12, state: "opened", labels: ["status::blocked"], web_url: "u" } },
    { json: { id: 5 } });
  const r = await inProcess(f, ["set", "01-01-01", "blocked", "--evidence", "waiting on the ADR"], gl.io);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(gl.lines()[1].slice(0, 5), ["glab", "api", "-X", "GET", "projects/77/issues/12"]);
  assert.deepEqual(gl.lines()[2].slice(0, 5), ["glab", "api", "-X", "PUT", "projects/77/issues/12"]);
  assert.deepEqual(gl.sent(2), { add_labels: "status::blocked", remove_labels: "status::in-progress" });
  assert.deepEqual(gl.sent(3), { body: "Blocked: waiting on the ADR" });
});

test("an unpublished issue is a warning that names the forge, and no forge call is made", async (t) => {
  for (const [tracker, forge] of [[GITHUB, "GitHub"], [GITLAB, "GitLab"]]) {
    const f = fixture(t, { tracker });
    const runner = fake();
    const r = await inProcess(f, ["set", "01-01-01", "in-progress"], runner.io);
    assert.equal(r.status, 0);
    assert.match(r.stderr, new RegExp(`WARN: 01_issue_SETUP\\.md: tracker ref is <unassigned>, publish the sprint \\(plan-publish\\) before status syncs to ${forge}`));
    assert.equal(runner.calls.length, 0);
    assert.match(read(f, "plan/01-foundations/01-skeleton/issues/01_issue_SETUP.md"), /\*\*Status\*\*: in-progress/);
  }
});

test("a forge CLI that is missing or refused is a warning: the markdown stands and the exit is 0", async (t) => {
  const f = fixture(t, { tracker: GITHUB, refs: { "02-01-01": "#42" } });
  const r = await inProcess(f, ["set", "02-01-01", "done"], fake(ORIGIN_GH, { status: null, code: "ENOENT" }).io);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARN: GitHub: #42 not read \(not-installed\): gh is not installed.*\(markdown already updated\)/);
  assert.equal(r.stdout, "OK: 02-01-01 -> done; sprint 02-01 -> done; epic 02 -> done");
  assert.match(read(f, "plan/02-features/epic.md"), /\*\*Status\*\*: done/);
});

test("a workspace missing tracker.mjs still writes the markdown and says the tracker was not updated", (t) => {
  const f = fixture(t, { tracker: GITHUB, refs: { "02-01-01": "#42" } });
  fs.rmSync(path.join(f.root, P, "plan", "tracker.mjs"));
  const r = run(f, ["set", "02-01-01", "done"]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARN: tracker\.mjs could not be loaded beside this script/);
  assert.match(read(f, "plan/02-features/01-alpha/issues/01_issue_ALPHA.md"), /\*\*Status\*\*: done/);
});
