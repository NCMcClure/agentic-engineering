// Where write-like-me keeps what it knows about the person. Nothing mutable
// lives in the plugin folder, which is replaced whole on every update:
//
//   ${CLAUDE_PLUGIN_DATA}/     data home (override: WLM_HOME), survives updates
//     observations.jsonl       pending style feedback, one JSON object per line
//     changelog.md             dated log of profile edits
//     samples/                 writing samples gathered by calibrate
//     state/                   timestamps and session flags
//   ~/.claude/rules/write-like-me.md   the profile (override: WLM_PROFILE)
//
// Claude Code gives hook processes CLAUDE_PLUGIN_DATA; it outlives plugin
// updates and is deleted on uninstall unless the person keeps it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The data home. Throws when neither variable is set: a hook treats that as "stay silent". */
export function dataHome(env = process.env) {
  const dir = env.WLM_HOME || env.CLAUDE_PLUGIN_DATA;
  if (!dir) throw new Error("write-like-me: neither WLM_HOME nor CLAUDE_PLUGIN_DATA is set");
  return path.resolve(dir);
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
