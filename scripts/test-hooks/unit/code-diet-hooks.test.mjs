// code-diet's hooks: the ladder the session hook prints from critical.json, and
// the debt-marker nudge after an edit. Each runs as a host runs it, one payload
// on stdin, with the person's settings in a temp CLAUDE_CONFIG_DIR so a
// developer's own enabledPlugins never reach a test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hookCommand } from "../../lib.mjs";
import { CONFIG_KEY, SHARED_LINE } from "../../shared/critical-context.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "code-diet");
const CRITICAL = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "critical.json"), "utf8"));
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;
const LADDER = CRITICAL.lines[0].text;

/** A repo the person has answered for (`on`, `off`, `team`), or one that carries a marker, or one nobody has answered. */
function repo(t, kind) {
  const { dir, git } = tempRepo(t, `diet-${kind}-`);
  if (["on", "off", "team"].includes(kind)) git("config", "--local", CONFIG_KEY, `${kind} Test 2026-01-01T00:00Z`);
  if (kind === "manifest") write(dir, ".agents/manifest.json", "{}\n");
  if (kind === "marker") write(dir, ".agents/plan/index.md", "# Plan\n");
  return dir;
}

function hook(t, script, payload, { cwd, env = {} } = {}) {
  const config = tempDir(t, "diet-settings-");
  const out = runNode(path.join(PLUGIN, "hooks", script), [], {
    cwd: cwd ?? payload?.cwd ?? config,
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: config, USERPROFILE: config, CLAUDE_PROJECT_DIR: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ...env },
  });
  const parsed = out.stdout.trim() ? JSON.parse(out.stdout) : null;
  return { ...out, parsed, context: parsed?.hookSpecificOutput?.additionalContext ?? "" };
}

const session = (t, dir, extra = {}) => hook(t, "session-start.mjs", { hook_event_name: "SessionStart", source: "startup", session_id: "s", cwd: dir, ...extra });
const subagent = (t, dir, agentType) => hook(t, "session-start.mjs", { hook_event_name: "SubagentStart", agent_type: agentType, session_id: "s", cwd: dir });
const edit = (t, dir, toolInput, options) => hook(t, "debt-nudge.mjs", { hook_event_name: "PostToolUse", tool_name: "Write", session_id: "s", cwd: dir, tool_input: toolInput }, options);

// ---- what is registered -----------------------------------------------------

test("hooks.json registers the session hook for every session start and every subagent, and the nudge after an edit", () => {
  assert.deepEqual(Object.keys(HOOKS).sort(), ["PostToolUse", "SessionStart", "SubagentStart"]);
  const [start] = HOOKS.SessionStart;
  assert.equal(start.matcher, "startup|resume|clear|compact");
  assert.equal(start.hooks[0].command, hookCommand("code-diet", "hooks/session-start.mjs", { loud: true }));
  assert.ok(start.hooks[0].statusMessage);
  assert.equal(HOOKS.SubagentStart[0].hooks[0].command, hookCommand("code-diet", "hooks/session-start.mjs"));
  assert.equal(HOOKS.PostToolUse[0].matcher, "Edit|MultiEdit|Write");
  assert.equal(HOOKS.PostToolUse[0].hooks[0].command, hookCommand("code-diet", "hooks/debt-nudge.mjs"));
});

test("the plugin ships no Python and no shell", () => {
  const stray = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => /\.(py|sh|bash)$/.test(f));
  assert.deepEqual(stray, []);
});

// ---- the ladder line --------------------------------------------------------

test("critical.json is one ladder line for every agent in every opted-in mode, inside its budget", () => {
  assert.equal(CRITICAL.plugin, "code-diet");
  assert.deepEqual(CRITICAL.chains, []);
  assert.deepEqual(CRITICAL.lines.map((l) => [l.for, l.mode, l.when]), [["all", "any", undefined]]);
  const cap = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "plugins", "code-diet.json"), "utf8")).critical.cap;
  const printed = "Critical, from code-diet:".length + CRITICAL.lines.reduce((n, l) => n + l.text.length + 3, 0);
  assert.ok(printed <= cap, `the block prints ${printed} characters, over the ${cap} cap`);
});

test("the ladder line carries all seven rungs in order, the carve-outs, the root-cause rule, and the debt grammar", () => {
  const rungs = ["YAGNI", "reuse what the repo already has", "stdlib", "the platform", "an installed dependency", "one line", "the minimum that works"];
  const at = rungs.map((r) => LADDER.indexOf(r));
  assert.ok(at.every((i) => i !== -1), `a rung is missing: ${rungs.filter((_, i) => at[i] === -1).join(", ")}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "the rungs are out of order");
  for (const phrase of ["trust-boundary validation", "data-loss handling", "security", "accessibility", "root cause", "`debt: <ceiling>, <upgrade trigger>`", "/code-diet:reuse-first"]) {
    assert.ok(LADDER.includes(phrase), `the ladder does not say: ${phrase}`);
  }
});

test("every skill the ladder and the skills name is one the plugin ships", () => {
  const shipped = fs.readdirSync(path.join(PLUGIN, "skills"));
  assert.deepEqual(shipped.sort(), ["capture-reusable", "debt", "ladder", "reuse-first", "review-diet"]);
  const texts = [LADDER, ...shipped.map((s) => fs.readFileSync(path.join(PLUGIN, "skills", s, "SKILL.md"), "utf8"))];
  for (const text of texts) for (const m of text.matchAll(/\/code-diet:([a-z-]+)/g)) assert.ok(shipped.includes(m[1]), `/code-diet:${m[1]} is not a skill`);
});

test("every script a skill runs exists in the plugin", () => {
  for (const skill of fs.readdirSync(path.join(PLUGIN, "skills"))) {
    const text = fs.readFileSync(path.join(PLUGIN, "skills", skill, "SKILL.md"), "utf8");
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+\.m?js)/g)) assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), `${skill} names ${m[1]}, which is not in the plugin`);
  }
});

// ---- session-start.mjs ------------------------------------------------------

test("a repo the person opted in gets the ladder at session start", (t) => {
  const out = session(t, repo(t, "on"));
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.equal(out.context, `Critical, from code-diet:\n- ${SHARED_LINE}\n- ${LADDER}`);
});

test("a repo with the team marker, or any plugin's own marker, gets the same ladder", (t) => {
  for (const kind of ["manifest", "team", "marker"]) assert.ok(session(t, repo(t, kind)).context.includes(LADDER), kind);
});

test("the ladder comes back after a compaction, a /clear, and a resume", (t) => {
  const dir = repo(t, "on");
  for (const source of ["compact", "clear", "resume"]) assert.ok(session(t, dir, { source }).context.includes(LADDER), source);
});

test("a repo the person answered off for gets nothing at all", (t) => {
  const out = session(t, repo(t, "off"));
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
  assert.equal(out.stderr, "");
});

test("a repo nobody has answered for is asked once, and gets no ladder until it is", (t) => {
  const out = session(t, repo(t, "unanswered"));
  assert.ok(!out.context.includes("Ladder:"), "the ladder went to a repo that has not opted in");
  assert.match(out.context, /ask the person once/);
  assert.ok(!out.context.includes("team conventions"), "the team conventions are offered without the plugin that sets them up");
});

test("a subagent that writes code gets the ladder; a read-only agent type gets nothing", (t) => {
  const dir = repo(t, "on");
  const builder = subagent(t, dir, "general-purpose");
  assert.equal(builder.parsed.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.ok(builder.context.includes(LADDER));
  for (const type of ["Explore", "Plan", "claude-code-guide"]) {
    const out = subagent(t, dir, type);
    assert.equal(out.stdout, "", `${type} was given the build rules`);
    assert.equal(out.status, 0);
  }
});

test("a subagent in a repo that has not opted in gets nothing, not even the question", (t) => {
  for (const kind of ["off", "unanswered"]) assert.equal(subagent(t, repo(t, kind), "general-purpose").stdout, "", kind);
});

test("the session hook moves nothing and writes nothing in the repo", (t) => {
  const dir = repo(t, "on");
  write(dir, "src/app.py", "x = 1  # debt: no cache\n");
  const before = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith(".git")).sort();
  const out = session(t, dir);
  assert.ok(!out.parsed.systemMessage, "nothing to tell the person");
  assert.deepEqual(fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith(".git")).sort(), before);
});

test("the session hook fails open on empty and malformed stdin", (t) => {
  const dir = repo(t, "off");
  for (const input of ["", "{not json", "null", "[]"]) {
    const out = hook(t, "session-start.mjs", input, { cwd: dir });
    assert.equal(out.status, 0, `exit ${out.status} on ${JSON.stringify(input)}`);
    assert.equal(out.stderr, "");
  }
});

// ---- debt-nudge.mjs ---------------------------------------------------------

const NUDGE = (ceilings) => `code-diet: debt marker(s) with no upgrade trigger: ${ceilings}. The grammar is \`debt: <ceiling>, <trigger>\`; name the observable condition that should make someone upgrade past the ceiling, or the shortcut rots into permanent.`;

test("a Write that leaves a marker with no trigger gets one nudge, to the model, naming the ceilings", (t) => {
  const out = edit(t, repo(t, "on"), { file_path: "src/app.py", content: "# debt: global lock\nx = 1\n// debt: a, b\n<!-- debt: no search -->\n" });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.parsed, { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: NUDGE("global lock; no search") } });
});

test("an Edit's new string and every edit of a MultiEdit are read, and at most three ceilings are named", (t) => {
  const dir = repo(t, "on");
  assert.equal(edit(t, dir, { file_path: "a.py", old_string: "x", new_string: "x  # debt: polling" }).context, NUDGE("polling"));
  const many = edit(t, dir, { file_path: "a.py", edits: [{ old_string: "a", new_string: "# debt: one\n# debt: two" }, { old_string: "b", new_string: "# debt: three\n# debt: four" }] });
  assert.equal(many.context, NUDGE("one; two; three"));
});

test("a marker with its trigger, a marker with no ceiling, and text with no marker are all left alone", (t) => {
  const dir = repo(t, "on");
  for (const content of ["# debt: global lock, per-account locks if throughput matters\n", "# debt:\n", "the technical debt: it grows\n", "x = 1\n", ""]) {
    const out = edit(t, dir, { file_path: "a.py", content });
    assert.equal(out.stdout, "", `nudged on ${JSON.stringify(content)}`);
    assert.equal(out.status, 0);
  }
});

test("the nudge never blocks: no decision, no exit code, nothing for the person", (t) => {
  const out = edit(t, repo(t, "on"), { file_path: "a.py", content: "# debt: global lock\n" });
  assert.equal(out.status, 0);
  assert.deepEqual(Object.keys(out.parsed), ["hookSpecificOutput"]);
  assert.deepEqual(Object.keys(out.parsed.hookSpecificOutput).sort(), ["additionalContext", "hookEventName"]);
});

test("the nudge speaks wherever the repo has opted in, and nowhere else", (t) => {
  const input = { file_path: "a.py", content: "# debt: global lock\n" };
  for (const kind of ["on", "team", "manifest", "marker"]) assert.equal(edit(t, repo(t, kind), input).context, NUDGE("global lock"), kind);
  for (const kind of ["off", "unanswered"]) {
    const out = edit(t, repo(t, kind), input);
    assert.equal(out.stdout, "", kind);
    assert.equal(out.stderr, "", kind);
  }
});

test("the repo judged is the one the payload's cwd is in, not the project dir", (t) => {
  const on = repo(t, "on"), off = repo(t, "off");
  const input = { file_path: "a.py", content: "# debt: global lock\n" };
  assert.equal(edit(t, on, input, { env: { CLAUDE_PROJECT_DIR: off } }).context, NUDGE("global lock"));
  assert.equal(edit(t, off, input, { env: { CLAUDE_PROJECT_DIR: on } }).stdout, "");
});

test("the nudge fails open: empty stdin, malformed JSON, and a payload of the wrong shape say nothing", (t) => {
  const dir = repo(t, "on");
  for (const input of ["", "{not json", "null", "[]", JSON.stringify({ cwd: dir }), JSON.stringify({ cwd: dir, tool_input: "debt: x" }), JSON.stringify({ cwd: dir, tool_input: { content: 7, edits: "# debt: x" } })]) {
    const out = hook(t, "debt-nudge.mjs", input, { cwd: dir });
    assert.equal(out.status, 0, `exit ${out.status} on ${input}`);
    assert.equal(out.stdout, "", `output on ${input}`);
    assert.equal(out.stderr, "", `stderr on ${input}`);
  }
});

test("outside any git repo the nudge is silent", (t) => {
  const dir = tempDir(t, "diet-nogit-");
  assert.equal(edit(t, dir, { file_path: "a.py", content: "# debt: global lock\n" }).stdout, "");
});
