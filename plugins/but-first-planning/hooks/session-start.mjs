#!/usr/bin/env node
// SessionStart and SubagentStart: this plugin's critical lines, through the
// kernel (critical-context.mjs), with two things of its own in front.
//
// A migration, main session only. A workspace this plugin scaffolded before
// 5.0 differs from today's in three ways, and each is moved without asking:
//
//   .plan/                 a workspace from before 4.0 becomes .agents/plan/
//   the Python scripts     plan-status.py and its siblings are parked under
//                          .agents/retired/but-first-planning/ and the Node
//                          ones are written where they were
//   the TaskCompleted gate a repo whose .claude/settings.json runs plan-gate.py
//                          gets `taskGate` in .agents/plan/config.json, the
//                          opt-in that keeps the gate on now that the plugin
//                          ships it as a hook that is off by default
//
// An old layout is recognised only by a script this plugin copied there. Only
// the kernel's `move` and `write` touch the repo, and neither overwrites, so a
// second run changes nothing. Files that name the old commands (checkpoint
// rows, a .gitignore line, the settings entry) are the repo's own: they are
// listed for the session to edit, never rewritten here.
//
// A briefing, main session only, one line and only when it applies: the
// workspace's scripts are not this plugin's current copies, with the command
// that refreshes them.
//
// Fail open, always exit 0. A session must never be blocked by this hook.
import fs from "node:fs";
import path from "node:path";
import { SCRIPTS, WORKSPACE, asset, staleScripts } from "../skills/spec-init/scaffold.mjs";
import { run } from "./critical-context.mjs";
import { CONFIG, GATE_KEY } from "./plan-gate.mjs";

const OLD_WORKSPACE = ".plan";
const RETIRED = ".agents/retired/but-first-planning";
const SCAFFOLD = path.join(import.meta.dirname, "..", "skills", "spec-init", "scaffold.mjs");
// Workspace-relative. Any one of these says the plugin scaffolded the directory.
const OLD_MARKS = ["plan/plan-status.py", "plan/verify-plan-tree.py", "spec/scripts/verify-spec-tree.py"];
// The Python scripts that have a Node successor at the same path.
const OLD_SCRIPTS = ["plan/plan-status.py", "plan/verify-plan-tree.py", "plan/publish-issues.py", "spec/scripts/verify-spec-tree.py", "progress/drift-status.py"];
const OLD_GATE = "plan/plan-gate.py";
const SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];
// Files outside the plan tree that tend to name the old commands or the old path.
const POINTERS = ["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md", ".gitignore", ".github/workflows/ci.yml", ".gitlab-ci.yml", `${WORKSPACE}/README.md`, `${WORKSPACE}/spec/plan.md`];
const OLD_COMMAND = /(?:plan-status|verify-plan-tree|verify-spec-tree|publish-issues|drift-status)\.py\b/;
const OLD_PATH = /(^|[^\w/.-])\.plan\//m;
const MAX_PLAN_FILES = 2000;

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };

/** Markdown files of the plan tree that still run a Python script, capped so a huge tree cannot stall the hook. */
function staleRows(root) {
  const hits = [];
  let seen = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= MAX_PLAN_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".md")) { seen++; if (OLD_COMMAND.test(readText(full) ?? "")) hits.push(full); }
    }
  };
  walk(path.join(root, WORKSPACE, "plan"));
  return hits.map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
}

function migrate({ root, move, write }) {
  const at = (rel) => path.join(root, rel);
  const marked = (dir) => OLD_MARKS.some((rel) => fs.existsSync(at(`${dir}/${rel}`)));
  const notes = [];

  // Read before anything moves: the settings entry says whether the gate was on.
  const gateWired = SETTINGS.filter((rel) => /plan-gate\.py/.test(readText(at(rel)) ?? ""));
  // ".agents/plan/plan/plan-gate.py" does not contain ".plan/", so this is the path from before 4.0.
  const oldGatePath = gateWired.some((rel) => /\.plan\/plan\/plan-gate\.py/.test(readText(at(rel)) ?? ""));

  if (marked(OLD_WORKSPACE) && move(OLD_WORKSPACE, WORKSPACE) === "moved") {
    notes.push(`The planning workspace moved from ${OLD_WORKSPACE}/ to ${WORKSPACE}/; nothing inside it was renamed.`);
  }
  if (!marked(WORKSPACE)) return notes.join(" ");

  // Each Node script is written before its Python one is parked, so a failed write leaves the old one working.
  for (const [name, rel] of Object.entries(SCRIPTS)) {
    if (name === "comments-server.py") continue;
    write(`${WORKSPACE}/${rel}`, asset(name));
  }
  for (const rel of OLD_SCRIPTS) {
    const next = `${WORKSPACE}/${rel.replace(/\.py$/, ".mjs")}`;
    if (fs.existsSync(at(next))) move(`${WORKSPACE}/${rel}`, `${RETIRED}/${rel}`);
  }
  // The comments server stays Python and keeps its path, so the old one is parked first.
  const server = `${WORKSPACE}/${SCRIPTS["comments-server.py"]}`;
  const current = asset("comments-server.py");
  const old = fs.existsSync(at(server)) ? fs.readFileSync(at(server)) : null;
  if (!old || !old.equals(current)) {
    if (old) move(server, `${RETIRED}/${SCRIPTS["comments-server.py"]}`);
    write(server, current);
  }
  notes.push(`The plan scripts are Node now: run \`node ${WORKSPACE}/plan/plan-status.mjs\` (and verify-plan-tree.mjs, publish-issues.mjs, spec/scripts/verify-spec-tree.mjs, progress/drift-status.mjs) wherever \`python ... .py\` was run. The Python copies are parked under ${RETIRED}/. Issue files keep their \`**GitHub**:\` field: the scripts read it as \`**Tracker**:\`.`);

  if (gateWired.length) {
    write(CONFIG, `${JSON.stringify({ [GATE_KEY]: true }, null, 2)}\n`);
    // The settings entry cannot be edited from here, and a python that finds no
    // file exits 2, which would refuse every task. So the file it runs stays:
    // the workspace's own copy does nothing once the Python verifier is gone,
    // and a workspace that moved gets a stand-in at the path the entry names.
    if (oldGatePath) write(`${OLD_WORKSPACE}/${OLD_GATE}`, "# Retired: the plan gate is the but-first-planning plugin's own hook now.\n# Delete this file with the TaskCompleted entry in .claude/settings.json that runs it.\n");
    // The copy that moved with the workspace is one no entry names.
    if (!gateWired.some((rel) => /\.agents\/plan\/plan\/plan-gate\.py/.test(readText(at(rel)) ?? ""))) move(`${WORKSPACE}/${OLD_GATE}`, `${RETIRED}/${OLD_GATE}`);
    notes.push(`The plan gate on TaskCompleted is this plugin's own hook now, off unless a repo asks for it: \`"${GATE_KEY}": true\` in ${CONFIG} keeps it on here. The entry in ${gateWired.join(" and ")} that runs plan-gate.py does nothing any more: remove it, then delete ${oldGatePath ? `${OLD_WORKSPACE}/` : `${WORKSPACE}/${OLD_GATE}`}.`);
  } else {
    move(`${WORKSPACE}/${OLD_GATE}`, `${RETIRED}/${OLD_GATE}`);
  }

  const rows = staleRows(root);
  if (rows.length) {
    notes.push(`${rows.length} file(s) under ${WORKSPACE}/plan/ still run the Python scripts in their checkpoint rows (${rows.slice(0, 3).join(", ")}${rows.length > 3 ? ", ..." : ""}): in each, replace \`python\` or \`python3\` and the \`.py\` name with \`node\` and the \`.mjs\` name.`);
  }
  const stale = POINTERS.filter((rel) => { const text = readText(at(rel)) ?? ""; return OLD_COMMAND.test(text) || OLD_PATH.test(text); });
  if (stale.length) notes.push(`Still naming the old commands or ${OLD_WORKSPACE}/, and yours to edit by hand: ${stale.join(", ")}.`);
  if (fs.existsSync(at(`${WORKSPACE}/plan/verify-agents-tree.py`))) notes.push(`${WORKSPACE}/plan/verify-agents-tree.py was left in place: it calls agent-works' hub check, not this plugin.`);
  notes.push(`The skills lost their numbers (spec-0-init is spec-init, spec-1-specify is spec-write, plan-0-decompose is plan-decompose, plan-1-publish-issues is plan-publish). Once this is committed, ${RETIRED}/ can be deleted.`);
  return notes.join(" ");
}

function briefing(payload, state) {
  const root = state.root;
  // Only a workspace on the Node scripts is compared; one that is not there yet has nothing to refresh.
  if (!root || !fs.existsSync(path.join(root, WORKSPACE, SCRIPTS["plan-status.mjs"]))) return "";
  const stale = staleScripts(root).map((rel) => path.basename(rel));
  if (!stale.length) return "";
  return `The plan scripts in ${WORKSPACE}/ are not this plugin's current copies (${stale.join(", ")}). Before publishing or changing a status, refresh them and commit the result: node "${SCAFFOLD}" --refresh`;
}

await run(briefing, { migrate });
