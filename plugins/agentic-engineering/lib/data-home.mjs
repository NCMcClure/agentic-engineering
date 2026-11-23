// Where an area keeps what has to outlive a plugin update.
//
// The host gives a plugin one data directory, CLAUDE_PLUGIN_DATA, which it
// names `<config>/plugins/data/<plugin>-<marketplace>` and deletes when the
// plugin is uninstalled. Every area of this plugin shares it, so each takes a
// folder of its own in it, named after the area:
//
//   ${CLAUDE_PLUGIN_DATA}/<area>/
//
// An area that was a plugin of its own once had a data directory of its own,
// beside this one: `<config>/plugins/data/<area>-<marketplace>`. That
// directory lasts only as long as the old plugin stays installed, so what it
// holds is copied across the first time the area finds its own folder empty.
// So is what the plugin kept before 2.0.0, when it was named agentcraft: its
// data directory, `<config>/plugins/data/agentcraft-<marketplace>`, holds the
// same `<area>/` folders.
//
// Import-safe: loading this module reads nothing.
import fs from "node:fs";
import path from "node:path";
import { PLUGIN } from "../hooks/critical-context.mjs";

/** What this plugin was called before 2.0.0, as the host spelled it in a data directory's name. */
const PREVIOUS_PLUGIN = "agentcraft";

/** The area's folder in the plugin's data directory. Throws when the host set no data directory. */
export function areaHome(area, env = process.env) {
  const data = env.CLAUDE_PLUGIN_DATA;
  if (!data || !String(data).trim()) throw new Error(`${area}: CLAUDE_PLUGIN_DATA is not set, so there is nowhere to keep its data`);
  return path.join(path.resolve(data), area);
}

/** The data directory the area had as a plugin of its own, or null where this plugin's own directory does not say which marketplace it is from. */
export function formerHome(area, env = process.env) {
  const data = env.CLAUDE_PLUGIN_DATA;
  if (!data || !String(data).trim()) return null;
  const dir = path.resolve(data);
  const name = path.basename(dir);
  if (!name.startsWith(`${PLUGIN}-`)) return null;
  return path.join(path.dirname(dir), `${area}-${name.slice(PLUGIN.length + 1)}`);
}

/** The data directory this plugin had under its previous name, which holds the area's folder, or null where the plugin's own directory does not say which marketplace it is from. */
export function previousHome(area, env = process.env) {
  const data = env.CLAUDE_PLUGIN_DATA;
  if (!data || !String(data).trim()) return null;
  const dir = path.resolve(data);
  const name = path.basename(dir);
  if (!name.startsWith(`${PLUGIN}-`)) return null;
  return path.join(path.dirname(dir), `${PREVIOUS_PLUGIN}-${name.slice(PLUGIN.length + 1)}`, area);
}

const entries = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };

/**
 * Bring across what the area kept before: under the plugin's previous name,
 * or as a plugin of its own (the first of the two that holds something). A
 * copy, made once. It runs only while the area's folder is empty or not there
 * and an old directory holds something. Nothing is moved and nothing is overwritten, so
 * the old directory is left as it was and a second run copies nothing. Gives
 * the names it copied, none when there was nothing to do.
 */
export function inherit(area, env = process.env) {
  const sources = [previousHome(area, env), formerHome(area, env)].filter(Boolean);
  if (!sources.length) return [];
  const home = areaHome(area, env);
  if (entries(home).length) return [];
  const from = sources.find((dir) => entries(dir).length);
  if (!from) return [];
  const names = entries(from).sort();
  fs.mkdirSync(home, { recursive: true });
  for (const name of names) fs.cpSync(path.join(from, name), path.join(home, name), { recursive: true, force: false, errorOnExist: true });
  return names;
}
