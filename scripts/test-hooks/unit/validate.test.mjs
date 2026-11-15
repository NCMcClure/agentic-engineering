// validate.mjs against a copy of this checkout with one thing broken at a
// time. Each case asserts the finding it expects, not only the exit code.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { AREA_PLUGIN as ONE, hookCommand } from "../../lib.mjs";
import { REPO, runNode, tree } from "./helpers.mjs";

const CATALOG = ".claude-plugin/marketplace.json";
const gate = (dir, ...args) => runNode("scripts/validate.mjs", ["--root", dir, ...args]);
// A tree with a plugin added or renamed needs its guide written again; every
// case but the guide's own wants that done, so it is not what fails.
const validate = (dir, ...args) => {
  runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]);
  return gate(dir, ...args);
};
const entry = (name, fn) => (m) => ({ ...m, plugins: m.plugins.map((p) => (p.name === name ? fn(p) : p)) });

// A plugin that meets every rule: what a new one looks like.
const TIDY = {
  "plugins/tidy/.claude-plugin/plugin.json": `${JSON.stringify({ name: "tidy", version: "0.1.0", description: "A plugin with nothing to waive." }, null, 2)}\n`,
  "plugins/tidy/README.md": "# tidy\n\nNothing to waive.\n",
  "plugins/tidy/CHANGELOG.md": "# Changelog\n\n- **0.1.0**: first release.\n",
  "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\n---\n\n# sweep\n",
};
const listTidy = (m) => ({ ...m, plugins: [...m.plugins, { name: "tidy", source: "./plugins/tidy", description: "Nothing to waive.", category: "testing" }] });
// A plugin is an area a person is offered, so a new one joins a group of the
// entry skill's data, with what it is picked for and a skill to hand off to.
const ENTRY_DATA = "plugins/agentcraft/skills/start-here/start-here.json";
const ENTRY_FILE = "plugins/agentcraft/skills/start-here/SKILL.md";
const askTidy = (d) => ({
  groups: d.groups.map((g, i) => (i === d.groups.length - 1 ? { ...g, areas: [...g.areas, "tidy"] } : g)),
  areas: { ...d.areas, tidy: { cue: "sweep the floor", how: "It sweeps.", uses: [{ want: "a clean floor", to: "sweep" }] } },
});
const withTidy = (extra = {}) => ({
  json: { [CATALOG]: listTidy, [ENTRY_DATA]: askTidy },
  write: { ...TIDY, ...extra },
});

test("this checkout passes", (t) => {
  const result = validate(tree(t));
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^validate: all green$/m);
});

test("a catalog entry with a version key fails", (t) => {
  const result = validate(tree(t, { json: { [CATALOG]: entry("code-diet", (p) => ({ ...p, version: "9.9.9" })) } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: entries carry a version key .*: code-diet/m);
});

test("a plugin directory with no catalog entry fails", (t) => {
  const result = validate(tree(t, { write: TIDY }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/tidy has no catalog entry/m);
});

test("an external entry passes as a github object and fails as an unknown kind", (t) => {
  const add = (source) => ({ json: { [CATALOG]: (m) => ({ ...m, plugins: [...m.plugins, { name: "outside", source, description: "Released from its own repo." }] }) } });
  const good = validate(tree(t, add({ source: "github", repo: "someone/outside" })));
  assert.equal(good.status, 0, good.stdout);
  assert.match(good.stdout, /^ok: 1 external entry/m);
  const bad = validate(tree(t, add({ source: "ftp", url: "ftp://example.com/outside" })));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /^FAIL: entry outside: unknown object source kind "ftp"/m);
});

// History has one home: CHANGELOG.md inside the plugin, newest first, its top
// entry the version plugin.json carries. A README keeps no changelog.
test("a plugin with no CHANGELOG.md fails", (t) => {
  const result = validate(tree(t, { remove: ["plugins/code-diet/CHANGELOG.md"] }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: code-diet: missing CHANGELOG\.md/m);
});

test("a CHANGELOG.md whose top entry is not the plugin.json version fails", (t) => {
  const result = validate(tree(t, { text: { "plugins/code-diet/CHANGELOG.md": (s) => s.replace("# Changelog\n\n", "# Changelog\n\n- **9.9.9**: a version plugin.json does not carry.\n") } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: code-diet: CHANGELOG\.md top entry is 9\.9\.9, plugin\.json is /m);
});

test("a README that still carries a ## Changelog section fails", (t) => {
  const result = validate(tree(t, { text: { "plugins/code-diet/README.md": (s) => `${s}\n## Changelog\n\n- 0.0.1: history kept in the wrong place.\n` } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: code-diet: README carries a "## Changelog" section/m);
});

// Plugins run on Node, and a skill's frontmatter carries five keys.
test("a plugin is held to the Node-only rules", (t) => {
  const result = validate(tree(t, withTidy({
    "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\nlicense: MIT\n---\n\n# sweep\n",
    "plugins/tidy/hooks/guard.py": "print('swept')\n",
  })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/tidy\/hooks\/guard\.py is not Node/m);
  assert.match(result.stdout, /^FAIL: tidy\/sweep: frontmatter key "license" is not one of the five allowed/m);
});

test("a skill kept out of the slash menu with user-invocable passes the frontmatter rule", (t) => {
  const result = validate(tree(t, withTidy({
    "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\nuser-invocable: false\n---\n\n# sweep\n",
  })));
  assert.doesNotMatch(result.stdout, /frontmatter key/);
});

test("a new plugin that meets every rule passes", (t) => {
  const result = validate(tree(t, withTidy()));
  assert.equal(result.status, 0, result.stdout);
});

test("a file with no extension is judged by its shebang", (t) => {
  const result = validate(tree(t, withTidy({ "plugins/tidy/bin/tidy": "#!/bin/sh\necho swept\n", "plugins/tidy/bin/sweep": "#!/usr/bin/env node\nconsole.log('swept');\n" })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/tidy\/bin\/tidy runs under "\/bin\/sh", not Node/m);
  assert.doesNotMatch(result.stdout, /bin\/sweep/);
});

// Hooks: known events, commands inside the plugin, a module the host can load.
const hooks = (map) => withTidy({
  "plugins/tidy/hooks/hooks.json": `${JSON.stringify(map, null, 2)}\n`,
  "plugins/tidy/hooks/start.mjs": "process.exitCode = 0;\n",
  "plugins/tidy/hooks/pane.tsx": "export {};\n",
});
const command = (file, { plugin = "tidy", loud = true, ...rest } = {}) => ({ hooks: [{ type: "command", command: hookCommand(plugin, `hooks/${file}`, { loud }), statusMessage: "Tidying", ...rest }] });

test("a hook on a known event that points inside the plugin passes", (t) => {
  const result = validate(tree(t, hooks({ hooks: { SessionStart: [command("start.mjs")] }, modules: ["./start.mjs"] })));
  assert.equal(result.status, 0, result.stdout);
});

test("an unknown hook event and a command that points at nothing both fail", (t) => {
  const result = validate(tree(t, hooks({ hooks: { SessionStarted: [command("missing.mjs")] } })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: tidy\/hooks\/hooks\.json: "SessionStarted" is not a known hook event/m);
  assert.match(result.stdout, /^FAIL: tidy\/hooks\/hooks\.json points at hooks\/missing\.mjs, which is not in the plugin/m);
});

test("a hooks module that is missing, outside the plugin, or not .mjs fails", (t) => {
  const result = validate(tree(t, hooks({ modules: ["./missing.mjs", "../../code-diet/README.md", "./pane.tsx"] })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: tidy\/hooks\/hooks\.json: module \.\/missing\.mjs does not exist/m);
  assert.match(result.stdout, /^FAIL: tidy\/hooks\/hooks\.json: module \.\.\/\.\.\/code-diet\/README\.md is outside the plugin/m);
  assert.match(result.stdout, /^FAIL: tidy\/hooks\/hooks\.json: module \.\/pane\.tsx is not a \.mjs or \.js file/m);
});

test("an absolute machine path in a tracked file fails", (t) => {
  const home = ["", "Users", "someone", "checkout"].join("/");
  const result = validate(tree(t, { text: { "plugins/code-diet/README.md": (s) => `${s}\nInstall from ${home}.\n` } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/code-diet\/README\.md carries an absolute machine path/m);
});

test("a Node file that calls process.exit fails, a test's one-line command included, and a comment does not", (t) => {
  const call = ["process", "exit(1)"].join(".");
  const result = validate(tree(t, withTidy({
    "plugins/tidy/skills/sweep/sweep.mjs": `console.log("swept");\n${call};\n`,
    "plugins/tidy/skills/sweep/note.mjs": `// never ${call}: set the exit code\nprocess.exitCode = 1;\n`,
    "scripts/test-hooks/unit/tidy.test.mjs": `const FAILING = 'node -e "${call}"';\n`,
  })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/tidy\/skills\/sweep\/sweep\.mjs:2 calls process\.exit: set process\.exitCode and let Node unwind/m);
  assert.match(result.stdout, /^FAIL: scripts\/test-hooks\/unit\/tidy\.test\.mjs:1 calls process\.exit/m);
  assert.doesNotMatch(result.stdout, /note\.mjs/);
  assert.equal(result.stdout.match(/^FAIL: /gm).length, 2, result.stdout);
});

test("a hub that is gone, or a CLAUDE.md that is its own file, fails", (t) => {
  const result = validate(tree(t, { remove: ["plugins/AGENTS.md", "CLAUDE.md"], write: { "CLAUDE.md": "# Rules of my own\n" } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/AGENTS\.md is missing/m);
  assert.match(result.stdout, /^FAIL: CLAUDE\.md is not a link to AGENTS\.md/m);
});

// A Node hook sits behind a guard, so a machine without Node hears about it
// once, at session start, instead of failing on every event.
test("a Node hook with no guard, a quiet one at session start, or no status message fails", (t) => {
  const bare = { hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.mjs"', statusMessage: "Tidying" }] };
  let result = validate(tree(t, hooks({ hooks: { PreToolUse: [bare] } })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: tidy\/hooks\/hooks\.json: the PreToolUse command for hooks\/start\.mjs has no guard for a machine without Node/m);

  result = validate(tree(t, hooks({ hooks: { SessionStart: [command("start.mjs", { loud: false, statusMessage: undefined })] } })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: .*the SessionStart command for hooks\/start\.mjs must use the guard that tells the person Node is missing/m);
  assert.match(result.stdout, /^FAIL: .*the SessionStart command for hooks\/start\.mjs has no statusMessage/m);

  result = validate(tree(t, hooks({ hooks: { PreToolUse: [command("start.mjs", { loud: false })], Stop: [{ hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.mjs" && echo done' }] }] } })));
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /PreToolUse/, "the quiet guard is enough off session start");
  assert.match(result.stdout, /^FAIL: .*the Stop command is not a guard followed by node/m);
});

// Shared files: one copy is edited, in scripts/shared/, and a plugin's copy
// is that file byte for byte.
const KERNEL = fs.readFileSync(path.join(REPO, "scripts/shared/critical-context.mjs"), "utf8");
const shares = (name, list) => ({ [`scripts/plugins/${name}.json`]: `${JSON.stringify({ shared: list })}\n` });

test("a shared copy that is missing or has drifted fails, and sync-shared --write repairs both", (t) => {
  const dir = tree(t, { write: { ...shares("write-like-me", ["hooks/critical-context.mjs"]), "plugins/agentcraft/skills/workflow-studio/hooks/critical-context.mjs": `${KERNEL}// edited here\n` } });
  const data = (shared) => fs.writeFileSync(path.join(dir, "scripts/plugins/agentcraft/skills/workflow-studio.json"), `${JSON.stringify({ shared })}\n`);
  data(["hooks/critical-context.mjs", "lib/no-such-file.mjs"]);
  const result = validate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/write-like-me\/hooks\/critical-context\.mjs is missing: node scripts\/sync-shared\.mjs --write/m);
  assert.match(result.stdout, /^FAIL: plugins\/workflow-studio\/hooks\/critical-context\.mjs has drifted from scripts\/shared\/critical-context\.mjs/m);
  assert.match(result.stdout, /^FAIL: plugins\/workflow-studio\/lib\/no-such-file\.mjs is listed as shared, but scripts\/shared\/no-such-file\.mjs does not exist/m);

  const check = runNode("scripts/sync-shared.mjs", ["--root", dir]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /^missing: plugins\/write-like-me\/hooks\/critical-context\.mjs/m);
  assert.match(check.stdout, /^drifted: plugins\/workflow-studio\/hooks\/critical-context\.mjs/m);
  assert.equal(fs.existsSync(path.join(dir, "plugins/write-like-me/hooks/critical-context.mjs")), false, "a check writes nothing");

  data(["hooks/critical-context.mjs"]);
  assert.equal(runNode("scripts/sync-shared.mjs", ["--root", dir, "--write"]).status, 0);
  for (const plugin of ["write-like-me", "workflow-studio"]) assert.equal(fs.readFileSync(path.join(dir, "plugins", plugin, "hooks/critical-context.mjs"), "utf8"), KERNEL, plugin);
  assert.equal(runNode("scripts/sync-shared.mjs", ["--root", dir]).status, 0);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  const after = validate(dir);
  assert.equal(after.status, 0, after.stdout);
  assert.match(after.stdout, /^ok: \d+ shared copy\/copies match scripts\/shared, /m);
});

test("a shared file with no suite of its own fails", (t) => {
  const result = validate(tree(t, { write: { "scripts/shared/untested.mjs": "export const nothing = null;\n" } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: scripts\/shared\/untested\.mjs has no scripts\/test-hooks\/unit\/untested\.test\.mjs/m);
});

test("a shared path that leaves the plugin fails", (t) => {
  const result = validate(tree(t, { write: shares("write-like-me", ["../docs-parity/hooks/critical-context.mjs"]) }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: scripts\/plugins\/write-like-me\.json: "\.\.\/docs-parity\/hooks\/critical-context\.mjs" is not a path inside the plugin/m);
});

// Critical lines: a plugin that ships them ships the kernel beside them, runs
// it at session start and in subagents, and stays under its cap.
const line = (text, extra = {}) => ({ for: "all", mode: "any", text, ...extra });
function speaks(plugin, data, { cap = 500, shared = ["hooks/critical-context.mjs"], events = ["SessionStart", "SubagentStart"] } = {}) {
  const run = (event) => command("session-start.mjs", { plugin, loud: event === "SessionStart" });
  return {
    json: {
      [`scripts/plugins/${plugin}.json`]: (m) => ({ ...m, shared, critical: { cap } }),
      [`plugins/${plugin}/hooks/hooks.json`]: (m) => ({ ...m, hooks: { ...m.hooks, SessionStart: undefined, SubagentStart: undefined, ...Object.fromEntries(events.map((e) => [e, [run(e)]])) } }),
    },
    write: {
      [`plugins/${plugin}/hooks/critical.json`]: `${JSON.stringify({ plugin, ...data }, null, 2)}\n`,
      [`plugins/${plugin}/hooks/critical-context.mjs`]: KERNEL,
      [`plugins/${plugin}/hooks/session-start.mjs`]: 'import { run } from "./critical-context.mjs";\n\nawait run();\n',
    },
  };
}

test("a plugin's critical lines pass within its cap and are counted against the total", (t) => {
  const result = validate(tree(t, speaks("docs-parity", { lines: [line("Docs change with the code.")], chains: [line("Shots go through the loop.", { partner: "perceptual-loop", for: "main" })] })));
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^ok: \d+ shared copy\/copies match scripts\/shared, /m);
  assert.match(result.stdout, /^ok: critical lines within budget \(\d+ of 7500 characters across \d+ plugin\(s\)\)$/m);
});

test("critical lines over the plugin's cap, or with a bad audience, mode or partner, fail", (t) => {
  const data = { lines: [line("x".repeat(600)), line("Wrong audience.", { for: "everyone" }), line("Wrong mode.", { mode: "sometimes" })], chains: [line("To itself.", { partner: "docs-parity" }), line("To nobody.", { partner: "no-such-plugin" })] };
  const result = validate(tree(t, speaks("docs-parity", data)));
  assert.equal(result.status, 1);
  const where = "FAIL: plugins\\/docs-parity\\/hooks\\/critical\\.json: ";
  assert.match(result.stdout, new RegExp(`^${where}critical and chain lines are \\d+ characters, over the 500 cap`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}"Wrong audience\\." needs for: main or all`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}"Wrong mode\\." needs mode: full, portable, any`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}chain partner "docs-parity" is not another plugin in ORDER`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}chain partner "no-such-plugin" is not another plugin in ORDER`, "m"));
});

test("critical lines with no kernel copy listed, no cap, the wrong name, or no subagent hook fail", (t) => {
  const result = validate(tree(t, {
    ...speaks("docs-parity", { plugin: "docs", lines: [line("Docs change with the code.")] }, { shared: [], events: ["SessionStart"] }),
    json: { ...speaks("docs-parity", {}, { shared: [], events: ["SessionStart"] }).json, "scripts/plugins/docs-parity.json": () => ({}) },
  }));
  assert.equal(result.status, 1);
  const where = "FAIL: plugins\\/docs-parity\\/hooks\\/critical\\.json: ";
  assert.match(result.stdout, new RegExp(`^${where}scripts\\/plugins\\/docs-parity\\.json does not list hooks\\/critical-context\\.mjs under shared`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}hooks\\.json does not run hooks\\/session-start\\.mjs on SubagentStart`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}plugin is "docs", expected docs-parity`, "m"));
  assert.match(result.stdout, new RegExp(`^${where}scripts\\/plugins\\/docs-parity\\.json carries no critical\\.cap`, "m"));
});

test("critical lines from a plugin the kernel's ORDER does not name fail", (t) => {
  const tidy = withTidy({
    "plugins/tidy/hooks/critical.json": `${JSON.stringify({ plugin: "tidy", lines: [line("Sweep first.")] })}\n`,
    "plugins/tidy/hooks/critical-context.mjs": KERNEL,
    "plugins/tidy/hooks/session-start.mjs": 'import { run } from "./critical-context.mjs";\n\nawait run();\n',
    "plugins/tidy/hooks/hooks.json": `${JSON.stringify({ hooks: { SessionStart: [command("session-start.mjs")], SubagentStart: [command("session-start.mjs", { loud: false })] } })}\n`,
    "scripts/plugins/tidy.json": `${JSON.stringify({ shared: ["hooks/critical-context.mjs"], critical: { cap: 500 } })}\n`,
  });
  const result = validate(tree(t, tidy));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/tidy\/hooks\/critical\.json: tidy is not in ORDER in scripts\/shared\/critical-context\.mjs/m);
  assert.equal(result.stdout.match(/^FAIL:/gm).length, 1, result.stdout);
});

// The entry skill is the one a person types. Its area tables are generated,
// and the gate holds its data to what a question can offer and to the tree.
const entryData = (fn) => ({ json: { [ENTRY_DATA]: fn } });
const area = (name, fn) => (d) => ({ ...d, areas: { ...d.areas, [name]: fn(d.areas[name]) } });

test("a plugin the entry skill never asks about fails, and so does one it asks about that is not there", (t) => {
  const unasked = validate(tree(t, { json: { [CATALOG]: listTidy }, write: TIDY }));
  assert.equal(unasked.status, 1);
  assert.match(unasked.stdout, /^FAIL: .*start-here\.json: no group asks about tidy, so a person is never offered it/m);
  const gone = validate(tree(t, entryData((d) => ({ ...d, groups: d.groups.map((g, i) => (i ? g : { ...g, areas: [...g.areas.slice(1), "no-such-plugin"] })) }))));
  assert.match(gone.stdout, /^FAIL: .*a group names no-such-plugin, which is not a plugin of this catalog/m);
  assert.match(gone.stdout, /^FAIL: .*no group asks about but-first-planning/m);
  assert.match(gone.stdout, /^FAIL: .*an entry for but-first-planning, which no group names/m);
});

test("the entry skill's data is held to what a question can offer", (t) => {
  // Five areas in one group is five options, and the last group carries "Learn more" as well.
  const wide = validate(tree(t, entryData((d) => ({ ...d, groups: [{ ...d.groups[0], areas: [...d.groups[0].areas, d.groups[1].areas[0]] }, { ...d.groups[1], areas: d.groups[1].areas.slice(1) }, ...d.groups.slice(2)] }))));
  assert.match(wide.stdout, /^FAIL: .*"Plan and run work" offers 5 options; a question takes two to four/m);
  const long = validate(tree(t, entryData(area("code-diet", (a) => ({ ...a, cue: "x".repeat(61), uses: [...a.uses, { want: "a fifth thing", to: "ladder" }] })))));
  assert.match(long.stdout, /^FAIL: .*code-diet needs a cue of 1 to 60 characters/m);
  assert.match(long.stdout, /^FAIL: .*code-diet has 5 uses; a question takes one to four/m);
  const label = validate(tree(t, entryData((d) => ({ ...d, groups: d.groups.map((g, i) => (i ? g : { ...g, header: "A label far too long" })) }))));
  assert.match(label.stdout, /^FAIL: .*"Plan and run work" needs a header of 1 to 12 characters/m);
});

test("a use of the entry skill names a skill that is there, and says so when only a person can start it", (t) => {
  const result = validate(tree(t, entryData((d) => area("agentic-teamwork", (a) => ({ ...a, uses: [{ want: "a thing nobody ships", to: "no-such-skill" }, { want: "set a repo up", to: "bootstrap" }, { want: "ship it", to: "ship", starts: "person" }] }))(d))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: .*agentic-teamwork hands off to no-such-skill, which is not one of its skills/m);
  assert.match(result.stdout, /^FAIL: .*\/agentic-teamwork:bootstrap is one only a person can start, so its use says "starts": "person"/m);
  assert.match(result.stdout, /^FAIL: .*\/agentic-teamwork:ship can be started by an agent, so its use carries no "starts": "person"/m);
});

test("an entry skill whose areas section is stale, or that a person could not type, fails", (t) => {
  // The data moved and the skill was not regenerated.
  const dir = tree(t, entryData(area("code-diet", (a) => ({ ...a, cue: "cut what the code does not need" }))));
  assert.match(gate(dir).stdout, /^FAIL: plugins\/agentcraft\/skills\/start-here\/SKILL\.md is stale: node scripts\/gen-guide\.mjs --write/m);
  assert.equal(runNode("scripts/gen-guide.mjs", ["--root", dir]).status, 1);
  assert.equal(runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]).status, 0);
  assert.match(fs.readFileSync(path.join(dir, ENTRY_FILE), "utf8"), /\| `code-diet` \| cut what the code does not need \|/);
  assert.equal(gate(dir).status, 0);
  // What is written by hand is kept, and the generated section stays the last thing in the file.
  assert.ok(fs.readFileSync(path.join(dir, ENTRY_FILE), "utf8").trimEnd().endsWith("<!-- end of the generated areas section -->"));
  assert.match(fs.readFileSync(path.join(dir, ENTRY_FILE), "utf8"), /^## Which mode$/m);
  const hidden = validate(tree(t, { text: { [ENTRY_FILE]: (s) => s.replace("argument-hint:", "disable-model-invocation: true\nargument-hint:") } }));
  assert.match(hidden.stdout, /^FAIL: .*the entry skill is the one a person types and an agent may be sent to/m);
});

// The guide is generated, so a copy that differs from a fresh one is stale.
test("a plugin guide that is missing or stale fails, and gen-guide --write repairs it", (t) => {
  const dir = tree(t, { json: { "plugins/code-diet/.claude-plugin/plugin.json": (m) => ({ ...m, version: "9.9.9" }) }, text: { "plugins/code-diet/CHANGELOG.md": (s) => s.replace("# Changelog\n\n", "# Changelog\n\n- **9.9.9**: a bump the guide has not seen.\n") } });
  assert.match(gate(dir).stdout, /^FAIL: docs\/plugins\.md is stale: node scripts\/gen-guide\.mjs --write/m);
  assert.equal(runNode("scripts/gen-guide.mjs", ["--root", dir]).status, 1);
  assert.equal(runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]).status, 0);
  assert.match(fs.readFileSync(path.join(dir, "docs/plugins.md"), "utf8"), /\| \[code-diet\]\(#code-diet\) \| 9\.9\.9 \|/);
  assert.equal(gate(dir).status, 0);
  fs.rmSync(path.join(dir, "docs/plugins.md"));
  assert.match(gate(dir).stdout, /^FAIL: docs\/plugins\.md is missing/m);
});

// A tag releases one plugin: it names the version that plugin's plugin.json carries.
test("--tag passes on the plugin.json version and fails on any other", (t) => {
  const dir = tree(t, withTidy());
  const good = validate(dir, "--tag", "tidy/v0.1.0");
  assert.equal(good.status, 0, good.stdout);
  for (const [tag, finding] of [
    ["tidy/v0.2.0", /^FAIL: tag "tidy\/v0\.2\.0" says 0\.2\.0, but .* is at 0\.1\.0/m],
    ["untidy/v0.1.0", /^FAIL: tag "untidy\/v0\.1\.0" names plugins\/untidy, which does not exist/m],
    ["v0.1.0", /^FAIL: tag "v0\.1\.0" is not <plugin>\/v<version>/m],
  ]) {
    const bad = validate(dir, "--tag", tag);
    assert.equal(bad.status, 1, tag);
    assert.match(bad.stdout, finding);
  }
});

// ---- one plugin of areas ---------------------------------------------------
// The plugins are becoming areas of one plugin, and until they have the gate
// takes both shapes. A plugin that moved in is an area there, a skill
// directory that holds routes/, and what is left under its old name is a stub.
// The one plugin's name is never written beside a colon here: an address
// under it is held to what it ships, in this file as in any other.
const HOME = `plugins/${ONE}`;
// Nor is the stub's name written beside a colon or an @: in a tree where it is
// a stub, this file's own lines would be read as its old addresses.
const STUB = "tidy";
const TIDY_AREA = `${HOME}/skills/tidy`;
const SWEEP = `${TIDY_AREA}/routes/sweep/ROUTE.md`;
const route = (name, body = `# ${name}\n\nDo it.\n`, extra = "") => `---\nname: ${name}\ndescription: "Does ${name}. Use when ${name} is wanted."\n${extra}---\n\n${body}`;
const TIDY_STUB = { name: "tidy", version: "1.0.0", description: `Moved: tidy is an area of ${ONE} now.`, dependencies: [ONE] };
const TIDY_DOOR = { lead: "Keeps the floor clean.", default: "sweep", routes: { sweep: { cue: "sweep the floor" } } };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
// Once a tree holds an area, every address in it is held to what its plugin
// ships. These files name addresses that are not there, as fixtures and as
// examples, and are rewritten by hand when the plugins move; until then a
// tree with an area leaves them out.
const UNHELD = ["docs/known-limits.md", "scripts/test-hooks/unit/agent-works-common.test.mjs", "scripts/test-hooks/unit/live-lane.test.mjs", "scripts/test-hooks/unit/perceptual-loop-hooks.test.mjs", "scripts/test-hooks/unit/plugin-workbench-context-lens.test.mjs"];
const moved = ({ stub = TIDY_STUB, door = TIDY_DOOR, write = {}, text = {} } = {}) => ({
  json: { [CATALOG]: listTidy, [ENTRY_DATA]: askTidy },
  text,
  write: {
    "plugins/tidy/.claude-plugin/plugin.json": json(stub),
    "plugins/tidy/README.md": `# tidy\n\nMoved into ${ONE}, as its tidy area.\n`,
    "plugins/tidy/CHANGELOG.md": "# Changelog\n\n- **1.0.0**: moved in as the tidy area.\n",
    [`${TIDY_AREA}/door.json`]: json(door),
    [SWEEP]: route("sweep"),
    ...write,
  },
  remove: UNHELD,
});

test("a tree that holds one area and the stub it left behind passes, each held to its own rules", (t) => {
  const result = validate(tree(t, moved()));
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^ok: 1 area: current, within the caps, user-invocable: false and callable, every route a ROUTE\.md in its table, no SKILL\.md below$/m);
  assert.match(result.stdout, /^ok: 1 stub: each depends on the plugin it moved into/m);
  assert.match(result.stdout, /^ok: \d+ addresses resolve \(.*\), [1-9]\d* of them on through an area to its route$/m);
  assert.match(result.stdout, /^ok: the entry skill offers 13 areas/m);
});

// One tree with a thing wrong for every rule the shape brings, judged once:
// a copy of the checkout and a run of the gate are what these cases cost.
// A plugin of this checkout is moved in by the script as well, since the
// aliases a stub owes are listed by plugin.
const PLANNING = ["but-first", "planning"].join("-");
const ROUTE_STEPS = [
  "# sweep",
  "",
  "`W` below is `../..` from the directory this file is in.",
  "",
  "Run `node \"W/scripts/pan.mjs\"`, which is there, then `node \"W/scripts/broom.mjs\"`, which is not.",
  "Unquoted: node W/scripts/pan.mjs --now",
  "Filled in by nothing: `node \"${CLAUDE_PLUGIN_ROOT}/skills/tidy/scripts/pan.mjs\"`.",
  "Copied from another route: `node \"R/scripts/pan.mjs\"`.",
  "",
].join("\n");
const PAGE = [`Run /${STUB}:sweep.`, `Or /${ONE}:brush.`, `Or \`/${ONE}:tidy mop\`.`, `Or /${ONE}:nothing.`, `This works: \`/${ONE}:tidy sweep\`, and so does /${ONE}:tidy.`].join("\n");
// Built, never written out: an entry here is an address to this file's own gate.
const GONE = ["code-diet", "nobody"].join(":"), WAS = [STUB, "critic"].join(":");
const alias = (name, to, extra = "user-invocable: false\n") => `---\nname: ${name}\ndescription: Use when a file still prints the old address of ${name}.\n${extra}---\n\nMoved: this is ${to} now.\n`;
const cleanups = [];
after(() => { for (const fn of cleanups) fn(); });
let brokenOnce;
const broken = () => (brokenOnce ??= (() => {
  const dir = tree({ after: (fn) => cleanups.push(fn) }, moved({
    stub: { name: "tidy", version: "1.0.0", description: "A plugin with nothing to waive.", hooks: "./hooks/hooks.json" },
    door: { lead: "", default: "mop", routes: { sweep: { cue: "" }, wipe: { cue: "wipe the table", starts: "nobody" } } },
    write: {
      "plugins/tidy/skills/sweep/SKILL.md": TIDY["plugins/tidy/skills/sweep/SKILL.md"],
      "plugins/tidy/CHANGELOG.md": `# Changelog\n\n- **1.0.0**: moved in as the tidy area; /${STUB}:sweep is history.\n`,
      [SWEEP]: route("sweep", ROUTE_STEPS),
      [`${TIDY_AREA}/scripts/pan.mjs`]: "export {};\n",
      [`${TIDY_AREA}/README.md`]: "# tidy\n\nThe pan is `${CLAUDE_PLUGIN_ROOT}/skills/tidy/scripts/pan.mjs`, and the mop is `${CLAUDE_PLUGIN_ROOT}/skills/tidy/scripts/mop.mjs`.\n",
      [`${TIDY_AREA}/routes/brush/ROUTE.md`]: route("bristle", undefined, "disable-model-invocation: true\n"),
      [`${TIDY_AREA}/routes/brush/SKILL.md`]: "---\nname: brush\ndescription: Use when the floor needs brushing.\n---\n\n# brush\n",
      [`${TIDY_AREA}/routes/empty/notes.md`]: "No route here.\n",
      [`${HOME}/skills/polish/SKILL.md`]: "---\nname: polish\ndescription: Use when the brass needs polishing.\n---\n\n# polish\n",
      "docs/moved.md": `${PAGE}\n`,
    },
    text: {
      "README.md": (s) => `${s}\nTo sweep, run \`/plugin install ${STUB}@agentic-engineering\`.\n`,
      "scripts/shared/critical-context.mjs": (s) => s.replace(/(export const DENYLIST = new Set\(\[[^\]]*)\]/, (whole, head) => `${head}, "${GONE}", "${WAS}"]`),
      "plugins/agentcraft/skills/agent-works/hooks/kanban/register.mjs": (s) => s.replaceAll("mcp__agent-works__", "mcp__kanban__"),
    },
  }));
  const moving = runNode("scripts/door-plugin.mjs", [PLANNING, "--root", dir, "--write"]);
  assert.equal(moving.status, 0, moving.stdout + moving.stderr);
  // One alias as it should be, and one with everything an alias may not be.
  const at = (rel) => path.join(dir, rel);
  for (const [name, text] of [
    ["plan-decompose", alias("plan-decompose", `\`/${ONE}:${PLANNING} plan-decompose\``)],
    ["spec-open", alias("spec-open", `a route of the planning area. ${"It says far too much. ".repeat(40)}`, "disable-model-invocation: true\n")],
  ]) {
    fs.mkdirSync(at(`plugins/${PLANNING}/skills/${name}`), { recursive: true });
    fs.writeFileSync(at(`plugins/${PLANNING}/skills/${name}/SKILL.md`), text);
  }
  runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]);
  // The area as the generator wrote it, then made hidden, and its block doubled.
  const area = fs.readFileSync(at(`${TIDY_AREA}/SKILL.md`), "utf8");
  fs.writeFileSync(at(`${TIDY_AREA}/SKILL.md`), `${area.replace("user-invocable: false\n", "disable-model-invocation: true\n")}\n${area.slice(area.indexOf("## Route"))}`);
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });
  return gate(dir).stdout;
})());
const findings = (file) => broken().split("\n").filter((l) => l.startsWith(`FAIL: ${file}`));

test("an area's data, its routes, and what sits beside it are held to the shape", () => {
  for (const finding of [
    /^FAIL: \S+\/tidy: the area has no lead; door\.json's lead is one sentence/m,
    /^FAIL: \S+\/tidy: the area has no default route: "mop" is not one of its routes/m,
    /^FAIL: \S+\/tidy: the cue for sweep is 0 characters; a cue is 1 to 60/m,
    /^FAIL: \S+\/tidy: route wipe is started by "nobody"; it is "agent" or "person"/m,
    /^FAIL: \S+\/tidy: the area routes wipe, and routes\/wipe\/ROUTE\.md is not there/m,
    /^FAIL: \S+\/tidy: route brush is not in the area's Route table; give it a cue in door\.json/m,
    /^FAIL: \S+\/tidy: routes\/empty has no ROUTE\.md/m,
    /^FAIL: \S+\/tidy: routes\/brush\/ROUTE\.md's frontmatter name is "bristle"/m,
    /^FAIL: \S+\/tidy: routes\/brush\/ROUTE\.md's frontmatter key "disable-model-invocation" is not one a route carries \(name, description, argument-hint\)/m,
    /^FAIL: plugins\/\S+\/skills\/tidy\/routes\/brush\/SKILL\.md is a SKILL\.md below the tidy area/m,
    /^FAIL: \S+\/polish: a skill of a plugin that holds areas is start-here or an area; this one is neither/m,
  ]) assert.match(broken(), finding);
});

test("an area the generator did not write is stale, and one made hidden or given a second block is refused", () => {
  assert.match(broken(), /^FAIL: plugins\/\S+\/skills\/tidy\/SKILL\.md is stale or missing; run node scripts\/gen-guide\.mjs --write/m);
  assert.match(broken(), /^FAIL: \S+\/tidy: an area carries user-invocable: false/m);
  assert.match(broken(), /^FAIL: \S+\/tidy: an area stays callable: disable-model-invocation: true hides it from the model/m);
  assert.match(broken(), /^FAIL: \S+\/tidy: the area holds 2 end markers and 2 Route table headers; one generated block has one of each/m);
});

test("a stub depends on the plugin it moved into, ships nothing of its own, and no install line names it", () => {
  for (const finding of [
    /^FAIL: tidy: a stub's plugin\.json carries "dependencies": \["\w+"\], so an install of the old name brings the plugin it moved into/m,
    /^FAIL: tidy: a stub's description says where it moved: it names \w+/m,
    /^FAIL: tidy: a stub's plugin\.json names hooks, and a stub ships none/m,
    /^FAIL: plugins\/tidy\/skills\/sweep\/SKILL\.md: a stub holds its manifest, a README\.md, a CHANGELOG\.md, and nothing else; this belongs in plugins\/\w+\/skills\/tidy\//m,
    new RegExp(`^FAIL: README\\.md:\\d+: tells its reader to install ${STUB}@agentic-engineering, a stub; the plugin to install is ${ONE}@agentic-engineering`, "m"),
  ]) assert.match(broken(), finding);
});

test("a stub's alias gives the route's new address and nothing else, callable and out of the slash menu", () => {
  const of = (name) => broken().split("\n").filter((l) => l.startsWith(`FAIL: ${PLANNING}/${name}: `)).map((l) => l.slice(`FAIL: ${PLANNING}/${name}: `.length));
  assert.deepEqual(of("plan-decompose"), [], "an alias that only says where to go");
  const bad = of("spec-open");
  assert.equal(bad.length, 4, bad.join("\n"));
  assert.match(bad[0], /^an alias stays callable by a model: hidden, the host refuses the old address/);
  assert.match(bad[1], /^an alias carries user-invocable: false/);
  assert.match(bad[2], /^an alias says where the route moved and nothing else; its body is \d+ characters, over 600/);
  assert.match(bad[3], /^an alias gives the new address, \//);
});

test("an address resolves once the tree holds an area: an old plugin name, a route named as a skill, and a word that is no route each fail with what to write", () => {
  const found = findings("docs/moved.md").map((l) => l.slice(0, l.lastIndexOf(" (")));
  assert.deepEqual(found, [
    `FAIL: docs/moved.md:1: /${STUB}:sweep names tidy as a plugin, and it is an area of ${ONE}; write /${ONE}:tidy sweep`,
    `FAIL: docs/moved.md:2: /${ONE}:brush names a route of the tidy area directly; write /${ONE}:tidy brush`,
    `FAIL: docs/moved.md:3: /${ONE}:tidy mop: mop is not a route of the tidy area; an area named alone is followed by punctuation or the end of its code span`,
    `FAIL: docs/moved.md:4: /${ONE}:nothing is not a skill, agent, or MCP server of ${ONE}`,
  ]);
  assert.deepEqual(findings("plugins/tidy/CHANGELOG.md"), [], "history keeps what it says");
});

test("a route names its directories from its own file and writes no root variable, and a plugin-root path in an area's markdown is in the plugin", () => {
  const found = findings(SWEEP).map((l) => l.slice(`FAIL: ${SWEEP}:`.length));
  assert.equal(found.length, 4, found.join("\n"));
  assert.match(found[0], /^10: W\/scripts\/broom\.mjs is not there/);
  assert.match(found[1], /^11: W\/scripts\/pan\.mjs is not quoted; write "W\/scripts\/pan\.mjs" in a command/);
  assert.match(found[2], /^12: a route writes no \$\{CLAUDE_PLUGIN_ROOT\}: read by path it is not filled in/);
  assert.match(found[3], /^13: R\/scripts\/pan\.mjs is under `R`, which this file does not declare/);
  const readme = findings(`${TIDY_AREA}/README.md`);
  assert.equal(readme.length, 1, readme.join("\n"));
  assert.match(readme[0], /README\.md:3: \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/tidy\/scripts\/mop\.mjs is not in plugins\/\w+/);
});

// Two lists that stop matching without a word when a name moves: the agents
// the session hook says nothing to, and the prefix the host gives a mod's tools.
test("a DENYLIST entry names an agent its plugin ships, and the mod's tools carry the prefix of the plugin that loads it", () => {
  assert.match(broken(), new RegExp(`^FAIL: DENYLIST entry "${GONE}" matches no agent: plugins/code-diet/agents/nobody\\.md is not there`, "m"));
  assert.match(broken(), new RegExp(`^FAIL: DENYLIST entry "${WAS}" names an agent by the plugin it was in; tidy is an area of ${ONE}, so the host names it ${ONE}:critic`, "m"));
  assert.match(broken(), /^FAIL: plugins\/agent-works\/hooks\/kanban\/register\.mjs answers mcp__kanban__\w+; the mod's tools are mcp__agent-works__<tool>/m);
});
