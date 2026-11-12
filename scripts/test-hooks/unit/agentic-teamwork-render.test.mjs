// agentic-teamwork's render.mjs: token replacement, the hashes that become the
// marker's owned map, and the three ways an existing file is treated on an upgrade.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { mergeFencedBlock, render, renderText, sha256, walk, writeOwned } from "../../../plugins/agentic-teamwork/scripts/render.mjs";
import { runNode, tempDir, write } from "./helpers.mjs";

const RENDER = "plugins/agentic-teamwork/scripts/render.mjs";
const hash = (text) => sha256(Buffer.from(text));

test("renderText replaces known tokens and reports unknown ones", () => {
  const out = renderText("{{PROJECT}} on {{MISSING}}", { PROJECT: "scout" });
  assert.equal(out.text, "scout on {{MISSING}}");
  assert.deepEqual(out.unknown, ["MISSING"]);
});

test("renderText leaves text with no tokens byte-identical, a workflow expression included", () => {
  const text = "no tokens here { } {{lowercase}} $VAR ${{ github.ref }}";
  assert.deepEqual(renderText(text, {}), { text, unknown: [] });
});

test("walk lists files relative to the base with forward slashes, sorted, skipping .git and node_modules", (t) => {
  const dir = tempDir(t, "walk-");
  write(dir, "b.txt", "b");
  write(dir, "a/c.txt", "c");
  write(dir, ".git/HEAD", "ref");
  write(dir, "node_modules/x/index.js", "x");
  assert.deepEqual(walk(dir), ["a/c.txt", "b.txt"]);
  assert.deepEqual(walk(path.join(dir, "absent")), []);
});

test("render writes the rendered bytes and hashes what it wrote", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "README.md", "# {{PROJECT}}\n");
  const result = render(source, target, { PROJECT: "scout" });

  assert.deepEqual(result.written, ["README.md"]);
  assert.equal(fs.readFileSync(path.join(target, "README.md"), "utf8"), "# scout\n");
  assert.equal(result.hashes["README.md"], hash("# scout\n"));
  assert.deepEqual(result.plan, [{ path: "README.md", bytes: 8 }]);
});

test("render hashes a template the same whatever line endings its checkout has", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "a.md", "one\r\ntwo\r\n");
  const result = render(source, target, {});
  assert.equal(fs.readFileSync(path.join(target, "a.md"), "utf8"), "one\ntwo\n");
  assert.equal(result.hashes["a.md"], hash("one\ntwo\n"));
});

test("render with dryRun writes nothing but plans everything", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "a/b.txt", "{{PROJECT}}");
  const result = render(source, target, { PROJECT: "x" }, { dryRun: true });

  assert.deepEqual(result.written, ["a/b.txt"]);
  assert.equal(fs.existsSync(path.join(target, "a", "b.txt")), false);
});

test("render leaves out what skip names", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "keep.md", "k\n");
  write(source, "template.json", "{}\n");
  const result = render(source, target, {}, { skip: (rel) => rel === "template.json" });
  assert.deepEqual(result.written, ["keep.md"]);
  assert.equal(fs.existsSync(path.join(target, "template.json")), false);
  assert.equal("template.json" in result.hashes, false);
});

test("an identical existing file is skipped, not rewritten", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "r.md", "same\n");
  write(target, "r.md", "same\n");
  const result = render(source, target, {}, { owned: { "r.md": hash("same\n") } });

  assert.deepEqual(result.written, []);
  assert.deepEqual(result.skipped, [{ path: "r.md", reason: "identical" }]);
  assert.equal(result.hashes["r.md"], hash("same\n"));
});

test("a file edited since it was written is kept, and keeps its recorded hash", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "r.md", "new\n");
  write(target, "r.md", "edited\n");
  const recorded = hash("old\n");
  const result = render(source, target, {}, { owned: { "r.md": recorded } });

  assert.deepEqual(result.written, []);
  assert.equal(result.skipped[0].reason, "edited since it was written");
  assert.equal(String(result.skipped[0].next), "new\n", "the caller is handed what would have been written, to diff");
  assert.equal(fs.readFileSync(path.join(target, "r.md"), "utf8"), "edited\n");
  // Keeping the recorded hash is what stops the next upgrade adopting the edit
  // and overwriting it the run after.
  assert.equal(result.hashes["r.md"], recorded);
});

test("force overwrites an edited file", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "r.md", "new\n");
  write(target, "r.md", "edited\n");
  const result = render(source, target, {}, { owned: { "r.md": hash("old\n") }, force: true });

  assert.deepEqual(result.written, ["r.md"]);
  assert.equal(fs.readFileSync(path.join(target, "r.md"), "utf8"), "new\n");
});

test("a file the scaffold has never owned is never overwritten, and is not claimed", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "AGENTS.md", "template\n");
  write(target, "AGENTS.md", "the repo's own hub\n");
  const result = render(source, target, {}, { owned: {} });

  assert.equal(result.skipped[0].reason, "exists and the scaffold does not own it");
  assert.equal(fs.readFileSync(path.join(target, "AGENTS.md"), "utf8"), "the repo's own hub\n");
  assert.deepEqual(result.hashes, {});
});

test("a file written before and untouched is replaced when the template changes", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "r.md", "v2\n");
  write(target, "r.md", "v1\n");
  const result = render(source, target, {}, { owned: { "r.md": hash("v1\n") } });

  assert.deepEqual(result.written, ["r.md"]);
  assert.equal(fs.readFileSync(path.join(target, "r.md"), "utf8"), "v2\n");
});

test("with no owned map every file is written over what is there", (t) => {
  const target = tempDir(t, "render-dst-");
  write(target, "r.md", "somebody's\n");
  assert.equal(writeOwned(target, "r.md", Buffer.from("fresh\n")).action, "written");
  assert.equal(fs.readFileSync(path.join(target, "r.md"), "utf8"), "fresh\n");
});

test("writeOwned makes an executable file executable", { skip: process.platform === "win32" && "Windows has no executable bit" }, (t) => {
  const target = tempDir(t, "render-dst-");
  writeOwned(target, "hooks/run", Buffer.from("#!/usr/bin/env node\n"), { executable: true });
  assert.ok(fs.statSync(path.join(target, "hooks", "run")).mode & 0o100);
});

test("mergeFencedBlock appends when there is no block and replaces when there is", () => {
  const block = "# >>> s\nA\n# <<< s\n";
  const appended = mergeFencedBlock("keep me\n", block, "# >>> s", "# <<< s");
  assert.equal(appended, "keep me\n\n# >>> s\nA\n# <<< s\n");

  const replaced = mergeFencedBlock(`${appended}after\n`, "# >>> s\nB\n# <<< s\n", "# >>> s", "# <<< s");
  assert.equal(replaced, "keep me\n\n# >>> s\nB\n# <<< s\nafter\n");
});

test("mergeFencedBlock on an empty file produces only the block", () => {
  assert.equal(mergeFencedBlock("", "# >>> s\nA\n# <<< s\n", "# >>> s", "# <<< s"), "# >>> s\nA\n# <<< s\n");
});

test("run directly it prints the plan and writes nothing", (t) => {
  const source = tempDir(t, "render-src-");
  const target = tempDir(t, "render-dst-");
  write(source, "a.md", "{{NAME}} and {{OTHER}}\n");
  const result = runNode(RENDER, [source, target, "--token", "NAME=x=y"]);
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.deepEqual(out.plan, [{ path: "a.md", bytes: 18 }]);
  assert.deepEqual(out.unknown, ["OTHER"]);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(runNode(RENDER, []).status, 2);
});
