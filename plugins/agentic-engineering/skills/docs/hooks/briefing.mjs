#!/usr/bin/env node
// This area's part of the session briefing: the plugin's briefing command
// (hooks/briefing.mjs at the plugin's root) loads it, runs `migrate` first and
// `briefing` after, in the main session only. The area's critical lines are
// data, critical.json beside this file, and the lines command prints them.
//
// Two notes, each only when there is something to fix:
//
// - The user docs, when their config cannot be read: the rule would still
//   arrive while the checker and the Stop check stood down in silence, so the
//   session is told the checks are off and why. A readable config costs nothing.
// - The system map, in a repo with a miro.config.mjs (at its root or in
//   diagrams/): one line when this machine lacks what the live check's browser
//   server needs (a new enough Node, npx, Google Chrome). It looks at paths and
//   versions and starts nothing; the map itself is not checked here, since that
//   would walk the tree on every start. map-stop-check.mjs checks it, once a
//   turn that changed something.
//
// A migration, once per repo: the writer contract lived at
// .agents/contracts/docs.md and now sits beside the config, at
// .agents/docs-contract.md, where the routes read it. The note that goes with
// the move names what a script cannot fix: the rule the root AGENTS.md may
// still carry in its own words, and the checker's old name inside the contract.
// Nothing the system map reads from a repo has had another path.
//
// Fail open: the briefing command never lets this cost a session.
import fs from "node:fs";
import path from "node:path";

const CONFIG = ".agents/docs-parity.json";
const CONTRACT = ".agents/docs-contract.md";
const OLD_CONTRACT = ".agents/contracts/docs.md";

function docsNote(state) {
  const file = state.root && path.join(state.root, CONFIG);
  if (!file || !fs.existsSync(file)) return "";
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (config && typeof config === "object" && !Array.isArray(config)) return "";
    return `${CONFIG} is not a JSON object, so the docs checker and the Stop check are off in this repo. Tell the person, and fix the file before relying on either.`;
  } catch (e) {
    return `${CONFIG} does not parse (${e.message}), so the docs checker and the Stop check are off in this repo. Tell the person, and fix the file before relying on either.`;
  }
}

async function mapNote(state) {
  // Loaded here, inside what the briefing command catches: a broken import costs the note alone.
  const { report } = await import("../routes/browser-setup/scripts/check-setup.mjs");
  const setup = report({ root: state.root });
  if (!setup.project || !setup.fixes.length) return "";
  // browser-setup is the person's to start, so the line says to ask them.
  return `system map: this repo draws Miro boards, and the live check cannot run on this machine yet (${setup.fixes.map((f) => f.split(":")[0]).join("; ")}). Ask the person whether to set it up before the live check is needed: on their yes that is /agentic-engineering:docs browser-setup. Building and linting work without it.`;
}

async function briefing(payload, state) {
  let map = "";
  try { map = await mapNote(state); } catch { /* the docs note still arrives */ }
  return [docsNote(state), map].filter(Boolean).join("\n");
}

/** The writer contract the init route wrote: its own title, in a repo that carries the config. */
function isWriterContract(root) {
  if (!fs.existsSync(path.join(root, CONFIG))) return false;
  try { return /^# Writing the user docs\s*$/m.test(fs.readFileSync(path.join(root, OLD_CONTRACT), "utf8")); } catch { return false; }
}

function migrate({ root, move }) {
  if (!isWriterContract(root)) return "";
  if (move(OLD_CONTRACT, CONTRACT) !== "moved") return "";
  return [
    `The writer contract is now ${CONTRACT}; where it names docs_check.py, the checker is docs-check.mjs, which /agentic-engineering:docs sync runs.`,
    "If the root AGENTS.md carries a \"User docs move with the code\" rule, it repeats what this hook now delivers and names the old paths: delete it, or, where people work without the plugin, keep it and correct the two names.",
    "A copy of docs_check.py that CI runs keeps working on the same config; if the person asks, /agentic-engineering:docs init replaces it with docs-check.mjs.",
  ].join(" ");
}

export { briefing, migrate };
