// verify-standard.mjs, the check agentic-teamwork ships into a repo and CI
// runs there: a temp repo that is correct, then one broken thing at a time.
// The point of each case is that the finding fires for the reason it claims,
// not merely that the exit code is 1.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const SCRIPTS = path.join(REPO, "plugins", "agentic-teamwork", "templates", "common", ".agents", "scripts");
const WORKFLOW = ".github/workflows/team-conventions.yml";
const FENCE = "# >>> agentic-teamwork\n.env\n# <<< agentic-teamwork\n";
const MARKER = { standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", forge: "github", lanes: { unit: "true" }, owned: {} };

/**
 * A folder that passes: the scripts, the marker, the hub and its one-line
 * link, the ignore block, and a workflow that runs the check. `files` then
 * overrides: a string is written, an object becomes JSON, null removes.
 */
function repo(t, files = {}) {
  const dir = tempDir(t, "conventions-");
  for (const script of ["verify-standard.mjs", "lane.mjs", "plugin-check.mjs"]) {
    write(dir, `.agents/scripts/${script}`, fs.readFileSync(path.join(SCRIPTS, script), "utf8"));
  }
  const base = {
    ".agents/manifest.json": MARKER,
    "AGENTS.md": "# fixture\n\n## Layout\n\n- `.agents/` - the marker and the scripts.\n",
    "CLAUDE.md": "@AGENTS.md\n",
    ".gitignore": FENCE,
    [WORKFLOW]: "jobs:\n  conventions:\n    steps:\n      - run: node .agents/scripts/verify-standard.mjs\n",
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    if (content === null) fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    else write(dir, rel, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return dir;
}

const verify = (dir, args = []) => runNode(path.join(dir, ".agents", "scripts", "verify-standard.mjs"), args, { cwd: dir });
function finding(t, files, pattern, args = []) {
  const result = verify(repo(t, files), args);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, pattern);
  assert.match(result.stdout, /^1 finding\(s\)$/m, `one finding, for one reason:\n${result.stdout}`);
}

test("a repo on the conventions passes, with no git and from any directory", (t) => {
  const dir = repo(t);
  const result = verify(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, "conventions ok\n");
  assert.equal(runNode(path.join(dir, ".agents", "scripts", "verify-standard.mjs"), [], { cwd: REPO }).stdout, "conventions ok\n");
  assert.equal(verify(dir, ["--quick"]).status, 0, "--quick is accepted");
});

test("--root checks another checkout", (t) => {
  const good = repo(t);
  const bad = repo(t, { "AGENTS.md": null });
  const result = runNode(path.join(good, ".agents", "scripts", "verify-standard.mjs"), ["--root", bad]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^hub: /m);
});

test("no marker is a `marker` finding", (t) => {
  finding(t, { ".agents/manifest.json": null }, /^marker: \.agents\/manifest\.json is missing/m);
});

test("a marker that does not parse, or has no integer version, is a `marker` finding", (t) => {
  finding(t, { ".agents/manifest.json": "{ not json" }, /^marker: \.agents\/manifest\.json does not parse/m);
  finding(t, { ".agents/manifest.json": { ...MARKER, standard_version: "one" } }, /^marker: .*standard_version is "one", not an integer/m);
});

test("a marker below the floor is a `floor` finding, and only that", (t) => {
  finding(t, {}, /^floor: standard_version 1 is below the floor 2$/m, ["--floor", "2"]);
  assert.equal(verify(repo(t), ["--floor", "1"]).status, 0);
});

test("a missing hub is a `hub` finding", (t) => {
  finding(t, { "AGENTS.md": null }, /^hub: AGENTS\.md is missing at the repo root$/m);
});

test("CLAUDE.md has to be a link to the hub: a symlink, or the one import line", (t) => {
  finding(t, { "CLAUDE.md": null }, /^claude-md: CLAUDE\.md is missing at the repo root/m);
  finding(t, { "CLAUDE.md": "# instructions of its own\n" }, /^claude-md: the root CLAUDE\.md has content of its own/m);
  // What a checkout that cannot hold a symlink leaves in its place.
  assert.equal(verify(repo(t, { "CLAUDE.md": "AGENTS.md" })).status, 0);
});

test("a symlinked CLAUDE.md passes when it points at the hub, and only then", { skip: process.platform === "win32" && "creating a symlink needs a privilege Windows does not grant by default" }, (t) => {
  const dir = repo(t, { "CLAUDE.md": null });
  fs.symlinkSync("AGENTS.md", path.join(dir, "CLAUDE.md"));
  assert.equal(verify(dir).status, 0);
  fs.rmSync(path.join(dir, "CLAUDE.md"));
  fs.symlinkSync("README.md", path.join(dir, "CLAUDE.md"));
  const result = verify(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^claude-md: the root CLAUDE\.md links to README\.md, not AGENTS\.md$/m);
});

test("a rule the hub does not import is a `rules-imported` finding", (t) => {
  finding(t, { ".agents/rules/local.md": "# a rule nobody loads\n" }, /^rules-imported: AGENTS\.md carries no @ import for: local\.md$/m);
  const imported = repo(t, { ".agents/rules/local.md": "# a rule\n", "AGENTS.md": "# fixture\n\n@.agents/rules/local.md\n" });
  assert.equal(verify(imported).status, 0);
});

test("a missing ignore block is a `gitignore-fence` finding", (t) => {
  finding(t, { ".gitignore": "node_modules/\n" }, /^gitignore-fence: /m);
  finding(t, { ".gitignore": null }, /^gitignore-fence: /m);
});

test("on GitHub, some workflow has to run the check", (t) => {
  finding(t, { [WORKFLOW]: null }, /^ci-gate: no workflow under \.github\/workflows\/ runs verify-standard\.mjs; \/agentic-teamwork:init-project --upgrade writes it$/m);
  finding(t, { [WORKFLOW]: "jobs:\n  test:\n    steps:\n      - run: npm test\n" }, /^ci-gate: /m);
  // Where the gate lives is the repo's business.
  const moved = repo(t, { [WORKFLOW]: null, ".github/workflows/ci.yaml": "steps:\n  - run: node .agents/scripts/verify-standard.mjs\n" });
  assert.equal(verify(moved).status, 0);
});

test("on GitLab, the pipeline has to run the check or include a local file that does", (t) => {
  const gitlab = { ".agents/manifest.json": { ...MARKER, forge: "gitlab" }, [WORKFLOW]: null };
  const gate = "team-conventions:\n  script:\n    - node .agents/scripts/verify-standard.mjs\n";
  finding(t, gitlab, /^ci-gate: \.gitlab-ci\.yml is missing; /m);
  finding(t, { ...gitlab, ".gitlab-ci.yml": "unit:\n  script: [npm test]\n" }, /^ci-gate: \.gitlab-ci\.yml neither runs verify-standard\.mjs nor includes a local file that does/m);
  finding(t, { ...gitlab, ".gitlab-ci.yml": "include:\n  - local: .gitlab/ci/team-conventions.yml\n" }, /^ci-gate: /m);
  for (const pipeline of ["include:\n  - local: .gitlab/ci/team-conventions.yml\n", "include: '/.gitlab/ci/team-conventions.yml'\n"]) {
    assert.equal(verify(repo(t, { ...gitlab, ".gitlab-ci.yml": pipeline, ".gitlab/ci/team-conventions.yml": gate })).status, 0, pipeline);
  }
  assert.equal(verify(repo(t, { ...gitlab, ".gitlab-ci.yml": gate })).status, 0);
});

test("a repo with no forge yet is warned about the gate, and passes", (t) => {
  const dir = repo(t, { ".agents/manifest.json": { ...MARKER, forge: "none" }, [WORKFLOW]: null });
  const result = verify(dir);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /^warning: ci-gate: no CI runs verify-standard\.mjs yet/m);
  assert.match(result.stdout, /^conventions ok$/m);
  const json = JSON.parse(verify(dir, ["--json"]).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.warnings[0].finding, "ci-gate");
});

test("a script the gate or the session hook runs has to be there", (t) => {
  finding(t, { ".agents/scripts/lane.mjs": null }, /^scripts-present: \.agents\/scripts\/lane\.mjs is missing$/m);
  const hook = { hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.agents/scripts/plugin-check.mjs"' }] }] } };
  finding(t, { ".claude/settings.json": hook, ".agents/scripts/plugin-check.mjs": null }, /^scripts-present: \.claude\/settings\.json runs \.agents\/scripts\/plugin-check\.mjs, which is missing$/m);
  // A repo that left the hook out does not need the script.
  assert.equal(verify(repo(t, { ".agents/scripts/plugin-check.mjs": null })).status, 0);
});

test("--json reports the same findings as one object", (t) => {
  const result = verify(repo(t, { ".agents/manifest.json": null, "AGENTS.md": null }), ["--json"]);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.findings.map((f) => f.finding), ["marker", "hub"]);
});
