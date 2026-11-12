#!/usr/bin/env node
// SessionStart and SubagentStart: the ladder, from critical.json, through the
// shared kernel. It prints where the repo has opted in (a committed marker, or
// the person's answer to the one-time question), comes back after a compaction
// or a /clear, and reaches every subagent except the read-only agent types.
//
// No briefing: the one thing worth saying every session is the ladder itself,
// and counting debt markers here would walk the tree on every start. No
// migration either: nothing this plugin reads from a repo has had another path.
//
// Fail open, always exit 0.
import { run } from "./critical-context.mjs";

await run();
