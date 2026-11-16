#!/usr/bin/env node
// aw who, aw agent: who is running on this machine, across projects, with the
// locks and leases they hold. The registry is <store>/agents.jsonl, one JSON
// object per line: { id, name, project, root, worktree, pid, session, started,
// beat }. An entry whose process is gone is dropped by whoever reads next.
import path from "node:path";
import { AwError, emit, intArg, ioOf, parseArgs, posix, readText, repoRoot, runMain, splitLines } from "../../lib/common.mjs";
import * as locks from "../locks.mjs";
import * as leases from "./leases.mjs";
import * as store from "./store.mjs";

const USAGE = `usage: aw who [--json]
       aw agent <start|beat|stop> [--name N] [--pid P] [--session ID] [--json]

Who is running on this machine: agents across projects, with the locks and leases they hold.

  aw who [--json]                         running agents by project, with their locks and leases
  aw agent start [--name N] [--pid P] [--session ID]     register (the session hook does this)
  aw agent beat  [--name N] [--pid P]     say "still here" (registers when not yet known)
  aw agent stop  [--name N] [--pid P]     leave

An agent is its name (--name, else the agent variable, else session-<pid>) in a project, living in a process:
the session's (--pid, else AW_SESSION_PID, else CLAUDE_PID while that process runs, else the nearest ancestor that is
not a shell). An entry whose process is gone is dropped by whoever reads next; an entry without a process id is
dropped after coordination.agentStaleMinutes (120) without a beat. Holders of locks and leases that never registered
are listed too, marked as such.

Options:
  --name N        the agent's name (default: the agent variable, else session-<pid>)
  --pid P         the process the agent lives in (default: the session's)
  --session ID    the session's id, when the caller knows it
  --json          print one JSON document`;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The file the registry lives in. */
export const agentsPath = (home) => path.join(home, "agents.jsonl");

function parse(text) {
  const rows = [];
  for (const line of splitLines(text ?? "")) {
    try {
      const doc = JSON.parse(line);
      if (isObject(doc) && doc.name) rows.push(doc);
    } catch { /* not an entry */ }
  }
  return rows;
}

const gone = (entry, staleMinutes) => (entry.pid ? !store.pidAlive(entry.pid) : store.ageSeconds(entry.beat) > staleMinutes * 60);

function rewrite(home, change, staleMinutes) {
  const file = agentsPath(home);
  return store.withFileLock(file, () => {
    const rows = parse(readText(file)).filter((r) => !gone(r, staleMinutes));
    const result = change(rows);
    store.write(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
    return result;
  });
}

/** The agents running now. With `prune`, entries whose process is gone are dropped from the store too. */
export function live(home, cfg = null, { prune = true } = {}) {
  const stale = store.setting(cfg, "agentStaleMinutes");
  const rows = parse(readText(agentsPath(home)));
  const alive = rows.filter((r) => !gone(r, stale));
  if (prune && alive.length !== rows.length) {
    try { rewrite(home, () => null, stale); } catch { /* the next reader tidies it */ }
  }
  return alive;
}

function findEntry(rows, name, project, pid) {
  const mine = rows.filter((r) => r.name === name && r.project === project);
  const exact = mine.filter((r) => pid !== null && r.pid === pid);
  return exact[0] ?? (mine.length === 1 && pid === null ? mine[0] : null);
}

/**
 * Register the agent of `ctx` (a `store.context`) as running, or note that it still is: the session hook calls this
 * once per session, `aw agent beat` later. `pid` is the process the agent lives in (default: the session's),
 * `session` the session's id, `worktree` the checkout it works in (default: the one `ctx.cwd` is in). Gives the entry.
 */
export function start(ctx, { pid = null, session = null, worktree = null } = {}) {
  const livesIn = pid ? Math.trunc(Number(pid)) : store.sessionPid(ctx.env);
  const name = ctx.agent;
  const stamp = store.now();
  const tree = worktree || posix(repoRoot(ctx.cwd) ?? ctx.root);
  ctx.stamp();
  return rewrite(ctx.home, (rows) => {
    let entry = findEntry(rows, name, ctx.project, livesIn);
    if (entry === null) {
      entry = { id: `${name}@${ctx.project}#${livesIn}`, name, project: ctx.project, root: posix(ctx.root), worktree: tree, pid: livesIn, session, started: stamp, beat: stamp };
      rows.push(entry);
    } else {
      Object.assign(entry, { beat: stamp, worktree: tree }, session ? { session } : {});
    }
    return entry;
  }, store.setting(ctx.cfg, "agentStaleMinutes"));
}

/** Take the agent of `ctx` out of the registry. True when it was registered. */
export function stop(ctx, { pid = null } = {}) {
  const name = ctx.agent;
  const livesIn = pid ? Math.trunc(Number(pid)) : null;
  return Boolean(rewrite(ctx.home, (rows) => {
    const entry = findEntry(rows, name, ctx.project, livesIn) ?? findEntry(rows, name, ctx.project, livesIn ?? store.sessionPid(ctx.env));
    if (entry === null) return false;
    rows.splice(rows.indexOf(entry), 1);
    return true;
  }, store.setting(ctx.cfg, "agentStaleMinutes")));
}

/**
 * The machine's picture: `{ at, agents, locks, leases, projects }`. Each agent carries the `locks` and `leases` it
 * holds; holders that never registered are added with `registered: false`.
 */
export function overview(home, cfg = null) {
  const known = store.projects(home);
  const rows = live(home, cfg).map((r) => ({ ...r, registered: true, locks: [], leases: [] }));
  const owner = (agent, project) => {
    let entry = rows.find((r) => r.name === agent && r.project === project);
    if (!entry) {
      entry = { id: `${agent}@${project}`, name: agent, project, registered: false, locks: [], leases: [] };
      rows.push(entry);
    }
    return entry;
  };
  const held = locks.allLocks(home).filter((r) => r.held);
  const leased = leases.live(home);
  for (const lk of held) owner(lk.agent ?? null, lk.project ?? null).locks.push(lk);
  for (const ls of leased) owner(ls.agent ?? null, ls.project ?? null).leases.push(ls);
  const ids = [...new Set(rows.filter((r) => r.project).map((r) => String(r.project)))].sort();
  return {
    at: store.now(), agents: rows, locks: held, leases: leased,
    projects: Object.fromEntries(ids.map((p) => [p, { name: store.projectLabel(p, known), root: known[p]?.root ?? null }])),
  };
}

function textOf(doc) {
  if (!doc.agents.length) return "nobody: no agent registered, no lock or lease held";
  const lines = [];
  const groups = Object.entries(doc.projects).sort(([, a], [, b]) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0));
  for (const [project, info] of [...groups, [null, { name: "?", root: null }]]) {
    const mine = doc.agents.filter((r) => (project === null ? !r.project : String(r.project) === project));
    if (!mine.length) continue;
    lines.push(`${info.name}${info.root ? `  (${info.root})` : ""}`);
    for (const r of mine.sort((a, b) => (String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0))) {
      if (r.registered) {
        lines.push(`  ${r.name}  pid ${r.pid || "?"}, up ${store.ago(store.ageSeconds(r.started))}, last beat ${store.ago(store.ageSeconds(r.beat))} ago`
          + (r.worktree && r.worktree !== info.root ? `, in ${r.worktree}` : ""));
      } else {
        lines.push(`  ${r.name}  (not registered: seen only through what it holds)`);
      }
      for (const lk of r.locks) {
        lines.push(`      lock  ${lk.resource} [${lk.scope === store.MACHINE ? "machine" : "project"}] for ${store.g(lk.heldMinutes ?? 0)} min: "${lk.for || "?"}"`);
      }
      for (const ls of r.leases) lines.push(`      lease ${leases.describe(ls, null, { withWho: false })}`);
    }
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------------- commands

async function who(argv, io) {
  const { values, positionals } = parseArgs(argv, { json: { type: "boolean" } });
  if (positionals.length) throw new AwError(`who: unexpected '${positionals[0]}'`);
  const ctx = store.context(io);
  const doc = overview(ctx.home, ctx.cfg);
  store.say(io, doc, values.json, textOf(doc));
  return 0;
}

async function agent(argv, io) {
  const { values, positionals } = parseArgs(argv, { name: { type: "string" }, pid: { type: "string" }, session: { type: "string" }, json: { type: "boolean" } });
  const [action] = positionals;
  if (positionals.length !== 1 || !["start", "beat", "stop"].includes(action)) throw new AwError("agent: one of start, beat, stop");
  const pid = intArg(values.pid, "--pid");
  const ctx = store.context(io, values.name ?? null);
  if (action !== "stop") {
    const entry = start(ctx, { pid, session: values.session ?? null });
    store.say(io, entry, values.json, `${entry.name}: ${entry.started === entry.beat ? "registered" : "still here"} in ${ctx.name} (pid ${entry.pid})`);
    return 0;
  }
  const left = stop(ctx, { pid });
  store.say(io, { stopped: left, name: ctx.agent, project: ctx.project }, values.json, `${ctx.agent}: ${left ? "left" : "was not registered"}`);
  return 0;
}

/** `aw who` and, called as `agent`, `aw agent <start|beat|stop>`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  if (argv.includes("--help") || argv.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  return io.command === "agent" ? agent(argv, io) : who(argv, io);
}

runMain(import.meta.url, main, "aw who");
