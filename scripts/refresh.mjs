#!/usr/bin/env node
// The dev loop: validate this working tree, then install it for your user.
//
// Nothing here is packaged or tagged, so what you edited a second ago is what
// the next session loads. A red validate stops the run: installing a tree that
// fails the structural gate puts a broken plugin in front of every session,
// and the failure output is easier to read than the symptom.
//
// Usage: node scripts/refresh.mjs [-- <install.mjs args>]
// Anything after `--` is passed through, so
// `node scripts/refresh.mjs -- --plugins agentic-teamwork` refreshes one plugin.
import { spawnSync } from "node:child_process";
import path from "node:path";

const here = import.meta.dirname;
const passthrough = process.argv.slice(2);
const extra = passthrough[0] === "--" ? passthrough.slice(1) : passthrough;

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: "inherit" }).status ?? 1;

console.log("== validate ==");
if (run("validate.mjs", []) !== 0) {
  console.error("\nvalidate is red, so nothing was installed. Fix the failures above and run this again.");
  process.exitCode = 1;
} else {
  console.log("\n== install ==");
  const code = run("install.mjs", extra);
  if (code !== 0) process.exitCode = code;
}
