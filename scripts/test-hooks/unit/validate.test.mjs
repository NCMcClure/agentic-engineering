// validate.mjs against a copy of this checkout with one thing broken at a
// time. Each case asserts the finding it expects, not only the exit code.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hookCommand } from "../../lib.mjs";
import { REPO, runNode, tree } from "./helpers.mjs";

const CATALOG = ".claude-plugin/marketplace.json";
const validate = (dir, ...args) => runNode("scripts/validate.mjs", ["--root", dir, ...args]);
const entry = (name, fn) => (m) => ({ ...m, plugins: m.plugins.map((p) => (p.name === name ? fn(p) : p)) });

// A plugin that meets every rule with no legacy flag: what a new one looks like.
const TIDY = {
  "plugins/tidy/.claude-plugin/plugin.json": `${JSON.stringify({ name: "tidy", version: "0.1.0", description: "A plugin with nothing to waive." }, null, 2)}\n`,
  "plugins/tidy/README.md": "# tidy\n\nNothing to waive.\n",
  "plugins/tidy/CHANGELOG.md": "# Changelog\n\n- **0.1.0**: first release.\n",
  "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\n---\n\n# sweep\n",
};
const withTidy = (extra = {}) => ({
  json: { [CATALOG]: (m) => ({ ...m, plugins: [...m.plugins, { name: "tidy", source: "./plugins/tidy", description: "Nothing to waive.", category: "testing" }] }) },
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

// The ratchet: a legacy flag waives the Node-only rules, and only for as long
// as the plugin breaks one of them.
test("a plugin with no legacy flag is held to the Node-only rules", (t) => {
  const result = validate(tree(t, { ...withTidy({ "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\nlicense: MIT\n---\n\n# sweep\n" }), remove: ["scripts/plugins/write-like-me.json"] }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/write-like-me\/hooks\/session_start\.py is not Node/m);
  assert.match(result.stdout, /^FAIL: tidy\/sweep: frontmatter key "license" is not one of the four allowed/m);
});

test("a new plugin that meets every rule passes without a flag", (t) => {
  const result = validate(tree(t, withTidy()));
  assert.equal(result.status, 0, result.stdout);
});

test("a legacy flag on a plugin that no longer needs it fails", (t) => {
  const result = validate(tree(t, withTidy({ "scripts/plugins/tidy.json": '{\n  "legacy": true\n}\n' })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: tidy no longer needs its legacy flag: remove it from scripts\/plugins\/tidy\.json/m);
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
const shares = (name, list) => ({ [`scripts/plugins/${name}.json`]: (m) => ({ ...m, shared: list }) });

test("a shared copy that is missing or has drifted fails, and sync-shared --write repairs both", (t) => {
  const dir = tree(t, { json: shares("write-like-me", ["hooks/critical-context.mjs"]), write: { "plugins/workflow-studio/hooks/critical-context.mjs": `${KERNEL}// edited here\n` } });
  const data = (shared) => fs.writeFileSync(path.join(dir, "scripts/plugins/workflow-studio.json"), `${JSON.stringify({ legacy: true, shared })}\n`);
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
  const result = validate(tree(t, { json: shares("write-like-me", ["../docs-parity/hooks/critical-context.mjs"]) }));
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
    json: { ...speaks("docs-parity", {}, { shared: [], events: ["SessionStart"] }).json, "scripts/plugins/docs-parity.json": (m) => ({ legacy: m.legacy }) },
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
