// but-first-planning's publisher (publish-issues.mjs): a sprint's plan issues
// become tickets on GitHub or GitLab, blockers first, each ref written back at
// once, and a second run publishes nothing twice. The workspace's copy is
// imported and handed a fake runner in place of gh, glab and git; the refusals
// that need no forge run as a child process.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const { scaffold } = await import(pathToFileURL(path.join(REPO, "plugins", "but-first-planning", "skills", "spec-init", "scaffold.mjs")).href);

const P = ".agents/plan";
const GITHUB = "# Issue tracker: GitHub\n\n| Role | Label | Meaning |\n|---|---|---|\n| ready-for-agent | `ready-for-agent` | AFK |\n| ready-for-human | `ready-for-human` | HITL |\n";
const GITLAB = "# Issue tracker: GitLab\n\n- **Project**: `group/thing`\n- **Project ID**: `77`\n- **Host**: `gitlab.example.com`\n";
const SPRINT = "plan/01-core/01-store";

const issue = ({ title, type = "AFK", ref = "<unassigned>", status = "not-started", blockedBy = [], field = "Tracker", what = null }) => `# ${title}

**Sprint**: [01-store](../sprint.md)
**Type**: ${type}
**${field}**: ${ref}
**Status**: ${status}

## Parent

[Sprint 01-01](../sprint.md)

## What to build

${what ?? `Build it: ${title}.`}

Anchor: [spec/02-runtime/events.md](../../../../spec/02-runtime/events.md)

**User-facing**: no - internal

## Acceptance criteria

- [ ] The behaviour in the title is implemented end-to-end
- [ ] The testing checkpoint command passes

## Testing checkpoint

\`echo ok\`

## Blocked by

${blockedBy.length ? blockedBy.map((f) => `- [blocker](./${f})`).join("\n") : "- None"}
`;

/**
 * One epic, one sprint, three issues. 01 is blocked by 02, so 02 publishes
 * first; 03 is a HITL decision. `refs` pre-publishes an issue by its number.
 */
function fixture(t, { tracker = GITHUB, refs = {}, field = "Tracker", statuses = {} } = {}) {
  const root = tempDir(t, "bfp-publish-");
  const ref = (n) => refs[n] ?? "<unassigned>";
  write(root, `${P}/tracker.md`, tracker);
  write(root, `${P}/plan/index.md`, "# Plan\n\n<!-- plan-format: 5.0 -->\n\n## Epics\n\n| # | Epic | Sprints | Issues | Status |\n|---|---|---|---|---|\n| 01 | [Core](01-core/epic.md) | 1 | 3 | not-started |\n");
  write(root, `${P}/plan/01-core/epic.md`, "# Epic 01: Core\n\n**Status**: not-started\n\n## Sprints\n\n| # | Sprint | Issues | Status |\n|---|---|---|---|\n| 01 | [Store](01-store/sprint.md) | 3 | not-started |\n");
  write(root, `${P}/${SPRINT}/sprint.md`, `# Sprint 01-01: Store

**Status**: not-started

## Issues

| # | Type | Title | ${field} | Status |
|---|------|-------|---------|--------|
| 01 | AFK | [Read path](issues/01_issue_READ-PATH.md) | ${ref("01")} | not-started |
| 02 | AFK | [Event type](issues/02_issue_EVENT-TYPE.md) | ${ref("02")} | not-started |
| 03 | HITL | [Decide the store](issues/03_issue_DECIDE-THE-STORE.md) | ${ref("03")} | not-started |
`);
  write(root, `${P}/${SPRINT}/issues/01_issue_READ-PATH.md`, issue({ title: "Read path", ref: ref("01"), blockedBy: ["02_issue_EVENT-TYPE.md"], field, status: statuses["01"] }));
  write(root, `${P}/${SPRINT}/issues/02_issue_EVENT-TYPE.md`, issue({ title: "Event type", ref: ref("02"), field, status: statuses["02"] }));
  write(root, `${P}/${SPRINT}/issues/03_issue_DECIDE-THE-STORE.md`, issue({ title: "Decide the store", type: "HITL", ref: ref("03"), field, what: "Decide which store backs the events.", status: statuses["03"] }));
  write(root, `${P}/spec/02-runtime/events.md`, "---\ntags: [x]\nsummary: s\ncreated: 2026-01\nupdated: 2026-01\n---\n# Events\n");
  scaffold(root);
  return { root, script: path.join(root, P, "plan", "publish-issues.mjs") };
}

const read = (f, rel) => fs.readFileSync(path.join(f.root, P, rel), "utf8");
const trackerLine = (f, name) => /\*\*(?:Tracker|GitHub)\*\*: (.+)/.exec(read(f, `${SPRINT}/issues/${name}`))[1];

/** A runner answering `answers` in order: `{ json }`, `{ stdout }`, or a failure `{ status, stderr, code }`. */
function fake(...answers) {
  const calls = [];
  const runner = (cmd, argv, { input } = {}) => {
    const a = answers[calls.length] ?? {};
    calls.push({ cmd, argv, input });
    return { status: "status" in a ? a.status : 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "", code: a.code };
  };
  const out = [];
  return {
    calls, out, lines: () => calls.map((c) => [c.cmd, ...c.argv]), sent: (i) => JSON.parse(calls[i].input),
    forge: () => calls.filter((c) => c.cmd !== "git" && c.cmd !== "ssh"),
    io: { run: runner, env: {}, pauseMs: 0, log: (line) => out.push(String(line)) },
  };
}

const publisher = async (f) => import(pathToFileURL(f.script).href);
const ORIGIN_GH = { stdout: "https://github.com/someone/thing.git\n" };
const ORIGIN_GL = { stdout: "https://gitlab.example.com/group/thing.git\n" };
const ghMade = (n) => [{ stdout: `https://github.com/someone/thing/issues/${n}\n` }, { json: { number: n, title: "t", state: "OPEN", labels: [], url: `https://github.com/someone/thing/issues/${n}` } }];
const glMade = (n) => [{ json: [{ id: 31, title: "01-01 store" }] }, { json: { iid: n, title: "t", state: "opened", labels: [], web_url: "u" } }];

// ---- publish ----------------------------------------------------------------

test("GitHub: a sprint publishes blockers first, labels by type, and writes each ref back at once", async (t) => {
  const f = fixture(t);
  const gh = fake(ORIGIN_GH, {}, ...ghMade(41), ...ghMade(42), {}, ...ghMade(43));
  const { run } = await publisher(f);
  assert.equal(run(["publish"], gh.io), 0);

  assert.equal(gh.out[0], "publishing 01-01 (lazy default): 3 issues, 3 unpublished, tracker=github");
  assert.deepEqual(gh.out.filter((l) => l.startsWith("#")), ["#41  01-01/02_issue_EVENT-TYPE.md", "#42  01-01/01_issue_READ-PATH.md", "#43  01-01/03_issue_DECIDE-THE-STORE.md"]);
  assert.deepEqual(JSON.parse(gh.out.at(-1)), { created: 3, skipped: 0, failures: [] });

  const creates = gh.calls.filter((c) => c.argv[1] === "create" && c.argv[0] === "issue");
  assert.deepEqual(creates.map((c) => c.argv[c.argv.indexOf("--title") + 1]), ["Event type", "Read path", "Decide the store"]);
  assert.deepEqual(creates.map((c) => c.argv[c.argv.indexOf("--label") + 1]), ["ready-for-agent", "ready-for-agent", "ready-for-human"]);
  assert.deepEqual(gh.calls.filter((c) => c.argv[0] === "label").map((c) => c.argv[2]), ["ready-for-agent", "ready-for-human"], "each triage label is made once");

  // The blocked body cites its blocker's real ref, and the spec anchor is a path a reader can open.
  const blocked = creates[1].input;
  assert.match(blocked, /## Blocked by\n\n- #41 event type\n/);
  assert.match(blocked, /Spec anchor: `\.agents\/plan\/spec\/02-runtime\/events\.md`/);
  assert.match(blocked, /spec\/02-runtime\/events\.md \(`\.agents\/plan\/spec\/02-runtime\/events\.md`\)/);
  assert.match(blocked, /\*Plan file: `\.agents\/plan\/plan\/01-core\/01-store\/issues\/01_issue_READ-PATH\.md`\. The plan tree is the source of truth\.\*$/);
  assert.match(creates[0].input, /## Blocked by\n\n- None\n/);

  assert.equal(trackerLine(f, "02_issue_EVENT-TYPE.md"), "#41");
  assert.equal(trackerLine(f, "01_issue_READ-PATH.md"), "#42");
  assert.match(read(f, `${SPRINT}/sprint.md`), /01_issue_READ-PATH\.md\) \| #42 \| not-started \|/);
  assert.match(read(f, `${SPRINT}/sprint.md`), /03_issue_DECIDE-THE-STORE\.md\) \| #43 \| not-started \|/);
  assert.match(read(f, `${SPRINT}/issues/01_issue_READ-PATH.md`), /\*\*Status\*\*: not-started/, "publishing does not start the work");
});

test("GitLab: the epic label and the sprint milestone are made once, and each issue carries its epic, type and milestone", async (t) => {
  const f = fixture(t, { tracker: GITLAB });
  const gl = fake(ORIGIN_GL, { json: { id: 1 } }, { json: { id: 31, title: "01-01 store" } }, ...glMade(11), ...glMade(12), ...glMade(13));
  const { run } = await publisher(f);
  assert.equal(run(["publish", "--sprint", "01-01"], gl.io), 0);

  assert.equal(gl.out[0], "publishing 01-01: 3 issues, 3 unpublished, tracker=gitlab");
  assert.ok(gl.out.includes("label epic::01-core created"));
  assert.ok(gl.out.includes("milestone 01-01 store created"));
  const posts = gl.forge().filter((c) => c.argv[2] === "POST");
  assert.deepEqual(posts.map((c) => c.argv[3]), ["projects/77/labels", "projects/77/milestones", "projects/77/issues", "projects/77/issues", "projects/77/issues"]);
  const bodies = posts.slice(2).map((c) => JSON.parse(c.input));
  assert.deepEqual(bodies.map((b) => b.title), ["Event type", "Read path", "Decide the store"]);
  assert.deepEqual(bodies.map((b) => b.labels), ["epic::01-core,type::AFK", "epic::01-core,type::AFK", "epic::01-core,type::HITL,decision"]);
  assert.deepEqual(bodies.map((b) => b.milestone_id), [31, 31, 31]);
  assert.match(bodies[1].description, /- #11 event type/);
  assert.equal(trackerLine(f, "03_issue_DECIDE-THE-STORE.md"), "#13");
  assert.deepEqual(JSON.parse(gl.out.at(-1)), { created: 3, skipped: 0, failures: [] });
});

test("a second publish skips what already has a ref, and a fully published plan has nothing to do", async (t) => {
  const f = fixture(t, { refs: { "02": "#41" } });
  const gh = fake(ORIGIN_GH, {}, ...ghMade(42), {}, ...ghMade(43));
  const { run } = await publisher(f);
  assert.equal(run(["publish", "--sprint", "01-01"], gh.io), 0);
  assert.deepEqual(JSON.parse(gh.out.at(-1)), { created: 2, skipped: 1, failures: [] });
  assert.equal(trackerLine(f, "02_issue_EVENT-TYPE.md"), "#41", "a published ref is never rewritten");
  assert.match(gh.calls.find((c) => c.argv[0] === "issue" && c.argv[1] === "create").input, /- #41 event type/);

  const again = fake(ORIGIN_GH);
  assert.equal(run([], again.io), 0);
  assert.deepEqual(again.out, ["nothing to publish, every issue already has a ref"]);
  assert.equal(again.forge().length, 0);
});

test("one failed ticket does not stop the rest: it is reported, exit is 1, and a re-run retries only it", async (t) => {
  const f = fixture(t);
  const refused = { status: 1, stderr: "gh: Validation Failed (HTTP 422)\n" };
  const gh = fake(ORIGIN_GH, {}, ...ghMade(41), refused, {}, ...ghMade(43));
  const { run } = await publisher(f);
  assert.equal(run(["publish"], gh.io), 1);
  const summary = JSON.parse(gh.out.at(-1));
  assert.equal(summary.created, 2);
  assert.deepEqual(summary.failures.map((x) => [x.issue, x.error]), [[".agents/plan/plan/01-core/01-store/issues/01_issue_READ-PATH.md", "refused"]]);
  assert.equal(trackerLine(f, "01_issue_READ-PATH.md"), "<unassigned>");
  assert.equal(trackerLine(f, "02_issue_EVENT-TYPE.md"), "#41");

  const retry = fake(ORIGIN_GH, {}, ...ghMade(44));
  assert.equal(run(["publish"], retry.io), 0);
  assert.deepEqual(JSON.parse(retry.out.at(-1)), { created: 1, skipped: 2, failures: [] });
  assert.equal(trackerLine(f, "01_issue_READ-PATH.md"), "#44");
});

test("--dry-run shows the order and touches neither the forge nor the plan", async (t) => {
  const f = fixture(t, { refs: { "02": "#41" } });
  const gh = fake(ORIGIN_GH);
  const { run } = await publisher(f);
  assert.equal(run(["publish", "--all", "--dry-run"], gh.io), 0);
  assert.deepEqual(gh.out, ["publishing ALL sprints: 3 issues, 2 unpublished, tracker=github", "  01-01 store: 02(#41), 01(new), 03*(new)"]);
  assert.equal(gh.forge().length, 0);
  assert.equal(trackerLine(f, "01_issue_READ-PATH.md"), "<unassigned>");
});

test("a tree that still names its tracker field `**GitHub**:` is published into that field", async (t) => {
  const f = fixture(t, { field: "GitHub", refs: { "02": "#41", "03": "#43" } });
  const gh = fake(ORIGIN_GH, {}, ...ghMade(42));
  const { run } = await publisher(f);
  assert.equal(run(["publish"], gh.io), 0);
  assert.match(read(f, `${SPRINT}/issues/01_issue_READ-PATH.md`), /\*\*GitHub\*\*: #42\n/);
  assert.doesNotMatch(read(f, `${SPRINT}/issues/01_issue_READ-PATH.md`), /\*\*Tracker\*\*/);
});

// ---- sync and status --------------------------------------------------------

test("sync rebuilds a published ticket's title and body, by coordinates or by number, on both forges", async (t) => {
  const f = fixture(t, { refs: { "01": "#42", "02": "#41" } });
  const { run } = await publisher(f);
  const gh = fake(ORIGIN_GH, {}, { json: { number: 42, title: "Read path", state: "OPEN", labels: [], url: "u" } });
  assert.equal(run(["sync", "01-01-01"], gh.io), 0);
  assert.equal(gh.out[0], "sync #42 <- .agents/plan/plan/01-core/01-store/issues/01_issue_READ-PATH.md");
  const edit = gh.forge()[0];
  assert.deepEqual(edit.argv.slice(0, 7), ["issue", "edit", "42", "-R", "someone/thing", "--title", "Read path"]);
  assert.match(edit.input, /- #41 event type/);

  const g = fixture(t, { tracker: GITLAB, refs: { "01": "#12" } });
  const mod = await publisher(g);
  for (const target of [["#12"], ["--iid", "12"], ["12"]]) {
    const gl = fake(ORIGIN_GL, { json: { iid: 12, title: "Read path", state: "opened", labels: [], web_url: "u" } });
    assert.equal(mod.run(["sync", ...target], gl.io), 0);
    assert.deepEqual(gl.forge()[0].argv.slice(0, 4), ["api", "-X", "PUT", "projects/77/issues/12"]);
    assert.equal(JSON.parse(gl.forge()[0].input).title, "Read path");
  }

  const dry = fake(ORIGIN_GH);
  assert.equal(run(["sync", "01-01-01", "--dry-run"], dry.io), 0);
  assert.equal(dry.forge().length, 0);
  assert.match(dry.out[1], /^## What to build/);
});

test("status reads every published ticket back and exits 1 where the tracker and the plan disagree about done", async (t) => {
  const f = fixture(t, { refs: { "01": "#42", "02": "#41" }, statuses: { "01": "done", "02": "done" } });
  const { run } = await publisher(f);
  const view = (n, state) => ({ json: { number: n, title: "t", state, labels: [], url: "u" } });
  const gh = fake(ORIGIN_GH, view(41, "CLOSED"), view(42, "OPEN"));
  assert.equal(run(["status"], gh.io), 1);
  assert.deepEqual(gh.out, [
    "01-01-02  #41     plan=done  tracker=done",
    "01-01-01  #42     plan=done  tracker=open  DISAGREE",
    "01-01-03  -       plan=not-started  tracker=unpublished",
    "3 issue(s), 1 disagreement(s)",
  ]);

  const g = fixture(t, { tracker: GITLAB, refs: { "02": "#11" }, statuses: { "02": "blocked" } });
  const mod = await publisher(g);
  const gl = fake(ORIGIN_GL, { json: { iid: 11, state: "opened", labels: ["status::blocked"], web_url: "u" } });
  assert.equal(mod.run(["status", "--sprint", "01-01", "--json"], gl.io), 0);
  const rows = JSON.parse(gl.out[0]);
  assert.deepEqual(rows.find((r) => r.ref === "#11"), { coords: "01-01-02", ref: "#11", plan: "blocked", tracker: "blocked", agrees: true });
});

// ---- refusals ---------------------------------------------------------------

test("a local-markdown workspace has nothing to publish to, and says so with exit 2", (t) => {
  const f = fixture(t, { tracker: "# Issue tracker: local markdown\n" });
  const r = runNode(f.script, ["publish"], { cwd: f.root });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /error: tracker\.md declares a local \(or unknown\) tracker, nothing to publish to/);
});

test("a missing tracker.md, an unfilled GitLab project, an unknown sprint and a bad flag are all exit 2", async (t) => {
  const f = fixture(t, { tracker: "# Issue tracker: GitLab\n\n- **Project**: `{{GITLAB_PROJECT_PATH}}`\n- **Project ID**: `{{GITLAB_PROJECT_ID}}`\n" });
  const unset = runNode(f.script, [], { cwd: f.root });
  assert.equal(unset.status, 2);
  assert.match(unset.stderr, /GitLab mode but \*\*Project\*\*: \/ \*\*Project ID\*\*: are unset/);

  fs.rmSync(path.join(f.root, P, "tracker.md"));
  const none = runNode(f.script, [], { cwd: f.root });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /\.agents\/plan\/tracker\.md not found, run spec-init first/);

  const g = fixture(t);
  assert.equal(runNode(g.script, ["publish", "--sprint", "09-09", "--dry-run"], { cwd: g.root }).status, 2);
  assert.equal(runNode(g.script, ["publish", "--frobnicate"], { cwd: g.root }).status, 2);
  const unpublished = runNode(g.script, ["sync", "01-01-01", "--dry-run"], { cwd: g.root });
  assert.equal(unpublished.status, 2);
  assert.match(unpublished.stderr, /01-01-01 is not published yet/);
  assert.match(runNode(g.script, ["sync", "#999", "--dry-run"], { cwd: g.root }).stderr, /no plan issue carries \*\*Tracker\*\*: #999/);
});
