#!/usr/bin/env node
// A named workspace's own door to a script every named workspace shares.
//
// `.agents/plans/<name>/` holds this file at each path the project workspace
// holds a script (`plan/plan-status.mjs`, `spec/scripts/verify-spec-tree.mjs`,
// and the rest), so one command shape runs in every workspace:
//
//   node .agents/plans/<name>/plan/plan-status.mjs check 01
//
// It runs the script of its own name in `.agents/plans/_scripts/`, telling it
// which workspace it was run in. The same bytes sit at all five paths, and
// `scaffold.mjs --refresh` rewrites one that has been changed. Node 22 stdlib
// only.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const parts = import.meta.dirname.split(path.sep);
const at = parts.lastIndexOf("plans");
const plans = parts.slice(0, at + 1).join(path.sep);
const script = path.join(plans, "_scripts", path.basename(import.meta.filename));

if (at < 1 || parts[at - 1] !== ".agents" || !parts[at + 1]) {
  console.error(`${path.basename(import.meta.filename)}: this launcher belongs inside a named workspace, .agents/plans/<name>/, and it is at ${import.meta.dirname}`);
  process.exitCode = 2;
} else if (!fs.existsSync(script)) {
  console.error(`${path.basename(import.meta.filename)}: the shared copy is missing (${script}); the but-first-planning scaffold writes it back with --refresh`);
  process.exitCode = 2;
} else {
  // The script runs only as the file node was started on, so it is named as that.
  process.argv.splice(1, 1, script, "--workspace", path.join(plans, parts[at + 1]));
  await import(pathToFileURL(script).href);
}
