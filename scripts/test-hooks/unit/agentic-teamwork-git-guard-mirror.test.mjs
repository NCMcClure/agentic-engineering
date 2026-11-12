// agentic-teamwork's pre-commit mirror (templates/githooks/pre-commit): the
// commit rules for a person committing outside Claude Code. Every case goes
// through a real `git commit` with core.hooksPath set, since that is the only
// way the file is ever run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const MIRROR = path.join(REPO, "plugins", "agentic-teamwork", "templates", "githooks", "pre-commit");
const SOURCE = fs.readFileSync(MIRROR, "utf8");
const suite = { after };
const HOME = tempDir(suite, "tw-mirror-home-");
// git runs the hook through its shebang, so node has to be findable by name.
const PATH = [path.dirname(process.execPath), process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter);

const MANIFEST = { standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: { unit: "npm test" }, owned: {} };
const node = (code) => `"${process.execPath}" -e "${code}"`;
const PASSING = node("process.exit(0)");
const FAILING = node("console.log('1 failing: adds two numbers'); process.exit(1)");

/** A repo with the mirror installed and turned on, one commit, and `staged` in the index. */
function repo(t, { branch = "feat/topic", manifest = MANIFEST, teamwork, staged = { "src/a.mjs": "export const a = 1;\n" }, tracked = {}, born = true } = {}) {
  const { dir, git } = tempRepo(t, "tw-mirror-");
  write(dir, ".githooks/pre-commit", SOURCE);
  fs.chmodSync(path.join(dir, ".githooks/pre-commit"), 0o755);
  git("config", "core.hooksPath", ".githooks");
  if (typeof manifest === "string") write(dir, ".agents/manifest.json", manifest);
  else if (manifest) write(dir, ".agents/manifest.json", JSON.stringify({ ...manifest, ...(teamwork ? { teamwork } : {}) }, null, 2));
  write(dir, "README.md", "# fixture\n");
  for (const [rel, content] of Object.entries(tracked)) write(dir, rel, content);
  if (born) {
    git("add", "-A");
    git("commit", "-q", "--no-verify", "-m", "first");
    if (branch !== "main") git("switch", "-q", "-c", branch);
  }
  for (const [rel, content] of Object.entries(staged)) write(dir, rel, content);
  git("add", "-A");
  return { dir, git };
}

/** `git commit`, as a person at a terminal: `ok`, and what the hook said. */
function commit(dir, extraEnv = {}) {
  const env = { ...process.env, HOME, USERPROFILE: HOME, PATH, Path: PATH, TEAMWORK_ALLOW: "", TEAMWORK_SKIP_TESTS: "", ...extraEnv };
  const r = spawnSync("git", ["-C", dir, "commit", "-q", "-m", "a change"], { encoding: "utf8", env });
  return { ok: r.status === 0, said: `${r.stdout}${r.stderr}` };
}

test("a commit that breaks no rule goes through, and so does every commit where there is no manifest", (t) => {
  assert.equal(commit(repo(t).dir).ok, true);
  const unmarked = repo(t, { branch: "main", manifest: null, staged: { ".env": "NAME=value\n" } });
  assert.equal(commit(unmarked.dir).ok, true, "a repo that has not opted in is not checked");
});

test("a commit on the protected branch is refused, with the branch command", (t) => {
  const out = commit(repo(t, { branch: "main" }).dir);
  assert.equal(out.ok, false);
  assert.match(out.said, /pre-commit: commits on main are not allowed: it moves only through a pull or merge request\. Branch first: git switch -c <type>\/<topic>/);
  const named = commit(repo(t, { branch: "release", teamwork: { protectedBranches: ["release"], branchPrefixes: ["feature/"] } }).dir);
  assert.match(named.said, /commits on release are not allowed.*git switch -c feature\/<topic>/s);
  assert.equal(commit(repo(t, { branch: "main", teamwork: { protectedBranches: ["release"] } }).dir).ok, true, "only the named branches are protected");
});

test("a repo's first commit lands on its default branch", (t) => {
  assert.equal(commit(repo(t, { born: false }).dir).ok, true);
});

test("staged junk is refused; deleting junk and committing an env example are not", (t) => {
  const out = commit(repo(t, { staged: { ".env": "NAME=value\n", "pkg/node_modules/x.js": "x\n" } }).dir);
  assert.equal(out.ok, false);
  assert.match(out.said, /these staged files must never be committed:\n\.env\npkg\/node_modules\/x\.js\n/);
  const cleanup = repo(t, { tracked: { ".DS_Store": "junk\n" }, staged: {} });
  cleanup.git("rm", "-q", ".DS_Store");
  assert.equal(commit(cleanup.dir).ok, true);
  assert.equal(commit(repo(t, { staged: { ".env.example": "NAME=\n", "api/.env.sample": "NAME=\n", ".env.template": "NAME=\n" } }).dir).ok, true);
  assert.match(commit(repo(t, { teamwork: { junkPatterns: ["\\.log$"] }, staged: { "run.log": "x\n" } }).dir).said, /run\.log/);
});

test("a staged credential is refused as file:line, never as the value", (t) => {
  const token = `ghp_${"a".repeat(36)}`;
  const out = commit(repo(t, { staged: { "config.mjs": `// settings\nconst token = "${token}";\n` } }).dir);
  assert.equal(out.ok, false);
  assert.match(out.said, /possible credentials in the staged change \(file:line\):\nconfig\.mjs:2\n/);
  assert.equal(out.said.includes(token), false);
  const extra = commit(repo(t, { teamwork: { secretPatternsExtra: ["sk_live_[[:alnum:]]{8,}"] }, staged: { "pay.mjs": 'const k = "sk_live_abcd1234";\n' } }).dir);
  assert.match(extra.said, /pay\.mjs:1/);
});

test("each rule has its switch", (t) => {
  const rules = { blockCommitOnProtected: false, blockJunk: false, blockSecrets: false };
  const staged = { ".env": "NAME=value\n", "k.mjs": `const k = "AKIA${"B".repeat(16)}";\n` };
  assert.equal(commit(repo(t, { branch: "main", staged, teamwork: { rules } }).dir).ok, true);
  assert.match(commit(repo(t, { staged, teamwork: { rules: { blockJunk: false } } }).dir).said, /possible credentials/);
});

test("the escape hatch in the environment skips everything, under the repo's own name for it", (t) => {
  const { dir } = repo(t, { branch: "main" });
  assert.equal(commit(dir, { TEAMWORK_ALLOW: "0" }).ok, false);
  assert.equal(commit(dir, { TEAMWORK_ALLOW: "1" }).ok, true);
  const renamed = repo(t, { branch: "main", teamwork: { escapeHatch: "MAINTAINER_SAYS_SO" } });
  assert.equal(commit(renamed.dir, { TEAMWORK_ALLOW: "1" }).ok, false);
  assert.equal(commit(renamed.dir, { MAINTAINER_SAYS_SO: "1" }).ok, true);
});

test("requireTestsPass: failing tests refuse the commit, passing ones do not, and the skip is there for who needs it", (t) => {
  const failing = repo(t, { teamwork: { requireTestsPass: true, test: { command: FAILING } } });
  const out = commit(failing.dir);
  assert.equal(out.ok, false);
  assert.match(out.said, /must pass before every commit, and it fails now \(TEAMWORK_SKIP_TESTS=1 skips it, if you know why\):\n1 failing: adds two numbers/);
  assert.equal(commit(failing.dir, { TEAMWORK_SKIP_TESTS: "1" }).ok, true);
  assert.equal(commit(repo(t, { teamwork: { requireTestsPass: true, test: { command: PASSING } } }).dir).ok, true);
  assert.equal(commit(repo(t, { teamwork: { rules: { requireTestsPass: true }, build: { command: FAILING } } }).dir).ok, false, "read from rules, falling back to the build");
  assert.equal(commit(repo(t, { teamwork: { test: { command: FAILING } } }).dir).ok, true, "off unless the repo turns it on");
});

test("a manifest that does not parse fails closed, with the way through", (t) => {
  const { dir } = repo(t, { manifest: "{ not json" });
  const out = commit(dir);
  assert.equal(out.ok, false);
  assert.match(out.said, /\.agents\/manifest\.json does not parse .*, so the commit rules cannot be read\. Fix it, or commit once with TEAMWORK_ALLOW=1\./);
  assert.equal(commit(dir, { TEAMWORK_ALLOW: "1" }).ok, true);
});

test("it is self-contained: nothing loaded but Node's own modules", () => {
  assert.match(SOURCE, /^#!\/usr\/bin\/env node\n/);
  const loaded = [...SOURCE.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)|\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(loaded.sort(), ["node:child_process", "node:fs", "node:path"]);
  assert.doesNotMatch(SOURCE, /CLAUDE_PLUGIN_ROOT|import\.meta|__dirname/);
  assert.doesNotMatch(SOURCE, /process\.exit\(/);
});

test("it runs whether the repo's package.json makes a bare file a module or not", (t) => {
  for (const type of ["module", "commonjs", null]) {
    const dir = tempDir(t, "tw-mirror-type-");
    if (type) write(dir, "package.json", JSON.stringify({ type }));
    fs.copyFileSync(MIRROR, path.join(dir, "pre-commit"));
    const result = runNode(path.join(dir, "pre-commit"), [], { cwd: dir, env: { ...process.env, HOME } });
    assert.equal(result.status, 0, `${type}: ${result.stderr}`);
    assert.equal(result.stderr, "", String(type));
  }
});

test("the template is committed executable, so a copy of it is too", { skip: process.platform === "win32" && "Windows keeps no executable bit" }, () => {
  assert.ok(fs.statSync(MIRROR).mode & 0o111);
});
