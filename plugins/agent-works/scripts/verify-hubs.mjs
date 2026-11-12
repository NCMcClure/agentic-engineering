#!/usr/bin/env node
// Check a repo's AGENTS.md hubs against the tree they describe. A hub is an
// AGENTS.md whose Layout names each child of its directory, one bullet each:
//
//   - `src/` - the application code; descend to change behaviour.
//
// Findings:
//   missing-line        a child directory the hub's Layout does not name
//   stale-line          a Layout bullet whose path is gone (git-ignored paths are exempt)
//   loose-code          a source file sitting directly beside a hub
//   claude-md-not-twin  a CLAUDE.md beside a hub with content of its own
//   missing-hub         a directory whose child directories hold code, and which
//                       has no AGENTS.md (only with --require-hubs)
//
// The tree is what a commit of the work tree would hold: tracked files plus new
// ones git does not ignore, so build output never counts and a hub written a
// moment ago does. A CLAUDE.md beside a hub is its twin when it is a symlink to
// AGENTS.md or, in a checkout that cannot hold a symlink, a file whose whole
// content is `@AGENTS.md` (or the link's own text, `AGENTS.md`).
//
// Exceptions live in the root hub, not here. One marker line, anywhere in the
// root AGENTS.md:
//
//   <!-- verify-hubs: exempt entrypoint.sh; skip generated/ -->
//
// `exempt` lists basenames that may sit loose beside a hub. Package markers
// (`__init__.py`), dotfiles, and tool config files matching
// *.config.{js,ts,mjs,cjs} are always exempt: the language or the tool pins
// where they live. `skip` lists
// path prefixes dropped from the check entirely, for a tree that is generated
// output or a template rather than this repo's own structure. Directives are
// separated by `;`, arguments by whitespace.
//
// CLI:  node verify-hubs.mjs [dir] [--json] [--require-hubs]
//   Lines of `<hub>: <finding>, <detail>` and a count, or with --json one
//   object: {ok, root, hubs, findings: [{finding, hub, detail}]}.
//   Exit 0 with no finding, 1 with any, 2 when dir is not inside a git work tree.
//
// As a module: checkHubs(dir, { requireHubs }) returns the same object and
// throws when dir is not inside a git work tree; parseMarker(text) reads the
// marker line; FINDINGS lists the finding names. Node 22 stdlib only.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Every finding name checkHubs can report. */
export const FINDINGS = Object.freeze(["missing-line", "stale-line", "loose-code", "claude-md-not-twin", "missing-hub"]);

const HUB = "AGENTS.md";
const TWIN = "CLAUDE.md";
const TWIN_TEXT = ["@AGENTS.md", "AGENTS.md"];
// What counts as source when it sits beside a hub, or makes a directory a code directory.
const CODE = new Set([
  ".py", ".pyi", ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".go", ".rs", ".rb", ".java", ".kt", ".php",
  ".ex", ".exs", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".scala", ".sh", ".ps1",
]);
const PACKAGE_MARKERS = new Set(["__init__.py", "__init__.pyi"]);
const isConfigFile = (name) => /\.config\.[cm]?[jt]s$/.test(name);
// A dotfile configures a tool, whatever its extension (.eslintrc.js).
const isCode = (name) => !name.startsWith(".") && CODE.has(path.posix.extname(name)) && !PACKAGE_MARKERS.has(name) && !isConfigFile(name);
// A Layout path this check can judge: a plain relative path, no glob and no placeholder.
const PLAIN_PATH = /^[A-Za-z0-9_.@+-]+(\/[A-Za-z0-9_.@+-]+)*$/;

/** The root hub's marker line: { exempt: Set of basenames, skip: path prefixes ending in "/" }. */
export function parseMarker(text) {
  const m = /<!--\s*verify-hubs:\s*([^>]*?)\s*-->/.exec(text ?? "");
  const out = { exempt: new Set(), skip: [] };
  if (!m) return out;
  for (const clause of m[1].split(";")) {
    const [directive, ...args] = clause.trim().split(/\s+/).filter(Boolean);
    if (directive === "exempt") for (const a of args) out.exempt.add(a);
    else if (directive === "skip") for (const a of args) out.skip.push(a.replace(/^\.\//, "").replace(/\/*$/, "/"));
  }
  return out;
}

// A span is a path when it has a slash or a dot in it: a bare word may be a command or a branch.
const looksLikePath = (span) => PLAIN_PATH.test(span.replace(/\/+$/, "")) && /[/.]/.test(span) && !span.startsWith("..");
const bare = (span) => span.replace(/\/+$/, "");

/** The Layout bullets of a hub, fenced blocks left out: for each, its backticked spans as written. */
function layoutLines(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced || !/^[-*+] `/.test(line)) continue;
    out.push([...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim().replace(/^\.\//, "")));
  }
  return out;
}

/**
 * Check the hubs of the work tree that holds `dir`.
 * @param {string} [dir] Any directory inside the work tree.
 * @param {{ requireHubs?: boolean }} [options] requireHubs also reports a non-leaf code directory with no hub.
 * @returns {{ ok: boolean, root: string, hubs: string[], findings: { finding: string, hub: string, detail: string }[] }}
 *   `hub` is the repo-relative path of the AGENTS.md the finding is about, forward slashes.
 */
export function checkHubs(dir = process.cwd(), { requireHubs = false } = {}) {
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  let root;
  try { root = git(dir, "rev-parse", "--show-toplevel").trim(); } catch { throw new Error(`${dir} is not inside a git work tree`); }
  const at = (rel) => path.join(root, ...rel.split("/"));
  const present = (rel) => { try { fs.lstatSync(at(rel)); return true; } catch { return false; } };
  // A trailing slash lets a directory-only pattern (archive/) match a path that does not exist yet.
  const isIgnored = (rel) => { try { git(root, "check-ignore", rel, `${rel}/`); return true; } catch { return false; } };

  const rootHub = at(HUB);
  const marker = parseMarker(fs.existsSync(rootHub) ? fs.readFileSync(rootHub, "utf8") : "");
  const isSkipped = (rel) => marker.skip.some((p) => rel === p.slice(0, -1) || rel.startsWith(p));
  const files = git(root, "ls-files", "-z", "-co", "--exclude-standard").split("\0")
    .filter((f) => f && !isSkipped(f) && present(f));

  const findings = [];
  const add = (finding, hub, detail) => findings.push({ finding, hub, detail });
  const hubs = files.filter((f) => path.posix.basename(f) === HUB).sort();

  for (const hub of hubs) {
    const dirOf = path.posix.dirname(hub);
    const prefix = dirOf === "." ? "" : `${dirOf}/`;
    const under = files.filter((f) => f.startsWith(prefix) && f !== hub).map((f) => f.slice(prefix.length));
    const childDirs = [...new Set(under.filter((f) => f.includes("/")).map((f) => f.split("/")[0]))].sort();
    const loose = under.filter((f) => !f.includes("/")).sort();

    const layout = layoutLines(fs.readFileSync(at(hub), "utf8"));
    // A child is named when a bullet carries it, or a path inside it.
    const named = new Set(layout.flat().map((span) => bare(span).split("/")[0]));

    for (const d of childDirs) if (!named.has(d)) add("missing-line", hub, `child directory ${d}/ is not named`);
    for (const [first] of layout) {
      if (!looksLikePath(first)) continue;
      const rel = prefix + bare(first);
      if (!present(rel) && !isIgnored(rel)) add("stale-line", hub, `${bare(first)} does not exist`);
    }
    for (const f of loose) {
      if (isCode(f) && !marker.exempt.has(f)) add("loose-code", hub, `${f} sits beside the hub; move it into a subdirectory`);
    }

    // One file, two names: a CLAUDE.md with content of its own drifts from the
    // hub it stands beside, and an agent that reads one never sees the other.
    const twin = prefix + TWIN;
    let stat = null;
    try { stat = fs.lstatSync(at(twin)); } catch { /* no twin is fine */ }
    if (stat?.isSymbolicLink()) {
      const target = fs.readlinkSync(at(twin)).replace(/\\/g, "/").replace(/^\.\//, "");
      if (target !== HUB) add("claude-md-not-twin", hub, `${twin} links to ${target}, not to its sibling AGENTS.md`);
    } else if (stat && !TWIN_TEXT.includes(fs.readFileSync(at(twin), "utf8").trim())) {
      add("claude-md-not-twin", hub, `${twin} has content of its own; move it into AGENTS.md and leave a symlink, or one line: @AGENTS.md`);
    }
  }

  if (requireHubs) {
    // A directory is a code directory when source sits somewhere inside it; it
    // is non-leaf when a child directory is one too. Dot-directories hold
    // tooling, not the code a hub orients a reader in.
    const hubDirs = new Set(hubs.map((h) => path.posix.dirname(h)));
    const nonLeaf = new Set();
    for (const f of files) {
      const parts = f.split("/");
      if (!isCode(parts.at(-1)) || parts.some((p) => p.startsWith("."))) continue;
      // Every directory above the file's own has a child directory with code in it.
      for (let i = 0; i < parts.length - 1; i++) nonLeaf.add(i === 0 ? "." : parts.slice(0, i).join("/"));
    }
    for (const d of [...nonLeaf].sort()) {
      if (!hubDirs.has(d)) add("missing-hub", d === "." ? HUB : `${d}/${HUB}`, `${d === "." ? "the repo root" : `${d}/`} has code directories below it and no AGENTS.md`);
    }
  }

  return { ok: findings.length === 0, root, hubs, findings };
}

/** The CLI: prints the report, returns the exit code. */
export function main(argv = process.argv.slice(2)) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const dirs = argv.filter((a) => !a.startsWith("--"));
  const unknown = flags.find((f) => !["--json", "--require-hubs"].includes(f));
  if (unknown || dirs.length > 1) {
    console.error(`verify-hubs: ${unknown ? `unknown option ${unknown}` : "one directory at most"}\nusage: node verify-hubs.mjs [dir] [--json] [--require-hubs]`);
    return 2;
  }
  let result;
  try { result = checkHubs(dirs[0] ?? process.cwd(), { requireHubs: flags.includes("--require-hubs") }); }
  catch (e) { console.error(`verify-hubs: ${e.message}`); return 2; }
  if (flags.includes("--json")) console.log(JSON.stringify(result));
  else {
    for (const f of result.findings) console.log(`${f.hub}: ${f.finding}, ${f.detail}`);
    console.log(result.findings.length ? `${result.findings.length} finding(s)` : "hubs ok");
  }
  return result.ok ? 0 : 1;
}

const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(import.meta.filename); } catch { return false; } })();
if (invoked) process.exitCode = main();
