#!/usr/bin/env node
// TaskCompleted: the plan gate. Off unless the repo asks for it.
//
// A repo turns it on with one key in .agents/plan/config.json, or, where it
// has only named workspaces, in .agents/plans/config.json:
//
//   { "taskGate": true }
//
// With the key set, a task cannot be marked done while a plan tree is
// critically broken: this hook runs each workspace's own verify-plan-tree.mjs
// (the project's, and every named one's) and, when one exits 2 (a hand-edited
// Status that no longer agrees with its parents, a broken link, a spec anchor
// that points nowhere), exits 2 itself with that verifier's findings on
// stderr, which is what the model is handed back. Warnings do not block.
//
// It guards the trees, not the work: an issue's own testing checkpoint is a
// project command no hook can see, so re-running it stays with whoever
// integrates the issue.
//
// Without the key, without a workspace, or with anything unreadable, it says
// nothing and exits 0.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPayload, repoRoot } from "../../../hooks/critical-context.mjs";
import { PLANS, WORKSPACE, workspaces } from "../routes/spec-init/scaffold.mjs";

export const CONFIG = `${WORKSPACE}/config.json`;
/** Where a repo with no project workspace sets the key. */
export const NAMED_CONFIG = `${PLANS}/config.json`;
export const GATE_KEY = "taskGate";
const VERIFIER = "plan/verify-plan-tree.mjs";
const CRITICAL = 2; // verify-plan-tree.mjs: 0 clean, 1 warnings only, 2 critical
const TIMEOUT_MS = 20_000; // for every workspace together

/** The config file that turns the gate on in this repo, or null. */
export function gateConfig(root) {
  return [CONFIG, NAMED_CONFIG].find((rel) => {
    try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"))?.[GATE_KEY] === true; } catch { return false; }
  }) ?? null;
}

/** Whether this repo opted in to the gate. */
export const gateOn = (root) => gateConfig(root) !== null;

/** Each workspace's verifier that is there to run, repo-relative: the project's first. */
export function verifiers(root) {
  return [`${WORKSPACE}/${VERIFIER}`, ...workspaces(root).map((name) => `${PLANS}/${name}/${VERIFIER}`)].filter((rel) => fs.existsSync(path.join(root, rel)));
}

function main() {
  process.exitCode = 0;
  try {
    const root = repoRoot(readPayload());
    const config = root ? gateConfig(root) : null;
    if (!config) return;
    const until = Date.now() + TIMEOUT_MS;
    for (const verifier of verifiers(root)) {
      const left = until - Date.now();
      if (left <= 0) return; // out of time: a gate that cannot finish does not block
      const r = spawnSync(process.execPath, [path.join(root, verifier)], { cwd: root, encoding: "utf8", timeout: left });
      if (r.status !== CRITICAL) continue;
      process.stderr.write(`plan gate: the plan tree has critical violations. Fix them before a task is marked done (${verifier}; turn the gate off with "${GATE_KEY}": false in ${config}).\n${r.stdout ?? ""}${r.stderr ?? ""}`);
      process.exitCode = 2;
    }
  } catch { /* fail open: a gate that cannot run does not block */ }
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) main();
