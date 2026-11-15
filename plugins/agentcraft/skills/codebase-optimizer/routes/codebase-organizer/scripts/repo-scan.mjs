#!/usr/bin/env node
// Deterministic recon for the codebase-organizer skill.
//
// Walks a repository and emits one JSON profile to stdout describing the shape
// of the tree: what sits loose at the root, which directories are overstuffed,
// what ecosystem the manifests imply, where cruft has accumulated, and whether
// the tree is a clean git checkout. The organize-plan workflow feeds this
// profile to its planner agents so they reason from counts, names, and paths
// instead of re-deriving them by hand on every run.
//
// Node 22 stdlib only, so it runs anywhere a repo can be checked out.
//
// Usage:
//   node repo-scan.mjs <repo_path> [--overstuffed N] [--max-list M]
//                      [--large-min N] [--large-cap N] [--exclude PATH]...
//
// The scan respects .gitignore loosely: it skips a built-in set of always-noise
// directories (.git, node_modules, virtualenvs, caches) so the counts reflect
// source, not dependencies. Cruft inside those directories is still summarized
// at a high level, because "you have three duplicate cache dirs" is itself a
// finding.
//
// The profile is the same on every machine: names are visited in sorted order,
// paths use forward slashes, and the JSON is ASCII (anything else is \u-escaped).
// Exit 0 with the profile, 1 with {"error": ...} on stdout when the path is not
// a directory, 2 with the reason on stderr for a bad argument.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Directories that are never the point of an organization pass: dependency
// trees, VCS internals, and build or test caches. The per-directory census does
// not descend into these, but their existence is noted as a cruft signal.
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "env", "__pycache__",
  ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache",
  ".tox", ".nox", ".gradle", ".idea", ".vscode", "target", "dist",
  "build", ".next", ".turbo", ".cache", "__snapshots__", ".terraform",
  "vendor", ".bundle", ".dart_tool", "Pods",
]);

const CACHE_CRUFT_DIRS = new Set([
  ".pytest_cache", ".pytest-cache", "__pycache__", ".ruff_cache", ".mypy_cache",
]);

// Files that legitimately belong at the root of a tidy repo: they describe
// intent, contract, or entry, not implementation. Everything else loose at the
// root is a candidate for nesting. Matched case-insensitively.
const ROOT_INTENT_EXACT = new Set([
  "readme", "readme.md", "readme.rst", "readme.txt",
  "license", "license.md", "license.txt", "licence", "copying", "notice",
  "changelog", "changelog.md", "contributing.md", "code_of_conduct.md",
  "security.md", "authors", "authors.md", "codeowners",
  // python manifests and lockfiles
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
  "manifest.in", "tox.ini", "poetry.lock", "uv.lock", "pipfile",
  "pipfile.lock", "environment.yml",
  // node
  "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "tsconfig.json", ".nvmrc",
  // go, rust, ruby, php, java, elixir
  "go.mod", "go.sum", "cargo.toml", "cargo.lock", "gemfile", "gemfile.lock",
  "composer.json", "composer.lock", "pom.xml", "build.gradle",
  "build.gradle.kts", "settings.gradle", "mix.exs", "mix.lock",
  // build, container, infra entry
  "makefile", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
  "flake.nix", "flake.lock", "default.nix", "shell.nix",
  // meta and dotfiles that configure the repo as a whole
  ".gitignore", ".gitattributes", ".editorconfig", ".dockerignore",
  ".gitlab-ci.yml", ".pre-commit-config.yaml", ".mailmap", ".envrc",
  ".python-version", ".tool-versions", ".prettierrc", ".eslintrc.json",
  ".eslintrc.js", ".eslintrc", "renovate.json", "cliff.toml",
  // common user-facing entry scripts
  "install.sh", "install.ps1", "install.cmd", "main.py", "__main__.py",
  "index.js", "index.ts", "app.py",
]);

// Prefix and suffix patterns that read as intent-ish, so the scan does not
// over-flag.
const ROOT_INTENT_REGEX = [
  /^\.env(\..+)?$/i,        // .env, .env.example
  /^readme/i,
  /^license/i,
  /^dockerfile/i,           // Dockerfile.prod and friends
  /^\.[a-z0-9_-]+rc$/i,     // arbitrary .*rc dotfiles
  /.+\.ya?ml\.example$/i,
];

// Names and patterns that signal accumulated cruft worth quarantining.
const CRUFT_REGEX = [
  /_backup(\.|$)/i,
  /_bak(\.|$)/i,
  /[-_]old(\.|$)/i,
  /[-_]copy(\.|$)/i,
  /[-_]deprecated(\.|$)/i,
  /_migration(\.|$)/i,
  /_retirement(\.|$)/i,
  /\.orig$/i,
  /\.tmp$/i,
  /~$/,
  /\.egg-info$/i,
];

// Manifest filename to ecosystem label, for sniffing project type.
const MANIFEST_ECOSYSTEM = new Map(Object.entries({
  "pyproject.toml": "python", "setup.py": "python", "setup.cfg": "python",
  "requirements.txt": "python", "pipfile": "python", "uv.lock": "python",
  "package.json": "node", "tsconfig.json": "node",
  "go.mod": "go", "cargo.toml": "rust", "gemfile": "ruby",
  "composer.json": "php", "pom.xml": "java", "build.gradle": "java",
  "build.gradle.kts": "java", "mix.exs": "elixir",
}));

const SOURCE_EXTS = new Set([
  ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".rb", ".java",
  ".kt", ".php", ".ex", ".exs", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".swift", ".scala", ".sh", ".ps1",
]);

// Canonical "overstuffed directory" threshold (philosophy principle 3). This is
// the single source for the number: prose and prompts elsewhere refer to
// "repo-scan's flat-max" instead of restating it.
export const FLAT_MAX_DEFAULT = 25;

const isIntentFile = (name) =>
  ROOT_INTENT_EXACT.has(name.toLowerCase()) || ROOT_INTENT_REGEX.some((rx) => rx.test(name));

const isCruft = (name) => CRUFT_REGEX.some((rx) => rx.test(name));

// The extension from the last dot on; a name that is only leading dots and a
// word (.bashrc, ..py) has none.
function extOf(name) {
  const i = name.lastIndexOf(".");
  return i <= 0 || /^\.*$/.test(name.slice(0, i)) ? "" : name.slice(i);
}

// Best-effort line count, null when unreadable. A last line with no newline
// still counts.
function countLines(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return null; }
  if (buf.length === 0) return 0;
  let n = 0;
  for (const byte of buf) if (byte === 0x0a) n++;
  if (buf[buf.length - 1] !== 0x0a) n++;
  return n;
}

// Git tracking facts, or {is_git:false} when the path is not a checkout.
function gitInfo(repo) {
  const run = (args) => {
    try {
      const out = execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] });
      return [out.trim(), 0];
    } catch (e) {
      return [String(e.stdout ?? "").trim(), typeof e.status === "number" ? e.status : 1];
    }
  };
  const [inside, rc] = run(["rev-parse", "--is-inside-work-tree"]);
  if (rc !== 0 || inside !== "true") return { is_git: false };
  const [status] = run(["status", "--porcelain"]);
  const [branch] = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const [tracked] = run(["ls-files"]);
  const lines = (s) => s.split("\n").filter(Boolean).length;
  return {
    is_git: true,
    branch,
    clean: status === "",
    dirty_count: lines(status),
    tracked_files: lines(tracked),
  };
}

// Normalize a repo-relative path: drop leading ./ characters and trailing
// slashes, use forward slashes.
const normRel = (p) => p.replace(/\\/g, "/").replace(/^[./]+/, "").replace(/\/+$/, "");

export function makeExcludeMatcher(excludes) {
  const norm = (excludes ?? []).map(normRel).filter(Boolean);
  return (rel) => {
    if (!norm.length) return false;
    const r = normRel(rel);
    return norm.some((ex) => r === ex || r.startsWith(ex + "/"));
  };
}

// Directory entries sorted by name, so the profile does not depend on the order
// a file system happens to list them in.
function readEntries(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function scan(repoPath, overstuffedThreshold, maxList, excludes = [], largeMin = 800, largeCap = 25) {
  const repo = path.resolve(repoPath);
  const isExcluded = makeExcludeMatcher(excludes);
  const profile = {
    repo_path: repo,
    git: gitInfo(repo),
    ecosystems: [],
    root: { intent_files: [], loose_files: [], dirs: [] },
    overstuffed_threshold: overstuffedThreshold,
    overstuffed_dirs: [],
    cruft: { files: [], dirs: [], duplicate_cache_dirs: [] },
    large_source_files: [],
    totals: {},
  };

  const ecosystems = new Set();
  let totalFiles = 0;
  let totalDirs = 0;
  const cacheDirSeen = new Map();
  const missingInit = [];

  // ---- Root inventory --------------------------------------------------
  let rootEntries;
  try {
    rootEntries = readEntries(repo);
  } catch (exc) {
    process.stdout.write(`{"error": ${ascii(JSON.stringify(exc.message))}}`);
    return null;
  }
  for (const entry of rootEntries) {
    const name = entry.name;
    // A caller-supplied exclusion also hides the entry from the root inventory,
    // not only from the walk: otherwise an excluded top-level directory still
    // shows up as a root dir the planner might try to move.
    if (isExcluded(name)) continue;
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && safeIsDir(path.join(repo, name)));
    if (isDir) {
      profile.root.dirs.push(name);
    } else {
      const low = name.toLowerCase();
      if (MANIFEST_ECOSYSTEM.has(low)) ecosystems.add(MANIFEST_ECOSYSTEM.get(low));
      if (isCruft(name)) profile.cruft.files.push("./" + name);
      else if (isIntentFile(name)) profile.root.intent_files.push(name);
      else {
        const loose = { name };
        if (SOURCE_EXTS.has(extOf(name))) {
          const lines = countLines(path.join(repo, name));
          if (lines !== null) loose.lines = lines;
        }
        profile.root.loose_files.push(loose);
      }
    }
  }

  // ---- Walk for per-directory census, cruft, big files, ecosystems -----
  // Top-down, a directory before its children, pruning the directories the
  // census must not descend into.
  const stack = [repo];
  while (stack.length) {
    const dirpath = stack.pop();
    const rel = path.relative(repo, dirpath).split(path.sep).join("/") || ".";
    let entries;
    try { entries = readEntries(dirpath); } catch { continue; }
    const dirnames = [];
    const filenames = [];
    // A symlink pointing at a directory counts as a child directory but is
    // never descended into: what it points at is counted where it lives.
    const linked = new Set();
    for (const e of entries) {
      const isLink = e.isSymbolicLink();
      const isDir = e.isDirectory() || (isLink && safeIsDir(path.join(dirpath, e.name)));
      if (isDir && isLink) linked.add(e.name);
      (isDir ? dirnames : filenames).push(e.name);
    }

    // Note cruft and cache directories, then prune them from the walk.
    const kept = [];
    for (const d of dirnames) {
      const childRel = rel === "." ? d : `${rel}/${d}`;
      // Caller-supplied exclusions (a test tree, say): prune the whole subtree
      // so it never enters the census, overstuffed detection, large-file list,
      // or sample output.
      if (isExcluded(childRel)) continue;
      if (SKIP_DIRS.has(d)) {
        cacheDirSeen.set(d, (cacheDirSeen.get(d) ?? 0) + 1);
        if (CACHE_CRUFT_DIRS.has(d)) profile.cruft.dirs.push(rel === "." ? d : `${rel}/${d}`);
        continue;
      }
      if (isCruft(d)) {
        profile.cruft.dirs.push(rel === "." ? d : `${rel}/${d}`);
        continue;
      }
      kept.push(d);
    }

    totalDirs += kept.length;
    totalFiles += filenames.length;

    // Manifest-based ecosystem sniffing anywhere in the tree.
    let pyCount = 0;
    let hasInit = false;
    for (const fn of filenames) {
      const low = fn.toLowerCase();
      if (MANIFEST_ECOSYSTEM.has(low)) ecosystems.add(MANIFEST_ECOSYSTEM.get(low));
      if (isCruft(fn) && rel !== ".") profile.cruft.files.push(`${rel}/${fn}`);
      // Track unusually large source files (refactor candidates).
      if (SOURCE_EXTS.has(extOf(fn))) {
        const lines = countLines(path.join(dirpath, fn));
        if (lines && lines >= largeMin) {
          profile.large_source_files.push({ path: rel === "." ? fn : `${rel}/${fn}`, lines });
        }
      }
      if (fn.endsWith(".py")) pyCount++;
      if (fn === "__init__.py") hasInit = true;
    }

    // MISSING_INIT: a non-root directory holding .py modules but no
    // __init__.py is not an importable regular package, so the re-export shims
    // the decompose stage leaves behind would not resolve through it. Reported
    // only for repos the manifests call Python (see the gate below).
    if (rel !== "." && pyCount > 0 && !hasInit) {
      missingInit.push({ path: rel, py_files: pyCount });
    }

    // Overstuffed detection: many direct file children plus a hint that the
    // names share prefixes, so a by-feature or by-type split is plausible.
    const nFiles = filenames.length;
    if (nFiles >= overstuffedThreshold && rel !== ".") {
      const stems = new Map();
      let nSource = 0;
      for (const fn of filenames) {
        if (SOURCE_EXTS.has(extOf(fn))) nSource++;
        const token = fn.split(/[_\-.]/, 1)[0].toLowerCase();
        if (token) stems.set(token, (stems.get(token) ?? 0) + 1);
      }
      const common = mostCommon(stems, 8).filter(([, c]) => c >= 2).map(([p, c]) => ({ prefix: p, count: c }));
      profile.overstuffed_dirs.push({
        path: rel,
        file_count: nFiles,
        // source_file_count lets the planner ignore data and ephemera dumps
        // (a 700-file session-state directory, say) and focus on real code.
        source_file_count: nSource,
        subdir_count: kept.length,
        common_prefixes: common,
        sample_files: [...filenames].sort().slice(0, maxList),
      });
    }

    for (let i = kept.length - 1; i >= 0; i--) {
      if (!linked.has(kept[i])) stack.push(path.join(dirpath, kept[i]));
    }
  }

  // ---- Duplicate cache dirs (.pytest_cache next to .pytest-cache) ------
  for (const [a, b] of [[".pytest_cache", ".pytest-cache"]]) {
    if (cacheDirSeen.get(a) && cacheDirSeen.get(b)) profile.cruft.duplicate_cache_dirs.push([a, b]);
  }

  profile.ecosystems = [...ecosystems].sort();
  stableSortDesc(profile.overstuffed_dirs, (d) => d.file_count);
  stableSortDesc(profile.large_source_files, (f) => f.lines);
  profile.large_source_files = profile.large_source_files.slice(0, largeCap);
  profile.totals = {
    root_dirs: profile.root.dirs.length,
    root_intent_files: profile.root.intent_files.length,
    root_loose_files: profile.root.loose_files.length,
    total_files: totalFiles,
    total_dirs: totalDirs,
    overstuffed_dir_count: profile.overstuffed_dirs.length,
    cruft_file_count: profile.cruft.files.length,
    cruft_dir_count: profile.cruft.dirs.length,
  };
  // Language-gated: the package-marker contract is a Python rule, so the key is
  // absent entirely on trees whose manifests say nothing about Python.
  if (profile.ecosystems.includes("python")) {
    missingInit.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    profile.missing_init = missingInit;
  }
  return profile;
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// The n highest counts, highest first, ties in first-seen order.
function mostCommon(counter, n) {
  return [...counter.entries()].map((e, i) => [e, i])
    .sort((a, b) => (b[0][1] - a[0][1]) || (a[1] - b[1]))
    .slice(0, n).map(([e]) => e);
}

// Highest key first, equal keys left in the order they were found.
function stableSortDesc(arr, key) {
  const decorated = arr.map((v, i) => [key(v), i, v]);
  decorated.sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
  arr.length = 0;
  arr.push(...decorated.map((d) => d[2]));
}

// JSON that survives any pipe: every character outside ASCII as a \u escape.
const ascii = (json) => json.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function parseArgs(argv) {
  const args = { repo_path: null, overstuffed: FLAT_MAX_DEFAULT, max_list: 30, large_min: 800, large_cap: 25, exclude: [] };
  const num = (v, flag) => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`${flag} expects an integer, got "${v}"`);
    return n;
  };
  // --flag value and --flag=value both work.
  const words = argv.flatMap((a) => (/^--[a-z-]+=/.test(a) ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a]));
  const value = (i, flag) => {
    if (i >= words.length) throw new Error(`${flag} expects a value`);
    return words[i];
  };
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (a === "--overstuffed") args.overstuffed = num(value(++i, a), a);
    else if (a === "--max-list") args.max_list = num(value(++i, a), a);
    else if (a === "--large-min") args.large_min = num(value(++i, a), a);
    else if (a === "--large-cap") args.large_cap = num(value(++i, a), a);
    else if (a === "--exclude") args.exclude.push(value(++i, a));
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else if (args.repo_path === null) args.repo_path = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  if (args.repo_path === null) throw new Error("repo_path is required");
  return args;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename)) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`repo-scan: ${e.message}\n`);
    process.exitCode = 2;
  }
  if (args) {
    if (!safeIsDir(args.repo_path)) {
      process.stdout.write(`{"error": ${ascii(JSON.stringify(`not a directory: ${args.repo_path}`))}}`);
      process.exitCode = 1;
    } else {
      const profile = scan(args.repo_path, args.overstuffed, args.max_list, args.exclude, args.large_min, args.large_cap);
      // A null profile means scan already wrote its own error payload.
      if (profile) process.stdout.write(ascii(JSON.stringify(profile, null, 2)) + "\n");
    }
  }
}
