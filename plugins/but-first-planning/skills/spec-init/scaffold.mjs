#!/usr/bin/env node
// scaffold.mjs: put the files that copy verbatim into a `.agents/plan/`
// workspace. Node 22 stdlib only.
//
//   node scaffold.mjs [--root <repo>] [--refresh] [--check]
//
// The workspace's scripts root themselves by their own path, so each has one
// place it must land; this file is the one list of those places. `spec-init`
// runs it for a new workspace, the session hook reads the same list to tell a
// stale copy from a current one, and `--refresh` is how a workspace catches up
// after the plugin updates.
//
//   (no flag)   copy what is missing; never touch a file that exists
//   --refresh   also rewrite the scripts that differ from this plugin's copy
//               (the site's CSS and JS are a project's to restyle, so those
//               are only ever copied when missing)
//   --check     change nothing; list the scripts that are missing or differ,
//               exit 1 if any
//
// The stubs that carry `{{PLACEHOLDER}}` tokens (README, mkdocs.yml, tracker.md,
// the index pages, the ADRs) are not here: `spec-init` fills those by hand.
//
// Exit 0 = done or nothing to do, 1 = `--check` found something, 2 = usage.
import fs from "node:fs";
import path from "node:path";

const ASSETS = path.join(import.meta.dirname, "assets");
export const WORKSPACE = ".agents/plan";

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
export const SITE = Object.fromEntries(["gruvbox.css", "mermaid-init.js", "spec-comments.css", "spec-comments.js", "plan-view.css", "plan-view.js"].map((n) => [n, `spec/assets/${n}`]));
/** Directories that start empty and must exist. */
export const EMPTY_DIRS = ["progress/completed", "progress/notes", "progress/drift"];

export const asset = (name) => fs.readFileSync(path.join(ASSETS, name));
// Compared with line endings folded: a checkout that converts to CRLF has not changed the script.
const lf = (bytes) => bytes.toString("utf8").replace(/\r\n/g, "\n");
const same = (file, bytes) => { try { return lf(fs.readFileSync(file)) === lf(bytes); } catch { return false; } };

/** The scripts of a workspace that are missing or differ from this plugin's copy, by workspace-relative path. */
export function staleScripts(root, files = SCRIPTS) {
  return Object.entries(files).filter(([name, rel]) => !same(path.join(root, WORKSPACE, rel), asset(name))).map(([, rel]) => rel);
}

/** Copies the verbatim files into `root`'s workspace. Returns `{ wrote, refreshed, kept }` as workspace-relative paths. */
export function scaffold(root, { refresh = false } = {}) {
  const out = { wrote: [], refreshed: [], kept: [] };
  for (const [name, rel] of Object.entries({ ...SCRIPTS, ...SITE })) {
    const target = path.join(root, WORKSPACE, rel);
    const bytes = asset(name);
    const present = fs.existsSync(target);
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

export function main(argv, log = console.log) {
  const args = { root: process.env.CLAUDE_PROJECT_DIR || process.cwd(), refresh: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--refresh") args.refresh = true;
    else if (argv[i] === "--check") args.check = true;
    else if (argv[i] === "--root" && argv[i + 1]) args.root = argv[++i];
    else { console.error(`scaffold.mjs: unknown argument '${argv[i]}'\nusage: scaffold.mjs [--root <repo>] [--refresh] [--check]`); return 2; }
  }
  const root = path.resolve(args.root);
  if (args.check) {
    const stale = staleScripts(root);
    for (const rel of stale) log(`differs or missing: ${WORKSPACE}/${rel}`);
    log(stale.length ? `${stale.length} script(s) are not this plugin's current copy; run with --refresh` : "every script is current");
    return stale.length ? 1 : 0;
  }
  const out = scaffold(root, { refresh: args.refresh });
  for (const rel of out.wrote) log(`wrote ${WORKSPACE}/${rel}`);
  for (const rel of out.refreshed) log(`refreshed ${WORKSPACE}/${rel}`);
  for (const rel of out.kept) log(`kept ${WORKSPACE}/${rel} (differs from the plugin's copy; --refresh rewrites it)`);
  if (!out.wrote.length && !out.refreshed.length && !out.kept.length) log("nothing to copy: every file is in place and every script is current");
  return 0;
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) process.exitCode = main(process.argv.slice(2));
