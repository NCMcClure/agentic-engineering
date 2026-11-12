#!/usr/bin/env node
// aw claim, aw claims: claims on a project's shared counters. A number taken
// once, by one agent, until its merge lands. They live in
// <store>/projects/<project id>/claims.json as {"counters": {<name>: {"floor":
// N or null, "claims": [{ value, agent, for, since, until }]}}}.
import path from "node:path";
import { AwError, emit, intArg, ioOf, parseArgs, readJson, runMain } from "../../lib/common.mjs";
import { CONFIG } from "../../lib/config.mjs";
import * as store from "./store.mjs";

const USAGE = `usage: aw claim COUNTER [--after N] [--value V] [--for "what"] [--release [--landed]] [--hours H] [--as AGENT] [--json]
       aw claims [--all] [--json]

Claims on a project's shared counters: a number taken once, by one agent, until its merge lands.

Two branches that each bump "the next version" to the same number collide at merge time. A claim settles who gets
which number before anybody writes it down.

  aw claim COUNTER [--after N] [--for "what"]     claim the next value: one above the highest known
  aw claim COUNTER --value V [--for "what"]       claim this very value
  aw claim COUNTER --release [--landed]           give it back; --landed: the value is in the main branch now
  aw claims [--all] [--json]

The store knows a counter's floor (the highest value known to have landed) and the claims in force. The next value is
one above the highest of both. The first time a counter is used, say what the code holds now: --after N. A claim
lasts until released or for coordination.claimHours (72), whichever comes first; asking again while you hold one
returns the same value and renews it. Released without --landed, a value is free again.

Claim at merge time, not when the work starts: a number held for days blocks nobody, but it leaves a gap when the
work is dropped. Counters are declared under "counters" in the config; an undeclared one works, with a warning.
Exit codes: 0 claimed or released, 1 not now (the value is taken, or nothing to release), 2 usage.

Options:
  --value V     claim (or, with --release, give back) this very value
  --after N     the value the code holds now: the next claim is above it
  --for TEXT    what the number is for (the branch, the card)
  --release     give your claim back
  --landed      with --release: the value has landed, never hand it out again
  --hours H     how long the claim lasts (default 72)
  --as AGENT    the agent's name (default: the agent variable, else session-<pid>)
  --all         claims: every project's counters
  --json        print one JSON document`;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const present = (v) => v !== null && v !== undefined;
const int = (v) => Math.trunc(Number(v));

/** The file a project's claims live in. */
export const claimsPath = (home, project) => path.join(store.projectDir(home, project), "claims.json");

function expired(claim) {
  const until = store.parseIso(claim.until);
  return until !== null && Date.now() / 1000 > until;
}

const inForce = (claims) => (Array.isArray(claims) ? claims.filter((x) => isObject(x) && !expired(x)) : []);

function counterOf(doc, name) {
  if (!isObject(doc.counters)) doc.counters = {};
  if (!isObject(doc.counters[name])) doc.counters[name] = { floor: null, claims: [] };
  const c = doc.counters[name];
  c.claims = inForce(c.claims);
  return c;
}

/** A project's counters, `{counter: { floor, claims }}`, with expired claims left out (they are dropped at the next write). */
export function read(home, project) {
  const doc = readJson(claimsPath(home, project), {});
  const out = {};
  for (const [name, c] of Object.entries(isObject(doc) && isObject(doc.counters) ? doc.counters : {})) {
    if (isObject(c)) out[name] = { floor: c.floor ?? null, claims: inForce(c.claims) };
  }
  return out;
}

/**
 * Claim a value of a counter for `hours`. `value` null: the next one (above `after`, the floor and every claim), or
 * the one the agent already holds, renewed. Gives `{ ok: true, claim, renewed }` or `{ ok: false, why, usage? }`.
 */
export function claim(home, project, counter, agent, { why = "", value = null, after = null, hours = store.SETTINGS.claimHours } = {}) {
  const until = store.isoAt(Date.now() / 1000 + hours * 3600);
  return store.updateJson(claimsPath(home, project), { counters: {} }, (doc) => {
    const c = counterOf(doc, counter);
    if (after !== null) c.floor = present(c.floor) ? Math.max(int(after), int(c.floor)) : int(after);
    const own = c.claims.filter((x) => x.agent === agent);
    if (value === null && own.length) {
      const last = own.at(-1);
      last.until = until;
      if (why) last.for = why;
      return { ok: true, claim: last, renewed: true };
    }
    let v;
    if (value === null) {
      const known = [...c.claims.map((x) => int(x.value)), ...(present(c.floor) ? [int(c.floor)] : [])];
      if (!known.length) {
        return { ok: false, usage: true, why: `nothing is known about '${counter}' yet: say what the code holds now (--after N) or the value you take (--value V)` };
      }
      v = Math.max(...known) + 1;
    } else {
      v = int(value);
      const other = c.claims.find((x) => int(x.value) === v && x.agent !== agent);
      if (other) return { ok: false, why: `${counter} ${v} is claimed by ${other.agent} (for: ${other.for || "?"}; until ${other.until})` };
      if (present(c.floor) && v <= int(c.floor)) return { ok: false, why: `${counter} ${v} has landed already (the highest landed value is ${c.floor})` };
      const same = c.claims.find((x) => int(x.value) === v);
      if (same) {
        same.until = until;
        return { ok: true, claim: same, renewed: true };
      }
    }
    const entry = { value: v, agent, for: why, since: store.now(), until };
    c.claims.push(entry);
    return { ok: true, claim: entry, renewed: false };
  });
}

/** Give back the agent's claims on a counter (`value` null: all of them). `landed` raises the floor to the highest one. Gives the claims released. */
export function release(home, project, counter, agent, { value = null, landed = false } = {}) {
  return store.updateJson(claimsPath(home, project), { counters: {} }, (doc) => {
    const c = counterOf(doc, counter);
    const given = c.claims.filter((x) => x.agent === agent && (value === null || int(x.value) === int(value)));
    c.claims = c.claims.filter((x) => !given.includes(x));
    if (landed && given.length) {
      const top = Math.max(...given.map((x) => int(x.value)));
      c.floor = present(c.floor) ? Math.max(top, int(c.floor)) : top;
    }
    return given;
  });
}

// ------------------------------------------------------------------------------------------------------- commands

async function claimCommand(argv, io) {
  const { values, positionals } = parseArgs(argv, {
    value: { type: "string" }, after: { type: "string" }, for: { type: "string" }, release: { type: "boolean" },
    landed: { type: "boolean" }, hours: { type: "string" }, as: { type: "string" }, json: { type: "boolean" },
  });
  if (positionals.length !== 1) throw new AwError(positionals.length ? `claim: unexpected '${positionals[1]}'` : "claim: name the counter: aw claim COUNTER");
  const value = intArg(values.value, "--value");
  const after = intArg(values.after, "--after");
  const hoursGiven = store.numArg(values.hours, "--hours");
  const ctx = store.context(io, values.as ?? null);
  const counter = store.checkName(positionals[0], "counter name");
  const warnings = [];
  if (!Object.hasOwn(ctx.cfg.counters ?? {}, counter)) {
    warnings.push(`'${counter}' is not declared under "counters" in ${CONFIG}: claimed all the same`);
    io.stderr.write(`aw claim: ${warnings[0]}\n`);
  }
  if (values.release) {
    const given = release(ctx.home, ctx.project, counter, ctx.agent, { value, landed: values.landed === true });
    if (!given.length) {
      store.say(io, { counter, released: [] }, values.json);
      io.stderr.write(`${counter}: ${ctx.agent} holds no claim${value !== null ? ` on ${value}` : ""}\n`);
      return 1;
    }
    store.say(io, { counter, released: given, landed: values.landed === true, warnings }, values.json,
      `${counter}: ${ctx.agent} released ${given.map((x) => x.value).join(", ")}${values.landed ? " (landed)" : " (free again)"}`);
    return 0;
  }
  ctx.stamp();
  const hours = hoursGiven ?? store.setting(ctx.cfg, "claimHours");
  const result = claim(ctx.home, ctx.project, counter, ctx.agent, { why: values.for || "", value, after, hours });
  if (!result.ok) {
    if (result.usage) throw new AwError(`claim: ${result.why}`);
    store.say(io, { counter, claimed: false, why: result.why }, values.json);
    io.stderr.write(`${result.why}. Take the next one: aw claim ${counter}\n`);
    return 1;
  }
  const c = result.claim;
  store.say(io, { counter, claimed: true, value: c.value, agent: ctx.agent, until: c.until, renewed: result.renewed, warnings }, values.json,
    `${counter}: ${c.value} is ${ctx.agent}'s until ${c.until}${result.renewed ? " (renewed)" : ""}`
    + `\nwhen the merge has landed: aw claim ${counter} --release --landed`);
  return 0;
}

async function claimsCommand(argv, io) {
  const { values, positionals } = parseArgs(argv, { all: { type: "boolean" }, json: { type: "boolean" } });
  if (positionals.length) throw new AwError(`claims: unexpected '${positionals[0]}'`);
  const ctx = store.context(io);
  const known = store.projects(ctx.home);
  const ids = values.all ? [...new Set([...store.projectFolders(ctx.home), ctx.project])].sort() : [ctx.project];
  const declared = isObject(ctx.cfg.counters) ? ctx.cfg.counters : {};
  const doc = {};
  const lines = [];
  const pad = values.all ? "  " : "";
  for (const id of ids) {
    const counters = read(ctx.home, id);
    if (id === ctx.project) for (const name of Object.keys(declared)) counters[name] ??= { floor: null, claims: [] };
    doc[id] = counters;
    if (values.all && Object.keys(counters).length) lines.push(store.projectLabel(id, known));
    for (const name of Object.keys(counters).sort()) {
      const c = counters[name];
      const about = id === ctx.project && isObject(declared[name]) ? declared[name].note : null;
      lines.push(`${pad}${name}: ${present(c.floor) ? `landed up to ${c.floor}` : "nothing landed known"}${about ? `  (${about})` : ""}`);
      for (const x of [...c.claims].sort((a, b) => int(a.value) - int(b.value))) {
        lines.push(`${pad}    ${x.value}  ${x.agent}  until ${x.until}: "${x.for || "?"}"`);
      }
    }
  }
  store.say(io, values.all ? { projects: doc } : { project: ctx.project, counters: doc[ctx.project] }, values.json,
    lines.length ? lines.join("\n") : "(no counters)");
  return 0;
}

/** `aw claim ...` and, called as `claims`, `aw claims ...`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  if (argv.includes("--help") || argv.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  return io.command === "claims" ? claimsCommand(argv, io) : claimCommand(store.glue(argv, ["--for"]), io);
}

runMain(import.meta.url, main, "aw claim");
