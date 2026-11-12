#!/usr/bin/env node
// The size and the work list of a whole-repo system-map sweep, which
// /marvelous-miro:diagrams-sync and its workflow read. It runs the checker
// beside it (system-map.mjs) without --changed and groups the findings by the
// module that owns each path: one unit per declared node, one per directory of
// source files no node owns yet. `large` says whether the repo is big enough
// that the sweep should fan out (the workflow) rather than run in one session.
//
// Usage: node map-sweep.mjs [--root DIR]              the summary and every unit
//        node map-sweep.mjs [--root DIR] --unit DIR   one unit: its files, nested modules, and findings
// stdout: one JSON object. Exit 0 on a report, 1 when the repo has no system
// map config, 2 when the checker throws.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CONFIG, extract, run } from "./system-map.mjs";

// debt: thresholds are a first guess, retune when a sweep's report shows the inline pass would have done.
export const LARGE = { modules: 8, files: 150 };
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx|py)$/;
// Findings about the map as a whole rather than any one module's files.
const GLOBAL = new Set(["MAP_STALE", "MAP_MISSING", "BOARD_BEHIND"]);

const within = (p, dir) => dir === "." || p === dir || p.startsWith(`${dir}/`);

/** The declared node whose directory is the nearest ancestor of a path, as the checker resolves it. */
function owner(byDir, p) {
  for (let d = path.posix.dirname(p); ; d = path.posix.dirname(d)) {
    if (byDir.has(d)) return byDir.get(d);
    if (d === "." || d === "/" || d === "") return null;
  }
}

const tally = (findings) => {
  const codes = {};
  for (const f of findings) codes[f.code] = (codes[f.code] ?? 0) + 1;
  return codes;
};

/** One checker pass with what the sweep reads from it, or null when the repo has no system map config. */
function survey(root) {
  const report = run(root);
  if (!report.config) return null;
  const ex = extract(root);
  const source = [...ex.texts.keys()].filter((f) => SOURCE.test(f));
  const whole = new Set([CONFIG, ex.cfg.map]);
  /** A finding's unit: a node id, `dir:<path>` for source no node owns, or null for the map and the config. */
  const keyOf = (f) => {
    if (GLOBAL.has(f.code) || whole.has(f.path)) return null;
    if (f.code === "NODE_MISSING") return `dir:${f.path}`;
    return owner(ex.byDir, f.path) ?? `dir:${path.posix.dirname(f.path)}`;
  };
  const warnings = report.findings.filter((f) => f.severity === "warning");
  return { report, ex, source, keyOf, warnings, fromConfig: new Set(Object.keys(ex.cfg.nodes ?? {})) };
}

export function sweep(root) {
  const s = survey(root);
  if (!s) return null;
  const grouped = new Map();
  for (const f of s.warnings) {
    const k = s.keyOf(f);
    if (k !== null) grouped.set(k, [...(grouped.get(k) ?? []), f]);
  }
  const units = [], configNodes = [];
  for (const n of s.ex.byId.values()) {
    if (n.path === null) continue;
    const found = grouped.get(n.id) ?? [];
    const files = s.source.filter((f) => owner(s.ex.byDir, f) === n.id).length;
    const config = s.fromConfig.has(n.id);
    const u = { dir: n.path, node: n.id, title: n.title, layer: n.layer, entry: config ? null : n.file, files, findings: found.length, codes: tally(found) };
    (config ? configNodes : units).push(u);
  }
  const loose = s.source.filter((f) => !owner(s.ex.byDir, f));
  for (const d of [...new Set(loose.map((f) => path.posix.dirname(f)))]) {
    const found = grouped.get(`dir:${d}`) ?? [];
    const files = loose.filter((f) => path.posix.dirname(f) === d).length;
    units.push({ dir: d, node: null, title: null, layer: null, entry: null, files, findings: found.length, codes: tally(found) });
  }
  units.sort((a, b) => a.dir.localeCompare(b.dir));
  const declared = units.filter((u) => u.node).length, looseDirs = units.length - declared;
  const modules = units.length + configNodes.length, files = s.source.length;
  return {
    config: s.report.config,
    large: modules >= LARGE.modules || files >= LARGE.files,
    reason: `${modules} module(s) (${declared} annotated, ${configNodes.length} in the config, ${looseDirs} unowned director${looseDirs === 1 ? "y" : "ies"}), `
      + `${files} source file(s); the sweep fans out from ${LARGE.modules} modules or ${LARGE.files} files`,
    totals: { modules, declared, config: configNodes.length, loose: looseDirs, sourceFiles: files, warnings: s.warnings.length, byCode: tally(s.warnings) },
    units,
    configNodes,
    global: s.report.findings.filter((f) => s.keyOf(f) === null).map(({ code, severity, path: p, message }) => ({ code, severity, path: p, message })),
  };
}

/** One unit as a writer or a reviewer needs it: the source it owns, the modules nested in it, and its findings. */
export function unit(root, dir) {
  const s = survey(root);
  if (!s) return null;
  const d = dir.replace(/\/+$/, "") || ".";
  const id = s.ex.byDir.get(d) ?? null;
  const mine = (f) => (id ? owner(s.ex.byDir, f) === id : !owner(s.ex.byDir, f) && within(f, d));
  const findings = s.warnings.filter((f) => {
    if (s.keyOf(f) === null) return false;
    return f.code === "NODE_MISSING" ? within(f.path, d) : mine(f.path);
  });
  return {
    dir: d,
    node: id,
    entry: id ? s.ex.byId.get(id).file : null,
    files: s.source.filter(mine),
    nested: [...s.ex.byDir.keys()].filter((k) => k !== d && within(k, d)).sort(),
    findings: findings.map(({ code, path: p, line, message }) => ({ code, path: p, line, message })),
  };
}

function main(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  let root = flag("--root");
  if (!root) {
    try { root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { root = process.cwd(); }
  }
  root = path.resolve(root);
  try {
    const dir = flag("--unit");
    const out = dir === null ? sweep(root) : unit(root, dir);
    if (!out) {
      console.log(JSON.stringify({ config: null, message: `no ${CONFIG} here; the person runs /marvelous-miro:diagrams-init to set the map up` }));
      return 1;
    }
    console.log(JSON.stringify(out, null, 1));
    return 0;
  } catch (e) {
    console.error(`map-sweep: ${e.message}`);
    return 2;
  }
}

// realpath: a plugin cached under a symlinked folder would otherwise never match and print nothing.
const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? ""); } catch { return null; } })();
if (invoked === import.meta.filename) process.exitCode = main(process.argv.slice(2));
