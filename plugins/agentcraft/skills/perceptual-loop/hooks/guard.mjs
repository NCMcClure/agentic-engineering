#!/usr/bin/env node
// PreToolUse on Bash and PowerShell: the render budget and the baseline's
// safety (scripts/lib/guard-rules.mjs has the rules).
//
// Inert in a project without a perceptual config: the config is looked for
// with existsSync alone, walking up from the payload's cwd, before anything of
// the plugin's engine is imported, so every shell command of every other
// project costs one small process and no git call. With a config, the repo's
// mode is read: where the person turned the plugins off and no marker is
// committed, the guard says nothing.
//
// Fail open: the exit code is always 0, nothing goes to stderr, and the only
// output is a deny with its reason, which is what the model reads.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { modeOf, readPayload } from "./critical-context.mjs";

// The state folder, and the folder the first layout kept it in: a repo not moved yet is still guarded.
const CONFIGS = [path.join(".agents", "perceptual", "config.json"), path.join(".perceptual-loop", "config.json")];

/** The folder whose state the command is judged against, or null when there is none. */
function configRoot(start, env) {
  const named = env.PL_DIR || env.PERCEPTUAL_LOOP_DIR;
  if (named) return fs.existsSync(path.join(named, "config.json")) ? start : null;
  let here = path.resolve(start);
  for (;;) {
    if (CONFIGS.some((rel) => fs.existsSync(path.join(here, rel)))) return here;
    const up = path.dirname(here);
    if (up === here) return null;
    here = up;
  }
}

async function main() {
  const payload = readPayload();
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !command) return;
  // the work tree the command runs in: a worktree session's project dir is the main checkout
  const start = [payload.cwd, process.env.CLAUDE_PROJECT_DIR].find((d) => typeof d === "string" && d) ?? process.cwd();
  const root = configRoot(start, process.env);
  if (!root || modeOf(root) === "none") return;
  const { decide } = await import(pathToFileURL(path.join(import.meta.dirname, "..", "scripts", "lib", "guard-rules.mjs")).href);
  const reason = decide(command, root);
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  }
}

process.exitCode = 0;
try { await main(); } catch { /* fail open: a broken guard never stops work */ }
