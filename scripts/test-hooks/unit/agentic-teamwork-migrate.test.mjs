// agentic-teamwork's migration, run the way it runs for a person: by the
// session hook, at the start of a session, in a repo the plugin's first
// layout set up. It must move the repo to the current layout without
// loosening one rule, without overwriting anything, and only once.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { makeFixture } from "../fixtures.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";
import { blockFromFirstLayout, loadConfig } from "../../../plugins/agentic-teamwork/hooks/lib/config.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-teamwork");
const HOOKS = path.join(PLUGIN, "hooks");
const suite = { after };
const HOME = tempDir(suite, "tw-migrate-home-");
const TMP = tempDir(suite, "tw-migrate-tmp-");
write(HOME, ".claude/settings.json", "{}\n");

const RETIRED = ".agents/retired/agentic-teamwork";
const OLD_CONFIG = ".claude/teamwork.json";
const OLD_RULES = ".claude/rules/team-workflow.md";
const NEW_MIRROR = fs.readFileSync(path.join(PLUGIN, "templates", "githooks", "pre-commit"), "utf8");
// Stand-ins for what the first layout's setup skill installed beside the settings file.
const OLD_MIRROR = '#!/bin/bash\nROOT="$(git rev-parse --show-toplevel)"\n[ -f "$ROOT/.claude/teamwork.json" ] || exit 0\n. "$ROOT/.githooks/lib-guard.sh"\n';
const OLD_LIB = 'TW_LIB_VERSION="0.1.0"\n';
const RULES_TEXT = "# Team workflow conventions\n\nSee `coupledFiles` in `.claude/teamwork.json`.\n";
const CLAUDE_MD = "# fixture\n\n## Team workflow rules\n\n- Full checklist: `.claude/rules/team-workflow.md`.\n";
const SETTINGS = '{\n  "permissions": { "deny": ["Bash(git push --force:*)"] }\n}\n';

const node = (code) => `"${process.execPath}" -e "${code}"`;
const FAILING = node("console.log('1 failing: adds two numbers'); process.exit(1)");

const env = (dir) => ({ ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: "", TMPDIR: TMP });
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));
const json = (dir, rel) => JSON.parse(read(dir, rel));

/**
 * A fixture repo of the first layout, as the old setup left one: the settings
 * file the fixture carries, plus the rules file, the CLAUDE.md section, the
 * permissions file and the bash mirror. `edit` changes the settings first.
 */
function oldRepo(t, kind = "teamwork-only", { edit = (c) => c, mirror = true, extras = true } = {}) {
  const dir = makeFixture(tempDir(t, "tw-migrate-"), kind);
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  write(dir, OLD_CONFIG, `${JSON.stringify(edit(json(dir, OLD_CONFIG)), null, 2)}\n`);
  if (extras) {
    write(dir, OLD_RULES, RULES_TEXT);
    write(dir, "CLAUDE.md", CLAUDE_MD);
    write(dir, ".claude/settings.json", SETTINGS);
  }
  if (mirror) {
    write(dir, ".githooks/pre-commit", OLD_MIRROR);
    write(dir, ".githooks/lib-guard.sh", OLD_LIB);
  }
  return { dir, git };
}

function start(dir, { event = "SessionStart", extra = {} } = {}) {
  const input = JSON.stringify({ hook_event_name: event, source: "startup", session_id: "migrate", cwd: dir, ...extra });
  const began = Date.now();
  const result = runNode(path.join(HOOKS, "session-start.mjs"), [], { cwd: dir, env: env(dir), input });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const out = result.stdout.trim() ? JSON.parse(result.stdout) : null;
  return { out, context: out?.hookSpecificOutput?.additionalContext ?? "", message: out?.systemMessage ?? "", ms: Date.now() - began };
}

function guard(dir, command) {
  const input = JSON.stringify({ hook_event_name: "PreToolUse", session_id: "migrate-guard", cwd: dir, tool_name: "Bash", tool_input: { command } });
  const result = runNode(path.join(HOOKS, "git-guard.mjs"), [], { cwd: dir, env: env(dir), input });
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
  return { decision: out?.permissionDecision ?? null, reason: out?.permissionDecisionReason ?? "" };
}

/** Every file of the repo outside .git, with its contents, to prove a run changed nothing. */
function snapshot(dir, rel = "") {
  const out = {};
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (child === ".git") continue;
    if (entry.isDirectory()) Object.assign(out, snapshot(dir, child));
    else out[child] = read(dir, child);
  }
  return out;
}

/** The settings a repo's hooks act on, without the fields that say where they were read from. */
function rules(dir) {
  const { manifest, unmoved, lanes, root, ...rest } = loadConfig(dir);
  return rest;
}

// ---- the move ------------------------------------------------------------

test("a first-layout repo is moved: the manifest written, the old files parked, the mirror replaced", (t) => {
  const { dir } = oldRepo(t);
  const old = json(dir, OLD_CONFIG);
  const oldText = read(dir, OLD_CONFIG);
  start(dir);

  const manifest = json(dir, ".agents/manifest.json");
  assert.deepEqual(Object.keys(manifest), ["standard", "standard_version", "project", "default_branch", "lanes", "owned", "teamwork"]);
  assert.equal(manifest.standard, "agentic-engineering");
  assert.equal(manifest.standard_version, 1);
  assert.equal(manifest.project, path.basename(dir));
  assert.equal(manifest.default_branch, "main");
  assert.deepEqual(manifest.lanes, { unit: "true" }, "the one test command it had becomes its unit lane");
  assert.deepEqual(manifest.owned, {});
  assert.deepEqual(manifest.teamwork, blockFromFirstLayout(old));

  assert.equal(read(dir, `${RETIRED}/${OLD_CONFIG}`), oldText, "parked as it was, not deleted");
  assert.equal(read(dir, `${RETIRED}/${OLD_RULES}`), RULES_TEXT);
  assert.equal(read(dir, `${RETIRED}/.githooks/pre-commit`), OLD_MIRROR);
  assert.equal(read(dir, `${RETIRED}/.githooks/lib-guard.sh`), OLD_LIB);
  for (const gone of [OLD_CONFIG, OLD_RULES, ".githooks/lib-guard.sh"]) assert.equal(has(dir, gone), false, `${gone} is still there`);
  assert.equal(read(dir, ".githooks/pre-commit"), NEW_MIRROR, "the bash mirror is replaced by the Node one");

  assert.equal(read(dir, ".claude/settings.json"), SETTINGS, "the permissions file is not the plugin's to move");
  assert.equal(read(dir, "CLAUDE.md"), CLAUDE_MD, "nor is CLAUDE.md");
  assert.equal(has(dir, "src/app.py") && has(dir, "scratch.txt"), true, "the person's work is where it was");
});

test("the model is told what moved and exactly what is left for it to do", (t) => {
  const { dir } = oldRepo(t);
  const { context, message } = start(dir);
  assert.match(context, /^agentic-teamwork moved this repo to its current layout: /);
  assert.match(context, /\.claude\/teamwork\.json -> \.agents\/retired\/agentic-teamwork\/\.claude\/teamwork\.json/);
  assert.match(context, /wrote \.agents\/manifest\.json; wrote \.githooks\/pre-commit/);
  assert.match(context, /The git rules now come from the `teamwork` block of \.agents\/manifest\.json, which spells out everything \.claude\/teamwork\.json enforced .*: nothing was loosened\./);
  assert.match(context, /\.claude\/rules\/team-workflow\.md is retired: .* If the team added rules of its own to that file, move them into AGENTS\.md first\./);
  assert.match(context, /Stage it with its executable bit, or git skips it on a teammate's machine: git add --chmod=\+x \.githooks\/pre-commit\./);
  assert.match(context, /yours to edit by hand: CLAUDE\.md\. The "Team workflow rules" section teamwork-init added to CLAUDE\.md can go\./);
  assert.match(context, /Once this is committed, \.agents\/retired\/agentic-teamwork\/ can be deleted\./);
  assert.match(message, /^agentic-teamwork moved \d+ path\(s\) to its current layout\.$/, "the person hears it too");
});

test("the same session is briefed from the layout it was just moved to", (t) => {
  const { dir } = oldRepo(t);
  const { context } = start(dir);
  assert.match(context, /\n\nTeam conventions v1\. Branch: feat\/live\. This repo's lanes: unit `true`\.\n\nCritical, from agentic-teamwork:\n/);
  assert.match(context, /- Branch as <type>\/<topic>, never commit on the default branch/, "the full lines, not the question");
  assert.doesNotMatch(context, /ask the person once/);
});

test("a repo with only the settings file moves just that, and says nothing about a mirror", (t) => {
  const { dir } = oldRepo(t, "teamwork-only", { mirror: false, extras: false });
  const { context } = start(dir);
  assert.equal(has(dir, `${RETIRED}/${OLD_CONFIG}`), true);
  assert.equal(has(dir, ".githooks"), false);
  assert.doesNotMatch(context, /chmod|yours to edit by hand|team-workflow/);
});

test("a first-layout test command in its own folder becomes a lane that goes there", (t) => {
  const { dir } = oldRepo(t, "teamwork-only", { edit: (c) => ({ ...c, test: { ...c.test, command: "npm test", dir: "server" } }) });
  start(dir);
  assert.deepEqual(json(dir, ".agents/manifest.json").lanes, { unit: "cd server && npm test" });
  const none = oldRepo(t, "teamwork-only", { edit: (c) => ({ ...c, baseBranch: "trunk", test: { ...c.test, command: null } }) });
  const { context } = start(none.dir);
  assert.deepEqual(json(none.dir, ".agents/manifest.json").lanes, {});
  assert.equal(json(none.dir, ".agents/manifest.json").default_branch, "trunk");
  assert.match(context, /names no lanes yet: ask the person to run \/agentic-teamwork:init-project --upgrade/);
});

test("it runs for the kinds of repo the first layout was used in", (t) => {
  for (const kind of ["adopted", "unborn"]) {
    const { dir } = oldRepo(t, kind, { mirror: false, extras: false });
    const before = snapshot(dir);
    const { context } = start(dir);
    assert.match(context, /moved this repo to its current layout/, kind);
    assert.equal(has(dir, ".agents/manifest.json") && has(dir, `${RETIRED}/${OLD_CONFIG}`) && !has(dir, OLD_CONFIG), true, kind);
    // Everything that is not this plugin's is byte for byte where it was.
    const now = snapshot(dir);
    for (const [rel, text] of Object.entries(before)) if (rel !== OLD_CONFIG) assert.equal(now[rel], text, `${kind}: ${rel}`);
  }
});

// ---- nothing loosens -----------------------------------------------------

test("the settings the hooks act on are the same before and after, key for key", (t) => {
  const edits = [
    (c) => c,
    (c) => ({ version: 1, baseBranch: c.baseBranch }),
    (c) => ({ ...c, protectedBranches: ["main", "release"], branchPrefixes: ["feat/"], escapeHatch: "MAINTAINER", secretPatternsExtra: ["sk_live_[[:alnum:]]{8,}"], junkPatterns: ["\\.log$"] }),
    (c) => ({ ...c, lint: { command: "eslint {file}", filePatterns: ["\\.ts$"] }, coupledFiles: [{ files: ["a", "b"], message: "together" }], scan: { maxFileBytes: 1000 } }),
    (c) => ({ ...c, rules: { ...c.rules, requireTestsPass: false, blockForcePush: false, stopGate: false } }),
    (c) => ({ ...c, test: { command: null }, build: { command: "make", dir: "app" }, docs: { files: ["GUIDE.md"], watchPatterns: ["^src/"] } }),
  ];
  for (const [n, edit] of edits.entries()) {
    const { dir } = oldRepo(t, "teamwork-only", { edit });
    const before = rules(dir);
    start(dir);
    assert.equal(has(dir, OLD_CONFIG), false, `settings ${n} were not moved`);
    assert.deepEqual(rules(dir), before, `settings ${n} changed in the move`);
  }
});

test("what was refused before is refused after: the stricter rules are written down, not dropped", (t) => {
  const { dir, git } = oldRepo(t, "teamwork-only", { edit: (c) => ({ ...c, test: { ...c.test, command: FAILING } }) });
  git("add", "src/app.py");
  const asked = () => ({
    onBranch: guard(dir, "git commit -m x"),
    force: guard(dir, "git push --force origin feat/live"),
    toMaster: guard(dir, "git push origin HEAD:master"),
  });
  const before = asked();
  assert.equal(before.onBranch.decision, "deny");
  assert.match(before.onBranch.reason, /1 failing: adds two numbers/, "passing tests were a hard gate in the first layout");
  assert.match(before.toMaster.reason, /Pushing to master/, "master was protected beside main");
  start(dir);
  assert.equal(json(dir, ".agents/manifest.json").teamwork.requireTestsPass, true);
  assert.deepEqual(json(dir, ".agents/manifest.json").teamwork.protectedBranches, ["main", "master"]);
  const now = asked();
  assert.deepEqual(now.onBranch.decision, "deny");
  assert.match(now.onBranch.reason, /1 failing: adds two numbers/);
  assert.equal(now.force.decision, "deny");
  assert.match(now.toMaster.reason, /Pushing to master/);
});

test("a settings file that left the defaults unsaid still gets them written down", (t) => {
  // The first layout protected main and master and gated on tests unless told otherwise.
  const { dir, git } = oldRepo(t, "teamwork-only", { edit: () => ({ version: 1, test: { command: FAILING } }) });
  git("add", "src/app.py");
  start(dir);
  const { teamwork } = json(dir, ".agents/manifest.json");
  assert.equal(teamwork.requireTestsPass, true);
  assert.deepEqual(teamwork.protectedBranches, ["main", "master"]);
  assert.deepEqual(teamwork.branchPrefixes, ["feature/", "fix/", "chore/"]);
  assert.match(guard(dir, "git commit -m x").reason, /1 failing: adds two numbers/);
  assert.match(guard(dir, "git push origin HEAD:master").reason, /Pushing to master/);
});

test("the mirror it writes enforces the moved rules for a commit made in a terminal", (t) => {
  const { dir, git } = oldRepo(t);
  start(dir);
  fs.chmodSync(path.join(dir, ".githooks/pre-commit"), 0o755);
  git("config", "core.hooksPath", ".githooks");
  git("switch", "-q", "main");
  git("add", "src/app.py");
  const PATH = [path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter);
  const commit = (extra = {}) => {
    try { execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "x"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env(dir), PATH, Path: PATH, ...extra } }); return { ok: true, stderr: "" }; } catch (e) { return { ok: false, stderr: String(e.stderr) }; }
  };
  const refused = commit();
  assert.equal(refused.ok, false, "a commit on main went through");
  assert.match(refused.stderr, /pre-commit: commits on main are not allowed/);
  assert.equal(commit({ TEAMWORK_ALLOW: "1" }).ok, true, "the escape hatch it had still opens");
});

// ---- only once, and never over anything ----------------------------------

test("a second run is silent about moving and changes nothing", (t) => {
  const { dir } = oldRepo(t);
  const first = start(dir);
  assert.match(first.context, /moved this repo/);
  const after = snapshot(dir);
  for (const n of [2, 3]) {
    const again = start(dir);
    assert.doesNotMatch(again.context, /moved this repo|retired|chmod/, `run ${n} reported a move`);
    assert.equal(again.message, "", `run ${n} told the person something`);
    assert.match(again.context, /^Team conventions v1\./);
    assert.deepEqual(snapshot(dir), after, `run ${n} changed the repo`);
  }
});

test("a repo that never had the first layout is not touched", (t) => {
  for (const kind of ["standard", "portable", "bare"]) {
    const dir = makeFixture(tempDir(t, "tw-migrate-"), kind);
    const before = snapshot(dir);
    const { context, message } = start(dir);
    assert.doesNotMatch(context, /moved this repo/, kind);
    assert.equal(message, "", kind);
    assert.deepEqual(snapshot(dir), before, kind);
  }
});

test("a subagent starting never moves a repo", (t) => {
  const { dir } = oldRepo(t);
  const before = snapshot(dir);
  start(dir, { event: "SubagentStart", extra: { agent_type: "general-purpose" } });
  assert.deepEqual(snapshot(dir), before);
});

test("a manifest that is already there is never rewritten: the block is left beside it to add by hand", (t) => {
  const { dir, git } = oldRepo(t, "teamwork-only", { edit: (c) => ({ ...c, test: { ...c.test, command: FAILING } }) });
  const theirs = `${JSON.stringify({ standard: "agentic-engineering", standard_version: 1, project: "theirs", default_branch: "main", lanes: { unit: "make test" }, owned: {} }, null, 2)}\n`;
  write(dir, ".agents/manifest.json", theirs);
  const oldText = read(dir, OLD_CONFIG);
  const first = start(dir);
  assert.equal(read(dir, ".agents/manifest.json"), theirs, "the manifest was overwritten");
  assert.equal(read(dir, OLD_CONFIG), oldText, "the old settings stay where the hooks still read them");
  assert.equal(read(dir, ".githooks/pre-commit"), OLD_MIRROR, "and so does the mirror that reads them");
  assert.deepEqual(json(dir, `${RETIRED}/teamwork-block.json`), blockFromFirstLayout(json(dir, OLD_CONFIG)));
  assert.match(first.context, /\.agents\/manifest\.json has no `teamwork` block, so this repo's git rules are still read from \.claude\/teamwork\.json\. Add the contents of \.agents\/retired\/agentic-teamwork\/teamwork-block\.json to the manifest as its `teamwork` key/);

  // Until somebody does, nothing loosens and every session says what is left.
  git("add", "src/app.py");
  assert.match(guard(dir, "git commit -m x").reason, /1 failing: adds two numbers/);
  const second = start(dir);
  assert.doesNotMatch(second.context, /moved this repo/);
  assert.match(second.context, /The git rules are still read from \.claude\/teamwork\.json: add the contents of \.agents\/retired\/agentic-teamwork\/teamwork-block\.json to \.agents\/manifest\.json as its `teamwork` key\./);

  // Once the block is in the manifest, the next session finishes the move.
  write(dir, ".agents/manifest.json", `${JSON.stringify({ ...JSON.parse(theirs), teamwork: json(dir, `${RETIRED}/teamwork-block.json`) }, null, 2)}\n`);
  const third = start(dir);
  assert.match(third.context, /moved this repo to its current layout/);
  assert.equal(has(dir, OLD_CONFIG), false);
  assert.equal(read(dir, ".githooks/pre-commit"), NEW_MIRROR);
  assert.equal(json(dir, ".agents/manifest.json").project, "theirs");
  assert.match(guard(dir, "git commit -m x").reason, /1 failing: adds two numbers/);
});

test("a path that already holds something is left alone and reported, never written over", (t) => {
  const { dir } = oldRepo(t);
  write(dir, `${RETIRED}/${OLD_RULES}`, "somebody's own file\n");
  const { context } = start(dir);
  assert.equal(read(dir, `${RETIRED}/${OLD_RULES}`), "somebody's own file\n");
  assert.equal(read(dir, OLD_RULES), RULES_TEXT, "the file that could not be parked stays");
  assert.match(context, /left these in place because the new path already exists: \.claude\/rules\/team-workflow\.md/);
  assert.equal(has(dir, `${RETIRED}/${OLD_CONFIG}`), true, "the rest of the move went ahead");
});

test("a pre-commit hook the team wrote itself is not replaced", (t) => {
  const { dir } = oldRepo(t, "teamwork-only", { mirror: false });
  const theirs = "#!/bin/sh\nnpm run lint-staged\n";
  write(dir, ".githooks/pre-commit", theirs);
  const { context } = start(dir);
  assert.equal(read(dir, ".githooks/pre-commit"), theirs);
  assert.equal(has(dir, `${RETIRED}/.githooks/pre-commit`), false);
  assert.doesNotMatch(context, /chmod/);
  assert.equal(has(dir, `${RETIRED}/${OLD_CONFIG}`), true);
});

test("a settings file that does not parse is left for a person: nothing is guessed from it", (t) => {
  const { dir } = oldRepo(t);
  write(dir, OLD_CONFIG, "{ not json");
  const before = snapshot(dir);
  const { context } = start(dir);
  assert.doesNotMatch(context, /moved this repo/);
  assert.deepEqual(snapshot(dir), before);
});

test("an interrupted move is finished by the next session", (t) => {
  const { dir } = oldRepo(t);
  // As if the first run stopped after parking the old mirror: the settings file is still the marker.
  fs.mkdirSync(path.join(dir, RETIRED, ".githooks"), { recursive: true });
  fs.renameSync(path.join(dir, ".githooks/pre-commit"), path.join(dir, RETIRED, ".githooks/pre-commit"));
  start(dir);
  assert.equal(read(dir, ".githooks/pre-commit"), NEW_MIRROR);
  assert.equal(has(dir, OLD_CONFIG), false);
  assert.equal(has(dir, ".githooks/lib-guard.sh"), false);
});

test("the whole hook, migration included, finishes well inside three seconds", (t) => {
  const { dir } = oldRepo(t);
  const { ms, context } = start(dir);
  assert.match(context, /moved this repo/);
  assert.ok(ms < 3000, `it took ${ms}ms`);
});
