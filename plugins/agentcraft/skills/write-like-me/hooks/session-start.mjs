#!/usr/bin/env node
// SessionStart: one line to the person when no writing profile exists yet, at
// most once a day.
//
// The profile itself is not printed here. It lives in ~/.claude/rules/, which
// Claude Code loads into every session and reloads after a compaction, so a
// copy from this hook would only be the same lines twice.
//
// Fail open, always exit 0.
import fs from "node:fs";
import path from "node:path";
import { ensureDirs, nowSeconds, profilePath, readEpoch, stateDir } from "../scripts/wlm/paths.mjs";
import { readPayload } from "./payload.mjs";

const NUDGE_INTERVAL_SECONDS = 86400;

function main() {
  if (!readPayload()) return;
  if (fs.existsSync(profilePath())) return;

  ensureDirs();
  const stamp = path.join(stateDir(), "last-nudge");
  const now = nowSeconds();
  if (now - readEpoch(stamp) < NUDGE_INTERVAL_SECONDS) return;

  fs.writeFileSync(stamp, String(now));
  console.log(JSON.stringify({
    systemMessage: "write-like-me: no writing profile found. Run /write-like-me:calibrate once to teach Claude your voice.",
  }));
}

// process.exitCode, never process.exit: stdout is this hook's whole contract,
// and an exit while it drains can cut the JSON short.
try { main(); } catch { /* fail open */ }
process.exitCode = 0;
