// agentic-teamwork's session-start.mjs: the briefing it puts in front of its
// critical lines. What the kernel decides (who asks, which lines, subagents)
// has its own suite; pinned here is what this plugin says about the repo, and
// the silence where it has nothing to say.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const HOOK = path.join(REPO, "plugins", "agentic-teamwork", "hooks", "session-start.mjs");
const suite = { after };
// An empty settings dir: only this plugin is enabled, so it is the one that asks.
const HOME = tempDir(suite, "tw-start-home-");
write(HOME, ".claude/settings.json", "{}\n");

const LANES = { unit: "npm test", integration: "not wired: none yet", e2e: "not wired: no browser", live: "npm run test:live" };
const manifest = (extra = {}) => JSON.stringify({ standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: LANES, owned: {}, ...extra }, null, 2);

function session(dir, { event = "SessionStart", env = {}, extra = {} } = {}) {
  const input = JSON.stringify({ hook_event_name: event, source: "startup", session_id: "start", cwd: dir, ...extra });
  const result = runNode(HOOK, [], {
    cwd: dir, input,
    env: { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: "", ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const json = result.stdout.trim() ? JSON.parse(result.stdout) : null;
  return { json, context: json?.hookSpecificOutput?.additionalContext ?? "" };
}

/** A repo on the conventions, on feat/x unless told otherwise. */
function marked(t, { manifestExtra = {}, files = {}, branch = "feat/x", remote } = {}) {
  const { dir, git } = tempRepo(t, "tw-start-");
  write(dir, ".agents/manifest.json", manifest(manifestExtra));
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  if (remote) git("remote", "add", "origin", remote);
  git("add", "-A");
  git("commit", "-q", "-m", "marked");
  if (branch !== "main") git("switch", "-q", "-c", branch);
  return { dir, git };
}

// ---- a repo on the conventions -------------------------------------------

test("the briefing leads the context: version, branch, lanes, then the critical lines", (t) => {
  const { context } = session(marked(t).dir);
  assert.match(context, /^Team conventions v1\. Branch: feat\/x\. This repo's lanes: unit `npm test`; integration not wired; e2e not wired; live `npm run test:live`\.\n\nCritical, from agentic-teamwork:\n/);
  assert.match(context, /- Branch as <type>\/<topic>, never commit on the default branch/);
  assert.doesNotMatch(context, /init-project --upgrade/, "nothing to upgrade");
  assert.doesNotMatch(context, /bootstrap/);
});

test("on the default branch it says so, with the branch command", (t) => {
  const { context } = session(marked(t, { branch: "main" }).dir);
  assert.match(context, /Branch: main\. You are on main, which rejects commits and pushes\. Branch first: git switch -c <type>\/<topic>\./);
});

test("the warning follows the repo's settings: its protected branches and its prefix, or nothing with both rules off", (t) => {
  const teamwork = { protectedBranches: ["release"], branchPrefixes: ["feature/"] };
  assert.match(session(marked(t, { branch: "release", manifestExtra: { teamwork } }).dir).context, /You are on release, which rejects commits and pushes\. Branch first: git switch -c feature\/<topic>\./);
  assert.doesNotMatch(session(marked(t, { branch: "main", manifestExtra: { teamwork } }).dir).context, /You are on main/);
  const off = { rules: { blockCommitOnProtected: false, blockPushToProtected: false } };
  assert.doesNotMatch(session(marked(t, { branch: "main", manifestExtra: { teamwork: off } }).dir).context, /You are on main/);
});

test("before the first commit it says where that commit lands", (t) => {
  const { dir } = tempRepo(t, "tw-start-unborn-");
  write(dir, ".agents/manifest.json", manifest());
  const { context } = session(dir);
  assert.match(context, /Branch: main\. The first commit lands on main; after it, branch before every change: git switch -c <type>\/<topic>\./);
  assert.doesNotMatch(context, /rejects commits/);
});

test("a branch behind its base as last fetched is told by how much", (t) => {
  const { dir, git } = marked(t, { branch: "main" });
  git("switch", "-q", "-c", "feat/x");
  git("switch", "-q", "main");
  for (const n of [1, 2]) { write(dir, `more-${n}.txt`, "x\n"); git("add", "-A"); git("commit", "-q", "-m", `more ${n}`); }
  git("update-ref", "refs/remotes/origin/main", "main");
  git("switch", "-q", "feat/x");
  assert.match(session(dir).context, /This branch is 2 commit\(s\) behind origin\/main as last fetched\. Fetch and merge it before building on this branch\./);
  git("merge", "-q", "main");
  assert.doesNotMatch(session(dir).context, /behind origin\/main/);
});

test("a detached HEAD is named as one", (t) => {
  const { dir, git } = marked(t);
  git("switch", "-q", "--detach");
  assert.match(session(dir).context, /Branch: a detached HEAD\./);
});

// ---- the upgrade nudge ---------------------------------------------------

test("a manifest with no lanes yet is told to upgrade, since the lanes come from it", (t) => {
  const { context } = session(marked(t, { manifestExtra: { lanes: {} } }).dir);
  assert.match(context, /This repo's manifest names no lanes yet: ask the person to run \/agentic-teamwork:init-project --upgrade on a branch, then commit what it changes\./);
});

test("rule files the manifest owns and still carries are told to upgrade, since they load twice", (t) => {
  const { context } = session(marked(t, { manifestExtra: { owned: { ".agents/rules/ladder.md": "0".repeat(64) } }, files: { ".agents/rules/ladder.md": "# The ladder\n" } }).dir);
  assert.match(context, /still carries rule files the plugin now delivers at session start, so they load twice: ask the person to run \/agentic-teamwork:init-project --upgrade on a branch/);
});

test("a repo's own rules are not mistaken for the plugin's", (t) => {
  const { context } = session(marked(t, { files: { ".agents/rules/house.md": "# ours\n" } }).dir);
  assert.doesNotMatch(context, /init-project --upgrade/);
});

// ---- the pre-commit mirror -----------------------------------------------

test("a committed mirror that git would skip gets one line, and one that can run gets none", (t) => {
  const mirror = fs.readFileSync(path.join(REPO, "plugins", "agentic-teamwork", "templates", "githooks", "pre-commit"), "utf8");
  const { dir, git } = marked(t, { files: { ".githooks/pre-commit": mirror } });
  git("update-index", "--chmod=-x", ".githooks/pre-commit");
  assert.match(session(dir).context, /\.githooks\/pre-commit is not executable, so git skips it and commits made in a terminal go unchecked: chmod \+x \.githooks\/pre-commit && git add --chmod=\+x \.githooks\/pre-commit\./);
  fs.chmodSync(path.join(dir, ".githooks/pre-commit"), 0o755);
  git("update-index", "--chmod=+x", ".githooks/pre-commit");
  assert.doesNotMatch(session(dir).context, /not executable/);
});

test("a hook the team wrote itself, and a mirror not committed yet, are not this line's business", (t) => {
  const own = marked(t, { files: { ".githooks/pre-commit": "#!/bin/sh\nnpm run lint-staged\n" } });
  own.git("update-index", "--chmod=-x", ".githooks/pre-commit");
  assert.doesNotMatch(session(own.dir).context, /not executable/);
  const fresh = marked(t);
  write(fresh.dir, ".githooks/pre-commit", "#!/usr/bin/env node\n// installed by agentic-teamwork\n");
  assert.doesNotMatch(session(fresh.dir).context, /not executable/);
});

// ---- a repo that is not on the conventions -------------------------------

test("answered team with no manifest: bootstrap before writing code", (t) => {
  const { dir, git } = tempRepo(t, "tw-start-team-");
  git("config", "--local", "agentic-engineering.plugins", "team Test 2026-01-01T00:00Z");
  const { context } = session(dir);
  assert.match(context, /^This repo is not on the team conventions yet: no \.agents\/manifest\.json\. Before writing code, ask the person to run \/agentic-teamwork:bootstrap, which works locally and pushes nothing\./);
  assert.match(context, /Critical, from agentic-teamwork:/);
});

test("answered on: the portable lines and no briefing at all", (t) => {
  const { dir, git } = tempRepo(t, "tw-start-on-");
  git("config", "--local", "agentic-engineering.plugins", "on Test 2026-01-01T00:00Z");
  const { context } = session(dir);
  assert.match(context, /^Critical, from agentic-teamwork:\n/);
  assert.match(context, /Test with the project's own test command/);
  assert.doesNotMatch(context, /bootstrap|Team conventions|lanes/);
});

test("nobody answered: the question, never the bootstrap nudge", (t) => {
  const { dir } = tempRepo(t, "tw-start-none-");
  const { context } = session(dir);
  assert.match(context, /^Before other work, ask the person once whether to use the agentic-engineering plugins in this repo/);
  assert.doesNotMatch(context, /not on the team conventions/);
});

test("answered off: nothing", (t) => {
  const { dir, git } = tempRepo(t, "tw-start-off-");
  git("config", "--local", "agentic-engineering.plugins", "off Test 2026-01-01T00:00Z");
  assert.equal(session(dir).json, null);
});

// ---- subagents -----------------------------------------------------------

test("a subagent gets the lines and never the briefing; a denied agent type gets nothing", (t) => {
  const { dir } = marked(t, { branch: "main" });
  const worker = session(dir, { event: "SubagentStart", extra: { agent_type: "general-purpose" } });
  assert.equal(worker.json.hookSpecificOutput.hookEventName, "SubagentStart");
  assert.match(worker.context, /^Critical, from agentic-teamwork:\n/);
  assert.doesNotMatch(worker.context, /Team conventions|You are on main/);
  assert.equal(session(dir, { event: "SubagentStart", extra: { agent_type: "Explore" } }).json, null);
});

// ---- the forge CLI -------------------------------------------------------

/** The directory `cmd` is found in on PATH, or null. */
function dirOnPath(cmd) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    if (exts.some((ext) => fs.existsSync(path.join(dir, cmd + ext)))) return dir;
  }
  return null;
}
const GIT_DIR = dirOnPath("git");
// The lookup also tries the usual install folders, so the "missing" case can only be shown where glab is in none of them.
const glabBesideGit = [GIT_DIR, "/opt/homebrew/bin", "/usr/local/bin"].some((dir) => dir && ["glab", "glab.exe", "glab.cmd"].some((name) => fs.existsSync(path.join(dir, name))));
const onlyGit = (extra = []) => ({ PATH: [...extra, GIT_DIR].join(path.delimiter), Path: [...extra, GIT_DIR].join(path.delimiter) });

test("a forge CLI that is not on PATH gets one line, with where to get it", { skip: glabBesideGit && "glab is installed beside git on this machine" }, (t) => {
  const { dir } = marked(t, { remote: "https://gitlab.com/group/project.git" });
  const { context } = session(dir, { env: onlyGit() });
  assert.match(context, /lanes: .*\. The glab CLI is not on PATH, so a merge request cannot be opened or landed from here\. Install it \(https:\/\/gitlab\.com\/gitlab-org\/cli#installation\) and sign in\.\n\nCritical/);
});

test("a forge CLI that is on PATH, and a remote on no known forge, add nothing", (t) => {
  const bin = tempDir(t, "tw-start-bin-");
  const fake = write(bin, process.platform === "win32" ? "glab.cmd" : "glab", process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
  fs.chmodSync(fake, 0o755);
  const { dir } = marked(t, { remote: "https://gitlab.com/group/project.git" });
  assert.doesNotMatch(session(dir, { env: onlyGit([bin]) }).context, /CLI is not on PATH/);
  const elsewhere = marked(t, { remote: "https://code.example.invalid/group/project.git" });
  assert.doesNotMatch(session(elsewhere.dir, { env: onlyGit() }).context, /CLI is not on PATH/);
  assert.doesNotMatch(session(marked(t).dir, { env: onlyGit() }).context, /CLI is not on PATH/, "no remote at all");
});

test("the provider a repo names decides the CLI, whatever the remote's host is called", { skip: glabBesideGit && "glab is installed beside git on this machine" }, (t) => {
  const { dir } = marked(t, { remote: "https://code.example.invalid/group/project.git", manifestExtra: { teamwork: { provider: "gitlab" } } });
  assert.match(session(dir, { env: onlyGit() }).context, /The glab CLI is not on PATH/);
});

// ---- the contract --------------------------------------------------------

test("empty and malformed stdin still brief the project dir's repo, and never fail", (t) => {
  const { dir } = marked(t);
  for (const input of ["", "{\"hook_event_name\": \"SessionStart\","]) {
    const result = runNode(HOOK, [], { cwd: dir, input, env: { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: "" } });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /^Team conventions v1\. Branch: feat\/x\./);
  }
});

test("the worst-case briefing stays well inside what a hook may print", (t) => {
  const lanes = Object.fromEntries(["unit", "integration", "e2e", "live"].map((lane) => [lane, `cd packages/${lane} && npm run test:${lane} -- --reporter=dot`]));
  const { dir } = marked(t, { branch: "main", remote: "https://gitlab.com/group/project.git", manifestExtra: { lanes, owned: { ".agents/rules/ladder.md": "0".repeat(64) } }, files: { ".agents/rules/ladder.md": "# The ladder\n" } });
  const { context } = session(dir, { env: glabBesideGit ? {} : onlyGit() });
  const briefing = context.split("\n\nCritical, from")[0];
  assert.ok(briefing.length < 1200, `the briefing is ${briefing.length} characters`);
});
