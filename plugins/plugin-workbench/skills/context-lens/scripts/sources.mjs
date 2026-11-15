// Which plugin a piece of context came from.
//
// A transcript records a hook run by its status message when the hook has
// one, and by its unexpanded command string otherwise, never by plugin. So the
// index is built from every hooks.json on this machine: each cached version
// under ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/, plus each
// known marketplace's own listing (a local checkout loads in place and has no
// cache copy). Old versions stay indexed, so an old transcript still resolves.
//
// Focus is the plugins the focus marketplace's catalog lists
// (agentic-engineering by default), which is how a plugin released from its
// own repo still counts as one of ours.
//
// A plugin may hold areas: skills with a `routes/` directory, each standing
// for a body of work. Then the plugin's name says little about where context
// came from, so the index also records the area: for a hook, the
// `skills/<area>/` its command runs from; for a listing entry, the area it
// names. An `area` is set only when it is known, and a reader keys on the
// area where there is one and the plugin where there is not.
//
// Import-safe: loading this module reads nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const defaultClaudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

/** An empty index: everything reads as unattributed. */
export const emptySources = () => ({ hookIndex: new Map(), hookAreas: new Map(), hooks: [], plugins: new Map(), areas: new Map(), focusNames: new Set(), focus: null });

/** The area a hook command runs from: the `skills/<area>/` under the plugin root, or null for a hook of the plugin's own. */
export const areaOfCommand = (command = "") => /\$\{CLAUDE_PLUGIN_ROOT\}["']?\/skills\/([^/\s"']+)\//.exec(String(command))?.[1] ?? null;

/** The key a reader groups context by: the area where one is known, else the plugin. */
export const ownerOf = (source) => source?.area ?? source?.plugin ?? null;

export function loadSources({ claudeDir = defaultClaudeDir(), focus = "agentic-engineering" } = {}) {
  const sources = { ...emptySources(), focus };
  const index = (name, marketplace, version, hooksFile) => {
    const plugin = sources.plugins.get(name) ?? { name, marketplaces: new Set(), versions: new Set() };
    plugin.marketplaces.add(marketplace);
    plugin.versions.add(version);
    sources.plugins.set(name, plugin);
    // An area is a skill directory that holds routes/.
    const skillsDir = path.join(path.dirname(path.dirname(hooksFile)), "skills");
    for (const skill of dirs(skillsDir)) {
      if (!dirs(path.join(skillsDir, skill)).includes("routes")) continue;
      if (!sources.areas.has(name)) sources.areas.set(name, new Set());
      sources.areas.get(name).add(skill);
    }
    const map = readJson(hooksFile)?.hooks ?? {};
    for (const [event, groups] of Object.entries(map)) {
      for (const group of Array.isArray(groups) ? groups : []) {
        for (const hook of group?.hooks ?? []) {
          // A hook that runs from a skill that is not an area belongs to the plugin.
          const from = areaOfCommand(hook.command);
          const area = from && sources.areas.get(name)?.has(from) ? from : null;
          // The transcript names a hook by its status message when it has one.
          for (const key of [hook.command, hook.statusMessage].filter(Boolean)) {
            const id = `${event}\0${key}`;
            if (!sources.hookIndex.has(id)) sources.hookIndex.set(id, new Set());
            sources.hookIndex.get(id).add(name);
            // One key, one plugin, two areas: the area is not known, and is left out.
            if (!sources.hookAreas.has(id)) sources.hookAreas.set(id, new Map());
            const seen = sources.hookAreas.get(id);
            seen.set(name, seen.has(name) && seen.get(name) !== area ? null : area);
          }
          sources.hooks.push({ event, matcher: group.matcher ?? "", plugin: name, ...(area ? { area } : {}) });
        }
      }
    }
  };

  const cache = path.join(claudeDir, "plugins", "cache");
  for (const marketplace of dirs(cache)) {
    for (const name of dirs(path.join(cache, marketplace))) {
      for (const version of dirs(path.join(cache, marketplace, name))) {
        index(name, marketplace, version, path.join(cache, marketplace, name, version, "hooks", "hooks.json"));
      }
    }
  }

  const known = readJson(path.join(claudeDir, "plugins", "known_marketplaces.json")) ?? {};
  for (const [marketplace, entry] of Object.entries(known)) {
    const location = entry?.installLocation;
    if (!location) continue;
    for (const listed of readJson(path.join(location, ".claude-plugin", "marketplace.json"))?.plugins ?? []) {
      if (!listed?.name) continue;
      if (marketplace === focus) sources.focusNames.add(listed.name);
      if (typeof listed.source === "string") index(listed.name, marketplace, "checkout", path.join(location, listed.source, "hooks", "hooks.json"));
    }
  }
  for (const [name, plugin] of sources.plugins) if (plugin.marketplaces.has(focus)) sources.focusNames.add(name);
  return sources;
}

const CACHE_PATH = /plugins\/cache\/([^/\s'"]+)\/([^/\s'"]+)\/([^/\s'"]+)\/(?:skills\/([^/\s'"]+)\/)?/;

/**
 * The plugin behind one hook run, and its area where the hook runs from one.
 * `command` is what the transcript recorded (a status message or a command
 * string); `text` is anything else it said, such as the stderr of a failure,
 * which often carries the plugin's cache path. A command two plugins share
 * comes back as both, never a guess.
 */
export function attributeHook(sources, { event, command = "", text = "" }) {
  if (command === "callback") return { plugin: "Claude Code", candidates: [] };
  const id = `${event}\0${command}`;
  const hit = sources.hookIndex.get(id);
  if (hit?.size) {
    const candidates = [...hit].sort();
    const area = candidates.length === 1 ? sources.hookAreas?.get(id)?.get(candidates[0]) : null;
    return { plugin: candidates.join(" or "), candidates, ...(area ? { area } : {}) };
  }
  const m = CACHE_PATH.exec(`${command}\n${text}`);
  if (m) return { plugin: m[2], marketplace: m[1], version: m[3], candidates: [m[2]], ...(m[4] && sources.areas?.get(m[2])?.has(m[4]) ? { area: m[4] } : {}) };
  return { plugin: null, candidates: [] };
}

/** The plugins with a hook on this event whose matcher accepts this tool, for context no hook run claimed. */
export function hookCandidates(sources, event, tool = "") {
  const out = new Set();
  for (const hook of sources.hooks) {
    if (hook.event !== event) continue;
    let matches = !hook.matcher || hook.matcher === "*";
    if (!matches) { try { matches = new RegExp(`^(?:${hook.matcher})$`).test(tool); } catch { matches = hook.matcher === tool; } }
    if (matches) out.add(hook.plugin);
  }
  return [...out].sort();
}

/** True when any of the plugins named is in focus. */
export const inFocus = (sources, ...names) => names.flat().some((n) => n && sources.focusNames.has(n));

/**
 * A skill or agent listing ("- name: description", continuation lines
 * indented) grouped by the plugin prefix of each name, in order of first
 * appearance. `bare` counts names listed with no description, which is what
 * Claude Code does to the least-used skills when the listing is over budget.
 *
 * Given the sources, an entry that names one of its plugin's areas is a group
 * of its own, under that area. `entries` is each entry as listed: its name,
 * what it cost in characters, and whether it kept a description.
 */
export function splitListing(text = "", sources = null) {
  const groups = new Map();
  let current = null;
  let entry = null;
  for (const line of String(text).split("\n")) {
    const m = /^- ([^\s:]+(?::[^\s:]+)?)(?::\s?(.*))?$/.exec(line);
    if (m) {
      const name = m[1];
      const [plugin, skill] = name.includes(":") ? name.split(":") : [null, name];
      const area = plugin && sources?.areas?.get(plugin)?.has(skill) ? skill : null;
      const key = `${plugin ?? ""}\0${area ?? ""}`;
      if (!groups.has(key)) groups.set(key, { plugin, area, count: 0, bare: 0, names: [], entries: [], lines: [] });
      current = groups.get(key);
      current.count += 1;
      const bare = !m[2]?.trim();
      if (bare) current.bare += 1;
      current.names.push(name);
      entry = { name, chars: line.length, bare };
      current.entries.push(entry);
      current.lines.push(line);
    } else if (current && line.trim()) {
      current.lines.push(line);
      entry.chars += line.length + 1;
    }
  }
  return [...groups.values()].map(({ lines, area, ...g }) => ({ ...g, ...(area ? { area } : {}), text: lines.join("\n") }));
}

/** The plugin that registered a tool: mcp__plugin_<plugin>_<server>__x, or mcp__<plugin>__x for a plugin's own server. */
export function toolPlugin(sources, name = "") {
  const bundled = /^mcp__plugin_([^_]+)_/.exec(name);
  if (bundled) return bundled[1];
  const own = /^mcp__([^_]+)__/.exec(name);
  return own && sources.plugins.has(own[1]) ? own[1] : null;
}

/** The plugin behind an MCP server's instructions block, named "plugin:<plugin>:<server>" or after the plugin itself. */
export function serverPlugin(sources, server = "") {
  if (server.startsWith("plugin:")) return server.split(":")[1] || null;
  return sources.plugins.has(server) ? server : null;
}
