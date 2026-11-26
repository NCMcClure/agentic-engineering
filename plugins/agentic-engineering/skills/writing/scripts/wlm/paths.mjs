// Where writing keeps what it knows about the person. Nothing mutable
// lives in the plugin folder, which is replaced whole on every update:
//
//   ${CLAUDE_PLUGIN_DATA}/writing/   data home (override: WLM_HOME), survives updates
//     observations.jsonl       pending style feedback, one JSON object per line
//     changelog.md             dated log of profile edits
//     samples/                 writing samples gathered by calibrate
//     state/                   timestamps and session flags
//   ~/.claude/rules/write-like-me.md   the profile (override: WLM_PROFILE)
//
// Claude Code gives hook processes CLAUDE_PLUGIN_DATA; it outlives plugin
// updates and is deleted on uninstall unless the person keeps it. The plugin
// shares that directory among its areas, so this one keeps to a folder of its
// own in it (lib/data-home.mjs). What it kept as a plugin of its own, in the
// directory beside this plugin's, is copied in the first time it is needed:
// that directory goes when the old plugin is uninstalled.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { areaHome, inherit } from "../../../../lib/data-home.mjs";

const AREA = "writing";
const asked = new Set();

/** The data home. Throws when neither variable is set: a hook treats that as "stay silent". */
export function dataHome(env = process.env) {
  if (env.WLM_HOME) return path.resolve(env.WLM_HOME);
  if (!env.CLAUDE_PLUGIN_DATA) throw new Error("writing: neither WLM_HOME nor CLAUDE_PLUGIN_DATA is set");
  const dir = areaHome(AREA, env);
  // Once a process, and before anything here makes a folder: the copy runs only into an empty home.
  if (!asked.has(dir)) {
    asked.add(dir);
    try { inherit(AREA, env); } catch { /* what could not be copied stays where it was */ }
  }
  return dir;
}

export const profilePath = (env = process.env) =>
  env.WLM_PROFILE ? path.resolve(env.WLM_PROFILE) : path.join(os.homedir(), ".claude", "rules", "write-like-me.md");

export const observationsPath = (env) => path.join(dataHome(env), "observations.jsonl");
export const changelogPath = (env) => path.join(dataHome(env), "changelog.md");
export const samplesDir = (env) => path.join(dataHome(env), "samples");
export const stateDir = (env) => path.join(dataHome(env), "state");

export function ensureDirs(env) {
  for (const dir of [dataHome(env), samplesDir(env), stateDir(env)]) fs.mkdirSync(dir, { recursive: true });
}

/**
 * A stamp file's time in seconds since the epoch, or 0 when it is missing or
 * unreadable. Stamps are decimal seconds with a fraction ("1794466073.41969").
 */
export function readEpoch(file) {
  try {
    const seconds = Number(fs.readFileSync(file, "utf8").trim() || NaN);
    return Number.isFinite(seconds) ? seconds : 0;
  } catch { return 0; }
}

/** Now, as a stamp holds it: seconds since the epoch. */
export const nowSeconds = () => Date.now() / 1000;
