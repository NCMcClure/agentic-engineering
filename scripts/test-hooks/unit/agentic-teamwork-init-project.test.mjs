// agentic-teamwork's init-project.mjs: what a fresh scaffold writes, what an
// upgrade keeps, replaces and removes, and that a second upgrade changes
// nothing. Every case runs the real script against a temp folder; nothing
// here reaches a forge or a network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  GATE, GITIGNORE_END, GITIGNORE_START, detectTestCommand, ensureGitlabInclude, mergeSettings, validateDescription, validateName,
} from "../../../plugins/agentic-teamwork/scripts/init-project.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const INIT = "plugins/agentic-teamwork/scripts/init-project.mjs";
const TEMPLATES = path.join(REPO, "plugins", "agentic-teamwork", "templates");
const WINDOWS = process.platform === "win32";
const sha = (text) => createHash("sha256").update(text).digest("hex");
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));
const marker = (dir) => JSON.parse(read(dir, ".agents/manifest.json"));
const saveMarker = (dir, value) => write(dir, ".agents/manifest.json", `${JSON.stringify(value, null, 2)}\n`);
const both = (r) => `${r.stdout}\n${r.stderr}`;

/** A fresh scaffold in a new folder; returns its directory and the run. */
function fresh(t, extra = [], { template = "library", name = "zz-fresh" } = {}) {
  const dir = path.join(tempDir(t, "init-fresh-"), name);
  const run = runNode(INIT, ["--name", name, "--template", template, "--description", "A scaffold for the tests.", "--target", dir, ...extra]);
  return { dir, run };
}
const upgrade = (dir, extra = []) => runNode(INIT, ["--upgrade", "--target", dir, ...extra]);

/** A repo with its own hub, README, manifest and source, and no marker. */
function adoptable(t) {
  const { dir, git } = tempRepo(t, "init-adopt-");
  write(dir, "AGENTS.md", "# the repo's own hub\n\nProse the owner wrote.\n");
  write(dir, "README.md", "# the repo's own readme\n");
  write(dir, "package.json", '{\n  "name": "adoptable",\n  "scripts": { "test": "node --test" }\n}\n');
  write(dir, "src/main.mjs", "export const main = () => 0;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "before the conventions");
  return { dir, git };
}

// ---------------------------------------------------------------------------
// A fresh scaffold

test("a fresh scaffold writes the marker, the hub and its link, the scripts, the gate, and nothing to git", (t) => {
  const { dir, run } = fresh(t, ["--forge", "github"]);
  assert.equal(run.status, 0, both(run));
  assert.match(run.stdout, /verify-standard\.mjs: conventions ok/);

  const m = marker(dir);
  assert.deepEqual(Object.keys(m), ["standard", "standard_version", "project", "description", "template", "default_branch", "forge", "lanes", "owned"]);
  assert.deepEqual({ ...m, owned: null }, {
    standard: "agentic-engineering", standard_version: 1, project: "zz-fresh", description: "A scaffold for the tests.",
    template: "library", default_branch: "main", forge: "github",
    lanes: {
      unit: "npm test",
      integration: "not wired: this template has no integration lane yet",
      e2e: "not wired: a library has no e2e lane",
      live: "not wired: add one the day this library calls a model",
    },
    owned: null,
  });
  for (const rel of [".agents/scripts/verify-standard.mjs", ".agents/scripts/lane.mjs", ".agents/scripts/plugin-check.mjs", "AGENTS.md", "README.md", "src/index.mjs", GATE.github, ".githooks/pre-commit"]) {
    assert.equal(m.owned[rel], sha(fs.readFileSync(path.join(dir, rel))), `${rel} is owned at the hash of what was written`);
  }
  for (const merged of [".gitignore", ".claude/settings.json", "CLAUDE.md", ".agents/manifest.json"]) assert.equal(merged in m.owned, false, `${merged} is merged or made, not owned`);

  assert.match(read(dir, "AGENTS.md"), /^# zz-fresh\n\nA scaffold for the tests\.\n/);
  assert.match(read(dir, "AGENTS.md"), /`src\/` - the library/);
  assert.match(read(dir, "AGENTS.md"), /team-conventions\.yml` - the CI gate: the conventions check and the unit lane on every pull request/);
  assert.match(read(dir, "CONTRIBUTING.md"), /reviewed pull request with green CI/);
  assert.match(read(dir, GATE.github), /node \.agents\/scripts\/verify-standard\.mjs/);
  assert.match(read(dir, GATE.github), /node \.agents\/scripts\/lane\.mjs unit/);
  assert.match(read(dir, GATE.github), /branches: \["main"\]/);
  assert.ok(read(dir, ".gitignore").startsWith(GITIGNORE_START) && read(dir, ".gitignore").trimEnd().endsWith(GITIGNORE_END));
  assert.equal(JSON.parse(read(dir, "package.json")).name, "zz-fresh");
  for (const helper of ["template.json", "gitignore.block"]) assert.equal(exists(dir, helper), false, `${helper} is an input, not a file the repo keeps`);
  assert.doesNotMatch(both(run), /unreplaced template tokens/);
  assert.ok(exists(dir, ".git"), "a folder that was not a repo is one now");
  assert.match(run.stdout, /git init -b main/);
});

test("a fresh scaffold stages and commits nothing", (t) => {
  const { dir, git } = tempRepo(t, "init-local-");
  const run = runNode(INIT, ["--name", "zz-local", "--template", "library", "--description", "Local only.", "--target", dir]);
  assert.equal(run.status, 0, both(run));
  assert.equal(git("diff", "--cached", "--name-only"), "", "nothing is staged");
  assert.throws(() => git("rev-parse", "--verify", "-q", "HEAD"), "nothing is committed");
  assert.equal(git("config", "--get", "--default", "", "core.hooksPath"), "", "the hook path is the person's to set");
  assert.match(run.stdout, /git config core\.hooksPath \.githooks/);
});

test("the link is a symlink to the hub, or one import line where asked", (t) => {
  const { dir, run } = fresh(t);
  assert.equal(run.status, 0, both(run));
  if (WINDOWS) assert.equal(read(dir, "CLAUDE.md"), "@AGENTS.md\n");
  else {
    assert.ok(fs.lstatSync(path.join(dir, "CLAUDE.md")).isSymbolicLink());
    assert.equal(fs.readlinkSync(path.join(dir, "CLAUDE.md")), "AGENTS.md");
  }

  const asked = fresh(t, ["--claude-md", "import"]);
  assert.equal(asked.run.status, 0, both(asked.run));
  assert.equal(fs.lstatSync(path.join(asked.dir, "CLAUDE.md")).isSymbolicLink(), false);
  assert.equal(read(asked.dir, "CLAUDE.md"), "@AGENTS.md\n");
  assert.match(asked.run.stdout, /verify-standard\.mjs: conventions ok/);
});

test("the shared settings gain the permission rules and the hook that offers the plugin", (t) => {
  const { dir, run } = fresh(t);
  assert.equal(run.status, 0, both(run));
  const wanted = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "settings.merge.json"), "utf8"));
  const settings = JSON.parse(read(dir, ".claude/settings.json"));
  assert.deepEqual(settings.permissions, wanted.permissions);
  assert.ok(settings.permissions.deny.includes("Bash(git push --force:*)"));
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /\.agents\/scripts\/plugin-check\.mjs/);

  const without = fresh(t, ["--no-plugin-check"]);
  assert.equal(without.run.status, 0, both(without.run));
  assert.deepEqual(Object.keys(JSON.parse(read(without.dir, ".claude/settings.json"))), ["permissions"]);
});

test("a GitLab repo gets the gate as a local include, and a pipeline file that includes it", (t) => {
  const { dir, run } = fresh(t, ["--forge", "gitlab"], { template: "node-service", name: "zz-service" });
  assert.equal(run.status, 0, both(run));
  assert.equal(marker(dir).forge, "gitlab");
  assert.match(read(dir, GATE.gitlab), /node \.agents\/scripts\/verify-standard\.mjs/);
  assert.match(read(dir, GATE.gitlab), /node \.agents\/scripts\/lane\.mjs unit/);
  assert.match(read(dir, ".gitlab-ci.yml"), /^include:\n {2}- local: \.gitlab\/ci\/team-conventions\.yml$/m);
  assert.equal(exists(dir, ".github"), false);
  assert.match(read(dir, "CONTRIBUTING.md"), /reviewed merge request with green CI/);
  assert.deepEqual(marker(dir).lanes, {
    unit: "npm --prefix server test",
    integration: "RUN_DB_TESTS=1 npm --prefix server run test:integration",
    e2e: "npm --prefix e2e test",
    live: "not wired: add one the day this service calls a model",
  });
  assert.equal(JSON.parse(read(dir, "server/package.json")).name, "zz-service-server");
});

test("the forge is read off the origin remote", (t) => {
  for (const [url, forge, gate] of [["git@github.com:someone/thing.git", "github", GATE.github], ["https://gitlab.com/group/thing.git", "gitlab", GATE.gitlab]]) {
    const { dir, git } = tempRepo(t, "init-remote-");
    git("remote", "add", "origin", url);
    const run = runNode(INIT, ["--name", "zz-remote", "--template", "library", "--description", "Reads its forge.", "--target", dir]);
    assert.equal(run.status, 0, both(run));
    assert.equal(marker(dir).forge, forge);
    assert.ok(exists(dir, gate), gate);
  }
});

test("with no forge known it writes no gate, says so, and still passes its own check", (t) => {
  const { dir, run } = fresh(t);
  assert.equal(run.status, 0, both(run));
  assert.equal(marker(dir).forge, "none");
  assert.equal(exists(dir, ".github") || exists(dir, ".gitlab") || exists(dir, ".gitlab-ci.yml"), false);
  assert.match(run.stdout, /no forge is known for this repo, so no CI gate was written/);
  assert.match(run.stdout, /verify-standard\.mjs: conventions ok/);
  assert.match(read(dir, "CONTRIBUTING.md"), /reviewed change request with green CI/);

  // Once the forge is known, the upgrade adds the gate.
  const again = upgrade(dir, ["--forge", "github"]);
  assert.equal(again.status, 0, both(again));
  assert.equal(marker(dir).forge, "github");
  assert.ok(exists(dir, GATE.github));
});

test("--dry-run writes nothing and names every path it would write", (t) => {
  const { dir, run } = fresh(t, ["--forge", "github", "--dry-run"]);
  assert.equal(run.status, 0, both(run));
  assert.match(run.stdout, /DRY RUN: nothing is written/);
  for (const rel of [".agents/scripts/verify-standard.mjs", "AGENTS.md", GATE.github, ".agents/manifest.json", ".claude/settings.json", "CLAUDE.md", ".gitignore"]) {
    assert.ok(run.stdout.includes(`would write ${rel}`), rel);
  }
  assert.equal(fs.existsSync(dir), false);
});

test("--json prints one object on stdout and the progress on stderr", (t) => {
  const { dir, run } = fresh(t, ["--forge", "github", "--json"]);
  assert.equal(run.status, 0, both(run));
  const out = JSON.parse(run.stdout);
  assert.deepEqual({ ...out, written: null }, {
    ok: true, target: dir, project: "zz-fresh", template: "library", forge: "github", default_branch: "main",
    standard_version: 1, written: null, kept: [], removed: [], unchanged: false,
  });
  assert.ok(out.written.includes(".agents/scripts/lane.mjs"));
  assert.match(run.stderr, /write AGENTS\.md/);
});

test("a wrong or missing argument is a usage error that says what to pass", (t) => {
  const dir = path.join(tempDir(t, "init-usage-"), "zz-usage");
  const base = ["--target", dir, "--dry-run"];
  const cases = [
    [["--name", "zz-usage", "--description", "No template."], /--template is required: one of library, node-service/],
    [["--name", "zz-usage", "--template", "ui", "--description", "A template that is not shipped."], /unknown template "ui"; one of library, node-service/],
    [["--name", "zz-usage", "--template", "library"], /a description is required/],
    [["--name", "Zz Usage", "--template", "library", "--description", "A bad name."], /"Zz Usage" is not a usable project name/],
    [["--name", "zz-usage", "--template", "library", "--description", 'Has "quotes" in it.'], /no double quotes/],
    [["--name", "zz-usage", "--template", "library", "--description", "x".repeat(121)], /121 characters; keep it to 120/],
    [["--name", "zz-usage", "--template", "library", "--description", "A bad forge.", "--forge", "bitbucket"], /--forge takes github, gitlab or none/],
    [["--name", "zz-usage", "--template", "library", "--description", "A bad link.", "--claude-md", "copy"], /--claude-md takes link or import/],
    [["--name", "zz-usage", "--template", "library", "--description", "A flag that does not exist.", "--colour", "x"], /colour/],
  ];
  for (const [args, message] of cases) {
    const run = runNode(INIT, [...args, ...base]);
    assert.equal(run.status, 2, `${args.join(" ")}\n${both(run)}`);
    assert.match(run.stderr, message);
  }
  assert.equal(fs.existsSync(dir), false);
});

// ---------------------------------------------------------------------------
// A fresh scaffold writes every template file, so a folder that already holds
// files would lose them. An agent can run it, which is when a wrong guess has
// to fail rather than overwrite.

test("a fresh scaffold refuses a folder that already has files in it", (t) => {
  const dir = tempDir(t, "init-occupied-");
  write(dir, "README.md", "# somebody's own\n");
  write(dir, ".DS_Store", "");
  const run = runNode(INIT, ["--name", "zz-occupied", "--template", "library", "--description", "Into an occupied folder.", "--target", dir]);
  assert.equal(run.status, 1, both(run));
  assert.match(run.stderr, /already has 1 file\(s\) of its own \(README\.md\)/);
  assert.match(run.stderr, /--upgrade/);
  assert.equal(read(dir, "README.md"), "# somebody's own\n");
  assert.equal(exists(dir, ".agents"), false);
});

test("a fresh scaffold into a folder holding only dotfiles and .git goes ahead", (t) => {
  const { dir } = tempRepo(t, "init-dotfiles-");
  write(dir, ".editorconfig", "root = true\n");
  const run = runNode(INIT, ["--name", "zz-dotfiles", "--template", "library", "--description", "Into a folder with only dotfiles.", "--target", dir]);
  assert.equal(run.status, 0, both(run));
  assert.ok(exists(dir, ".agents/manifest.json"));
});

test("a repo that already carries the marker is sent to --upgrade", (t) => {
  const { dir, run } = fresh(t);
  assert.equal(run.status, 0, both(run));
  const again = runNode(INIT, ["--name", "zz-fresh", "--template", "library", "--description", "Twice.", "--target", dir]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already carries \.agents\/manifest\.json: use --upgrade/);
});

// ---------------------------------------------------------------------------
// The opt-in block

test("no teamwork block is written unless asked for", (t) => {
  const { dir, run } = fresh(t);
  assert.equal(run.status, 0, both(run));
  assert.equal("teamwork" in marker(dir), false);
});

test("--strict writes the hard test gate with the command it found", (t) => {
  const { dir, run } = fresh(t, ["--strict"]);
  assert.equal(run.status, 0, both(run));
  assert.deepEqual(marker(dir).teamwork, { requireTestsPass: true, test: { command: "npm test" } });
  assert.match(run.stdout, /the strict test gate on/);

  const named = fresh(t, ["--strict", "--test-command", "node --test"]);
  assert.deepEqual(marker(named.dir).teamwork, { requireTestsPass: true, test: { command: "node --test" } });
});

test("--strict on an upgrade keeps the rest of an existing block, and refuses with nothing to run", (t) => {
  const { dir } = fresh(t);
  saveMarker(dir, { ...marker(dir), teamwork: { branchPrefixes: ["feat/"], test: { dir: "pkg", timeoutSeconds: 30 } } });
  const run = upgrade(dir, ["--strict"]);
  assert.equal(run.status, 0, both(run));
  assert.deepEqual(marker(dir).teamwork, { branchPrefixes: ["feat/"], test: { dir: "pkg", timeoutSeconds: 30, command: "npm test" }, requireTestsPass: true });

  const { dir: bare } = tempRepo(t, "init-strict-");
  write(bare, "notes.txt", "no manifest names a test command here\n");
  const refused = upgrade(bare, ["--strict"]);
  assert.equal(refused.status, 2, both(refused));
  assert.match(refused.stderr, /--strict needs a command to run: pass --test-command/);
  assert.equal(exists(bare, ".agents"), false);
});

test("--hooks-path turns the pre-commit hook on in this clone", (t) => {
  const { dir, git } = tempRepo(t, "init-hooks-");
  const run = runNode(INIT, ["--name", "zz-hooks", "--template", "library", "--description", "With the hook on.", "--target", dir, "--hooks-path"]);
  assert.equal(run.status, 0, both(run));
  assert.equal(git("config", "core.hooksPath"), ".githooks");
  assert.equal(read(dir, ".githooks/pre-commit"), fs.readFileSync(path.join(TEMPLATES, "githooks", "pre-commit"), "utf8").replace(/\r\n/g, "\n"));
  if (!WINDOWS) assert.ok(fs.statSync(path.join(dir, ".githooks", "pre-commit")).mode & 0o100, "the hook is executable");
});

// ---------------------------------------------------------------------------
// --upgrade: the conventions around a repo that already has files

test("--upgrade keeps the repo's own files and lays down no starter source", (t) => {
  const { dir } = adoptable(t);
  const plan = upgrade(dir, ["--forge", "github", "--dry-run"]);
  assert.equal(plan.status, 0, both(plan));
  assert.match(plan.stdout, /keep {2}AGENTS\.md: exists and the scaffold does not own it/);
  assert.match(plan.stdout, /would write \.agents\/scripts\/verify-standard\.mjs/);
  assert.equal(exists(dir, ".agents"), false, "a dry run writes nothing");

  const run = upgrade(dir, ["--forge", "github"]);
  assert.equal(run.status, 0, both(run));
  assert.equal(read(dir, "AGENTS.md"), "# the repo's own hub\n\nProse the owner wrote.\n");
  assert.equal(read(dir, "README.md"), "# the repo's own readme\n");
  assert.equal(JSON.parse(read(dir, "package.json")).name, "adoptable");
  for (const starter of ["src/index.mjs", "src/slugify.mjs", "test", "CONTRIBUTING.md", ".gitattributes"]) assert.equal(exists(dir, starter), false, `${starter} is a starter file`);

  const m = marker(dir);
  assert.equal(m.project, path.basename(dir));
  assert.equal(m.template, null);
  assert.equal(m.lanes.unit, "npm test", "the unit lane is the test command the repo already has");
  assert.match(m.lanes.integration, /^not wired/);
  for (const own of ["AGENTS.md", "README.md", "package.json", "src/main.mjs"]) assert.equal(own in m.owned, false, `${own} stays the repo's own`);
  assert.ok(m.owned[".agents/scripts/verify-standard.mjs"]);
});

test("a second --upgrade changes nothing", (t) => {
  const { dir, git } = adoptable(t);
  assert.equal(upgrade(dir, ["--forge", "github"]).status, 0);
  git("add", "-A");
  git("commit", "-q", "-m", "the conventions");
  const second = upgrade(dir);
  assert.equal(second.status, 0, both(second));
  assert.match(second.stdout, /nothing to do: already on conventions v1, 1 file\(s\) kept as they are/);
  assert.match(second.stdout, /verify-standard\.mjs: conventions ok/);
  assert.equal(git("status", "--porcelain"), "");

  // The same holds for a repo a fresh scaffold made.
  const made = fresh(t, ["--forge", "gitlab"], { template: "node-service", name: "zz-twice" });
  const before = marker(made.dir);
  const again = upgrade(made.dir);
  assert.equal(again.status, 0, both(again));
  assert.match(again.stdout, /nothing to do: already on conventions v1$/m);
  assert.deepEqual(marker(made.dir), before);
});

test("--upgrade makes a repo's CLAUDE.md the hub, word for word, and links back to it", (t) => {
  const { dir, git } = tempRepo(t, "init-claude-");
  const words = "# our instructions\n\nAlways run the linter.\n";
  write(dir, "CLAUDE.md", words);
  git("add", "-A");
  git("commit", "-q", "-m", "instructions");
  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  assert.match(run.stdout, /move CLAUDE\.md to AGENTS\.md/);
  assert.equal(read(dir, "AGENTS.md"), words);
  assert.equal(read(dir, "CLAUDE.md"), WINDOWS ? "@AGENTS.md\n" : words, "CLAUDE.md now reads through to the hub");
  assert.equal("AGENTS.md" in marker(dir).owned, false);
});

test("--upgrade leaves a CLAUDE.md with content beside a hub alone, and says whose it is to fix", (t) => {
  const { dir } = adoptable(t);
  write(dir, "CLAUDE.md", "# separate instructions\n");
  const run = upgrade(dir);
  assert.equal(run.status, 1, both(run));
  assert.match(run.stdout, /keep {2}CLAUDE\.md: it has content of its own beside AGENTS\.md/);
  assert.match(run.stderr, /these are this repo's own to fix/);
  assert.match(run.stderr, /^claude-md: /m);
  assert.equal(read(dir, "CLAUDE.md"), "# separate instructions\n");
});

test("--upgrade replaces a file it wrote and nobody touched, and keeps an edited one with its diff", (t) => {
  const { dir } = fresh(t, ["--forge", "github"]);
  const m = marker(dir);
  // An earlier version's lane.mjs, untouched since: the marker holds its hash.
  write(dir, ".agents/scripts/lane.mjs", "// an earlier version\n");
  m.owned[".agents/scripts/lane.mjs"] = sha("// an earlier version\n");
  saveMarker(dir, m);
  // And a gate somebody edited.
  fs.appendFileSync(path.join(dir, GATE.github), "# our own addition\n");

  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  assert.match(run.stdout, /write \.agents\/scripts\/lane\.mjs/);
  assert.equal(read(dir, ".agents/scripts/lane.mjs"), fs.readFileSync(path.join(TEMPLATES, "common", ".agents", "scripts", "lane.mjs"), "utf8"));
  assert.match(run.stdout, /keep {2}\.github\/workflows\/team-conventions\.yml: edited since it was written/);
  assert.match(run.stdout, /^ {4}-# our own addition$/m, "the diff against what would have been written");
  assert.match(read(dir, GATE.github), /# our own addition/);
  assert.equal(marker(dir).owned[GATE.github], m.owned[GATE.github], "the recorded hash stays, so the next upgrade flags it again");

  const forced = upgrade(dir, ["--force"]);
  assert.equal(forced.status, 0, both(forced));
  assert.doesNotMatch(read(dir, GATE.github), /# our own addition/);
});

test("--upgrade removes an untouched script or rule it no longer ships, and lets an edited one go", (t) => {
  const { dir } = fresh(t);
  const m = marker(dir);
  write(dir, ".agents/scripts/retired.mjs", "// shipped once\n");
  write(dir, ".agents/scripts/edited.mjs", "// shipped once, then changed here\n");
  write(dir, ".agents/rules/copied.md", "# a rule the scaffold once copied in\n");
  write(dir, ".agents/rules/house.md", "# the repo's own rule\n");
  Object.assign(m.owned, {
    ".agents/scripts/retired.mjs": sha("// shipped once\n"),
    ".agents/scripts/edited.mjs": sha("// shipped once\n"),
    ".agents/rules/copied.md": sha("# a rule the scaffold once copied in\n"),
  });
  saveMarker(dir, m);
  fs.appendFileSync(path.join(dir, "AGENTS.md"), "\n@.agents/rules/copied.md\n@.agents/rules/house.md\n");

  const plan = upgrade(dir, ["--dry-run"]);
  assert.match(plan.stdout, /would remove \.agents\/scripts\/retired\.mjs/);
  assert.ok(exists(dir, ".agents/scripts/retired.mjs"));

  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  assert.equal(exists(dir, ".agents/scripts/retired.mjs"), false);
  assert.equal(exists(dir, ".agents/rules/copied.md"), false);
  assert.ok(exists(dir, ".agents/scripts/edited.mjs"), "an edited one stays as the repo's own");
  assert.ok(exists(dir, ".agents/rules/house.md"), "a rule the marker never owned is not touched");
  assert.match(run.stdout, /keep {2}\.agents\/scripts\/edited\.mjs: no longer shipped, and edited/);
  const hub = read(dir, "AGENTS.md");
  assert.doesNotMatch(hub, /@\.agents\/rules\/copied\.md/);
  assert.match(hub, /@\.agents\/rules\/house\.md/);
  const owned = Object.keys(marker(dir).owned);
  for (const gone of [".agents/scripts/retired.mjs", ".agents/scripts/edited.mjs", ".agents/rules/copied.md"]) assert.equal(owned.includes(gone), false, gone);
});

test("--upgrade keeps what a marker carries that this script does not write", (t) => {
  const { dir } = fresh(t);
  const teamwork = { requireTestsPass: true, test: { command: "make check" }, protectedBranches: ["main", "release"] };
  saveMarker(dir, { ...marker(dir), teamwork, readme: { paths: ["docs/README.md"] }, lanes: { unit: "make check" } });
  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  const m = marker(dir);
  assert.deepEqual(m.teamwork, teamwork);
  assert.deepEqual(m.readme, { paths: ["docs/README.md"] });
  assert.deepEqual(m.lanes, { unit: "make check" });
  assert.equal(Object.keys(m).at(-1), "owned");
});

test("--upgrade gives a marker with no lanes the test command it finds", (t) => {
  const { dir } = adoptable(t);
  saveMarker(dir, { standard: "agentic-engineering", standard_version: 1, project: "adoptable", default_branch: "trunk", lanes: {}, owned: {} });
  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  assert.equal(marker(dir).lanes.unit, "npm test");
  assert.equal(marker(dir).default_branch, "trunk", "the recorded default branch is kept");
});

test("--upgrade merges the shared settings and never rewrites what is there", (t) => {
  const { dir } = adoptable(t);
  write(dir, ".claude/settings.json", `${JSON.stringify({ model: "sonnet", permissions: { deny: ["Bash(rm -rf:*)", "Bash(git push -f:*)"], allow: ["Bash(npm test)"] } }, null, 2)}\n`);
  assert.equal(upgrade(dir).status, 0);
  const settings = JSON.parse(read(dir, ".claude/settings.json"));
  assert.equal(settings.model, "sonnet");
  assert.deepEqual(settings.permissions.allow, ["Bash(npm test)"]);
  assert.deepEqual(settings.permissions.deny.slice(0, 2), ["Bash(rm -rf:*)", "Bash(git push -f:*)"], "its own entries first, in its order");
  assert.equal(settings.permissions.deny.filter((e) => e === "Bash(git push -f:*)").length, 1, "no duplicate");
  assert.ok(settings.permissions.deny.includes("Bash(git commit --no-verify:*)"));

  const { dir: broken } = adoptable(t);
  write(broken, ".claude/settings.json", "{ not json");
  const run = upgrade(broken);
  assert.equal(run.status, 0, both(run));
  assert.match(run.stdout, /\.claude\/settings\.json does not parse, so it was left alone/);
  assert.equal(read(broken, ".claude/settings.json"), "{ not json");
});

test("--upgrade adds the gate to an existing GitLab pipeline without touching its jobs", (t) => {
  const { dir } = adoptable(t);
  const pipeline = "stages:\n  - test\n\nunit:\n  stage: test\n  script:\n    - npm test\n";
  write(dir, ".gitlab-ci.yml", pipeline);
  const run = upgrade(dir, ["--forge", "gitlab"]);
  assert.equal(run.status, 0, both(run));
  assert.equal(read(dir, ".gitlab-ci.yml"), `include:\n  - local: ${GATE.gitlab}\n\n${pipeline}`);
  assert.match(run.stdout, /the gate also runs the unit lane \(npm test\)\. If \.gitlab-ci\.yml already runs it, delete the gate's unit job/);

  // An include this script cannot safely rewrite is the person's, and the check says so.
  const { dir: scalar } = adoptable(t);
  write(scalar, ".gitlab-ci.yml", "include: ci/all.yml\n");
  const manual = upgrade(scalar, ["--forge", "gitlab"]);
  assert.equal(manual.status, 1, both(manual));
  assert.match(manual.stdout, /has an include this script will not rewrite/);
  assert.match(manual.stderr, /^ci-gate: /m);
  assert.equal(read(scalar, ".gitlab-ci.yml"), "include: ci/all.yml\n");
});

test("ensureGitlabInclude adds the gate once, wherever an include list already is", () => {
  const item = `- local: ${GATE.gitlab}`;
  assert.deepEqual(ensureGitlabInclude("", "FRESH"), { text: "FRESH", how: "created" });
  assert.equal(ensureGitlabInclude(`include:\n  ${item}\n`, "FRESH").how, "present");
  assert.equal(ensureGitlabInclude("include:\n    - local: ci/a.yml\njob:\n  script: [x]\n", "FRESH").text, `include:\n    ${item}\n    - local: ci/a.yml\njob:\n  script: [x]\n`);
  assert.equal(ensureGitlabInclude("job:\n  script: [x]\n", "FRESH").text, `include:\n  ${item}\n\njob:\n  script: [x]\n`);
  for (const manual of ["include: ci/a.yml\n", "include:\n  local: ci/a.yml\n", "include: ['ci/a.yml']\n"]) {
    assert.deepEqual(ensureGitlabInclude(manual, "FRESH"), { text: manual, how: "manual" }, manual);
  }
});

// ---------------------------------------------------------------------------
// A repo set up by the plugin's first layout: its settings in
// .claude/teamwork.json, and a shell pre-commit hook beside its library.

test("--upgrade carries a first-layout repo's rules into the marker, so nothing loosens", (t) => {
  const { dir, git } = adoptable(t);
  write(dir, ".claude/teamwork.json", `${JSON.stringify({
    version: 1, provider: "gitlab", baseBranch: "develop", protectedBranches: ["develop", "release"],
    test: { command: "make check", dir: "." }, rules: { requireTestsPass: true },
  }, null, 2)}\n`);
  write(dir, ".githooks/pre-commit", '#!/bin/bash\n. "$ROOT/.githooks/lib-guard.sh"\n');
  write(dir, ".githooks/lib-guard.sh", "TW_LIB_VERSION=1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "the first layout");

  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  const m = marker(dir);
  assert.equal(m.default_branch, "develop");
  assert.equal(m.lanes.unit, "make check");
  assert.deepEqual(m.teamwork.protectedBranches, ["develop", "release"]);
  assert.equal(m.teamwork.requireTestsPass, true);
  assert.equal(m.teamwork.test.command, "make check");
  assert.match(run.stdout, /the rules \.claude\/teamwork\.json enforced are now the marker's `teamwork` block/);
  assert.ok(exists(dir, ".claude/teamwork.json"), "the old file is the session hook's to retire");

  // The shell hook is replaced by the one-file hook, and parked, not deleted.
  const hook = fs.readFileSync(path.join(TEMPLATES, "githooks", "pre-commit"), "utf8");
  assert.equal(read(dir, ".githooks/pre-commit"), hook.replace(/\r\n/g, "\n"));
  assert.equal(exists(dir, ".githooks/lib-guard.sh"), false);
  assert.equal(read(dir, ".agents/retired/agentic-teamwork/.githooks/pre-commit"), '#!/bin/bash\n. "$ROOT/.githooks/lib-guard.sh"\n');
  assert.equal(read(dir, ".agents/retired/agentic-teamwork/.githooks/lib-guard.sh"), "TW_LIB_VERSION=1\n");
  assert.match(run.stdout, /move \.githooks\/pre-commit and its library to \.agents\/retired\/agentic-teamwork\//);

  const again = upgrade(dir);
  assert.equal(again.status, 0, both(again));
  assert.match(again.stdout, /nothing to do/);
});

test("--upgrade keeps a pre-commit hook the repo wrote itself", (t) => {
  const { dir } = adoptable(t);
  write(dir, ".githooks/pre-commit", "#!/bin/sh\nnpm run lint\n");
  const run = upgrade(dir);
  assert.equal(run.status, 0, both(run));
  assert.match(run.stdout, /keep {2}\.githooks\/pre-commit: exists and the scaffold does not own it/);
  assert.equal(read(dir, ".githooks/pre-commit"), "#!/bin/sh\nnpm run lint\n");
});

// ---------------------------------------------------------------------------
// The pieces

test("detectTestCommand reads the command off the manifests a repo has", (t) => {
  const dir = (files) => { const d = tempDir(t, "init-detect-"); for (const [rel, text] of Object.entries(files)) write(d, rel, text); return d; };
  assert.equal(detectTestCommand(dir({})), null);
  assert.equal(detectTestCommand(dir({ "package.json": '{"scripts":{"test":"vitest run"}}' })), "npm test");
  assert.equal(detectTestCommand(dir({ "package.json": '{"scripts":{"test":"vitest run"}}', "pnpm-lock.yaml": "" })), "pnpm test");
  assert.equal(detectTestCommand(dir({ "package.json": '{"scripts":{"test":"vitest run"}}', "yarn.lock": "" })), "yarn test");
  assert.equal(detectTestCommand(dir({ "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })), null);
  assert.equal(detectTestCommand(dir({ "Cargo.toml": "[package]\n" })), "cargo test");
  assert.equal(detectTestCommand(dir({ "go.mod": "module x\n" })), "go test ./...");
  assert.equal(detectTestCommand(dir({ "pyproject.toml": "[tool.pytest.ini_options]\n" })), "pytest");
  assert.equal(detectTestCommand(dir({ "pyproject.toml": "[project]\nname = 'x'\n" })), null);
  assert.equal(detectTestCommand(dir({ "Package.swift": "// swift-tools-version:5.9\n" })), "swift test");
  assert.equal(detectTestCommand(dir({ Makefile: "build:\n\ttrue\ntest:\n\ttrue\n" })), "make test");
});

test("mergeSettings adds what is missing and repeats nothing", () => {
  const addition = { permissions: { deny: ["a", "b"], ask: ["c"] }, hooks: { SessionStart: [{ hooks: [{ type: "command", command: "check" }] }] } };
  const once = mergeSettings({ permissions: { deny: ["b", "z"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "own" }] }] } }, addition);
  assert.deepEqual(once.permissions, { deny: ["b", "z", "a"], ask: ["c"] });
  assert.deepEqual(Object.keys(once.hooks), ["Stop", "SessionStart"]);
  assert.deepEqual(mergeSettings(once, addition), once, "merging again changes nothing");
  assert.deepEqual(mergeSettings(null, { permissions: { deny: ["a"] } }), { permissions: { deny: ["a"] } });
});

test("names and descriptions are held to what a package manifest accepts", () => {
  assert.equal(validateName("scout-2.x_y"), null);
  for (const bad of ["", "Scout", "-scout", "a b", "x".repeat(65)]) assert.ok(validateName(bad), bad);
  assert.equal(validateName("MyRepo", { fresh: false }), null, "a repo being adopted keeps the name it has");
  assert.ok(validateName("my repo", { fresh: false }));
  assert.equal(validateDescription("One plain line."), null);
  assert.equal(validateDescription("", { required: false }), null);
  for (const bad of ["", 'a "quoted" word', "two\nlines", "back\\slash", "x".repeat(121)]) assert.ok(validateDescription(bad), bad);
});
