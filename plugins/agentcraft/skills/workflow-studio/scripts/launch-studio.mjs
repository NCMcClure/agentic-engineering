#!/usr/bin/env node
// Start Workflow Studio: sync the bundled app into a persistent install home,
// install its dependencies when the lockfile changed, and start the Vite dev
// server with STUDIO_ROOT pointed at the folder workflow projects persist in.
//
//   node launch-studio.mjs <plugin-root> <studio-root> <data-dir>
//     plugin-root   holds app/, the bundled source (read-only)
//     studio-root   where workflow projects persist
//     data-dir      persistent install home; the app runs from <data-dir>/app
//
// Env (optional): WORKFLOW_EXPORT_ROOT or CLAUDE_PROJECT_DIR, the project dir
// Publish is allowed to write into; forwarded to the dev server.
//
// Exit 2 on a usage error, 1 when a prerequisite is missing, 0 when a studio
// is already running for this studio root; otherwise the dev server's own
// exit code, since this process lives exactly as long as the server does.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE = "Usage: node launch-studio.mjs <plugin-root> <studio-root> <data-dir>";
// What the app needs to build and run; everything else in app/ stays in the plugin.
const SOURCE_DIRS = ["src", "docs"];
const SOURCE_FILES = ["index.html", "vite.config.ts", "tsconfig.json", "tsconfig.node.json", "package.json", "package-lock.json"];
const HEALTH_TIMEOUT_MS = 5000;

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
      "Error: 'npm' was not found on PATH. It normally ships with Node.js (20+).",
      "Install Node.js from https://nodejs.org/ or via your package manager, then retry.",
    ];
  }
  if (Number(nodeVersion.split(".")[0]) < 20) {
    return [`Error: Node.js v${nodeVersion} is too old. Workflow Studio (Vite 6) needs Node 20+.`, "Upgrade Node.js, then retry."];
  }
  return null;
}

/**
 * The port of a studio already serving this studio root, or null. The server
 * writes <studio-root>/.studio.lock with its port; the lock counts only while
 * that port's /api/health answers as the studio.
 */
export async function runningPort(lockFile, fetchImpl = globalThis.fetch) {
  let port;
  try { port = JSON.parse(fs.readFileSync(lockFile, "utf8")).port; } catch { return null; }
  if (!Number.isInteger(port)) return null;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const health = await response.json();
    return health && health.ok && health.app === "workflow-studio" ? port : null;
  } catch { return null; }
}

export const lockHash = (lockfile) => createHash("sha256").update(fs.readFileSync(lockfile)).digest("hex");

/** Replace the install home's copy of the app sources; node_modules and the stamp are left alone. */
function copySources(appSrc, appRun) {
  for (const dir of SOURCE_DIRS) {
    fs.rmSync(path.join(appRun, dir), { recursive: true, force: true });
    fs.cpSync(path.join(appSrc, dir), path.join(appRun, dir), { recursive: true });
  }
  for (const file of SOURCE_FILES) fs.copyFileSync(path.join(appSrc, file), path.join(appRun, file));
}

/** Run npm with the terminal's own stdio; resolves to its exit code. Signals sent to this process reach it. */
function runNpm(args, { cwd, env }) {
  return new Promise((resolve) => {
    // npm is npm.cmd on Windows, which only a shell can start; the command is
    // fixed words, so there is nothing in it for a shell to misread.
    const options = { cwd, env, stdio: "inherit" };
    const child = process.platform === "win32" ? spawn(["npm", ...args].join(" "), { ...options, shell: true }) : spawn("npm", args, options);
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

/**
 * The launcher. `deps` lets a caller stand in for the outside world: `npm`
 * (run an npm command, resolve to its exit code), `fetch`, `env`, `log`, `warn`.
 */
export async function main(argv, deps = {}) {
  const { env = process.env, platform = process.platform, nodeVersion = process.versions.node, npm = runNpm, fetch: fetchImpl = globalThis.fetch, log = console.log, warn = console.error } = deps;
  if (argv.length !== 3) {
    warn(USAGE);
    return 2;
  }
  const [pluginRoot, studioRoot, dataDir] = argv.map((arg) => path.resolve(arg));

  const missing = prerequisites({ env, platform, nodeVersion });
  if (missing) {
    for (const line of missing) warn(line);
    return 1;
  }

  const appSrc = path.join(pluginRoot, "app");
  const appRun = path.join(dataDir, "app");
  if (!fs.existsSync(appSrc) || !fs.statSync(appSrc).isDirectory()) {
    warn(`Error: vendored app not found at ${appSrc} \u2014 is the plugin installed correctly?`);
    return 1;
  }

  // Already running? Hand back that URL instead of starting a second instance,
  // which would double the file watcher.
  const lockFile = path.join(studioRoot, ".studio.lock");
  if (fs.existsSync(lockFile)) {
    const port = await runningPort(lockFile, fetchImpl);
    if (port !== null) {
      log("Workflow Studio is already running.");
      log(`  \u279c  Local:   http://localhost:${port}/`);
      return 0;
    }
    fs.rmSync(lockFile, { force: true }); // left behind by a server that died
  }

  // The child's PATH ends with this Node's folder, so the dev server's own
  // `node` lookups succeed even when this script was started by full path.
  const key = pathKey(env);
  const childEnv = { ...env, [key]: [env[key], path.dirname(process.execPath)].filter(Boolean).join(path.delimiter) };

  // The install stamp (the lockfile's hash) is written only after `npm ci`
  // succeeds, so a failed or interrupted install is retried on the next
  // launch instead of leaving a half-installed node_modules that a lockfile
  // compare would call done.
  fs.mkdirSync(appRun, { recursive: true });
  const stampFile = path.join(appRun, ".install-stamp");
  const hash = lockHash(path.join(appSrc, "package-lock.json"));
  let stamp = "";
  try { stamp = fs.readFileSync(stampFile, "utf8").replace(/\n+$/, ""); } catch { /* never installed */ }

  if (stamp !== hash) {
    log(`Workflow Studio: (re)installing app into ${appRun} (first run or lockfile changed)...`);
    fs.rmSync(stampFile, { force: true });
    copySources(appSrc, appRun);
    const status = await npm(["ci"], { cwd: appRun, env: childEnv });
    if (status !== 0) return status;
    fs.writeFileSync(stampFile, hash);
  } else {
    // Install unchanged: refresh the sources, which is cheap, without reinstalling.
    copySources(appSrc, appRun);
  }

  fs.mkdirSync(studioRoot, { recursive: true });
  const exportRoot = env.WORKFLOW_EXPORT_ROOT || env.CLAUDE_PROJECT_DIR || "";
  log(`Workflow Studio: starting dev server (STUDIO_ROOT=${studioRoot})...`);
  return npm(["run", "dev"], { cwd: appRun, env: { ...childEnv, STUDIO_ROOT: studioRoot, WORKFLOW_EXPORT_ROOT: exportRoot } });
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = await main(process.argv.slice(2));
