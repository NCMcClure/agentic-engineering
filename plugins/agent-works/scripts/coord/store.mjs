// The machine-wide store: where it lives, how it is written, and what the
// machine's processes are.
//
// Layout under `awHome(env)` (AW_HOME, else ~/.agent-works):
//
//   agents.jsonl                      one JSON line per running agent
//   resources.json                    {"leases": [...]}
//   locks/<scope>/<resource>.lock     scope = "machine" or a project id
//   locks/<scope>/<resource>.queue/   one ticket per waiter
//   projects/<project id>/notes.log   and claims.json (guard.log is the guard's)
//   notes.log                         machine-wide notes
//   learnings/<id>-<slug>.md
//   projects.json                     {project id: {root, name, seen}}
//
// Rules of the store: a file is replaced whole through a temp file and a
// rename, so a reader never sees half of one; a read-modify-write happens
// under a lock file (`<file>.lk`) that is created exclusively and held for
// milliseconds, never while a command runs; an entry whose process is gone is
// dropped by whoever reads next.
//
// Nothing here reads the process's environment or working directory: every
// function takes the store's folder (`home`) or an `env`, so two stores can be
// used in one process and a hook can ask without starting one.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AwError, agentName, atomicWrite, awHome, emit, exclusiveCreate, jsonText, mainRoot, nowIso, posix, projectId,
  projectName, readJson, readText, realPath, splitLines,
} from "../../lib/common.mjs";
import { DEFAULTS, loadConfig } from "../../lib/config.mjs";

export const MACHINE = "machine";
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const AGENT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The exit code of a command that was killed at its time limit. */
export const TIMED_OUT = 124;
/** The exit code of a command that could not be started. */
export const NOT_STARTED = 127;
const KILL_GRACE_MS = 3000; // from the polite signal to the hard one

/** What a project may override under "coordination" in its config, with the values used when it does not. */
export const SETTINGS = DEFAULTS.coordination;

/** A coordination setting as a number: the project's, else the default (also when the project's is not a number). */
export function setting(cfg, key) {
  const value = cfg?.coordination?.[key] ?? SETTINGS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : SETTINGS[key];
}

/** One JSON document (`asJson`), else the text; nothing at all when the text is empty. */
export function say(io, doc, asJson, text = "") {
  if (asJson) emit(io, doc, true);
  else if (text) emit(io, text);
}

/** A number the way a person writes it: six significant digits, no trailing zeros (`5`, `0.3`, `12.5`). */
export function g(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v);
}

/** A flag's value as a number: `fallback` when the flag was not given, an AwError when it is not one. */
export function numArg(value, flag, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = String(value).trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new AwError(`${flag} takes a number, not "${value}"`);
  return n;
}

/**
 * `argv` with each `--name value` of the free-text flags in `names` joined into `--name=value`, up to a `--`, so a
 * text that starts with a dash ("- cap the job count") is read as the flag's value and not as another flag.
 */
export function glue(argv, names) {
  const out = [];
  const cut = argv.indexOf("--");
  const end = cut < 0 ? argv.length : cut;
  for (let i = 0; i < end; i++) {
    if (names.includes(argv[i]) && i + 1 < end) out.push(`${argv[i]}=${argv[++i]}`);
    else out.push(argv[i]);
  }
  return [...out, ...argv.slice(end)];
}

const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
/** Block this process for `ms` milliseconds. Only for the few milliseconds a store file is contended. */
export const pause = (ms) => { Atomics.wait(SLEEPER, 0, 0, Math.max(0, ms)); };

// ----------------------------------------------------------------------------------------------------------- time

/** Now in UTC to the second: every stamp in the store has this shape. */
export const now = nowIso;

/** Seconds since 1970 as a stamp of the store. */
export function isoAt(seconds) {
  return new Date(Math.floor(seconds) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
}

/** A stamp of the store as seconds since 1970; null when it is not one. */
export function parseIso(stamp) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z$/.exec(String(stamp));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isNaN(ms) ? null : ms / 1000;
}

/** Seconds since a stamp; 0 when it cannot be read (an unreadable stamp never makes anything stale). */
export function ageSeconds(stamp) {
  const t = parseIso(stamp);
  return t === null ? 0 : Math.max(0, Date.now() / 1000 - t);
}

/** A duration for people: `30 s`, `10 min`, `2.0 h`. */
export function ago(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 90) return `${s.toFixed(0)} s`;
  if (s < 5400) return `${(s / 60).toFixed(0)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

// ---------------------------------------------------------------------------------------------------------- paths

/** The store's folder for an environment. */
export const homeOf = (env = process.env) => awHome(env);
export const locksRoot = (home) => path.join(home, "locks");
export const projectDir = (home, project) => path.join(home, "projects", project);

/** `value` when it is a plain name (a resource, a counter); an AwError when it is not. */
export function checkName(value, what) {
  if (!NAME_RE.test(value ?? "")) throw new AwError(`${what} '${value}': letters, digits, '_', '.', '-' only, at most 64 characters`);
  return value;
}

const namesIn = (dir) => {
  try { return fs.readdirSync(dir); } catch { return []; }
};

/** The folders of `<home>/projects`: every project that has written a note or a claim. */
export function projectFolders(home) {
  const dir = path.join(home, "projects");
  return namesIn(dir).filter((name) => {
    try { return fs.statSync(path.join(dir, name)).isDirectory(); } catch { return false; }
  });
}

// ---------------------------------------------------------------------------------------------- read-modify-write

/**
 * Run `fn` holding the short exclusive lock beside `target` (`<target>.lk`), for one read-modify-write.
 *
 * The lock file is created exclusively, so of several processes exactly one holds it; the others retry every few
 * milliseconds. One left by a process that died is broken once that process is gone, or after `stale` seconds.
 * Held longer than `timeout` seconds by someone alive, it is an AwError. Never hold one across anything slow.
 */
export function withFileLock(target, fn, { timeout = 15, stale = 30 } = {}) {
  const file = `${target}.lk`;
  const breakIfDead = () => {
    let age;
    try { age = (Date.now() - fs.statSync(file).mtimeMs) / 1000; } catch { return; }
    if (age < 1) return;
    if (age < stale) {
      const pid = (readText(file, "") ?? "").split(" ", 1)[0];
      if (!/^\d+$/.test(pid) || pidAlive(Number(pid))) return;
    }
    // The rename is the arbiter: of several breakers only one moves the file away.
    const moved = `${file}.dead-${process.pid}-${process.hrtime.bigint()}`;
    try {
      fs.renameSync(file, moved);
      fs.rmSync(moved, { force: true });
    } catch { /* another breaker was first */ }
  };
  const deadline = Date.now() + timeout * 1000;
  for (let tries = 1; !exclusiveCreate(file, `${process.pid} ${(Date.now() / 1000).toFixed(3)}`); tries++) {
    if (tries % 25 === 0) breakIfDead();
    if (Date.now() > deadline) {
      throw new AwError(`the store is busy: ${path.basename(file)} was held for ${g(timeout)} s. Run the command again.`);
    }
    pause(4 + Math.random() * 26);
  }
  try {
    return fn();
  } finally {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        fs.unlinkSync(file);
        break;
      } catch (e) {
        if (e.code === "ENOENT") break;
        pause(5 * (attempt + 1)); // Windows: a breaker is looking at it this instant
      }
    }
  }
}

/** Replace a file whole (temp file, then rename), waiting out a reader that has it open this instant (Windows). */
export function write(file, text) {
  for (let attempt = 0; ; attempt++) {
    try {
      atomicWrite(file, text);
      return;
    } catch (e) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(e.code) || attempt === 3) throw e;
      pause(50);
    }
  }
}

const kindOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/**
 * Read `file` (`fallback` when absent or damaged), let `change` edit the document in place, write it back. Gives what
 * `change` returned. The whole step runs under the file's lock, so concurrent updates never lose one another's work.
 */
export function updateJson(file, fallback, change) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withFileLock(file, () => {
    let doc = readJson(file, null);
    if (kindOf(doc) !== kindOf(fallback)) doc = structuredClone(fallback);
    const result = change(doc);
    write(file, `${jsonText(doc)}\n`);
    return result;
  });
}

/** Append one line to a log; beyond `maxBytes` the log becomes `<name>.1` (one older generation is kept). */
export function appendLine(file, line, maxBytes = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const limit = Number(maxBytes ?? SETTINGS.logBytes);
  withFileLock(file, () => {
    try {
      if (fs.statSync(file).size > limit) fs.renameSync(file, `${file}.1`);
    } catch { /* no log yet */ }
    fs.appendFileSync(file, `${String(line).replace(/\n+$/, "")}\n`);
  });
}

/** A rotating log's lines, oldest first (the older generation, then the current one). */
export function logLines(file) {
  const out = [];
  for (const p of [`${file}.1`, file]) {
    const text = readText(p);
    if (text) out.push(...splitLines(text).filter((line) => line.trim()));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------ processes

const probe = (program, args, timeout = 30_000) => {
  try {
    const r = spawnSync(program, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return r.error || r.status !== 0 ? null : r.stdout;
  } catch {
    return null;
  }
};

/**
 * The machine's processes as a Map of pid -> [parent pid, executable name]; empty when they cannot be listed.
 *
 * Elsewhere than Windows: `ps`. Windows: `tasklist` (names only, parent 0), or with `parents` the process list of
 * PowerShell, which is slower and so asked only when the ancestry matters.
 */
export function processTable({ parents = false } = {}) {
  const table = new Map();
  if (process.platform === "win32") {
    if (parents) {
      const out = probe("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2}' -f $_.ProcessId, $_.ParentProcessId, $_.Name }"]);
      for (const line of splitLines(out ?? "")) {
        const m = /^(\d+),(\d+),(.*)$/.exec(line.trim());
        if (m) table.set(Number(m[1]), [Number(m[2]), m[3]]);
      }
      if (table.size) return table;
    }
    for (const line of splitLines(probe("tasklist", ["/FO", "CSV", "/NH"]) ?? "")) {
      const cells = line.split('","').map((c) => c.replace(/^"|"$/g, ""));
      if (cells.length >= 2 && /^\d+$/.test(cells[1])) table.set(Number(cells[1]), [0, cells[0]]);
    }
    return table;
  }
  for (const line of splitLines(probe("ps", ["-A", "-o", "pid=,ppid=,comm="]) ?? "")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (m) table.set(Number(m[1]), [Number(m[2]), path.basename(m[3])]);
  }
  return table;
}

/** The running executables whose name starts with one of the prefixes (case ignored), sorted. */
export function running(prefixes) {
  const low = (prefixes ?? []).filter(Boolean).map((p) => String(p).toLowerCase());
  if (!low.length) return [];
  const names = new Set([...processTable().values()].map(([, name]) => name));
  return [...names].filter((n) => low.some((p) => n.toLowerCase().startsWith(p))).sort();
}

/**
 * Whether a process with this id exists. Unknown or invalid: false.
 *
 * Caveats: the operating system hands a finished process's id out again, so "alive" can be a stranger that got the
 * number (nothing is taken over on a pid alone while a stranger wears it: the entry then ends by its time, not its
 * process); a process of another user counts as alive; and in a container or a separate pid namespace the ids of the
 * host are not visible, so a store shared across that line sees its holders as gone.
 */
export function pidAlive(pid) {
  const n = typeof pid === "number" ? pid : typeof pid === "string" && /^\d+$/.test(pid.trim()) ? Number(pid) : NaN;
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0); // signal 0 sends nothing, on Windows too: it only asks whether the process is there
    return true;
  } catch (e) {
    return e.code === "EPERM"; // someone else's process: it exists
  }
}

// Programs that are a means of starting something, not the session an agent lives in.
const LAUNCHERS = new Set(["python", "pythonw", "py", "bash", "sh", "zsh", "fish", "dash", "ksh", "cmd", "powershell", "pwsh",
  "conhost", "env", "aw", "git", "busybox", "winpty", "timeout", "nohup", "sudo", "time", "uv", "login", "mintty", "tmux", "screen"]);

const stem = (name) => path.basename(String(name)).toLowerCase().replace(/\.exe$/, "").replace(/[\d.]+$/, ""); // python3.12 -> python

const pidIn = (text) => (/^\d+$/.test(String(text ?? "").trim()) && Number(text) > 0 ? Number(text) : null);

/**
 * The process an agent's session lives in: what must stay alive for its entries in the store to count.
 *
 * `AW_SESSION_PID` when set; else `CLAUDE_PID` while that process runs; else the nearest ancestor of this command
 * that is not a shell or a launcher (the agent tool that started the shell); else the furthest ancestor found.
 *
 * The variables come first because ancestry is not reliable everywhere: under Git Bash on Windows a pipe or an
 * `exec` leaves a process whose parent is already gone, and the walk then ends at a shell that lives for one
 * command. A session named after such a process would have a new name with every call.
 */
export function sessionPid(env = process.env) {
  const given = pidIn(env.AW_SESSION_PID);
  if (given !== null) return given;
  const named = pidIn(env.CLAUDE_PID);
  if (named !== null && pidAlive(named)) return named;
  const table = processTable({ parents: true });
  let pid = process.pid;
  let best = process.ppid;
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    const parent = table.get(pid)?.[0] ?? 0;
    if (parent <= 1 || seen.has(parent) || !table.has(parent)) break;
    seen.add(parent);
    best = parent;
    if (!LAUNCHERS.has(stem(table.get(parent)[1]))) return parent;
    pid = parent;
  }
  return best;
}

// ------------------------------------------------------------------------------------------- running a command

function killTree(child, signal) {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore", timeout: 30_000, windowsHide: true });
    } else {
      process.kill(-child.pid, signal); // the child leads its own process group
    }
  } catch { /* gone already */ }
}

const groupAlive = (pid) => {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** Leading `NAME=value` words set the command's environment, the way a shell reads them. */
export function splitAssignments(command) {
  const vars = {};
  let i = 0;
  for (; i < command.length - 1; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(command[i]);
    if (!m) break;
    vars[m[1]] = m[2];
  }
  return [vars, command.slice(i)];
}

/** The file a program name stands for on Windows (PATH and PATHEXT); null when none is found. */
function whichWindows(program, env) {
  const exts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const dirs = /[\\/]/.test(program) ? [""] : ["", ...String(env.PATH ?? env.Path ?? "").split(";").filter(Boolean)];
  for (const dir of dirs) {
    for (const ext of path.extname(program) ? ["", ...exts] : exts) {
      const file = path.resolve(dir || ".", program + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
    }
  }
  return null;
}

// One word for cmd.exe, which runs a .cmd or .bat file: quoted for the program behind it, then every character
// cmd.exe would act on escaped.
const cmdWord = (word) => `"${String(word).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`.replace(/[()%!^"<>&|]/g, "^$&");

/** What to hand to `spawn` for a program and its arguments: `[file, args, extra options]`. */
function spawnPlan(command, env) {
  if (process.platform !== "win32") return [command[0], command.slice(1), { detached: true }];
  const found = whichWindows(command[0], env);
  if (found && /\.(cmd|bat)$/i.test(found)) {
    // A batch file is not a program: cmd.exe runs it (npm is npm.cmd).
    const line = [found, ...command.slice(1)].map(cmdWord).join(" ");
    return [env.ComSpec || env.COMSPEC || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { windowsVerbatimArguments: true }];
  }
  return [found ?? command[0], command.slice(1), {}];
}

/**
 * Run a program with its arguments (never through a shell) and wait for it. Resolves to `[exit code, timed out]`.
 *
 * - The command's process tree is killed at `maxSeconds` (code 124), and when this process is asked to stop
 *   (SIGINT, SIGTERM, SIGHUP: code 128 + the signal's number), so nothing is left running behind a released lock.
 * - A program that cannot be started gives 127, with the reason through `onError`.
 * - A command ended by a signal gives 128 + the signal's number.
 * - `tick` is called once a minute while the command runs (a lock refreshes itself there).
 *
 * Leading `NAME=value` words go into the command's environment. A line that needs a shell is the caller's to wrap:
 * `bash -c "..."`, `cmd /c "..."`.
 */
export function runChild(command, { env = process.env, extra = {}, maxSeconds = null, tick = null, tickMs = 60_000, onError = () => {} } = {}) {
  const [vars, argv] = splitAssignments(command);
  const childEnv = { ...env, ...extra, ...vars };
  return new Promise((resolve) => {
    let child;
    let timedOut = false;
    let stopped = null;
    let exited = null;
    const timers = [];
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const onSignal = (sig) => {
      if (stopped) return;
      stopped = sig;
      stop();
    };
    const finish = (code) => {
      for (const t of timers) clearTimeout(t);
      clearInterval(ticker);
      for (const sig of signals) process.removeListener(sig, onSignal);
      resolve([code, timedOut]);
    };
    // After the kill was asked for: done once the command and everything it started are gone.
    const settle = () => {
      if (exited === null) return;
      if (groupAlive(child.pid)) timers.push(setTimeout(settle, 50));
      else finish(timedOut ? TIMED_OUT : 128 + (os.constants.signals[stopped] ?? 15));
    };
    function stop() {
      killTree(child, "SIGTERM");
      timers.push(setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS));
      settle();
    }
    let ticker = null;
    try {
      const [file, args, options] = spawnPlan(argv, childEnv);
      child = spawn(file, args, { stdio: "inherit", env: childEnv, windowsHide: true, ...options });
    } catch (e) {
      onError(e.message);
      resolve([NOT_STARTED, false]);
      return;
    }
    for (const sig of signals) process.on(sig, onSignal);
    if (tick) {
      ticker = setInterval(() => {
        try { tick(); } catch { /* the next tick tries again: a failed refresh must not stop the command */ }
      }, tickMs);
    }
    if (maxSeconds !== null && maxSeconds !== undefined) {
      timers.push(setTimeout(() => {
        timedOut = true;
        stop();
      }, Math.min(Math.max(0, maxSeconds) * 1000, 2 ** 31 - 1)));
    }
    child.on("error", (e) => {
      if (exited !== null) return;
      exited = NOT_STARTED;
      onError(e.code === "ENOENT" ? `'${argv[0]}' was not found. It runs as a program with its arguments: wrap a shell line yourself (bash -c "...")` : e.message);
      finish(NOT_STARTED);
    });
    child.on("exit", (code, sig) => {
      if (exited !== null) return;
      exited = code ?? 128 + (os.constants.signals[sig] ?? 0);
      if (timedOut || stopped) settle();
      else finish(exited);
    });
  });
}

// ------------------------------------------------------------------------------------------ who and which project

/**
 * Who is asking and for which project, resolved once per command from its `io` (`{ cwd, env }`): `home` (the
 * store), `cfg`, `project` (the id), `root` (the main checkout), `name` (the project's, for people) and `agent`
 * (the caller's name, resolved when first read; `as` is an explicit `--as`).
 */
export function context(io = {}, as = null) {
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const cfg = loadConfig(cwd);
  const project = projectId(cwd);
  const root = mainRoot(cwd) ?? realPath(cwd);
  let agent = null;
  return {
    cwd, env, cfg, project, root,
    home: awHome(env),
    name: projectName(root, cfg) || project,
    get agent() {
      agent ??= identity(cfg, as, env);
      return agent;
    },
    /** Note this project in projects.json (cheap: written at most every few hours). */
    stamp() {
      touchProject(this.home, project, root, this.name);
    },
  };
}

/**
 * The agent's name: `explicit` (an `--as`), else the environment (the config's agent variable and its aliases), else
 * `session-<pid>`. A coordination aid between cooperating agents, not a security boundary: a name is whatever its
 * bearer says.
 */
export function identity(cfg = null, explicit = null, env = process.env) {
  if (explicit) {
    if (!AGENT_RE.test(explicit)) throw new AwError(`agent name '${explicit}': lower-case letters, digits and '-' only`);
    return explicit;
  }
  const name = agentName(cfg, env);
  if (name) {
    const clean = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    if (clean) return clean;
  }
  return `session-${sessionPid(env)}`;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The projects seen on this machine: `{project id: {root, name, seen}}`. */
export function projects(home) {
  const doc = readJson(path.join(home, "projects.json"), {});
  return isObject(doc) ? doc : {};
}

/** Write a project into projects.json unless it is there, unchanged, and was seen in the last six hours. */
export function touchProject(home, project, root, name = null) {
  const label = name || path.basename(root) || project;
  const entry = projects(home)[project];
  if (isObject(entry) && entry.root === posix(root) && entry.name === label && ageSeconds(entry.seen) < 6 * 3600) return;
  try {
    updateJson(path.join(home, "projects.json"), {}, (doc) => {
      doc[project] = { root: posix(root), name: label, seen: now() };
    });
  } catch { /* a list of projects seen is a convenience: never the reason a command fails */ }
}

/** A project's name for people: the one it was seen with, else its id without the hash; `?` for none. */
export function projectLabel(project, known) {
  if (!project) return "?";
  const entry = known?.[project];
  if (isObject(entry) && entry.name) return String(entry.name);
  return String(project).replace(/-[0-9a-f]{8}$/, "");
}

/** Project ids matching what a person typed: the id, the project's name, or a prefix of the id. */
export function findProject(home, text) {
  const known = projects(home);
  const seen = [...new Set([...Object.keys(known), ...projectFolders(home)])];
  const low = String(text).toLowerCase();
  const exact = seen.filter((p) => p.toLowerCase() === low || projectLabel(p, known).toLowerCase() === low);
  return (exact.length ? exact : seen.filter((p) => p.toLowerCase().startsWith(low))).sort();
}

// ---------------------------------------------------------------------------------------------------------- notes

/** A project's notes log; the machine's when `project` is null. */
export const notePath = (home, project) => path.join(project ? projectDir(home, project) : home, "notes.log");

/** One line on a project's notes log (`project` null: the machine's). Gives the line back. */
export function appendNote(home, project, who, text, maxBytes = null) {
  const line = `${now()}  ${who}  ${String(text).split(/\s+/).filter(Boolean).join(" ")}`;
  appendLine(notePath(home, project), line, maxBytes);
  return line;
}
