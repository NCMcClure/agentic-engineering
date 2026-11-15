#!/usr/bin/env node
// PostToolUse on an edit or a write: two checks a repo opts into through the
// `teamwork` block of its manifest, and nothing where it has not.
//
//   lint          `lint.command` runs on an edited file matching
//                 `lint.filePatterns`, with `{file}` as the file's path. A
//                 failure goes back to the model with the linter's last lines.
//   coupledFiles  editing one file of a group names the others and the
//                 group's reason, while the edit is still in hand.
//
// Both arrive as PostToolUse `additionalContext`: feedback, never a block.
// A file outside the repo, a linter that cannot start or runs out of time,
// and a repo in mode none all say nothing. Fail open, always exit 0.
import fs from "node:fs";
import path from "node:path";
import { readPayload, repoRoot } from "./critical-context.mjs";
import { anyOf, globTest, loadConfig, modeFor } from "./lib/config.mjs";
import { bashFor, runShell } from "./lib/gate.mjs";

// The hook has fifteen seconds; a linter slower than this on one file is not feedback.
const LINT_MS = 10_000;

/**
 * A path as the file system names it, symlinks and Windows short names
 * resolved: git reports the repo that way while the host names the file as it
 * was opened. The file may be gone already, so the deepest existing ancestor
 * is resolved and the rest appended.
 */
function real(p) {
  const tail = [];
  let at = path.resolve(p);
  while (!fs.existsSync(at)) {
    const up = path.dirname(at);
    if (up === at) return p;
    tail.unshift(path.basename(at));
    at = up;
  }
  return path.join(fs.realpathSync.native(at), ...tail);
}

/** `{file}` filled in: quoted for the shell, unless the command already quotes it. */
function lintLine(template, file) {
  if (/["']\{file\}["']/.test(template)) return template.replaceAll("{file}", file);
  // Quoted for the shell runShell will hand the line to.
  const quoted = bashFor() ? `'${file.replaceAll("'", "'\\''")}'` : `"${file}"`;
  return template.replaceAll("{file}", quoted);
}

function lintNote(config, root, file, rel) {
  const { command, filePatterns } = config.lint;
  if (!command || !fs.existsSync(file) || !anyOf(filePatterns)(rel)) return null;
  const line = lintLine(command, file);
  const result = runShell(line, { cwd: root, timeoutMs: LINT_MS, lines: 20 });
  if (result.ok || result.timedOut) return null;
  return `Lint fails on ${rel} (\`${line}\`)${result.output ? `:\n${result.output}\n` : ". "}Fix it before you commit.`;
}

function coupledNote(config, rel) {
  const group = config.coupledFiles.find((g) => g.files.some((glob) => globTest(glob)(rel)));
  if (!group) return null;
  const others = group.files.filter((glob) => glob !== rel);
  return `${rel} is one of a group of files that change together${others.length ? ` (also: ${others.join(", ")})` : ""}. ${group.message} If you changed a name, a path, or an identifier, update the whole group in this change.`;
}

function main() {
  const payload = readPayload();
  const file = payload?.tool_input?.file_path;
  if (typeof file !== "string" || !file) return;
  const root = repoRoot(payload);
  if (!root || modeFor(root) === "none") return;
  const rel = path.relative(real(root), real(file)).split(path.sep).join("/");
  // Outside the repo: a scratchpad, and no business of this repo's rules.
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return;
  const config = loadConfig(root);
  const notes = [lintNote(config, root, file, rel), coupledNote(config, rel)].filter(Boolean);
  if (!notes.length) return;
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join("\n\n") } }));
}

// process.exitCode, not process.exit: an exit while stdout drains can cut the
// output short, and a host reads that as a crashed hook.
try { main(); } catch { /* fail open: missed feedback costs nothing, a failed edit costs work */ }
process.exitCode = 0;
