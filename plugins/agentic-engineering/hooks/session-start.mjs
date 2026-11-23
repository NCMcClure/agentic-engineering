#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact) and SubagentStart: the
// critical lines, in one voice. The shared line once, then a block for each
// area with a line that applies here, then, in the main session, each area's
// routes by name (at a 200k window the listing shows eleven names and no
// route), then, where nothing settles the repo, the once-per-clone question.
// A subagent gets the lines marked for all agents; a denied agent type gets
// nothing.
//
// The session briefing is briefing.mjs, a SessionStart command of its own: a
// host shows the model only a preview of a hook's output past 10,000
// characters, and the two together could pass it. scripts/validate.mjs holds
// each under that.
//
// Fail open, always exit 0.
import { answer, criticalBlocks, questionFor, routeIndex, run } from "./critical-context.mjs";

await run((payload) => {
  const state = answer(payload);
  return [...criticalBlocks(state), routeIndex(state), questionFor(state)];
});
