#!/usr/bin/env node
// PreToolUse on a shell command or an edit: the agent guard. It stops the
// mistakes agents make more than once, before the tool runs: staging the whole
// tree or the owner's own files, editing a generated file, starting something
// another agent holds the lock of, a run far larger than an iteration needs,
// and whatever the project wrote down as its own rules. The rules themselves
// are in lib/guard-rules.mjs; this file reads the payload, gathers the facts
// they ask for and prints the one decision.
//
// It acts only where `.agents/agent-works.json` is found at or above the
// payload's cwd; a linked work tree that has no copy of the file is judged by
// the main checkout's. Paths are always read against the work tree the tool
// runs in. Anywhere else it reads nothing but folder names and says nothing.
//
// A deny or an ask is a permission decision with its reason; a warning is
// context for the model (and, for a run let through on its reason, a line for
// the person). Every decision is appended as one JSON line to
// <store>/projects/<project id>/guard.log unless `guard.log` is false.
//
// Contract: read stdin once, catch everything, exit 0. A broken guard never
// stops work: bad stdin, no git, an unreadable config all end in silence.
//
//   node guard.mjs --explain '<command>' [--cwd DIR] [--tool Bash] [--file PATH] [--json]
//   node guard.mjs --explain <Tool> '<command, or the tool input as JSON>'
//
// says what would be decided, by which rule, and how the command was read.
// Explaining is never logged.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOLS = ["Bash", "PowerShell", "Edit", "Write", "MultiEdit", "NotebookEdit"];
const MARKER = [".agents", "agent-works.json"];
const INERT = "no .agents/agent-works.json at or above this folder: the guard is inert here";
const USAGE = "usage: guard.mjs --explain ['<command>'] [--cwd DIR] [--tool TOOL] [--file PATH] [--json]\n"
  + "       guard.mjs --explain <Tool> '<command, or the tool input as JSON>'\n";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

/**
 * The folder whose `.agents/agent-works.json` governs a tool call in `cwd`, or null where the guard is inert:
 * the nearest one at or above `cwd`, else the main checkout's when `cwd` is in a linked work tree.
 */
async function governing(cwd) {
  let top = null;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (isFile(path.join(dir, ...MARKER))) return dir;
    if (top === null && fs.existsSync(path.join(dir, ".git"))) top = dir;
    if (path.dirname(dir) === dir) break;
  }
  if (top === null || !isFile(path.join(top, ".git"))) return null;
  const { mainRoot } = await import("../lib/common.mjs");
  const main = mainRoot(top);
  return main !== null && main !== top && isFile(path.join(main, ...MARKER)) ? main : null;
}

/** A configured folder with `~`, `$VAR`, `${VAR}` and `%VAR%` filled in. */
function expandPath(p, env) {
  const filled = p.replace(/\$\{(\w+)\}|\$(\w+)|%(\w+)%/g, (whole, a, b, c) => env[a ?? b ?? c] ?? whole);
  return filled === "~" || /^~[\\/]/.test(filled) ? path.join(os.homedir(), filled.slice(1)) : filled;
}

/** The config that governs `cwd` and the facts the rules ask for, each read only when a rule asks. */
async function gather(cwd, from, env) {
  const [common, { loadConfig }] = await Promise.all([import("../lib/common.mjs"), import("../lib/config.mjs")]);
  const cfg = loadConfig(from);
  const here = common.realPath(cwd);
  const root = common.repoRoot(here) ?? common.projectRoot(here); // pathspecs and guard.ownerFiles are relative to the work tree's top
  let branch;
  const facts = {
    cwd: here,
    root,
    get branch() {
      branch ??= common.currentBranch(here) ?? "";
      return branch;
    },
    branchAt: (dir) => (isDir(dir) ? common.currentBranch(dir) : null),
    agent: common.agentName(cfg, env),
    items(dir) {
      const full = expandPath(dir, env);
      try {
        return fs.readdirSync(path.isAbsolute(full) ? full : path.join(root, full)).filter((n) => !n.startsWith(".")).sort();
      } catch {
        return null;
      }
    },
    groups: (file) => common.readJson(path.join(root, file), null),
    resolve: (file) => (path.isAbsolute(file) ? common.realPath(file) : file),
  };
  return { cfg, facts, common };
}

/** The rules' answer for one tool call. The lock store is opened only when the command starts a resource. */
async function judged(tool, input, cfg, facts, env) {
  const rules = await import("../lib/guard-rules.mjs");
  const command = isObject(input) ? input.command : null;
  if (rules.SHELL_TOOLS.includes(tool) && typeof command === "string" && rules.lockLevel(cfg)
    && isObject(cfg.resources) && Object.keys(cfg.resources).length
    && rules.locksNeeded(rules.readCommand(command, cfg, facts).units, cfg).length) {
    const { lockHolders } = await import("../scripts/locks.mjs");
    facts.lockHolders = (agent, names) => lockHolders(cfg, { cwd: facts.root, env }, agent, names);
  }
  return { rules, ...rules.judge(tool, input, cfg, facts) };
}

/** One object as a line of JSON: a space after each comma and colon, ASCII only. */
function line(doc) {
  const ascii = (text) => text.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return `{${Object.entries(doc).map(([k, v]) => `${ascii(JSON.stringify(k))}: ${ascii(JSON.stringify(v))}`).join(", ")}}\n`;
}

/**
 * The decision log: the answered decision, with the patterns skipped on the way. A call that goes ahead is logged
 * only to name a skipped pattern, and only when the end of the log does not name it already.
 */
function log({ cfg, facts, common }, env, tool, input, decision, skipped) {
  if (!((cfg.guard || {}).log ?? true) || (!decision && !skipped.length)) return;
  try {
    const file = path.join(common.projectHome(facts.root, env), "guard.log");
    const subject = input.command || input.file_path || input.notebook_path || "";
    const doc = {
      at: common.nowIso(), decision: decision?.kind ?? "allow", rule: decision?.rule ?? "pattern-skipped",
      agent: facts.agent, tool, subject: String(subject).slice(0, 600),
    };
    if (decision?.notice) doc.notice = decision.notice;
    if (skipped.length) doc.note = skipped.join("; ");
    if (!decision) {
      const said = line({ note: doc.note }).slice(1, -2);
      let tail = "";
      try { tail = fs.readFileSync(file, "utf8").slice(-8192); } catch { /* no log yet */ }
      if (tail.includes(said)) return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line(doc));
  } catch { /* the log is a convenience */ }
}

async function hook() {
  const payload = JSON.parse(fs.readFileSync(0, "utf8").replace(/^﻿/, ""));
  if (!isObject(payload) || !TOOLS.includes(payload.tool_name) || !isObject(payload.tool_input)) return;
  const cwd = typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const from = await governing(cwd);
  if (from === null) return;
  const got = await gather(cwd, from, process.env);
  const { rules, decisions, skipped } = await judged(payload.tool_name, payload.tool_input, got.cfg, got.facts, process.env);
  const decision = decisions[0] ?? null;
  log(got, process.env, payload.tool_name, payload.tool_input, decision, skipped);
  if (decision) process.stdout.write(JSON.stringify(rules.answer(decision)));
}

/** `--explain`: what would be decided for a command or an edit, and by which rule. Returns the exit code. */
async function explain(argv) {
  const { parseArgs } = await import("node:util");
  let args;
  try {
    args = parseArgs({
      args: argv, allowPositionals: true,
      options: { cwd: { type: "string" }, tool: { type: "string" }, file: { type: "string" }, json: { type: "boolean" } },
    });
  } catch (e) {
    process.stderr.write(`guard.mjs --explain: ${e.message}\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;
  let tool = values.tool ?? null;
  let subject = positionals[0] ?? "";
  if (positionals.length === 2 && TOOLS.includes(positionals[0])) [tool, subject] = positionals;
  else if (positionals.length > 1) {
    process.stderr.write(USAGE);
    return 2;
  }
  let input = values.file ? { file_path: values.file } : { command: subject };
  if (!values.file && /^\s*\{/.test(subject)) {
    try {
      const given = JSON.parse(subject);
      if (isObject(given)) input = given;
    } catch { /* a command that starts with a brace */ }
  }
  tool ??= input.command === undefined ? "Edit" : "Bash";
  const cwd = path.resolve(values.cwd ?? process.cwd());
  const doc = { tool, cwd, config: null, decision: "allow", rule: null, message: "", all: [] };
  const from = await governing(cwd);
  if (from === null) {
    doc.message = INERT;
  } else {
    const { cfg, facts } = await gather(cwd, from, process.env);
    doc.config = cfg._path ?? null;
    if (cfg._error) doc.message = `${cfg._error} (the built-in defaults apply)`;
    const { rules, decisions, skipped } = await judged(tool, input, cfg, facts, process.env);
    doc.all = decisions.map((d) => ({ decision: d.kind, rule: d.rule }));
    if (decisions.length) Object.assign(doc, { decision: decisions[0].kind, rule: decisions[0].rule, message: decisions[0].message });
    if (rules.SHELL_TOOLS.includes(tool) && typeof input.command === "string") doc.segments = rules.readCommand(input.command, cfg, facts).segments;
    if (skipped.length) doc.skipped = skipped;
  }
  if (values.json) {
    const { jsonText } = await import("../lib/common.mjs");
    process.stdout.write(`${jsonText(doc)}\n`);
    return 0;
  }
  const out = [`decision: ${doc.decision}${doc.rule ? `   rule: ${doc.rule}` : ""}`];
  if (doc.all.length > 1) out.push(`also:     ${doc.all.slice(1).map((d) => `${d.rule} (${d.decision})`).join(", ")}`);
  for (const segment of doc.segments ?? []) out.push(`segment:  ${segment.map((w) => `[${w}]`).join(" ")}`);
  for (const note of doc.skipped ?? []) out.push(`skipped:  ${note}`);
  if (doc.message) out.push("", doc.message);
  process.stdout.write(`${out.join("\n")}\n`);
  return 0;
}

if (process.argv[2] === "--explain") {
  process.exitCode = await explain(process.argv.slice(3));
} else {
  try { await hook(); } catch { /* fail open */ }
  process.exitCode = 0;
}
