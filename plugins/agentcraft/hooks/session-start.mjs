#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact) and SubagentStart: the
// critical lines, in one voice. The shared line once, then a block for each
// area with a line that applies here, then, in the main session of a repo
// nothing settles, the once-per-clone question. A subagent gets the lines
// marked for all agents; a denied agent type gets nothing.
//
// The session briefing is briefing.mjs, a SessionStart command of its own: a
// host shows the model only a preview of a hook's output past 10,000
// characters, and the two together could pass it. scripts/validate.mjs holds
// each under that.
//
// Fail open, always exit 0.
import { answer, criticalBlocks, questionFor, run } from "./critical-context.mjs";

await run((payload) => {
  const state = answer(payload);
  return [...criticalBlocks(state), questionFor(state)];
});
