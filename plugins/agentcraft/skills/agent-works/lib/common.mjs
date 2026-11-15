// What every `aw` command, the hooks and the coordination store share: the
// `io` a command works through, files written whole or not at all, the roots
// of a repository and of a project, the findings model and its exit codes,
// frontmatter, templates, and the plugins block of a root AGENTS.md.
//
// Node's standard library only, and cheap to import: a hook loads this on
// every tool call. Nothing here reads the process's working directory or
// environment unless its caller left the argument out.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parseFlags } from "node:util";
import { DEFAULTS, findConfig, loadConfig } from "./config.mjs";

/** A usage or environment error: whoever runs the command prints it and exits with `exitCode` (2 unless given). */
export class AwError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = "AwError";
    this.exitCode = exitCode;
  }
}

// ------------------------------------------------------------------------------------------------------------- io

/** The `io` a command works through, `{ cwd, env, stdout, stderr }`, each missing part taken from the process. */
export function ioOf(io = {}) {
  return { cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr, ...io };
}

/** An io that keeps what is printed instead of printing it: `io.out()` and `io.err()` give it back as text. */
export function bufferedIo(io = {}) {
  const out = [];
  const err = [];
  const sink = (lines) => ({ write: (chunk) => (lines.push(String(chunk)), true) });
  return { ...ioOf(io), stdout: sink(out), stderr: sink(err), out: () => out.join(""), err: () => err.join("") };
}

/** Everything piped to the command: `io.stdin` when it is a string, else the process's standard input read to its end. */
export function readStdin(io) {
  if (typeof io?.stdin === "string") return io.stdin;
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

const ascii = (text) => text.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** A document as the JSON text of every `--json` output and every file `aw` writes: two-space indent, ASCII only. */
export function jsonText(doc) {
  return ascii(JSON.stringify(doc ?? null, null, 2));
}

/** Print one JSON document (`asJson`), else `text`, else `obj` itself when it is a string, to `io.stdout`. */
export function emit(io, obj, asJson = false, text = null) {
  const line = asJson ? jsonText(obj) : text !== null && text !== undefined ? String(text) : typeof obj === "string" ? obj : jsonText(obj);
  io.stdout.write(`${line}\n`);
}

/** Print `message` to `io.stderr` and give back `code` (2): a command writes `return fail(io, "...")`. */
export function fail(io, message, code = 2) {
  io.stderr.write(`${message}\n`);
  return code;
}

// ----------------------------------------------------------------------------------------------------------- time

/** Now in UTC to the second, `2026-01-31T12:00:00Z`. */
export function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

/** Today's date where the machine is, `2026-01-31`. */
export function today() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// ---------------------------------------------------------------------------------------------------------- files

const decode = (bytes, keepMark) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: keepMark }).decode(bytes);

/** A file's text without a byte order mark and with LF line endings; `fallback` (null) when it cannot be read as UTF-8. */
export function readText(file, fallback = null) {
  if (typeof file !== "string") return fallback;
  try { return decode(fs.readFileSync(file), false).replace(/\r\n?/g, "\n"); } catch { return fallback; }
}

/** The parsed file; `fallback` (null) when it is missing, unreadable or not JSON. */
export function readJson(file, fallback = null) {
  const text = readText(file);
  if (text === null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

/** The file's text with its line endings and byte order mark as they are, so a write changes nothing else; null when unreadable. */
export function readRaw(file) {
  if (typeof file !== "string") return null;
  try { return decode(fs.readFileSync(file), true); } catch { return null; }
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Write through a temp file in the same folder and rename it: a reader never sees half a file. The folder is made. */
export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      // Windows: another process has the target open for a moment.
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || attempt === 19) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      pause(10 * (attempt + 1));
    }
  }
}

/** `atomicWrite` of a document as `jsonText` and a final newline. */
export function writeJson(file, doc) {
  atomicWrite(file, `${jsonText(doc)}\n`);
}

/** Create the file only if nothing is there yet. True when this call created it. */
export function exclusiveCreate(file, text = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, text, { flag: "wx" });
    return true;
  } catch (e) {
    // Windows reports a file that is being deleted as a permission error.
    if (["EEXIST", "EPERM", "EACCES"].includes(e.code)) return false;
    throw e;
  }
}

/** A path with forward slashes. */
export function posix(p) {
  return String(p).replace(/\\/g, "/");
}

/** `p` made absolute, with its links (and a Windows short name) resolved as far as the path exists. */
export function realPath(p) {
  let head = path.resolve(String(p));
  const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(head), ...tail); } catch { /* not there: resolve what is above it */ }
    const up = path.dirname(head);
    if (up === head) return path.join(head, ...tail);
    tail.unshift(path.basename(head));
    head = up;
  }
}

/** `p` relative to `root` with forward slashes; `p` itself (forward slashes) when it is not under `root`. */
export function rel(p, root) {
  try {
    const r = path.relative(realPath(root), realPath(p));
    if (r === "") return ".";
    if (r === ".." || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) return posix(p);
    return posix(r);
  } catch {
    return posix(p);
  }
}

const LINE_END = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/g;

/** The lines of a text, without their endings unless `keepEnds`; a final line ending adds no empty line. */
export function splitLines(text, keepEnds = false) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(LINE_END)) {
    const end = m.index + m[0].length;
    out.push(text.slice(at, keepEnds ? end : m.index));
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// ----------------------------------------------------------------------------------------------- repository roots

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

/** Where a lookup starts: `start` (default: the working directory) resolved, or its folder when it is a file. */
export function startDir(start) {
  const p = realPath(start || process.cwd());
  try { return fs.statSync(p).isDirectory() ? p : path.dirname(p); } catch { return p; }
}

/** A folder, then each folder above it up to the top. */
export function* ancestors(dir) {
  for (let p = dir; ; p = path.dirname(p)) {
    yield p;
    if (path.dirname(p) === p) return;
  }
}

/** The work tree's top: the first folder at or above `start` holding `.git` (a folder, or a file in a linked work tree). */
export function repoRoot(start) {
  for (const dir of ancestors(startDir(start))) if (fs.existsSync(path.join(dir, ".git"))) return dir;
  return null;
}

/** The git directory of the work tree at `root`, following a linked work tree's `.git` file; null when there is none. */
export function gitDir(root) {
  const dot = path.join(root, ".git");
  if (isDir(dot)) return dot;
  const m = /^\s*gitdir:\s*(.+?)\s*$/s.exec(readText(dot) ?? "");
  return m ? realPath(path.resolve(root, m[1])) : null;
}

/**
 * The main checkout of the repository, so every linked work tree resolves to one place. The answer of
 * `git rev-parse --git-common-dir` (its parent), read from the files so no process is started. Else `repoRoot`.
 */
export function mainRoot(start) {
  const root = repoRoot(start);
  if (root === null) return null;
  const g = gitDir(root);
  if (g === null || g === path.join(root, ".git")) return root;
  const common = readText(path.join(g, "commondir"));
  if (!common) return root; // a submodule: its own repository
  const c = realPath(path.resolve(g, common.trim()));
  return path.basename(c) === ".git" && isDir(path.dirname(c)) ? path.dirname(c) : root;
}

/** Run git and wait. `[exit code, stdout]`; `[127, ""]` when git is absent, is killed or runs past `timeoutMs`. */
export function git(args, cwd = null, { timeoutMs = 20_000, env = process.env } = {}) {
  try {
    const r = spawnSync("git", args, {
      cwd: cwd || undefined, env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true, maxBuffer: 256 * 1024 * 1024,
    });
    return r.error || r.status === null ? [127, ""] : [r.status, r.stdout];
  } catch {
    return [127, ""];
  }
}

/** The checked-out branch, read from HEAD without starting git; null when detached or outside a repository. */
export function currentBranch(start) {
  const root = repoRoot(start);
  const g = root === null ? null : gitDir(root);
  const head = g === null ? null : readText(path.join(g, "HEAD"));
  const m = /^ref:\s*refs\/heads\/(.+?)\s*$/.exec(head ?? "");
  return m ? m[1] : null;
}

// ------------------------------------------------------------------------------------------------------- projects

/** Where a project-level tool works: the folder of the config, else the work tree's top, else `start`. */
export function projectRoot(start) {
  const config = findConfig(start);
  if (config !== null) return path.dirname(path.dirname(config));
  return repoRoot(start) ?? startDir(start);
}

/** `<main checkout's folder name>-<8 hex of the sha1 of its path>`: one id for a repository and all its work trees. */
export function projectId(start) {
  const root = mainRoot(start) ?? startDir(start);
  const folded = process.platform === "win32" ? root.replace(/\//g, "\\").toLowerCase() : root;
  const key = folded.replace(/\\/g, "/").replace(/\/+$/, "");
  const name = path.basename(root).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  return `${name}-${createHash("sha1").update(key, "utf8").digest("hex").slice(0, 8)}`;
}

/**
 * The project's name for people: `name` in the config, else the folder name of the main checkout, so a linked work
 * tree says the project's name and not its own folder's. A project kept below the top of a repository (its config in
 * a sub-folder) keeps that folder's name. `projectId` is not derived from this.
 */
export function projectName(start, cfg = null) {
  const given = (cfg ?? loadConfig(start)).name;
  if (typeof given === "string" && given.trim()) return given.trim();
  let root = projectRoot(start);
  if (fs.existsSync(path.join(root, ".git"))) root = mainRoot(root) ?? root;
  return path.basename(root) || "project";
}

const homeDir = (env) => (process.platform === "win32" ? env.USERPROFILE : env.HOME) || os.homedir();

/** The machine-wide store: `AW_HOME` (or `AGENT_WORKS_HOME`), else `~/.agent-works`. Made by the first write, not here. */
export function awHome(env = process.env) {
  const given = env.AW_HOME || env.AGENT_WORKS_HOME;
  if (!given) return path.join(homeDir(env), ".agent-works");
  return given === "~" || /^~[\\/]/.test(given) ? path.join(homeDir(env), given.slice(1)) : path.normalize(given);
}

/** This project's folder in the store: `<awHome>/projects/<projectId>`. */
export function projectHome(start, env = process.env) {
  return path.join(awHome(env), "projects", projectId(start));
}

/** The agent's name: the variable named by `guard.agentVar`, then its aliases, then `CLAUDE_AGENT_NAME`; null when none is set. */
export function agentName(cfg = null, env = process.env) {
  const guard = (cfg ?? loadConfig()).guard || {};
  const aliases = Array.isArray(guard.agentVarAliases) ? guard.agentVarAliases : [];
  for (const name of [guard.agentVar || "AW_AGENT", ...aliases, "CLAUDE_AGENT_NAME"]) {
    const value = String(env[String(name)] ?? "").trim();
    if (value) return value;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------------- findings

/** The levels of a finding, gravest first. */
export const LEVELS = Object.freeze(["critical", "warning", "info"]);

const asDict = (f) => ({ code: f.code, level: f.level, path: f.path ?? "", line: f.line ?? 0, message: f.message ?? "" });

function findingText(f) {
  const where = (f.path ?? "") + (f.line ? `:${f.line}` : "");
  return `${String(f.level).toUpperCase().padEnd(8)} ${String(f.code).padEnd(22)} ${where}${where ? " — " : ""}${f.message ?? ""}`;
}

/** One thing a check found: `code`, `level` (one of LEVELS), `path`, `line` (0 for none) and `message`. */
export class Finding {
  constructor(code, level, path = "", line = 0, message = "") {
    this.code = code;
    this.level = level;
    this.path = path;
    this.line = line;
    this.message = message;
  }

  /** The finding as a plain object, in the key order of every JSON output. */
  toDict() {
    return asDict(this);
  }

  /** The finding as one line of a check's report. */
  text() {
    return findingText(this);
  }
}

/** Every finding code a check can report. `accept` in the config names one of these. */
export const CODES = Object.freeze([
  "ACCEPT_UNUSED",
  "BRIEF_SIZE", "BRIEF_STRAY", "BRIEF_UNTRACKED",
  "CLAUDE_CHAIN", "CONFIG_INVALID", "CONTRACT_MISSING", "CONTRACT_STALE",
  "DEC_AMENDED", "DEC_INDEX_HANDWRITTEN", "DEC_INDEX_STALE", "DEC_NUMBER", "DEC_SECTIONS", "DEC_SIZE",
  "DOCS_AGENT_FILE", "DUP_RULE",
  "GATE_OWED_OLD", "GEN_TWIN_MISSING", "GEN_TWIN_ORPHAN", "GLOSSARY_DUP_TERM", "GLOSSARY_MULTI", "GLOSSARY_ROW_LONG",
  "HUB_ISOLATION", "HUB_MISSING", "HUB_MIXED_DIR", "HUB_ROOT_MISSING", "HUB_SIZE", "HUB_STALE_CHILD", "HUB_UNLISTED_CHILD",
  "KANBAN_CARD_INVALID", "KANBAN_EPIC_UNKNOWN", "KANBAN_GRANT_ORPHAN", "KANBAN_OLD_FOLDER", "KANBAN_REVIEW_UNLINKED",
  "KANBAN_SPRINT_OVERDUE", "KANBAN_SPRINT_UNKNOWN", "KANBAN_STALE_START", "KANBAN_STATUS_UNKNOWN", "KANBAN_UNTRACKED",
  "LINK_BROKEN",
  "MEM_FILE_SIZE", "MEM_FOLDER_OVER", "MEM_FRONTMATTER", "MEM_HOOK_LONG", "MEM_INDEX_HANDWRITTEN",
  "MEM_INDEX_PLACEHOLDER", "MEM_INDEX_STALE", "MEM_LINK_DANGLING", "MEM_NAME_MISMATCH", "MEM_ROOT_LOOSE",
  "MEM_SHARED_CANDIDATE", "MEM_SLUG_DUP",
  "PATH_MISSING",
  "ROOT_PLUGINS", "ROOT_SIZE", "ROOT_STATUS_PROSE",
  "STATUS_DONE_SECTION", "STATUS_MULTI", "STATUS_SIZE",
  "TASKS_TWO_HOMES",
]);

/**
 * Never accepted, whatever the config says: a broken config and the report about the list itself. (Every critical
 * finding too: `splitAccepted` goes by its level.)
 */
export const NEVER_ACCEPTED = Object.freeze(["CONFIG_INVALID", "ACCEPT_UNUSED"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A value as one line of JSON with a space after each comma and colon, ASCII only: how a message quotes a config value. */
function inlineJson(value) {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`;
  if (isObject(value)) return `{${Object.entries(value).map(([k, v]) => `${ascii(JSON.stringify(k))}: ${inlineJson(v)}`).join(", ")}}`;
  return ascii(JSON.stringify(value ?? null));
}

function acceptPath(value) {
  let text = posix(value).trim();
  while (text.startsWith("./")) text = text.slice(2);
  return text.replace(/\/+$/, "") || text;
}

/**
 * True when `name` matches the shell pattern: `*` is any run of characters (a `/` included), `?` is one, `[abc]` and
 * `[!abc]` are sets. The whole name must match, and case counts.
 */
export function fnmatch(name, pattern) {
  let source = "";
  for (let i = 0; i < pattern.length;) {
    const c = pattern[i++];
    if (c === "*") {
      source += ".*";
    } else if (c === "?") {
      source += ".";
    } else if (c === "[") {
      let j = i;
      if (pattern[j] === "!") j++;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j++;
      if (j >= pattern.length) {
        source += "\\[";
        continue;
      }
      let set = pattern.slice(i, j);
      i = j + 1;
      const negated = set.startsWith("!");
      if (negated) set = set.slice(1);
      if (!set) source += negated ? "." : "(?!)";
      else source += `[${negated ? "^" : ""}${set.replace(/[\\\]\[^]/g, "\\$&")}]`;
    } else {
      source += c.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
    }
  }
  try { return new RegExp(`^(?:${source})$`, "s").test(name); } catch { return false; }
}

/**
 * `accept` of the config as `[the entries that hold, what is wrong with the others]`. An entry holds when it is
 * `{ code: <a finding code>, path: <an exact path or a glob>, why: <a reason> }`, all three non-empty. Each good entry
 * carries its place in the list as `index`.
 */
export function acceptEntries(cfg) {
  const raw = cfg?.accept;
  if (raw === null || raw === undefined) return [[], []];
  if (!Array.isArray(raw)) return [[], ['"accept" must be a list']];
  const good = [];
  const bad = [];
  raw.forEach((entry, index) => {
    const at = `accept[${index}]`;
    if (!isObject(entry)) {
      bad.push(`${at}: an entry is {"code": …, "path": …, "why": …}, not ${inlineJson(entry)}`);
      return;
    }
    const { code, why } = entry;
    if (typeof code !== "string" || !CODES.includes(code)) {
      bad.push(`${at}: "code" ${inlineJson(code)} is not a finding code (aw doctor --json lists the codes it found)`);
    } else if (NEVER_ACCEPTED.includes(code)) {
      bad.push(`${at}: ${code} is never accepted`);
    } else if (typeof entry.path !== "string" || !entry.path.trim()) {
      bad.push(`${at}: "path" is the finding's path, or a glob over paths, as a non-empty string`);
    } else if (typeof why !== "string" || !why.trim()) {
      bad.push(`${at}: "why" is required: the reason this finding stays, in a sentence`);
    } else {
      good.push({ index, code, path: acceptPath(entry.path), why: why.trim() });
    }
  });
  return [good, bad];
}

/**
 * `[the findings that stay, the accepted ones as plain objects with their why, the entries with what they met]`.
 * A finding is accepted when an entry names its code and its path (exactly, or as a glob in which `*` also crosses
 * `/`). A critical finding is never accepted. Each entry comes back with `used` (it took a finding) and `critical`
 * (it met a finding that cannot be accepted), which is what ACCEPT_UNUSED is made of.
 */
export function splitAccepted(findings, cfg) {
  const entries = acceptEntries(cfg ?? {})[0].map((e) => ({ ...e, used: false, critical: false }));
  const kept = [];
  const accepted = [];
  for (const f of findings) {
    const where = acceptPath(f.path ?? "");
    const hit = entries.find((e) => e.code === f.code && (e.path === where || fnmatch(where, e.path)));
    if (!hit || NEVER_ACCEPTED.includes(f.code)) {
      kept.push(f);
    } else if (f.level === "critical") {
      hit.critical = true;
      kept.push(f);
    } else {
      hit.used = true;
      accepted.push({ ...asDict(f), why: hit.why });
    }
  }
  return [kept, accepted, entries];
}

/** Where a report sends the reader for the findings it left out. */
export const ACCEPTED_HINT = "aw doctor --accepted lists them";

/** The line a report prints for the findings the project accepted. */
export function acceptedLine(accepted) {
  return `${accepted.length} accepted (${ACCEPTED_HINT})`;
}

/** The exit code of a finding list: 2 with a critical finding, 1 with a warning, else 0 (info never fails a run). */
export function exitFor(findings) {
  const levels = new Set([...findings].map((f) => f.level));
  return levels.has("critical") ? 2 : levels.has("warning") ? 1 : 0;
}

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rank = (f) => (LEVELS.includes(f.level) ? LEVELS.indexOf(f.level) : 9);

/** The findings gravest first, then by code, path and line. A new list. */
export function sortFindings(findings) {
  return [...findings].sort((a, b) => rank(a) - rank(b) || order(a.code, b.code) || order(a.path ?? "", b.path ?? "") || (a.line ?? 0) - (b.line ?? 0));
}

const countByLevel = (findings) => Object.fromEntries(LEVELS.map((level) => [level, findings.filter((f) => f.level === level).length]));

/**
 * The one JSON shape of every finding list (other plugins read it): the check's own keys (`extra`), then
 * `summary: { critical, warning, info }` and `findings: [{ code, level, path, line, message }]`.
 */
export function findingsDoc(findings, extra = null) {
  const sorted = sortFindings(findings);
  return { ...(extra ?? {}), summary: countByLevel(sorted), findings: sorted.map(asDict) };
}

/**
 * Print a check's findings the one way every `aw` check does, and give back its exit code. The findings the project
 * accepted (`accept` in `cfg`, else in the config found from `io.cwd`) are taken out first: they are not counted and
 * do not fail the run. With `json` they are listed under `accepted`, a key that is there only when something was.
 */
export function report(io, findings, { json = false, title = "", extra = null, cfg = null } = {}) {
  const [kept, accepted] = splitAccepted(sortFindings(findings), cfg ?? loadConfig(io.cwd));
  const code = exitFor(kept);
  if (json) {
    emit(io, findingsDoc(kept, { ...(extra ?? {}), ...(accepted.length ? { accepted } : {}) }), true);
    return code;
  }
  const lines = kept.map(findingText);
  if (accepted.length) lines.push(acceptedLine(accepted));
  const summary = Object.entries(countByLevel(kept)).filter(([, n]) => n).map(([level, n]) => `${n} ${level}`).join(", ") || "clean";
  lines.push(`${title ? `${title}: ` : ""}${summary}`);
  emit(io, lines.join("\n"));
  return code;
}

// ---------------------------------------------------------------------------------------------------- frontmatter

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function scalar(raw) {
  const v = raw.trim();
  if (v.length >= 2 && v[0] === v.at(-1) && "\"'".includes(v[0])) return v.slice(1, -1);
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(/,\s*/).map(scalar) : [];
  }
  return v;
}

/**
 * `[fields, body]` of a Markdown file; fields is null without a `---` block. The small subset the agent files use:
 * `key: value`, inline lists, `- item` lists and one level of nesting. Every value is text.
 */
export function parseFrontmatter(text) {
  const m = FRONTMATTER.exec(text);
  if (!m) return [null, text];
  const fields = {};
  let key = null;
  for (const raw of splitLines(m[1])) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    if (" \t".includes(raw[0]) && key !== null) {
      const item = raw.trim();
      if (item.startsWith("- ")) {
        if (!Array.isArray(fields[key])) fields[key] = [];
        fields[key].push(scalar(item.slice(2)));
      } else if (item.includes(":")) {
        if (!isObject(fields[key])) fields[key] = {};
        const colon = item.indexOf(":");
        fields[key][item.slice(0, colon).trim()] = scalar(item.slice(colon + 1));
      }
      continue;
    }
    const colon = raw.indexOf(":");
    if (colon < 0) continue;
    key = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1);
    fields[key] = value.trim() ? scalar(value) : "";
  }
  return [fields, text.slice(m[0].length)];
}

// ------------------------------------------------------------------------------------------------------ templates

/** The plugin's own folder: the one that holds `lib/`. */
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** Where the plugin keeps its templates. */
export const TEMPLATES = path.join(PLUGIN_ROOT, "assets", "templates");

/**
 * The plugin's template `assets/templates/<name>` with each `{{key}}` of `values` filled. The files are the one copy
 * of each template. A place nobody filled stays visible as `{{key}}`. A missing template is an AwError.
 */
export function template(name, values = {}) {
  let text = readText(path.join(TEMPLATES, name));
  if (text === null) throw new AwError(`the plugin's template assets/templates/${name} is missing: the installation is incomplete`);
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{{${key}}}`, () => String(value));
  return text;
}

/** The plugins section of a root AGENTS.md, from its opening marker to its closing one. */
export const PLUGINS_BLOCK = /<!-- agent-works:plugins\b[\s\S]*?<!-- \/agent-works:plugins -->\n?/;

/**
 * The section of the root AGENTS.md that introduces the plugins named by `plugins` in the config ("" for none).
 * Every session and every sub-agent loads the root file, so this is what primes them to open a skill when its case
 * comes up. One copy, the template `agents-plugins.md`: a row is kept when its plugin is in the list.
 */
export function pluginsBlock(cfg = null) {
  const given = cfg?.plugins ?? DEFAULTS.plugins;
  const names = Array.isArray(given) ? given.map(String) : [];
  if (!names.length) return "";
  const rows = splitLines(template("agents-plugins.md")).filter((line) => {
    const m = /^\| \*\*([^*]+)\*\* \|/.exec(line);
    return !m || names.includes(m[1]);
  });
  return `${rows.join("\n")}\n`;
}

/** `text` (a root AGENTS.md) with the plugins section put in or brought up to date, nothing else touched. LF endings. */
export function withPluginsBlock(text, block) {
  const lf = text.replace(/\r\n/g, "\n");
  if (PLUGINS_BLOCK.test(lf)) return lf.replace(PLUGINS_BLOCK, () => block);
  if (!block) return lf;
  const heads = [...lf.matchAll(/(?:^|(?<=\n))## /g)].map((m) => m.index);
  // After the first section (what the project is), before the rest.
  if (heads.length >= 2) return `${lf.slice(0, heads[1])}${block}\n${lf.slice(heads[1])}`;
  return `${lf}${lf.endsWith("\n") ? "" : "\n"}\n${block}`;
}

/** The plugin's version, from its `plugin.json`; "0.0.0" when it cannot be read. */
export function pluginVersion() {
  const doc = readJson(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), {});
  return isObject(doc) ? String(doc.version || "0.0.0") : "0.0.0";
}

/** How many lines a text has; a last line without a line ending counts. */
export function lineCount(text) {
  return text.split("\n").length - 1 + (text && !text.endsWith("\n") ? 1 : 0);
}

// ------------------------------------------------------------------- indexes: generated, or written by hand
// An index (a memory folder's INDEX.md, the decisions' README.md) is generated when one of its first lines is the
// marker its command writes. Any other is written by hand, and is never rewritten as a side effect.

/** "missing", "generated" (`marker` is one of the file's first `within` lines) or "handwritten". */
export function indexKind(index, marker, within = 2) {
  const text = readText(index);
  if (text === null) return "missing";
  return splitLines(text).slice(0, within).some((line) => line.trim() === marker) ? "generated" : "handwritten";
}

/** How many lines of an index say something the generated one would not: what generating it loses. */
export function linesLost(have, generated) {
  const keep = new Set(splitLines(generated).map((line) => line.trim()));
  return splitLines(have).filter((line) => line.trim() && !keep.has(line.trim())).length;
}

/** Add one list line to an index written by hand, after its last list line (at the end when it has none). False when the file cannot be read. */
export function appendListLine(file, line) {
  const raw = readRaw(file);
  if (raw === null) return false;
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  const ended = (text) => text.endsWith("\n") || text.endsWith("\r");
  const rows = splitLines(raw, true);
  const last = rows.findLastIndex((row) => row.startsWith("- [") || row.startsWith("* ["));
  if (last < 0) {
    const gap = !raw ? "" : ended(raw) ? nl : nl + nl;
    atomicWrite(file, raw + gap + line + nl);
    return true;
  }
  if (!ended(rows[last])) rows[last] += nl;
  rows.splice(last + 1, 0, line + nl);
  atomicWrite(file, rows.join(""));
  return true;
}

const SKIPPED_FOLDERS = new Set(["node_modules", "build", "dist", "target", "out", "vendor", "__pycache__", "venv", ".git"]);

/** Compare two paths folder by folder, so a folder's files sort together whatever else its name is a prefix of. */
function byParts(a, b) {
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p).split(path.sep);
  const [x, y] = [fold(a), fold(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return order(x[i], y[i]);
  return x.length - y.length;
}

/** The Markdown files under `root` that git tracks or would add, sorted; without git, a walk that skips dependency folders. */
export function markdownFiles(root) {
  const [code, out] = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"], root);
  if (code === 0) {
    const files = new Set(out.split("\0").filter(Boolean).map((name) => path.join(root, name)));
    return [...files].filter(isFile).sort(byParts);
  }
  const found = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) && (!entry.name.startsWith(".") || entry.name === ".agents")) walk(full);
      } else if (entry.name.toLowerCase().endsWith(".md") && !isDir(full)) {
        found.push(full);
      }
    }
  };
  walk(String(root));
  return found.sort(byParts);
}

// ------------------------------------------------------------------------------------------------------- commands

/**
 * A command's arguments, read. `options` is what `node:util`'s parseArgs takes, such as
 * `{ json: { type: "boolean" }, as: { type: "string" }, exclude: { type: "string", multiple: true } }`; `-h` and
 * `--help` are always known. Gives `{ values, positionals, rest, help }`: `rest` is what followed a `--`, untouched
 * (null without one). An unknown flag or a flag without its value is an AwError.
 */
export function parseArgs(argv, options = {}) {
  const cut = argv.indexOf("--");
  try {
    const { values, positionals } = parseFlags({
      args: cut < 0 ? argv : argv.slice(0, cut),
      options: { help: { type: "boolean", short: "h" }, ...options },
      allowPositionals: true,
      strict: true,
    });
    return { values, positionals, rest: cut < 0 ? null : argv.slice(cut + 1), help: values.help === true };
  } catch (e) {
    throw new AwError(e.message);
  }
}

/** A flag's value as a whole number: `fallback` when the flag was not given, an AwError when it is not one. */
export function intArg(value, flag, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (!/^[+-]?\d+$/.test(String(value).trim())) throw new AwError(`${flag} takes a whole number, not "${value}"`);
  return Number(value);
}

/**
 * Run a command's `main(argv, io)` and give back its exit code. An AwError is printed as `<name>: <message>` and
 * gives its own code; a closed pipe ends quietly with 0; anything else is printed with its stack and gives 1.
 */
export async function runCommand(main, argv, io, name = "aw") {
  const through = ioOf(io);
  try {
    return Math.trunc(Number(await main(argv, through))) || 0;
  } catch (e) {
    if (e instanceof AwError) return fail(through, `${name}: ${e.message}`, e.exitCode);
    if (e?.code === "EPIPE") return 0;
    return fail(through, `${name}: ${e?.stack ?? e}`, 1);
  }
}

/** True when the module at `importMetaUrl` is the script Node was started with. */
export function isMain(importMetaUrl) {
  try {
    return fs.realpathSync.native(fileURLToPath(importMetaUrl)) === fs.realpathSync.native(process.argv[1]);
  } catch {
    return false;
  }
}

/** Run `main` as this process's command: its arguments, its io, and `process.exitCode` set from what it gives back. */
export async function runCli(main, name = "aw") {
  // A reader that stops early (`aw ... | head`) is not an error.
  process.stdout.on("error", (e) => { if (e?.code !== "EPIPE") throw e; });
  process.exitCode = await runCommand(main, process.argv.slice(2), ioOf(), name);
}

/**
 * The last line of a command module, `runMain(import.meta.url, main)`: `runCli(main)` when the module is the script
 * Node was started with, nothing when it was imported. Errors are printed under `name` (default: `aw <file name>`).
 */
export async function runMain(importMetaUrl, main, name = null) {
  if (!isMain(importMetaUrl)) return;
  const base = path.basename(fileURLToPath(importMetaUrl)).replace(/\.[cm]?js$/, "");
  await runCli(main, name ?? (base === "aw" ? "aw" : `aw ${base}`));
}
