// code-diet's review-scan.mjs: the signals it locates, the diff arithmetic, its
// selftest, and the git half of landing a cut (--apply), on throwaway repos.
// The review-diet workflow that drives --apply is run here too, with its
// agents replaced by a script, to hold its order of operations.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { STDLIB_DUPES, extract, langOf, shouldSkip } from "../../../plugins/code-diet/scripts/review-scan.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const SCAN = path.join(REPO, "plugins", "code-diet", "scripts", "review-scan.mjs");
const WORKFLOW = path.join(REPO, "plugins", "code-diet", "skills", "review-diet", "workflows", "review.js");

const APP_PY = `import requests
import os

def only_caller_wrapper(x):
    return x + 1

def never_used(y):
    return y

def widget(verbose=False):
    return only_caller_wrapper(verbose)

class Base(ABC):
    @abstractmethod
    def run(self):
        ...

class Impl(Base):
    def run(self):
        return widget()

def main():
    Impl().run()
`;
const UTIL_MJS = `import _ from "lodash";
import fs from "node:fs";
const moment = require("moment");

export function padLeft(s, n, strict = false) {
  return String(s).padStart(n);
}

export const once = (fn) => {
  let done = false;
  return () => { if (!done) { done = true; fn(); } };
};

const helper = x => x * 2;

export async function load(path) {
  return helper(once(() => padLeft(path, 2)));
}

class Shape {}
export class Circle extends Shape {
  area() { return 1; }
}
`;

/** One commit of source, then a working change: a function appended to a tracked file and a new untracked file. */
function sample(t) {
  const { dir, git } = tempRepo(t, "review-");
  write(dir, "src/app.py", APP_PY);
  write(dir, "src/util.mjs", UTIL_MJS);
  write(dir, "node_modules/x/index.js", "export function vendored() {}\n");
  write(dir, ".gitignore", "node_modules/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  fs.appendFileSync(path.join(dir, "src", "app.py"), "\ndef added_later(flag=True):\n    return never_used(flag)\n");
  write(dir, "lib/new.py", "import six\ndef fresh():\n    return 1\n");
  return { dir, git };
}

const scanOf = (dir, ...args) => {
  const result = runNode(SCAN, args, { cwd: dir });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const keys = (out) => out.candidates.map((c) => `${c.file}:${c.line} ${c.kind} ${c.symbol}`);

test("--selftest runs the extractor's own assertions", () => {
  const result = runNode(SCAN, ["--selftest"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "selftest ok");
});

test("extract reads Python definitions, flag defaults, abstract classes, and imports", () => {
  const { defs, classes, imports } = extract("s.py", APP_PY);
  assert.deepEqual(defs.map((d) => [d.name, d.line, d.span]), [
    ["only_caller_wrapper", 4, 2], ["never_used", 7, 2], ["widget", 10, 2], ["run", 15, 2], ["run", 19, 2], ["main", 22, 2],
  ]);
  assert.deepEqual(defs.find((d) => d.name === "widget").flags, ["verbose"]);
  assert.deepEqual(classes.map((c) => [c.name, c.abstract, c.bases]), [["Base", true, ["ABC"]], ["Impl", false, ["Base"]]]);
  assert.deepEqual(imports.map((i) => i.mod), ["requests", "os"]);
});

test("extract reads JavaScript functions, arrows, classes, and package imports, never a node: builtin", () => {
  const { defs, classes, imports } = extract("s.mjs", UTIL_MJS);
  assert.deepEqual(defs.map((d) => [d.name, d.span, d.selfCounts]), [["padLeft", 3, true], ["once", 4, false], ["helper", 1, false], ["load", 3, true]]);
  assert.deepEqual(defs[0].flags, ["strict"]);
  assert.deepEqual(classes.map((c) => [c.name, c.bases]), [["Shape", []], ["Circle", ["Shape"]]]);
  assert.deepEqual(imports.map((i) => i.mod), ["lodash", "moment"]);
});

test("generated, vendored, and non-source paths are left out", () => {
  for (const rel of ["node_modules/a/b.js", "dist/app.js", "pkg/vendor/x.py", "app.min.js", "types.d.ts", ".venv/lib/x.py"]) assert.ok(shouldSkip(rel), rel);
  assert.ok(!shouldSkip("src/app.js"));
  assert.deepEqual(["a.py", "a.tsx", "a.mjs", "a.md", "Makefile"].map(langOf), ["py", "js", "js", null, null]);
});

test("every dependency in the map names what replaces it", () => {
  for (const [dep, native] of Object.entries(STDLIB_DUPES)) assert.ok(native.length > 3, dep);
});

test("diff scope: only the working change is searched, and its lines are counted", (t) => {
  const out = scanOf(sample(t).dir);
  assert.equal(out.scope, "diff");
  assert.deepEqual(out.diff, { files: 2, insertions: 7, deletions: 0, net: 7 });
  assert.deepEqual(keys(out), [
    "lib/new.py:1 dep-duplicates-stdlib six",
    "lib/new.py:2 uncalled-symbol fresh",
    "src/app.py:25 dead-flag added_later(flag=)",
    "src/app.py:25 uncalled-symbol added_later",
  ]);
  assert.deepEqual(out.counts, { "dep-duplicates-stdlib": 1, "uncalled-symbol": 2, "dead-flag": 1 });
  assert.deepEqual(out.candidates[1], { kind: "uncalled-symbol", file: "lib/new.py", line: 2, symbol: "fresh", detail: "no call sites found, about 2 lines", span: 2 });
});

test("repo scope: the whole tree, with no diff stats", (t) => {
  const out = scanOf(sample(t).dir, "--scope", "repo");
  assert.equal(out.diff, null);
  assert.deepEqual(keys(out), [
    "lib/new.py:1 dep-duplicates-stdlib six",
    "lib/new.py:2 uncalled-symbol fresh",
    "src/app.py:1 dep-duplicates-stdlib requests",
    "src/app.py:4 single-caller-wrapper only_caller_wrapper",
    "src/app.py:7 single-caller-wrapper never_used",
    "src/app.py:10 dead-flag widget(verbose=)",
    "src/app.py:10 single-caller-wrapper widget",
    "src/app.py:13 single-impl-abstraction Base",
    "src/app.py:15 single-caller-wrapper run",
    "src/app.py:19 single-caller-wrapper run",
    "src/app.py:25 dead-flag added_later(flag=)",
    "src/app.py:25 uncalled-symbol added_later",
    "src/util.mjs:1 dep-duplicates-stdlib lodash",
    "src/util.mjs:3 dep-duplicates-stdlib moment",
    "src/util.mjs:5 dead-flag padLeft(strict=)",
    "src/util.mjs:5 single-caller-wrapper padLeft",
    "src/util.mjs:9 single-caller-wrapper once",
    "src/util.mjs:14 single-caller-wrapper helper",
    "src/util.mjs:16 uncalled-symbol load",
    "src/util.mjs:21 single-impl-abstraction Circle",
  ]);
  assert.ok(!out.candidates.some((c) => c.file.startsWith("node_modules/")), "an ignored directory was scanned");
});

test("an arrow function with one caller is a single-caller wrapper, not an uncalled symbol", (t) => {
  const out = scanOf(sample(t).dir, "--scope", "repo");
  const once = out.candidates.find((c) => c.symbol === "once");
  assert.deepEqual([once.kind, once.detail, once.span], ["single-caller-wrapper", "one call site, about 4 lines", 4]);
});

test("an arrow with no braces spans its own statement, not the block after it", () => {
  const { defs } = extract("s.mjs", "const double = (n) =>\n  n * 2;\n\nexport function next() {\n  return 1;\n}\n");
  assert.deepEqual(defs.map((d) => [d.name, d.span]), [["double", 2], ["next", 3]]);
});

test("--base widens the diff to everything since that commit", (t) => {
  const { dir, git } = sample(t);
  git("add", "-A");
  git("commit", "-q", "-m", "second");
  assert.deepEqual(scanOf(dir).candidates, [], "a clean tree has no working diff");
  const out = scanOf(dir, "--base", "HEAD~1");
  assert.deepEqual(out.diff, { files: 2, insertions: 6, deletions: 0, net: 6 });
  assert.equal(out.candidates.length, 4);
});

test("a repo with no commit yet is measured against the empty tree", (t) => {
  const { dir } = tempRepo(t, "review-unborn-");
  write(dir, "a.py", "def lonely():\n    return 1\n");
  const out = scanOf(dir);
  assert.equal(out.diff.files, 1);
  assert.deepEqual(keys(out), ["a.py:1 uncalled-symbol lonely"]);
});

test("outside a git work tree, or with a base that does not resolve, it exits 1 and says why", (t) => {
  const outside = runNode(SCAN, [], { cwd: tempDir(t, "review-nogit-") });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /not a git work tree/);
  const base = runNode(SCAN, ["--base", "no-such-ref"], { cwd: sample(t).dir });
  assert.equal(base.status, 1);
  assert.match(base.stderr, /could not resolve --base no-such-ref/);
});

test("a scope or an --apply step it does not know is a usage error", (t) => {
  const { dir } = sample(t);
  assert.equal(runNode(SCAN, ["--scope", "everything"], { cwd: dir }).status, 2);
  assert.equal(runNode(SCAN, ["--apply", "everything"], { cwd: dir }).status, 2);
});

// ---- --apply ----------------------------------------------------------------

const NODE = `"${process.execPath}"`;
const PASS = `${NODE} -e "process.exit(0)"`;
const FAIL = `${NODE} -e "console.log('boom: orphaned import'); process.exit(3)"`;
const TWO_FNS = "export function keep() {\n  return 1;\n}\n\nexport function cut() {\n  return 2;\n}\n";
const ONE_FN = "export function keep() {\n  return 1;\n}\n";

/** A committed repo with two tracked source files and one untracked file of the person's. */
function landing(t) {
  const { dir, git } = tempRepo(t, "apply-");
  write(dir, "src/a.mjs", TWO_FNS);
  write(dir, "src/b.mjs", TWO_FNS);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  write(dir, "notes.txt", "the person's own untracked notes\n");
  const apply = (...args) => {
    const r = runNode(SCAN, ["--apply", ...args], { cwd: dir });
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };
  return { dir, git, apply, read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8") };
}

test("--apply begin records the base commit, the branch, and the untracked files nothing may touch", (t) => {
  const { git, apply } = landing(t);
  const begin = apply("begin");
  assert.equal(begin.status, 0, begin.stderr);
  assert.deepEqual(begin.json, { base: git("rev-parse", "HEAD"), branch: "main", protected: ["notes.txt"] });
});

test("--apply begin refuses while tracked files carry uncommitted changes", (t) => {
  const { dir, apply } = landing(t);
  write(dir, "src/a.mjs", ONE_FN);
  const begin = apply("begin");
  assert.equal(begin.status, 1);
  assert.match(begin.stderr, /uncommitted changes in 1 tracked file\(s\) \(src\/a\.mjs\)/);
  assert.equal(begin.stdout, "");
});

test("--apply begin refuses a repo with no commit to put a cut back to", (t) => {
  const { dir } = tempRepo(t, "apply-unborn-");
  write(dir, "a.mjs", ONE_FN);
  const begin = runNode(SCAN, ["--apply", "begin"], { cwd: dir });
  assert.equal(begin.status, 1);
  assert.match(begin.stderr, /no commit yet/);
});

test("--apply check runs each command against the cut and commits nothing", (t) => {
  const { dir, git, apply, read } = landing(t);
  const before = git("rev-parse", "HEAD");
  write(dir, "src/a.mjs", ONE_FN);
  const check = apply("check", "src/a.mjs", "--check", PASS, "--check", PASS);
  assert.equal(check.status, 0, check.stderr);
  assert.deepEqual(check.json, { green: true, validated: true, files: ["src/a.mjs"], checks: [{ command: PASS, exit: 0 }, { command: PASS, exit: 0 }] });
  assert.equal(git("rev-parse", "HEAD"), before);
  assert.equal(read("src/a.mjs"), ONE_FN, "the cut stays in the tree for the caller to commit");
});

test("--apply check on red stops at the failing command and carries the tail of its output", (t) => {
  const { dir, apply, read } = landing(t);
  write(dir, "src/a.mjs", ONE_FN);
  const check = apply("check", "src/a.mjs", "--check", PASS, "--check", FAIL, "--check", PASS);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.json.green, false);
  assert.equal(check.json.validated, true);
  assert.deepEqual(check.json.checks.map((c) => c.exit), [0, 3]);
  assert.match(check.json.checks[1].tail, /boom: orphaned import/);
  assert.equal(read("src/a.mjs"), ONE_FN, "a red check leaves the cut in place for one repair");
});

test("--apply check with no command is green and says nothing was validated", (t) => {
  const { dir, apply } = landing(t);
  write(dir, "src/a.mjs", ONE_FN);
  assert.deepEqual(apply("check", "src/a.mjs").json, { green: true, validated: false, files: ["src/a.mjs"], checks: [] });
});

test("--apply check runs its commands from the repo root", (t) => {
  const { dir, apply } = landing(t);
  write(dir, "src/a.mjs", ONE_FN);
  const marker = `${NODE} -e "process.exit(require('fs').existsSync('notes.txt') ? 0 : 9)"`;
  const r = runNode(SCAN, ["--apply", "check", "src/a.mjs", "--check", marker], { cwd: path.join(dir, "src") });
  assert.equal(JSON.parse(r.stdout).green, true, r.stdout);
  assert.equal(apply("check", "src/a.mjs", "--check", marker).json.green, true);
});

test("--apply check refuses a second change in the tree: one cut per commit", (t) => {
  const { dir, apply } = landing(t);
  write(dir, "src/a.mjs", ONE_FN);
  write(dir, "src/b.mjs", ONE_FN);
  const check = apply("check", "src/a.mjs", "--check", PASS);
  assert.equal(check.status, 1);
  assert.match(check.stderr, /src\/b\.mjs changed too/);
  assert.equal(apply("check", "src/a.mjs", "src/b.mjs", "--check", PASS).json.green, true, "naming both is one cut across two files");
});

test("--apply check refuses a file that is not in HEAD, an unchanged cut, and a cut with no files", (t) => {
  const { dir, apply } = landing(t);
  const untouched = apply("check", "src/a.mjs", "--check", PASS);
  assert.equal(untouched.status, 1);
  assert.match(untouched.stderr, /none of the named files has changed/);
  write(dir, "src/a.mjs", ONE_FN);
  const stranger = apply("check", "notes.txt", "--check", PASS);
  assert.equal(stranger.status, 1);
  assert.match(stranger.stderr, /not in HEAD.*notes\.txt/);
  const outside = apply("check", "../elsewhere.mjs", "--check", PASS);
  assert.equal(outside.status, 1);
  assert.equal(apply("check", "--check", PASS).status, 2);
});

test("--apply revert puts the named files back and touches nothing else", (t) => {
  const { dir, git, apply, read } = landing(t);
  const before = git("rev-parse", "HEAD");
  write(dir, "src/a.mjs", ONE_FN);
  fs.rmSync(path.join(dir, "src", "b.mjs"));
  const revert = apply("revert", "src/a.mjs", "src/b.mjs");
  assert.equal(revert.status, 0, revert.stderr);
  assert.deepEqual(revert.json, { reverted: ["src/a.mjs", "src/b.mjs"] });
  assert.equal(read("src/a.mjs"), TWO_FNS);
  assert.equal(read("src/b.mjs"), TWO_FNS, "a file the cut deleted comes back");
  assert.equal(read("notes.txt"), "the person's own untracked notes\n");
  assert.equal(git("rev-parse", "HEAD"), before);
  assert.equal(git("status", "--porcelain"), "?? notes.txt");
});

test("--apply revert refuses a file that is not in HEAD, so it can never delete the person's own", (t) => {
  const { apply, read } = landing(t);
  const revert = apply("revert", "notes.txt");
  assert.equal(revert.status, 1);
  assert.match(revert.stderr, /not in HEAD/);
  assert.equal(read("notes.txt"), "the person's own untracked notes\n");
});

test("--apply report sums what landed since the base, and needs a base that resolves", (t) => {
  const { dir, git, apply } = landing(t);
  const base = apply("begin").json.base;
  assert.deepEqual(apply("report", "--base", base).json, { base, commits: 0, insertions: 0, deletions: 0, net: 0 });
  write(dir, "src/a.mjs", ONE_FN);
  git("commit", "-q", "-am", "code-diet: delete: cut (src/a.mjs)");
  write(dir, "src/b.mjs", `${ONE_FN}// one line added\n`);
  git("commit", "-q", "-am", "code-diet: shrink: cut (src/b.mjs)");
  assert.deepEqual(apply("report", "--base", base).json, { base, commits: 2, insertions: 1, deletions: 8, net: -7 });
  assert.equal(apply("report").status, 1);
  assert.equal(apply("report", "--base", "no-such-ref").status, 1);
});

test("the whole loop: a green cut is committed, a red one is put back, and the report counts only what landed", (t) => {
  const { dir, git, apply, read } = landing(t);
  const { base } = apply("begin").json;

  write(dir, "src/a.mjs", ONE_FN);
  assert.equal(apply("check", "src/a.mjs", "--check", PASS).json.green, true);
  git("add", "--", "src/a.mjs");
  git("commit", "-q", "-m", "code-diet: delete: cut (src/a.mjs)");

  write(dir, "src/b.mjs", ONE_FN);
  assert.equal(apply("check", "src/b.mjs", "--check", FAIL).json.green, false);
  assert.equal(apply("revert", "src/b.mjs").status, 0);

  assert.equal(apply("begin").status, 0, "the tree is clean again, ready for the next cut");
  assert.deepEqual(apply("report", "--base", base).json, { base, commits: 1, insertions: 0, deletions: 4, net: -4 });
  assert.equal(read("src/b.mjs"), TWO_FNS);
  assert.equal(git("status", "--porcelain"), "?? notes.txt");
});

// ---- the workflow that drives --apply ---------------------------------------

/** Run the workflow script with its host functions replaced: `answers` maps an agent label to its result. */
async function workflow(args, answers) {
  const body = fs.readFileSync(WORKFLOW, "utf8").replace("export const meta", "const meta");
  const AsyncFunction = (async () => {}).constructor;
  const calls = [];
  const agent = async (prompt, options) => {
    calls.push({ label: options.label, prompt, options });
    const answer = answers[options.label];
    return typeof answer === "function" ? answer(prompt) : answer ?? null;
  };
  const result = await new AsyncFunction("args", "agent", "log", "phase", body)(args, agent, () => {}, () => {});
  return { result, calls, labels: calls.map((c) => c.label) };
}

const FINDINGS = [
  { file: "src/a.mjs", line: 5, tag: "delete:", cut: "cut()", replacement: "", spanLines: 3 },
  { file: "src/b.mjs", line: 5, tag: "yagni:", cut: "cut()", replacement: "", spanLines: 3 },
];
const ARGS = { root: "/work/repo", scan: "/plugins/code diet/scripts/review-scan.mjs", findings: FINDINGS, scope: "diff" };
const CAPTURE = { ok: true, base: "abc1234567", protected: ["notes.txt"] };
const BASELINE = { checks: [{ name: "unit", cmd: "npm test", passes: true }, { name: "lint", cmd: "npm run lint", passes: false }] };

test("workflow: a green cut lands, a red one gets one repair and is then put back, and the report is the script's", async () => {
  const { result, calls, labels } = await workflow(ARGS, {
    capture: CAPTURE,
    baseline: BASELINE,
    "apply:1": { edited: true, files: ["src/a.mjs"], green: true, validated: true, committed: true, sha: "111" },
    "apply:2": { edited: true, files: ["src/b.mjs"], green: false, committed: false, failure: "npm test: boom" },
    "repair:2": { edited: true, files: ["src/b.mjs", "src/c.mjs"], green: false, committed: false, failure: "not surgical" },
    "revert:2": { reverted: true },
    tally: { commits: 1, insertions: 0, deletions: 4, net: -4 },
  });
  assert.deepEqual(labels, ["capture", "baseline", "apply:1", "apply:2", "repair:2", "revert:2", "tally"]);
  assert.deepEqual(result, {
    baseSha: "abc1234567",
    protectedUntracked: ["notes.txt"],
    checks: ["npm test"],
    checksLeftOut: ["npm run lint"],
    predictedNet: -6,
    realizedNet: -4,
    applied: [{ finding: "src/a.mjs:L5 delete:", sha: "111", outcome: "applied and green" }],
    reverted: [{ finding: "src/b.mjs:L5 yagni:", outcome: "reverted: not surgical" }],
  });
  const prompt = (label) => calls.find((c) => c.label === label).prompt;
  const apply = 'cd "/work/repo" && node "/plugins/code diet/scripts/review-scan.mjs" --apply';
  assert.ok(prompt("capture").includes(`${apply} begin`));
  assert.ok(prompt("apply:1").includes(`${apply} check <file>... --check "npm test"`), "only the check that was green before any cut is used");
  assert.ok(!prompt("apply:1").includes("npm run lint"));
  assert.ok(prompt("revert:2").includes(`${apply} revert "src/b.mjs" "src/c.mjs"`), "every file the cut and its repair touched goes back");
  assert.ok(prompt("tally").includes(`${apply} report --base abc1234567`));
  for (const c of calls) assert.ok(!/git[^\n]*reset --hard/.test(c.prompt), `${c.label} is told to reset`);
});

test("workflow: a repair that goes green lands the cut", async () => {
  const { result, labels } = await workflow({ ...ARGS, findings: [FINDINGS[0]] }, {
    capture: CAPTURE,
    baseline: BASELINE,
    "apply:1": { edited: true, files: ["src/a.mjs"], green: false, committed: false, failure: "npm test: boom" },
    "repair:1": { edited: true, files: ["src/a.mjs", "src/index.mjs"], green: true, validated: true, committed: true, sha: "222" },
    tally: { net: -2 },
  });
  assert.deepEqual(labels, ["capture", "baseline", "apply:1", "repair:1", "tally"]);
  assert.deepEqual(result.applied, [{ finding: "src/a.mjs:L5 delete:", sha: "222", outcome: "applied and green" }]);
  assert.deepEqual(result.reverted, []);
  assert.equal(result.realizedNet, -2);
});

test("workflow: with no check to run, a landed cut is reported as not validated", async () => {
  const { result } = await workflow({ ...ARGS, findings: [FINDINGS[0]] }, {
    capture: CAPTURE,
    baseline: { checks: [] },
    "apply:1": { edited: true, files: ["src/a.mjs"], green: true, validated: false, committed: true, sha: "333" },
    tally: { net: -3 },
  });
  assert.deepEqual(result.applied, [{ finding: "src/a.mjs:L5 delete:", sha: "333", outcome: "applied, not validated" }]);
});

test("workflow: a cut whose agent never answers is put back and reported, and the next cut still runs", async () => {
  const { result, labels } = await workflow(ARGS, {
    capture: CAPTURE,
    baseline: BASELINE,
    "revert:1": { reverted: false },
    "apply:2": { edited: true, files: ["src/b.mjs"], green: true, validated: true, committed: true, sha: "444" },
    tally: { net: -3 },
  });
  assert.deepEqual(labels, ["capture", "baseline", "apply:1", "revert:1", "apply:2", "tally"]);
  assert.deepEqual(result.reverted, [{ finding: "src/a.mjs:L5 delete:", outcome: "reverted: apply agent produced no result (putting it back also reported trouble)" }]);
  assert.equal(result.applied.length, 1);
});

test("workflow: it stops at capture when the tree has uncommitted changes", async () => {
  const { result, labels } = await workflow(ARGS, { capture: { ok: false, refusal: "uncommitted changes in 1 tracked file(s)" } });
  assert.deepEqual(labels, ["capture"]);
  assert.deepEqual(result, { aborted: "Capture", reason: "uncommitted changes in 1 tracked file(s)" });
});

test("workflow: no confirmed findings means no agent runs, and args may arrive as a JSON string", async () => {
  const none = await workflow(JSON.stringify({ ...ARGS, findings: [{ file: "", cut: "" }] }), {});
  assert.deepEqual(none.labels, []);
  assert.equal(none.result.note, "no confirmed findings to apply");
  await assert.rejects(workflow({ root: "/work/repo", findings: FINDINGS }, {}), /args must be an object/);
});
