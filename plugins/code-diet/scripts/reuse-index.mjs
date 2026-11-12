#!/usr/bin/env node
// What already exists that might cover <thing>: in this repo, and in the other
// checkouts the person has pointed at.
//
// Usage: node reuse-index.mjs "<thing>" [--also <dir>]... [--limit <n>] [--json]
//
// Searched, in order: the repo around the working directory, each directory
// listed under `code-diet.reuse` in git config, and each --also. To list one:
//   git config --global --add code-diet.reuse ~/src/shared-ui
// (--local instead keeps the path to this clone.) Nothing leaves the machine:
// it reads files and git config only.
//
// A candidate is a file: its path, its opening comment or heading, and the
// names it defines at the top level. --limit caps the rows per source (8).
// A listed directory that cannot be read is named under `skipped`, never
// silently dropped. exit 0 unless the query is missing (2).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { SKIP_DIRS } from "./debt.mjs";

export const CONFIG_KEY = "code-diet.reuse";
const EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".rb", ".java", ".kt", ".swift",
  ".sh", ".css", ".scss", ".vue", ".svelte", ".sql", ".md"]);
const MAX_BYTES = 256 * 1024;
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "into"]);
const DEFINES = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class|const|let|def|func|fn)\s+([A-Za-z_$][\w$]*)/gm;
const COMMENT = /^\s*(?:(?:\/\/+|\/\*+|\*+|#+|--|;+|<!--)(?:\s+|$)|"""|''')(.*?)\s*(?:\*\/|-->|"""|''')?\s*$/;
// Opening lines that say nothing about what the file is for.
const NOISE = /^(?:@|eslint|SPDX|copyright)/i;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const FM_DESCRIPTION = /^description:[ \t]*(?:[>|]-?[ \t]*\n[ \t]+)?["']?(.+?)["']?[ \t]*$/m;

export const HERE = "this repo";

const git = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return r.status === 0 ? r.stdout : null;
};

export const termsOf = (query) => query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));

/** Word-overlap score. Deliberately dumb: it ranks candidates for a reader, it does not decide. */
export function score(query, ...fields) {
  const terms = termsOf(query);
  if (terms.length === 0) return 0;
  const text = fields.filter(Boolean).join(" ").toLowerCase();
  let hits = 0;
  for (const term of terms) if (text.includes(term)) hits++;
  return hits / terms.length;
}

/** What a file says it is: a frontmatter description, else its first comment line or heading with words in it, or "" when it opens with code. */
export function describe(text) {
  const fm = FRONTMATTER.exec(text);
  const stated = fm && FM_DESCRIPTION.exec(fm[1]);
  if (stated) return stated[1].slice(0, 160);
  for (const line of (fm ? text.slice(fm[0].length) : text).split("\n", 30)) {
    if (!line.trim() || line.startsWith("#!")) continue;
    const m = COMMENT.exec(line);
    if (!m) return "";
    if (/[A-Za-z]{3}/.test(m[1]) && !NOISE.test(m[1])) return m[1].slice(0, 160);
  }
  return "";
}

export const definesOf = (text) => [...new Set([...text.matchAll(DEFINES)].map((m) => m[1]))];

/** Every file under dir a search should read: what git would commit, or a plain walk where there is no git. */
function filesOf(dir) {
  const listed = git(dir, "-c", "core.quotepath=off", "ls-files", "-z", "--cached", "--others", "--exclude-standard");
  if (listed !== null) return listed.split("\0").filter((f) => f && !f.split("/").some((p) => SKIP_DIRS.has(p)));
  const out = [];
  const walk = (at, rel) => {
    let entries;
    try { entries = fs.readdirSync(at, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(at, e.name), `${rel}${e.name}/`); }
      else if (e.isFile()) out.push(`${rel}${e.name}`);
    }
  };
  walk(dir, "");
  return out;
}

// debt: every query reads every listed file, a cached index when a query takes seconds
export function search(query, source, dir, limit) {
  const terms = termsOf(query);
  const rows = [];
  for (const rel of filesOf(dir)) {
    if (!EXT.has(path.extname(rel))) continue;
    const full = path.join(dir, rel);
    let text;
    try {
      if (fs.statSync(full).size > MAX_BYTES) continue;
      text = fs.readFileSync(full, "utf8");
    } catch { continue; }
    const description = describe(text);
    const defines = definesOf(text);
    const s = score(query, rel, description, defines.join(" "));
    if (s === 0) continue;
    rows.push({
      source, name: rel, kind: "file", description,
      defines: defines.filter((d) => terms.some((t) => d.toLowerCase().includes(t))).slice(0, 8),
      how: `read ${source === HERE ? rel : path.join(dir, rel)}`,
      score: s,
    });
  }
  return rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).slice(0, limit);
}

/** The directories the person listed in git config, as written (git expands a leading ~/). */
export function listed(cwd) {
  return (git(cwd, "config", "--type=path", "--get-all", CONFIG_KEY) ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function main(argv) {
  const also = [];
  let query = "", limit = 8, json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--also") also.push(argv[++i] ?? "");
    else if (a === "--limit") limit = Number(argv[++i]) || limit;
    else if (a === "--json") json = true;
    else if (!a.startsWith("--") && !query) query = a;
  }
  if (!query) { console.error('usage: node reuse-index.mjs "<thing>" [--also <dir>]... [--limit <n>] [--json]'); return 2; }

  const cwd = process.cwd();
  const home = git(cwd, "rev-parse", "--show-toplevel")?.trim() || cwd;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const seen = new Set([real(home)]);
  const results = search(query, HERE, home, limit);
  const searched = [HERE];
  const skipped = [];
  for (const entry of [...listed(cwd), ...also].filter(Boolean)) {
    const dir = path.resolve(home, entry);
    const at = real(dir);
    if (!at || !fs.statSync(at).isDirectory()) { skipped.push(`${entry}: not a directory on this machine`); continue; }
    if (seen.has(at)) continue;
    seen.add(at);
    results.push(...search(query, entry, dir, limit));
    searched.push(entry);
  }

  if (json) { console.log(JSON.stringify({ query, searched, results, skipped })); return 0; }
  if (results.length === 0) console.log(`nothing matches "${query}"`);
  for (const r of results) {
    console.log([`${r.source}: ${r.name}`, `  ${r.description || "(no opening comment)"}`,
      r.defines.length ? `  defines ${r.defines.join(", ")}` : "", `  ${r.how}`].filter(Boolean).join("\n"));
  }
  console.log(`searched: ${searched.join(", ")}`);
  for (const s of skipped) console.log(`not searched: ${s}`);
  if (searched.length === 1 && !skipped.length) console.log(`to search another checkout too: git config --global --add ${CONFIG_KEY} <dir>`);
  return 0;
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = main(process.argv.slice(2));
