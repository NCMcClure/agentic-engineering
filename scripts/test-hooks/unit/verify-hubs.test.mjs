// verify-hubs.mjs: each finding raised by the smallest tree that earns it, the
// exemptions that silence one, and the command line. Every tree is a throwaway
// git repo, because the checker reads the tree the way a commit would.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FINDINGS, checkHubs, main, parseMarker } from "../../shared/verify-hubs.mjs";
import { runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const SCRIPT = "scripts/shared/verify-hubs.mjs";
const NO_SYMLINKS = process.platform === "win32" && "a symlink needs a privilege the Windows runner does not have";

/** A repo with one root hub naming `src/` and `docs/`, and a file in each. */
function repo(t, hub = "# demo\n\n## Layout\n\n- `src/` - the code.\n- `docs/` - the pages.\n") {
  const { dir, git } = tempRepo(t, "hubs-");
  write(dir, "AGENTS.md", hub);
  write(dir, "src/app/main.py", "print('hi')\n");
  write(dir, "docs/guide.md", "# guide\n");
  return { dir, git };
}
const names = (dir, options) => checkHubs(dir, options).findings.map((f) => `${f.finding} ${f.hub} ${f.detail}`);

test("FINDINGS names every finding and cannot be edited", () => {
  assert.deepEqual([...FINDINGS], ["missing-line", "stale-line", "loose-code", "claude-md-not-twin", "missing-hub"]);
  assert.ok(Object.isFrozen(FINDINGS));
});

test("parseMarker reads exempt and skip, and an absent marker is empty", () => {
  const m = parseMarker("intro\n<!-- verify-hubs: exempt main.go  run.sh; skip generated ./vendor/ -->\n");
  assert.deepEqual([...m.exempt], ["main.go", "run.sh"]);
  assert.deepEqual(m.skip, ["generated/", "vendor/"]);
  assert.deepEqual(parseMarker("# no marker"), { exempt: new Set(), skip: [] });
  assert.deepEqual(parseMarker(undefined), { exempt: new Set(), skip: [] });
});

test("a hub that names each child is clean, and the result carries the root and the hubs", (t) => {
  const { dir } = repo(t);
  const result = checkHubs(dir);
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.hubs, ["AGENTS.md"]);
  assert.equal(fs.realpathSync.native(result.root), fs.realpathSync.native(dir));
});

test("a directory inside the work tree is checked from the work tree's root", (t) => {
  const { dir } = repo(t);
  assert.deepEqual(checkHubs(path.join(dir, "src", "app")).hubs, ["AGENTS.md"]);
});

test("missing-line: a child directory no bullet names, tracked or brand new", (t) => {
  const { dir, git } = repo(t);
  git("add", "-A");
  write(dir, "tools/gen.txt", "x\n");
  assert.deepEqual(names(dir), ["missing-line AGENTS.md child directory tools/ is not named"]);
});

test("missing-line: a bullet that names a path inside the child names the child", (t) => {
  const { dir } = repo(t, "- `src/` - code.\n- `docs/guide.md` - the one page.\n- `.github/workflows/ci.yml` - CI.\n");
  write(dir, ".github/workflows/ci.yml", "on: push\n");
  assert.deepEqual(names(dir), []);
});

test("missing-line: a directory git ignores is not a child", (t) => {
  const { dir } = repo(t);
  write(dir, ".gitignore", "build/\n");
  write(dir, "build/out.js", "x\n");
  assert.deepEqual(names(dir), []);
});

test("stale-line: a bullet whose path is gone", (t) => {
  const { dir } = repo(t, "- `src/` - code.\n- `docs/` - pages.\n- `scripts/build.mjs` - gone.\n- `old/` - gone too.\n");
  assert.deepEqual(names(dir), [
    "stale-line AGENTS.md scripts/build.mjs does not exist",
    "stale-line AGENTS.md old does not exist",
  ]);
});

test("stale-line: a deleted file still in the index is gone", (t) => {
  const { dir, git } = repo(t, "- `src/` - code.\n- `docs/` - pages.\n- `notes.md` - notes.\n");
  write(dir, "notes.md", "x\n");
  git("add", "-A");
  assert.deepEqual(names(dir), []);
  fs.rmSync(path.join(dir, "notes.md"));
  assert.deepEqual(names(dir), ["stale-line AGENTS.md notes.md does not exist"]);
});

test("stale-line: an ignored path, a bare word, a glob and a fenced example are not judged", (t) => {
  const hub = [
    "- `src/` - code.", "- `docs/` - pages.",
    "- `dist/` - build output, ignored.",
    "- `main` - the branch releases are cut from.",
    "- `npm test` - the unit lane.",
    "- `packages/*/src/` - one per package.",
    "- `plugins/<name>/` - a placeholder.",
    "```", "- `example/` - what a bullet looks like.", "```", "",
  ].join("\n");
  const { dir } = repo(t, hub);
  write(dir, ".gitignore", "dist/\n");
  assert.deepEqual(names(dir), []);
});

test("loose-code: a source file beside a hub, in the root and in a nested hub", (t) => {
  const { dir } = repo(t);
  write(dir, "run.sh", "echo hi\n");
  write(dir, "src/AGENTS.md", "- `app/` - the app.\n");
  write(dir, "src/util.ts", "export {};\n");
  assert.deepEqual(names(dir), [
    "loose-code AGENTS.md run.sh sits beside the hub; move it into a subdirectory",
    "loose-code src/AGENTS.md util.ts sits beside the hub; move it into a subdirectory",
  ]);
});

test("loose-code: package markers, dotfiles, tool config, non-code files and exempt names may sit beside a hub", (t) => {
  const { dir } = repo(t, "- `src/` - code.\n- `docs/` - pages.\n<!-- verify-hubs: exempt main.go -->\n");
  for (const f of ["__init__.py", "__init__.pyi", ".eslintrc.js", "vite.config.ts", "eslint.config.mjs", "package.json", "README.md", "Makefile", "main.go"]) write(dir, f, "x\n");
  assert.deepEqual(names(dir), []);
});

test("skip drops a tree from every check, its own hubs included", (t) => {
  const { dir } = repo(t, "- `src/` - code.\n- `docs/` - pages.\n<!-- verify-hubs: skip templates/ -->\n");
  write(dir, "templates/AGENTS.md", "- `gone/` - not here.\n");
  write(dir, "templates/loose.py", "x\n");
  const result = checkHubs(dir, { requireHubs: true });
  assert.deepEqual(result.hubs, ["AGENTS.md"]);
  assert.deepEqual(result.findings.filter((f) => f.finding !== "missing-hub"), []);
});

test("claude-md-not-twin: a CLAUDE.md with content of its own, and not one that only imports the hub", (t) => {
  const { dir } = repo(t);
  write(dir, "CLAUDE.md", "@AGENTS.md\n");
  assert.deepEqual(names(dir), []);
  write(dir, "CLAUDE.md", "AGENTS.md");
  assert.deepEqual(names(dir), []);
  write(dir, "CLAUDE.md", "@AGENTS.md\n\nAlso: always use tabs.\n");
  assert.deepEqual(names(dir), ["claude-md-not-twin AGENTS.md CLAUDE.md has content of its own; move it into AGENTS.md and leave a symlink, or one line: @AGENTS.md"]);
});

test("claude-md-not-twin: a symlink to the sibling hub is the twin, a symlink elsewhere is not", { skip: NO_SYMLINKS }, (t) => {
  const { dir } = repo(t);
  write(dir, "src/AGENTS.md", "- `app/` - the app.\n");
  fs.symlinkSync("AGENTS.md", path.join(dir, "CLAUDE.md"));
  fs.symlinkSync("../AGENTS.md", path.join(dir, "src", "CLAUDE.md"));
  assert.deepEqual(names(dir), ["claude-md-not-twin src/AGENTS.md src/CLAUDE.md links to ../AGENTS.md, not to its sibling AGENTS.md"]);
});

test("a CLAUDE.md with no hub beside it is nobody's twin", (t) => {
  const { dir } = repo(t);
  write(dir, "docs/CLAUDE.md", "Write short pages.\n");
  assert.deepEqual(names(dir), []);
});

test("missing-hub: only on request, for a directory whose child directories hold code", (t) => {
  const { dir } = repo(t, "- `src/` - code.\n- `docs/` - pages.\n- `.github/` - CI.\n");
  write(dir, "src/app/handlers/get.py", "x\n");
  write(dir, "src/app/__init__.py", "");
  write(dir, ".github/scripts/release/tag.sh", "x\n");
  assert.deepEqual(names(dir), []);
  assert.deepEqual(names(dir, { requireHubs: true }), [
    "missing-hub src/AGENTS.md src/ has code directories below it and no AGENTS.md",
    "missing-hub src/app/AGENTS.md src/app/ has code directories below it and no AGENTS.md",
  ]);
});

test("missing-hub: a repo with code directories and no root hub", (t) => {
  const { dir } = tempRepo(t, "hubs-");
  write(dir, "lib/a.js", "x\n");
  write(dir, "README.md", "x\n");
  assert.deepEqual(names(dir), []);
  assert.deepEqual(names(dir, { requireHubs: true }), ["missing-hub AGENTS.md the repo root has code directories below it and no AGENTS.md"]);
});

test("checkHubs throws outside a git work tree", (t) => {
  const dir = tempDir(t, "hubs-plain-");
  assert.throws(() => checkHubs(dir), /is not inside a git work tree/);
});

test("the command line prints one line per finding and exits 1", (t) => {
  const { dir } = repo(t);
  write(dir, "run.sh", "echo hi\n");
  const r = runNode(SCRIPT, [dir]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "AGENTS.md: loose-code, run.sh sits beside the hub; move it into a subdirectory\n1 finding(s)\n");
  assert.equal(r.stderr, "");
});

test("the command line checks the current directory when given none, and exits 0 when clean", (t) => {
  const { dir } = repo(t);
  const r = runNode(SCRIPT, [], { cwd: dir });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "hubs ok\n");
});

test("--json prints one object, and --require-hubs adds the missing hubs to it", (t) => {
  const { dir } = repo(t);
  write(dir, "src/app/handlers/get.py", "x\n");
  const plain = runNode(SCRIPT, ["--json", dir]);
  assert.equal(plain.status, 0);
  const result = JSON.parse(plain.stdout);
  assert.deepEqual(Object.keys(result), ["ok", "root", "hubs", "findings"]);
  assert.deepEqual([result.ok, result.hubs, result.findings], [true, ["AGENTS.md"], []]);

  const strict = runNode(SCRIPT, [dir, "--json", "--require-hubs"]);
  assert.equal(strict.status, 1);
  assert.deepEqual(JSON.parse(strict.stdout).findings.map((f) => [f.finding, f.hub]), [["missing-hub", "src/AGENTS.md"], ["missing-hub", "src/app/AGENTS.md"]]);
});

test("the command line exits 2, with the reason on stderr, outside a repo and on an unknown option", (t) => {
  const outside = runNode(SCRIPT, [tempDir(t, "hubs-plain-")]);
  assert.equal(outside.status, 2);
  assert.match(outside.stderr, /^verify-hubs: .* is not inside a git work tree\n$/);
  assert.equal(outside.stdout, "");

  const { dir } = repo(t);
  const unknown = runNode(SCRIPT, [dir, "--fix"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown option --fix/);
  assert.equal(runNode(SCRIPT, [dir, dir]).status, 2);
});

test("main returns the exit code without ending the process", (t) => {
  const { dir } = repo(t);
  t.mock.method(console, "log", () => {});
  assert.equal(main([dir]), 0);
  write(dir, "run.sh", "x\n");
  assert.equal(main([dir, "--json"]), 1);
});
