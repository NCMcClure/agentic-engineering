// but-first-planning's named workspaces: `.agents/plans/<name>/`, one feature's
// or task's spec and plan beside (or without) the project workspace at
// `.agents/plan/`. A named workspace holds no script of its own: a launcher at
// each path runs the one copy in `.agents/plans/_scripts/`. This suite builds
// one the way `scaffold.mjs --workspace` does and runs every script through its
// launcher, alone and beside a project workspace that uses the same
// coordinates, to show neither reaches into the other.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const AREA = path.join(REPO, "plugins", "agentic-engineering", "skills", "but-first-planning");
const SCAFFOLD = path.join(AREA, "routes", "spec-init", "scaffold.mjs");
const { LAUNCHERS, NAMED_PAGES, PLANS, SHARED, SHARED_SCRIPTS, WORKSPACE, asset, nameProblem, scaffold, scaffoldNamed, staleShared, workspaces } = await import(pathToFileURL(SCAFFOLD).href);
const tracker = await import(pathToFileURL(path.join(AREA, "routes", "spec-init", "assets", "tracker.mjs")).href);

const GITHUB = "# Issue tracker: GitHub\n\n| Role | Label | Meaning |\n|---|---|---|\n| ready-for-agent | `ready-for-agent` | AFK |\n";
const GITLAB = "# Issue tracker: GitLab\n\n- **Project**: `group/thing`\n- **Project ID**: `77`\n- **Host**: `gitlab.example.com`\n";
const LOCAL = "# Issue tracker: local markdown\n\nThe plan tree is the only source of truth.\n";
const ORIGIN_GH = { stdout: "https://github.com/someone/thing.git\n" };
const ORIGIN_GL = { stdout: "https://gitlab.example.com/group/thing.git\n" };

const issue = (title, ref = "<unassigned>") => `# ${title}

**Sprint**: [01-store](../sprint.md)
**Type**: AFK
**Tracker**: ${ref}
**Status**: not-started

## Parent

[Sprint 01-01](../sprint.md)

## What to build

Build it: ${title}.

Anchor: [spec/events.md](../../../../spec/events.md)

**User-facing**: no - internal

## Acceptance criteria

- [ ] it works

## Testing checkpoint

\`echo ok\`

## Blocked by

- None
`;

/** One epic, one sprint, one issue and one flat spec page under `home`, a workspace directory. */
function tree(root, home, { ref = "<unassigned>", title = "Event type" } = {}) {
  write(root, `${home}/plan/index.md`, "# Plan\n\n<!-- plan-format: 5.0 -->\n\n## Epics\n\n| # | Epic | Sprints | Issues | Status |\n|---|---|---|---|---|\n| 01 | [Core](01-core/epic.md) | 1 | 1 | not-started |\n");
  write(root, `${home}/plan/01-core/epic.md`, "# Epic 01: Core\n\n**Status**: not-started\n\n## Sprints\n\n| # | Sprint | Issues | Status |\n|---|---|---|---|\n| 01 | [Store](01-store/sprint.md) | 1 | not-started |\n");
  write(root, `${home}/plan/01-core/01-store/sprint.md`, `# Sprint 01-01: Store\n\n**Status**: not-started\n\n## Issues\n\n| # | Type | Title | Tracker | Status |\n|---|---|---|---|---|\n| 01 | AFK | [${title}](issues/01_issue_EVENT-TYPE.md) | ${ref} | not-started |\n`);
  write(root, `${home}/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md`, issue(title, ref));
  write(root, `${home}/spec/events.md`, "---\ntags: [runtime]\nsummary: How events move.\ncreated: 2026-01\nupdated: 2026-01\n---\n# Events\n");
}

/** A repo with the named workspace `name`, its tree written. `project` adds a project workspace with a tree of the same coordinates. */
function repo(t, { name = "billing", project = false, ...opts } = {}) {
  const root = tempDir(t, "bfp-named-");
  if (project) { tree(root, WORKSPACE, { title: "Project event type" }); scaffold(root); }
  tree(root, `${PLANS}/${name}`, opts);
  scaffoldNamed(root, name, { title: "Billing export" });
  return root;
}

const at = (root, name, rel) => path.join(root, PLANS, name, rel);
const run = (root, name, rel, args = []) => runNode(at(root, name, rel), args, { cwd: root });
const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");
/** Every file under `rel`, path to content, so a tree can be compared before and after. */
function snapshot(root, rel) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else out[`${dir}/${e.name}`] = read(root, `${dir}/${e.name}`);
    }
  };
  walk(rel);
  return out;
}

/** A runner answering `answers` in order: `{ json }`, `{ stdout }`, or a failure. */
function fake(...answers) {
  const calls = [];
  const out = [];
  const runner = (cmd, argv, { input } = {}) => {
    const a = answers[calls.length] ?? {};
    calls.push({ cmd, argv, input });
    return { status: "status" in a ? a.status : 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "", code: a.code };
  };
  return { calls, out, lines: () => calls.map((c) => [c.cmd, ...c.argv]), io: { run: runner, env: {}, pauseMs: 0, log: (line) => out.push(String(line)) } };
}

/** The shared copy of a script, imported, with console output captured around `fn`. */
async function shared(root, script, fn) {
  const mod = await import(pathToFileURL(path.join(root, SHARED, script)).href);
  const out = [], err = [];
  const log = console.log, writeErr = process.stderr.write;
  console.log = (line) => out.push(String(line));
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  try { return { status: await fn(mod), stdout: out.join("\n"), stderr: err.join("") }; } finally {
    console.log = log;
    process.stderr.write = writeErr;
  }
}

// ---- the scaffold ----------------------------------------------------------

test("a named workspace is scaffolded whole in a repo that has no project workspace, and a second run copies nothing", (t) => {
  const root = tempDir(t, "bfp-named-");
  const out = scaffoldNamed(root, "billing", { title: "Billing export" });
  assert.deepEqual(out.refreshed, []);
  assert.deepEqual(out.kept, []);
  assert.deepEqual(out.wrote, [
    ...SHARED_SCRIPTS.map((n) => `${SHARED}/${n}`),
    ...LAUNCHERS.map((rel) => `${PLANS}/billing/${rel}`),
    ...Object.values(NAMED_PAGES).map((rel) => `${PLANS}/billing/${rel}`),
    ...["completed", "notes", "drift"].map((d) => `${PLANS}/billing/progress/${d}/.gitkeep`),
  ]);
  assert.equal(fs.existsSync(path.join(root, WORKSPACE)), false, "a named workspace never brings a project workspace with it");
  assert.equal(SHARED_SCRIPTS.includes("comments-server.py"), false, "a named workspace has no site, so no site server");
  for (const rel of LAUNCHERS) assert.equal(read(root, `${PLANS}/billing/${rel}`), asset("launcher.mjs").toString("utf8"), rel);
  for (const rel of Object.values(NAMED_PAGES)) assert.doesNotMatch(read(root, `${PLANS}/billing/${rel}`), /\{\{/, `${rel} has every token filled`);
  assert.match(read(root, `${PLANS}/billing/spec/index.md`), /^# Billing export: specification\n/);
  assert.match(read(root, `${PLANS}/billing/plan/index.md`), /`billing\.EE-SS-II`/);
  assert.match(read(root, `${PLANS}/billing/plan/index.md`), /plan-format: 5\.0/);
  assert.deepEqual(workspaces(root), ["billing"]);

  const again = scaffoldNamed(root, "billing");
  assert.deepEqual([again.wrote, again.refreshed, again.kept], [[], [], []]);
});

test("a page that exists is never overwritten, and a second workspace reuses the shared copy", (t) => {
  const root = tempDir(t, "bfp-named-");
  write(root, `${PLANS}/billing/spec/index.md`, "# Mine\n");
  scaffoldNamed(root, "billing");
  assert.equal(read(root, `${PLANS}/billing/spec/index.md`), "# Mine\n");
  const second = scaffoldNamed(root, "auth-migration");
  assert.equal(second.wrote.some((rel) => rel.startsWith(SHARED)), false, "the shared scripts are written once");
  assert.deepEqual(workspaces(root), ["auth-migration", "billing"]);
});

test("a name is lowercase, starts with a letter, and is never `project` or the shared directory", () => {
  for (const ok of ["billing", "auth-migration", "v2", "a"]) assert.equal(nameProblem(ok), null, ok);
  for (const bad of ["project", "_scripts", "Billing", "2fa", "a b", "", "x".repeat(41), "a/b", "../up"]) assert.ok(nameProblem(bad), bad);
});

test("the command line: --workspace makes one, a bad name or a stray --title is exit 2, and --check and --refresh cover the named tier", (t) => {
  const root = tempDir(t, "bfp-named-");
  const cli = (...args) => runNode(SCAFFOLD, ["--root", root, ...args]);
  const made = cli("--workspace", "billing", "--title", "Billing export");
  assert.equal(made.status, 0);
  assert.match(made.stdout, /^wrote \.agents\/plans\/_scripts\/plan-status\.mjs\n/);
  assert.match(made.stdout, /wrote \.agents\/plans\/billing\/plan\/plan-status\.mjs\n/);
  assert.match(read(root, `${PLANS}/billing/spec/index.md`), /^# Billing export: specification/);

  for (const bad of [["--workspace", "project"], ["--workspace", "Bad_Name"], ["--title", "No workspace"]]) {
    const r = cli(...bad);
    assert.equal(r.status, 2, bad.join(" "));
    assert.match(r.stderr, /^scaffold\.mjs: /);
  }

  assert.equal(cli("--check").stdout, "every script is current\n");
  fs.appendFileSync(at(root, "billing", "plan/plan-status.mjs"), "// edited\n");
  fs.rmSync(path.join(root, SHARED, "tracker.mjs"));
  assert.deepEqual(staleShared(root), [`${SHARED}/tracker.mjs`, `${PLANS}/billing/plan/plan-status.mjs`]);
  const check = cli("--check");
  assert.equal(check.status, 1);
  assert.equal(check.stdout, `differs or missing: ${SHARED}/tracker.mjs\ndiffers or missing: ${PLANS}/billing/plan/plan-status.mjs\n2 script(s) are not this plugin's current copy; run with --refresh\n`);
  assert.equal(cli("--workspace", "billing").stdout, `wrote ${SHARED}/tracker.mjs\nkept ${PLANS}/billing/plan/plan-status.mjs (differs from the plugin's copy; --refresh rewrites it)\n`);
  assert.equal(cli("--refresh").stdout, `refreshed ${PLANS}/billing/plan/plan-status.mjs\n`);
  assert.equal(cli("--check").status, 0);
  assert.equal(fs.existsSync(path.join(root, WORKSPACE)), false, "neither --check nor --refresh gives a named-only repo a project workspace");

  // The plain run is spec-init's: it makes the project workspace beside the named one, and touches nothing of it.
  const before = snapshot(root, PLANS);
  const project = cli();
  assert.match(project.stdout, /^wrote \.agents\/plan\/plan\/plan-status\.mjs\n/);
  assert.doesNotMatch(project.stdout, /\.agents\/plans\//);
  assert.deepEqual(snapshot(root, PLANS), before);
  assert.equal(cli("--check").stdout, "every script is current\n");
});

test("in a repo with both tiers, --check and --refresh cover both, and a repo with neither still gets the project workspace", (t) => {
  const root = repo(t, { project: true });
  const cli = (...args) => runNode(SCAFFOLD, ["--root", root, ...args]);
  fs.appendFileSync(path.join(root, WORKSPACE, "plan/plan-status.mjs"), "// edited\n");
  fs.appendFileSync(path.join(root, SHARED, "plan-status.mjs"), "// edited\n");
  assert.equal(cli("--check").stdout, `differs or missing: ${WORKSPACE}/plan/plan-status.mjs\ndiffers or missing: ${SHARED}/plan-status.mjs\n2 script(s) are not this plugin's current copy; run with --refresh\n`);
  assert.equal(cli("--refresh").stdout, `refreshed ${WORKSPACE}/plan/plan-status.mjs\nrefreshed ${SHARED}/plan-status.mjs\n`);

  const bare = tempDir(t, "bfp-bare-");
  assert.match(runNode(SCAFFOLD, ["--root", bare]).stdout, /^wrote \.agents\/plan\/plan\/plan-status\.mjs\n/);
  assert.deepEqual(staleShared(bare), [], "a repo with no named workspace has no shared copy to be stale");
});

// ---- the launchers ---------------------------------------------------------

test("every script runs through its launcher, on the workspace the launcher sits in", (t) => {
  const root = repo(t);
  const plan = run(root, "billing", "plan/verify-plan-tree.mjs");
  assert.equal(plan.stdout, "OK: 1 epics, 1 sprints, 1 issues, 0 broken links, 0 missing fields\n");
  assert.equal(plan.status, 0);

  const spec = run(root, "billing", "spec/scripts/verify-spec-tree.mjs");
  assert.equal(spec.stdout, "OK: 0 categories, 1 content files, 1 index hubs, 0 broken links\n", "flat pages pass, and the two mandatory pages are the project's");
  assert.equal(spec.status, 0);

  const check = run(root, "billing", "plan/plan-status.mjs", ["check"]);
  assert.equal(check.stdout, "plan tree of billing: not-started\nNOT DONE: plan tree of billing is 'not-started'\n");
  assert.equal(check.status, 1);

  write(root, `${PLANS}/billing/progress/drift/drift-a.md`, "---\nid: D1\nkind: defect\nstatus: open\n---\n# A\n");
  const drift = run(root, "billing", "progress/drift-status.mjs", ["--json"]);
  assert.equal(drift.status, 0);
  assert.deepEqual(JSON.parse(drift.stdout).map((d) => d.id), ["D1"]);
});

test("a launcher works from any directory, and says so when the shared copy is gone", (t) => {
  const root = repo(t);
  const elsewhere = runNode(at(root, "billing", "plan/verify-plan-tree.mjs"), [], { cwd: tempDir(t, "bfp-cwd-") });
  assert.equal(elsewhere.status, 0);
  fs.rmSync(path.join(root, SHARED, "verify-plan-tree.mjs"));
  const gone = run(root, "billing", "plan/verify-plan-tree.mjs");
  assert.equal(gone.status, 2);
  assert.match(gone.stderr, /^verify-plan-tree\.mjs: the shared copy is missing \(.*_scripts.verify-plan-tree\.mjs\); the but-first-planning scaffold writes it back with --refresh\n$/);
});

test("the shared copy run directly refuses to guess a workspace: exit 2, naming the ones there are", (t) => {
  const root = repo(t);
  scaffoldNamed(root, "auth-migration");
  for (const [script, args] of [["plan-status.mjs", ["check"]], ["verify-plan-tree.mjs", []], ["verify-spec-tree.mjs", []], ["drift-status.mjs", []], ["publish-issues.mjs", ["status"]]]) {
    const r = runNode(path.join(root, SHARED, script), args, { cwd: root });
    assert.equal(r.status, 2, script);
    assert.match(r.stdout + r.stderr, /the copy every named workspace shares.*\(\.agents\/plans\/auth-migration, \.agents\/plans\/billing\)/, script);
  }
  const wrong = runNode(path.join(root, SHARED, "verify-plan-tree.mjs"), ["--workspace", path.join(root, WORKSPACE)], { cwd: root });
  assert.equal(wrong.status, 2, "--workspace takes a named workspace only");
  assert.match(wrong.stdout, /--workspace takes the directory of a named workspace/);
});

// ---- one workspace never reaches into another ------------------------------

test("a status set in a named workspace changes that workspace only, and is said with its name", (t) => {
  const root = repo(t, { project: true });
  const before = snapshot(root, WORKSPACE);
  const r = run(root, "billing", "plan/plan-status.mjs", ["set", "01-01-01", "done", "--evidence", "green"]);
  assert.equal(r.stdout, "OK: billing.01-01-01 -> done; sprint billing.01-01 -> done; epic billing.01 -> done\n");
  assert.equal(r.stderr, "");
  assert.equal(r.status, 0);
  assert.match(read(root, `${PLANS}/billing/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md`), /\*\*Status\*\*: done/);
  assert.match(read(root, `${PLANS}/billing/plan/index.md`), /01-core\/epic\.md\) \| 1 \| 1 \| done \|/);
  assert.match(read(root, `${PLANS}/billing/progress/completed/01-core.md`), /\| 01-01\/01 \| Event type \| - \|/);
  assert.deepEqual(snapshot(root, WORKSPACE), before, "the project workspace, which has an issue at the same coordinates, is untouched");

  const project = runNode(path.join(root, WORKSPACE, "plan/plan-status.mjs"), ["set", "01-01-01", "in-progress"], { cwd: root });
  assert.equal(project.stdout, "OK: 01-01-01 -> in-progress; sprint 01-01 -> in-progress; epic 01 -> in-progress\n", "the project's own coordinates stay bare");
  assert.match(read(root, `${PLANS}/billing/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md`), /\*\*Status\*\*: done/);
});

// ---- the tracker -----------------------------------------------------------

test("a named workspace with no tracker.md moves its ticket on the project's tracker; one of its own wins", async (t) => {
  const root = repo(t, { project: true, ref: "#42" });
  write(root, `${WORKSPACE}/tracker.md`, GITHUB);
  const gh = fake(ORIGIN_GH, { json: { number: 42, title: "Event type", state: "OPEN", labels: [], url: "u" } }, {}, { json: { number: 42, state: "CLOSED", labels: [], url: "u" } });
  const r = await shared(root, "plan-status.mjs", (m) => m.run(["--workspace", path.join(root, PLANS, "billing"), "set", "01-01-01", "done"], gh.io));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  assert.deepEqual(gh.lines()[2], ["gh", "issue", "close", "42", "-R", "someone/thing"]);

  write(root, `${PLANS}/billing/tracker.md`, LOCAL);
  const local = fake();
  await shared(root, "plan-status.mjs", (m) => m.run(["--workspace", path.join(root, PLANS, "billing"), "set", "01-01-01", "in-progress"], local.io));
  assert.deepEqual(local.calls, [], "its own local-markdown tracker.md means no forge is called");
});

test("with no tracker.md anywhere a named workspace is local-markdown: status works, publishing says there is nowhere to publish", (t) => {
  const root = repo(t);
  assert.equal(run(root, "billing", "plan/plan-status.mjs", ["set", "01-01-01", "done"]).stderr, "");
  const r = run(root, "billing", "plan/publish-issues.mjs", ["status"]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "error: no tracker.md in .agents/plans/billing/ or in .agents/plan/: this workspace is local-markdown, nothing to publish to\n");
});

test("GitHub: a named workspace's ticket carries a plan label and cites its own spec and plan paths", async (t) => {
  const root = repo(t, { project: true });
  write(root, `${WORKSPACE}/tracker.md`, GITHUB);
  const gh = fake(ORIGIN_GH, {}, {}, { stdout: "https://github.com/someone/thing/issues/41\n" }, { json: { number: 41, title: "t", state: "OPEN", labels: [], url: "u" } });
  const r = await shared(root, "publish-issues.mjs", (m) => m.run(["--workspace", path.join(root, PLANS, "billing"), "publish"], gh.io));
  assert.equal(r.status, 0, gh.out.join("\n"));
  assert.deepEqual(gh.calls.filter((c) => c.argv[0] === "label").map((c) => c.argv[2]), ["ready-for-agent", "plan:billing"]);
  const create = gh.calls.find((c) => c.argv[0] === "issue" && c.argv[1] === "create");
  assert.deepEqual(create.argv.flatMap((a, i) => (a === "--label" ? [create.argv[i + 1]] : [])).join(",").split(","), ["ready-for-agent", "plan:billing"]);
  assert.match(create.input, /Spec anchor: `\.agents\/plans\/billing\/spec\/events\.md`/);
  assert.match(create.input, /\*Plan file: `\.agents\/plans\/billing\/plan\/01-core\/01-store\/issues\/01_issue_EVENT-TYPE\.md`\./);
  assert.match(read(root, `${PLANS}/billing/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md`), /\*\*Tracker\*\*: #41/);
  assert.match(read(root, `${WORKSPACE}/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md`), /\*\*Tracker\*\*: <unassigned>/, "the project's issue at the same coordinates is not published");
});

test("GitLab: a named workspace's epic label and milestone carry its name, so two plans never share one", async (t) => {
  const root = repo(t);
  write(root, `${PLANS}/billing/tracker.md`, GITLAB);
  const gl = fake(ORIGIN_GL, { json: { id: 1 } }, { json: { id: 31, title: "billing.01-01 store" } }, { json: [{ id: 31, title: "billing.01-01 store" }] }, { json: { iid: 11, title: "t", state: "opened", labels: [], web_url: "u" } });
  const r = await shared(root, "publish-issues.mjs", (m) => m.run(["--workspace", path.join(root, PLANS, "billing"), "publish", "--sprint", "01-01"], gl.io));
  assert.equal(r.status, 0, gl.out.join("\n"));
  assert.ok(gl.out.includes("label epic::billing.01-core created"), gl.out.join("\n"));
  assert.ok(gl.out.includes("milestone billing.01-01 store created"), gl.out.join("\n"));
});

test("tracker names: the project's are bare, a named workspace's carry its name", () => {
  const sprint = { enum: "02", eslug: "persistence", snum: "01", sslug: "event-store" };
  const named = { ...sprint, ws: "billing" };
  const github = tracker.readTracker(GITHUB);
  assert.equal(tracker.epicLabel(sprint), "epic::02-persistence");
  assert.equal(tracker.epicLabel(named), "epic::billing.02-persistence");
  assert.equal(tracker.milestoneTitle(sprint), "02-01 event-store");
  assert.equal(tracker.milestoneTitle(named), "billing.02-01 event-store");
  assert.equal(tracker.planLabel(sprint), null);
  assert.deepEqual(tracker.ticketLabels(github, sprint, { type: "AFK" }), ["ready-for-agent"]);
  assert.deepEqual(tracker.ticketLabels(github, named, { type: "AFK" }), ["ready-for-agent", "plan:billing"]);
  assert.deepEqual(tracker.ticketLabels(tracker.readTracker(GITLAB), named, { type: "HITL", decision: true }), ["epic::billing.02-persistence", "type::HITL", "decision"]);
});
