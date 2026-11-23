// agent-works in the plugin's hooks.json, and its critical.json: which of its
// scripts runs on which event, behind which guard, and the lines every session
// is given. A wrong matcher here is silent: the hook simply never runs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { hookCommand } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-engineering", "skills", "agent-works");
const ROOT = path.join(REPO, "plugins", "agentic-engineering");
const read = (rel) => JSON.parse(fs.readFileSync(path.join(PLUGIN, rel), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8"));
const DOOR = read("door.json");
/** This area's hooks on an event: the groups of the plugin's map that run a file of its hooks/ folder. */
const mine = (event) => (config.hooks[event] ?? []).filter((g) => g.hooks.some((h) => String(h.command).includes("/skills/agent-works/hooks/")));
const own = (script) => hookCommand("agentic-engineering", `skills/agent-works/hooks/${script}`);
/** The one group on an event that runs this script of the area's. */
const only = (event, script) => {
  const groups = mine(event).filter((g) => g.hooks.some((h) => h.command === own(script)));
  assert.equal(groups.length, 1, `${script} on ${event}`);
  assert.equal(groups[0].hooks.length, 1, `${script} on ${event}`);
  return { matcher: groups[0].matcher, ...groups[0].hooks[0] };
};
/** The area's scripts an event runs, in the map's order. */
const scripts = (event) => mine(event).flatMap((g) => g.hooks.map((h) => /\/hooks\/([\w-]+\.mjs)"$/.exec(h.command)?.[1]));
const matches = (matcher, name) => new RegExp(`^(?:${matcher})$`).test(name);
// A mod's tool as the host names it: by the plugin that loads the mod.
const hostId = (name) => `mcp__agentic-engineering__${name}`;

test("agent-works hooks.json: the events it has a hook on, and nothing else", () => {
  assert.deepEqual(Object.keys(config).sort(), ["description", "hooks", "modules"]);
  assert.deepEqual(Object.keys(config.hooks).filter((event) => mine(event).length).sort(), ["PostToolUse", "PreToolUse", "Stop", "SubagentStop", "UserPromptSubmit"]);
  assert.deepEqual(Object.fromEntries(["PostToolUse", "PreToolUse", "Stop", "SubagentStop", "UserPromptSubmit"].map((event) => [event, scripts(event)])), {
    PostToolUse: ["card-sync.mjs", "plan-gate.mjs", "plan-follow.mjs"],
    PreToolUse: ["guard.mjs", "plan-gate.mjs", "plan-follow.mjs"],
    Stop: ["card-sync.mjs", "plan-follow.mjs"],
    SubagentStop: ["card-sync.mjs", "plan-follow.mjs"],
    UserPromptSubmit: ["plan-gate.mjs"],
  });
});

test("agent-works has no session hook of its own: its lines and its briefing go out through the plugin's two commands", () => {
  assert.deepEqual([mine("SessionStart"), mine("SubagentStart")], [[], []]);
  assert.equal(fs.existsSync(path.join(PLUGIN, "hooks", "session-start.mjs")), false);
  assert.ok(fs.existsSync(path.join(PLUGIN, "hooks", "briefing.mjs")));
  const briefing = config.hooks.SessionStart.flatMap((g) => g.hooks).find((h) => h.command === hookCommand("agentic-engineering", "hooks/briefing.mjs"));
  // A migration is given three seconds by the helper, and the briefing reads the board after it.
  assert.ok(briefing.timeout >= 5);
});

test("agent-works hooks.json: the guard sees every shell command and every edit, before it runs", () => {
  const guard = only("PreToolUse", "guard.mjs");
  assert.equal(guard.matcher, "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit");
  assert.equal(guard.command, own("guard.mjs"));
  assert.equal(guard.timeout, 5);
});

test("agent-works hooks.json: card-sync hears what changes a card's state, and both kinds of stop", async () => {
  const after = only("PostToolUse", "card-sync.mjs");
  assert.equal(after.command, own("card-sync.mjs"));
  for (const tool of ["Bash", "PowerShell", "Edit", "Write", "MultiEdit", "NotebookEdit"]) assert.ok(matches(after.matcher, tool), tool);
  for (const tool of ["Read", "Grep", hostId("list_tasks"), "mcp__agent-works__move_task", "mcp__other__move_task"]) assert.ok(!matches(after.matcher, tool), tool);

  // The pane's tools that change a card are the ones the hook is run for, and the ones the rules know.
  const tools = await import(pathToFileURL(path.join(PLUGIN, "hooks", "kanban", "tools.mjs")).href);
  const sync = await import(pathToFileURL(path.join(PLUGIN, "lib", "sync.mjs")).href);
  for (const name of ["move_task", "plan_task", "settle_gate"]) {
    assert.ok(name in tools.TOOLS, `the pane has no ${name}`);
    assert.ok(matches(after.matcher, hostId(name)), name);
    assert.equal(sync.observe({ tool: tools.toolId(name), input: { id: "0001" } })?.kind, "board", name);
  }
  for (const name of Object.keys(tools.TOOLS)) {
    const seen = sync.observe({ tool: tools.toolId(name), input: { id: "0001", title: "t" } });
    assert.equal(matches(after.matcher, hostId(name)), seen !== null, `${name}: run for it exactly when the rules read it`);
  }

  for (const event of ["Stop", "SubagentStop"]) {
    const stop = only(event, "card-sync.mjs");
    assert.equal(stop.matcher, undefined);
    assert.equal(stop.command, own("card-sync.mjs"));
  }
});

test("agent-works hooks.json: the plan gate hears a prompt, plan mode entered and left, and a write that may be the plan file", () => {
  const prompt = only("UserPromptSubmit", "plan-gate.mjs");
  assert.deepEqual([prompt.matcher, prompt.timeout], [undefined, 5]);
  const before = only("PreToolUse", "plan-gate.mjs");
  for (const tool of ["Write", "Edit", "MultiEdit", "ExitPlanMode"]) assert.ok(matches(before.matcher, tool), tool);
  for (const tool of ["EnterPlanMode", "Bash", "NotebookEdit", "Read", "ExitPlanModeV2", "MyWrite"]) assert.ok(!matches(before.matcher, tool), tool);
  const after = only("PostToolUse", "plan-gate.mjs");
  for (const tool of ["EnterPlanMode", "ExitPlanMode"]) assert.ok(matches(after.matcher, tool), tool);
  for (const tool of ["Write", "Edit", "Agent"]) assert.ok(!matches(after.matcher, tool), tool);
  assert.deepEqual([before.timeout, after.timeout], [5, 5]);
  // The plan tree's own gate is another area's and another event's: the two never share a name's meaning.
  assert.deepEqual(mine("TaskCompleted"), []);
});

test("agent-works hooks.json: the plan follower hears an Agent call before and after, a child session's start, and both kinds of stop", () => {
  const before = only("PreToolUse", "plan-follow.mjs");
  for (const tool of ["Agent", "Task", "mcp__ccd_session__start_session"]) assert.ok(matches(before.matcher, tool), tool);
  for (const tool of ["TaskCreate", "TaskStop", "Bash", "mcp__ccd_session__send_message"]) assert.ok(!matches(before.matcher, tool), tool);
  const after = only("PostToolUse", "plan-follow.mjs");
  for (const tool of ["Agent", "Task"]) assert.ok(matches(after.matcher, tool), tool);
  for (const tool of ["TaskCreate", "mcp__ccd_session__start_session"]) assert.ok(!matches(after.matcher, tool), tool);
  for (const event of ["Stop", "SubagentStop"]) assert.deepEqual([only(event, "plan-follow.mjs").matcher, only(event, "plan-follow.mjs").timeout], [undefined, 5]);
});

test("agent-works hooks.json: every script it names is shipped, and the pane is the one module", () => {
  for (const m of JSON.stringify(config).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1])), m[1]);
  assert.deepEqual(config.modules, ["../skills/agent-works/hooks/kanban/register.mjs"]);
  assert.ok(fs.existsSync(path.join(PLUGIN, "hooks", "kanban", "register.mjs")));
});

test("agent-works critical.json: ten lines within the cap, the hub line only where the repo is set up, and none waiting on another plugin", () => {
  const data = read("hooks/critical.json");
  assert.equal(data.area, "agent-works");
  assert.equal("chains" in data, false);
  assert.deepEqual(data.lines.map((l) => [l.for, l.mode, l.when ?? null]), [
    ["main", "any", null], ["main", "any", null], ["main", "any", null], ["main", "any", null],
    // What waited on another plugin: the grill, the perceptual doctrine, and, on the conventions, ship and land.
    ["main", "any", null], ["main", "any", null], ["main", "full", null],
    ["all", "any", null], ["all", "any", null], ["all", "any", ".agents/agent-works.json"],
  ]);
  assert.match(data.lines[4].text, /\/agentic-engineering:planning grill/);
  assert.match(data.lines[5].text, /\/agentic-engineering:perceptual-loop\.$/);
  assert.match(data.lines[6].text, /\/agentic-engineering:delivery ship; .* \/agentic-engineering:delivery land\.$/);
  assert.match(data.lines.at(-1).text, /^Hubs: a directory with an AGENTS\.md holds no source files, .* Run `aw hubs`/);
  // The cap is CRITICAL_CAPS in scripts/validate.mjs.
  const size = "Critical, from agent-works:".length + data.lines.reduce((n, l) => n + l.text.length + 3, 0);
  assert.ok(size <= 2100, `${size} characters`);
  const routes = fs.readdirSync(path.join(PLUGIN, "routes"));
  for (const line of data.lines) {
    for (const m of line.text.matchAll(/\/agentic-engineering:agent-works ([a-z-]+)/g)) {
      assert.ok(routes.includes(m[1]), m[0]);
      assert.notEqual(DOOR.routes[m[1]]?.starts, "person", `${m[0]} is one the model can start`);
    }
    for (const m of line.text.matchAll(/`aw ([a-z]+)(?: ([a-z]+))?/g)) assert.ok(["board", "hubs"].includes(m[1]), m[0]);
  }
});
