#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact) and SubagentStart: this
// plugin's critical lines from critical.json, through the kernel
// (critical-context.mjs), with two things of its own in front. The blind
// critic never gets any of it: the kernel's deny list names its agent type.
//
// A migration, main session only. The plugin's first layout kept a project's
// state in .perceptual-loop/ at the root; it now lives in .agents/perceptual/.
// The whole folder is moved in one rename (config, groups, baseline, success
// files, rulings, and the untracked shots and runs with them), recognised by
// the config.json only this plugin wrote. Nothing inside it is rewritten: a
// config that names the old folder is reported key by key for the model to
// edit, and the CLI keeps reading that spelling from the new folder meanwhile.
// Only the kernel's `move` touches the repo, and it never overwrites.
//
// A briefing, main session only, in a repo that has the state folder (a few
// dozen tokens): how many shots and which groups there are, so the model uses
// the harness instead of building one, and whatever in config.json still
// waits for an edit.
//
// Fail open, always exit 0. A session must never be blocked by this hook.
import fs from "node:fs";
import path from "node:path";
import { OLD_DIR_NAME, allShots, loadConfig, oldPathKeys } from "../scripts/lib/project.mjs";
import { shellOnly } from "../scripts/lib/render.mjs";
import { run } from "./critical-context.mjs";

const NEW_DIR = ".agents/perceptual";
const CONFIG = `${NEW_DIR}/config.json`;
// Files that tend to name the old folder, its scripts, or the skills that were renamed.
const POINTERS = [".gitignore", "AGENTS.md", "CLAUDE.md", ".agents/AGENTS.md", "README.md", "CONTRIBUTING.md", "package.json", ".github/workflows/ci.yml", ".gitlab-ci.yml"];
const OLD_NAMES = [/(?:^|[^\w-])\.perceptual-loop(?![\w-])/m, /\b(?:iterate|baseline|compare|calibrate|evidence_lint|review_page)\.py\b/, /perceptual-loop:(?:build-harness|orchestrate-agents|iterate)(?![\w-])/];
const MAX_LISTED = 4;

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
const readJson = (file) => { try { return JSON.parse(readText(file)); } catch { return null; } };
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const listed = (items) => (items.length > MAX_LISTED ? [...items.slice(0, MAX_LISTED), `and ${items.length - MAX_LISTED} more`] : items).join("; ");

/**
 * What in a config still waits for a person or the model to edit, one sentence each:
 * values that name the old folder, render commands that need a shell, and budget
 * patterns that match a script the plugin no longer has.
 */
function configEdits(config, file) {
  if (!isObject(config)) return [];
  const out = [];
  const keys = oldPathKeys(config).map(([key]) => key);
  if (keys.length) {
    out.push(`${file} still names the old folder: replace ${OLD_DIR_NAME} with ${NEW_DIR} in ${listed(keys)}.${keys.includes("shotsDir") ? " Until then shotsDir is read from the new folder; any other value is used as written." : ""}`);
  }
  const render = isObject(config.render) ? config.render : {};
  const shell = Object.entries(render).filter(([, command]) => typeof command === "string" && shellOnly(command));
  if (shell.length) {
    out.push(`A render command is started as a program with its arguments, never through a shell, and ${listed(shell.map(([s, c]) => `render.${s} holds ${shellOnly(c)}`))}. In ${file}, put that line in a script and name the script, or name the shell yourself as an array: ["bash", "-c", "<the line>"].`);
  }
  const match = Array.isArray(config.budget?.match) ? config.budget.match : [];
  const stale = match.map((p, i) => [i, p]).filter(([, p]) => typeof p === "string" && /\.py\b|\\\.py/.test(p));
  if (stale.length) {
    out.push(`${listed(stale.map(([i, p]) => `budget.match[${i}] (${JSON.stringify(p)})`))} in ${file} matched a script that is now a command of pl.mjs: the render budget's own pattern is ${JSON.stringify(String.raw`pl\.mjs["']?\s+iterate\b`)}.`);
  }
  return out;
}

// ---- migration -----------------------------------------------------------

// Set when this run moved the folder, so the briefing does not repeat what the note just said.
let justMoved = false;

function migrate({ root, move }) {
  // Recognised by the one file only this plugin wrote; without it there is nothing to move.
  if (!fs.existsSync(path.join(root, OLD_DIR_NAME, "config.json"))) return "";
  if (move(OLD_DIR_NAME, NEW_DIR) !== "moved") return "";
  justMoved = true;
  const notes = [
    `The perceptual state (config, groups, baseline, success files, rulings, shots and runs) is now in ${NEW_DIR}/, and nothing inside it was rewritten.`,
    "Its scripts are one CLI now: `pl.mjs <command>` where `<command>.py` stood (`pl.mjs lint` for evidence_lint.py, `pl.mjs review` for review_page.py); the skills give the full call.",
    ...configEdits(readJson(path.join(root, CONFIG)), CONFIG),
  ];
  const stale = POINTERS.filter((rel) => { const text = readText(path.join(root, rel)); return text !== null && OLD_NAMES.some((rx) => rx.test(text)); });
  if (stale.length) notes.push(`Still naming ${OLD_DIR_NAME}/, a script that is gone, or a renamed skill (build-harness is shot-harness, iterate is iterate-shots), and yours to edit by hand: ${stale.join(", ")}.`);
  return notes.join(" ");
}

// ---- briefing ------------------------------------------------------------

function briefing(payload, state) {
  const root = state.root;
  if (!root) return "";
  const moved = fs.existsSync(path.join(root, CONFIG));
  const unmoved = !moved && fs.existsSync(path.join(root, OLD_DIR_NAME, "config.json"));
  if (!moved && !unmoved) return "";
  const dir = moved ? NEW_DIR : OLD_DIR_NAME;
  const lines = [];
  let shots = 0;
  try { shots = allShots(root, loadConfig(root)).length; } catch { /* a config that does not parse: the count is not worth a failure */ }
  const groups = Object.keys(readJson(path.join(root, dir, "groups.json")) ?? {});
  lines.push(`This repo has a perceptual harness in ${dir}/: ${shots} shot(s)${groups.length ? `, groups ${groups.slice(0, 6).join(", ")}` : ""}. Iterate on it with /perceptual-loop:iterate-shots instead of rendering by hand.`);
  if (unmoved) lines.push(`Its state is still in ${OLD_DIR_NAME}/ and is read from there: move that folder to ${NEW_DIR}/, merging by hand what is already there.`);
  else if (!justMoved) lines.push(...configEdits(readJson(path.join(root, CONFIG)), CONFIG));
  return lines.join(" ");
}

await run(briefing, { migrate });
