#!/usr/bin/env node
// What agent-works needs on this machine, checked in one pass, so an agent can
// find a missing prerequisite on its own.
//
//   node machine-doctor.mjs            one line per check, with the fix; exit 1 when a hard one fails
//   node machine-doctor.mjs --json     the same report as JSON: { ok, checks }
//   node machine-doctor.mjs --root D   check for the repository at D (default: the work tree of the cwd)
//
// `aw doctor --machine` runs the same checks. `aw doctor` without the flag is
// a different thing: it checks the repository's agent files, not the machine.
//
// Each check is ok, missing, misconfigured, or skipped (it does not apply to
// this repository). Hard checks (Node, git) are what every command needs; the
// forge's command line is needed only where cards follow issues, so it warns.
// The last two warn as well, and matter to a machine coming from the separate
// plugins: the Claude Code build, and the switch that stops a stub's update
// from bringing agentic-engineering in (docs/known-limits.md, finding 7).
// Nothing here signs in, reads a credential or installs anything: a fix is a
// line for the person.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { emit, ioOf, parseArgs, repoRoot, runMain } from "../lib/common.mjs";
import { FORGES, checkCli, cliPath, detect } from "../../../lib/provider.mjs";

const USAGE = `usage: aw doctor --machine [--json]
       node machine-doctor.mjs [--json] [--root DIR]

Check what agent-works needs on this machine: Node 22 or newer, git, and the command line of the forge the
repository's remote is on (gh for GitHub, glab for GitLab). Then two things the move to one plugin leans on:
the Claude Code build (2.1.321 or newer) and CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC (not set). Exit 1 when a
hard check (Node, git) fails.`;

/** The oldest Node the plugin runs on. */
export const NODE_MAJOR = 22;

const nodeOk = (version) => Number(String(version).split(".")[0]) >= NODE_MAJOR;

// The first Claude Code build that installs a dependency a plugin update adds
// in the same step. The move to one plugin leans on that: each old plugin's
// name is now a stub that depends on agentic-engineering.
export const CLAUDE_CODE_FLOOR = "2.1.321";
const PLUGIN = "agentic-engineering@agentic-engineering";
// The switch that stops that install on any build.
const TRAFFIC = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";

/** Whether version `a` is older than `b`, part by part as numbers: 2.1.99 is older than 2.1.321. */
export const olderThan = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
  const at = x.findIndex((n, i) => n !== y[i]);
  return at !== -1 && x[at] < y[at];
};

/**
 * The build `claude --version` reports: `{ version }`, or `{ none }` saying why there is none to read. The
 * program is the one this session runs in when it names it, else the first on the PATH.
 */
export function claudeCodeVersion(env = process.env, which = cliPath) {
  const claude = env.CLAUDE_CODE_EXECPATH || which("claude", env);
  if (!claude) return { none: "no claude on the PATH, and no session naming its own" };
  const run = spawnSync(claude, ["--version"], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"], env });
  const version = /\b(\d+\.\d+\.\d+)\b/.exec(run.stdout ?? "")?.[1];
  return version ? { version } : { none: `${claude} --version printed no version` };
}

/**
 * The hard gaps a lookup can see, with no process started: cheap enough for a session-start hook. `which(name, env)`
 * finds a program (default: the PATH, then the usual install folders).
 */
export function hardGaps(env = process.env, { nodeVersion = process.versions.node, which = cliPath } = {}) {
  const gaps = [];
  if (!nodeOk(nodeVersion)) gaps.push(`Node ${nodeVersion} is older than ${NODE_MAJOR}`);
  if (!which("git", env)) gaps.push("git is not installed");
  return gaps;
}

/**
 * Every check for the repository at `root`: `[{ id, hard, status, detail, fix? }]`, `status` one of ok, missing,
 * misconfigured, skipped. `run` is the process runner `detect` takes, `which` the program lookup, and `claude`
 * what reads the Claude Code build (a test hands all three in).
 */
export function checks({ root = null, env = process.env, nodeVersion = process.versions.node, run, which = cliPath, claude = claudeCodeVersion } = {}) {
  const out = [];
  const add = (id, hard, status, detail, fix = null) => out.push({ id, hard, status, detail, ...(fix ? { fix } : {}) });

  if (nodeOk(nodeVersion)) add("node", true, "ok", `Node ${nodeVersion}`);
  else add("node", true, "misconfigured", `Node ${nodeVersion} is older than ${NODE_MAJOR}`, `install Node ${NODE_MAJOR} or newer from https://nodejs.org or with your version manager`);

  const git = which("git", env);
  if (git) add("git", true, "ok", git);
  else add("git", true, "missing", "git is not on the PATH", "install git from https://git-scm.com/downloads or your package manager");

  // The forge only means something once git can name the remote: a missing git is one finding, not two.
  if (!git) add("forge", false, "skipped", "needs git first");
  else if (!root) add("forge", false, "skipped", "not inside a repository");
  else {
    const provider = detect(root, { env, run });
    const forge = FORGES[provider.kind];
    if (!forge) {
      add("forge", false, "skipped", provider.host
        ? `the remote's host (${provider.host}) names no forge this plugin knows: cards stay local`
        : "no remote named origin: cards stay local");
    } else {
      const host = provider.host ?? forge.host;
      const cli = which === cliPath ? checkCli(provider, { env }) : { ok: Boolean(which(forge.cli, env)), value: { cli: forge.cli, path: which(forge.cli, env) } };
      if (cli.ok) add("forge", false, "ok", `${cli.value.cli} for ${host}: ${cli.value.path}`);
      else add("forge", false, "missing", `${forge.cli} is not on the PATH, and the remote is on ${host}`, `install it from ${forge.install} (the person signs in themselves)`);
    }
  }

  const build = claude(env, which);
  if (build.none) add("claude", false, "skipped", build.none);
  else if (!olderThan(build.version, CLAUDE_CODE_FLOOR)) add("claude", false, "ok", `Claude Code ${build.version}`);
  else add("claude", false, "misconfigured", `Claude Code ${build.version} is older than ${CLAUDE_CODE_FLOOR}: each old plugin's name is now a stub that depends on ${PLUGIN}, and only ${CLAUDE_CODE_FLOOR} or newer installs that in the same step as the stub's update; on an older build it arrives a session late, and the old plugin is off until it does`,
    `the person updates Claude Code (claude update in a terminal; the desktop app from its own menu), or installs the plugin by name: claude plugin install ${PLUGIN}`);

  const off = String(env[TRAFFIC] ?? "").trim().toLowerCase();
  if (!off || off === "0" || off === "false") add("deps", false, "ok", `${TRAFFIC} is not set: a stub's update can install ${PLUGIN}`);
  else add("deps", false, "misconfigured", `${TRAFFIC} is set: Claude Code installs no dependency while it is, so the update that turns an old plugin into its stub leaves the stub failing to load, with ${PLUGIN} not installed`,
    `the person runs the update once without the variable: claude plugin update <old plugin>@agentic-engineering`);
  return out;
}

/** The report as text: a summary line, then one line per check with its fix under it. */
export function render(report) {
  const counts = {};
  for (const c of report) counts[c.status] = (counts[c.status] ?? 0) + 1;
  const hard = report.filter((c) => c.hard && c.status !== "ok");
  const lines = [`machine: ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ")}; hard prerequisites ${hard.length ? `failing: ${hard.map((c) => c.id).join(", ")}` : "ok"}`];
  for (const c of report) {
    lines.push(`  ${c.status.padEnd(13)} ${c.id.padEnd(6)} ${c.detail}`);
    if (c.fix) lines.push(`  ${"".padEnd(20)} fix: ${c.fix}`);
  }
  return lines.join("\n");
}

/** True when no hard check fails. */
export const passes = (report) => report.every((c) => !c.hard || c.status === "ok");

export async function main(argv, io) {
  io = ioOf(io);
  const { values, help } = parseArgs(argv, { json: { type: "boolean" }, root: { type: "string" }, machine: { type: "boolean" } });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  const root = values.root ? path.resolve(io.cwd, values.root) : repoRoot(io.cwd);
  const report = checks({ root, env: io.env });
  emit(io, { ok: passes(report), checks: report }, values.json === true, values.json ? null : render(report));
  return passes(report) ? 0 : 1;
}

runMain(import.meta.url, main, "machine-doctor");
