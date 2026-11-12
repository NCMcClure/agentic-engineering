#!/usr/bin/env node
// Drift listing: a fast, read-only index of the cross-cutting drift items, so
// an agent can triage WHICH drift files to open rather than reading them all.
//
// Lives in `.agents/plan/progress/` and roots itself there, reading the sibling
// `drift/` directory's `drift-*.md` files. Node 22 stdlib only; never writes.
// `build-assess-drift` owns advancing a drift item's status; this only reports.
//
// Each drift file carries greppable frontmatter (the format owned by
// `build-next-issue`):
//
//     ---
//     id: D1
//     kind: defect | smell | checkpoint-bug | note
//     surfaced: 2026-05-31 (01-03)
//     where: <spec/plan/code location>
//     route: spec-edit | build-improve-architecture | follow-up issue #NNN
//     status: open | routed | resolved | by-design | human-or-future
//     ---
//     # <Short title>
//
// `status:` is the drift lifecycle. `open` and `routed` are the actionable set
// (recorded-but-untriaged, and handed-off-to-an-issue); `resolved`, `by-design`
// (re-assessed as intentional, never a real defect), and `human-or-future`
// (parked for a human decision or deferred work) are terminal. A status may
// carry a trailing annotation of how and when it was settled, for example
// `resolved (drift-triage 2026-06-06, #376)`: only the leading keyword counts.
//
// Usage:
//
//     drift-status.mjs [--status S [S ...]] [--open] [--json]
//
//     (no args)        every drift item as an aligned table plus a counts line
//     --open           shortcut for `--status open routed` (the actionable set)
//     --status open …  only items whose status is one of the given values
//     --json           the items as a JSON array instead
//
// Exit codes: 0 = listed (even at zero items); 2 = bad usage.
import fs from "node:fs";
import path from "node:path";

const PROGRESS_ROOT = import.meta.dirname; // .agents/plan/progress/
const DRIFT_DIR = path.join(PROGRESS_ROOT, "drift");

// The drift lifecycle vocabulary (owned by build-next-issue). CORE is always
// shown in the summary so "is there work?" reads at a glance even at zero; the
// terminal outcomes beyond it appear only when present. ACTIONABLE is --open.
const CORE = ["open", "routed", "resolved"];
const STATUSES = ["open", "routed", "resolved", "by-design", "human-or-future"];
const ACTIONABLE = ["open", "routed"];
const FIELDS = ["id", "kind", "surfaced", "where", "route", "status"];

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const KV_RE = /^([A-Za-z_-]+):\s*(.*)$/;
const H1_RE = /^#\s+(.+?)\s*$/m;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * Drop one matched pair of surrounding quotes. Frontmatter scalars are
 * sometimes written as `status: "resolved"` (valid YAML) and the raw quotes
 * must not leak into the value.
 */
const unquote = (v) => (v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'") ? v.slice(1, -1).trim() : v);

/**
 * The leading status keyword, lowercased. Drift files routinely annotate a
 * status with how and when it was settled, so classify on the first token
 * rather than the whole string. An empty status is the sentinel "?".
 */
export const statusKey = (status) => (status.trim() ? status.trim().split(/\s+/)[0].toLowerCase() : "") || "?";

/**
 * The frontmatter fields and title of one drift file. Every FIELDS key is
 * present (missing ones as ""), plus `title` and `file`. A file without
 * parseable frontmatter still returns a row, flagged with status "?" so it
 * surfaces in the listing rather than vanishing silently.
 */
export function parseDriftFile(file, text) {
  const item = Object.fromEntries(FIELDS.map((k) => [k, ""]));
  item.file = file;
  item.title = "";

  const m = FM_RE.exec(text);
  if (!m) { item.status = "?"; return item; }

  for (const line of m[1].split("\n")) {
    const kv = KV_RE.exec(line.trim());
    if (kv && FIELDS.includes(kv[1])) item[kv[1]] = unquote(kv[2].trim());
  }
  item.title = H1_RE.exec(text.slice(m[0].length))?.[1]?.trim() ?? "";
  return item;
}

function collect(statuses) {
  if (!isDir(DRIFT_DIR)) return [];
  const names = fs.readdirSync(DRIFT_DIR).filter((n) => n.startsWith("drift-") && n.endsWith(".md")).sort();
  let items = names.map((n) => parseDriftFile(n, fs.readFileSync(path.join(DRIFT_DIR, n), "utf8")));
  if (statuses) items = items.filter((it) => statuses.includes(statusKey(it.status)));
  // Actionable first (open, then routed), terminal outcomes after, then by id.
  const rank = (s) => { const i = STATUSES.indexOf(statusKey(s)); return i === -1 ? 9 : i; };
  return items.sort((a, b) => rank(a.status) - rank(b.status)
    || (a.id || "~").localeCompare(b.id || "~") || a.file.localeCompare(b.file));
}

const truncate = (v, w) => (v.length <= w ? v : `${v.slice(0, w - 1)}…`);

function printTable(items) {
  if (!items.length) { console.log("No drift items."); return; }

  const cols = [["id", "ID", 5], ["status", "STATUS", 8], ["kind", "KIND", 14],
    ["where", "WHERE", 30], ["route", "ROUTE", 24], ["file", "FILE", 36]];
  console.log(cols.map(([, name, w]) => name.padEnd(w)).join("  "));
  console.log(cols.map(([, , w]) => "-".repeat(w)).join("  "));
  for (const it of items) console.log(cols.map(([key, , w]) => truncate(it[key] ?? "", w).padEnd(w)).join("  "));

  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const unknown = {};
  let malformed = 0; // no parseable frontmatter at all
  for (const it of items) {
    const sk = statusKey(it.status);
    if (sk in counts) counts[sk]++;
    else if (sk === "?") malformed++;
    else unknown[sk] = (unknown[sk] ?? 0) + 1;
  }
  const parts = CORE.map((s) => `${counts[s]} ${s}`);
  parts.push(...STATUSES.filter((s) => !CORE.includes(s) && counts[s]).map((s) => `${counts[s]} ${s}`));
  parts.push(...Object.keys(unknown).sort().map((k) => `${unknown[k]} ${k}`));
  if (malformed) parts.push(`${malformed} malformed`);
  console.log(`\n${items.length} item${items.length === 1 ? "" : "s"}: ${parts.join(", ")}`);
}

export function main(argv) {
  let statuses = null;
  let json = false;
  let openOnly = false;
  const wanted = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") { json = true; continue; }
    if (argv[i] === "--open") { openOnly = true; continue; }
    if (argv[i] === "--status") { while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) wanted.push(argv[++i]); continue; }
    console.error(`drift-status.mjs: unknown argument '${argv[i]}'`);
    return 2;
  }
  if (openOnly) statuses = ACTIONABLE;
  else if (wanted.length) statuses = wanted;

  if (!isDir(DRIFT_DIR)) {
    // Not an error: a workspace may simply have no drift yet.
    process.stderr.write(`No drift directory at ${DRIFT_DIR}, nothing to list.\n`);
    console.log(json ? "[]" : "No drift items.");
    return 0;
  }

  const items = collect(statuses);
  if (json) console.log(JSON.stringify(items, null, 2));
  else printTable(items);
  return 0;
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
