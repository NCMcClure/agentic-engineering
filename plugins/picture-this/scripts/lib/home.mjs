// Where things live: the plugin (read-only, replaced on update), its data
// folder (the studio's install home), and the repo a figure is for.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PtError } from "./args.mjs";

/** The plugin's own folder: the one that holds scripts/, kit/ and app/. */
export const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The persistent folder the studio is installed into. An empty value is
 * refused: resolved as a path it would be the current folder, and the studio
 * would install itself into whatever project the command ran in.
 */
export function dataHome(env = process.env) {
  const home = env.PT_HOME || env.CLAUDE_PLUGIN_DATA;
  if (!home || !home.trim()) {
    throw new PtError("picture-this has no data folder: CLAUDE_PLUGIN_DATA is not set. Run this from a Claude Code session with the plugin installed, or set PT_HOME to a folder to install the studio into.");
  }
  return path.resolve(home);
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
