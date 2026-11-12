// The lines every agentic-engineering plugin keeps in an agent's context: at
// session start, after every compaction or /clear, and in subagents. Each
// plugin ships this file unchanged in its hooks/ (a plugin cannot reach
// outside its own directory) with its own lines beside it in critical.json.
// The marketplace repo keeps the one copy that is edited and hash-checks the
// rest.
//
// Given the hook payload and the environment, it answers:
//   root       the work tree the session is in: the payload's cwd first,
//              since a worktree session's project dir is the main checkout
//   mode       full (.agents/manifest.json or an older layout's marker, or
//              the person answered `team`),
//              portable (a plugin's own marker is committed, or the person
//              answered `on`), none (`off`, or nothing answered yet). A
//              committed marker outranks a personal `off`.
//   enabled    the plugins enabledPlugins turns on in the user's, the
//              project's, the project's local, and the managed settings, each
//              later file overriding the earlier
//   asker      whether this plugin is the first enabled one in ORDER: the one
//              that prints the shared first line, the catalog notices, and
//              the question
//   subagent   a SubagentStart, and whether its agent type is denied context
//   question   whether to ask the person, once per clone, if this repo uses
//              the plugins: only the asker, only the main session, only where
//              nothing settles it. The answer is personal, kept in the
//              clone's git config, and never asked for again.
//
// What it cannot see: plugins loaded with --plugin-dir or a --settings file,
// and a partner on an older version that ships no session hook. There a
// chain line can be missing or the shared line can print twice; both cost a
// line, never a wrong instruction.
//
// A subagent never gets a plugin's briefing, only the lines marked all, and
// a denied agent type gets nothing at all. In mode none a plugin says
// nothing: no briefing, no lines, only the asker's question.
//
// A plugin whose layout in a repo has changed passes run() a migrate
// function. It runs first, in the main session only, and may only use the
// move(from, to) and write(rel, content, { mode }) it is handed: both refuse
// to touch a path that exists, so a migration cannot overwrite and running it
// twice changes nothing. What moved is reported to the model and to the person.
//
// Reads files and git config only: no network. Fail open: a question that
// cannot be answered answers in the quiet direction, nothing throws, and the
// hook exits 0 through process.exitCode.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MARKETPLACE = "agentic-engineering";
export const ORDER = ["agentic-teamwork", "agent-works", "code-diet", "docs-parity", "but-first-planning", "perceptual-loop", "marvelous-miro"];
// Agents that must not get the lines: read-only searchers and planners that
// never act on them, host helpers, and an unanchored judge that must never
// see what the builder meant.
export const DENYLIST = new Set(["Explore", "Plan", "web-fetch", "claude-code-guide", "statusline-setup", "perceptual-loop:vision-critic"]);
export const SHARED_LINE = "Nothing is done until it's checked, and a claim isn't a check.";
export const MODES = ["full", "portable", "any"];
export const AUDIENCES = ["main", "all"];
export const CHOICES = ["team", "on", "off"];
export const CONFIG_KEY = `${MARKETPLACE}.plugins`;
// The repo-wide marker: a repo that carries it runs every plugin in full.
export const MANIFEST = ".agents/manifest.json";
// One plugin's own marker: a repo that committed any of these chose the
// plugins, so their portable lines apply without asking.
export const MARKERS = [".agents/agent-works.json", ".agents/docs-parity.json", ".agents/perceptual", ".agents/plan", ".agents/system-map.json", "miro.config.mjs", "diagrams/miro.config.mjs"];
// The repo-wide marker of an older layout. A repo that still carries one is on
// the conventions already: every plugin treats it so while the owning plugin's
// migration, which may run after theirs in the same session, moves it.
export const OLD_MANIFESTS = [".claude/teamwork.json"];
// One plugin's own marker in an older layout, counted the same way until it is moved.
export const OLD_MARKERS = [".perceptual-loop"];
// How long a migration may take before the hook stops waiting on it.
export const MIGRATE_MS = 3000;

const DATA = path.join(import.meta.dirname, "critical.json");

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const toplevel = (dir) => { try { return git(dir, "rev-parse", "--show-toplevel") || null; } catch { return null; } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const present = (root, rel) => Boolean(root) && fs.existsSync(path.join(root, rel));

export function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, "") || "{}") ?? {}; } catch { return {}; }
}

/** The work tree the session is in, or the folder itself where there is no git yet. */
export function repoRoot(payload, env = process.env) {
  const cwd = typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : null;
  return (cwd && toplevel(cwd)) || env.CLAUDE_PROJECT_DIR || toplevel(process.cwd()) || cwd || null;
}

/** The person's answer for this clone, `team`, `on`, or `off`, or "" when nothing is recorded. */
export function choiceOf(root) {
  if (!root) return "";
  try { return git(root, "config", "--local", CONFIG_KEY).match(/^(team|on|off)\b/)?.[1] ?? ""; } catch { return ""; }
}

export function modeOf(root, choice = choiceOf(root)) {
  if (!root) return "none";
  if (present(root, MANIFEST) || choice === "team" || OLD_MANIFESTS.some((m) => present(root, m))) return "full";
  if (choice === "on" || [...MARKERS, ...OLD_MARKERS].some((m) => present(root, m))) return "portable";
  return "none";
}

// The managed file an administrator deploys, which wins over every other.
export const MANAGED_SETTINGS = { darwin: "/Library/Application Support/ClaudeCode/managed-settings.json", win32: "C:\\Program Files\\ClaudeCode\\managed-settings.json" }[process.platform] ?? "/etc/claude-code/managed-settings.json";

const configDir = (env) => env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
const pluginsDir = (env) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(configDir(env), "plugins");
const userSettings = (env) => path.join(configDir(env), "settings.json");

/**
 * The plugins `enabledPlugins` turns on: the user's settings, then the
 * project's, then the project's local, then the managed file, later files
 * winning. A worktree session reads the main checkout's project files too,
 * since an untracked settings.local.json lives only there.
 */
export function enabledPlugins(root, env = process.env, managed = MANAGED_SETTINGS) {
  const dirs = [...new Set([env.CLAUDE_PROJECT_DIR, root].filter(Boolean))];
  const files = [
    userSettings(env),
    ...dirs.map((d) => path.join(d, ".claude", "settings.json")),
    ...dirs.map((d) => path.join(d, ".claude", "settings.local.json")),
    managed,
  ];
  const merged = {};
  for (const file of files) Object.assign(merged, readJson(file)?.enabledPlugins ?? {});
  return new Set(ORDER.filter((n) => merged[`${n}@${MARKETPLACE}`] === true));
}

/** The first enabled plugin in ORDER asks the shared question and prints the shared line. */
export const isAsker = (self, enabled) => ORDER.find((n) => enabled.has(n)) === self;

export function answer(payload, env = process.env, self) {
  const event = payload.hook_event_name ?? "SessionStart";
  const root = repoRoot(payload, env);
  const enabled = enabledPlugins(root, env);
  // This plugin is running, so it is enabled whatever the files say.
  if (self) enabled.add(self);
  const subagent = event === "SubagentStart";
  const choice = choiceOf(root);
  return { event, root, mode: modeOf(root, choice), choice, enabled, asker: isAsker(self, enabled), subagent, denied: subagent && DENYLIST.has(payload.agent_type) };
}

/**
 * What an unanswered folder is: `repo` (a git work tree), `empty` (nothing
 * but dotfiles and no git yet, where most projects start), or null for a
 * folder with files and no git, which is somebody's notes and is never asked.
 */
export function repoKind(root) {
  if (!root) return null;
  try { git(root, "rev-parse", "--git-dir"); return "repo"; } catch { /* not a repo */ }
  try { return fs.readdirSync(root).every((n) => n.startsWith(".")) ? "empty" : null; } catch { return null; }
}

/**
 * The once-per-clone question, or "". The team conventions are offered only
 * with agentic-teamwork enabled to set them up. A folder with no git cannot
 * keep the answer, so it is asked each session until git init.
 */
export function questionFor(state) {
  if (!state.asker || state.subagent || state.mode !== "none" || state.choice) return "";
  const kind = repoKind(state.root);
  if (!kind) return "";
  const team = state.enabled.has("agentic-teamwork");
  const answers = [
    team ? "the team conventions (then run /agentic-teamwork:bootstrap)" : null,
    "plugins only (their portable discipline, none of the repo conventions)",
    `no (every ${MARKETPLACE} plugin stays silent here)`,
  ].filter(Boolean);
  const values = team ? "team|on|off" : "on|off";
  return [
    `Before other work, ask the person once whether to use the ${MARKETPLACE} plugins in this repo: ${answers.join(", or ")}.`,
    `Record the answer with git config --local ${CONFIG_KEY} "<${values}> <who> <iso date>" (who: git config user.name) and never ask again in this clone; the plugins' lines arrive from the next session.`,
    kind === "empty" ? "This folder is not a git repo yet, so the answer keeps only after git init." : "",
  ].filter(Boolean).join(" ");
}

const opted = (root, when) => !when || [when].flat().some((p) => present(root, p));
const applies = (line, state) =>
  (line.for === "all" || !state.subagent) && (line.mode === "any" || line.mode === state.mode) && opted(state.root, line.when);

/** The lines this plugin prints for this state, chain lines last. */
export function criticalLines(data, state) {
  if (state.mode === "none" || state.denied || !data) return [];
  const own = (data.lines ?? []).filter((l) => applies(l, state));
  const chains = (data.chains ?? []).filter((c) => state.enabled.has(c.partner) && applies(c, state));
  const lines = [...own, ...chains].map((l) => l.text);
  return lines.length || state.asker ? [...(state.asker ? [SHARED_LINE] : []), ...lines] : [];
}

export const renderCritical = (self, lines) => (lines.length ? `Critical, from ${self}:\n${lines.map((l) => `- ${l}`).join("\n")}` : "");

// ---- the catalog ---------------------------------------------------------
// The catalog as this machine last fetched it: the marketplace clone on disk,
// so nothing here touches the network.

function catalog(env) {
  const entry = readJson(path.join(pluginsDir(env), "known_marketplaces.json"))?.[MARKETPLACE];
  const dir = entry?.installLocation;
  const listing = dir && readJson(path.join(dir, ".claude-plugin", "marketplace.json"));
  if (!listing) return null;
  const plugins = (listing.plugins ?? []).map((p) => {
    const local = typeof p.source === "string" ? readJson(path.join(dir, p.source, ".claude-plugin", "plugin.json")) : null;
    return { name: p.name, version: local?.version ?? null, description: p.description ?? local?.description ?? "" };
  });
  return { plugins, inPlace: ["directory", "file"].includes(entry.source?.source) };
}

/** Installed copies older than the catalog. A marketplace registered from a local checkout is never behind. */
export function behindCatalog(env = process.env) {
  const cat = catalog(env);
  if (!cat || cat.inPlace) return [];
  const installed = readJson(path.join(pluginsDir(env), "installed_plugins.json"))?.plugins ?? {};
  return cat.plugins.flatMap((p) => {
    const record = (installed[`${p.name}@${MARKETPLACE}`] ?? []).find((r) => r.scope === "user");
    return record?.version && p.version && record.version !== p.version ? [{ name: p.name, installed: record.version, available: p.version }] : [];
  });
}

/**
 * Catalog plugins the person has neither enabled nor turned off, and has not
 * been told about: each is news once. `dataDir` is the plugin's own data
 * directory; without one there is nowhere to remember, so nothing is news
 * rather than everything being news every session.
 */
export function catalogNews(env = process.env, dataDir = env.CLAUDE_PLUGIN_DATA) {
  const cat = catalog(env);
  if (!cat || !dataDir) return [];
  const enabled = readJson(userSettings(env))?.enabledPlugins ?? {};
  const seenFile = path.join(dataDir, "catalog-seen.json");
  const seen = new Set(readJson(seenFile) ?? []);
  const news = cat.plugins.filter((p) => enabled[`${p.name}@${MARKETPLACE}`] === undefined && !seen.has(p.name));
  if (news.length) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(seenFile, `${JSON.stringify([...seen, ...news.map((p) => p.name)].sort())}\n`);
  }
  return news;
}

/** What changed in the catalog, for the asker to pass on: plugins behind it, and each new plugin once. */
export function catalogNotices(env = process.env) {
  const parts = [];
  try {
    const behind = behindCatalog(env);
    if (behind.length) parts.push(`Behind the ${MARKETPLACE} catalog: ${behind.map((b) => `${b.name} ${b.installed} (catalog ${b.available})`).join(", ")}. Update: ${behind.map((b) => `claude plugin update ${b.name}@${MARKETPLACE}`).join("; ")}, then start a new session.`);
    const news = catalogNews(env);
    if (news.length) parts.push(`New in the ${MARKETPLACE} catalog: ${news.map((p) => `${p.name} (${p.description.split(/(?<=\.)\s/)[0].slice(0, 120)})`).join("; ")}. Tell the person once; /plugin install <name>@${MARKETPLACE} adds one, and setting it to false in enabledPlugins silences it.`);
  } catch { /* fail open */ }
  return parts.join("\n\n");
}

// ---- migration -----------------------------------------------------------

/** Move one path to its new home: `moved`, `kept` (the target exists, so nothing is touched), or `absent`. */
export function moveOnce(root, from, to) {
  const source = path.join(root, from), target = path.join(root, to);
  if (!fs.existsSync(source)) return "absent";
  if (fs.existsSync(target)) return "kept";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(source, target);
  return "moved";
}

/** Run a plugin's migrate with a move and a write that never overwrite; returns what happened, or null. */
export async function migrated(migrate, payload, env = process.env) {
  const root = repoRoot(payload, env);
  if (typeof migrate !== "function" || !root) return null;
  const result = { moved: [], kept: [], wrote: [], notes: [], failed: [] };
  const api = {
    root, payload, env,
    move(from, to) {
      try {
        const outcome = moveOnce(root, from, to);
        if (outcome === "moved") result.moved.push(`${from} -> ${to}`);
        if (outcome === "kept") result.kept.push(`${from} (${to} exists)`);
        return outcome;
      } catch (e) { result.failed.push(`${from}: ${e.code ?? e.message}`); return "failed"; }
    },
    write(rel, content, { mode } = {}) {
      try {
        const target = path.join(root, rel);
        if (fs.existsSync(target)) return false;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, mode ? { mode } : undefined);
        result.wrote.push(rel);
        return true;
      } catch (e) { result.failed.push(`${rel}: ${e.code ?? e.message}`); return false; }
    },
  };
  let timer;
  try {
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve("late"), MIGRATE_MS); });
    const out = await Promise.race([Promise.resolve().then(() => migrate(api)), late]);
    if (out === "late") result.failed.push(`not finished after ${MIGRATE_MS / 1000}s`);
    else result.notes.push(...[out ?? []].flat().filter((n) => typeof n === "string" && n));
  } catch (e) {
    result.failed.push(String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
  // A note explains a change, so with nothing changed there is nothing to say.
  if (!result.moved.length && !result.wrote.length) result.notes = [];
  return Object.values(result).some((list) => list.length) ? result : null;
}

/** A migration's result as the model reads it (`context`) and as the person does (`message`). */
export function migrationReport(self, result) {
  if (!result) return { context: "", message: "" };
  const changed = [...result.moved, ...result.wrote.map((w) => `wrote ${w}`)];
  const parts = [];
  if (changed.length) parts.push(`${self} moved this repo to its current layout: ${changed.join("; ")}. Nothing else changed; commit these with your next change.`);
  if (result.notes.length) parts.push(result.notes.join(" "));
  if (result.kept.length) parts.push(`${self} left these in place because the new path already exists: ${result.kept.join("; ")}. Merge them by hand and delete the old one.`);
  if (result.failed.length) parts.push(`${self} could not finish moving to its current layout (${result.failed.join("; ")}). What it did not move is untouched; tell the person.`);
  const context = parts.join(" ");
  const summary = [
    changed.length ? `moved ${changed.length} path(s) to its current layout` : "",
    result.kept.length ? `left ${result.kept.length} old path(s) to merge by hand` : "",
    result.failed.length ? "could not finish a layout move" : "",
  ].filter(Boolean).join(", ");
  return { context, message: summary ? `${self} ${summary}.` : "" };
}

// ---- the hook ------------------------------------------------------------

/** One JSON object on stdout: context for the model, and a line for the person when there is one. */
export function emit(event, context, message) {
  const out = {};
  if (context) out.hookSpecificOutput = { hookEventName: event, additionalContext: context };
  if (message) out.systemMessage = message;
  if (context || message) console.log(JSON.stringify(out));
}

/**
 * The whole hook, as one context block or nothing: what a migration moved,
 * the plugin's own briefing (optional, given the payload and the state, main
 * session only), its critical lines, and from the asker the catalog notices
 * and the question.
 */
export async function run(briefing, { migrate } = {}) {
  // process.exitCode, not process.exit: an exit while stdout drains can cut
  // the output short, and a host reads that as a crashed hook.
  process.exitCode = 0;
  try {
    const payload = readPayload();
    const data = readJson(DATA);
    const self = data?.plugin;
    // critical.json is what names the plugin; without it there is nobody to speak as.
    if (!self) return;
    const event = payload.hook_event_name ?? "SessionStart";
    const subagent = event === "SubagentStart";
    if (subagent && DENYLIST.has(payload.agent_type)) return;
    // Before the state is read: a migration can create the marker the mode turns on.
    const report = migrationReport(self, subagent ? null : await migrated(migrate, payload));
    const state = answer(payload, process.env, self);
    const parts = [];
    if (report.context) parts.push(report.context);
    if (!state.subagent && state.mode !== "none") {
      try { const text = await briefing?.(payload, state); if (text) parts.push(text); } catch { /* the lines still go out */ }
    }
    const block = renderCritical(self, criticalLines(data, state));
    if (block) parts.push(block);
    if (state.asker && !state.subagent && state.mode !== "none") {
      const notices = catalogNotices();
      if (notices) parts.push(notices);
    }
    const question = questionFor(state);
    if (question) parts.push(question);
    emit(state.event, parts.join("\n\n"), report.message);
  } catch { /* fail open: never cost a session over context */ }
}
