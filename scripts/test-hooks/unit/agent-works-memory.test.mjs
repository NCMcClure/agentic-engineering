// agent-works scripts/memory.mjs: lint, generated and hand-written indexes, new and touch.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { HAS_GIT, codes, common, config, project, script } from "./agent-works-homes.mjs";

const memory = await script("memory.mjs");
const TODAY = common.today();
const G = memory.GENERATED; // the second line of a generated index
const M = ".agents/memory";

function mem(slug, { type = "learning", description = "What is in it and when it matters", date = "2026-01-05", name = null, extra = "", body = "Body.\n" } = {}) {
  return `---\nname: ${name ?? slug}\ndescription: ${description}\ntype: ${type}\nupdated: ${date}\n${extra}---\n\n# ${slug}\n\n${body}`;
}

/** A tree whose indexes are generated (they carry the marker). */
function generated(t) {
  const p = project(t, { config: {} });
  p.write(`${M}/INDEX.md`, `# Memory index\n${G}\n\nWhat this project remembers.\n`);
  p.write(`${M}/tooling/INDEX.md`, `# tooling/\n${G}\n\nTraps of the build tools.\n`);
  p.write(`${M}/tooling/2026-01-05-compiler-memory.md`, mem("compiler-memory"));
  p.write(`${M}/tooling/2026-01-07-why-ninja.md`, mem("why-ninja", { type: "decision", date: "2026-01-07" }));
  p.write(`${M}/project/2026-01-09-project-status.md`, mem("project-status", { type: "status", date: "2026-01-09" }));
  return p;
}
const found = (p, cfg = null) => memory.findings(p.root, cfg);
const unique = (pairs) => pairs.filter((x, i) => i === 0 || String(x) !== String(pairs[i - 1]));
const codesOf = (p) => unique(codes(found(p)));
const bytes = (p, rel) => fs.readFileSync(p.at(rel)).toString("latin1");
const lines = (text) => text.split("\n").filter((l, i, all) => i < all.length - 1 || l !== "");

/** Make another folder's index stale, and return its bytes: a side effect on it would show. */
function staleProjectIndex(p) {
  p.write(`${M}/project/2026-01-09-project-status.md`, mem("project-status", { type: "status", description: "Where the project stands now", date: "2026-01-09" }));
  return bytes(p, `${M}/project/INDEX.md`);
}

test("agent-works memory: the index is generated from the frontmatter", async (t) => {
  const p = generated(t);
  assert.equal((await p.aw("memory", "index", "--check"))[0], 1);
  let [code, out] = await p.aw("memory", "index");
  assert.equal(code, 0);
  assert.deepEqual(lines(out), [`wrote ${M}/INDEX.md`, `wrote ${M}/project/INDEX.md`, `wrote ${M}/tooling/INDEX.md`]);
  const tooling = lines(p.read(`${M}/tooling/INDEX.md`));
  assert.deepEqual(tooling.slice(0, 7), ["# tooling/", G, "", "Traps of the build tools.", "", "Parent: [../INDEX.md](../INDEX.md)", ""]);
  // decisions before learnings, each line: slug, type, the description
  assert.deepEqual(tooling.slice(-2), ["- [why-ninja](2026-01-07-why-ninja.md) — decision — What is in it and when it matters",
    "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — What is in it and when it matters"]);
  const root = p.read(`${M}/INDEX.md`);
  assert.deepEqual(lines(root).slice(0, 2), ["# Memory index", G]);
  assert.ok(root.includes("What this project remembers.")); // the hand-written line is kept
  assert.ok(root.includes("- [tooling/](tooling/INDEX.md) — Traps of the build tools."));
  assert.ok(root.includes("- [project/](project/INDEX.md) — <one line: what belongs in this folder>"));
  assert.equal(lines(p.read(`${M}/project/INDEX.md`))[1], G); // a missing index is made generated
  assert.equal((await p.aw("memory", "index", "--check"))[0], 0);
  assert.equal((await p.aw("memory", "index"))[1], "memory indexes are up to date\n");
  // the folder that never got its line says so, until the line is written by hand
  const got = found(p);
  assert.deepEqual(got.map((f) => [f.code, f.level, f.path, f.line]), [["MEM_INDEX_PLACEHOLDER", "warning", `${M}/project/INDEX.md`, 4]]);
  assert.ok(got[0].message.includes("aw memory index"));
  [code, out] = await p.aw("memory", "lint");
  assert.equal(code, 1);
  assert.ok(out.endsWith("memory: 3 memories in 2 folders: 1 warning\n"), out);
  p.write(`${M}/project/INDEX.md`, p.read(`${M}/project/INDEX.md`).replace(memory.FOLDER_INTRO, "The living status."));
  assert.deepEqual(codesOf(p), [["MEM_INDEX_STALE", `${M}/INDEX.md`]]); // the parent still lists the placeholder
  await p.aw("memory", "index");
  assert.ok(p.read(`${M}/INDEX.md`).includes("- [project/](project/INDEX.md) — The living status."));
  assert.deepEqual(codesOf(p), []);
  assert.deepEqual(["", "tooling/", "project/"].map((d) => memory.indexKind(p.at(`${M}/${d}INDEX.md`))), ["generated", "generated", "generated"]);
});

test("agent-works memory: every lint code", async (t) => {
  const p = generated(t);
  await p.aw("memory", "index");
  const w = (name, text) => p.write(`${M}/${name}`, text);
  w("loose-note.md", "no home");
  w("tooling/2026-01-05-no-front.md", "# nothing\n");
  w("tooling/Bad Name.md", mem("bad-name"));
  w("tooling/2026-01-06-other.md", mem("other", { name: "different", date: "2026-01-06" }));
  w("tooling/2026-01-06-odd-type.md", mem("odd-type", { type: "note", date: "2026-01-06" }));
  w("tooling/2026-01-06-old-date.md", mem("old-date", { date: "2025-12-01" }));
  w("project/2026-01-06-compiler-memory.md", mem("compiler-memory", { date: "2026-01-06" }));
  w("tooling/2026-01-06-long-hook.md", mem("long-hook", { description: "x".repeat(161), date: "2026-01-06" }));
  w("tooling/2026-01-06-linked.md", mem("linked", { date: "2026-01-06", body: "See [[why-ninja]] and [[nowhere]] but not `[[in-code]]`.\n" }));
  w("tooling/2026-01-06-big.md", mem("big", { date: "2026-01-06", body: "line\n".repeat(400) }));
  w("tooling/2026-01-06-shared.md", mem("shared", { date: "2026-01-06", extra: "tags: [machine, windows]\n" }));
  w("project/2026-01-06-second-status.md", mem("second-status", { type: "status", date: "2026-01-06", body: "## Done\n\n- much\n" }));
  const got = found(p);
  const by = (code) => got.filter((f) => f.code === code);
  const names = (code) => by(code).map((f) => f.path.split("/").at(-1)).sort();
  assert.deepEqual(names("MEM_ROOT_LOOSE"), ["loose-note.md"]);
  assert.deepEqual(names("MEM_FRONTMATTER"), ["2026-01-05-no-front.md", "2026-01-06-odd-type.md", "2026-01-06-old-date.md"]);
  assert.deepEqual(names("MEM_NAME_MISMATCH"), ["2026-01-06-other.md", "Bad Name.md"]);
  assert.deepEqual(names("MEM_SLUG_DUP"), ["2026-01-05-compiler-memory.md"]);
  assert.deepEqual(names("MEM_HOOK_LONG"), ["2026-01-06-long-hook.md"]);
  assert.deepEqual(by("MEM_LINK_DANGLING").map((f) => [f.path.split("/").at(-1), f.line, f.message]), [["2026-01-06-linked.md", 10, "[[nowhere]] names no memory"]]);
  assert.deepEqual(names("MEM_FILE_SIZE"), ["2026-01-06-big.md"]);
  assert.deepEqual(by("MEM_SHARED_CANDIDATE").map((f) => [f.level, f.path.split("/").at(-1)]), [["info", "2026-01-06-shared.md"]]);
  assert.deepEqual(names("STATUS_MULTI"), ["2026-01-09-project-status.md"]);
  assert.deepEqual(by("STATUS_DONE_SECTION").map((f) => [f.path.split("/").at(-1), f.line]), [["2026-01-06-second-status.md", 10]]);
  assert.ok(by("MEM_INDEX_STALE").length > 0);
  assert.ok(got.every((f) => f.level === "warning" || f.code === "MEM_SHARED_CANDIDATE"));
  assert.ok(by("MEM_FRONTMATTER").some((f) => f.message === 'type "note" is not one of: status, decision, learning, report, reference'));
  assert.ok(by("MEM_FRONTMATTER").some((f) => f.message === "`updated: 2025-12-01` and the file name's date 2026-01-06 differ (aw memory touch old-date)"));
});

test("agent-works memory: the budgets, and a status memory beyond three times its budget is critical", (t) => {
  const p = generated(t);
  const cfg = config.merge(config.defaults(), { budgets: { memoryFolderFiles: 1, statusLines: 10 } });
  const status = (body) => p.write(`${M}/project/2026-01-09-project-status.md`, mem("project-status", { type: "status", date: "2026-01-09", body }));
  status("x\n".repeat(12));
  let got = Object.fromEntries(found(p, cfg).map((f) => [f.code, f]));
  assert.equal(got.MEM_FOLDER_OVER.path, `${M}/tooling`);
  assert.equal(got.STATUS_SIZE.level, "warning");
  status("x\n".repeat(40));
  got = Object.fromEntries(found(p, cfg).map((f) => [f.code, f]));
  assert.equal(got.STATUS_SIZE.level, "critical"); // over three times the budget
  assert.equal("MEM_FILE_SIZE" in got, false);
});

test("agent-works memory: new starts a memory, its folder and their indexes", async (t) => {
  const p = generated(t);
  await p.aw("memory", "index");
  let [code, out, err] = await p.aw("memory", "new", "engine", "frame-pacing", "--type", "learning",
    "--description", "Why frames stutter under vsync and what fixed it", "--about", "Facts about the engine.");
  assert.deepEqual([code, err], [0, ""]);
  const rel = `${M}/engine/${TODAY}-frame-pacing.md`;
  assert.equal(out, `${rel}\n`);
  const [fields, body] = common.parseFrontmatter(p.read(rel));
  assert.deepEqual(fields, { name: "frame-pacing", description: "Why frames stutter under vsync and what fixed it", type: "learning", updated: TODAY });
  assert.ok(body.includes("# Frame pacing"));
  const engine = p.read(`${M}/engine/INDEX.md`);
  assert.deepEqual(lines(engine).slice(0, 4), ["# engine/", G, "", "Facts about the engine."]);
  assert.ok(engine.includes(`- [frame-pacing](${TODAY}-frame-pacing.md) — learning — Why frames stutter`));
  assert.ok(p.read(`${M}/INDEX.md`).includes("- [engine/](engine/INDEX.md) — Facts about the engine."));
  assert.deepEqual(codesOf(p), [["MEM_INDEX_PLACEHOLDER", `${M}/project/INDEX.md`]]); // the fixture's own folder without its line; not the new one
  // a new folder without --about: the placeholder is said at once, on stderr, and by the lint
  [code, out, err] = await p.aw("memory", "new", "render", "shadow-bias", "--type", "learning", "--description", "What the bias hides");
  assert.deepEqual([code, out], [0, `${M}/render/${TODAY}-shadow-bias.md\n`]);
  assert.ok(err.includes(`${M}/render/INDEX.md still says \`<one line: what belongs in this folder>\``));
  assert.ok(err.includes("--about"));
  assert.ok(codesOf(p).some(([c, where]) => c === "MEM_INDEX_PLACEHOLDER" && where === `${M}/render/INDEX.md`));
  [code, out, err] = await p.aw("memory", "new", "render", "shadow-cascade", "--type", "learning", "--description", "x", "--json");
  assert.equal(code, 0);
  assert.ok(err.includes("still says")); // until the line is written
  assert.deepEqual(Object.keys(JSON.parse(out)), ["path", "indexes"]); // and the JSON on stdout stays clean
  // a slug is unique across the tree; a project has one status memory; names are kebab-case; a type is one of five
  for (const args of [["other", "frame-pacing", "--type", "report"], ["project", "status-two", "--type", "status"], ["engine", "Bad_Slug", "--type", "report"],
    ["engine", "x", "--type", "essay"]]) {
    const [status, said, why] = await p.aw("memory", "new", ...args, "--description", "x");
    assert.deepEqual([status, said], [2, ""], args.join(" "));
    assert.ok(why.startsWith("aw memory"), why);
  }
  assert.equal((await p.aw("memory", "new", "engine", "y", "--type", "report"))[0], 2); // --description is required
  assert.equal((await p.aw("memory", "new", "engine", "--type", "report", "--description", "x"))[0], 2);
});

test("agent-works memory: the argument shape other plugins' skills name", async (t) => {
  const p = project(t, { config: {} });
  const [code, out] = await p.aw("memory", "new", "f", "s", "--type", "learning", "--description", "d");
  assert.deepEqual([code, out], [0, `${M}/f/${TODAY}-s.md\n`]);
  assert.equal(p.exists(`${M}/INDEX.md`), true);
});

test("agent-works memory: new regenerates only its folder's index", async (t) => {
  const p = generated(t);
  await p.aw("memory", "index");
  const before = staleProjectIndex(p);
  const root = bytes(p, `${M}/INDEX.md`);
  const [code, out] = await p.aw("memory", "new", "tooling", "linker-flags", "--type", "report", "--description", "What LTO cost", "--json");
  assert.deepEqual([code, JSON.parse(out).indexes], [0, [`${M}/tooling/INDEX.md`]]);
  assert.ok(p.read(`${M}/tooling/INDEX.md`).includes(`- [linker-flags](${TODAY}-linker-flags.md) — report — What LTO cost`));
  assert.equal(bytes(p, `${M}/project/INDEX.md`), before); // stale, and left so
  assert.equal(bytes(p, `${M}/INDEX.md`), root);
  assert.deepEqual(codesOf(p), [["MEM_INDEX_PLACEHOLDER", `${M}/project/INDEX.md`], ["MEM_INDEX_STALE", `${M}/project/INDEX.md`]]);
});

test("agent-works memory: touch renames the file and fixes the links to it", async (t) => {
  const p = generated(t);
  await p.aw("memory", "index");
  const before = staleProjectIndex(p);
  p.write("AGENTS.md", `# Root\r\n\r\nSee [the trap](${M}/tooling/2026-01-05-compiler-memory.md).\r\n`);
  p.write(`${M}/tooling/2026-01-07-why-ninja.md`,
    mem("why-ninja", { type: "decision", date: "2026-01-07", body: "Because of [[compiler-memory]] (2026-01-05-compiler-memory.md).\n" }));
  let [code, out, err] = await p.aw("memory", "touch", "compiler-memory", "--json");
  assert.deepEqual([code, err], [0, ""]);
  const doc = JSON.parse(out);
  const fresh = `${M}/tooling/${TODAY}-compiler-memory.md`;
  assert.deepEqual(Object.keys(doc), ["path", "renamedFrom", "renamedWith", "linksFixed", "indexes"]);
  assert.deepEqual([doc.path, doc.renamedFrom], [fresh, `${M}/tooling/2026-01-05-compiler-memory.md`]);
  assert.equal(doc.renamedWith, "rename"); // the project's .git is a stand-in: git does not know the file
  assert.deepEqual([...doc.linksFixed].sort(), [`${M}/tooling/2026-01-07-why-ninja.md`, "AGENTS.md"]);
  assert.deepEqual(doc.indexes, [`${M}/tooling/INDEX.md`]);
  assert.equal(p.exists(`${M}/tooling/2026-01-05-compiler-memory.md`), false);
  assert.equal(common.parseFrontmatter(p.read(fresh))[0].updated, TODAY);
  // a file whose link is fixed keeps its line endings
  assert.equal(p.read("AGENTS.md"), `# Root\r\n\r\nSee [the trap](${M}/tooling/${TODAY}-compiler-memory.md).\r\n`);
  assert.ok(p.read(`${M}/tooling/INDEX.md`).includes(`- [compiler-memory](${TODAY}-compiler-memory.md)`));
  assert.equal(bytes(p, `${M}/project/INDEX.md`), before); // no other folder's index
  assert.deepEqual(codesOf(p), [["MEM_INDEX_PLACEHOLDER", `${M}/project/INDEX.md`], ["MEM_INDEX_STALE", `${M}/project/INDEX.md`]]);
  assert.ok((await p.aw("memory", "touch", "compiler-memory"))[1].includes("already dated today"));
  [code, out, err] = await p.aw("memory", "touch", "no-such");
  assert.deepEqual([code, out, err], [2, "", "aw memory touch: no memory with the slug `no-such`\n"]);
  assert.equal((await p.aw("memory", "touch", "why-ninja", "--date", "soon"))[0], 2);
  [code, out] = await p.aw("memory", "touch", "why-ninja", "--date", "2026-02-01");
  assert.equal(p.exists(`${M}/tooling/2026-02-01-why-ninja.md`), true, out);
  assert.ok(out.includes("(was 2026-01-07-why-ninja.md; renamed without git: the file is not tracked, or git is absent)"), out);
});

test("agent-works memory: touch leaves a symlinked Markdown file a symlink", { skip: process.platform === "win32" && "a checkout there holds no symlink" }, async (t) => {
  const p = generated(t);
  await p.aw("memory", "index");
  p.write("AGENTS.md", `See ${M}/tooling/2026-01-05-compiler-memory.md.\n`);
  fs.symlinkSync("AGENTS.md", p.at("CLAUDE.md"));
  const [code, out] = await p.aw("memory", "touch", "compiler-memory", "--json");
  assert.deepEqual([code, JSON.parse(out).linksFixed], [0, ["AGENTS.md"]]);
  assert.ok(fs.lstatSync(p.at("CLAUDE.md")).isSymbolicLink());
  assert.ok(p.read("CLAUDE.md").includes(`${TODAY}-compiler-memory.md`));
});

test("agent-works memory: lint as JSON, a project without memory, and no action", async (t) => {
  const p = generated(t);
  p.write(`${M}/project/INDEX.md`, `# project/\n${G}\n\nThe living status.\n`);
  await p.aw("memory", "index");
  let [code, out] = await p.aw("memory", "lint", "--json");
  assert.deepEqual([code, JSON.parse(out)], [0, { summary: { critical: 0, warning: 0, info: 0 }, findings: [] }]);
  const bare = project(t);
  [code, out] = await bare.aw("memory", "lint");
  assert.deepEqual([code, out], [0, `aw memory: no ${M} here (aw setup --plan)\n`]);
  assert.deepEqual(JSON.parse((await bare.aw("memory", "lint", "--json"))[1]), { summary: { critical: 0, warning: 0, info: 0 }, findings: [] });
  assert.equal((await bare.aw("memory", "index"))[0], 0);
  assert.equal(bare.exists(".agents"), false);
  [code, out] = await p.aw("memory");
  assert.equal(code, 2);
  assert.ok(out.startsWith("usage: aw memory <lint|index|new|touch>"));
  assert.equal((await p.aw("memory", "forget"))[0], 2);
  assert.deepEqual((await p.aw("memory", "--help")).slice(0, 1), [0]);
  assert.equal((await p.aw("memory", "lint", "--nope"))[0], 2);
});

// ---- a tree whose indexes were written by hand: they say more than the descriptions, and no command may wipe that

const HAND = {
  [`${M}/INDEX.md`]: "# Memory index\r\n\r\nFolders by content. Start with `project/`.\r\n\r\n"
    + "- [project/](project/INDEX.md) — living status, and the plan we no longer follow\r\n"
    + "- [tooling/](tooling/INDEX.md) — traps of the build tools (ask before adding a compiler)\r\n",
  [`${M}/tooling/INDEX.md`]: "# tooling/\r\n\r\nTraps of the build tools. Parent: [../INDEX.md](../INDEX.md).\r\n\r\n"
    + "- [why-ninja](2026-01-07-why-ninja.md) — decision — make was 4× slower; **measured** on the big tree\r\n"
    + "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — the compiler needs 6 GB a job: "
    + "cap the jobs, see [why-ninja](2026-01-07-why-ninja.md)\r\n\r\nNotes below the list stay too.\r\n",
  [`${M}/project/INDEX.md`]: "# project/\n\n- [project-status](2026-01-09-project-status.md) — status — read this first", // no final newline
};

function byHand(t, { git = "stub", crlfMemory = true } = {}) {
  const p = project(t, { config: {}, git });
  for (const [rel, text] of Object.entries(HAND)) p.write(rel, text);
  p.write(`${M}/tooling/2026-01-05-compiler-memory.md`, crlfMemory ? mem("compiler-memory").replaceAll("\n", "\r\n") : mem("compiler-memory"));
  p.write(`${M}/tooling/2026-01-07-why-ninja.md`, mem("why-ninja", { type: "decision", date: "2026-01-07" }));
  p.write(`${M}/project/2026-01-09-project-status.md`, mem("project-status", { type: "status", date: "2026-01-09" }));
  return p;
}
const unchanged = (p, ...but) => Object.entries(HAND).every(([rel, text]) => but.includes(rel) || p.read(rel) === text);
const keepEnds = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

test("agent-works memory: touch replaces the file name in a hand-written index, and nothing else", async (t) => {
  const p = byHand(t);
  const [code, out, err] = await p.aw("memory", "touch", "compiler-memory", "--json");
  assert.deepEqual([code, err], [0, ""]);
  const index = `${M}/tooling/INDEX.md`;
  assert.deepEqual(JSON.parse(out).indexes, [index]);
  assert.equal(p.read(index), HAND[index].replaceAll("2026-01-05-compiler-memory.md", `${TODAY}-compiler-memory.md`));
  const [old, fresh] = [keepEnds(HAND[index]), keepEnds(p.read(index))];
  assert.deepEqual(old.map((line, i) => (line === fresh[i] ? null : i)).filter((i) => i !== null), [5]); // one line, and every other byte as it was
  assert.equal(old.length, fresh.length);
  assert.ok(unchanged(p, index));
  assert.equal(memory.indexKind(p.at(index)), "handwritten");
  // the memory itself keeps its line endings
  assert.equal(p.read(`${M}/tooling/${TODAY}-compiler-memory.md`), mem("compiler-memory", { date: TODAY }).replaceAll("\n", "\r\n"));
  // a second touch on the same day changes nothing at all
  const snapshot = Object.keys(HAND).map((rel) => p.read(rel));
  assert.deepEqual(JSON.parse((await p.aw("memory", "touch", "compiler-memory", "--json"))[1]).indexes, []);
  assert.deepEqual(Object.keys(HAND).map((rel) => p.read(rel)), snapshot);
});

test("agent-works memory: new appends one line to a hand-written index", async (t) => {
  const p = byHand(t);
  const [code, out, err] = await p.aw("memory", "new", "tooling", "linker-flags", "--type", "report", "--description", "What LTO cost", "--json");
  assert.deepEqual([code, err], [0, ""]);
  const index = `${M}/tooling/INDEX.md`;
  assert.deepEqual(JSON.parse(out).indexes, [index]);
  const old = keepEnds(HAND[index]);
  const line = `- [linker-flags](${TODAY}-linker-flags.md) — report — What LTO cost\r\n`; // the house format, the file's line endings
  assert.deepEqual(keepEnds(p.read(index)), [...old.slice(0, 6), line, ...old.slice(6)]); // after the last list line; the notes below it stay below
  assert.ok(unchanged(p, index));
  // an index without a final newline gets one before the new line
  assert.equal((await p.aw("memory", "new", "project", "the-plan", "--type", "reference", "--description", "The first plan"))[0], 0);
  assert.equal(p.read(`${M}/project/INDEX.md`), `${HAND[`${M}/project/INDEX.md`]}\n- [the-plan](${TODAY}-the-plan.md) — reference — The first plan\n`);
  assert.equal(p.read(`${M}/INDEX.md`), HAND[`${M}/INDEX.md`]);
});

test("agent-works memory: a new folder in a hand-written tree gets a hand-written index and one line in the root's", async (t) => {
  const p = byHand(t);
  const [code, out, err] = await p.aw("memory", "new", "engine", "frame-pacing", "--type", "learning", "--description", "Why frames stutter",
    "--about", "Facts about the engine.", "--json");
  assert.deepEqual([code, err], [0, ""]);
  assert.deepEqual(JSON.parse(out).indexes, [`${M}/engine/INDEX.md`, `${M}/INDEX.md`]);
  assert.equal(p.read(`${M}/INDEX.md`), `${HAND[`${M}/INDEX.md`]}- [engine/](engine/INDEX.md) — Facts about the engine.\r\n`);
  assert.equal(p.read(`${M}/engine/INDEX.md`), "# engine/\n\nFacts about the engine.\n\nParent: [../INDEX.md](../INDEX.md)\n\n"
    + `- [frame-pacing](${TODAY}-frame-pacing.md) — learning — Why frames stutter\n`);
  assert.equal(memory.indexKind(p.at(`${M}/engine/INDEX.md`)), "handwritten");
  assert.ok(unchanged(p, `${M}/INDEX.md`));
});

test("agent-works memory: index refuses a hand-written tree until it is told to adopt it", async (t) => {
  const p = byHand(t);
  let [code, out, err] = await p.aw("memory", "index");
  assert.deepEqual([code, out], [2, ""]);
  for (const part of ["3 indexes are written by hand; nothing was written", `${M}/tooling/INDEX.md  (3 lines would be lost)`, // two list lines and the notes
    `${M}/project/INDEX.md  (1 line would be lost)`, `${M}/INDEX.md  (2 lines would be lost)`, // the description line is kept
    "6 lines say something else today", "aw memory index --adopt", "(160 characters at most"]) assert.ok(err.includes(part), part);
  assert.ok(unchanged(p));
  [code, out] = await p.aw("memory", "index", "--json");
  const doc = JSON.parse(out);
  assert.deepEqual([code, doc.refused, doc.written], [2, true, []]);
  assert.deepEqual(doc.handwritten, [{ path: `${M}/INDEX.md`, linesLost: 2 }, { path: `${M}/project/INDEX.md`, linesLost: 1 }, { path: `${M}/tooling/INDEX.md`, linesLost: 3 }]);
  assert.ok(unchanged(p));
  [code, out, err] = await p.aw("memory", "index", "--adopt");
  assert.deepEqual([code, err], [0, ""]);
  assert.deepEqual(lines(out), [`adopted ${M}/INDEX.md`, `adopted ${M}/project/INDEX.md`, `adopted ${M}/tooling/INDEX.md`]);
  const tooling = lines(p.read(`${M}/tooling/INDEX.md`));
  // the description is kept without the parent link it carried; the generator writes that link on its own line
  assert.deepEqual(tooling.slice(0, 7), ["# tooling/", G, "", "Traps of the build tools.", "", "Parent: [../INDEX.md](../INDEX.md)", ""]);
  const rootIndex = p.read(`${M}/INDEX.md`);
  assert.ok(rootIndex.includes("- [tooling/](tooling/INDEX.md) — Traps of the build tools.\n"));
  assert.ok(!rootIndex.includes("Parent:"));
  assert.equal(tooling.at(-1), "- [compiler-memory](2026-01-05-compiler-memory.md) — learning — What is in it and when it matters");
  // the one index that had no description line of its own now says so
  assert.deepEqual(found(p).map((f) => [f.code, f.path]), [["MEM_INDEX_PLACEHOLDER", `${M}/project/INDEX.md`]]);
  assert.equal((await p.aw("memory", "index"))[1], "memory indexes are up to date\n"); // generated now: no flag needed
  [code, out] = await p.aw("memory", "index", "--json");
  assert.deepEqual([code, JSON.parse(out)], [0, { written: [], adopted: [] }]);
});

test("agent-works memory: index --check tells a hand-written index from a stale one", async (t) => {
  const p = byHand(t);
  let [code, out] = await p.aw("memory", "index", "--check", "--json");
  let doc = JSON.parse(out);
  assert.equal(code, 0); // information: a hand-written index is not a stale one
  assert.deepEqual(doc.findings.map((f) => [f.code, f.level, f.path]), [["MEM_INDEX_HANDWRITTEN", "info", `${M}/INDEX.md`],
    ["MEM_INDEX_HANDWRITTEN", "info", `${M}/project/INDEX.md`], ["MEM_INDEX_HANDWRITTEN", "info", `${M}/tooling/INDEX.md`]]);
  assert.ok(doc.findings[2].message.includes("3 lines would be lost"));
  // a missing index and a generated one that is out of date are stale; the hand-written ones stay information
  p.remove(`${M}/project/INDEX.md`);
  p.write(`${M}/tooling/INDEX.md`, `# tooling/\n${G}\n\nTraps.\n`);
  [code, out] = await p.aw("memory", "index", "--check", "--json");
  doc = JSON.parse(out);
  assert.equal(code, 1);
  assert.deepEqual(doc.findings.map((f) => [f.code, f.level, f.path]), [["MEM_INDEX_STALE", "warning", `${M}/project/INDEX.md`],
    ["MEM_INDEX_STALE", "warning", `${M}/tooling/INDEX.md`], ["MEM_INDEX_HANDWRITTEN", "info", `${M}/INDEX.md`]]);
  assert.ok(unchanged(p, `${M}/project/INDEX.md`, `${M}/tooling/INDEX.md`));
  // the marker counts on the first two lines only: a later mention of it does not make an index generated
  p.write(`${M}/tooling/INDEX.md`, `# tooling/\n\nTraps.\n\n${G}\n`);
  assert.equal(memory.indexKind(p.at(`${M}/tooling/INDEX.md`)), "handwritten");
});

test("agent-works memory: a memory git tracks is renamed with git mv, another plainly", { skip: !HAS_GIT && "needs git" }, async (t) => {
  const p = byHand(t, { git: "real", crlfMemory: false });
  p.git("add", "--", ".agents/agent-works.json", `${M}/INDEX.md`, `${M}/tooling`, `${M}/project/INDEX.md`);
  p.git("commit", "-q", "-m", "first");
  const [code, out, err] = await p.aw("memory", "touch", "compiler-memory");
  assert.deepEqual([code, err], [0, ""]);
  assert.ok(out.includes("(was 2026-01-05-compiler-memory.md; renamed with git mv)"), out);
  assert.ok(out.includes(`updated ${M}/tooling/INDEX.md`));
  const status = p.git("status", "--porcelain").split("\n");
  // staged as a rename (R), with the new date still to stage (M); the index edit is unstaged
  assert.ok(status.includes(`RM ${M}/tooling/2026-01-05-compiler-memory.md -> ${M}/tooling/${TODAY}-compiler-memory.md`), status.join("\n"));
  assert.ok(status.includes(` M ${M}/tooling/INDEX.md`));
  assert.equal(common.parseFrontmatter(p.read(`${M}/tooling/${TODAY}-compiler-memory.md`))[0].updated, TODAY);
  assert.ok(p.read(`${M}/tooling/INDEX.md`).includes(`](${TODAY}-compiler-memory.md)`));

  const doc = JSON.parse((await p.aw("memory", "touch", "project-status", "--json"))[1]);
  assert.equal(doc.renamedWith, "rename");
  assert.equal(p.exists(`${M}/project/${TODAY}-project-status.md`), true);
  assert.ok(p.read(`${M}/project/INDEX.md`).includes(`](${TODAY}-project-status.md)`));
});
