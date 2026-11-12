// agentic-teamwork's stop-gate.mjs. What it finds is written to the agent, so
// it has to land where the host shows the model: a Stop hook's
// `additionalContext`, or `decision: "block"` with its reason. A
// `systemMessage` reaches the person only. And it must never keep a session
// from stopping: once per finding, and never on a stop it already continued.
import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOKS = path.join(REPO, "plugins", "agentic-teamwork", "hooks");
const suite = { after };
const HOME = tempDir(suite, "tw-stop-home-");
const TMP = tempDir(suite, "tw-stop-tmp-");

const MANIFEST = { standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: { unit: "npm test", e2e: "not wired: no browser yet" }, owned: {} };
const node = (code) => `"${process.execPath}" -e "${code}"`;
const PASSING = node("process.exit(0)");
const FAILING = node("console.log('1 failing: adds two numbers'); process.exit(1)");

/** A repo on a feature branch with one commit; `after` is written once the commit exists, so it is uncommitted work. */
function repo(t, { manifest = true, teamwork, choice, old, files = { "src/a.mjs": "export const a = 1;\n" }, after: later = {} } = {}) {
  const { dir, git } = tempRepo(t, "tw-stop-");
  if (manifest) write(dir, ".agents/manifest.json", JSON.stringify({ ...MANIFEST, ...(teamwork ? { teamwork } : {}) }, null, 2));
  if (old) write(dir, ".claude/teamwork.json", JSON.stringify(old, null, 2));
  if (choice) git("config", "--local", "agentic-engineering.plugins", `${choice} Test 2026-01-01T00:00Z`);
  write(dir, "README.md", "# fixture\n");
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  git("switch", "-q", "-c", "feat/topic");
  for (const [rel, content] of Object.entries(later)) write(dir, rel, content);
  return { dir, git };
}

const env = (dir) => ({ ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: dir, TMPDIR: TMP });

let sessions = 0;
/** A session id no other test uses, since the gate remembers what it told each one. */
const fresh = () => `stop-${process.pid}-${sessions += 1}`;

function gate(dir, { session = fresh(), active = false, cwd = dir } = {}) {
  const input = JSON.stringify({ hook_event_name: "Stop", session_id: session, stop_hook_active: active, cwd });
  const result = runNode(path.join(HOOKS, "stop-gate.mjs"), [], { cwd, env: env(dir), input });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

const contextOf = (out) => out?.hookSpecificOutput?.additionalContext ?? "";
const CHANGED = { "src/a.mjs": "export const a = 2;\n" };

// ---- what it says, and to whom -------------------------------------------

test("the findings go to the model as Stop additionalContext, and never as a block", (t) => {
  const out = gate(repo(t, { after: CHANGED }).dir);
  assert.equal(out.hookSpecificOutput?.hookEventName, "Stop");
  assert.match(contextOf(out), /^Before you finish:\n- 1 file\(s\) are changed and not committed: src\/a\.mjs\. Say so in your report, and commit only if the person asked for it\./);
  assert.match(contextOf(out), /\n- Source files changed and no test command ran in this session\./);
  assert.equal(out.decision, undefined);
});

test("the person gets one line naming what was sent, not the text", (t) => {
  const out = gate(repo(t, { after: { ...CHANGED, "scratch.txt": "stray\n" } }).dir);
  assert.equal(out.systemMessage, "agentic-teamwork told the agent before it stopped: uncommitted work, untracked files at the root, no test run.");
  assert.match(contextOf(out), /Untracked files at the repo root: scratch\.txt\./);
});

test("the no-test finding names the repo's lanes, wired ones only", (t) => {
  const context = contextOf(gate(repo(t, { after: CHANGED }).dir));
  assert.match(context, /Name the lane that covers the change and run it: unit `npm test`\. A lane that did not run is reported as not run\./);
  assert.doesNotMatch(context, /e2e/);
});

test("with no lanes to name, it points at the project's own test command", (t) => {
  const context = contextOf(gate(repo(t, { manifest: false, choice: "on", after: CHANGED }).dir));
  assert.match(context, /Run the project's own test command, or say that it has none\./);
});

test("a clean tree gets silence", (t) => {
  assert.equal(gate(repo(t).dir), null);
});

test("a changed file that is not source is uncommitted work, and no reason to run tests", (t) => {
  const out = gate(repo(t, { after: { "README.md": "# fixture\n\nMore.\n" } }).dir);
  assert.match(out.systemMessage, /: uncommitted work\.$/);
});

test("test.sourcePatterns decides what counts as source", (t) => {
  const teamwork = { test: { sourcePatterns: ["^docs/.*\\.md$"] } };
  assert.match(gate(repo(t, { teamwork, after: { "docs/guide.md": "# Guide\n" } }).dir).systemMessage, /no test run/);
  assert.doesNotMatch(gate(repo(t, { teamwork, after: CHANGED }).dir).systemMessage, /no test run/);
});

test("a renamed file is reported under its new name", (t) => {
  const { dir, git } = repo(t);
  git("mv", "src/a.mjs", "src/b.mjs");
  assert.match(contextOf(gate(dir)), /not committed: src\/b\.mjs\./);
});

test("before the first commit nothing is called stray", (t) => {
  const { dir } = tempRepo(t, "tw-stop-unborn-");
  write(dir, ".agents/manifest.json", JSON.stringify(MANIFEST));
  write(dir, "README.md", "# new\n");
  const out = gate(dir);
  assert.match(out.systemMessage, /uncommitted work/);
  assert.doesNotMatch(out.systemMessage, /untracked files at the root/);
});

// ---- the record of test runs ---------------------------------------------

test("a test command the guard saw in this session answers the no-test finding", (t) => {
  const { dir } = repo(t, { after: CHANGED });
  const session = fresh();
  const input = JSON.stringify({ hook_event_name: "PreToolUse", session_id: session, cwd: dir, tool_name: "Bash", tool_input: { command: "npm test" } });
  assert.equal(runNode(path.join(HOOKS, "git-guard.mjs"), [], { cwd: dir, env: env(dir), input }).status, 0);
  assert.equal(gate(dir, { session }).systemMessage, "agentic-teamwork told the agent before it stopped: uncommitted work.");
  assert.match(gate(dir).systemMessage, /no test run/, "another session ran nothing");
});

// ---- it cannot loop -------------------------------------------------------

test("a stop that a Stop hook already continued is let through", (t) => {
  assert.equal(gate(repo(t, { after: CHANGED }).dir, { active: true }), null);
});

test("a finding is said once: the next stop of the same session is silent", (t) => {
  const { dir } = repo(t, { after: CHANGED });
  const session = fresh();
  assert.ok(gate(dir, { session }));
  assert.equal(gate(dir, { session }), null);
  assert.equal(gate(dir, { session }), null);
  assert.ok(gate(dir), "another session has not heard it");
});

test("only what is new is said on a later stop", (t) => {
  const { dir } = repo(t, { after: CHANGED });
  const session = fresh();
  gate(dir, { session });
  write(dir, "scratch.txt", "stray\n");
  const out = gate(dir, { session });
  assert.equal(out.systemMessage, "agentic-teamwork told the agent before it stopped: untracked files at the root.");
  assert.doesNotMatch(contextOf(out), /not committed/);
  write(dir, "notes.txt", "another\n");
  assert.match(contextOf(gate(dir, { session })), /notes\.txt, scratch\.txt/, "a second stray file is news");
});

test("a finding that went away and came back is said again", (t) => {
  const { dir, git } = repo(t, { after: { "README.md": "# fixture\n\nMore.\n" } });
  const session = fresh();
  assert.ok(gate(dir, { session }));
  git("commit", "-q", "-am", "more");
  assert.equal(gate(dir, { session }), null, "clean");
  write(dir, "README.md", "# fixture\n\nMore still.\n");
  assert.match(gate(dir, { session }).systemMessage, /uncommitted work/);
});

test("empty and malformed stdin say nothing, since nothing says whether the stop was continued", (t) => {
  const { dir } = repo(t, { after: CHANGED });
  for (const input of ["", "{\"stop_hook_active\": fals", "null", "42"]) {
    const result = runNode(path.join(HOOKS, "stop-gate.mjs"), [], { cwd: dir, env: env(dir), input });
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout.trim(), "", input);
    assert.equal(result.stderr, "", input);
  }
});

// ---- which repos it speaks in --------------------------------------------

test("mode none: a repo nobody answered for, or answered off, gets silence", (t) => {
  assert.equal(gate(repo(t, { manifest: false, after: CHANGED }).dir), null);
  assert.equal(gate(repo(t, { manifest: false, choice: "off", after: CHANGED }).dir), null);
});

// ---- the opt-in hard gate ------------------------------------------------

test("without requireTestsPass a failing test command is never run at a stop", (t) => {
  const out = gate(repo(t, { teamwork: { test: { command: FAILING } }, after: CHANGED }).dir);
  assert.equal(out.decision, undefined);
  assert.ok(out.hookSpecificOutput);
});

test("requireTestsPass: failing tests with source changes block the stop, and the reason reaches the model", (t) => {
  const out = gate(repo(t, { teamwork: { requireTestsPass: true, test: { command: FAILING } }, after: CHANGED }).dir);
  assert.equal(out.decision, "block");
  assert.match(out.reason, /fails with uncommitted source changes in the tree \(requireTestsPass in \.agents\/manifest\.json\)/);
  assert.match(out.reason, /1 failing: adds two numbers/);
  assert.equal(out.hookSpecificOutput, undefined);
});

test("requireTestsPass: the block is not repeated on the continuation it caused", (t) => {
  const { dir } = repo(t, { teamwork: { requireTestsPass: true, test: { command: FAILING } }, after: CHANGED });
  const session = fresh();
  assert.equal(gate(dir, { session }).decision, "block");
  assert.equal(gate(dir, { session, active: true }), null);
});

test("requireTestsPass: passing tests leave the report, without the no-test finding", (t) => {
  const out = gate(repo(t, { teamwork: { requireTestsPass: true, test: { command: PASSING } }, after: CHANGED }).dir);
  assert.equal(out.decision, undefined);
  assert.equal(out.systemMessage, "agentic-teamwork told the agent before it stopped: uncommitted work.");
});

test("requireTestsPass: with no source file changed the tests are not run", (t) => {
  const teamwork = { requireTestsPass: true, test: { command: FAILING } };
  assert.equal(gate(repo(t, { teamwork }).dir), null);
  assert.equal(gate(repo(t, { teamwork, after: { "README.md": "# fixture\n\nMore.\n" } }).dir).decision, undefined);
});

test("rules.stopGate: false keeps the report and drops the block", (t) => {
  const out = gate(repo(t, { teamwork: { requireTestsPass: true, rules: { stopGate: false }, test: { command: FAILING } }, after: CHANGED }).dir);
  assert.equal(out.decision, undefined);
  assert.match(out.systemMessage, /uncommitted work, no test run/);
});

test("a repo still on the first layout keeps its hard gate at a stop", (t) => {
  const old = { version: 1, baseBranch: "main", test: { command: FAILING, dir: ".", sourcePatterns: ["^src/"] }, rules: { requireTestsPass: true, stopGate: true } };
  const out = gate(repo(t, { manifest: false, old, after: CHANGED }).dir);
  assert.equal(out.decision, "block");
  const off = gate(repo(t, { manifest: false, old: { ...old, rules: { stopGate: false } }, after: CHANGED }).dir);
  assert.equal(off.decision, undefined);
});
