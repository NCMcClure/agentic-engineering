#!/usr/bin/env node
// The system map: the code declares its modules and their calls in `@system`
// comment lines, this script extracts them into a committed, diffable map
// (default `diagrams/system-map.json`), and checks the map against the code.
// The grammar is in skills/diagrams-sync/references/grammar.md. Reads
// `.agents/system-map.json` at the root of the repo it is pointed at (--root,
// else the git top level of the current directory); a repo without it has not
// opted in, and the check prints one line and exits 0.
//
// Checks:
//   MAP_MISSING / MAP_STALE   the committed map is absent, or differs from what
//                             the annotations say now (run --write)
//   UNDECLARED_IMPORT         a file in one module imports a file in another
//                             with no `calls` line between them
//   UNDECLARED_RUN            the same for a repo script one module runs as a
//                             child process (a path.join of literals in a file
//                             that spawns, a quoted path inside a spawn call, or
//                             a `node <path>` line in YAML or shell)
//   NODE_MISSING              a directory of source files no node owns
//   LAYER_VIOLATION           a call up the layers (a service calling a surface)
//   EGRESS_OUTSIDE_ADAPTER    a network call (fetch, http, a spawned glab/gh/curl,
//                             a Python HTTP client, or a config `egress` pattern)
//                             in a module that is not an adapter
//   UNDECLARED_EXPORT         an export of a node's entry file with no
//                             `exposes` or `internal` line; EXPORT_STALE is an
//                             `exposes` line for a name it no longer exports
//   TARGET_MISSING, NODE_DUPLICATE, LAYER_UNKNOWN, CALLS_ORPHAN, PARSE
//                             annotations that do not make a map
//   BOARD_BEHIND (info)       the map changed since it was last published
//
// What cannot carry a comment (a JSON catalog, a directory of manifests and
// Markdown, a system outside the repo that calls in) is declared under `nodes`
// in the config instead, with its own `calls`.
//
// --changed BASE (a ref, or A..B) limits the findings about files (imports,
// runs, egress, exports, and NODE_MISSING) to the files it changed, so a repo
// can adopt the map one change at a time. A `Diagram: none, <why>` line in
// the range's commit messages or in --note waives imports, runs, and egress.
// Nothing waives a stale map, a missing node, or an unclassified export: the
// fix is one line each.
//
// Exit 0 clean (info only), 1 warnings, 2 when the check itself cannot run.
// --json prints one object:
// {config, mode, summary, accepted, findings: [{code, severity, path, line, message}]}.
// Writes only with --write (the map) or --mark-published (publishedHash in the
// config). Reads files and git only: no network, and nothing here knows a
// board's credentials.
//
// `generate` draws the map as a miro-board scene. The build hands it to a
// generator as `kit.systemMap`, so a repo's `diagrams/src/gen-system.mjs` is
// one line and never imports the plugin.
//
// Node 22 stdlib only, and it imports nothing of its own: a repo that wants
// the check in CI copies this one file in and runs it there.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CONFIG = ".agents/system-map.json";
// diagrams-init is run by a person, so every pointer to it says who runs it.
const ADOPT = "the person runs /marvelous-miro:diagrams-init to set the map up";
export const LAYERS = ["people", "surface", "service", "adapter", "runtime", "external"];
const SEVERITY = { warning: 1, info: 0 };
const DEFAULTS = {
  title: "System map",
  map: "diagrams/system-map.json",
  include: ["**"],
  // Agent tooling a repo keeps beside its config, a CI copy of this script
  // among it. A repo whose .agents/ holds real modules sets its own exclude.
  exclude: [".agents/**"],
  externals: {},
  nodes: {},
  egress: [],
  board: null,
  // Opt-in: a label (say "confidential") the board must be recorded as carrying
  // before anything is published to it. Null asks for nothing.
  requireClassification: null,
  classification: null,
  publishedHash: null,
  accept: [],
};
// Prose and tests describe the grammar; they never declare a module. Nor does the
// board's own project: the diagrams directory, or a miro.config.mjs kept at the root.
const ALWAYS_EXCLUDED = ["**/*.md", "**/*.mdx", ".agents/system-map.json", "**/node_modules/**", "**/*.test.*", "**/*.spec.*",
  "**/test/**", "**/tests/**", "**/__tests__/**", "**/fixtures/**", "diagrams/**", "**/miro.config.mjs"];
// debt: JS/TS and Python imports only, add a scanner when a repo in another language opts in.
const JS_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);
const PY_EXT = new Set([".py"]);
const SHELL_EXT = new Set([".yml", ".yaml", ".sh"]);
const SCRIPT = /\.(?:mjs|cjs|js|py)$/;
const MAX_BYTES = 512 * 1024;

const ANNOTATION = /^\s*(?:\/\/+|#+|\*+|--|\/\*+|<!--)?\s*@system\b(.*)$/;
const NODE_LINE = /^node\s+([a-z0-9][\w-]*)\s+"([^"]+)"((?:\s+\w+=\S+)*)\s*(?:\*\/|-->)?\s*$/;
const EXPOSES_LINE = /^exposes\s+([A-Za-z_$][\w$]*)\s+"([^"]+)"\s*(?:\*\/|-->)?\s*$/;
const INTERNAL_LINE = /^internal((?:\s+[A-Za-z_$][\w$]*)+)\s*(?:\*\/|-->)?\s*$/;
const CALLS_LINE = /^calls\s+((?:ext:)?[a-z0-9][\w-]*)\s+"([^"]+)"\s*(?:\*\/|-->)?\s*$/;
const JS_IMPORTS = [
  /(?:^|[^\w.$])(?:import|export)\s[^'";]*?\bfrom\s*["']([^"']+)["']/g,
  /(?:^|[^\w.$])import\s*["']([^"']+)["']/g,
  /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const PY_FROM = /^\s*from\s+(\.*[\w.]*)\s+import\b/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm;
// debt: runs are found from literal paths only, add a resolver when a repo builds script paths at runtime.
const PATH_CALL = /\bpath\.(?:join|resolve)\(([^()]*)\)/g;
const PATH_LITERAL = /["']((?:\.{1,2}\/|[\w.-]+\/)[\w./-]*\.(?:mjs|cjs|js|py))["']/g;
const SPAWN = /\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn|fork)\s*\(/g;
const SHELL_NODE = /\bnode\s+(?:\.\/)?([\w./-]+\.(?:mjs|cjs|js))\b/g;
const LITERAL = /^\s*["']([^"']*)["']\s*$/;
const HERE = /^\s*(?:import\.meta\.dirname|__dirname|here)\s*$/;
// debt: exports found by pattern, add a parser when `export *` or Python's __all__ hides one.
const JS_EXPORTS = [
  [/^export\s+(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm, (m) => [m[1]]],
  [/^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, (m) => [m[1]]],
  // A TypeScript annotation may sit between the name and its `=`, and may hold an arrow type's `=>`.
  [/^export\s+(?:const|let|var)\s+([^\n;]*)/gm, (m) => [...m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?::(?:[^=]|=>)+)?=(?!>)/g)].map((x) => x[1])],
  [/^export\s*\{([^}]*)\}/gm, (m) => m[1].split(",").map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)],
  [/^export\s+default\b/gm, () => ["default"]],
];
const PY_EXPORTS = [/^(?:async\s+)?def\s+([A-Za-z]\w*)/gm, /^class\s+([A-Za-z]\w*)/gm];
// Matched against code with strings and comments blanked, so a hint table or a
// comment never counts. A bare fetch( only: obj.fetch() is a local method, and
// fetch() { is one being defined.
const EGRESS = [/(?<![.\w$])fetch\s*\((?![^)]*\)\s*\{)/, /\bhttps?\.(?:request|get)\s*\(/, /\bnew\s+WebSocket\s*\(/,
  /\brequests\.(?:get|post|put|patch|delete|head|request)\s*\(/, /\burlopen\s*\(/, /\bhttpx\.\w+\s*\(/];
// The one pattern that needs its string: which binary is spawned.
const EGRESS_SPAWN = /\b(?:execFileSync|execFile|execSync|exec|spawnSync|spawn)\s*\(\s*["'`](?:glab|gh|curl|wget)\b/;
const STRING = /(["'`])(?:\\.|(?!\1)[^\\])*\1/g;
const WAIVER = /^\s*Diagram:\s*(none|n\/?a|no\b)/im;

const finding = (code, severity, p, line, message) => ({ code, severity, path: p, line, message });
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const toPosix = (p) => p.split(path.sep).join("/");
/** The line a match starts on, past any newline or separator its leading guard consumed. */
const lineOf = (text, m) => text.slice(0, m.index + (m[0].length - m[0].trimStart().length)).split("\n").length;

/** A repo-relative glob as a regex: `**\/` any depth (including none), `*` within a segment. */
function globRe(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length;) {
    if (pattern.startsWith("**/", i)) { out += "(?:.*/)?"; i += 3; }
    else if (pattern.startsWith("**", i)) { out += ".*"; i += 2; }
    else if (pattern[i] === "*") { out += "[^/]*"; i++; }
    else if (pattern[i] === "?") { out += "[^/]"; i++; }
    else { out += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&"); i++; }
  }
  return new RegExp(`^${out}$`);
}
const matches = (p, globs) => (globs ?? []).some((g) => globRe(g).test(p));

function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(String(e.stderr ?? "").trim() || `git ${args.join(" ")} failed`);
  }
}
const lines = (s) => s.split("\n").filter(Boolean);

function configPath(root, config) { return config ? path.resolve(config) : path.join(root, CONFIG); }

function loadConfig(root, config) {
  const p = configPath(root, config);
  if (!isFile(p)) return null;
  return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")) };
}

/** Tracked and untracked-but-not-ignored files that still exist, so a turn's new module counts before it is added. */
function files(root) {
  return [...new Set(lines(git(root, "ls-files", "--cached", "--others", "--exclude-standard")))]
    .filter((f) => isFile(path.join(root, f))).sort();
}

// ---- extraction -----------------------------------------------------------------

/** The node owning a repo-relative path: the declared module whose directory is its nearest ancestor. */
function owner(byDir, p) {
  for (let d = path.posix.dirname(p); ; d = path.posix.dirname(d)) {
    if (byDir.has(d)) return byDir.get(d);
    if (d === "." || d === "/" || d === "") return null;
  }
}

/** The map the annotations describe, the findings that keep it from being one, and what the import scan needs. */
export function extract(root, cfg = loadConfig(root)) {
  const all = files(root);
  const scanned = all.filter((f) => matches(f, cfg.include) && !matches(f, [...ALWAYS_EXCLUDED, ...cfg.exclude]));
  const findings = [], nodes = [], calls = [], texts = new Map(), exposes = new Map(), internal = new Map();
  for (const f of scanned) {
    let text;
    try {
      if (fs.statSync(path.join(root, f)).size > MAX_BYTES) continue;
      text = fs.readFileSync(path.join(root, f), "utf8");
    } catch { continue; }
    if (text.includes("\0")) continue;
    texts.set(f, text);
    if (!text.includes("@system")) continue;
    text.split("\n").forEach((raw, i) => {
      const m = ANNOTATION.exec(raw);
      if (!m) return;
      const body = m[1].trim(), line = i + 1;
      const n = NODE_LINE.exec(body), c = CALLS_LINE.exec(body), x = EXPOSES_LINE.exec(body), q = INTERNAL_LINE.exec(body);
      if (x) exposes.set(f, [...(exposes.get(f) ?? []), { name: x[1], label: x[2], line }]);
      else if (q) internal.set(f, new Set([...(internal.get(f) ?? []), ...q[1].trim().split(/\s+/)]));
      else if (n) {
        const attrs = Object.fromEntries([...n[3].matchAll(/(\w+)=(\S+)/g)].map((a) => [a[1], a[2]]));
        nodes.push({ id: n[1], title: n[2], layer: attrs.layer ?? "service", path: path.posix.dirname(f), file: f, line });
      } else if (c) calls.push({ to: c[1], label: c[2], file: f, line });
      else findings.push(finding("PARSE", "warning", f, line, `not an @system line: expected node <id> "<title>" layer=<layer>, calls <id|ext:id> "<label>", exposes <name> "<label>", or internal <name>...`));
    });
  }

  for (const [id, n] of Object.entries(cfg.nodes ?? {})) {
    nodes.push({ id, title: n.title ?? id, layer: n.layer ?? "service", path: n.path ?? null, file: CONFIG, line: 0 });
    for (const c of n.calls ?? []) calls.push({ from: id, to: c.to, label: c.label ?? "", file: CONFIG, line: 0 });
  }

  const byId = new Map(), byDir = new Map();
  for (const n of nodes) {
    if (!LAYERS.includes(n.layer)) findings.push(finding("LAYER_UNKNOWN", "warning", n.file, n.line, `layer ${n.layer} is not one of ${LAYERS.join(", ")}`));
    if (byId.has(n.id)) { findings.push(finding("NODE_DUPLICATE", "warning", n.file, n.line, `node ${n.id} is already declared in ${byId.get(n.id).file}`)); continue; }
    if (n.path !== null && byDir.has(n.path)) { findings.push(finding("NODE_DUPLICATE", "warning", n.file, n.line, `${n.path} already roots node ${byDir.get(n.path)}; one node per directory`)); continue; }
    byId.set(n.id, n);
    if (n.path !== null) byDir.set(n.path, n.id);
  }
  const externals = Object.entries(cfg.externals ?? {});
  const edges = [];
  for (const c of calls) {
    const from = c.from ?? owner(byDir, c.file);
    if (!from) { findings.push(finding("CALLS_ORPHAN", "warning", c.file, c.line, "no @system node owns this file; declare one in this directory or an ancestor")); continue; }
    const known = c.to.startsWith("ext:") ? Object.hasOwn(cfg.externals ?? {}, c.to.slice(4)) : byId.has(c.to);
    if (!known) { findings.push(finding("TARGET_MISSING", "warning", c.file, c.line, `calls ${c.to}, which is ${c.to.startsWith("ext:") ? `not in externals in ${CONFIG}` : "not a declared node"}`)); continue; }
    if (c.to === from) continue;
    edges.push({ from, to: c.to, label: c.label });
    const [lf, lt] = [layerOf(byId, from), layerOf(byId, c.to)];
    if (LAYERS.indexOf(lt) >= 0 && LAYERS.indexOf(lt) < LAYERS.indexOf(lf)) {
      findings.push(finding("LAYER_VIOLATION", "warning", c.file, c.line, `${from} (${lf}) calls ${c.to} (${lt}), up the layers; call down or across, move a module to the layer it serves, or accept it with a why`));
    }
  }

  // The public surface of each node's entry file, checked against what the file really exports.
  const surface = new Map();
  for (const n of byId.values()) {
    if (n.file === CONFIG || !texts.has(n.file)) continue;
    const exported = exportsOf(n.file, texts.get(n.file));
    const names = new Set(exported.map(([name]) => name));
    const declared = exposes.get(n.file) ?? [];
    for (const d of declared) if (!names.has(d.name)) findings.push(finding("EXPORT_STALE", "warning", n.file, d.line, `${d.name} has an exposes line but ${n.file} no longer exports it; drop the line`));
    surface.set(n.id, { file: n.file, exported, classified: new Set([...declared.map((d) => d.name), ...(internal.get(n.file) ?? [])]) });
    n.exposes = declared.filter((d) => names.has(d.name)).map(({ name, label }) => ({ name, label })).sort((a, b) => a.name.localeCompare(b.name));
  }

  const rank = (n) => LAYERS.indexOf(n.layer);
  const map = {
    title: cfg.title,
    nodes: [
      ...[...byId.values()].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
        .map((n) => ({ id: n.id, title: n.title, layer: n.layer, path: n.path, ...(n.exposes?.length ? { exposes: n.exposes } : {}) })),
      ...externals.sort(([a], [b]) => a.localeCompare(b)).map(([id, title]) => ({ id: `ext:${id}`, title, layer: "external", path: null })),
    ],
    edges: [...new Map(edges.map((e) => [`${e.from}\0${e.to}\0${e.label}`, e])).values()]
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.label.localeCompare(b.label)),
  };
  return { map, findings, byDir, byId, surface, texts, all: new Set(all), cfg };
}

const layerOf = (byId, id) => (id.startsWith("ext:") ? "external" : byId.get(id)?.layer);

/** [name, line] for every name a file exports: JS/TS export statements, Python's public top-level defs and classes. */
function exportsOf(f, text) {
  const ext = path.extname(f), out = [];
  if (JS_EXT.has(ext)) for (const [re, names] of JS_EXPORTS) for (const m of text.matchAll(re)) for (const n of names(m)) out.push([n, lineOf(text, m)]);
  if (PY_EXT.has(ext)) for (const re of PY_EXPORTS) for (const m of text.matchAll(re)) out.push([m[1], lineOf(text, m)]);
  return out.sort((a, b) => a[1] - b[1]);
}

export const serialize = (map) => JSON.stringify(map, null, 2) + "\n";
export const mapHash = (map) => createHash("sha256").update(serialize(map)).digest("hex").slice(0, 16);

// ---- the import cross-check -------------------------------------------------------

/** Repo-relative targets of a file's local imports, with the line each sits on. */
function importsOf(f, text, all) {
  const ext = path.extname(f), dir = path.posix.dirname(f), out = [];
  if (JS_EXT.has(ext)) {
    for (const re of JS_IMPORTS) for (const m of text.matchAll(re)) {
      if (m[1].startsWith(".")) out.push([path.posix.normalize(path.posix.join(dir, m[1])), lineOf(text, m)]);
    }
  } else if (PY_EXT.has(ext)) {
    // A module is local when a tracked file or package sits at its path; everything else is stdlib or installed.
    const local = (p) => all.has(`${p}.py`) || [...all].some((a) => a.startsWith(`${p}/`));
    for (const m of text.matchAll(PY_FROM)) {
      const dots = /^\.*/.exec(m[1])[0].length, rest = m[1].slice(dots).replaceAll(".", "/");
      let base = dir;
      for (let i = 1; i < dots; i++) base = path.posix.dirname(base);
      const p = dots ? path.posix.normalize(path.posix.join(base, rest || ".")) : rest;
      if (dots || local(p)) out.push([p, lineOf(text, m)]);
    }
    for (const m of text.matchAll(PY_IMPORT)) {
      for (const mod of m[1].split(",").map((s) => s.trim().replaceAll(".", "/"))) if (local(mod)) out.push([mod, lineOf(text, m)]);
    }
  }
  return out;
}

/** The text of a call's arguments, from just past its opening parenthesis to the one that closes it. */
function callArgs(text, start) {
  let depth = 1, i = start;
  for (; i < text.length && depth; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
  return text.slice(start, i - 1);
}

/**
 * Repo scripts a file runs as a child process. A path.join of literals counts
 * anywhere in a file that spawns, since the path is often held in a variable
 * first; a bare quoted path counts only inside a spawn call, since a table of
 * paths is data. In YAML or shell, every `node <path>` line.
 */
function runsOf(f, text, all) {
  const ext = path.extname(f), dir = path.posix.dirname(f), out = [];
  const keep = (p, m) => { if (SCRIPT.test(p) && all.has(p)) out.push([p, lineOf(text, m)]); };
  if (SHELL_EXT.has(ext)) {
    for (const m of text.matchAll(SHELL_NODE)) keep(path.posix.normalize(m[1]), m);
  } else if (JS_EXT.has(ext) && text.includes("child_process")) {
    for (const m of text.matchAll(PATH_CALL)) {
      // The first argument is the file's own directory, a literal, or anything else (a repo root).
      const args = m[1].split(",");
      const [base, rest] = HERE.test(args[0]) ? [dir, args.slice(1)] : LITERAL.test(args[0]) ? [".", args] : [".", args.slice(1)];
      const parts = rest.map((a) => LITERAL.exec(a)?.[1]);
      if (parts.some((x) => x === undefined)) continue;
      keep(path.posix.normalize(path.posix.join(base, ...parts)), m);
    }
    for (const call of text.matchAll(SPAWN)) {
      const args = callArgs(text, call.index + call[0].length);
      for (const m of args.matchAll(PATH_LITERAL)) {
        keep(path.posix.normalize(m[1].startsWith(".") ? path.posix.join(dir, m[1]) : m[1]), { index: call.index + call[0].length + m.index, 0: m[0] });
      }
    }
  }
  return out;
}

/** Network calls in a file, by line: the built-in patterns and the config's own. */
function egressOf(f, text, extra) {
  const ext = path.extname(f);
  if (!JS_EXT.has(ext) && !PY_EXT.has(ext)) return [];
  const res = [...EGRESS, ...extra.map((p) => new RegExp(p))];
  const comment = PY_EXT.has(ext) ? /#.*$/ : /\/\/.*$/;
  return text.split("\n").flatMap((l, i) => {
    if (/^\s*(?:\/\*|\*)/.test(l)) return [];
    // Strings masked to spaces keep columns, so the comment found on the masked line cuts the raw one too.
    const masked = l.replace(STRING, (m) => " ".repeat(m.length));
    const end = masked.search(comment) === -1 ? l.length : masked.search(comment);
    return res.some((re) => re.test(masked.slice(0, end))) || EGRESS_SPAWN.test(l.slice(0, end)) ? [i + 1] : [];
  });
}

/** Directories of source files no node owns, each reported once at its topmost unowned directory. */
function checkCoverage(ex, only) {
  const loose = [...ex.texts.keys()].filter((f) => (JS_EXT.has(path.extname(f)) || PY_EXT.has(path.extname(f))) && !owner(ex.byDir, f));
  const dirs = [...new Set(loose.map((f) => path.posix.dirname(f)))].sort();
  const top = dirs.filter((d) => !dirs.some((o) => o !== d && (o === "." || d.startsWith(`${o}/`))));
  return top.flatMap((d) => {
    const inside = d === "." ? loose : loose.filter((f) => f.startsWith(`${d}/`));
    if (only && !inside.some((f) => only.has(f))) return [];
    return [finding("NODE_MISSING", "warning", d, 0, `${d}/ holds ${inside.length} source file(s) no @system node owns; declare a node in its entry file, or accept it with a why`)];
  });
}

/** Every export of each node's entry file is classified with an exposes or internal line. */
function checkSurface(ex, only) {
  const out = [];
  for (const [id, s] of ex.surface) {
    if (only && !only.has(s.file)) continue;
    for (const [name, line] of s.exported) {
      if (!s.classified.has(name)) out.push(finding("UNDECLARED_EXPORT", "warning", s.file, line, `${name} is exported from ${id}'s entry file with no @system exposes ${name} "<what it does>" or internal ${name} line`));
    }
  }
  return out;
}

function checkImports(root, ex, only) {
  const declared = new Set(ex.map.edges.map((e) => `${e.from}\0${e.to}`));
  const out = [];
  for (const [f, text] of ex.texts) {
    if (only && !only.has(f)) continue;
    const from = owner(ex.byDir, f);
    if (!from) continue;
    const seen = new Set();
    for (const [kind, refs] of [["IMPORT", importsOf(f, text, ex.all)], ["RUN", runsOf(f, text, ex.all)]]) {
      for (const [target, line] of refs) {
        // A target path that is itself a module's directory belongs to that module.
        const to = ex.byDir.get(target) ?? owner(ex.byDir, target);
        if (!to || to === from || declared.has(`${from}\0${to}`) || seen.has(`${line}\0${to}`)) continue;
        seen.add(`${line}\0${to}`);
        const verb = kind === "RUN" ? "runs" : "imports";
        out.push(finding(`UNDECLARED_${kind}`, "warning", f, line, `${from} ${verb} ${target} (${to}) with no @system calls ${to} line; declare the call or move the code`));
      }
    }
    if (layerOf(ex.byId, from) !== "adapter") {
      for (const line of egressOf(f, text, ex.cfg.egress ?? [])) {
        out.push(finding("EGRESS_OUTSIDE_ADAPTER", "warning", f, line, `${from} (${layerOf(ex.byId, from)}) calls the network; move the call into an adapter node, or accept it with a why`));
      }
    }
  }
  return out;
}

/** [changed files, the range's commit messages]. A plain ref compares the working tree, untracked files included. */
function changedFiles(root, base) {
  if (base.includes("..")) return [new Set(lines(git(root, "diff", "--name-only", base))), git(root, "log", "--format=%B", base)];
  return [new Set([...lines(git(root, "diff", "--name-only", base)), ...lines(git(root, "ls-files", "--others", "--exclude-standard"))]), ""];
}

// ---- run --------------------------------------------------------------------------

/** The report as an object: what the CLI prints, and what map-sweep.mjs groups by module. */
export function run(root, { changed = null, note = null, config = null, write = false } = {}) {
  const cfg = loadConfig(root, config);
  if (!cfg) return { config: null, mode: [], summary: { warning: 0, info: 0 }, accepted: 0, findings: [] };
  const mode = ["tree"];
  const ex = extract(root, cfg);
  const mapFile = path.join(root, cfg.map);
  const fresh = serialize(ex.map);
  if (write) {
    mode.push("write");
    fs.mkdirSync(path.dirname(mapFile), { recursive: true });
    fs.writeFileSync(mapFile, fresh);
  }
  let findings = [...ex.findings];
  if (!isFile(mapFile)) findings.push(finding("MAP_MISSING", "warning", cfg.map, 0, "no committed map; run this script again with --write"));
  else if (fs.readFileSync(mapFile, "utf8") !== fresh) findings.push(finding("MAP_STALE", "warning", cfg.map, 0, "the annotations changed and the map did not; run this script again with --write and commit the map"));

  let only = null, waived = false;
  if (changed) {
    mode.push("changed");
    const [names, messages] = changedFiles(root, changed);
    only = names;
    waived = WAIVER.test(`${messages}\n${note ?? ""}`);
  }
  if (!waived) findings = findings.concat(checkImports(root, ex, only));
  findings = findings.concat(checkCoverage(ex, only), checkSurface(ex, only));
  if (cfg.board && cfg.publishedHash !== mapHash(ex.map)) {
    findings.push(finding("BOARD_BEHIND", "info", cfg.map, 0, "the map changed since the board was last published; /marvelous-miro:diagrams-sync publishes it"));
  }

  const accepted = (f) => (cfg.accept ?? []).some((a) => a.code === f.code && (!a.path || a.path === f.path));
  const kept = findings.filter((f) => !accepted(f))
    .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || a.path.localeCompare(b.path) || a.line - b.line || a.code.localeCompare(b.code));
  const summary = Object.fromEntries(Object.keys(SEVERITY).map((k) => [k, kept.filter((f) => f.severity === k).length]));
  return { config: config ? toPosix(config) : CONFIG, mode, summary, accepted: findings.length - kept.length, findings: kept };
}

export const exitCode = ({ summary }) => (summary.warning ? 1 : 0);

/**
 * Why the board may not be published to yet, or null. The gate every publish
 * goes through: a board is recorded, and, where the config asks for a
 * classification label, the board is recorded as carrying it.
 */
export function publishBlocker(cfg) {
  if (!cfg.board) return `no board recorded in ${CONFIG}; ${ADOPT}`;
  const want = typeof cfg.requireClassification === "string" ? cfg.requireClassification.trim() : "";
  const have = cfg.classification ?? {};
  if (want && (String(have.label ?? "").toLowerCase() !== want.toLowerCase() || !have.confirmed)) {
    return `${CONFIG} requires the board to be classified "${want}" and does not record that it is; set the label in Miro, confirm it on the board, then record classification: {label: "${want}", confirmed: "<date>"}`;
  }
  return null;
}

// ---- the generator ------------------------------------------------------------------

const COLOR = { people: "yellow", surface: "teal", service: "blue", adapter: "purple", runtime: "gray", external: "orange" };
const MIN_W = 240, MAX_LINE = 420, MIN_H = 100, GAP_X = 120, GAP_Y = 160, X0 = 60, Y0 = 140;
// A bus's junction is a dot in a taller gap: clear of the mid-gap lane where the connectors
// drawn straight between the two rows bend, and with every leg into and out of it longer
// than the 30px stub Miro takes instead of a shorter one.
const DOT = 12, DOT_Y = 64, GAP_BUS = 180, CLEAR = 6;
const sceneId = (id) => id.replace(/[^\w-]/g, "_");
// Even widths keep every centre on a whole pixel, so a connector between lined-up centres is straight.
const even = (v) => 2 * Math.ceil(v / 2);

// The geometry the miro-board build lint predicts and checks, so the layout is chosen
// against the findings a build would report. Miro attaches a connector at the middle of a
// side, and between facing sides runs it straight when the centres line up, otherwise out,
// across at mid-gap, and in. Boxes are { x, y, w, h }.
const facing = (A, B) => {
  if (A.y + A.h <= B.y || B.y + B.h <= A.y) {
    const [U, D] = A.y < B.y ? [A, B] : [B, A], p = [U.x + U.w / 2, U.y + U.h], q = [D.x + D.w / 2, D.y], m = (p[1] + q[1]) / 2;
    return Math.abs(p[0] - q[0]) < 1 ? [p, q] : [p, [p[0], m], [q[0], m], q];
  }
  const [L, R] = A.x < B.x ? [A, B] : [B, A], p = [L.x + L.w, L.y + L.h / 2], q = [R.x, R.y + R.h / 2], m = (p[0] + q[0]) / 2;
  return Math.abs(p[1] - q[1]) < 1 ? [p, q] : [p, [m, p[1]], [m, q[1]], q];
};
const legs = (P) => P.slice(1).map((q, i) => [P[i], q]);
// Crossings as the lint counts them: the route nudged three ways, the fewest proper
// intersections, so a pass through a bend counts and a touch that turns back does not.
const NUDGES = [[0.4137, 0.2719], [-0.3391, 0.5113], [0.2087, -0.4523]];
const crossings = (A, B) => Math.min(...NUDGES.map(([dx, dy]) => {
  let n = 0;
  for (const [p, q] of legs(A.map(([x, y]) => [x + dx, y + dy]))) for (const [r, t] of legs(B)) {
    const d1 = [q[0] - p[0], q[1] - p[1]], d2 = [t[0] - r[0], t[1] - r[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) <= 1e-9 * Math.hypot(...d1) * Math.hypot(...d2)) continue;
    const u = ((r[0] - p[0]) * d2[1] - (r[1] - p[1]) * d2[0]) / den, v = ((r[0] - p[0]) * d1[1] - (r[1] - p[1]) * d1[0]) / den;
    if (u > 0 && u < 1 && v > 0 && v < 1) n++;
  }
  return n;
}));
// Two legs on one line (a shared run, as bad as a crossing) or close beside each other.
const alongside = (p, q, r, t) => {
  const flat = (a, b, k) => Math.abs(a[k] - b[k]) < 0.5, k = flat(p, q, 1) && flat(r, t, 1) ? 1 : flat(p, q, 0) && flat(r, t, 0) ? 0 : -1;
  if (k < 0) return 0;
  const run = Math.min(Math.max(p[1 - k], q[1 - k]), Math.max(r[1 - k], t[1 - k])) - Math.max(Math.min(p[1 - k], q[1 - k]), Math.min(r[1 - k], t[1 - k]));
  const d = Math.abs(p[k] - r[k]);
  return d <= 3 && run > 1 ? 10 : d > 3 && d < 20 && run > 20 ? 1 : 0;
};
// Does leg p-q pass within CLEAR of box r? Liang-Barsky, as the lint's line_card and line_near.
const passes = (p, q, r) => {
  const [x0, y0, x1, y1] = [r.x - CLEAR, r.y - CLEAR, r.x + r.w + CLEAR, r.y + r.h + CLEAR], dx = q[0] - p[0], dy = q[1] - p[1];
  let t0 = 0, t1 = 1;
  for (const [pp, qq] of [[-dx, p[0] - x0], [dx, x1 - p[0]], [-dy, p[1] - y0], [dy, y1 - p[1]]]) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return (t1 - t0) * Math.hypot(dx, dy) > 2;
};

/**
 * The map as a miro-board scene, drawn to the rules the build lint enforces: one row per
 * layer, top to bottom in LAYERS order, every card in a row as tall as the row's tallest
 * (an elbow bends at mid-gap below its own card, which beside a taller card is still level
 * with it), each row ordered by the mean centre of its neighbours in the rows above (ties
 * by id). Two or more cards that each call the same two or more cards in the row below
 * cross whatever their order, with one elbow per pair, so such a set is drawn as a bus:
 * each caller into a junction dot in the gap, the dot out to each callee. Cards then move
 * within their rows while that lowers what the lint would report between the connectors
 * drawn, and whatever no order untangles is cut, the connector or bus in the most
 * conflict per call it carries first, so the drawing builds clean. Connectors carry no
 * caption: what each call passes is a `→ <target>: <label>` body line on the calling
 * card, since a caption on a shared side or a short run is illegible on the board. A
 * connector is drawn only between adjacent rows or neighbouring cards, where Miro's
 * elbowed route stays in the gap between them.
 * debt: a call that skips a row, or that was cut, shows only as its body line; add channel
 * routing when a board's readers need those arrows drawn.
 */
export function generate(kit, mapFile) {
  const map = JSON.parse(fs.readFileSync(mapFile instanceof URL ? mapFile : path.resolve(mapFile), "utf8"));
  const { createScene, tw, wrap, TS = 19, BS = 14, PAD = 16, LH = 1.25 } = kit;
  const s = createScene();
  s.text("title", X0, 40, map.title ?? "System map", { size: 40 });
  const title = new Map(map.nodes.map((n) => [n.id, n.title]));
  const body = (n) => [n.path ?? "outside the repo",
    ...(n.exposes ?? []).flatMap((x) => wrap(`• ${x.name}: ${x.label}`, MAX_LINE, BS)),
    ...map.edges.filter((e) => e.from === n.id).flatMap((e) => wrap(`→ ${title.get(e.to)}: ${e.label}`, MAX_LINE, BS))];
  const size = (n) => {
    const lines = body(n);
    const w = even(Math.max(MIN_W, tw(n.title, TS) + 2 * PAD + 8, ...lines.map((l) => tw(l, BS) + 2 * PAD + 8)));
    const h = Math.ceil(Math.max(MIN_H, 2 * PAD + TS * LH + 8 + lines.length * BS * LH));
    return { lines, w, h };
  };
  const rows = LAYERS.map((layer) => map.nodes.filter((n) => n.layer === layer).map((n) => ({ n, ...size(n) }))).filter((r) => r.length)
    .map((r) => r.map((c) => ({ ...c, h: Math.max(...r.map((o) => o.h)) })));
  const rowOf = new Map(rows.flatMap((r, i) => r.map((c) => [c.n.id, i])));

  // The buses, gap by gap: the largest set of callers and callees first, then again among the calls left.
  const buses = [];
  for (const gap of rows.keys()) {
    const below = new Map();
    for (const e of map.edges) if (rowOf.get(e.from) === gap && rowOf.get(e.to) === gap + 1) below.set(e.from, (below.get(e.from) ?? new Set()).add(e.to));
    const from = [...below.keys()].sort();
    for (;;) {
      let best = null;
      for (const [i, a] of from.entries()) for (const b of from.slice(i + 1)) {
        const to = [...below.get(a)].filter((t) => below.get(b).has(t)).sort(), by = from.filter((u) => to.every((t) => below.get(u).has(t)));
        if (to.length > 1 && (!best || by.length * to.length > best.from.length * best.to.length)) best = { id: sceneId(`bus-${by[0]}-${to[0]}`), gap, from: by, to };
      }
      if (!best) break;
      buses.push(best);
      for (const u of best.from) for (const t of best.to) below.get(u).delete(t);
    }
  }
  const key = (a, b) => [a, b].sort().join(">");
  const bused = new Set(buses.flatMap((b) => b.from.flatMap((u) => b.to.map((t) => key(u, t)))));
  const pairs = [...new Map(map.edges.map((e) => [key(e.from, e.to), [e.from, e.to]]))].filter(([k]) => !bused.has(k));
  const calls = new Map([...pairs.map(([k]) => [k, 1]), ...buses.map((b) => [b.id, b.from.length * b.to.length])]);

  const gapBelow = rows.map((_, i) => (buses.some((b) => b.gap === i) ? GAP_BUS : GAP_Y));
  const rowY = rows.reduce((ys, r, i) => [...ys, i ? ys[i - 1] + rows[i - 1][0].h + gapBelow[i - 1] : Y0], []);
  const rowWidth = (r) => r.reduce((a, c) => a + c.w, 0) + GAP_X * (r.length - 1);
  const widest = Math.max(...rows.map(rowWidth));
  const centre = new Map();
  const neighbours = (id) => map.edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : []));
  const orders = [];
  for (const row of rows) {
    const score = ({ n }) => {
      const xs = neighbours(n.id).filter((m) => centre.has(m)).map((m) => centre.get(m));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity;
    };
    const ordered = row.map((c) => [c, score(c)]).sort(([a, sa], [b, sb]) => (sa === sb ? a.n.id.localeCompare(b.n.id) : sa - sb)).map(([c]) => c);
    let x = X0 + (widest - rowWidth(ordered)) / 2;
    for (const c of ordered) { centre.set(c.n.id, x + c.w / 2); x += c.w + GAP_X; }
    orders.push(ordered);
  }

  /** Every card's box, and each bus's junction centred on its cards (on one of them when that is near). */
  const place = () => {
    const at = new Map();
    for (const [ri, r] of orders.entries()) {
      let x = Math.round(X0 + (widest - rowWidth(r)) / 2);
      for (const [ci, c] of r.entries()) { at.set(c.n.id, { x, y: rowY[ri], w: c.w, h: c.h, ri, ci }); x += c.w + GAP_X; }
    }
    for (const b of buses) {
      const xs = [...b.from, ...b.to].map((id) => at.get(id).x + at.get(id).w / 2), mid = Math.round(xs.reduce((a, v) => a + v, 0) / xs.length);
      const closest = xs.reduce((a, v) => (Math.abs(v - mid) < Math.abs(a - mid) ? v : a));
      at.set(b.id, { x: (Math.abs(closest - mid) <= GAP_X / 4 ? closest : mid) - DOT / 2, y: rowY[b.gap] + rows[b.gap][0].h + DOT_Y, w: DOT, h: DOT });
    }
    return at;
  };
  /** The connectors drawn, keyed by the pair or the bus they belong to. */
  const draw = (at, cut) => [
    ...pairs.flatMap(([k, [a, b]]) => {
      const [A, B] = [at.get(a), at.get(b)];
      if (cut.has(k) || !A || !B || (A.ri === B.ri ? Math.abs(A.ci - B.ci) !== 1 : Math.abs(A.ri - B.ri) !== 1)) return [];
      return [{ key: k, ends: [a, b], P: facing(A, B) }];
    }),
    ...buses.filter((b) => !cut.has(b.id)).flatMap((b) => [...b.from.map((u) => [u, b.id]), ...b.to.map((t) => [b.id, t])]
      .map((ends) => ({ key: b.id, ends, P: facing(at.get(ends[0]), at.get(ends[1])) }))),
  ];
  /** What the lint would report, by key: 10 for a crossing, a shared run, or a pass by a box it does not end on; 1 for a close parallel run. */
  const conflicts = (at, C) => {
    const by = new Map(), add = (k, n) => n && by.set(k, (by.get(k) ?? 0) + n);
    for (const [i, a] of C.entries()) {
      for (const [id, r] of at) if (!a.ends.includes(id) && legs(a.P).some(([p, q]) => passes(p, q, r))) add(a.key, 10);
      for (const b of C.slice(i + 1)) {
        if (new Set([...a.ends, ...b.ends]).size < 4) continue;
        let n = 10 * crossings(a.P, b.P);
        for (const [p, q] of legs(a.P)) for (const [r, t] of legs(b.P)) n += alongside(p, q, r, t);
        add(a.key, n);
        add(b.key, n);
      }
    }
    return by;
  };
  /** Moves cards within their rows while that lowers the conflicts among what is drawn; returns what is left, by key. */
  const untangle = (cut) => {
    const left = () => { const at = place(); return conflicts(at, draw(at, cut)); };
    const sum = (by) => [...by.values()].reduce((a, n) => a + n, 0);
    for (let best = sum(left()), better = best > 0; better;) {
      better = false;
      for (const r of orders) for (let from = 0; from < r.length; from++) for (let to = 0; to < r.length; to++) {
        if (to === from || best === 0) continue;
        const [c] = r.splice(from, 1);
        r.splice(to, 0, c);
        const n = sum(left());
        if (n < best) { best = n; better = n > 0; } else { r.splice(to, 1); r.splice(from, 0, c); }
      }
    }
    return left();
  };
  const cut = new Set();
  for (let left = untangle(cut); left.size; left = untangle(cut)) {
    cut.add([...left].sort(([a, m], [b, n]) => n / calls.get(b) - m / calls.get(a) || a.localeCompare(b))[0][0]);
  }
  const at = place(), drawn = new Set(draw(at, cut).map((c) => c.key));

  for (const r of orders) for (const c of r) {
    const { x, y, w, h } = at.get(c.n.id);
    s.card(sceneId(c.n.id), x, y, w, h, { color: COLOR[c.n.layer], title: c.n.title, body: c.lines });
  }
  for (const b of buses.filter((x) => drawn.has(x.id))) {
    const { x, y } = at.get(b.id);
    s.box(b.id, s.rect(`r-${b.id}`, x, y, DOT, DOT, { bg: kit.MUTED, stroke: kit.MUTED }));
  }
  const tint = (to) => (to.startsWith("ext:") ? kit.MUTED : undefined);
  const seen = new Set();
  for (const e of map.edges) {
    const [from, to] = [sceneId(e.from), sceneId(e.to)], base = `e-${from}-${to}`;
    if (!drawn.has(key(e.from, e.to)) || seen.has(base)) continue; // one connector per caller and callee; every label is already on the calling card
    seen.add(base);
    const [a, b] = [s.nodes[from], s.nodes[to]];
    const pts = b.y > a.y ? [s.B(a), s.T(b)] : b.y < a.y ? [s.T(a), s.B(b)] : b.x > a.x ? [s.R(a), s.L(b)] : [s.L(a), s.R(b)];
    s.arrow(base, from, to, pts, { color: tint(e.to) });
  }
  for (const b of buses.filter((x) => drawn.has(x.id))) {
    const J = s.nodes[b.id];
    for (const u of b.from.map(sceneId)) s.arrow(`e-${u}-${b.id}`, u, b.id, [s.B(s.nodes[u]), s.T(J)]);
    for (const t of b.to) s.arrow(`e-${b.id}-${sceneId(t)}`, b.id, sceneId(t), [s.B(J), s.T(s.nodes[sceneId(t)])], { color: tint(t) });
  }
  return s;
}

// ---- CLI ------------------------------------------------------------------------------

const USAGE = `usage: system-map.mjs [--root DIR] [--config FILE] [--write] [--changed BASE] [--note TEXT] [--json]
       system-map.mjs [--root DIR] --can-publish | --mark-published

  --root DIR        the project root (default: the git top level, else the current directory)
  --config FILE     the config file (default: <root>/${CONFIG})
  --write           write the map from the annotations, then check
  --check           check only (the default)
  --changed BASE    limit the import check to files changed since BASE (a ref, or A..B)
  --note TEXT       text to search for a "Diagram: none, <why>" line, such as a pull request description
  --json            print the report as one JSON object
  --can-publish     exit 1, saying why, unless a board is recorded (and classified, where the config requires a label)
  --mark-published  record the current map as published (after a publish succeeds)`;

function main(argv) {
  const value = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  if (argv.includes("-h") || argv.includes("--help")) { console.log(USAGE); return 0; }
  let root = value("--root");
  if (!root) { try { root = git(process.cwd(), "rev-parse", "--show-toplevel").trim(); } catch { root = process.cwd(); } }
  root = path.resolve(root);
  try {
    if (argv.includes("--can-publish") || argv.includes("--mark-published")) {
      const cfg = loadConfig(root, value("--config"));
      if (!cfg) { console.log(`system-map: no ${CONFIG} here; ${ADOPT}`); return 1; }
      const blocker = publishBlocker(cfg);
      if (blocker) { console.log(`system-map: not publishing: ${blocker}`); return 1; }
      if (argv.includes("--mark-published")) {
        const file = configPath(root, value("--config"));
        const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
        raw.publishedHash = mapHash(extract(root, cfg).map);
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
        console.log(`system-map: recorded the map as published (${raw.publishedHash})`);
      } else console.log(`system-map: ok to publish to ${cfg.board}${cfg.requireClassification ? ` (classified ${cfg.classification.label}, confirmed ${cfg.classification.confirmed})` : ""}`);
      return 0;
    }
    const report = run(root, { changed: value("--changed"), note: value("--note"), config: value("--config"), write: argv.includes("--write") });
    if (argv.includes("--json")) console.log(JSON.stringify(report, null, 1));
    else if (!report.config) console.log(`system-map: no ${CONFIG} here; ${ADOPT}`);
    else {
      for (const f of report.findings) console.log(`${f.severity.padEnd(8)} ${f.code.padEnd(18)} ${f.path}${f.line ? `:${f.line}` : ""}  ${f.message}`);
      const s = report.summary;
      console.log(`system-map: ${s.warning} warning, ${s.info} info${report.accepted ? `, ${report.accepted} accepted` : ""}`);
    }
    return exitCode(report);
  } catch (e) {
    console.error(`system-map: ${e.message}`);
    return 2;
  }
}

// realpath: a script reached through a symlinked folder would otherwise never
// match the resolved module path, and the CLI would print nothing.
const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? ""); } catch { return null; } })();
if (invoked === import.meta.filename) process.exitCode = main(process.argv.slice(2));
