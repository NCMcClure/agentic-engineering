#!/usr/bin/env node
// Case-driven hook tests: one JSON file per case.
//
// These run a hook the way the host does: through the command its plugin's
// hooks.json registers, with one JSON payload on stdin, reading stdout and the
// exit code. That is the contract a host depends on, and the one a refactor
// inside the script can break without any unit test noticing. Because the
// command comes from hooks.json, a case does not care what language the hook
// is written in.
//
// A case is scripts/test-hooks/cases/<plugin>/<hook>.<n>.json:
//
//   {
//     "script":  "git-guard.sh",          // the hook file, as its hooks.json command names it
//     "event":   "PreToolUse",            // the hooks.json event the command is registered under
//     "fixture": "adopted",               // fixtures.mjs kind the hook runs in (cwd); default "adopted"
//     "project": "bare",                  // fixtures.mjs kind CLAUDE_PROJECT_DIR points at, when it is
//                                         // not the cwd: a session working in another work tree
//     "stdin":   { ... } | "<raw string>",// object is stringified; string is literal
//     "env":     { "NAME": "value" },     // extra environment, optional
//     "gap":     "what is wrong today",   // a known defect: the case states the behavior wanted, is
//                                         // expected to fail, and fails the lane once it passes, so
//                                         // the fix removes the line
//     "expect": {
//       "exit": 0,
//       "stdoutJson": { "keysPresent": ["hookSpecificOutput"] },
//       "stdoutEmpty": true,              // instead of stdoutJson: no output at all
//       "stderrIncludes": "..."           // optional
//     }
//   }
//
// `{{REPO}}` in stdin and env values is the fixture's path and `{{PROJECT}}`
// the project fixture's, the two things a case cannot know when it is written.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseHookCommand } from "../lib.mjs";
import { REPO, makeFixture } from "./fixtures.mjs";

const CASES = path.join(import.meta.dirname, "cases");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-cases-"));
// The hooks' own state (a session registry, a writing profile) belongs to the
// person; the cases get an empty home so they neither read nor write it.
const home = path.join(root, "home");
fs.mkdirSync(home);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const built = new Map();
const fixture = (kind) => {
  if (!built.has(kind)) built.set(kind, makeFixture(root, kind));
  return built.get(kind);
};

const files = fs.readdirSync(CASES, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .flatMap((plugin) => fs.readdirSync(path.join(CASES, plugin.name))
    .filter((f) => f.endsWith(".json")).sort()
    .map((f) => ({ plugin: plugin.name, file: f, path: path.join(CASES, plugin.name, f) })));

assert.ok(files.length, `no cases found under ${CASES}`);

const hooksJson = (plugin) => JSON.parse(fs.readFileSync(path.join(REPO, "plugins", plugin, "hooks", "hooks.json"), "utf8")).hooks ?? {};

/** The hooks.json entry that runs this script on this event. */
function registered(plugin, event, script) {
  for (const group of hooksJson(plugin)[event] ?? []) {
    for (const hook of group.hooks ?? []) if (String(hook.command ?? "").includes(`/${script}`)) return hook;
  }
  return null;
}

/**
 * Run one hook as the host would: exec form when the entry carries args, a
 * shell otherwise. Windows may have no sh, so a Node hook is run there as the
 * command its guard leads to.
 */
function runHook(plugin, hook, { cwd, env, input }) {
  const options = { cwd, env, input, encoding: "utf8", timeout: 60_000 };
  if (Array.isArray(hook.args)) {
    const expand = (s) => String(s).split("${CLAUDE_PLUGIN_ROOT}").join(env.CLAUDE_PLUGIN_ROOT);
    return spawnSync(expand(hook.command), hook.args.map(expand), options);
  }
  const node = process.platform === "win32" ? parseHookCommand(hook.command, plugin) : null;
  if (node) return spawnSync(process.execPath, [path.join(env.CLAUDE_PLUGIN_ROOT, node.script), ...node.args], options);
  return spawnSync("sh", ["-c", hook.command], options);
}

// Every Node hook a plugin ships must have the three mandatory cases, so a new
// hook cannot arrive untested.
const shipped = (plugin) => {
  const dir = path.join(REPO, "plugins", plugin, "hooks");
  const commands = fs.readFileSync(path.join(dir, "hooks.json"), "utf8");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".mjs") && commands.includes(`/hooks/${f}`));
};
for (const plugin of new Set(files.map((f) => f.plugin))) {
  for (const hook of shipped(plugin)) {
    test(`${plugin}/${hook} has happy path, empty stdin, and malformed JSON cases`, () => {
      const mine = files.filter((f) => f.plugin === plugin).map((f) => JSON.parse(fs.readFileSync(f.path, "utf8"))).filter((c) => c.script === hook);
      assert.ok(mine.length >= 3, `${hook} has ${mine.length} case(s), needs at least the three mandatory ones`);
      assert.ok(mine.some((c) => c.stdin === ""), `${hook} has no empty-stdin case`);
      assert.ok(mine.some((c) => typeof c.stdin === "string" && c.stdin !== ""), `${hook} has no malformed-JSON case`);
      assert.ok(mine.some((c) => typeof c.stdin === "object"), `${hook} has no happy-path case`);
    });
  }
}

function runCase(plugin, c) {
  const hook = registered(plugin, c.event, c.script);
  assert.ok(hook, `${plugin}'s hooks.json runs no ${c.script} on ${c.event}`);
  const cwd = fixture(c.fixture ?? "adopted");
  const project = c.project ? fixture(c.project) : cwd;
  const fill = (s) => s.split("{{REPO}}").join(cwd).split("{{PROJECT}}").join(project);
  const input = fill(typeof c.stdin === "string" ? c.stdin : JSON.stringify(c.stdin ?? {}));
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_PLUGIN_ROOT: path.join(REPO, "plugins", plugin),
    ...Object.fromEntries(Object.entries(c.env ?? {}).map(([k, v]) => [k, fill(String(v))])),
  };
  const { status, stdout, stderr } = runHook(plugin, hook, { cwd, env, input });
  assert.equal(status, c.expect.exit, `exit ${status}, stderr: ${stderr}`);
  if (c.expect.stderrIncludes) assert.ok(stderr.includes(c.expect.stderrIncludes), `stderr was: ${stderr}`);
  if (c.expect.stdoutEmpty) {
    assert.equal(stdout.trim(), "", `expected no output, got: ${stdout}`);
    return;
  }
  if (!c.expect.stdoutJson) return;
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(stdout); }, `stdout is not JSON: ${stdout}`);
  for (const key of c.expect.stdoutJson.keysPresent ?? []) assert.ok(key in parsed, `stdout has no "${key}": ${stdout}`);
}

for (const { plugin, file, path: casePath } of files) {
  const c = JSON.parse(fs.readFileSync(casePath, "utf8"));
  // A stock Windows has no sh and no python3, so only Node hooks are held to it.
  const skip = process.platform === "win32" && !parseHookCommand(registered(plugin, c.event, c.script)?.command, plugin) ? "not a Node hook, not run on Windows" : false;
  test(`${plugin}/${file}${c.gap ? ` (known gap: ${c.gap})` : ""}`, { skip }, () => {
    if (!c.gap) return runCase(plugin, c);
    let failed = false;
    try { runCase(plugin, c); } catch { failed = true; }
    assert.ok(failed, `this case passes now: the gap is closed, so delete its "gap" line`);
  });
}

// What a spawn cannot show: which sessions a hook is registered for. Context a
// SessionStart hook gives is standing context, so it has to come back when a
// compaction or a /clear throws the conversation away.
const NEEDED = ["startup", "resume", "clear", "compact"];
const KNOWN_GAPS = new Map([["agentic-teamwork", "its briefing is lost at a compaction or a /clear"]]);
for (const plugin of fs.readdirSync(path.join(REPO, "plugins"))) {
  let hooks;
  try { hooks = hooksJson(plugin); } catch { continue; }
  for (const group of hooks.SessionStart ?? []) {
    const gap = KNOWN_GAPS.get(plugin);
    test(`${plugin}: SessionStart "${group.matcher ?? ""}" covers startup, resume, clear, and compact${gap ? ` (known gap: ${gap})` : ""}`, () => {
      const matcher = group.matcher ?? "";
      const covers = !matcher || matcher === "*" || NEEDED.every((s) => new RegExp(`^(?:${matcher})$`).test(s));
      if (gap) assert.ok(!covers, `the matcher covers all four now: drop ${plugin} from KNOWN_GAPS`);
      else assert.ok(covers, `matcher "${matcher}" leaves out ${NEEDED.filter((s) => !new RegExp(`^(?:${matcher})$`).test(s)).join(", ")}`);
    });
  }
}
