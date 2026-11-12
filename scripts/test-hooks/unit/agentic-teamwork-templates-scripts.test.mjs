// The two small scripts agentic-teamwork ships into a repo beside its check:
// lane.mjs, which runs a test lane by name, and plugin-check.mjs, the tracked
// session hook that offers the plugin to a person whose Claude Code does not
// run it. Each plugin-check case gets its own config dir, so nothing reads the
// developer's own settings.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const SCRIPTS = path.join(REPO, "plugins", "agentic-teamwork", "templates", "common", ".agents", "scripts");
const ship = (dir, script) => write(dir, `.agents/scripts/${script}`, fs.readFileSync(path.join(SCRIPTS, script), "utf8"));

// ---------------------------------------------------------------------------
// lane.mjs

function laneRepo(t, lanes) {
  const dir = tempDir(t, "lane-");
  ship(dir, "lane.mjs");
  if (lanes !== undefined) write(dir, ".agents/manifest.json", JSON.stringify({ lanes }));
  // Exits 0 only when the flag the lane command sets reached it; echoes its arguments.
  write(dir, "check.mjs", 'console.log(`flag=${process.env.LANE_FLAG ?? ""} args=${process.argv.slice(2).join(",")}`);\nprocess.exitCode = process.env.LANE_FLAG === "1" ? 0 : 3;\n');
  return dir;
}
const lane = (dir, args) => runNode(path.join(dir, ".agents", "scripts", "lane.mjs"), args, { cwd: REPO });

test("lane runs the named lane's command from the repo root, with its exit code", (t) => {
  const dir = laneRepo(t, { unit: "node check.mjs", integration: "LANE_FLAG=1 node check.mjs" });
  const failed = lane(dir, ["unit"]);
  assert.equal(failed.status, 3, failed.stdout + failed.stderr);
  assert.match(failed.stdout, /^lane: unit: node check\.mjs$/m);
  const passed = lane(dir, ["integration"]);
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /flag=1/, "a leading NAME=value is set in the command's environment on every platform");
});

test("lane passes extra arguments on to the command", (t) => {
  const dir = laneRepo(t, { unit: "LANE_FLAG=1 node check.mjs" });
  const result = lane(dir, ["unit", "--only", "one"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /args=--only,one/);
});

test("a lane that is not wired is skipped out loud, and passes", (t) => {
  const dir = laneRepo(t, { unit: "node check.mjs", live: "not wired: add one the day this repo calls a model" });
  const result = lane(dir, ["live"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "lane: live skipped, not wired: add one the day this repo calls a model\n");
});

test("--list prints every lane and its command", (t) => {
  const dir = laneRepo(t, { unit: "node check.mjs", e2e: "not wired: no browser lane" });
  const result = lane(dir, ["--list"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "unit: node check.mjs\ne2e: not wired: no browser lane\n");
});

test("no lane named, an unknown lane, and no marker are usage errors", (t) => {
  const dir = laneRepo(t, { unit: "node check.mjs" });
  assert.equal(lane(dir, []).status, 2);
  const unknown = lane(dir, ["smoke"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no "smoke" lane; this repo has unit/);
  const bare = lane(laneRepo(t), ["unit"]);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /no readable `lanes`/);
});

// ---------------------------------------------------------------------------
// plugin-check.mjs

const PLUGIN = "agentic-teamwork@agentic-engineering";
const OFFER = "Tell the person once";

/** A repo carrying the script, and a config dir with these settings and install records. */
function fixture(t, { enabled = {}, installed = [], local = null } = {}) {
  const { dir, git } = tempRepo(t, "plugin-check-");
  ship(dir, "plugin-check.mjs");
  if (local) write(dir, ".claude/settings.local.json", JSON.stringify({ enabledPlugins: local }));
  const config = tempDir(t, "plugin-check-home-");
  write(config, "settings.json", JSON.stringify({ enabledPlugins: enabled }));
  write(config, "plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: Object.fromEntries(installed.map((p) => [p, [{ scope: "user", version: "1.0.0" }]])) }));
  return { dir, git, config };
}

function check({ dir, config }, env = {}) {
  const base = { ...process.env };
  delete base.CLAUDE_CODE_REMOTE;
  const result = runNode(path.join(dir, ".agents", "scripts", "plugin-check.mjs"), [], {
    cwd: dir, env: { ...base, CLAUDE_CONFIG_DIR: config, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ...env },
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: dir }),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  if (!result.stdout.trim()) return null;
  const out = JSON.parse(result.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
  return out.hookSpecificOutput.additionalContext;
}

test("silent when the plugin is installed and enabled", (t) => {
  assert.equal(check(fixture(t, { enabled: { [PLUGIN]: true }, installed: [PLUGIN] })), null);
});

test("not installed: one line that reaches the model, with the two commands and the way to say no", (t) => {
  const line = check(fixture(t));
  assert.ok(line, "an offer");
  assert.equal(line.includes("\n"), false, "one line");
  assert.ok(line.includes(OFFER));
  assert.match(line, /It is not installed: they type \/plugin marketplace add \S+ and then \/plugin install agentic-teamwork@agentic-engineering themselves/);
  assert.match(line, /git config --local agentic-engineering\.plugins "off Test \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z"/);
});

test("installed but not enabled: enabling is the fix", (t) => {
  for (const enabled of [{ [PLUGIN]: false }, {}]) {
    const line = check(fixture(t, { enabled, installed: [PLUGIN] }));
    assert.match(line, /It is installed and turned off/);
    assert.match(line, /enabledPlugins/);
    assert.doesNotMatch(line, /marketplace add/);
  }
});

test("the repo's own settings count, the local file last", (t) => {
  const on = fixture(t, { installed: [PLUGIN] });
  write(on.dir, ".claude/settings.json", JSON.stringify({ enabledPlugins: { [PLUGIN]: true } }));
  assert.equal(check(on), null, "enabled for the project");
  const off = fixture(t, { enabled: { [PLUGIN]: true }, installed: [PLUGIN], local: { [PLUGIN]: false } });
  assert.match(check(off), /turned off/);
});

test("another plugin being off or absent is none of its business", (t) => {
  assert.equal(check(fixture(t, { enabled: { [PLUGIN]: true, "code-diet@agentic-engineering": false }, installed: [PLUGIN] })), null);
});

test("a person with no Claude settings at all gets the offer", (t) => {
  const f = fixture(t);
  assert.ok(check({ ...f, config: path.join(f.config, "absent") }).includes(OFFER));
});

test("silent once the person said no in this clone, and only then", (t) => {
  const f = fixture(t);
  f.git("config", "--local", "agentic-engineering.plugins", "off Test 2026-11-09T20:00Z");
  assert.equal(check(f), null);
  f.git("config", "--local", "agentic-engineering.plugins", "on Test 2026-11-09T20:00Z");
  assert.ok(check(f), "a yes that did not take still offers");
});

test("silent in a cloud session, which loads no marketplace plugins", (t) => {
  assert.equal(check(fixture(t), { CLAUDE_CODE_REMOTE: "true" }), null);
});

test("fails open: unreadable settings, malformed stdin and no stdin still exit 0 with nothing on stderr", (t) => {
  const f = fixture(t);
  write(f.config, "settings.json", "{ not json");
  for (const input of ["", "{ not json", "null"]) {
    const result = runNode(path.join(f.dir, ".agents", "scripts", "plugin-check.mjs"), [], { cwd: f.dir, input, env: { ...process.env, CLAUDE_CONFIG_DIR: f.config } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
  }
});
