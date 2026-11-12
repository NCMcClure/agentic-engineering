#!/usr/bin/env node
// aw memory: the project's long-term memory, kept to its contract (references/memory.md).
//
//   aw memory lint [--json]                                  check the tree
//   aw memory index [--check] [--adopt]                      write the generated INDEX.md files from the frontmatter
//   aw memory new <folder> <slug> --type T --description D   start a memory (and its folder, if new)
//   aw memory touch <slug>                                   a memory changed: bump `updated`, rename, fix links
//
// The tree is `paths.memory` (default .agents/memory): category folders, one
// topic per file named `<YYYY-MM-DD>-<slug>.md`, frontmatter `name` (= the
// slug), `description`, `type`, `updated` (= the date prefix), and an INDEX.md
// at every level.
//
// An INDEX.md is generated when its first or second line is the marker
// `aw memory index` writes (GENERATED below): its lists come from the memories'
// frontmatter and only its description line is written by hand. Any other
// INDEX.md is hand-written and is never rewritten as a side effect: `new`
// appends one line to it, `touch` replaces the old file name on the line that
// links it, and `index` refuses to run over it until it is told to with --adopt.
import fs from "node:fs";
import path from "node:path";
import {
  AwError, Finding, appendListLine, atomicWrite, emit, fail, git, indexKind as kindOfIndex, ioOf, lineCount, linesLost as lost,
  markdownFiles, parseArgs, parseFrontmatter, projectRoot, readRaw, readText, rel, report, runMain, splitLines, template, today,
} from "../lib/common.mjs";
import { budget, configPath, loadConfig } from "../lib/config.mjs";

const USAGE = `usage: aw memory <lint|index|new|touch> [args]

  aw memory lint [--json]                                  check the tree
  aw memory index [--check] [--adopt] [--json]             write the generated INDEX.md files from the frontmatter
  aw memory new <folder> <slug> --type T --description D [--title T] [--about LINE] [--json]
                                                           start a memory (and its folder, if new)
  aw memory touch <slug> [--date YYYY-MM-DD] [--json]      a memory changed: bump \`updated\`, rename, fix links

The tree is paths.memory (default .agents/memory): category folders, one topic per file named
<YYYY-MM-DD>-<slug>.md, frontmatter name (= the slug), description, type, updated (= the date prefix), and an
INDEX.md at every level. Types: status, decision, learning, report, reference.

An INDEX.md is generated when its first or second line is the marker \`aw memory index\` writes. Any other is
hand-written and never rewritten as a side effect: \`new\` appends one line to it, \`touch\` replaces the old file
name on the line that links it, and \`index\` refuses to run over it until it is told to with --adopt.

  MEM_FRONTMATTER       a memory without the four fields, with an unknown type, or whose date and \`updated\` differ
  MEM_NAME_MISMATCH     the file name is not <date>-<slug>.md, or \`name\` is not the slug
  MEM_SLUG_DUP          two memories with one slug (a slug is the memory's identity across the tree)
  MEM_ROOT_LOOSE        a memory at the root of the tree (memories live in category folders)
  MEM_FOLDER_OVER       a folder with more memories than budgets.memoryFolderFiles: split it
  MEM_FILE_SIZE         a memory over budgets.memoryFileLines
  MEM_HOOK_LONG         a description over budgets.indexHookChars (it is the index line)
  MEM_LINK_DANGLING     a [[slug]] that names no memory
  MEM_INDEX_STALE       an INDEX.md that is missing, or a generated one that differs from what \`aw memory index\` writes
  MEM_INDEX_HANDWRITTEN info: an INDEX.md written by hand (kept as it is; \`aw memory index --adopt\` converts it)
  MEM_INDEX_PLACEHOLDER a folder's INDEX.md still says \`<one line: what belongs in this folder>\`: write the line
  MEM_SHARED_CANDIDATE  info: tagged machine or tooling, so it may belong in the shared learnings (aw learn add)
  STATUS_SIZE           the status memory over budgets.statusLines (critical beyond three times the budget)
  STATUS_DONE_SECTION   the status memory keeps a Done section (done is the git log and closed cards: aw status)
  STATUS_MULTI          more than one memory of type status`;

/** The types of a memory; also the order of an index. */
export const TYPES = Object.freeze(["status", "decision", "learning", "report", "reference"]);
const NAME_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const LINK_RE = /\[\[([a-z0-9][a-z0-9-]*)\]\]/g;
const CODE_RE = /`[^`]*`/g;
const DONE_RE = /^#{1,6}\s+(Done|Completed|Changelog|History)\b/i;
const SHARED_TAGS = ["machine", "tooling"];
/** What a folder's index says until someone writes its one line. */
export const FOLDER_INTRO = "<one line: what belongs in this folder>";
const PARENT_LINK = /\s*Parent:\s*\[[^\]]*\]\([^)]*\)\.?/g; // written by the generator on a line of its own
/** The marker of a generated index, on its second line. An INDEX.md without it is hand-written. */
export const GENERATED = "<!-- generated by `aw memory index`: the description line below is yours, the lists come from the "
  + "memories' frontmatter -->";
const INDEX = "INDEX.md";

const squash = (value) => String(value).split(/\s+/).filter(Boolean).join(" ");
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byParts = (a, b) => {
  const [x, y] = [a.split(path.sep), b.split(path.sep)];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return byName(x[i], y[i]);
  return x.length - y.length;
};
const isDir = (p) => {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
};
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};
const plural = (n, one = "", many = "s") => (n === 1 ? one : many);

/** The memory tree's folder (`paths.memory`). */
export function memoryRoot(root, cfg) {
  return configPath(cfg, root, "memory");
}

/**
 * The tree as data: `{ dir, folders: [path], memories: [entry], loose: [entry] }`.
 *
 * An entry: `{ path, rel (to the repository), folder, file, date, slug, fields (null without frontmatter), body,
 * lines, text }`. `loose` holds the memories at the root of the tree.
 */
export function scan(root, cfg) {
  const base = memoryRoot(root, cfg);
  const out = { dir: base, folders: [], memories: [], loose: [] };
  if (!isDir(base)) return out;
  const visit = (d) => {
    let names;
    try { names = fs.readdirSync(d).sort(byName); } catch { return; }
    for (const name of names) {
      const full = path.join(d, name);
      if (isDir(full)) {
        if (!name.startsWith(".")) {
          out.folders.push(full);
          visit(full);
        }
      } else if (path.extname(name).toLowerCase() === ".md" && name !== INDEX) {
        const text = readText(full, "") ?? "";
        const [fields, body] = parseFrontmatter(text);
        const m = NAME_RE.exec(name);
        const entry = {
          path: full, rel: rel(full, root), folder: d, file: name, date: m ? m[1] : null, slug: m ? m[2] : null,
          fields, body, lines: lineCount(text), text,
        };
        (d === base ? out.loose : out.memories).push(entry);
      }
    }
  };
  visit(base);
  return out;
}

const typeOf = (entry) => String(entry.fields?.type || "");

/** The hand-written description line of an INDEX.md: its first paragraph that is no heading, link or list. */
function intro(index, fallback) {
  for (const line of splitLines(readText(index) ?? "")) {
    let s = line.trim();
    if (!s || ["#", "-", "*", "<!--", "Parent:", "|"].some((lead) => s.startsWith(lead))) continue;
    // A hand-written index may end its description with the parent link: that link is the generator's to write,
    // and in the root index, which lists this description, it would point at the wrong file.
    s = s.replace(PARENT_LINK, "").trim();
    if (s) return s;
  }
  return fallback;
}

/** "missing", "generated" (the marker is its first or second line) or "handwritten". */
export function indexKind(index) {
  return kindOfIndex(index, GENERATED);
}

/** The line of a memory in its folder's index: the house format, also appended to a hand-written index. */
export function memoryLine(m) {
  const hook = squash(m.fields?.description || "<no description>");
  return `- [${m.slug || m.file.slice(0, -3)}](${m.file}) — ${typeOf(m) || "?"} — ${hook}`;
}

/** The generated INDEX.md of folder `d`; `about` replaces the description line it would keep. */
export function buildIndex(d, tree, about = null) {
  const isRoot = d === tree.dir;
  const fallback = isRoot ? "Decisions, measured facts, lessons and status of this project: one line per category folder." : FOLDER_INTRO;
  const lines = [isRoot ? "# Memory index" : `# ${path.basename(d)}/`, GENERATED, "", about || intro(path.join(d, INDEX), fallback), ""];
  if (!isRoot) lines.push("Parent: [../INDEX.md](../INDEX.md)", "");
  for (const f of tree.folders.filter((x) => path.dirname(x) === d).sort(byParts)) {
    lines.push(`- [${path.basename(f)}/](${path.basename(f)}/INDEX.md) — ${intro(path.join(f, INDEX), FOLDER_INTRO)}`);
  }
  const rank = (m) => (TYPES.includes(typeOf(m)) ? TYPES.indexOf(typeOf(m)) : TYPES.length);
  const mine = tree.memories.filter((m) => m.folder === d)
    .sort((a, b) => rank(a) - rank(b) || byName(a.slug || a.file, b.slug || b.file));
  lines.push(...mine.map(memoryLine));
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Every INDEX.md the tree should hold, as `[path, text]` pairs in path order. */
export function indexes(tree) {
  if (!isDir(tree.dir)) return [];
  return [tree.dir, ...tree.folders].map((d) => [path.join(d, INDEX), buildIndex(d, tree)]).sort((a, b) => byParts(a[0], b[0]));
}

/**
 * How many lines of an index say something the generated one would not. A parent link at the end of the
 * description line is not lost: the generator writes it on a line of its own.
 */
export function linesLost(have, generated) {
  const kept = splitLines(have).map((l) => (l.trim().startsWith("Parent:") ? l : l.replace(PARENT_LINK, "")));
  return lost(kept.join("\n"), generated);
}

/** The hand-written indexes of the tree: `[{ path, linesLost }]`. */
export function handwritten(root, tree) {
  const out = [];
  for (const [file, text] of indexes(tree)) {
    if (indexKind(file) === "handwritten") out.push({ path: rel(file, root), linesLost: linesLost(readText(file, "") ?? "", text) });
  }
  return out;
}

/** What `aw memory lint` and the doctor report about the tree. */
export function findings(root, cfg = null) {
  const config = cfg ?? loadConfig(root);
  const tree = scan(root, config);
  const out = [];
  if (!isDir(tree.dir)) return out;
  const B = (key) => budget(config, key);
  for (const e of tree.loose) {
    out.push(new Finding("MEM_ROOT_LOOSE", "warning", e.rel, 0, "a memory at the root of the tree: move it into the category folder that fits"));
  }
  const slugs = new Map();
  for (const e of tree.memories) if (e.slug) slugs.set(e.slug, [...(slugs.get(e.slug) ?? []), e]);
  const status = tree.memories.filter((e) => typeOf(e) === "status");
  for (const e of tree.memories) {
    const f = e.fields;
    if (e.slug === null) {
      out.push(new Finding("MEM_NAME_MISMATCH", "warning", e.rel, 0, "the file name must be <YYYY-MM-DD>-<slug>.md (kebab-case slug)"));
    }
    if (f === null) {
      out.push(new Finding("MEM_FRONTMATTER", "warning", e.rel, 1, "no frontmatter: name, description, type, updated"));
      continue;
    }
    const missing = ["name", "description", "type", "updated"].filter((k) => !String(f[k] || "").trim());
    if (missing.length) out.push(new Finding("MEM_FRONTMATTER", "warning", e.rel, 1, `frontmatter lacks: ${missing.join(", ")}`));
    if (f.type && !TYPES.includes(f.type)) {
      out.push(new Finding("MEM_FRONTMATTER", "warning", e.rel, 1, `type "${f.type}" is not one of: ${TYPES.join(", ")}`));
    }
    if (e.date && f.updated && String(f.updated) !== e.date) {
      out.push(new Finding("MEM_FRONTMATTER", "warning", e.rel, 1,
        `\`updated: ${f.updated}\` and the file name's date ${e.date} differ (aw memory touch ${e.slug})`));
    }
    if (e.slug && f.name && f.name !== e.slug) {
      out.push(new Finding("MEM_NAME_MISMATCH", "warning", e.rel, 1, `\`name: ${f.name}\` is not the file's slug \`${e.slug}\``));
    }
    const hook = [...squash(f.description || "")].length;
    if (hook > B("indexHookChars")) {
      out.push(new Finding("MEM_HOOK_LONG", "warning", e.rel, 1,
        `the description is ${hook} characters, the budget is ${B("indexHookChars")}: it is the index line, say what is in the file and when it matters`));
    }
    const lines = splitLines(e.text);
    if (typeOf(e) === "status") {
      const limit = B("statusLines");
      if (e.lines > limit) {
        out.push(new Finding("STATUS_SIZE", e.lines > 3 * limit ? "critical" : "warning", e.rel, 0,
          `${e.lines} lines, the budget is ${limit}: goal, current focus, known issues as card links; lessons move to topic memories`));
      }
      const done = lines.findIndex((line) => DONE_RE.test(line));
      if (done >= 0) {
        out.push(new Finding("STATUS_DONE_SECTION", "warning", e.rel, done + 1,
          "a Done section: what is done is the git log and the closed cards (aw status)"));
      }
    } else if (e.lines > B("memoryFileLines")) {
      out.push(new Finding("MEM_FILE_SIZE", "warning", e.rel, 0, `${e.lines} lines, the budget is ${B("memoryFileLines")}: one topic per file, split it`));
    }
    lines.forEach((line, i) => {
      // `[[slug]]` in code is talk about the syntax.
      for (const m of line.replace(CODE_RE, "").matchAll(LINK_RE)) {
        if (!slugs.has(m[1])) out.push(new Finding("MEM_LINK_DANGLING", "warning", e.rel, i + 1, `[[${m[1]}]] names no memory`));
      }
    });
    const given = f.tags || [];
    const tags = (Array.isArray(given) ? given : String(given).split(/[,\s]+/)).map((t) => String(t).toLowerCase());
    if (tags.some((t) => SHARED_TAGS.includes(t))) {
      out.push(new Finding("MEM_SHARED_CANDIDATE", "info", e.rel, 0,
        "tagged machine/tooling: if it holds for other projects too, publish it with `aw learn add`"));
    }
  }
  for (const [slug, entries] of [...slugs].sort((a, b) => byName(a[0], b[0]))) {
    if (entries.length > 1) {
      out.push(new Finding("MEM_SLUG_DUP", "warning", entries[1].rel, 0, `the slug \`${slug}\` is used twice: ${entries.map((x) => x.rel).join(", ")}`));
    }
  }
  if (status.length > 1) {
    out.push(new Finding("STATUS_MULTI", "warning", status[1].rel, 0, `more than one memory of type status: ${status.map((x) => x.rel).join(", ")}`));
  }
  for (const d of tree.folders) {
    const n = tree.memories.filter((e) => e.folder === d).length;
    if (n > B("memoryFolderFiles")) {
      out.push(new Finding("MEM_FOLDER_OVER", "warning", rel(d, root), 0,
        `${n} memories, the budget is ${B("memoryFolderFiles")}: split the folder where it clearly divides`));
    }
  }
  for (const [file, text] of indexes(tree)) {
    const have = readText(file);
    if (have !== null && indexKind(file) === "handwritten") {
      const n = linesLost(have, text);
      out.push(new Finding("MEM_INDEX_HANDWRITTEN", "info", rel(file, root), 0,
        `written by hand (${n} line${plural(n)} would be lost by generating it): \`aw memory new\` and \`touch\` edit it a line at a time; \`aw memory index --adopt\` converts it`));
    } else if (have === null || have !== text) {
      out.push(new Finding("MEM_INDEX_STALE", "warning", rel(file, root), 0,
        `${have === null ? "is missing" : "differs from the memories' frontmatter"} (aw memory index)`));
    }
    if (have !== null && path.dirname(file) !== tree.dir) {
      const at = splitLines(have).findIndex((l) => l.trim() === FOLDER_INTRO) + 1;
      if (at) {
        out.push(new Finding("MEM_INDEX_PLACEHOLDER", "warning", rel(file, root), at,
          `still says \`${FOLDER_INTRO}\`: write the folder's one line in its place (that line is yours), then \`aw memory index\` carries it into the parent index. A new folder gets it at once from \`aw memory new … --about "<one line>"\``));
      }
    }
  }
  return out;
}

/**
 * Write the indexes that are missing or generated and stale; a hand-written one only with `adopt`. `only` names the
 * folders whose index may be written (default: every folder of the tree). Gives the paths written, repo-relative.
 */
export function writeIndexes(root, cfg, { adopt = false, only = null } = {}) {
  const changed = [];
  for (const [file, text] of indexes(scan(root, cfg))) {
    if (only !== null && !only.includes(path.dirname(file))) continue;
    if (!adopt && indexKind(file) === "handwritten") continue;
    if (readText(file) !== text) {
      atomicWrite(file, text);
      changed.push(rel(file, root));
    }
  }
  return changed;
}

// ------------------------------------------------------------------------------- edits that keep every other byte

/** Replace a file name wherever a Markdown file has it; nothing else of the file changes. */
function replaceName(file, old, fresh) {
  const raw = readRaw(file);
  if (!raw || !raw.includes(old)) return false;
  atomicWrite(file, raw.replaceAll(old, () => fresh));
  return true;
}

/** Rename a memory: `git mv` when git tracks the file (its history follows it), else a plain rename. Says which. */
function rename(old, fresh) {
  const dir = path.dirname(old);
  if (git(["ls-files", "--error-unmatch", "--", path.basename(old)], dir)[0] === 0) {
    const [code] = git(["mv", "--", path.basename(old), path.basename(fresh)], dir);
    if (code === 0 && isFile(fresh) && !fs.existsSync(old)) return "git mv";
  }
  fs.renameSync(old, fresh);
  return "rename";
}

// ------------------------------------------------------------------------------------------------------- commands

const context = (io) => {
  const root = projectRoot(io.cwd);
  return [root, loadConfig(root)];
};

function lint(args, io) {
  const { values } = parseArgs(args, { json: { type: "boolean" } });
  const [root, cfg] = context(io);
  const tree = scan(root, cfg);
  if (!isDir(tree.dir) && !values.json) {
    emit(io, `aw memory: no ${rel(tree.dir, root)} here (aw setup --plan)`);
    return 0;
  }
  return report(io, findings(root, cfg), { json: values.json === true, title: `memory: ${tree.memories.length} memories in ${tree.folders.length} folders`, cfg });
}

function index(args, io) {
  const { values } = parseArgs(args, { check: { type: "boolean" }, adopt: { type: "boolean" }, json: { type: "boolean" } });
  const [root, cfg] = context(io);
  const json = values.json === true;
  if (values.check) {
    const stale = findings(root, cfg).filter((f) => f.code === "MEM_INDEX_STALE" || f.code === "MEM_INDEX_HANDWRITTEN");
    return report(io, stale, { json, title: "memory indexes", cfg });
  }
  const byHand = handwritten(root, scan(root, cfg));
  if (byHand.length && !values.adopt) {
    if (json) {
      emit(io, { refused: true, handwritten: byHand, written: [] }, true);
      return 2;
    }
    const n = byHand.length;
    const gone = byHand.reduce((sum, h) => sum + h.linesLost, 0);
    return fail(io, [
      `aw memory index: ${n} index${plural(n, " is", "es are")} written by hand; nothing was written.`,
      ...byHand.map((h) => `  ${h.path}  (${h.linesLost} line${plural(h.linesLost)} would be lost)`),
      "Generating them replaces every list line with the slug, type and `description` of the memory's "
        + `frontmatter: ${gone} line${plural(gone, " says", "s say")} something else today, and that text would be gone.`,
      `First move what those lines say into each memory's \`description\` (${budget(cfg, "indexHookChars")} `
        + "characters at most: `aw memory lint` reports MEM_HOOK_LONG), then run `aw memory index --adopt`.",
      "Until then `aw memory new` and `aw memory touch` edit these indexes one line at a time.",
    ].join("\n"));
  }
  const changed = writeIndexes(root, cfg, { adopt: values.adopt === true });
  const adopted = byHand.map((h) => h.path);
  if (json) emit(io, { written: changed, adopted }, true);
  else emit(io, changed.map((c) => `${adopted.includes(c) ? "adopted" : "wrote"} ${c}`).join("\n") || "memory indexes are up to date");
  return 0;
}

function start(args, io) {
  const { values, positionals } = parseArgs(args, {
    type: { type: "string" }, description: { type: "string" }, title: { type: "string" }, about: { type: "string" }, json: { type: "boolean" },
  });
  if (positionals.length !== 2) throw new AwError("new takes a folder and a slug: aw memory new <folder> <slug> --type T --description D");
  const [folderName, slug] = positionals;
  if (values.type === undefined || values.description === undefined) throw new AwError("new needs --type and --description");
  if (!TYPES.includes(values.type)) throw new AwError(`--type is one of: ${TYPES.join(", ")}`);
  const [root, cfg] = context(io);
  if (!SLUG_RE.test(slug) || !SLUG_RE.test(folderName)) {
    return fail(io, "aw memory new: folder and slug are kebab-case (lower-case letters, digits, '-')");
  }
  let tree = scan(root, cfg);
  const clash = [...tree.memories, ...tree.loose].find((e) => e.slug === slug);
  if (clash) return fail(io, `aw memory new: the slug \`${slug}\` exists: ${clash.rel} (update it: aw memory touch ${slug})`);
  if (values.type === "status" && tree.memories.some((e) => typeOf(e) === "status")) {
    return fail(io, "aw memory new: there is a status memory already; a project has one");
  }
  const folder = path.join(tree.dir, folderName);
  const date = today();
  const file = path.join(folder, `${date}-${slug}.md`);
  const words = slug.replaceAll("-", " ");
  const title = values.title || words.charAt(0).toUpperCase() + words.slice(1);
  const text = template(values.type === "status" ? "status.md" : "memory-file.md",
    { slug, description: squash(values.description), type: values.type, date, title });
  atomicWrite(file, text);
  // Only the indexes this memory belongs in: its folder's, and the root's when the folder is new to it.
  tree = scan(root, cfg);
  const entry = tree.memories.find((e) => e.path === file);
  const about = squash(values.about || "");
  const folderIndex = path.join(folder, INDEX);
  const rootIndex = path.join(tree.dir, INDEX);
  const kind = indexKind(folderIndex);
  const changed = [];
  if (kind === "handwritten") {
    if (appendListLine(folderIndex, memoryLine(entry))) changed.push(rel(folderIndex, root));
  } else if (kind === "generated") {
    changed.push(...writeIndexes(root, cfg, { only: [folder] }));
  } else if (indexKind(rootIndex) === "handwritten") {
    // A hand-written tree gets a folder index of its own kind, and one line for the folder in the root index.
    atomicWrite(folderIndex, `# ${folderName}/\n\n${about || FOLDER_INTRO}\n\nParent: [../INDEX.md](../INDEX.md)\n\n${memoryLine(entry)}\n`);
    changed.push(rel(folderIndex, root));
    if (!(readText(rootIndex, "") ?? "").includes(`(${folderName}/INDEX.md)`)) {
      if (appendListLine(rootIndex, `- [${folderName}/](${folderName}/INDEX.md) — ${about || FOLDER_INTRO}`)) changed.push(rel(rootIndex, root));
    }
  } else {
    atomicWrite(folderIndex, buildIndex(folder, tree, about || null));
    changed.push(rel(folderIndex, root));
    changed.push(...writeIndexes(root, cfg, { only: [tree.dir] }));
  }
  if (values.json) emit(io, { path: rel(file, root), indexes: changed }, true);
  else emit(io, rel(file, root));
  if (intro(folderIndex, FOLDER_INTRO) === FOLDER_INTRO) {
    io.stderr.write(`note: ${rel(folderIndex, root)} still says \`${FOLDER_INTRO}\`: write the folder's one line in `
      + "its place, then run `aw memory index` (for a new folder, `--about \"<one line>\"` does it at once). "
      + "`aw memory lint` reports it as MEM_INDEX_PLACEHOLDER until then.\n");
  }
  return 0;
}

const isLink = (p) => {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
};

function touch(args, io) {
  const { values, positionals } = parseArgs(args, { date: { type: "string" }, json: { type: "boolean" } });
  if (positionals.length !== 1) throw new AwError("touch takes one slug: aw memory touch <slug>");
  const [slug] = positionals;
  const [root, cfg] = context(io);
  const tree = scan(root, cfg);
  const found = [...tree.memories, ...tree.loose].filter((e) => e.slug === slug);
  if (found.length !== 1) return fail(io, `aw memory touch: ${found.length ? "more than one" : "no"} memory with the slug \`${slug}\``);
  const [e] = found;
  const date = values.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(io, "aw memory touch: --date is YYYY-MM-DD");
  const raw = readRaw(e.path);
  if (raw === null) return fail(io, `aw memory touch: ${e.rel} cannot be read`);
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  let text = raw;
  if (e.fields !== null && "updated" in e.fields) {
    text = text.replace(/^updated:[^\r\n]*/m, () => `updated: ${date}`);
  } else if (e.fields !== null) {
    text = text.replace(/^(﻿?---[ \t]*\r?\n[\s\S]*?)(\r?\n---)/, (_, head, close) => `${head}${nl}updated: ${date}${close}`);
  }
  const newName = `${date}-${slug}.md`;
  const newPath = path.join(path.dirname(e.path), newName);
  const renamed = newName !== e.file;
  const fixed = [];
  const changed = [];
  let how = null;
  if (renamed && fs.existsSync(newPath)) return fail(io, `aw memory touch: ${rel(newPath, root)} exists already`);
  if (renamed) how = rename(e.path, newPath);
  if (text !== raw) atomicWrite(newPath, text);
  // The index of the memory's folder, and no other folder's. A generated one is written again from the frontmatter
  // (the description may have changed); a hand-written one only has the file name replaced on the line that links it.
  const folderIndex = path.join(e.folder, INDEX);
  if (indexKind(folderIndex) === "generated") changed.push(...writeIndexes(root, cfg, { only: [e.folder] }));
  if (renamed) {
    // Links name the exact file: fix them wherever the repository's Markdown has one. A hand-written index is
    // Markdown like any other; a generated one never names another folder's memory.
    const inTree = (md) => path.basename(md) === INDEX && (path.dirname(md) === tree.dir || md.startsWith(tree.dir + path.sep));
    for (const md of [...new Set([folderIndex, ...markdownFiles(root)])].sort(byParts)) {
      // A symlink is another file's second name: the file itself is in the list.
      if (md === newPath || !isFile(md) || isLink(md) || (inTree(md) && indexKind(md) === "generated")) continue;
      if (replaceName(md, e.file, newName)) (inTree(md) ? changed : fixed).push(rel(md, root));
    }
  }
  if (values.json) {
    emit(io, { path: rel(newPath, root), renamedFrom: renamed ? e.rel : null, renamedWith: how, linksFixed: fixed, indexes: [...changed].sort() }, true);
  } else {
    const said = { "git mv": "renamed with git mv", rename: "renamed without git: the file is not tracked, or git is absent" };
    emit(io, rel(newPath, root) + (renamed ? `  (was ${e.file}; ${said[how]})` : "  (already dated today)"));
    for (const f of fixed) emit(io, `fixed links in ${f}`);
    for (const c of [...changed].sort()) emit(io, `updated ${c}`);
  }
  return 0;
}

const ACTIONS = { lint, index, new: start, touch };

export async function main(argv, io) {
  io = ioOf(io);
  const [action, ...rest] = argv;
  if (action === "-h" || action === "--help" || rest.includes("--help") || rest.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  if (!Object.hasOwn(ACTIONS, action ?? "")) {
    emit(io, USAGE);
    return 2;
  }
  return ACTIONS[action](rest, io);
}

runMain(import.meta.url, main);
