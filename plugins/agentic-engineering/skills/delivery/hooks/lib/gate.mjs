// What the guard and the stop gate share: running a repo's own command (its
// tests, its linter), and the record of which test commands a session ran.
//
// The record is one small file per session in the temp directory, so it
// outlives each hook process and never lands in the repo.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { notWired } from "./config.mjs";

const MAX_OUTPUT = 4000;

/**
 * The bash to hand a command line to, or null for the platform's own shell.
 * On Windows it is looked up on PATH and never taken from the Windows folders,
 * where `bash.exe` starts another system rather than the shell the repo's
 * commands were written for.
 */
export function bashFor(env = process.env) {
  if (process.platform !== "win32") return "bash";
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH");
  const found = String(env[key] ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "bash.exe"))
    .find((file) => !/[\\/]windows(apps)?[\\/]/i.test(file) && fs.existsSync(file));
  return found ?? null;
}

/**
 * Run one command line of the repo's own, as the person would type it: bash
 * where there is one, the platform's shell otherwise. Off Windows it is a
 * login bash, since a hook does not inherit an interactive shell's PATH.
 * Returns `ok`, `timedOut`, and the last lines of what it printed, stdout and
 * stderr in the order written.
 */
export function runShell(command, { cwd, timeoutMs = 240_000, env = process.env, lines = 40 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-teamwork-run-"));
  const log = path.join(dir, "out.log");
  const fd = fs.openSync(log, "w");
  try {
    const options = { cwd, env, timeout: timeoutMs, windowsHide: true, stdio: ["ignore", fd, fd] };
    const bash = bashFor(env);
    // A login shell on Windows starts in the home folder, not in cwd, so it is a plain one there.
    let r = bash ? spawnSync(bash, [process.platform === "win32" ? "-c" : "-lc", command], options) : null;
    if (!r || r.error?.code === "ENOENT") r = spawnSync(command, { ...options, shell: true });
    const output = fs.readFileSync(log, "utf8").trim().split(/\r?\n/).slice(-lines).join("\n").slice(-MAX_OUTPUT);
    return { ok: r.status === 0, timedOut: r.error?.code === "ETIMEDOUT", output };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The hard gate's run: `test.command`, or `build.command` where there are no
 * tests yet. Null when the repo names neither, which passes: there is nothing to fail.
 */
export function runTests(config, root) {
  const [command, dir] = config.test.command ? [config.test.command, config.test.dir] : [config.build.command, config.build.dir];
  if (!command) return null;
  const seconds = config.test.timeoutSeconds;
  const cwd = path.resolve(root, dir);
  if (!fs.existsSync(cwd)) return { ok: false, command, output: `could not run: ${dir} does not exist (test.dir in the manifest's teamwork block)` };
  const result = runShell(command, { cwd, timeoutMs: seconds * 1000 });
  const output = result.timedOut ? `${result.output}\n(stopped after ${seconds}s: test.timeoutSeconds)`.trim() : result.output || `could not run: ${command}`;
  return { ok: result.ok, command, output };
}

/** A command line that runs tests, by the runners people use. */
export const TEST_COMMAND = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test|\b(vitest|jest|pytest|tox|rspec|phpunit)\b|\bplaywright\s+test\b|\bnode\s+(?:\S+\s+){0,6}?--test\b|\b(go|cargo|swift|dotnet|deno|mvn|gradle|gradlew|make)\s+test\b|\bpython3?\s+-m\s+unittest\b/;

const squeeze = (text) => String(text).replace(/\s+/g, " ").trim();

/**
 * The lanes a command line runs: those whose command appears in it as typed,
 * whole, so a lane that is `npm test` is not found inside `npm test:live`.
 */
export function lanesIn(command, lanes) {
  const line = ` ${squeeze(command)} `;
  const edge = " ;&|()\"'";
  return Object.entries(lanes ?? {}).filter(([, cmd]) => {
    const wanted = squeeze(cmd);
    if (notWired(wanted) || !wanted) return false;
    for (let at = line.indexOf(wanted); at >= 0; at = line.indexOf(wanted, at + 1)) {
      if (edge.includes(line[at - 1]) && edge.includes(line[at + wanted.length])) return true;
    }
    return false;
  }).map(([lane]) => lane);
}

export const recordFile = (sessionId, env = process.env) =>
  path.join(env.TMPDIR || os.tmpdir(), `agentic-teamwork-${String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "")}.json`);

/** A session's record: `testRuns` (what ran), and `told` (what the stop gate already said). */
export function readRecord(sessionId, env = process.env) {
  let record = null;
  try { record = JSON.parse(fs.readFileSync(recordFile(sessionId, env), "utf8")); } catch { /* nothing recorded yet */ }
  const r = record && typeof record === "object" ? record : {};
  return { testRuns: Array.isArray(r.testRuns) ? r.testRuns : [], told: r.told && typeof r.told === "object" ? r.told : {} };
}

/** Best effort: a record that cannot be written is never a reason to stop a command. */
export function writeRecord(sessionId, record, env = process.env) {
  try { fs.writeFileSync(recordFile(sessionId, env), JSON.stringify(record)); } catch { /* read-only temp directory */ }
}

/** Note that a test command ran in this session, with the lanes it covers. */
export function recordTestRun(sessionId, command, lanes, env = process.env) {
  const record = readRecord(sessionId, env);
  record.testRuns = [...record.testRuns, { at: new Date().toISOString(), command: squeeze(command).slice(0, 200), lanes }].slice(-20);
  writeRecord(sessionId, record, env);
}
