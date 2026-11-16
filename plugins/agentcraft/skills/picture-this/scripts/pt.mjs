#!/usr/bin/env node
// picture-this's one CLI: node pt.mjs <command> [options]. Each command lives
// in commands/<file>.mjs and is imported only when it runs. Every command takes
// --help and --json. Exit codes: 0 done or passed, 1 a check found something,
// 2 a usage or environment error. Node 22 stdlib only: anything that needs a
// package (the studio, the browser) runs from the plugin's data folder.
import fs from "node:fs";
import { PtError } from "./lib/args.mjs";

export const COMMANDS = {
  setup: ["setup", "run", "install the studio into the plugin's data folder, once (asks first: --yes installs)"],
  studio: ["studio", "run", "serve a repo's figures and drafts, live; prints the URL to open"],
  draft: ["draft", "run", "start a round of drafts, one per named view (new), check it is fair and every view is stated (check), list the studies"],
  sheet: ["shots", "sheet", "lay a figure's beats side by side, with and without captions, to look it over"],
  still: ["shots", "still", "take a figure's still in light and dark (or its beat strip, --strip, or a looping GIF, --gif), and print the Markdown that shows it"],
  init: ["kit", "init", "record where this repo keeps its figures and stills"],
  kit: ["kit", "kit", "is the kit in this repo and current (status); put it there or bring it up to date (install)"],
  land: ["land", "run", "make a chosen draft one of the repo's figures"],
  model: ["model", "run", "check a figure's model.json: ids, flows, beats, captions, sources"],
};

export const USAGE = `usage: node pt.mjs <command> [options]    (every command takes --help and --json)

${Object.entries(COMMANDS).map(([name, [, , what]]) => `  ${name.padEnd(8)} ${what}`).join("\n")}

Exit codes: 0 done or passed, 1 a check found something, 2 usage or environment.`;

/** Run one command; returns the exit code. `io` is where it prints. */
export async function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  const [name, ...rest] = argv;
  if (name === "--help" || name === "-h") { io.out(USAGE + "\n"); return 0; }
  if (!name || !COMMANDS[name]) {
    io.err(`${name ? `unknown command '${name}'\n` : ""}${USAGE}\n`);
    return 2;
  }
  const [file, fn] = COMMANDS[name];
  try {
    const mod = await import(`./commands/${file}.mjs`);
    return await mod[fn](rest);
  } catch (e) {
    if (e instanceof PtError) { io.err(e.message + "\n"); return e.code; }
    io.err(`pt ${name}: internal error: ${e.stack ?? e}\n`);
    return 2;
  }
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = await main(process.argv.slice(2));
