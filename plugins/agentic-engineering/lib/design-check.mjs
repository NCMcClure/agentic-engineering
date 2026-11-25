#!/usr/bin/env node
// Hold a front end to the design system its repo adopted. The repo's pin,
// .agents/design.json, says what is off-system; this reads the source files
// and reports each thing that is.
//
//   {
//     "schema": 1, "system": "<name>", "version": "<x.y.z>", "source": "<where it came from>", "ref": "<tag>",
//     "tokens":  ["<repo paths of the files where raw colour values may be defined>"],
//     "banned":  { "values": ["color"], "classes": [{ "name": "<family>", "pattern": "<regexp source>" }] },
//     "allow":   "<repo path of the exceptions file>",
//     "include": ["<globs>"], "exclude": ["<globs>"]
//   }
//
// What it finds:
//   color      with "color" in banned.values: a hex colour (#rgb, #rgba,
//              #rrggbb, #rrggbbaa) or a colour function (rgb, rgba, hsl,
//              hsla, hwb, lab, lch, oklab, oklch, color(<space> ...)) whose
//              arguments hold a number once every var(...) is taken out, so
//              hsl(var(--primary)) is a token and hsl(210 40% 98%) is not.
//              Named colours (red, white) are not looked for.
//   <family>   a class token whose utility matches a banned.classes pattern.
//              The utility is the token split on ":" outside square
//              brackets, its last segment, with a leading "!" or "-" (and a
//              trailing "!") taken off: "md:hover:!-rounded-lg" is
//              "rounded-lg". Tokens come from class, className, :class,
//              class:list and ngClass attribute strings; from every string
//              literal inside cn, clsx, classnames, classNames, cva, cx, tv,
//              twMerge and twJoin calls (a cva's variant keys included); and
//              from CSS @apply. A template literal's ${...} parts are dropped.
//              It reads text, not syntax: a class built at run time from
//              pieces is missed, and a string in one of those calls that is
//              not a class is read as one (it errs toward finding).
//   allow      an entry in the allow file with no reason, or one that matches
//              nothing (so the list cannot rot).
//
// The allow file, at the path the pin names (relative to the repo root):
//
//   { "allow": [ { "file": "<glob>", "rule": "color" | "<family>", "text": "<optional: the offending text>", "reason": "<why>" } ] }
//
// An entry suppresses every finding of its rule in the files its glob
// matches, or only those whose text contains `text` when it has one. A bare
// array is read as the list.
//
// Files: the pin's include globs (default: every .css .scss .ts .tsx .js
// .jsx .vue .svelte .html .astro file) minus its exclude globs, minus
// node_modules, build output (dist, build, out, .next, .nuxt, .svelte-kit,
// .astro, .output, coverage, storybook-static), .agents/, *.d.ts and
// *.min.* files, and the token files.
//
// CLI:  node .agents/scripts/design-check.mjs [--json] [--root <dir>] [paths...]
//   Paths narrow the scan to those files or folders. Each finding is a line
//   `file:line  rule  text  fix`, then a count. Exit 0 with nothing found,
//   1 with a finding, 2 when there is no readable pin.
//
// As a module: check(files, pin, { allow, full }) is pure (files are
// { path, text } with repo-relative paths); scan(root, pin, paths) reads
// the tree. Node 22 standard library only: a repo runs it with no plugin
// and no network.
import fs from "node:fs";
import path from "node:path";

export const PIN = ".agents/design.json";
export const RULES = ".agents/rules/design.md";
export const DEFAULT_INCLUDE = ["**/*.{css,scss,ts,tsx,js,jsx,vue,svelte,html,astro}"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".astro", ".output", "coverage", "storybook-static", ".turbo", ".vercel", ".cache"]);
const ALWAYS_EXCLUDE = [".agents/**", "**/*.d.ts", "**/*.min.*"];
const CALLS = ["cn", "clsx", "classnames", "classNames", "cva", "cx", "tv", "twMerge", "twJoin"];

// ---- globs ---------------------------------------------------------------------------------

/** A glob as a RegExp over a "/"-separated relative path: `**` any folders, `*` and `?` within one, `{a,b}` either. */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") { i++; out += "(?:.*/)?"; } else out += ".*";
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) { out += "\\{"; continue; }
      out += `(?:${glob.slice(i + 1, end).split(",").map((p) => p.replace(/[.+^$()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*")).join("|")})`;
      i = end;
    } else out += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

const matcher = (globs) => { const rx = globs.map(globToRegExp); return (p) => rx.some((r) => r.test(p)); };

// ---- what is found -------------------------------------------------------------------------

/** The utility of one class token: its last ":" segment outside brackets, without a leading ! or - or a trailing !. */
export function utilityOf(token) {
  let depth = 0, start = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth = Math.max(0, depth - 1);
    else if (token[i] === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!?-?/, "").replace(/!$/, "");
}

/** The index just past the parenthesis that closes the one at `open`, or -1. Quotes are honoured. */
function closeParen(text, open) {
  let depth = 0, quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "\"" || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/** The class strings of one file: `{ text, index }` each, index being where the string starts in the file. */
export function classStrings(text) {
  const out = [];
  const attr = /(?<![\w-])(?:className|class|:class|class:list|\[ngClass\]|ngClass)\s*=\s*\{?\s*(["'`])([\s\S]*?)\1/g;
  for (const m of text.matchAll(attr)) out.push({ text: m[2], index: m.index + m[0].length - m[2].length - 1 });
  const call = new RegExp(`(?<![\\w.$])(?:${CALLS.join("|")})\\s*\\(`, "g");
  for (const m of text.matchAll(call)) {
    const open = m.index + m[0].length - 1;
    const end = closeParen(text, open);
    const body = text.slice(open, end === -1 ? text.length : end);
    for (const s of body.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g)) out.push({ text: s[2], index: open + s.index + 1 });
  }
  for (const m of text.matchAll(/@apply\s+([^;}\n]+)/g)) out.push({ text: m[1], index: m.index + m[0].length - m[1].length });
  return out;
}

/** Every class token of one file: `{ token, index }`. */
export function classTokens(text) {
  const out = [];
  for (const s of classStrings(text)) {
    const body = s.text.replace(/\$\{[^}]*\}/g, (x) => " ".repeat(x.length));
    for (const t of body.matchAll(/\S+/g)) out.push({ token: t[0], index: s.index + t.index });
  }
  return out;
}

const HEX = /(?<![\w&#.$-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color(?=\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)\b))\(/gi;

/** Every raw colour value in one file: `{ text, index }`. */
export function colorValues(text) {
  const out = [];
  for (const m of text.matchAll(HEX)) out.push({ text: m[0], index: m.index });
  for (const m of text.matchAll(COLOR_FN)) {
    const end = closeParen(text, m.index + m[0].length - 1);
    if (end === -1) continue;
    const whole = text.slice(m.index, end);
    let args = whole.slice(m[0].length, -1);
    // var(...) is a token, however deep: take each out until none is left.
    for (let prev = null; prev !== args;) { prev = args; args = args.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, " "); }
    if (/\d|#/.test(args) && !whole.includes("\n")) out.push({ text: whole, index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---- the check -----------------------------------------------------------------------------

const lineAt = (text, index) => { let n = 1; for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") n++; return n; };

/** The allow list in an allow file's JSON: its `allow` array, or the array itself. */
export const allowEntries = (json) => (Array.isArray(json) ? json : Array.isArray(json?.allow) ? json.allow : []);

/** What to write about a finding: how to fix it, or allow it. */
function fixFor(rule, pin) {
  const allow = pin.allow ? ` in ${pin.allow}` : "";
  const system = pin.system ?? "the system";
  if (rule === "color") return `use a colour token of ${system} (${RULES}), or allow it${allow} with a reason`;
  return `use ${system}'s component or token for ${rule} (${RULES}), or allow it${allow} with a reason`;
}

/**
 * Check files against a pin. `files` are `{ path, text }`, path relative to
 * the repo root with "/" separators; `allow` the allow entries; `full` false
 * when only some of the repo was scanned, so an entry for a file outside the
 * scan is not called stale. Returns `{ findings, allowed, files }`; a finding
 * is `{ file, line, rule, text, fix }`.
 */
export function check(files, pin, { allow = [], full = true } = {}) {
  const banned = pin?.banned ?? {};
  const colors = (banned.values ?? []).includes("color");
  const families = (banned.classes ?? []).flatMap((c) => { try { return [{ name: c.name, rx: new RegExp(c.pattern) }]; } catch { return []; } });
  const raw = [];
  for (const f of files) {
    if (colors) for (const v of colorValues(f.text)) raw.push({ file: f.path, line: lineAt(f.text, v.index), rule: "color", text: v.text });
    if (families.length) {
      for (const t of classTokens(f.text)) {
        const utility = utilityOf(t.token);
        const family = families.find((fam) => fam.rx.test(utility));
        if (family) raw.push({ file: f.path, line: lineAt(f.text, t.index), rule: family.name, text: t.token });
      }
    }
  }
  const entries = allow.map((e, i) => ({ ...e, i, glob: typeof e?.file === "string" && e.file ? globToRegExp(e.file) : null, used: 0 }));
  const findings = [], allowed = [];
  for (const r of raw) {
    const entry = entries.find((e) => e.glob && e.reason && String(e.reason).trim() && e.rule === r.rule &&e.glob.test(r.file) && (!e.text || r.text.includes(e.text)));
    if (entry) { entry.used++; allowed.push({ ...r, reason: entry.reason }); } else findings.push({ ...r, fix: fixFor(r.rule, pin) });
  }
  const where = pin.allow ?? "the allow file";
  for (const e of entries) {
    const label = `allow[${e.i}]${e.file ? ` ${e.file}` : ""}${e.rule ? ` ${e.rule}` : ""}`;
    if (!e.glob || !e.rule) findings.push({ file: where, line: 0, rule: "allow", text: label, fix: "an allow entry names a file glob and a rule" });
    else if (!e.reason || !String(e.reason).trim()) findings.push({ file: where, line: 0, rule: "allow", text: label, fix: "an allow entry needs a reason; it allows nothing until it has one" });
    else if (!e.used && (full || files.some((f) => e.glob.test(f.path)))) findings.push({ file: where, line: 0, rule: "allow", text: label, fix: "this entry matches nothing now: delete it" });
  }
  findings.sort((a, b) => (a.rule === "allow") - (b.rule === "allow") || a.file.localeCompare(b.file) || a.line - b.line);
  return { findings, allowed, files: files.length };
}

// ---- the tree ------------------------------------------------------------------------------

const toPosix = (p) => p.split(path.sep).join("/");

/** The repo-relative paths the pin covers under root, narrowed to `paths` when given. */
export function filesFor(root, pin, paths = []) {
  const include = matcher(Array.isArray(pin.include) && pin.include.length ? pin.include : DEFAULT_INCLUDE);
  const exclude = matcher([...ALWAYS_EXCLUDE, ...(Array.isArray(pin.exclude) ? pin.exclude : []), ...(Array.isArray(pin.tokens) ? pin.tokens : [])]);
  const out = [];
  const visit = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) visit(full); continue; }
      if (!e.isFile()) continue;
      const rel = toPosix(path.relative(root, full));
      if (include(rel) && !exclude(rel)) out.push(rel);
    }
  };
  const starts = paths.length ? paths.map((p) => path.resolve(root, p)) : [root];
  for (const start of starts) {
    let stat = null;
    try { stat = fs.statSync(start); } catch { continue; }
    if (stat.isDirectory()) visit(start);
    else { const rel = toPosix(path.relative(root, start)); if (include(rel) && !exclude(rel)) out.push(rel); }
  }
  return [...new Set(out)].sort();
}

/** Read a pin and its allow file from a repo, and check the files it covers. Throws when the pin is missing or does not parse. */
export function scan(root, paths = []) {
  const pin = JSON.parse(fs.readFileSync(path.join(root, PIN), "utf8"));
  let allow = [];
  if (pin.allow) {
    try { allow = allowEntries(JSON.parse(fs.readFileSync(path.join(root, pin.allow), "utf8"))); } catch (e) { if (e.code !== "ENOENT") throw new Error(`${pin.allow} does not parse: ${e.message}`); }
  }
  const files = filesFor(root, pin, paths).map((p) => ({ path: p, text: fs.readFileSync(path.join(root, p), "utf8") }));
  return { pin, ...check(files, pin, { allow, full: paths.length === 0 }) };
}

/** The nearest folder at or above `from` that holds a pin, or null. */
export function findRoot(from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, PIN))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

// ---- the command ---------------------------------------------------------------------------

export function main(argv, { cwd = process.cwd(), out = console.log, err = console.error } = {}) {
  const json = argv.includes("--json");
  const at = argv.indexOf("--root");
  const root = at !== -1 ? path.resolve(cwd, argv[at + 1] ?? ".") : findRoot(cwd);
  const paths = argv.filter((a, i) => a !== "--json" && a !== "--root" && argv[i - 1] !== "--root");
  if (!root || !fs.existsSync(path.join(root, PIN))) { err(`design-check: no ${PIN} here or above; adopt a design system first`); return 2; }
  let result;
  try { result = scan(root, paths.map((p) => path.resolve(cwd, p))); } catch (e) { err(`design-check: ${e.message}`); return 2; }
  const { pin, findings, allowed, files } = result;
  if (json) out(JSON.stringify({ system: pin.system ?? null, version: pin.version ?? null, files, findings, allowed: allowed.length }, null, 2));
  else {
    for (const f of findings) out(`${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}  ${f.text}  ${f.fix}`);
    out(`design-check: ${findings.length} finding(s) in ${files} file(s) against ${pin.system ?? "the system"} ${pin.version ?? ""}`.trimEnd() + (allowed.length ? `, ${allowed.length} allowed` : "") + ".");
  }
  return findings.length ? 1 : 0;
}

const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(import.meta.filename); } catch { return false; } })();
if (invoked) process.exitCode = main(process.argv.slice(2));
