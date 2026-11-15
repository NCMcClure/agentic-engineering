#!/usr/bin/env node
// Starts a project's diagrams: a miro.config.mjs naming the board, one example
// generator, an empty miro/board.json, and the .gitignore lines for the live check's
// scratch files. Refuses to touch a directory that already has a config.
//
// Usage: node init.mjs <dir> --board <https://miro.com/app/board/<id>=/>
// Prints the files it wrote as JSON; exit 1 on a refusal.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// process.exitCode rather than process.exit: see build.mjs.
function main() {
  const [dir, ...rest] = process.argv.slice(2);
  const board = rest[rest.indexOf("--board") + 1];
  const fail = (m) => { console.error(m); return 1; };
  if (!dir || !rest.includes("--board")) return fail("usage: init.mjs <dir> --board <miro board url>");
  if (!/^https:\/\/miro\.com\/app\/board\/[^/]+\/?$/.test(board ?? "")) return fail(`not a Miro board URL: ${board}`);
  const root = path.resolve(dir);
  const config = path.join(root, "miro.config.mjs");
  if (existsSync(config)) return fail(`${config} exists; edit it instead`);

  const assets = path.join(import.meta.dirname, "..", "assets");
  const wrote = [];
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "miro"), { recursive: true });
  writeFileSync(config, readFileSync(path.join(assets, "miro.config.mjs"), "utf8").replace("{{BOARD_URL}}", board));
  wrote.push(config);
  const gen = path.join(root, "src", "gen-example.mjs");
  if (!existsSync(gen)) { copyFileSync(path.join(assets, "gen-example.mjs"), gen); wrote.push(gen); }
  const boardJson = path.join(root, "miro", "board.json");
  if (!existsSync(boardJson)) { writeFileSync(boardJson, JSON.stringify({ url: board, frames: {}, ids: {} }, null, 2) + "\n"); wrote.push(boardJson); }
  const ignore = path.join(root, ".gitignore");
  const have = existsSync(ignore) ? readFileSync(ignore, "utf8") : "";
  const need = ["miro/live-dump.json", "miro/board-dump.js"].filter((l) => !have.split("\n").includes(l));
  if (need.length) { appendFileSync(ignore, `${have && !have.endsWith("\n") ? "\n" : ""}${need.join("\n")}\n`); wrote.push(ignore); }
  console.log(JSON.stringify({ dir: root, wrote }, null, 2));
  return 0;
}

process.exitCode = main();
