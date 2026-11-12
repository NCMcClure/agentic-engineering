#!/usr/bin/env node
// Checks what the live Miro check needs on this machine: Node new enough for
// chrome-devtools-mcp, npx, Google Chrome, and (for Claude Desktop surfaces that do not
// start plugin servers) the browser server in Claude Desktop's config.
//
// Usage:
//   node check-setup.mjs                    JSON report; exit 1 when the browser server cannot start
//   node check-setup.mjs --desktop          print the Claude Desktop config entry
//   node check-setup.mjs --desktop --write  merge it into Claude Desktop's config (backup kept)
// MARVELOUS_MIRO_CHROME and MARVELOUS_MIRO_DESKTOP_CONFIG override the Chrome and config
// paths it looks at.
//
// It reads paths and versions only. No Miro sign-in, token, or cookie is read, written,
// or printed here: the sign-in lives in the browser profile, and stays there.
// The session hook imports report() to say one line when a Miro project is open on a
// machine the live check cannot run on; importing this file runs nothing.

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ARGS, PROFILE, npx } from "./miro-browser.mjs";

const NAME = "miro-browser";
// Where a project keeps its config: at its root, or in diagrams/ (init.mjs's default).
export const PROJECT_CONFIGS = ["miro.config.mjs", "diagrams/miro.config.mjs"];

const onPath = (env, bin) => (env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, bin)).find(existsSync) ?? null;

function chrome(env) {
  if (env.MARVELOUS_MIRO_CHROME !== undefined) return existsSync(env.MARVELOUS_MIRO_CHROME) ? env.MARVELOUS_MIRO_CHROME : null;
  const mac = "Google Chrome.app/Contents/MacOS/Google Chrome";
  const win = "Google/Chrome/Application/chrome.exe";
  const spots = {
    darwin: [path.join("/Applications", mac), path.join(homedir(), "Applications", mac)],
    win32: [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, win)),
  }[process.platform];
  return spots ? spots.find(existsSync) ?? null : onPath(env, "google-chrome") ?? onPath(env, "google-chrome-stable");
}

const desktopConfig = (env) => env.MARVELOUS_MIRO_DESKTOP_CONFIG ?? {
  darwin: path.join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  win32: path.join(env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json"),
}[process.platform] ?? path.join(homedir(), ".config", "Claude", "claude_desktop_config.json");

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);

/** What this machine has of what the browser server needs, and the project found under `root`. */
export function report({ root = process.cwd(), env = process.env } = {}) {
  const [maj, min] = process.versions.node.split(".").map(Number);
  const node = { version: process.versions.node, ok: maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19) };
  // The PATH's npx survives a Node upgrade; the one beside this node is the fallback.
  const npxPath = onPath(env, path.basename(npx())) ?? (existsSync(npx()) ? npx() : null);
  const browser = chrome(env);
  const file = desktopConfig(env);
  let servers = {};
  try { servers = readJson(file)?.mcpServers ?? {}; } catch { servers = null; }
  const entry = servers && Object.entries(servers).find(([, s]) => (s.args ?? []).some((a) => String(a).includes("chrome-devtools-mcp")));
  const project = PROJECT_CONFIGS.map((f) => path.resolve(root, f)).find(existsSync) ?? null;
  const fixes = [];
  if (!node.ok) fixes.push(`Node ${node.version} is too old for chrome-devtools-mcp: install Node 22.12 or newer (nodejs.org, or your package manager)`);
  if (!npxPath) fixes.push("npx is not on the PATH: install Node, which ships npx with it (nodejs.org, or your package manager)");
  if (!browser) fixes.push("Google Chrome is not installed: install it from google.com/chrome or your package manager (chrome-devtools-mcp drives Chrome only)");
  return {
    ok: !fixes.length, node, npx: npxPath, chrome: browser,
    profile: { path: PROFILE, used: existsSync(PROFILE) },
    desktop: { path: file, exists: existsSync(file), readable: servers !== null, server: entry?.[0] ?? null },
    project, fixes,
  };
}

function main(argv, env = process.env) {
  const r = report({ env });
  if (!argv.includes("--desktop")) {
    console.log(JSON.stringify(r, null, 2));
    return r.ok ? 0 : 1;
  }
  // A GUI-launched app may start with a PATH that lacks node, which npx itself runs on.
  const PATH = [path.dirname(process.execPath), ...(env.PATH ?? "").split(path.delimiter)].filter((d, i, all) => d && all.indexOf(d) === i).join(path.delimiter);
  const server = { command: r.npx ?? "npx", args: ARGS, env: { PATH } };
  if (!argv.includes("--write")) {
    console.log(JSON.stringify({ path: r.desktop.path, mcpServers: { [NAME]: server } }, null, 2));
    return 0;
  }
  if (!r.desktop.readable) {
    console.error(`${r.desktop.path} is not valid JSON; fix it by hand first`);
    return 1;
  }
  const cfg = readJson(r.desktop.path) ?? {};
  const backup = r.desktop.exists ? `${r.desktop.path}.bak` : null;
  if (backup) copyFileSync(r.desktop.path, backup);
  mkdirSync(path.dirname(r.desktop.path), { recursive: true });
  writeFileSync(r.desktop.path, JSON.stringify({ ...cfg, mcpServers: { ...cfg.mcpServers, [NAME]: server } }, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: r.desktop.path, backup, server: NAME, next: "quit Claude Desktop completely and reopen it" }, null, 2));
  return 0;
}

// realpath: a plugin cached under a symlinked folder would otherwise never match and print nothing.
const invoked = (() => { try { return realpathSync(process.argv[1] ?? ""); } catch { return null; } })();
if (invoked === import.meta.filename) process.exitCode = main(process.argv.slice(2));
