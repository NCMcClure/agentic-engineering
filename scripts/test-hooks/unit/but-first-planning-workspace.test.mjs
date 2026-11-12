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

const PLUGIN = path.join(REPO, "plugins", "but-first-planning");
const SCAFFOLD = path.join(PLUGIN, "skills", "spec-init", "scaffold.mjs");
const SPEC_OPEN = path.join(PLUGIN, "skills", "spec-open", "spec-open.mjs");
const INSTALL = path.join(PLUGIN, "install.mjs");
const { EMPTY_DIRS, SCRIPTS, SITE, WORKSPACE, scaffold, staleScripts } = await import(pathToFileURL(SCAFFOLD).href);
const { findRoot } = await import(pathToFileURL(SPEC_OPEN).href);
const installer = await import(pathToFileURL(INSTALL).href);

const real = (p) => fs.realpathSync.native(p);
const at = (root, rel) => path.join(root, WORKSPACE, rel);

// ---- scaffold ---------------------------------------------------------------

test("every file the scaffold copies exists in the plugin, and the scripts land where they root themselves", () => {
  for (const name of [...Object.keys(SCRIPTS), ...Object.keys(SITE)]) {
    assert.ok(fs.existsSync(path.join(PLUGIN, "skills", "spec-init", "assets", name)), name);
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
  write(root, `${WORKSPACE}/spec/assets/gruvbox.css`, "/* the project's own theme */\n");
  assert.deepEqual(staleScripts(root).sort(), ["plan/plan-status.mjs", "plan/tracker.mjs"]);

  const plain = scaffold(root);
  assert.deepEqual(plain, { wrote: ["plan/tracker.mjs"], refreshed: [], kept: ["plan/plan-status.mjs"] });
  assert.match(fs.readFileSync(at(root, "plan/plan-status.mjs"), "utf8"), /\/\/ edited/);

  const refreshed = scaffold(root, { refresh: true });
  assert.deepEqual(refreshed, { wrote: [], refreshed: ["plan/plan-status.mjs"], kept: [] });
  assert.deepEqual(staleScripts(root), []);
  assert.equal(fs.readFileSync(at(root, "spec/assets/gruvbox.css"), "utf8"), "/* the project's own theme */\n");
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

// ---- install ----------------------------------------------------------------

const SKILLS = fs.readdirSync(path.join(PLUGIN, "skills")).filter((n) => fs.existsSync(path.join(PLUGIN, "skills", n, "SKILL.md"))).sort();

test("install copies every skill into a project's .claude/skills and points plugin paths at the copy", (t) => {
  const project = tempDir(t, "bfp-install-");
  const out = [];
  assert.equal(installer.main([project], { log: (l) => out.push(l) }), 0);
  const dest = path.join(project, ".claude", "skills");
  assert.deepEqual(fs.readdirSync(dest).filter((n) => fs.existsSync(path.join(dest, n, "SKILL.md"))).sort(), SKILLS);
  assert.ok(out.includes(`\nInstalled ${SKILLS.length} skills into ${dest}`));
  assert.ok(fs.existsSync(path.join(dest, "spec-init", "assets", "plan-status.mjs")));
  assert.ok(fs.existsSync(path.join(dest, "spec-init", "scaffold.mjs")));

  // No copied file still asks for a plugin root, and what replaced it exists.
  const texts = fs.readdirSync(dest, { recursive: true }).map(String).filter((f) => /\.(md|js)$/.test(f));
  for (const rel of texts) assert.doesNotMatch(fs.readFileSync(path.join(dest, rel), "utf8"), /\$\{CLAUDE_PLUGIN_ROOT\}/, rel);
  const posix = dest.split(path.sep).join("/");
  assert.ok(fs.readFileSync(path.join(dest, "spec-open", "SKILL.md"), "utf8").includes(`${posix}/spec-open/spec-open.mjs`));
  assert.ok(fs.existsSync(path.join(dest, "but-first-planning-references", "subagent-fallback.md")));
  assert.match(fs.readFileSync(path.join(dest, "build-sprint", "SKILL.md"), "utf8"), /\(\.\.\/but-first-planning-references\/subagent-fallback\.md\)/);
});

test("install replaces a skill of the same name, leaves other skills alone, and --global goes to the home directory", (t) => {
  const project = tempDir(t, "bfp-install-again-");
  write(project, ".claude/skills/grill/STALE.md", "left by an older copy\n");
  write(project, ".claude/skills/someone-elses/SKILL.md", "---\nname: someone-elses\ndescription: x\n---\n");
  assert.equal(installer.main([], { cwd: project, log: () => {} }), 0);
  assert.equal(fs.existsSync(path.join(project, ".claude/skills/grill/STALE.md")), false);
  assert.ok(fs.existsSync(path.join(project, ".claude/skills/someone-elses/SKILL.md")));

  const home = tempDir(t, "bfp-install-home-");
  assert.equal(installer.main(["--global"], { home, cwd: project, log: () => {} }), 0);
  assert.ok(fs.existsSync(path.join(home, ".claude", "skills", "spec-init", "SKILL.md")));
});

test("install as a command: --help exits 0, an unknown option exits 2, and a relocated path keeps its tail", (t) => {
  const project = tempDir(t, "bfp-install-cli-");
  const run = runNode(INSTALL, [project]);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /Installed \d+ skills into /);
  assert.match(run.stdout, /The hooks .* come only with the plugin install\./);
  assert.equal(runNode(INSTALL, ["--help"]).status, 0);
  const bad = runNode(INSTALL, ["--frobnicate"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown option '--frobnicate'/);

  const dest = path.join("x", ".claude", "skills");
  assert.equal(installer.relocate('scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-sprint/workflows/build-sprint.js"', dest), 'scriptPath: "x/.claude/skills/build-sprint/workflows/build-sprint.js"');
  assert.equal(installer.relocate('pluginRoot: "${CLAUDE_PLUGIN_ROOT}"', dest), 'pluginRoot: "x/.claude"');
});
