// but-first-planning's hooks: the session hook (its two critical lines, the
// move of an older workspace to the current layout, the one-line briefing
// about stale scripts) and the plan gate on TaskCompleted, which is off unless
// a repo asks for it. Each runs as a host runs it, one payload on stdin, with
// the person's settings in a temp CLAUDE_CONFIG_DIR so a developer's own
// enabledPlugins never reach a test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { hookCommand } from "../../lib.mjs";
import { CONFIG_KEY } from "../../shared/critical-context.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "but-first-planning");
const CRITICAL = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "critical.json"), "utf8"));
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;
const META = JSON.parse(fs.readFileSync(path.join(REPO, "scripts", "plugins", "but-first-planning.json"), "utf8"));
const { SCRIPTS, scaffold } = await import(pathToFileURL(path.join(PLUGIN, "skills", "spec-init", "scaffold.mjs")).href);
const [GRILL, PLAN] = CRITICAL.lines.map((l) => l.text);
const RETIRED = ".agents/retired/but-first-planning";

function hook(t, script, payload, { cwd, env = {} } = {}) {
  const config = tempDir(t, "bfp-settings-");
  const out = runNode(path.join(PLUGIN, "hooks", script), [], {
    cwd: cwd ?? payload?.cwd ?? config,
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    env: { ...process.env, CLAUDE_CONFIG_DIR: config, HOME: config, USERPROFILE: config, CLAUDE_PROJECT_DIR: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_CODE_PLUGIN_CACHE_DIR: "", ...env },
  });
  const parsed = out.stdout.trim() ? JSON.parse(out.stdout) : null;
  return { ...out, parsed, context: parsed?.hookSpecificOutput?.additionalContext ?? "", message: parsed?.systemMessage ?? "" };
}

const session = (t, dir, extra = {}) => hook(t, "session-start.mjs", { hook_event_name: "SessionStart", source: "startup", session_id: "s", cwd: dir, ...extra });
const subagent = (t, dir, agentType) => hook(t, "session-start.mjs", { hook_event_name: "SubagentStart", agent_type: agentType, session_id: "s", cwd: dir });
const taskDone = (t, dir) => hook(t, "plan-gate.mjs", { hook_event_name: "TaskCompleted", session_id: "s", cwd: dir, task_id: "1", task_subject: "Build the slice" });
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");

/** A repo with a current workspace: the scripts, and a plan tree with one issue. `broken` leaves the issue file out of the sprint table's reach. */
function planRepo(t, { broken = false } = {}) {
  const { dir } = tempRepo(t, "bfp-plan-");
  scaffold(dir);
  const P = ".agents/plan/plan";
  write(dir, `${P}/index.md`, "# Plan\n\n## Epics\n\n| # | Epic | Sprints | Issues | Status |\n|---|---|---|---|---|\n| 01 | [Core](01-core/epic.md) | 1 | 1 | not-started |\n");
  write(dir, `${P}/01-core/epic.md`, "# Epic 01\n\n**Status**: not-started\n\n## Sprints\n\n| # | Sprint | Issues | Status |\n|---|---|---|---|\n| 01 | [Store](01-store/sprint.md) | 1 | not-started |\n");
  write(dir, `${P}/01-core/01-store/sprint.md`, `# Sprint\n\n**Status**: not-started\n\n## Issues\n\n| # | Type | Title | Tracker | Status |\n|---|---|---|---|---|\n| 01 | AFK | [Event type](issues/${broken ? "09_issue_GONE.md" : "01_issue_EVENT-TYPE.md"}) | <unassigned> | not-started |\n`);
  write(dir, `${P}/01-core/01-store/issues/01_issue_EVENT-TYPE.md`, "# Event type\n\n**Sprint**: [s](../sprint.md)\n**Type**: AFK\n**Tracker**: <unassigned>\n**Status**: not-started\n\n## Parent\n\n[s](../sprint.md)\n\n## What to build\n\nIt.\n\n**User-facing**: no - internal\n\n## Acceptance criteria\n\n- [ ] works\n\n## Testing checkpoint\n\n`echo ok`\n\n## Blocked by\n\n- None\n");
  return dir;
}

// ---- what is registered -----------------------------------------------------

test("hooks.json registers the session hook for every session start and every subagent, and the gate on TaskCompleted", () => {
  assert.deepEqual(Object.keys(HOOKS).sort(), ["SessionStart", "SubagentStart", "TaskCompleted"]);
  const [start] = HOOKS.SessionStart;
  assert.equal(start.matcher, "startup|resume|clear|compact");
  assert.equal(start.hooks[0].command, hookCommand("but-first-planning", "hooks/session-start.mjs", { loud: true }));
  assert.ok(start.hooks[0].statusMessage);
  assert.equal(HOOKS.SubagentStart[0].hooks[0].command, hookCommand("but-first-planning", "hooks/session-start.mjs"));
  assert.equal(HOOKS.TaskCompleted[0].hooks[0].command, hookCommand("but-first-planning", "hooks/plan-gate.mjs"));
  assert.equal(HOOKS.TaskCompleted[0].matcher, undefined, "TaskCompleted takes no matcher");
});

test("critical.json: two lines under the cap, no chain lines yet, and every skill a line names exists", () => {
  assert.equal(CRITICAL.plugin, "but-first-planning");
  assert.equal(CRITICAL.lines.length, 2);
  assert.deepEqual(CRITICAL.chains, []);
  const size = CRITICAL.lines.reduce((n, l) => n + l.text.length, 0);
  assert.ok(size <= META.critical.cap, `${size} characters, cap ${META.critical.cap}`);
  for (const skill of CRITICAL.lines.flatMap((l) => [...l.text.matchAll(/\/but-first-planning:([a-z-]+)/g)].map((m) => m[1]))) {
    const file = path.join(PLUGIN, "skills", skill, "SKILL.md");
    assert.ok(fs.existsSync(file), skill);
    // The model is sent to these by a line, so it has to be able to invoke them.
    assert.doesNotMatch(fs.readFileSync(file, "utf8").split("\n---")[0], /disable-model-invocation:\s*true/, skill);
  }
});

// ---- the lines --------------------------------------------------------------

test("a repo with a plan workspace hears both lines; one that only opted in hears the grill line", (t) => {
  const withPlan = session(t, planRepo(t));
  assert.equal(withPlan.status, 0);
  assert.ok(withPlan.context.includes(GRILL) && withPlan.context.includes(PLAN));
  assert.match(withPlan.context, /^Critical, from but-first-planning:/m);

  const { dir, git } = tempRepo(t, "bfp-on-");
  git("config", "--local", CONFIG_KEY, "on Test 2026-01-01T00:00Z");
  const portable = session(t, dir);
  assert.ok(portable.context.includes(GRILL));
  assert.ok(!portable.context.includes(PLAN));
});

test("a repo that answered off hears nothing, and neither does a read-only subagent", (t) => {
  const { dir, git } = tempRepo(t, "bfp-off-");
  git("config", "--local", CONFIG_KEY, "off Test 2026-01-01T00:00Z");
  const off = session(t, dir);
  assert.equal(off.status, 0);
  assert.equal(off.stdout.trim(), "");

  const plan = planRepo(t);
  assert.equal(subagent(t, plan, "Explore").stdout.trim(), "");
  const builder = subagent(t, plan, "general-purpose");
  assert.ok(builder.context.includes(PLAN), "a subagent that builds is told where the plan lives");
  assert.ok(!builder.context.includes(GRILL), "the grill line is the main session's");
});

test("empty and malformed stdin exit 0 with nothing on stderr", (t) => {
  for (const input of ["", "{\"hook_event_name\": \"SessionStart\","]) {
    for (const script of ["session-start.mjs", "plan-gate.mjs"]) {
      const r = hook(t, script, input, { cwd: tempDir(t, "bfp-nowhere-") });
      assert.equal(r.status, 0, `${script} ${JSON.stringify(input)}`);
      assert.equal(r.stderr, "");
    }
  }
});

// ---- the briefing -----------------------------------------------------------

test("a workspace whose scripts are current gets no briefing; a stale or missing one is named with the command that refreshes it", (t) => {
  const dir = planRepo(t);
  assert.doesNotMatch(session(t, dir).context, /not this plugin's current copies/);

  fs.appendFileSync(path.join(dir, ".agents/plan/plan/plan-status.mjs"), "\n// edited\n");
  fs.rmSync(path.join(dir, ".agents/plan/plan/tracker.mjs"));
  const stale = session(t, dir);
  assert.match(stale.context, /The plan scripts in \.agents\/plan\/ are not this plugin's current copies \(plan-status\.mjs, tracker\.mjs\)\./);
  const command = /node "([^"]+scaffold\.mjs)" --refresh/.exec(stale.context);
  assert.ok(command && fs.existsSync(command[1]), "the briefing names a script that exists");
  // The lines still follow the briefing.
  assert.ok(stale.context.includes(PLAN));
  assert.ok(!subagent(t, dir, "general-purpose").context.includes("current copies"), "a subagent gets no briefing");

  assert.equal(runNode(command[1], ["--root", dir, "--refresh"]).status, 0);
  assert.doesNotMatch(session(t, dir).context, /not this plugin's current copies/);
});

// ---- the migration ----------------------------------------------------------

const PY = "#!/usr/bin/env python3\nprint('an older script')\n";
const OLD_SCRIPTS = ["plan/plan-status.py", "plan/verify-plan-tree.py", "plan/publish-issues.py", "plan/plan-gate.py", "spec/scripts/verify-spec-tree.py", "spec/scripts/comments-server.py", "progress/drift-status.py"];
const GATE_SETTINGS = (workspace) => `${JSON.stringify({ permissions: { allow: ["Bash(npm test)"] }, hooks: { TaskCompleted: [{ hooks: [{ type: "command", command: `python3 "\${CLAUDE_PROJECT_DIR}/${workspace}/plan/plan-gate.py"` }] }] } }, null, 2)}\n`;

/** A workspace as this plugin scaffolded it before 5.0, under `workspace`: Python scripts, a `**GitHub**:` field, Python checkpoint rows. */
function oldLayout(t, workspace, { gate = false } = {}) {
  const { dir } = tempRepo(t, "bfp-old-");
  for (const rel of OLD_SCRIPTS) write(dir, `${workspace}/${rel}`, PY);
  write(dir, `${workspace}/tracker.md`, "# Issue tracker: GitHub\n");
  write(dir, `${workspace}/README.md`, `# Planning workspace\n\nRun \`python ${workspace}/plan/plan-status.py check\`.\n`);
  write(dir, `${workspace}/spec/index.md`, "# Spec\n");
  write(dir, `${workspace}/plan/index.md`, "# Plan\n\n<!-- plan-format: 3.7 -->\n");
  write(dir, `${workspace}/plan/01-core/epic.md`, `# Epic 01\n\n**Status**: not-started\n\n| Check | Command | Expected |\n|---|---|---|\n| verifier | \`python ${workspace}/plan/verify-plan-tree.py\` | exit 0 |\n`);
  write(dir, `${workspace}/plan/01-core/01-store/sprint.md`, `# Sprint\n\n**Status**: not-started\n\n| Check | Command | Expected |\n|---|---|---|\n| done | \`python ${workspace}/plan/plan-status.py check 01-01\` | exit 0 |\n`);
  write(dir, `${workspace}/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md`, "# Event type\n\n**GitHub**: #12\n**Status**: done\n");
  write(dir, ".gitignore", `${workspace}/.site/\n`);
  if (gate) write(dir, ".claude/settings.json", GATE_SETTINGS(workspace));
  return dir;
}

test("a 4.x workspace: the Python scripts are parked, the Node ones are written, and the session is told what to edit by hand", (t) => {
  const dir = oldLayout(t, ".agents/plan");
  const r = session(t, dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");

  for (const rel of Object.values(SCRIPTS)) assert.ok(exists(dir, `.agents/plan/${rel}`), rel);
  for (const rel of OLD_SCRIPTS.filter((s) => s !== "spec/scripts/comments-server.py")) {
    assert.equal(exists(dir, `.agents/plan/${rel}`), false, `${rel} still in place`);
    assert.equal(read(dir, `${RETIRED}/${rel}`), PY, `${rel} not parked`);
  }
  // The comments server keeps its name, so the old one is parked and the current one written.
  assert.equal(read(dir, `${RETIRED}/spec/scripts/comments-server.py`), PY);
  assert.notEqual(read(dir, ".agents/plan/spec/scripts/comments-server.py"), PY);
  assert.equal(exists(dir, ".agents/plan/config.json"), false, "no gate was wired, so none is turned on");

  // The repo's own files are untouched.
  assert.match(read(dir, ".agents/plan/plan/01-core/epic.md"), /verify-plan-tree\.py/);
  assert.equal(read(dir, ".agents/plan/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md"), "# Event type\n\n**GitHub**: #12\n**Status**: done\n");

  assert.match(r.context, /but-first-planning moved this repo to its current layout:/);
  assert.match(r.context, /The plan scripts are Node now: run `node \.agents\/plan\/plan\/plan-status\.mjs`/);
  assert.match(r.context, /2 file\(s\) under \.agents\/plan\/plan\/ still run the Python scripts in their checkpoint rows \(\.agents\/plan\/plan\/01-core\/01-store\/sprint\.md, \.agents\/plan\/plan\/01-core\/epic\.md\)/);
  assert.match(r.context, /yours to edit by hand: \.agents\/plan\/README\.md\./);
  assert.match(r.context, /`\*\*GitHub\*\*:` field: the scripts read it as `\*\*Tracker\*\*:`/);
  assert.match(r.message, /^but-first-planning moved \d+ path\(s\) to its current layout\.$/);
  // The scripts it wrote are current, so there is nothing to refresh.
  assert.doesNotMatch(r.context, /not this plugin's current copies/);

  // The migrated funnel reads the tree it was written into.
  const check = runNode(path.join(dir, ".agents/plan/plan/plan-status.mjs"), ["check", "01-01"], { cwd: dir });
  assert.match(check.stdout, /^01-core\/01-store: /);
});

test("a second session after a migration changes nothing and says nothing about it", (t) => {
  const dir = oldLayout(t, ".agents/plan", { gate: true });
  session(t, dir);
  const snapshot = () => fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith(".git")).sort().join("\n");
  const before = snapshot();
  const again = session(t, dir);
  assert.equal(snapshot(), before);
  assert.doesNotMatch(again.context, /current layout|Node now/);
  assert.equal(again.message, "");
  assert.ok(again.context.includes(PLAN));
});

test("a workspace from before 4.0 moves from .plan/ to .agents/plan/ and is then brought to the Node scripts", (t) => {
  const dir = oldLayout(t, ".plan");
  const r = session(t, dir);
  assert.equal(exists(dir, ".plan"), false);
  assert.ok(exists(dir, ".agents/plan/plan/plan-status.mjs"));
  assert.ok(exists(dir, ".agents/plan/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md"));
  assert.equal(read(dir, `${RETIRED}/plan/plan-status.py`), PY);
  assert.match(r.context, /\.plan -> \.agents\/plan/);
  assert.match(r.context, /The planning workspace moved from \.plan\/ to \.agents\/plan\/; nothing inside it was renamed\./);
  assert.match(r.context, /yours to edit by hand: .*\.gitignore/);
  // The marker the move created turns the plan line on in the same session.
  assert.ok(r.context.includes(PLAN));
});

test("a repo that ran the gate keeps it: the opt-in is written and the old settings entry can no longer refuse a task", (t) => {
  const dir = oldLayout(t, ".agents/plan", { gate: true });
  const r = session(t, dir);
  assert.deepEqual(JSON.parse(read(dir, ".agents/plan/config.json")), { taskGate: true });
  assert.equal(read(dir, ".claude/settings.json"), GATE_SETTINGS(".agents/plan"), "the settings file is the repo's to edit");
  // The file the old entry runs stays, so the entry does not fail on a missing file.
  assert.equal(read(dir, ".agents/plan/plan/plan-gate.py"), PY);
  assert.match(r.context, /`"taskGate": true` in \.agents\/plan\/config\.json keeps it on here\./);
  assert.match(r.context, /The entry in \.claude\/settings\.json that runs plan-gate\.py does nothing any more: remove it, then delete \.agents\/plan\/plan\/plan-gate\.py\./);

  const moved = oldLayout(t, ".plan", { gate: true });
  const second = session(t, moved);
  assert.deepEqual(JSON.parse(read(moved, ".agents/plan/config.json")), { taskGate: true });
  // The entry names the old path, so a stand-in is left there for it to find.
  assert.match(read(moved, ".plan/plan/plan-gate.py"), /^# Retired:/);
  assert.equal(exists(moved, ".agents/plan/plan/plan-gate.py"), false, "the copy no entry names is parked");
  assert.equal(read(moved, `${RETIRED}/plan/plan-gate.py`), PY);
  assert.match(second.context, /remove it, then delete \.plan\/\./);
  // The stand-in is not a workspace: the next session moves nothing.
  assert.equal(session(t, moved).message, "");
});

test("a folder named .plan that this plugin did not write is left alone", (t) => {
  const { dir } = tempRepo(t, "bfp-foreign-");
  write(dir, ".plan/notes.md", "somebody's own plan\n");
  write(dir, ".plan/plan/todo.md", "- [ ] theirs\n");
  const r = session(t, dir);
  assert.equal(r.status, 0);
  assert.equal(read(dir, ".plan/notes.md"), "somebody's own plan\n");
  assert.equal(exists(dir, ".agents"), false);
  assert.doesNotMatch(r.context, /current layout/);
});

test("an old workspace beside a new one is not merged: the old folder stays and the session is told", (t) => {
  const dir = oldLayout(t, ".plan");
  write(dir, ".agents/plan/plan/index.md", "# the newer plan\n");
  const r = session(t, dir);
  assert.ok(exists(dir, ".plan/plan/plan-status.py"));
  assert.equal(read(dir, ".agents/plan/plan/index.md"), "# the newer plan\n");
  assert.match(r.context, /left these in place because the new path already exists: \.plan \(\.agents\/plan exists\)/);
});

test("a subagent never migrates", (t) => {
  const dir = oldLayout(t, ".plan");
  subagent(t, dir, "general-purpose");
  assert.ok(exists(dir, ".plan/plan/plan-status.py"));
  assert.equal(exists(dir, ".agents"), false);
});

// ---- the plan gate ----------------------------------------------------------

test("the gate is off by default: a broken plan tree does not refuse a task", (t) => {
  const dir = planRepo(t, { broken: true });
  const r = taskDone(t, dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("with taskGate on, a critically broken tree refuses the task and hands the model the verifier's findings", (t) => {
  const dir = planRepo(t, { broken: true });
  write(dir, ".agents/plan/config.json", "{ \"taskGate\": true }\n");
  const r = taskDone(t, dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^plan gate: the plan tree has critical violations\. Fix them before a task is marked done/);
  assert.match(r.stderr, /FAIL: .*sprint\.md lists issues not on disk: \["09_issue_GONE\.md"\]/);
  assert.match(r.stderr, /"taskGate": false in \.agents\/plan\/config\.json/);
  assert.equal(r.stdout, "");
});

test("with taskGate on, a clean tree and a tree with only warnings both let the task through", (t) => {
  const clean = planRepo(t);
  write(clean, ".agents/plan/config.json", "{ \"taskGate\": true }\n");
  const ok = taskDone(t, clean);
  assert.equal(ok.status, 0);
  assert.equal(ok.stderr, "");

  // No plan-format marker, so a missing User-facing line is a warning.
  const warned = planRepo(t);
  write(warned, ".agents/plan/config.json", "{ \"taskGate\": true }\n");
  const file = path.join(warned, ".agents/plan/plan/01-core/01-store/issues/01_issue_EVENT-TYPE.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("**User-facing**: no - internal\n", ""));
  assert.equal(taskDone(t, warned).status, 0);
});

test("the gate fails open: taskGate false, an unreadable config, no verifier and no workspace all exit 0 in silence", (t) => {
  const off = planRepo(t, { broken: true });
  write(off, ".agents/plan/config.json", "{ \"taskGate\": false }\n");
  const garbled = planRepo(t, { broken: true });
  write(garbled, ".agents/plan/config.json", "{ taskGate: yes");
  const bare = planRepo(t, { broken: true });
  write(bare, ".agents/plan/config.json", "{ \"taskGate\": true }\n");
  fs.rmSync(path.join(bare, ".agents/plan/plan/verify-plan-tree.mjs"));
  const { dir: none } = tempRepo(t, "bfp-none-");
  for (const dir of [off, garbled, bare, none]) {
    const r = taskDone(t, dir);
    assert.equal(r.status, 0);
    assert.equal(r.stdout + r.stderr, "");
  }
});

test("the gate judges the work tree the session is in, not the project dir", (t) => {
  const broken = planRepo(t, { broken: true });
  write(broken, ".agents/plan/config.json", "{ \"taskGate\": true }\n");
  const clean = planRepo(t);
  const r = hook(t, "plan-gate.mjs", { hook_event_name: "TaskCompleted", cwd: broken }, { cwd: clean, env: { CLAUDE_PROJECT_DIR: clean } });
  assert.equal(r.status, 2);
});
