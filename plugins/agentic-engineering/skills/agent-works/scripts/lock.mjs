#!/usr/bin/env node
// aw lock: exclusive locks on scarce resources, across agents, worktrees and
// projects. One holder at a time, the others wait in a first come, first
// served queue. `locks.mjs` is the library behind it.
import { AwError, emit, ioOf, parseArgs, posix, runMain } from "../lib/common.mjs";
import * as store from "./coord/store.mjs";
import * as locks from "./locks.mjs";

const USAGE = `usage: aw lock <run|acquire|release|status|holder> ...

Exclusive locks on scarce resources, across agents, worktrees and projects: one holder at a time, a fair queue.

The normal way, one command under one hold (queues, sets the agent variable for the command, kills its process tree
at the limit, and always releases, also after a failure):

  aw lock run RESOURCE --for "what, how long" [--as AGENT] [--max-minutes N] [--wait SECONDS] -- <command ...>

Several commands under one hold:

  aw lock acquire RESOURCE --for "what, how long" [--as AGENT] [--wait SECONDS] [--despite-running] [--json]
  <commands>
  aw lock release RESOURCE [--as AGENT] [--json]

  aw lock status [RESOURCE] [--all] [--json]      aw lock holder RESOURCE [--json]

The command after -- runs as a program with its arguments, never through a shell; leading NAME=value words set its
environment. A line that needs a shell is yours to wrap: -- bash -c "make && make test".

Scopes. A resource whose config entry says "scope": "machine", and the built-in resources gpu and gpu-exclusive,
lock machine-wide: every project on this machine contends for the one lock. Any other resource locks under the
project (the repository and all its worktrees), so the same name in two projects is two locks. A resource the config
does not declare is locked for the project, ad hoc, with a warning.

Exit codes of acquire and run: 0 = held (run: the command's own exit code); 3 = STILL QUEUED after --wait seconds:
not a failure, the place in the queue is kept for 10 minutes, run the same command again (run prints STILL QUEUED and
does not start the command); 124 = run killed the command at its time limit; 127 = the command could not be started;
2 = usage error. --wait defaults to 480 s, shorter than a tool's time limit on purpose. release: 1 when someone else
holds the lock. holder: 0 when held, 1 when free.

Options:
  --for TEXT          what the run is and how long it takes ("smoke gate, 2 min"); whoever waits reads it
  --as AGENT          the agent's name (default: the agent variable, else session-<pid>)
  --wait SECONDS      how long to wait for a turn (default 480); then exit 3, place kept
  --max-minutes N     run: kill the command's process tree after this long (default: the resource's maxMinutes, else ${locks.DEFAULT_MAX_MINUTES})
  --despite-running   take a free lock although the application already runs (you started it, or the owner said so)
  --all               status: also the locks of other projects
  --json              print one JSON document

Rules of use:
  - Hold a lock for the run only, never while thinking or editing.
  - Release also after a failure (\`run\` does it for you).
  - Needing two resources, take them in the order "lockOrder" lists them, so two agents cannot each hold one and
    wait for the other (a warning says so when the order is broken).
  - First come, first served: waiters queue by the time they first asked. A waiter whose command died keeps its
    place for 10 minutes; one that has not polled for 45 s is passed over until it asks again.
  - A long hold must be refreshed: call acquire again with the same name (\`run\` refreshes by itself). A lock not
    refreshed for coordination.lockStaleMinutes (45) while none of the resource's processes runs is taken over, with
    a note; so is the lock of a \`run\` whose own process is gone.
  - While the resource's application runs without any lock (the owner's own instance, or a leftover), acquire waits.

Agent names: lower-case letters, digits and '-'. Default: the agent variable of the config (AW_AGENT), else
session-<pid>. A coordination aid between cooperating agents, not a security boundary.`;

const WHO = { as: { type: "string" } };
const JSON_FLAG = { json: { type: "boolean" } };
const WAITING = {
  ...WHO, for: { type: "string" }, wait: { type: "string" }, "despite-running": { type: "boolean" },
  // Tests shorten these.
  poll: { type: "string" }, live: { type: "string" }, keep: { type: "string" },
};

function one(positionals, verb, what = "RESOURCE", required = true) {
  if (positionals.length > 1) throw new AwError(`lock ${verb}: unexpected '${positionals[1]}'`);
  if (required && !positionals.length) throw new AwError(`lock ${verb}: name the ${what.toLowerCase()}: aw lock ${verb} ${what}`);
  return positionals[0] ?? null;
}

/** Who asks, for which resource, in which folder: what every verb that names a holder starts from. */
function setup(io, resourceName, as) {
  const ctx = store.context(io, as ?? null);
  const resource = store.checkName(resourceName, "resource name");
  const scope = locks.scopeOf(resource, ctx.cfg, null, ctx.project);
  const who = locks.me(ctx.home, ctx.agent, ctx.project, scope);
  const warnings = ctx.cfg._error ? [`config: ${ctx.cfg._error} (the defaults are used)`] : [];
  return { ctx, resource, who, dir: locks.scopeDir(ctx.home, scope), spec: locks.specOf(resource, ctx.cfg), warnings };
}

function waitingOptions(values, verb) {
  if (!values.for) throw new AwError(`lock ${verb}: say what it is for: --for "<what, how long>"`);
  return {
    wait: store.numArg(values.wait, "--wait", 480),
    poll: store.numArg(values.poll, "--poll", locks.POLL_S),
    live: store.numArg(values.live, "--live", locks.LIVE_S),
    keep: store.numArg(values.keep, "--keep", locks.KEEP_S),
    despiteRunning: values["despite-running"] === true,
  };
}

function askingWarnings(io, resource, ctx, who) {
  const out = locks.askingWarnings(resource, ctx.cfg, who);
  for (const line of out) io.stderr.write(`aw lock: ${line}\n`);
  return out;
}

function stillQueued(io, resource, options, text) {
  io.stderr.write(`${resource}: STILL QUEUED after ${store.g(options.wait)} s (held by ${text}). Not a failure: the place in the queue is `
    + `kept for ${store.g(options.keep / 60)} min. Run the same command again.\n`);
  return locks.QUEUED;
}

const processesOf = (spec) => (Array.isArray(spec.processes) ? spec.processes : []);

async function acquire(argv, io) {
  const { values, positionals } = parseArgs(argv, { ...WAITING, ...JSON_FLAG });
  const options = waitingOptions(values, "acquire");
  const { ctx, resource, who, dir, spec, warnings } = setup(io, one(positionals, "acquire"), values.as);
  warnings.push(...askingWarnings(io, resource, ctx, who));
  ctx.stamp();
  // The pid of a plain hold is the session's: who to look for, not a reason to call the lock stale.
  const [got, text] = await locks.waitFor(dir, resource, who, values.for, {
    ...options, processes: processesOf(spec), staleMinutes: store.setting(ctx.cfg, "lockStaleMinutes"),
    extra: { pid: store.sessionPid(io.env), run: false },
    onWait: values.json ? null : (line) => io.stderr.write(`${line}\n`),
  });
  store.say(io, { resource, scope: who.scope, held: got, agent: who.agent, project: who.project, note: text, warnings }, values.json,
    got ? `${resource}: held by ${who.agent}${text ? ` (${text})` : ""}` : "");
  return got ? 0 : stillQueued(io, resource, options, text);
}

async function run(argv, io) {
  const { values, positionals, rest } = parseArgs(argv, { ...WAITING, "max-minutes": { type: "string" } });
  const command = rest ?? [];
  if (!command.length) throw new AwError("lock run: no command after --");
  const options = waitingOptions(values, "run");
  const { ctx, resource, who, dir, spec } = setup(io, one(positionals, "run"), values.as);
  askingWarnings(io, resource, ctx, who);
  ctx.stamp();
  const maxMinutes = Number(store.numArg(values["max-minutes"], "--max-minutes") || spec.maxMinutes || locks.DEFAULT_MAX_MINUTES);
  const [got, text] = await locks.waitFor(dir, resource, who, values.for, {
    ...options, processes: processesOf(spec), staleMinutes: store.setting(ctx.cfg, "lockStaleMinutes"),
    extra: { maxMinutes, run: true, pid: process.pid },
    onWait: (line) => io.stderr.write(`${line}\n`),
  });
  if (!got) return stillQueued(io, resource, options, text);
  io.stderr.write(`${resource}: held by ${who.agent}${text ? ` (${text})` : ""}; limit ${store.g(maxMinutes)} min\n`);
  let code = 1;
  let timedOut = false;
  try {
    const agentVar = String(ctx.cfg.guard?.agentVar || "AW_AGENT");
    [code, timedOut] = await store.runChild(command, {
      env: io.env, extra: { [agentVar]: who.agent, AW_AGENT: who.agent }, maxSeconds: maxMinutes * 60,
      tick: () => locks.keep(dir, resource, who),
      onError: (why) => io.stderr.write(`${resource}: could not start the command: ${why}\n`),
    });
  } finally {
    locks.release(dir, resource, who);
  }
  if (timedOut) {
    try {
      const whose = who.scope === store.MACHINE ? [null, `${who.agent}@${ctx.name}`] : [who.project, who.agent];
      store.appendNote(ctx.home, ...whose, `${resource}: run killed at its ${store.g(maxMinutes)} min limit (${values.for})`);
    } catch { /* the note is a courtesy */ }
    io.stderr.write(`${resource}: the command ran into its ${store.g(maxMinutes)} min limit: its process tree was killed\n`);
  }
  io.stderr.write(`${resource}: released by ${who.agent} (exit ${code})\n`);
  return code;
}

async function release(argv, io) {
  const { values, positionals } = parseArgs(argv, { ...WHO, ...JSON_FLAG });
  const { ctx, resource, who, dir } = setup(io, one(positionals, "release"), values.as);
  const cur = locks.readLock(dir, resource);
  if (cur === null) {
    store.say(io, { resource, released: false, holder: null }, values.json, `${resource}: already free`);
    return 0;
  }
  if (!locks.release(dir, resource, who)) {
    store.say(io, { resource, released: false, holder: cur.agent ?? null, project: cur.project ?? null }, values.json, "");
    io.stderr.write(`${resource}: held by ${locks.label(cur, who.scope, ctx.home)}, not by ${who.agent}: only the holder releases\n`);
    return 1;
  }
  store.say(io, { resource, released: true, holder: null }, values.json, `${resource}: released by ${who.agent}`);
  return 0;
}

async function holder(argv, io) {
  const { values, positionals } = parseArgs(argv, JSON_FLAG);
  const ctx = store.context(io);
  const resource = store.checkName(one(positionals, "holder"), "resource name");
  const doc = locks.holder(resource, ctx.cfg, ctx);
  store.say(io, { resource, holder: doc?.agent ?? null, project: doc?.project ?? null, scope: locks.scopeOf(resource, ctx.cfg, null, ctx.project) },
    values.json, doc ? String(doc.agent) : "");
  return doc ? 0 : 1;
}

async function status(argv, io) {
  const { values, positionals } = parseArgs(argv, { all: { type: "boolean" }, ...JSON_FLAG });
  const ctx = store.context(io);
  const given = one(positionals, "status", "RESOURCE", false);
  const only = given === null ? null : store.checkName(given, "resource name");
  const rows = locks.statusRows(ctx, only, values.all === true);
  const known = store.projects(ctx.home);
  const lines = [];
  for (const r of rows) {
    const where = r.scope === store.MACHINE ? "machine" : r.scope === ctx.project ? "project" : store.projectLabel(r.scope, known);
    const head = `${r.resource} [${where}]`;
    const running = r.running.length ? `; running: ${r.running.join(", ")}` : "";
    if (r.held) {
      const who = r.agent + (r.scope === store.MACHINE && r.project ? ` (${store.projectLabel(r.project, known)})` : "");
      const flags = (r.overdue ? " OVERDUE" : "") + (r.stale ? " STALE (not refreshed)" : "");
      lines.push(`${head}: held by ${who} for ${store.g(r.heldMinutes)} of ${store.g(r.maxMinutes)} min${flags}, `
        + `since ${r.since}, refreshed ${r.refreshed}, for: ${r.for || "?"}${running}`);
    } else {
      lines.push(`${head}: free${running}${r.running.length ? " (no lock: the owner's own instance, or a leftover)" : ""}`);
    }
    r.waiting.forEach((w, i) => {
      const away = w.live ? "" : ` (not polling for ${w.idleSeconds.toFixed(0)} s: passed over, place kept)`;
      lines.push(`    ${i + 1}. ${w.agent} waiting since ${store.isoAt(w.asked)}${away}`);
    });
  }
  store.say(io, { dir: posix(store.locksRoot(ctx.home)), project: ctx.project, resources: rows }, values.json, lines.join("\n"));
  return 0;
}

const VERBS = { run, acquire, release, status, holder };

/** `aw lock <verb> ...`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  const cut = argv.indexOf("--");
  const own = cut < 0 ? argv : argv.slice(0, cut);
  if (own.includes("--help") || own.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  const [verb, ...rest] = argv;
  if (!verb || !Object.hasOwn(VERBS, verb)) {
    io.stderr.write(`${verb ? `aw lock: no action '${verb}'\n\n` : ""}${USAGE}\n`);
    return 2;
  }
  return VERBS[verb](store.glue(rest, ["--for"]), io);
}

runMain(import.meta.url, main);
