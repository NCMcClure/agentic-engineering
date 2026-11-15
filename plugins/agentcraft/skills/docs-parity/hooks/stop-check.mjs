#!/usr/bin/env node
// Stop: when this turn's changes left the user docs behind, tell the agent
// while the change is still in hand. A warning, never a refusal.
//
// It runs in any repo that carries .agents/docs-parity.json, whatever else is
// installed, and judges the work tree the session is in. Two checks:
//   parity   docs-check on everything changed since HEAD (committed work is
//            CI's to check): a surface whose code moved while its pages and
//            shots did not, plus the tree findings on files this turn changed
//   README   readme-check on a README this turn changed, only in a repo whose
//            config carries a `readme` block
//
// What it finds is written to the agent, so it goes where the model reads it:
// the Stop event's `additionalContext`, which continues the turn once. The
// person gets one short line as `systemMessage`. The same findings are sent
// to the agent once per session: a turn that ends with them again shows the
// person the line and leaves the agent alone, since it already chose.
//
// Never re-enters on the continuation it caused (`stop_hook_active`), and
// acts only on a payload it can read, since that flag is the loop guard.
// Fail open, always exit 0: a warning is never worth a failed turn.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG, changedFiles, run } from "../scripts/docs-check.mjs";
import { checkRepo, optedIn } from "../scripts/readme-check.mjs";
import { repoRoot } from "./critical-context.mjs";

const SHOWN = 4;
const SCRIPTS = path.join(import.meta.dirname, "..", "scripts");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function readPayload() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch { return null; }
}

/** Up to SHOWN of each list as bullets, then one line for the rest. */
function bullets(lists, command) {
  const shown = lists.flatMap((list) => list.slice(0, SHOWN));
  const hidden = lists.reduce((n, list) => n + list.length, 0) - shown.length;
  return [...shown.map((line) => `- ${line}`), ...(hidden > 0 ? [`- and ${hidden} more: ${command} lists them.`] : [])];
}

/** The parity paragraph and its count for the person, or null when the docs kept up. */
function docsBehind(root, changed) {
  const live = run(root, { changed: "HEAD" }).findings.filter((f) => f.severity !== "info");
  const parity = live.filter((f) => f.code === "PARITY_MISSING").map((f) => `${f.message}.`);
  const tree = live.filter((f) => f.code !== "PARITY_MISSING" && changed.has(f.path))
    .map((f) => `${f.code} ${f.path}${f.line ? `:${f.line}` : ""}: ${f.message}.`);
  if (!parity.length && !tree.length) return null;
  return {
    text: [
      "Docs parity, before you finish:",
      ...bullets([parity, tree], `node "${path.join(SCRIPTS, "docs-check.mjs")}" --changed HEAD`),
      "Update the pages and retake the shots in this change (/docs-parity:docs-sync), or write `Docs: none, <why>` in the commit message.",
    ].join("\n"),
    summary: [parity.length ? `${plural(parity.length, "surface")} changed without ${parity.length === 1 ? "its" : "their"} docs` : "", tree.length ? `${plural(tree.length, "finding")} on changed pages` : ""].filter(Boolean).join(", "),
  };
}

/** The README paragraph and its count, or null: only for a README this turn changed. */
function readmeBehind(root, changed) {
  if (!optedIn(root)) return null;
  const report = checkRepo(root);
  const findings = report.findings.filter((f) => changed.has(f.path)).map((f) => `${f.finding}: ${f.detail}.`);
  const warnings = report.warnings.filter((w) => changed.has(w.path)).map((w) => `${w.finding} (a warning, yours to judge): ${w.detail}.`);
  if (!findings.length && !warnings.length) return null;
  return {
    text: [
      findings.length ? "A README this turn changed does not pass readme-check:" : "A README this turn changed passes readme-check, with warnings:",
      ...bullets([findings, warnings], `node "${path.join(SCRIPTS, "readme-check.mjs")}"`),
      findings.length ? "Rewrite it to the skeleton with /docs-parity:readme, which also says where the moved content goes."
        : "Read each one: a long text block or a line addressed to an agent usually belongs in AGENTS.md or a skill (/docs-parity:readme).",
    ].join("\n"),
    summary: [findings.length ? plural(findings.length, "README finding") : "", warnings.length ? plural(warnings.length, "README warning") : ""].filter(Boolean).join(", "),
  };
}

/** True the first time this session is given this text; the record lives in the temp folder. */
function firstTelling(root, sessionId, text) {
  if (typeof sessionId !== "string" || !sessionId) return true;
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const file = path.join(os.tmpdir(), `docs-parity-stop-${hash(`${root}\0${sessionId}`).slice(0, 24)}.json`);
  const print = hash(text);
  try { if (JSON.parse(fs.readFileSync(file, "utf8")).told === print) return false; } catch { /* nothing told yet */ }
  try { fs.writeFileSync(file, JSON.stringify({ told: print })); } catch { /* it is told again next time */ }
  return true;
}

function main() {
  const payload = readPayload();
  if (!payload || payload.stop_hook_active === true) return;
  const root = repoRoot(payload);
  if (!root || !fs.existsSync(path.join(root, CONFIG))) return;
  const changed = new Set(changedFiles(root, "HEAD")[0]);
  if (!changed.size) return;

  const parts = [];
  for (const check of [docsBehind, readmeBehind]) {
    try { const part = check(root, changed); if (part) parts.push(part); } catch { /* one check failing does not silence the other */ }
  }
  if (!parts.length) return;
  const context = parts.map((p) => p.text).join("\n\n");
  const summary = parts.map((p) => p.summary).join(", ");
  if (firstTelling(root, payload.session_id, context)) {
    console.log(JSON.stringify({
      systemMessage: `docs-parity told the agent the docs fell behind this turn: ${summary}.`,
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: context },
    }));
  } else {
    console.log(JSON.stringify({ systemMessage: `docs-parity: the docs are still behind this session's changes (${summary}); the agent was told once.` }));
  }
}

// process.exitCode, never process.exit: stdout is this hook's whole contract,
// and an exit while it drains can cut the JSON short.
try { main(); } catch { /* fail open */ }
process.exitCode = 0;
