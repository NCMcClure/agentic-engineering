// The studio's install home and its dev server. The app ships as source under
// the plugin's app/; it is copied into the data folder, its packages are
// installed there once, and it is run from there. The plugin itself stays
// free of dependencies.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// What the app needs to run; everything else in app/ stays in the plugin.
export const SOURCE_DIRS = ["src", "fixtures"];
export const SOURCE_FILES = ["index.html", "vite.config.mjs", "capture.mjs", "package.json", "package-lock.json"];
const HEALTH_TIMEOUT_MS = 5000;
const STAMP = ".install-stamp";

const pathKey = (env) => Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";

/** The full path of a program on PATH, or null. On Windows a program is found under any PATHEXT ending. */
export function findOnPath(name, env = process.env, platform = process.platform) {
  const dirs = (env[pathKey(env)] ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const endings = platform === "win32" ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ending of endings) {
      const candidate = path.join(dir, name + ending);
      try {
        if (!fs.statSync(candidate).isFile()) continue;
        if (platform !== "win32") fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

/** The lines to print when a prerequisite is missing, or null when npm is there and Node is new enough. */
export function prerequisites({ env = process.env, platform = process.platform, nodeVersion = process.versions.node } = {}) {
  if (!findOnPath("npm", env, platform)) {
    return [
      "'npm' was not found on PATH. It normally ships with Node.js (20+).",
      "Install Node.js from https://nodejs.org/ or via your package manager, then retry.",
    ];
  }
  if (Number(nodeVersion.split(".")[0]) < 20) {
    return [`Node.js v${nodeVersion} is too old: the studio (Vite 6) needs Node 20+.`, "Upgrade Node.js, then retry."];
  }
  return null;
}

const read = (file) => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } };
export const lockHash = (lockfile) => createHash("sha256").update(fs.readFileSync(lockfile)).digest("hex");
/** The Playwright version the lockfile pins: the browser it downloads is tied to it. */
export function playwrightVersion(lockfile) {
  try { return JSON.parse(fs.readFileSync(lockfile, "utf8")).packages["node_modules/playwright"].version; } catch { return ""; }
}

/** The folders of an install home. */
export function homeLayout(home) {
  const app = path.join(home, "app");
  return { home, app, browsers: path.join(home, "browsers"), vite: path.join(app, "node_modules", "vite", "bin", "vite.js"), playwright: path.join(app, "node_modules", "playwright", "cli.js") };
}

/**
 * What is installed. `app` is "ready" when the packages match the plugin's
 * lockfile, "stale" when a different lockfile was installed, "missing" when
 * nothing was. `browser` is "ready" when the browser for the pinned Playwright
 * is there.
 */
export function installState(home, pluginRoot) {
  const at = homeLayout(home);
  const lockfile = path.join(pluginRoot, "app", "package-lock.json");
  const stamp = read(path.join(at.app, STAMP));
  const browserStamp = read(path.join(at.browsers, STAMP));
  return {
    app: !stamp ? "missing" : stamp === lockHash(lockfile) ? "ready" : "stale",
    browser: browserStamp && browserStamp === playwrightVersion(lockfile) ? "ready" : "missing",
  };
}

/**
 * Replace the install home's copy of the app sources, and give its fixtures
 * the kit they draw with. node_modules and the stamps are left alone.
 */
export function syncSources(home, pluginRoot) {
  const from = path.join(pluginRoot, "app"), to = homeLayout(home).app;
  fs.mkdirSync(to, { recursive: true });
  for (const dir of SOURCE_DIRS) {
    fs.rmSync(path.join(to, dir), { recursive: true, force: true });
    fs.cpSync(path.join(from, dir), path.join(to, dir), { recursive: true });
  }
  for (const file of SOURCE_FILES) fs.copyFileSync(path.join(from, file), path.join(to, file));
  fs.cpSync(path.join(pluginRoot, "kit"), path.join(to, "fixtures", "kit"), { recursive: true });
}

/** The child's environment: PATH ends with this Node's folder, so `node` is found even when this script was started by full path. */
export function childEnv(env = process.env, extra = {}) {
  const key = pathKey(env);
  return { ...env, [key]: [env[key], path.dirname(process.execPath)].filter(Boolean).join(path.delimiter), ...extra };
}

/** Run a program with the terminal's own stdio; resolves to its exit code. Signals sent to this process reach it. */
export function run(command, args, { cwd, env, shell = false } = {}) {
  return new Promise((resolve) => {
    const options = { cwd, env, stdio: "inherit" };
    const child = shell ? spawn([command, ...args].join(" "), { ...options, shell: true }) : spawn(command, args, options);
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const forward = (signal) => { try { child.kill(signal); } catch { /* already gone */ } };
    for (const signal of signals) process.on(signal, forward);
    const done = (code) => {
      for (const signal of signals) process.off(signal, forward);
      resolve(code);
    };
    child.on("error", () => done(127));
    child.on("exit", (code, signal) => done(code ?? 128 + (os.constants.signals[signal] ?? 0)));
  });
}

// npm is npm.cmd on Windows, which only a shell can start; the command is
// fixed words, so there is nothing in it for a shell to misread.
export const runNpm = (args, options) => run("npm", args, { ...options, shell: process.platform === "win32" });
export const runNode = (args, options) => run(process.execPath, args, options);

/**
 * Install what is not there yet: the app's packages, then the browser. Each
 * stamp is written only after its step succeeds, so a failed or interrupted
 * install is retried next time instead of being taken for done. Returns 0, or
 * the exit code of the step that failed.
 */
export async function install({ home, pluginRoot, env = process.env, browser = true, npm = runNpm, node = runNode, log = console.log, warn = console.error }) {
  const at = homeLayout(home);
  const lockfile = path.join(pluginRoot, "app", "package-lock.json");
  const state = installState(home, pluginRoot);
  syncSources(home, pluginRoot);
  if (state.app !== "ready") {
    log(`picture-this: installing the studio into ${at.app} ...`);
    fs.rmSync(path.join(at.app, STAMP), { force: true });
    const status = await npm(["ci", "--no-audit", "--no-fund"], { cwd: at.app, env: childEnv(env) });
    if (status !== 0) {
      warn("picture-this: `npm ci` failed. It needs network access the first time; nothing was marked as installed, so running setup again retries it.");
      return status;
    }
    fs.writeFileSync(path.join(at.app, STAMP), lockHash(lockfile) + "\n");
  }
  if (browser && installState(home, pluginRoot).browser !== "ready") {
    log(`picture-this: downloading the browser stills are taken with into ${at.browsers} ...`);
    fs.mkdirSync(at.browsers, { recursive: true });
    fs.rmSync(path.join(at.browsers, STAMP), { force: true });
    const status = await node([at.playwright, "install", "chromium"], { cwd: at.app, env: childEnv(env, { PLAYWRIGHT_BROWSERS_PATH: at.browsers }) });
    if (status !== 0) {
      warn("picture-this: the browser download failed. The studio still previews figures; stills need the browser, and running setup again retries it.");
      return status;
    }
    fs.writeFileSync(path.join(at.browsers, STAMP), playwrightVersion(lockfile) + "\n");
  }
  return 0;
}

/**
 * The port of a studio already serving this repo, or null. The server writes
 * the lock with its port; the lock counts only while that port's /api/health
 * answers as picture-this for the same repo.
 */
export async function runningPort(lockFile, repo, fetchImpl = globalThis.fetch) {
  let port;
  try { port = JSON.parse(fs.readFileSync(lockFile, "utf8")).port; } catch { return null; }
  if (!Number.isInteger(port)) return null;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const health = await response.json();
    return health && health.ok && health.app === "picture-this" && (!repo || path.resolve(health.repo) === path.resolve(repo)) ? port : null;
  } catch { return null; }
}

/** What the dev server is told about the repo it serves. */
export function studioEnv(at) {
  return { PT_REPO: at.repo, PT_FIGURES: at.figures, PT_DRAFTS: at.drafts };
}
