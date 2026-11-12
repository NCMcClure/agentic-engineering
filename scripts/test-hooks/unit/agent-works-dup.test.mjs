// agent-works scripts/dup.mjs: a rule stated in more than one place.
import assert from "node:assert/strict";
import { test } from "node:test";
import { config, project, script } from "./agent-works-homes.mjs";

const dup = await script("dup.mjs");

const RULE = "Never start the simulator from an agent shell: it runs in the service session and once logged the owner out of "
  + "the store, so every launch goes through the session runner script.";
const decision = (slug, body) => `---\nname: ${slug}\ndescription: d\ntype: decision\nupdated: 2026-01-05\n---\n\n# ${slug}\n\n${body}\n`;

function tree(t) {
  const p = project(t, { config: {} });
  p.write("AGENTS.md", `# Root\n\n## Rules\n\n1. **Session.** ${RULE}\n2. Something only said here, once, in the root file.\n`);
  p.write("tools/AGENTS.md", "# tools\n\n- `session/` — the runner.\n");
  return p;
}
const found = (p, options) => dup.findings(p.root, null, options);
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

test("agent-works dup: one copy is clean", async (t) => {
  const p = tree(t);
  assert.deepEqual(found(p), []);
  assert.deepEqual(await p.aw("dup"), [0, "dup: 2 rule surfaces: clean\n", ""]);
});

test("agent-works dup: the same rule in a hub, a brief and a decision memory", async (t) => {
  const p = tree(t);
  p.write("tools/AGENTS.md", "# tools\n\n- `session/` — the runner.\n\nRemember: *never start the simulator* from an agent shell: it runs\n"
    + "in the service session and once logged the owner out of the store, so every launch goes through the\nsession runner script!\n");
  p.write(".agents/briefs/common.md", `# Brief\n\n${RULE}\n`);
  p.write(".agents/memory/safety/2026-01-05-session-zero.md", decision("session-zero", RULE));
  p.write(".agents/memory/safety/2026-01-05-a-learning.md", decision("a-learning", RULE).replace("type: decision", "type: learning"));
  p.write("docs/guide.md", RULE); // user docs are not a rule surface
  const got = found(p).map((f) => [f.path, f.line, f.message.split(': "')[0]]).sort((a, b) => order(a[0], b[0]) || a[1] - b[1] || order(a[2], b[2]));
  assert.deepEqual(got.map(([where, line]) => [where, line]), [
    [".agents/briefs/common.md", 3], ["AGENTS.md", 5], ["AGENTS.md", 5], ["AGENTS.md", 5], ["tools/AGENTS.md", 5], ["tools/AGENTS.md", 5]]);
  assert.deepEqual(got.filter(([where]) => where === "AGENTS.md").map(([, , said]) => said.split(" words also in ")[1]),
    [".agents/briefs/common.md:3", ".agents/memory/safety/2026-01-05-session-zero.md:10", "tools/AGENTS.md:5"]);
  assert.ok(found(p).every((f) => f.code === "DUP_RULE" && f.level === "warning"));
  assert.ok(found(p)[0].message.endsWith('…" (keep one copy, link to it from the other)'));
  const [code, out] = await p.aw("dup", "--json");
  const doc = JSON.parse(out);
  assert.deepEqual([code, doc.summary.warning, doc.surfaces], [1, 6, 4]);
  assert.deepEqual(Object.keys(doc), ["surfaces", "summary", "findings"]);
});

test("agent-works dup: markup, case and wrapping do not hide a copy; code and short runs do", (t) => {
  const p = tree(t);
  p.write("tools/AGENTS.md", `# tools\n\n\`\`\`\n${RULE}\n\`\`\`\n\nNever start the simulator from an agent shell.\n`);
  assert.deepEqual(found(p), []);
  assert.equal(found(p, { minWords: 7 }).length, 0); // a run shorter than a shingle is never seen
  const cfg = config.merge(config.loadConfig(p.root), { dup: { shingleWords: 6, minWords: 7 } });
  assert.equal(dup.findings(p.root, cfg).length, 1);
});

test("agent-works dup: the threshold and the lines to skip are settings", async (t) => {
  const p = tree(t);
  const partial = RULE.split(/\s+/).slice(0, 13).join(" ");
  p.write("tools/AGENTS.md", `# tools\n\n${partial} and that is all.\n`);
  assert.deepEqual(found(p), []); // 13 shared words, the default asks for 14
  assert.equal(found(p, { minWords: 12 }).length, 1);
  const [code, out] = await p.aw("dup", "--min-words", "12");
  assert.equal(code, 1);
  assert.ok(out.includes("13 words also in tools/AGENTS.md:3"), out);
  assert.equal((await p.aw("dup", "--min-words", "many"))[0], 2);
  p.write(".agents/agent-works.json", JSON.stringify({ dup: { minWords: 12, ignore: ["(unclosed"] } }));
  assert.equal(dup.findings(p.root).length, 1); // an expression that does not compile is passed over
  p.write(".agents/agent-works.json", JSON.stringify({ dup: { minWords: 12, ignore: ["(unclosed", "^Never start"] } }));
  assert.deepEqual(dup.findings(p.root), []);
});

test("agent-works dup: explicit files are compared instead of the rule surfaces", async (t) => {
  const p = tree(t);
  p.write("a.md", RULE);
  p.write("b.md", `Intro.\n\n${RULE}`);
  const got = found(p, { paths: ["a.md", "b.md"] });
  assert.deepEqual(got.map((f) => [f.path, f.line]), [["a.md", 1]]);
  assert.ok(got[0].message.includes("b.md:3"));
  const [code, out] = await p.aw("dup", "a.md", "b.md", "--json");
  assert.deepEqual([code, JSON.parse(out).surfaces], [1, 2]);
});

test("agent-works dup: runs two word lists share, the longest once", () => {
  const words = (text) => text.split(" ").map((w) => [w, 1]);
  const a = words("one two three four five six seven eight");
  const b = words("zero one two three four five six nine one two three four");
  assert.deepEqual(dup.runsBetween(a, b, 4), [[0, 1, 6]]); // the repeat inside the longer run is not a second report
  assert.deepEqual(dup.runsBetween(a, b.slice(0, 3), 4), []);
  assert.deepEqual(dup.wordsOf("---\ntype: x\n---\n# Don’t *stop*\n<!-- a note -->\n[see](there/it.md) Now\n"),
    [["don’t", 4], ["stop", 4], ["see", 6], ["now", 6]]);
});
