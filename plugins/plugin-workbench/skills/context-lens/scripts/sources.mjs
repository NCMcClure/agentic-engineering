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
// Import-safe: loading this module reads nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const defaultClaudeDir = (env = process.env) => env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const dirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

/** An empty index: everything reads as unattributed. */
export const emptySources = () => ({ hookIndex: new Map(), hooks: [], plugins: new Map(), focusNames: new Set(), focus: null });

export function loadSources({ claudeDir = defaultClaudeDir(), focus = "agentic-engineering" } = {}) {
  const sources = { ...emptySources(), focus };
  const index = (name, marketplace, version, hooksFile) => {
    const plugin = sources.plugins.get(name) ?? { name, marketplaces: new Set(), versions: new Set() };
    plugin.marketplaces.add(marketplace);
    plugin.versions.add(version);
    sources.plugins.set(name, plugin);
    const map = readJson(hooksFile)?.hooks ?? {};
    for (const [event, groups] of Object.entries(map)) {
      for (const group of Array.isArray(groups) ? groups : []) {
        for (const hook of group?.hooks ?? []) {
          // The transcript names a hook by its status message when it has one.
          for (const key of [hook.command, hook.statusMessage].filter(Boolean)) {
            const id = `${event}\0${key}`;
            if (!sources.hookIndex.has(id)) sources.hookIndex.set(id, new Set());
            sources.hookIndex.get(id).add(name);
          }
          sources.hooks.push({ event, matcher: group.matcher ?? "", plugin: name });
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

const CACHE_PATH = /plugins\/cache\/([^/\s'"]+)\/([^/\s'"]+)\/([^/\s'"]+)\//;

/**
 * The plugin behind one hook run. `command` is what the transcript recorded
 * (a status message or a command string); `text` is anything else it said,
 * such as the stderr of a failure, which often carries the plugin's cache
 * path. A command two plugins share comes back as both, never a guess.
 */
export function attributeHook(sources, { event, command = "", text = "" }) {
  if (command === "callback") return { plugin: "Claude Code", candidates: [] };
  const hit = sources.hookIndex.get(`${event}\0${command}`);
  if (hit?.size) {
    const candidates = [...hit].sort();
    return { plugin: candidates.join(" or "), candidates };
  }
  const m = CACHE_PATH.exec(`${command}\n${text}`);
  if (m) return { plugin: m[2], marketplace: m[1], version: m[3], candidates: [m[2]] };
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
 */
export function splitListing(text = "") {
  const groups = new Map();
  let current = null;
  for (const line of String(text).split("\n")) {
    const m = /^- ([^\s:]+(?::[^\s:]+)?)(?::\s?(.*))?$/.exec(line);
    if (m) {
      const name = m[1];
      const plugin = name.includes(":") ? name.split(":")[0] : null;
      if (!groups.has(plugin)) groups.set(plugin, { plugin, count: 0, bare: 0, names: [], lines: [] });
      current = groups.get(plugin);
      current.count += 1;
      if (!m[2]?.trim()) current.bare += 1;
      current.names.push(name);
      current.lines.push(line);
    } else if (current && line.trim()) {
      current.lines.push(line);
    }
  }
  return [...groups.values()].map(({ lines, ...g }) => ({ ...g, text: lines.join("\n") }));
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
