// repo-scan.mjs, the organizer's recon. The profiles below are pinned field for
// field: each was recorded from the Python scanner this one replaced, run over
// the same tree with names visited in sorted order, and the Node scanner's
// output matched it byte for byte.
//
// Where the two differ, on purpose:
// - `missing_init` is new: the directories that hold .py modules and no
//   __init__.py, present only when a manifest says the repo is Python.
// - Names are visited in sorted order, so one tree gives one profile on every
//   file system; the Python walk followed the order the file system listed.
// - Paths use forward slashes on every platform.
// - A flag may be written --flag=value; unique prefixes of a flag (--over 5)
//   are not accepted, and -h prints no help.
// - A bad argument exits 2 with one line on stderr, not a usage block.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FLAT_MAX_DEFAULT, makeExcludeMatcher, parseArgs, scan } from "../../../plugins/codebase-optimizer/skills/codebase-organizer/scripts/repo-scan.mjs";
import { runNode, tempDir, write } from "./helpers.mjs";

const SCRIPT = "plugins/codebase-optimizer/skills/codebase-organizer/scripts/repo-scan.mjs";
const NO_SYMLINKS = process.platform === "win32" && "a symlink needs a privilege the Windows runner does not have";
const lines = (n) => "x\n".repeat(n);

// A polyglot repo that has drifted: loose files and cruft at the root, an
// overstuffed directory whose names cluster, large modules that tie on length,
// packages with and without a marker, caches, and a name outside ASCII.
function drifted(dir) {
  write(dir, "README.md", "# drifted\n");
  write(dir, "LICENSE", "MIT\n");
  write(dir, "pyproject.toml", "[project]\nname = \"drifted\"\n");
  write(dir, "package.json", "{}\n");
  write(dir, ".gitignore", "dist/\n");
  write(dir, ".env.example", "KEY=\n");
  write(dir, ".toolrc", "x\n");
  write(dir, "Dockerfile.prod", "FROM scratch\n");
  write(dir, "notes.txt", "remember\n");
  write(dir, "stray.py", "a\nb\nc");
  write(dir, "empty.sh", "");
  write(dir, "crlf.ps1", "a\r\nb\r\n");
  write(dir, "data.PY", "a\n");
  write(dir, "..py", "a\n");
  write(dir, "café.py", lines(11));
  write(dir, "report_old.md", "x\n");
  write(dir, "main.py.orig", "x\n");
  write(dir, "scratch~", "x\n");
  write(dir, "src/app/__init__.py", "");
  write(dir, "src/app/core.py", lines(30));
  write(dir, "src/app/views.py", lines(30));
  write(dir, "src/app/models.py", lines(12));
  write(dir, "src/app/small.py", lines(9));
  write(dir, "src/app/util/strings.py", lines(10));
  write(dir, "src/app/util/legacy_backup.py", "x\n");
  write(dir, "src/app/handlers/__init__.py", "");
  for (const n of ["user_get", "user_put", "user_delete", "order_get", "order_put", "health"]) write(dir, `src/app/handlers/${n}.py`, "x\n");
  write(dir, "src/app/handlers/README.md", "x\n");
  write(dir, "src/app/handlers/schema.json", "{}\n");
  write(dir, "src/web/package.json", "{}\n");
  write(dir, "src/web/tsconfig.json", "{}\n");
  for (const n of ["api-client.ts", "api-types.ts", "app.tsx", "index.ts", "Makefile"]) write(dir, `src/web/${n}`, "x\n");
  write(dir, "src/web/node_modules/dep/index.js", lines(50));
  write(dir, "tools/go.mod", "module tools\n");
  write(dir, "tools/gen.go", lines(10));
  write(dir, "docs_old/guide.md", "x\n");
  write(dir, "pkg.egg-info/PKG-INFO", "x\n");
  write(dir, "__pycache__/stray.cpython-311.pyc", "x\n");
  write(dir, "src/app/__pycache__/core.cpython-311.pyc", "x\n");
  write(dir, ".pytest_cache/README.md", "x\n");
  write(dir, "tests/.pytest-cache/README.md", "x\n");
  write(dir, "tests/test_core.py", lines(3));
  write(dir, "dist/bundle.js", lines(900));
  write(dir, "build/lib.py", lines(900));
  return dir;
}

// A small Node library that is already tidy: nothing loose, nothing overstuffed.
function tidy(dir) {
  write(dir, "README.md", "# tidy\n");
  write(dir, "package.json", "{\"name\":\"tidy\"}\n");
  write(dir, "tsconfig.json", "{}\n");
  write(dir, ".gitignore", "node_modules/\n");
  write(dir, "src/index.ts", "export {};\n");
  write(dir, "src/lib/parse.ts", lines(4));
  write(dir, "src/lib/orphan.py", "x\n");
  write(dir, "test/parse.test.ts", lines(2));
  return dir;
}

// A Python service with a flat package past the default threshold and modules
// on both sides of the default large-file line.
function service(dir) {
  write(dir, "README.rst", "service\n");
  write(dir, "setup.py", "x\n");
  write(dir, "requirements.txt", "x\n");
  write(dir, "manage.py", "x\n");
  write(dir, "conftest.py", "x\n");
  write(dir, "svc/__init__.py", "");
  for (let i = 1; i <= 13; i++) write(dir, `svc/job_${String(i).padStart(2, "0")}.py`, "x\n");
  for (let i = 1; i <= 9; i++) write(dir, `svc/task-${i}.py`, "x\n");
  write(dir, "svc/fixtures.yaml", "x\n");
  write(dir, "svc/Notes", "x\n");
  write(dir, "svc/engine.py", lines(801));
  write(dir, "svc/almost.py", lines(799));
  write(dir, "svc/exact.py", `${lines(799)}x`);
  write(dir, "svc/plugins/loader.py", "x\n");
  write(dir, "svc/plugins/builtin/__init__.py", "");
  write(dir, "svc/plugins/builtin/echo.py", "x\n");
  write(dir, "tests/unit/test_engine.py", lines(900));
  write(dir, "tests/unit/data_deprecated.json", "{}\n");
  write(dir, "vendor/lib/x.py", lines(2000));
  write(dir, "scripts/deploy_migration.sh", "x\n");
  write(dir, "scripts/run.sh", "x\n");
  return dir;
}

/** Run the scanner as a command; returns the parsed profile and the raw text. */
function run(dir, args = []) {
  const r = runNode(SCRIPT, [dir, ...args]);
  assert.equal(r.status, 0, r.stderr);
  return { profile: JSON.parse(r.stdout), text: r.stdout };
}
/** The profile without the two fields a recorded profile cannot carry. */
function recorded(profile, dir) {
  assert.equal(profile.repo_path, path.resolve(dir));
  const { repo_path: _path, missing_init: _init, ...rest } = profile;
  return rest;
}
const KEYS = ["repo_path", "git", "ecosystems", "root", "overstuffed_threshold", "overstuffed_dirs", "cruft", "large_source_files", "totals"];

const DRIFTED_ROOT = {
  intent_files: [".env.example", ".gitignore", ".toolrc", "Dockerfile.prod", "LICENSE", "README.md", "package.json", "pyproject.toml"],
  loose_files: [{ name: "..py" }, { name: "café.py", lines: 11 }, { name: "crlf.ps1", lines: 2 }, { name: "data.PY" }, { name: "empty.sh", lines: 0 }, { name: "notes.txt" }, { name: "stray.py", lines: 3 }],
  dirs: [".pytest_cache", "__pycache__", "build", "dist", "docs_old", "pkg.egg-info", "src", "tests", "tools"],
};
const DRIFTED_CRUFT = {
  files: ["./main.py.orig", "./report_old.md", "./scratch~", "src/app/util/legacy_backup.py"],
  dirs: [".pytest_cache", "__pycache__", "docs_old", "pkg.egg-info", "src/app/__pycache__", "tests/.pytest-cache"],
  duplicate_cache_dirs: [[".pytest_cache", ".pytest-cache"]],
};

test("golden: a drifted polyglot repo, every threshold lowered", (t) => {
  const dir = drifted(tempDir(t, "scan-"));
  const { profile } = run(dir, ["--overstuffed", "5", "--max-list", "4", "--large-min", "10", "--large-cap", "4"]);
  assert.deepEqual(Object.keys(profile), [...KEYS, "missing_init"]);
  assert.deepEqual(recorded(profile, dir), {
    git: { is_git: false },
    ecosystems: ["go", "node", "python"],
    root: DRIFTED_ROOT,
    overstuffed_threshold: 5,
    overstuffed_dirs: [
      { path: "src/app/handlers", file_count: 9, source_file_count: 7, subdir_count: 0, common_prefixes: [{ prefix: "user", count: 3 }, { prefix: "order", count: 2 }], sample_files: ["README.md", "__init__.py", "health.py", "order_get.py"] },
      { path: "src/web", file_count: 7, source_file_count: 4, subdir_count: 0, common_prefixes: [{ prefix: "api", count: 2 }], sample_files: ["Makefile", "api-client.ts", "api-types.ts", "app.tsx"] },
      { path: "src/app", file_count: 5, source_file_count: 5, subdir_count: 2, common_prefixes: [], sample_files: ["__init__.py", "core.py", "models.py", "small.py"] },
    ],
    cruft: DRIFTED_CRUFT,
    large_source_files: [{ path: "src/app/core.py", lines: 30 }, { path: "src/app/views.py", lines: 30 }, { path: "src/app/models.py", lines: 12 }, { path: "café.py", lines: 11 }],
    totals: { root_dirs: 9, root_intent_files: 8, root_loose_files: 7, total_files: 44, total_dirs: 7, overstuffed_dir_count: 3, cruft_file_count: 4, cruft_dir_count: 6 },
  });
});

test("golden: the same repo at the default thresholds", (t) => {
  const dir = drifted(tempDir(t, "scan-"));
  assert.deepEqual(recorded(run(dir).profile, dir), {
    git: { is_git: false },
    ecosystems: ["go", "node", "python"],
    root: DRIFTED_ROOT,
    overstuffed_threshold: 25,
    overstuffed_dirs: [],
    cruft: DRIFTED_CRUFT,
    large_source_files: [],
    totals: { root_dirs: 9, root_intent_files: 8, root_loose_files: 7, total_files: 44, total_dirs: 7, overstuffed_dir_count: 0, cruft_file_count: 4, cruft_dir_count: 6 },
  });
});

const TIDY = {
  ecosystems: ["node"],
  overstuffed_threshold: 25,
  overstuffed_dirs: [],
  cruft: { files: [], dirs: [], duplicate_cache_dirs: [] },
  large_source_files: [],
};
const TIDY_INTENT = [".gitignore", "README.md", "package.json", "tsconfig.json"];

/** `git init` on main with an identity and no line-ending rewriting; returns a runner. */
function init(dir) {
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  return git;
}

test("golden: a tidy Node repo, committed, then one file changed and one added", (t) => {
  const dir = tidy(tempDir(t, "scan-"));
  const git = init(dir);
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  write(dir, "untracked.txt", "x\n");
  write(dir, "README.md", "# changed\n");
  const { profile } = run(dir);
  assert.deepEqual(Object.keys(profile), KEYS, "no missing_init: no manifest says Python");
  assert.deepEqual(recorded(profile, dir), {
    git: { is_git: true, branch: "main", clean: false, dirty_count: 2, tracked_files: 8 },
    ...TIDY,
    root: { intent_files: TIDY_INTENT, loose_files: [{ name: "untracked.txt" }], dirs: [".git", "src", "test"] },
    totals: { root_dirs: 3, root_intent_files: 4, root_loose_files: 1, total_files: 9, total_dirs: 3, overstuffed_dir_count: 0, cruft_file_count: 0, cruft_dir_count: 0 },
  });
});

test("golden: the tidy repo before its first commit", (t) => {
  const dir = tidy(tempDir(t, "scan-"));
  init(dir);
  assert.deepEqual(recorded(run(dir).profile, dir), {
    git: { is_git: true, branch: "HEAD", clean: false, dirty_count: 6, tracked_files: 0 },
    ...TIDY,
    root: { intent_files: TIDY_INTENT, loose_files: [], dirs: [".git", "src", "test"] },
    totals: { root_dirs: 3, root_intent_files: 4, root_loose_files: 0, total_files: 8, total_dirs: 3, overstuffed_dir_count: 0, cruft_file_count: 0, cruft_dir_count: 0 },
  });
});

const SERVICE_ROOT = { intent_files: ["README.rst", "requirements.txt", "setup.py"], loose_files: [{ name: "conftest.py", lines: 1 }, { name: "manage.py", lines: 1 }] };
const JOBS = Array.from({ length: 13 }, (_, i) => `job_${String(i + 1).padStart(2, "0")}.py`);
const TASKS = Array.from({ length: 9 }, (_, i) => `task-${i + 1}.py`);

test("golden: a Python service at the defaults", (t) => {
  const dir = service(tempDir(t, "scan-"));
  assert.deepEqual(recorded(run(dir).profile, dir), {
    git: { is_git: false },
    ecosystems: ["python"],
    root: { ...SERVICE_ROOT, dirs: ["scripts", "svc", "tests", "vendor"] },
    overstuffed_threshold: 25,
    overstuffed_dirs: [{
      path: "svc", file_count: 28, source_file_count: 26, subdir_count: 1,
      common_prefixes: [{ prefix: "job", count: 13 }, { prefix: "task", count: 9 }],
      sample_files: ["Notes", "__init__.py", "almost.py", "engine.py", "exact.py", "fixtures.yaml", ...JOBS, ...TASKS],
    }],
    cruft: { files: ["scripts/deploy_migration.sh", "tests/unit/data_deprecated.json"], dirs: [], duplicate_cache_dirs: [] },
    large_source_files: [{ path: "tests/unit/test_engine.py", lines: 900 }, { path: "svc/engine.py", lines: 801 }, { path: "svc/exact.py", lines: 800 }],
    totals: { root_dirs: 4, root_intent_files: 3, root_loose_files: 2, total_files: 40, total_dirs: 6, overstuffed_dir_count: 1, cruft_file_count: 2, cruft_dir_count: 0 },
  });
});

test("golden: the service with two trees excluded and flags written with =", (t) => {
  const dir = service(tempDir(t, "scan-"));
  const { profile } = run(dir, ["--exclude", "tests", "--exclude=./svc/plugins/", "--overstuffed=20", "--max-list", "3"]);
  assert.deepEqual(recorded(profile, dir), {
    git: { is_git: false },
    ecosystems: ["python"],
    root: { ...SERVICE_ROOT, dirs: ["scripts", "svc", "vendor"] },
    overstuffed_threshold: 20,
    overstuffed_dirs: [{
      path: "svc", file_count: 28, source_file_count: 26, subdir_count: 0,
      common_prefixes: [{ prefix: "job", count: 13 }, { prefix: "task", count: 9 }],
      sample_files: ["Notes", "__init__.py", "almost.py"],
    }],
    cruft: { files: ["scripts/deploy_migration.sh"], dirs: [], duplicate_cache_dirs: [] },
    large_source_files: [{ path: "svc/engine.py", lines: 801 }, { path: "svc/exact.py", lines: 800 }],
    totals: { root_dirs: 3, root_intent_files: 3, root_loose_files: 2, total_files: 35, total_dirs: 2, overstuffed_dir_count: 1, cruft_file_count: 1, cruft_dir_count: 0 },
  });
  assert.deepEqual(profile.missing_init, []);
});

test("golden: a linked directory is counted and not entered, a dangling link is a file", { skip: NO_SYMLINKS }, (t) => {
  const dir = tempDir(t, "scan-");
  write(dir, "setup.py", "x\n");
  write(dir, "real/a.py", "x\n");
  write(dir, "real/sub/b.py", "x\n");
  write(dir, "pkg/c.py", "x\n");
  fs.symlinkSync("../real", path.join(dir, "pkg", "linked"));
  fs.symlinkSync("real", path.join(dir, "rootlink"));
  fs.symlinkSync("nowhere", path.join(dir, "broken"));
  fs.symlinkSync("nowhere.py", path.join(dir, "pkg", "broken.py"));
  assert.deepEqual(recorded(run(dir, ["--large-min", "1"]).profile, dir), {
    git: { is_git: false },
    ecosystems: ["python"],
    root: { intent_files: ["setup.py"], loose_files: [{ name: "broken" }], dirs: ["pkg", "real", "rootlink"] },
    overstuffed_threshold: 25,
    overstuffed_dirs: [],
    cruft: { files: [], dirs: [], duplicate_cache_dirs: [] },
    large_source_files: [{ path: "setup.py", lines: 1 }, { path: "pkg/c.py", lines: 1 }, { path: "real/a.py", lines: 1 }, { path: "real/sub/b.py", lines: 1 }],
    totals: { root_dirs: 3, root_intent_files: 1, root_loose_files: 1, total_files: 6, total_dirs: 5, overstuffed_dir_count: 0, cruft_file_count: 0, cruft_dir_count: 0 },
  });
});

test("missing_init lists each directory with modules and no marker, by path, in a Python repo", (t) => {
  const dir = drifted(tempDir(t, "scan-"));
  assert.deepEqual(run(dir).profile.missing_init, [{ path: "src/app/util", py_files: 2 }, { path: "tests", py_files: 1 }]);
  const svc = service(tempDir(t, "scan-"));
  assert.deepEqual(run(svc).profile.missing_init, [{ path: "svc/plugins", py_files: 1 }, { path: "tests/unit", py_files: 1 }]);
});

test("the output is two-space JSON in ASCII, ending in one newline", (t) => {
  const dir = drifted(tempDir(t, "scan-"));
  const { text } = run(dir, ["--large-min", "10"]);
  assert.match(text, /^\{\n  "repo_path": /);
  assert.ok(text.endsWith("\n}\n"));
  assert.ok(text.includes('"name": "caf\\u00e9.py"'), "a name outside ASCII is escaped");
  assert.doesNotMatch(text, /[^\x00-\x7f]/);
  assert.doesNotMatch(text, /\r/);
});

test("scan() returns the profile the command prints", (t) => {
  const dir = service(tempDir(t, "scan-"));
  assert.equal(FLAT_MAX_DEFAULT, 25);
  assert.deepEqual(scan(dir, FLAT_MAX_DEFAULT, 30), run(dir).profile);
});

test("makeExcludeMatcher matches a prefix and what is under it, however the prefix is written", () => {
  const excluded = makeExcludeMatcher(["./tests/", "svc\\plugins"]);
  assert.deepEqual(["tests", "tests/unit/a.py", "svc/plugins", "svc/plugins/x", "testsuite", "svc"].map(excluded), [true, true, true, true, false, false]);
  assert.equal(makeExcludeMatcher([])("anything"), false);
  assert.equal(makeExcludeMatcher(["", "./"])("anything"), false);
});

test("parseArgs reads every flag in both spellings and refuses what it does not know", () => {
  assert.deepEqual(parseArgs(["--overstuffed=7", "repo", "--max-list", "2", "--large-min=3", "--large-cap", "4", "--exclude", "a", "--exclude=b"]),
    { repo_path: "repo", overstuffed: 7, max_list: 2, large_min: 3, large_cap: 4, exclude: ["a", "b"] });
  assert.deepEqual(parseArgs(["repo"]), { repo_path: "repo", overstuffed: 25, max_list: 30, large_min: 800, large_cap: 25, exclude: [] });
  assert.throws(() => parseArgs([]), /repo_path is required/);
  assert.throws(() => parseArgs(["repo", "--nope"]), /unknown option: --nope/);
  assert.throws(() => parseArgs(["repo", "again"]), /unexpected argument: again/);
  assert.throws(() => parseArgs(["repo", "--overstuffed", "many"]), /--overstuffed expects an integer/);
  assert.throws(() => parseArgs(["repo", "--overstuffed"]), /--overstuffed expects a value/);
});

test("a path that is not a directory is one error object on stdout, exit 1", (t) => {
  const missing = path.join(tempDir(t, "scan-"), "nope");
  const r = runNode(SCRIPT, [missing]);
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout), { error: `not a directory: ${missing}` });
  assert.ok(r.stdout.startsWith('{"error": "not a directory: '), "the shape a caller greps for");
  assert.ok(!r.stdout.endsWith("\n"));
});

test("a bad argument is one line on stderr, nothing on stdout, exit 2", (t) => {
  const r = runNode(SCRIPT, [tempDir(t, "scan-"), "--nope"]);
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, "", "repo-scan: unknown option: --nope\n"]);
  assert.equal(runNode(SCRIPT, []).status, 2);
});
