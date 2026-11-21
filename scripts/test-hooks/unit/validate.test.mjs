// validate.mjs against a copy of this checkout with one thing broken at a
// time. Each case asserts the finding it expects, not only the exit code.
//
// The tree has one shape: the one plugin, whose skills are the entry skill
// and the areas, and nothing beside it under plugins/. So what a case adds is
// an area (`tidy`, with one route), or a second directory that has no place.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { AREA_PLUGIN as ONE, hookCommand, parseHookCommand } from "../../lib.mjs";
import { REPO, runNode, tree } from "./helpers.mjs";

const CATALOG = ".claude-plugin/marketplace.json";
const gate = (dir, ...args) => runNode("scripts/validate.mjs", ["--root", dir, ...args]);
// A tree with an area added or renamed needs its generated files written
// again; every case but the generator's own wants that done, so it is not
// what fails.
const validate = (dir, ...args) => {
  runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]);
  return gate(dir, ...args);
};
const entry = (name, fn) => (m) => ({ ...m, plugins: m.plugins.map((p) => (p.name === name ? fn(p) : p)) });
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const HOME = `plugins/${ONE}`;
const MANIFEST = `${HOME}/.claude-plugin/plugin.json`;
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, MANIFEST), "utf8")).version;
const ENTRY_DATA = `${HOME}/skills/start-here/start-here.json`;
const ENTRY_FILE = `${HOME}/skills/start-here/SKILL.md`;

// An area that meets every rule: what a new one looks like. Its SKILL.md is
// the generator's to write.
// The area's name is never written beside a colon or an @ here: in a tree
// where it is an area, this file's own lines would be read as its old
// addresses, from when an area was a plugin of its own.
const OLD = "tidy";
const TIDY_AREA = `${HOME}/skills/tidy`;
const SWEEP = `${TIDY_AREA}/routes/sweep/ROUTE.md`;
const route = (name, body = `# ${name}\n\nDo it.\n`, extra = "") => `---\nname: ${name}\ndescription: "Does ${name}. Use when ${name} is wanted."\n${extra}---\n\n${body}`;
const TIDY_DOOR = { lead: "Keeps the floor clean.", default: "sweep", routes: { sweep: { cue: "sweep the floor" } } };
// A person is asked about every area, so a new one joins a group of the entry
// skill's data, with what it is picked for and a route to hand off to.
const askTidy = (d) => ({
  groups: d.groups.map((g, i) => (i === d.groups.length - 1 ? { ...g, areas: [...g.areas, "tidy"] } : g)),
  areas: { ...d.areas, tidy: { cue: "sweep the floor", how: "It sweeps.", uses: [{ want: "a clean floor", to: "sweep" }] } },
});
const withArea = ({ door = TIDY_DOOR, write = {}, text = {}, json: edits = {} } = {}) => ({
  json: { [ENTRY_DATA]: askTidy, ...edits },
  text,
  write: { [`${TIDY_AREA}/door.json`]: json(door), [SWEEP]: route("sweep"), ...write },
});

test("this checkout passes", (t) => {
  const result = validate(tree(t));
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^validate: all green$/m);
  assert.match(result.stdout, /^ok: 13 areas: current, within the caps, user-invocable: false and callable, every route a ROUTE\.md in its table, no SKILL\.md below$/m);
  assert.match(result.stdout, /^ok: 1 plugin directory: /m);
  assert.match(result.stdout, new RegExp(`^ok: no install line names an area or a plugin's old name: the one to install is ${ONE}@agentic-engineering$`, "m"));
  assert.match(result.stdout, /^ok: the entry skill offers 13 areas/m);
});

test("a new area that meets every rule passes", (t) => {
  const result = validate(tree(t, withArea()));
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^ok: 14 areas: /m);
  assert.match(result.stdout, /^ok: \d+ addresses resolve \(.*\), [1-9]\d* of them on through an area to its route$/m);
  assert.match(result.stdout, /^ok: the entry skill offers 14 areas/m);
});

test("a catalog entry with a version key fails", (t) => {
  const result = validate(tree(t, { json: { [CATALOG]: entry(ONE, (p) => ({ ...p, version: "9.9.9" })) } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: entries carry a version key .*: ${ONE}`, "m"));
});

// One shape: the only directory under plugins/ is the one plugin. A second,
// in the catalog or not, is told where what it holds belongs.
test("a second directory under plugins/ fails, with or without a catalog entry", (t) => {
  const files = {
    "plugins/tidy/.claude-plugin/plugin.json": json({ name: "tidy", version: "0.1.0", description: "A plugin with skills of its own." }),
    "plugins/tidy/README.md": "# tidy\n\nSweeps.\n",
    "plugins/tidy/CHANGELOG.md": "# Changelog\n\n- **0.1.0**: first release.\n",
    "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\n---\n\n# sweep\n",
  };
  const finding = new RegExp(`^FAIL: plugins/tidy: the marketplace ships one plugin, ${HOME}, and plugins/ holds no other directory; what is new goes in as an area, ${HOME}/skills/<area>/`, "m");
  const unlisted = validate(tree(t, { write: files }));
  assert.equal(unlisted.status, 1);
  assert.match(unlisted.stdout, finding);
  const listed = validate(tree(t, { json: { [CATALOG]: (m) => ({ ...m, plugins: [...m.plugins, { name: "tidy", source: "./plugins/tidy", description: "Sweeps.", category: "engineering" }] }) }, write: files }));
  assert.equal(listed.status, 1);
  assert.match(listed.stdout, finding);
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
// entry the one version, which plugin.json carries. A README keeps no
// changelog. An area's CHANGELOG.md is its history as a plugin of its own,
// and is held to nothing.
test("the plugin with no CHANGELOG.md fails, and an area without one does not", (t) => {
  const result = validate(tree(t, { remove: [`${HOME}/CHANGELOG.md`] }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${ONE}: missing CHANGELOG\\.md`, "m"));
  const area = validate(tree(t, { remove: [`${HOME}/skills/code-diet/CHANGELOG.md`] }));
  assert.doesNotMatch(area.stdout, /^FAIL: .*CHANGELOG/m);
});

test("a CHANGELOG.md whose top entry is not the plugin.json version fails", (t) => {
  const result = validate(tree(t, { text: { [`${HOME}/CHANGELOG.md`]: (s) => s.replace("# Changelog\n\n", "# Changelog\n\n- **9.9.9**: a version plugin.json does not carry.\n") } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${ONE}: CHANGELOG\\.md top entry is 9\\.9\\.9, plugin\\.json is `, "m"));
});

test("a README that still carries a ## Changelog section fails", (t) => {
  const result = validate(tree(t, { text: { [`${HOME}/README.md`]: (s) => `${s}\n## Changelog\n\n- 0.0.1: history kept in the wrong place.\n` } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${ONE}: README carries a "## Changelog" section`, "m"));
});

// The plugin runs on Node, and a skill's frontmatter carries five keys.
test("the plugin is held to the Node-only rules, and a skill to its five keys", (t) => {
  const result = validate(tree(t, withArea({
    write: { [`${TIDY_AREA}/hooks/guard.py`]: "print('swept')\n" },
    text: { [ENTRY_FILE]: (s) => s.replace("argument-hint:", "license: MIT\nargument-hint:") },
  })));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${TIDY_AREA}/hooks/guard\\.py is not Node`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${ONE}/start-here: frontmatter key "license" is not one of the five allowed`, "m"));
});

test("a file with no extension is judged by its shebang", (t) => {
  const result = validate(tree(t, { write: { [`${HOME}/bin/tidy`]: "#!/bin/sh\necho swept\n", [`${HOME}/bin/sweep`]: "#!/usr/bin/env node\nconsole.log('swept');\n" } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${HOME}/bin/tidy runs under "/bin/sh", not Node`, "m"));
  assert.doesNotMatch(result.stdout, /bin\/sweep/);
});

// Hooks: the plugin has one map. Known events, commands inside the plugin, a
// module the host can load.
const MAP = `${HOME}/hooks/hooks.json`;
const WHERE = `${ONE}/hooks/hooks\\.json`;
const mapped = (fn, write = {}) => ({
  json: { [MAP]: fn },
  write: { [`${HOME}/hooks/start.mjs`]: "process.exitCode = 0;\n", [`${HOME}/hooks/pane.tsx`]: "export {};\n", ...write },
});
const command = (file, { loud = false, ...rest } = {}) => ({ hooks: [{ type: "command", command: hookCommand(ONE, `hooks/${file}`, { loud }), statusMessage: "Tidying", ...rest }] });
const on = (event, ...groups) => (m) => ({ ...m, hooks: { ...m.hooks, [event]: [...(m.hooks[event] ?? []), ...groups] } });
const modules = (...list) => (m) => ({ ...m, modules: [...(m.modules ?? []), ...list] });

test("a hook on a known event that points inside the plugin passes", (t) => {
  const result = validate(tree(t, mapped((m) => modules("./start.mjs")(on("PreToolUse", command("start.mjs"))(m)))));
  assert.equal(result.status, 0, result.stdout);
});

test("an unknown hook event and a command that points at nothing both fail", (t) => {
  const result = validate(tree(t, mapped(on("SessionStarted", command("missing.mjs")))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: "SessionStarted" is not a known hook event`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE} points at hooks/missing\\.mjs, which is not in the plugin`, "m"));
});

test("a hooks module that is missing, outside the plugin, or not .mjs fails", (t) => {
  const result = validate(tree(t, mapped(modules("./missing.mjs", "../../code-diet/README.md", "./pane.tsx"))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: module \\./missing\\.mjs does not exist`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: module \\.\\./\\.\\./code-diet/README\\.md is outside the plugin`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: module \\./pane\\.tsx is not a \\.mjs or \\.js file`, "m"));
});

test("an absolute machine path in a tracked file fails", (t) => {
  const home = ["", "Users", "someone", "checkout"].join("/");
  const file = `${HOME}/skills/code-diet/README.md`;
  const result = validate(tree(t, { text: { [file]: (s) => `${s}\nInstall from ${home}.\n` } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${file.replace(".", "\\.")} carries an absolute machine path`, "m"));
});

test("a Node file that calls process.exit fails, a test's one-line command included, and a comment does not", (t) => {
  const call = ["process", "exit(1)"].join(".");
  const result = validate(tree(t, { write: {
    [`${HOME}/skills/code-diet/scripts/sweep.mjs`]: `console.log("swept");\n${call};\n`,
    [`${HOME}/skills/code-diet/scripts/note.mjs`]: `// never ${call}: set the exit code\nprocess.exitCode = 1;\n`,
    "scripts/test-hooks/unit/tidy.test.mjs": `const FAILING = 'node -e "${call}"';\n`,
  } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${HOME}/skills/code-diet/scripts/sweep\\.mjs:2 calls process\\.exit: set process\\.exitCode and let Node unwind`, "m"));
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
test("a Node hook with no guard, a session start where none tells the person, or no status message fails", (t) => {
  const bare = { hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.mjs"', statusMessage: "Tidying" }] };
  let result = validate(tree(t, mapped(on("PreToolUse", bare))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: the PreToolUse command for hooks/start\\.mjs has no guard for a machine without Node`, "m"));

  // Every SessionStart command made quiet, and one more with nothing to show while it runs.
  const quiet = (h) => {
    const parsed = parseHookCommand(h.command, ONE);
    return parsed?.guard === "loud" ? { ...h, command: hookCommand(ONE, parsed.script, { loud: false }) } : h;
  };
  const hushed = (m) => on("SessionStart", command("start.mjs", { statusMessage: undefined }))({ ...m, hooks: { ...m.hooks, SessionStart: m.hooks.SessionStart.map((g) => ({ ...g, hooks: g.hooks.map(quiet) })) } });
  result = validate(tree(t, mapped(hushed)));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: .*the SessionStart command for hooks\/session-start\.mjs must use the guard that tells the person Node is missing/m);
  assert.match(result.stdout, /^FAIL: .*the SessionStart command for hooks\/start\.mjs has no statusMessage/m);

  result = validate(tree(t, mapped((m) => on("Stop", { hooks: [{ type: "command", command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/start.mjs" && echo done' }] })(on("PreToolUse", command("start.mjs"))(m)))));
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /PreToolUse/, "the quiet guard is enough off session start");
  assert.match(result.stdout, /^FAIL: .*the Stop command is not a guard followed by node/m);
});

test("one SessionStart command tells the person Node is missing: a second loud one, or a loud one on another event, fails", (t) => {
  let result = validate(tree(t, mapped(on("SessionStart", command("start.mjs", { loud: true })))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: the SessionStart command for hooks/start\\.mjs repeats the guard that tells the person Node is missing; hooks/session-start\\.mjs says it, and the rest stay quiet`, "m"));

  result = validate(tree(t, mapped(on("Stop", command("start.mjs", { loud: true })))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${WHERE}: the Stop command for hooks/start\\.mjs uses the guard that tells the person Node is missing; only a SessionStart command does`, "m"));
});

// Shared files: what several areas use sits once, in the one plugin's lib/,
// with a suite of its own name. The folders that held a copy per plugin are gone.
const LIB = `plugins/${ONE}/lib`;
const AREA = (name, rel) => `plugins/${ONE}/skills/${name}/${rel}`;

test("a shared file with no suite of its own fails, and so do the folders that held a copy for each plugin", (t) => {
  const clean = gate(tree(t));
  assert.match(clean.stdout, new RegExp(`^ok: \\d+ shared file\\(s\\) in ${LIB}/, each with a suite$`, "m"));

  const result = gate(tree(t, { write: {
    [`${LIB}/untested.mjs`]: "export const nothing = null;\n",
    "scripts/shared/provider.mjs": "export const copy = true;\n",
    "scripts/plugins/code-diet.json": "{ \"shared\": [] }\n",
  } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${LIB}/untested\\.mjs has no scripts/test-hooks/unit/untested\\.test\\.mjs`, "m"));
  assert.match(result.stdout, /^FAIL: scripts\/shared\/ is still here: one plugin holds one copy of what its areas share/m);
  assert.match(result.stdout, /^FAIL: scripts\/plugins\/ is still here/m);
});

test("the copy a route puts in a user's repo is held equal to the one in lib/", (t) => {
  const copy = AREA("but-first-planning", "routes/spec-init/assets/provider.mjs");
  assert.match(gate(tree(t)).stdout, /^ok: duplicated files hash-equal \(1 copy\/copies present\)$/m);
  const result = gate(tree(t, { text: { [copy]: (s) => `${s}// edited here\n` } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${copy} has drifted from ${LIB}/provider\\.mjs`, "m"));
});

// The session hooks: one helper, each area's lines as data under its cap, and
// a hook map that runs the lines once per event and the briefing once.
const HELPER = `plugins/${ONE}/hooks/critical-context.mjs`;
const line = (text, extra = {}) => ({ for: "all", mode: "any", text, ...extra });
const lines = (name, data) => ({ [AREA(name, "hooks/critical.json")]: `${JSON.stringify({ area: name, ...data }, null, 2)}\n` });
const where = (name) => `FAIL: plugins/${ONE}/skills/${name}/hooks/critical\\.json: `;

test("the areas' critical lines pass within their caps, and the gate prints the total and each command's worst case", (t) => {
  const result = gate(tree(t));
  const [, total, areas, linesWorst, briefingWorst] = /^ok: critical lines within budget \((\d+) of 7500 characters across (\d+) area\(s\)\); the lines command prints at most (\d+) and the briefing (\d+), of 10000$/m.exec(result.stdout) ?? [];
  assert.equal(areas, "7", result.stdout);
  assert.ok(Number(total) <= 7500 && Number(linesWorst) <= 10000 && Number(briefingWorst) <= 10000);
  assert.equal(Number(linesWorst), Number(total) + 1000, "the lines, the question, and the JSON they go out in");
  assert.match(result.stdout, /^ok: \d+ plugin-qualified DENYLIST entr(y|ies): each an agent its plugin ships$/m);
});

test("lines over an area's cap, or with a bad audience, mode or when, or the wrong area name, fail", (t) => {
  const data = { area: "docs", lines: [line("x".repeat(600)), line("Wrong audience.", { for: "everyone" }), line("Wrong mode.", { mode: "sometimes" }), line("Wrong gate.", { when: ["docs", 7] })] };
  const result = gate(tree(t, { write: lines("docs-parity", data) }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}critical lines are \\d+ characters, over the 450 cap`, "m"));
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}"Wrong audience\\." needs for: main or all`, "m"));
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}"Wrong mode\\." needs mode: full, portable, any`, "m"));
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}"Wrong gate\\." needs when: a repo path, or a list of them`, "m"));
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}area is "docs", expected docs-parity`, "m"));
});

test("every area is present, so a chains block and a line that names a partner both fail", (t) => {
  const data = { lines: [line("Shots go through the loop.", { partner: "perceptual-loop" })], chains: [line("Docs change with the code.", { partner: "agent-works" })] };
  const result = gate(tree(t, { write: lines("docs-parity", data) }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}it carries a chains block; a line that waited on another plugin is a line of its own now, behind its own when`, "m"));
  assert.match(result.stdout, new RegExp(`^${where("docs-parity")}"Shots go through the loop\\." names a partner; every area is present`, "m"));
});

test("lines past the total, or a command that could print past what a host shows in full, fail", (t) => {
  const big = Object.assign({}, ...["agent-works", "agentic-teamwork", "perceptual-loop"].map((name) => lines(name, { lines: [line("x".repeat(2600))] })));
  let result = gate(tree(t, { write: big }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: critical lines and the route index total \d+ characters, over the 7500 target/m);

  result = gate(tree(t, { write: Object.assign(big, lines("but-first-planning", { lines: [line("x".repeat(1500))] })) }));
  assert.match(result.stdout, /^FAIL: the lines command can print \d+ characters, over the host's 10000/m);

  result = gate(tree(t, { text: { [HELPER]: (s) => s.replace("export const MIGRATION_CHARS = 4200;", "export const MIGRATION_CHARS = 9000;") } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: the briefing command can print \d+ characters, over the host's 10000/m);
});

test("the route index counts toward the lines' total, and a helper that prints none fails", (t) => {
  // The tree as it is: the lines and the index together are inside the target.
  const here = gate(tree(t));
  const total = Number(/^ok: critical lines within budget \((\d+) of 7500 characters/m.exec(here.stdout)?.[1]);
  assert.ok(total > 6500 && total <= 7500, here.stdout.match(/^ok: critical lines.*$/m)?.[0]);
  // At a 200k window the index is the only text that names every route, so a helper that drops it is a finding.
  const silent = gate(tree(t, { text: { [HELPER]: (s) => s.replace('if (state.mode === "none" || state.subagent || !areas.length) return "";', 'return "";') } }));
  assert.equal(silent.status, 1);
  assert.match(silent.stdout, /^FAIL: .*routeIndex prints nothing for the main session of an opted-in repo/m);
});

test("AREAS in the helper and the caps in the gate name the same areas, each with its lines", (t) => {
  let result = gate(tree(t, { text: { [HELPER]: (s) => s.replace('"perceptual-loop", "system-map"];', '"perceptual-loop", "tidy"];') } }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${HELPER}: AREAS does not list system-map, which CRITICAL_CAPS in scripts/validate\\.mjs gives a cap`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${HELPER}: AREAS lists tidy, which has no cap in CRITICAL_CAPS in scripts/validate\\.mjs`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${HELPER}: AREAS lists tidy, which has no plugins/${ONE}/skills/tidy/hooks/critical\\.json`, "m"));
  assert.match(result.stdout, new RegExp(`^${where("system-map")}system-map is not in AREAS in ${HELPER}, so its lines never print`, "m"));

  result = gate(tree(t, { remove: [AREA("code-diet", "hooks/critical.json")] }));
  assert.match(result.stdout, new RegExp(`^FAIL: ${HELPER}: AREAS lists code-diet, which has no plugins/${ONE}/skills/code-diet/hooks/critical\\.json`, "m"));
});

test("a second copy of the helper, an area's own session hook, and a briefing with no allowance or no file fail", (t) => {
  const result = gate(tree(t, {
    write: {
      [AREA("code-diet", "hooks/critical-context.mjs")]: fs.readFileSync(path.join(REPO, HELPER), "utf8"),
      [AREA("code-diet", "hooks/session-start.mjs")]: "process.exitCode = 0;\n",
      [AREA("code-diet", "hooks/briefing.mjs")]: "export const briefing = () => \"\";\n",
    },
    remove: [AREA("system-map", "hooks/briefing.mjs")],
  }));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${AREA("code-diet", "hooks/critical-context\\.mjs")} is a second copy of the session helper; the one copy is ${HELPER}`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${AREA("code-diet", "hooks/session-start\\.mjs")}: an area has no session hook of its own`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${AREA("code-diet", "hooks/briefing\\.mjs")} has no allowance in BRIEFING_CHARS in ${HELPER}, so the briefing command never loads it`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${HELPER}: BRIEFING_CHARS gives system-map an allowance, and plugins/${ONE}/skills/system-map/hooks/briefing\\.mjs is not there`, "m"));
});

test("a hook map that runs the lines other than once per event, or the briefing other than once at session start, fails", (t) => {
  const session = (file, loud = false) => ({ type: "command", command: hookCommand(ONE, `hooks/${file}`, { loud }), statusMessage: "Reading" });
  const group = (matcher, ...list) => ({ ...(matcher ? { matcher } : {}), hooks: list });
  const STARTS = "startup|resume|clear|compact";
  const map = (fn) => ({ json: { [MAP]: (m) => ({ ...m, hooks: fn(m.hooks) }) } });
  const others = (h) => h.SessionStart.filter((g) => !g.hooks.some((x) => /\/hooks\/(session-start|briefing)\.mjs"$/.test(x.command) && !x.command.includes("/skills/")));

  // The lines twice at session start and never in a subagent; the briefing in a subagent and on Stop.
  let result = gate(tree(t, map((h) => ({
    ...h,
    SessionStart: [group(STARTS, session("session-start.mjs", true)), group(STARTS, session("session-start.mjs")), group(STARTS, session("briefing.mjs")), ...others(h)],
    SubagentStart: [group(null, session("briefing.mjs"))],
    Stop: [...h.Stop, group(null, session("briefing.mjs"))],
  }))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${MAP} runs hooks/session-start\\.mjs 2 time\\(s\\) on SessionStart; it runs once`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${MAP} runs hooks/session-start\\.mjs 0 time\\(s\\) on SubagentStart; it runs once`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${MAP} runs hooks/briefing\\.mjs 1 time\\(s\\) on SubagentStart; it runs never: a subagent gets no briefing`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${MAP} runs hooks/briefing\\.mjs on Stop; it is a session-start command`, "m"));

  // No briefing at all, and the lines only on a fresh start.
  result = gate(tree(t, map((h) => ({ ...h, SessionStart: [group("startup", session("session-start.mjs", true)), ...others(h)] }))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, new RegExp(`^FAIL: ${MAP} runs hooks/briefing\\.mjs 0 time\\(s\\) on SessionStart; it runs once`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: ${MAP}: hooks/session-start\\.mjs runs on SessionStart "startup"; it is "startup\\|resume\\|clear\\|compact", so the context comes back after a compaction and a /clear`, "m"));
});

// The entry skill is the one a person types. Its area tables are generated,
// and the gate holds its data to what a question can offer and to the tree.
const entryData = (fn) => ({ json: { [ENTRY_DATA]: fn } });
const area = (name, fn) => (d) => ({ ...d, areas: { ...d.areas, [name]: fn(d.areas[name]) } });

test("an area the entry skill never asks about fails, and so does one it asks about that is not there", (t) => {
  const unasked = validate(tree(t, { ...withArea(), json: {} }));
  assert.equal(unasked.status, 1);
  assert.match(unasked.stdout, /^FAIL: .*start-here\.json: no group asks about tidy, so a person is never offered it/m);
  const gone = validate(tree(t, entryData((d) => ({ ...d, groups: d.groups.map((g, i) => (i ? g : { ...g, areas: [...g.areas.slice(1), "no-such-area"] })) }))));
  assert.match(gone.stdout, new RegExp(`^FAIL: .*a group names no-such-area, which is not an area of ${ONE}`, "m"));
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

test("a use of the entry skill names a route that is there, and says so when only a person can start it", (t) => {
  const result = validate(tree(t, entryData((d) => area("agentic-teamwork", (a) => ({ ...a, uses: [{ want: "a thing nobody ships", to: "no-such-route" }, { want: "set a repo up", to: "bootstrap" }, { want: "ship it", to: "ship", starts: "person" }] }))(d))));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^FAIL: .*agentic-teamwork hands off to no-such-route, which is not one of its routes/m);
  assert.match(result.stdout, new RegExp(`^FAIL: .*/${ONE}:agentic-teamwork bootstrap is one only a person can start, so its use says "starts": "person"`, "m"));
  assert.match(result.stdout, new RegExp(`^FAIL: .*/${ONE}:agentic-teamwork ship can be started by an agent, so its use carries no "starts": "person"`, "m"));
});

test("an entry skill whose areas section is stale, or that a person could not type, fails", (t) => {
  // The data moved and the skill was not regenerated.
  const dir = tree(t, entryData(area("code-diet", (a) => ({ ...a, cue: "cut what the code does not need" }))));
  assert.match(gate(dir).stdout, new RegExp(`^FAIL: ${ENTRY_FILE.replace(".", "\\.")} is stale: node scripts/gen-guide\\.mjs --write`, "m"));
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
// It lists the plugin with its one version, and each area with its routes as
// an agent's addresses.
test("a plugin guide that is missing or stale fails, and gen-guide --write repairs it", (t) => {
  const dir = tree(t, { json: { [MANIFEST]: (m) => ({ ...m, version: "9.9.9" }) }, text: { [`${HOME}/CHANGELOG.md`]: (s) => s.replace("# Changelog\n\n", "# Changelog\n\n- **9.9.9**: a bump the guide has not seen.\n") } });
  assert.match(gate(dir).stdout, /^FAIL: docs\/plugins\.md is stale: node scripts\/gen-guide\.mjs --write/m);
  assert.equal(runNode("scripts/gen-guide.mjs", ["--root", dir]).status, 1);
  assert.equal(runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]).status, 0);
  const guide = fs.readFileSync(path.join(dir, "docs/plugins.md"), "utf8");
  assert.match(guide, /^Version 9\.9\.9\. /m);
  assert.match(guide, new RegExp(`^Install it with \`/plugin install ${ONE}@agentic-engineering\``, "m"));
  assert.doesNotMatch(guide, /Old names/, "the catalog lists one plugin, and so does the guide");
  assert.equal(gate(dir).status, 0);
  fs.rmSync(path.join(dir, "docs/plugins.md"));
  assert.match(gate(dir).stdout, /^FAIL: docs\/plugins\.md is missing/m);
});

// One version, so one tag form: the plugin's name and the version its plugin.json carries.
test("--tag passes on the plugin's version and fails on any other, an area's name included", (t) => {
  const dir = tree(t);
  const good = gate(dir, "--tag", `${ONE}/v${VERSION}`);
  assert.equal(good.status, 0, good.stdout);
  for (const [tag, finding] of [
    [`${ONE}/v99.0.0`, new RegExp(`^FAIL: tag "${ONE}/v99\\.0\\.0" says 99\\.0\\.0, but .* is at ${VERSION.replaceAll(".", "\\.")}`, "m")],
    ["code-diet/v2.0.0", new RegExp(`^FAIL: tag "code-diet/v2\\.0\\.0" names code-diet; the one release tag is ${ONE}/v<version>$`, "m")],
    ["v0.1.0", new RegExp(`^FAIL: tag "v0\\.1\\.0" is not ${ONE}/v<version>`, "m")],
  ]) {
    const bad = gate(dir, "--tag", tag);
    assert.equal(bad.status, 1, tag);
    assert.match(bad.stdout, finding);
  }
});

// ---- an area, and what names it ------------------------------------------
// One tree with a thing wrong for every rule the shape brings, judged once:
// a copy of the checkout and a run of the gate are what these cases cost.
// The one plugin's name is never written beside a colon here: an address
// under it is held to what it ships, in this file as in any other.
const RENAMED = ["marvelous", "miro"].join("-");
const ROUTE_STEPS = [
  "# sweep",
  "",
  "`W` below is `../..` from the directory this file is in.",
  "",
  "Run `node \"W/scripts/pan.mjs\"`, which is there, then `node \"W/scripts/broom.mjs\"`, which is not.",
  "Unquoted: node W/scripts/pan.mjs --now",
  "Filled in by nothing: `node \"${CLAUDE_PLUGIN_ROOT}/skills/tidy/scripts/pan.mjs\"`.",
  "Copied from another route: `node \"R/scripts/pan.mjs\"`.",
  "What it swept is kept in `${CLAUDE_PLUGIN_DATA}/tidy`.",
  // A directory of the repo the route works in, declared by what it is: nothing here resolves it, and nothing is said.
  "`P` below is the workspace this run works in. Read `P/spec/index.md`, then run `node P/plan/status.mjs`.",
  "",
].join("\n");
const PAGE = [`Run /${OLD}:sweep.`, `Or /${RENAMED}:sweep.`, `Or /${ONE}:brush.`, `Or \`/${ONE}:tidy mop\`.`, `Or /${ONE}:nothing.`, `This works: \`/${ONE}:tidy sweep\`, and so does /${ONE}:tidy.`].join("\n");
// Built, never written out: an entry here is an address to this file's own gate.
const GONE = [ONE, "nobody"].join(":"), WAS = [OLD, "critic"].join(":");
const cleanups = [];
after(() => { for (const fn of cleanups) fn(); });
let brokenOnce;
const broken = () => (brokenOnce ??= (() => {
  const dir = tree({ after: (fn) => cleanups.push(fn) }, withArea({
    door: { lead: "", default: "mop", routes: { sweep: { cue: "" }, wipe: { cue: "wipe the table", starts: "nobody" } } },
    write: {
      // A second directory under plugins/, with a skill of its own and no catalog entry.
      "plugins/tidy/skills/sweep/SKILL.md": "---\nname: sweep\ndescription: Use when the floor needs sweeping.\n---\n\n# sweep\n",
      [`${TIDY_AREA}/CHANGELOG.md`]: `# Changelog\n\n- **1.0.0**: moved in as the tidy area; /${OLD}:sweep is history.\n`,
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
      "README.md": (s) => `${s}\nTo sweep, run \`/plugin install ${OLD}@agentic-engineering\`. To go back, \`/plugin uninstall ${OLD}@agentic-engineering\`.\n`,
      [`${HOME}/hooks/critical-context.mjs`]: (s) => s.replace(/(export const DENYLIST = new Set\(\[[^\]]*)\]/, (whole, head) => `${head}, "${GONE}", "${WAS}"]`),
      [`${HOME}/skills/agent-works/hooks/kanban/register.mjs`]: (s) => s.replaceAll(`mcp__${ONE}__`, "mcp__kanban__"),
    },
  }));
  runNode("scripts/gen-guide.mjs", ["--root", dir, "--write"]);
  // The area as the generator wrote it, then made hidden, and its block doubled.
  const file = path.join(dir, `${TIDY_AREA}/SKILL.md`);
  const text = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, `${text.replace("user-invocable: false\n", "disable-model-invocation: true\n")}\n${text.slice(text.indexOf("## Route"))}`);
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
    /^FAIL: \S+\/polish: a skill of \S+ is start-here or an area; this one is neither/m,
  ]) assert.match(broken(), finding);
});

test("an area the generator did not write is stale, and one made hidden or given a second block is refused", () => {
  assert.match(broken(), /^FAIL: plugins\/\S+\/skills\/tidy\/SKILL\.md is stale or missing; run node scripts\/gen-guide\.mjs --write/m);
  assert.match(broken(), /^FAIL: \S+\/tidy: an area carries user-invocable: false/m);
  assert.match(broken(), /^FAIL: \S+\/tidy: an area stays callable: disable-model-invocation: true hides it from the model/m);
  assert.match(broken(), /^FAIL: \S+\/tidy: the area holds 2 end markers and 2 Route table headers; one generated block has one of each/m);
});

test("nothing beside the one plugin, and no install line names an area or an old name", () => {
  assert.match(broken(), /^FAIL: plugins\/tidy: the marketplace ships one plugin, plugins\/\w+, and plugins\/ holds no other directory/m);
  const lines = broken().split("\n").filter((l) => /^FAIL: README\.md:\d+: tells its reader to install /.test(l));
  assert.equal(lines.length, 1, "an uninstall line is not an install line");
  assert.match(lines[0], new RegExp(`install ${OLD}@agentic-engineering, which the catalog does not list; the plugin to install is ${ONE}@agentic-engineering`));
});

test("an address resolves to what the plugin ships: an old plugin name, a route named as a skill, and a word that is no route each fail with what to write", () => {
  const found = findings("docs/moved.md").map((l) => l.slice(0, l.lastIndexOf(" (")));
  assert.deepEqual(found, [
    `FAIL: docs/moved.md:1: /${OLD}:sweep names tidy as a plugin, and it is an area of ${ONE}; write /${ONE}:tidy sweep`,
    `FAIL: docs/moved.md:2: /${RENAMED}:sweep names ${RENAMED} as a plugin, and it is the system-map area of ${ONE}; write /${ONE}:system-map sweep`,
    `FAIL: docs/moved.md:3: /${ONE}:brush names a route of the tidy area directly; write /${ONE}:tidy brush`,
    `FAIL: docs/moved.md:4: /${ONE}:tidy mop: mop is not a route of the tidy area; an area named alone is followed by punctuation or the end of its code span`,
    `FAIL: docs/moved.md:5: /${ONE}:nothing is not a skill, agent, or MCP server of ${ONE}`,
  ]);
  assert.deepEqual(findings(`${TIDY_AREA}/CHANGELOG.md`), [], "history keeps what it says");
});

test("a route names its directories from its own file and writes neither variable the host fills in, and a plugin-root path in an area's markdown is in the plugin", () => {
  const found = findings(SWEEP).map((l) => l.slice(`FAIL: ${SWEEP}:`.length));
  assert.equal(found.length, 5, found.join("\n"));
  assert.match(found[0], /^10: W\/scripts\/broom\.mjs is not there/);
  assert.match(found[1], /^11: W\/scripts\/pan\.mjs is not quoted; write "W\/scripts\/pan\.mjs" in a command/);
  assert.match(found[2], /^12: a route writes no \$\{CLAUDE_PLUGIN_ROOT\}: read by path it is not filled in/);
  assert.match(found[3], /^13: R\/scripts\/pan\.mjs is under `R`, which this file does not declare/);
  assert.match(found[4], /^14: a route writes no \$\{CLAUDE_PLUGIN_DATA\}: read by path it is not filled in; the area's SKILL\.md, which the host does fill in, names the data directory/);
  const readme = findings(`${TIDY_AREA}/README.md`);
  assert.equal(readme.length, 1, readme.join("\n"));
  assert.match(readme[0], /README\.md:3: \$\{CLAUDE_PLUGIN_ROOT\}\/skills\/tidy\/scripts\/mop\.mjs is not in plugins\/\w+/);
});

// Two lists that stop matching without a word when a name moves: the agents
// the session hook says nothing to, and the prefix the host gives a mod's tools.
test("a DENYLIST entry names an agent the plugin ships, and the mod's tools carry the plugin's prefix", () => {
  assert.match(broken(), new RegExp(`^FAIL: DENYLIST entry "${GONE}" matches no agent: ${HOME}/agents/nobody\\.md is not there`, "m"));
  assert.match(broken(), new RegExp(`^FAIL: DENYLIST entry "${WAS}" names an agent by the plugin it was in; tidy is an area of ${ONE}, so the host names it ${ONE}:critic`, "m"));
  assert.match(broken(), new RegExp(`^FAIL: ${HOME}/skills/agent-works/hooks/kanban/register\\.mjs answers mcp__kanban__\\w+; the mod's tools are mcp__${ONE}__<tool>`, "m"));
});

// The two READMEs a person lands on are held to the README check the plugin ships.
test("a landing README over the word limit, out of order, or naming agent plumbing fails", (t) => {
  const long = validate(tree(t, { text: { "README.md": (s) => `${s}\n${"word ".repeat(900)}\n` } }));
  assert.equal(long.status, 1);
  assert.match(long.stdout, /^FAIL: readme-length: README\.md: \d+ words, over the 800-word limit/m);

  const plumbing = validate(tree(t, { text: { "plugins/agentcraft/README.md": (s) => s.replace("## Contributing", "## Contributing\n\nThe rules are in AGENTS.md.\n") } }));
  assert.equal(plumbing.status, 1);
  assert.match(plumbing.stdout, /^FAIL: readme-plumbing: plugins\/agentcraft\/README\.md:\d+: names `AGENTS\.md`/m);

  const order = validate(tree(t, { text: { "README.md": (s) => s.replace("## Usage", "## How to start") } }));
  assert.equal(order.status, 1);
  assert.match(order.stdout, /^FAIL: readme-sections: README\.md: no `## Usage` section/m);
});

test("a landing README with an em-dash or an emoji fails", (t) => {
  const dash = validate(tree(t, { text: { "README.md": (s) => s.replace("## Usage", "## Usage\n\nOne thing \u2014 and another.\n") } }));
  assert.match(dash.stdout, /^FAIL: README\.md uses an em-dash/m);
  const emoji = validate(tree(t, { text: { "plugins/agentcraft/README.md": (s) => s.replace("## Usage", "## Usage\n\nShip it \u{1F680}\n") } }));
  assert.match(emoji.stdout, /^FAIL: plugins\/agentcraft\/README\.md uses an emoji/m);
});
