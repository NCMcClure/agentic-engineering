// verify-structure.mjs, the gate a stage passes or fails on: which finding gets
// which severity, what --strict raises, what a repo with no root hub is spared,
// and the exit code the worst finding becomes.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LADDER, exitCodeOf, gradeHubFinding, parseArgs, verifyStructure,
} from "../../../plugins/codebase-optimizer/skills/codebase-organizer/scripts/verify-structure.mjs";
import { runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const SCRIPT = "plugins/codebase-optimizer/skills/codebase-organizer/scripts/verify-structure.mjs";
const lines = (n) => "x\n".repeat(n);
const rows = (report) => report.findings.map((f) => `${f.severity} ${f.check} ${f.path}`);

/** A Python repo under git whose hubs agree with its tree: nothing to report. */
function clean(t) {
  const { dir, git } = tempRepo(t, "structure-");
  write(dir, "pyproject.toml", "[project]\nname = \"demo\"\n");
  write(dir, "AGENTS.md", "- `src/` - the package.\n");
  write(dir, "src/AGENTS.md", "- `demo/` - the package itself.\n");
  write(dir, "src/demo/__init__.py", "");
  write(dir, "src/demo/core.py", lines(5));
  return { dir, git };
}

test("the ladder: which checks fail a stage, which warn, which are for the record", () => {
  assert.deepEqual(LADDER, {
    MISSING_INIT: "CRITICAL",
    HUB_LOOSE_CODE: "CRITICAL",
    HUB_MISSING_LINE: "WARNING",
    HUB_STALE_LINE: "WARNING",
    HUB_MISSING: "WARNING",
    CLAUDE_MD_NOT_TWIN: "WARNING",
    FLAT_DIR_BLOAT: "WARNING",
    CRUFT_PRESENT: "WARNING",
    OVERSIZED_MODULE: "INFO",
    EPHEMERA_UNIGNORED: "INFO",
  });
  assert.ok(Object.isFrozen(LADDER));
});

test("exit code: 2 for a critical finding, 1 for warnings, 0 for INFO or nothing", () => {
  assert.equal(exitCodeOf({ critical: 1, warning: 4, info: 2 }), 2);
  assert.equal(exitCodeOf({ critical: 0, warning: 1, info: 2 }), 1);
  assert.equal(exitCodeOf({ critical: 0, warning: 0, info: 9 }), 0);
  assert.equal(exitCodeOf({ critical: 0, warning: 0, info: 0 }), 0);
});

test("a hub finding's grade: loose code is critical only once the root has a hub", () => {
  const grade = (finding, rootHub, strict = false) => gradeHubFinding(finding, { rootHub, strict });
  assert.deepEqual(grade("loose-code", true), { check: "HUB_LOOSE_CODE", severity: "CRITICAL" });
  assert.deepEqual(grade("loose-code", false), { check: "HUB_LOOSE_CODE", severity: "WARNING" });
  for (const [finding, check] of [["missing-line", "HUB_MISSING_LINE"], ["stale-line", "HUB_STALE_LINE"], ["missing-hub", "HUB_MISSING"], ["claude-md-not-twin", "CLAUDE_MD_NOT_TWIN"]]) {
    assert.deepEqual(grade(finding, true), { check, severity: "WARNING" });
    assert.deepEqual(grade(finding, false), { check, severity: "WARNING" });
  }
});

test("--strict raises the three findings about hubs that exist, and leaves the other two as warnings", () => {
  const strict = (finding, rootHub) => gradeHubFinding(finding, { rootHub, strict: true }).severity;
  for (const finding of ["loose-code", "missing-line", "stale-line"]) {
    assert.equal(strict(finding, true), "CRITICAL", finding);
    assert.equal(strict(finding, false), "CRITICAL", `${finding}, no root hub`);
  }
  assert.equal(strict("missing-hub", true), "WARNING");
  assert.equal(strict("claude-md-not-twin", true), "WARNING");
});

test("a finding this gate has no name for is a warning, never dropped", () => {
  assert.deepEqual(gradeHubFinding("some-new-check", { rootHub: true, strict: true }), { check: "HUB_SOME_NEW_CHECK", severity: "WARNING" });
});

test("a repo whose hubs agree with its tree is clean", (t) => {
  const { dir } = clean(t);
  const report = verifyStructure(dir);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.summary, { critical: 0, warning: 0, info: 0 });
  assert.deepEqual([report.subtree, report.strict, report.hubs, report.notes], ["src", false, 2, []]);
});

test("MISSING_INIT: critical inside the subtree, silent for the subtree's own root and outside it", (t) => {
  const { dir } = clean(t);
  write(dir, "src/loose.py", "x\n");
  write(dir, "src/demo/util/strings.py", "x\n");
  write(dir, "tests/test_core.py", "x\n");
  write(dir, "AGENTS.md", "- `src/` - the package.\n- `tests/` - the tests.\n");
  write(dir, "src/demo/AGENTS.md", "- `util/` - helpers.\n<!-- the package's own modules sit beside this hub -->\n");
  const scoped = verifyStructure(dir).findings.filter((f) => f.check === "MISSING_INIT");
  assert.deepEqual(scoped.map((f) => [f.severity, f.path]), [["CRITICAL", "src/demo/util"]]);
  assert.match(scoped[0].message, /^1 \.py module\(s\) and no __init__\.py/);

  const whole = verifyStructure(dir, { subtree: "" }).findings.filter((f) => f.check === "MISSING_INIT");
  assert.deepEqual(whole.map((f) => f.path), ["src", "src/demo/util", "tests"]);
});

test("MISSING_INIT is a Python rule: a repo no manifest calls Python is never failed on it", (t) => {
  const { dir } = tempRepo(t, "structure-");
  write(dir, "package.json", "{}\n");
  write(dir, "AGENTS.md", "- `src/` - code.\n");
  write(dir, "src/AGENTS.md", "- `tools/` - generators.\n");
  write(dir, "src/tools/gen.py", "x\n");
  assert.deepEqual(rows(verifyStructure(dir)), []);
  assert.deepEqual(rows(verifyStructure(dir, { subtree: "" })), []);
});

test("the scan's findings: a flat directory and cruft warn, a long module is INFO", (t) => {
  const { dir } = clean(t);
  for (const n of ["user_get", "user_put", "user_del", "order_get"]) write(dir, `src/demo/${n}.py`, "x\n");
  write(dir, "src/demo/big.py", lines(40));
  write(dir, "src/demo/core_old.py", "x\n");
  write(dir, "report_backup.md", "x\n");
  const report = verifyStructure(dir, { flatMax: 5, moduleMax: 40 });
  assert.deepEqual(rows(report), [
    "WARNING CRUFT_PRESENT src/demo/core_old.py",
    "WARNING FLAT_DIR_BLOAT src/demo",
    "INFO OVERSIZED_MODULE src/demo/big.py",
  ]);
  assert.equal(report.findings[1].message, "8 source files (limit 5): split into subdirectories by feature or type; clusters: user*(3), core*(2)");
  assert.equal(report.findings[2].message, "40 lines (limit 40): a candidate to decompose");
  assert.equal(exitCodeOf(report.summary), 1);

  assert.deepEqual(rows(verifyStructure(dir, { flatMax: 5, moduleMax: 40, subtree: "" })).filter((r) => r.includes("CRUFT")), [
    "WARNING CRUFT_PRESENT report_backup.md",
    "WARNING CRUFT_PRESENT src/demo/core_old.py",
  ]);
  assert.deepEqual(rows(verifyStructure(dir)), ["WARNING CRUFT_PRESENT src/demo/core_old.py"], "at the default limits only the cruft is left");
});

test("EPHEMERA_UNIGNORED: a build artifact and a doubled cache are INFO, an ordinary cache is nothing", (t) => {
  const { dir } = clean(t);
  write(dir, ".gitignore", "*.egg-info/\n__pycache__/\n.pytest_cache/\n.pytest-cache/\n");
  write(dir, "demo.egg-info/PKG-INFO", "x\n");
  write(dir, "src/demo/__pycache__/core.pyc", "x\n");
  write(dir, ".pytest_cache/README.md", "x\n");
  write(dir, "src/.pytest-cache/README.md", "x\n");
  const report = verifyStructure(dir);
  assert.deepEqual(rows(report), ["INFO EPHEMERA_UNIGNORED .pytest_cache / .pytest-cache", "INFO EPHEMERA_UNIGNORED demo.egg-info"]);
  assert.equal(exitCodeOf(report.summary), 0, "INFO alone passes");
});

test("hub findings: loose code beside a hub fails, an unnamed child and a missing hub warn", (t) => {
  const { dir } = clean(t);
  write(dir, "run.sh", "x\n");
  write(dir, "tools/gen/make.py", "x\n");
  write(dir, "tools/lint/check.py", "x\n");
  write(dir, "CLAUDE.md", "Use tabs.\n");
  const report = verifyStructure(dir);
  assert.deepEqual(rows(report), [
    "CRITICAL HUB_LOOSE_CODE AGENTS.md",
    "WARNING CLAUDE_MD_NOT_TWIN AGENTS.md",
    "WARNING HUB_MISSING tools/AGENTS.md",
    "WARNING HUB_MISSING_LINE AGENTS.md",
  ]);
  assert.equal(exitCodeOf(report.summary), 2);
  assert.deepEqual(report.summary, { critical: 1, warning: 3, info: 0 });
});

test("a repo with no root hub is warned, not failed, for code beside a nested hub", (t) => {
  const { dir } = tempRepo(t, "structure-");
  write(dir, "package.json", "{}\n");
  write(dir, "lib/AGENTS.md", "- `parse/` - parsers.\n");
  write(dir, "lib/index.js", "x\n");
  write(dir, "lib/parse/json.js", "x\n");
  const report = verifyStructure(dir);
  assert.deepEqual(rows(report), ["WARNING HUB_LOOSE_CODE lib/AGENTS.md", "WARNING HUB_MISSING AGENTS.md"]);
  assert.equal(exitCodeOf(report.summary), 1);
  assert.deepEqual(rows(verifyStructure(dir, { strict: true })), ["CRITICAL HUB_LOOSE_CODE lib/AGENTS.md", "WARNING HUB_MISSING AGENTS.md"]);
});

test("--strict fails the stage that just wrote the hubs for a line it left out or left stale", (t) => {
  const { dir } = clean(t);
  write(dir, "AGENTS.md", "- `src/` - the package.\n- `scripts/` - gone.\n");
  write(dir, "docs/guide.md", "x\n");
  write(dir, "CLAUDE.md", "Use tabs.\n");
  assert.deepEqual(rows(verifyStructure(dir)), [
    "WARNING CLAUDE_MD_NOT_TWIN AGENTS.md",
    "WARNING HUB_MISSING_LINE AGENTS.md",
    "WARNING HUB_STALE_LINE AGENTS.md",
  ]);
  const strict = verifyStructure(dir, { strict: true });
  assert.deepEqual(rows(strict), [
    "CRITICAL HUB_MISSING_LINE AGENTS.md",
    "CRITICAL HUB_STALE_LINE AGENTS.md",
    "WARNING CLAUDE_MD_NOT_TWIN AGENTS.md",
  ]);
  assert.equal(exitCodeOf(strict.summary), 2);
});

test("hub findings are whole-repo whatever the subtree; --exclude prunes them and the scan alike", (t) => {
  const { dir } = clean(t);
  write(dir, "vendor/AGENTS.md", "- `gone/` - not here.\n");
  write(dir, "vendor/pkg/mod_old.py", "x\n");
  write(dir, "AGENTS.md", "- `src/` - the package.\n- `vendor/` - third-party code.\n");
  assert.deepEqual(rows(verifyStructure(dir, { subtree: "src/demo" })), ["WARNING HUB_MISSING_LINE vendor/AGENTS.md", "WARNING HUB_STALE_LINE vendor/AGENTS.md"]);
  assert.deepEqual(rows(verifyStructure(dir, { subtree: "", excludes: ["./vendor/"] })), []);
});

test("outside a git work tree the scan still grades and a note says the hubs were not checked", (t) => {
  const dir = tempDir(t, "structure-plain-");
  write(dir, "setup.py", "x\n");
  write(dir, "src/pkg/mod.py", "x\n");
  const report = verifyStructure(dir);
  assert.deepEqual(rows(report), ["CRITICAL MISSING_INIT src/pkg"]);
  assert.equal(report.hubs, null);
  assert.deepEqual(report.notes, ["hub checks skipped: not a git work tree"]);
});

test("the command line: --json carries the report and the exit code is the worst finding", (t) => {
  const { dir } = clean(t);
  const ok = runNode(SCRIPT, [dir, "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const report = JSON.parse(ok.stdout);
  assert.deepEqual(Object.keys(report), ["root", "subtree", "strict", "hubs", "notes", "summary", "findings"]);
  assert.deepEqual(report.summary, { critical: 0, warning: 0, info: 0 });

  write(dir, "docs/guide.md", "x\n");
  const warned = runNode(SCRIPT, ["--json", dir]);
  assert.equal(warned.status, 1);
  assert.deepEqual(JSON.parse(warned.stdout).findings, [{ severity: "WARNING", check: "HUB_MISSING_LINE", path: "AGENTS.md", message: "child directory docs/ is not named" }]);

  const failed = runNode(SCRIPT, [dir, "--strict", "--json"]);
  assert.equal(failed.status, 2);
  assert.deepEqual([JSON.parse(failed.stdout).strict, JSON.parse(failed.stdout).summary.critical], [true, 1]);
});

test("the command line: text is one line per finding, then the counts; the directory defaults to the current one", (t) => {
  const { dir } = clean(t);
  write(dir, "run.sh", "x\n");
  const r = runNode(SCRIPT, ["--subtree", ""], { cwd: dir });
  assert.equal(r.status, 2);
  const out = r.stdout.split("\n");
  assert.match(out[0], /^structure of .* \(whole repo\)$/);
  assert.deepEqual(out.slice(1), ["CRITICAL HUB_LOOSE_CODE  AGENTS.md: run.sh sits beside the hub; move it into a subdirectory", "1 critical, 0 warning, 0 info", ""]);
  assert.match(runNode(SCRIPT, [dir, "--strict"]).stdout, /^structure of .* \(scan kept to src\/, strict\)\n/);
});

test("the command line: a bad argument or a path that is no directory is exit 2 with the reason on stderr", (t) => {
  const { dir } = clean(t);
  for (const [args, reason] of [
    [[dir, "--nope"], /^verify-structure: unknown option: --nope\n$/],
    [[dir, "--flat-max", "many"], /--flat-max expects a whole number, got "many"/],
    [[dir, "--module-max"], /--module-max expects a value/],
    [[dir, dir], /unexpected argument/],
    [[`${dir}-missing`], /not a directory/],
  ]) {
    const r = runNode(SCRIPT, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, reason);
    assert.equal(r.stdout, "");
  }
});

test("parseArgs: defaults, both flag spellings, and --subtree with an empty value", () => {
  assert.deepEqual(parseArgs([]), { repo: null, subtree: "src", flatMax: null, moduleMax: 1500, excludes: [], strict: false, json: false });
  assert.deepEqual(parseArgs(["repo", "--subtree=", "--flat-max=12", "--module-max", "900", "--exclude", "a", "--exclude=b", "--strict", "--json"]),
    { repo: "repo", subtree: "", flatMax: 12, moduleMax: 900, excludes: ["a", "b"], strict: true, json: true });
  assert.equal(parseArgs(["--subtree", ""]).subtree, "");
});
