#!/usr/bin/env node
// scaffold.mjs: put the files that copy verbatim into a planning workspace.
// Node 22 stdlib only.
//
//   node scaffold.mjs [--root <repo>] [--workspace <name> [--title <text>]] [--refresh] [--check]
//
// A repo holds one project workspace, `.agents/plan/`, and any number of named
// ones, `.agents/plans/<name>/`, each for one feature or task. The project's
// scripts root themselves by their own path, so each has one place it must
// land. A named workspace holds a launcher at each of those places instead,
// onto the one copy every named workspace shares, `.agents/plans/_scripts/`.
// This file is the one list of all of it. `spec-init` runs it for a new
// workspace, the session hook reads the same lists to tell a stale copy from a
// current one, and `--refresh` is how a repo catches up after the plugin
// updates.
//
//   (no flag)           the project workspace: copy what is missing; never
//                       touch a file that exists. It makes the workspace where
//                       there is none, beside any named ones
//   --workspace <name>  a named workspace instead: the shared scripts, its
//                       launchers, its three index pages and its empty ledgers,
//                       each only where missing. `--title` is its heading.
//   --refresh           also rewrite the scripts that differ from this plugin's
//                       copy, in every workspace the repo has and no other: a
//                       repo with only named workspaces is not given a project
//                       one (the site's CSS and JS are a project's to restyle,
//                       so those are only ever copied when missing)
//   --check             change nothing; list the scripts that are missing or
//                       differ, exit 1 if any
//
// The project's stubs that carry `{{PLACEHOLDER}}` tokens (README, mkdocs.yml,
// tracker.md, the index pages, the ADRs) are not here: `spec-init` fills those
// by hand. A named workspace has no interview, so its three are filled here.
//
// Exit 0 = done or nothing to do, 1 = `--check` found something, 2 = usage.
import fs from "node:fs";
import path from "node:path";

const ASSETS = path.join(import.meta.dirname, "assets");
/** The project workspace. */
export const WORKSPACE = ".agents/plan";
/** Where named workspaces live, one directory each. */
export const PLANS = ".agents/plans";
/** The one copy of the scripts every named workspace runs. No workspace can take the name. */
export const SHARED = `${PLANS}/_scripts`;
/** A named workspace's name. `project` is how the project workspace is said where a name is asked for. */
export const NAME = /^[a-z][a-z0-9-]{0,39}$/;
export const RESERVED = ["project"];

/** The scripts, asset name to workspace-relative path. `tracker.mjs` and `provider.mjs` are what the two beside them import. */
export const SCRIPTS = {
  "plan-status.mjs": "plan/plan-status.mjs",
  "publish-issues.mjs": "plan/publish-issues.mjs",
  "verify-plan-tree.mjs": "plan/verify-plan-tree.mjs",
  "tracker.mjs": "plan/tracker.mjs",
  "provider.mjs": "plan/provider.mjs",
  "verify-spec-tree.mjs": "spec/scripts/verify-spec-tree.mjs",
  "comments-server.py": "spec/scripts/comments-server.py",
  "drift-status.mjs": "progress/drift-status.mjs",
};
/** The spec site's own CSS and JS. */
export const SITE = Object.fromEntries(["house.css", "mermaid-init.js", "spec-comments.css", "spec-comments.js", "plan-view.css", "plan-view.js"].map((n) => [n, `spec/assets/${n}`]));
/** A site file's name in workspaces scaffolded before 5.0.2. One that has it loads it from its own mkdocs.yml, so it is not given the new one. */
export const FORMER = { "house.css": "spec/assets/gruvbox.css" };
/** Directories that start empty and must exist. */
export const EMPTY_DIRS = ["progress/completed", "progress/notes", "progress/drift"];
/** What the shared copy holds, flat: every script but the site's server, which a named workspace has no site for. */
export const SHARED_SCRIPTS = Object.keys(SCRIPTS).filter((n) => n.endsWith(".mjs"));
/** Where a named workspace holds a launcher: the path each script a person runs has in the project workspace. */
export const LAUNCHERS = ["plan/plan-status.mjs", "plan/publish-issues.mjs", "plan/verify-plan-tree.mjs", "spec/scripts/verify-spec-tree.mjs", "progress/drift-status.mjs"];
/** A named workspace's pages, stub to workspace-relative path. */
export const NAMED_PAGES = { "named-spec-index.md": "spec/index.md", "named-plan-index.md": "plan/index.md", "progress-index.md": "progress/index.md" };

export const asset = (name) => fs.readFileSync(path.join(ASSETS, name));
// Compared with line endings folded: a checkout that converts to CRLF has not changed the script.
const lf = (bytes) => bytes.toString("utf8").replace(/\r\n/g, "\n");
const same = (file, bytes) => { try { return lf(fs.readFileSync(file)) === lf(bytes); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** The scripts of the project workspace that are missing or differ from this plugin's copy, by workspace-relative path. */
export function staleScripts(root, files = SCRIPTS) {
  return Object.entries(files).filter(([name, rel]) => !same(path.join(root, WORKSPACE, rel), asset(name))).map(([, rel]) => rel);
}

/** The repo's named workspaces, by name: a directory under `.agents/plans/` that holds a spec or a plan. */
export function workspaces(root) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, PLANS), { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && NAME.test(e.name) && ["plan/index.md", "spec/index.md"].some((rel) => fs.existsSync(path.join(root, PLANS, e.name, rel))))
    .map((e) => e.name).sort();
}

/** Every file of the named tier this plugin owns, repo-relative path to its bytes: the shared scripts and each workspace's launchers. */
function namedFiles(root, names = workspaces(root)) {
  const launcher = asset("launcher.mjs");
  return [
    ...SHARED_SCRIPTS.map((name) => [`${SHARED}/${name}`, asset(name)]),
    ...names.flatMap((name) => LAUNCHERS.map((rel) => [`${PLANS}/${name}/${rel}`, launcher])),
  ];
}

/** The shared scripts and launchers that are missing or differ, by repo-relative path. Nothing where the repo has no named workspace. */
export function staleShared(root) {
  const names = workspaces(root);
  if (!names.length && !isDir(path.join(root, SHARED))) return [];
  return namedFiles(root, names).filter(([rel, bytes]) => !same(path.join(root, rel), bytes)).map(([rel]) => rel);
}

/** Copies the verbatim files into `root`'s project workspace. Returns `{ wrote, refreshed, kept }` as workspace-relative paths. */
export function scaffold(root, { refresh = false } = {}) {
  const out = { wrote: [], refreshed: [], kept: [] };
  for (const [name, rel] of Object.entries({ ...SCRIPTS, ...SITE })) {
    const target = path.join(root, WORKSPACE, rel);
    const bytes = asset(name);
    const present = fs.existsSync(target);
    if (!present && FORMER[name] && fs.existsSync(path.join(root, WORKSPACE, FORMER[name]))) continue;
    if (present && (same(target, bytes) || !refresh || !(name in SCRIPTS))) {
      if (name in SCRIPTS && !same(target, bytes)) out.kept.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    (present ? out.refreshed : out.wrote).push(rel);
  }
  for (const rel of EMPTY_DIRS) {
    const keep = path.join(root, WORKSPACE, rel, ".gitkeep");
    if (fs.existsSync(path.dirname(keep))) continue;
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.writeFileSync(keep, "");
    out.wrote.push(`${rel}/.gitkeep`);
  }
  return out;
}

/** Why `name` cannot name a workspace, or null. */
export function nameProblem(name) {
  if (RESERVED.includes(name)) return `'${name}' is how the project workspace (${WORKSPACE}/) is named; pick another`;
  if (!NAME.test(String(name ?? ""))) return `a workspace name is lowercase letters, digits and dashes, starting with a letter, 40 characters at most (got '${name ?? ""}')`;
  return null;
}

/**
 * Brings the named tier up to date: the shared scripts, and the launchers of
 * every workspace in `names`. Never a spec or plan file. Returns
 * `{ wrote, refreshed, kept }` as repo-relative paths.
 */
export function scaffoldShared(root, { refresh = false, names = workspaces(root) } = {}) {
  const out = { wrote: [], refreshed: [], kept: [] };
  for (const [rel, bytes] of namedFiles(root, names)) {
    const target = path.join(root, rel);
    const present = fs.existsSync(target);
    if (present && same(target, bytes)) continue;
    if (present && !refresh) { out.kept.push(rel); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    (present ? out.refreshed : out.wrote).push(rel);
  }
  return out;
}

/**
 * Makes (or completes) the named workspace `name`: the shared scripts, its
 * launchers, its three index pages and its empty ledgers. Never overwrites a
 * page. Returns `{ wrote, refreshed, kept }` as repo-relative paths.
 */
export function scaffoldNamed(root, name, { title = name, refresh = false } = {}) {
  const problem = nameProblem(name);
  if (problem) throw new Error(problem);
  const out = scaffoldShared(root, { refresh, names: [...new Set([...workspaces(root), name])] });
  const home = `${PLANS}/${name}`;
  for (const [stub, rel] of Object.entries(NAMED_PAGES)) {
    const target = path.join(root, home, rel);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, lf(asset(`stubs/${stub}`)).replaceAll("{{NAME}}", name).replaceAll("{{TITLE}}", title).replaceAll("{{PROJECT_NAME}}", title));
    out.wrote.push(`${home}/${rel}`);
  }
  for (const rel of EMPTY_DIRS) {
    const keep = path.join(root, home, rel, ".gitkeep");
    if (fs.existsSync(path.dirname(keep))) continue;
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.writeFileSync(keep, "");
    out.wrote.push(`${home}/${rel}/.gitkeep`);
  }
  return out;
}

const USAGE = "usage: scaffold.mjs [--root <repo>] [--workspace <name> [--title <text>]] [--refresh] [--check]";

export function main(argv, log = console.log) {
  const args = { root: process.env.CLAUDE_PROJECT_DIR || process.cwd(), refresh: false, check: false, workspace: null, title: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--refresh") args.refresh = true;
    else if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--root" && argv[i + 1]) args.root = argv[++i];
    else if (argv[i] === "--workspace" && argv[i + 1]) args.workspace = argv[++i];
    else if (argv[i] === "--title" && argv[i + 1]) args.title = argv[++i];
    else { console.error(`scaffold.mjs: unknown argument '${argv[i]}'\n${USAGE}`); return 2; }
  }
  const root = path.resolve(args.root);
  if (args.workspace !== null && nameProblem(args.workspace)) { console.error(`scaffold.mjs: ${nameProblem(args.workspace)}\n${USAGE}`); return 2; }
  if (args.title !== null && args.workspace === null) { console.error(`scaffold.mjs: --title names a named workspace's heading; give --workspace too\n${USAGE}`); return 2; }

  // A repo with only named workspaces has no project workspace, and neither --check nor --refresh gives it one:
  // those two keep up what is there. A plain run is the one that makes the project workspace, wherever it is run.
  const named = workspaces(root).length > 0 || isDir(path.join(root, SHARED));
  const project = isDir(path.join(root, WORKSPACE)) || !named || (!args.refresh && !args.check);

  if (args.check) {
    const stale = [...(project ? staleScripts(root).map((rel) => `${WORKSPACE}/${rel}`) : []), ...staleShared(root)];
    for (const rel of stale) log(`differs or missing: ${rel}`);
    log(stale.length ? `${stale.length} script(s) are not this plugin's current copy; run with --refresh` : "every script is current");
    return stale.length ? 1 : 0;
  }

  const out = { wrote: [], refreshed: [], kept: [] };
  const add = (part, prefix = "") => { for (const k of Object.keys(out)) out[k].push(...part[k].map((rel) => prefix + rel)); };
  if (args.workspace !== null) add(scaffoldNamed(root, args.workspace, { title: args.title ?? args.workspace, refresh: args.refresh }));
  else {
    if (project) add(scaffold(root, { refresh: args.refresh }), `${WORKSPACE}/`);
    if (named) add(scaffoldShared(root, { refresh: args.refresh }));
  }
  for (const rel of out.wrote) log(`wrote ${rel}`);
  for (const rel of out.refreshed) log(`refreshed ${rel}`);
  for (const rel of out.kept) log(`kept ${rel} (differs from the plugin's copy; --refresh rewrites it)`);
  if (!out.wrote.length && !out.refreshed.length && !out.kept.length) log("nothing to copy: every file is in place and every script is current");
  return 0;
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
