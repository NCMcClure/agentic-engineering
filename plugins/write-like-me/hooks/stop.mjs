#!/usr/bin/env node
// Stop: when style feedback is pending, have the model fork a subagent that
// folds it into the writing profile.
//
//   exit 0, no stdout                        the turn ends
//   exit 0, {"decision":"block","reason"}    the turn goes on; `reason` is what
//                                            the model reads next
//
// Guards, in order: the loop guard (`stop_hook_active`: this Stop follows the
// refinement turn this hook asked for), learning paused (state/refine-disabled),
// nothing pending, once per session, a one-hour cooldown across sessions.
//
// Fail open, always exit 0.
import fs from "node:fs";
import path from "node:path";
import { pending } from "../scripts/wlm/observations.mjs";
import { dataHome, ensureDirs, nowSeconds, profilePath, readEpoch, stateDir } from "../scripts/wlm/paths.mjs";
import { readPayload } from "./payload.mjs";

const COOLDOWN_SECONDS = 3600;
const SESSION_FLAG_STALE_SECONDS = 86400;
const FLAG = "refine-fired-";

/** A session id as a file name: anything that could leave the state folder becomes `_`. */
const flagName = (sessionId) => FLAG + (typeof sessionId === "string" && sessionId ? sessionId.replace(/[^A-Za-z0-9._-]/g, "_") : "unknown");

function main() {
  const payload = readPayload();
  if (!payload || payload.stop_hook_active) return;

  ensureDirs();
  const state = stateDir();
  if (fs.existsSync(path.join(state, "refine-disabled"))) return;
  if (!pending().length) return;

  const sessionFlag = path.join(state, flagName(payload.session_id));
  if (fs.existsSync(sessionFlag)) return;

  const now = nowSeconds();
  const lastRefined = path.join(state, "last-refined");
  if (now - readEpoch(lastRefined) < COOLDOWN_SECONDS) return;

  // Sweep flags of sessions long over, so state/ does not grow forever.
  for (const name of fs.readdirSync(state)) {
    if (!name.startsWith(FLAG)) continue;
    const flag = path.join(state, name);
    try { if (now - fs.statSync(flag).mtimeMs / 1000 > SESSION_FLAG_STALE_SECONDS) fs.rmSync(flag); } catch { /* another session's sweep got there first */ }
  }

  // Stamp before speaking, so a fork that crashes cannot fire again in a loop.
  fs.writeFileSync(sessionFlag, String(now));
  fs.writeFileSync(lastRefined, String(now));

  // The subagent reads refine-profile.md as a plain file, where plugin
  // variables are never filled in, so the paths are resolved here.
  const rules = path.join(import.meta.dirname, "refine-profile.md");
  console.log(JSON.stringify({
    decision: "block",
    reason:
      "Create a forked subagent with 'sonnet' model. Subagent initial message is: " +
      `'Read & execute writing-profile refinement rules: ${rules}. Profile: ${profilePath()}. Data dir: ${dataHome()}.'`,
  }));
}

try { main(); } catch { /* fail open */ }
process.exitCode = 0;
