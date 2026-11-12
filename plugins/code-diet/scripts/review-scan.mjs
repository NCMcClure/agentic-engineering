#!/usr/bin/env node
// Deterministic over-engineering signal scanner. It LOCATES cut candidates; it
// never judges (the review-diet skill does that). Every count, diff stat, and
// net-lines figure is computed here so the skill never re-derives arithmetic.
//
// Usage: node review-scan.mjs [--scope diff|repo] [--base <ref>]
//   diff (default) = the working change (staged, unstaged, untracked) vs --base
//   repo           = the whole tree
//   --base         = HEAD by default; the empty tree when there is no commit yet
//
// stdout: {"scope", "diff": {files, insertions, deletions, net} | null,
//          "candidates": [{kind, file, line, symbol, detail, span}],
//          "counts": {<kind>: n}}
// kinds: single-caller-wrapper, dep-duplicates-stdlib, dead-flag,
//        uncalled-symbol, single-impl-abstraction.
// exit 0 on success even with zero candidates; 1 when this is not a git tree
// or --base does not resolve; 2 on a usage error.
//
// node review-scan.mjs --selftest   runs the extractor's own assertions.
//
// Landing confirmed cuts, one commit each (the git half of review-diet --apply;
// paths are root-relative, as the scan prints them):
//   --apply begin                       {"base", "branch", "protected": [untracked paths]}
//                                       exit 1 while tracked files carry uncommitted
//                                       changes: a cut landed over them would carry
//                                       them into its commit
//   --apply check <file>... [--check "<command>"]...
//                                       confirms the named files are the only tracked
//                                       change, then runs each command from the root:
//                                       {"green", "validated", "files", "checks"}
//   --apply revert <file>...            puts the named files back as HEAD has them
//   --apply report --base <sha>         {"commits", "insertions", "deletions", "net"}
//                                       for everything landed since begin
// It never commits, cleans, or pushes: the commit is the caller's own git call.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv",
  ".next", "target", "coverage", ".turbo", "vendor", ".mypy_cache", ".pytest_cache", ".tox", ".git-rewrite"]);
const SRC_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py"]);
const MAX_BYTES = 512 * 1024;
// debt: one fixed cap per check command, a --timeout flag when a repo's check needs longer
const CHECK_MS = 5 * 60 * 1000;

// A dependency whose job the standard library or the platform already does.
// debt: hand-kept map, widen it when a review keeps missing a common dependency.
export const STDLIB_DUPES = {
  lodash: "native Array and Object methods",
  underscore: "native Array and Object methods",
  moment: "Intl.DateTimeFormat and Date",
  "left-pad": "String.prototype.padStart",
  "is-array": "Array.isArray",
  uuid: "crypto.randomUUID()",
  "node-fetch": "the native fetch()",
  "isomorphic-fetch": "the native fetch()",
  axios: "the native fetch()",
  request: "the native fetch()",
  querystring: "URLSearchParams",
  mkdirp: "fs.mkdir(path, {recursive: true})",
  rimraf: "fs.rm(path, {recursive: true})",
  glob: "fs.globSync (node 22)",
  dotenv: "process.loadEnvFile() (node 22)",
  requests: "urllib.request for a simple GET",
  six: "Python 3 builtins",
  pytz: "zoneinfo",
  ujson: "json",
  toml: "tomllib",
};
const ENTRYPOINTS = new Set(["main", "handler", "setup", "teardown", "default", "index"]);

const PY_DEF = /^(\s*)def\s+([A-Za-z_]\w*)\s*\(/;
const PY_CLASS = /^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/;
const JS_FUNC = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const JS_ARROW = /^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
const JS_CLASS = /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?/;
const CALL = /([A-Za-z_$][\w$]*)\s*\(/g;
const FLAG_PARAM = /([A-Za-z_]\w*)\s*=\s*(?:True|False|true|false)\b/g;
const PY_IMPORT = /^\s*(?:import\s+([A-Za-z_]\w*)|from\s+([A-Za-z_]\w*)[\w.]*\s+import)/;
const JS_IMPORT = /(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])/g;

// quotepath off: a path with non-ASCII characters is listed as it is on disk.
const run = (args, cwd) => spawnSync("git", ["-c", "core.quotepath=off", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = (args, cwd) => { const r = run(args, cwd); return r.status === 0 ? r.stdout : ""; };
const list = (args, cwd) => git([...args, "-z"], cwd).split("\0").filter(Boolean);
const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const shouldSkip = (rel) =>
  rel.split("/").some((p) => SKIP_DIRS.has(p)) || /\.(min\.js|d\.ts|bundle\.js)$/.test(rel);

export const langOf = (rel) => (path.extname(rel) === ".py" ? "py" : SRC_EXT.has(path.extname(rel)) ? "js" : null);

const untracked = (root) => list(["ls-files", "--others", "--exclude-standard"], root);

function sourceFiles(root) {
  const seen = new Set();
  const out = [];
  for (const rel of [...list(["ls-files"], root), ...untracked(root)]) {
    if (seen.has(rel) || shouldSkip(rel) || langOf(rel) === null) continue;
    try { if (fs.statSync(path.join(root, rel)).size > MAX_BYTES) continue; } catch { continue; }
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

function pyBlockSpan(lines, start, indent) {
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const ind = lines[i].length - lines[i].trimStart().length;
    if (ind <= indent) break;
    end = i;
  }
  return end - start + 1;
}

function jsBlockSpan(lines, start) {
  let depth = 0;
  let started = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") depth--;
    }
    if (started && depth <= 0) return i - start + 1;
    // A body with no braces ends at its semicolon, not at the next block's.
    if (!started && /;\s*$/.test(lines[i])) return i - start + 1;
  }
  return 1;
}

/** (defs, classes, imports) for one file. Lines are 1-indexed. */
export function extract(rel, text) {
  const lines = text.split("\n");
  const lang = langOf(rel);
  const defs = [], classes = [], imports = [];
  lines.forEach((line, idx) => {
    if (lang === "py") {
      let m = PY_DEF.exec(line);
      if (m) {
        const indent = m[1].length;
        const paren = line.slice(line.indexOf("(") + 1);
        defs.push({ file: rel, line: idx + 1, name: m[2], span: pyBlockSpan(lines, idx, indent), flags: [...paren.matchAll(FLAG_PARAM)].map((f) => f[1]), selfCounts: true });
        return;
      }
      m = PY_CLASS.exec(line);
      if (m) {
        const span = pyBlockSpan(lines, idx, m[1].length);
        const bases = (m[3] ?? "").split(",").map((b) => b.trim().split("[")[0]).filter(Boolean);
        const body = lines.slice(idx, idx + span).join("\n");
        classes.push({ file: rel, line: idx + 1, name: m[2], span, bases, abstract: bases.some((b) => ["ABC", "ABCMeta", "Protocol"].includes(b)) || body.includes("@abstractmethod") || body.includes("NotImplementedError") });
        return;
      }
      m = PY_IMPORT.exec(line);
      if (m) imports.push({ file: rel, line: idx + 1, mod: m[1] ?? m[2] });
      return;
    }
    let m = JS_FUNC.exec(line) ?? JS_ARROW.exec(line);
    if (m) {
      const paren = line.includes("(") ? line.slice(line.indexOf("(") + 1) : "";
      // An arrow assigned to a const does not spell `name(` on its own line, so
      // it never contributes to the call tally and must not be subtracted from it.
      defs.push({ file: rel, line: idx + 1, name: m[1], span: jsBlockSpan(lines, idx), flags: [...paren.matchAll(FLAG_PARAM)].map((f) => f[1]), selfCounts: line.includes(`${m[1]}(`) });
    }
    m = JS_CLASS.exec(line);
    if (m) {
      classes.push({ file: rel, line: idx + 1, name: m[1], span: jsBlockSpan(lines, idx), bases: m[2] ? [m[2]] : [], abstract: line.includes("abstract") || Boolean(m[2]) });
    }
    for (const im of line.matchAll(JS_IMPORT)) {
      const spec = im[1] ?? im[2];
      if (spec && !spec.startsWith(".") && !spec.startsWith("node:")) imports.push({ file: rel, line: idx + 1, mod: spec.split("/")[0] });
    }
  });
  return { defs, classes, imports };
}

function resolveBase(base, root) {
  if (git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], root).trim()) return base;
  return base === "HEAD" ? EMPTY_TREE : null;
}

/** Insertions and deletions summed over `git diff --numstat <args>`; a binary file counts as a file and no lines. */
function numstat(args, root) {
  let insertions = 0, deletions = 0;
  const files = new Set();
  for (const line of git(["diff", "--numstat", ...args], root).split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    if (parts[0] !== "-") insertions += Number(parts[0]);
    if (parts[1] !== "-") deletions += Number(parts[1]);
    files.add(parts[2]);
  }
  return { files, insertions, deletions };
}

function diffStats(base, root) {
  const stat = numstat([base], root);
  for (const rel of untracked(root)) {
    if (shouldSkip(rel)) continue;
    stat.insertions += readText(path.join(root, rel)).split("\n").length;
    stat.files.add(rel);
  }
  return { files: stat.files.size, insertions: stat.insertions, deletions: stat.deletions, net: stat.insertions - stat.deletions };
}

function changedLines(base, root) {
  const result = new Map();
  let current = null;
  for (const line of git(["diff", "--unified=0", base], root).split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      current = p === "/dev/null" ? null : p.startsWith("b/") ? p.slice(2) : p;
    } else if (line.startsWith("@@") && current) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = Math.max(Number(m[2] ?? "1"), 1);
      if (!result.has(current)) result.set(current, new Set());
      for (let n = start; n < start + count; n++) result.get(current).add(n);
    }
  }
  for (const rel of untracked(root)) {
    if (shouldSkip(rel)) continue;
    const n = readText(path.join(root, rel)).split("\n").length;
    result.set(rel, new Set(Array.from({ length: n }, (_, i) => i + 1)));
  }
  return result;
}

const isEntrypoint = (name) => ENTRYPOINTS.has(name) || name.startsWith("test") || (name.startsWith("__") && name.endsWith("__"));

export function scan(scope, base, root) {
  const files = sourceFiles(root);
  const corpus = new Map(files.map((f) => [f, readText(path.join(root, f))]));
  const corpusText = [...corpus.values()].join("\n");

  const callTally = new Map();
  for (const m of corpusText.matchAll(CALL)) callTally.set(m[1], (callTally.get(m[1]) ?? 0) + 1);

  const allDefs = [], allClasses = [], allImports = [];
  const defsCount = new Map(), subclassCount = new Map(), flagDefaultCount = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const [file, text] of corpus) {
    const { defs, classes, imports } = extract(file, text);
    allDefs.push(...defs); allClasses.push(...classes); allImports.push(...imports);
    for (const d of defs) { if (d.selfCounts) bump(defsCount, d.name); for (const flag of d.flags) bump(flagDefaultCount, flag); }
    for (const c of classes) for (const b of c.bases) bump(subclassCount, b);
  }

  let inScope = () => true;
  let diff = null;
  if (scope !== "repo") {
    const changed = changedLines(base, root);
    inScope = (f, ln) => changed.get(f)?.has(ln) ?? false;
    diff = diffStats(base, root);
  }

  const seen = new Set();
  const candidates = [];
  const add = (kind, file, line, symbol, detail, span) => {
    const key = `${kind}|${file}|${line}|${symbol}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ kind, file, line, symbol, detail, span });
  };

  for (const c of allClasses) {
    if (!inScope(c.file, c.line)) continue;
    const impls = subclassCount.get(c.name) ?? 0;
    if (c.abstract && impls <= 1) add("single-impl-abstraction", c.file, c.line, c.name, `abstract, ${impls} implementation(s), about ${c.span} lines`, c.span);
  }

  for (const d of allDefs) {
    if (!inScope(d.file, d.line)) continue;
    for (const flag of d.flags) {
      const uses = [...corpusText.matchAll(new RegExp(`\\b${flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "g"))].length;
      if (uses - (flagDefaultCount.get(flag) ?? 0) <= 0) add("dead-flag", d.file, d.line, `${d.name}(${flag}=)`, "the flag is never overridden at any call site", 1);
    }
    if (isEntrypoint(d.name)) continue;
    const callers = (callTally.get(d.name) ?? 0) - (defsCount.get(d.name) ?? 0);
    if (callers <= 0) add("uncalled-symbol", d.file, d.line, d.name, `no call sites found, about ${d.span} lines`, d.span);
    else if (callers === 1) add("single-caller-wrapper", d.file, d.line, d.name, `one call site, about ${d.span} lines`, d.span);
  }

  for (const im of allImports) {
    if (!inScope(im.file, im.line)) continue;
    if (STDLIB_DUPES[im.mod]) add("dep-duplicates-stdlib", im.file, im.line, im.mod, STDLIB_DUPES[im.mod], 1);
  }

  // By code point, not locale: the order is the same on every machine.
  candidates.sort((a, b) => byCodePoint(a.file, b.file) || a.line - b.line || byCodePoint(a.kind, b.kind));
  const counts = {};
  for (const c of candidates) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
  return { scope, diff, candidates, counts };
}

// ---- selftest ---------------------------------------------------------------

function selftest() {
  const py = extract("s.py", [
    "import requests",
    "def only_caller_wrapper(x):",
    "    return x + 1",
    "def never_used(y):",
    "    return y",
    "def widget(verbose=False):",
    "    return only_caller_wrapper(verbose)",
    "class Base(ABC):",
    "    @abstractmethod",
    "    def run(self):",
    "        ...",
    "",
  ].join("\n"));
  const names = py.defs.map((d) => d.name);
  for (const name of ["only_caller_wrapper", "never_used", "widget"]) assert.ok(names.includes(name), `def ${name} not found`);
  assert.ok(py.defs.some((d) => d.flags.includes("verbose")), "flag default not parsed");
  assert.ok(py.classes[0]?.abstract, "ABC base not detected abstract");
  assert.equal(py.imports[0]?.mod, "requests");

  const js = extract("s.mjs", [
    'import fs from "node:fs";',
    'import _ from "lodash";',
    "export function shout(text, loud = false) {",
    "  return loud ? text.toUpperCase() : text;",
    "}",
    "const twice = (n) => n * 2;",
    "",
  ].join("\n"));
  assert.deepEqual(js.imports.map((i) => i.mod), ["lodash"], "a node: import is not a dependency");
  assert.deepEqual(js.defs.map((d) => [d.name, d.span, d.selfCounts]), [["shout", 3, true], ["twice", 1, false]]);
  assert.deepEqual(js.defs[0].flags, ["loud"]);
  console.log("selftest ok");
  return 0;
}

// ---- apply ------------------------------------------------------------------
// A cut is validated while it is the only uncommitted tracked change, so
// undoing it is putting its files back as HEAD has them: no reset, no clean,
// and nothing untracked is ever touched.

const out = (value) => { console.log(JSON.stringify(value)); return 0; };
const refuse = (why) => { console.error(`review-scan: ${why}`); return 1; };
const head = (root) => git(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root).trim();
const trackedChanges = (root) => list(["diff", "--name-only", "--no-renames", "HEAD"], root);
const sample = (items) => `${items.slice(0, 5).join(", ")}${items.length > 5 ? `, and ${items.length - 5} more` : ""}`;
const tail = (text) => text.trim().split("\n").slice(-20).join("\n").slice(-2000);

function begin(root) {
  const base = head(root);
  if (!base) return refuse("no commit yet: a cut needs a commit to be put back to");
  const dirty = trackedChanges(root);
  if (dirty.length) return refuse(`uncommitted changes in ${dirty.length} tracked file(s) (${sample(dirty)}): commit or stash them first, since a cut landed over them would carry them into its commit`);
  return out({ base, branch: git(["symbolic-ref", "--short", "-q", "HEAD"], root).trim(), protected: untracked(root) });
}

/** The named files as root-relative paths, or a refusal: each must exist at HEAD, so it can be put back. */
function cutFiles(root, files) {
  const rels = [...new Set(files.map((f) => (path.isAbsolute(f) ? path.relative(root, f) : path.normalize(f)).split(path.sep).join("/")))];
  if (!rels.length) return { usage: "name the files this cut changed" };
  if (!head(root)) return { refusal: "no commit yet: a cut needs a commit to be put back to" };
  const unknown = rels.filter((f) => f.startsWith("../") || run(["cat-file", "-e", `HEAD:${f}`], root).status !== 0);
  if (unknown.length) return { refusal: `not in HEAD, so a cut there could not be put back: ${sample(unknown)}` };
  return { rels };
}

function check(root, files, commands) {
  const named = cutFiles(root, files);
  if (named.usage) { console.error(`review-scan: ${named.usage}`); return 2; }
  if (named.refusal) return refuse(named.refusal);
  const changed = trackedChanges(root);
  const stray = changed.filter((f) => !named.rels.includes(f));
  if (stray.length) return refuse(`${sample(stray)} changed too: one cut per commit, so put the others back or name them`);
  const touched = named.rels.filter((f) => changed.includes(f));
  if (!touched.length) return refuse("none of the named files has changed: there is no cut to check");
  const checks = [];
  for (const command of commands) {
    const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: CHECK_MS });
    const exit = r.status ?? 1;
    checks.push(exit === 0 ? { command, exit } : { command, exit, tail: tail(`${r.stdout ?? ""}\n${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`) });
    if (exit !== 0) break;
  }
  // Green with nothing run is not a pass: `validated` says whether a check stood behind it.
  return out({ green: checks.every((c) => c.exit === 0), validated: checks.length > 0, files: touched, checks });
}

function revert(root, files) {
  const named = cutFiles(root, files);
  if (named.usage) { console.error(`review-scan: ${named.usage}`); return 2; }
  if (named.refusal) return refuse(named.refusal);
  const r = run(["checkout", "-q", "HEAD", "--", ...named.rels], root);
  if (r.status !== 0) return refuse(`git could not put the files back: ${r.stderr.trim()}`);
  return out({ reverted: named.rels });
}

function report(root, base) {
  if (!base || !git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], root).trim()) return refuse(`--apply report needs the --base that begin printed${base ? `; ${base} does not resolve` : ""}`);
  const stat = numstat([base, "HEAD"], root);
  return out({ base, commits: Number(git(["rev-list", "--count", `${base}..HEAD`], root).trim() || 0), insertions: stat.insertions, deletions: stat.deletions, net: stat.insertions - stat.deletions });
}

// ---- cli --------------------------------------------------------------------

function parseArgs(argv) {
  const args = { scope: "diff", base: null, apply: null, checks: [], files: [], selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scope") args.scope = argv[++i];
    else if (a === "--base") args.base = argv[++i];
    else if (a === "--apply") args.apply = argv[++i];
    else if (a === "--check") args.checks.push(argv[++i]);
    else if (a === "--selftest") args.selftest = true;
    else if (a === "--") { args.files.push(...argv.slice(i + 1)); break; }
    else if (!a.startsWith("--")) args.files.push(a);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.selftest) return selftest();
  const usage = (why) => { console.error(`review-scan: ${why}`); return 2; };
  if (!["diff", "repo"].includes(args.scope)) return usage("--scope is diff or repo");
  if (args.apply !== null && !["begin", "check", "revert", "report"].includes(args.apply)) return usage("--apply is begin, check, revert, or report");
  if (args.checks.some((c) => !c)) return usage("--check needs a command");

  const cwd = process.cwd();
  if (git(["rev-parse", "--is-inside-work-tree"], cwd).trim() !== "true") return refuse(`not a git work tree: ${cwd}`);
  const root = git(["rev-parse", "--show-toplevel"], cwd).trim() || cwd;

  if (args.apply === "begin") return begin(root);
  if (args.apply === "check") return check(root, args.files, args.checks);
  if (args.apply === "revert") return revert(root, args.files);
  if (args.apply === "report") return report(root, args.base);

  const base = resolveBase(args.base ?? "HEAD", root);
  if (base === null) return refuse(`could not resolve --base ${args.base}`);
  return out(scan(args.scope, base, root));
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = main(process.argv.slice(2));
