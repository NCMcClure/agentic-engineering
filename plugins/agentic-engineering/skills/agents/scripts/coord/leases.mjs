#!/usr/bin/env node
// aw lease, aw leases: saying what you use of a shared resource, and how much,
// while you use it. The leases live in <store>/resources.json as
// {"leases": [{ id, resource, agent, project, share, mem, cpu, for, pid, since,
// until, hold }]}; one whose process is gone or whose time is over is dropped
// by whoever reads next.
import { randomBytes } from "node:crypto";
import path from "node:path";
import { AwError, emit, ioOf, parseArgs, readJson, runMain } from "../../lib/common.mjs";
import * as store from "./store.mjs";

const USAGE = `usage: aw lease RESOURCE [options] --for "what" (-- <command ...> | --hold)
       aw lease --release ID
       aw leases [--resource R] [--json]

Leases: saying what you use of a shared resource, and how much, while you use it.

  aw lease RESOURCE [--share 0..1] [--mem 12GB] [--cpu N] --for "what" -- <command ...>
        the lease lives while the command runs and is gone when it exits, also after a failure
  aw lease RESOURCE [...] --for "what" --hold [--minutes N]
        a lease that stays until released, until its session ends, or for N minutes (default 120)
  aw lease --release ID
  aw leases [--resource R] [--json]

A lease is a declaration, not a lock and not enforcement: several agents may lease the same resource and the leases
add up. \`aw sys\` prints them beside the live readings and warns when they add up to more than there is (shares over
1, more memory than the device has). Need the resource alone? That is a lock: \`aw lock run\`.

The resource name is free: gpu, cpu, ram, disk, a port, a licence. \`aw lease ... -- <command>\` returns the command's
exit code (124 when --max-minutes killed it, 127 when it could not be started). The command runs as a program with
its arguments, never through a shell: wrap a shell line yourself (-- bash -c "...").

Options:
  --share F         the fraction of the resource you expect to use, 0 to 1
  --mem SIZE        memory you expect to use on it, with a unit: 12GB, 512MB
  --cpu N           processors you expect to keep busy
  --for TEXT        what the use is
  --as AGENT        the agent's name (default: the agent variable, else session-<pid>)
  --hold            keep the lease after this command returns, until released
  --minutes N       with --hold: how long the lease lasts at most (default 120)
  --max-minutes N   with a command: kill its process tree after this long (exit 124)
  --release ID      give a held lease back
  --resource R      leases: only this resource
  --json            print one JSON document (not with a command)`;

const UNITS = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** The file the leases live in. */
export const leasesPath = (home) => path.join(home, "resources.json");

/** '12GB', '512 MB', '1.5g' -> bytes (binary units); an AwError without a number and a unit. */
export function parseMem(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt])i?b?\s*$/i.exec(String(text));
  if (!m) throw new AwError(`memory '${text}': a number and a unit, such as 12GB or 512MB`);
  return Math.trunc(Number(m[1]) * UNITS[m[2].toLowerCase()]);
}

/** Bytes for people: `12.0 GB`, `512.0 MB`; `?` for no number. */
export function fmtBytes(n) {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() ? Number(n) : NaN;
  if (!Number.isFinite(v)) return "?";
  for (const [unit, size] of [["TB", 1024 ** 4], ["GB", 1024 ** 3], ["MB", 1024 ** 2]]) {
    if (v >= size) return `${(v / size).toFixed(1)} ${unit}`;
  }
  return `${(v / 1024).toFixed(0)} KB`;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const present = (v) => v !== null && v !== undefined;

function gone(lease) {
  const until = lease.until ? store.parseIso(lease.until) : null;
  if (until !== null && Date.now() / 1000 > until) return true;
  return present(lease.pid) && !store.pidAlive(lease.pid);
}

const listOf = (doc) => (isObject(doc) && Array.isArray(doc.leases) ? doc.leases.filter(isObject) : []);

/** The leases in force on this machine. With `prune`, those whose process is gone or whose time is over are dropped from the store too. */
export function live(home, { prune = true } = {}) {
  const rows = listOf(readJson(leasesPath(home), {}));
  const alive = rows.filter((r) => !gone(r));
  if (prune && alive.length !== rows.length) {
    try {
      store.updateJson(leasesPath(home), { leases: [] }, (doc) => {
        doc.leases = listOf(doc).filter((r) => !gone(r));
      });
    } catch { /* the next reader tidies it */ }
  }
  return alive;
}

/** Write a lease into the store and give it back. `pid` is the process it lives with; `until` a stamp or null. */
export function add(home, { resource, agent, project, why, pid, share = null, mem = null, cpu = null, until = null, hold = false }) {
  const lease = {
    id: `ls-${randomBytes(3).toString("hex")}`, resource, agent, project, share, mem, cpu, for: why, pid, since: store.now(), until, hold,
  };
  store.updateJson(leasesPath(home), { leases: [] }, (doc) => {
    doc.leases = [...listOf(doc).filter((r) => !gone(r)), lease];
  });
  return lease;
}

/** Take a lease out of the store by its id; gives it back, or null when it was not there. */
export function remove(home, id) {
  return store.updateJson(leasesPath(home), { leases: [] }, (doc) => {
    const rows = listOf(doc);
    const hit = rows.find((r) => r.id === id) ?? null;
    doc.leases = rows.filter((r) => r !== hit && !gone(r));
    return hit;
  });
}

/** One lease as a line: what, how much, whose (`withWho`), for how long, what for, its id (`withId`). */
export function describe(lease, known = null, { withWho = true, withId = true } = {}) {
  const parts = [String(lease.resource)];
  if (present(lease.share)) parts.push(`share ${store.g(lease.share)}`);
  if (present(lease.mem)) parts.push(fmtBytes(lease.mem));
  if (present(lease.cpu)) parts.push(`${store.g(lease.cpu)} cpu`);
  let text = parts.join(" ");
  if (withWho) text += `  ${lease.agent} (${store.projectLabel(lease.project, known)})`;
  text += `  for ${store.ago(store.ageSeconds(lease.since))}`;
  if (lease.until) text += `, until ${lease.until}`;
  return `${text}: "${lease.for || "?"}"${withId ? `  [${lease.id}]` : ""}`;
}

/** Per resource: how many leases, and what their shares, memory and processors add up to. */
export function totals(rows) {
  const out = {};
  for (const r of rows) {
    const t = (out[String(r.resource)] ??= { count: 0, share: 0, mem: 0, cpu: 0 });
    t.count += 1;
    t.share = Math.round((t.share + Number(r.share || 0)) * 1e4) / 1e4;
    t.mem += Math.trunc(Number(r.mem || 0));
    t.cpu += Number(r.cpu || 0);
  }
  return out;
}

/** The line that says what several leases on one resource add up to. */
export function totalLine(name, t) {
  const extra = (t.share ? ` share ${store.g(t.share)}` : "") + (t.mem ? ` ${fmtBytes(t.mem)}` : "") + (t.cpu ? ` ${store.g(t.cpu)} cpu` : "");
  return `${name}: ${t.count} leases add up to${extra || " nothing stated"}`;
}

// ------------------------------------------------------------------------------------------------------- commands

function sayOthers(io, home, others) {
  if (!others.length) return;
  const known = store.projects(home);
  io.stderr.write(`also on ${others[0].resource} right now:\n`);
  for (const r of others) io.stderr.write(`  ${describe(r, known)}\n`);
}

async function lease(argv, io) {
  const { values, positionals, rest } = parseArgs(argv, {
    share: { type: "string" }, mem: { type: "string" }, cpu: { type: "string" }, for: { type: "string" }, as: { type: "string" },
    hold: { type: "boolean" }, minutes: { type: "string" }, "max-minutes": { type: "string" }, release: { type: "string" },
    json: { type: "boolean" },
  });
  const ctx = store.context(io, values.as ?? null);
  const { home } = ctx;
  if (values.release) {
    const id = values.release;
    const hit = live(home).find((r) => r.id === id);
    if (!hit) {
      store.say(io, { released: false, id }, values.json, `${id}: no such lease (already gone)`);
      return 0;
    }
    if (hit.agent !== ctx.agent || hit.project !== ctx.project) {
      store.say(io, { released: false, id, agent: hit.agent ?? null, project: hit.project ?? null }, values.json);
      io.stderr.write(`${id}: held by ${hit.agent} (${store.projectLabel(hit.project, store.projects(home))}), not by `
        + `${ctx.agent}: only its holder releases a lease\n`);
      return 1;
    }
    remove(home, id);
    store.say(io, { released: true, id }, values.json, `${id}: released`);
    return 0;
  }

  const command = rest ?? [];
  if (positionals.length > 1) throw new AwError(`lease: unexpected '${positionals[1]}'`);
  if (!positionals.length) throw new AwError("lease: name the resource (gpu, cpu, ram, ...), or --release ID");
  const resource = store.checkName(positionals[0], "resource name");
  if (!values.for) throw new AwError('lease: say what it is for: --for "<what>"');
  const share = store.numArg(values.share, "--share");
  const cpu = store.numArg(values.cpu, "--cpu");
  const maxMinutes = store.numArg(values["max-minutes"], "--max-minutes");
  if (share !== null && !(share >= 0 && share <= 1)) throw new AwError(`lease: --share ${store.g(share)}: a fraction of the resource, 0 to 1`);
  if (cpu !== null && cpu < 0) throw new AwError("lease: --cpu: a number of processors");
  if (Boolean(command.length) === Boolean(values.hold)) {
    throw new AwError("lease: either -- <command> (the lease lives while it runs) or --hold (until released)");
  }
  const mem = values.mem ? parseMem(values.mem) : null;
  ctx.stamp();
  const others = live(home).filter((r) => r.resource === resource);
  const mine = { resource, agent: ctx.agent, project: ctx.project, why: values.for, share, mem, cpu };

  if (values.hold) {
    const minutes = store.numArg(values.minutes, "--minutes", store.setting(ctx.cfg, "holdMinutes"));
    const held = add(home, { ...mine, pid: store.sessionPid(io.env), until: store.isoAt(Date.now() / 1000 + minutes * 60), hold: true });
    store.say(io, { lease: held, others }, values.json,
      `${held.id}: ${describe(held, null, { withWho: false, withId: false })}\nrelease it with: aw lease --release ${held.id}`);
    sayOthers(io, home, others);
    return 0;
  }

  const until = maxMinutes ? store.isoAt(Date.now() / 1000 + maxMinutes * 60 + 60) : null;
  const held = add(home, { ...mine, pid: process.pid, until, hold: false });
  io.stderr.write(`lease ${held.id}: ${describe(held, null, { withWho: false, withId: false })}\n`);
  sayOthers(io, home, others);
  let code = 1;
  try {
    let timedOut;
    [code, timedOut] = await store.runChild(command, {
      env: io.env, extra: { AW_LEASE: held.id }, maxSeconds: maxMinutes ? maxMinutes * 60 : null,
      onError: (why) => io.stderr.write(`lease ${held.id}: could not start the command: ${why}\n`),
    });
    if (timedOut) io.stderr.write(`lease ${held.id}: the command ran into its ${store.g(maxMinutes)} min limit: its process tree was killed\n`);
  } finally {
    try { remove(home, held.id); } catch { /* its process is gone in a moment, and the next reader drops it */ }
  }
  io.stderr.write(`lease ${held.id}: released (exit ${code})\n`);
  return code;
}

async function leases(argv, io) {
  const { values, positionals } = parseArgs(argv, { resource: { type: "string" }, json: { type: "boolean" } });
  if (positionals.length) throw new AwError(`leases: unexpected '${positionals[0]}'`);
  const home = store.homeOf(io.env);
  const rows = live(home).filter((r) => !values.resource || r.resource === values.resource);
  const key = (r) => `${r.resource}\n${r.since}`;
  rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const known = store.projects(home);
  const lines = rows.length ? rows.map((r) => describe(r, known)) : ["no leases"];
  const sums = totals(rows);
  for (const [name, t] of Object.entries(sums)) if (t.count > 1) lines.push(`  ${totalLine(name, t)}`);
  store.say(io, { leases: rows, totals: sums }, values.json, lines.join("\n"));
  return 0;
}

/** `aw lease ...` and, called as `leases`, `aw leases ...`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  const cut = argv.indexOf("--");
  const own = cut < 0 ? argv : argv.slice(0, cut);
  if (own.includes("--help") || own.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  return io.command === "leases" ? leases(argv, io) : lease(store.glue(argv, ["--for"]), io);
}

runMain(import.meta.url, main, "aw lease");
