#!/usr/bin/env node
// Run one of this repo's test lanes by name. The commands are `lanes` in
// .agents/manifest.json, so CI, a person, and an agent all run the same thing
// and nobody guesses a command.
//
// Usage: node .agents/scripts/lane.mjs <unit|integration|e2e|live> [extra args for the command]
//        node .agents/scripts/lane.mjs --list
//
// A lane whose command starts with "not wired" has nothing to run yet: this
// says so, with the reason, and exits 0, so a skipped lane is visible in the
// output instead of missing from it. Otherwise the exit code is the command's.
// Exit 2: no such lane, or no readable marker.
//
// Leading NAME=value words in a command are set in its environment here, not
// left to the shell, so `RUN_DB_TESTS=1 npm test` runs the same on Windows.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "..");
const [name, ...extra] = process.argv.slice(2);

let lanes = null;
try { lanes = JSON.parse(fs.readFileSync(path.join(root, ".agents", "manifest.json"), "utf8")).lanes ?? null; } catch { /* reported below */ }

if (!lanes || typeof lanes !== "object") {
  console.error("lane: .agents/manifest.json has no readable `lanes`");
  process.exitCode = 2;
} else if (!name || name === "--list") {
  for (const [lane, command] of Object.entries(lanes)) console.log(`${lane}: ${command}`);
  process.exitCode = name ? 0 : 2;
} else if (typeof lanes[name] !== "string" || !lanes[name]) {
  console.error(`lane: no "${name}" lane; this repo has ${Object.keys(lanes).join(", ")}`);
  process.exitCode = 2;
} else if (/^not wired\b/i.test(lanes[name])) {
  console.log(`lane: ${name} skipped, ${lanes[name]}`);
  process.exitCode = 0;
} else {
  const env = { ...process.env };
  let command = lanes[name];
  for (let m; (m = /^([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s+/.exec(command));) {
    env[m[1]] = m[2];
    command = command.slice(m[0].length);
  }
  const quoted = extra.map((a) => (/^[A-Za-z0-9_./:=@-]+$/.test(a) ? a : JSON.stringify(a)));
  console.log(`lane: ${name}: ${lanes[name]}`);
  const result = spawnSync([command, ...quoted].join(" "), { cwd: root, env, shell: true, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
