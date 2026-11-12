#!/usr/bin/env node
// Spec-tree structural verifier, count-agnostic. Read-only, Node 22 stdlib only.
// Validates the progressive-disclosure specification under `.agents/plan/spec/`
// authored by the `spec-write` skill:
//
//   * every content file (non-index, non-README) carries valid frontmatter
//     (tags, summary, created, updated; relates-to optional);
//   * `index.md` files are navigation hubs and carry NO frontmatter;
//   * `relates-to` cross-links resolve to real files;
//   * a root `spec/index.md` exists.
//
// Exits 0 clean, 1 on warnings only, 2 on any critical violation. Reports the
// discovered counts:
//   OK: 4 categories, 17 content files, 6 index hubs, 0 broken links
//
// `assets/` and `scripts/` are skipped (site chrome, not docs), as is
// `prototypes/` (throwaway HTML design artifacts).
import fs from "node:fs";
import path from "node:path";

const SPEC_ROOT = path.dirname(import.meta.dirname); // .agents/plan/spec/ (the script sits in spec/scripts/)

const SKIP_DIRS = new Set(["assets", "scripts", ".site", "prototypes"]);
const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;
const SIZE_WARN_LINES = 200;

const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/**
 * [frontmatter object or null, whether a block was present]. Minimal YAML:
 * flat keys, inline `[a, b]` lists, and `key:` followed by `- item` lines.
 */
export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return [null, false];
  const end = text.indexOf("\n---", 3);
  if (end === -1) return [null, false];
  const lines = text.slice(3, end).replace(/^\n+|\n+$/g, "").split("\n");
  const data = {};
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }
    const [, key, raw] = m;
    const val = raw.trim();
    if (val === "") {
      const items = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) { items.push(lines[j].replace(/^\s*-\s+/, "").trim()); j++; }
      data[key] = items;
      i = j;
    } else if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      data[key] = inner ? inner.split(",").map((s) => s.trim()).filter(Boolean) : [];
      i++;
    } else {
      data[key] = val.replace(/^["']|["']$/g, "");
      i++;
    }
  }
  return [data, true];
}

/** Every `.md` under the spec root, skip dirs pruned, sorted by full path. */
function markdownFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) markdownFiles(full, out); continue; }
    if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out.sort();
}

export function verify() {
  const failures = []; // critical -> exit 2
  const warnings = []; // exit 1 when there are no failures

  if (!exists(path.join(SPEC_ROOT, "index.md"))) failures.push("spec/: missing root index.md");

  const categories = fs.readdirSync(SPEC_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name)).map((e) => e.name).sort();

  const contentFiles = [];
  const indexHubs = [];

  for (const md of markdownFiles(SPEC_ROOT)) {
    const rel = path.relative(SPEC_ROOT, md);
    const text = read(md);
    const name = path.basename(md);

    if (name === "index.md") {
      indexHubs.push(md);
      if (parseFrontmatter(text)[1]) warnings.push(`spec/${rel}: index.md should be a navigation hub with no frontmatter`);
      continue;
    }
    if (name === "README.md") continue;

    contentFiles.push(md);
    const [fm, had] = parseFrontmatter(text);
    if (!had) { failures.push(`spec/${rel}: MISSING_FRONTMATTER (content file has no --- block)`); continue; }
    for (const field of ["tags", "summary", "created", "updated"]) {
      if (!(field in fm)) failures.push(`spec/${rel}: INVALID_FRONTMATTER (missing '${field}')`);
    }
    if (Array.isArray(fm.tags) && !fm.tags.length) warnings.push(`spec/${rel}: EMPTY_TAGS`);
    for (const datef of ["created", "updated"]) {
      const v = fm[datef];
      if (typeof v === "string" && v && !DATE_RE.test(v)) {
        failures.push(`spec/${rel}: INVALID_FRONTMATTER ('${datef}' must be YYYY-MM or YYYY-MM-DD, got '${v}')`);
      }
    }
    const relTo = fm["relates-to"] ?? [];
    if (Array.isArray(relTo)) {
      for (const entry of relTo) {
        const link = String(entry).split("#")[0].trim();
        if (!link || link.startsWith("http")) continue;
        if (!exists(path.resolve(path.dirname(md), link))) failures.push(`spec/${rel}: relates-to link does not resolve: ${link}`);
      }
    }
    if ((text.match(/\n/g) ?? []).length > SIZE_WARN_LINES) {
      warnings.push(`spec/${rel}: oversized (> ${SIZE_WARN_LINES} lines), consider splitting`);
    }
  }

  // Mandatory contract pages (exact filenames; owned by spec-write's
  // CODEBASE-LAYOUT.md and USER-DOCS-SPEC.md). Warn level: legacy specs pass.
  const contentNames = new Set(contentFiles.map((p) => path.basename(p)));
  for (const page of ["repository-layout.md", "user-docs-plan.md"]) {
    if (!contentNames.has(page)) warnings.push(`spec/: no content file named ${page} (mandatory page, see spec-write)`);
  }

  for (const w of warnings) console.log(`WARN: ${w}`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL: ${f}`);
    console.log(`\n${failures.length} failure(s), ${warnings.length} warning(s)`);
    return 2;
  }
  console.log(`OK: ${categories.length} categories, ${contentFiles.length} content files, ${indexHubs.length} index hubs, 0 broken links`);
  return warnings.length ? 1 : 0;
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) {
  if (isDir(SPEC_ROOT)) {
    process.exitCode = verify();
  } else {
    console.log(`FAIL: no spec tree at ${SPEC_ROOT}`);
    process.exitCode = 2;
  }
}
