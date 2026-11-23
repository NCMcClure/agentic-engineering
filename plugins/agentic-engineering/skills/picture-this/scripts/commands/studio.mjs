// pt studio: serve a repo's figures and drafts, live, in the browser.
import fs from "node:fs";
import { PtError, parseArgs } from "../lib/args.mjs";
import { ensureDrafts, layout } from "../lib/config.mjs";
import { PLUGIN_ROOT, dataHome, repoRoot } from "../lib/home.mjs";
import { childEnv, homeLayout, installState, runNode, runningPort, studioEnv, syncSources } from "../lib/studio.mjs";

const HELP = `usage: node pt.mjs studio [--repo <dir>]

Starts the studio for a repo: a gallery of its figures and scratch drafts, each
live, with a bare frame and a contact sheet per figure. Run it in the
background and read the URL from the "Local:" line it prints; the port is
Vite's to choose. Stopping the command stops the studio.

Exit codes: 0 a studio was already running for this repo (its URL is printed),
2 the studio is not installed or the arguments are wrong; otherwise the dev
server's own exit code.`;

/** The studio must be installed and current before anything is started from it. */
export function requireStudio(home, pluginRoot, { browser = false } = {}) {
  const state = installState(home, pluginRoot);
  if (state.app !== "ready") {
    throw new PtError(`the studio is ${state.app === "stale" ? "out of date (the plugin was updated)" : "not installed"}: run \`setup --yes\` first`);
  }
  if (browser && state.browser !== "ready") throw new PtError("the browser stills are taken with is not installed: run `setup --yes` first");
  // The packages are current; the sources are cheap to refresh, so a plugin
  // update that changed only the app's own files needs no reinstall.
  syncSources(home, pluginRoot);
  return homeLayout(home);
}

/** `deps` stands in for the outside world in tests: env, cwd, pluginRoot, node, fetch, log. */
export async function run(argv, deps = {}) {
  const { env = process.env, cwd = process.cwd(), pluginRoot = PLUGIN_ROOT, node = runNode, fetch: fetchImpl = globalThis.fetch, log = console.log } = deps;
  const opts = parseArgs(argv, { repo: "string" });
  if (opts.help) { process.stdout.write(HELP + "\n"); return 0; }
  if (opts._.length) throw new PtError(HELP);
  const home = dataHome(env);
  const at = layout(repoRoot(opts.repo, { cwd }));
  const studio = requireStudio(home, pluginRoot);
  ensureDrafts(at.repo);

  if (fs.existsSync(at.lock)) {
    const port = await runningPort(at.lock, at.repo, fetchImpl);
    if (port !== null) {
      log("The picture-this studio is already running for this repo.");
      log(`  ➜  Local:   http://127.0.0.1:${port}/`);
      return 0;
    }
    fs.rmSync(at.lock, { force: true }); // left behind by a server that died
  }

  log(`picture-this: starting the studio for ${at.repo} ...`);
  return node([studio.vite], { cwd: studio.app, env: childEnv(env, studioEnv(at)) });
}
