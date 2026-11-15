#!/usr/bin/env node
// One change request, from "the branch is pushed" to "it is on the base
// branch": a pull request on GitHub, a merge request on GitLab, through the
// same few calls on either, so an agent opens, waits on, and merges one the
// same way in every repo instead of relearning a forge's states each time.
//
//   node mr.mjs check                                  which forge this is, and whether its CLI is installed and signed in
//   node mr.mjs open --title <t> [--body-file <f>|-] [--target <b>] [--source <b>] [--draft] [--label <l>]...
//   node mr.mjs status <n> | --branch <b>              state, merge status, checks and what failed, head
//   node mr.mjs wait <n> [--interval 10] [--timeout 540] [--settle 30]
//   node mr.mjs merge <n> --sha <full head sha> [--method merge|squash|rebase] [--keep-branch]
//   node mr.mjs approve <n>
//   node mr.mjs retry <n>                              run the failed checks again, or start missing ones
//   node mr.mjs comment <n> --body-file <f>|-
//
// Everywhere: --json for one JSON object instead of one line, --root <dir> for
// a checkout other than the current folder, and --forge github|gitlab for a
// remote whose host name does not say which it is (the marker's `forge` is
// read for the same purpose). <n> is the pull request number or the merge
// request iid. Progress while waiting goes to stderr, one line per change.
//
// | Exit | Meaning                                                               |
// | 0    | done: read, opened, approved, merged, or (wait) mergeable             |
// | 1    | wait: the checks failed or were canceled; merge: refused, with why    |
// | 2    | usage                                                                 |
// | 3    | wait: still waiting at the timeout                                    |
// | 4    | wait: needs an approval                                               |
// | 5    | wait: conflicts, or the branch is behind its target                   |
// | 6    | wait: any other blocker (a draft, a block, a check waiting on a       |
// |      | person, already merged or closed)                                     |
// | 7    | the forge could not be asked: unknown forge, CLI missing or signed    |
// |      | out, no network, not found, forbidden                                 |
//
// wait keeps reading only while the state resolves by itself: a merge status
// the forge is still computing, or checks that are queued or running. A
// blocker no check result clears (conflicts, a missing approval, a draft)
// stops it at once rather than at the end of the checks. Where the forge wants
// checks and the head has none (a retarget drops them), wait starts them,
// once. A request the forge calls mergeable with no checks at all is given
// --settle seconds for checks to appear before it is taken at its word.
//
// merge refuses unless the request is mergeable and its head is the sha that
// was reviewed, so a push after the review is never merged unread. It merges
// with a merge commit and removes the source branch unless told otherwise.
// GitLab's per-request squash flag outranks a merge parameter, and a squashed
// request leaves the one stacked on it in conflict, so the flag is turned off
// and read back first.
//
// The forge is reached only through lib/provider.mjs, which runs `gh` or
// `glab` without a shell and names the repository on every call. Exit codes
// are set, never process.exit().
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
  FORGES, approveChange, authStatus, checkCli, commentOnChange, createChange, currentBranch, detect, listChanges,
  mergeChange, retryChecks, updateChange, viewChange,
} from "./lib/provider.mjs";

const METHODS = ["merge", "squash", "rebase"];
const OPTIONS = {
  json: { type: "boolean" }, root: { type: "string" }, forge: { type: "string" },
  branch: { type: "string" }, interval: { type: "string" }, timeout: { type: "string" }, settle: { type: "string" },
  sha: { type: "string" }, method: { type: "string" }, "keep-branch": { type: "boolean" },
  title: { type: "string" }, body: { type: "string" }, "body-file": { type: "string" },
  target: { type: "string" }, source: { type: "string" }, draft: { type: "boolean" }, label: { type: "string", multiple: true },
};

class Usage extends Error {}
/** A provider call that did not go through: carries the provider's own kind and hint. */
class Unreachable extends Error {
  constructor(result) {
    super(result.hint);
    this.kind = result.error;
  }
}
const need = (result) => { if (!result.ok) throw new Unreachable(result); return result.value; };

/** What to call a change request here, and how to write one's number. */
function words(provider) {
  const noun = provider.noun ?? "change request";
  const ref = (n) => (provider.kind === "gitlab" ? `MR !${n}` : provider.kind === "github" ? `PR #${n}` : `change request ${n}`);
  return { noun, ref };
}

/** The forge behind `root`: the flag, then the remote's host name, then the marker's `forge`. */
function providerFor(root, forge, io) {
  const found = detect(root, io);
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(path.join(root, ".agents", "manifest.json"), "utf8")).forge; } catch { /* no marker */ }
  const kind = forge ?? found.kind ?? (FORGES[recorded] ? recorded : null);
  const known = FORGES[kind];
  return known ? { ...found, kind: known.kind, cli: known.cli, noun: known.noun, short: known.short } : found;
}

/** A change request as this script prints it: the provider's object, minus the body, plus the forge's words. */
const shape = (provider, change) => {
  const { body: _body, ...rest } = change;
  return { forge: provider.kind, noun: words(provider).noun, ...rest };
};

/**
 * What one read means: `{ exit, reason }` when it is settled, or `{ wait }`
 * while the forge is still working (`restart` when it is waiting on checks
 * that were never started). `unchecked` marks a yes given with no checks run.
 */
export function judge(change, noun = "change request") {
  const checks = change.checks?.state ?? "none";
  const failed = change.checks?.failed ?? [];
  if (change.state !== "open") return { exit: 6, reason: `the ${noun} is ${change.state}` };
  if (checks === "failed" || checks === "canceled") return { exit: 1, reason: `checks ${checks}${failed.length ? `: ${failed.join(", ")}` : ""}` };
  if (change.mergeStatus === "conflicts") return { exit: 5, reason: `conflicts with ${change.target}: sync the branch with it` };
  if (change.mergeStatus === "behind") return { exit: 5, reason: `behind ${change.target}: sync the branch with it` };
  if (change.mergeStatus === "approval") return { exit: 4, reason: "needs an approval" };
  if (change.mergeStatus === "draft") return { exit: 6, reason: `the ${noun} is a draft` };
  if (checks === "pending") return { wait: "checks running" };
  if (change.mergeStatus === "checking") return { wait: "the forge is still working out whether it can merge" };
  if (change.mergeStatus === "ready") {
    if (checks === "passed" || checks === "skipped") return { exit: 0, reason: "green and mergeable" };
    if (checks === "none") return { exit: 0, reason: "mergeable, with no checks on the head", unchecked: true };
    return { exit: 6, reason: "a check is waiting on a person" };
  }
  if (change.mergeStatus === "checks") {
    if (checks === "none") return { wait: "no checks on the head", restart: true };
    if (checks === "passed" || checks === "skipped") return { wait: "the forge has not counted the green checks yet" };
    return { exit: 6, reason: "a check is waiting on a person" };
  }
  return { exit: 6, reason: change.mergeStatus === "blocked" ? `blocked (${change.mergeStatusRaw ?? "the forge gives no reason"})` : `merge status ${change.mergeStatusRaw ?? change.mergeStatus}` };
}

function line(ctx, c, extra = "") {
  const checks = c.checks ? `checks ${c.checks.state}${c.checks.failed.length ? ` (failed: ${c.checks.failed.join(", ")})` : ""}${c.checks.url ? ` ${c.checks.url}` : ""}` : "checks not read";
  return `${ctx.ref(c.number)} ${c.state} ${c.mergeStatus} ${checks} head ${c.sha}${extra}`;
}

function numberOf(ctx, positionals) {
  const raw = positionals[1];
  if (!raw) throw new Usage(`name the ${ctx.noun}: <number>`);
  if (!/^[1-9]\d*$/.test(raw)) throw new Usage(`"${raw}" is not a ${ctx.noun} number`);
  return Number(raw);
}

function seconds(raw, flag) {
  if (!/^\d+$/.test(raw)) throw new Usage(`${flag} takes whole seconds, not "${raw}"`);
  return Number(raw);
}

function bodyOf(ctx, values) {
  if (values["body-file"] === "-") return ctx.stdin();
  if (values["body-file"]) {
    try { return fs.readFileSync(path.resolve(ctx.cwd, values["body-file"]), "utf8"); } catch { throw new Usage(`--body-file ${values["body-file"]} cannot be read`); }
  }
  return values.body ?? "";
}

function check(ctx) {
  const { provider, io } = ctx;
  const cli = need(checkCli(provider, { env: io.env }));
  const auth = need(authStatus(provider, io));
  const where = [provider.host, provider.slug].filter(Boolean).join("/") || "no origin remote";
  const out = { forge: provider.kind, noun: ctx.noun, cli: cli.cli, host: provider.host, slug: provider.slug, account: auth.account };
  return { exit: 0, out, text: `${provider.kind} (${where}): ${cli.cli} is signed in${auth.account ? ` as ${auth.account}` : ""}; a change request here is a ${ctx.noun}` };
}

function open(ctx, positionals, values) {
  const { provider, io } = ctx;
  if (!values.title?.trim()) throw new Usage(`a ${ctx.noun} needs a title: --title "<subject>"`);
  const body = bodyOf(ctx, values);
  const source = values.source ?? need(currentBranch(ctx.root, io));
  // One open request per branch: a second run reports the first instead of failing on it.
  const [already] = need(listChanges(provider, { source, state: "open", limit: 5 }, io));
  if (already) return { exit: 0, out: { ...shape(provider, already), created: false }, text: `${ctx.ref(already.number)} is already open from ${source}: ${already.url}` };
  const made = need(createChange(provider, { title: values.title, body, source, target: values.target, draft: Boolean(values.draft), labels: values.label ?? [] }, io));
  return { exit: 0, out: { ...shape(provider, made), created: true }, text: `${ctx.ref(made.number)} opened: ${made.url}` };
}

function status(ctx, positionals, values) {
  const { provider, io } = ctx;
  let n;
  if (values.branch) {
    const [found] = need(listChanges(provider, { source: values.branch, state: "open", limit: 5 }, io));
    if (!found) throw new Unreachable({ error: "not-found", hint: `no open ${ctx.noun} from ${values.branch}` });
    n = found.number;
  } else n = numberOf(ctx, positionals);
  const c = need(viewChange(provider, n, io));
  return { exit: 0, out: shape(provider, c), text: line(ctx, c) };
}

async function wait(ctx, positionals, values) {
  const { provider, io } = ctx;
  const n = numberOf(ctx, positionals);
  const interval = seconds(values.interval ?? "10", "--interval");
  const timeout = seconds(values.timeout ?? "540", "--timeout");
  const settle = seconds(values.settle ?? "30", "--settle");
  const deadline = ctx.now() + timeout * 1000;
  let restarted = false;
  let uncheckedSince = null;
  let last = "";
  for (;;) {
    const c = need(viewChange(provider, n, io));
    let v = judge(c, ctx.noun);
    // Right after a push a forge can say mergeable before the checks exist.
    if (v.unchecked) {
      uncheckedSince ??= ctx.now();
      if (ctx.now() - uncheckedSince < settle * 1000) v = { wait: "mergeable, giving checks a moment to appear" };
    } else uncheckedSince = null;
    if (v.exit !== undefined) return { exit: v.exit, out: { ...shape(provider, c), exit: v.exit, reason: v.reason }, text: line(ctx, c, `: ${v.reason}`) };
    if (v.restart && !restarted) {
      restarted = true;
      const started = retryChecks(provider, n, io);
      ctx.note(`${ctx.ref(n)}: no checks on the head${started.ok && started.value.started ? "; started them" : ""}`);
    } else if (v.wait !== last) ctx.note(`${ctx.ref(n)}: waiting, ${v.wait}`);
    last = v.wait;
    const left = deadline - ctx.now();
    if (left <= 0) {
      const reason = `still waiting after ${timeout}s: ${v.wait}`;
      return { exit: 3, out: { ...shape(provider, c), exit: 3, reason }, text: line(ctx, c, `: ${reason}`) };
    }
    await ctx.sleep(Math.min(interval * 1000, left));
  }
}

function merge(ctx, positionals, values) {
  const { provider, io } = ctx;
  const n = numberOf(ctx, positionals);
  const sha = values.sha ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Usage("--sha takes the full 40-character head sha that was reviewed; a forge refuses a short one");
  const method = values.method ?? "merge";
  if (!METHODS.includes(method)) throw new Usage(`--method takes ${METHODS.join(", ")}, not "${method}"`);
  const refuse = (c, reason) => ({ exit: 1, out: { ...shape(provider, c), merged: false, reason }, text: `${ctx.ref(n)} not merged: ${reason}` });

  let c = need(viewChange(provider, n, io));
  if (c.squash === true && method !== "squash") {
    need(updateChange(provider, n, { squash: false }, io));
    c = need(viewChange(provider, n, io));
    if (c.squash) return refuse(c, `squash still reads on after turning it off; the project may require squash, which leaves a ${ctx.noun} stacked on this one in conflict`);
  }
  const v = judge(c, ctx.noun);
  if (v.exit !== 0) return refuse(c, v.reason ?? `not ready yet: ${v.wait}`);
  if (c.sha !== sha) return refuse(c, `the head moved: reviewed ${sha}, the head is ${c.sha}`);

  const done = mergeChange(provider, n, { method, deleteBranch: !values["keep-branch"], sha }, io);
  if (!done.ok && done.error === "refused") return refuse(c, done.hint);
  const landed = need(done);
  if (landed.merged === false) return refuse(c, `the forge took the merge but the ${ctx.noun} reads ${landed.change?.state ?? "unmerged"}`);
  // A fast-forward makes no merge commit: the reviewed head is what lands.
  const mergeSha = landed.sha ?? sha;
  return { exit: 0, out: { ...shape(provider, landed.change ?? c), state: "merged", merged: true, mergeSha }, text: `${ctx.ref(n)} merged at ${mergeSha}` };
}

function approve(ctx, positionals) {
  const n = numberOf(ctx, positionals);
  need(approveChange(ctx.provider, n, ctx.io));
  return { exit: 0, out: { number: n, approved: true }, text: `${ctx.ref(n)} approved` };
}

function retry(ctx, positionals) {
  const n = numberOf(ctx, positionals);
  const { started } = need(retryChecks(ctx.provider, n, ctx.io));
  return { exit: 0, out: { number: n, started }, text: `${ctx.ref(n)}: ${started ? `${started} check run(s) started again` : "nothing to run again"}` };
}

function comment(ctx, positionals, values) {
  const n = numberOf(ctx, positionals);
  const body = bodyOf(ctx, values);
  if (!body.trim()) throw new Usage("a comment needs a body: --body-file <file>, or --body-file - with the text on stdin");
  const made = need(commentOnChange(ctx.provider, n, body, ctx.io));
  return { exit: 0, out: { number: n, ...made }, text: `${ctx.ref(n)}: commented${made.url ? ` ${made.url}` : ""}` };
}

const VERBS = { check, open, status, wait, merge, approve, retry, comment };

/**
 * Run one verb. Everything that touches the world is injectable: `run` (the
 * provider's runner), `env`, `cwd`, `sleep`, `now`, `stdin`, and `note` for
 * the progress lines. Answers `{ exit, out, text }` or `{ exit, error }`.
 */
export async function main(argv, { run, env = process.env, cwd = process.cwd(), sleep = delay, now = Date.now, stdin = () => fs.readFileSync(0, "utf8"), note = (text) => process.stderr.write(`${text}\n`) } = {}) {
  let parsed;
  try { parsed = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS }); }
  catch (e) { return { exit: 2, error: { kind: "usage", message: e.message } }; }
  const { values, positionals } = parsed;
  const usage = (message) => ({ exit: 2, error: { kind: "usage", message } });
  const verb = VERBS[positionals[0]];
  if (!verb) return usage(`usage: mr.mjs <${Object.keys(VERBS).join("|")}> [<number>] [--json]`);
  if (values.forge && !FORGES[values.forge]) return usage(`--forge takes github or gitlab, not "${values.forge}"`);

  const root = path.resolve(cwd, values.root ?? ".");
  const io = { run, env, cwd: root };
  const provider = providerFor(root, values.forge, io);
  const ctx = { provider, io, root, cwd, sleep, now, stdin, note, ...words(provider) };
  if (!provider.kind) {
    const where = provider.host ? `its origin is on ${provider.host}, which names neither` : "it has no origin remote that names one";
    return { exit: 7, error: { kind: "unknown-provider", message: `This repository's forge is not known (${where}), so its change requests cannot be reached. Pass --forge github or --forge gitlab.` } };
  }
  try {
    return await verb(ctx, positionals, values);
  } catch (e) {
    if (e instanceof Usage) return usage(e.message);
    if (e instanceof Unreachable) return { exit: 7, error: { kind: e.kind, message: e.message } };
    throw e;
  }
}

function report(result, json) {
  if (result.error) {
    if (json) process.stdout.write(`${JSON.stringify({ error: result.error })}\n`);
    else process.stderr.write(`mr: ${result.error.message}\n`);
  } else if (json) process.stdout.write(`${JSON.stringify(result.out)}\n`);
  else process.stdout.write(`${result.text}\n`);
  process.exitCode = result.exit;
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename); } catch { return false; } };

if (isMain()) {
  const argv = process.argv.slice(2);
  report(await main(argv), argv.includes("--json"));
}
