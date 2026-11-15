#!/usr/bin/env node
// SessionStart and SubagentStart: this plugin's critical lines, through the
// kernel (critical-context.mjs), with two things of its own in front.
//
// A migration, main session only. A repo set up by the plugin's first layout
// keeps its rules in .claude/teamwork.json, a rules file under .claude/rules,
// and a bash pre-commit mirror in .githooks. They are moved to the current
// layout: the settings become the `teamwork` block of .agents/manifest.json
// with everything the old file enforced spelled out, so nothing loosens; the
// old files are parked under .agents/retired/agentic-teamwork/, never deleted;
// the mirror is replaced by the Node one. Only the kernel's `move` and `write`
// touch the repo, and neither overwrites, so a second run changes nothing.
//
// A briefing, main session only, in a repo on the team conventions (about a
// hundred tokens): the branch, whether it is protected or behind its base as
// last fetched, the lane commands from the manifest, and one line each for a
// repo that should run the upgrade, a committed pre-commit mirror git would
// skip, rules still read from the first layout, and a forge CLI that is not
// on PATH (a PATH lookup: nothing is started).
// A repo whose person answered `team` and has no manifest yet is told to
// bootstrap before writing code.
//
// Fail open, always exit 0. A session must never be blocked by this hook.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FORGES, cliPath, detect } from "../scripts/lib/provider.mjs";
import { run } from "./critical-context.mjs";
import { FIRST_LAYOUT, MANIFEST, blockFromFirstLayout, firstLayout, loadConfig, notWired } from "./lib/config.mjs";

const RETIRED = ".agents/retired/agentic-teamwork";
const BLOCK_FILE = `${RETIRED}/teamwork-block.json`;
const OLD_RULES = ".claude/rules/team-workflow.md";
const MIRROR = ".githooks/pre-commit";
const OLD_MIRROR_LIB = ".githooks/lib-guard.sh";
const NEW_MIRROR = path.join(import.meta.dirname, "..", "templates", "githooks", "pre-commit");
// Files that tend to name the old paths, and what to look for in them.
const POINTERS = ["CLAUDE.md", "AGENTS.md", "README.md", "CONTRIBUTING.md", MIRROR, ".github/workflows/ci.yml", ".gitlab-ci.yml"];
const OLD_NAMES = [FIRST_LAYOUT, OLD_RULES, "lib-guard.sh", "/teamwork-init", "/teamwork-audit"];

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
const readJson = (file) => { try { return JSON.parse(readText(file)); } catch { return null; } };

// ---- migration -----------------------------------------------------------

/** The lanes a first-layout repo can name: its one test command, run where it said to run it. */
function lanesFrom(old) {
  const command = typeof old.test?.command === "string" ? old.test.command.trim() : "";
  if (!command) return {};
  const dir = typeof old.test?.dir === "string" && old.test.dir && old.test.dir !== "." ? old.test.dir : null;
  return { unit: dir ? `cd ${dir} && ${command}` : command };
}

function migrate({ root, move, write }) {
  const old = firstLayout(root);
  // Recognised by the one file only this plugin wrote; without it there is nothing to move.
  if (!old) return "";
  const at = (rel) => path.join(root, rel);
  const block = blockFromFirstLayout(old);
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

  if (!fs.existsSync(at(MANIFEST))) {
    write(MANIFEST, json({
      standard: "agentic-engineering", standard_version: 1, project: path.basename(root),
      default_branch: typeof old.baseBranch === "string" && old.baseBranch ? old.baseBranch : "main",
      lanes: lanesFrom(old), owned: {}, teamwork: block,
    }));
  }
  const manifest = readJson(at(MANIFEST));
  const carried = manifest?.teamwork;
  if (!carried || typeof carried !== "object" || Array.isArray(carried)) {
    // A manifest somebody else wrote cannot be edited from here. The old file
    // stays where it is and keeps being read, so nothing loosens meanwhile.
    write(BLOCK_FILE, json(block));
    return `${MANIFEST} ${manifest ? "has no `teamwork` block" : "does not parse"}, so this repo's git rules are still read from ${FIRST_LAYOUT}. Add the contents of ${BLOCK_FILE} to the manifest as its \`teamwork\` key; the next session then retires the old files.`;
  }

  const notes = [`The git rules now come from the \`teamwork\` block of ${MANIFEST}, which spells out everything ${FIRST_LAYOUT} enforced (protected branches, patterns, lint, coupled files, the test gate): nothing was loosened.`];

  if (move(OLD_RULES, `${RETIRED}/${OLD_RULES}`) === "moved") {
    notes.push(`${OLD_RULES} is retired: the plugin delivers its rules at session start now. If the team added rules of its own to that file, move them into AGENTS.md first.`);
  }

  // The bash mirror reads the old file, so it has to go with it. Only one this plugin installed is replaced.
  const retiredMirror = `${RETIRED}/${MIRROR}`;
  const ours = (readText(at(MIRROR)) ?? "").includes("lib-guard.sh");
  if (ours) move(MIRROR, retiredMirror);
  move(OLD_MIRROR_LIB, `${RETIRED}/${OLD_MIRROR_LIB}`);
  const script = (ours || fs.existsSync(at(retiredMirror))) && !fs.existsSync(at(MIRROR)) ? readText(NEW_MIRROR) : null;
  if (script && write(MIRROR, script, { mode: 0o755 })) {
    notes.push(`${MIRROR} is now a Node script that reads the manifest. Stage it with its executable bit, or git skips it on a teammate's machine: git add --chmod=+x ${MIRROR}. Steps the team added to the old one are in ${retiredMirror}.`);
  }

  // Last, because it is what the next run would recognise an unfinished move by.
  move(FIRST_LAYOUT, `${RETIRED}/${FIRST_LAYOUT}`);

  const stale = POINTERS.filter((rel) => OLD_NAMES.some((name) => (readText(at(rel)) ?? "").includes(name)));
  if (stale.length) {
    notes.push(`Still naming the old paths or the old skills (${OLD_NAMES.join(", ")}), and yours to edit by hand: ${stale.join(", ")}.${stale.includes("CLAUDE.md") ? " The \"Team workflow rules\" section teamwork-init added to CLAUDE.md can go." : ""}`);
  }
  notes.push(`Once this is committed, ${RETIRED}/ can be deleted.`);
  return notes.join(" ");
}

// ---- briefing ------------------------------------------------------------

/** The lane commands in one line; a lane that is not wired is named without its reason. */
function lanesLine(lanes) {
  const parts = Object.entries(lanes).map(([lane, command]) => (notWired(command) ? `${lane} not wired` : `${lane} \`${command}\``));
  return parts.length ? `This repo's lanes: ${parts.join("; ")}.` : "";
}

/** Rule files the manifest owns that are still on disk: the plugin delivers those rules itself now, so they load twice. */
function ownedRuleCopies(root, manifest) {
  return Object.keys(manifest.owned ?? {}).filter((rel) => /^\.agents\/rules\/[^/]+\.md$/.test(rel) && fs.existsSync(path.join(root, rel)));
}

/** One line when the CLI for this repo's forge is not on PATH, else "". */
function forgeLine(root, config) {
  try {
    const provider = detect(root, { remote: config.remote, kind: config.provider === "auto" ? undefined : config.provider });
    if (!provider.cli || cliPath(provider.cli)) return "";
    return `The ${provider.cli} CLI is not on PATH, so a ${provider.noun} cannot be opened or landed from here. Install it (${FORGES[provider.kind].install}) and sign in.`;
  } catch { return ""; }
}

/**
 * One line when the committed pre-commit mirror cannot run: git skips a hook
 * that is not executable, and says so only to whoever commits. A mirror not
 * yet committed is left to the note of the migration that wrote it.
 */
function mirrorLine(root, git) {
  try {
    const file = path.join(root, MIRROR);
    if (!fs.readFileSync(file, "utf8").includes("agentic-teamwork")) return "";
    const entry = git("ls-files", "-s", "--", MIRROR);
    if (!entry) return "";
    const off = entry.startsWith("100644") || (process.platform !== "win32" && !(fs.statSync(file).mode & 0o111));
    return off ? `${MIRROR} is not executable, so git skips it and commits made in a terminal go unchecked: chmod +x ${MIRROR} && git add --chmod=+x ${MIRROR}.` : "";
  } catch { return ""; }
}

function briefing(payload, state) {
  const root = state.root;
  if (!root || state.mode !== "full") return "";
  const config = loadConfig(root);
  const lines = [];
  if (!config.manifest) {
    lines.push(`This repo is not on the team conventions yet: no ${MANIFEST}. Before writing code, ask the person to run /agentic-teamwork:bootstrap, which works locally and pushes nothing.`);
  } else {
    const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    let branch = "";
    try { branch = git("symbolic-ref", "--short", "-q", "HEAD"); } catch { /* detached */ }
    let unborn = false;
    try { git("rev-parse", "--verify", "-q", "HEAD"); } catch { unborn = true; }
    const base = config.defaultBranch ?? "main";
    const version = config.manifest.standard_version;
    lines.push(`Team conventions${version ? ` v${version}` : ""}. Branch: ${branch || "a detached HEAD"}.`);
    const guarded = config.rules.blockCommitOnProtected || config.rules.blockPushToProtected;
    if (guarded && config.protectedBranches.includes(branch)) {
      const example = config.branchPrefixes[0] ? `${config.branchPrefixes[0]}<topic>` : "<type>/<topic>";
      if (unborn) lines.push(`The first commit lands on ${branch}; after it, branch before every change: git switch -c ${example}.`);
      else lines.push(`You are on ${branch}, which rejects commits and pushes. Branch first: git switch -c ${example}.`);
    } else {
      try {
        const behind = Number(git("rev-list", "--count", `HEAD..${config.remote}/${base}`));
        if (behind > 0) lines.push(`This branch is ${behind} commit(s) behind ${config.remote}/${base} as last fetched. Fetch and merge it before building on this branch.`);
      } catch { /* no remote ref yet */ }
    }
    const lanes = lanesLine(config.lanes);
    if (lanes) lines.push(lanes);
    const why = ownedRuleCopies(root, config.manifest).length
      ? "This repo still carries rule files the plugin now delivers at session start, so they load twice"
      : (lanes ? "" : "This repo's manifest names no lanes yet");
    if (why) lines.push(`${why}: ask the person to run /agentic-teamwork:init-project --upgrade on a branch, then commit what it changes.`);
    const mirror = mirrorLine(root, git);
    if (mirror) lines.push(mirror);
    if (config.unmoved) lines.push(`The git rules are still read from ${FIRST_LAYOUT}: add the contents of ${BLOCK_FILE} to ${MANIFEST} as its \`teamwork\` key.`);
  }
  const forge = forgeLine(root, config);
  if (forge) lines.push(forge);
  return lines.join(" ");
}

await run(briefing, { migrate });
