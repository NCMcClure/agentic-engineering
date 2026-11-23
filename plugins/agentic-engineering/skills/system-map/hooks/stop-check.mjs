#!/usr/bin/env node
// Stop: when this turn's changes left the system map behind the code, tell
// the agent while the change is still in hand. A warning, never a refusal.
//
// It runs in any repo that carries .agents/system-map.json, whatever else is
// installed, and judges the work tree the session is in. One check: the
// plugin's own system-map.mjs on everything changed since HEAD (committed
// work is CI's to check). What it tells: a finding on a file this turn
// changed (an import, a run or a network call nobody declared, a module with
// no node, an export nobody classified), and a map the annotations have
// moved past. A board that is behind the map is the person's to publish and
// is never told here.
//
// What it finds is written to the agent, so it goes where the model reads it:
// the Stop event's `additionalContext`, which continues the turn once. The
// person gets one short line as `systemMessage`. The same findings are sent
// to the agent once per session: a turn that ends with them again shows the
// person the line and leaves the agent alone, since it already chose.
//
// The session hook does not check the map, since that would walk the tree on
// every start. Here the walk is paid once a turn, and only by a repo that
// has a map and a turn that changed something.
//
// Never re-enters on the continuation it caused (`stop_hook_active`), and
// acts only on a payload it can read, since that flag is the loop guard.
// Fail open, always exit 0: a warning is never worth a failed turn.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG, changedFiles, run } from "../scripts/system-map.mjs";
import { repoRoot } from "../../../hooks/critical-context.mjs";

const SHOWN = 4;
const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "system-map.mjs");
// The map file's own findings are about the whole tree, so they are told whichever files the turn changed.
const WHOLE_TREE = new Set(["MAP_STALE", "MAP_MISSING"]);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function readPayload() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8").replace(/^﻿/, ""));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  } catch { return null; }
}

/** The note for the agent and the count for the person, or null when the map kept up. */
function mapBehind(root, changed) {
  const findings = run(root, { changed: "HEAD" }).findings
    .filter((f) => f.severity !== "info" && (WHOLE_TREE.has(f.code) || changed.has(f.path)))
    .map((f) => `${f.code} ${f.path}${f.line ? `:${f.line}` : ""}: ${f.message}.`);
  if (!findings.length) return null;
  const hidden = findings.length - SHOWN;
  return {
    text: [
      "System map, before you finish:",
      ...findings.slice(0, SHOWN).map((line) => `- ${line}`),
      ...(hidden > 0 ? [`- and ${hidden} more: node "${SCRIPT}" --changed HEAD lists them.`] : []),
      "Add the `@system` line beside the code and write the map again in this change (/agentic-engineering:system-map diagrams-sync), or write `Diagram: none, <why>` in the commit message for an import, a run or a network call that needs no edge.",
    ].join("\n"),
    summary: plural(findings.length, "finding"),
  };
}

/** True the first time this session is given this text; the record lives in the temp folder. */
function firstTelling(root, sessionId, text) {
  if (typeof sessionId !== "string" || !sessionId) return true;
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const file = path.join(os.tmpdir(), `system-map-stop-${hash(`${root}\0${sessionId}`).slice(0, 24)}.json`);
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
  const changed = changedFiles(root, "HEAD")[0];
  if (!changed.size) return;
  const behind = mapBehind(root, changed);
  if (!behind) return;
  if (firstTelling(root, payload.session_id, behind.text)) {
    console.log(JSON.stringify({
      systemMessage: `system-map told the agent the map fell behind this turn: ${behind.summary}.`,
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: behind.text },
    }));
  } else {
    console.log(JSON.stringify({ systemMessage: `system-map: the map is still behind this session's changes (${behind.summary}); the agent was told once.` }));
  }
}

// process.exitCode, never process.exit: stdout is this hook's whole contract,
// and an exit while it drains can cut the JSON short.
try { main(); } catch { /* fail open */ }
process.exitCode = 0;
