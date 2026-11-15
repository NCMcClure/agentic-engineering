#!/usr/bin/env node
// SessionStart: nothing to say.
//
// This hook used to tell a person with no writing profile to build one, once
// a day. As an area of a plugin every session loads, it would say that to
// people who never asked for a writing voice, so it says nothing now: the
// entry skill offers the calibration to a person who wants it. The gate below
// is the one the area's other hooks open with, kept here so the three read
// alike: without a profile this area does nothing at all.
//
// The profile itself is not printed here either. It lives in ~/.claude/rules/,
// which Claude Code loads into every session and reloads after a compaction,
// so a copy from this hook would only be the same lines twice.
//
// Fail open, always exit 0.
import fs from "node:fs";
import { profilePath } from "../scripts/wlm/paths.mjs";
import { readPayload } from "./payload.mjs";

function main() {
  if (!readPayload()) return;
  if (!fs.existsSync(profilePath())) return;
}

// process.exitCode, never an early exit: stdout is a hook's whole contract.
try { main(); } catch { /* fail open */ }
process.exitCode = 0;
