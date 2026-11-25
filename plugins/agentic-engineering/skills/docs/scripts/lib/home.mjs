// Where things live: the plugin (read-only, replaced on update), its data
// folder (the studio's install home), and the repo a figure is for.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { areaHome, inherit } from "../../../../lib/data-home.mjs";
import { PtError } from "./args.mjs";

// The area this studio is part of, whose folder in the plugin's data directory it keeps to.
const AREA = "docs";
const asked = new Set();

/** The plugin's own folder: the one that holds scripts/, kit/ and app/. */
export const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The persistent folder the studio is installed into. An empty value is
 * refused: resolved as a path it would be the current folder, and the studio
 * would install itself into whatever project the command ran in. What the
 * studio kept under the area's former name, picture-this, is copied across
 * the first time the folder is asked for.
 */
export function dataHome(env = process.env) {
  if (env.PT_HOME && env.PT_HOME.trim()) return path.resolve(env.PT_HOME);
  if (!env.CLAUDE_PLUGIN_DATA || !env.CLAUDE_PLUGIN_DATA.trim()) {
    throw new PtError("pt has no data folder: CLAUDE_PLUGIN_DATA is not set. Run this from a Claude Code session with the plugin installed, or set PT_HOME to a folder to install the studio into.");
  }
  // The plugin's data directory is shared by its areas: this one keeps to its own folder in it.
  const dir = areaHome(AREA, env);
  // Once a process, and before anything here makes a folder: the copy runs only into an empty home.
  if (!asked.has(dir)) {
    asked.add(dir);
    try { inherit(AREA, env); } catch { /* what could not be copied is installed afresh */ }
  }
  return dir;
}

/** The repo a command works on: --repo, else the git checkout around the current folder, else the folder itself. */
export function repoRoot(explicit, { cwd = process.cwd() } = {}) {
  if (explicit) {
    const dir = path.resolve(cwd, explicit);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new PtError(`--repo ${explicit}: no such folder`);
    return dir;
  }
  try {
    return path.resolve(execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch { return path.resolve(cwd); }
}
