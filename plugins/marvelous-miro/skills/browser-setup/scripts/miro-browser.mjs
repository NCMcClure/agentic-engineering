#!/usr/bin/env node
// The plugin's browser server: chrome-devtools-mcp, pinned, with a Chrome profile of
// its own so a Miro sign-in made there persists and never fights another
// chrome-devtools server over the default profile. The plugin's .mcp.json starts this
// over stdio; check-setup.mjs reads ARGS to write the same server into Claude
// Desktop's config. Importing this file starts nothing.
//
// The profile sits under the person's home rather than the plugin's data directory
// because Claude Desktop, which knows nothing of that directory, has to open the same
// one. The sign-in is the only credential the plugin ever touches, and it never leaves
// that profile: no script here reads it.

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const PACKAGE = "chrome-devtools-mcp@1.11.0";
export const PROFILE = path.join(homedir(), ".cache", "marvelous-miro", "chrome-profile");
// The live check needs pages, scripts, and screenshots; performance, network, and
// emulation tools would only add schemas.
export const ARGS = ["-y", PACKAGE, `--userDataDir=${PROFILE}`, "--no-category-performance", "--no-category-network", "--no-category-emulation", "--no-usage-statistics"];
// npx beside the node running this, so a GUI-launched app with a short PATH still finds it.
export const npx = () => {
  const name = process.platform === "win32" ? "npx.cmd" : "npx";
  const beside = path.join(path.dirname(process.execPath), name);
  return existsSync(beside) ? beside : name;
};

// realpath: a plugin cached under a symlinked folder would otherwise never match and start nothing.
const invoked = (() => { try { return realpathSync(process.argv[1] ?? ""); } catch { return null; } })();
if (invoked === import.meta.filename) {
  // npx.cmd needs a shell on Windows, and a shell splits an unquoted path at its spaces.
  const windows = process.platform === "win32";
  const quoted = (arg) => (windows && /\s/.test(arg) ? `"${arg}"` : arg);
  const child = spawn(quoted(npx()), ARGS.map(quoted), { stdio: "inherit", shell: windows });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, sig) => { process.exitCode = code ?? (sig ? 1 : 0); });
  child.on("error", (e) => { console.error(`miro-browser: could not start ${PACKAGE}: ${e.message}`); process.exitCode = 1; });
}
