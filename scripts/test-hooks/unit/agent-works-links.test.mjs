// agent-works scripts/links.mjs: relative links and repository paths written in code.
import assert from "node:assert/strict";
import { test } from "node:test";
import { project, script } from "./agent-works-homes.mjs";

const links = await script("links.mjs");

function tree(t) {
  const p = project(t, { config: {} });
  p.write("src/app/cli.ts", "x");
  p.write("src/app/util.ts", "x");
  p.write("tools/run.sh", "x");
  p.write("docs/guide.md", "user docs\n");
  p.write(".agents/contracts/protocol.md", "# Protocol\n");
  return p;
}
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function found(p, targets = null) {
  const res = links.findings(p.root, null, targets);
  const rows = res.findings.map((f) => [f.code, f.path, f.line, f.message]).sort((a, b) => order(a[0], b[0]) || order(a[1], b[1]) || a[2] - b[2] || order(a[3], b[3]));
  return [res, rows];
}
const BAD = "[x](nowhere.md) and `src/none.ts`\n";

test("agent-works links: links, anchors, globs, braces and placeholders that hold are clean", (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "# Root\n\nSee [the protocol](.agents/contracts/protocol.md#frames), [docs](docs/), <https://example.com> and\n"
    + "[the web](https://example.com/a) or [an anchor](#top). Run `tools/run.sh --fast` on `src/app/cli.ts`.\n"
    + "Every `src/app/*.ts`, `src/{app,lib}/cli.ts`, `src/app/<name>.ts` and `tools/…`.\n\n"
    + "```bash\nbash tools/run.sh src/app/cli.ts\n```\n");
  const [res, rows] = found(p);
  assert.deepEqual(rows, []);
  assert.deepEqual([res.files, res.links, res.paths], [2, 2, 8]);
});

test("agent-works links: a broken link and a missing path, with the line", async (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "# Root\n\n[gone](docs/missing.md) and [ok](docs/guide.md) and `[not a link](in/code.md)`.\n"
    + "Run `tools/gone.sh` and `src/app/nope/*.ts` and `src/lib/<name>.ts`, not `other/thing.ts`.\n"
    + "```\n[fenced](no/link.md) tools/absent.py\n```\n");
  p.write("src/AGENTS.md", "# src\n\n[up](../AGENTS.md) [bad](app/none.ts) [rooted](/tools/run.sh) [spaced](<../docs/guide.md>)\n");
  assert.deepEqual(found(p)[1], [
    ["LINK_BROKEN", "AGENTS.md", 3, "broken link: docs/missing.md"],
    ["LINK_BROKEN", "src/AGENTS.md", 3, "broken link: app/none.ts"],
    ["PATH_MISSING", "AGENTS.md", 4, "no such path: src/app/nope/*.ts"],
    ["PATH_MISSING", "AGENTS.md", 4, "no such path: src/lib/<name>.ts"],
    ["PATH_MISSING", "AGENTS.md", 4, "no such path: tools/gone.sh"],
    ["PATH_MISSING", "AGENTS.md", 6, "no such path: tools/absent.py"],
  ]);
  let [code, out] = await p.aw("links", "--json");
  const doc = JSON.parse(out);
  assert.deepEqual([code, doc.summary.warning, doc.files], [1, 6, 3]);
  assert.deepEqual(Object.keys(doc), ["files", "links", "paths", "summary", "findings"]);
  [code, out] = await p.aw("links");
  assert.ok(out.endsWith("links: 3 files, 6 relative links, 4 paths in code: 6 warning\n"), out);
});

test("agent-works links: a glob must match something, and a hidden name only a pattern that names the dot", (t) => {
  const p = tree(t);
  p.write("src/.hidden/x.ts", "x");
  p.write("src/deep/er/still/y.ts", "x");
  p.write("AGENTS.md", "`src/**/y.ts` `src/*/x.ts` `src/.h*/x.ts` `src/app/[cu]*.ts` `src/app/[!cu]*.ts` `src/**/z.ts` `src/app/cl?.ts` `src/{deep,nope}/er`\n");
  assert.deepEqual(found(p)[1].map((row) => row[3]), ["no such path: src/**/z.ts", "no such path: src/*/x.ts", "no such path: src/app/[!cu]*.ts",
    "no such path: src/app/cl?.ts"]); // a `?` alone makes no glob: the name is taken as written
});

test("agent-works links: planned paths and paths never checked are settings", (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "`src/next/thing.ts` is planned; `tools/out/bin` is build output; [later](src/next/README.md).\n");
  assert.equal(found(p)[1].length, 3);
  p.write(".agents/agent-works.json", JSON.stringify({ links: { planned: ["src/next"], notChecked: ["tools/out/"] } }));
  assert.deepEqual(found(p)[1], []);
});

test("agent-works links: the roots whose paths are checked are a setting", (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "`src/none.ts` and `tools/none.sh`\n");
  assert.equal(found(p)[1].length, 2);
  p.write(".agents/agent-works.json", JSON.stringify({ links: { roots: ["tools"] } }));
  assert.deepEqual(found(p)[1].map((row) => row[3]), ["no such path: tools/none.sh"]);
});

test("agent-works links: more files to read are a setting", async (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "# Root\n");
  p.write("README.md", BAD);
  p.write("docs/guide.md", BAD);
  p.write("docs/more/deep.md", BAD);
  assert.deepEqual(found(p)[1], []); // the default: neither is an agent file
  p.write(".agents/agent-works.json", JSON.stringify({ links: { files: ["README.md", "AGENTS.md", "no/such.md"] } }));
  const [res, rows] = found(p);
  assert.deepEqual(rows.map(([code, where]) => [code, where]), [["LINK_BROKEN", "README.md"], ["PATH_MISSING", "README.md"]]);
  assert.equal(res.files, 3); // AGENTS.md once, the missing one skipped
  p.write(".agents/agent-works.json", JSON.stringify({ links: { files: ["README.md", "docs"] } }));
  assert.deepEqual([...new Set(found(p)[1].map((row) => row[1]))].sort(), ["README.md", "docs/guide.md", "docs/more/deep.md"]);
  assert.equal((await p.aw("links"))[0], 1);
});

test("agent-works links: what is read by default and what is not", async (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "# Root\n");
  p.write(".agents/memory/tooling/2026-01-05-old.md", BAD); // links yes, paths no: memory is dated
  p.write(".agents/README.md", BAD); // the generated page: links yes, paths no
  p.write(".agents/decisions/0001-x.md", BAD); // both
  p.write(".agents/kanban/0001-card.md", BAD); // not read
  p.write(".agents/plan/spec/a.md", BAD); // not read
  p.write("docs/guide.md", BAD); // user docs: not an agent file
  p.write("src/notes.md", BAD); // not an agent file
  assert.deepEqual(found(p)[1].map(([code, where]) => [code, where]), [
    ["LINK_BROKEN", ".agents/README.md"], ["LINK_BROKEN", ".agents/decisions/0001-x.md"],
    ["LINK_BROKEN", ".agents/memory/tooling/2026-01-05-old.md"], ["PATH_MISSING", ".agents/decisions/0001-x.md"]]);
  // explicit targets are read whatever they are
  assert.deepEqual(found(p, ["docs", "src/notes.md"])[1].map(([code, where]) => [code, where]), [["LINK_BROKEN", "docs/guide.md"], ["LINK_BROKEN", "src/notes.md"],
    ["PATH_MISSING", "docs/guide.md"], ["PATH_MISSING", "src/notes.md"]]);
  const [code, out, err] = await p.aw("links", "no/such.md");
  assert.deepEqual([code, out, err], [2, "", "aw links: no such file or folder: no/such.md\n"]);
  const [again, text] = await p.aw("links", "docs", "src/notes.md", "--json");
  assert.deepEqual([again, JSON.parse(text).files], [1, 2]);
});

test("agent-works links: the old board folder is left out like the new one", (t) => {
  const p = tree(t);
  p.write("AGENTS.md", "# Root\n");
  p.write(".agents/board/board.json", "{}");
  p.write(".agents/board/0001-card.md", BAD);
  assert.deepEqual(found(p)[1], []);
});
