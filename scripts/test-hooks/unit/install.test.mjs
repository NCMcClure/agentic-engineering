// install.mjs against a throwaway config directory: what it writes, what it
// leaves alone, that --uninstall puts back what it found, and what it does
// with a stub: never installs one, and retires the copy an earlier run left
// under one's name.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AREA_PLUGIN } from "../../lib.mjs";
import { REPO, runNode } from "./helpers.mjs";

const MARKET = "agentic-engineering";
const KEY = `${AREA_PLUGIN}@${MARKET}`;
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, "plugins", AREA_PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
// A stub: the old name of a plugin that is an area now.
const STUB = "agent-works";
const STUB_KEY = `${STUB}@${MARKET}`;

function config(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (rel, value) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  };
  for (const [rel, value] of Object.entries(files)) put(rel, value);
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
  const run = (...args) => runNode("scripts/install.mjs", args, { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
  return { dir, read, run, put, cache: (...rel) => path.join(dir, "plugins", "cache", MARKET, ...rel) };
}

/** A config directory as an earlier install of the stub's plugin left it: a cached version, a user-scope record, the enable flag, and its data. */
function earlier(t) {
  const c = config(t);
  const cached = c.cache(STUB, "1.4.0");
  c.put(path.relative(c.dir, path.join(cached, ".claude-plugin", "plugin.json")), { name: STUB, version: "1.4.0" });
  c.put("plugins/installed_plugins.json", { version: 2, plugins: { [STUB_KEY]: [{ scope: "user", installPath: cached, version: "1.4.0" }], "other@elsewhere": [{ scope: "user", installPath: "x", version: "1.0.0" }] } });
  c.put("settings.json", { theme: "dark", enabledPlugins: { [STUB_KEY]: true, "other@elsewhere": true } });
  c.put(`plugins/data/${STUB}-${MARKET}/board.json`, { kept: true });
  return { ...c, cached };
}

test("a bare install writes agentcraft alone: the cached copy, both registries, and the enable flag", (t) => {
  const { read, run, cache } = config(t, { "settings.json": { theme: "dark", enabledPlugins: { "other@elsewhere": true } } });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^1 plugin\(s\) installed\./m);
  const cached = cache(AREA_PLUGIN, VERSION);
  assert.ok(fs.existsSync(path.join(cached, ".claude-plugin", "plugin.json")));
  assert.ok(fs.existsSync(path.join(cached, "skills", "start-here", "SKILL.md")));
  assert.deepEqual(fs.readdirSync(cache()), [AREA_PLUGIN], "no stub is copied");
  const installed = read("plugins/installed_plugins.json").plugins;
  assert.deepEqual(Object.keys(installed), [KEY]);
  const [entry] = installed[KEY];
  assert.deepEqual({ scope: entry.scope, installPath: entry.installPath, version: entry.version }, { scope: "user", installPath: cached, version: VERSION });
  assert.deepEqual(read("settings.json"), { theme: "dark", enabledPlugins: { "other@elsewhere": true, [KEY]: true } });
  assert.equal(read("plugins/known_marketplaces.json")[MARKET].source.path, REPO);
});

test("--dry-run writes nothing", (t) => {
  const { dir, run } = config(t);
  const result = run("--dry-run");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^would copy /m);
  assert.match(result.stdout, /^1 plugin\(s\) would be installed\.$/m);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a project's own install of the same plugin survives install and uninstall", (t) => {
  const project = { scope: "project", projectPath: "somewhere", installPath: "elsewhere", version: "0.0.1" };
  const { read, run } = config(t, { "plugins/installed_plugins.json": { version: 2, plugins: { [KEY]: [project] } } });
  assert.equal(run().status, 0);
  assert.deepEqual(read("plugins/installed_plugins.json").plugins[KEY].map((e) => e.scope), ["project", "user"]);
  assert.equal(run("--uninstall").status, 0);
  assert.deepEqual(read("plugins/installed_plugins.json").plugins[KEY], [project]);
});

test("a marketplace of the same name from another source is refused, then parked by --force and restored by --uninstall", (t) => {
  const theirs = { source: { source: "github", repo: "someone/agentic-engineering" }, installLocation: "their-clone", lastUpdated: "2026-01-01T00:00:00.000Z" };
  const { dir, read, run, cache } = config(t, { "plugins/known_marketplaces.json": { [MARKET]: theirs, other: { source: { source: "github", repo: "a/b" } } } });

  const refused = run();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /A different marketplace is already registered as "agentic-engineering"/);
  assert.deepEqual(read("plugins/known_marketplaces.json")[MARKET], theirs);
  assert.ok(!fs.existsSync(path.join(dir, "plugins", "cache")));

  assert.equal(run("--force").status, 0);
  assert.equal(read("plugins/known_marketplaces.json")[MARKET].source.source, "directory");

  assert.equal(run("--uninstall").status, 0);
  const known = read("plugins/known_marketplaces.json");
  assert.deepEqual(known[MARKET], theirs);
  assert.ok(known.other);
  assert.equal(read("plugins/installed_plugins.json").plugins[KEY], undefined);
  assert.equal(read("settings.json").enabledPlugins[KEY], undefined);
  assert.ok(!fs.existsSync(cache(AREA_PLUGIN)));
});

test("a plugin the checkout does not ship is refused before anything is written", (t) => {
  const { dir, run } = config(t);
  const result = run("--plugins", "no-such-plugin");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^not in this checkout: no-such-plugin; it ships agentcraft$/m);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("a stub is never installed: asked for by name it is refused, with where it moved", (t) => {
  const { dir, run } = config(t);
  const result = run("--plugins", STUB);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.trim(), `not in this checkout: ${STUB}; it ships ${AREA_PLUGIN} (${STUB} moved into ${AREA_PLUGIN})`);
  assert.deepEqual(fs.readdirSync(dir), [], "nothing is written");
  const both = run("--plugins", `${AREA_PLUGIN},${STUB}`);
  assert.equal(both.status, 2, "one stub in the list refuses the whole run");
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("every plugin directory but agentcraft is a stub to the installer, which is how the gate tells one too", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, ".claude-plugin", "marketplace.json"), "utf8"));
  const local = catalog.plugins.filter((p) => typeof p.source === "string").map((p) => p.name);
  const depends = (name) => [].concat(JSON.parse(fs.readFileSync(path.join(REPO, "plugins", name, ".claude-plugin", "plugin.json"), "utf8")).dependencies ?? []);
  assert.deepEqual(local.filter((name) => !depends(name).includes(AREA_PLUGIN)), [AREA_PLUGIN]);
});

test("an install retires the copy an earlier run left under a stub's name, and leaves its data alone", (t) => {
  const { dir, read, run, cache, cached } = earlier(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`remove ${cached}`), result.stdout);
  assert.ok(!fs.existsSync(cache(STUB)), "the old plugin's cached versions are gone, and its empty folder with them");
  const installed = read("plugins/installed_plugins.json").plugins;
  assert.deepEqual(Object.keys(installed).sort(), [KEY, "other@elsewhere"].sort(), "its user-scope record is dropped, another plugin's stays");
  assert.deepEqual(read("settings.json"), { theme: "dark", enabledPlugins: { "other@elsewhere": true, [KEY]: true } });
  assert.deepEqual(read(`plugins/data/${STUB}-${MARKET}/board.json`), { kept: true }, "the old plugin's data folder is where an area copies its state from");
  assert.ok(fs.existsSync(path.join(dir, "plugins", "cache", MARKET, AREA_PLUGIN, VERSION)));
});

test("a version of a stub's plugin that another scope still points at stays on disk, with that scope's record", (t) => {
  const { read, run, put, cache } = earlier(t);
  const kept = cache(STUB, "1.3.0");
  fs.mkdirSync(kept, { recursive: true });
  const project = { scope: "project", projectPath: "somewhere", installPath: kept, version: "1.3.0" };
  const records = read("plugins/installed_plugins.json");
  records.plugins[STUB_KEY].unshift(project);
  put("plugins/installed_plugins.json", records);
  assert.equal(run().status, 0);
  assert.deepEqual(fs.readdirSync(cache(STUB)), ["1.3.0"], "only the version nothing points at is removed");
  assert.deepEqual(read("plugins/installed_plugins.json").plugins[STUB_KEY], [project]);
});

test("a stub with no folder under this marketplace's cache is left alone, enable flag and all", (t) => {
  const { read, run } = config(t, {
    "settings.json": { enabledPlugins: { [STUB_KEY]: true } },
    "plugins/installed_plugins.json": { version: 2, plugins: { [STUB_KEY]: [{ scope: "user", installPath: "from-the-host", version: "2.0.0" }] } },
  });
  assert.equal(run().status, 0);
  assert.equal(read("settings.json").enabledPlugins[STUB_KEY], true, "a flag set by hand, or by the host for the stub itself, stays");
  assert.equal(read("plugins/installed_plugins.json").plugins[STUB_KEY].length, 1);
});

test("--dry-run says what it would retire and writes none of it, and --uninstall retires too", (t) => {
  const { read, run, cache, cached } = earlier(t);
  const dry = run("--dry-run");
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(dry.stdout.includes(`would remove ${cached}`), dry.stdout);
  assert.match(dry.stdout, /^would write .*installed_plugins\.json: dropped the user-scope install of agent-works, which moved into agentcraft$/m);
  assert.match(dry.stdout, /^would write .*settings\.json: dropped enabledPlugins for agent-works$/m);
  assert.ok(fs.existsSync(cached), "nothing was removed");
  assert.equal(read("settings.json").enabledPlugins[STUB_KEY], true);
  assert.ok(!fs.existsSync(cache(AREA_PLUGIN)));

  const off = run("--uninstall");
  assert.equal(off.status, 0, off.stderr);
  assert.ok(!fs.existsSync(cache(STUB)));
  assert.equal(read("plugins/installed_plugins.json").plugins[STUB_KEY], undefined);
  assert.equal(read("settings.json").enabledPlugins[STUB_KEY], undefined);
});
