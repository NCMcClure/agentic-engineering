// but-first-planning's tracker layer (tracker.mjs): what tracker.md is read
// as, and the calls a publish and a status change make on GitHub and on
// GitLab. A fake runner stands in for gh, glab and git: it records every call
// and answers canned output in order, so nothing here starts a process.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO } from "./helpers.mjs";

const ASSETS = path.join(REPO, "plugins", "but-first-planning", "skills", "spec-init", "assets");
const {
  BOARD_STATUS, EPIC_COLORS, STATUS_LABEL, agrees, createTicket, epicLabel, milestoneTitle, providerFor, readTracker, rebuildTicket,
  refNumber, syncStatus, ticketLabels, trackerState,
} = await import(pathToFileURL(path.join(ASSETS, "tracker.mjs")).href);

const GH = { kind: "github", cli: "gh", host: "github.com", slug: "someone/thing", root: null };
const GL = { kind: "gitlab", cli: "glab", host: "gitlab.example.com", slug: "group/thing", projectId: "77", root: null };
const R = ["-R", "someone/thing"];
const JSON_BODY = ["-H", "Content-Type: application/json", "--input", "-"];
const GH_ISSUE_FIELDS = "number,title,body,state,labels,url,assignees,milestone,author,updatedAt";

/** A runner answering `answers` in order: `{ json }`, `{ stdout }`, or a failure `{ status, stderr, code }`. */
function fake(...answers) {
  const calls = [];
  const run = (cmd, argv, { input } = {}) => {
    const a = answers[calls.length] ?? {};
    calls.push({ cmd, argv, input });
    return { status: "status" in a ? a.status : 0, stdout: a.json !== undefined ? JSON.stringify(a.json) : a.stdout ?? "", stderr: a.stderr ?? "", code: a.code };
  };
  return { run, calls, lines: () => calls.map((c) => [c.cmd, ...c.argv]), sent: (i) => JSON.parse(calls[i].input), io: { run, env: {} } };
}

const GITHUB_MD = `# Issue tracker: GitHub

| Role | Label | Meaning |
|------|-------|---------|
| ready-for-agent | \`agent-ready\` | AFK |
| ready-for-human | \`needs-human\` | HITL |
| ready-for-review | \`needs-eyes\` | REVIEW |

- **Notify**: \`@someone\`

- **URL**: \`https://github.com/users/someone/projects/4\`  &nbsp; **Owner**: \`someone\`  &nbsp; **Number**: \`4\`
`;
const GITLAB_MD = `# Issue tracker: GitLab

- **Project**: \`group/thing\`
- **Project ID**: \`77\`
- **Host**: \`gitlab.example.com\` (authenticated \`glab\` CLI)

- **Notify**: \`{{NOTIFY_HANDLE}}\`
`;
const SPRINT = { enum: "02", eslug: "persistence", snum: "01", sslug: "event-store" };
const AFK = { title: "Events round-trip", type: "AFK", decision: false };

// ---- tracker.md -------------------------------------------------------------

test("tracker.md names the forge, its labels, its board and who to notify", () => {
  assert.deepEqual(readTracker(GITHUB_MD), {
    mode: "github", labels: { agent: "agent-ready", human: "needs-human", review: "needs-eyes" }, board: { owner: "someone", number: 4 }, notify: "@someone",
  });
  assert.deepEqual(readTracker(GITLAB_MD), { mode: "gitlab", project: "group/thing", projectId: "77", host: "gitlab.example.com", notify: null });
  assert.deepEqual(readTracker("# Issue tracker: local markdown\n"), { mode: "local", notify: null });
  assert.equal(readTracker("").mode, "local");
  assert.equal(readTracker(undefined).mode, "local");
});

test("an unfilled placeholder is unset, and REVIEW falls back to the human label when tracker.md has no review row", () => {
  const bare = readTracker("# Issue tracker: GitHub\n\n- **URL**: `{{PROJECT_BOARD_URL}}`  **Owner**: `{{PROJECT_OWNER}}`  **Number**: `{{PROJECT_NUMBER}}`\n\n| ready-for-human | `hands` | x |\n");
  assert.equal(bare.board, null);
  assert.deepEqual(bare.labels, { agent: "ready-for-agent", human: "hands", review: "hands" });
  assert.equal(readTracker("# Issue tracker: GitLab\n- **Project**: `{{GITLAB_PROJECT_PATH}}`\n- **Project ID**: `{{GITLAB_PROJECT_ID}}`\n").project, null);
});

test("the provider is the forge tracker.md names, pinned to its project where it names one", () => {
  const origin = fake({ stdout: "git@github.com:someone/thing.git\n" });
  const gh = providerFor(readTracker(GITHUB_MD), "checkout", origin.io);
  assert.deepEqual([gh.kind, gh.cli, gh.host, gh.slug], ["github", "gh", "github.com", "someone/thing"]);
  // The remote says nothing useful here: tracker.md's project, id and host win.
  const gl = providerFor(readTracker(GITLAB_MD), "checkout", fake({ status: 2, stderr: "error: No such remote 'origin'\n" }).io);
  assert.deepEqual([gl.kind, gl.cli, gl.host, gl.slug, gl.projectId], ["gitlab", "glab", "gitlab.example.com", "group/thing", "77"]);
  assert.equal(providerFor({ mode: "local" }, "checkout", origin.io), null);
});

test("a tracker ref is `#NNN` or nothing", () => {
  assert.equal(refNumber("#42"), "42");
  assert.equal(refNumber(" #7 "), "7");
  for (const not of ["<unassigned>", "42", "local:01-01/02", "", null, undefined]) assert.equal(refNumber(not), null);
});

// ---- publishing -------------------------------------------------------------

test("labels: GitHub takes the triage label for the type, GitLab the epic and type labels", () => {
  const gh = readTracker(GITHUB_MD), gl = readTracker(GITLAB_MD);
  assert.deepEqual(ticketLabels(gh, SPRINT, { type: "AFK" }), ["agent-ready"]);
  assert.deepEqual(ticketLabels(gh, SPRINT, { type: "HITL" }), ["needs-human"]);
  assert.deepEqual(ticketLabels(gh, SPRINT, { type: "REVIEW" }), ["needs-eyes"]);
  assert.deepEqual(ticketLabels(gl, SPRINT, { type: "AFK" }), ["epic::02-persistence", "type::AFK"]);
  assert.deepEqual(ticketLabels(gl, SPRINT, { type: "HITL", decision: true }), ["epic::02-persistence", "type::HITL", "decision"]);
  assert.equal(epicLabel(SPRINT), "epic::02-persistence");
  assert.equal(milestoneTitle(SPRINT), "02-01 event-store");
});

test("GitHub: a ticket is opened with its triage label, which is made first and only once a run", () => {
  const gh = fake(
    {}, // label create
    { stdout: "https://github.com/someone/thing/issues/42\n" },
    { json: { number: 42, title: "Events round-trip", body: "the body", state: "OPEN", labels: [{ name: "agent-ready" }], url: "https://github.com/someone/thing/issues/42" } },
    { stdout: "https://github.com/someone/thing/issues/43\n" },
    { json: { number: 43, title: "Second", state: "OPEN", labels: [], url: "u" } },
  );
  const config = readTracker(GITHUB_MD), state = {};
  const made = createTicket(GH, config, SPRINT, AFK, "the body", state, gh.io);
  assert.equal(made.ok, true);
  assert.equal(made.value.number, 42);
  assert.deepEqual(made.made, ["label agent-ready"]);
  assert.deepEqual(gh.lines()[0], ["gh", "label", "create", "agent-ready", ...R]);
  assert.deepEqual(gh.lines()[1], ["gh", "issue", "create", ...R, "--title", "Events round-trip", "--body-file", "-", "--label", "agent-ready"]);
  assert.equal(gh.calls[1].input, "the body");
  assert.deepEqual(gh.lines()[2], ["gh", "issue", "view", "42", ...R, "--json", GH_ISSUE_FIELDS]);

  const second = createTicket(GH, config, SPRINT, { ...AFK, title: "Second" }, "b", state, gh.io);
  assert.equal(second.value.number, 43);
  assert.deepEqual(second.made, []);
  assert.equal(gh.calls.length, 5, "the label is not made twice");
  assert.equal(gh.lines()[3][2], "create");
});

test("GitLab: the epic label and the sprint milestone are made once, then the issue goes into both", () => {
  const P = "projects/77";
  const gl = fake(
    { json: { id: 9, name: "epic::02-persistence" } }, // label
    { json: { id: 31, title: "02-01 event-store" } }, // milestone
    { json: [{ id: 31, title: "02-01 event-store" }] }, // the milestone's id, by title
    { json: { iid: 12, title: "Events round-trip", description: "the body", state: "opened", labels: ["epic::02-persistence", "type::AFK"], web_url: "https://gitlab.example.com/group/thing/-/issues/12", milestone: { title: "02-01 event-store" } } },
    { json: [{ id: 31, title: "02-01 event-store" }] },
    { json: { iid: 13, title: "Decide the store", state: "opened", labels: [], web_url: "u" } },
  );
  const config = readTracker(GITLAB_MD), state = {};
  const made = createTicket(GL, config, SPRINT, AFK, "the body", state, gl.io);
  assert.equal(made.ok, true);
  assert.equal(made.value.number, 12);
  assert.deepEqual(made.made, ["label epic::02-persistence", "milestone 02-01 event-store"]);
  assert.deepEqual(gl.lines()[0], ["glab", "api", "-X", "POST", `${P}/labels`, ...JSON_BODY]);
  assert.deepEqual(gl.sent(0), { name: "epic::02-persistence", color: EPIC_COLORS[1], description: "Epic 02" });
  assert.deepEqual(gl.lines()[1], ["glab", "api", "-X", "POST", `${P}/milestones`, ...JSON_BODY]);
  assert.deepEqual(gl.sent(1), { title: "02-01 event-store" });
  assert.deepEqual(gl.lines()[3], ["glab", "api", "-X", "POST", `${P}/issues`, ...JSON_BODY]);
  assert.deepEqual(gl.sent(3), { title: "Events round-trip", description: "the body", labels: "epic::02-persistence,type::AFK", milestone_id: 31 });

  const second = createTicket(GL, config, SPRINT, { title: "Decide the store", type: "HITL", decision: true }, "b", state, gl.io);
  assert.equal(second.value.number, 13);
  assert.equal(gl.calls.length, 6, "neither the label nor the milestone is made twice");
  assert.equal(gl.sent(5).labels, "epic::02-persistence,type::HITL,decision");
});

test("a label or a milestone that already exists is not a failure", () => {
  const taken = { status: 1, stdout: '{"message":"Label already exists"}', stderr: "glab: Label already exists (HTTP 409)\n" };
  const gl = fake(taken, { status: 1, stdout: '{"message":"Title has already been taken"}', stderr: "glab: Title has already been taken (HTTP 400)\n" },
    { json: [{ id: 31, title: "02-01 event-store" }] }, { json: { iid: 12, title: "t", state: "opened", labels: [], web_url: "u" } });
  const made = createTicket(GL, readTracker(GITLAB_MD), SPRINT, AFK, "b", {}, gl.io);
  assert.equal(made.ok, true);
  assert.deepEqual(made.made, []);
});

test("a create that fails answers the failure and its hint, and nothing is thrown", () => {
  const down = fake({}, { status: 1, stderr: "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n" });
  const r = createTicket(GH, readTracker(GITHUB_MD), SPRINT, AFK, "b", {}, down.io);
  assert.equal(r.ok, false);
  assert.equal(r.error, "network");
  assert.match(r.hint, /could not reach github\.com/);
  const missing = createTicket(GH, readTracker(GITHUB_MD), SPRINT, AFK, "b", {}, fake({ status: null, code: "ENOENT" }).io);
  assert.equal(missing.error, "not-installed");
});

test("a rebuild sends the title and the body and nothing else", () => {
  const gh = fake({}, { json: { number: 42, title: "New", state: "OPEN", labels: [], url: "u" } });
  assert.equal(rebuildTicket(GH, "42", { title: "New", body: "new body" }, gh.io).ok, true);
  assert.deepEqual(gh.lines()[0], ["gh", "issue", "edit", "42", ...R, "--title", "New", "--body-file", "-"]);
  const gl = fake({ json: { iid: 12, title: "New", state: "opened", labels: [], web_url: "u" } });
  rebuildTicket(GL, "12", { title: "New", body: "new body" }, gl.io);
  assert.deepEqual(gl.sent(0), { title: "New", description: "new body" });
});

// ---- status -----------------------------------------------------------------

const ghView = (state, extra = {}) => ({ json: { number: 42, title: "t", state, labels: [], url: "u", ...extra } });
const glView = (state, labels = []) => ({ json: { iid: 12, title: "t", state, labels, web_url: "u" } });
const NO_BOARD = { ...readTracker(GITHUB_MD), board: null };

test("GitHub: done closes an open issue, anything else reopens a closed one, and agreement costs one read", () => {
  const close = fake(ghView("OPEN"), {}, ghView("CLOSED"));
  assert.deepEqual(syncStatus(GH, NO_BOARD, "42", "done", {}, close.io), []);
  assert.deepEqual(close.lines()[1], ["gh", "issue", "close", "42", ...R]);

  const reopen = fake(ghView("CLOSED"), {}, ghView("OPEN"));
  assert.deepEqual(syncStatus(GH, NO_BOARD, "42", "in-progress", {}, reopen.io), []);
  assert.deepEqual(reopen.lines()[1], ["gh", "issue", "reopen", "42", ...R]);

  const settled = fake(ghView("CLOSED"));
  assert.deepEqual(syncStatus(GH, NO_BOARD, "42", "done", {}, settled.io), []);
  assert.equal(settled.calls.length, 1);
});

test("GitHub: a cancelled issue closes as not planned, and a blocked reason is a comment", () => {
  const cancel = fake(ghView("OPEN"), { json: { number: 42 } });
  assert.deepEqual(syncStatus(GH, NO_BOARD, "42", "done", { cancelled: true }, cancel.io), []);
  assert.deepEqual(cancel.lines()[1], ["gh", "api", "-X", "PATCH", "repos/someone/thing/issues/42", ...JSON_BODY]);
  assert.deepEqual(cancel.sent(1), { state: "closed", state_reason: "not_planned" });

  const blocked = fake(ghView("OPEN"), { stdout: "https://github.com/someone/thing/issues/42#issuecomment-9\n" });
  assert.deepEqual(syncStatus(GH, NO_BOARD, "42", "blocked", { reason: "waiting on the ADR" }, blocked.io), []);
  assert.deepEqual(blocked.lines()[1], ["gh", "issue", "comment", "42", ...R, "--body-file", "-"]);
  assert.equal(blocked.calls[1].input, "Blocked: waiting on the ADR");
});

test("GitHub: with a board, the issue's own item gets the matching Status option", () => {
  const items = { repository: { issue: { projectItems: { nodes: [
    { id: "ITEM_other", project: { id: "PVT_other", number: 9, field: null } },
    { id: "ITEM_1", project: { id: "PVT_4", number: 4, field: { id: "FIELD_1", options: [{ id: "o-todo", name: "Todo" }, { id: "o-prog", name: "In Progress" }, { id: "o-done", name: "Done" }] } } },
  ] } } } };
  const gh = fake(ghView("OPEN"), { json: { data: items } }, { json: { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "ITEM_1" } } } } });
  assert.deepEqual(syncStatus(GH, readTracker(GITHUB_MD), "42", "in-progress", {}, gh.io), []);
  const query = gh.lines()[1];
  assert.deepEqual(query.slice(0, 3), ["gh", "api", "graphql"]);
  assert.ok(query.includes("owner=someone") && query.includes("repo=thing") && query.includes("num=42"));
  const mutation = gh.lines()[2];
  for (const want of ["project=PVT_4", "item=ITEM_1", "field=FIELD_1", "option=o-prog"]) assert.ok(mutation.includes(want), want);
  assert.equal(BOARD_STATUS.blocked, "Todo");

  const absent = fake(ghView("OPEN"), { json: { data: { repository: { issue: { projectItems: { nodes: [] } } } } } });
  assert.deepEqual(syncStatus(GH, readTracker(GITHUB_MD), "42", "in-progress", {}, absent.io), ["issue #42 is not on project 4; skipping board Status"]);
});

test("GitLab: the status label follows the plan and done closes, in one update", () => {
  const start = fake(glView("opened"), glView("opened", ["status::in-progress"]));
  assert.deepEqual(syncStatus(GL, readTracker(GITLAB_MD), "12", "in-progress", {}, start.io), []);
  assert.deepEqual(start.lines()[1], ["glab", "api", "-X", "PUT", "projects/77/issues/12", ...JSON_BODY]);
  assert.deepEqual(start.sent(1), { add_labels: "status::in-progress" });

  const block = fake(glView("opened", ["status::in-progress"]), glView("opened", ["status::blocked"]), { json: { id: 5 } });
  assert.deepEqual(syncStatus(GL, readTracker(GITLAB_MD), "12", "blocked", { reason: "no decision yet" }, block.io), []);
  assert.deepEqual(block.sent(1), { add_labels: "status::blocked", remove_labels: "status::in-progress" });
  assert.deepEqual(block.lines()[2], ["glab", "api", "-X", "POST", "projects/77/issues/12/notes", ...JSON_BODY]);
  assert.deepEqual(block.sent(2), { body: "Blocked: no decision yet" });

  const done = fake(glView("opened", ["status::in-progress"]), glView("closed"));
  assert.deepEqual(syncStatus(GL, readTracker(GITLAB_MD), "12", "done", {}, done.io), []);
  assert.deepEqual(done.sent(1), { remove_labels: "status::in-progress", state_event: "close" });

  const reopen = fake(glView("closed"), glView("opened"));
  syncStatus(GL, readTracker(GITLAB_MD), "12", "not-started", {}, reopen.io);
  assert.deepEqual(reopen.sent(1), { state_event: "reopen" });

  const settled = fake(glView("closed"));
  assert.deepEqual(syncStatus(GL, readTracker(GITLAB_MD), "12", "done", {}, settled.io), []);
  assert.equal(settled.calls.length, 1);
  assert.deepEqual(Object.values(STATUS_LABEL), ["status::in-progress", "status::blocked"]);
});

test("GitLab: a cancelled issue closes with a comment saying it was dropped", () => {
  const gl = fake(glView("opened"), glView("closed"), { json: { id: 6 } });
  assert.deepEqual(syncStatus(GL, readTracker(GITLAB_MD), "12", "done", { cancelled: true }, gl.io), []);
  assert.deepEqual(gl.sent(1), { state_event: "close" });
  assert.match(gl.sent(2).body, /^Cancelled:/);
});

test("a tracker that cannot be reached or changed is a warning, never a throw", () => {
  const offline = fake({ status: null, code: "ENOENT" });
  const [warning] = syncStatus(GH, NO_BOARD, "42", "done", {}, offline.io);
  assert.match(warning, /^#42 not read \(not-installed\): gh is not installed/);
  const refused = fake(glView("opened"), { status: 1, stdout: '{"message":"403 Forbidden"}', stderr: "glab: 403 Forbidden (HTTP 403)\n" });
  const [denied] = syncStatus(GL, readTracker(GITLAB_MD), "12", "done", {}, refused.io);
  assert.match(denied, /^#12 close failed \(forbidden\)/);
});

test("read-back: a ticket is done, blocked, in progress or just open, and agreement is about done", () => {
  assert.equal(trackerState(GH, "42", fake(ghView("CLOSED")).io).value.state, "done");
  assert.equal(trackerState(GH, "42", fake(ghView("OPEN")).io).value.state, "open");
  assert.equal(trackerState(GL, "12", fake(glView("opened", ["status::blocked"])).io).value.state, "blocked");
  assert.equal(trackerState(GL, "12", fake(glView("opened", ["status::in-progress", "type::AFK"])).io).value.state, "in-progress");
  assert.equal(trackerState(GL, "12", fake({ status: 1, stderr: "glab: 404 Not found (HTTP 404)\n" }).io).error, "not-found");

  assert.equal(agrees("done", "done"), true);
  assert.equal(agrees("open", "not-started"), true);
  assert.equal(agrees("open", "in-progress"), true);
  assert.equal(agrees("open", "done"), false);
  assert.equal(agrees("done", "in-progress"), false);
  assert.equal(agrees("blocked", "blocked"), true);
  assert.equal(agrees("blocked", "in-progress"), false);
});
