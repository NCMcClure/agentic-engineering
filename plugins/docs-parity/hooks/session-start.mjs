#!/usr/bin/env node
// SessionStart and SubagentStart: the docs rule, as the critical line in
// critical.json, in a repo that carries .agents/docs-parity.json. The kernel
// decides who hears it; this file adds two things for the main session.
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
// Fail open, always exit 0: the kernel never lets this cost a session.
import fs from "node:fs";
import path from "node:path";
import { run } from "./critical-context.mjs";

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
    `The writer contract is now ${CONTRACT}; where it names docs_check.py, the checker is docs-check.mjs, which /docs-parity:docs-sync runs.`,
    "If the root AGENTS.md carries a \"User docs move with the code\" rule, it repeats what this hook now delivers and names the old paths: delete it, or, where people work without the plugin, keep it and correct the two names.",
    "A copy of docs_check.py that CI runs keeps working on the same config; /docs-parity:docs-init can replace it with docs-check.mjs.",
  ].join(" ");
}

await run(briefing, { migrate });
