// perceptual-loop at session start: the move from the first layout
// (.perceptual-loop/) to .agents/perceptual/ with a note that names every
// config key left to edit, the briefing that says a harness exists, the
// critical lines and who gets them, and the plugin's hook map. The area's
// part runs alone, through the plugin's helper (area-session.mjs says why).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { hookCommand } from "../../lib.mjs";
import { PL, PLUGIN, runNode, tempDir, write } from "./design-fixtures.mjs";

const HOOK = path.join(import.meta.dirname, "area-session.mjs");
const ROOT = path.join(PLUGIN, "..", "..");
const DOOR = JSON.parse(fs.readFileSync(path.join(PLUGIN, "door.json"), "utf8"));
const PLAN = [".agents/plan", ".agents/plans", ".plan/plan/plan-status.py", ".plan/plan/verify-plan-tree.py", ".plan/spec/scripts/verify-spec-tree.py"];
const CRITICAL = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "critical.json"), "utf8"));
const TASTE = "Defects are yours to fix; taste (how bright, how much, which of two plausible looks) is the owner's to decide.";

/** A git repo the person answered for (`on`, `off`, or not at all), on main with nothing committed. */
function repo(answer = null) {
  const dir = tempDir("pl-session-");
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  if (answer) git("config", "--local", "agentic-engineering.plugins", `${answer} test 2026-01-01T00:00Z`);
  return dir;
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const OLD_CONFIG = { version: 1, reference: "reference", candidates: ["candidate"], shotsDir: ".perceptual-loop/shots", render: {}, passes: ["beauty"],
  regionsFrom: "reference", budget: { free: 3, match: [] }, metrics: { ssim: true, deltaE: true, edges: true, detail: true } };

/** The state folder as the first layout wrote it, with two shots and a run that was never tracked. */
function firstLayout(dir, config = OLD_CONFIG) {
  write(dir, ".perceptual-loop/config.json", json(config));
  write(dir, ".perceptual-loop/groups.json", json({ smoke: ["sky_*"], cabins: ["cab_*"] }));
  write(dir, ".perceptual-loop/baseline.json", json({ version: 1, tolerances: {}, entries: { "sky_0/candidate/frame.ssim": 0.91 } }));
  write(dir, ".perceptual-loop/.gitignore", "shots/\nruns/\n");
  write(dir, ".perceptual-loop/success/sky.md", "# Sky\n");
  write(dir, ".perceptual-loop/decisions/2026-01-02-sky.md", "keep\n");
  for (const shot of ["sky_0", "sky_1"]) write(dir, `.perceptual-loop/shots/${shot}/shot.json`, json({ name: shot }));
  write(dir, ".perceptual-loop/runs/iterate/sky_0/metrics.candidate.json", "{}\n");
  return dir;
}

/** Run the hook as a host does; returns the context the model reads, the line the person reads, and the raw result. */
function session(dir, payload = {}, env = {}) {
  const r = runNode(HOOK, ["design"], { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, PL_DIR: "", PERCEPTUAL_LOOP_DIR: "", PL_SHOTS_DIR: "", CLAUDE_PLUGIN_DATA: "", ...env },
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: dir, ...payload }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  const out = r.stdout ? JSON.parse(r.stdout) : {};
  return { context: out.hookSpecificOutput?.additionalContext ?? "", message: out.systemMessage ?? "", stdout: r.stdout };
}

// ---- the lines -------------------------------------------------------------------------------

test("critical.json: seven lines for every agent in any opted-in repo, none waiting on another plugin, under the cap", () => {
  assert.equal(CRITICAL.area, "design");
  assert.equal("chains" in CRITICAL, false);
  // The line about a ruling with reach stands behind the plan it would be recorded in, and the design system's behind the pin.
  assert.deepEqual(CRITICAL.lines.map((l) => [l.for, l.mode, l.when]), [...Array.from({ length: 5 }, () => ["all", "any", undefined]), ["all", "any", PLAN], ["all", "any", ".agents/design.json"]]);
  assert.match(CRITICAL.lines[6].text, /reads \.agents\/rules\/design\.md first, .* \/agentic-engineering:design check before done\.$/);
  assert.ok(CRITICAL.lines.some((l) => l.text === TASTE), "the taste line is quoted elsewhere and stays word for word");
  assert.match(CRITICAL.lines[0].text, /starts with its doctrine, before the first change: \/agentic-engineering:design\.$/);
  assert.match(CRITICAL.lines[4].text, /\/agentic-engineering:agents locks\.$/);
  assert.match(CRITICAL.lines[5].text, /\/agentic-engineering:planning spec-edit\.$/);
  // The cap is CRITICAL_CAPS in scripts/validate.mjs.
  const printed = "Critical, from design:".length + CRITICAL.lines.reduce((n, l) => n + l.text.length + 3, 0);
  assert.ok(printed <= 1100, `the block prints ${printed} characters`);
  const skill = fs.readFileSync(path.join(PLUGIN, "SKILL.md"), "utf8");
  assert.doesNotMatch(skill, /^disable-model-invocation:\s*true/m, "the lines send the model to a skill it can invoke");
});

test("the lines reach an opted-in session and a working subagent, and never the blind critic", () => {
  const dir = repo("on");
  const main = session(dir);
  for (const line of CRITICAL.lines) assert.equal(main.context.includes(`- ${line.text}`), !line.when, line.text);
  const planned = repo("on");
  write(planned, ".agents/plan/index.md", "# Plan\n");
  assert.ok(session(planned).context.includes(`- ${CRITICAL.lines[5].text}`), "a repo with a plan hears where a ruling is recorded");
  assert.match(main.context, /^Critical, from design:/m);
  assert.doesNotMatch(main.context, /perceptual harness/, "no state folder, no briefing");
  assert.equal(main.message, "");
  const worker = session(dir, { hook_event_name: "SubagentStart", agent_type: "general-purpose" });
  assert.ok(worker.context.includes(TASTE));
  for (const agent of ["agentic-engineering:vision-critic", "Explore", "Plan"]) {
    assert.equal(session(dir, { hook_event_name: "SubagentStart", agent_type: agent }).stdout, "", `${agent} is told nothing`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, "agents", "vision-critic.md")), true, "the agent the deny list names is the one the plugin ships");
  assert.match(fs.readFileSync(path.join(ROOT, "agents", "vision-critic.md"), "utf8"), /^name: vision-critic$/m);
});

test("where the person answered off, the hook says nothing and moves nothing it has no marker for", () => {
  const dir = repo("off");
  assert.equal(session(dir).stdout, "");
  assert.equal(session(dir, { hook_event_name: "SubagentStart", agent_type: "general-purpose" }).stdout, "");
  assert.equal(fs.existsSync(path.join(dir, ".agents")), false);
});

// ---- the design system ---------------------------------------------------------------------

/** A data directory whose profile names house-ui, as the system route leaves it. */
function profiled() {
  const data = tempDir("pl-data-");
  write(data, "design/profile.json", json({ source: "house/ui", ref: "v0.2.0", manifest: { name: "house-ui" } }));
  return data;
}

test("a web front end that is not on the person's design system hears it once, and nothing where any condition fails", () => {
  const data = profiled();
  const NUDGE = /This repo looks like a web front end and is not on the person's design system \(house-ui\)\. Ask them once whether to adopt it: on a yes, \/agentic-engineering:design adopt; on a no, git config --local agentic-engineering\.design off\./;
  const app = repo("on");
  write(app, "package.json", json({ dependencies: { react: "19.0.0" } }));
  const heard = session(app, {}, { CLAUDE_PLUGIN_DATA: data }).context;
  assert.match(heard, NUDGE);
  assert.equal(heard.match(NUDGE).length, 1);

  const shadcn = repo("on");
  write(shadcn, "components.json", "{}\n");
  assert.match(session(shadcn, {}, { CLAUDE_PLUGIN_DATA: data }).context, NUDGE, "a components.json is a front end");

  assert.doesNotMatch(session(app, {}, { CLAUDE_PLUGIN_DATA: tempDir("pl-data-") }).context, /design system/, "no profile, nothing said");
  const api = repo("on");
  write(api, "package.json", json({ dependencies: { express: "4" } }));
  assert.doesNotMatch(session(api, {}, { CLAUDE_PLUGIN_DATA: data }).context, /design system/, "not a front end");
  assert.doesNotMatch(session(app, { hook_event_name: "SubagentStart", agent_type: "general-purpose" }, { CLAUDE_PLUGIN_DATA: data }).context, /design system/, "a subagent gets no briefing");

  execFileSync("git", ["-C", app, "config", "--local", "agentic-engineering.design", "off"]);
  assert.doesNotMatch(session(app, {}, { CLAUDE_PLUGIN_DATA: data }).context, /design system/, "the person said no in this clone");
});

test("a repo on a design system is opted in by its pin, hears the design line, and is not asked to adopt", () => {
  const dir = repo();
  write(dir, "package.json", json({ dependencies: { react: "19.0.0" } }));
  write(dir, ".agents/design.json", json({ schema: 1, system: "house-ui", version: "0.2.0" }));
  const { context } = session(dir, {}, { CLAUDE_PLUGIN_DATA: profiled() });
  assert.ok(context.includes(`- ${CRITICAL.lines[6].text}`), "the pin is a marker, and the line stands behind it");
  assert.ok(context.includes(TASTE), "the pin alone turns the portable lines on");
  assert.doesNotMatch(context, /not on the person's design system/);
});

// ---- the move --------------------------------------------------------------------------------

test("a repo on the first layout is moved in one rename, nothing inside rewritten, and the note names the key to edit", () => {
  const dir = firstLayout(repo());
  const before = fs.readFileSync(path.join(dir, ".perceptual-loop/config.json"), "utf8");
  const first = session(dir);
  assert.equal(fs.existsSync(path.join(dir, ".perceptual-loop")), false, "the old folder is gone");
  for (const rel of ["config.json", "groups.json", "baseline.json", ".gitignore", "success/sky.md", "decisions/2026-01-02-sky.md", "shots/sky_1/shot.json", "runs/iterate/sky_0/metrics.candidate.json"]) {
    assert.ok(fs.existsSync(path.join(dir, ".agents/perceptual", rel)), `${rel} moved, tracked or not`);
  }
  assert.equal(fs.readFileSync(path.join(dir, ".agents/perceptual/config.json"), "utf8"), before, "the config is byte for byte what it was");
  assert.match(first.context, /^design moved this repo to its current layout: \.perceptual-loop -> \.agents\/perceptual\./);
  assert.match(first.context, /nothing inside it was rewritten/);
  assert.match(first.context, /\.agents\/perceptual\/config\.json still names the old folder: replace \.perceptual-loop with \.agents\/perceptual in shotsDir\. Until then shotsDir is read from the new folder/);
  assert.match(first.context, /`pl\.mjs <command>` where `<command>\.py` stood/);
  assert.equal(first.message, "design moved 1 path(s) to its current layout.");
  assert.ok(first.context.includes(TASTE), "the marker it created turns the lines on in the same session");
  assert.match(first.context, /This repo has a perceptual harness in \.agents\/perceptual\/: 2 shot\(s\), groups smoke, cabins\./);
  assert.equal(first.context.match(/still names the old folder/g).length, 1, "the note and the briefing do not say it twice");

  // the CLI finds everything where it now is, through the spelling nobody has edited yet
  const shots = runNode(PL, ["groups", "resolve", "--all", "--json"], { cwd: dir, env: { PL_DIR: "", PERCEPTUAL_LOOP_DIR: "", PL_SHOTS_DIR: "" } });
  assert.equal(shots.status, 0, shots.stderr);
  assert.match(shots.stdout, /sky_0[\s\S]*sky_1/);

  // a second session moves nothing and keeps reminding until the key is edited
  const second = session(dir);
  assert.equal(second.message, "");
  assert.doesNotMatch(second.context, /moved this repo/);
  assert.match(second.context, /config\.json still names the old folder: replace \.perceptual-loop with \.agents\/perceptual in shotsDir\./);
  const file = path.join(dir, ".agents/perceptual/config.json");
  fs.writeFileSync(file, json({ ...OLD_CONFIG, shotsDir: ".agents/perceptual/shots" }));
  const third = session(dir);
  assert.doesNotMatch(third.context, /old folder/);
  assert.match(third.context, /perceptual harness in \.agents\/perceptual\/: 2 shot\(s\)/);
});

test("the note lists every value that names the old folder, a render line that needs a shell, a budget pattern for a script that is gone, and the files that still point there", () => {
  const dir = firstLayout(repo(), {
    ...OLD_CONFIG,
    render: { candidate: "cd app && npm run render -- {shots} > .perceptual-loop/runs/render.log", reference: ["capture", "--out", ".perceptual-loop/shots", "{shots}"] },
    budget: { free: 3, match: ["npm run render", String.raw`iterate\.py`] },
  });
  write(dir, ".gitignore", "node_modules/\n.perceptual-loop/shots/\n");
  // The repo's own file, naming a skill by an address it had before. Built from its parts: nothing ships there now.
  write(dir, "AGENTS.md", `# App\n\nRun \`${["/perceptual-loop", "build-harness"].join(":")}\` once.\n`);
  write(dir, "README.md", "# App\n\nUses the perceptual-loop plugin.\n");
  const { context } = session(dir);
  assert.match(context, /replace \.perceptual-loop with \.agents\/perceptual in shotsDir; render\.candidate; render\.reference\[2\]\./);
  assert.match(context, /never through a shell, and render\.candidate holds more than one command/);
  assert.match(context, /or name the shell yourself as an array: \["bash", "-c", "<the line>"\]/);
  assert.match(context, /budget\.match\[1\] \("iterate\\\\\.py"\) in \.agents\/perceptual\/config\.json matched a script that is now a command of pl\.mjs/);
  assert.match(context, /yours to edit by hand: \.gitignore, AGENTS\.md\./, "README names the plugin, not the folder, and is left out");
  const again = session(dir).context;
  assert.match(again, /render\.candidate holds more than one command/, "what is still unedited is said again next session");
  assert.doesNotMatch(again, /yours to edit by hand/, "the pointer files are named once, when the folder moved");
});

test("a folder the plugin did not write is left alone, and so is an old one whose new home is taken", () => {
  const stray = repo("on");
  write(stray, ".perceptual-loop/notes.txt", "mine\n");
  const s = session(stray);
  assert.equal(s.message, "");
  assert.ok(fs.existsSync(path.join(stray, ".perceptual-loop/notes.txt")), "no config.json, so not this plugin's to move");

  const both = firstLayout(repo());
  write(both, ".agents/perceptual/notes.md", "already here\n");
  const b = session(both);
  assert.ok(fs.existsSync(path.join(both, ".perceptual-loop/config.json")), "the old folder is untouched");
  assert.match(b.context, /left these in place because the new path already exists: \.perceptual-loop \(\.agents\/perceptual exists\)/);
  assert.match(b.context, /Its state is still in \.perceptual-loop\/ and is read from there/);
  assert.match(b.context, /perceptual harness in \.perceptual-loop\/: 2 shot\(s\)/);
  assert.equal(b.message, "design left 1 old path(s) to merge by hand.");
});

test("a subagent starts no move, and the hook fails open on anything it cannot read", () => {
  const dir = firstLayout(repo());
  session(dir, { hook_event_name: "SubagentStart", agent_type: "general-purpose" });
  assert.ok(fs.existsSync(path.join(dir, ".perceptual-loop/config.json")), "only the main session moves a repo");
  const broken = repo("on");
  write(broken, ".agents/perceptual/config.json", "{ not json");
  const s = session(broken);
  assert.ok(s.context.includes(TASTE), "the lines still go out");
  assert.match(s.context, /perceptual harness in \.agents\/perceptual\/: 0 shot\(s\)/);
  for (const input of ["", "not json", "[]", "﻿{}"]) {
    const r = runNode(HOOK, ["design"], { cwd: tempDir("pl-nowhere-"), env: { CLAUDE_PROJECT_DIR: "" }, input });
    assert.deepEqual([r.status, r.stderr], [0, ""], JSON.stringify(input));
  }
});

// ---- the hook map ----------------------------------------------------------------------------

test("the plugin's hook map runs the guard on both shells, and the area has no session hook of its own", () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;
  const guard = hookCommand("agentic-engineering", "skills/design/hooks/guard.mjs");
  assert.deepEqual(map.PreToolUse.filter((g) => g.hooks.some((h) => h.command === guard)).map((g) => g.matcher), ["Bash|PowerShell"]);
  assert.ok(fs.existsSync(path.join(PLUGIN, "hooks", "briefing.mjs")), "its briefing is a part of the plugin's");
  assert.equal(fs.existsSync(path.join(PLUGIN, "hooks", "session-start.mjs")), false);
  assert.doesNotMatch(JSON.stringify(Object.entries(map).filter(([event]) => event !== "PreToolUse")), /skills\/design\//, "the plugin's two session commands speak for it");
});

test("every route names no script that is gone, and reaches the one CLI through the plugin root by the area's path", () => {
  const routes = fs.readdirSync(path.join(PLUGIN, "routes")).sort();
  assert.deepEqual(routes, ["adopt", "audio", "calibrate", "check", "define-success", "iterate", "judge", "motion", "probe", "shot-harness", "system"]);
  for (const name of routes) {
    const text = fs.readFileSync(path.join(PLUGIN, "routes", name, "ROUTE.md"), "utf8");
    assert.match(text, new RegExp(`^name: ${name}$`, "m"), name);
    assert.doesNotMatch(text, /\b(?:iterate|baseline|compare|calibrate|sheet|sweep|flow|video|audio|init|groups|blind|timing|evidence_lint|review_page)\.py\b|uv run/, `${name} still calls a Python script`);
    assert.doesNotMatch(text, /\.perceptual-loop\//, `${name} names the first layout's folder`);
    for (const call of text.match(/node "\$\{CLAUDE_PLUGIN_ROOT\}[^"]*pl\.mjs"/g) ?? []) assert.equal(call, 'node "${CLAUDE_PLUGIN_ROOT}/skills/design/scripts/pl.mjs"', name);
  }
  assert.equal(DOOR.routes["shot-harness"].starts, "person", "the set-up route is the person's to start");
});
