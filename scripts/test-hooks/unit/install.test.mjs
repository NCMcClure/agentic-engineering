// install.mjs against a throwaway config directory: what it writes, what it
// leaves alone, and that --uninstall puts back what it found.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode } from "./helpers.mjs";

const KEY = "code-diet@agentic-engineering";
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, "plugins/code-diet/.claude-plugin/plugin.json"), "utf8")).version;

function config(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, value] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `${JSON.stringify(value, null, 2)}\n`);
  }
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
  const run = (...args) => runNode("scripts/install.mjs", args, { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
  return { dir, read, run, install: (...args) => run("--plugins", "code-diet", ...args) };
}

test("install writes the cached copy, both registries, and the enable flag", (t) => {
  const { dir, read, install } = config(t, { "settings.json": { theme: "dark", enabledPlugins: { "other@elsewhere": true } } });
  const result = install();
  assert.equal(result.status, 0, result.stderr);
  const cached = path.join(dir, "plugins", "cache", "agentic-engineering", "code-diet", VERSION);
  assert.ok(fs.existsSync(path.join(cached, ".claude-plugin", "plugin.json")));
  const [entry] = read("plugins/installed_plugins.json").plugins[KEY];
  assert.deepEqual({ scope: entry.scope, installPath: entry.installPath, version: entry.version }, { scope: "user", installPath: cached, version: VERSION });
  assert.deepEqual(read("settings.json"), { theme: "dark", enabledPlugins: { "other@elsewhere": true, [KEY]: true } });
  assert.equal(read("plugins/known_marketplaces.json")["agentic-engineering"].source.path, REPO);
});

test("--dry-run writes nothing", (t) => {
  const { dir, install } = config(t);
  const result = install("--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^would copy /m);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a project's own install of the same plugin survives install and uninstall", (t) => {
  const project = { scope: "project", projectPath: "somewhere", installPath: "elsewhere", version: "0.0.1" };
  const { read, install } = config(t, { "plugins/installed_plugins.json": { version: 2, plugins: { [KEY]: [project] } } });
  assert.equal(install().status, 0);
  assert.deepEqual(read("plugins/installed_plugins.json").plugins[KEY].map((e) => e.scope), ["project", "user"]);
  assert.equal(install("--uninstall").status, 0);
  assert.deepEqual(read("plugins/installed_plugins.json").plugins[KEY], [project]);
});

test("a marketplace of the same name from another source is refused, then parked by --force and restored by --uninstall", (t) => {
  const theirs = { source: { source: "github", repo: "someone/agentic-engineering" }, installLocation: "their-clone", lastUpdated: "2026-01-01T00:00:00.000Z" };
  const { dir, read, install } = config(t, { "plugins/known_marketplaces.json": { "agentic-engineering": theirs, other: { source: { source: "github", repo: "a/b" } } } });

  const refused = install();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /A different marketplace is already registered as "agentic-engineering"/);
  assert.deepEqual(read("plugins/known_marketplaces.json")["agentic-engineering"], theirs);
  assert.ok(!fs.existsSync(path.join(dir, "plugins", "cache")));

  assert.equal(install("--force").status, 0);
  assert.equal(read("plugins/known_marketplaces.json")["agentic-engineering"].source.source, "directory");

  assert.equal(install("--uninstall").status, 0);
  const known = read("plugins/known_marketplaces.json");
  assert.deepEqual(known["agentic-engineering"], theirs);
  assert.ok(known.other);
  assert.equal(read("plugins/installed_plugins.json").plugins[KEY], undefined);
  assert.equal(read("settings.json").enabledPlugins[KEY], undefined);
  assert.ok(!fs.existsSync(path.join(dir, "plugins", "cache", "agentic-engineering", "code-diet")));
});

test("a plugin the checkout does not ship is refused before anything is written", (t) => {
  const { dir, run } = config(t);
  const result = run("--plugins", "no-such-plugin");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not in this checkout: no-such-plugin/);
  assert.deepEqual(fs.readdirSync(dir), []);
});
