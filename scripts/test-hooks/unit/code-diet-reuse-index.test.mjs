// code-diet's reuse-index.mjs: what a query finds in this repo and in the
// other directories the person listed, and that a directory it could not read
// is named rather than dropped. Git's global and system config are replaced,
// so a developer's own `code-diet.reuse` list never reaches a test.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { CONFIG_KEY, definesOf, describe, score, termsOf } from "../../../plugins/code-diet/scripts/reuse-index.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const INDEX = path.join(REPO, "plugins", "code-diet", "scripts", "reuse-index.mjs");

/** Run the index in `cwd` with an empty global git config. */
function ask(t, cwd, args, { json = true } = {}) {
  const globalConfig = write(tempDir(t, "reuse-gitconfig-"), "config", "");
  const result = runNode(INDEX, [...args, ...(json ? ["--json"] : [])], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" } });
  return { ...result, json: json && result.status === 0 ? JSON.parse(result.stdout) : null };
}

/** A repo with a dates module, a panel component, a doc, an ignored build, and a vendored dependency. */
function home(t) {
  const { dir, git } = tempRepo(t, "reuse-home-");
  write(dir, "src/dates.mjs", "// Business-day arithmetic for invoices.\nexport function isBusinessDay(d) { return d.getDay() % 6 !== 0; }\nexport const addBusinessDays = (d, n) => d;\n");
  write(dir, "src/components/SidePanel.tsx", "/** A resizable side panel with a drag handle. */\nexport function SidePanel() { return null; }\n");
  write(dir, "src/main.mjs", 'import { isBusinessDay } from "./dates.mjs";\nconsole.log(isBusinessDay(new Date()));\n');
  write(dir, "docs/panels.md", "# Panels\n\nHow the side panel remembers its width.\n");
  write(dir, "build/dates.mjs", "// Business-day arithmetic for invoices.\nexport function isBusinessDay() {}\n");
  write(dir, "node_modules/dates/index.js", "// Business-day arithmetic.\nexport function isBusinessDay() {}\n");
  write(dir, "data/business-days.csv", "day\n1\n");
  write(dir, ".gitignore", "node_modules/\nscratch/\n");
  write(dir, "scratch/dates.mjs", "// Business-day scratch.\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return { dir, git };
}

/** A second directory with no git: a shared library somewhere else on the machine. */
function shared(t) {
  const dir = tempDir(t, "reuse-shared-");
  write(dir, "ui/ResizablePanel.tsx", "// A resizable panel: side, bottom, or floating.\nexport function ResizablePanel() { return null; }\n");
  write(dir, "ui/Button.tsx", "// A button.\nexport function Button() { return null; }\n");
  write(dir, "dist/ResizablePanel.js", "// A resizable panel, built.\n");
  return dir;
}

test("termsOf keeps the words that carry meaning", () => {
  assert.deepEqual(termsOf("A resizable side-panel for the app"), ["resizable", "side", "panel", "app"]);
  assert.deepEqual(termsOf("a b of"), []);
});

test("score is the share of the query's words found anywhere in the fields", () => {
  assert.equal(score("resizable side panel", "src/SidePanel.tsx", "A resizable panel"), 1);
  assert.equal(score("resizable side panel", "src/Button.tsx", "A panel"), 1 / 3);
  assert.equal(score("resizable side panel", "src/dates.mjs", null, ""), 0);
  assert.equal(score("a b", "a b"), 0, "a query with no word worth matching scores nothing");
});

test("describe takes the opening comment, heading, docstring, or frontmatter description, and nothing from a file that opens with code", () => {
  assert.equal(describe("#!/usr/bin/env node\n// Business-day arithmetic.\nimport fs from 'node:fs';\n"), "Business-day arithmetic.");
  assert.equal(describe("/**\n * A resizable side panel.\n */\nexport {};\n"), "A resizable side panel.");
  assert.equal(describe('"""Parse invoices into rows."""\nimport os\n'), "Parse invoices into rows.");
  assert.equal(describe("# Panels\n\nBody.\n"), "Panels");
  assert.equal(describe("<!-- A page about panels -->\n"), "A page about panels");
  assert.equal(describe("---\nname: thing\ndescription: \"Use when a panel needs resizing.\"\n---\n\n# thing\n"), "Use when a panel needs resizing.");
  assert.equal(describe("---\nname: thing\ndescription: >\n  Use when a panel\n  needs resizing.\n---\n"), "Use when a panel");
  assert.equal(describe("// @ts-check\n// eslint-disable no-console\n// Sends the weekly digest.\n"), "Sends the weekly digest.");
  assert.equal(describe('import fs from "node:fs";\n// not an opening comment\n'), "");
  assert.equal(describe("#header { color: red; }\n"), "");
  assert.equal(describe(""), "");
});

test("definesOf lists what a file defines at the top level, once each", () => {
  assert.deepEqual(definesOf("export function a() {}\nexport default async function b() {}\nconst c = 1;\nclass D {}\n  function nested() {}\ndef e():\n    pass\nexport const a2 = 1;\nfunction a() {}\n"), ["a", "b", "c", "D", "e", "a2"]);
});

test("a query finds a file by its name, its opening comment, or a name it defines", (t) => {
  const { dir } = home(t);
  const out = ask(t, dir, ["business day arithmetic"]);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.json.searched, ["this repo"]);
  assert.deepEqual(out.json.skipped, []);
  assert.deepEqual(out.json.results[0], {
    source: "this repo", name: "src/dates.mjs", kind: "file",
    description: "Business-day arithmetic for invoices.",
    defines: ["isBusinessDay", "addBusinessDays"],
    how: "read src/dates.mjs", score: 1,
  });
});

test("ignored, vendored, built, and non-source files are never candidates", (t) => {
  const { dir } = home(t);
  const names = ask(t, dir, ["business day dates"]).json.results.map((r) => r.name);
  assert.ok(names.includes("src/dates.mjs"));
  for (const name of names) assert.ok(!/^(node_modules|build|scratch|data)\//.test(name), `${name} should not be searched`);
});

test("results rank by how much of the query they cover, and --limit caps a source", (t) => {
  const { dir } = home(t);
  const all = ask(t, dir, ["resizable side panel"]).json.results;
  assert.deepEqual(all.map((r) => [r.name, r.score]), [["src/components/SidePanel.tsx", 1], ["docs/panels.md", 1 / 3]]);
  assert.deepEqual(ask(t, dir, ["resizable side panel", "--limit", "1"]).json.results.map((r) => r.name), ["src/components/SidePanel.tsx"]);
});

test("a directory listed in git config is searched too, under the name it was listed by", (t) => {
  const { dir, git } = home(t);
  const lib = shared(t);
  git("config", "--local", "--add", CONFIG_KEY, lib);
  const out = ask(t, dir, ["resizable panel"]);
  assert.deepEqual(out.json.searched, ["this repo", lib]);
  const theirs = out.json.results.filter((r) => r.source === lib);
  assert.deepEqual(theirs.map((r) => r.name), ["ui/ResizablePanel.tsx"]);
  assert.equal(theirs[0].how, `read ${path.join(lib, "ui/ResizablePanel.tsx")}`);
  assert.ok(out.json.results.some((r) => r.source === "this repo" && r.name === "src/components/SidePanel.tsx"));
});

test("--also adds a directory for one query, relative to the repo root", (t) => {
  const { dir } = home(t);
  const lib = shared(t);
  const out = ask(t, dir, ["resizable panel", "--also", lib, "--also", "src/components"]);
  assert.deepEqual(out.json.searched, ["this repo", lib, "src/components"]);
  assert.ok(out.json.results.some((r) => r.source === "src/components" && r.name === "SidePanel.tsx"));
});

test("a listed directory that is not there is named under skipped, and the rest is still searched", (t) => {
  const { dir, git } = home(t);
  const gone = path.join(tempDir(t, "reuse-gone-"), "moved-away");
  git("config", "--local", "--add", CONFIG_KEY, gone);
  const out = ask(t, dir, ["business day"]);
  assert.equal(out.status, 0);
  assert.deepEqual(out.json.skipped, [`${gone}: not a directory on this machine`]);
  assert.deepEqual(out.json.searched, ["this repo"]);
  assert.ok(out.json.results.length > 0);
});

test("the repo itself, listed again, is searched once", (t) => {
  const { dir, git } = home(t);
  git("config", "--local", "--add", CONFIG_KEY, dir);
  const out = ask(t, dir, ["business day"]);
  assert.deepEqual(out.json.searched, ["this repo"]);
  assert.equal(out.json.results.filter((r) => r.name === "src/dates.mjs").length, 1);
});

test("outside a git repo it searches the working directory", (t) => {
  const out = ask(t, shared(t), ["resizable panel"]);
  assert.deepEqual(out.json.results.map((r) => r.name), ["ui/ResizablePanel.tsx"]);
});

test("the text form lists each candidate, where it looked, and how to list another checkout", (t) => {
  const { dir } = home(t);
  const out = ask(t, dir, ["business day arithmetic", "--limit", "1"], { json: false });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.stdout.trim().split("\n"), [
    "this repo: src/dates.mjs",
    "  Business-day arithmetic for invoices.",
    "  defines isBusinessDay, addBusinessDays",
    "  read src/dates.mjs",
    "searched: this repo",
    `to search another checkout too: git config --global --add ${CONFIG_KEY} <dir>`,
  ]);
  const none = ask(t, dir, ["quaternion slerp"], { json: false });
  assert.match(none.stdout, /^nothing matches "quaternion slerp"\nsearched: this repo\n/);
});

test("no query is a usage error", (t) => {
  const out = ask(t, home(t).dir, []);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage: node reuse-index\.mjs/);
  assert.equal(out.stdout, "");
});
