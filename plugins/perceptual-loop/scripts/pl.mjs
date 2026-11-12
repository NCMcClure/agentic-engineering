#!/usr/bin/env node
// perceptual-loop's one CLI: node pl.mjs <command> [options]. Each command lives
// in commands/<file>.mjs and is imported only when it runs. Every command takes
// --help and --json. Exit codes: 0 done or passed, 1 a gate failed or a check
// found something, 2 a usage or environment error. Everything is Node except
// the last two commands, which hand over to an optional Python script.
import { PlError } from "./lib/args.mjs";

const COMMANDS = {
  init: ["init", "init", "scaffold .agents/perceptual/ (config, groups, baseline, success/, decisions/)"],
  "new-shot": ["init", "newShot", "add a shot folder with its shot.json, and copy pictures in under the contract's names"],
  "new-success": ["init", "newSuccess", "write a task's success file from the template"],
  groups: ["groups", "run", "list groups, show one, resolve a selection, propose a smoke set"],
  compare: ["compare", "run", "measure each candidate against the reference, per shot, into a run folder"],
  baseline: ["baseline", "run", "gate a run (check, stale), accept it for named shots (update), show or set tolerances"],
  calibrate: ["calibrate", "run", "turn the spread of repeated runs into tolerances, and find bistable entries"],
  iterate: ["iterate", "run", "render a few shots, compare, gate, draw each shot's sheet, and say where the time went"],
  sheet: ["sheet", "run", "draw a sheet to look at: a shot, a triptych, a zoomed crop, a contact sheet, a heat map"],
  blind: ["blind", "run", "copy a before and after to neutral names for a critic, and keep the key apart"],
  review: ["review", "run", "queue a look question for the owner, build the review page, apply the rulings"],
  lint: ["lint", "run", "check a report for verdicts read off metrics, bare claims, and targets set against the reference"],
  timing: ["timing", "run", "where the iteration time went, and whether the render budget is kept"],
  video: ["video", "run", "a clip: probe it, write its frames, a contact sheet, a burst, or compare two clips frame by frame"],
  sweep: ["sweep", "run", "is a sequence smooth: jumps, flicker, direction, and judder over time"],
  flow: ["flow", "run", "which way and how fast the pixels move between frames, per region, with what is unknown"],
  audio: ["audio", "run", "a sound: loudness, silence and clipping, pitch, onsets, sound against sound, a spectrogram"],
  semantic: ["extras", "semantic", "optional, needs Python and torch: how alike two pictures are when no pixel lines up (CLIP, LPIPS)"],
  keypoints: ["extras", "keypoints", "optional, needs Python and mediapipe: a character's joints, and whether two pictures agree about them"],
};

const USAGE = `usage: node pl.mjs <command> [options]    (every command takes --help and --json)

${Object.entries(COMMANDS).map(([name, [, , what]]) => `  ${name.padEnd(12)} ${what}`).join("\n")}

Exit codes: 0 done or passed, 1 a gate failed or a check found something, 2 usage or environment.`;

const [name, ...rest] = process.argv.slice(2);
if (name === "--help" || name === "-h") process.stdout.write(USAGE + "\n");
else if (!name || !COMMANDS[name]) {
  process.stderr.write(`${name ? `unknown command '${name}'\n` : ""}${USAGE}\n`);
  process.exitCode = 2;
} else {
  const [file, fn] = COMMANDS[name];
  try {
    const mod = await import(`./commands/${file}.mjs`);
    process.exitCode = await mod[fn](rest);
  } catch (e) {
    if (e instanceof PlError) process.stderr.write(e.message + "\n");
    else process.stderr.write(`pl ${name}: internal error: ${e.stack ?? e}\n`);
    process.exitCode = e instanceof PlError ? e.code : 2;
  }
}
