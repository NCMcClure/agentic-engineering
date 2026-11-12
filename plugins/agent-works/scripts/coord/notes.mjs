#!/usr/bin/env node
// aw note, aw notes: short notes between agents. One line per note,
// `<stamp>  <who>  <text>`, on <store>/projects/<project id>/notes.log, or on
// <store>/notes.log for the machine's. A log rotates into `notes.log.1`.
import { AwError, emit, intArg, ioOf, parseArgs, runMain } from "../../lib/common.mjs";
import { budget } from "../../lib/config.mjs";
import * as store from "./store.mjs";

const USAGE = `usage: aw note "<text>" [--machine] [--as AGENT] [--json]
       aw notes [N] [--project P | --all | --machine] [--json]

Short notes between agents: what you merged that others must pull, what you wait for, what you left running.

  aw note "<text>" [--machine] [--as AGENT]
        one line on this project's notes log (--machine: on the machine's, read by every project)
  aw notes [N] [--project P | --all | --machine] [--json]
        the last N notes (default 30) of this project; of project P (its id, its folder name, or a prefix);
        of every project and the machine together; or of the machine alone

A note is one line: budgets.noteChars (200) at most, and a longer one is refused. A text that starts with a dash
goes after a double dash: aw note -- "- like this". Detail belongs in a kanban card,
a memory or a file, with the note pointing at it. Logs rotate (one older generation is kept), so a note is not a
record: what must last goes in the project's memory.

Options:
  --machine      note: write on the machine's log; notes: read it
  --as AGENT     the agent's name (default: the agent variable, else session-<pid>)
  --project P    notes: a project's id, folder name, or a prefix of either
  --all          notes: every project's notes and the machine's, by time
  --json         print one JSON document`;

function rowsOf(home, project, where) {
  return store.logLines(store.notePath(home, project)).map((line) => {
    const [at, agent = "", ...text] = line.split("  ");
    return { at, project, where, agent, text: text.join("  ") };
  });
}

/**
 * Notes as rows of `{ at, project, where, agent, text }`, oldest first: this project's; with `project`, the one it
 * names; with `everything`, every project's and the machine's by time; with `machine`, the machine's alone.
 */
export function read(ctx, { project = null, everything = false, machine = false } = {}) {
  const { home } = ctx;
  const known = store.projects(home);
  if (machine) return rowsOf(home, null, "machine");
  if (everything) {
    const ids = [...new Set([...Object.keys(known), ...store.projectFolders(home)])].sort();
    const rows = rowsOf(home, null, "machine");
    for (const id of ids) rows.push(...rowsOf(home, id, store.projectLabel(id, known)));
    return rows
      .map((row, i) => [row, i])
      .sort(([a, i], [b, j]) => (a.at < b.at ? -1 : a.at > b.at ? 1 : i - j)) // stamps sort as text
      .map(([row]) => row);
  }
  if (project) {
    const hits = store.findProject(home, project);
    if (hits.length !== 1) {
      throw new AwError(`notes: project '${project}': ${hits.length ? `several match (${hits.join(", ")})`
        : "none seen on this machine (aw who lists the projects with agents; --all reads every log)"}`);
    }
    return rowsOf(home, hits[0], store.projectLabel(hits[0], known));
  }
  return rowsOf(home, ctx.project, ctx.name);
}

async function note(argv, io) {
  const { values, positionals, rest } = parseArgs(argv, { machine: { type: "boolean" }, as: { type: "string" }, json: { type: "boolean" } });
  const words = [...positionals, ...(rest ?? [])]; // a text that starts with a dash goes after `--`
  if (words.length > 1) throw new AwError(`note: one text, in quotes: aw note "<text>" (unexpected '${words[1]}')`);
  const ctx = store.context(io, values.as ?? null);
  const text = String(words[0] ?? "").split(/\s+/).filter(Boolean).join(" ");
  const limit = budget(ctx.cfg, "noteChars");
  if (!text) throw new AwError('note: say something: aw note "<text>"');
  if ([...text].length > limit) {
    throw new AwError(`note: ${[...text].length} characters, and a note is one line of at most ${limit} `
      + "(budgets.noteChars). Put the detail in a kanban card, a memory or a file and point at it.");
  }
  ctx.stamp();
  const rotateAt = store.setting(ctx.cfg, "logBytes");
  const line = values.machine
    ? store.appendNote(ctx.home, null, `${ctx.agent}@${ctx.name}`, text, rotateAt)
    : store.appendNote(ctx.home, ctx.project, ctx.agent, text, rotateAt);
  store.say(io, { line, where: values.machine ? "machine" : ctx.project }, values.json, line);
  return 0;
}

async function notes(argv, io) {
  const { values, positionals } = parseArgs(argv, {
    project: { type: "string" }, all: { type: "boolean" }, machine: { type: "boolean" }, json: { type: "boolean" },
  });
  if (positionals.length > 1) throw new AwError(`notes: unexpected '${positionals[1]}'`);
  if ([values.project, values.all, values.machine].filter(Boolean).length > 1) throw new AwError("notes: one of --project, --all, --machine");
  const n = intArg(positionals[0], "N", 30);
  const ctx = store.context(io);
  const all = read(ctx, { project: values.project ?? null, everything: values.all === true, machine: values.machine === true });
  const rows = n > 0 ? all.slice(-n) : [];
  const lines = rows.map((r) => `${r.at}  ${values.all ? `[${r.where}]  ` : ""}${r.agent}  ${r.text}`);
  store.say(io, { notes: rows }, values.json, lines.length ? lines.join("\n") : "(no notes)");
  return 0;
}

/** `aw note ...` and, called as `notes`, `aw notes ...`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  const own = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
  if (own.includes("--help") || own.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  return io.command === "notes" ? notes(argv, io) : note(argv, io);
}

runMain(import.meta.url, main, "aw note");
