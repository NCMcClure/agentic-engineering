#!/usr/bin/env node
// This area's part of the session briefing: the plugin's briefing command
// (hooks/briefing.mjs at the plugin's root) loads it, runs `migrate` first and
// `briefing` after, in the main session only. The area's critical lines are
// data, critical.json beside this file, and the lines command prints them.
//
// A briefing, only when the config cannot be read: the rule would still
// arrive while the checker and the Stop hook stood down in silence, so the
// session is told the checks are off and why. A readable config costs nothing.
//
// A migration, once per repo: the writer contract lived at
// .agents/contracts/docs.md and now sits beside the config, at
// .agents/docs-contract.md, where the skills read it. The note that goes with
// the move names what a script cannot fix: the rule the root AGENTS.md may
// still carry in its own words, and the checker's old name inside the contract.
//
// Fail open: the briefing command never lets this cost a session.
import fs from "node:fs";
import path from "node:path";

const CONFIG = ".agents/docs-parity.json";
const CONTRACT = ".agents/docs-contract.md";
const OLD_CONTRACT = ".agents/contracts/docs.md";

function briefing(payload, state) {
  const file = state.root && path.join(state.root, CONFIG);
  if (!file || !fs.existsSync(file)) return "";
  try {
    const config = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (config && typeof config === "object" && !Array.isArray(config)) return "";
    return `${CONFIG} is not a JSON object, so the docs checker and the Stop check are off in this repo. Tell the person, and fix the file before relying on either.`;
  } catch (e) {
    return `${CONFIG} does not parse (${e.message}), so the docs checker and the Stop check are off in this repo. Tell the person, and fix the file before relying on either.`;
  }
}

/** The writer contract docs-init wrote: its own title, in a repo that carries the config. */
function isWriterContract(root) {
  if (!fs.existsSync(path.join(root, CONFIG))) return false;
  try { return /^# Writing the user docs\s*$/m.test(fs.readFileSync(path.join(root, OLD_CONTRACT), "utf8")); } catch { return false; }
}

function migrate({ root, move }) {
  if (!isWriterContract(root)) return "";
  if (move(OLD_CONTRACT, CONTRACT) !== "moved") return "";
  return [
    `The writer contract is now ${CONTRACT}; where it names docs_check.py, the checker is docs-check.mjs, which /agentcraft:docs-parity docs-sync runs.`,
    "If the root AGENTS.md carries a \"User docs move with the code\" rule, it repeats what this hook now delivers and names the old paths: delete it, or, where people work without the plugin, keep it and correct the two names.",
    "A copy of docs_check.py that CI runs keeps working on the same config; if the person asks, /agentcraft:docs-parity docs-init replaces it with docs-check.mjs.",
  ].join(" ");
}

export { briefing, migrate };
