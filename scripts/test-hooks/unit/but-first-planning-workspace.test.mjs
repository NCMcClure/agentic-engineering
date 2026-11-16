// but-first-planning's three scripts that are not part of the plan funnel:
// scaffold.mjs (what copies verbatim into a workspace, and how a workspace
// catches up), spec-open.mjs (which repo's spec site to serve), and
// install.mjs (the skills as plain Claude Code skills, without the plugin).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentcraft", "skills", "but-first-planning");
const SCAFFOLD = path.join(PLUGIN, "routes", "spec-init", "scaffold.mjs");
const SPEC_OPEN = path.join(PLUGIN, "routes", "spec-open", "spec-open.mjs");
// The path a README once published a curl to. It is the stub's now, and installs nothing.
const INSTALL = path.join(REPO, "plugins", "but-first-planning", "install.mjs");
const { EMPTY_DIRS, SCRIPTS, SITE, WORKSPACE, scaffold, staleScripts } = await import(pathToFileURL(SCAFFOLD).href);
const { findRoot } = await import(pathToFileURL(SPEC_OPEN).href);

const real = (p) => fs.realpathSync.native(p);
const at = (root, rel) => path.join(root, WORKSPACE, rel);

// ---- scaffold ---------------------------------------------------------------

test("every file the scaffold copies exists in the plugin, and the scripts land where they root themselves", () => {
  for (const name of [...Object.keys(SCRIPTS), ...Object.keys(SITE)]) {
    assert.ok(fs.existsSync(path.join(PLUGIN, "routes", "spec-init", "assets", name)), name);
  }
  assert.equal(SCRIPTS["plan-status.mjs"], "plan/plan-status.mjs");
  assert.equal(SCRIPTS["publish-issues.mjs"], "plan/publish-issues.mjs");
  // The two the funnel and the publisher import sit beside them.
  assert.equal(SCRIPTS["tracker.mjs"], "plan/tracker.mjs");
  assert.equal(SCRIPTS["provider.mjs"], "plan/provider.mjs");
  assert.equal(SCRIPTS["verify-spec-tree.mjs"], "spec/scripts/verify-spec-tree.mjs");
  assert.equal(SCRIPTS["drift-status.mjs"], "progress/drift-status.mjs");
});

test("a new workspace gets every script, the site's files and the empty ledgers, and a second run copies nothing", (t) => {
  const root = tempDir(t, "bfp-scaffold-");
  const first = scaffold(root);
  assert.equal(first.wrote.length, Object.keys(SCRIPTS).length + Object.keys(SITE).length + EMPTY_DIRS.length);
  for (const rel of [...Object.values(SCRIPTS), ...Object.values(SITE), ...EMPTY_DIRS.map((d) => `${d}/.gitkeep`)]) assert.ok(fs.existsSync(at(root, rel)), rel);
  assert.deepEqual(scaffold(root), { wrote: [], refreshed: [], kept: [] });
  assert.deepEqual(staleScripts(root), []);
});

test("a script that differs is kept until --refresh, and the site's own files are never rewritten", (t) => {
  const root = tempDir(t, "bfp-refresh-");
  scaffold(root);
  fs.appendFileSync(at(root, "plan/plan-status.mjs"), "\n// edited\n");
  fs.rmSync(at(root, "plan/tracker.mjs"));
  write(root, `${WORKSPACE}/spec/assets/house.css`, "/* the project's own theme */\n");
  assert.deepEqual(staleScripts(root).sort(), ["plan/plan-status.mjs", "plan/tracker.mjs"]);

  const plain = scaffold(root);
  assert.deepEqual(plain, { wrote: ["plan/tracker.mjs"], refreshed: [], kept: ["plan/plan-status.mjs"] });
  assert.match(fs.readFileSync(at(root, "plan/plan-status.mjs"), "utf8"), /\/\/ edited/);

  const refreshed = scaffold(root, { refresh: true });
  assert.deepEqual(refreshed, { wrote: [], refreshed: ["plan/plan-status.mjs"], kept: [] });
  assert.deepEqual(staleScripts(root), []);
  assert.equal(fs.readFileSync(at(root, "spec/assets/house.css"), "utf8"), "/* the project's own theme */\n");
});

test("a workspace scaffolded when the theme file was gruvbox.css keeps it and is not given a second theme", (t) => {
  const root = tempDir(t, "bfp-legacy-theme-");
  scaffold(root);
  // What an older plugin version left: the theme under its old name, which that workspace's mkdocs.yml loads.
  fs.renameSync(at(root, SITE["house.css"]), at(root, "spec/assets/gruvbox.css"));
  fs.writeFileSync(at(root, "spec/assets/gruvbox.css"), "/* the old palette */\n");
  assert.deepEqual(scaffold(root, { refresh: true }), { wrote: [], refreshed: [], kept: [] });
  assert.equal(fs.existsSync(at(root, SITE["house.css"])), false);
  assert.equal(fs.readFileSync(at(root, "spec/assets/gruvbox.css"), "utf8"), "/* the old palette */\n");
});

test("a checkout that turned line endings into CRLF has not made a script stale", (t) => {
  const root = tempDir(t, "bfp-crlf-");
  scaffold(root);
  const file = at(root, "plan/verify-plan-tree.mjs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
  assert.deepEqual(staleScripts(root), []);
});

test("the command line: copy, --check (exit 1 when something differs), --refresh, and exit 2 for a flag it does not know", (t) => {
  const root = tempDir(t, "bfp-cli-");
  const copied = runNode(SCAFFOLD, ["--root", root]);
  assert.equal(copied.status, 0);
  assert.match(copied.stdout, /^wrote \.agents\/plan\/plan\/plan-status\.mjs$/m);
  assert.equal(runNode(SCAFFOLD, ["--root", root, "--check"]).stdout, "every script is current\n");

  fs.appendFileSync(at(root, "progress/drift-status.mjs"), "\n// edited\n");
  const check = runNode(SCAFFOLD, ["--root", root, "--check"]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /^differs or missing: \.agents\/plan\/progress\/drift-status\.mjs$/m);
  assert.match(runNode(SCAFFOLD, ["--root", root]).stdout, /^kept \.agents\/plan\/progress\/drift-status\.mjs/m);
  assert.match(runNode(SCAFFOLD, ["--root", root, "--refresh"]).stdout, /^refreshed \.agents\/plan\/progress\/drift-status\.mjs$/m);
  assert.equal(runNode(SCAFFOLD, ["--root", root, "--check"]).status, 0);
  assert.equal(runNode(SCAFFOLD, ["--frobnicate"]).status, 2);
});

test("the scaffolded scripts run from where they land", (t) => {
  const root = tempDir(t, "bfp-run-");
  scaffold(root);
  write(root, `${WORKSPACE}/plan/index.md`, "# Plan\n");
  assert.equal(runNode(at(root, "plan/verify-plan-tree.mjs"), [], { cwd: root }).status, 0);
  const check = runNode(at(root, "plan/plan-status.mjs"), ["check"], { cwd: root });
  assert.equal(check.stdout, "plan tree: not-started\nNOT DONE: plan tree is 'not-started'\n");
  assert.equal(runNode(at(root, "progress/drift-status.mjs"), [], { cwd: root }).stdout, "No drift items.\n");
});

// ---- spec-open --------------------------------------------------------------

test("spec-open serves the repo that owns the workspace: an explicit root, the project dir, or the nearest one above cwd", (t) => {
  const repo = tempDir(t, "bfp-open-");
  scaffold(repo);
  const deep = path.join(repo, "src", "deep");
  fs.mkdirSync(deep, { recursive: true });
  const elsewhere = tempDir(t, "bfp-open-other-");

  assert.equal(findRoot({ env: { SPEC_ROOT: repo }, arg: undefined, cwd: elsewhere }), repo);
  assert.equal(findRoot({ env: {}, arg: repo, cwd: elsewhere }), repo);
  assert.equal(findRoot({ env: { CLAUDE_PROJECT_DIR: repo }, arg: undefined, cwd: elsewhere }), repo);
  assert.equal(real(findRoot({ env: {}, arg: undefined, cwd: deep })), real(repo));
  // Nothing found: the first candidate comes back, for the error message to name.
  assert.equal(findRoot({ env: {}, arg: undefined, cwd: elsewhere }), elsewhere);
});

test("spec-open with no spec site says to run spec-init and exits 1", (t) => {
  const dir = tempDir(t, "bfp-open-none-");
  // A port nothing serves on: the probe for a running site fails at once.
  const r = runNode(SPEC_OPEN, [], { cwd: dir, env: { ...process.env, SPEC_PORT: "9", SPEC_ROOT: dir, CLAUDE_PROJECT_DIR: "" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No spec site found \(.*comments-server\.py missing\), run spec-init first\./);
});

test("spec-open in a repo with only named workspaces says they have no site and where their pages are", (t) => {
  const dir = tempDir(t, "bfp-open-named-");
  write(dir, ".agents/plans/billing/spec/index.md", "# Billing\n");
  write(dir, ".agents/plans/auth-migration/spec/index.md", "# Auth\n");
  write(dir, ".agents/plans/_scripts/plan-status.mjs", "");
  const r = runNode(SPEC_OPEN, [], { cwd: path.join(dir, ".agents"), env: { ...process.env, SPEC_PORT: "9", SPEC_ROOT: "", CLAUDE_PROJECT_DIR: "" } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No spec site found \(.*comments-server\.py missing\), run spec-init first\.\nA named workspace has no site; its pages are markdown: \.agents\/plans\/auth-migration\/spec\/index\.md, \.agents\/plans\/billing\/spec\/index\.md\.\n/);
});

// ---- install ----------------------------------------------------------------
// Before the plugins were one, this script copied each skill into a project's
// .claude/skills for a host with no plugins. A route is a document its area
// reads, not a skill to copy, so there is nothing left to install: the script
// stays at the path that was published, and says where to go.

test("the install script at the published path installs nothing and names the plugin to install", (t) => {
  const project = tempDir(t, "bfp-install-");
  for (const args of [[], [project], ["--global"], ["--help"]]) {
    const run = runNode(INSTALL, args, { cwd: project });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, "");
    assert.match(run.stdout, /^but-first-planning is now an area of the agentcraft plugin, and this script installs nothing\.$/m);
    assert.match(run.stdout, /^ {2}\/plugin install agentcraft@agentic-engineering$/m);
    assert.match(run.stdout, /\/agentcraft:start-here/);
  }
  assert.deepEqual(fs.readdirSync(project), [], "nothing was written");
  assert.equal(fs.existsSync(path.join(PLUGIN, "install.mjs")), false, "the area ships no installer of its own");
});
