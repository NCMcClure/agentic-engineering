// agent-works scripts/setup.mjs: the plan, the apply, an existing repository, the launcher.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PLUGIN, common, config, project, script } from "./agent-works-homes.mjs";

const setup = await script("setup.mjs");
const decisions = await script("decisions.mjs");
const TODAY = common.today();
const WINDOWS = process.platform === "win32";

async function plan(p, ...args) {
  const [code, out, err] = await p.aw("setup", "--plan", "--json", ...args);
  assert.deepEqual([code, err], [0, ""]);
  return JSON.parse(out);
}
const steps = (doc, act = null) => doc.steps.filter((s) => act === null || s.do === act).map((s) => [s.do, s.path]);
const has = (doc, act, where) => doc.steps.some((s) => s.do === act && s.path === where);
const findingCodes = async (p) => [...new Set(JSON.parse((await p.aw("doctor", "--json"))[1]).findings.map((f) => f.code))].sort();

/** A linked work tree of the project, as git lays one out (no git process is needed). */
function worktree(p, rel = ".claude/worktrees/agent-abc123") {
  const wt = p.at(rel);
  const meta = path.join(p.root, ".git", "worktrees", path.basename(wt));
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, "commondir"), "../..\n");
  fs.writeFileSync(path.join(meta, "HEAD"), "ref: refs/heads/topic\n");
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${meta}\n`);
  return wt;
}

test("agent-works setup: a work tree is named after the project, not its own folder", async (t) => {
  const p = project(t);
  const wt = worktree(p);
  const [code, , err] = await p.awIn(wt, "setup", "--apply");
  assert.deepEqual([code, err], [0, ""]);
  const page = fs.readFileSync(path.join(wt, ".agents", "README.md"), "utf8");
  assert.ok(page.includes("how agent work is kept in acme\n"));
  assert.ok(!page.includes("agent-abc123"));
  assert.equal(fs.readFileSync(path.join(wt, "AGENTS.md"), "utf8").split("\n")[0], "# AGENTS.md — acme");
  // the page a work tree wrote is the page the main checkout would write: merged, it is "up to date" there
  for (const rel of [".agents/README.md", ".agents/agent-works.json", "AGENTS.md"]) p.write(rel, fs.readFileSync(path.join(wt, rel), "utf8"));
  assert.ok(has(await plan(p), "keep", ".agents/README.md"));
});

test("agent-works setup: the config's name wins over the folder's", async (t) => {
  const p = project(t);
  await p.aw("setup", "--apply");
  assert.ok(p.read(".agents/README.md").includes("kept in acme\n"));
  const cfg = JSON.parse(p.read(".agents/agent-works.json"));
  p.write(".agents/agent-works.json", JSON.stringify({ ...cfg, name: "Cardan" }));
  assert.ok(has(await plan(p), "regenerate", ".agents/README.md"));
  await p.aw("setup", "--apply");
  assert.ok(p.read(".agents/README.md").includes("kept in Cardan\n"));
  assert.equal(p.read("AGENTS.md").split("\n")[0], "# AGENTS.md — acme"); // a file that is there is never rewritten
  assert.equal(common.projectName(p.root), "Cardan");
  assert.match(common.projectId(p.root), /^acme-[0-9a-f]{8}$/); // the id in the store is the folder's, as before
});

test("agent-works setup: --plan writes nothing", async (t) => {
  const p = project(t);
  const before = p.tree();
  const doc = await plan(p);
  assert.deepEqual(Object.keys(doc), ["root", "fresh", "found", "twins", "steps", "next", "applied"]);
  assert.deepEqual([doc.fresh, doc.twins, doc.applied, doc.root], [true, "link", null, common.posix(p.root)]);
  assert.deepEqual(steps(doc, "create"), [
    ["create", ".agents/agent-works.json"], ["create", ".agents/README.md"], ["create", "AGENTS.md"],
    ["create", ".agents/memory/INDEX.md"], ["create", ".agents/memory/project/INDEX.md"],
    ["create", `.agents/memory/project/${TODAY}-project-status.md`],
    ["create", ".agents/decisions/README.md"], ["create", ".agents/CONTEXT.md"]]);
  assert.deepEqual(steps(doc, "twins"), [["twins", "CLAUDE.md"]]);
  assert.deepEqual(steps(doc, "append"), []); // tracked twins need no line in .gitignore
  assert.equal("text" in doc.steps[0], false);
  assert.deepEqual(steps(await plan(p, "--twins", "generated"), "append"), [["append", ".gitignore"]]);
  assert.deepEqual(p.tree(), before);
  const [, text] = await p.aw("setup", "--plan");
  assert.ok(text.startsWith(`aw setup — ${common.posix(p.root)} (a fresh repository; CLAUDE.md twins: link)\n\n  create     .agents/agent-works.json   the config: its presence turns the guard on\n`), text);
  assert.ok(text.includes("\nNothing was written. `aw setup --apply` does the create / add / regenerate / section / move / twins steps; REPORT steps are yours.\n\nnext:\n  aw doctor --baseline"));
  for (const args of [[], ["--plan", "--apply"]]) {
    const [code, out, err] = await p.aw("setup", ...args);
    assert.deepEqual([code, out, err], [2, "", "aw setup: say --plan (print what would happen) or --apply (do it)\n"]);
  }
  for (const args of [["--plan", "--twins", "sometimes"], ["--plan", "--kanban", "shared"], ["--plan", "extra"], ["--plan", "--nope"]]) assert.equal((await p.aw("setup", ...args))[0], 2, args.join(" "));
  assert.deepEqual(p.tree(), before);
});

test("agent-works setup: --apply on a fresh repository, then the doctor is calm", async (t) => {
  const p = project(t);
  p.write("src/a.py", "x");
  let [code, out, err] = await p.aw("setup", "--apply");
  assert.deepEqual([code, err], [0, ""]);
  assert.deepEqual(p.tree(), [
    ".agents/CONTEXT.md", ".agents/README.md", ".agents/agent-works.json", ".agents/decisions/README.md",
    ".agents/memory/INDEX.md", ".agents/memory/project/INDEX.md", `.agents/memory/project/${TODAY}-project-status.md`, "AGENTS.md", "CLAUDE.md", "src/a.py"].sort());
  const cfg = JSON.parse(p.read(".agents/agent-works.json"));
  assert.deepEqual([cfg.version, cfg.claude.twins], [config.CONFIG_VERSION, "link"]);
  assert.deepEqual(config.loadConfig(p.root)._error, undefined);
  assert.equal(decisions.indexKind(p.at(".agents/decisions/README.md")), "generated"); // it carries the marker
  assert.ok(p.read(".agents/README.md").includes(`agent-works contract v${common.pluginVersion()}`));
  if (!WINDOWS) assert.equal(fs.readlinkSync(p.at("CLAUDE.md")), "AGENTS.md");
  else assert.equal(p.read("CLAUDE.md"), "@AGENTS.md\n");
  for (const rel of p.tree()) assert.ok(!fs.readFileSync(p.at(rel)).includes("\r"), rel);
  assert.ok(out.includes("created .agents/agent-works.json\n") && out.includes("\nwrote 1 CLAUDE.md twin\n"), out);
  const doc = JSON.parse((await p.aw("doctor", "--json"))[1]);
  assert.equal(doc.summary.critical, 0);
  assert.deepEqual([...new Set(doc.findings.map((f) => f.code))], ["HUB_UNLISTED_CHILD"]); // the repo map is still to fill in
  assert.equal(setup.setUpRoot(p.at("src")), p.root);
  // and a second run changes nothing
  const snapshot = p.tree().map((rel) => fs.readFileSync(p.at(rel), "latin1"));
  [code, out] = await p.aw("setup", "--apply");
  assert.ok(out.includes("nothing to do: everything is in place"));
  assert.deepEqual(p.tree().map((rel) => fs.readFileSync(p.at(rel), "latin1")), snapshot);
  const applied = JSON.parse((await p.aw("setup", "--apply", "--json"))[1]).applied;
  assert.deepEqual(applied, []);
});

test("agent-works setup: generated twins are one-line files behind a line in .gitignore", async (t) => {
  const p = project(t);
  await p.aw("setup", "--apply", "--twins", "generated");
  assert.equal(JSON.parse(p.read(".agents/agent-works.json")).claude.twins, "generated");
  assert.ok(p.read(".gitignore").split("\n").includes("CLAUDE.md"));
  assert.deepEqual(fs.readFileSync(p.at("CLAUDE.md")), Buffer.from("@AGENTS.md\n"));
  // a config that is there decides from then on
  assert.equal((await plan(p)).twins, "generated");
  const q = project(t);
  await q.aw("setup", "--apply", "--twins", "committed");
  assert.equal(q.exists(".gitignore"), false);
  assert.equal(q.read("CLAUDE.md"), "@AGENTS.md\n");
});

test("agent-works setup: the plugins section of the root file", async (t) => {
  const p = project(t);
  const block = common.pluginsBlock();
  for (const name of ["agent-works", "codebase-optimizer", "perceptual-loop"]) assert.ok(block.includes(`| **${name}** |`), name);
  await p.aw("setup", "--apply");
  assert.ok(p.read("AGENTS.md").includes(block)); // a new root file carries it
  assert.ok(!p.read("AGENTS.md").includes("{{"));
  // an existing file: after its first section, and brought up to date in place
  p.write("AGENTS.md", "# Mine\n\n## What this is\n\nA thing.\n\n## Rules\n\n1. One.\n");
  assert.ok((await findingCodes(p)).includes("ROOT_PLUGINS"));
  await p.aw("setup", "--apply");
  assert.equal(p.read("AGENTS.md"), `# Mine\n\n## What this is\n\nA thing.\n\n${block}\n## Rules\n\n1. One.\n`);
  assert.ok(!(await findingCodes(p)).includes("ROOT_PLUGINS"));
  p.write("AGENTS.md", p.read("AGENTS.md").replace("Work judged by eye or ear", "Old words"));
  assert.ok((await findingCodes(p)).includes("ROOT_PLUGINS"));
  // the config's list decides the rows
  p.write(".agents/agent-works.json", JSON.stringify({ version: 1, plugins: ["agent-works"] }));
  await p.aw("setup", "--apply");
  const text = p.read("AGENTS.md");
  assert.ok(text.includes("| **agent-works** |"));
  assert.ok(!text.includes("perceptual-loop"));
  assert.ok(text.endsWith("## Rules\n\n1. One.\n"));
  p.write(".agents/agent-works.json", JSON.stringify({ version: 1, plugins: [] }));
  await p.aw("setup", "--apply");
  assert.equal(p.read("AGENTS.md"), "# Mine\n\n## What this is\n\nA thing.\n\n\n## Rules\n\n1. One.\n");
  assert.ok(!(await findingCodes(p)).includes("ROOT_PLUGINS"));
});

test("agent-works setup: an existing repository keeps its prose and gets reports", async (t) => {
  const p = project(t);
  p.write("AGENTS.md", `# Mine\n${"l\n".repeat(300)}`);
  p.write("CLAUDE.md", "My own Claude notes.\n");
  p.write(".gitignore", "node_modules/"); // no final newline
  p.write(".agents/memory/INDEX.md", "# Memory index\n\nOurs.\n");
  p.write(".agents/memory/tooling/2026-01-05-a-trap.md", "---\nname: a-trap\ndescription: d\ntype: learning\nupdated: 2026-01-05\n---\n");
  p.write(".agents/board/board.json", "{}");
  p.write("docs/adr/0001-first.md", "# 1. First\n");
  p.write("docs/CONTEXT.md", "# Glossary\n");
  p.write(".plan/plan/x.md", "x");
  p.write(".perceptual-loop/config.json", "{}");
  const doc = await plan(p, "--twins", "generated");
  assert.equal(doc.fresh, false);
  assert.deepEqual(steps(doc, "keep"), [["keep", "AGENTS.md"], ["keep", ".agents/memory"]]);
  assert.ok(doc.steps.find((s) => s.path === "AGENTS.md").why.startsWith("yours (301 lines, over the budget of 200"));
  const reports = Object.fromEntries(doc.steps.filter((s) => s.do === "report").map((s) => [s.path, s]));
  assert.deepEqual(Object.keys(reports).sort(), [".agents/board", ".perceptual-loop", ".plan", "CLAUDE.md", "docs/CONTEXT.md", "docs/adr"]);
  assert.equal(reports["docs/adr"].commands[0], "git mv docs/adr .agents/decisions");
  assert.equal(reports["docs/CONTEXT.md"].commands[0], "git mv docs/CONTEXT.md .agents/CONTEXT.md");
  assert.deepEqual(reports[".agents/board"].commands, ["git mv .agents/board .agents/kanban"]);
  assert.ok(reports["docs/adr"].why.includes("DOCS_AGENT_FILE"));
  assert.ok(reports["CLAUDE.md"].why.includes("leave the one line `@AGENTS.md`"));
  assert.ok((await plan(p)).steps.find((s) => s.do === "report" && s.path === "CLAUDE.md").why.includes("delete it") || WINDOWS);
  assert.ok(has(doc, "section", "AGENTS.md"));
  const [code, out] = await p.aw("setup", "--apply", "--twins", "generated");
  assert.equal(code, 0);
  assert.ok(out.includes("  REPORT     docs/adr   DOCS_AGENT_FILE: decision records under the user docs. Move them yourself:\n               git mv docs/adr .agents/decisions\n"), out);
  assert.ok(p.read("AGENTS.md").startsWith("# Mine\n"));
  assert.ok(p.read("AGENTS.md").endsWith(common.pluginsBlock())); // put in, the prose untouched
  assert.equal(p.read("AGENTS.md").split("l\n").length - 1, 300);
  assert.equal(p.read("CLAUDE.md"), "My own Claude notes.\n"); // never overwritten
  assert.ok(out.includes("! CLAUDE.md: has content of its own"), out);
  assert.equal(p.read(".gitignore").split("\n")[0], "node_modules/");
  assert.ok(p.read(".gitignore").split("\n").includes("CLAUDE.md"));
  assert.equal(p.exists("docs/adr/0001-first.md"), true); // nothing is moved out of docs
  assert.equal(p.exists(".agents/decisions"), false);
  assert.equal(p.exists(".agents/CONTEXT.md"), false);
  assert.equal(p.exists(".agents/board/board.json"), true);
  assert.equal(p.read(".agents/memory/INDEX.md"), "# Memory index\n\nOurs.\n"); // an index that was there stays
  assert.equal(p.exists(".agents/memory/tooling/INDEX.md"), false); // and none is written unasked
  assert.ok(!out.includes("wrote .agents/memory"));
  assert.ok((await p.aw("memory", "lint"))[1].includes("MEM_INDEX_STALE"));
  assert.equal(p.exists(".agents/memory/project"), false); // an existing tree is not given a second status
});

test("agent-works setup: a root CLAUDE.md that is a symlink to AGENTS.md is no content of its own", { skip: WINDOWS && "a checkout there holds no symlink" }, async (t) => {
  const p = project(t);
  p.write("AGENTS.md", "# Mine\n");
  fs.symlinkSync("AGENTS.md", p.at("CLAUDE.md"));
  const doc = await plan(p);
  assert.equal(doc.found.claudeOwn, false);
  assert.equal(has(doc, "report", "CLAUDE.md"), false);
});

test("agent-works setup: no twins, a local board, and the board moved out of its old folder", async (t) => {
  const p = project(t);
  p.write(".agents/board/board.json", "{}");
  p.write(".agents/board/0001-a.md", "card");
  const doc = await plan(p, "--twins", "off", "--kanban", "ignored", "--move-board");
  assert.deepEqual(steps(doc, "move"), [["move", ".agents/board"]]);
  assert.deepEqual(steps(doc, "twins"), []);
  assert.deepEqual(steps(doc, "append"), [["append", ".gitignore"]]);
  const [, out] = await p.aw("setup", "--apply", "--twins", "off", "--kanban", "ignored", "--move-board");
  assert.ok(out.includes("  move       .agents/board -> .agents/kanban   KANBAN_OLD_FOLDER: the board moves to .agents/kanban\n"), out);
  assert.ok(out.includes("\nmoved .agents/board to .agents/kanban\n"));
  assert.equal(p.exists(".agents/kanban/0001-a.md"), true);
  assert.equal(p.exists(".agents/board"), false);
  assert.equal(JSON.parse(p.read(".agents/agent-works.json")).claude.twins, "off");
  assert.equal(p.exists("CLAUDE.md"), false);
  const lines = p.read(".gitignore").split("\n");
  assert.ok(lines.includes(".agents/kanban/"));
  assert.ok(!lines.includes("CLAUDE.md"));
});

test("agent-works setup: the contracts page is regenerated only when it is the plugin's own", async (t) => {
  const p = project(t);
  await p.aw("setup", "--apply");
  p.write(".agents/README.md", "<!-- agent-works contract v0.0.1: generated -->\nold\n");
  assert.ok(has(await plan(p), "regenerate", ".agents/README.md"));
  assert.ok((await p.aw("setup", "--apply"))[1].includes("\nregenerated .agents/README.md\n"));
  assert.ok(p.read(".agents/README.md").includes(`contract v${common.pluginVersion()}`));
  p.write(".agents/README.md", "# Hand-written\n");
  assert.ok(has(await plan(p), "report", ".agents/README.md"));
  await p.aw("setup", "--apply");
  assert.equal(p.read(".agents/README.md"), "# Hand-written\n");
});

test("agent-works setup: every template is a file of the plugin, and the config it writes is the current version", () => {
  assert.throws(() => common.template("no-such-template.md"), common.AwError);
  const values = { version: "1", project: "p", twins: "generated", slug: "s", date: "d", title: "t", description: "x", plugins: "", number: "0001", status: "s", type: "t" };
  for (const name of ["config.json", "agents-readme.md", "agents-root.md", "agents-hub.md", "agents-plugins.md", "memory-index.md", "memory-file.md", "status.md", "glossary.md",
    "decision.md", "gitignore-twins", "gitignore-kanban"]) {
    const text = common.template(name, values);
    assert.ok(text.length > 0, name);
    assert.ok(!text.includes("{{"), name);
    assert.ok(!text.includes("\r"), name);
  }
  const written = JSON.parse(common.template("config.json", { twins: "committed" }));
  assert.deepEqual([written.version, written.claude.twins], [config.CONFIG_VERSION, "committed"]);
  // What it writes holds no key the defaults do not know, and no value of another shape.
  for (const [key, value] of Object.entries(written)) assert.equal(typeof value, typeof config.DEFAULTS[key], key);
});

test("agent-works setup: the launcher finds the plugin's command line", async (t) => {
  const p = project(t);
  const target = path.join(p.tmp, "bin");
  const [code, out, err] = await p.aw("setup", "--install-launcher", target);
  assert.deepEqual([code, err], [0, ""]);
  assert.deepEqual(out.split("\n").slice(0, 2), [common.posix(path.join(target, "aw")), common.posix(path.join(target, "aw.cmd"))]);
  assert.ok(out.includes(`note: ${common.posix(target)} is not on your PATH yet`));
  assert.ok(!fs.readFileSync(path.join(target, "aw")).includes("\r"));
  assert.deepEqual(p.tree(), []); // installing a launcher sets nothing up
  const cli = path.join(PLUGIN, "scripts", "aw.mjs");
  const run = (file, args, env) => spawnSync(process.execPath, [file, ...args], { cwd: p.root, encoding: "utf8", env: { ...p.env(), ...env } });
  let r = run(path.join(target, "aw"), ["hubs", "--json"], { AGENT_WORKS_CLI: cli });
  assert.deepEqual([r.status, JSON.parse(r.stdout).findings], [0, []], r.stderr);
  // without the variable it finds the copy it was written from, and a launcher that finds nothing says so
  r = run(path.join(target, "aw"), ["--version"], {});
  assert.deepEqual([r.status, r.stdout], [0, `aw ${common.pluginVersion()}\n`], r.stderr);
  const lost = path.join(p.tmp, "lost");
  setup.installLauncher(lost, { env: { ...p.env(), HOME: p.tmp, USERPROFILE: p.tmp }, baked: path.join(p.tmp, "nowhere", "aw.mjs") });
  r = run(path.join(lost, "aw"), ["--version"], { HOME: p.tmp, USERPROFILE: p.tmp });
  assert.deepEqual([r.status, r.stdout, r.stderr], [1, "", "aw: agent-works is not installed (no scripts/aw.mjs under ~/.claude/plugins/cache)\n"]);
  // a folder that is on the PATH gets no note
  const on = setup.installLauncher(target, { env: { ...p.env(), PATH: [target, process.env.PATH].join(path.delimiter) } });
  assert.equal(on.length, 2);
  if (!WINDOWS) {
    assert.equal(fs.statSync(path.join(target, "aw")).mode & 0o111, 0o111);
    r = spawnSync(path.join(target, "aw"), ["--version"], { cwd: p.root, encoding: "utf8", env: { ...p.env(), AGENT_WORKS_CLI: cli } });
    assert.deepEqual([r.status, r.stdout], [0, `aw ${common.pluginVersion()}\n`], r.stderr);
  }
});

test("agent-works setup: --apply with --install-launcher does both", async (t) => {
  const p = project(t);
  const target = path.join(p.tmp, "bin");
  const doc = JSON.parse((await p.aw("setup", "--apply", "--json", `--install-launcher=${target}`))[1]);
  assert.ok(doc.applied.includes("created AGENTS.md"));
  assert.ok(doc.applied.includes(common.posix(path.join(target, "aw"))));
  assert.equal(p.exists(".agents/agent-works.json"), true);
});
