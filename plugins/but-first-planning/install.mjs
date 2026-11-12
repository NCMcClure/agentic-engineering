#!/usr/bin/env node
// Install the but-first-planning skills as plain Claude Code skills, without
// the plugin system. Node 22 stdlib only.
//
//   node install.mjs [TARGET_DIR] [--global]
//
//   node install.mjs                 into ./.claude/skills (the current project)
//   node install.mjs /path/to/repo   into that project's .claude/skills
//   node install.mjs --global        into ~/.claude/skills (every project)
//
// Run from a checkout, it copies the skills beside it. Run with no checkout
// beside it (piped to `node --input-type=module -`), it shallow-clones the
// marketplace first; BFP_REPO and BFP_BRANCH name another fork or branch.
//
// A skill installed this way is invoked without the plugin prefix
// (`/spec-init`, not `/but-first-planning:spec-init`) and has no
// ${CLAUDE_PLUGIN_ROOT}, so every such path in the copied files is rewritten
// to where the copy landed. What does not come along is the hooks: the session
// lines, the layout migration and the opt-in plan gate need the plugin install
// (`/plugin install but-first-planning@agentic-engineering`).
//
// Exit 0 = installed, 1 = nothing to install from, 2 = usage.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = process.env.BFP_REPO || "NCMcClure/agentic-engineering";
const BRANCH = process.env.BFP_BRANCH || "main";
const USAGE = "usage: install.mjs [TARGET_DIR] [--global]";
// Where the shared references land beside the skills: a folder with no SKILL.md, which a skill loader skips.
const REFERENCES = "but-first-planning-references";
const TEXT = /\.(md|js|mjs|json|html|yml)$/;

/** A copied file's text with every plugin-relative path pointed at the standalone copy. */
export function relocate(text, dest) {
  const at = (p) => p.split(path.sep).join("/");
  return text
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/skills/", `${at(dest)}/`)
    .replaceAll("${CLAUDE_PLUGIN_ROOT}/references/", `${at(dest)}/${REFERENCES}/`)
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", at(path.dirname(dest)))
    .replaceAll("../../references/", `../${REFERENCES}/`);
}

function copyTree(from, to, dest) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name), target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target, dest);
    else if (TEXT.test(entry.name)) fs.writeFileSync(target, relocate(fs.readFileSync(source, "utf8"), dest));
    else fs.copyFileSync(source, target);
  }
}

/**
 * Copies every skill under `source` (a plugin directory) into `dest` (a
 * `.claude/skills` directory), replacing a skill of the same name. Returns the
 * names installed.
 */
export function install(source, dest) {
  const skills = path.join(source, "skills");
  const names = fs.readdirSync(skills, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(skills, e.name, "SKILL.md"))).map((e) => e.name).sort();
  fs.mkdirSync(dest, { recursive: true });
  for (const name of names) {
    fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    copyTree(path.join(skills, name), path.join(dest, name), dest);
  }
  const references = path.join(source, "references");
  if (fs.existsSync(references)) {
    fs.rmSync(path.join(dest, REFERENCES), { recursive: true, force: true });
    copyTree(references, path.join(dest, REFERENCES), dest);
  }
  return names;
}

/** The plugin directory to install from: the one this file sits in, else a fresh shallow clone. Returns `{ source, cleanup }`. */
function locate(here, log) {
  // Piped to node, "here" is whatever directory the person is in: only this plugin's own folder counts.
  const ours = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "utf8")).name === "but-first-planning"; } catch { return false; } };
  if (here && ours(here) && fs.existsSync(path.join(here, "skills"))) return { source: here, cleanup: null };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "but-first-planning-"));
  log(`Fetching ${REPO} (${BRANCH})...`);
  execFileSync("git", ["clone", "--depth", "1", "--branch", BRANCH, `https://github.com/${REPO}.git`, tmp], { stdio: "ignore" });
  return { source: path.join(tmp, "plugins", "but-first-planning"), cleanup: tmp };
}

export function main(argv, { here = import.meta.dirname, home = os.homedir(), cwd = process.cwd(), log = console.log } = {}) {
  let global = false, target = null;
  for (const arg of argv) {
    if (arg === "--global" || arg === "-g") global = true;
    else if (arg === "-h" || arg === "--help") { log(`${USAGE}\n\n  (no argument)   ./.claude/skills\n  TARGET_DIR      that project's .claude/skills\n  --global        ~/.claude/skills`); return 0; }
    else if (arg.startsWith("-")) { console.error(`install.mjs: unknown option '${arg}'\n${USAGE}`); return 2; }
    else target = arg;
  }
  let found;
  try { found = locate(here, log); } catch (e) { console.error(`install.mjs: could not fetch ${REPO}: ${e.message.split("\n")[0]}`); return 1; }
  try {
    if (!fs.existsSync(path.join(found.source, "skills"))) { console.error("install.mjs: could not find a skills/ directory"); return 1; }
    const dest = path.resolve(global ? path.join(home, ".claude", "skills") : path.join(target ?? cwd, ".claude", "skills"));
    const names = install(found.source, dest);
    for (const name of names) log(`  + ${name}`);
    log(`\nInstalled ${names.length} skills into ${dest}`);
    log("Start a planning workspace with /spec-init (start a new session if the skills do not appear yet).");
    log("The hooks (session lines, layout migration, the opt-in plan gate) come only with the plugin install.");
    return 0;
  } finally {
    if (found.cleanup) fs.rmSync(found.cleanup, { recursive: true, force: true });
  }
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// Piped to node there is no file to compare against, and that is a run too.
if (!process.argv[1] || process.argv[1] === "-" || realpath(process.argv[1]) === realpath(import.meta.filename ?? "")) {
  process.exitCode = main(process.argv.slice(2));
}
