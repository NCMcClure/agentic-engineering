#!/usr/bin/env node
// The structure gate: one graded reading of a repo's shape, for a stage to pass
// or fail on. It derives nothing itself. `repo-scan.mjs` says what is messy,
// `verify-hubs.mjs` says where the AGENTS.md hubs disagree with the tree, and
// this file gives each finding a severity and turns the worst one into an exit
// code.
//
//   CRITICAL  fails a stage
//     MISSING_INIT        a directory under the subtree holds .py modules and no
//                         __init__.py (Python repos only): imports and re-export
//                         shims that go through it will not resolve
//     HUB_LOOSE_CODE      a source file sits beside a hub. WARNING while the repo
//                         has no root AGENTS.md: a tree that never had hubs is
//                         not failed for lacking them
//   WARNING   reported, never fails a stage
//     HUB_MISSING_LINE    a hub does not name one of its child directories
//     HUB_STALE_LINE      a hub names a path that is gone
//     HUB_MISSING         a directory whose children hold code has no hub
//     CLAUDE_MD_NOT_TWIN  a CLAUDE.md beside a hub has content of its own
//     FLAT_DIR_BLOAT      a directory at or over --flat-max source files
//     CRUFT_PRESENT       a backup, old, copy or .orig file to quarantine
//   INFO      for the record
//     OVERSIZED_MODULE    a source file at or over --module-max lines
//     EPHEMERA_UNIGNORED  a build artifact or stray cache directory to gitignore
//
// --strict is for the stage that has just written the hubs: HUB_MISSING_LINE,
// HUB_STALE_LINE and HUB_LOOSE_CODE are then CRITICAL whatever the root holds,
// because an inconsistency in hubs written a moment ago is that stage's own
// mistake. HUB_MISSING and CLAUDE_MD_NOT_TWIN stay warnings: the first is a
// directory the plan chose not to hub, the second is the owner's file.
//
// Usage:
//   node verify-structure.mjs [repo_path] [--subtree src] [--flat-max N]
//        [--module-max 1500] [--exclude PATH]... [--strict] [--json]
//
// repo_path defaults to the current directory. The scan's findings are kept to
// --subtree (default `src`; pass --subtree "" for the whole repo). Hub findings
// are always whole-repo: the root hub and its twins are facts about the repo,
// not about a subtree. --exclude prunes a path prefix from both. Outside a git
// work tree the hub checks are skipped and a note says so.
//
// --json prints {root, subtree, strict, hubs, notes, summary, findings}, each
// finding {severity, check, path, message}. Exit 0 clean or INFO only, 1 with
// warnings, 2 with a critical finding or a usage error (reason on stderr).
// Node 22 stdlib only.
import fs from "node:fs";
import path from "node:path";
import { FLAT_MAX_DEFAULT, scan } from "./repo-scan.mjs";
import { checkHubs } from "./verify-hubs.mjs";

/** Each check's severity before the root-hub ramp and --strict are applied. */
export const LADDER = Object.freeze({
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
const HUB_CHECKS = Object.freeze({
  "loose-code": "HUB_LOOSE_CODE",
  "missing-line": "HUB_MISSING_LINE",
  "stale-line": "HUB_STALE_LINE",
  "missing-hub": "HUB_MISSING",
  "claude-md-not-twin": "CLAUDE_MD_NOT_TWIN",
});
// What --strict raises to CRITICAL.
const STRICT = new Set(["HUB_LOOSE_CODE", "HUB_MISSING_LINE", "HUB_STALE_LINE"]);
const RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 };
// Caches every toolchain ignores already: naming each one is noise.
const STD_CACHES = new Set(["__pycache__", ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache", ".tox", ".nox", ".cache"]);

const norm = (p) => String(p).replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
const under = (rel, prefix) => !prefix || rel === prefix || rel.startsWith(`${prefix}/`);

/**
 * The severity of one hub finding.
 * @param {string} finding A finding name from verify-hubs.mjs.
 * @param {{ rootHub: boolean, strict: boolean }} state Whether the repo has a root AGENTS.md, and whether --strict is on.
 * @returns {{ check: string, severity: "CRITICAL"|"WARNING"|"INFO" }}
 */
export function gradeHubFinding(finding, { rootHub, strict }) {
  const check = HUB_CHECKS[finding] ?? `HUB_${finding.toUpperCase().replace(/-/g, "_")}`;
  if (strict && STRICT.has(check)) return { check, severity: "CRITICAL" };
  if (check === "HUB_LOOSE_CODE" && !rootHub) return { check, severity: "WARNING" };
  return { check, severity: LADDER[check] ?? "WARNING" };
}

/**
 * Grade the repo at `repo`.
 * @param {string} repo
 * @param {{ subtree?: string, flatMax?: number|null, moduleMax?: number, excludes?: string[], strict?: boolean }} [options]
 */
export function verifyStructure(repo, { subtree = "src", flatMax = null, moduleMax = 1500, excludes = [], strict = false } = {}) {
  const root = path.resolve(repo);
  const scope = norm(subtree);
  const skip = excludes.map(norm).filter(Boolean);
  const excluded = (rel) => skip.some((prefix) => under(rel, prefix));
  const findings = [];
  const notes = [];
  const add = (check, severity, where, message) => findings.push({ severity, check, path: where, message });

  const profile = scan(root, flatMax ?? FLAT_MAX_DEFAULT, 30, skip, moduleMax, Infinity);
  if (!profile) throw new Error(`cannot read ${root}`);
  const limit = profile.overstuffed_threshold;

  for (const d of profile.missing_init ?? []) {
    // The subtree's own root is a source root, not a package.
    if (scope && (d.path === scope || !under(d.path, scope))) continue;
    add("MISSING_INIT", LADDER.MISSING_INIT, d.path, `${d.py_files} .py module(s) and no __init__.py: not an importable package, so imports and shims that go through it will break`);
  }
  for (const d of profile.overstuffed_dirs) {
    if (!under(d.path, scope) || d.source_file_count < limit) continue;
    const clusters = d.common_prefixes.map((p) => `${p.prefix}*(${p.count})`).join(", ") || "no obvious prefix clusters";
    add("FLAT_DIR_BLOAT", LADDER.FLAT_DIR_BLOAT, d.path, `${d.source_file_count} source files (limit ${limit}): split into subdirectories by feature or type; clusters: ${clusters}`);
  }
  for (const f of profile.large_source_files) {
    if (under(f.path, scope)) add("OVERSIZED_MODULE", LADDER.OVERSIZED_MODULE, f.path, `${f.lines} lines (limit ${moduleMax}): a candidate to decompose`);
  }
  for (const f of profile.cruft.files.map(norm)) {
    if (under(f, scope)) add("CRUFT_PRESENT", LADDER.CRUFT_PRESENT, f, "looks like cruft (backup, old, copy, .orig): quarantine it under archive/ for a person to review, never delete it");
  }
  for (const d of profile.cruft.dirs) {
    if (!STD_CACHES.has(path.posix.basename(d))) add("EPHEMERA_UNIGNORED", LADDER.EPHEMERA_UNIGNORED, d, "a build artifact or a stray cache directory: add it to .gitignore");
  }
  for (const pair of profile.cruft.duplicate_cache_dirs) {
    add("EPHEMERA_UNIGNORED", LADDER.EPHEMERA_UNIGNORED, pair.join(" / "), "two cache directories for one tool: keep one and gitignore it");
  }

  let hubs = null;
  if (profile.git.is_git) {
    const result = checkHubs(root, { requireHubs: true });
    const state = { rootHub: result.hubs.includes("AGENTS.md"), strict };
    hubs = result.hubs.length;
    for (const f of result.findings) {
      if (excluded(path.posix.dirname(f.hub))) continue;
      const { check, severity } = gradeHubFinding(f.finding, state);
      add(check, severity, f.hub, f.detail);
    }
  } else {
    notes.push("hub checks skipped: not a git work tree");
  }

  findings.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.check < b.check ? -1 : a.check > b.check ? 1 : 0) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const count = (severity) => findings.filter((f) => f.severity === severity).length;
  return {
    root, subtree: scope, strict, hubs, notes,
    summary: { critical: count("CRITICAL"), warning: count("WARNING"), info: count("INFO") },
    findings,
  };
}

/** 0 clean or INFO only, 1 warnings, 2 a critical finding. */
export const exitCodeOf = (summary) => (summary.critical ? 2 : summary.warning ? 1 : 0);

export function parseArgs(argv) {
  const args = { repo: null, subtree: "src", flatMax: null, moduleMax: 1500, excludes: [], strict: false, json: false };
  const words = argv.flatMap((a) => (/^--[a-z-]+=/.test(a) ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a]));
  const value = (i, flag) => {
    if (i >= words.length) throw new Error(`${flag} expects a value`);
    return words[i];
  };
  const int = (v, flag) => {
    if (!/^\d+$/.test(v)) throw new Error(`${flag} expects a whole number, got "${v}"`);
    return Number(v);
  };
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (a === "--subtree") args.subtree = value(++i, a);
    else if (a === "--flat-max") args.flatMax = int(value(++i, a), a);
    else if (a === "--module-max") args.moduleMax = int(value(++i, a), a);
    else if (a === "--exclude") args.excludes.push(value(++i, a));
    else if (a === "--strict") args.strict = true;
    else if (a === "--json") args.json = true;
    else if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
    else if (args.repo === null) args.repo = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return args;
}

/** The CLI: prints the report, returns the exit code. */
export function main(argv = process.argv.slice(2)) {
  let args;
  try { args = parseArgs(argv); } catch (e) { console.error(`verify-structure: ${e.message}`); return 2; }
  const repo = args.repo ?? process.cwd();
  let isDir = false;
  try { isDir = fs.statSync(repo).isDirectory(); } catch { /* reported below */ }
  if (!isDir) { console.error(`verify-structure: not a directory: ${repo}`); return 2; }

  const report = verifyStructure(repo, args);
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`structure of ${report.root} (${report.subtree ? `scan kept to ${report.subtree}/` : "whole repo"}${report.strict ? ", strict" : ""})`);
    for (const f of report.findings) console.log(`${f.severity.padEnd(8)} ${f.check}  ${f.path}: ${f.message}`);
    for (const n of report.notes) console.log(`note: ${n}`);
    const { critical, warning, info } = report.summary;
    console.log(`${critical} critical, ${warning} warning, ${info} info`);
  }
  return exitCodeOf(report.summary);
}

const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(import.meta.filename); } catch { return false; } })();
if (invoked) process.exitCode = main();
