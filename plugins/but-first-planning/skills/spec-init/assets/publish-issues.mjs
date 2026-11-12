#!/usr/bin/env node
// Publish plan-tree issues to the tracker tracker.md names, dependency-ordered.
//
// Lives at `.agents/plan/plan/publish-issues.mjs` beside `tracker.mjs` (the
// GitHub and GitLab vocabulary) and `provider.mjs` (the layer over `gh` and
// `glab`). Deterministic and idempotent: it parses the plan tree, sorts each
// sprint's issues so a blocker is published before what it blocks (a blocked
// body then cites a real `#NNN`), opens one ticket per unpublished issue, and
// writes the ref into the issue file and the sprint table at once, so an
// interrupted run leaves an accurate record and a second run skips whatever
// already carries a ref.
//
// Usage:
//   publish-issues.mjs [publish] [--sprint EE-SS] [--all] [--dry-run]
//   publish-issues.mjs sync <EE-SS-II | #NNN> [--dry-run]     (also: sync --iid NNN)
//   publish-issues.mjs status [--sprint EE-SS] [--json]
//
// `publish` with no selector publishes the FIRST sprint (in epic and sprint
// order) that still has `<unassigned>` issues: one sprint per run, lazily.
// `sync` rebuilds a published ticket's title and body from its plan file.
// `status` reads every published ticket back and says where the tracker and
// the plan disagree about done.
//
// Local-markdown mode has nothing to publish to; the script says so.
//
// Node 22 stdlib only. Exit 0 = ok; 1 = at least one ticket failed, or
// `status` found a disagreement; 2 = usage or configuration.
import fs from "node:fs";
import path from "node:path";
import { checkCli } from "./provider.mjs";
import { agrees, createTicket, providerFor, readTracker, rebuildTicket, refNumber, trackerState } from "./tracker.mjs";

const PLAN = import.meta.dirname; //            .agents/plan/plan/
const PLAN_DIR = path.dirname(PLAN); //         .agents/plan/
const ROOT = path.dirname(path.dirname(PLAN_DIR)); // the repository (.agents/ is one level under it)
const TRACKER_MD = path.join(PLAN_DIR, "tracker.md");

// `**GitHub**:` is the name the field had before 5.0; a tree that still
// carries it is read and written the same way.
const TRACKER_FIELD_RE = /(\*\*(?:Tracker|GitHub)\*\*:[ \t]*)(.+)/;
const UNASSIGNED = "<unassigned>";

class Die extends Error {}
const die = (msg) => { throw new Die(msg); };
const read = (p) => fs.readFileSync(p, "utf8");
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (p) => (isDir(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const subfiles = (p) => (isDir(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort() : []);
const posix = (p) => p.split(path.sep).join("/");

// --------------------------------------------------------------------------
// Tracker config
// --------------------------------------------------------------------------
function tracker() {
  if (!fs.existsSync(TRACKER_MD)) die(`${posix(path.relative(ROOT, TRACKER_MD))} not found, run spec-init first`);
  const config = readTracker(read(TRACKER_MD));
  if (config.mode === "local") die("tracker.md declares a local (or unknown) tracker, nothing to publish to");
  if (config.mode === "gitlab" && !(config.project && config.projectId)) die("tracker.md is GitLab mode but **Project**: / **Project ID**: are unset");
  return config;
}

// --------------------------------------------------------------------------
// Plan-tree parsing. The shapes are verifier-enforced by verify-plan-tree.mjs.
// --------------------------------------------------------------------------
function parseIssue(file) {
  const text = read(file);
  const title = /^# (.+)/.exec(text)?.[1];
  const type = /\*\*Type\*\*: (\w+)/.exec(text)?.[1];
  const ref = TRACKER_FIELD_RE.exec(text)?.[2];
  if (!title || !type || !ref) die(`${file}: missing H1 / **Type** / **Tracker**, run verify-plan-tree.mjs`);

  const section = (name) => new RegExp(`## ${name}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |(?![\\s\\S]))`).exec(text)?.[1]?.trim() ?? "";
  const what = section("What to build");
  const name = path.basename(file);
  return {
    file,
    title: title.trim(),
    type,
    ref: ref.trim(),
    status: /\*\*Status\*\*:[ \t]*(\S+)/.exec(text)?.[1] ?? "not-started",
    what,
    criteria: section("Acceptance criteria"),
    deps: [...section("Blocked by").matchAll(/\]\(\.\/([0-9]{2}_issue_[A-Z0-9-]+\.md)\)/g)].map((m) => m[1]),
    anchors: [...what.matchAll(/\]\((?:\.\.\/)+spec\/([^)]+)\)/g)].map((m) => m[1]),
    // A HITL issue whose job is a decision gets the `decision` label on GitLab.
    decision: type === "HITL" && (/\bDecide\b/.test(what) || name.includes("DECISION") || name.includes("DECIDE")),
  };
}

export function toposort(issues) {
  const byName = new Map(issues.map((i) => [path.basename(i.file), i]));
  const done = new Set();
  const order = [];
  const visit = (i, stack) => {
    const n = path.basename(i.file);
    if (done.has(n) || stack.has(n)) return; // a cycle falls back to numeric order
    for (const d of i.deps) if (byName.has(d)) visit(byName.get(d), new Set([...stack, n]));
    done.add(n);
    order.push(i);
  };
  for (const i of [...issues].sort((a, b) => path.basename(a.file).localeCompare(path.basename(b.file)))) visit(i, new Set());
  return order;
}

function loadTree() {
  const sprints = [];
  for (const eName of subdirs(PLAN).filter((n) => /^\d{2}-/.test(n))) {
    const epic = path.join(PLAN, eName);
    for (const sName of subdirs(epic).filter((n) => /^\d{2}-/.test(n))) {
      const sprint = path.join(epic, sName);
      const files = subfiles(path.join(sprint, "issues")).filter((n) => n.endsWith(".md")).map((n) => path.join(sprint, "issues", n));
      if (!files.length) continue;
      sprints.push({
        enum: eName.slice(0, 2), eslug: eName.slice(3), snum: sName.slice(0, 2), sslug: sName.slice(3),
        sprintMd: path.join(sprint, "sprint.md"),
        issues: toposort(files.map(parseIssue)),
      });
    }
  }
  return sprints;
}

const coordsOf = (s, i) => `${s.enum}-${s.snum}-${path.basename(i.file).slice(0, 2)}`;
const unpublished = (i) => refNumber(i.ref) === null;

/** Every already-published issue file mapped to its number, across all sprints, so a cross-sprint blocker resolves. */
function publishedRefs(allSprints) {
  const refs = new Map();
  for (const s of allSprints) for (const i of s.issues) if (!unpublished(i)) refs.set(i.file, refNumber(i.ref));
  return refs;
}

/** The ticket body, from the plan file. A blocker is cited by its `#NNN` once it has one. */
export function buildBody(issue, refs) {
  const what = issue.what.replace(/\[([^\]]+)\]\((?:\.\.\/)+spec\/([^)]+)\)/g, "$1 (`.agents/plan/spec/$2`)");
  const blocked = issue.deps.map((dep) => {
    const ref = refs.get(path.join(path.dirname(issue.file), dep));
    return ref ? `- #${ref} ${dep.slice(9, -3).replaceAll("-", " ").toLowerCase()}` : `- ${dep} (unpublished)`;
  });
  const anchors = [...new Set(issue.anchors)].map((a) => `Spec anchor: \`.agents/plan/spec/${a}\``).join("\n");
  return `## What to build\n\n${what}\n\n${anchors ? `${anchors}\n\n` : ""}`
    + `## Acceptance criteria\n\n${issue.criteria}\n\n`
    + `## Blocked by\n\n${blocked.length ? blocked.join("\n") : "- None"}\n\n`
    + `---\n*Plan file: \`${posix(path.relative(ROOT, issue.file))}\`. The plan tree is the source of truth.*`;
}

/** Writes `#NNN` into the issue file's tracker field and its row of the sprint table. */
function backfill(sprint, issue, num) {
  fs.writeFileSync(issue.file, read(issue.file).replace(TRACKER_FIELD_RE, (_m, lead) => `${lead}#${num}`));
  if (!fs.existsSync(sprint.sprintMd)) return;
  const row = `(issues/${path.basename(issue.file)})`;
  const lines = read(sprint.sprintMd).split(/(?<=\n)/).map((line) => (line.includes(row) && line.includes(UNASSIGNED) ? line.replace(UNASSIGNED, `#${num}`) : line));
  fs.writeFileSync(sprint.sprintMd, lines.join(""));
}

/** A short wait between creates, so a sprint's worth of tickets does not read as abuse to the forge. */
const pause = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------
function cmdPublish(args, io) {
  const config = tracker();
  const provider = providerFor(config, ROOT, io);
  if (!args.dryRun && !io.run) {
    const cli = checkCli(provider, io);
    if (!cli.ok) die(cli.hint);
  }

  const allSprints = loadTree();
  let sprints = allSprints;
  if (args.sprint) {
    sprints = allSprints.filter((s) => `${s.enum}-${s.snum}` === args.sprint);
    if (!sprints.length) die(`sprint ${args.sprint} not found in the plan tree`);
  } else if (!args.all) {
    sprints = allSprints.filter((s) => s.issues.some(unpublished)).slice(0, 1);
    if (!sprints.length) { io.log("nothing to publish, every issue already has a ref"); return 0; }
  }

  const refs = publishedRefs(allSprints);
  const total = sprints.reduce((n, s) => n + s.issues.length, 0);
  const pending = sprints.reduce((n, s) => n + s.issues.filter(unpublished).length, 0);
  const scope = args.sprint || (args.all ? "ALL sprints" : `${sprints[0].enum}-${sprints[0].snum} (lazy default)`);
  io.log(`publishing ${scope}: ${total} issues, ${pending} unpublished, tracker=${config.mode}`);

  if (args.dryRun) {
    for (const s of sprints) {
      const row = s.issues.map((i) => `${path.basename(i.file).slice(0, 2)}${i.decision ? "*" : ""}(${refs.has(i.file) ? `#${refs.get(i.file)}` : "new"})`).join(", ");
      io.log(`  ${s.enum}-${s.snum} ${s.sslug}: ${row}`);
    }
    return 0;
  }

  const state = {};
  let created = 0, skipped = 0;
  const failures = [];
  for (const s of sprints) {
    for (const i of s.issues) {
      if (refs.has(i.file)) { skipped++; continue; }
      const made = createTicket(provider, config, s, i, buildBody(i, refs), state, io);
      if (!made.ok) {
        failures.push({ issue: posix(path.relative(ROOT, i.file)), error: made.error, hint: made.hint });
        io.log(`FAIL ${path.basename(i.file)}: ${made.hint}`);
        continue;
      }
      for (const what of made.made ?? []) io.log(`${what} created`);
      const num = String(made.value.number);
      refs.set(i.file, num);
      backfill(s, i, num);
      created++;
      io.log(`#${num}  ${s.enum}-${s.snum}/${path.basename(i.file)}`);
      pause(io.pauseMs ?? 150);
    }
  }
  io.log(JSON.stringify({ created, skipped, failures }));
  return failures.length ? 1 : 0;
}

/** The published issue a `sync` argument names: coordinates, `#NNN`, or a bare number. */
function findPublished(allSprints, target) {
  const byCoords = /^\d{2}-\d{2}-\d{2}$/.test(target);
  const num = byCoords ? null : /^#?(\d+)$/.exec(target)?.[1];
  if (!byCoords && !num) die(`sync takes <EE-SS-II> or <#NNN> (got '${target}')`);
  for (const s of allSprints) {
    for (const i of s.issues) {
      if (byCoords ? coordsOf(s, i) === target : refNumber(i.ref) === num) return i;
    }
  }
  return die(byCoords ? `no plan issue ${target}` : `no plan issue carries **Tracker**: #${num}`);
}

function cmdSync(args, io) {
  if (!args.target) die("sync takes <EE-SS-II> or <#NNN>");
  const config = tracker();
  const allSprints = loadTree();
  const issue = findPublished(allSprints, args.target);
  const num = refNumber(issue.ref);
  if (!num) die(`${args.target} is not published yet (its **Tracker** is ${issue.ref}); publish it instead`);
  const body = buildBody(issue, publishedRefs(allSprints));
  io.log(`sync #${num} <- ${posix(path.relative(ROOT, issue.file))}`);
  if (args.dryRun) { io.log(body); return 0; }
  const r = rebuildTicket(providerFor(config, ROOT, io), num, { title: issue.title, body }, io);
  if (!r.ok) { io.log(`FAIL #${num}: ${r.hint}`); return 1; }
  io.log("synced (title and body rebuilt; labels, milestone and state untouched)");
  return 0;
}

function cmdStatus(args, io) {
  const config = tracker();
  const provider = providerFor(config, ROOT, io);
  let sprints = loadTree();
  if (args.sprint) {
    sprints = sprints.filter((s) => `${s.enum}-${s.snum}` === args.sprint);
    if (!sprints.length) die(`sprint ${args.sprint} not found in the plan tree`);
  }
  const rows = [];
  for (const s of sprints) {
    for (const i of s.issues) {
      const num = refNumber(i.ref);
      if (!num) { rows.push({ coords: coordsOf(s, i), ref: null, plan: i.status, tracker: "unpublished", agrees: true }); continue; }
      const seen = trackerState(provider, num, io);
      rows.push(seen.ok
        ? { coords: coordsOf(s, i), ref: `#${num}`, plan: i.status, tracker: seen.value.state, agrees: agrees(seen.value.state, i.status) }
        : { coords: coordsOf(s, i), ref: `#${num}`, plan: i.status, tracker: `unread (${seen.error})`, agrees: null, hint: seen.hint });
    }
  }
  const off = rows.filter((r) => r.agrees === false);
  if (args.json) io.log(JSON.stringify(rows, null, 2));
  else {
    for (const r of rows) io.log(`${r.coords}  ${(r.ref ?? "-").padEnd(6)}  plan=${r.plan}  tracker=${r.tracker}${r.agrees === false ? "  DISAGREE" : ""}`);
    const unread = rows.filter((r) => r.agrees === null).length;
    io.log(`${rows.length} issue(s), ${off.length} disagreement(s)${unread ? `, ${unread} not read` : ""}`);
  }
  return off.length ? 1 : 0;
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------
/** `io` is the provider's `{ run, env }` plus `log`: a test hands in a runner in place of gh and glab. */
export function run(rawArgv, io = {}) {
  const out = { log: (line) => console.log(line), ...io };
  const argv = rawArgv.length ? [...rawArgv] : ["publish"];
  const verb = ["publish", "sync", "status"].includes(argv[0]) ? argv.shift() : "publish";
  const args = { all: false, sprint: null, dryRun: false, json: false, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all" && verb === "publish") args.all = true;
    else if (a === "--dry-run" && verb !== "status") args.dryRun = true;
    else if (a === "--json" && verb === "status") args.json = true;
    else if (a === "--sprint" && verb !== "sync") args.sprint = argv[++i];
    else if (a.startsWith("--sprint=") && verb !== "sync") args.sprint = a.slice("--sprint=".length);
    else if (a === "--iid" && verb === "sync") args.target = argv[++i];
    else if (a.startsWith("--iid=") && verb === "sync") args.target = a.slice("--iid=".length);
    else if (verb === "sync" && !a.startsWith("--") && !args.target) args.target = a;
    else die(`unknown argument '${a}'`);
  }
  if (verb === "sync") return cmdSync(args, out);
  if (verb === "status") return cmdStatus(args, out);
  return cmdPublish(args, out);
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof Die)) throw e;
    process.stderr.write(`error: ${e.message}\n`);
    process.exitCode = 2;
  }
}
