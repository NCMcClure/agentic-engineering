#!/usr/bin/env node
// This area's part of the session briefing: the plugin's briefing command
// (hooks/briefing.mjs at the plugin's root) loads it, runs `migrate` first and
// `briefing` after, in the main session only. The area's critical lines are
// data, critical.json beside this file, and the lines command prints them.
//
// A briefing, main session only, and only when there is something to fix: in
// a repo with a miro.config.mjs (at its root or in diagrams/), one line when
// this machine lacks what the live check's browser server needs (a new enough
// Node, npx, Google Chrome). It looks at paths and versions and starts
// nothing; the system map is not checked here, since that would walk the tree
// on every start. stop-check.mjs checks it, once a turn that changed something.
//
// No migration: nothing this plugin reads from a repo has had another path.
//
// Fail open, always exit 0.

async function briefing(payload, state) {
  // Loaded here, inside what the briefing command catches: a broken import costs the note alone.
  const { report } = await import("../routes/browser-setup/scripts/check-setup.mjs");
  const setup = report({ root: state.root });
  if (!setup.project || !setup.fixes.length) return "";
  // browser-setup is the person's to start, so the line says to ask them.
  return `system-map: this repo draws Miro boards, and the live check cannot run on this machine yet (${setup.fixes.map((f) => f.split(":")[0]).join("; ")}). Ask the person whether to set it up before the live check is needed: on their yes that is /agentic-engineering:system-map browser-setup. Building and linting work without it.`;
}

export { briefing };
