#!/usr/bin/env node
// SessionStart (startup, resume, clear, compact) and SubagentStart: this
// plugin's critical lines, through the kernel (critical-context.mjs), with two
// things of its own in front. A subagent gets the lines marked for every agent
// and neither of the two.
//
// A migration, main session only, in a repo that carries
// .agents/agent-works.json. The plugin's defaults changed with 1.0, so what a
// repo relied on without saying is written down, and nothing loosens:
//   - a config that does not name `claude.twins` behaved as `generated`;
//   - the guard refused a resource's command run outside its lock, and by
//     default now only warns (`guard.locks`);
//   - a board folder with committed files is a shared, tracked board.
// The kernel's `write` never overwrites, so the keys the config lacks go into
// a new file, .agents/retired/agent-works/config-additions.json, and the model
// is told to merge them. A board still in .agents/board moves to the folder
// the config names. A second run finds nothing to do and says nothing.
//
// A briefing, main session only, a few lines at most:
//   - in a repo with the config: the CLAUDE.md twins are healed when they are
//     generated ones (a fresh checkout or worktree has none), and when the
//     root one had to be written the model is told to read AGENTS.md now; the
//     session is registered as running (`aw who`); while the additions file
//     waits to be merged, one line says so;
//   - with a board: in a worktree whose branch a card names, which card this
//     session is working, its done criteria and the command that prints its
//     brief; anywhere else, the board in one line. After a compaction that
//     line is how a round comes back from the board instead of from memory.
// No board folder, or no cards: nothing about the board.
//
// The modules that read the board and the machine's store are imported only
// when there is something for them to read. No network. Fail open, exit 0.
import fs from "node:fs";
import path from "node:path";
import { run } from "./critical-context.mjs";

const CONFIG = ".agents/agent-works.json";
const RETIRED = ".agents/retired/agent-works";
const ADDITIONS = `${RETIRED}/config-additions.json`;
const AW = path.join(import.meta.dirname, "..", "scripts", "aw.mjs");
const POINTER = "The board is the record: /agent-works:orchestrate resumes it.";
// The longest each part of the briefing may be, so the whole stays a few lines.
const BOARD_CHARS = 240;
const TITLE_CHARS = 50;
const CRITERIA_CHARS = 100;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// What each key of the additions file keeps as it was, for whoever merges it.
const WHY = {
  "claude.twins": "a config that does not name it now means a tracked symlink, and this repo's twins were generated files",
  "guard.locks": "the guard now only warns about a resource's command run outside its lock, and refused it before",
  "kanban.tracked": "the board folder is now kept out of git unless the config says it is shared, and this repo commits its board",
};

/** The dotted keys of `add` that `own` does not name. */
function missing(own, add) {
  const keys = [];
  for (const [block, values] of Object.entries(isObject(add) ? add : {})) {
    for (const key of Object.keys(isObject(values) ? values : {})) {
      if (!isObject(own?.[block]) || own[block][key] === undefined) keys.push(`${block}.${key}`);
    }
  }
  return keys;
}

/** What is looser while the additions wait: only the guard, since the hook and the board keep the other two as they were. */
// The config reader already counts the waiting keys, so nothing changes in the meantime.
const interim = (keys) => (keys.length ? " They apply already; merging makes the config say so." : "");

// ---- migration -----------------------------------------------------------

let wroteAdditions = false;

async function migrate({ root, move, write }) {
  // Recognised by the one file only this plugin writes; without it there is nothing to keep.
  const own = readJson(path.join(root, CONFIG));
  if (!isObject(own)) return "";
  const { DEFAULTS, OLD_BOARD } = await import("../lib/config.mjs");
  const { git, mainRoot } = await import("../lib/common.mjs");
  const notes = [];

  // The board lives in the main checkout, so only a session there moves it.
  const named = typeof own.paths?.kanban === "string" && own.paths.kanban.trim() ? own.paths.kanban.trim() : DEFAULTS.paths.kanban;
  const folder = named.replace(/\\/g, "/").replace(/\/+$/, "");
  const inMain = real(mainRoot(root) ?? root) === real(root);
  const oldThere = fs.existsSync(path.join(root, OLD_BOARD, "board.json"));
  const newThere = !path.isAbsolute(folder) && fs.existsSync(path.join(root, folder));
  let tracked = null;
  const isTracked = () => {
    tracked ??= git(["ls-files", "--", OLD_BOARD, ...(path.isAbsolute(folder) ? [] : [folder])], root, { timeoutMs: 2000 })[1].trim() !== "";
    return tracked;
  };
  if (inMain && oldThere && !newThere && !path.isAbsolute(folder) && folder !== OLD_BOARD) {
    const shared = own.kanban?.tracked === true || isTracked();
    if (move(OLD_BOARD, folder) === "moved" && !shared) {
      notes.push(`The board in ${folder}/ is working state, kept out of git: leave it out of the commit.`);
    }
  }

  const add = {};
  if (!isObject(own.claude) || !own.claude.twins) add.claude = { twins: "generated" };
  if (!isObject(own.guard) || own.guard.locks === undefined) add.guard = { locks: "deny" };
  if ((!isObject(own.kanban) || own.kanban.tracked === undefined) && (oldThere || newThere) && isTracked()) add.kanban = { tracked: true };
  const keys = missing(own, add);
  if (keys.length && write(ADDITIONS, json(add))) {
    wroteAdditions = true;
    notes.unshift(`Version 1.0 changed three defaults, and ${ADDITIONS} holds what this repo relied on without saying. Merge its keys into ${CONFIG} now, `
      + `keeping everything that file already holds, then delete ${ADDITIONS}: ${keys.map((k) => `\`${k}\` (${WHY[k]})`).join("; ")}.${interim(keys)}`);
  }
  return notes.join(" ");
}

// ---- briefing ------------------------------------------------------------

/** The twins healed where they are generated ones, the session registered, and the lines either leaves to say. */
async function setUp(cwd, payload) {
  const { loadConfig } = await import("../lib/config.mjs");
  const cfg = loadConfig(cwd);
  if (!cfg._path) return [];
  const lines = [];
  const waiting = missing(readJson(cfg._path), readJson(path.join(cfg._root, ADDITIONS)));
  try {
    const twins = await import("../scripts/twins.mjs");
    // While the additions wait to be merged they decide the form, so a fresh worktree still gets its twins.
    const keep = waiting.includes("claude.twins") ? { ...cfg, _path: path.join(cfg._root, ADDITIONS) } : cfg;
    if (twins.modeOf(keep) === "generated" && twins.heal(cfg._root, keep, { orphans: false }).root_created) {
      lines.push("This checkout had no CLAUDE.md, so the project's guidance was not loaded: read AGENTS.md at the repository root now, "
        + "before anything else. (Its twin is written now; later sessions load it.)");
    }
  } catch { /* the session goes on without its twins */ }
  try {
    const [agents, store] = await Promise.all([import("../scripts/coord/agents.mjs"), import("../scripts/coord/store.mjs")]);
    agents.start(store.context({ cwd, env: process.env }), { session: typeof payload.session_id === "string" && payload.session_id ? payload.session_id : null });
  } catch { /* the machine's store is an aid, never a reason to fail */ }
  if (waiting.length && !wroteAdditions) lines.push(`${ADDITIONS} still waits to be merged into ${CONFIG} (${waiting.join(", ")}), then deleted.${interim(waiting)}`);
  return lines;
}

/** One line about the board, or about the card this worktree is working; "" without a board or cards. */
async function boardLine(cwd) {
  const { locate, readFullBoard } = await import("../scripts/io.mjs");
  const loc = locate(cwd);
  if (!isDir(loc.dir)) return "";
  const board = readFullBoard(loc);
  if (!board.cards.length) return "";
  const { briefLine, isFinished, summary } = await import("../lib/board.mjs");
  const mine = loc.toplevel !== loc.main && loc.branch ? board.cards.find((c) => c.branch === loc.branch && !isFinished(board, c)) : null;
  if (!mine) return `${clip(briefLine(summary(board, Date.now())), BOARD_CHARS)} ${POINTER}`;
  const { doneCriteria } = await import("../lib/cards.mjs");
  const criteria = doneCriteria(mine.body).split("\n").map((l) => l.replace(/^\s*[-*]\s+(\[.\]\s+)?/, "").trim()).filter(Boolean).join("; ");
  return `You are working card ${mine.id} "${clip(String(mine.title), TITLE_CHARS)}".${criteria ? ` Done when: ${clip(criteria, CRITERIA_CHARS)}.` : ""} `
    + `Its brief: node "${AW}" board brief ${mine.id}. Cadence: /agent-works:work-card; end your final message with the CARD line.`;
}

/** A cheap look for a board folder, so a repo without one never loads the board's modules. */
async function mayHaveBoard(cwd) {
  const { boardDir, loadConfig } = await import("../lib/config.mjs");
  const { mainRoot, projectRoot } = await import("../lib/common.mjs");
  return isDir(boardDir(loadConfig(cwd), mainRoot(cwd) ?? projectRoot(cwd)));
}

async function briefing(payload, state) {
  const cwd = [payload.cwd, state.root].find((dir) => typeof dir === "string" && dir && isDir(dir));
  if (!cwd) return "";
  const lines = [];
  try { lines.push(...await setUp(cwd, payload)); } catch { /* the board line still goes out */ }
  try { if (await mayHaveBoard(cwd)) lines.push(await boardLine(cwd)); } catch { /* no board line */ }
  return lines.filter(Boolean).join(" ");
}

await run(briefing, { migrate });
