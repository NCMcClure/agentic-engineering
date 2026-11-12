#!/usr/bin/env node
// aw status: where the project stands, derived from where the facts live. Nothing here is written by hand.
//
//   aw status [--json] [--merges N]
//
//   the board    the active sprint, the open epics with their progress, cards per column of the board's folder,
//                the open ones by title, and the gates still owed
//   resources    locks held, leases in force and counters claimed, from the machine-wide store
//   done         the last merges on this branch (git log), which is the project's record of what is finished
//   status file  the status memory's place and size (its text is the goal and the current focus)
//
// Each part is left out when its source is absent (no board, no git). The board and the store are read through
// the modules that own them, imported only here and only when asked for: a part whose module cannot be had says
// so, and the rest prints.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  awHome, currentBranch, emit, git, intArg, ioOf, mainRoot, parseArgs, parseFrontmatter, posix, projectId, projectRoot, readJson, readText, runMain,
} from "../lib/common.mjs";
import { boardDir, budget, loadConfig } from "../lib/config.mjs";
import { scan as scanMemory } from "./memory.mjs";

const USAGE = `usage: aw status [--json] [--merges N]

Where the project stands, derived from where the facts live.

  --json      one JSON document: { project, root, branch, statusFile, board, coordination, done }
  --merges N  how many merges to list (default 20)

  the board    the active sprint, the open epics with their progress, cards per column, the open ones by title,
               and the gates still owed
  resources    locks held, leases in force and counters claimed, from the machine-wide store
  done         the last merges on this branch (git log); a history without merge commits gives its last commits
  status file  the status memory's place and size

Each part is left out when its source is absent (no board, no git).`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const text = (v) => (v === null || v === undefined ? "" : String(v));

// ------------------------------------------------------------------------------------ the modules read through
// Each is beside this file and belongs to another part of the plugin. `[module, why not]`: one of the two is null.

async function load(file) {
  const full = path.join(HERE, file);
  if (!fs.existsSync(full)) return [null, `scripts/${file} is missing`];
  try {
    return [await import(pathToFileURL(full).href), null];
  } catch (e) {
    return [null, `scripts/${file}: ${e?.name ?? "Error"}: ${e?.message ?? e}`];
  }
}

/** What this command asks of the board and the store: the module, the export, and how it is called. `home` is the machine-wide store. */
const SOURCES = {
  // readBoard(dir) -> { columns: [{ id, title, role }], sprints: [{ id, title, state, end, goal }], cards: [card] }
  board: { file: "io.mjs", name: "readBoard", call: (fn, { dir }) => fn(dir) },
  // allLocks(home) -> [{ resource, scope, held, agent, project, for, since }]
  locks: { file: "locks.mjs", name: "allLocks", call: (fn, { home }) => fn(home) },
  // live(home, { prune: false }) -> [{ resource, agent, project, share, mem, for, since }]
  leases: { file: "coord/leases.mjs", name: "live", call: (fn, { home }) => fn(home, { prune: false }) },
  // read(home, project) -> { <counter>: { floor, claims: [{ agent, value, for, since }] } }
  claims: { file: "coord/claims.mjs", name: "read", call: (fn, { home, project }) => fn(home, project) },
};

/** `[what the source answered, why it could not]`. `mods` may hand in a module by its key (a test does). */
async function ask(key, args, mods) {
  const source = SOURCES[key];
  let mod = mods?.[key];
  if (mod === undefined) {
    const [loaded, why] = await load(source.file);
    if (loaded === null) return [null, why];
    mod = loaded;
  }
  if (typeof mod?.[source.name] !== "function") return [null, `scripts/${source.file} exports no ${source.name}`];
  try {
    return [await source.call(mod[source.name], args), null];
  } catch (e) {
    return [null, `scripts/${source.file}: ${source.name} failed: ${e?.message ?? e}`];
  }
}

// ------------------------------------------------------------------------------------------------------ the board

/** A progress bar of `width` cells and the count beside it: `▰▰▰▱▱▱▱▱ 3/8`. */
export function progressBar(done, total, width = 8) {
  const filled = total === 0 ? 0 : Math.floor((done / total) * width + 0.5);
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)} ${done}/${total}`;
}

/** One line for a sprint: `Sprint s2 "Title" (active, ends 2026-01-31): the goal`. */
export function sprintLine(sprint) {
  const when = sprint.end ? `, ends ${sprint.end}` : "";
  const goal = sprint.goal ? `: ${sprint.goal}` : "";
  return `Sprint ${sprint.id} "${sprint.title}" (${sprint.state}${when})${goal}`;
}

const cardOf = (c, fallbackTitle = "") => ({
  id: text(c.id), title: text(c.title) || fallbackTitle, status: text(c.status), kind: text(c.kind) || "task", owner: text(c.owner),
  needs: text(c.needs), ref: text(c.ref), priority: text(c.priority), updated: text(c.updated), epic: text(c.epic), sprint: text(c.sprint),
});

/** The board from its files alone: `board.json` and each card's frontmatter. */
function boardFromFiles(folder) {
  const doc = readJson(path.join(folder, "board.json"), {}) ?? {};
  const cards = [];
  let names = [];
  try { names = fs.readdirSync(folder).filter((n) => n.endsWith(".md")).sort(); } catch { /* no cards */ }
  for (const name of names) {
    const [f] = parseFrontmatter(readText(path.join(folder, name), "") ?? "");
    if (f && f.id && f.status) cards.push({ ...f, title: f.title || name.slice(0, -3) });
  }
  return { columns: doc.columns, sprints: doc.sprints, cards };
}

/**
 * The board of the project at `root`, or null when it has none: `{ dir, done, columns: [{ id, title, count }],
 * cards, gates, sprint, epics }`, through the board's own reader, or from the cards' frontmatter when that reader
 * cannot be had. The folder is the main checkout's, so every work tree sees one board.
 */
export async function board(root, cfg = null, mods = null) {
  const config = cfg ?? loadConfig(root);
  const folder = boardDir(config, mainRoot(root) ?? projectRoot(root));
  if (!isDir(folder)) return null;
  const [read] = await ask("board", { dir: folder }, mods);
  const viaBoard = isObject(read) && Array.isArray((read.config ?? read).columns) && Array.isArray(read.cards);
  const raw = viaBoard ? { ...(read.config ?? read), cards: read.cards } : boardFromFiles(folder);
  const listed = (Array.isArray(raw.columns) ? raw.columns : []).filter(isObject);
  const columns = listed.map((c) => ({ id: c.id, title: c.title || c.id }));
  const doneIds = listed.filter((c) => c.role === "done" || c.done).map((c) => c.id);
  const done = doneIds[0] ?? (viaBoard ? listed.at(-1)?.id ?? null : "done");
  const cards = raw.cards.filter(isObject).map((c) => cardOf(c));
  const finished = (c) => c.status === "archived" || doneIds.includes(c.status);

  const active = (Array.isArray(raw.sprints) ? raw.sprints : []).filter(isObject).find((s) => s.state === "active") ?? null;
  const sprint = active ? { ...active, line: sprintLine(active) } : null;
  const order = new Map(raw.cards.filter(isObject).map((c) => [text(c.id), Number.isFinite(Number(c.order)) ? Number(c.order) : Infinity]));
  const epics = cards.filter((c) => c.kind === "epic" && !finished(c))
    .sort((a, b) => order.get(a.id) - order.get(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => {
      const children = cards.filter((c) => c.epic === e.id && c.kind !== "epic" && c.status !== "suggested");
      const n = children.filter(finished).length;
      return { id: e.id, title: e.title, done: n, total: children.length, bar: progressBar(n, children.length) };
    });

  const known = columns.map((c) => c.id);
  for (const c of cards) {
    if (!known.includes(c.status)) {
      known.push(c.status);
      columns.push({ id: c.status, title: c.status });
    }
  }
  for (const col of columns) col.count = cards.filter((c) => c.status === col.id).length;
  const gates = cards.filter((c) => c.kind === "gate" && c.status !== done);
  return { dir: posix(folder), done, columns, cards, gates, sprint, epics };
}

// ------------------------------------------------------------------------------------------------- the store

const pick = (row, keys) => Object.fromEntries(keys.filter((k) => row?.[k] !== null && row?.[k] !== undefined).map((k) => [k, row[k]]));

/**
 * Locks, leases and claims of this project and the machine: `{ locks, leases, claims }`, with `unavailable:
 * { <part>: why }` for each part that could not be read. Null when none of the three could.
 */
export async function coordination(root, env = process.env, mods = null) {
  const args = { home: awHome(env), project: projectId(root) };
  const { project } = args;
  const out = { locks: [], leases: [], claims: [] };
  const unavailable = {};
  const [locks, noLocks] = await ask("locks", args, mods);
  if (noLocks) unavailable.locks = noLocks;
  else {
    for (const row of Array.isArray(locks) ? locks : []) {
      if (row?.held && ["machine", project].includes(row.scope)) out.locks.push(pick(row, ["resource", "scope", "agent", "project", "for", "since"]));
    }
  }
  const [leases, noLeases] = await ask("leases", args, mods);
  if (noLeases) unavailable.leases = noLeases;
  else out.leases = (Array.isArray(leases) ? leases : []).map((l) => pick(l, ["resource", "agent", "project", "share", "mem", "for", "since"]));
  const [claims, noClaims] = await ask("claims", args, mods);
  if (noClaims) unavailable.claims = noClaims;
  else {
    for (const [name, counter] of Object.entries(isObject(claims) ? claims : {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      for (const c of counter?.claims || []) out.claims.push({ counter: name, ...pick(c, ["agent", "value", "for", "since"]) });
    }
  }
  const missing = Object.keys(unavailable).length;
  if (missing === 3) return null;
  return missing ? { ...out, unavailable } : out;
}

// ------------------------------------------------------------------------------------------- git and the memory

/** The last `n` merges on this branch; a history without merge commits (squash, rebase) gives its last commits. Null without git. */
export function merges(root, n = 20) {
  const format = "--pretty=format:%h%x09%ad%x09%s";
  let [code, out] = git(["log", "--merges", "--first-parent", `-${n}`, "--date=short", format], root);
  if (code !== 0) return null;
  let kind = "merges";
  if (!out.trim()) {
    [code, out] = git(["log", "--first-parent", `-${n}`, "--date=short", format], root);
    kind = "commits";
  }
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const at = line.indexOf("\t");
    const next = line.indexOf("\t", at + 1);
    if (at >= 0 && next >= 0) rows.push({ commit: line.slice(0, at), date: line.slice(at + 1, next), subject: line.slice(next + 1) });
  }
  return { kind, rows };
}

/** The status memory: `{ path, lines, budget, updated }`, or null when the project has none. */
export function statusFile(root, cfg) {
  try {
    for (const e of scanMemory(root, cfg).memories) {
      if (e.fields?.type === "status") return { path: e.rel, lines: e.lines, budget: budget(cfg, "statusLines"), updated: text(e.fields.updated) };
    }
  } catch { /* an unreadable tree has no status file to show */ }
  return null;
}

/** Everything `aw status` prints, as one document. `mods` hands in the board's and the store's modules (a test does). */
export async function collect(root, { merges: n = 20, env = process.env, mods = null } = {}) {
  const cfg = loadConfig(root);
  return {
    project: projectId(root), root: posix(root), branch: currentBranch(root), statusFile: statusFile(root, cfg),
    board: await board(root, cfg, mods), coordination: await coordination(root, env, mods), done: merges(root, n),
  };
}

/** The document of `collect` as the text `aw status` prints. */
export function textOf(doc) {
  const lines = [`${doc.project}   branch ${doc.branch || "(detached)"}`];
  const s = doc.statusFile;
  if (s) lines.push(`status file: ${s.path} (${s.lines}/${s.budget} lines, updated ${s.updated || "?"})`);
  const b = doc.board;
  lines.push("");
  if (b) {
    lines.push(`board: ${b.columns.map((c) => `${c.title} ${c.count}`).join(", ")}`);
    if (b.sprint) lines.push(b.sprint.line);
    for (const e of b.epics || []) lines.push(`  epic ${e.id} ${e.bar}: ${e.title}`);
    for (const col of b.columns) {
      if (col.id === b.done) continue;
      // With a sprint active, the cards listed are the sprint's: the rest wait in the backlog.
      const shown = b.cards.filter((c) => c.status === col.id && c.kind !== "gate" && c.kind !== "epic"
        && (!b.sprint || c.sprint === text(b.sprint.id) || c.status === "suggested")).slice(0, 12);
      for (const c of shown) lines.push(`  [${col.title}] ${c.id} ${c.title}${c.owner ? `  (${c.owner})` : ""}`);
    }
    if (b.gates.length) {
      lines.push(`gates owed: ${b.gates.length}`);
      for (const g of b.gates) {
        const more = [g.ref ? `for ${g.ref}` : "", g.needs ? `needs ${g.needs}` : ""].filter(Boolean).join("; ");
        lines.push(`  ${g.id} ${g.title}${more ? `  (${more})` : ""}`);
      }
    } else {
      lines.push("gates owed: none");
    }
  } else {
    lines.push("board: none here");
  }
  const c = doc.coordination;
  if (c) {
    const no = c.unavailable ?? {};
    const or = (key, said, none) => (no[key] ? `cannot be read (${no[key]})` : said || none);
    lines.push("");
    lines.push(`locks: ${or("locks", c.locks.map((l) => `${l.resource} held by ${l.agent}${l.for ? ` (${l.for})` : ""}`).join(", "), "none held")}`);
    lines.push(`leases: ${or("leases", c.leases.map((l) => `${l.resource} by ${l.agent}`).join(", "), "none")}`);
    lines.push(`claims: ${or("claims", c.claims.map((x) => `${x.counter}${x.value !== undefined ? `=${x.value}` : ""} by ${x.agent}`).join(", "), "none")}`);
  } else if (c === null) {
    lines.push("", "locks, leases, claims: cannot be read here (the lock and coordination commands are not available)");
  }
  const d = doc.done;
  if (d) {
    lines.push("");
    lines.push(`done (the last ${d.rows.length} ${d.kind} on this branch):`);
    for (const r of d.rows) lines.push(`  ${r.date} ${r.commit} ${r.subject.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  return lines.join("\n");
}

/**
 * What a session briefing says of the document of `collect`, a line each and only what is there: the board's
 * counts with the gates owed, the active sprint, the locks held. "" when there is nothing to say.
 */
export function brief(doc) {
  const lines = [];
  const b = doc.board;
  if (b) {
    const owed = b.gates.length ? `; gates owed: ${b.gates.map((g) => `${g.id} ${g.title}`).join(", ")}` : "";
    lines.push(`board: ${b.columns.map((c) => `${c.title} ${c.count}`).join(", ")}${owed}`);
    if (b.sprint) lines.push(b.sprint.line);
  }
  const held = doc.coordination?.locks ?? [];
  if (held.length) lines.push(`locks: ${held.map((l) => `${l.resource} held by ${l.agent}${l.for ? ` (${l.for})` : ""}`).join(", ")}`);
  return lines.join("\n");
}

export async function main(argv, io) {
  io = ioOf(io);
  const { values, help } = parseArgs(argv, { json: { type: "boolean" }, merges: { type: "string" } });
  if (help) {
    emit(io, USAGE);
    return 0;
  }
  const doc = await collect(projectRoot(io.cwd), { merges: intArg(values.merges, "--merges", 20), env: io.env });
  emit(io, doc, values.json === true, values.json ? null : textOf(doc));
  return 0;
}

runMain(import.meta.url, main);
