// pt setup: install the studio into the plugin's data folder, once.
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { PLUGIN_ROOT, dataHome } from "../lib/home.mjs";
import { homeLayout, install, installState, prerequisites } from "../lib/studio.mjs";

const HELP = `usage: node pt.mjs setup [--yes] [--check] [--no-browser] [--json]

Installs the studio figures are rendered in: a Vite app and its packages, and
the headless browser stills are taken with. Both go into the plugin's data
folder, never into your project, and are downloaded once.

  --check        say what is installed and change nothing
  --yes          download and install; without it, setup only says what it would do
  --no-browser   skip the browser: figures still preview, stills cannot be taken

Exit codes: 0 installed, 1 not installed (or an install step failed), 2 usage or environment.`;

/** `deps` stands in for the outside world in tests: env, pluginRoot, npm, node, log, warn. */
export async function run(argv, deps = {}) {
  const { env = process.env, pluginRoot = PLUGIN_ROOT, log = console.log, warn = console.error } = deps;
  const opts = parseArgs(argv, { yes: "bool", check: "bool", "no-browser": "bool" });
  if (opts.help) { process.stdout.write(HELP + "\n"); return 0; }
  if (opts._.length) throw new PtError(HELP);
  const home = dataHome(env);
  const at = homeLayout(home);
  const wantBrowser = !opts.noBrowser;
  const state = installState(home, pluginRoot);
  const ready = state.app === "ready" && (!wantBrowser || state.browser === "ready");
  const doc = { home, app: state.app, browser: state.browser, ready };

  if (opts.check || ready) {
    emit(doc, opts.json, [
      `studio:  ${state.app}${state.app === "stale" ? " (the plugin was updated: its packages changed)" : ""}`,
      `browser: ${state.browser}`,
      ready ? `ok: installed in ${home}` : "not installed: run `setup --yes`",
    ].join("\n"));
    return ready ? 0 : 1;
  }

  const missing = prerequisites(deps);
  if (missing) throw new PtError(missing.join("\n"));

  if (!opts.yes) {
    emit({ ...doc, wouldInstall: true }, opts.json, [
      `picture-this renders figures in a studio it installs once, into its own data folder:`,
      `  ${at.app}`,
      ...(state.app === "ready" ? [] : ["  - npm packages: Vite, React, Playwright, two fonts (about 120 packages, from the npm registry)"]),
      ...(wantBrowser && state.browser !== "ready" ? ["  - a headless Chromium, for stills (about 100 MB to download, 200 MB on disk)"] : []),
      "Nothing is added to your project. It needs network access this once.",
      "To install: run this command again with --yes.",
    ].join("\n"));
    return 1;
  }

  const status = await install({ home, pluginRoot, env, browser: wantBrowser, npm: deps.npm, node: deps.node, log, warn });
  if (status !== 0) return status === 2 ? 1 : status;
  const after = installState(home, pluginRoot);
  emit({ home, app: after.app, browser: after.browser, ready: true }, opts.json, `ok: installed in ${home}`);
  return 0;
}
