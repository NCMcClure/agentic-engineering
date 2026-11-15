#!/usr/bin/env node
// Move one plugin into the one plugin as an area. The plugins are becoming
// areas of `agentcraft`: a plugin's directory becomes
// plugins/agentcraft/skills/<plugin>/, its skills/ becomes routes/, and each
// SKILL.md a ROUTE.md, a document an agent reads by path. This does the parts
// of that a script can:
//
//   the moves        where each file goes is lib.mjs's areaPath. A skill named
//                    after its plugin is the area's own text; the manifest
//                    stays behind, for the stub; the hook map, the agents, the
//                    MCP servers, and bin/ become the one plugin's own.
//   the area's data  with no door.json, one is written: every skill a route
//                    with a blank cue, no lead, and no default, which validate
//                    then fails one by one. One that is there is never changed.
//   the paths        in every route, each plugin-root token and the path after
//                    it becomes a path under a directory the file names from
//                    itself; every other token, relative path, repo path, and
//                    path built from parts that named a file by its old place
//                    names it by its new one.
//   the hook map     merged into the one plugin's, each Node command behind
//                    the guard that names the one plugin.
//   the addresses    every `<plugin>:<skill>` in a tracked file becomes the
//                    address through the area, in markdown and JSON. Anywhere
//                    else it is reported.
//   the generator    gen-guide.mjs then writes the area, the entry skill, and
//                    the guide.
//
// What it cannot settle it leaves and reports with a file and a line: a token
// it cannot place, an address in code (a hand rewrites it, and where a skill is
// run by name the command and its arguments are passed apart), a path built
// from parts it cannot follow. A template copy and a recording keep what they
// say. A second run changes nothing.
//
// It takes a plugin the catalog lists as a directory here, never a path, and
// writes through no symbolic link.
//
// Usage: node scripts/door-plugin.mjs <plugin> [--root <dir>] [--check | --write] [--into <plugin>]
// With neither flag it says what a write would do and writes nothing; --check
// does the same and exits 1 when a write would change a file.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GUIDE, ROUTE_END, areaData, generate, generated, routeNames } from "./gen-guide.mjs";
import { AREA_PLUGIN as ONE, ENTRY_SKILL, SPLIT, addressFinder, areaOwner, areaPath, gitLsFiles, hookCommand, isRecording, isTemplateCopy, namedDirs, parseFrontmatter, parseHookCommand, placed, readJson, walk } from "./lib.mjs";

// ---- the area's data -------------------------------------------------------
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const skillNames = (root, plugin) => {
  const dir = path.join(root, "plugins", plugin, "skills");
  return isDir(dir) ? fs.readdirSync(dir).filter((d) => d !== plugin && fs.existsSync(path.join(dir, d, "SKILL.md"))).sort() : [];
};
// Where a plugin's own text and data are before the move: the skill named
// after it, whose directory becomes the area's.
const doorFile = (plugin) => `plugins/${plugin}/skills/${plugin}/SKILL.md`;
const doorData = (plugin) => `plugins/${plugin}/skills/${plugin}/door.json`;
const skillFile = (plugin, skill) => `plugins/${plugin}/skills/${skill}/SKILL.md`;

/**
 * The door.json a plugin with none starts from: every skill a route, in
 * directory order, with the blanks a person fills in. A skill that is out of
 * the listing is one only the person starts, and a route carries no such key,
 * so it is recorded here. The skill named after the plugin is the area's own
 * text, and one that leaves for an area of its own is that area's route.
 */
export function scaffold(root, plugin) {
  const routes = {};
  for (const skill of skillNames(root, plugin).filter((s) => !SPLIT[plugin]?.[s])) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(root, skillFile(plugin, skill)), "utf8")) ?? {};
    routes[skill] = fm["disable-model-invocation"] === "true" ? { cue: "", starts: "person" } : { cue: "" };
  }
  return { lead: "", default: "", routes };
}

// ---- the paths -------------------------------------------------------------
// The variable, and the path after it when there is one: the run of path
// characters lib.mjs reads, so a placeholder is part of the path.
const TOKEN = /\$\{CLAUDE_PLUGIN_ROOT\}((?:\/(?:[A-Za-z0-9_.\/{}$*[\]>-]|<(?!\/))+)?)/g;
// The plugin root from a skill's own file, skills/<skill>/SKILL.md.
const ROOT_REL = "../..";
// `W` first: it is the letter dev-rules.md states the sentence with.
const LETTERS = "WRDGHJKLMNQTUVXYZ";

/** The sentence a route names the plugin root with; validate reads it up to "is in". */
export const declaration = (letter, what = "the plugin's own directory") =>
  `\`${letter}\` below is \`${ROOT_REL}\` from the directory this file is in: ${what}. Write it out as an absolute path wherever a command or an argument says \`${letter}\`.`;

// Why a token in a command is left when a quoted string is already open around it.
const NESTED = "inside a double-quoted string: quoting it there would close the string";
// A letter standing alone anywhere in the file already means something there.
const standsAlone = (text, letter) => new RegExp(`(?<![A-Za-z0-9_./-])${letter}(?![A-Za-z0-9_-])`).test(text);

/**
 * A routed skill's SKILL.md with each plugin-root token placed under a named
 * directory: `{ text, placed, left }`, `left` being the tokens that stay,
 * `{ line, text, why }` each, by their line in the text returned.
 *
 * A token with a path becomes `W/<path>`: as it stands right after the quote
 * or the backtick that opens a string or a code span, in double quotes
 * anywhere else in a command (a code fence or a code span), and in a code
 * span of its own in prose. The variable alone is the root, so in a command
 * it becomes "W". The directory is declared once, below the heading (below
 * the frontmatter when there is none), unless the file declares it already.
 *
 * What has no form that validate accepts and a shell still runs is left:
 * the variable named in prose, a token after a single quote, inside a longer
 * word, or inside a double-quoted string that quoting it would close, an
 * unquoted glob, which double quotes would stop expanding, and any token
 * above the line the directory is declared on, where nothing can name it yet.
 *
 * `exists` says whether a path is in the plugin, which is how a path's own
 * full stop is told from the sentence's; without it a full stop ends the
 * sentence.
 */
export function placeRootPaths(text, { exists = () => false, what } = {}) {
  const declared = namedDirs(text).find((d) => path.posix.normalize(`${d.rel}/`) === `${ROOT_REL}/`)?.name;
  const letter = declared ?? [...LETTERS].find((l) => !standsAlone(text, l));
  const lines = text.split("\n");
  const frontmatterEnd = lines[0] === "---" ? lines.indexOf("---", 1) : -1;

  // Which lines sit in a code fence, and where the heading is.
  const fenced = [];
  let fence = "", heading = -1;
  for (let i = 0; i < lines.length; i++) {
    const mark = i > frontmatterEnd ? /^\s*(`{3,}|~{3,})/.exec(lines[i])?.[1] ?? "" : "";
    fenced[i] = Boolean(fence || mark);
    if (fence) { if (mark.startsWith(fence)) fence = ""; }
    else if (mark) fence = mark;
    else if (heading === -1 && i > frontmatterEnd && /^# /.test(lines[i])) heading = i;
  }
  // The line the directory is declared on: the file's own declaration, or
  // the line this one goes in at. Nothing above it can use the letter.
  const insertAt = (heading === -1 ? frontmatterEnd : heading) + 1;
  const declaredAt = declared
    ? text.slice(0, text.search(new RegExp(`\`${declared}\`\\s+below\\s+is\\s+\``))).split("\n").length - 1
    : insertAt;

  const left = [];
  let placed = 0;
  const place = (line, i) => line.replace(TOKEN, (token, rest, at) => {
    const before = line[at - 1] ?? "", after = line[at + token.length] ?? "";
    const leave = (why) => { left.push({ index: i, text: token, why }); return token; };
    const put = (written) => { placed++; return written; };
    if (!letter) return leave("no capital letter is free in this file to name the plugin root with");
    if (i < declaredAt) return leave("sits above where the directory is declared, so nothing there can name it yet");
    const head = line.slice(0, at);
    // In a fence a backtick is the shell's. Outside one, an odd count before
    // the token puts it inside a code span, and an odd count of unescaped
    // double quotes puts it inside a quoted string.
    const span = !fenced[i] && (head.split("`").length - 1) % 2 === 1;
    const command = fenced[i] || span;
    const inString = (head.match(/(?<!\\)"/g) ?? []).length % 2 === 1;
    if (before === "'") return leave("single-quoted: a route's path is double-quoted in a command");
    if (/[A-Za-z0-9_./\\-]/.test(before)) return leave("runs on from a longer word, so it is not a path of its own");
    // What opens right before the token: a quoted string (an escaped quote
    // opens one inside another), or a code span.
    const escaped = before === "\"" && line[at - 2] === "\\";
    const opensString = before === "\"" && (escaped || inString);
    const opensSpan = before === "`" && span;
    if (before === "\"" && !opensString) return leave("runs on from a quoted string, so it is not a path of its own");
    if (before === "`" && !fenced[i] && !opensSpan) return leave("runs on from a code span, so it is not a path of its own");
    if (rest) {
      const whole = rest.slice(1);
      // A full stop that ends the sentence is not part of the path.
      const target = exists(whole) ? whole : whole.replace(/\.+$/, "") || whole;
      const tail = whole.slice(target.length);
      if (opensString || opensSpan) return put(`${letter}/${target}${tail}`);
      if (!command) return put(`\`${letter}/${target}\`${tail}`);
      if (inString) return leave(NESTED);
      if (/[*?[\]{}]/.test(target)) return leave("an unquoted glob: double quotes would stop the shell expanding it");
      return put(`"${letter}/${target}"${tail}`);
    }
    if (/[A-Za-z0-9_/-]/.test(after)) return leave("runs on into a longer word, so it is not a path under the root");
    if (!command || (opensSpan && after === "`")) return leave("names the variable, not a path under it: say what the sentence means by hand");
    // The root as a whole quoted argument is the letter between its quotes.
    const closes = escaped ? line.startsWith("\\\"", at + token.length) : after === "\"";
    if (opensString) return closes ? put(letter) : leave(NESTED);
    if (inString) return leave(NESTED);
    return put(`"${letter}"`);
  });
  for (let i = 0; i < lines.length; i++) if (lines[i].includes("${CLAUDE_PLUGIN_ROOT}")) lines[i] = place(lines[i], i);

  // A blank line goes on each side of the declaration that has none.
  let added = 0;
  if (placed && !declared) {
    const insert = ["", declaration(letter, what), ...(lines[insertAt]?.trim() ? [""] : [])];
    lines.splice(insertAt, 0, ...insert);
    added = insert.length;
  }
  return {
    text: lines.join("\n"),
    placed,
    left: left.map(({ index, ...rest }) => ({ line: index + 1 + (index >= insertAt ? added : 0), ...rest })),
  };
}

// ---- the addresses ---------------------------------------------------------
// What a file is to an address in it. Markdown and JSON are text an agent or
// a person reads, so the address is rewritten there. Anywhere else it is
// reported. Code that runs a skill by name passes the command and its
// arguments apart, so one string cannot become two words: that is a hand's to
// rewrite, and validate fails each until one does. A template copy is another
// repo's file once copied and stays as it is; validate exempts it.
const WHY = {
  template: "a template copy, another repo's file once copied: it stays as it is",
  code: "code: a hand rewrites it, and where a skill is run by name the command and its arguments are passed apart",
  other: "neither markdown nor JSON",
  fixture: "a test that builds scratch marketplaces and says so (door-plugin: leave): its strings are fixtures, not names for this tree",
};
// A test file whose strings build scratch trees opts out of every rewrite
// with this line: a fixture's plugin may carry a real one's name.
const LEAVE = /^\/\/ door-plugin: leave\b/m;
const kindOf = (f) =>
  path.basename(f) === "CHANGELOG.md" ? "history"
    : isRecording(f) ? "recording"
      : isTemplateCopy(f) ? "template"
          : /\.(md|json)$/.test(f) ? "rewrite"
            : /\.[cm]?[jt]sx?$/.test(f) ? "code" : "other";

/** One line with each address `to` has an answer for replaced by it, and what followed kept: `{ line, count }`. */
export function rewriteLine(line, find, to) {
  let out = "", at = 0, count = 0;
  for (const a of find(line)) {
    const next = to(a);
    if (next == null) continue;
    out += line.slice(at, a.index) + next;
    at = a.index + a.text.length;
    count++;
  }
  return { line: out + line.slice(at), count };
}

/**
 * The addresses in `files` that `to` has an answer for, each by what its file
 * is: rewritten in markdown and JSON, counted and left in a CHANGELOG.md and
 * in a recording, listed to `stay` in a template copy, and listed for a
 * `hand` anywhere else. `find` reads a line's addresses, `to(address)` is
 * what one becomes, or null for an address that is not being moved, and
 * `read(file)` is a file's text, or null for one to pass over. `rewrites(kind)`
 * says which kinds of file are rewritten (markdown and JSON unless given),
 * and `name(file)` the path a file is judged and reported by. Returns
 * `{ edits, rewritten, files, hand, stay, left }`, `edits` being each changed
 * file's new text; nothing is written. The move to one plugin is this pass
 * with another `find` and `to`.
 */
export function rewriteAddresses({ files, read, find, to, rewrites = (kind) => kind === "rewrite", name = (file) => file }) {
  const out = { edits: new Map(), rewritten: 0, files: [], hand: [], stay: [], left: { history: 0, recordings: 0 } };
  for (const file of [...files].sort()) {
    const text = read(file);
    if (text == null) continue;
    const kind = LEAVE.test(text) ? "fixture" : kindOf(name(file));
    let count = 0;
    const lines = text.split("\n").map((line, i) => {
      if (rewrites(kind)) {
        const next = rewriteLine(line, find, to);
        count += next.count;
        return next.line;
      }
      for (const a of find(line)) {
        if (to(a) == null) continue;
        if (kind === "history") out.left.history++;
        else if (kind === "recording") out.left.recordings++;
        else out[kind === "template" ? "stay" : "hand"].push({ file: name(file), line: i + 1, text: a.text, becomes: to(a), why: WHY[kind] ?? WHY.code });
      }
      return line;
    });
    if (!count) continue;
    out.rewritten += count;
    out.files.push({ file: name(file), count });
    out.edits.set(file, lines.join("\n"));
  }
  return out;
}

// The plugin is a name the catalog lists as a directory here, never a path: a
// path reaches a skills directory anywhere on the disk, and the run would
// move what it found there.
function listed(root, plugin) {
  let catalog;
  try { catalog = readJson(path.join(root, ".claude-plugin", "marketplace.json")); }
  catch (e) { throw new Error(`.claude-plugin/marketplace.json could not be read (${e.message}), so there is no catalog to find ${JSON.stringify(plugin)} in`); }
  const entry = (Array.isArray(catalog?.plugins) ? catalog.plugins : []).find((p) => p?.name === plugin);
  if (!entry || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(plugin)) throw new Error(`${JSON.stringify(plugin)} is not a plugin the catalog lists`);
  if (entry.source !== `./plugins/${plugin}`) throw new Error(`${JSON.stringify(plugin)} is not a directory in this catalog: its source is ${JSON.stringify(entry.source)}, not "./plugins/${plugin}"`);
}

// Whether a path under the root is a symbolic link, or sits under one. A
// write to it lands wherever the link points, which may be outside the
// checkout, so no pass reads it as its own file and nothing is written to it.
function linked(root, rel) {
  let at = root;
  for (const part of rel.split("/")) {
    at = path.join(at, part);
    let stat;
    try { stat = fs.lstatSync(at); } catch { return false; } // not there yet, so nothing to follow
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}
const LINKED = "a symbolic link, or under one: its text is another file's, so no pass flips, rewrites, or writes it";

// ---- an area ---------------------------------------------------------------
// The plugins are becoming one plugin whose skills are areas. This moves one
// plugin in: where each file goes is lib.mjs's areaPath, and the rest is
// making what named a file by its old place name it by its new one.
export const AREA_PLUGIN = ONE;
// A run that stops part way leaves files moved and nothing rewritten, and no
// later run can tell which half is which.
const UNDO = "Put the tree back as its last commit has it (the moved files under the one plugin included), fix what stopped the run, and run it again.";

const posix = (p) => p.split(path.sep).join("/");
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isLink = (file) => { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } };
const isCode = (f) => /\.[cm]?[jt]sx?$/.test(f);
const MERGED = new Set([".mcp.json", "hooks/hooks.json"]);

/** A SKILL.md without the key that kept it out of the listing: a route is a document no host lists, and its area's data says who starts it. */
export function unflip(text) {
  const lines = text.split("\n");
  const end = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const at = lines.findIndex((l, i) => i > 0 && i < end && l.startsWith("disable-model-invocation:"));
  if (at !== -1) lines.splice(at, 1);
  return lines.join("\n");
}

// Each `${VAR}/<path>` in a string, with the path as areaPath has it.
const underRoot = (text, variable, plugin) =>
  text.replace(new RegExp(`\\$\\{${variable}\\}/([A-Za-z0-9_./-]+)`, "g"), (whole, rest) => {
    const to = areaPath(plugin, rest);
    return to == null ? whole : `\${${variable}}/${to}`;
  });
const deep = (value, fn) =>
  typeof value === "string" ? fn(value)
    : Array.isArray(value) ? value.map((v) => deep(v, fn))
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v, fn)])) : value;
const commands = (value) =>
  Array.isArray(value) ? value.reduce((n, v) => n + commands(v), 0)
    : value && typeof value === "object" ? Object.entries(value).reduce((n, [k, v]) => n + (k === "command" && typeof v === "string" ? 1 : commands(v)), 0) : 0;

// A path a file writes relative to itself: `./x`, `../x/y`, `..`.
const RELATIVE = /(?<![A-Za-z0-9_@~$}/.-])(\.\.(?:\/[A-Za-z0-9_.@-]+)*\/?|\.(?:\/[A-Za-z0-9_.@-]+)+\/?)(?![A-Za-z0-9_/-]|\.)/g;
// A path with no leading dot, as a markdown link's target or a code span of
// its own.
const BARE = /(?<=\]\(|`)([A-Za-z0-9_@-][A-Za-z0-9_.@-]*(?:\/[A-Za-z0-9_.@-]+)*\/?)(?=[)`#])/g;

/**
 * Move plugin `plugin` into the plugin `into` as an area, in the checkout at
 * `root`, or with no `write` say what that would do. Returns the report:
 * the files `moved` (`{ from, to }` each) and the ones that `stays` (the
 * manifest, for the stub), what was `merged` into the one plugin's own files
 * (hook entries, modules, MCP servers, agents), whether
 * the area's data was `scaffolded` and its `routes`, the routes' root `paths`
 * (`placed`, the `files`, the tokens `left`), the other files' `tokens`
 * (`rewritten`, `left`), the relative `links` rewritten, `addresses` and
 * `repoPaths` as rewriteAddresses returns them, and so the paths `built` from
 * string parts, the code `parts` that build a path a hand has to finish, the
 * links `skipped`, what the generator did (`generated`, null on a dry run),
 * and every file `changed`. A second run moves nothing and changes nothing.
 * Throws, before anything is written, when the plugin is not one the catalog
 * lists as a directory here, when the one plugin is not there to move into,
 * when it is neither a plugin with skills nor already an area, when it is
 * both, and when a file is already where one of its files would land.
 */
export function areaPlugin(root, plugin, { write = false, into = AREA_PLUGIN } = {}) {
  const at = (rel) => path.join(root, rel);
  const from = `plugins/${plugin}`, home = `plugins/${into}`, area = `${home}/skills/${plugin}`;
  // The one plugin is a name, never a path, and it is there already: it holds
  // the skill a person types, or an area. Anything else is another plugin's
  // directory, or a place outside the checkout.
  if (typeof into !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(into)) throw new Error(`${JSON.stringify(into)} is not a plugin's name; --into takes the name of the one plugin, never a path`);
  listed(root, plugin);
  if (plugin === into) throw new Error(`${JSON.stringify(plugin)} cannot be an area of itself`);
  const holdsAreas = isDir(at(`${home}/skills`)) && fs.readdirSync(at(`${home}/skills`)).some((skill) => isDir(at(`${home}/skills/${skill}/routes`)));
  const isOne = fs.existsSync(at(`${home}/.claude-plugin/plugin.json`)) && (holdsAreas || fs.existsSync(at(`${home}/skills/${ENTRY_SKILL}/SKILL.md`)));
  if (!isOne) throw new Error(`${home} is not the one plugin the areas go into: it has a manifest and holds the ${ENTRY_SKILL} skill or an area already. This moves a plugin in, and never makes that plugin`);
  const here = isDir(at(`${from}/skills`)), there = areaOwner(root, plugin) === into;
  if (!here && !there) throw new Error(`${from} has no skills directory, and ${area} is no area`);
  if (here && there) throw new Error(`${from}/skills and ${area}/routes are both there: a move was started and did not finish. ${UNDO}`);
  // Edits no commit holds are moved and rewritten as they are, and nothing
  // afterwards tells them from this run's own.
  let dirty = [];
  if (here) try {
    dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", from], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean).map((l) => l.slice(3));
  } catch { /* not a git checkout: nothing to compare with */ }

  // ---- where each file goes ------------------------------------------------
  const sources = here ? walk(at(from)).map(posix).sort() : [];
  const dest = new Map();          // a repo path as it is, to the repo path it moves to
  const stays = [], moved = [], skipped = [];
  for (const rel of sources) {
    const to = areaPath(plugin, rel);
    if (to == null) { stays.push(`${from}/${rel}`); continue; }
    if (MERGED.has(rel)) continue;
    const target = `${home}/${to}`;
    if (fs.existsSync(at(target)) || isLink(at(target))) throw new Error(`${target} is already there, and ${from}/${rel} would land on it`);
    dest.set(`${from}/${rel}`, target);
    if (isLink(at(`${from}/${rel}`))) skipped.push({ file: target, why: "a symbolic link: moved as the link it is, and no pass reads or writes through it" });
  }
  for (const [source, target] of dest) if (target.startsWith(`${home}/skills/`)) moved.push({ from: source, to: target });
  // Where an existing file or directory is after the move.
  const after = (rel) => {
    if (rel !== from && !rel.startsWith(`${from}/`)) return rel;
    if (!here) return rel;
    const to = areaPath(plugin, rel.slice(from.length + 1));
    return to == null ? rel : `${home}/${to}`;
  };
  const landed = new Set([...dest.values()]);
  const lands = (rel) => landed.has(rel) || [...landed].some((f) => f.startsWith(`${rel}/`));

  // ---- the area's data, and its routes ---------------------------------------
  // A skill that leaves for an area of its own is that area's route, not this one's.
  const split = Object.entries(SPLIT[plugin] ?? {}).filter(([skill]) => fs.existsSync(at(skillFile(plugin, skill))));
  const skillsHere = here ? skillNames(root, plugin).filter((s) => s !== ENTRY_SKILL && !SPLIT[plugin]?.[s]) : [];
  const dataRel = here ? doorData(plugin) : areaData(into, plugin);
  const staged = new Map();        // keyed by the path a file has now
  const disk = (rel) => (fs.existsSync(at(rel)) && !isLink(at(rel)) ? fs.readFileSync(at(rel), "utf8") : null);
  const current = (rel) => staged.get(rel) ?? disk(rel);
  const stage = (rel, text) => { if (text === disk(rel)) staged.delete(rel); else staged.set(rel, text); };
  let data;
  const scaffolded = disk(dataRel) === null;
  if (scaffolded) {
    data = scaffold(root, plugin);
    delete data.routes[ENTRY_SKILL];
    stage(dataRel, `${JSON.stringify(data, null, 2)}\n`);
  } else {
    try { data = JSON.parse(disk(dataRel)); } catch (e) { throw new Error(`${dataRel} does not parse (${e.message})`); }
  }
  const routes = here ? skillsHere : routeNames(root, into, plugin);
  const routeFiles = new Set([...routes.map((r) => skillFile(plugin, r)), ...split.map(([skill]) => skillFile(plugin, skill))]);
  const agentsDir = here ? `${from}/agents` : `${home}/agents`;
  const agents = new Set(isDir(at(agentsDir)) ? fs.readdirSync(at(agentsDir)).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)) : []);
  let servers = {};
  try { servers = readJson(at(here ? `${from}/.mcp.json` : `${home}/.mcp.json`)).mcpServers ?? {}; } catch { /* the plugin ships no MCP server */ }

  // ---- the area's own files --------------------------------------------------
  const paths = { placed: 0, files: [], left: [] }, tokens = { rewritten: 0, files: [], left: [] }, links = { rewritten: 0, files: [] };
  // A path to a manifest: those stay behind, and an installed copy of the one
  // plugin holds nothing of the old directory, so no path from here reaches it.
  const manifests = [];
  // What reads like a path and may not be one to this tree: left, and listed.
  const unsure = [];
  const STUB = "names a manifest of the plugin this was: it stays in the old directory, for the stub, and the one plugin's own is at its root";
  const existsHere = (rel) => fs.existsSync(at(rel));
  for (const [source, target] of dest) {
    const full = at(source);
    if (isLink(full) || fs.readFileSync(full).includes(0)) continue;
    // History is not rewritten, and a template copy is another repo's file:
    // what it names is in the repo it is copied into. Both move as they are.
    if (path.posix.basename(source) === "CHANGELOG.md" || isTemplateCopy(source)) continue;
    const dirWas = path.posix.dirname(source), dirIs = path.posix.dirname(target);
    const markdown = source.endsWith(".md");
    let text = fs.readFileSync(full, "utf8");
    const route = routeFiles.has(source);
    if (route) text = unflip(text);
    // A skill that left for an area of its own is that area's route, under the route's name.
    const leaving = split.find(([skill]) => skillFile(plugin, skill) === source);
    if (leaving) text = text.replace(/^(---\n(?:(?!---\n)[^\n]*\n)*?name:[ \t]*)[^\n]*/, (whole, head) => `${head}${leaving[1].route}`);

    // Paths under a directory the file already names from itself.
    const linksBefore = links.rewritten;
    const named = markdown ? namedDirs(text) : [];
    if (named.length) {
      const bases = new Map(named.map((d) => [d.name, path.posix.normalize(path.posix.join(dirWas, d.rel))]));
      const use = new RegExp(`(?<![A-Za-z0-9_./-])(${[...bases.keys()].join("|")})\\/((?:[A-Za-z0-9_.-]+\\/)*[A-Za-z0-9_.-]+)`, "g");
      text = text.replace(use, (whole, name, written) => {
        const base = bases.get(name);
        const p = existsHere(`${base}/${written}`) ? written : written.replace(/\.+$/, "");
        if (!p || !existsHere(`${base}/${p}`)) return whole;
        const next = path.posix.relative(after(base), after(`${base}/${p}`));
        if (next === p) return whole;
        links.rewritten++;
        return `${name}/${next}${written.slice(p.length)}`;
      });
    }

    // The plugin's root was this area's directory. A route names it from its
    // own file; any other file's token is filled in by the host, or printed
    // for a shell that has it, so it stays a token, under the one plugin's root.
    const countBefore = tokens.rewritten;
    if (route) {
      // The area this route is in: `skills/<area>` under the one plugin's root.
      const own = target.slice(home.length + 1).split("/").slice(0, 2).join("/");
      const out = placeRootPaths(text.replace(TOKEN, (token, rest) => {
        if (!rest) return token;
        const whole = rest.slice(1);
        const p = existsHere(`${from}/${whole}`) ? whole : whole.replace(/\.+$/, "") || whole;
        const to = areaPath(plugin, p);
        if (to == null) return token;
        const under = path.posix.relative(own, to);
        return `\${CLAUDE_PLUGIN_ROOT}${under ? `/${under}` : ""}${whole.slice(p.length)}`;
      }), { exists: (p) => lands(path.posix.normalize(`${home}/${own}/${p}`)), what: "the area's own directory" });
      text = out.text;
      if (out.placed) { paths.placed += out.placed; paths.files.push(target); }
      for (const l of out.left) paths.left.push({ file: target, ...l });
    } else {
      // The old door's generated block names the variable alone, and the
      // generator replaces that block.
      let generatedBlock = false;
      text = text.split("\n").map((line, i) => {
        if (source === doorFile(plugin)) {
          if (line.trim() === "## Route") generatedBlock = true;
          else if (line.trim() === ROUTE_END) generatedBlock = false;
        }
        return line.replace(TOKEN, (token, rest, index) => {
          if (!rest) {
            if (!generatedBlock && !/[A-Za-z0-9_]/.test(line[index + token.length] ?? "")) tokens.left.push({ file: target, line: i + 1, text: token, why: `the variable alone: it was this area's directory, which is \${CLAUDE_PLUGIN_ROOT}/skills/${plugin} now; say which the sentence means by hand` });
            return token;
          }
          const whole = rest.slice(1);
          const p = existsHere(`${from}/${whole}`) ? whole : whole.replace(/\.+$/, "") || whole;
          const to = areaPath(plugin, p);
          if (to == null) { tokens.left.push({ file: target, line: i + 1, text: token, why: "stays in the old directory, which becomes a stub: another plugin's file" }); return token; }
          if (to === p) return token;
          tokens.rewritten++;
          return `\${CLAUDE_PLUGIN_ROOT}/${to}${whole.slice(p.length)}`;
        });
      }).join("\n");
      if (tokens.rewritten > countBefore) tokens.files.push(target);
    }

    // What the file names relative to itself, wherever that is now.
    const turn = (written, resolved) => {
      const next = path.posix.relative(dirIs, after(resolved)) || ".";
      return written.endsWith("/") && !next.endsWith("/") ? `${next}/` : next;
    };
    const resolves = (written, base) => {
      const resolved = path.posix.normalize(path.posix.join(base, written)).replace(/\/$/, "");
      return resolved === ".." || resolved.startsWith("../") || !existsHere(resolved) ? null : resolved;
    };
    // The directory a file names from itself, in the sentence validate reads.
    const DECLARED = /(`[A-Z]`\s+below\s+is\s+`)([^`\s]+)(`\s+from\s+the\s+directory\s+this\s+file\s+is\s+in)/g;
    if (markdown) text = text.replace(DECLARED, (whole, lead, rel, tail) => {
      const resolved = resolves(rel, dirWas);
      // What a route calls the plugin's root is its own area's directory now,
      // which for a skill that left its plugin is not that plugin's area.
      const next = resolved && (route && resolved === from ? path.posix.relative(dirIs, `${home}/${target.slice(home.length + 1).split("/").slice(0, 2).join("/")}`) || "." : turn(rel, resolved));
      if (!next || next === rel) return whole;
      links.rewritten++;
      return lead + next + tail;
    });
    let fence = "";
    text = text.split("\n").map((line, i) => {
      const mark = markdown ? /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? "" : "";
      const fenced = Boolean(fence || mark);
      if (fence) { if (mark.startsWith(fence)) fence = ""; } else if (mark) fence = mark;
      // A path joined from this file's own directory, part by part: the
      // longest run of its string literals that is there is the path.
      if (isCode(source)) line = line.replace(/(import\.meta\.dirname\s*,\s*)((["'])\.\.?\3(?:\s*,\s*\3[A-Za-z0-9_.@-]+\3)*)/g, (whole, lead, run, quote) => {
        const all = [...run.matchAll(/["']([^"']*)["']/g)].map((part) => part[1]);
        let n = all.length;
        while (n > 0 && !resolves(all.slice(0, n).join("/"), dirWas)) n--;
        if (!n) return whole;
        const was = all.slice(0, n).join("/"), resolved = resolves(was, dirWas);
        if (resolved.startsWith(`${from}/`) && after(resolved) === resolved) return whole;   // a manifest: listed below
        // Nothing but steps up: how far up is what the code means (the
        // plugin's root, or the directory its siblings are in), and only a
        // person can say whether that is the area's or the one plugin's now.
        if (all.slice(0, n).every((part) => part === ".." || part === ".")) {
          const next = turn(was, resolved);
          if (next !== was) unsure.push({ file: target, line: i + 1, text: run, why: `a join of nothing but steps up, left as it is: if it means this file's place in the tree it is ${next.split("/").map((part) => `"${part}"`).join(", ")} now, and if it means so many levels above the file it is right` });
          return whole;
        }
        let next = turn(was, resolved);
        if (!next.startsWith(".")) next = `./${next}`;
        if (next === was) return whole;
        links.rewritten++;
        return lead + [...next.split("/"), ...all.slice(n)].map((part) => `${quote}${part}${quote}`).join(", ");
      });
      let out = line.replace(RELATIVE, (whole, _, index) => {
        // A chain of ../ with no file after it is prose about how deep a
        // tree is as often as it is a path, so it is never rewritten.
        if (/^(?:\.\.\/?)+$/.test(whole)) {
          const resolved = !/below\s+is\s+`$/.test(line.slice(0, index)) && resolves(whole, dirWas);
          const next = resolved && turn(whole, resolved);
          if (next && next !== whole && markdown) unsure.push({ file: target, line: i + 1, text: whole, why: `a chain of ../ with no file after it, left as it is: if it is a path from this file it is ${next} now, and if it describes another tree it is right` });
          return whole;
        }
        const p = resolves(whole, dirWas) ? whole : whole.replace(/\.+$/, "");
        const resolved = p && resolves(p, dirWas);
        if (!resolved) return whole;
        if (resolved.startsWith(`${from}/`) && after(resolved) === resolved) { manifests.push({ file: target, line: i + 1, text: p, why: STUB }); return whole; }
        let next = turn(p, resolved);
        // An import needs its leading dot; a link in prose reads better without one it never had.
        if (!next.startsWith(".") && (!markdown || p.startsWith("./"))) next = `./${next}`;
        if (next === p) return whole;
        links.rewritten++;
        return next + whole.slice(p.length);
      });
      if (markdown && !fenced) out = out.replace(BARE, (whole, _, index) => {
        // From the file's own directory first, then from the plugin's root,
        // which is how a README and a hub write a path, and how prose in a
        // skill names another skill's file.
        const own = resolves(whole, dirWas), rooted = own ? null : resolves(whole, from);
        if (own?.startsWith(`${from}/`) && after(own) === own) return whole;   // a manifest, named in prose: the hub's to say
        let next = whole;
        if (own) next = turn(whole, own);
        else if (rooted && after(rooted).startsWith(`${area}/`)) next = after(rooted).slice(area.length + 1) + (whole.endsWith("/") ? "/" : "");
        if (next === whole) return whole;
        // One bare directory name in a code span is as often any plugin's
        // (`skills/`) as this one's.
        if (out[index - 1] === "`" && !whole.replace(/\/$/, "").includes("/") && isDir(at(own ?? rooted))) {
          unsure.push({ file: target, line: i + 1, text: whole, why: `a directory's bare name in prose, left as it is: if it means this area's it is ${next} now, and if it means any plugin's it is right` });
          return whole;
        }
        links.rewritten++;
        return next;
      });
      return out;
    }).join("\n");
    if (links.rewritten > linksBefore) links.files.push(target);
    stage(source, text);
  }

  // ---- what the one plugin holds once ------------------------------------------
  const merged = { hooks: 0, modules: 0, servers: 0, agents: [...dest.values()].filter((t) => t.startsWith(`${home}/agents/`)).length };
  const out = new Map();           // files written whole, by the path they are written to
  let order = [];
  try { order = (readJson(at(".claude-plugin/marketplace.json")).plugins ?? []).map((p) => p?.name); } catch { /* listed() read it already */ }
  const rank = (entry) => { const area = /\/skills\/([^/"\\]+)\//.exec(JSON.stringify(entry))?.[1]; const at = order.indexOf(area); return at === -1 ? order.length : at; };
  const inCatalogOrder = (entries) => entries.map((entry, i) => [rank(entry), i, entry]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , entry]) => entry);
  // A Node command's guard names the plugin whose hooks are off without Node,
  // which is the one plugin now: the command is written again by the function
  // hooks.json is written with, over the path the move gave it.
  const reguard = (value) =>
    Array.isArray(value) ? value.map(reguard)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => {
        const call = k === "command" && typeof v === "string" ? parseHookCommand(v, plugin) : null;
        return [k, call?.guard ? hookCommand(into, call.script, { loud: call.guard === "loud", args: call.args }) : reguard(v)];
      })) : value;
  const mergeMap = (name, variable, count) => {
    const source = `${from}/hooks/${name}`, target = `${home}/hooks/${name}`;
    if (!here || disk(source) === null) return;
    let map;
    try { map = JSON.parse(disk(source)); } catch (e) { throw new Error(`${source} does not parse (${e.message})`); }
    let base = {};
    if (disk(target) !== null) try { base = JSON.parse(disk(target)); } catch (e) { throw new Error(`${target} does not parse (${e.message})`); }
    const hooks = { ...(base.hooks ?? {}) };
    // Each event's entries in the catalog's order of the plugins they came
    // from, whatever order the plugins were moved in.
    for (const [event, entries] of Object.entries(reguard(deep(map.hooks ?? {}, (s) => underRoot(s, variable, plugin))))) hooks[event] = inCatalogOrder([...(hooks[event] ?? []), ...entries]);
    // And the events by name, so the file is the same whichever plugin brought an event first.
    const byName = Object.fromEntries(Object.keys(hooks).sort().map((event) => [event, hooks[event]]));
    // A module is named by a path relative to the map that lists it.
    const modules = [].concat(map.modules ?? []).map((m) => {
      const next = path.posix.relative(`${home}/hooks`, after(path.posix.normalize(path.posix.join(`${from}/hooks`, m))));
      return next.startsWith(".") ? next : `./${next}`;
    });
    merged[count] += commands(map.hooks ?? {});
    merged.modules += modules.length;
    const { hooks: _, modules: had = [], ...rest } = base;
    const { hooks: __, modules: ___, ...own } = map;
    const all = inCatalogOrder([...new Set([...[].concat(had), ...modules])]);
    out.set(target, `${JSON.stringify({ ...own, ...rest, hooks: byName, ...(all.length ? { modules: all } : {}) }, null, 2)}\n`);
  };
  mergeMap("hooks.json", "CLAUDE_PLUGIN_ROOT", "hooks");
  if (here && disk(`${from}/.mcp.json`) !== null) {
    const target = `${home}/.mcp.json`;
    let base = {};
    if (disk(target) !== null) try { base = JSON.parse(disk(target)); } catch (e) { throw new Error(`${target} does not parse (${e.message})`); }
    for (const name of Object.keys(servers)) if (name in (base.mcpServers ?? {})) throw new Error(`${target} already has an MCP server named ${JSON.stringify(name)}, and ${from}/.mcp.json brings another`);
    merged.servers = Object.keys(servers).length;
    out.set(target, `${JSON.stringify({ ...base, mcpServers: { ...(base.mcpServers ?? {}), ...deep(servers, (s) => underRoot(s, "CLAUDE_PLUGIN_ROOT", plugin)) } }, null, 2)}\n`);
  }

  // A skill that left for an area of its own: that area's data, started the
  // way this one's is, where it has none.
  const created = [];
  for (const [, { area: other, route }] of split) {
    const rel = areaData(into, other);
    if (disk(rel) !== null) continue;
    out.set(rel, `${JSON.stringify({ lead: "", default: "", routes: { [route]: { cue: "" } } }, null, 2)}\n`);
    created.push(rel);
  }

  // ---- every file that names the plugin ------------------------------------------
  const catalogs = new Set([".claude-plugin/marketplace.json"]);
  const guide = new Set([GUIDE, placed(root, GUIDE), after(GUIDE)]);
  const files = new Set([...gitLsFiles(root), ...dest.keys(), ...(isDir(at(home)) ? walk(at(home)).map((f) => `${home}/${posix(f)}`) : [])]);
  const read = (rel) => {
    if (catalogs.has(rel) || guide.has(rel) || linked(root, rel) || !fs.existsSync(at(rel))) return null;
    if (rel.startsWith(`${from}/`) && !dest.has(rel)) return null;   // a manifest, which stays, or a map that is merged
    return !staged.has(rel) && fs.readFileSync(at(rel)).includes(0) ? null : current(rel);
  };
  // What a file is, and so what a pass does with it, is read off the path it
  // will have, and it is reported by that path.
  const pass = (options) => {
    const { edits, ...rest } = rewriteAddresses({ files, read, name: after, ...options });
    for (const [rel, text] of edits) stage(rel, text);
    return rest;
  };
  const routed = new Set(routes);
  const addresses = pass({
    find: addressFinder([plugin]),
    to: (a) => (a.name === plugin ? `/${into}:${plugin}`
      : SPLIT[plugin]?.[a.name] ? `/${into}:${SPLIT[plugin][a.name].area} ${SPLIT[plugin][a.name].route}`
        : routed.has(a.name) ? `/${into}:${plugin} ${a.name}`
          : agents.has(a.name) || a.name in servers ? `${a.slash ? "/" : ""}${into}:${a.name}` : null),
  });
  // A path from the repo's root. Code is text here: a path in a string is the
  // same path wherever it is written, unlike an address a call splits.
  const mention = new RegExp(`(?<![A-Za-z0-9_-])plugins\\/${escapeRe(plugin)}((?:\\/[A-Za-z0-9_.@<>{}$*\\[\\]-]+)*\\/?)(?![A-Za-z0-9_-])`, "g");
  const repoPaths = pass({
    find: (line) => [...line.matchAll(mention)].map((m) => ({ text: m[0], index: m.index, rest: m[1].replace(/^\//, "").replace(/\/$/, ""), slash: m[1].endsWith("/"), source: !m[1] && /["']\.\/$/.test(line.slice(0, m.index)) && /^["']/.test(line.slice(m.index + m[0].length)) })),
    to: (a) => {
      if (a.source) return null;   // a catalog entry's source, wherever one is written: the stub's
      // A full stop that ends the sentence is not part of the path.
      const p = !here || existsHere(`${from}/${a.rest}`) ? a.rest : a.rest.replace(/\.+$/, "");
      const to = areaPath(plugin, p);
      return to == null ? null : `${home}/${to}${a.slash ? "/" : ""}${a.rest.slice(p.length)}`;
    },
    rewrites: (kind) => kind !== "history" && kind !== "recording" && kind !== "template" && kind !== "fixture",
  });

  // The same path as the arguments of a join: "plugins", "<plugin>", and the
  // string literals after them, which are the path up to the first argument
  // that is not one.
  const joined = new RegExp(`(["'])plugins\\1\\s*,\\s*\\1${escapeRe(plugin)}\\1(?:\\s*,\\s*\\1[A-Za-z0-9_.@-]+\\1)*`, "g");
  const built = pass({
    find: (line) => [...line.matchAll(joined)].map((m) => ({ text: m[0], index: m.index, quote: m[1], rest: [...m[0].matchAll(/["']([^"']*)["']/g)].map((part) => part[1]).slice(2) })),
    to: (a) => {
      const to = areaPath(plugin, a.rest.join("/"));
      return to == null ? null : ["plugins", into, ...to.split("/")].map((part) => `${a.quote}${part}${a.quote}`).join(", ");
    },
    rewrites: (kind) => kind === "code",
  });

  // What is left of a path built from parts, which no pass above can finish:
  // a part that is a variable, and a file's name under a route.
  const parts = [];
  const q = "[\"'`]";
  const byName = new RegExp(`${q}plugins${q}\\s*,\\s*${q}${escapeRe(plugin)}${q}`);
  const byVariable = new RegExp(`${q}plugins${q}\\s*,\\s*(?!(?:false|true|null|undefined)\\b)[A-Za-z_$][\\w$]*\\s*[,)]`);
  const underArea = new RegExp(`${q}plugins${q}\\s*,\\s*${q}${escapeRe(into)}${q}\\s*,\\s*${q}skills${q}\\s*,\\s*${q}${escapeRe(plugin)}${q}`);
  for (const rel of [...files].sort()) {
    if (!isCode(rel) || isTemplateCopy(rel)) continue;
    const inArea = dest.has(rel) || rel.startsWith(`${area}/`);
    const text = read(rel);
    if (text == null) continue;
    text.split("\n").forEach((line, i) => {
      if (/^\s*(?:\/\/|\*)/.test(line)) return;   // a comment builds nothing
      const why = inArea ? (/SKILL\.md|(["'`])skills\1/.test(line) ? "a path built from parts: under an area skills/ is routes/ and SKILL.md is ROUTE.md"
        : /(["'`])\.claude-plugin\1/.test(line) ? STUB : null)
        : byName.test(line) ? `a path to plugins/${plugin} built from parts, which stays: the old directory keeps its manifests`
          : underArea.test(line) && /SKILL\.md|(["'`])skills\1\s*,\s*[A-Za-z_$]/.test(line) ? "a path under an area built from parts, as far as its string literals went: a route's file is ROUTE.md"
            : byVariable.test(line) ? `a plugin's path built from parts, the plugin named by a variable: one that is an area now is under plugins/${into}/skills/` : null;
      if (why) parts.push({ file: after(rel), line: i + 1, text: line.trim().slice(0, 80), why });
    });
  }

  parts.push(...manifests, ...unsure);
  parts.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));

  // ---- the write -----------------------------------------------------------------
  const changed = [...new Set([...dest.values(), ...[...staged.keys()].map(after), ...out.keys()])];
  if (write) try {
    for (const [source, target] of dest) {
      fs.mkdirSync(path.dirname(at(target)), { recursive: true });
      fs.renameSync(at(source), at(target));
    }
    for (const rel of MERGED) fs.rmSync(at(`${from}/${rel}`), { force: true });
    // What the moves emptied, from the deepest directory up.
    const prune = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) prune(path.join(dir, entry.name));
      if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
    };
    if (here) prune(at(from));
    for (const [rel, text] of [...[...staged].map(([rel, text]) => [after(rel), text]), ...out]) {
      fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
      fs.writeFileSync(at(rel), text);
    }
  } catch (e) {
    throw new Error(`the move of ${from} stopped part way (${e.message}). ${UNDO}`);
  }
  const results = write || !changed.length ? generate(root, { write }) : null;
  for (const r of results ?? []) if ((r.state === "wrote" || r.state === "stale" || r.state === "missing") && !changed.includes(r.rel)) changed.push(r.rel);

  return { plugin, into, dirty, moved, stays, merged, scaffolded, routes, paths, tokens, links, addresses, repoPaths, built, parts, skipped, created, generated: results, changed };
}

/** The area report as the command prints it. */
export function areaSummary(report, { write = false } = {}) {
  const { plugin, into, moved, stays, merged, scaffolded, routes, paths, tokens, links, addresses, repoPaths, built, parts, skipped, created } = report;
  const area = `plugins/${into}/skills/${plugin}`;
  const site = (s) => (s.line ? `  ${s.file}:${s.line}: ${s.text}${s.becomes ? ` (write ${s.becomes})` : ""}: ${s.why}` : `  ${s.file}: ${s.why}`);
  const hand = [...skipped, ...paths.left, ...tokens.left, ...addresses.hand, ...repoPaths.hand, ...built.hand, ...parts];
  const stay = [...addresses.stay, ...repoPaths.stay];
  return [
    ...(report.dirty.length ? [`NOT COMMITTED: ${count(report.dirty.length, "file")} under plugins/${plugin} ${report.dirty.length === 1 ? "differs" : "differ"} from the last commit, and ${write ? "moved and were" : "would move and be"} rewritten as ${report.dirty.length === 1 ? "it is" : "they are"}; nothing afterwards tells those edits from this run's (${report.dirty.slice(0, 5).join(", ")}${report.dirty.length > 5 ? ", ..." : ""})`] : []),
    moved.length || stays.length
      ? `moves: ${count(moved.length, "file")} under plugins/${into}/skills; ${stays.length} stay in plugins/${plugin} (its manifest)`
      : `moves: none, ${area} is an area already`,
    `routes: ${routes.length}${routes.length ? ` (${routes.join(", ")})` : ""}, each a ROUTE.md`,
    scaffolded
      ? `area data: ${write ? "wrote" : "would write"} ${area}/door.json: ${count(routes.length, "route")}, each cue, the lead, and the default left blank`
      : `area data: ${area}/door.json is there, and is left as it is`,
    `merged into the one plugin: ${count(merged.hooks, "hook entry", "hook entries")}, ${count(merged.modules, "module")}, ${count(merged.servers, "MCP server")}, ${count(merged.agents, "agent")}`,
    `paths: ${paths.placed} under a named directory in ${count(paths.files.length, "route")}; ${tokens.rewritten} other plugin-root paths now under the area in ${count(tokens.files.length, "file")}; ${links.rewritten} relative paths and links rewritten in ${count(links.files.length, "file")}; ${repoPaths.rewritten} paths from the repo's root rewritten in ${count(repoPaths.files.length, "file")}, and ${built.rewritten} built from parts in ${count(built.files.length, "file")}; ${paths.left.length + tokens.left.length + parts.length} left for a hand`,
    `addresses: ${addresses.rewritten} rewritten in ${count(addresses.files.length, "file")}; ${addresses.hand.length} left for a hand; ${addresses.stay.length} in template copies stay; left alone, ${addresses.left.history} in a CHANGELOG.md and ${addresses.left.recordings} in a recording`,
    ...(created.length ? [`started for an area a skill left for, each blank a person's to fill: ${created.join(", ")}`] : []),
    ...(hand.length ? [`by hand, ${hand.length}:`, ...hand.map(site)] : []),
    ...(stay.length ? [`staying in template copies, ${stay.length}:`, ...stay.map(site)] : []),
    ...(report.generated ? report.generated.map((result) => generated(result, write)) : ["generator: runs once these are written"]),
  ].join("\n");
}

// ---- the command -----------------------------------------------------------
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function main(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const valued = new Set(["--root", "--into"]);
  // A flag that takes a value and has none is a mistake, never its default.
  for (const name of valued) {
    if (argv.includes(name) && (flag(name) === undefined || flag(name).startsWith("--"))) { console.log(`door-plugin: ${name} takes a value`); return 1; }
  }
  const plugin = argv.find((arg, i) => !arg.startsWith("--") && !valued.has(argv[i - 1]));
  if (!plugin) {
    console.log("usage: node scripts/door-plugin.mjs <plugin> [--root <dir>] [--check | --write] [--into <plugin>]");
    return 1;
  }
  const root = path.resolve(flag("--root") ?? path.join(import.meta.dirname, ".."));
  // --check wins when both are given: nothing is written.
  const check = argv.includes("--check"), write = argv.includes("--write") && !check;
  let report;
  try { report = areaPlugin(root, plugin, { write, into: flag("--into") ?? AREA_PLUGIN }); }
  catch (e) { console.log(`door-plugin: ${e.message}`); return 1; }
  console.log(areaSummary(report, { write }));
  if (report.generated?.some((r) => r.state === "failed")) return 1;
  if (!write && report.changed.length) console.log(`a write would change ${count(report.changed.length, "file")}; run it with --write`);
  return check && report.changed.length ? 1 : 0;
}

// Real paths on both sides: run through a symlinked directory (macOS's /var
// is one), argv[1] and import.meta.filename spell the same file differently.
const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? ""); } catch { return ""; } })();
if (invoked === import.meta.filename) process.exitCode = main(process.argv.slice(2));
