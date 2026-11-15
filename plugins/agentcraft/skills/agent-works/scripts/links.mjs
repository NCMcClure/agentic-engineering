#!/usr/bin/env node
// aw links: the agent files point at things that exist.
//
//   aw links [file.md | folder …] [--json]
//
// Default targets: the root AGENTS.md, every hub, the Markdown under .agents/,
// and `links.files`. Links are checked in all of them. Paths in code are
// checked in the files that describe the present (hubs, the glossary,
// decisions, contracts, briefs) and not in memory, which records what was true
// on its date, nor in the generated .agents/README.md, which names homes a
// project may not have yet. The board and plan folders are left out: cards and
// plans quote freely, and plans have their own verifiers.
import fs from "node:fs";
import path from "node:path";
import { AwError, Finding, emit, git, ioOf, markdownFiles, parseArgs, projectRoot, readText, rel, report, runMain, splitLines } from "../lib/common.mjs";
import { OLD_BOARD, boardDir, configPath, loadConfig } from "../lib/config.mjs";

const USAGE = `usage: aw links [file.md | folder …] [--json]

Check the links and paths of the agent files.

  LINK_BROKEN   a relative Markdown link ([text](target), anchors ignored) that resolves to nothing
  PATH_MISSING  a repository path written in code (\`src/app/cli.ts\`, also inside a command or a fenced block) that is
                not there. A glob (\`*\`, \`{a,b}\`) must match something; a path with a placeholder (\`<id>\`, \`…\`) is
                checked up to it.

Default targets: the root AGENTS.md, every hub, the Markdown under .agents/, and links.files. Links are checked in
all of them. Paths in code are checked in the files that describe the present (hubs, the glossary, decisions,
contracts, briefs) and not in memory, which records what was true on its date, nor in the generated
.agents/README.md, which names homes a project may not have yet. The board and plan folders are left out.

Config (links in .agents/agent-works.json):
  files       Markdown files or folders read as well by default, relative to the top (the root README.md); one that
              is not there is skipped
  roots       top-level folders whose paths are checked when written in code (default: every top-level folder git
              tracks, and .agents)
  planned     paths named before they exist; remove an entry when its work lands
  notChecked  build output and look-alike paths that are never checked`;

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_SPAN = /`([^`]+)`/g;
const SKIP_TOP = new Set(["node_modules", "build", "dist", "target", "out", "vendor", "__pycache__", "venv"]);
const FENCE = /^\s*(```|~~~)/;

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const exists = (p) => {
  try { fs.statSync(p); return true; } catch { return false; }
};
const trimSlashes = (s) => String(s).replace(/^\/+|\/+$/g, "");
const under = (file, dir) => file === dir || file.startsWith(dir + path.sep);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The top-level folders whose paths are checked when written in code: `links.roots`, else what git tracks, and .agents. */
export function rootsOf(root, cfg) {
  const given = (cfg.links?.roots || []).map(trimSlashes).filter(Boolean);
  if (given.length) return given;
  const [code, out] = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  let tops;
  if (code === 0) {
    tops = out.split("\0").filter((l) => l.includes("/")).map((l) => l.split("/", 1)[0]);
  } else {
    try { tops = fs.readdirSync(root).filter((name) => isDir(path.join(root, name))); } catch { tops = []; }
  }
  const kept = new Set(tops.filter((t) => !SKIP_TOP.has(t) && (!t.startsWith(".") || t === ".agents")));
  if (isDir(path.join(root, ".agents"))) kept.add(".agents");
  return [...kept].sort(byName);
}

/** The Markdown files named by `targets` (files, or folders read to their depth). A target that is not there is an AwError. */
export function expandTargets(root, targets) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = entries.filter((e) => !e.isDirectory()).map((e) => e.name).sort(byName);
    out.push(...names.filter((n) => n.toLowerCase().endsWith(".md")).map((n) => path.join(dir, n)));
    for (const name of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(byName)) {
      if (!SKIP_TOP.has(name) && name !== ".git") walk(path.join(dir, name));
    }
  };
  for (const t of targets) {
    const full = path.isAbsolute(t) ? t : path.join(root, t);
    if (!exists(full)) throw new AwError(`no such file or folder: ${t}`);
    if (isDir(full)) walk(full);
    else out.push(full);
  }
  return out;
}

/** What is read without targets: every AGENTS.md, the Markdown under .agents/ outside the board and the plan, and `links.files`. */
export function defaultTargets(root, cfg) {
  const skip = [boardDir(cfg, root), configPath(cfg, root, "plan"), path.join(root, OLD_BOARD)];
  const files = [];
  for (const md of markdownFiles(root)) {
    if ((path.basename(md) === "AGENTS.md" || rel(md, root).startsWith(".agents/")) && !skip.some((s) => under(md, s))) files.push(md);
  }
  // links.files: Markdown the project wants read as well (the root README.md, a folder of pages).
  for (const extra of cfg.links?.files || []) {
    let more = [];
    try {
      if (exists(path.join(root, String(extra)))) more = expandTargets(root, [String(extra)]);
    } catch { /* not there after all: skipped */ }
    files.push(...more.filter((m) => !files.includes(m)));
  }
  return files;
}

function braces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  return m[1].split(",").flatMap((alt) => braces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)));
}

/** One path segment of a glob as a pattern over a name: `*` and `?` stay inside the name, `[…]` is a set. */
function segmentPattern(segment) {
  let source = "";
  for (let i = 0; i < segment.length;) {
    const c = segment[i++];
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "[") {
      const end = segment.indexOf("]", segment[i] === "!" ? i + 2 : i + 1);
      if (end < 0) {
        source += "\\[";
        continue;
      }
      let set = segment.slice(i, end);
      i = end + 1;
      const negated = set.startsWith("!");
      if (negated) set = set.slice(1);
      source += `[${negated ? "^" : ""}${set.replace(/[\\\]^]/g, "\\$&")}]`;
    } else source += escape(c);
  }
  try { return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : ""); } catch { return null; }
}

/** True when the glob `pattern` (relative, forward slashes) matches something under `root`. A name that opens with a dot is matched only by a segment that does. */
function globAny(root, pattern) {
  const segments = pattern.split("/").filter((s) => s !== "" && s !== ".");
  const list = (dir) => {
    try { return fs.readdirSync(dir); } catch { return []; }
  };
  const match = (dir, at) => {
    if (at === segments.length) return true;
    const segment = segments[at];
    if (segment === "**") {
      if (match(dir, at + 1)) return true;
      return list(dir).some((name) => !name.startsWith(".") && isDir(path.join(dir, name)) && match(path.join(dir, name), at));
    }
    if (!/[*?[]/.test(segment)) {
      const next = path.join(dir, segment);
      return fs.existsSync(next) && (at === segments.length - 1 || isDir(next)) && match(next, at + 1);
    }
    const re = segmentPattern(segment);
    if (!re) return false;
    return list(dir).some((name) => (segment.startsWith(".") || !name.startsWith(".")) && re.test(name)
      && (at === segments.length - 1 || isDir(path.join(dir, name))) && match(path.join(dir, name), at + 1));
  };
  return match(root, 0);
}

const unquote = (text) => {
  try { return decodeURIComponent(text); } catch { return text; }
};

/** Reads one file after another against one project, counting the links and paths it looked at. */
export class Checker {
  constructor(root, cfg) {
    this.root = root;
    const links = cfg.links || {};
    this.planned = [...(links.planned || []), ...(links.notChecked || [])].map(trimSlashes);
    const roots = rootsOf(root, cfg);
    this.pathInCode = roots.length
      ? new RegExp(`(?:^|[\\s"'(=\`])((?:${roots.map(escape).join("|")})/(?:[^\\s"'\`),;{]|\\{[^}\\s]*\\})*)`, "g")
      : null;
    this.noPaths = [configPath(cfg, root, "memory")]; // memory records what was true on its date
    this.noPathsFiles = [path.join(root, ".agents", "README.md")]; // the generated page names homes that may not exist yet
    this.links = 0;
    this.paths = 0;
  }

  isPlanned(p) {
    return this.planned.some((x) => p === x || p.startsWith(`${x}/`));
  }

  pathExists(written) {
    let p = written.replace(/[.,;:]+$/, "").replace(/\/+$/, "");
    if (this.isPlanned(p)) return true;
    const cut = /[<…$%]|\.\.\./.exec(p);
    if (cut) {
      p = p.slice(0, cut.index);
      p = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""; // "pkg/x/<name>.ts" -> the folder
      if (!p || this.isPlanned(p)) return true;
    }
    if (/[*{[]/.test(p)) return braces(p).some((alt) => globAny(this.root, alt));
    return fs.existsSync(path.join(this.root, p));
  }

  check(file) {
    const out = [];
    const where = rel(file, this.root);
    const text = readText(file);
    if (text === null) return out;
    const withPaths = this.pathInCode !== null && !this.noPathsFiles.includes(file) && !this.noPaths.some((d) => file.startsWith(d + path.sep));
    let fenced = false;
    splitLines(text).forEach((line, i) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return;
      }
      if (withPaths) {
        for (const span of fenced ? [line] : [...line.matchAll(CODE_SPAN)].map((m) => m[1])) {
          for (const m of span.matchAll(this.pathInCode)) {
            this.paths += 1;
            if (!this.pathExists(m[1])) out.push(new Finding("PATH_MISSING", "warning", where, i + 1, `no such path: ${m[1]}`));
          }
        }
      }
      if (fenced) return;
      for (const m of line.replace(CODE_SPAN, "").matchAll(LINK)) {
        const target = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue; // http:, mailto:, an anchor
        this.links += 1;
        const p = unquote(target.split("#")[0]).replace(/^[<>]+|[<>]+$/g, "");
        const full = path.normalize(p.startsWith("/") ? path.join(this.root, p.replace(/^\/+/, "")) : path.join(path.dirname(file), p));
        if (!fs.existsSync(full) && !this.isPlanned(rel(full, this.root))) out.push(new Finding("LINK_BROKEN", "warning", where, i + 1, `broken link: ${target}`));
      }
    });
    return out;
  }
}

/** `{ findings, files, links, paths }` for the targets (default: the agent files). */
export function findings(root, cfg = null, targets = null) {
  const config = cfg ?? loadConfig(root);
  const files = targets?.length ? expandTargets(root, targets) : defaultTargets(root, config);
  const checker = new Checker(root, config);
  const found = files.flatMap((f) => checker.check(f));
  return { findings: found, files: files.length, links: checker.links, paths: checker.paths };
}

export async function main(argv, io) {
  io = ioOf(io);
  const { values, positionals, help } = parseArgs(argv, { json: { type: "boolean" } });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  const root = projectRoot(io.cwd);
  const cfg = loadConfig(root);
  const res = findings(root, cfg, positionals);
  return report(io, res.findings, {
    json: values.json === true, title: `links: ${res.files} files, ${res.links} relative links, ${res.paths} paths in code`,
    extra: { files: res.files, links: res.links, paths: res.paths }, cfg,
  });
}

runMain(import.meta.url, main);
