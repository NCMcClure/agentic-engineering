// The lines the agentcraft plugin keeps in an agent's context: at session
// start, after every compaction or /clear, and in subagents. One copy, run by
// one command (session-start.mjs beside it), which prints the shared line
// once, then each area's lines under the area's name, then the once-per-clone
// question. An area's lines are data, in its own hooks/critical.json.
//
// Given the hook payload and the environment, it answers:
//   root       the work tree the session is in: the payload's cwd first,
//              since a worktree session's project dir is the main checkout
//   mode       full (.agents/manifest.json or an older layout's marker, or
//              the person answered `team`),
//              portable (an area's own marker is committed, or the person
//              answered `on`), none (`off`, or nothing answered yet). A
//              committed marker outranks a personal `off`.
//   subagent   a SubagentStart, and whether its agent type is denied context
//   lines      each area's lines for this mode, audience, and repo
//   question   whether to ask the person, once per clone, if this repo uses
//              the plugin: only the main session, only where nothing settles
//              it. The answer is personal, kept in the clone's git config,
//              and never asked for again.
//
// Every area is always present, so nothing here reads a settings file to
// decide who speaks: a line that waited on another plugin stands behind its
// own `when`.
//
// A subagent gets only the lines marked all, and never a briefing (that is
// briefing.mjs, a SessionStart command of its own); a denied agent type gets
// nothing at all. In mode none the plugin says nothing but the question.
//
// An area whose layout in a repo has changed exports a migrate function. The
// briefing command runs it first, in the main session only, and it may only
// use the move(from, to) and write(rel, content, { mode }) it is handed: both
// refuse to touch a path that exists, so a migration cannot overwrite and
// running it twice changes nothing. What moved is reported to the model and
// to the person.
//
// Reads files and git config only: no network. Fail open: a question that
// cannot be answered answers in the quiet direction, nothing throws, and the
// hook exits 0 through process.exitCode.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MARKETPLACE = "agentic-engineering";
export const PLUGIN = "agentcraft";
// The areas that keep critical lines, in the order their blocks print.
export const AREAS = ["agentic-teamwork", "agent-works", "code-diet", "docs-parity", "but-first-planning", "perceptual-loop", "system-map"];
// Agents that must not get the lines: read-only searchers and planners that
// never act on them, host helpers, and an unanchored judge that must never
// see what the builder meant.
export const DENYLIST = new Set(["Explore", "Plan", "web-fetch", "claude-code-guide", "statusline-setup", "agentcraft:vision-critic"]);
export const SHARED_LINE = "Nothing is done until it's checked, and a claim isn't a check.";
export const MODES = ["full", "portable", "any"];
export const AUDIENCES = ["main", "all"];
export const CHOICES = ["team", "on", "off"];
// Named for the marketplace, and kept: an answer recorded before the plugins
// became areas of this one is still the answer.
export const CONFIG_KEY = `${MARKETPLACE}.plugins`;
// The repo-wide marker: a repo that carries it runs every area in full.
export const MANIFEST = ".agents/manifest.json";
// One area's own marker: a repo that committed any of these chose the plugin,
// so the portable lines apply without asking.
export const MARKERS = [".agents/agent-works.json", ".agents/docs-parity.json", ".agents/perceptual", ".agents/plan", ".agents/system-map.json", "miro.config.mjs", "diagrams/miro.config.mjs"];
// The repo-wide marker of an older layout. A repo that still carries one is on
// the conventions already, and is read so while the migration moves it.
export const OLD_MANIFESTS = [".claude/teamwork.json"];
// One area's own marker in an older layout, counted the same way until it is
// moved: the lines command may run before the briefing command has moved it.
// A planning workspace is known by a script only that area wrote into it.
export const OLD_MARKERS = [".perceptual-loop", ".plan/plan/plan-status.py", ".plan/plan/verify-plan-tree.py", ".plan/spec/scripts/verify-spec-tree.py"];
// How long one area's migration may take before the hook stops waiting on it.
export const MIGRATE_MS = 3000;

// What each part of the briefing command may print, in characters. A host
// shows the model only a preview of a hook's output past 10,000, so each part
// is cut to its allowance and the gate holds their sum under that.
export const BRIEFING_CHARS = { "agentic-teamwork": 1400, "agent-works": 900, "docs-parity": 300, "but-first-planning": 500, "perceptual-loop": 1400, "system-map": 400 };
// Every area's report of what its migration moved, together: one report may
// take all of it, since two layouts rarely move in one session.
export const MIGRATION_CHARS = 4200;
// The notice that an installed copy is behind the catalog.
export const CATALOG_CHARS = 400;

// Each area's lines sit in its own hooks/, beside the code they speak for.
const dataFile = (area) => path.join(import.meta.dirname, "..", "skills", area, "hooks", "critical.json");

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const toplevel = (dir) => { try { return git(dir, "rev-parse", "--show-toplevel") || null; } catch { return null; } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const present = (root, rel) => Boolean(root) && fs.existsSync(path.join(root, rel));

/** `text` as it is, or cut to `max` characters with a mark that says it was cut. */
export const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function readPayload() {
  try { return JSON.parse(fs.readFileSync(0, "utf8").replace(/^﻿/, "") || "{}") ?? {}; } catch { return {}; }
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

/** What the hook knows about this session: the event, the repo and its mode, and whether a subagent is denied the lines. */
export function answer(payload, env = process.env) {
  const event = payload.hook_event_name ?? "SessionStart";
  const root = repoRoot(payload, env);
  const subagent = event === "SubagentStart";
  const choice = choiceOf(root);
  return { event, root, mode: modeOf(root, choice), choice, subagent, denied: subagent && DENYLIST.has(payload.agent_type) };
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
 * The once-per-clone question, or "". A folder with no git cannot keep the
 * answer, so it is asked each session until git init.
 */
export function questionFor(state) {
  if (state.subagent || state.mode !== "none" || state.choice) return "";
  const kind = repoKind(state.root);
  if (!kind) return "";
  return [
    `Before other work, ask the person once whether to use the ${PLUGIN} plugin in this repo: the team conventions (on their yes, /${PLUGIN}:agentic-teamwork bootstrap), or the plugin only (its portable discipline, none of the repo conventions), or no (the plugin stays silent here).`,
    `Record the answer with git config --local ${CONFIG_KEY} "<team|on|off> <who> <iso date>" (who: git config user.name) and never ask again in this clone; the plugin's lines arrive from the next session.`,
    kind === "empty" ? "This folder is not a git repo yet, so the answer keeps only after git init." : "",
  ].filter(Boolean).join(" ");
}

const opted = (root, when) => !when || [when].flat().some((p) => present(root, p));
const applies = (line, state) =>
  (line.for === "all" || !state.subagent) && (line.mode === "any" || line.mode === state.mode) && opted(state.root, line.when);

/** The lines one area prints for this state. */
export function criticalLines(data, state) {
  if (state.mode === "none" || state.denied || !data) return [];
  return (data.lines ?? []).filter((l) => applies(l, state)).map((l) => l.text);
}

export const renderCritical = (area, lines) => (lines.length ? `Critical, from ${area}:\n${lines.map((l) => `- ${l}`).join("\n")}` : "");

/** Every area's data, in AREAS order: `{ area, data }`, data null where the file is missing or does not parse. */
export const readAreas = () => AREAS.map((area) => ({ area, data: readJson(dataFile(area)) }));

/**
 * What the critical-lines command prints for this state: the shared line
 * once, then a block for each area with a line that applies. Nothing where
 * the plugin is silent (mode none) or the agent is denied.
 */
export function criticalBlocks(state, areas = readAreas()) {
  if (state.mode === "none" || state.denied) return [];
  return [SHARED_LINE, ...areas.map(({ area, data }) => renderCritical(area, criticalLines(data, state))).filter(Boolean)];
}

// ---- the route index -----------------------------------------------------
// Where the skill listing does not fit its budget (a 200k context window),
// the host lists this plugin's skills by name alone: fourteen names, and no
// route among them, since a route is a document and never listed. So the
// lines command says which routes each area has, and how one is taken. Read
// from each area's door.json as it runs, so it cannot drift from the areas.
export const ROUTES_HEAD = `Routes, by area. An area is a skill: call it with the Skill tool and the route as the first word of its arguments (${PLUGIN}:agentic-teamwork with ship). A route is no skill of its own.`;
const skillsDir = () => path.join(import.meta.dirname, "..", "skills");

/** Each area and its routes, in name order: `{ area, routes }`, for every skill directory with a door.json. */
export function readRoutes(dir = skillsDir()) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; }
  return names.map((area) => ({ area, routes: Object.keys(readJson(path.join(dir, area, "door.json"))?.routes ?? {}) })).filter((a) => a.routes.length);
}

/**
 * The route index, for the main session of a repo where the plugin speaks. A
 * subagent is handed its task by the session that started it, and a repo
 * nobody answered for gets the question and nothing else.
 */
export function routeIndex(state, areas = readRoutes()) {
  if (state.mode === "none" || state.subagent || !areas.length) return "";
  return [ROUTES_HEAD, ...areas.map(({ area, routes }) => `- ${area}: ${routes.join(", ")}`)].join("\n");
}

// ---- the catalog ---------------------------------------------------------
// The catalog as this machine last fetched it: the marketplace clone on disk,
// so nothing here touches the network.

const configDir = (env) => env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
const pluginsDir = (env) => env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(configDir(env), "plugins");

function catalog(env) {
  const entry = readJson(path.join(pluginsDir(env), "known_marketplaces.json"))?.[MARKETPLACE];
  const dir = entry?.installLocation;
  const listing = dir && readJson(path.join(dir, ".claude-plugin", "marketplace.json"));
  if (!listing) return null;
  const plugins = (listing.plugins ?? []).map((p) => {
    const local = typeof p.source === "string" ? readJson(path.join(dir, p.source, ".claude-plugin", "plugin.json")) : null;
    return { name: p.name, version: local?.version ?? null };
  });
  return { plugins, inPlace: ["directory", "file"].includes(entry.source?.source) };
}

/**
 * Installed copies older than the catalog: this plugin, and any plugin under
 * an older name that has not yet become the stub that depends on it, which is
 * what still runs its own hooks beside this one's. A marketplace registered
 * from a local checkout is never behind.
 */
export function behindCatalog(env = process.env) {
  const cat = catalog(env);
  if (!cat || cat.inPlace) return [];
  const installed = readJson(path.join(pluginsDir(env), "installed_plugins.json"))?.plugins ?? {};
  return cat.plugins.flatMap((p) => {
    const record = (installed[`${p.name}@${MARKETPLACE}`] ?? []).find((r) => r.scope === "user");
    return record?.version && p.version && record.version !== p.version ? [{ name: p.name, installed: record.version, available: p.version }] : [];
  });
}

/** One line for what is behind the catalog, or "". */
export function catalogNotice(env = process.env) {
  try {
    const behind = behindCatalog(env);
    if (!behind.length) return "";
    return clip(`Behind the ${MARKETPLACE} catalog: ${behind.map((b) => `${b.name} ${b.installed} (catalog ${b.available})`).join(", ")}. Tell the person once: claude plugin update <name>@${MARKETPLACE} for each, then a new session.`, CATALOG_CHARS);
  } catch { return ""; /* fail open */ }
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

/** Run an area's migrate with a move and a write that never overwrite; returns what happened, or null. */
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
export function migrationReport(area, result) {
  if (!result) return { context: "", message: "" };
  const changed = [...result.moved, ...result.wrote.map((w) => `wrote ${w}`)];
  const parts = [];
  if (changed.length) parts.push(`${area} moved this repo to its current layout: ${changed.join("; ")}. Nothing else changed; commit these with your next change.`);
  if (result.notes.length) parts.push(result.notes.join(" "));
  if (result.kept.length) parts.push(`${area} left these in place because the new path already exists: ${result.kept.join("; ")}. Merge them by hand and delete the old one.`);
  if (result.failed.length) parts.push(`${area} could not finish moving to its current layout (${result.failed.join("; ")}). What it did not move is untouched; tell the person.`);
  const context = parts.join(" ");
  const summary = [
    changed.length ? `moved ${changed.length} path(s) to its current layout` : "",
    result.kept.length ? `left ${result.kept.length} old path(s) to merge by hand` : "",
    result.failed.length ? "could not finish a layout move" : "",
  ].filter(Boolean).join(", ");
  return { context, message: summary ? `${area} ${summary}.` : "" };
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
 * A SessionStart or SubagentStart command, whole. `parts` is given the
 * payload and answers with the text blocks to print, or with `{ blocks,
 * message }` where there is also a line for the person; they go out as one
 * context block, or nothing. A denied agent type never reaches it. Fail
 * open: nothing throws, and the hook exits 0.
 */
export async function run(parts) {
  // process.exitCode, not process.exit: an exit while stdout drains can cut
  // the output short, and a host reads that as a crashed hook.
  process.exitCode = 0;
  try {
    const payload = readPayload();
    const event = payload.hook_event_name ?? "SessionStart";
    if (event === "SubagentStart" && DENYLIST.has(payload.agent_type)) return;
    const out = await parts(payload);
    const { blocks, message = "" } = Array.isArray(out) ? { blocks: out } : out ?? { blocks: [] };
    emit(event, (blocks ?? []).filter(Boolean).join("\n\n"), message);
  } catch { /* fail open: never cost a session over context */ }
}
