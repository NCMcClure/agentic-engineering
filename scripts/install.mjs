#!/usr/bin/env node
// Install this checkout's plugins into Claude Code for your user, without the
// host CLI.
//
// Claude Code reads plugins off the filesystem, so the installer writes what
// `/plugin install` would have written: a cached copy per plugin version, the
// marketplace registry, the install registry, and the enable flag.
//
// Usage:
//   node scripts/install.mjs [--uninstall] [--plugins a,b] [--dry-run] [--force]
//
// --dry-run prints every write and touches nothing. --uninstall reverses the
// writes. --force is only for the marketplace-name collision below. The config
// directory is CLAUDE_CONFIG_DIR when set, ~/.claude otherwise.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "./lib.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const CONFIG = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const CATALOG = readJson(path.join(REPO, ".claude-plugin", "marketplace.json"));
const NAME = CATALOG.name;

// ---- arguments ---------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const DRY = flag("--dry-run");
const FORCE = flag("--force");
const UNINSTALL = flag("--uninstall");

// An external entry has no tree here to copy, so only the ./plugins/ entries
// install from a checkout.
const all = CATALOG.plugins.filter((p) => typeof p.source === "string").map((p) => p.name);
const wanted = value("--plugins")?.split(",").map((s) => s.trim()).filter(Boolean) ?? all;
const unknown = wanted.filter((p) => !all.includes(p));
if (unknown.length) {
  console.error(`not in this checkout: ${unknown.join(", ")}; it ships ${all.join(", ")}`);
  process.exitCode = 2;
}

// ---- write primitives --------------------------------------------------
// Every mutation goes through one of these three, so --dry-run is one branch
// each rather than a flag threaded through the rest.
const say = (verb, detail) => console.log(`${DRY ? "would " : ""}${verb} ${detail}`);
const exists = (p) => fs.existsSync(p);

function copyTree(from, to) {
  say("copy", `${path.relative(REPO, from)} -> ${to}`);
  if (DRY) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function removeTree(p) {
  if (!exists(p)) return;
  say("remove", p);
  if (DRY) return;
  fs.rmSync(p, { recursive: true, force: true });
}

/**
 * Read a JSON file the host owns, hand it to `mutate`, write it back only if
 * something changed. Every key the file already carried survives; the only
 * thing that can differ is formatting (two-space, one trailing newline).
 */
function editJson(file, fallback, mutate) {
  let data = fallback;
  if (exists(file)) {
    try { data = readJson(file); }
    catch (e) { throw new Error(`${file} is not valid JSON (${e.message}); fix or move it, the installer will not overwrite it blind`); }
  }
  const before = JSON.stringify(data);
  const summary = mutate(data);
  if (JSON.stringify(data) === before) return false;
  say("write", `${file}: ${summary}`);
  if (!DRY) writeJson(file, data);
  return true;
}

const versionOf = (plugin) => readJson(path.join(REPO, "plugins", plugin, ".claude-plugin", "plugin.json")).version;
const plugins = path.join(CONFIG, "plugins");
const FILES = {
  known: path.join(plugins, "known_marketplaces.json"),
  installed: path.join(plugins, "installed_plugins.json"),
  settings: path.join(CONFIG, "settings.json"),
  // Where a marketplace of the same name that this install displaced is
  // parked, so --uninstall can put it back instead of deleting it.
  displaced: path.join(plugins, `.${NAME}-displaced.json`),
};
const cacheOf = (plugin) => path.join(plugins, "cache", NAME, plugin);
/** The user-scope install only: a project's own install of the same plugin is not ours to touch. */
const others = (data, key) => (data.plugins?.[key] ?? []).filter((e) => e.scope !== "user");

function install(list) {
  const now = new Date().toISOString();
  const known = exists(FILES.known) ? readJson(FILES.known) : {};
  const prior = known[NAME];
  const collision = prior && prior.installLocation !== REPO;
  if (collision && !FORCE) {
    console.error([
      `A different marketplace is already registered as "${NAME}":`,
      `  ${JSON.stringify(prior.source)}`,
      "Claude Code allows one source per marketplace name, so installing this checkout would repoint it.",
      "Re-run with --force to do that (the displaced entry is saved, and --uninstall restores it).",
    ].join("\n"));
    process.exitCode = 1;
    return;
  }
  if (collision && !exists(FILES.displaced)) {
    say("write", `${FILES.displaced}: park the marketplace entry this install displaces`);
    if (!DRY) writeJson(FILES.displaced, prior);
  }

  for (const plugin of list) {
    const version = versionOf(plugin);
    const key = `${plugin}@${NAME}`;
    const dir = path.join(cacheOf(plugin), version);
    copyTree(path.join(REPO, "plugins", plugin), dir);

    editJson(FILES.installed, { version: 2, plugins: {} }, (data) => {
      data.version ??= 2;
      data.plugins ??= {};
      const was = (data.plugins[key] ?? []).find((e) => e.scope === "user");
      data.plugins[key] = [...others(data, key), { scope: "user", installPath: dir, version, installedAt: was?.installedAt ?? now, lastUpdated: now }];
      return `plugins["${key}"] = user scope at ${version}`;
    });
    editJson(FILES.settings, {}, (data) => {
      data.enabledPlugins ??= {};
      data.enabledPlugins[key] = true;
      return `enabledPlugins["${key}"] = true`;
    });
  }

  editJson(FILES.known, {}, (data) => {
    data[NAME] = { source: { source: "directory", path: REPO }, installLocation: REPO, lastUpdated: now };
    return `["${NAME}"] = directory source at ${REPO}`;
  });
  console.log(DRY ? `${list.length} plugin(s) would be installed.` : `${list.length} plugin(s) installed. Start a new session to load them.`);
}

function uninstall(list) {
  for (const plugin of list) {
    // A version another scope's install still points at stays on disk.
    const kept = new Set(others(exists(FILES.installed) ? readJson(FILES.installed) : {}, `${plugin}@${NAME}`).map((e) => e.installPath));
    const root = cacheOf(plugin);
    for (const version of exists(root) ? fs.readdirSync(root) : []) {
      if (!kept.has(path.join(root, version))) removeTree(path.join(root, version));
    }
    if (!DRY && exists(root) && !fs.readdirSync(root).length) fs.rmdirSync(root);
  }

  let remaining = [];
  editJson(FILES.installed, { version: 2, plugins: {} }, (data) => {
    for (const plugin of list) {
      const key = `${plugin}@${NAME}`;
      const rest = others(data, key);
      if (rest.length) data.plugins[key] = rest;
      else delete (data.plugins ?? {})[key];
    }
    remaining = Object.keys(data.plugins ?? {}).filter((k) => k.endsWith(`@${NAME}`));
    return `dropped the user-scope install of ${list.join(", ")}`;
  });
  editJson(FILES.settings, {}, (data) => {
    for (const plugin of list) delete (data.enabledPlugins ?? {})[`${plugin}@${NAME}`];
    return `dropped enabledPlugins for ${list.join(", ")}`;
  });

  // A parked entry goes back as soon as our plugins are gone: whatever else is
  // installed under this marketplace name belongs to that entry, not to this
  // checkout, so leaving ours in place is what would strand it.
  const parked = exists(FILES.displaced) ? readJson(FILES.displaced) : null;
  if (!parked && remaining.length) {
    console.log(`kept the "${NAME}" marketplace entry, ${remaining.length} plugin(s) still installed from it.`);
    return;
  }
  editJson(FILES.known, {}, (data) => {
    if (parked) { data[NAME] = parked; return `["${NAME}"] restored to the entry this install displaced`; }
    if (data[NAME]?.installLocation !== REPO) return "";
    delete data[NAME];
    return `["${NAME}"] removed`;
  });
  if (parked) removeTree(FILES.displaced);
  console.log(DRY ? "nothing was uninstalled (dry run)." : "uninstalled.");
}

// ---- drive -------------------------------------------------------------
if (!process.exitCode) {
  console.log(`${UNINSTALL ? "uninstalling" : "installing"} ${wanted.join(", ")}${DRY ? " (dry run)" : ""}`);
  try {
    if (UNINSTALL) uninstall(wanted);
    else install(wanted);
  } catch (e) {
    console.error(`install failed: ${e.message}`);
    process.exitCode = 1;
  }
}
