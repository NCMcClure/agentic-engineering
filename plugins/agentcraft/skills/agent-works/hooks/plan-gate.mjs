#!/usr/bin/env node
// UserPromptSubmit, PreToolUse and PostToolUse: make a plan written in Claude
// Code's plan mode carry its orchestration, and record it when the person
// approves. (Plan mode is the host's; the spec and plan tree in a repo are the
// but-first-planning area's, and this hook never reads them.)
//
// While the session is in plan mode, a prompt (or the model entering plan mode
// itself) is told the format of the plan's `## Orchestration` section, in full
// the first time and as one sentence for the next hour. A write to the plan
// file that lacks the section gets the sentence once. ExitPlanMode with a
// plan whose orchestration breaks a rule is denied with what to fix, at most
// twice per plan file, so a model that cannot satisfy the gate is never
// trapped; a clean plan prints nothing, because an explicit allow would skip
// the person's approval. PostToolUse on ExitPlanMode fires only on approval:
// it saves the plan's state under the work tree's git dir and hands the
// session the waves. A plan with no units drops any earlier state.
//
// What was already said is a small file in the temp dir, keyed by session, and
// losing it only repeats a message. A payload this hook has nothing to say to
// loads no module and starts no process. Main session only, silent in a repo
// where the plugins are off. Fail open, always exit 0.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { modeOf, readPayload, repoRoot } from "../../../hooks/critical-context.mjs";

const BOARD = `node "${path.join(import.meta.dirname, "..", "scripts", "aw.mjs")}" board`;
const TOLD_MS = 60 * 60 * 1000;
const MAX_DENIALS = 2;
const HAS_SECTION = /^##[ \t]+Orchestration[ \t]*$|^[ \t]*Orchestration:[ \t]*none\b/im;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const saidFile = (id) => path.join(process.env.TMPDIR || os.tmpdir(), `agent-works-planmode-${String(id || "unknown").replace(/[^A-Za-z0-9_-]/g, "")}.json`);
function readSaid(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return { told: Number(s?.told) || 0, files: s?.files && typeof s.files === "object" ? s.files : {} };
  } catch {
    return { told: 0, files: {} };
  }
}
const readFile = (file) => { try { return typeof file === "string" && file ? fs.readFileSync(file, "utf8") : ""; } catch { return ""; } };
const text = (v) => (typeof v === "string" && v ? v : "");
const context = (hookEventName, additionalContext) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }));

/** Whether the plan file will carry its orchestration after this write or edit. */
function carries(input, tool) {
  if (tool === "Write") return HAS_SECTION.test(text(input.content));
  const added = tool === "Edit" ? [input.new_string] : (Array.isArray(input.edits) ? input.edits.map((e) => e?.new_string) : []);
  return HAS_SECTION.test([readFile(input.file_path), ...added.map(text)].join("\n"));
}

async function main() {
  const payload = readPayload();
  if (!payload || typeof payload !== "object") return;
  if (typeof payload.agent_id === "string" && payload.agent_id) return;
  const event = String(payload.hook_event_name ?? "");
  const tool = String(payload.tool_name ?? "");
  const planning = payload.permission_mode === "plan";
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};

  let kind = null;
  if (event === "UserPromptSubmit" && planning) kind = "prompt";
  else if (event === "PostToolUse" && tool === "EnterPlanMode") kind = "entered";
  else if (event === "PreToolUse" && /^(Write|Edit|MultiEdit)$/.test(tool) && planning) kind = "write";
  else if (event === "PreToolUse" && tool === "ExitPlanMode") kind = "exit";
  else if (event === "PostToolUse" && tool === "ExitPlanMode") kind = "approved";
  if (!kind) return;
  if (modeOf(repoRoot(payload)) === "none") return;

  const { handoff, instructions, parseOrchestration, pointer, refusal, stateOf } = await import("../lib/planmode.mjs");
  const { atomicWrite } = await import("../lib/common.mjs");
  const file = saidFile(payload.session_id);
  const said = readSaid(file);
  const save = (next) => atomicWrite(file, `${JSON.stringify(next)}\n`);
  const now = Date.now();

  if (kind === "prompt" || kind === "entered") {
    // The format in full, or the one sentence when it was given within the hour.
    const full = now - said.told > TOLD_MS;
    context(event, full ? instructions() : pointer());
    if (full) save({ ...said, told: now });
    return;
  }

  if (kind === "write") {
    const target = text(input.file_path);
    if (!target || said.files[target]?.pointed || carries(input, tool)) return;
    said.files[target] = { ...said.files[target], pointed: true };
    save(said);
    context("PreToolUse", pointer());
    return;
  }

  if (kind === "exit") {
    const planFile = text(input.planFilePath);
    const plan = text(input.plan) || readFile(planFile);
    if (!plan) return;
    const parsed = parseOrchestration(plan);
    if (!parsed.findings.length) return;
    const key = planFile || "plan";
    const denied = said.files[key]?.denied ?? 0;
    if (denied >= MAX_DENIALS) return;
    said.files[key] = { ...said.files[key], denied: denied + 1 };
    save(said);
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: refusal(parsed.findings) } }));
    return;
  }

  // The approval: the plan's state is kept for the work tree, or dropped when it names no units.
  const response = payload.tool_response && typeof payload.tool_response === "object" ? payload.tool_response : {};
  const planFile = text(response.filePath) || text(input.planFilePath);
  const plan = text(response.plan) || text(input.plan) || readFile(planFile);
  if (!plan) return;
  const { dropPlanState, locate, writePlanState } = await import("../scripts/io.mjs");
  const cwd = [payload.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()].find((dir) => typeof dir === "string" && dir && isDir(dir));
  const loc = cwd ? locate(cwd) : null;
  if (!loc?.gitDir) return;
  const parsed = parseOrchestration(plan);
  if (!parsed.units.length) { dropPlanState(loc); return; }
  const state = stateOf(parsed, { planFile, at: new Date(now).toISOString() });
  if (writePlanState(loc, state)) context("PostToolUse", handoff(state, { cli: BOARD }));
}

// process.exitCode, not process.exit: an exit while stdout drains can cut the
// output short, and a host reads that as a crashed hook.
process.exitCode = 0;
try { await main(); } catch { /* a reminder is never worth a failed turn */ }
