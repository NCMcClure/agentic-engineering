// The one reader of a repo's settings for this plugin. Every hook asks here,
// so a rule means the same thing at a commit, at an edit, and at a stop.
//
// The settings are the optional `teamwork` block of .agents/manifest.json,
// the repo-wide marker, laid over DEFAULTS. Every key is optional. A repo
// with no block gets the defaults: the default branch is protected, a push
// asks, credentials and junk are refused, and no test run is forced. The
// stricter rules are written down by the repo that wants them.
//
// A repo whose settings still sit in .claude/teamwork.json, the plugin's
// first layout, is read from there until the session hook has moved them:
// what that file enforced stays enforced in the meantime.
//
// Reads files only. Nothing here throws: an unreadable file is an absent one.
import fs from "node:fs";
import path from "node:path";
import { MANIFEST, modeOf } from "../critical-context.mjs";

export { MANIFEST };
/** Where the plugin's first layout kept its settings. */
export const FIRST_LAYOUT = ".claude/teamwork.json";

/** The per-rule switches under `rules`. Each is on unless the block says `false`. */
export const RULES = Object.freeze([
  "blockCommitOnProtected", "blockPushToProtected", "blockForcePush", "blockNoVerify",
  "blockSecrets", "blockJunk", "askBeforePush", "stopGate",
]);

/** What a repo gets for every key its `teamwork` block leaves out. */
export const DEFAULTS = Object.freeze({
  // `github`, `gitlab`, or `auto` to read it off the remote.
  provider: "auto",
  remote: "origin",
  // null: the manifest's `default_branch`, or main and master where it names none.
  protectedBranches: null,
  // Empty: any `<type>/<topic>`. The first entry is the one a refusal suggests.
  branchPrefixes: Object.freeze([]),
  // `<NAME>=1` in a command turns the guard off for that command, on the record.
  escapeHatch: "TEAMWORK_ALLOW",
  // The hard gate: run `test.command` before a commit and at a stop, and refuse on failure.
  requireTestsPass: false,
  test: Object.freeze({ command: null, dir: ".", sourcePatterns: Object.freeze([]), testPatterns: Object.freeze([]), timeoutSeconds: 240 }),
  // Stands in for `test.command` in the hard gate where a repo has no tests yet.
  build: Object.freeze({ command: null, dir: "." }),
  // Run on an edited file matching `filePatterns`; `{file}` is the file's path.
  lint: Object.freeze({ command: null, filePatterns: Object.freeze([]) }),
  junkPatterns: Object.freeze(["(^|/)\\.DS_Store$", "(^|/)Thumbs\\.db$", "(^|/)node_modules/", "(^|/)__pycache__/", "(^|/)\\.env(\\..*)?$"]),
  secretPatternsExtra: Object.freeze([]),
  // [{ files: [<path or glob>], message }]: files that change together.
  coupledFiles: Object.freeze([]),
  // Kept for the tools that read it; no hook of this plugin checks documentation.
  docs: Object.freeze({ files: Object.freeze(["README.md", "CLAUDE.md"]), watchPatterns: Object.freeze([]) }),
  scan: Object.freeze({ maxFileBytes: 524288 }),
  rules: Object.freeze(Object.fromEntries(RULES.map((name) => [name, true]))),
});

/** Credential shapes that never appear in ordinary source. A repo adds its own in `secretPatternsExtra`. */
export const SECRET_PATTERNS = Object.freeze([
  "sk-ant-[A-Za-z0-9_-]{10,}", "AKIA[0-9A-Z]{16}", "ghp_[A-Za-z0-9]{36}", "github_pat_[A-Za-z0-9_]{22,}",
  "glpat-[A-Za-z0-9_-]{20,}", "xox[baprs]-[A-Za-z0-9-]{10,}", "-----BEGIN [A-Z ]*PRIVATE KEY-----",
]);
/** An env file that documents the variables and holds no values: never junk, whatever the patterns say. */
export const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$/;
/** The files that count as source where `test.sourcePatterns` names none. */
export const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|cs|php|sql)$/;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const strings = (v, fallback) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : [...fallback]);
const string = (v, fallback) => (typeof v === "string" && v ? v : fallback);

// The settings were first written for grep -E, so its bracket classes are honored.
const POSIX_CLASS = { alnum: "A-Za-z0-9", alpha: "A-Za-z", digit: "0-9", lower: "a-z", upper: "A-Z", space: "\\s", xdigit: "0-9A-Fa-f", word: "\\w", punct: "!-\\/:-@\\[-`{-~" };

/** One pattern from the settings as a RegExp, or null for one that does not compile. */
export function toRegExp(pattern) {
  if (typeof pattern !== "string" || !pattern) return null;
  try { return new RegExp(pattern.replace(/\[:([a-z]+):\]/g, (whole, name) => POSIX_CLASS[name] ?? whole)); } catch { return null; }
}

/** A test for "any of these patterns matches". No pattern, or none that compiles, matches nothing. */
export function anyOf(patterns) {
  const compiled = (patterns ?? []).map(toRegExp).filter(Boolean);
  return (text) => compiled.some((re) => re.test(text));
}

/** A path or glob from `coupledFiles` as a test: `*` crosses folders, `?` is one character. */
export function globTest(glob) {
  const source = String(glob).replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*+/g, ".*").replace(/\?/g, ".");
  let re = null;
  try { re = new RegExp(`^${source}$`); } catch { /* an unclosed bracket: compare as plain text */ }
  return (rel) => (re ? re.test(rel) : rel === glob);
}

/**
 * A `teamwork` block laid over the defaults. A key of the wrong type takes its
 * default rather than failing: a guard that cannot read a setting keeps guarding.
 */
export function settings(block, { defaultBranch = null } = {}) {
  const b = isObject(block) ? block : {};
  const part = (key) => (isObject(b[key]) ? b[key] : {});
  const test = part("test"), build = part("build"), lint = part("lint"), docs = part("docs"), scan = part("scan"), rules = part("rules");
  const named = strings(b.protectedBranches, []);
  const seconds = Number(test.timeoutSeconds);
  const bytes = Number(scan.maxFileBytes);
  return {
    provider: ["github", "gitlab"].includes(b.provider) ? b.provider : DEFAULTS.provider,
    remote: string(b.remote, DEFAULTS.remote),
    defaultBranch,
    protectedBranches: named.length ? named : defaultBranch ? [defaultBranch] : ["main", "master"],
    branchPrefixes: strings(b.branchPrefixes, DEFAULTS.branchPrefixes),
    escapeHatch: /^[A-Za-z_][A-Za-z0-9_]*$/.test(b.escapeHatch ?? "") ? b.escapeHatch : DEFAULTS.escapeHatch,
    requireTestsPass: (typeof b.requireTestsPass === "boolean" ? b.requireTestsPass : rules.requireTestsPass) === true,
    test: {
      command: string(test.command, null),
      dir: string(test.dir, DEFAULTS.test.dir),
      sourcePatterns: strings(test.sourcePatterns, DEFAULTS.test.sourcePatterns),
      testPatterns: strings(test.testPatterns, DEFAULTS.test.testPatterns),
      timeoutSeconds: seconds > 0 ? seconds : DEFAULTS.test.timeoutSeconds,
    },
    build: { command: string(build.command, null), dir: string(build.dir, DEFAULTS.build.dir) },
    lint: { command: string(lint.command, null), filePatterns: strings(lint.filePatterns, DEFAULTS.lint.filePatterns) },
    junkPatterns: Array.isArray(b.junkPatterns) && b.junkPatterns.length ? strings(b.junkPatterns, []) : [...DEFAULTS.junkPatterns],
    secretPatternsExtra: strings(b.secretPatternsExtra, DEFAULTS.secretPatternsExtra),
    coupledFiles: (Array.isArray(b.coupledFiles) ? b.coupledFiles : []).filter(isObject)
      .map((g) => ({ files: strings(g.files, []), message: string(g.message, "These files change together.") })).filter((g) => g.files.length),
    docs: { files: strings(docs.files, DEFAULTS.docs.files), watchPatterns: strings(docs.watchPatterns, DEFAULTS.docs.watchPatterns) },
    scan: { maxFileBytes: bytes > 0 ? bytes : DEFAULTS.scan.maxFileBytes },
    rules: Object.fromEntries(RULES.map((name) => [name, rules[name] !== false])),
  };
}

const CARRIED = ["provider", "remote", "branchPrefixes", "escapeHatch", "test", "build", "lint", "junkPatterns", "secretPatternsExtra", "coupledFiles", "docs", "scan"];

/**
 * The `teamwork` block that keeps a first-layout file's rules as they were.
 * Every key it wrote is carried as written, and what that layout did by
 * default and this one does not is spelled out: main and master protected, the
 * feature/fix/chore prefixes, and passing tests as a hard gate.
 */
export function blockFromFirstLayout(old) {
  const o = isObject(old) ? old : {};
  const block = {};
  for (const key of CARRIED) if (o[key] !== undefined && o[key] !== null) block[key] = o[key];
  const named = strings(o.protectedBranches, []);
  block.protectedBranches = named.length ? named : ["main", "master"];
  if (!strings(block.branchPrefixes, []).length) block.branchPrefixes = ["feature/", "fix/", "chore/"];
  const { requireTestsPass, ...rules } = isObject(o.rules) ? o.rules : {};
  block.requireTestsPass = requireTestsPass !== false;
  if (Object.keys(rules).length) block.rules = rules;
  return block;
}

/** The first-layout file as an object, or null where there is none to read. */
export const firstLayout = (root) => {
  const old = root ? readJson(path.join(root, FIRST_LAYOUT)) : null;
  return isObject(old) ? old : null;
};

/**
 * A repo's settings: `settings()` of its block, plus `root`, `manifest` (the
 * parsed marker, or null), `lanes` (lane name to command), and `unmoved`,
 * true while the rules still come from the first layout's file.
 */
export function loadConfig(root) {
  const read = root ? readJson(path.join(root, MANIFEST)) : null;
  const manifest = isObject(read) ? read : null;
  const old = isObject(manifest?.teamwork) ? null : firstLayout(root);
  const defaultBranch = string(manifest?.default_branch, null) ?? string(old?.baseBranch, null);
  const lanes = Object.fromEntries(Object.entries(isObject(manifest?.lanes) ? manifest.lanes : {}).filter(([, command]) => typeof command === "string" && command));
  return { ...settings(old ? blockFromFirstLayout(old) : manifest?.teamwork, { defaultBranch }), root: root ?? null, manifest, lanes, unmoved: Boolean(old) };
}

/**
 * How much of the plugin applies in a repo: the kernel's mode, except that a
 * repo still carrying the first layout's file runs in full, as it did before.
 */
export function modeFor(root) {
  if (!root) return "none";
  return fs.existsSync(path.join(root, FIRST_LAYOUT)) ? "full" : modeOf(root);
}

/** A lane whose command is a reason it cannot run yet, not a command. */
export const notWired = (command) => /^not wired\b/i.test(command);
