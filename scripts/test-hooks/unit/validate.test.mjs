// validate.mjs against a copy of this checkout with one thing broken at a
// time. Each case asserts the finding it expects, not only the exit code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runNode, tree } from "./helpers.mjs";

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
  const result = validate(tree(t, { remove: ["scripts/plugins/code-diet.json"] }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: plugins\/code-diet\/hooks\/kernel_inject\.py is not Node/m);
  assert.match(result.stdout, /^FAIL: code-diet\/ladder: frontmatter key "license" is not one of the four allowed/m);
});

test("a new plugin that meets every rule passes without a flag", (t) => {
  const result = validate(tree(t, withTidy()));
  assert.equal(result.status, 0, result.stdout);
});

test("a legacy flag on a plugin that no longer needs it fails", (t) => {
  const result = validate(tree(t, withTidy({ "scripts/plugins/tidy.json": '{\n  "legacy": true\n}\n' })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: tidy no longer needs its legacy flag: delete scripts\/plugins\/tidy\.json/m);
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
const command = (file) => ({ hooks: [{ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"` }] });

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
