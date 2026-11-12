#!/usr/bin/env node
// The one session hook this repo tracks, in .claude/settings.json. The team's
// working rules arrive through the agentic-teamwork plugin, and a person whose
// Claude Code does not run it has no plugin hook to tell them so. The repo
// asks instead: one SessionStart line offering the plugin, or nothing when it
// is on, or when the person already said no in this clone
// (`git config --local agentic-engineering.plugins "off ..."`).
//
// It reads the person's settings ($CLAUDE_CONFIG_DIR or ~/.claude) and their
// installed-plugin records, then this repo's .claude/settings.json and
// settings.local.json, each later file winning. Node stdlib, no network. It
// fails open and always exits 0: a broken check never blocks a session.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKETPLACE = "agentic-engineering";
const SOURCE = "NCMcClure/agentic-engineering";
const PLUGIN = `agentic-teamwork@${MARKETPLACE}`;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const git = (root, ...args) => { try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

function payload() {
  if (process.stdin.isTTY) return {};
  try { return JSON.parse(fs.readFileSync(0, "utf8") || "{}") ?? {}; } catch { return {}; }
}

/** "missing" when the plugin is not installed, "off" when it is installed and not enabled, null when it runs. */
function gap(root, env) {
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
  const enabled = Object.assign({}, ...[
    path.join(claudeDir, "settings.json"),
    path.join(root, ".claude", "settings.json"),
    path.join(root, ".claude", "settings.local.json"),
  ].map((f) => readJson(f)?.enabledPlugins ?? {}));
  if (enabled[PLUGIN] === true) return null;
  const records = readJson(path.join(env.CLAUDE_CODE_PLUGIN_CACHE_DIR || path.join(claudeDir, "plugins"), "installed_plugins.json"))?.plugins ?? {};
  return (records[PLUGIN] ?? []).length > 0 ? "off" : "missing";
}

function offer(state, who, date) {
  const fix = state === "off"
    ? `It is installed and turned off: after they approve the edit, set "${PLUGIN}" to true under enabledPlugins where it is false (their ~/.claude/settings.json, or this repo's .claude/settings.local.json).`
    : `It is not installed: they type /plugin marketplace add ${SOURCE} and then /plugin install ${PLUGIN} themselves, and start a new session.`;
  return "This repo follows team conventions that the agentic-teamwork plugin brings into every session (the git rules, the test lanes, how a change lands), and this person's Claude Code does not run it. "
    + `Tell the person once, before other work, and offer to set it up. On yes: ${fix} `
    + `On no: run git config --local ${MARKETPLACE}.plugins "off ${who} ${date}" and do not raise it again.`;
}

function main() {
  const input = payload();
  const env = process.env;
  // A cloud session loads no marketplace plugins, so there is nothing to offer.
  if (env.CLAUDE_CODE_REMOTE === "true") return;
  const start = input.cwd || env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = git(start, "rev-parse", "--show-toplevel") || start;
  if (git(root, "config", "--local", `${MARKETPLACE}.plugins`).split(/\s+/)[0] === "off") return;
  const state = gap(root, env);
  if (!state) return;
  const who = git(root, "config", "user.name") || "<their name>";
  const additionalContext = offer(state, who, new Date().toISOString().slice(0, 16) + "Z");
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }) + "\n");
}

try { main(); } catch { /* fail open */ }
process.exitCode = 0;
