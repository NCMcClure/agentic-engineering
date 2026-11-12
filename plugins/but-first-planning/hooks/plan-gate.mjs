#!/usr/bin/env node
// TaskCompleted: the plan gate. Off unless the repo asks for it.
//
// A repo turns it on with one key in .agents/plan/config.json:
//
//   { "taskGate": true }
//
// With the key set, a task cannot be marked done while the plan tree is
// critically broken: this hook runs the workspace's own verify-plan-tree.mjs
// and, when it exits 2 (a hand-edited Status that no longer agrees with its
// parents, a broken link, a spec anchor that points nowhere), exits 2 itself
// with the verifier's findings on stderr, which is what the model is handed
// back. Warnings do not block.
//
// It guards the tree, not the work: an issue's own testing checkpoint is a
// project command no hook can see, so re-running it stays with whoever
// integrates the issue.
//
// Without the key, without a workspace, or with anything unreadable, it says
// nothing and exits 0.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPayload, repoRoot } from "./critical-context.mjs";

export const CONFIG = ".agents/plan/config.json";
export const GATE_KEY = "taskGate";
const VERIFIER = ".agents/plan/plan/verify-plan-tree.mjs";
const CRITICAL = 2; // verify-plan-tree.mjs: 0 clean, 1 warnings only, 2 critical
const TIMEOUT_MS = 20_000;

/** Whether this repo opted in to the gate. */
export function gateOn(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, CONFIG), "utf8"))?.[GATE_KEY] === true; } catch { return false; }
}

function main() {
  process.exitCode = 0;
  try {
    const root = repoRoot(readPayload());
    if (!root || !gateOn(root)) return;
    const verifier = path.join(root, VERIFIER);
    if (!fs.existsSync(verifier)) return;
    const r = spawnSync(process.execPath, [verifier], { cwd: root, encoding: "utf8", timeout: TIMEOUT_MS });
    if (r.status !== CRITICAL) return;
    process.stderr.write(`plan gate: the plan tree has critical violations. Fix them before a task is marked done (${VERIFIER}; turn the gate off with "${GATE_KEY}": false in ${CONFIG}).\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    process.exitCode = 2;
  } catch { /* fail open: a gate that cannot run does not block */ }
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) main();
