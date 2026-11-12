// What the agent-works coordination suites share: temp projects on one temp
// store, and `aw` as separate processes. Nothing here touches the real store:
// every child gets AW_HOME pointing into the test's temp folder. No tests live
// in this file.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, tempDir } from "./helpers.mjs";

export const PLUGIN = path.join(REPO, "plugins", "agent-works");
export const AW = path.join(PLUGIN, "scripts", "aw.mjs");
export const NODE = process.execPath;
/** Import a module of the plugin by its path under the plugin folder. */
export const load = (rel) => import(pathToFileURL(path.join(PLUGIN, rel)).href);

const STRAY = ["AW_AGENT", "PL_AGENT", "CLAUDE_AGENT_NAME", "AW_RUN", "AW_LEASE", "CLAUDE_PID", "AGENT_WORKS_HOME", "AW_HOME", "AW_SESSION_PID"];

/** The id of a process that has exited. */
export function deadPid() {
  return spawnSync(NODE, ["-e", ""]).pid;
}

export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Poll `fn` until it gives something truthy; fails after `ms`. */
export async function until(fn, ms = 20_000, what = "the condition") {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what} did not come true within ${ms} ms`);
    await sleep(100);
  }
}

/** A stamp of the store, `seconds` from now. */
export const stampIn = (seconds) => new Date(Math.floor(Date.now() / 1000 + seconds) * 1000).toISOString().replace(/\.\d+Z$/, "Z");

/**
 * One temp store and one temp project `proj` (with `config` as its .agents/agent-works.json when given), removed
 * when the test ends; every child still running then is killed first.
 */
export function world(t, config = null) {
  const tmp = fs.realpathSync.native(tempDir(t, "aw-coord-"));
  const home = path.join(tmp, "store");
  const children = [];
  t.after(() => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });

  const w = {
    tmp,
    home,
    /** The environment of a child: the test runner's, without anything that names an agent or a store, plus `extra`. */
    env(extra = {}) {
      const env = { ...process.env };
      for (const key of STRAY) delete env[key];
      return { ...env, AW_HOME: home, AW_SESSION_PID: String(process.pid), ...extra };
    },
    /** What an in-process call takes: `{ cwd, env }`. */
    at(cwd = w.proj, extra = {}) {
      return { cwd, env: w.env(extra) };
    },
    writeConfig(root, doc) {
      fs.mkdirSync(path.join(root, ".agents"), { recursive: true });
      fs.writeFileSync(path.join(root, ".agents", "agent-works.json"), JSON.stringify(doc));
    },
    /** A folder that looks like a repository (a .git folder with a HEAD: no git process needed). */
    project(name, doc = null) {
      const root = path.join(tmp, name);
      fs.mkdirSync(path.join(root, ".git"), { recursive: true });
      fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/feat/x\n");
      if (doc !== null) w.writeConfig(root, doc);
      return root;
    },
    /** `aw <args>` run to its end: `{ status, stdout, stderr }`. Options: `cwd`, `env` (extra variables), `stdin`. */
    aw(args, { cwd = w.proj, env = {}, stdin = "", timeout = 90_000 } = {}) {
      const r = spawnSync(NODE, [AW, ...args.map(String)], { cwd, env: w.env(env), encoding: "utf8", input: stdin, timeout });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
    /** `aw <args> --json` parsed (the flag is the caller's to pass). */
    doc(args, options = {}) {
      const r = w.aw(args, options);
      try {
        return JSON.parse(r.stdout);
      } catch {
        throw new Error(`aw ${args.join(" ")}: not JSON (exit ${r.status})\n${r.stdout}\n${r.stderr}`);
      }
    },
    /** `aw <args>` as a background process: `{ child, done, exited }`, `done` resolving to `{ status, stdout, stderr }`. */
    spawn(args, { cwd = w.proj, env = {} } = {}) {
      return w.start(NODE, [AW, ...args.map(String)], { cwd, env });
    },
    /** Any program as a background process, the same way. */
    start(program, args, { cwd = w.proj, env = {} } = {}) {
      const child = spawn(program, args, { cwd, env: w.env(env), stdio: ["ignore", "pipe", "pipe"] });
      children.push(child);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const done = new Promise((resolve) => {
        child.on("close", (code, signal) => resolve({ status: code ?? `signal ${signal}`, stdout, stderr }));
      });
      // `done` waits for everything that inherited the pipes; `exited` only for the process itself.
      const exited = new Promise((resolve) => { child.on("exit", resolve); });
      return { child, done, exited };
    },
    /** A child Node running `code` as a module, with `args` (for races on the store's own functions). */
    script(code, args = []) {
      return w.start(NODE, ["--input-type=module", "-e", code, "--", ...args.map(String)]);
    },
    /** The project id `aw` gives a folder. */
    id(cwd = w.proj) {
      return w.doc(["lock", "status", "--json"], { cwd }).project;
    },
  };
  w.proj = w.project("proj", config);
  return w;
}
