#!/usr/bin/env node
// SessionStart and SubagentStart: this plugin's critical lines, from
// critical.json, through the shared kernel. They print in a repo that has
// opted in and carries a Miro project or a system map, come back after a
// compaction or a /clear, and reach every subagent except the read-only
// agent types.
//
// A briefing, main session only, and only when there is something to fix: in
// a repo with a miro.config.mjs (at its root or in diagrams/), one line when
// this machine lacks what the live check's browser server needs (a new enough
// Node, npx, Google Chrome). It looks at paths and versions and starts
// nothing; the system map is not checked here, since that would walk the tree
// on every start.
//
// No migration: nothing this plugin reads from a repo has had another path.
//
// Fail open, always exit 0.
import { run } from "./critical-context.mjs";

async function briefing(payload, state) {
  // Loaded here, inside what the kernel catches: a broken import costs the note, never the lines.
  const { report } = await import("../skills/browser-setup/scripts/check-setup.mjs");
  const setup = report({ root: state.root });
  if (!setup.project || !setup.fixes.length) return "";
  // browser-setup is run by the person, so the line asks for that instead of naming a skill to load.
  return `marvelous-miro: this repo draws Miro boards, and the live check cannot run on this machine yet (${setup.fixes.map((f) => f.split(":")[0]).join("; ")}). Ask the person to run /marvelous-miro:browser-setup before the live check is needed; building and linting work without it.`;
}

await run(briefing);
