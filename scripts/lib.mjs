// Shared helpers for the repo's own tooling. Node 22 stdlib only, never shipped.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
// Atomic: a half-written ~/.claude/settings.json costs the user their settings,
// and the installer rewrites files it does not own. Temp file beside the target
// (same filesystem, so rename is atomic), then rename over it.
export function writeJson(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// A one-line scalar as YAML reads it, so a count or a copy of it is of the text
// a host sees. A double-quoted scalar's escapes are undone (the ones a
// generator here writes are JSON's), a single-quoted scalar's '' is one quote,
// and anything else is plain text.
function scalar(raw) {
  const text = raw.trim();
  if (/^".*"$/s.test(text)) { try { return JSON.parse(text); } catch { return text.slice(1, -1); } }
  if (/^'.*'$/s.test(text)) return text.slice(1, -1).replaceAll("''", "'");
  return text;
}

// Frontmatter: a leading --- block of `key: value` pairs. Scalars keep their text
// (quotes stripped, escapes undone); `>` and `>-` fold their indented block into
// one line. That is every shape SKILL.md uses; anything richer is a reason to
// reach for a parser.
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return null;
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const out = {};
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (raw === ">" || raw === ">-" || raw === "|" || raw === "|-") {
      const block = [];
      while (i + 1 < end && (lines[i + 1].trim() === "" || /^\s+/.test(lines[i + 1]))) {
        block.push(lines[++i].trim());
      }
      out[key] = block.join(" ").trim();
    } else {
      out[key] = scalar(raw);
    }
  }
  return out;
}

// What follows the frontmatter block: the text a host hands the model when the
// skill is invoked. A file with no frontmatter is all body.
export function skillBody(text) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 3);
  return end === -1 ? text : text.slice(end + 5);
}

// A name in an address is word characters joined by single hyphens. One that
// runs on into a glob or a placeholder (`build-*`, `spec-<phase>`) names a
// family and is not one name, so it does not end here; `</` closes a tag and
// ends a name as any other character does.
const NAME = "[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)*";
const NAME_END = "(?![A-Za-z0-9_]|-?(?:[*{\\[$]|<(?!\\/)))";

/**
 * A finder for the addresses on one line of text: `<plugin>:<name>` for the
 * plugins named, bare or with the leading slash it is invoked by, and never
 * as a segment of a path. Each is `{ text, index, slash, plugin, name, route }`,
 * `index` being where on the line the address starts, for a caller that
 * rewrites it. `route` is the word one space after a slash-led address, the
 * first word of its arguments and so the route when the address is an area's,
 * or "" when what follows is not a word. Whether anything is at the address
 * is the caller's to check.
 */
export function addressFinder(plugins) {
  if (!plugins.length) return () => [];
  const names = plugins.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const address = new RegExp(`(?<![\\w@./-])(\\/?)(${names}):(${NAME})${NAME_END}`, "g");
  const argument = new RegExp(`^ (${NAME})${NAME_END}`);
  return (line) => [...line.matchAll(address)].map((m) => ({
    text: m[0],
    index: m.index,
    slash: m[1] === "/",
    plugin: m[2],
    name: m[3],
    route: (m[1] && argument.exec(line.slice(m.index + m[0].length))?.[1]) || "",
  }));
}

// A path under the plugin root, as skill markdown writes it: the variable,
// a slash, and the run of path characters after it. Placeholder characters
// are part of the run, so `skills/<route>/SKILL.md` is read whole and seen
// to be a pattern; `</` closes a tag and ends the path.
const ROOT_PATH = /\$\{CLAUDE_PLUGIN_ROOT\}\/((?:[A-Za-z0-9_.\/{}$*[\]>-]|<(?!\/))+)/g;

/** The plugin-root paths on one line: `{ path, placeholder }`, the path relative to the root. */
export const pluginRootPaths = (line) =>
  [...line.matchAll(ROOT_PATH)].map((m) => ({ path: m[1], placeholder: /[<>{}$*[\]]/.test(m[1]) }));

// A route is read by path, where nothing fills in the root variable. It names
// the directories its commands use from its own file, one capital letter
// each: "`W` below is `../..` from the directory this file is in". The
// sentence may wrap.
const NAMED_DIR = /`([A-Z])`\s+below\s+is\s+`([^`\s]+)`\s+from\s+the\s+directory\s+this\s+file\s+is\s+in/g;

// A route may name a directory that is not the plugin's as well: one of the
// repo it works in, which differs from run to run ("`P` below is the workspace
// this run works in"). It is declared by the same opening, without the "from
// the directory this file is in" that makes a name a path of the plugin, and
// no path under it is resolved here: there is nothing here to resolve it in.
const OUTSIDE_DIR = /`([A-Z])`\s+below\s+is\s+(?!`[^`\s]+`\s+from\s+the\s+directory\s+this\s+file\s+is\s+in)/g;

/** The letters a skill's markdown declares for a directory outside the plugin. */
export const outsideDirs = (text) => [...new Set([...String(text).matchAll(OUTSIDE_DIR)].map((m) => m[1]))];

/** The directories a skill's markdown names from its own file: `{ name, rel }` each, in order. */
export const namedDirs = (text) => [...String(text).matchAll(NAMED_DIR)].map((m) => ({ name: m[1], rel: m[2] }));

/**
 * The paths one line writes under named directories: `{ name, path, quoted }`
 * each. `names` is the letters this file declared. A letter inside a word or
 * a longer path is not one (`JS/TS`, `docs/S/x`). `quoted` says whether the
 * name follows a double quote or a backtick: a command quotes the path, prose
 * gives it a code span.
 */
export function namedPaths(line, names) {
  if (!names.length) return [];
  const use = new RegExp(`(?<![A-Za-z0-9_./-])(${names.join("|")})\\/((?:[A-Za-z0-9_.-]+\\/)*[A-Za-z0-9_.-]+)`, "g");
  return [...line.matchAll(use)].map((m) => ({ name: m[1], path: m[2], quoted: m.index > 0 && "\"`".includes(line[m.index - 1]) }));
}

// ---- one plugin of areas -------------------------------------------------
// The marketplace ships one plugin whose skills are areas. An area is a skill
// directory that holds `routes/`, and each route is a document there,
// `routes/<route>/ROUTE.md`. plugins/ holds no other directory.

/** The one plugin, and the skill a person types, which is the one skill of it that is not an area. */
export const AREA_PLUGIN = "agentic-engineering";
export const ENTRY_SKILL = "start-here";

/**
 * An area was a plugin of its own once, under the area's name, bar the two
 * whose plugin went by another: that name, and the area it is now. The
 * catalog lists none of them, so a file that still names one names nothing.
 */
export const REGROUPED = {
  // Areas retired when the thirteen were regrouped into areas named for a
  // domain of work: each was a plugin of its own before that, and an area
  // of this one after, under the name on the left.
  "but-first-planning": "planning", "agentic-teamwork": "delivery", "write-like-me": "writing",
  "code-diet": "code", "codebase-optimizer": "code",
  "plugin-workbench": "harness", "context-doctor": "harness", "workflow-studio": "harness",
};
export const OLD_NAMES = { "marvelous-miro": "system-map", "animated-storytelling": "picture-this", ...REGROUPED };

/**
 * The areas made in the regroup, which were never a plugin: `code:` is a
 * CSS selector's word as often as it is anything, so none is read as an old
 * plugin's name.
 */
export const NEVER_PLUGINS = new Set(Object.values(REGROUPED));

/**
 * The routes renamed when their area was: under each old name, a route's old
 * name and the name it has in the area it moved to. A route missing here kept
 * its name. An address still written with an old name is rewritten with this.
 */
export const OLD_ROUTES = {
  "code-diet": { "reuse-first": "reuse", "review-diet": "review", "capture-reusable": "capture" },
  "codebase-optimizer": { "optimize-codebase": "restructure", "codebase-organizer": "organize", "improve-codebase-architecture": "deepen" },
  "plugin-workbench": { "improve-plugin": "plugin-improve", "create-plugin": "plugin-create", "evaluate-plugin": "plugin-evaluate", "refresh-marketplace": "marketplace-refresh" },
  "workflow-studio": { "author-workflow": "workflow" },
};

/** Where an old name and one of its routes are now: `{ area, route }`, the route "" when none was given. Null for a name that is not an old one. */
export function renamedRoute(old, route = "") {
  const area = OLD_NAMES[old];
  if (!area) return null;
  return { area, route: route ? (OLD_ROUTES[old]?.[route] ?? route) : "" };
}

/** The old name a route of an area had, where it was renamed: `{ old, route }` with the area's own name for it now, or null. */
export function oldRouteIn(area, route) {
  for (const [old, routes] of Object.entries(OLD_ROUTES)) {
    if (OLD_NAMES[old] === area && Object.hasOwn(routes, route)) return { old, route: routes[route] };
  }
  return null;
}

/**
 * Whether a tracked file is history: a CHANGELOG.md, or what an area keeps of
 * the plugins it was made from, `skills/<area>/history/<old-name>.md`. History
 * keeps what it says.
 */
export const isHistory = (f) => f.split("/").pop() === "CHANGELOG.md" || /(?:^|\/)skills\/[^/]+\/history\/[^/]+\.md$/.test(f);

/**
 * A name the one plugin itself went by before 2.0.0. It is the plugin renamed,
 * not an area that moved in, so nothing maps it to an area: an install line,
 * an address, or an MCP tool name that still carries it names nothing now.
 */
export const OLD_PLUGIN_NAMES = ["agentcraft"];

// Files duplicated on purpose: a canonical file, and the copies held
// hash-equal to it. The plugin keeps one copy of what its areas share (in its
// lib/), so the only pairs left are files a route copies into a user's repo,
// where nothing can reach back into the plugin.
export const HASH_PAIRS = [
  { canonical: `plugins/${AREA_PLUGIN}/lib/provider.mjs`, copies: [`plugins/${AREA_PLUGIN}/skills/planning/routes/spec-init/assets/provider.mjs`] },
];

// The trees a route copies into a user's repo. A file there is another repo's
// file once copied: what it names is in that repo, and a copy already out
// there does not change when this one does.
const TEMPLATE_TREES = [
  `plugins/${AREA_PLUGIN}/skills/delivery/templates/`,
  `plugins/${AREA_PLUGIN}/skills/agent-works/assets/templates/`,
  `plugins/${AREA_PLUGIN}/skills/planning/routes/spec-init/assets/`,
  `plugins/${AREA_PLUGIN}/skills/docs-parity/routes/docs-init/assets/`,
  `plugins/${AREA_PLUGIN}/skills/system-map/routes/diagrams-init/assets/`,
  `plugins/${AREA_PLUGIN}/skills/writing/routes/calibrate/assets/`,
  `plugins/${AREA_PLUGIN}/skills/picture-this/kit/`,
  `plugins/${AREA_PLUGIN}/skills/picture-this/blank/`,
];

/** Whether a tracked file is a template copy: under one of those trees, or the canonical file of a pair whose copy is. */
export const isTemplateCopy = (f) =>
  TEMPLATE_TREES.some((tree) => f.startsWith(tree))
  || HASH_PAIRS.some((pair) => pair.canonical === f && pair.copies.some((copy) => isTemplateCopy(copy)));

// Files that record what a session did, or what a board held: the live lane's
// baseline, where `<plugin>:<skill>` names the skill a prompt was measured
// against, the transcripts its unit tests read, where it is a call a session
// made, and the card fixtures. None is a way to reach a skill, and a plugin
// that becomes an area later does not rewrite what was recorded before it.
export const isRecording = (f) =>
  f === "scripts/test-hooks/live/baseline.json" || f.startsWith("scripts/test-hooks/fixtures/live-lane/") || f.startsWith("scripts/test-hooks/cases/agent-works/cards/");

/**
 * The string literals of `<name> = new Set([...])` in a module's source, in
 * order, read off the text so the module is never run; null when the source
 * declares no such Set of literals.
 */
export function stringSet(source, name) {
  const body = new RegExp(`\\b${name}\\s*=\\s*new Set\\(\\[([^\\]]*)\\]\\)`).exec(source)?.[1];
  return body === undefined ? null : [...body.matchAll(/(["'])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
}

// Every file under dir, recursively, as paths relative to dir. Skips .git.
export function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

export const gitLsFiles = (root) =>
  execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

export const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const state = { failures: 0 };
export const ok = (what) => console.log(`ok: ${what}`);
export const fail = (what, where) => {
  state.failures++;
  console.log(`FAIL: ${what}${where ? ` (${where})` : ""}`);
};
export const note = (what) => console.log(`note: ${what}`);
export const failures = () => state.failures;

// ---- hook commands -------------------------------------------------------
// A Node hook is registered behind a guard, so a machine without Node on PATH
// gets one line at session start instead of an error on every event. The loud
// form says so to the person; the quiet form, for every other event, stays out
// of the way.
const NODE_MISSING = (plugin) => `Node 22 is not on PATH, so ${plugin} hooks are off.`;
const QUIET_GUARD = "command -v node >/dev/null 2>&1 || exit 0; ";
const loudGuard = (plugin) => `command -v node >/dev/null 2>&1 || { echo '${JSON.stringify({ systemMessage: NODE_MISSING(plugin) })}'; exit 0; }; `;
const NODE_CALL = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+\.m?js)"((?: [A-Za-z0-9_./=:-]+)*)$/;

/** The command hooks.json carries for a plugin's Node hook; `script` is plugin-relative. */
export const hookCommand = (plugin, script, { loud = false, args = [] } = {}) =>
  `${loud ? loudGuard(plugin) : QUIET_GUARD}node "\${CLAUDE_PLUGIN_ROOT}/${script}"${args.map((a) => ` ${a}`).join("")}`;

/**
 * A hooks.json command that runs Node on a plugin file, taken apart: its
 * `script` (plugin-relative), plain `args`, and `guard` (`loud`, `quiet`, or
 * null). Null for any other command.
 */
export function parseHookCommand(command, plugin) {
  const text = String(command ?? "");
  const guard = text.startsWith(loudGuard(plugin)) ? "loud" : text.startsWith(QUIET_GUARD) ? "quiet" : null;
  const call = NODE_CALL.exec(guard === "loud" ? text.slice(loudGuard(plugin).length) : guard === "quiet" ? text.slice(QUIET_GUARD.length) : text);
  return call ? { script: call[1], args: call[2].trim().split(" ").filter(Boolean), guard } : null;
}
