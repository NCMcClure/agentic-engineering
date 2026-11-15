#!/usr/bin/env node
// PostToolUse, Stop and SubagentStop: keep the cards a session works on in
// step with the work.
//
// After a tool call it notes what the call did to a card (an edit, a commit or
// a push on the card's branch, a pull or merge request opened or merged with
// `gh` or `glab`, a board command or one of the pane's board tools) in the
// session's ledger, a JSON file in the temp dir, and tells the model at once
// when that owes a move the card does not show yet, or, on a timer that backs
// off, when work has gone on under a card nobody updated. A stop is held once
// to ask about each card the session (or that subagent) worked on whose state
// may have moved. lib/sync.mjs holds every rule; this file is the wiring.
//
// Everything it finds goes to the model: context after a tool call, the reason
// of a held stop. It moves no card itself.
//
// A call that touches no card starts no process and reads no file. A repo
// with no board folder, and one where the plugins are off, is silence. Never
// re-enters on a continuation it caused. Fail open, always exit 0.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterTool, cardsOf, ledgerOf, observe, record, stopAsk } from "../lib/sync.mjs";
import { modeOf, readPayload, repoRoot } from "./critical-context.mjs";

const CLI = `node "${path.join(import.meta.dirname, "..", "scripts", "aw.mjs")}" board`;
const KINDS = { PostToolUse: "tool", Stop: "stop", SubagentStop: "subagent" };

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ledgerFile = (id) => path.join(process.env.TMPDIR || os.tmpdir(), `agent-works-cards-${String(id || "unknown").replace(/[^A-Za-z0-9_-]/g, "")}.json`);
const readLedger = (file) => { try { return ledgerOf(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { return ledgerOf(null); } };

/** A tool's input as the rules read it: the pane's move tool names its column `status`. */
function toolInput(input) {
  const given = input !== null && typeof input === "object" ? input : {};
  return given.column === undefined && typeof given.status === "string" ? { ...given, column: given.status } : given;
}

async function main() {
  const payload = readPayload();
  const kind = KINDS[payload.hook_event_name];
  if (!kind) return;
  if (kind !== "tool" && payload.stop_hook_active === true) return;

  // Only a call that did something a card cares about looks at the repo.
  const seen = kind === "tool" ? observe({ tool: payload.tool_name, input: toolInput(payload.tool_input), output: payload.tool_response }) : null;
  if (kind === "tool" && !seen) return;

  const file = ledgerFile(payload.session_id);
  let ledger = readLedger(file);
  const lastMessage = typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : "";
  // A stop with nothing in the ledger and no CARD line in the final message has nothing to ask.
  if (kind !== "tool" && !ledger.events.length && !/\bCARD\b/.test(lastMessage)) return;

  const { locate, readFullBoard, writeAtomic } = await import("../scripts/io.mjs");
  const cwd = [payload.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].find((dir) => typeof dir === "string" && dir && isDir(dir));
  const loc = cwd ? locate(cwd) : null;
  if (!loc || !isDir(loc.dir)) return;
  if (modeOf(repoRoot(payload)) === "none") return;

  const board = readFullBoard(loc);
  const now = Date.now();
  const at = new Date(now).toISOString();
  const worktree = loc.toplevel !== loc.main;
  const agent = typeof payload.agent_id === "string" && payload.agent_id ? payload.agent_id : null;
  // Subagents share the session's ledger, so a write is a rename: a reader never sees half a file.
  const save = (next) => writeAtomic(file, `${JSON.stringify(next)}\n`);

  if (kind === "tool") {
    const ids = cardsOf(board, seen, { branch: loc.branch, focus: ledger.focus });
    if (!ids.length) return;
    ledger = record(ledger, { ...seen, ids, ...(agent ? { agent } : {}) }, { at, now, board });
    const tell = seen.kind === "board" ? null : afterTool(board, ledger, ids, { now, cli: CLI, worktree });
    if (tell) ledger = { ...ledger, told: { ...ledger.told, ...tell.told } };
    save(ledger);
    if (tell) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: tell.text } }));
    return;
  }

  const ask = stopAsk(board, ledger, { now, cli: CLI, agent: kind === "subagent" ? agent ?? "subagent" : null, lastMessage, worktree });
  if (!ask) return;
  save({ ...ledger, asked: { ...ledger.asked, ...ask.asked } });
  console.log(JSON.stringify({ decision: "block", reason: ask.text }));
}

// process.exitCode, not process.exit: an exit while stdout drains can cut the
// output short, and a host reads that as a crashed hook.
process.exitCode = 0;
try { await main(); } catch { /* a reminder is never worth a failed turn */ }
