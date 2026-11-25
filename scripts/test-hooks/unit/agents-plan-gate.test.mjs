// The plan-gate hook, run the way a host runs it: one payload on stdin, a temp
// repo that is on the plugin (or one that is not), and the per-session file in
// a temp dir of the test's own. Payloads are the shapes Claude Code 2.1.326
// recorded, so the hook is read against what a host sends. The rules are
// covered in agent-works-planmode.test.mjs; this is the wiring.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { instructions, pointer } from "../../../plugins/agentic-engineering/skills/agents/lib/planmode.mjs";
import { locate, planStateDir, readPlanState } from "../../../plugins/agentic-engineering/skills/agents/scripts/io.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOK = path.join(REPO, "plugins", "agentic-engineering", "skills", "agents", "hooks", "plan-gate.mjs");
const AW = path.join(REPO, "plugins", "agentic-engineering", "skills", "agents", "scripts", "aw.mjs");
const RECORDED = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "test-hooks", "cases", "agents", "plan-mode", "payloads.json"), "utf8")).payloads;

const TABLE = [
  "# Plan",
  "",
  "## Orchestration",
  "",
  "| Unit | What | Runs as | After | Files | Model | Why this model |",
  "|---|---|---|---|---|---|---|",
  "| U1 | Parser | subagent | - | `lib/a.mjs` | opus | edge cases |",
  "| U2 | Wiring | subagent | U1 | `hooks/b.mjs` | sonnet | known pattern |",
  "",
].join("\n");
const OPT_OUT = "# Plan\n\nOrchestration: none, one function in one file\n";
const BARE = "# Plan\n\n1. Do the thing.\n";

function fixture(t) {
  const repo = tempRepo(t, "plan-gate-");
  // Answered, so what the hook says does not depend on the machine's own settings.
  repo.git("config", "--local", "agentic-engineering.plugins", "on Test 2026-01-01T00:00Z");
  write(repo.dir, "README.md", "fixture\n");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "fixture");
  return { ...repo, tmp: tempDir(t, "plan-gate-tmp-"), plans: tempDir(t, "plan-gate-plans-") };
}
const envOf = (project, tmp) => ({ ...process.env, CLAUDE_PROJECT_DIR: project, TMPDIR: tmp });
const SAID = "agent-works-planmode-s1.json";

/** A recorded payload with its placeholders filled in and `extra` laid over it. */
function payload(r, key, extra = {}) {
  const fill = (v) => (typeof v === "string" ? v.replaceAll("{{REPO}}", r.dir).replaceAll("{{PLANS}}", r.plans).replaceAll("{{PATH}}", path.join(r.dir, "t.jsonl"))
    : Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
  const base = fill(RECORDED[key]);
  return { ...base, ...extra, session_id: extra.session_id ?? "s1" };
}

/** Run the hook as a host does; null for no output. */
function hook(r, input, { cwd = r.dir, raw } = {}) {
  const out = runNode(HOOK, [], { cwd, env: envOf(r.dir, r.tmp), input: raw ?? JSON.stringify(input) });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim() ? JSON.parse(out.stdout) : null;
}
const context = (out) => out?.hookSpecificOutput?.additionalContext;
const exit = (r, plan, extra = {}) => payload(r, "PreToolUse.ExitPlanMode", { tool_input: { plan, planFilePath: path.join(r.plans, "p.md") }, ...extra });
const approve = (r, plan, extra = {}) => payload(r, "PostToolUse.ExitPlanMode", { tool_response: { plan, isAgent: false, filePath: path.join(r.plans, "p.md") }, ...extra });

test("the first plan-mode prompt gets the instructions, the next the pointer", (t) => {
  const r = fixture(t);
  const first = hook(r, payload(r, "UserPromptSubmit.plan"));
  assert.equal(first.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.equal(context(first), instructions());
  assert.equal(context(hook(r, payload(r, "UserPromptSubmit.plan"))), pointer());
  assert.ok(fs.readdirSync(r.tmp).includes(SAID), "what was said lives in the temp dir");
});

test("the full instructions come back after an hour, and another session starts fresh", (t) => {
  const r = fixture(t);
  hook(r, payload(r, "UserPromptSubmit.plan"));
  const file = path.join(r.tmp, SAID);
  const said = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, JSON.stringify({ ...said, told: Date.now() - 61 * 60 * 1000 }));
  assert.equal(context(hook(r, payload(r, "UserPromptSubmit.plan"))), instructions());
  assert.equal(context(hook(r, payload(r, "UserPromptSubmit.plan", { session_id: "other" }))), instructions());
});

test("a prompt outside plan mode is silent and spawns nothing", (t) => {
  const r = fixture(t);
  assert.equal(hook(r, payload(r, "UserPromptSubmit.plan", { permission_mode: "default" })), null);
  assert.deepEqual(fs.readdirSync(r.tmp), []);
});

test("a repo the plugin is not on, and a subagent, hear nothing", (t) => {
  const off = tempRepo(t, "plan-gate-off-");
  write(off.dir, "README.md", "x\n");
  off.git("add", "-A");
  off.git("commit", "-q", "-m", "x");
  const r = { ...fixture(t), dir: off.dir };
  const tmp = tempDir(t, "plan-gate-off-tmp-");
  const run = (input) => runNode(HOOK, [], { cwd: off.dir, env: envOf(off.dir, tmp), input: JSON.stringify(input) });
  for (const input of [payload(r, "UserPromptSubmit.plan"), exit(r, BARE), approve(r, TABLE)]) {
    const quiet = run(input);
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout.trim(), "", `${input.hook_event_name}: the plugins are off here`);
  }
  assert.deepEqual(fs.readdirSync(tmp), [], "and nothing is noted");
  assert.equal(readPlanState(locate(off.dir)), null, "and no plan is kept");
  const on = fixture(t);
  assert.equal(hook(on, payload(on, "UserPromptSubmit.plan", { agent_id: "agent-1" })), null, "a subagent");
  assert.equal(hook(on, exit(on, BARE, { agent_id: "agent-1" })), null);
});

test("the model entering plan mode itself gets the instructions", (t) => {
  const r = fixture(t);
  const out = hook(r, payload(r, "PostToolUse.EnterPlanMode"));
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(context(out), instructions());
  assert.equal(hook(r, payload(r, "PreToolUse.EnterPlanMode")), null, "only the call that happened is told");
});

test("a plan-file write without the section is pointed once per file, with no decision", (t) => {
  const r = fixture(t);
  const write1 = payload(r, "PreToolUse.Write.plan-file");
  const out = hook(r, write1);
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(context(out), pointer());
  assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(hook(r, write1), null, "the same file is not pointed twice");
  const other = payload(r, "PreToolUse.Write.plan-file");
  other.tool_input.file_path = path.join(r.plans, "another.md");
  assert.equal(context(hook(r, other)), pointer(), "another file is");
});

test("a write that carries the section, or the opt-out, is silent; outside plan mode too", (t) => {
  const r = fixture(t);
  const w = (content, extra) => { const p = payload(r, "PreToolUse.Write.plan-file", extra); p.tool_input.content = content; return p; };
  assert.equal(hook(r, w(TABLE)), null);
  assert.equal(hook(r, w(OPT_OUT)), null);
  assert.equal(hook(r, w(BARE, { permission_mode: "default" })), null);
});

test("an Edit reads the file on disk and the new string", (t) => {
  const r = fixture(t);
  const planFile = write(r.plans, "e.md", BARE);
  const edit = (newString) => ({ ...payload(r, "PreToolUse.Write.plan-file"), tool_name: "Edit", tool_input: { file_path: planFile, old_string: "x", new_string: newString } });
  assert.equal(hook(r, edit("## Orchestration\n\n| Unit |")), null, "the edit brings the heading");
  const onDisk = write(r.plans, "d.md", TABLE);
  assert.equal(hook(r, { ...edit("tweak"), tool_input: { file_path: onDisk, old_string: "x", new_string: "tweak" } }), null, "the file already has it");
  assert.equal(context(hook(r, edit("tweak"))), pointer(), "neither does");
  const multi = { ...payload(r, "PreToolUse.Write.plan-file"), tool_name: "MultiEdit", tool_input: { file_path: write(r.plans, "m.md", BARE), edits: [{ old_string: "a", new_string: "Orchestration: none, tiny" }] } };
  assert.equal(hook(r, multi), null);
});

test("ExitPlanMode with no orchestration is denied with the findings and the format", (t) => {
  const r = fixture(t);
  const out = hook(r, exit(r, BARE));
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  const why = out.hookSpecificOutput.permissionDecisionReason;
  assert.match(why, /has no `## Orchestration` section/);
  assert.ok(why.includes(instructions()), "the format rides along");
});

test("a clean plan prints nothing at all, so the approval dialog is the person's", (t) => {
  const r = fixture(t);
  const out = runNode(HOOK, [], { cwd: r.dir, env: envOf(r.dir, r.tmp), input: JSON.stringify(exit(r, TABLE)) });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
  assert.equal(hook(r, exit(r, OPT_OUT)), null, "the opt-out line passes");
});

test("the plan is read from planFilePath when the payload carries no text", (t) => {
  const r = fixture(t);
  const planFile = write(r.plans, "disk.md", BARE);
  const p = payload(r, "PreToolUse.ExitPlanMode");
  p.tool_input = { planFilePath: planFile };
  assert.equal(hook(r, p).hookSpecificOutput.permissionDecision, "deny");
  const none = payload(r, "PreToolUse.ExitPlanMode");
  none.tool_input = {};
  assert.equal(hook(r, none), null, "no plan text at all");
});

test("a plan file is denied twice and let through the third time", (t) => {
  const r = fixture(t);
  assert.equal(hook(r, exit(r, BARE)).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(hook(r, exit(r, BARE)).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(hook(r, exit(r, BARE)), null, "never trapped");
  const other = exit(r, BARE);
  other.tool_input.planFilePath = path.join(r.plans, "second.md");
  assert.equal(hook(r, other).hookSpecificOutput.permissionDecision, "deny", "the count is per file");
});

test("an approval writes the state under the git dir and hands off the waves", (t) => {
  const r = fixture(t);
  const out = hook(r, approve(r, TABLE));
  assert.equal(out.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(context(out), /^The plan is approved/);
  assert.match(context(out), /- Wave 1: U1 \(subagent, opus\)\n- Wave 2: U2 \(subagent, sonnet\)/);
  const loc = locate(r.dir);
  assert.ok(fs.existsSync(path.join(planStateDir(loc), "plan.json")));
  const { state, events } = readPlanState(loc);
  assert.deepEqual(state.waves, [["U1"], ["U2"]]);
  assert.equal(state.planFile, path.join(r.plans, "p.md"));
  assert.deepEqual(events, []);
});

test("a plan with a session unit is handed the board's own command, the route that starts a card, and neither forge's noun alone", (t) => {
  const r = fixture(t);
  const withSession = `${TABLE.trimEnd()}\n| U3 | API | session | U1 | \`src/api/\` | opus | its own request |\n\nApproval: approving this plan approves starting U3.\n`;
  assert.equal(hook(r, exit(r, withSession)), null, "the gate takes it");
  const text = context(hook(r, approve(r, withSession)));
  assert.ok(text.includes(`node "${AW}" board epic "<plan title>"`), "the launcher, by its absolute path");
  assert.match(text, /\/agentic-engineering:agents dispatch/);
  assert.doesNotMatch(text, /PLUGIN_ROOT/);
  assert.match(hook(r, exit(r, withSession.replace(/\nApproval:.*\n/, "\n"), { session_id: "s2" })).hookSpecificOutput.permissionDecisionReason, /opens its pull or merge request without asking/);
});

test("approving an opt-out plan drops an earlier state and says nothing", (t) => {
  const r = fixture(t);
  hook(r, approve(r, TABLE));
  const loc = locate(r.dir);
  assert.ok(readPlanState(loc));
  assert.equal(hook(r, approve(r, OPT_OUT)), null);
  assert.equal(readPlanState(loc), null);
  assert.equal(hook(r, approve(r, BARE)), null, "no section drops it too");
});

test("an approval reads the plan from the file when the response carries none", (t) => {
  const r = fixture(t);
  const planFile = write(r.plans, "p.md", TABLE);
  const p = payload(r, "PostToolUse.ExitPlanMode");
  p.tool_response = { isAgent: false, filePath: planFile };
  assert.match(context(hook(r, p)), /Wave 1/);
});

test("an approval outside a git repo is silent", (t) => {
  const r = fixture(t);
  const loose = tempDir(t, "plan-gate-loose-");
  const p = approve(r, TABLE, { cwd: loose });
  // A folder outside any repo counts only where the person said to use the plugins there, so the session's project stays the repo.
  const out = runNode(HOOK, [], { cwd: loose, env: envOf(r.dir, r.tmp), input: JSON.stringify(p) });
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), "");
});

test("empty and malformed stdin exit 0 with no output", (t) => {
  const r = fixture(t);
  for (const raw of ["", "   ", "{\"hook_event_name\": \"PreToolUse\",", "null", "[]", "\"x\""]) {
    assert.equal(hook(r, null, { raw }), null, JSON.stringify(raw));
  }
  assert.equal(hook(r, { hook_event_name: "Stop", session_id: "s1" }), null, "an event it does not handle");
});
