#!/usr/bin/env node
// aw: the one command line of agent-works.
//
//   node aw.mjs <command> [args]     aw --help lists the commands; aw <command> --help explains one
//
// Each command is a module beside this file that exports `async main(argv, io)`
// and resolves to the exit code. `argv` is what followed the command, untouched;
// `io` is { cwd, env, stdout, stderr, command }, `command` being the name the
// module was called by (several share a module). A module is imported only when
// its command is asked for, and one that is missing or fails to import is
// listed as unavailable and never breaks the others.
//
// Exit codes: 0 clean, 1 warnings or not now, 2 critical or a usage error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emit, fail, ioOf, pluginVersion, runCli, runCommand, runMain } from "../lib/common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Every command: the module that holds it (beside this file), the names it answers to, and its line in `aw --help`. */
export const MODULES = [
  { file: "setup.mjs", commands: ["setup"], text: "set a repository up for agent work, or adopt an existing one (--plan, --apply)" },
  { file: "doctor.mjs", commands: ["doctor"], text: "run every check: sizes, duplication, staleness, agent files in the user docs" },
  { file: "status.mjs", commands: ["status"], text: "derived status: the board, owed gates, locks, claims, recent merges" },
  { file: "hubs.mjs", commands: ["hubs"], text: "verify the AGENTS.md hub tree" },
  { file: "twins.mjs", commands: ["twins"], text: "write or check the CLAUDE.md twin beside every AGENTS.md" },
  { file: "memory.mjs", commands: ["memory"], text: "project memory: lint, index, new, touch" },
  { file: "decisions.mjs", commands: ["decisions"], text: "decision records and the glossary: new, index, lint" },
  { file: "links.mjs", commands: ["links"], text: "check the links and paths of the agent files" },
  { file: "dup.mjs", commands: ["dup"], text: "find a rule stated in more than one place" },
  // `kanban` is the board's earlier name, kept for one major version.
  { file: "board.mjs", commands: ["board", "kanban"], text: "the task board: list, add, move, owe, settle, lint" },
  { file: "lock.mjs", commands: ["lock"], text: "exclusive locks on scarce resources: run, acquire, release, status" },
  { file: "coord/leases.mjs", commands: ["lease", "leases"], text: "declare shared use of a machine resource for the length of a command" },
  { file: "coord/sysinfo.mjs", commands: ["sys"], text: "live machine readings beside the leases and locks held" },
  { file: "coord/notes.mjs", commands: ["note", "notes"], text: "short notes to other agents" },
  { file: "coord/claims.mjs", commands: ["claim", "claims"], text: "claim a shared counter until a merge lands" },
  { file: "coord/learnings.mjs", commands: ["learn"], text: "learnings shared across projects: add, search, show, list" },
  { file: "coord/agents.mjs", commands: ["who", "agent"], text: "who is running on this machine" },
];

const USAGE = `usage: aw [--root DIR] <command> [args]

agent-works: project tools and machine-wide coordination.

options:
  -h, --help  show this help; after a command, that command's own
  --version   print the plugin's version
  --root DIR  work as if started in DIR (default: the working directory)`;

/** A command module's `main`, or why it cannot be had: `{ main }` or `{ why }`. */
async function load(mod) {
  const file = path.join(HERE, mod.file);
  const name = `scripts/${mod.file}`;
  if (!fs.existsSync(file)) return { why: `${name} is missing` };
  try {
    const loaded = await import(pathToFileURL(file).href);
    return typeof loaded.main === "function" ? { main: loaded.main } : { why: `${name} exports no main` };
  } catch (e) {
    return { why: `${name}: ${e?.name ?? "Error"}: ${e?.message ?? e}` };
  }
}

/** Why each module that cannot be had cannot, by its file. Imports every module. */
async function unavailable() {
  const failed = new Map();
  for (const mod of MODULES) {
    const { why } = await load(mod);
    if (why) failed.set(mod.file, why);
  }
  return failed;
}

function helpText(failed) {
  const lines = ["commands:"];
  for (const mod of MODULES) lines.push(`  ${mod.commands.join(", ").padEnd(16)} ${mod.text}${failed.has(mod.file) ? "  (unavailable)" : ""}`);
  if (failed.size) lines.push("", "unavailable:", ...[...failed.values()].map((why) => `  ${why}`));
  lines.push("", "exit codes: 0 clean, 1 warnings or not now, 2 critical or a usage error; aw lock: 3 still queued");
  return lines.join("\n");
}

const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};

/** Run `aw <argv>`; resolves to the exit code. */
export async function main(argv, io) {
  let through = ioOf(io);
  const args = [...argv];

  // --root DIR may stand anywhere before a `--`; it is applied before any module looks for the project.
  let root = null;
  for (let i = 0; i < args.length && args[i] !== "--";) {
    if (args[i] === "--root" && i + 1 < args.length) [, root] = args.splice(i, 2);
    else if (args[i].startsWith("--root=")) root = args.splice(i, 1)[0].slice("--root=".length);
    else i++;
  }
  if (root) {
    const dir = path.resolve(through.cwd, root);
    if (!isDir(dir)) return fail(through, `aw: --root ${root}: not a directory`);
    // When this is the process's own command, move the process too: whatever a command starts then starts there.
    if (through.stdout === process.stdout && path.resolve(through.cwd) === process.cwd()) process.chdir(dir);
    through = { ...through, cwd: dir };
  }

  const at = args.findIndex((a) => !a.startsWith("-"));
  const command = at < 0 ? null : args[at];
  const before = at < 0 ? args : args.slice(0, at);
  const mod = command === null ? null : MODULES.find((m) => m.commands.includes(command));
  if (command !== null && !mod) return fail(through, `aw: no command '${command}'\n\n${helpText(await unavailable())}`);

  if (before.includes("--version")) {
    emit(through, `aw ${pluginVersion()}`);
    return 0;
  }
  const helpAsked = before.includes("-h") || before.includes("--help");
  if (!mod || helpAsked) {
    emit(through, `${USAGE}\n\n${helpText(await unavailable())}`);
    return helpAsked || !args.length ? 0 : 2;
  }
  if (before.length) return fail(through, `aw: no option '${before[0]}' (aw --help lists them; a command's own options follow the command)`);

  // One command: import only its module, so `aw note` does not pay for the others.
  const { main: run, why } = await load(mod);
  if (!run) return fail(through, `aw ${command}: unavailable (${why})`);
  return runCommand(run, args.slice(at + 1), { ...through, command }, `aw ${command}`);
}

/** Run `aw` as this process's command: what the launchers in `bin/` call. */
export const cli = () => runCli(main);

runMain(import.meta.url, main);
