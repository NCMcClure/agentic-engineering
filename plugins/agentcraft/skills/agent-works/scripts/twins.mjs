#!/usr/bin/env node
// aw twins: the CLAUDE.md beside every AGENTS.md.
//
//   aw twins            write what is missing (per claude.twins of the config)
//   aw twins --check    list what is missing or stale, write nothing; exit 1 when something is
//
// The agent guidance of a repository is tool-neutral (AGENTS.md); Claude Code
// reads CLAUDE.md. A twin makes the two one file: a symlink to the sibling
// AGENTS.md, or a one-line file that imports it (`@AGENTS.md`) where a checkout
// cannot hold a symlink. Either form that is already there counts as a twin and
// is left alone, whatever the mode.
//
// claude.twins:  link       a tracked symlink to AGENTS.md (the default when the config does not
//                           say; the one-line file on Windows, or where a symlink is refused)
//                generated  one-line files, git-ignored and healed at session start
//                committed  one-line files, tracked; this command still writes the missing ones
//                off        no twins
//
//   GEN_TWIN_MISSING  warning  an AGENTS.md without its CLAUDE.md, or a CLAUDE.md with content of its own beside one
//   GEN_TWIN_ORPHAN   warning  a twin whose AGENTS.md is gone
import fs from "node:fs";
import path from "node:path";
import { Finding, emit, findingsDoc, git, ioOf, parseArgs, posix, projectRoot, readJson, readText, report, runMain } from "../lib/common.mjs";
import { DEFAULTS, findConfig, loadConfig } from "../lib/config.mjs";

const USAGE = `usage: aw twins [--check] [--json]

Write the CLAUDE.md twin beside every AGENTS.md, or check them.

  --check   list what is missing or stale; write nothing (exit 1 when something is)
  --json    one JSON document: { mode, written, removed, summary, findings }

claude.twins in .agents/agent-works.json chooses the form:
  link       a tracked symlink to AGENTS.md (the default; the one-line file on Windows)
  generated  one-line files (\`@AGENTS.md\`), git-ignored and healed at session start
  committed  one-line files, tracked
  off        no twins

  GEN_TWIN_MISSING  warning  an AGENTS.md without its CLAUDE.md, or a CLAUDE.md with content of its own beside one
  GEN_TWIN_ORPHAN   warning  a twin whose AGENTS.md is gone`;

/** The whole content of a one-line twin. */
export const STUB = "@AGENTS.md\n";
/** The values of `claude.twins` under which twins are written and checked. */
export const MODES = Object.freeze(["link", "generated", "committed"]);
const SKIP_DIRS = new Set(["node_modules", "build", "dist", "target", "out", "vendor", "third_party", "__pycache__", "venv", "archive"]);
const HUB = "AGENTS.md";
const TWIN = "CLAUDE.md";

/** The folder that holds `.agents/agent-works.json` at or above `start`, or null: the cheap "is this repository set up" probe. */
export function setUpRoot(start) {
  const config = findConfig(start);
  return config === null ? null : path.dirname(path.dirname(config));
}

/**
 * `claude.twins` of a config, lower case: "link", "generated", "committed", "off", or whatever else the file says
 * (anything outside MODES means no twins). A config that does not say is "link".
 */
export function modeOf(cfg) {
  const named = (value) => (value === "symlink" ? "link" : value);
  const merged = String(cfg?.claude?.twins || "").toLowerCase();
  if (merged && merged !== DEFAULTS.claude.twins) return named(merged);
  // The merged value may be the default laid under a file that does not say: the file decides.
  const own = cfg?._path ? readJson(cfg._path)?.claude?.twins : null;
  return named(String(own || "link").toLowerCase());
}

/** What `aw twins` writes in a mode: "link" (a symlink) or "stub" (the one-line file). Windows gets the file. */
export function formOf(mode, platform = process.platform) {
  return mode === "link" && platform !== "win32" ? "link" : "stub";
}

function walk(root, name) {
  const found = [];
  const visit = (dir, prefix) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (entries.some((e) => e.name === name && !e.isDirectory())) found.push(prefix + name);
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) visit(path.join(dir, e.name), `${prefix}${e.name}/`);
    }
  };
  visit(root, "");
  return found.sort();
}

const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/** Every AGENTS.md git knows or would add (tracked and untracked, ignored paths left out), repo-relative; a walk without git. */
export function agentsFiles(root) {
  const [code, out] = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", HUB, `**/${HUB}`], root);
  if (code !== 0) return walk(root, HUB);
  const names = new Set(out.split("\0").filter(Boolean));
  return [...names].filter((n) => isFile(path.join(root, n))).sort();
}

/**
 * What stands at a CLAUDE.md path: "link" (a symlink to its sibling AGENTS.md, or the link's own text where a
 * checkout wrote it as a file), "stub" (the one line `@AGENTS.md`), "other" (anything else) or "none".
 */
export function stateOf(file) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { return "none"; }
  if (stat.isSymbolicLink()) {
    try { return posix(fs.readlinkSync(file)).replace(/^\.\//, "") === HUB ? "link" : "other"; } catch { return "other"; }
  }
  const text = readText(file);
  if (text === null) return "other";
  return text.trim() === "@AGENTS.md" ? "stub" : text.trim() === HUB ? "link" : "other";
}

function writeTwin(file, form) {
  if (form === "link") {
    try {
      fs.symlinkSync(HUB, file);
      return;
    } catch { /* this checkout cannot hold a symlink: the one-line file does the same job */ }
  }
  fs.writeFileSync(file, STUB);
}

/**
 * Write the missing twins of the tree at `root`, or only report them with `check`.
 *
 * Returns `{ mode, written: [paths], removed: [paths], findings: [Finding], root_created: boolean }`. `root_created`
 * says the root twin had to be written, so the session that asked started without the project's guidance.
 * `orphans: false` skips the walk for twins whose AGENTS.md is gone (a session hook's quick pass). Never overwrites
 * a CLAUDE.md with content of its own. A mode outside MODES writes and reports nothing.
 */
export function heal(root, cfg = null, { check = false, orphans = true, platform = process.platform } = {}) {
  const config = cfg ?? loadConfig(root);
  const mode = modeOf(config);
  const res = { mode, written: [], removed: [], findings: [], root_created: false };
  if (!MODES.includes(mode)) return res;
  const form = formOf(mode, platform);
  const leave = form === "link" ? "a symlink to it (`aw twins` writes one once the file is gone)" : "the one line `@AGENTS.md`";
  const hubs = agentsFiles(root);
  for (const agents of hubs) {
    const rel = agents.slice(0, -HUB.length) + TWIN;
    const file = path.join(root, rel);
    const state = stateOf(file);
    if (state === "link" || state === "stub") continue;
    if (state === "other") {
      res.findings.push(new Finding("GEN_TWIN_MISSING", "warning", rel, 0,
        `has content of its own: move that into the AGENTS.md beside it and leave ${leave}`));
      continue;
    }
    if (check) {
      res.findings.push(new Finding("GEN_TWIN_MISSING", "warning", rel, 0, "is missing (run `aw twins`)"));
      continue;
    }
    try {
      writeTwin(file, form);
    } catch (e) {
      res.findings.push(new Finding("GEN_TWIN_MISSING", "warning", rel, 0, `could not be written: ${e.message}`));
      continue;
    }
    res.written.push(rel);
    if (rel === TWIN) res.root_created = true;
  }
  if (orphans) {
    const have = new Set(hubs.map((h) => h.slice(0, -HUB.length)));
    for (const rel of walk(root, TWIN)) {
      const folder = rel.slice(0, -TWIN.length);
      const state = stateOf(path.join(root, rel));
      // A CLAUDE.md with content of its own and no AGENTS.md is its owner's, not a twin.
      if (have.has(folder) || isFile(path.join(root, folder, HUB)) || (state !== "stub" && state !== "link")) continue;
      if (check || mode !== "generated") {
        res.findings.push(new Finding("GEN_TWIN_ORPHAN", "warning", rel, 0, "points at an AGENTS.md that is not there: delete it"));
      } else {
        try {
          fs.unlinkSync(path.join(root, rel));
          res.removed.push(rel);
        } catch { /* left where it is: the next run reports it */ }
      }
    }
  }
  return res;
}

/** What doctor reports: the check, writing nothing. */
export function findings(root, cfg = null) {
  return heal(root, cfg, { check: true }).findings;
}

export async function main(argv, io) {
  io = ioOf(io);
  const { values, help } = parseArgs(argv, { check: { type: "boolean" }, json: { type: "boolean" } });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  const json = values.json === true;
  if (findConfig(io.cwd) === null) {
    emit(io, { mode: null, written: [], summary: { critical: 0, warning: 0, info: 0 }, findings: [] }, json,
      "aw twins: no .agents/agent-works.json here, nothing to do (aw setup --plan)");
    return 0;
  }
  const root = projectRoot(io.cwd);
  const cfg = loadConfig(root);
  const res = heal(root, cfg, { check: values.check === true });
  if (!MODES.includes(res.mode)) {
    emit(io, findingsDoc([], { mode: res.mode, written: [] }), json, `aw twins: claude.twins is "${res.mode}", nothing to do`);
    return 0;
  }
  if (json) return report(io, res.findings, { json: true, extra: { mode: res.mode, written: res.written, removed: res.removed }, cfg });
  for (const rel of res.written) emit(io, `wrote ${rel}`);
  for (const rel of res.removed) emit(io, `removed ${rel} (its AGENTS.md is gone)`);
  const done = values.check ? "checked" : `${res.written.length} written`;
  return report(io, res.findings, { title: `twins (${res.mode}, ${done})`, cfg });
}

runMain(import.meta.url, main);
