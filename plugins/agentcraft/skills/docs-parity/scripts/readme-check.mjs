#!/usr/bin/env node
// Does each README tell a person what the project is, why to use it, and how,
// in at most 800 words, in standard-readme's order, with no agent context in
// it? A person or the `readme` skill runs it by hand, the Stop hook runs it on
// a README the turn changed in a repo that opted in, and CI can run a copy.
//
// Usage: node readme-check.mjs [--root DIR] [--json]
//
// Which files: the root README.md always, plus every tracked file matching a
// glob in the repo's `readme.paths`. The `readme` block is read from
// .agents/docs-parity.json and from .agents/manifest.json; a repo with neither
// is checked with no globs and no accepts. The root README is named for the
// project (the block's `name`, else the manifest's `project`, else the origin
// remote's repository name, else the checkout's folder); any other README for
// its directory.
//
// Findings, exit 1 on any:
//   readme-missing      there is no root README.md
//   readme-length       more than 800 words, fenced code included
//   readme-title        the first line is not `# <name>` or `# <Title> _(<name>)_`
//   readme-description  no one-line paragraph of at most 120 characters right
//                       after the title (badge lines may sit between)
//   readme-why          no prose paragraph after it, before the first `## `
//   readme-sections     the `## ` sections are not standard-readme's, in order:
//                       Security? Background? Install Usage <own sections>
//                       API? Maintainers? Thanks|Credits|Acknowledgements?
//                       Contributing License (when a LICENSE sits beside it);
//                       Security may also sit among the repo's own sections
//   readme-plumbing     names .agents, AGENTS.md, CLAUDE.md, or .claude as a
//                       path segment, code blocks included, with no
//                       `readme.accept` entry for that term in that file
//   readme-accept       a `readme.accept` entry with no `why`, whatever its path
//   readme-config       a `readme` block is not the shape it takes
// Warnings, printed and never failing:
//   readme-agent-prose  a text, prompt, or bare fence past 10 lines, or prose
//                       addressed to an agent
//
// HTML comments are invisible to the structure checks (title, one-liner, why,
// sections) and visible to the word count, the plumbing, and the phrases.
//
// One file, Node 22 stdlib only, no imports of its own, no network: a copy
// placed in a repository runs in CI, where the plugin is not installed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const WORD_LIMIT = 800;
export const DESCRIPTION_LIMIT = 120;
export const PLUMBING = [".agents", "AGENTS.md", "CLAUDE.md", ".claude"];
export const AGENT_PHRASES = ["the agent", "your agent", "you are an", "walk me through"];
// The two files a `readme` block may sit in.
export const CONFIG = ".agents/docs-parity.json";
export const MANIFEST = ".agents/manifest.json";
const PROMPT_FENCE_LINES = 10;
const PROMPT_INFO = new Set(["text", "prompt", ""]);
const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt"];
const SKILL = "/docs-parity:readme";

// Each standard section's place. The repo's own sections, any names, sit at
// OWN: after Usage and before API. Security is 0 before anything else and one
// of the repo's own sections after that.
const OWN = 4;
const RANK = {
  Security: 0, Background: 1, Install: 2, Usage: 3, API: 5, Maintainers: 6, Maintainer: 6,
  Thanks: 7, Credits: 7, Acknowledgements: 7, Contributing: 8, License: 9,
};
const ORDER = "Security, Background, Install, Usage, the repo's own sections, API, Maintainers, Thanks, Contributing, License";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const show = (v) => { const s = JSON.stringify(v) ?? String(v); return s.length > 40 ? `${s.slice(0, 37)}...` : s; };
const normalize = (text) => String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
// A path segment: after a line start, whitespace, `/`, `~`, a backtick, `(`, a
// quote, `[`, `*`, `_`, or `<`; before a line end or anything that is not a
// letter, a digit, or `-`. Not `-`, so `.claude-plugin/` is not `.claude`.
const TERM_RE = PLUMBING.map((term) => ({ term, re: new RegExp(`(?<=^|[\\s/~\`("'\\[*_<])${esc(term)}(?=$|[^\\p{L}\\p{N}-])`, "gmu") }));
const PHRASE_RE = AGENT_PHRASES.map((phrase) => ({ phrase, re: new RegExp(`\\b${esc(phrase)}\\b`, "i") }));
// One badge: a markdown image, inline or by reference, optionally linked; an
// HTML <img>; or an <a> holding only images. A badge line is nothing else.
const IMG = String.raw`!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])`;
const BADGE_TOKEN = String.raw`(?:\[${IMG}\](?:\([^)]*\)|\[[^\]]*\])|${IMG}|<img\b[^>]*>|<a\b[^>]*>\s*(?:<img\b[^>]*>\s*)+<\/a>)`;
const BADGE = new RegExp(String.raw`^\s*${BADGE_TOKEN}(?:\s*${BADGE_TOKEN})*\s*$`, "i");
const NOT_PROSE = /^\s*(?:[-*+]\s|\d+[.)]\s|<|\||!\[|\[!\[|>)/;

/** A repo-relative glob as a regex: `**\/` any depth (including none), `*` within a segment. */
export function globRe(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length;) {
    if (pattern.startsWith("**/", i)) { out += "(?:.*/)?"; i += 3; }
    else if (pattern.startsWith("**", i)) { out += ".*"; i += 2; }
    else if (pattern[i] === "*") { out += "[^/]*"; i++; }
    else if (pattern[i] === "?") { out += "[^/]"; i++; }
    else { out += esc(pattern[i]); i++; }
  }
  return new RegExp(`^${out}$`);
}

export const wordCount = (text) => normalize(text).split(/\s+/).filter(Boolean).length;

/** An ATX heading's level and text, or null. A closing `#` run counts only after a space. */
function heading(text) {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(text);
  if (!m) return null;
  return { level: m[1].length, title: (m[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "").trim() };
}

/**
 * Each line with its number, its raw text, its text with HTML comments blanked
 * (outside fences), and whether it sits in a fenced block; and the fences.
 */
function parseLines(text) {
  const lines = [];
  const fences = [];
  let open = null;
  let comment = false;
  normalize(text).split("\n").forEach((raw, i) => {
    const n = i + 1;
    if (open) {
      const close = (open.char === "`" ? /^ {0,3}(`{3,})[ \t]*$/ : /^ {0,3}(~{3,})[ \t]*$/).exec(raw);
      const closes = Boolean(close && close[1].length >= open.size);
      lines.push({ n, raw, text: raw, code: true, fence: closes, info: open.info });
      if (closes) { fences.push(open); open = null; } else open.body++;
      return;
    }
    let line = raw;
    if (comment) {
      const end = line.indexOf("-->");
      if (end === -1) { lines.push({ n, raw, text: "", code: false }); return; }
      line = line.slice(end + 3);
      comment = false;
    }
    line = line.replace(/<!--[\s\S]*?-->/g, "");
    const start = line.indexOf("<!--");
    if (start !== -1) { line = line.slice(0, start); comment = true; }
    // A backtick fence's info string holds no backtick, so "```x``` inline" is prose.
    const m = /^ {0,3}(?:(`{3,})([^`]*)|(~{3,})(.*))$/.exec(line);
    if (m) {
      const run = m[1] ?? m[3];
      open = { char: run[0], size: run.length, info: (m[2] ?? m[4]).trim().split(/\s+/)[0].toLowerCase(), start: n, body: 0 };
      lines.push({ n, raw, text: line, code: true, fence: true, info: open.info });
      return;
    }
    lines.push({ n, raw, text: line, code: false });
  });
  if (open) fences.push(open);
  return { lines, fences };
}

/** Paragraph-level blocks: a heading line, a fenced block, or a run of non-blank lines. */
function toBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (l.code) {
      if (!cur || cur.kind !== "code") { cur = { kind: "code", lines: [] }; blocks.push(cur); }
      cur.lines.push(l);
      if (l.fence && cur.lines.length > 1) cur = null;
      continue;
    }
    if (!l.text.trim()) { cur = null; continue; }
    const h = heading(l.text);
    if (h) { blocks.push({ kind: "heading", lines: [l], heading: h }); cur = null; continue; }
    if (!cur || cur.kind !== "text") { cur = { kind: "text", lines: [] }; blocks.push(cur); }
    cur.lines.push(l);
  }
  return blocks;
}

const isBadges = (b) => b.kind === "text" && b.lines.every((l) => BADGE.test(l.text));

/** The title block, the description block (badge lines before it dropped, or null), and the index after it. */
function head(blocks) {
  const title = blocks[0] ?? null;
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind !== "text") return { title, description: b, rest: i + 1 };
    const first = b.lines.findIndex((l) => !BADGE.test(l.text));
    if (first === -1) continue;
    return { title, description: first === 0 ? b : { kind: "text", lines: b.lines.slice(first) }, rest: i + 1 };
  }
  return { title, description: null, rest: blocks.length };
}

const validDescription = (b) => Boolean(b && b.kind === "text" && b.lines.length === 1
  && !/^\s*[>#]/.test(b.lines[0].text) && b.lines[0].text.trim().length <= DESCRIPTION_LIMIT);

/** The README's one-liner, or null when it has none: the sentence the repository's description on its forge should repeat. */
export function oneLiner(text) {
  const { description } = head(toBlocks(parseLines(text).lines));
  return validDescription(description) ? description.lines[0].text.trim() : null;
}

/** Every plumbing mention, one entry per occurrence, with its 1-based line. */
export function plumbingHits(text) {
  const hits = [];
  normalize(text).split("\n").forEach((line, i) => {
    const here = [];
    for (const { term, re } of TERM_RE) {
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) here.push({ term, line: i + 1, at: m.index });
    }
    hits.push(...here.sort((a, b) => a.at - b.at).map(({ term, line: n }) => ({ term, line: n })));
  });
  return hits;
}

/**
 * One file's `readme` block, read defensively: the name, the globs, and the
 * accept entries that are usable, and a finding for each part that is not.
 * `file` is the config the block came from, which the findings name.
 */
export function readmeConfig(doc, file = CONFIG) {
  const findings = [];
  const add = (finding, message) => findings.push({ finding, path: file, line: null, message, detail: `${file}: ${message}` });
  const paths = [];
  const accept = [];
  let name = null;
  const block = doc?.readme;
  if (block === undefined || block === null) return { name, paths, accept, findings };
  if (typeof block !== "object" || Array.isArray(block)) {
    add("readme-config", `readme is ${show(block)}; it is an object with an optional \`name\`, an optional \`paths\` list of globs, and an optional \`accept\` list of {path, term, why}`);
    return { name, paths, accept, findings };
  }
  if (block.name !== undefined) {
    if (typeof block.name !== "string" || !block.name.trim()) add("readme-config", `readme.name is ${show(block.name)}, not the project's name`);
    else name = block.name.trim();
  }
  if (block.paths !== undefined) {
    if (!Array.isArray(block.paths)) add("readme-config", `readme.paths is ${show(block.paths)}, not a list of globs`);
    else {
      const bad = block.paths.filter((p) => typeof p !== "string" || !p);
      if (bad.length) add("readme-config", `readme.paths holds ${bad.map(show).join(", ")}, which ${bad.length === 1 ? "is not a glob" : "are not globs"}`);
      paths.push(...block.paths.filter((p) => typeof p === "string" && p));
    }
  }
  if (block.accept !== undefined) {
    if (!Array.isArray(block.accept)) add("readme-config", `readme.accept is ${show(block.accept)}, not a list of {path, term, why} entries`);
    else block.accept.forEach((e, i) => {
      if (!e || typeof e !== "object" || Array.isArray(e)) return add("readme-config", `readme.accept[${i}] is ${show(e)}, not a {path, term, why} entry`);
      if (!String(e.why ?? "").trim()) return add("readme-accept", `readme.accept[${i}] ("${e.term ?? "no term"}" in ${e.path ?? "no path"}) has no why, so it clears nothing; say why the mention has to stay, or move it out of the README`);
      if (typeof e.path !== "string" || typeof e.term !== "string") return add("readme-config", `readme.accept[${i}] needs a path and a term beside its why`);
      accept.push(e);
    });
  }
  return { name, paths, accept, findings };
}

export const configFindings = (doc, file) => readmeConfig(doc, file).findings;

/**
 * One README's findings and warnings. Pure: the caller reads the file, the
 * name, whether a LICENSE sits beside it, and the accept entries.
 */
export function checkReadme(text, { path: file = "README.md", name, hasLicense = false, accept = [] } = {}) {
  const findings = [];
  const warnings = [];
  const add = (list, finding, line, message) => list.push({ finding, path: file, line: line ?? null, message, detail: `${file}${line ? `:${line}` : ""}: ${message}` });
  const { lines, fences } = parseLines(text);
  const blocks = toBlocks(lines);

  const words = wordCount(text);
  if (words > WORD_LIMIT) add(findings, "readme-length", null, `${words} words, over the ${WORD_LIMIT}-word limit (fenced code counts); move the depth to CONTRIBUTING.md or docs/ (${SKILL})`);

  const { title, description, rest } = head(blocks);
  const titleLine = title?.lines[0];
  const h = title?.kind === "heading" ? title.heading : null;
  const readable = h && /^(.+?)\s+_\((.+)\)_$/.exec(h.title);
  if (!h || h.level !== 1 || !(h.title === name || readable?.[2] === name)) {
    add(findings, "readme-title", titleLine?.n ?? 1, `the first line must be \`# ${name}\` or \`# <readable title> _(${name})_\`, not "${titleLine?.text.trim() ?? ""}"`);
  }

  if (!validDescription(description)) {
    const l = description?.lines[0];
    const why = !description || description.kind !== "text" ? "there is none"
      : description.lines.length > 1 ? `it runs ${description.lines.length} lines`
        : /^\s*[>#]/.test(l.text) ? "it starts with a quote or a heading"
          : `it is ${l.text.trim().length} characters`;
    add(findings, "readme-description", l?.n ?? null, `right after the title comes a one-line description of at most ${DESCRIPTION_LIMIT} characters, and ${why}`);
  }

  const firstSection = blocks.findIndex((b) => b.kind === "heading" && b.heading.level === 2);
  const before = blocks.slice(rest, firstSection === -1 ? blocks.length : firstSection);
  if (!before.some((b) => b.kind === "text" && !isBadges(b) && !NOT_PROSE.test(b.lines[0].text))) {
    add(findings, "readme-why", description?.lines[0]?.n ?? null, "after the one-liner comes at least one prose paragraph, before the first `## `, saying why the project exists and who it is for");
  }

  // ---- the sections
  const sections = blocks.filter((b) => b.kind === "heading" && b.heading.level === 2).map((b) => ({ name: b.heading.title, n: b.lines[0].n }));
  const present = new Set(sections.map((s) => s.name));
  for (const required of ["Install", "Usage", "Contributing", ...(hasLicense ? ["License"] : [])]) {
    if (!present.has(required)) add(findings, "readme-sections", null, `no \`## ${required}\` section${required === "License" ? ", and a LICENSE sits beside this README" : ""}; the order is ${ORDER}`);
  }
  const seen = new Set();
  let top = null;
  let reported = false;
  for (const s of sections) {
    s.rank = s.name === "Security" && top && top.rank > 0 ? OWN : (RANK[s.name] ?? OWN);
    if (s.rank !== OWN && seen.has(s.name)) add(findings, "readme-sections", s.n, `\`## ${s.name}\` appears twice`);
    seen.add(s.name);
    if (!reported && top && s.rank < top.rank) {
      const own = top.rank === OWN ? `the repo's own sections, such as \`## ${top.name}\`, go between Usage and API` : `the order is ${ORDER}`;
      add(findings, "readme-sections", s.n, `\`## ${s.name}\` comes after \`## ${top.name}\`; ${own}`);
      reported = true;
    }
    if (!top || s.rank >= top.rank) top = s;
  }

  // ---- the plumbing, and the entries that clear it (an entry with no why clears nothing)
  const cleared = new Set((accept ?? []).filter((e) => e && e.path === file && String(e.why ?? "").trim()).map((e) => e.term));
  const byTerm = new Map();
  for (const hit of plumbingHits(text)) {
    if (cleared.has(hit.term)) continue;
    if (!byTerm.has(hit.term)) byTerm.set(hit.term, []);
    byTerm.get(hit.term).push(hit.line);
  }
  for (const [term, at] of byTerm) {
    add(findings, "readme-plumbing", at[0], `names \`${term}\`${at.length > 1 ? ` (${at.length} times, lines ${at.join(", ")})` : ""}, which is agent plumbing; move it to CONTRIBUTING.md, docs/, or AGENTS.md, or keep it with a readme.accept entry that says why`);
  }

  // ---- the warnings: judgment calls, so they never fail
  for (const f of fences) {
    if (PROMPT_INFO.has(f.info) && f.body > PROMPT_FENCE_LINES) {
      add(warnings, "readme-agent-prose", f.start, `a ${f.body}-line ${f.info ? `\`${f.info}\`` : "bare"} block reads like a prompt for an agent; a prompt belongs in AGENTS.md or a skill, and a long example in docs/`);
    }
  }
  for (const { phrase, re } of PHRASE_RE) {
    const at = lines.filter((l) => !l.fence && (!l.code || PROMPT_INFO.has(l.info)) && re.test(l.raw)).map((l) => l.n);
    if (at.length) add(warnings, "readme-agent-prose", at[0], `"${phrase}" reads as written to an agent${at.length > 1 ? ` (${at.length} lines)` : ""}; a README talks to a person`);
  }

  return { findings, warnings };
}

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };

/**
 * What the repository is called where nothing in it says: the last segment of
 * the origin remote, else the folder of the main checkout (a linked work tree
 * is named for its branch, not its project), else this folder.
 */
export function repoName(root) {
  try {
    const m = /([^/:\\]+?)(?:\.git)?\/*$/.exec(git(root, "config", "--get", "remote.origin.url").trim());
    if (m) return m[1];
  } catch { /* no origin */ }
  try {
    const common = git(root, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
    if (path.basename(common) === ".git") return path.basename(path.dirname(common));
  } catch { /* not a repo */ }
  return path.basename(path.resolve(root));
}

/** The READMEs this repo's check covers: the root one, plus the tracked files the globs opt in. */
export function readmeFiles(root, paths = []) {
  const globs = paths.map(globRe);
  if (!globs.length) return ["README.md"];
  let tracked = [];
  try { tracked = git(root, "ls-files", "-z").split("\0").filter(Boolean); } catch { /* not a repo */ }
  return ["README.md", ...tracked.filter((f) => f !== "README.md" && globs.some((g) => g.test(f))).sort()];
}

/** Whether the repo carries a `readme` block: the opt-in the Stop hook waits for. */
export const optedIn = (root) => [CONFIG, MANIFEST].some((file) => {
  const block = readJson(path.join(root, file))?.readme;
  return block !== undefined && block !== null;
});

/** Every covered README's findings and warnings, and the `readme` blocks' own. */
export function checkRepo(root) {
  const manifest = readJson(path.join(root, MANIFEST));
  const configs = [readmeConfig(readJson(path.join(root, CONFIG)), CONFIG), readmeConfig(manifest, MANIFEST)];
  const paths = [...new Set(configs.flatMap((c) => c.paths))];
  const accept = configs.flatMap((c) => c.accept);
  const project = configs.find((c) => c.name)?.name || (typeof manifest?.project === "string" && manifest.project) || repoName(root);
  const files = readmeFiles(root, paths);
  const findings = configs.flatMap((c) => c.findings);
  const warnings = [];
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), "utf8"); } catch { text = null; }
    if (text === null) {
      findings.push({ finding: "readme-missing", path: file, line: null, message: "there is no README", detail: `${file}: there is no README; every repo carries one (${SKILL})` });
      continue;
    }
    const dir = path.posix.dirname(file);
    const name = dir === "." ? project : path.posix.basename(dir);
    const hasLicense = LICENSE_FILES.some((l) => fs.existsSync(path.join(root, dir, l)));
    const result = checkReadme(text, { path: file, name, hasLicense, accept });
    findings.push(...result.findings);
    warnings.push(...result.warnings);
  }
  return { files, findings, warnings };
}

const USAGE = `usage: readme-check.mjs [--root DIR] [--json]

  --root DIR  the repository (default: the git top level, else the current folder)
  --json      print {ok, files, findings, warnings} as one JSON object`;

function main(argv) {
  let root = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "-h" || argv[i] === "--help") { console.log(USAGE); return 0; }
    else if (argv[i] === "--root" && i + 1 < argv.length) root = argv[++i];
    else if (argv[i].startsWith("--root=")) root = argv[i].slice("--root=".length);
    else { console.error(`readme-check: unknown argument ${argv[i]}\n${USAGE}`); return 2; }
  }
  if (!root) { try { root = git(process.cwd(), "rev-parse", "--show-toplevel").trim(); } catch { root = process.cwd(); } }
  const { files, findings, warnings } = checkRepo(path.resolve(root));
  if (json) console.log(JSON.stringify({ ok: findings.length === 0, files, findings, warnings }));
  else {
    for (const f of findings) console.log(`${f.finding}: ${f.detail}`);
    for (const w of warnings) console.log(`warning: ${w.finding}: ${w.detail}`);
    const w = warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : "";
    console.log(findings.length ? `${findings.length} finding(s)${w}; ${SKILL} rewrites a README to pass` : `readme ok${w}`);
  }
  return findings.length ? 1 : 0;
}

// Run only as the command; the Stop hook imports checkRepo(). Through
// realpath, since a checkout under a linked folder is named two ways.
const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? ""); } catch { return null; } })();
if (invoked === import.meta.filename) process.exitCode = main(process.argv.slice(2));
