#!/usr/bin/env node
// Enforce the profile line budget. This file is the one home of the number.
//
// The profile loads into every session, so every line is paid for in permanent
// context. Skills, hooks and docs say "the budget profile-budget.mjs enforces"
// and never restate it.
//
//   node profile-budget.mjs [path]
//
// `path` defaults to the resolved profile (WLM_PROFILE, or
// ~/.claude/rules/write-like-me.md). Prints "<lines>/<budget> lines" and a
// verdict. Exit 0 at or under budget, 1 over it, 2 when the file is missing.
import fs from "node:fs";
import { profilePath } from "./paths.mjs";

export const BUDGET = 60;

// Every character that ends a line: a profile pasted from anywhere is counted
// the way an editor would show it.
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

/** How many lines a text holds; a final line break does not start another. */
export function countLines(text) {
  const lines = text.split(LINE_BREAK);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export function main(argv) {
  const target = argv[0] ?? profilePath();
  let text;
  try {
    if (!fs.statSync(target).isFile()) throw new Error("not a file");
    text = fs.readFileSync(target, "utf8");
  } catch {
    console.error(`no profile at ${target}`);
    return 2;
  }
  const lines = countLines(text);
  const over = lines > BUDGET;
  console.log(`${lines}/${BUDGET} lines \u2014 ${over ? "OVER BUDGET" : "OK"}`);
  return over ? 1 : 0;
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = main(process.argv.slice(2));
