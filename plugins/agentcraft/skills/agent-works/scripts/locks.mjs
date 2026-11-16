// Exclusive locks on scarce resources, across agents, worktrees and projects:
// one holder at a time, a fair queue. `lock.mjs` is the command; this is what
// it, the guard hook, `aw who`, `aw sys` and `aw status` share.
//
// On disk, under <store>/locks/<scope>/ (scope: "machine" or a project id):
//
//   <resource>.lock      one JSON object: resource, scope, agent, project, for,
//                        pid, since, refreshed, run, and where they apply
//                        maxMinutes and processes. Created exclusively, so of
//                        two takers exactly one makes it; refreshed by
//                        replacing it whole.
//   <resource>.queue/    one ticket per waiter, named after it (`agent`, or
//                        `agent@project` in the machine scope). Its text is
//                        when the waiter first asked, in seconds since 1970
//                        (its place); its mtime is its last poll.
//
// A waiter is live for 45 s after a poll and keeps its place for 10 minutes.
// Only the earliest live waiter tries the lock, so the queue is first come,
// first served. A lock is stale when nobody refreshed it for
// coordination.lockStaleMinutes, or when it belongs to a `run` whose process is
// gone; a stale lock is taken over unless one of the resource's processes
// still runs, and the take-over leaves a note.
//
// Every function takes the store's folder or an `env`: nothing here reads the
// process's own, and nothing but `waitFor` waits.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { awHome, exclusiveCreate, projectId, readJson } from "../lib/common.mjs";
import { CONFIG } from "../lib/config.mjs";
import * as store from "./coord/store.mjs";

/** Resources that lock machine-wide whatever a config says. */
export const BUILTIN_MACHINE = Object.freeze(["gpu", "gpu-exclusive"]);
export const LIVE_S = 45; // a waiter that polled within this is in line
export const KEEP_S = 600; // a waiter that stopped polling keeps its place this long
export const POLL_S = 5;
export const DEFAULT_MAX_MINUTES = 30;
/** Exit code "still queued": not 1, which is most often a wrapped command's own. */
export const QUEUED = 3;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const namesIn = (dir) => {
  try { return fs.readdirSync(dir); } catch { return []; }
};
const unlink = (file) => {
  try { fs.unlinkSync(file); } catch { /* gone already */ }
};

// ------------------------------------------------------------------------------------------- resources and scopes

/** The config's entry for a resource; `{}` when it declares none. */
export function specOf(resource, cfg) {
  const spec = cfg?.resources?.[resource];
  return isObject(spec) ? spec : {};
}

/** Whether the config (or the built-in list) knows the resource. */
export const declared = (resource, cfg) => BUILTIN_MACHINE.includes(resource) || Object.hasOwn(cfg?.resources ?? {}, resource);

/** Whether every project on the machine contends for the one lock. */
export const isMachine = (resource, cfg) => BUILTIN_MACHINE.includes(resource) || specOf(resource, cfg).scope === store.MACHINE;

/** "machine", or the id of the project the resource is locked under (`project`, else the one `start` is in). */
export function scopeOf(resource, cfg, start = null, project = null) {
  return isMachine(resource, cfg) ? store.MACHINE : project ?? projectId(start);
}

/** The folder of a scope's locks. */
export const scopeDir = (home, scope) => path.join(store.locksRoot(home), scope);

/**
 * Who is asking: `{ agent, project, scope, key, home }`. In the machine scope two projects may each have an agent of
 * the same name, so there the project is part of who it is (`key`).
 */
export function me(home, agent, project, scope) {
  return { home, agent, project, scope, key: scope === store.MACHINE ? `${agent}@${project}` : agent };
}

const keyOf = (doc, scope) => (scope === store.MACHINE && doc.project ? `${doc.agent}@${doc.project}` : String(doc.agent));
const mine = (doc, who) => Boolean(doc) && keyOf(doc, who.scope) === who.key;

/** A holder for people: `agent`, with its project's name in the machine scope. */
export function label(doc, scope, home) {
  if (scope === store.MACHINE && doc.project) return `${doc.agent} (${store.projectLabel(doc.project, store.projects(home))})`;
  return String(doc.agent);
}

// ------------------------------------------------------------------------------------------------- the lock file

/**
 * The lock's record, or null when the resource is free. Earlier field names are read as aliases: `holder` for
 * `agent`, `what` for `for`. A file caught between its creation and its first write, or damaged, is held all the
 * same (by `?`).
 */
export function readLock(dir, resource) {
  const file = path.join(dir, `${resource}.lock`);
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = readJson(file, null);
    if (isObject(doc)) {
      if (!doc.agent && doc.holder) doc.agent = doc.holder;
      if ((doc.for === undefined || doc.for === null) && doc.what !== undefined && doc.what !== null) doc.for = doc.what;
      if (doc.agent) return { resource, ...doc };
    }
    if (!fs.existsSync(file)) return null;
    store.pause(10); // caught while its holder replaced it: look again
  }
  let stamp;
  try { stamp = store.isoAt(fs.statSync(file).mtimeMs / 1000); } catch { return null; }
  return { resource, agent: "?", for: "", since: stamp, refreshed: stamp };
}

function refreshLock(dir, resource, doc, why = null) {
  const next = { ...doc, refreshed: store.now(), ...(why ? { for: why } : {}) };
  store.write(path.join(dir, `${resource}.lock`), JSON.stringify(next));
  return next;
}

/** Stale: not refreshed for `staleMinutes`, or the lock of a `run` whose own process is gone (nobody is left to release it). */
export function isStale(doc, staleMinutes) {
  if (store.ageSeconds(doc.refreshed) > staleMinutes * 60) return true;
  return Boolean(doc.run) && doc.pid !== null && doc.pid !== undefined && !store.pidAlive(doc.pid);
}

// ------------------------------------------------------------------------------------------------------ the queue

const queueDir = (dir, resource) => path.join(dir, `${resource}.queue`);

function takeTicket(dir, resource, key) {
  const file = path.join(queueDir(dir, resource), key);
  try {
    if (exclusiveCreate(file, String(Date.now() / 1000))) return;
    const at = new Date();
    fs.utimesSync(file, at, at);
  } catch { /* Windows: a ticket of this name is being deleted this instant; the next poll takes a new one */ }
}

/** Leave a resource's queue. True when there was a place to give up. */
export function dropTicket(dir, resource, key) {
  try {
    fs.unlinkSync(path.join(queueDir(dir, resource), key));
    return true;
  } catch {
    return false;
  }
}

/**
 * The waiters, first asked first: `[{ agent, asked, live, idleSeconds }]`. Tickets nobody polled for `keepS` seconds
 * are thrown away.
 */
export function queue(dir, resource, liveS = LIVE_S, keepS = KEEP_S) {
  const rows = [];
  for (const name of namesIn(queueDir(dir, resource))) {
    const file = path.join(queueDir(dir, resource), name);
    try {
      const mtime = fs.statSync(file).mtimeMs / 1000;
      const idle = Date.now() / 1000 - mtime;
      if (idle > keepS) {
        fs.unlinkSync(file);
        continue;
      }
      const asked = Number(fs.readFileSync(file, "utf8").trim() || NaN);
      rows.push({ agent: name, asked: Number.isFinite(asked) ? asked : mtime, live: idle <= liveS, idleSeconds: Math.round(idle * 10) / 10 });
    } catch { /* taken away between the listing and the look */ }
  }
  return rows.sort((a, b) => a.asked - b.asked || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0));
}

// -------------------------------------------------------------------------------------------------------- acquire

function note(who, text) {
  try {
    if (who.scope === store.MACHINE) store.appendNote(who.home, null, `${who.agent}@${store.projectLabel(who.project, store.projects(who.home))}`, text);
    else store.appendNote(who.home, who.project, who.agent, text);
  } catch { /* a note is a courtesy: never the reason a lock is not taken */ }
}

/**
 * One attempt on the lock file. `[true, note]` when the agent holds it now, else `[false, who is in the way]`.
 * `processes` are name prefixes of the resource's application; `extra` goes into the record (pid, run, maxMinutes).
 */
export function tryAcquire(dir, resource, who, why, { processes = [], staleMinutes = store.SETTINGS.lockStaleMinutes, despiteRunning = false, extra = {} } = {}) {
  const file = path.join(dir, `${resource}.lock`);
  const { scope, home } = who;
  const cur = readLock(dir, resource);
  if (cur && mine(cur, who)) {
    refreshLock(dir, resource, { ...cur, ...extra }, why);
    return [true, "refreshed"];
  }
  let tookOver = null;
  if (cur) {
    const stale = isStale(cur, staleMinutes);
    const procs = stale ? store.running([...new Set([...processes, ...(Array.isArray(cur.processes) ? cur.processes : [])])].sort()) : [];
    if (!stale || procs.length) {
      const idle = store.ageSeconds(cur.refreshed);
      const more = stale ? `; not refreshed for ${Math.trunc(idle / 60)} min but ${procs.join(", ")} is running` : "";
      return [false, `${label(cur, scope, home)} (for: ${cur.for || "?"}; since ${cur.since}${more})`];
    }
    // Take a stale lock over. The rename is the arbiter: of several takers only one moves the file away.
    const moved = `${file}.stale-${process.pid}-${process.hrtime.bigint()}`;
    try { fs.renameSync(file, moved); } catch { return [false, "a stale lock that another agent is taking over"]; }
    const was = readJson(moved, null);
    if (isObject(was) && was.refreshed !== cur.refreshed) {
      // Its holder refreshed it between our look and our move: give it back.
      exclusiveCreate(file, JSON.stringify(was));
      unlink(moved);
      return [false, `${was.agent || was.holder} (just refreshed)`];
    }
    unlink(moved);
    tookOver = cur;
  } else {
    const procs = store.running(processes);
    if (procs.length && !despiteRunning) {
      return [false, `nobody: ${procs.join(", ")} runs without a lock (the owner's own instance, or a leftover) and must exit first; --despite-running takes the lock anyway`];
    }
  }
  const stamp = store.now();
  const doc = {
    resource, scope, agent: who.agent, project: who.project, for: why, pid: process.pid, since: stamp, refreshed: stamp,
    ...(processes.length ? { processes } : {}), ...extra,
  };
  // Atomic: of two creators exactly one succeeds.
  if (!exclusiveCreate(file, JSON.stringify(doc))) {
    const other = readLock(dir, resource);
    return [false, other ? `${label(other, scope, home)} (for: ${other.for || "?"})` : "another agent, a moment ago"];
  }
  if (tookOver) {
    const whyStale = store.ageSeconds(tookOver.refreshed) > staleMinutes * 60 ? `not refreshed since ${tookOver.refreshed}` : "its run is gone";
    note(who, `took over ${resource} from ${label(tookOver, scope, home)}: ${whyStale} and no process of it running (was for: ${tookOver.for || "?"})`);
    return [true, `taken over from ${label(tookOver, scope, home)} (stale)`];
  }
  return [true, ""];
}

/**
 * Queue and poll until the lock is ours or `wait` seconds are over. Resolves to `[true, note]` or
 * `[false, what is in the way]`; the place in the queue is kept when the wait runs out. `onWait(line)` is called once
 * per change of holder or of place, not once per poll.
 */
export async function waitFor(dir, resource, who, why, {
  wait = 0, poll = POLL_S, live = LIVE_S, keep = KEEP_S, processes = [], staleMinutes = store.SETTINGS.lockStaleMinutes,
  despiteRunning = false, extra = {}, onWait = null,
} = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + Math.max(0, wait) * 1000;
  const options = { processes, staleMinutes, extra };
  let said = null;
  for (;;) {
    const cur = readLock(dir, resource);
    let ahead = [];
    let got;
    let text;
    if (cur && mine(cur, who)) { // the holder refreshing: no queue
      [got, text] = tryAcquire(dir, resource, who, why, { ...options, despiteRunning: true });
    } else {
      takeTicket(dir, resource, who.key);
      const inLine = queue(dir, resource, live, keep).filter((r) => r.live).map((r) => r.agent);
      ahead = inLine.includes(who.key) ? inLine.slice(0, inLine.indexOf(who.key)) : [];
      if (ahead.length) { // first come, first served: only the head of the line tries the lock
        [got, text] = [false, `${cur ? label(cur, who.scope, who.home) : "nobody"}; in the queue behind ${ahead.join(", ")}`];
      } else {
        [got, text] = tryAcquire(dir, resource, who, why, { ...options, despiteRunning });
      }
    }
    if (got) {
      dropTicket(dir, resource, who.key);
      return [true, text];
    }
    const left = deadline - Date.now();
    if (left <= 0) return [false, text];
    const seen = `${text.split(/[ :;(]/)[0]}\n${ahead.join(",")}`;
    if (seen !== said && onWait) onWait(`${resource}: waiting; held by ${text}`);
    said = seen;
    await sleep(Math.min(Math.max(poll, 0.05) * 1000, left));
  }
}

/** Give a lock back when `who` still holds it. True when it was theirs and is gone now. */
export function release(dir, resource, who) {
  if (!mine(readLock(dir, resource), who)) return false;
  unlink(path.join(dir, `${resource}.lock`));
  return true;
}

/** Refresh a lock when `who` holds it (a `run` does this once a minute). True when it was refreshed. */
export function keep(dir, resource, who) {
  const cur = readLock(dir, resource);
  if (!mine(cur, who)) return false;
  refreshLock(dir, resource, cur);
  return true;
}

/** What to say when `resource` is asked for while holding one that "lockOrder" puts after it; null when the order holds. */
export function orderWarning(resource, held, order) {
  if (!order.includes(resource)) return null;
  const late = held.filter((h) => order.includes(h) && order.indexOf(h) > order.indexOf(resource));
  if (!late.length) return null;
  return `lock order: ${resource} comes before ${late.join(", ")} (lockOrder: ${order.join(" -> ")}) and you hold `
    + `${late.join(", ")} already. Two agents taking them in different orders wait on each other forever: `
    + `release ${late.join(", ")} and take them in order.`;
}

/** The warnings of asking for a resource: one the config does not declare, one taken out of "lockOrder". */
export function askingWarnings(resource, cfg, who) {
  const out = [];
  if (!declared(resource, cfg)) {
    out.push(`'${resource}' is not declared under "resources" in ${CONFIG}: locked for this project only, ad hoc. `
      + 'Declare it (with "scope": "machine" if other projects share it).');
  }
  const order = (Array.isArray(cfg?.lockOrder) ? cfg.lockOrder : []).map(String);
  const warning = orderWarning(resource, heldBy(who.home, who.agent, who.project), order);
  if (warning) out.push(warning);
  return out;
}

// ------------------------------------------------------------- what the guard, the session hook and status ask

const startOf = (at) => at?.cwd ?? at?.root ?? null;
const homeAt = (at) => at?.home ?? awHome(at?.env ?? process.env);

/** The lock record of a resource as the project at `at.cwd` sees it (with its `scope`), or null when it is free. `at` is `{ cwd, env }`. */
export function holder(resource, cfg, at = {}) {
  const scope = scopeOf(resource, cfg, startOf(at));
  const doc = readLock(scopeDir(homeAt(at), scope), resource);
  return doc ? { ...doc, scope } : null;
}

/** Whether this agent of the project at `at.cwd` holds the resource right now. `at` is `{ cwd, env }`. */
export function holds(agent, resource, cfg, at = {}) {
  if (!agent) return false;
  const project = projectId(startOf(at));
  const scope = scopeOf(resource, cfg, null, project);
  return mine(readLock(scopeDir(homeAt(at), scope), resource), me(homeAt(at), agent, project, scope));
}

/** Refresh the lock when this agent holds it (the guard does so when it lets a holder's command through). True when refreshed. */
export function refresh(agent, resource, cfg, at = {}) {
  if (!agent) return false;
  const project = projectId(startOf(at));
  const scope = scopeOf(resource, cfg, null, project);
  try {
    return keep(scopeDir(homeAt(at), scope), resource, me(homeAt(at), agent, project, scope));
  } catch {
    return false;
  }
}

/**
 * For the guard: `{ holders, mine }` over `names` (default: every resource the config declares). `holders` maps a
 * held resource to its agent's name (a free one is absent); `mine` is the Set of those `agent` holds, each refreshed
 * on the way, since a holder at work keeps its lock fresh. Never throws. `at` is `{ cwd, env }`.
 */
export function lockHolders(cfg, at = {}, agent = null, names = null) {
  const holders = {};
  const own = new Set();
  for (const name of names ?? Object.keys(cfg?.resources ?? {})) {
    try {
      const held = holder(name, cfg, at);
      if (!held?.agent) continue;
      holders[name] = String(held.agent);
      if (holds(agent, name, cfg, at)) {
        own.add(name);
        refresh(agent, name, cfg, at);
      }
    } catch { /* an unreadable store holds nobody back */ }
  }
  return { holders, mine: own };
}

/** The resources this agent of this project holds, in either scope, sorted. */
export function heldBy(home, agent, project) {
  const out = [];
  for (const scope of [store.MACHINE, project]) {
    const dir = scopeDir(home, scope);
    for (const file of namesIn(dir).filter((n) => n.endsWith(".lock"))) {
      const name = file.slice(0, -".lock".length);
      if (mine(readLock(dir, name), me(home, agent, project, scope))) out.push(name);
    }
  }
  return out.sort();
}

/**
 * Every lock on this machine, in every scope, without probing any process: rows of `{ resource, scope, held,
 * waiting }` and, when held, `agent, project, since, refreshed, pid, heldMinutes, for`. With `withQueues`, resources
 * that only have waiters are listed too.
 */
export function allLocks(home, { withQueues = false } = {}) {
  const rows = [];
  for (const scope of namesIn(store.locksRoot(home)).sort()) {
    const dir = scopeDir(home, scope);
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
    const names = new Set();
    for (const file of namesIn(dir)) {
      if (file.endsWith(".lock")) names.add(file.slice(0, -".lock".length));
      else if (withQueues && file.endsWith(".queue")) names.add(file.slice(0, -".queue".length));
    }
    for (const name of [...names].sort()) {
      const cur = readLock(dir, name);
      const waiting = withQueues ? queue(dir, name) : [];
      if (!cur && !waiting.length) continue;
      const row = { resource: name, scope, held: Boolean(cur), waiting };
      if (cur) {
        Object.assign(row, {
          agent: cur.agent ?? null, project: cur.project || (scope === store.MACHINE ? null : scope), since: cur.since ?? null,
          refreshed: cur.refreshed ?? null, pid: cur.pid ?? null, heldMinutes: Math.round(store.ageSeconds(cur.since) / 6) / 10,
          for: cur.for ?? null,
        });
      }
      rows.push(row);
    }
  }
  return rows;
}

/**
 * What `aw lock status` shows: the resources the project of `ctx` can see (its own and the machine's; `everything`:
 * every project's too), each with who holds it, how long against its maximum, what of its application runs, and
 * who waits.
 */
export function statusRows(ctx, only = null, everything = false) {
  const { cfg, home, project } = ctx;
  const staleMinutes = store.setting(cfg, "lockStaleMinutes");
  const wanted = [];
  const has = (scope, name) => wanted.some((p) => p[0] === scope && p[1] === name);
  for (const name of [...Object.keys(cfg.resources ?? {}), ...BUILTIN_MACHINE]) {
    const scope = scopeOf(name, cfg, null, project);
    if (!has(scope, name)) wanted.push([scope, name]);
  }
  const found = allLocks(home, { withQueues: true })
    .filter((r) => everything || r.scope === store.MACHINE || r.scope === project)
    .map((r) => [r.scope, r.resource])
    .filter(([scope, name]) => !has(scope, name))
    .sort((a, b) => (a.join("\n") < b.join("\n") ? -1 : 1));
  wanted.push(...found);
  let pairs = wanted;
  if (only) {
    pairs = wanted.filter((p) => p[1] === only);
    if (!pairs.length) pairs = [[scopeOf(only, cfg, null, project), only]];
  }
  let names = null; // the process list, asked for only when a resource names processes
  return pairs.map(([scope, name]) => {
    const dir = scopeDir(home, scope);
    const cur = readLock(dir, name);
    const spec = scope === store.MACHINE || scope === project ? specOf(name, cfg) : {};
    const prefixes = [...(spec.processes ?? []), ...(cur?.processes ?? [])].map((p) => String(p).toLowerCase());
    if (prefixes.length) names ??= [...new Set([...store.processTable().values()].map(([, n]) => n))].sort();
    const row = {
      resource: name, scope, held: Boolean(cur),
      running: prefixes.length ? names.filter((n) => prefixes.some((p) => n.toLowerCase().startsWith(p))) : [],
      waiting: queue(dir, name),
    };
    if (cur) {
      const heldMin = store.ageSeconds(cur.since) / 60;
      const maxMin = Number(cur.maxMinutes || spec.maxMinutes || DEFAULT_MAX_MINUTES);
      Object.assign(row, {
        agent: cur.agent ?? null, project: cur.project ?? null, since: cur.since ?? null, refreshed: cur.refreshed ?? null,
        heldMinutes: Math.round(heldMin * 10) / 10, maxMinutes: maxMin, overdue: heldMin > maxMin, stale: isStale(cur, staleMinutes),
        for: cur.for ?? null,
      });
    }
    return row;
  });
}
