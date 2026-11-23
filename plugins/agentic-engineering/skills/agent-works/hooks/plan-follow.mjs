#!/usr/bin/env node
// PreToolUse, PostToolUse, SubagentStop and Stop: hold a session to the
// orchestration of a plan its person approved in Claude Code's plan mode.
//
// Before an Agent call the main session makes, an approved plan's unit it
// names is checked against the plan: the model must be the plan's and every
// subagent unit it waits on must have returned, else the call is denied with
// the right value. A call that passes is logged as started. After the call,
// the unit is logged as returned (a foreground agent) or as launched under its
// agent id (a background agent, whose PostToolUse fires at launch), and
// SubagentStop marks that unit returned when the agent ends. A stop is held
// once when the plan is in force and nothing was started or filed. A child
// session started for a board card through the desktop app's session tool is
// held to the card's model pin and its `after` cards, plan or no plan.
// lib/planmode.mjs holds every rule; the state lives under the work tree's git
// dir (scripts/io.mjs).
//
// An event this hook does not handle loads no module. With no approved plan
// the Agent, SubagentStop and Stop branches look for one small file, start no
// process and say nothing; only the check on a child session's start reads
// the board. Fail open, always exit 0.
import fs from "node:fs";
import { readPayload } from "../../../hooks/critical-context.mjs";

const START_SESSION = "mcp__ccd_session__start_session";
const isAgent = (name) => name === "Agent" || name === "Task";
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function deny(reason) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
}

async function main() {
  const payload = readPayload();
  if (!payload || typeof payload !== "object") return;
  const event = String(payload.hook_event_name ?? "");
  const tool = String(payload.tool_name ?? "");
  const sub = typeof payload.agent_id === "string" && payload.agent_id ? payload.agent_id : null;

  const branch = event === "PreToolUse" && isAgent(tool) && !sub ? "gate"
    : event === "PostToolUse" && isAgent(tool) && !sub ? "after"
    : event === "SubagentStop" && sub ? "end"
    : event === "PreToolUse" && tool === START_SESSION ? "session"
    : event === "Stop" && !sub && payload.stop_hook_active !== true ? "stop"
    : null;
  if (!branch) return;

  const { appendPlanEvent, locate, readBoard, readFullBoard, readPlanState } = await import("../scripts/io.mjs");
  const cwd = [payload.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].find((dir) => typeof dir === "string" && dir && isDir(dir));
  const loc = cwd ? locate(cwd) : null;
  if (!loc?.git) return;
  const { agentGate, idleAsk, sessionGate, unitOf } = await import("../lib/planmode.mjs");
  const now = Date.now();
  const at = new Date(now).toISOString();

  if (branch === "session") {
    // Dispatch names a card's session `card-<id>`; any other name is not a card's.
    const id = /^card-([\w.-]+)$/.exec(String(payload.tool_input?.name ?? "").trim())?.[1];
    if (!id || !isDir(loc.dir)) return;
    const { findCard, holdOf } = await import("../lib/board.mjs");
    const board = readFullBoard(loc);
    const card = findCard(board, id);
    const verdict = card ? sessionGate(card, holdOf(board, card), payload.tool_input) : null;
    if (verdict?.deny) deny(verdict.deny);
    return;
  }

  const plan = readPlanState(loc);
  if (!plan) return;
  const { state, events } = plan;

  if (branch === "gate") {
    const verdict = agentGate(state, events, payload.tool_input);
    if (verdict?.deny) deny(verdict.deny);
    else if (verdict?.start) appendPlanEvent(loc, { t: "start", unit: verdict.start, at });
    return;
  }

  if (branch === "after") {
    const unit = unitOf(state, payload.tool_input);
    if (!unit) return;
    const res = payload.tool_response && typeof payload.tool_response === "object" ? payload.tool_response : {};
    const launched = res.isAsync === true || res.status === "async_launched";
    appendPlanEvent(loc, launched ? { t: "agent", unit, agent: res.agentId, at } : { t: "returned", unit, at });
    return;
  }

  if (branch === "end") {
    const launch = events.find((e) => e.t === "agent" && e.agent === sub);
    if (launch && !events.some((e) => e.t === "returned" && e.unit === launch.unit)) appendPlanEvent(loc, { t: "returned", unit: launch.unit, at });
    return;
  }

  // A stop: cards filed since the approval count as the plan being acted on.
  if (events.some((e) => e.t === "asked")) return;
  const since = Date.parse(state.at);
  const cardsSince = isDir(loc.dir) ? readBoard(loc.dir).cards.filter((c) => Date.parse(c.created) > since).length : 0;
  const ask = idleAsk(state, events, { cardsSince, now });
  if (!ask) return;
  appendPlanEvent(loc, { t: "asked", at });
  console.log(JSON.stringify({ decision: "block", reason: ask }));
}

// process.exitCode, not process.exit: an exit while stdout drains can cut the
// output short, and a host reads that as a crashed hook.
process.exitCode = 0;
try { await main(); } catch { /* a reminder is never worth a failed turn */ }
