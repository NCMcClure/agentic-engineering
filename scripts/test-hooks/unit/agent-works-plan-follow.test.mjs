// The plan-follow hook: after a plan is approved in plan mode, it holds Agent
// calls that name a unit to the plan's model and order, logs starts and
// returns, holds a child session to its card's pin, and asks once at a stop
// when nothing started. Run the way a host runs it: one payload on stdin,
// against a temp repo seeded with an approved plan from the real modules. The
// payloads are the shapes recorded from Claude Code 2.1.326. The rules are in
// agent-works-planmode.test.mjs; this is the wiring.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempRepo, write } from "./helpers.mjs";

const O = path.join(REPO, "plugins", "agentcraft", "skills", "agent-works");
const HOOK = path.join(O, "hooks", "plan-follow.mjs");
const load = (...rel) => import(pathToFileURL(path.join(O, ...rel)).href);
const { parseOrchestration, stateOf } = await load("lib", "planmode.mjs");
const { locate, planStateDir, readPlanState, writePlanState } = await load("scripts", "io.mjs");
const RECORDED = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "test-hooks", "cases", "agent-works", "plan-mode", "payloads.json"), "utf8")).payloads;

const PLAN = [
  "# Plan", "", "## Orchestration", "",
  "| Unit | What | Runs as | After | Files | Model | Why this model |",
  "|---|---|---|---|---|---|---|",
  "| U1 | Rules | subagent | - | `lib/a.mjs` | opus | edge cases |",
  "| U2 | Wiring | subagent | U1 | `hooks/b.mjs` | sonnet | known pattern |",
  "",
].join("\n");

const iso = (ms) => new Date(ms).toISOString();

function repo(t, { plan = true, at = iso(Date.now() - 60 * 1000) } = {}) {
  const r = tempRepo(t, "plan-follow-");
  write(r.dir, "README.md", "fixture\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "fixture");
  if (plan) writePlanState(locate(r.dir), stateOf(parseOrchestration(PLAN), { planFile: "/plans/p.md", at }));
  return r.dir;
}

function hook(dir, payload) {
  const out = runNode(HOOK, [], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: typeof payload === "string" ? payload : JSON.stringify(payload) });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim() ? JSON.parse(out.stdout) : null;
}

/** A recorded payload with the placeholders filled and fields overridden. */
// Filled value by value, never in the JSON text: a Windows path's backslashes would not survive that.
const fill = (v, dir) => (typeof v === "string" ? v.replaceAll("{{REPO}}", dir).replaceAll("{{PATH}}", dir).replaceAll("{{PLANS}}", dir)
  : Array.isArray(v) ? v.map((x) => fill(x, dir))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, dir)])) : v);
const recorded = (key, dir, over = {}) => ({ ...fill(RECORDED[key], dir), ...over });
const agent = (dir, unit, model, extra = {}) => recorded("PreToolUse.Agent", dir, { tool_input: { description: `${unit} do it`, prompt: "do it", subagent_type: "general-purpose", ...(model ? { model } : {}) }, ...extra });
const launched = (dir, unit, id = "agent-1") => {
  const p = recorded("PostToolUse.Agent.background", dir);
  p.tool_input = { ...p.tool_input, description: `${unit} do it` };
  p.tool_response = { ...p.tool_response, agentId: id };
  return p;
};
const foreground = (dir, unit) => ({ ...launched(dir, unit), tool_response: { status: "completed", content: [] } });
const subagentStop = (dir, id) => recorded("SubagentStop", dir, { agent_id: id });
const stop = (dir, extra = {}) => recorded("Stop", dir, extra);
const denial = (out) => out?.hookSpecificOutput?.permissionDecisionReason;
const log = (dir) => {
  try { return fs.readFileSync(path.join(planStateDir(locate(dir)), "plan.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
};

test("no approved plan is silence for every event, and nothing is logged", (t) => {
  const dir = repo(t, { plan: false });
  for (const p of [agent(dir, "U1", "haiku"), launched(dir, "U1"), foreground(dir, "U1"), subagentStop(dir, "agent-1"), stop(dir)]) {
    assert.equal(hook(dir, p), null, `${p.hook_event_name} ${p.tool_name ?? ""}`);
  }
  assert.deepEqual(log(dir), []);
});

test("an unnamed Agent call passes with a plan in force", (t) => {
  const dir = repo(t);
  const p = agent(dir, "U1", "haiku");
  p.tool_input.description = "Explore the repo";
  assert.equal(hook(dir, p), null);
  assert.deepEqual(log(dir), []);
});

test("a unit on the wrong model is denied, naming the right one", (t) => {
  const dir = repo(t);
  const out = hook(dir, agent(dir, "U1", "sonnet"));
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(denial(out), /U1 runs on opus.*model: "opus"/);
  assert.deepEqual(log(dir), []);
  assert.match(denial(hook(dir, agent(dir, "U1", undefined))), /model: "opus"/, "no model at all is the wrong model");
});

test("a unit on the plan's model passes and is logged as started; Task is Agent", (t) => {
  const dir = repo(t);
  assert.equal(hook(dir, agent(dir, "U1", "opus")), null);
  assert.equal(hook(dir, { ...agent(dir, "U1", "opus"), tool_name: "Task" }), null);
  assert.deepEqual(log(dir).map((e) => [e.t, e.unit]), [["start", "U1"], ["start", "U1"]]);
});

test("a unit waits for the units it follows, and passes once they have returned", (t) => {
  const dir = repo(t);
  assert.match(denial(hook(dir, agent(dir, "U2", "sonnet"))), /U2 waits on U1/);
  hook(dir, foreground(dir, "U1"));
  assert.equal(hook(dir, agent(dir, "U2", "sonnet")), null);
  assert.ok(log(dir).some((e) => e.t === "start" && e.unit === "U2"));
});

test("a background launch is not a return; the SubagentStop for its agent id is", (t) => {
  const dir = repo(t);
  assert.equal(hook(dir, launched(dir, "U1", "a52978c4b6c81fd9c")), null);
  assert.deepEqual(log(dir).map((e) => [e.t, e.unit, e.agent]), [["agent", "U1", "a52978c4b6c81fd9c"]]);
  assert.match(denial(hook(dir, agent(dir, "U2", "sonnet"))), /waits on U1/, "launched only, so U2 still waits");
  assert.equal(hook(dir, subagentStop(dir, "someone-else")), null);
  assert.equal(log(dir).some((e) => e.t === "returned"), false, "another agent's stop marks nothing");
  assert.equal(hook(dir, subagentStop(dir, "a52978c4b6c81fd9c")), null, "SubagentStop never speaks");
  assert.deepEqual(log(dir).filter((e) => e.t === "returned").map((e) => e.unit), ["U1"]);
  hook(dir, subagentStop(dir, "a52978c4b6c81fd9c"));
  assert.equal(log(dir).filter((e) => e.t === "returned").length, 1, "a second stop adds nothing");
  assert.equal(hook(dir, agent(dir, "U2", "sonnet")), null);
});

test("a foreground PostToolUse marks the unit returned at once", (t) => {
  const dir = repo(t);
  assert.equal(hook(dir, foreground(dir, "U1")), null);
  assert.deepEqual(log(dir).map((e) => [e.t, e.unit]), [["returned", "U1"]]);
});

test("a subagent's own Agent call is not gated", (t) => {
  const dir = repo(t);
  const p = agent(dir, "U1", "haiku", { agent_id: "a52978c4b6c81fd9c", agent_type: "general-purpose" });
  assert.equal(hook(dir, p), null);
  assert.equal(hook(dir, { ...launched(dir, "U1"), agent_id: "a52978c4b6c81fd9c" }), null);
  assert.deepEqual(log(dir), []);
});

// ---- start_session ----------------------------------------------------------

const CREATED = iso(Date.now() - 2 * 60 * 60 * 1000);
function card(dir, id, title, fields = "", created = CREATED) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  write(path.join(dir, ".agents", "kanban"), `${id}-${slug}.md`, `---\nid: ${id}\ntitle: ${title}\n${fields}created: ${created}\nupdated: ${created}\n---\n\n## Done when\n- it works\n`);
}
const session = (dir, name, model) => ({ hook_event_name: "PreToolUse", session_id: "s", cwd: dir, tool_name: "mcp__ccd_session__start_session", tool_input: { name, ...(model ? { model } : {}) } });

test("start_session: a card on a model outside its pin, or with an unfinished after card, is denied; a clean one passes", (t) => {
  const dir = repo(t, { plan: false });
  card(dir, "0001", "First", "status: backlog\norder: 1\nmodel: opus\n");
  card(dir, "0002", "Second", "status: backlog\norder: 2\nafter: 0001\n");
  card(dir, "0003", "Third", "status: backlog\norder: 3\n");
  const wrong = hook(dir, session(dir, "card-0001", "claude-sonnet-5-5"));
  assert.equal(wrong.hookSpecificOutput.permissionDecision, "deny");
  assert.match(denial(wrong), /Card 0001 is pinned to opus.*model "opus"/);
  assert.equal(hook(dir, session(dir, "card-0001", "claude-opus-4-8")), null);
  assert.match(denial(hook(dir, session(dir, "card-0002", "opus"))), /Card 0002 waits on 0001/);
  assert.equal(hook(dir, session(dir, "card-0003", "sonnet")), null, "no pin, nothing waiting");
  assert.equal(hook(dir, session(dir, "card-3", "sonnet")), null, "an id written short is the same card");
  assert.match(denial(hook(dir, session(dir, "card-2", "opus"))), /Card 0002 waits on 0001/);
  assert.equal(hook(dir, session(dir, "card-01-01-01", "sonnet")), null, "a plan issue's coordinates are never read as card 0001");
  assert.equal(hook(dir, session(dir, "card-0009", "sonnet")), null, "no such card");
  assert.equal(hook(dir, session(dir, "refactor the thing", "sonnet")), null, "not a card name");
});

test("start_session: no board folder is silence", (t) => {
  const dir = repo(t, { plan: false });
  assert.equal(hook(dir, session(dir, "card-0001", "sonnet")), null);
});

// ---- Stop -------------------------------------------------------------------

test("a stop with nothing started and no card filed is held once", (t) => {
  const dir = repo(t);
  const held = hook(dir, stop(dir));
  assert.equal(held.decision, "block");
  assert.match(held.reason, /orchestration has not started: wave 1 is U1; wave 2 is U2/);
  assert.equal(hook(dir, stop(dir)), null, "once per approved plan");
  assert.equal(log(dir).filter((e) => e.t === "asked").length, 1);
});

test("a stop is not held on its own continuation, after a unit started, or after a card was filed", (t) => {
  let dir = repo(t);
  assert.equal(hook(dir, stop(dir, { stop_hook_active: true })), null);
  assert.equal(log(dir).some((e) => e.t === "asked"), false, "and the hold is not spent");
  hook(dir, agent(dir, "U1", "opus"));
  assert.equal(hook(dir, stop(dir)), null);
  dir = repo(t);
  card(dir, "0001", "Filed after", "status: backlog\norder: 1\n", iso(Date.now()));
  assert.equal(hook(dir, stop(dir)), null);
  dir = repo(t);
  card(dir, "0001", "Filed before", "status: backlog\norder: 1\n");
  assert.equal(hook(dir, stop(dir)).decision, "block", "a card older than the approval is not a response to it");
});

test("a subagent's stop never holds", (t) => {
  const dir = repo(t);
  assert.equal(hook(dir, stop(dir, { agent_id: "x" })), null);
});

// ---- input ------------------------------------------------------------------

test("empty and malformed stdin exit 0 with no output", (t) => {
  const dir = repo(t);
  for (const input of ["", "   ", "{\"hook_event_name\":", "null", "[]", "42", "﻿"]) assert.equal(hook(dir, input), null, JSON.stringify(input));
});

test("an event it does not handle, or outside a repo, is silence", (t) => {
  const dir = repo(t);
  assert.equal(hook(dir, { hook_event_name: "PostToolUse", tool_name: "Bash", cwd: dir, tool_input: {}, tool_response: {} }), null);
  assert.equal(hook(dir, { hook_event_name: "SessionStart", cwd: dir }), null);
  const out = runNode(HOOK, [], { cwd: path.dirname(dir), env: { ...process.env, CLAUDE_PROJECT_DIR: "" }, input: JSON.stringify({ hook_event_name: "Stop", cwd: "/nonexistent-dir-for-test" }) });
  assert.deepEqual([out.status, out.stdout], [0, ""]);
});

test("the state the test seeds is what the hook reads", (t) => {
  const dir = repo(t);
  assert.deepEqual(readPlanState(locate(dir)).state.waves, [["U1"], ["U2"]]);
});

test("the hook never names a plugin root variable", (t) => {
  assert.doesNotMatch(fs.readFileSync(HOOK, "utf8"), /PLUGIN_ROOT/);
});
