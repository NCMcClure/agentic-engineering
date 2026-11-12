// What the agent-works suites for the homes commands (hubs, twins, memory,
// decisions, links, dup, status, setup, doctor) share: a throwaway project and
// `aw` run against it in this process.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./helpers.mjs";

export const PLUGIN = path.join(REPO, "plugins", "agent-works");
const load = (rel) => import(pathToFileURL(path.join(PLUGIN, rel)).href);

export const common = await load("lib/common.mjs");
export const config = await load("lib/config.mjs");
const dispatcher = await load("scripts/aw.mjs");

/** A command module of the plugin, by its file name under scripts/. */
export const script = (name) => load(`scripts/${name}`);

const NAMES_OF_AN_AGENT = ["AW_AGENT", "PL_AGENT", "CLAUDE_AGENT_NAME", "AW_RUN", "AW_HOME", "AGENT_WORKS_HOME"];

/**
 * A temp folder that holds a project named `acme` and a store beside it, removed when the test ends.
 *
 * `git`: "stub" (the default) gives a `.git` folder with a HEAD and nothing else, which the commands take for a
 * repository while git itself does not, so every check runs from the files on disk; "real" runs `git init`; false
 * gives no repository at all. `config` is written as `.agents/agent-works.json` when given.
 */
export function project(t, { config: doc, branch = "feat/x", git = "stub" } = {}) {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "aw-homes-")));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));
  const root = path.join(tmp, "acme");
  const home = path.join(tmp, "aw-home");
  fs.mkdirSync(root);
  const at = (rel) => path.join(root, ...rel.split("/"));
  const p = {
    tmp, root, home, at,
    write(rel, text = "") {
      fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
      fs.writeFileSync(at(rel), text);
      return at(rel);
    },
    read: (rel) => fs.readFileSync(at(rel), "utf8"),
    exists: (rel) => fs.existsSync(at(rel)),
    remove: (rel) => fs.rmSync(at(rel), { recursive: true, force: true }),
    /** The environment a command runs in: this one without an agent's name, the store in the temp folder. */
    env(extra = {}) {
      const env = { ...process.env };
      for (const name of NAMES_OF_AN_AGENT) delete env[name];
      return { ...env, AW_HOME: home, ...extra };
    },
    /** `aw <args>` in the project, in this process: `[exit code, stdout, stderr]`. */
    async aw(...args) {
      return p.awIn(root, ...args);
    },
    async awIn(cwd, ...args) {
      const io = common.bufferedIo({ cwd, env: p.env() });
      const code = await dispatcher.main(args, io);
      return [code, io.out(), io.err()];
    },
    /** git in the project, with an identity and the bytes left as they are; gives stdout. */
    git(...args) {
      return execFileSync("git", ["-C", root, "-c", "core.autocrlf=false", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    },
    /** Every file of the project outside `.git`, repo-relative, sorted. */
    tree() {
      const out = [];
      const walk = (dir, prefix) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (prefix === "" && e.name === ".git") continue;
          if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
          else out.push(prefix + e.name);
        }
      };
      walk(root, "");
      return out.sort();
    },
  };
  if (git === "stub") {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
  } else if (git === "real") {
    p.git("init", "-q", "-b", "main");
    p.git("config", "core.autocrlf", "false");
  }
  if (doc !== undefined) p.write(".agents/agent-works.json", JSON.stringify(doc, null, 2));
  return p;
}

/** `[code, path]` of each finding, sorted: what most assertions compare. */
export const codes = (findings) => findings.map((f) => [f.code, f.path])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

/** Whether this machine has git: the tests that need a real repository skip without it. */
export const HAS_GIT = (() => {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
})();
