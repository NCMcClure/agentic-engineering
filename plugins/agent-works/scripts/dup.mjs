#!/usr/bin/env node
// aw dup: a rule stated in more than one place.
//
//   aw dup [--json] [--min-words N] [paths…]
//
// A rule written twice is two rules the day one copy changes. This finds runs
// of the same words shared between the rule surfaces of a project: the root
// AGENTS.md, the hubs, .agents/README.md, the briefs, and the memories of type
// decision.
//
// How: each file's prose is reduced to lower-case words (code fences,
// frontmatter, link targets and punctuation dropped), cut into shingles of
// `dup.shingleWords` words, and shingles two files share are joined into runs.
import fs from "node:fs";
import path from "node:path";
import { Finding, emit, intArg, ioOf, markdownFiles, parseArgs, parseFrontmatter, projectRoot, readText, rel, report, runMain, splitLines } from "../lib/common.mjs";
import { configPath, loadConfig } from "../lib/config.mjs";

const USAGE = `usage: aw dup [--json] [--min-words N] [paths…]

Find a rule stated in more than one place: runs of the same words shared between the rule surfaces of a project
(the root AGENTS.md, the hubs, .agents/README.md, the briefs, and the memories of type decision).

  paths          compare these files instead of the project's rule surfaces
  --min-words N  shortest shared run that is reported (default: dup.minWords, 14)
  --json         one JSON document: { surfaces, summary, findings }

  DUP_RULE  warning  a run of at least dup.minWords consecutive words (default 14) that two files share; reported
                     once per pair of places as file:line pairs

Tune in .agents/agent-works.json: dup.shingleWords (default 12), dup.minWords, and dup.ignore (regular expressions;
a line that matches one is not read). Keep one copy, and make the other a link to it.`;

const WORD = /[a-z0-9]+(?:['’][a-z]+)?/g;
const FENCE = /^\s*(```|~~~)/;

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byParts = (a, b) => {
  const [x, y] = [a.split(path.sep), b.split(path.sep)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return byName(x[i], y[i]);
  return x.length - y.length;
};
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/** Every Markdown file under a folder, to its depth, in path order. */
function markdownUnder(dir) {
  const out = [];
  const walk = (d) => {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    for (const name of names) {
      const full = path.join(d, name);
      if (isDir(full)) walk(full);
      else if (name.endsWith(".md")) out.push(full);
    }
  };
  walk(dir);
  return out.sort(byParts);
}

/** The files that state rules. */
export function surfaces(root, cfg) {
  const out = [];
  const add = (p) => {
    if (isFile(p) && !out.includes(p)) out.push(p);
  };
  add(path.join(root, "AGENTS.md"));
  for (const md of markdownFiles(root)) if (path.basename(md) === "AGENTS.md") add(md);
  add(path.join(root, ".agents", "README.md"));
  markdownUnder(configPath(cfg, root, "briefs")).forEach(add);
  for (const p of markdownUnder(configPath(cfg, root, "memory"))) {
    if (path.basename(p) === "INDEX.md") continue;
    const [fields] = parseFrontmatter(readText(p, "") ?? "");
    if (fields && fields.type === "decision") add(p);
  }
  return out;
}

/** `[word, line number]` of a file's prose. `ignore` holds regular expressions: a line one of them matches is not read. */
export function wordsOf(text, ignore = []) {
  const out = [];
  const skip = ignore.flatMap((source) => {
    try { return [new RegExp(source)]; } catch { return []; }
  });
  let fenced = false;
  let inFront = text.startsWith("---");
  splitLines(text).forEach((raw, i) => {
    if (inFront) {
      if (i > 0 && raw.trim() === "---") inFront = false;
      return;
    }
    if (FENCE.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced || raw.trimStart().startsWith("<!--") || skip.some((re) => re.test(raw))) return;
    const line = raw.replace(/\]\([^)]*\)/g, "]"); // a link's target is an address, not prose
    for (const m of line.toLowerCase().matchAll(WORD)) out.push([m[0], i + 1]);
  });
  return out;
}

/** Maximal runs of words two word lists share: `[start in a, start in b, length in words]`, longest first. */
export function runsBetween(a, b, size) {
  if (a.length < size || b.length < size) return [];
  const wa = a.map(([w]) => w);
  const wb = b.map(([w]) => w);
  const index = new Map();
  for (let i = 0; i <= wa.length - size; i++) {
    const key = wa.slice(i, i + size).join(" ");
    index.set(key, [...(index.get(key) ?? []), i]);
  }
  const hits = new Set();
  const pairs = [];
  for (let j = 0; j <= wb.length - size; j++) {
    for (const i of index.get(wb.slice(j, j + size).join(" ")) ?? []) {
      if (!hits.has(`${i},${j}`)) {
        hits.add(`${i},${j}`);
        pairs.push([i, j]);
      }
    }
  }
  pairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const runs = [];
  for (const [i, j] of pairs) {
    if (hits.has(`${i - 1},${j - 1}`)) continue; // not the start of its run
    let n = 1;
    while (hits.has(`${i + n},${j + n}`)) n++;
    runs.push([i, j, n + size - 1]);
  }
  // One report per place: drop a run that lies inside a longer one on either side (repeated boilerplate).
  runs.sort((x, y) => y[2] - x[2]);
  const kept = [];
  for (const [i, j, n] of runs) {
    if (kept.some(([ki, kj, kn]) => (ki <= i && i < ki + kn) || (kj <= j && j < kj + kn))) continue;
    kept.push([i, j, n]);
  }
  return kept;
}

const whole = (value, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n ? n : fallback;
};

/** The DUP_RULE findings between the project's rule surfaces, or between `paths` (repo-relative) when given. */
export function findings(root, cfg = null, { paths = null, minWords = null } = {}) {
  const config = cfg ?? loadConfig(root);
  const opts = config.dup || {};
  const size = Math.max(4, whole(opts.shingleWords, 12));
  const least = Math.max(size, whole(minWords, whole(opts.minWords, 14)));
  const ignore = (opts.ignore || []).map(String);
  const files = paths?.length ? paths.map((p) => path.join(root, p)) : surfaces(root, config);
  const docs = files.filter(isFile).map((f) => [f, wordsOf(readText(f, "") ?? "", ignore)]);
  const out = [];
  for (let x = 0; x < docs.length; x++) {
    for (let y = x + 1; y < docs.length; y++) {
      const [fa, a] = docs[x];
      const [fb, b] = docs[y];
      for (const [i, j, n] of runsBetween(a, b, size)) {
        if (n < least) continue;
        const excerpt = a.slice(i, i + Math.min(n, 12)).map(([w]) => w).join(" ");
        out.push(new Finding("DUP_RULE", "warning", rel(fa, root), a[i][1],
          `${n} words also in ${rel(fb, root)}:${b[j][1]}: "${excerpt}…" (keep one copy, link to it from the other)`));
      }
    }
  }
  return out;
}

export async function main(argv, io) {
  io = ioOf(io);
  const { values, positionals, help } = parseArgs(argv, { json: { type: "boolean" }, "min-words": { type: "string" } });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  const root = projectRoot(io.cwd);
  const cfg = loadConfig(root);
  const found = findings(root, cfg, { paths: positionals, minWords: intArg(values["min-words"], "--min-words") });
  const n = positionals.length || surfaces(root, cfg).length;
  return report(io, found, { json: values.json === true, title: `dup: ${n} rule surfaces`, extra: { surfaces: n }, cfg });
}

runMain(import.meta.url, main);
