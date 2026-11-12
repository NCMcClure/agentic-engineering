// hooks.json and critical.json of agent-works: which script runs on which
// event, behind which guard, and the lines every session is given. A wrong
// matcher here is silent: the hook simply never runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { hookCommand } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agent-works");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN, rel), "utf8"));
const config = read("hooks/hooks.json");
const only = (event) => {
  assert.equal(config.hooks[event].length, 1, event);
  assert.equal(config.hooks[event][0].hooks.length, 1, event);
  return { matcher: config.hooks[event][0].matcher, ...config.hooks[event][0].hooks[0] };
};
const matches = (matcher, name) => new RegExp(`^(?:${matcher})$`).test(name);

test("agent-works hooks.json: the events, and nothing else", () => {
  assert.deepEqual(Object.keys(config).sort(), ["hooks", "modules"]);
  assert.deepEqual(Object.keys(config.hooks).sort(), ["PostToolUse", "PreToolUse", "SessionStart", "Stop", "SubagentStart", "SubagentStop"]);
});

test("agent-works hooks.json: the session hook runs at every start and in subagents, loud only where a person reads it", () => {
  const start = only("SessionStart");
  assert.equal(start.matcher, "startup|resume|clear|compact");
  assert.equal(start.command, hookCommand("agent-works", "hooks/session-start.mjs", { loud: true }));
  assert.ok(start.statusMessage);
  // A migration is given three seconds by the kernel, and the briefing reads the board after it.
  assert.ok(start.timeout >= 5);
  const sub = only("SubagentStart");
  assert.equal(sub.matcher, undefined);
  assert.equal(sub.command, hookCommand("agent-works", "hooks/session-start.mjs"));
});

test("agent-works hooks.json: the guard sees every shell command and every edit, before it runs", () => {
  const guard = only("PreToolUse");
  assert.equal(guard.matcher, "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit");
  assert.equal(guard.command, hookCommand("agent-works", "hooks/guard.mjs"));
  assert.equal(guard.timeout, 5);
});

test("agent-works hooks.json: card-sync hears what changes a card's state, and both kinds of stop", async () => {
  const after = only("PostToolUse");
  assert.equal(after.command, hookCommand("agent-works", "hooks/card-sync.mjs"));
  for (const tool of ["Bash", "PowerShell", "Edit", "Write", "MultiEdit", "NotebookEdit"]) assert.ok(matches(after.matcher, tool), tool);
  for (const tool of ["Read", "Grep", "mcp__agent-works__list_tasks", "mcp__other__move_task"]) assert.ok(!matches(after.matcher, tool), tool);

  // The pane's tools that change a card are the ones the hook is run for, and the ones the rules know.
  const tools = await import(pathToFileURL(path.join(PLUGIN, "hooks", "kanban", "tools.mjs")).href);
  const sync = await import(pathToFileURL(path.join(PLUGIN, "lib", "sync.mjs")).href);
  for (const name of ["move_task", "plan_task", "settle_gate"]) {
    assert.ok(name in tools.TOOLS, `the pane has no ${name}`);
    assert.ok(matches(after.matcher, tools.toolId(name)), name);
    assert.equal(sync.observe({ tool: tools.toolId(name), input: { id: "0001" } })?.kind, "board", name);
  }
  for (const name of Object.keys(tools.TOOLS)) {
    const seen = sync.observe({ tool: tools.toolId(name), input: { id: "0001", title: "t" } });
    assert.equal(matches(after.matcher, tools.toolId(name)), seen !== null, `${name}: run for it exactly when the rules read it`);
  }

  for (const event of ["Stop", "SubagentStop"]) {
    const stop = only(event);
    assert.equal(stop.matcher, undefined);
    assert.equal(stop.command, hookCommand("agent-works", "hooks/card-sync.mjs"));
  }
});

test("agent-works hooks.json: every script it names is shipped, and the pane is the one module", () => {
  for (const m of JSON.stringify(config).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) assert.ok(fs.existsSync(path.join(PLUGIN, m[1])), m[1]);
  assert.deepEqual(config.modules, ["./kanban/register.mjs"]);
  assert.ok(fs.existsSync(path.join(PLUGIN, "hooks", "kanban", "register.mjs")));
});

test("agent-works critical.json: seven lines within the cap, the hub line only where the repo is set up, and a chain to each partner", () => {
  const data = read("hooks/critical.json");
  assert.equal(data.plugin, "agent-works");
  assert.deepEqual(data.chains.map((c) => c.partner), ["perceptual-loop", "but-first-planning", "agentic-teamwork"]);
  assert.deepEqual(data.lines.map((l) => [l.for, l.mode, l.when ?? null]), [
    ["main", "any", null], ["main", "any", null], ["main", "any", null], ["main", "any", null],
    ["all", "any", null], ["all", "any", null], ["all", "any", ".agents/agent-works.json"],
  ]);
  assert.match(data.lines.at(-1).text, /^Hubs: a directory with an AGENTS\.md holds no source files, .* Run `aw hubs`/);
  const size = "Critical, from agent-works:".length + data.lines.reduce((n, l) => n + l.text.length + 3, 0);
  assert.ok(size <= 2000, `${size} characters`);
  const skills = fs.readdirSync(path.join(PLUGIN, "skills"));
  for (const line of data.lines) {
    for (const m of line.text.matchAll(/\/agent-works:([a-z-]+)/g)) {
      assert.ok(skills.includes(m[1]), m[0]);
      assert.doesNotMatch(fs.readFileSync(path.join(PLUGIN, "skills", m[1], "SKILL.md"), "utf8"), /^disable-model-invocation: true$/m, `${m[0]} is one the model can open`);
    }
    for (const m of line.text.matchAll(/`aw ([a-z]+)(?: ([a-z]+))?/g)) assert.ok(["board", "hubs"].includes(m[1]), m[0]);
  }
});
