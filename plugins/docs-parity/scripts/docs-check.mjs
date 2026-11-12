#!/usr/bin/env node
// Check the user docs against the rules a script can check, and against the
// code they describe. Reads `.agents/docs-parity.json` at the project root; a
// project without it has not opted in, and the check prints one line and
// exits 0.
//
// Tree checks: every image a page embeds exists and has its dark twin, no image
// sits unreferenced, internal links resolve (markdown, MDX, and wiki links), a
// public root never links into a private one, the nav manifest and the pages
// agree, pages carry their frontmatter and opening summary and stay under
// budget, and a root's deny patterns stay out of its pages.
//
// Two git-backed modes look at the code too:
//   --changed BASE   files changed since BASE (a ref or an A..B range); a
//                    surface's code changing while its pages and shots did not
//                    is PARITY_MISSING, unless a `Docs: none, <why>` line in the
//                    range's commit messages or in --note says why
//   --stale          a shot whose capture commit (the shots manifest, else the
//                    image's own last commit) predates a change to its
//                    surface's code is SHOT_STALE
//
// Exit 0 clean (info only), 1 warnings, 2 critical or an error. --json prints
// one object:
// {config, mode, summary, accepted, findings: [{code, severity, path, line, message}]}.
// Never writes a file.
//
// One file, Node 22 stdlib only, no imports of its own: a copy placed in a
// repository runs in CI, where the plugin is not installed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const CONFIG = ".agents/docs-parity.json";
const PAGE_EXT = [".md", ".mdx"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"];
const TWIN_EXT = [".png", ".jpg", ".jpeg", ".webp", ".avif"]; // raster only: an SVG can be theme-neutral
const NAV_FILES = new Set(["_Sidebar.md", "_sidebar.md", "_Footer.md", "_footer.md", "SUMMARY.md"]);
const SEVERITY = { critical: 2, warning: 1, info: 0 };

const DEFAULTS = {
  target: "docs-folder",
  docsRoot: "docs",
  nav: "auto",
  frontmatter: [],
  tags: null,
  summary: true,
  pageBudget: 120,
  linkBase: "/",
  roots: [],
  images: {},
  surfaces: [],
  ignore: ["**/AGENTS.md", "**/CLAUDE.md", "**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**", "**/__tests__/**"],
  accept: [],
};

const IMG_MD = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
const IMG_ATTR = /\b(?:src|srcSet|srcset)\s*=\s*\{?["'`]([^"'`]+)["'`]/g;
const LINK_MD = /(?<!!)\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g;
const LINK_ATTR = /\bhref\s*=\s*\{?["'`]([^"'`]+)["'`]/g;
const LINK_WIKI = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const INLINE_CODE = /`[^`]*`/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const DOCS_NONE = /^\s*Docs:\s*(none|n\/?a|no\b)/im;

const finding = (code, severity, p, line, message) => ({ code, severity, path: p, line, message });
const all = (re, text) => [...text.matchAll(re)].map((m) => m[1]);
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// Text as every check reads it: no byte-order mark, and one kind of line ending.
const readText = (p) => fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
const ext = (p) => path.extname(p).toLowerCase();
const stem = (p) => path.basename(p, path.extname(p));
const toPosix = (p) => p.split(path.sep).join("/");
const trimSlashes = (s) => String(s ?? "").replace(/^\/+|\/+$/g, "");
// Symlinks resolved, so a file reached through a link is the same file
// whichever way a page names it. A path that does not exist stays as written.
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
/** A path as findings name it: relative to the root, where the file really is; as given when that is outside the root. */
const relTo = (root, p) => {
  const rel = path.relative(real(root), real(p));
  return rel.startsWith("..") || path.isAbsolute(rel) ? toPosix(p) : toPosix(rel) || ".";
};
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Paths in folder order: a folder's own files sort with it, whatever punctuation its siblings carry. */
const byParts = (a, b) => {
  const x = a.split(path.sep), y = b.split(path.sep);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return byText(x[i], y[i]);
  return x.length - y.length;
};

/** A repo-relative glob as a regex: `**\/` any depth (including none), `*` within a segment. */
export function globRe(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length;) {
    if (pattern.startsWith("**/", i)) { out += "(?:.*/)?"; i += 3; }
    else if (pattern.startsWith("**", i)) { out += ".*"; i += 2; }
    else if (pattern[i] === "*") { out += "[^/]*"; i++; }
    else if (pattern[i] === "?") { out += "[^/]"; i++; }
    else { out += pattern[i].replace(/[.+^${}()|[\]\\]/g, "\\$&"); i++; }
  }
  return new RegExp(`^${out}$`);
}
const matches = (p, globs) => (globs ?? []).some((g) => globRe(g).test(p));

/**
 * A root's deny pattern as a RegExp. A config may carry a pattern in the
 * spelling other regex engines use: named groups as `(?P<name>...)`, `\A` and
 * `\Z` for the ends, and leading inline flags such as `(?i)`.
 */
function denyRe(pattern, rootName) {
  let source = String(pattern), flags = "";
  const inline = /^\(\?([a-z]+)\)/.exec(source);
  if (inline) {
    source = source.slice(inline[0].length);
    flags = [...new Set(inline[1])].filter((f) => "ims".includes(f)).join("");
  }
  // One pass, escapes first, so an escaped backslash or parenthesis is never taken for the start of one of these.
  source = source.replace(/\\([\s\S])|\(\?P<([A-Za-z_]\w*)>|\(\?P=([A-Za-z_]\w*)\)/g, (m, escaped, group, backref) => {
    if (escaped !== undefined) return escaped === "A" ? "^" : escaped === "Z" ? "$" : m;
    return group ? `(?<${group}>` : `\\k<${backref}>`;
  });
  try { return new RegExp(source, flags); } catch (e) {
    throw new Error(`the ${rootName} root's deny pattern /${pattern}/ is not a regular expression (${e.message})`);
  }
}

function loadConfig(root, config) {
  const p = config ? path.resolve(config) : path.join(root, CONFIG);
  if (!isFile(p)) return null;
  let cfg;
  try { cfg = JSON.parse(readText(p)); } catch (e) { throw new Error(`${config ?? CONFIG} does not parse (${e.message})`); }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error(`${config ?? CONFIG} is not a JSON object`);
  return { ...DEFAULTS, ...cfg };
}

// ---- pages ------------------------------------------------------------------

/** [frontmatter text or null, body, the line number body's first line sits on]. */
function splitFrontmatter(text) {
  if (text.startsWith("---\n")) {
    const rest = text.slice(4);
    const end = /^---[ \t]*$/m.exec(rest);
    if (end) {
      const fm = rest.slice(0, end.index);
      return [fm, rest.slice(end.index + end[0].length), fm.split("\n").length + 1]; // body[0] is the rest of the closing --- line
    }
  }
  return [null, text, 1];
}

const frontmatterKeys = (fm) => new Set(all(/^([A-Za-z_][\p{L}\p{N}_-]*)\s*:/gmu, fm ?? ""));

function tagCount(fm) {
  const inline = /^tags\s*:\s*\[([^\]]*)\]/m.exec(fm ?? "");
  if (inline) return inline[1].split(",").filter((t) => t.trim()).length;
  const list = /^tags\s*:\s*\n((?:\s+-\s+.*\n?)+)/m.exec(fm ?? "");
  return list ? list[1].trim().split("\n").length : 0;
}

/** The body with fenced code blocks blanked (line count kept), so examples are not checked as links. */
function stripCode(body) {
  let fenced = false;
  return body.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return ""; }
    return fenced ? "" : line;
  }).join("\n");
}

/** True when the first block after imports and an optional H1 is a prose paragraph. */
function hasSummary(body) {
  for (let block of body.trim().split(/\n\s*\n/)) {
    block = block.trim();
    if (!block || block.startsWith("import ") || block.startsWith("export ")) continue;
    if (/^#\s/.test(block)) {
      const nl = block.indexOf("\n");
      if (nl === -1) continue;
      block = block.slice(nl + 1).trim();
    }
    return !/^(#|[-*+]\s|\d+\.\s|<|```|~~~|\||!\[|>)/.test(block);
  }
  return false;
}

/** Every file under a directory. A linked file counts; a linked folder is not entered. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() || (e.isSymbolicLink() && isFile(full))) out.push(full);
  }
  return out;
}

/** The pages: markdown under docsRoot, narrowed to the config's `include` globs when it has them. */
function pageFiles(docsRoot, root, include) {
  if (!isDir(docsRoot)) return [];
  let pages = walk(docsRoot).filter((p) => PAGE_EXT.includes(path.extname(p)) && !NAV_FILES.has(path.basename(p))).sort(byParts);
  if (include?.length) pages = pages.filter((p) => matches(relTo(root, p), include));
  return pages;
}

function rootOf(pageRel, roots, docsRel) {
  const inner = docsRel && pageRel.startsWith(`${docsRel}/`) ? pageRel.slice(docsRel.length + 1) : pageRel;
  return roots.find((r) => {
    const p = trimSlashes(r?.path);
    return p && (inner === p || inner.startsWith(`${p}/`));
  }) ?? null;
}

// ---- resolution -------------------------------------------------------------

const clean = (ref) => ref.split("?")[0].split("#")[0].split(/\s/)[0];

function resolveImage(ref, page, ctx) {
  ref = clean(ref);
  const { urlPrefix, dir } = ctx.images;
  if (urlPrefix && dir && ref.startsWith(urlPrefix)) return path.join(ctx.root, dir, ref.slice(urlPrefix.length));
  if (ref.startsWith("/")) return path.join(ctx.siteRoot, ref.replace(/^\/+/, ""));
  return path.join(path.dirname(page), ref);
}

function resolveWiki(name, ctx) {
  const want = name.trim().replace(/ /g, "-").toLowerCase();
  return ctx.pages.find((p) => stem(p).toLowerCase() === want) ?? null;
}

/** The page file a link points at, or null when nothing on disk matches. */
function resolveLink(href, page, ctx) {
  href = href.split("#")[0].split("?")[0];
  if (!href) return page;
  const base = ctx.linkBase;
  const target = href.startsWith("/")
    ? path.join(ctx.docsRoot, href.startsWith(base) ? href.slice(base.length) : href.replace(/^\/+/, ""))
    : path.join(path.dirname(page), href);
  const candidates = [target];
  if (!PAGE_EXT.includes(path.extname(target))) {
    candidates.push(...PAGE_EXT.map((e) => target + e), ...PAGE_EXT.map((e) => path.join(target, `index${e}`)),
      ...PAGE_EXT.map((e) => path.join(target, `README${e}`)));
  }
  const hit = candidates.find(isFile);
  if (hit) return hit;
  if (ctx.wiki && !trimSlashes(href).includes("/")) return resolveWiki(stem(href), ctx); // a wiki links pages by name, from anywhere
  if (isDir(target) || (!PAGE_EXT.includes(path.extname(target)) && fs.existsSync(target))) return target; // a folder or an asset
  return null;
}

// ---- tree checks ------------------------------------------------------------

function checkLink(out, prel, n, href, target, rootCfg, ctx) {
  if (target === null) { out.push(finding("LINK_BROKEN", "warning", prel, n, `${href} resolves to no page`)); return; }
  const to = rootOf(relTo(ctx.root, target), ctx.roots, ctx.docsRel);
  if (to?.private && !rootCfg?.private) {
    out.push(finding("ROOT_LEAK", "critical", prel, n, `a public page links into the private ${to.name ?? "root"} root: ${href}`));
  }
}

function checkTree(root, cfg) {
  const out = [];
  const docsRel = trimSlashes(cfg.docsRoot);
  const docsRoot = path.join(root, docsRel);
  if (!isDir(docsRoot)) return [finding("DOCS_ROOT_MISSING", "critical", docsRel, 0, "the configured docsRoot does not exist")];
  const images = cfg.images ?? {};
  const ctx = {
    root, docsRel, docsRoot, images,
    roots: cfg.roots ?? [],
    siteRoot: path.join(root, cfg.siteRoot || docsRel),
    linkBase: cfg.linkBase || "/",
    pages: pageFiles(docsRoot, root, cfg.include),
    wiki: String(cfg.target ?? "").startsWith("wiki"),
  };
  const themes = images.themes?.length ? images.themes : ["default"];
  const darkSuffix = images.darkSuffix ?? ".dark";
  const referenced = new Set();
  const deny = new Map(ctx.roots.map((r) => [r, (r?.deny ?? []).map((pat) => [pat, denyRe(pat, r.name ?? "root")])]));

  for (const page of ctx.pages) {
    const prel = relTo(root, page);
    const text = readText(page);
    const [fm, body, bodyLine] = splitFrontmatter(text);
    const rootCfg = rootOf(prel, ctx.roots, docsRel);
    const keys = frontmatterKeys(fm);

    const missing = (cfg.frontmatter ?? []).filter((k) => !keys.has(k));
    if (missing.length) out.push(finding("FRONTMATTER_MISSING", "warning", prel, 1, `frontmatter lacks ${missing.join(", ")}`));
    if (cfg.tags && keys.has("tags")) {
      const n = tagCount(fm);
      if (n < cfg.tags[0] || n > cfg.tags[1]) out.push(finding("FRONTMATTER_TAGS", "warning", prel, 1, `${n} tags, want ${cfg.tags[0]} to ${cfg.tags[1]}`));
    }
    if (cfg.summary && !hasSummary(body)) out.push(finding("SUMMARY_MISSING", "warning", prel, bodyLine, "the page does not open with a summary paragraph"));
    const lines = text.split("\n").length;
    if (cfg.pageBudget && lines > cfg.pageBudget) {
      out.push(finding("PAGE_BUDGET", "warning", prel, lines, `${lines} lines, budget ${cfg.pageBudget}: split it by topic`));
    }

    stripCode(body).split("\n").forEach((raw, i) => {
      const n = bodyLine + i;
      for (const [pat, re] of deny.get(rootCfg) ?? []) {
        if (re.test(raw)) out.push(finding("ROOT_DENY", "warning", prel, n, `the ${rootCfg.name ?? "root"} root does not allow /${pat}/`));
      }
      const line = raw.replace(INLINE_CODE, ""); // deny patterns may target code spans; links and images never sit in one
      for (let ref of [...all(IMG_MD, line), ...all(IMG_ATTR, line)]) {
        ref = ref.split(",")[0].trim();
        if (EXTERNAL.test(ref) || !IMAGE_EXT.includes(ext(clean(ref)))) continue;
        const target = resolveImage(ref, page, ctx);
        referenced.add(real(target));
        if (!isFile(target)) { out.push(finding("IMAGE_MISSING", "warning", prel, n, `${ref} does not exist`)); continue; }
        if (themes.includes("dark") && TWIN_EXT.includes(ext(target)) && !stem(target).endsWith(darkSuffix)) {
          const twin = path.join(path.dirname(target), stem(target) + darkSuffix + path.extname(target));
          referenced.add(real(twin));
          if (!isFile(twin)) out.push(finding("IMAGE_NO_DARK", "warning", prel, n, `${ref} has no ${path.basename(twin)} beside it`));
        }
      }
      for (const href of [...all(LINK_MD, line), ...all(LINK_ATTR, line)]) {
        if (!EXTERNAL.test(href)) checkLink(out, prel, n, href, resolveLink(href, page, ctx), rootCfg, ctx);
      }
      for (const m of line.matchAll(LINK_WIKI)) {
        // GitHub writes [[text|Page]], MediaWiki [[Page|text]]: try both halves
        const target = (m[2] && resolveWiki(m[2], ctx)) || resolveWiki(m[1], ctx);
        checkLink(out, prel, n, `[[${m[2] || m[1]}]]`, target, rootCfg, ctx);
      }
    });
  }

  if (images.dir && isDir(path.join(root, images.dir))) {
    for (const f of walk(path.join(root, images.dir)).sort(byParts)) {
      if (IMAGE_EXT.includes(ext(f)) && !referenced.has(real(f))) {
        out.push(finding("IMAGE_ORPHAN", "warning", relTo(root, f), 0, "no page embeds this image"));
      }
    }
  }
  return out.concat(checkNav(root, cfg, docsRoot, ctx.pages));
}

// ---- nav manifests ----------------------------------------------------------

function detectNav(root, cfg, docsRoot) {
  if (cfg.nav && cfg.nav !== "auto") return cfg.nav;
  if (walk(docsRoot).some((f) => path.basename(f) === "meta.json")) return "meta.json";
  if (isFile(path.join(root, "mkdocs.yml"))) return "mkdocs";
  if (isFile(path.join(docsRoot, "SUMMARY.md"))) return "summary";
  if (sidebarOf(docsRoot)) return "sidebar";
  return "none";
}

/** The wiki sidebar under its name on disk, which a case-blind file system would otherwise answer to either way. */
function sidebarOf(docsRoot) {
  const names = fs.readdirSync(docsRoot);
  const name = ["_Sidebar.md", "_sidebar.md"].find((n) => names.includes(n) && isFile(path.join(docsRoot, n)));
  return name ? path.join(docsRoot, name) : null;
}

function checkNav(root, cfg, docsRoot, pages) {
  const kind = detectNav(root, cfg, docsRoot);
  if (kind === "meta.json") return navMetaJson(root, docsRoot);
  if (kind === "mkdocs") return navListed(root, docsRoot, pages, path.join(root, "mkdocs.yml"), mkdocsEntries(path.join(root, "mkdocs.yml")));
  if (kind === "summary") {
    const f = path.join(docsRoot, "SUMMARY.md");
    return navListed(root, docsRoot, pages, f, mdLinkEntries(f));
  }
  if (kind === "sidebar") return navSidebar(root, pages, sidebarOf(docsRoot) ?? path.join(docsRoot, "_sidebar.md"));
  return [];
}

/** Fumadocs: every folder with a meta.json lists its pages and subfolders in reading order. */
function navMetaJson(root, docsRoot) {
  const out = [];
  for (const meta of walk(docsRoot).filter((f) => path.basename(f) === "meta.json").sort(byParts)) {
    const folder = path.dirname(meta);
    let entries;
    try { entries = JSON.parse(readText(meta)).pages; } catch {
      out.push(finding("NAV_INVALID", "warning", relTo(root, meta), 0, "meta.json does not parse"));
      continue;
    }
    if (!Array.isArray(entries)) continue;
    const strings = entries.filter((e) => typeof e === "string");
    const names = strings.filter((e) => !e.startsWith("---") && !e.startsWith("[") && !e.startsWith("!"))
      .map((e) => (e.startsWith("...") && e.length > 3 ? e.slice(3) : e));
    for (const name of names) {
      if (name === "..." || name === "z...a") continue;
      if (!PAGE_EXT.some((e) => isFile(path.join(folder, name + e))) && !isDir(path.join(folder, name))) {
        out.push(finding("NAV_DEAD", "warning", relTo(root, meta), 0, `lists ${name}, which is not a page or folder`));
      }
    }
    if (strings.includes("...") || strings.includes("z...a")) continue;
    const excluded = new Set(strings.filter((e) => e.startsWith("!")).map((e) => e.slice(1)));
    for (const child of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => byText(a.name, b.name))) {
      const full = path.join(folder, child.name);
      const file = isFile(full);
      const isPage = file && PAGE_EXT.includes(path.extname(child.name));
      const isSection = !file && child.isDirectory() && walk(full).some((f) => PAGE_EXT.includes(path.extname(f)));
      const name = file ? stem(child.name) : child.name;
      if ((isPage || isSection) && !names.includes(name) && !excluded.has(name) && name !== "index") { // index is the folder's own page
        out.push(finding("NAV_MISSING", "warning", relTo(root, full), 0, `not listed in ${relTo(root, meta)}`));
      }
    }
  }
  return out;
}

function mkdocsEntries(file) {
  const m = /^nav\s*:\s*\n((?:[ \t-].*\n?|\s*\n)*)/m.exec(readText(file));
  return m ? all(/([\p{L}\p{N}_./-]+\.md)(?![\p{L}\p{N}_])/gu, m[1]) : null; // no nav key: mkdocs builds the nav from the file system
}

const mdLinkEntries = (file) => all(LINK_MD, stripCode(readText(file))).filter((h) => !EXTERNAL.test(h));

function navListed(root, docsRoot, pages, manifest, entries) {
  if (entries === null) return [];
  const out = [], listed = new Set();
  for (const e of entries) {
    const target = path.join(docsRoot, e.split("#")[0]);
    if (!isFile(target)) out.push(finding("NAV_DEAD", "warning", relTo(root, manifest), 0, `lists ${e}, which does not exist`));
    listed.add(real(target));
  }
  for (const p of pages) {
    if (!listed.has(real(p))) out.push(finding("NAV_MISSING", "warning", relTo(root, p), 0, `not listed in ${relTo(root, manifest)}`));
  }
  return out;
}

/** A GitHub or GitLab wiki: the sidebar links pages by wiki link or markdown link; Home is implicit. */
function navSidebar(root, pages, sidebar) {
  const text = stripCode(readText(sidebar));
  const ctx = { pages }, out = [], listed = new Set();
  for (const m of text.matchAll(LINK_WIKI)) {
    const target = (m[2] && resolveWiki(m[2], ctx)) || resolveWiki(m[1], ctx);
    if (target) listed.add(target);
    else out.push(finding("NAV_DEAD", "warning", relTo(root, sidebar), 0, `links [[${m[1]}]], which is not a page`));
  }
  for (const href of all(LINK_MD, text).filter((h) => !EXTERNAL.test(h))) {
    const target = resolveWiki(stem(href.split("#")[0]), ctx);
    if (target) listed.add(target);
    else out.push(finding("NAV_DEAD", "warning", relTo(root, sidebar), 0, `links ${href}, which is not a page`));
  }
  for (const p of pages) {
    if (stem(p).toLowerCase() !== "home" && !listed.has(p)) {
      out.push(finding("NAV_MISSING", "warning", relTo(root, p), 0, `not linked from ${relTo(root, sidebar)}`));
    }
  }
  return out;
}

// ---- git-backed checks ------------------------------------------------------

function git(root, ...args) {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
  } catch (e) {
    throw new Error(String(e.stderr ?? "").trim() || `git ${args.join(" ")} failed`);
  }
}

/** [changed files, the range's commit messages]. A plain ref compares the working tree, untracked files included. */
export function changedFiles(root, base) {
  const lines = (s) => s.split("\n").filter(Boolean);
  if (base.includes("..")) return [[...new Set(lines(git(root, "diff", "--name-only", base)))].sort(byText), git(root, "log", "--format=%B", base)];
  const files = [...lines(git(root, "diff", "--name-only", base)), ...lines(git(root, "ls-files", "--others", "--exclude-standard"))];
  return [[...new Set(files)].sort(byText), ""];
}

function checkChanged(root, cfg, base, note) {
  const [files, messages] = changedFiles(root, base);
  const exempt = DOCS_NONE.test(`${messages}\n${note ?? ""}`);
  const out = [];
  for (const s of cfg.surfaces ?? []) {
    const name = s.name || (s.code ?? []).join(", ");
    const skip = [...(cfg.ignore ?? []), ...(s.exclude ?? [])];
    const code = files.filter((f) => matches(f, s.code) && !matches(f, skip));
    if (!code.length) continue;
    const pages = files.filter((f) => matches(f, s.pages));
    const shots = files.filter((f) => matches(f, s.shots));
    const group = s.group ? ` (capture group ${s.group})` : "";
    if (!pages.length && !shots.length) {
      out.push(finding("PARITY_MISSING", exempt ? "info" : "warning", code[0], 0,
        `surface ${name} changed (${code.length} file(s)) but none of its pages (${(s.pages?.length ? s.pages : ["none mapped"]).join(", ")}) `
        + `or shots changed${group}${exempt ? "; a Docs: none line says why" : ""}`));
    } else if (s.shots?.length && !shots.length) {
      out.push(finding("SHOTS_UNCHANGED", "info", code[0], 0, `surface ${name}: pages changed, shots did not; retake${group} if the change shows on screen`));
    }
  }
  return out;
}

/** {image repo path: the commit it was captured from}, from the shots manifest when the harness writes one. */
function shotCommits(root, cfg) {
  const images = cfg.images ?? {};
  const manifest = images.manifest || (images.dir ? `${images.dir.replace(/\/+$/, "")}/shots.json` : null);
  const out = {};
  if (manifest && isFile(path.join(root, manifest))) {
    const shots = JSON.parse(readText(path.join(root, manifest))).shots ?? {};
    for (const [name, entry] of Object.entries(shots)) {
      if (entry?.commit) out[path.posix.join(path.posix.dirname(manifest), name)] = entry.commit;
    }
  }
  return out;
}

function checkStale(root, cfg) {
  const recorded = shotCommits(root, cfg);
  const darkSuffix = cfg.images?.darkSuffix ?? ".dark";
  const tracked = git(root, "ls-files").split("\n").filter(Boolean);
  const out = [], cache = new Map();
  for (const s of cfg.surfaces ?? []) {
    if (!s.shots?.length || !s.code?.length) continue;
    const skip = [...(cfg.ignore ?? []), ...(s.exclude ?? [])];
    const spec = ["--", ...s.code.map((g) => `:(glob)${g}`), ...skip.map((g) => `:(glob,exclude)${g}`)];
    for (const img of tracked.filter((f) => matches(f, s.shots) && IMAGE_EXT.includes(ext(f)))) {
      const base = path.posix.basename(img, path.posix.extname(img));
      const light = base.endsWith(darkSuffix) ? path.posix.join(path.posix.dirname(img), base.slice(0, -darkSuffix.length) + path.posix.extname(img)) : img;
      const sha = recorded[light] || recorded[light.slice(0, light.length - path.posix.extname(light).length)] || git(root, "log", "-1", "--format=%H", "--", img).trim();
      if (!sha) continue;
      const key = `${sha}\0${s.name}`;
      if (!cache.has(key)) {
        try { cache.set(key, git(root, "diff", "--name-only", sha, ...spec).split("\n").filter(Boolean)); } catch { cache.set(key, []); }
      }
      const moved = cache.get(key);
      if (moved.length) {
        out.push(finding("SHOT_STALE", "warning", img, 0, `captured at ${sha.slice(0, 8)}, and ${moved.length} file(s) of surface `
          + `${s.name ?? "?"} changed since (first: ${moved[0]})${s.group ? `; retake capture group ${s.group}` : ""}`));
      }
    }
  }
  return out;
}

// ---- run --------------------------------------------------------------------

/** The report as an object; the command and the Stop hook both call this. */
export function run(root, { changed = null, stale = false, tree = true, note = null, config = null } = {}) {
  const cfg = loadConfig(root, config);
  if (!cfg) return { config: null, mode: [], summary: { critical: 0, warning: 0, info: 0 }, accepted: 0, findings: [] };
  const mode = [];
  let findings = [];
  if (tree) { mode.push("tree"); findings = findings.concat(checkTree(root, cfg)); }
  if (changed) { mode.push("changed"); findings = findings.concat(checkChanged(root, cfg, changed, note)); }
  if (stale) { mode.push("stale"); findings = findings.concat(checkStale(root, cfg)); }
  const accepted = (f) => (cfg.accept ?? []).some((a) => a?.code === f.code && (!a.path || a.path === f.path));
  const kept = findings.filter((f) => !accepted(f))
    .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || byText(a.path, b.path) || a.line - b.line || byText(a.code, b.code));
  const summary = Object.fromEntries(Object.keys(SEVERITY).map((k) => [k, kept.filter((f) => f.severity === k).length]));
  return { config: config ? toPosix(path.normalize(config)) : CONFIG, mode, summary, accepted: findings.length - kept.length, findings: kept };
}

export const exitCode = ({ summary }) => (summary.critical ? 2 : summary.warning ? 1 : 0);

// ---- the command ------------------------------------------------------------

const USAGE = `usage: docs-check.mjs [--root DIR] [--config FILE] [--changed BASE] [--stale] [--no-tree] [--note TEXT] [--json]

  --root DIR      the project root (default: the nearest folder at or above the current one that
                  holds ${CONFIG}, else the git top level, else the current folder)
  --config FILE   the config file (default: <root>/${CONFIG})
  --changed BASE  check parity of files changed since BASE (a ref, or A..B)
  --stale         find shots captured before their surface's code last changed
  --no-tree       skip the tree checks (use with --changed or --stale)
  --note TEXT     text to search for a "Docs: none, <why>" line, such as a pull request body
  --json          print the report as one JSON object`;

const VALUE_FLAGS = ["--root", "--config", "--changed", "--note"];
const PLAIN_FLAGS = ["--stale", "--no-tree", "--json", "--help", "-h"];

/** `--flag value` and `--flag=value`; a value is taken as written, so a note may start with a dash. */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].startsWith("--") ? argv[i].indexOf("=") : -1;
    const name = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    if (VALUE_FLAGS.includes(name)) {
      if (eq === -1 && i + 1 >= argv.length) throw new Error(`${name} needs a value`);
      opts[name.slice(2)] = eq === -1 ? argv[++i] : argv[i].slice(eq + 1);
    } else if (PLAIN_FLAGS.includes(argv[i])) opts[argv[i].replace(/^-+/, "")] = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return opts;
}

function defaultRoot() {
  const cwd = process.cwd();
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (isFile(path.join(dir, CONFIG))) return dir;
    if (path.dirname(dir) === dir) break;
  }
  try { return git(cwd, "rev-parse", "--show-toplevel").trim() || cwd; } catch { return cwd; }
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    console.error(`docs-check: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (opts.help || opts.h) { console.log(USAGE); return 0; }
  let report;
  try {
    report = run(path.resolve(opts.root || defaultRoot()), { changed: opts.changed, stale: Boolean(opts.stale), tree: !opts["no-tree"],
      note: opts.note, config: opts.config });
  } catch (e) {
    console.error(`docs-check: ${e.message}`);
    return 2;
  }
  if (opts.json) console.log(JSON.stringify(report, null, 1));
  else if (!report.config) console.log(`docs-check: no ${CONFIG} here; run /docs-parity:docs-init`);
  else {
    for (const f of report.findings) console.log(`${f.severity.padEnd(8)} ${f.code.padEnd(20)} ${f.path}${f.line ? `:${f.line}` : ""}  ${f.message}`);
    const s = report.summary;
    console.log(`docs-check: ${s.critical} critical, ${s.warning} warning, ${s.info} info${report.accepted ? `, ${report.accepted} accepted` : ""}`);
  }
  return exitCode(report);
}

// Run only as the command; the Stop hook imports run(). Through realpath,
// since a checkout under a linked folder is named two ways.
const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? ""); } catch { return null; } })();
if (invoked === import.meta.filename) process.exitCode = main(process.argv.slice(2));
