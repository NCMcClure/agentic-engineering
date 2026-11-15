#!/usr/bin/env node
// aw hubs: verify the AGENTS.md orientation hubs of a source tree (whole repository, read-only).
//
//   aw hubs [path] [--json] [--exclude PREFIX …]
//
// The contract (references/hubs.md): the root AGENTS.md orients, every non-leaf
// code directory carries a short hub that lists its direct children, and a
// directory with a hub holds no source files of its own.
//
// Two layers. What a hub says about its own directory (its Layout lines, the
// files beside it, its CLAUDE.md) is read by verify-hubs.mjs from what git
// would commit, and reported here under this command's codes and levels. What
// the tree owes as a whole (a root file, a hub in every non-leaf code
// directory, no directory that mixes loose source with code folders, the size
// budgets) is checked here. Where git cannot answer (no repository, or a path
// below its top) every check runs from the files on disk.
import fs from "node:fs";
import path from "node:path";
import { Finding, emit, fail, ioOf, lineCount, parseArgs, posix, readText, realPath, repoRoot, report, runMain, splitLines } from "../lib/common.mjs";
import { budget, defaults, loadConfig } from "../lib/config.mjs";
import { stateOf } from "./twins.mjs";
import { checkHubs } from "./verify-hubs.mjs";

const USAGE = `usage: aw hubs [path] [--json] [--exclude PREFIX …]

Verify the AGENTS.md orientation hubs. Exit 0 clean (also: no source files yet), 1 warnings, 2 critical.

  path              the tree's root (default: the working tree's top)
  --json            one JSON document: { root, hubs, claude_chain, summary, findings }
  --exclude PREFIX  repo-relative prefix to skip (repeatable; the root AGENTS.md skip marker adds more)

  HUB_ROOT_MISSING    warning   the tree has source files but no root AGENTS.md (legacy trees ramp in)
  HUB_ISOLATION       critical  source files sit beside an AGENTS.md (warning until a root AGENTS.md exists)
  HUB_MISSING         warning   a non-leaf code directory carries no AGENTS.md
  HUB_MIXED_DIR       warning   a directory mixes loose source files with code sub-directories
  HUB_STALE_CHILD     warning   a hub lists a child that is not there
  HUB_UNLISTED_CHILD  warning   a hub does not name one of its sub-directories
  CLAUDE_CHAIN        warning   a CLAUDE.md beside a hub with content of its own; and, where the root CLAUDE.md
                                imports @AGENTS.md: a hub without its CLAUDE.md, an orphan CLAUDE.md
  ROOT_SIZE           warning   the root AGENTS.md is over budgets.rootAgentsLines
  HUB_SIZE            warning   a hub is over budgets.hubLines

A Layout line is a bullet that opens with the child's path in a code span:
    - \`server/\` - the runtime; descend for anything that runs in production.

Never walked: dot-directories (so .agents/ and .git/), a legacy .plan/, dependency and build folders, an
archive/, the prefixes given with --exclude, and those of a marker line in the root AGENTS.md:
    <!-- verify-agents-tree: skip generated/ data/fixtures/ -->
In a git repository the marker of verify-hubs.mjs is read as well:
    <!-- verify-hubs: exempt entrypoint.sh; skip generated/ -->`;

/** Folder names that are never walked. */
export const SKIP_DIRS = new Set([
  ".git", ".agents", ".plan", "node_modules", "build", "dist", "target", "out", "third_party", "third-party",
  "vendor", "vendored", "__pycache__", ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache", ".tox",
  ".nox", ".idea", ".vscode", ".next", ".turbo", ".cache", "venv", "virtualenv", "env", ".venv", "archive",
]);
// Package markers are structural glue, not content: a Python package cannot exist without __init__.py.
const PACKAGE_MARKERS = new Set(["__init__.py", "__init__.pyi"]);
const CODE_EXTS = new Set([
  ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".c", ".h", ".cc", ".cpp", ".cxx",
  ".hh", ".hpp", ".hxx", ".rs", ".go", ".java", ".kt", ".kts", ".swift", ".m", ".mm", ".rb", ".php", ".cs", ".fs",
  ".scala", ".clj", ".ex", ".exs", ".erl", ".hrl", ".hs", ".ml", ".mli", ".lua", ".zig", ".nim", ".d", ".jl", ".r",
  ".sh", ".bash", ".zsh", ".ps1", ".sql", ".proto",
]);
const SKIP_MARKER = /<!--\s*verify-agents-tree:\s*skip\s+([^>]+?)\s*-->/;
const HUB = "AGENTS.md";
const TWIN = "CLAUDE.md";

// The child a list item or a table row is about: its leading code span or link.
const LEAD = /^\s*(?:[-*+]\s+|\d+[.)]\s+|\|\s*)(?:\*\*)?(?:`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/;
const CHILD = /^[A-Za-z0-9_.@+-]+(\/[A-Za-z0-9_.@+-]+)*\/?$/;
const FENCE = /^\s*(```|~~~)/;

const read = (file) => readText(file, "") ?? "";
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const exists = (p) => {
  try { fs.statSync(p); return true; } catch { return false; }
};
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const trimSlashes = (s) => s.replace(/^\/+|\/+$/g, "");

/** The folders the root AGENTS.md leaves out with its `verify-agents-tree: skip` marker, resolved. */
export function markerSkips(rootAgents, root) {
  const m = SKIP_MARKER.exec(read(rootAgents));
  if (!m) return new Set();
  return new Set(m[1].split(/\s+/).filter(Boolean).map((e) => realPath(path.join(root, e.replace(/\/+$/, "")))));
}

/** `[line number, the path as written]` of every child a hub's list items and table rows lead with. */
export function listedChildren(text) {
  const out = [];
  let fenced = false;
  splitLines(text).forEach((line, i) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = LEAD.exec(line);
    if (!m) return;
    let written = m[1] || "";
    if (!written) { // a link: its target when it is relative, else its text
      const target = m[3].split("#")[0];
      written = /^[a-z][a-z0-9+.-]*:/i.test(target) ? "" : target;
      if (written.endsWith(`/${HUB}`)) written = written.slice(0, -HUB.length);
    }
    written = written.trim();
    if (written.startsWith("./")) written = written.slice(2);
    // A child is a folder (`name/`), a path, or a file name with an extension; a bare word may be a command.
    const dotted = written.replace(/^\.+|\.+$/g, "").includes(".");
    if (!CHILD.test(written) || written.startsWith("..") || !(written.includes("/") || dotted)) return;
    out.push([i + 1, written]);
  });
  return out;
}

/** The tree on disk: which directories hold source files themselves, which hold some below, and each one's walked children. */
function walkTree(root, skipped) {
  const directCode = new Map();
  const subtreeCode = new Map();
  const children = new Map();
  const walk = (d) => {
    let direct = false;
    const kids = [];
    let names = [];
    try { names = fs.readdirSync(d).sort(byName); } catch { /* unreadable: an empty directory */ }
    for (const name of names) {
      const full = path.join(d, name);
      if (isDir(full)) {
        if (!skipped(full, name)) kids.push(full);
      } else if (CODE_EXTS.has(path.extname(name).toLowerCase()) && !PACKAGE_MARKERS.has(name) && isFile(full)) {
        direct = true;
      }
    }
    directCode.set(d, direct);
    children.set(d, kids);
    let sub = direct;
    for (const k of kids) if (walk(k)) sub = true;
    subtreeCode.set(d, sub);
    return sub;
  };
  const any = walk(root);
  return { any, directCode, subtreeCode, children };
}

/** `[line number, the span as written]` of the hub's bullet that opens with `written` in a code span; `[0, written]` when none does. */
function lineOf(text, written) {
  const bare = (span) => span.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  let fenced = false;
  let found = [0, written];
  splitLines(text).some((line, i) => {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const m = /^[-*+] `([^`]+)`/.exec(line);
      if (m && bare(m[1]) === bare(written)) found = [i + 1, m[1].trim().replace(/^\.\//, "")];
    }
    return found[0] > 0;
  });
  return found;
}

/**
 * What verify-hubs.mjs says about the hubs of the work tree whose top is `root`, as this command's findings; null
 * when git cannot answer for exactly this tree, so the caller checks from the files on disk instead. Hubs in a
 * directory that is never walked (`walked` holds the others, repo-relative) are left out.
 */
function fromGit(root, walked, strict) {
  let res;
  try {
    res = checkHubs(root);
    if (realPath(res.root) !== root) return null;
  } catch {
    return null;
  }
  const out = [];
  const loose = new Map();
  for (const f of res.findings) {
    const dir = path.posix.dirname(f.hub);
    if (!walked.has(dir)) continue;
    if (f.finding === "missing-line") {
      const name = /^child directory (.+)\/ is not named$/.exec(f.detail)?.[1];
      out.push(new Finding("HUB_UNLISTED_CHILD", "warning", f.hub, 0, name
        ? `does not name its sub-directory \`${name}/\`: add a line that opens with it in a code span`
        : f.detail));
    } else if (f.finding === "stale-line") {
      const named = /^(.+) does not exist$/.exec(f.detail)?.[1] ?? "";
      const [line, written] = named ? lineOf(read(path.join(root, f.hub)), named) : [0, ""];
      out.push(new Finding("HUB_STALE_CHILD", "warning", f.hub, line, written ? `lists \`${written}\`, which is not there` : f.detail));
    } else if (f.finding === "loose-code") {
      const file = /^(.+) sits beside the hub/.exec(f.detail)?.[1] ?? f.detail;
      loose.set(dir, [...(loose.get(dir) ?? []), file]);
    } else if (f.finding === "claude-md-not-twin") {
      const at = /^(\S*CLAUDE\.md) /.exec(f.detail)?.[1] ?? (dir === "." ? TWIN : `${dir}/${TWIN}`);
      out.push(new Finding("CLAUDE_CHAIN", "warning", at, 0, f.detail.slice(f.detail.indexOf(" ") + 1)));
    }
  }
  for (const [dir, files] of loose) {
    out.push(new Finding("HUB_ISOLATION", strict ? "critical" : "warning", dir, 0,
      `source files sit directly beside AGENTS.md (${files.join(", ")}): move the code into sub-directories`));
  }
  return out;
}

/**
 * `{ findings: [Finding], hubs: n, claude_chain: boolean }` for the tree at `root`. `excludes` are repo-relative
 * prefixes left out; `cfg` gives the budgets (the defaults without one).
 */
export function verify(root, excludes = [], cfg = null) {
  const config = cfg ?? defaults();
  const findings = [];
  root = realPath(root);
  const rootAgents = path.join(root, HUB);
  const skipPaths = markerSkips(rootAgents, root);
  for (const e of excludes) if (e && trimSlashes(posix(e))) skipPaths.add(realPath(path.join(root, trimSlashes(posix(e)))));
  const skipped = (full, name) => name.startsWith(".") || SKIP_DIRS.has(name) || skipPaths.has(realPath(full));
  const rel = (p) => posix(path.relative(root, p)) || ".";

  const sizeCheck = (hub, isRoot, text) => {
    const lines = lineCount(text);
    const limit = budget(config, isRoot ? "rootAgentsLines" : "hubLines");
    if (lines > limit) {
      findings.push(new Finding(isRoot ? "ROOT_SIZE" : "HUB_SIZE", "warning", rel(hub), 0, `${lines} lines, the budget is ${limit}: ${isRoot
        ? "keep orientation and the rules here; move the why into decisions and memory"
        : "a hub lists its direct children, one line each"}`));
    }
  };

  if (isFile(rootAgents)) sizeCheck(rootAgents, true, read(rootAgents)); // every session loads it, code or no code
  const { any, directCode, subtreeCode, children } = walkTree(root, skipped);
  if (!any) return { findings, hubs: 0, claude_chain: false }; // no code yet: nothing else to check

  const strict = isFile(rootAgents);
  if (!strict) {
    findings.push(new Finding("HUB_ROOT_MISSING", "warning", ".", 0,
      "the tree has source files but no root AGENTS.md: write one (aw setup --plan shows how)"));
  }

  const dirs = [...directCode.keys()];
  const own = fromGit(root, new Set(dirs.map(rel)), strict);
  if (own !== null) findings.push(...own);

  const hubDirs = [];
  for (const d of dirs) {
    const hub = path.join(d, HUB);
    const hasHub = isFile(hub);
    if (hasHub) hubDirs.push(d);
    if (own === null && hasHub && directCode.get(d)) {
      findings.push(new Finding("HUB_ISOLATION", strict ? "critical" : "warning", rel(d), 0,
        "source files sit directly beside AGENTS.md: move the code into sub-directories"));
    }
    const codeKids = children.get(d).filter((c) => subtreeCode.get(c));
    if (codeKids.length && !hasHub) {
      if (directCode.get(d)) {
        findings.push(new Finding("HUB_MIXED_DIR", "warning", rel(d), 0,
          "mixes loose source files with code sub-directories: move the files down a level, then add an AGENTS.md hub"));
      } else {
        findings.push(new Finding("HUB_MISSING", "warning", rel(d), 0, "non-leaf code directory without an AGENTS.md hub"));
      }
    }
    if (!hasHub) continue;

    const text = read(hub);
    if (d !== root) sizeCheck(hub, false, text);
    if (own !== null) continue;
    for (const [n, written] of listedChildren(text)) {
      if (written.includes("*") || written.includes("<")) continue;
      // The root file is prose too: a bullet that leads with a file name is not a child line there.
      if (d === root && !written.includes("/")) continue;
      if (!exists(path.join(d, written.replace(/\/+$/, "")))) {
        findings.push(new Finding("HUB_STALE_CHILD", "warning", rel(hub), n, `lists \`${written}\`, which is not there`));
      }
    }
    for (const kid of codeKids) {
      const name = path.basename(kid).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(?<![\\p{L}\\p{N}_.-])${name}(?![\\p{L}\\p{N}_-])`, "u").test(text)) {
        findings.push(new Finding("HUB_UNLISTED_CHILD", "warning", rel(hub), 0, `does not name its code sub-directory \`${path.basename(kid)}/\``));
      }
    }
  }

  // The chain is opted into by a root CLAUDE.md whose own text imports the root AGENTS.md. A symlink there opts into
  // nothing: `aw twins` and the doctor check the twins of a repository that is set up.
  const rootTwin = stateOf(path.join(root, TWIN));
  const chain = rootTwin === "stub" || (rootTwin === "other" && isFile(path.join(root, TWIN)) && read(path.join(root, TWIN)).includes("@AGENTS.md"));
  if (chain) {
    for (const d of hubDirs) {
      const claude = path.join(d, TWIN);
      const state = stateOf(claude);
      if (state === "none") {
        findings.push(new Finding("CLAUDE_CHAIN", "warning", rel(d), 0, "AGENTS.md has no sibling CLAUDE.md (run `aw twins`)"));
      } else if (own === null && d !== root && state === "other") {
        findings.push(new Finding("CLAUDE_CHAIN", "warning", rel(claude), 0, "must be a symlink to AGENTS.md, or exactly '@AGENTS.md'"));
      }
    }
    for (const d of dirs) {
      if (stateOf(path.join(d, TWIN)) !== "none" && !isFile(path.join(d, HUB))) {
        findings.push(new Finding("CLAUDE_CHAIN", "warning", rel(path.join(d, TWIN)), 0, "orphan CLAUDE.md (no sibling AGENTS.md)"));
      }
    }
  }
  return { findings, hubs: hubDirs.length, claude_chain: chain };
}

/** The given path, else the working tree's top (found by its .git), else the working directory. */
export function findRoot(given, cwd) {
  if (given) return realPath(path.resolve(cwd, given));
  return realPath(repoRoot(cwd) ?? cwd);
}

/** `--exclude a b` names two prefixes: every value up to the next option belongs to the flag. */
function spreadExcludes(argv) {
  const out = [];
  let taking = false;
  for (const arg of argv) {
    if (arg === "--exclude") {
      taking = true;
      continue;
    }
    if (arg.startsWith("-")) taking = false;
    if (taking) out.push("--exclude", arg);
    else out.push(arg);
  }
  return out;
}

export async function main(argv, io) {
  io = ioOf(io);
  const { values, positionals, help } = parseArgs(spreadExcludes(argv), { json: { type: "boolean" }, exclude: { type: "string", multiple: true } });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  if (positionals.length > 1) return fail(io, "aw hubs: one path at most (aw hubs --help)");
  const root = findRoot(positionals[0], io.cwd);
  if (!isDir(root)) return fail(io, `aw hubs: ${posix(root)} is not a directory`);
  const cfg = loadConfig(root);
  const res = verify(root, values.exclude ?? [], cfg);
  const extra = { root: posix(root), hubs: res.hubs, claude_chain: res.claude_chain };
  const chain = res.claude_chain ? "checked" : "not opted in";
  return report(io, res.findings, { json: values.json === true, title: `hubs: ${res.hubs}, CLAUDE.md chain ${chain}`, extra, cfg });
}

runMain(import.meta.url, main);
