// agent-works scripts/doctor.mjs: every check together, its own codes, the
// accepted findings, the baseline and the page.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { HAS_GIT, PLUGIN, common, config, project, script } from "./agent-works-homes.mjs";

const doctor = await script("doctor.mjs");
const VERSION = common.pluginVersion();
const STAMP = `<!-- agent-works contract v${VERSION}: generated -->\n`;
// The board's findings come from the board's own module: these suites pin what the doctor itself says.
const NO_BOARD = { mods: { board: { findings: () => [] } } };
const notBoards = (codes) => codes.filter((code) => !/^(KANBAN_|GATE_)/.test(code));

async function runJson(p, ...args) {
  const [code, out, err] = await p.aw("doctor", "--json", ...args);
  assert.equal(err, "");
  return [code, JSON.parse(out)];
}
const codesOf = (doc) => [...new Set(doc.findings.map((f) => f.code))].sort();
const configFindings = (p) => doctor.configFindings(config.loadConfig(p.root), p.root);

test("agent-works doctor: an empty repository without a config is clean, and nothing is written", async (t) => {
  const p = project(t);
  const [code, doc] = await runJson(p);
  assert.deepEqual([code, doc.summary, doc.findings, doc.config, doc.failed], [0, { critical: 0, warning: 0, info: 0 }, [], null, {}]);
  assert.deepEqual(Object.keys(doc), ["project", "root", "config", "at", "failed", "sizes", "codes", "accepted", "summary", "findings"]);
  assert.deepEqual(doc.sizes, { rootAgentsLines: 0, rootAgentsBytes: 0, memoryFiles: 0, memoryFolders: 0, memoryLines: 0, statusLines: 0, decisions: 0, hubs: 0 });
  assert.match(doc.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  const [, text] = await p.aw("doctor");
  assert.equal(text, `agent-works doctor — ${doc.project}   (no .agents/agent-works.json: the defaults apply; aw setup --plan)\n\n`
    + "sizes: rootAgentsLines 0, rootAgentsBytes 0, memoryFiles 0, memoryFolders 0, memoryLines 0, statusLines 0, decisions 0, hubs 0\n\n"
    + "doctor: 0 critical, 0 warning, 0 info\n");
  assert.equal(fs.existsSync(p.home), false); // read-only: nothing is written, here or in the store
  assert.deepEqual(p.tree(), []);
});

test("agent-works doctor: a legacy repository gets its report without a config", async (t) => {
  const p = project(t);
  p.write("AGENTS.md", `# Root\n\n**Status: the MVP works.**\n\n- \`src/\`\n${"line\n".repeat(200)}`);
  p.write("src/app/a.py", "x");
  p.write("docs/adr/0001-first.md", "# 1. First\n\n## Status\n\naccepted\n");
  p.write("docs/CONTEXT.md", "# Glossary\n\n| Term | Meaning |\n|---|---|\n| lap | Once round. |\n");
  p.write("docs/0002-loose.md", "# 2. Loose\n\n## Decision\n\nYes.\n");
  p.write(".agents/board/board.json", "{}");
  p.write(".agents/memory/project/2026-01-09-project-status.md",
    `---\nname: project-status\ndescription: d\ntype: status\nupdated: 2026-01-09\n---\n\n## Done\n\n${"- x\n".repeat(400)}`);
  const [code, doc] = await runJson(p);
  assert.equal(code, 2);
  assert.deepEqual(notBoards(codesOf(doc)), ["DOCS_AGENT_FILE", "HUB_MISSING", "MEM_INDEX_STALE", "ROOT_SIZE", "ROOT_STATUS_PROSE", "STATUS_DONE_SECTION", "STATUS_SIZE"]);
  const by = Object.fromEntries(doc.findings.map((f) => [f.code, f]));
  assert.deepEqual([by.STATUS_SIZE.level, by.ROOT_STATUS_PROSE.level, by.ROOT_STATUS_PROSE.line], ["critical", "info", 3]);
  const moves = doc.findings.filter((f) => f.code === "DOCS_AGENT_FILE").map((f) => [f.path, f.message]).sort();
  assert.deepEqual(moves.map(([where]) => where), ["docs/0002-loose.md", "docs/CONTEXT.md", "docs/adr"]);
  assert.ok(moves[1][1].includes("`git mv docs/CONTEXT.md .agents/CONTEXT.md`"));
  assert.ok(moves[2][1].includes("`git mv docs/adr .agents/decisions`"));
  assert.deepEqual([doc.sizes.rootAgentsLines, doc.sizes.statusLines, doc.sizes.memoryFiles], [205, 409, 1]);
  assert.equal(doc.sizes.rootAgentsBytes, Buffer.byteLength(p.read("AGENTS.md")));
  const [, text] = await p.aw("doctor");
  for (const heading of ["Hubs and the root", "Memory and status", "User docs", "doctor: 1 critical"]) assert.ok(text.includes(heading), heading);
  // The board's module, where the plugin has it, adds the board's own line about the old folder.
  if (codesOf(doc).some((c) => c.startsWith("KANBAN_"))) {
    assert.ok(codesOf(doc).includes("KANBAN_OLD_FOLDER"));
    assert.ok(text.includes("Tasks and briefs"));
  }
});

test("agent-works doctor: a config that is not valid is critical", async (t) => {
  const p = project(t);
  p.write(".agents/agent-works.json", "{ nope");
  const [code, doc] = await runJson(p);
  assert.equal(code, 2);
  assert.deepEqual(doc.findings.filter((f) => f.code === "CONFIG_INVALID").map((f) => [f.level, f.path]), [["critical", ".agents/agent-works.json"]]);
  assert.ok(doc.findings[0].message.endsWith("(the defaults apply until it is fixed)"));
  p.write(".agents/agent-works.json", JSON.stringify({
    version: 2, budgets: [],
    guard: { ownerFiles: "x", rules: [{ id: "r", match: ["([a"] }, { match: ["x"] }], generated: [{ match: "((" }] },
    resources: { gpu: { scope: "galaxy", match: ["ok"] }, bad: 3 },
  }));
  let msgs = configFindings(p).map((f) => f.message);
  assert.equal(msgs.length, 8, msgs.join("\n"));
  for (const part of ['"version" is 2; this plugin reads version 1', '"budgets" must be an object', '"guard.ownerFiles" must be a list', "guard.rules[r]: the pattern '([a'",
    'every guard.rules entry is an object with "id" and "match"', "guard.generated: the pattern '(('", '"resources.gpu.scope" is "project" or "machine"',
    '"resources.bad" must be an object']) assert.ok(msgs.some((m) => m.includes(part)), `${part}\n${msgs.join("\n")}`);
  p.write(".agents/agent-works.json", JSON.stringify({ version: 1, guard: { rules: [{ id: "ok", match: ["a+"] }], generated: [{ match: "(^|/)src/gen/", how: "x" }, { how: "y" }] } }));
  assert.deepEqual(configFindings(p), []);
  for (const version of ["1", 0, 1.5, null]) {
    p.write(".agents/agent-works.json", JSON.stringify({ version }));
    msgs = configFindings(p).map((f) => f.message);
    assert.deepEqual(msgs, [`"version" is ${JSON.stringify(version)}; this plugin reads version 1`]);
  }
  p.write(".agents/agent-works.json", "{}"); // the version left out is the current one
  assert.deepEqual(configFindings(p), []);
});

test("agent-works doctor: match entries of the config with an unless of their own", (t) => {
  const p = project(t);
  const good = {
    version: 1,
    guard: { rules: [{ id: "r", match: [{ pattern: "a+", unless: ["b"] }, "c"], unless: ["d"] }] },
    resources: { ed: { match: [{ pattern: "render\\.ps1", unless: ["-List\\b"] }, "Editor"], unless: ["--version"], matchFileCommands: true } },
    runs: [{ id: "x", match: [{ pattern: "render", unless: "--plan" }], unless: ["--help"] }],
  };
  p.write(".agents/agent-works.json", JSON.stringify(good));
  assert.deepEqual(configFindings(p), []);
  const bad = {
    version: 1,
    guard: { rules: [{ id: "r", match: [{ pattern: "a", unless: ["([b"] }, { unless: ["x"] }] }] },
    resources: { ed: { match: [{ pattern: "((", unless: ["ok"] }, 7], unless: ["[z"] } },
    runs: [{ id: "x", match: [{ pattern: "ok", unless: ["(?P<"] }], unless: ["(("] }],
  };
  p.write(".agents/agent-works.json", JSON.stringify(bad));
  const found = configFindings(p);
  assert.ok(found.every((f) => f.code === "CONFIG_INVALID" && f.level === "critical"));
  const msgs = found.map((f) => f.message);
  assert.equal(msgs.length, 7, msgs.join("\n"));
  for (const part of ["guard.rules[r] (unless): the pattern '([b'", 'guard.rules[r]: a match entry is a regular expression or {"pattern": …, "unless": […]}; {"unless": ["x"]} has no "pattern"',
    "resources.ed: the pattern '(('", "resources.ed: 7 is not a regular expression (a string)", "resources.ed (unless): the pattern '[z'",
    "runs[x] (unless): the pattern '(?P<'", "runs[x] (unless): the pattern '(('"]) assert.ok(msgs.some((m) => m.includes(part)), `${part}\n${msgs.join("\n")}`);
});

test("agent-works doctor: Markdown named like a brief outside the briefs folder", async (t) => {
  const p = project(t);
  const w = p.write;
  w(".agents/agent-works.json", "{}");
  w(".gitignore", ".scratch/\nruns/\n");
  w(".scratch/round-3/agent-a1.md", "Do the importer.\n"); // git-ignored: exactly where they hide
  w(".scratch/BRIEF-common.md", "Rules for all.\n");
  w("runs/2026-01-05/handoff.md", "What is left.\n");
  w("notes/Handover-to-next.md", "x\n");
  w("docs/agent-brief.md", "x\n");
  w("a/b/c/briefing.md", "x\n"); // three folders deep: still read
  // not strays
  w(".agents/briefs/common.md", "ours\n");
  w(".agents/briefs/rounds/2026-01-05-brief-round.md", "ours\n");
  w(".agents/memory/tooling/2026-01-05-brief-lessons.md", "a memory about briefs\n");
  w(".agents/kanban/0001-write-the-brief.md", "a card\n");
  w("docs/brief.txt", "not Markdown\n");
  w("docs/briefcase/notes.md", "the folder's name is not the file's\n");
  w("AGENTS.md", "# Root\n");
  // not walked: too deep, heavy trees, the tool's own work trees, a folder of thousands
  w("a/b/c/d/agent-deep.md", "x\n");
  w("node_modules/pkg/agent-brief.md", "x\n");
  w("build/handoff.md", "x\n");
  w(".claude/worktrees/w1/.scratch/agent-a1.md", "x\n");
  w(".claude/agents/agent-reviewer.md", "an agent definition\n");
  w("huge/agent-lost.md", "x\n");
  w("huge/sub/agent-lost.md", "x\n");
  for (let i = 0; i < 41; i++) w(`huge/data-${String(i).padStart(3, "0")}.bin`, "");
  const strays = () => doctor.strayBriefFindings(p.root, config.loadConfig(p.root));
  const { entries } = doctor.STRAY;
  doctor.STRAY.entries = 40;
  t.after(() => { doctor.STRAY.entries = entries; });
  const found = strays();
  assert.deepEqual(found.map((f) => [f.code, f.level, f.path]), [".scratch/BRIEF-common.md", ".scratch/round-3/agent-a1.md", "a/b/c/briefing.md", "docs/agent-brief.md",
    "notes/Handover-to-next.md", "runs/2026-01-05/handoff.md"].map((where) => ["BRIEF_STRAY", "warning", where]));
  assert.ok(found[0].message.includes("outside .agents/briefs: no agent finds it there. Move what holds for every round into .agents/briefs/common.md"));
  assert.equal(doctor.groupOf("BRIEF_STRAY"), "Tasks and briefs");
  // through the whole doctor, and the names are a setting
  assert.ok(codesOf((await runJson(p))[1]).includes("BRIEF_STRAY"));
  w(".agents/agent-works.json", JSON.stringify({ briefs: { stray: ["handoff*.md"] } }));
  assert.deepEqual(strays().map((f) => f.path), ["runs/2026-01-05/handoff.md"]);
  w(".agents/agent-works.json", JSON.stringify({ briefs: { stray: [] }, paths: { briefs: ".scratch" } }));
  assert.deepEqual(strays(), []);
  w(".agents/agent-works.json", JSON.stringify({ paths: { briefs: ".scratch" } })); // the briefs folder is a setting
  const got = strays().map((f) => f.path);
  assert.ok(!got.includes(".scratch/BRIEF-common.md"));
  assert.ok(got.includes(".agents/briefs/rounds/2026-01-05-brief-round.md"));
  w(".agents/agent-works.json", JSON.stringify({ briefs: [] }));
  assert.ok(configFindings(p).some((f) => f.message === '"briefs" must be an object'));
});

test("agent-works doctor: the plugin's own templates are no stray briefs when the project is the plugin", () => {
  const repo = path.resolve(PLUGIN, "..", "..");
  const found = doctor.strayBriefFindings(repo, config.loadConfig(repo)).map((f) => f.path);
  assert.deepEqual(found.filter((where) => where.startsWith("plugins/agent-works/")), []);
});

test("agent-works doctor: the contracts page: missing, without a stamp, of another version, over its budget", async (t) => {
  const p = project(t, { config: { claude: { twins: "off" } } });
  const stale = async () => (await runJson(p))[1].findings.filter((f) => f.code === "CONTRACT_STALE").map((f) => f.message);
  assert.ok(codesOf((await runJson(p))[1]).includes("CONTRACT_MISSING"));
  p.write(".agents/README.md", "# mine\n");
  assert.deepEqual(await stale(), ["carries no agent-works version stamp (aw setup --apply regenerates it)"]);
  p.write(".agents/README.md", "<!-- agent-works contract v0.0.1: generated -->\n# x\n");
  assert.deepEqual(await stale(), [`generated by agent-works 0.0.1, installed is ${VERSION} (aw setup --apply regenerates it)`]);
  p.write(".agents/README.md", `${STAMP}# x\n${"l\n".repeat(120)}`);
  assert.deepEqual(await stale(), ["122 lines, the budget is 120"]);
  p.write(".agents/README.md", `${STAMP}# x\n`);
  assert.deepEqual(codesOf((await runJson(p))[1]), []);
});

test("agent-works doctor: briefs over their budget, a missing twin, and tasks in two homes", async (t) => {
  const p = project(t, { config: { tasks: { home: "github" } } });
  p.write(".agents/README.md", STAMP);
  p.write("AGENTS.md", "# Root\n");
  p.write(".agents/briefs/common.md", "l\n".repeat(121));
  p.write(".agents/briefs/rounds/2026-01-05-round.md", "l\n".repeat(81));
  p.write(".agents/briefs/rounds/2026-01-06-short.md", "l\n".repeat(80));
  p.write(".agents/kanban/board.json", "{}");
  p.write(".agents/kanban/0001-a.md", '---\nid: "0001"\ntitle: A\nstatus: todo\norder: 1\n---\n');
  const found = (await doctor.collect(p.root, NO_BOARD)).findings;
  const got = found.filter((f) => /^(BRIEF_|GEN_|TASKS_)/.test(f.code)).map((f) => [f.code, f.path]);
  assert.deepEqual(got, [["BRIEF_SIZE", ".agents/briefs/common.md"], ["BRIEF_SIZE", ".agents/briefs/rounds/2026-01-05-round.md"],
    ["GEN_TWIN_MISSING", "CLAUDE.md"], ["TASKS_TWO_HOMES", ".agents/kanban"]]);
  assert.ok(found.find((f) => f.path.endsWith("-round.md")).message.startsWith("81 lines, the budget is 80"));
  assert.ok(found.find((f) => f.code === "TASKS_TWO_HOMES").message.startsWith('tasks.home is "github"'));
  assert.deepEqual(["BRIEF_SIZE", "GEN_TWIN_MISSING", "SOMETHING_NEW", "CLAUDE_CHAIN", "GATE_OWED_OLD"].map(doctor.groupOf),
    ["Tasks and briefs", "Hubs and the root", "Other", "Hubs and the root", "Tasks and briefs"]);
  // cards in the old folder and the new one are two homes too
  p.write(".agents/agent-works.json", "{}");
  p.write(".agents/board/0002-b.md", "card\n");
  const two = doctor.tasksFindings(p.root, config.loadConfig(p.root));
  assert.deepEqual(two.map((f) => [f.code, f.path, f.message]), [["TASKS_TWO_HOMES", ".agents/board", "cards in both .agents/board and .agents/kanban: move the old ones over"]]);
});

test("agent-works doctor: a brief git does not track", { skip: !HAS_GIT && "needs git" }, (t) => {
  const p = project(t, { config: {}, git: "real" });
  p.write(".agents/briefs/common.md", "tracked\n");
  p.write(".agents/briefs/rounds/scratch.md", "not tracked\n");
  p.git("add", "--", ".agents/briefs/common.md");
  const found = doctor.briefFindings(p.root, config.loadConfig(p.root));
  assert.deepEqual(found.map((f) => [f.code, f.level, f.path]), [["BRIEF_UNTRACKED", "warning", ".agents/briefs/rounds/scratch.md"]]);
});

test("agent-works doctor: a check that breaks does not hide the others", async (t) => {
  const failed = {};
  assert.deepEqual(await doctor.safe("boom", () => { throw new RangeError("out of it"); }, failed), []);
  assert.deepEqual(failed, { boom: "RangeError: out of it" });
  const p = project(t);
  p.write("AGENTS.md", `# Root\n${"l\n".repeat(250)}`);
  const res = await doctor.collect(p.root, { mods: { board: { findings: () => { throw new Error("the board is on fire"); } } } });
  assert.deepEqual(res.failed, { kanban: "Error: the board is on fire" });
  assert.deepEqual(res.findings.map((f) => f.code), ["ROOT_SIZE"]);
  const none = await doctor.collect(p.root, { mods: { board: {} } });
  assert.deepEqual(none.failed, { kanban: "Error: scripts/io.mjs exports no findings" });
  // what the board's module finds is listed with the rest, whether it hands back findings or plain objects
  const some = await doctor.collect(p.root, { mods: { board: { findings: (root) => [{ code: "KANBAN_CARD_INVALID", level: "warning", path: `${path.basename(root)}/x.md`, message: "no id" }] } } });
  assert.deepEqual(some.findings.map((f) => [f.code, f.path, f.line]), [["KANBAN_CARD_INVALID", "acme/x.md", 0], ["ROOT_SIZE", "AGENTS.md", 0]]);
  assert.deepEqual(some.failed, {});
});

test("agent-works doctor: --baseline records the numbers, and later runs print what moved", async (t) => {
  const p = project(t);
  p.write("AGENTS.md", `# Root\n${"l\n".repeat(250)}`);
  let [code, doc] = await runJson(p, "--baseline");
  const file = path.join(p.home, "projects", common.projectId(p.root), "baseline.json");
  assert.equal(fs.existsSync(file), true);
  assert.equal(doc.baselineWritten, common.posix(file));
  assert.equal("baseline" in doc, false); // the first run has nothing to compare against
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(Object.keys(saved), ["at", "project", "sizes", "codes"]);
  assert.deepEqual([saved.sizes.rootAgentsLines, saved.codes, saved.project], [251, { ROOT_SIZE: 1 }, doc.project]);
  p.write("AGENTS.md", `# Root\n${"l\n".repeat(150)}`);
  [code, doc] = await runJson(p);
  assert.equal(code, 0);
  assert.deepEqual(doc.baseline.sizes.rootAgentsLines, [251, 151]);
  assert.deepEqual(doc.baseline.codes, { ROOT_SIZE: [1, 0] });
  assert.equal(doc.baseline.at, saved.at);
  const [, text] = await p.aw("doctor");
  assert.ok(text.includes(`since the baseline of ${saved.at}:\n  rootAgentsBytes: 507 -> 307\n  rootAgentsLines: 251 -> 151\n  ROOT_SIZE: 1 -> 0\n`), text);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).sizes.rootAgentsLines, 251); // only --baseline rewrites it
  await p.aw("doctor", "--baseline");
  assert.ok((await p.aw("doctor"))[1].includes("nothing moved since the baseline of "));
});

test("agent-works doctor: --html writes one self-contained page", async (t) => {
  const p = project(t, { config: { version: 1, claude: { twins: "off" }, accept: [{ code: "CONTRACT_MISSING", path: ".agents/README.md", why: "not <yet>" }] } });
  p.write("AGENTS.md", `# Root <b>\n${"l\n".repeat(250)}`);
  const [code, text] = await p.aw("doctor", "--html", "report.html");
  assert.equal(code, 1);
  assert.ok(text.endsWith("report written: report.html\n"), text);
  const page = p.read("report.html");
  assert.ok(page.startsWith('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'));
  assert.ok(page.includes('<tr class="warning"><td>warning</td><td><code>ROOT_SIZE</code></td><td><code>AGENTS.md</code></td>'));
  assert.ok(page.includes("<h2>Accepted <small>1</small></h2>") && page.includes("<td>not &lt;yet&gt;</td>"));
  assert.ok(page.includes(" · 1 accepted · config: .agents/agent-works.json</p>"));
  assert.ok(!page.replaceAll("http-equiv", "").includes("http")); // self-contained: nothing is fetched
  const clean = project(t);
  await clean.aw("doctor", "--json", "--html", path.join(clean.tmp, "out.html"));
  assert.ok(fs.readFileSync(path.join(clean.tmp, "out.html"), "utf8").includes("<p>Clean.</p>"));
});

test("agent-works doctor: the text report folds a long list, and --all lists it", async (t) => {
  const p = project(t);
  for (let i = 0; i < 12; i++) p.write(`.agents/memory/loose-${i}.md`, "x");
  const [, text] = await p.aw("doctor");
  assert.ok(text.includes("\n  … 4 more MEM_ROOT_LOOSE (--json or --all lists them)\n"), text);
  assert.ok(text.includes("Memory and status (13)\n"));
  assert.ok(!(await p.aw("doctor", "--all"))[1].includes("more MEM_ROOT_LOOSE"));
});

// ---- `accept` in the config: a finding the project decided is fine as it is ------------------------------------

const WHY = "cli.ts is the path every run command names";

function mixed(t) {
  const p = project(t);
  p.write("AGENTS.md", "# Root\n\n- `apps/`\n");
  p.write("apps/hub/src/cli.ts", "x");
  p.write("apps/hub/src/store/a.ts", "x");
  const long = (slug, description, date) => `---\nname: ${slug}\ndescription: ${description}\ntype: reference\nupdated: ${date}\n---\n\n${"- step\n".repeat(420)}`;
  p.write(".agents/memory/reference/2026-01-05-approved-plan.md", long("approved-plan", "The plan as approved", "2026-01-05"));
  p.write(".agents/memory/reference/2026-01-06-other.md", long("other", "Another long one", "2026-01-06"));
  p.accept = (accept, more = {}) => p.write(".agents/agent-works.json", JSON.stringify({ version: 1, claude: { twins: "off" }, accept, ...more }));
  return p;
}
const having = (doc, code) => doc.findings.filter((f) => f.code === code).map((f) => f.path).sort();

test("agent-works doctor: an accepted finding is not a warning", async (t) => {
  const p = mixed(t);
  p.accept([]);
  const [, before] = await runJson(p);
  assert.deepEqual(having(before, "HUB_MIXED_DIR"), ["apps/hub/src"]);
  assert.equal(having(before, "MEM_FILE_SIZE").length, 2);
  assert.deepEqual(before.accepted, []);
  p.accept([{ code: "HUB_MIXED_DIR", path: "apps/hub/src", why: WHY },
    { code: "MEM_FILE_SIZE", path: ".agents/memory/reference/*-approved-plan.md", why: "the approved plan, as written" }]);
  const [, doc] = await runJson(p);
  assert.deepEqual(having(doc, "HUB_MIXED_DIR"), []);
  assert.deepEqual(having(doc, "MEM_FILE_SIZE"), [".agents/memory/reference/2026-01-06-other.md"]); // the glob took one, not both
  assert.deepEqual(having(doc, "ACCEPT_UNUSED"), []);
  assert.equal(doc.summary.warning, before.summary.warning - 2);
  assert.deepEqual(doc.accepted.map((a) => [a.code, a.path, a.why]), [["HUB_MIXED_DIR", "apps/hub/src", WHY],
    ["MEM_FILE_SIZE", ".agents/memory/reference/2026-01-05-approved-plan.md", "the approved plan, as written"]]);
  assert.deepEqual(Object.keys(doc).slice(-2), ["summary", "findings"]);
  assert.equal("HUB_MIXED_DIR" in doc.codes, false); // the baseline counts what is still open
  const [, text] = await p.aw("doctor");
  assert.ok(text.includes("\n2 accepted (aw doctor --accepted lists them)\n"));
  assert.ok(!text.includes(WHY));
  const [, listed] = await p.aw("doctor", "--accepted");
  assert.ok(listed.includes(`\nAccepted (2)\n  HUB_MIXED_DIR          apps/hub/src — ${WHY}\n`), listed);
  assert.ok(!listed.includes("aw doctor --accepted lists them"));
});

test("agent-works doctor: accepting everything that warns makes the run clean", async (t) => {
  const p = mixed(t);
  p.accept([]);
  let [code, doc] = await runJson(p);
  assert.equal(code, 1);
  p.accept(doc.findings.filter((f) => f.level === "warning").map((f) => ({ code: f.code, path: f.path, why: "decided" })));
  [code, doc] = await runJson(p);
  assert.deepEqual([code, doc.summary.warning, doc.summary.critical], [0, 0, 0]);
  assert.ok((await p.aw("doctor"))[1].includes("doctor: 0 critical, 0 warning"));
});

test("agent-works doctor: a critical finding and the config's own check are never accepted", async (t) => {
  const p = mixed(t);
  const status = ".agents/memory/project/2026-01-09-project-status.md";
  p.write(status, `---\nname: project-status\ndescription: d\ntype: status\nupdated: 2026-01-09\n---\n\n${"- x\n".repeat(400)}`);
  p.accept([{ code: "STATUS_SIZE", path: status, why: "long on purpose" }]);
  let [code, doc] = await runJson(p);
  assert.equal(code, 2);
  assert.deepEqual(doc.findings.filter((f) => f.code === "STATUS_SIZE").map((f) => f.level), ["critical"]);
  assert.deepEqual(doc.accepted, []);
  const unused = doc.findings.filter((f) => f.code === "ACCEPT_UNUSED");
  assert.deepEqual(unused.map((f) => [f.level, f.path]), [["info", ".agents/agent-works.json"]]);
  assert.equal(unused[0].message, `accept[0] (STATUS_SIZE at ${status}) matches only a critical finding, and a critical finding is never accepted: repair it, and remove the entry`);
  for (const never of ["CONFIG_INVALID", "ACCEPT_UNUSED"]) {
    p.accept([{ code: never, path: "*", why: "no" }]);
    [code, doc] = await runJson(p);
    assert.equal(code, 2);
    assert.ok(doc.findings.some((f) => f.code === "CONFIG_INVALID" && f.message.includes("is never accepted")), never);
  }
});

test("agent-works doctor: an entry of accept that matches nothing is reported", async (t) => {
  const p = mixed(t);
  p.accept([{ code: "HUB_MIXED_DIR", path: "apps/hub/src", why: WHY }, { code: "HUB_MIXED_DIR", path: "apps/gone", why: "it was mixed once" }]);
  const [, doc] = await runJson(p);
  const unused = doc.findings.filter((f) => f.code === "ACCEPT_UNUSED");
  assert.deepEqual(unused.map((f) => [f.level, f.message]), [["info", "accept[1] (HUB_MIXED_DIR at apps/gone) matches no finding: remove the entry"]]);
  assert.equal(doctor.groupOf("ACCEPT_UNUSED"), "Config");
});

test("agent-works doctor: the shape of accept is checked, and the entries that hold still hold", async (t) => {
  const p = mixed(t);
  p.accept({ code: "HUB_MIXED_DIR" });
  assert.deepEqual(configFindings(p).map((f) => f.message), ['"accept" must be a list']);
  p.accept(["HUB_MIXED_DIR", { code: "HUB_MIXED", path: "a", why: "w" }, { code: "HUB_MIXED_DIR", why: "w" }, { code: "HUB_MIXED_DIR", path: "a", why: "  " },
    { code: "HUB_MIXED_DIR", path: "a" }, { code: "HUB_MIXED_DIR", path: "apps/hub/src", why: WHY }]);
  const found = configFindings(p);
  assert.deepEqual(found.map((f) => [f.code, f.level]), Array(5).fill(["CONFIG_INVALID", "critical"]));
  for (const part of ["accept[0]", 'accept[1]: "code" "HUB_MIXED" is not a finding code', 'accept[2]: "path"', 'accept[3]: "why"', 'accept[4]: "why"']) {
    assert.ok(found.some((f) => f.message.includes(part)), part);
  }
  const [code, doc] = await runJson(p); // the entry that is well-formed still holds
  assert.deepEqual([code, having(doc, "HUB_MIXED_DIR"), doc.accepted.length], [2, [], 1]);
  p.accept([], { name: 7 });
  assert.ok(configFindings(p)[0].message.startsWith('"name" must be a string'));
});

test("agent-works doctor: the single checks honour the list", async (t) => {
  const p = mixed(t);
  p.accept([]);
  let [code, out] = await p.aw("hubs", "--json");
  assert.deepEqual([code, JSON.parse(out).findings.map((f) => f.code)], [1, ["HUB_MISSING", "HUB_MISSING", "HUB_MIXED_DIR"]]);
  assert.equal("accepted" in JSON.parse(out), false);
  assert.equal((await p.aw("memory", "lint"))[0], 1);
  const one = { code: "HUB_MIXED_DIR", path: "apps/hub/src", why: WHY };
  p.accept([one]);
  [code, out] = await p.aw("hubs", "--json");
  let doc = JSON.parse(out);
  assert.deepEqual([code, doc.findings.map((f) => f.code), doc.summary.warning], [1, ["HUB_MISSING", "HUB_MISSING"], 2]);
  assert.deepEqual(doc.accepted.map((a) => [a.code, a.path, a.why]), [["HUB_MIXED_DIR", "apps/hub/src", WHY]]);
  assert.deepEqual(Object.keys(doc).slice(-2), ["summary", "findings"]);
  p.accept([one, { code: "HUB_MISSING", path: "apps*", why: "two folders, one file each" },
    { code: "MEM_FILE_SIZE", path: "./.agents/memory/reference/*", why: "reference material, kept whole" }]);
  [code, out] = await p.aw("hubs");
  assert.equal(code, 0);
  assert.ok(out.includes("3 accepted (aw doctor --accepted lists them)"));
  assert.ok(out.trimEnd().endsWith("clean"));
  [code, out] = await p.aw("memory", "lint", "--json");
  doc = JSON.parse(out);
  assert.deepEqual(doc.findings.filter((f) => f.code === "MEM_FILE_SIZE"), []);
  assert.equal(doc.accepted.length, 2);
  assert.ok(!out.includes("ACCEPT_UNUSED")); // only the whole run can say an entry matches nothing
});

test("agent-works doctor: every finding code these commands report is a known one, and every known one is reported somewhere", () => {
  const used = new Set();
  for (const name of ["hubs", "twins", "memory", "decisions", "links", "dup", "doctor"]) {
    const source = fs.readFileSync(path.join(PLUGIN, "scripts", `${name}.mjs`), "utf8");
    for (const m of source.matchAll(/Finding\(\s*"([A-Z][A-Z0-9_]+)"/g)) used.add(m[1]);
    for (const m of source.matchAll(/Finding\(\w+ \? "([A-Z][A-Z0-9_]+)" : "([A-Z][A-Z0-9_]+)"/g)) used.add(m[1]).add(m[2]);
  }
  // The board's own codes are reported by the board's module.
  assert.deepEqual([...used].sort(), notBoards([...common.CODES]).sort());
  assert.deepEqual(common.CODES.filter((code) => doctor.groupOf(code) === "Other"), []);
  assert.equal(doctor.groupOf("HUB_SIZE"), "Hubs and the root");
});

test("agent-works doctor: --help says what it checks, and an option it does not have is refused", async (t) => {
  const p = project(t);
  const [code, out] = await p.aw("doctor", "--help");
  assert.equal(code, 0);
  assert.ok(out.startsWith("usage: aw doctor [--json] [--baseline] [--html FILE] [--all] [--accepted]\n       aw doctor --machine [--json]\n"));
  assert.equal((await p.aw("doctor", "--nope"))[0], 2);
});

test("agent-works doctor: --machine checks the machine instead of the repository", async (t) => {
  const p = project(t);
  const [code, out, err] = await p.aw("doctor", "--machine", "--json");
  const doc = JSON.parse(out);
  assert.equal(err, "");
  assert.deepEqual(Object.keys(doc), ["ok", "checks"]);
  assert.deepEqual(doc.checks.map((c) => c.id), ["node", "git", "forge"]);
  assert.equal(code, doc.ok ? 0 : 1);
  assert.deepEqual(doc.checks[0], { id: "node", hard: true, status: "ok", detail: `Node ${process.versions.node}` });
  const [, text] = await p.aw("doctor", "--machine");
  assert.ok(text.startsWith("machine: "), text);
  assert.deepEqual(p.tree(), []);
});
