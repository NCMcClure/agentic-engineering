#!/usr/bin/env node
// Stop: what the turn leaves behind, said to the agent before it stops.
//
// With `requireTestsPass` on (the manifest's `teamwork` block) and source
// files changed, it runs the repo's tests and blocks the stop on failure:
// `decision: "block"` with the failing output as the reason, so the model
// reads it and fixes the tree.
//
// Otherwise it only reports, once, as context the model reads before it
// writes its last message:
//   work that is not committed,
//   untracked files sitting at the repo root,
//   source files changed with no test command run in this session (the guard
//   notes each one it sees).
// The report goes out as Stop `additionalContext`, which reaches the model;
// the person gets a one-line `systemMessage` naming what was sent.
//
// It cannot loop: a stop that a Stop hook already continued (`stop_hook_active`)
// is let through untouched, and a finding is said again only after it went
// away and came back, so a session is not reminded of the same uncommitted
// work at the end of every turn.
//
// Documentation is not checked here. In mode none it says nothing.
//
// Fail open, always exit 0.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { repoRoot } from "./critical-context.mjs";
import { MANIFEST, SOURCE_FILE, anyOf, loadConfig, modeFor, notWired } from "./lib/config.mjs";
import { readRecord, runTests, writeRecord } from "./lib/gate.mjs";

const SHOWN = 5;
const some = (files) => `${files.slice(0, SHOWN).join(", ")}${files.length > SHOWN ? `, and ${files.length - SHOWN} more` : ""}`;

/** Every path `git status` reports, renames by their new name. */
function changedFiles(git) {
  const fields = git("status", "--porcelain", "-z", "-uall").split("\0");
  const files = [];
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].length < 4) continue;
    files.push(fields[i].slice(3));
    // A rename or a copy carries the old name as the next field.
    if ("RC".includes(fields[i][0])) i += 1;
  }
  return files;
}

function lanesLine(lanes) {
  const wired = Object.entries(lanes).filter(([, command]) => !notWired(command)).map(([lane, command]) => `${lane} \`${command}\``);
  return wired.length ? `Name the lane that covers the change and run it: ${wired.join("; ")}.` : "Run the project's own test command, or say that it has none.";
}

/**
 * The payload, or null when stdin holds none that parses. Without one there
 * is no telling whether this stop was already continued, so nothing is said.
 */
function stopPayload() {
  try {
    const payload = JSON.parse(fs.readFileSync(0, "utf8").replace(/^\uFEFF/, ""));
    return payload && typeof payload === "object" ? payload : null;
  } catch { return null; }
}

function main() {
  const payload = stopPayload();
  // Never re-enter on a continuation a Stop hook caused.
  if (!payload || payload.stop_hook_active === true) return;
  const root = repoRoot(payload);
  if (!root || modeFor(root) === "none") return;
  const config = loadConfig(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

  const changed = changedFiles(git);
  const isSource = config.test.sourcePatterns.length ? anyOf(config.test.sourcePatterns) : (file) => SOURCE_FILE.test(file);
  const source = changed.filter(isSource);

  // The hard gate: never end a turn with broken source work in the tree.
  let ranHere = false;
  if (config.requireTestsPass && config.rules.stopGate && source.length) {
    const tests = runTests(config, root);
    ranHere = Boolean(tests);
    if (tests && !tests.ok) {
      console.log(JSON.stringify({
        decision: "block",
        reason: `\`${tests.command}\` fails with uncommitted source changes in the tree (requireTestsPass in ${MANIFEST}):\n${tests.output}\n\nFix it before you finish; do not leave the tree broken.`,
      }));
      return;
    }
  }

  // Without a session to remember for, nothing is remembered: better said twice than kept from the wrong session.
  const record = payload.session_id ? readRecord(payload.session_id) : { testRuns: [], told: {} };
  // label -> [what makes this finding the same one as last time, what to say]
  const found = {};
  if (changed.length) {
    found["uncommitted work"] = ["", `${changed.length} file(s) are changed and not committed: ${some(changed)}. Say so in your report, and commit only if the person asked for it.`];
  }
  // Before the first commit every file is untracked, and none of them is stray for it.
  let born = true;
  try { git("rev-parse", "--verify", "-q", "HEAD"); } catch { born = false; }
  const stray = born ? git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter((file) => file && !file.includes("/")) : [];
  if (stray.length) {
    found["untracked files at the root"] = [stray.join("\n"), `Untracked files at the repo root: ${some(stray)}. Commit them, ignore them, or delete them; scratch files do not live in the repo.`];
  }
  if (source.length && !ranHere && !record.testRuns.length) {
    found["no test run"] = ["", `Source files changed and no test command ran in this session. ${lanesLine(config.lanes)} A lane that did not run is reported as not run.`];
  }

  const fresh = Object.entries(found).filter(([label, [same]]) => record.told[label] !== same);
  // What is no longer found is forgotten, so it is said again if it comes back.
  const told = Object.fromEntries(Object.entries(found).map(([label, [same]]) => [label, same]));
  if (payload.session_id && JSON.stringify(told) !== JSON.stringify(record.told)) writeRecord(payload.session_id, { ...record, told });
  if (!fresh.length) return;

  console.log(JSON.stringify({
    systemMessage: `agentic-teamwork told the agent before it stopped: ${fresh.map(([label]) => label).join(", ")}.`,
    hookSpecificOutput: { hookEventName: "Stop", additionalContext: ["Before you finish:", ...fresh.map(([, [, text]]) => `- ${text}`)].join("\n") },
  }));
}

// process.exitCode, not process.exit: an exit while stdout drains can cut the
// output short, and a host reads that as a crashed hook.
try { main(); } catch { /* fail open: a report is never worth a failed turn */ }
process.exitCode = 0;
