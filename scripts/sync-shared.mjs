#!/usr/bin/env node
// Some files ship in several plugins unchanged, because a plugin cannot reach
// outside its own directory. scripts/shared/ holds the one copy of each that
// is edited; a plugin lists where its copies go under `shared` in
// scripts/plugins/<name>.json.
//
// Usage: node scripts/sync-shared.mjs [--write] [--root <dir>]
//
// Without --write it reports the copies that are missing or have drifted and
// exits 1 if there are any. With --write it rewrites them from scripts/shared/.
import fs from "node:fs";
import path from "node:path";
import { sha256, sharedCopies } from "./lib.mjs";

const argv = process.argv.slice(2);
const ROOT = path.resolve(argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : path.join(import.meta.dirname, ".."));
const WRITE = argv.includes("--write");
const at = (rel) => path.join(ROOT, rel);

const { copies, problems } = sharedCopies(ROOT);
for (const { copy, canonical } of copies) if (!fs.existsSync(at(canonical))) problems.push(`${copy}: ${canonical} does not exist`);
for (const problem of problems) console.error(problem);

let stale = 0;
for (const { copy, canonical } of copies.filter((c) => fs.existsSync(at(c.canonical)))) {
  if (fs.existsSync(at(copy)) && sha256(at(copy)) === sha256(at(canonical))) continue;
  stale++;
  console.log(`${WRITE ? "wrote" : fs.existsSync(at(copy)) ? "drifted" : "missing"}: ${copy} <- ${canonical}`);
  if (!WRITE) continue;
  fs.mkdirSync(path.dirname(at(copy)), { recursive: true });
  fs.copyFileSync(at(canonical), at(copy));
}
if (!stale) console.log(`${copies.length} shared copy/copies up to date`);
else if (!WRITE) console.log("run: node scripts/sync-shared.mjs --write");
process.exitCode = problems.length || (stale && !WRITE) ? 1 : 0;
