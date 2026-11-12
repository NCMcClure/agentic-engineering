// code-diet's debt.mjs: the `debt:` grammar, the tree scan, and the ledger.
// The grammar has one home, so the edit hook's reading of it is tested here too.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MARKER, parsePayload, renderLedger, scan, triggerless } from "../../../plugins/code-diet/scripts/debt.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const DEBT = path.join(REPO, "plugins", "code-diet", "scripts", "debt.mjs");

const NOTES = [
  "# Notes",
  "<!-- debt: one page, split it when it passes 300 lines -->",
  "<!-- debt: no search -->",
  ";; debt: a | pipe, trigger with , commas, twice",
  "/* debt: block closer, upgrade when ready */",
  "-- debt:   ",
  "text debt: not a marker",
  "",
].join("\n");

/** A small tree with a marker in every comment style, one in a skipped directory, and one nested. */
function sample(t) {
  const dir = tempDir(t, "debt-");
  write(dir, "docs/notes.md", NOTES);
  write(dir, "src/app.py", "def f(y):\n    # debt: linear scan, index it when the list passes 10k rows\n    return y\n");
  write(dir, "src/util.mjs", "const x = 1;\n\n// debt: global lock\nexport const y = x;\n");
  write(dir, "node_modules/x/index.js", "// debt: inside a skipped directory\n");
  write(dir, "dist/out.js", "// debt: build output\n");
  return dir;
}

const EXPECTED = [
  { file: "docs/notes.md", line: 2, ceiling: "one page", trigger: "split it when it passes 300 lines", no_trigger: false },
  { file: "docs/notes.md", line: 3, ceiling: "no search", trigger: null, no_trigger: true },
  { file: "docs/notes.md", line: 4, ceiling: "a | pipe", trigger: "trigger with , commas, twice", no_trigger: false },
  { file: "docs/notes.md", line: 5, ceiling: "block closer", trigger: "upgrade when ready", no_trigger: false },
  { file: "docs/notes.md", line: 6, ceiling: "", trigger: null, no_trigger: true },
  { file: "src/app.py", line: 2, ceiling: "linear scan", trigger: "index it when the list passes 10k rows", no_trigger: false },
  { file: "src/util.mjs", line: 3, ceiling: "global lock", trigger: null, no_trigger: true },
];

test("parsePayload splits ceiling from trigger on the first comma", () => {
  assert.deepEqual(parsePayload("global lock"), { ceiling: "global lock", trigger: null });
  assert.deepEqual(parsePayload("global lock, per-account locks if throughput matters"), { ceiling: "global lock", trigger: "per-account locks if throughput matters" });
  assert.deepEqual(parsePayload("a, b, c"), { ceiling: "a", trigger: "b, c" });
});

test("parsePayload treats an empty trigger as no trigger and strips a block-comment closer", () => {
  assert.deepEqual(parsePayload("one page,  "), { ceiling: "one page", trigger: null });
  assert.deepEqual(parsePayload("no search -->"), { ceiling: "no search", trigger: null });
  assert.deepEqual(parsePayload("block closer, upgrade when ready */  "), { ceiling: "block closer", trigger: "upgrade when ready" });
  assert.deepEqual(parsePayload("   "), { ceiling: "", trigger: null });
});

test("MARKER reads every comment leader, repeated or inline, and nothing that is not a comment", () => {
  for (const line of ["# debt: x", "## debt: x", "// debt: x", "-- debt: x", "; debt: x", ";; debt: x", "/* debt: x */", "<!-- debt: x -->", "x = 1  # debt: x", "call(); //debt: x"]) {
    assert.ok(MARKER.test(line), `no marker read in: ${line}`);
  }
  for (const line of ["text debt: x", "debt: x", "the debt: grammar", "# technical debt here"]) {
    assert.ok(!MARKER.test(line), `a marker was read in: ${line}`);
  }
});

test("triggerless lists the ceilings that name no trigger, and skips a marker with no ceiling", () => {
  assert.deepEqual(triggerless("# debt: global lock\nx = 1\n// debt: a, b\n<!-- debt: no search -->\n# debt:\n"), ["global lock", "no search"]);
  assert.deepEqual(triggerless("nothing here\n"), []);
});

test("scan finds every marker, sorted by file then line, with forward-slash paths", (t) => {
  assert.deepEqual(scan(sample(t)), EXPECTED);
});

test("scan sorts by code point, so the order does not depend on the machine's locale", (t) => {
  const dir = tempDir(t, "debt-order-");
  for (const name of ["beta.txt", "Zed.txt", "apple.txt", "_z.txt"]) write(dir, name, "# debt: x, y\n");
  assert.deepEqual(scan(dir).map((m) => m.file), ["Zed.txt", "_z.txt", "apple.txt", "beta.txt"]);
});

test("scan reads CRLF files without carrying the carriage return into the trigger", (t) => {
  const dir = tempDir(t, "debt-crlf-");
  write(dir, "a.txt", "# debt: one, two\r\n# debt: three\r\n");
  assert.deepEqual(scan(dir).map((m) => [m.ceiling, m.trigger]), [["one", "two"], ["three", null]]);
});

test("scan skips a file too large to be source", (t) => {
  const dir = tempDir(t, "debt-big-");
  write(dir, "big.txt", `# debt: x\n${"y".repeat(600 * 1024)}`);
  write(dir, "small.txt", "# debt: x\n");
  assert.deepEqual(scan(dir).map((m) => m.file), ["small.txt"]);
});

test("the command prints the count, the trigger-less count, and the markers", (t) => {
  const result = runNode(DEBT, ["--root", sample(t)]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { count: 7, no_trigger_count: 3, markers: EXPECTED });
});

test("the command scans the working directory when no --root is given", (t) => {
  const result = runNode(DEBT, [], { cwd: sample(t) });
  assert.equal(JSON.parse(result.stdout).count, 7);
});

test("--write saves the ledger as a markdown table, pipes escaped", (t) => {
  const dir = sample(t);
  const ledger = path.join(tempDir(t, "debt-ledger-"), "ledger.md");
  const result = runNode(DEBT, ["--root", dir, "--write", ledger]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(ledger, "utf8"), [
    "# Debt ledger",
    "",
    "7 markers, 3 with no trigger.",
    "",
    "| File | Line | Ceiling | Trigger |",
    "| --- | --- | --- | --- |",
    "| docs/notes.md | 2 | one page | split it when it passes 300 lines |",
    "| docs/notes.md | 3 | no search | _(none)_ |",
    "| docs/notes.md | 4 | a \\| pipe | trigger with , commas, twice |",
    "| docs/notes.md | 5 | block closer | upgrade when ready |",
    "| docs/notes.md | 6 |  | _(none)_ |",
    "| src/app.py | 2 | linear scan | index it when the list passes 10k rows |",
    "| src/util.mjs | 3 | global lock | _(none)_ |",
    "",
  ].join("\n"));
  assert.equal(JSON.parse(result.stdout).count, 7, "the JSON still goes to stdout");
});

test("renderLedger of nothing is a header and an empty table", () => {
  assert.equal(renderLedger([]), "# Debt ledger\n\n0 markers, 0 with no trigger.\n\n| File | Line | Ceiling | Trigger |\n| --- | --- | --- | --- |\n");
});

test("a root that is not a directory exits 1 and says so", (t) => {
  const result = runNode(DEBT, ["--root", path.join(tempDir(t, "debt-none-"), "absent")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a directory/);
  assert.equal(result.stdout, "");
});

test("a ledger that cannot be written exits 1 and says so", (t) => {
  const dir = sample(t);
  const result = runNode(DEBT, ["--root", dir, "--write", path.join(dir, "no-such-folder", "ledger.md")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot write ledger/);
});

test("the plugin's own tree carries no marker without a trigger", () => {
  const own = scan(path.join(REPO, "plugins", "code-diet")).filter((m) => /\.(mjs|js)$/.test(m.file));
  assert.ok(own.length > 0, "the plugin marks its own shortcuts");
  assert.deepEqual(own.filter((m) => m.no_trigger), []);
});
