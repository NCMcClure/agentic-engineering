// agent-works scripts/decisions.mjs: records, the generated index, the glossary.
import assert from "node:assert/strict";
import { test } from "node:test";
import { common, config, project, script } from "./agent-works-homes.mjs";

const decisions = await script("decisions.mjs");
const D = ".agents/decisions/";

const record = (n, title) => `# ${n}. ${title}

## Status

accepted (2026-01-05)

## Sources

An issue.

## Context

Why.

## Decision

What.

## Consequences

Then.
`;
const REST = `\n${record("0", "x").slice(record("0", "x").indexOf("\n") + 1)}`; // a record below its heading
const BODY = "\n## Context\n\nWhy.\n\n## Decision\n\nWhat.\n\n## Consequences\n\nThen.\n";

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const codes = (p, cfg = null) => decisions.findings(p.root, cfg).map((f) => [f.code, f.path, f.line])
  .sort((a, b) => order(a[0], b[0]) || order(a[1], b[1]) || a[2] - b[2]);

test("agent-works decisions: new numbers the record and keeps the index", async (t) => {
  const p = project(t, { config: {} });
  let [code, out, err] = await p.aw("decisions", "new", "Use one wire format: little endian!");
  assert.deepEqual([code, err, out], [0, "", `${D}0001-use-one-wire-format-little-endian.md\n`]);
  const text = p.read(`${D}0001-use-one-wire-format-little-endian.md`);
  assert.ok(text.startsWith(`# 0001. Use one wire format: little endian!\n\n## Status\n\nproposed (${common.today()})\n`));
  for (const section of decisions.SECTIONS) assert.ok(text.includes(`## ${section}\n`), section);
  [code, out] = await p.aw("decisions", "new", "Second thing", "--slug", "second", "--status", "accepted", "--json");
  assert.deepEqual(JSON.parse(out), { path: `${D}0002-second.md`, number: "0002", index: `${D}README.md` });
  const index = p.read(`${D}README.md`);
  assert.ok(index.includes("- [0001 — Use one wire format: little endian!](0001-use-one-wire-format-little-endian.md) — proposed"));
  assert.ok(index.includes("- [0002 — Second thing](0002-second.md) — accepted"));
  assert.deepEqual(codes(p), []);
  assert.equal((await p.aw("decisions", "index", "--check"))[0], 0);
  [code, out, err] = await p.aw("decisions", "new", "Second", "--slug", "second");
  assert.deepEqual([code, out, err], [2, "", "aw decisions new: a record with the slug `second` exists\n"]);
  assert.equal((await p.aw("decisions", "new", "!!!"))[0], 2);
  assert.equal((await p.aw("decisions", "new"))[0], 2);
});

test("agent-works decisions: the argument shape other plugins' skills name", async (t) => {
  const p = project(t, { config: {} });
  assert.deepEqual((await p.aw("decisions", "new", "t")).slice(0, 2), [0, `${D}0001-t.md\n`]);
});

test("agent-works decisions: every lint code of a record", async (t) => {
  const p = project(t, { config: {} });
  const w = (name, text) => p.write(D + name, text);
  w("0001-first.md", record("0001", "First"));
  w("0002-short.md", "# 0002. Short\n\n## Status\n\naccepted\n\n## Decision\n\nYes.\n");
  w("0002-twice.md", record("0002", "Twice"));
  w("0004-wrong-heading.md", record("0007", "Wrong"));
  w("notes.md", record("0009", "No number in the name"));
  w("0005-amended.md", `${record("0005", "Amended")}\n## Amendment 2026-02-01\n\nA.\n\n## Amendment 2026-03-01\n\nB.\n`);
  w("0006-once.md", `${record("0006", "Once")}\n## Amendment 2026-02-01\n\nA.\n`);
  w("0008-long.md", record("0008", "Long") + "x\n".repeat(150));
  assert.deepEqual(codes(p), [["DEC_AMENDED", `${D}0005-amended.md`, 0], ["DEC_INDEX_STALE", `${D}README.md`, 0],
    ["DEC_NUMBER", `${D}0002-twice.md`, 0], ["DEC_NUMBER", `${D}0004-wrong-heading.md`, 1],
    ["DEC_NUMBER", `${D}notes.md`, 0], ["DEC_SECTIONS", `${D}0002-short.md`, 0], ["DEC_SIZE", `${D}0008-long.md`, 0]]);
  const found = decisions.findings(p.root);
  assert.equal(found.find((f) => f.code === "DEC_SECTIONS").message, "lacks the sections: Sources, Context, Consequences");
  assert.equal(found.find((f) => f.path.endsWith("0002-twice.md")).message, "the number 0002 is also 0002-short.md");
  assert.equal(found.find((f) => f.path.endsWith("0004-wrong-heading.md")).message, "the heading says 0007, the file name 0004");
  let [code, out] = await p.aw("decisions", "lint", "--json");
  assert.deepEqual([code, JSON.parse(out).summary.warning], [1, 7]);
  [code, out] = await p.aw("decisions", "lint");
  assert.ok(out.endsWith("decisions: 8 records: 7 warning\n"), out);
  assert.equal((await p.aw("decisions", "index"))[1], `wrote ${D}README.md\n`);
  assert.ok(!codes(p).some(([c]) => c === "DEC_INDEX_STALE"));
});

test("agent-works decisions: the folder is a setting", async (t) => {
  const p = project(t, { config: { paths: { decisions: "design/adr" } } });
  await p.aw("decisions", "new", "Elsewhere");
  assert.equal(p.exists("design/adr/0001-elsewhere.md"), true);
  assert.equal(p.exists("design/adr/README.md"), true);
});

test("agent-works decisions: the glossary: one home, a term once, a row within its budget", (t) => {
  const p = project(t, { config: {} });
  p.write(".agents/CONTEXT.md", `# Glossary\n\n| Term | Meaning |\n|---|---|\n| **stream** | Frames over the wire. |\n`
    + `| shot | One picture. |\n| \`Stream\` | Again. |\n| gate | ${"x".repeat(300)} |\n\n- **hub** — the daemon\n- **hub**: twice\n`
    + "```\n| stream | in a fence |\n```\n");
  const G = ".agents/CONTEXT.md";
  assert.deepEqual(codes(p), [["GLOSSARY_DUP_TERM", G, 7], ["GLOSSARY_DUP_TERM", G, 11], ["GLOSSARY_ROW_LONG", G, 8]]);
  assert.equal(decisions.findings(p.root).find((f) => f.line === 7).message, "`Stream` is defined on line 5 too");
  const roomy = config.merge(config.loadConfig(p.root), { budgets: { glossaryRowChars: 400 } });
  assert.ok(!codes(p, roomy).some(([c]) => c === "GLOSSARY_ROW_LONG"));
  p.write("docs/CONTEXT.md", "# Glossary\n\n| Term | Meaning |\n|---|---|\n| lap | Once round. |\n");
  const multi = decisions.findings(p.root).filter((f) => f.code === "GLOSSARY_MULTI");
  assert.deepEqual(multi.map((f) => [f.path, f.level]), [["docs/CONTEXT.md", "warning"]]);
  assert.ok(multi[0].message.includes(".agents/CONTEXT.md, docs/CONTEXT.md"));
});

test("agent-works decisions: Status and Sources are read in the ADR forms too", async (t) => {
  const p = project(t, { config: {} });
  const w = (name, text) => p.write(D + name, text);
  w("0001-heading.md", record("0001", "Heading"));
  w("0002-bullets.md", `# 0002. Bullets\n\n- **Status:** accepted\n- **Date:** 2026-02-03\n- **Sources:** [an issue](https://example.com/1)\n${BODY}`);
  w("0003-bold.md", `# 0003. Bold\n\n**Status:** superseded by 0004\n\n**Sources:** a talk\n${BODY}`);
  w("0004-plain.md", `# 0004. Plain\n\nStatus: accepted (2026-03-01)\nDate: 2026-03-01\nSource: the measurement\n${BODY}`);
  w("0005-colon-outside.md", `# 0005. Colon outside\n\n* __Status__: **proposed**\n* **Sources**: none\n${BODY}`);
  w("0006-frontmatter.md", `---\nstatus: rejected\ndate: 2026-04-05\nsources: an issue\n---\n\n# 0006. Frontmatter\n${BODY}`);
  w("0007-mixed.md", `# 0007. Mixed\n\n- **Status:** accepted\n\n## Sources\n\nAn issue.\n${BODY}`);
  // not the forms: a status line below the first section is prose, a fenced one is an example
  w("0008-prose.md", "# 0008. Prose\n\n```\nStatus: accepted\n```\n\n## Context\n\nStatus: unknown at the time.\nSources: none.\n"
    + "\n## Decision\n\nWhat.\n\n## Consequences\n\nThen.\n");
  w("0009-no-sources.md", `# 0009. No sources\n\n**Status:** accepted\n${BODY}`);
  const got = decisions.findings(p.root).filter((f) => f.code === "DEC_SECTIONS").map((f) => [f.path, f.message]);
  assert.deepEqual(got, [[`${D}0008-prose.md`, "lacks the sections: Status, Sources"], [`${D}0009-no-sources.md`, "lacks the section: Sources"]]);
  const status = Object.fromEntries(decisions.scan(p.root, config.loadConfig(p.root)).map((r) => [r.number, r.status]));
  assert.deepEqual(status, {
    "0001": "accepted (2026-01-05)", "0002": "accepted (2026-02-03)", "0003": "superseded by 0004", "0004": "accepted (2026-03-01)", "0005": "proposed",
    "0006": "rejected (2026-04-05)", "0007": "accepted", "0008": "", "0009": "accepted",
  });
  assert.equal((await p.aw("decisions", "index"))[0], 0);
  const index = p.read(`${D}README.md`);
  for (const line of ["- [0002 — Bullets](0002-bullets.md) — accepted (2026-02-03)\n", "- [0003 — Bold](0003-bold.md) — superseded by 0004\n",
    "- [0006 — Frontmatter](0006-frontmatter.md) — rejected (2026-04-05)\n", "- [0008 — Prose](0008-prose.md)\n"]) assert.ok(index.includes(line), line);
  // linting rewrote nobody's record
  assert.equal(p.read(`${D}0002-bullets.md`).split("\n")[2], "- **Status:** accepted");
});

const HAND = "# Architecture decisions\n\nRead 0001 before touching the wire.\n\n| No | What | Why it matters |\n|---|---|---|\n| 0001 | First | the wire |\n";

test("agent-works decisions: a hand-written index is kept until it is adopted by name", async (t) => {
  const p = project(t, { config: {} });
  p.write(`${D}0001-first.md`, record("0001", "First"));
  p.write(`${D}README.md`, HAND);
  assert.equal(decisions.indexKind(p.at(`${D}README.md`)), "handwritten");
  const found = decisions.findings(p.root);
  assert.deepEqual(found.map((f) => [f.code, f.level, f.path]), [["DEC_INDEX_HANDWRITTEN", "info", `${D}README.md`]]);
  assert.ok(found[0].message.includes("5 lines would be lost"));
  assert.ok(found[0].message.includes("--adopt"));
  assert.equal((await p.aw("decisions", "lint"))[0], 0); // information, not a failure
  assert.equal((await p.aw("decisions", "index", "--check"))[0], 0);
  // index refuses, says why and names the way
  let [code, out, err] = await p.aw("decisions", "index");
  assert.deepEqual([code, out], [2, ""]);
  assert.ok(err.startsWith(`aw decisions index: ${D}README.md is written by hand; nothing was written.\n`), err);
  assert.ok(err.includes("5 lines say something else today"));
  assert.ok(err.includes("aw decisions index --adopt"));
  assert.equal(p.read(`${D}README.md`), HAND);
  [code, out] = await p.aw("decisions", "index", "--json");
  assert.deepEqual([code, JSON.parse(out)], [2, { refused: true, handwritten: [{ path: `${D}README.md`, linesLost: 5 }], written: [] }]);
  // a new record adds its one line and leaves the rest
  [code, out] = await p.aw("decisions", "new", "Second thing", "--json");
  assert.equal(JSON.parse(out).index, `${D}README.md`);
  assert.equal(p.read(`${D}README.md`), `${HAND}\n- [0002 — Second thing](0002-second-thing.md) — proposed (${common.today()})\n`);
  // setup never writes over it
  const before = p.read(`${D}README.md`);
  assert.equal((await p.aw("setup", "--apply"))[0], 0);
  assert.equal(p.read(`${D}README.md`), before);
  // adopting is asked for by name
  [code, out] = await p.aw("decisions", "index", "--adopt");
  assert.deepEqual([code, out], [0, `adopted ${D}README.md\n`]);
  const text = p.read(`${D}README.md`);
  assert.ok(text.split("\n").slice(0, decisions.MARKER_WITHIN).includes(decisions.GENERATED));
  assert.ok(!text.includes("Architecture decisions"));
  assert.equal(decisions.indexKind(p.at(`${D}README.md`)), "generated");
  assert.deepEqual(codes(p), []);
  assert.equal((await p.aw("decisions", "index"))[1], "the decision index is up to date\n");
  assert.deepEqual(JSON.parse((await p.aw("decisions", "index", "--json"))[1]), { written: [], adopted: [] });
});

test("agent-works decisions: a generated index is rewritten, and so is the stub setup once wrote", async (t) => {
  const p = project(t, { config: {} });
  await p.aw("decisions", "new", "First");
  p.write(`${D}0002-second.md`, record("0002", "Second"));
  assert.deepEqual(codes(p).map(([c]) => c), ["DEC_INDEX_STALE"]);
  assert.equal((await p.aw("decisions", "index", "--check"))[0], 1);
  assert.equal((await p.aw("decisions", "index"))[1], `wrote ${D}README.md\n`);
  assert.deepEqual(codes(p), []);
  for (const stub of [decisions.STUB_0_1_2, decisions.buildIndex([])]) {
    p.write(`${D}README.md`, stub);
    assert.equal(decisions.indexKind(p.at(`${D}README.md`)), "generated");
    assert.equal((await p.aw("decisions", "index"))[0], 0);
    assert.ok(p.read(`${D}README.md`).includes("- [0002 — Second](0002-second.md)"));
  }
  assert.ok(decisions.buildIndex([]).includes(decisions.GENERATED));
  assert.ok(decisions.buildIndex([]).includes("No records yet"));
});

test("agent-works decisions: new follows the title form of the folder", async (t) => {
  const forms = {
    "# {n}. {t}": "# 0004. Next one", "# ADR {n}: {t}": "# ADR 0004: Next one", "# {n}: {t}": "# 0004: Next one", "# {n} - {t}": "# 0004 - Next one",
    "# ADR-{n}: {t}": "# ADR-0004: Next one", "# ADR {n} - {t}": "# ADR 0004 - Next one", "# {n} — {t}": "# 0004 — Next one",
  };
  for (const [form, want] of Object.entries(forms)) {
    const p = project(t, { config: {} });
    for (const [n, title] of [["0001", "First"], ["0002", "Second"], ["0003", "Third"]]) {
      p.write(`${D}${n}-${title.toLowerCase()}.md`, form.replace("{n}", n).replace("{t}", title) + REST);
    }
    const [code, , err] = await p.aw("decisions", "new", "Next one");
    assert.deepEqual([form, code, err], [form, 0, ""]);
    assert.equal(p.read(`${D}0004-next-one.md`).split("\n")[0], want, form);
    assert.deepEqual(decisions.findings(p.root).filter((f) => ["DEC_NUMBER", "DEC_SECTIONS"].includes(f.code)), [], form); // every form is read
    assert.ok(p.read(`${D}README.md`).includes("- [0004 — Next one](0004-next-one.md)"), form);
  }
});

test("agent-works decisions: new takes the majority of the last records, and its own form in an empty folder", async (t) => {
  const p = project(t, { config: {} });
  await p.aw("decisions", "new", "Alone");
  assert.equal(p.read(`${D}0001-alone.md`).split("\n")[0], "# 0001. Alone");
  const pad = (n) => String(n).padStart(4, "0");
  for (let n = 2; n < 8; n++) p.write(`${D}${pad(n)}-r${n}.md`, `# ADR ${pad(n)}: R${n}${REST}`); // six records in the ADR form, then one in another
  p.write(`${D}0008-r8.md`, `# 0008 - R8${REST}`);
  p.write(`${D}0009-untitled.md`, "Just prose, no heading.\n");
  await p.aw("decisions", "new", "After");
  assert.equal(p.read(`${D}0010-after.md`).split("\n")[0], "# ADR 0010: After");
  // short numbers are followed in their width
  const q = project(t, { config: {} });
  for (const n of [1, 2, 3]) q.write(`${D}${pad(n)}-r${n}.md`, `# ADR ${n}: R${n}${REST}`);
  await q.aw("decisions", "new", "After");
  assert.equal(q.read(`${D}0004-after.md`).split("\n")[0], "# ADR 4: After");
});

test("agent-works decisions: a project without records is clean, and nothing is written for it", async (t) => {
  const p = project(t, { config: {} });
  assert.deepEqual(codes(p), []);
  assert.deepEqual(await p.aw("decisions", "lint"), [0, "decisions: 0 records: clean\n", ""]);
  assert.deepEqual(JSON.parse((await p.aw("decisions", "lint", "--json"))[1]), { summary: { critical: 0, warning: 0, info: 0 }, findings: [] });
  assert.equal((await p.aw("decisions", "index"))[0], 0);
  assert.equal(p.exists(".agents/decisions"), false);
  const [code, out] = await p.aw("decisions");
  assert.equal(code, 2);
  assert.ok(out.startsWith("usage: aw decisions <new|index|lint>"));
});
