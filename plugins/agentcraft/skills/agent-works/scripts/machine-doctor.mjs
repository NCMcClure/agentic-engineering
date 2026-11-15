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
// Nothing here signs in, reads a credential or installs anything: a fix is a
// line for the person.
import path from "node:path";
import { emit, ioOf, parseArgs, repoRoot, runMain } from "../lib/common.mjs";
import { FORGES, checkCli, cliPath, detect } from "../lib/provider.mjs";

const USAGE = `usage: aw doctor --machine [--json]
       node machine-doctor.mjs [--json] [--root DIR]

Check what agent-works needs on this machine: Node 22 or newer, git, and the command line of the forge the
repository's remote is on (gh for GitHub, glab for GitLab). Exit 1 when a hard check (Node, git) fails.`;

/** The oldest Node the plugin runs on. */
export const NODE_MAJOR = 22;

const nodeOk = (version) => Number(String(version).split(".")[0]) >= NODE_MAJOR;

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
 * misconfigured, skipped. `run` is the process runner `detect` takes and `which` the program lookup (a test hands
 * both in).
 */
export function checks({ root = null, env = process.env, nodeVersion = process.versions.node, run, which = cliPath } = {}) {
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
