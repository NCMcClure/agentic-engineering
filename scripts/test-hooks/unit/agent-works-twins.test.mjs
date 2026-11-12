// agent-works scripts/twins.mjs: the CLAUDE.md beside every AGENTS.md, as a
// symlink or as the one-line file, written, checked and healed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { common, config, project, script } from "./agent-works-homes.mjs";

const twins = await script("twins.mjs");
const WINDOWS = process.platform === "win32";
const NO_LINKS = { skip: WINDOWS && "a checkout there holds no symlink" };

/** A project with three hubs and one that is not ours, under the given `claude.twins` (none: the config does not say). */
function hubs(t, mode) {
  const p = project(t, { config: mode ? { claude: { twins: mode } } : {} });
  p.write("AGENTS.md", "# Root\n");
  p.write("apps/AGENTS.md", "# apps\n");
  p.write("apps/web/AGENTS.md", "# web\n");
  p.write("node_modules/pkg/AGENTS.md", "# not ours\n");
  return p;
}
const OURS = ["CLAUDE.md", "apps/CLAUDE.md", "apps/web/CLAUDE.md"];
const isLink = (file) => fs.lstatSync(file).isSymbolicLink();

test("agent-works twins: without a config it does nothing, in one line", async (t) => {
  const p = project(t);
  p.write("AGENTS.md", "# Root\n");
  const [code, out] = await p.aw("twins");
  assert.equal(code, 0);
  assert.equal(out, "aw twins: no .agents/agent-works.json here, nothing to do (aw setup --plan)\n");
  assert.equal(p.exists("CLAUDE.md"), false);
  const [, json] = await p.aw("twins", "--check", "--json");
  assert.deepEqual(JSON.parse(json), { mode: null, written: [], summary: { critical: 0, warning: 0, info: 0 }, findings: [] });
});

test("agent-works twins: the mode is claude.twins of the file, and a config that does not say is link", (t) => {
  const p = project(t, { config: {} });
  const mode = () => twins.modeOf(config.loadConfig(p.root));
  assert.equal(mode(), "link");
  for (const [written, read] of [["generated", "generated"], ["committed", "committed"], ["off", "off"], ["link", "link"], ["symlink", "link"], ["Generated", "generated"]]) {
    p.write(".agents/agent-works.json", JSON.stringify({ claude: { twins: written } }));
    assert.equal(mode(), read, written);
  }
  assert.equal(twins.modeOf(config.defaults()), "link");
  assert.equal(twins.modeOf(config.merge(config.defaults(), { claude: { twins: "committed" } })), "committed");
  assert.deepEqual([twins.formOf("link", "linux"), twins.formOf("link", "win32"), twins.formOf("generated", "linux"), twins.formOf("committed", "darwin")],
    ["link", "stub", "stub", "stub"]);
  assert.deepEqual(twins.MODES, ["link", "generated", "committed"]);
});

test("agent-works twins: by default a twin is a symlink to its sibling, written once", NO_LINKS, async (t) => {
  const p = hubs(t);
  const [code, out] = await p.aw("twins");
  assert.equal(code, 0, out);
  assert.equal(out, "wrote CLAUDE.md\nwrote apps/CLAUDE.md\nwrote apps/web/CLAUDE.md\ntwins (link, 3 written): clean\n");
  for (const rel of OURS) {
    assert.ok(isLink(p.at(rel)), rel);
    assert.equal(fs.readlinkSync(p.at(rel)), "AGENTS.md");
  }
  assert.equal(p.read("apps/CLAUDE.md"), "# apps\n");
  assert.equal(p.exists("node_modules/pkg/CLAUDE.md"), false);
  fs.rmSync(p.at("apps/CLAUDE.md"));
  const res = twins.heal(p.root);
  assert.deepEqual([res.mode, res.written, res.root_created], ["link", ["apps/CLAUDE.md"], false]);
  assert.deepEqual(twins.heal(p.root).written, []);
  assert.equal((await p.aw("twins", "--check"))[0], 0);
});

test("agent-works twins: on Windows, and where a symlink is refused, the default writes the one-line file", (t) => {
  const p = hubs(t);
  const res = twins.heal(p.root, null, { platform: "win32" });
  assert.deepEqual([res.mode, res.written, res.root_created], ["link", OURS, true]);
  for (const rel of OURS) assert.equal(fs.readFileSync(p.at(rel), "utf8"), "@AGENTS.md\n");
  assert.deepEqual(twins.heal(p.root).written, []); // a one-line file that is there is a twin in every mode
});

test("agent-works twins: generated mode writes one-line files, heals them and is idempotent", async (t) => {
  const p = hubs(t, "generated");
  const [code, out] = await p.aw("twins");
  assert.equal(code, 0, out);
  for (const rel of OURS) assert.deepEqual(fs.readFileSync(p.at(rel)), Buffer.from("@AGENTS.md\n"));
  assert.equal(p.exists("node_modules/pkg/CLAUDE.md"), false);
  fs.rmSync(p.at("apps/CLAUDE.md"));
  const res = twins.heal(p.root);
  assert.deepEqual([res.written, res.root_created], [["apps/CLAUDE.md"], false]);
  assert.deepEqual(twins.heal(p.root).written, []);
});

test("agent-works twins: --check writes nothing and says what is missing", async (t) => {
  for (const mode of [null, "generated"]) {
    const p = hubs(t, mode);
    const [code, out] = await p.aw("twins", "--check", "--json");
    const doc = JSON.parse(out);
    assert.equal(code, 1);
    assert.deepEqual(Object.keys(doc), ["mode", "written", "removed", "summary", "findings"]);
    assert.equal(doc.mode, mode ?? "link");
    assert.deepEqual(doc.findings.map((f) => [f.code, f.path, f.message]), OURS.map((rel) => ["GEN_TWIN_MISSING", rel, "is missing (run `aw twins`)"]));
    assert.equal(p.exists("CLAUDE.md"), false);
    await p.aw("twins");
    const [again, text] = await p.aw("twins", "--check");
    assert.deepEqual([again, text], [0, `twins (${mode ?? "link"}, checked): clean\n`]);
  }
});

test("agent-works twins: a CLAUDE.md with content of its own is never overwritten", async (t) => {
  for (const mode of [null, "generated", "committed"]) {
    const p = hubs(t, mode);
    p.write("apps/CLAUDE.md", "My own notes.\n");
    const [code, out] = await p.aw("twins");
    assert.equal(code, 1);
    assert.ok(out.includes("content of its own"), out);
    assert.equal(p.read("apps/CLAUDE.md"), "My own notes.\n");
    assert.equal(p.exists("CLAUDE.md"), true);
  }
});

test("agent-works twins: a twin whose AGENTS.md is gone is removed where twins are generated, and reported elsewhere", async (t) => {
  const p = hubs(t, "generated");
  p.write("gone/CLAUDE.md", "@AGENTS.md\n");
  p.write("mine/CLAUDE.md", "Hand-written, no AGENTS.md beside it.\n");
  const found = twins.findings(p.root).map((f) => [f.code, f.path]);
  assert.ok(found.some(([code, where]) => code === "GEN_TWIN_ORPHAN" && where === "gone/CLAUDE.md"));
  assert.ok(!found.some(([, where]) => where === "mine/CLAUDE.md"));
  assert.equal(p.exists("gone/CLAUDE.md"), true); // the check wrote nothing
  assert.deepEqual(twins.heal(p.root, null, { orphans: false }).removed, []);
  assert.deepEqual(twins.heal(p.root).removed, ["gone/CLAUDE.md"]);
  assert.equal(p.exists("mine/CLAUDE.md"), true);

  for (const mode of [null, "committed"]) {
    const q = hubs(t, mode);
    q.write("gone/CLAUDE.md", "@AGENTS.md\n");
    const [code, out] = await q.aw("twins");
    assert.equal(code, 1); // tracked: an orphan is reported, not deleted
    assert.ok(out.includes("GEN_TWIN_ORPHAN"), out);
    assert.equal(q.exists("CLAUDE.md"), true);
    assert.equal(q.exists("gone/CLAUDE.md"), true);
  }
});

test("agent-works twins: a dangling symlink to AGENTS.md is an orphan too", NO_LINKS, (t) => {
  const p = hubs(t, "generated");
  fs.mkdirSync(p.at("gone"));
  fs.symlinkSync("AGENTS.md", p.at("gone/CLAUDE.md"));
  assert.deepEqual(twins.findings(p.root).filter((f) => f.code === "GEN_TWIN_ORPHAN").map((f) => f.path), ["gone/CLAUDE.md"]);
  assert.deepEqual(twins.heal(p.root).removed, ["gone/CLAUDE.md"]);
});

test("agent-works twins: off, and any value that is no mode, write nothing", async (t) => {
  for (const mode of ["off", "sometimes"]) {
    const p = hubs(t, mode);
    const [code, out] = await p.aw("twins");
    assert.deepEqual([code, out], [0, `aw twins: claude.twins is "${mode}", nothing to do\n`]);
    assert.equal(p.exists("CLAUDE.md"), false);
    const [, json] = await p.aw("twins", "--json");
    assert.deepEqual(JSON.parse(json), { mode, written: [], summary: { critical: 0, warning: 0, info: 0 }, findings: [] });
    assert.deepEqual(twins.heal(p.root), { mode, written: [], removed: [], findings: [], root_created: false });
  }
});

test("agent-works twins: what stands at a path, and the probe for a repository that is set up", NO_LINKS, (t) => {
  const p = project(t, { config: {} });
  p.write("a/AGENTS.md", "# a\n");
  p.write("a/CLAUDE.md", "  @AGENTS.md  \n");
  p.write("b/CLAUDE.md", "AGENTS.md"); // a link a checkout wrote as a file
  p.write("c/CLAUDE.md", "words\n");
  fs.mkdirSync(p.at("d"));
  fs.symlinkSync("./AGENTS.md", p.at("d/CLAUDE.md"));
  fs.mkdirSync(p.at("e"));
  fs.symlinkSync("../a/AGENTS.md", p.at("e/CLAUDE.md"));
  assert.deepEqual(["a", "b", "c", "d", "e", "f"].map((dir) => twins.stateOf(p.at(`${dir}/CLAUDE.md`))), ["stub", "link", "other", "link", "other", "none"]);
  assert.equal(twins.setUpRoot(p.at("a")), p.root);
  assert.equal(twins.setUpRoot(p.tmp), null);
  assert.equal(common.rel(twins.setUpRoot(p.root), p.root), ".");
});

test("agent-works twins: in a git repository the hubs are the ones git would commit", async (t) => {
  const p = project(t, { config: { claude: { twins: "committed" } }, git: "real" });
  p.write(".gitignore", "scratch/\n");
  p.write("AGENTS.md", "# Root\n");
  p.write("src/AGENTS.md", "# src\n");
  p.write("scratch/AGENTS.md", "# ignored\n");
  const [code, out] = await p.aw("twins", "--json");
  assert.deepEqual([code, JSON.parse(out).written], [0, ["CLAUDE.md", "src/CLAUDE.md"]]);
  assert.equal(p.exists("scratch/CLAUDE.md"), false);
});
