// docs-parity's docs-check.mjs: the tree checks per docs target, parity and
// staleness over real git history, and the command's flags, output and exit
// codes. Small throwaway projects; each test builds exactly the docs it needs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONFIG, exitCode, globRe, run } from "../../../plugins/docs-parity/scripts/docs-check.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const CHECK = path.join(REPO, "plugins", "docs-parity", "scripts", "docs-check.mjs");
const PAGE = (t, body) => `---\ntitle: ${t}\ndescription: Do the thing.\ntags: [a, b, c]\n---\n\nThis page explains ${t}. It has a summary.\n\n## Section\n\n${body}\n`;
const codes = (report) => report.findings.map((f) => f.code).sort();

/** A directory with files and, when given, `.agents/docs-parity.json` (an object, or the file's raw text). */
function project(t, files, config) {
  const dir = tempDir(t, "docs-check-");
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  if (config) write(dir, CONFIG, typeof config === "string" ? config : JSON.stringify(config));
  return dir;
}

const SITE = {
  target: "site:fumadocs", docsRoot: "content/docs", nav: "meta.json",
  frontmatter: ["title", "description"], tags: [3, 7],
  roots: [{ name: "guide", path: "guide", deny: ["\\bAPI_KEY\\b"] }, { name: "admin", path: "admin", private: true }],
  images: { dir: "public/images", urlPrefix: "/images/", themes: ["light", "dark"] },
};

const site = (over = {}) => {
  const files = {
    "content/docs/meta.json": JSON.stringify({ pages: ["index", "guide", "admin"] }),
    "content/docs/index.mdx": PAGE("Home", "See [the guide](/guide/start)."),
    "content/docs/guide/meta.json": JSON.stringify({ pages: ["start"] }),
    "content/docs/guide/start.mdx": PAGE("Start", '<Figure src="/images/guide/start.webp" alt="x" />'),
    "content/docs/admin/meta.json": JSON.stringify({ pages: ["deploy"] }),
    "content/docs/admin/deploy.mdx": PAGE("Deploy", "Set `API_KEY`."),
    "public/images/guide/start.webp": "img",
    "public/images/guide/start.dark.webp": "img",
    ...over,
  };
  for (const [k, v] of Object.entries(files)) if (v === null) delete files[k];
  return files;
};

// ---- the tree checks ----------------------------------------------------------

test("a project without the config is silent and clean", (t) => {
  const r = run(project(t, { "docs/a.md": "# A" }));
  assert.deepEqual([r.config, r.findings, exitCode(r)], [null, [], 0]);
});

test("a consistent site is clean", (t) => {
  const r = run(project(t, site(), SITE));
  assert.deepEqual([r.findings, exitCode(r)], [[], 0]);
});

test("an image that is missing, one with no dark twin, and one nobody embeds", (t) => {
  const files = site({
    "public/images/guide/start.dark.webp": null, "public/images/guide/old.webp": "x",
    "content/docs/guide/start.mdx": PAGE("Start", '<Figure src="/images/guide/start.webp" alt="x" />\n\n![gone](/images/guide/gone.webp)'),
  });
  assert.deepEqual(codes(run(project(t, files, SITE))), ["IMAGE_MISSING", "IMAGE_NO_DARK", "IMAGE_ORPHAN"]);
});

test("a single-theme project needs no twin", (t) => {
  const cfg = { ...SITE, images: { dir: "public/images", urlPrefix: "/images/", themes: ["default"] } };
  assert.deepEqual(codes(run(project(t, site({ "public/images/guide/start.dark.webp": null }), cfg))), []);
});

test("a broken link, and a public page linking into the private root, which is critical", (t) => {
  const files = site({ "content/docs/guide/start.mdx": PAGE("Start", '<Figure src="/images/guide/start.webp" alt="x" />\n\n[deploy](/admin/deploy) and [x](/guide/nope)') });
  const r = run(project(t, files, SITE));
  assert.deepEqual([codes(r), exitCode(r)], [["LINK_BROKEN", "ROOT_LEAK"], 2]);
});

test("findings carry the file's own line number", (t) => {
  const r = run(project(t, { "docs/a.md": "---\ntitle: A\n---\n\nSummary.\n\n[x](nope.md)\n" }, { nav: "none" }));
  assert.deepEqual(r.findings.map((f) => [f.code, f.line]), [["LINK_BROKEN", 7]]);
});

test("links and images inside inline code and fenced blocks are ignored", (t) => {
  const body = '<Figure src="/images/guide/start.webp" alt="x" />\n\n`[text](url)`\n\n```md\n![x](/images/none.webp) [y](/nope)\n```';
  assert.deepEqual(codes(run(project(t, site({ "content/docs/guide/start.mdx": PAGE("Start", body) }), SITE))), []);
});

test("meta.json: a listed page that is gone, and pages it does not list; a folder's index is its own page", (t) => {
  const files = site({
    "content/docs/guide/meta.json": JSON.stringify({ pages: ["start", "gone"] }),
    "content/docs/guide/extra.mdx": PAGE("Extra", "x"),
    "content/docs/guide/sub/index.mdx": PAGE("Sub", "x"),
  });
  assert.deepEqual(codes(run(project(t, files, SITE))), ["NAV_DEAD", "NAV_MISSING", "NAV_MISSING"]);
});

test("meta.json: the rest marker lists everything", (t) => {
  const files = site({ "content/docs/guide/meta.json": JSON.stringify({ pages: ["start", "..."] }), "content/docs/guide/extra.mdx": PAGE("Extra", "x") });
  assert.deepEqual(codes(run(project(t, files, SITE))), []);
});

test("meta.json: separators, links, exclusions and extracted folders are not pages to find; a file that does not parse is NAV_INVALID", (t) => {
  const files = {
    "docs/meta.json": "{nope",
    "docs/x/meta.json": JSON.stringify({ pages: ["---Section---", "[Link](https://example.invalid)", "!hidden", "...folder", "one", 3] }),
    "docs/x/one.md": "# One\n\nText.\n", "docs/x/hidden.md": "# Hidden\n\nText.\n", "docs/x/two.mdx": "# Two\n\nText.\n",
    "docs/x/folder/p.md": "# P\n\nText.\n", "docs/x/empty/notes.txt": "x",
  };
  const r = run(project(t, files, { docsRoot: "docs" }));
  assert.deepEqual(r.findings.map((f) => [f.code, f.path]), [["NAV_INVALID", "docs/meta.json"], ["NAV_MISSING", "docs/x/two.mdx"]]);
});

test("frontmatter, tags, summary, budget, and a root's deny pattern", (t) => {
  const files = site({ "content/docs/guide/start.mdx": "---\ntitle: Start\ntags: [a]\n---\n\n## Straight to a heading\n\nSet API_KEY.\n"
    + '<Figure src="/images/guide/start.webp" alt="x" />\n' + "\n".repeat(20) });
  assert.deepEqual(codes(run(project(t, files, { ...SITE, pageBudget: 20 }))),
    ["FRONTMATTER_MISSING", "FRONTMATTER_TAGS", "PAGE_BUDGET", "ROOT_DENY", "SUMMARY_MISSING"]);
});

test("deny patterns skip fenced code, and other roots", (t) => {
  const files = site({ "content/docs/guide/start.mdx": PAGE("Start", '<Figure src="/images/guide/start.webp" alt="x" />\n\n```bash\nexport API_KEY=1\n```') });
  assert.deepEqual(codes(run(project(t, files, SITE))), []);
});

test("a deny pattern written for another regex engine still reads: named groups, \\A and \\Z, a leading (?i)", (t) => {
  const deny = ["(?i)\\bapi_key\\b", "(?P<word>secret)-(?P=word)", "\\AStart here\\Z", "C:\\\\Apps", "\\(?P<x>\\)"];
  const files = { "docs/guide/a.md": "# A\n\nProse first.\n\nSet API_KEY now.\n\nA secret-secret thing.\n\nStart here\n\nDo not Start here again.\n\nOpen C:\\Apps and C:^pps.\n\nWrite (P<x>) there.\n" };
  const r = run(project(t, files, { nav: "none", roots: [{ name: "guide", path: "guide", deny }] }));
  assert.deepEqual(r.findings.map((f) => [f.code, f.line, f.message]),
    [5, 7, 9, 13, 15].map((n, i) => ["ROOT_DENY", n, `the guide root does not allow /${deny[i]}/`]));
});

test("a deny pattern that is no regular expression fails the run with its root's name, exit 2", (t) => {
  const dir = project(t, { "docs/guide/a.md": "# A\n\nText.\n" }, { nav: "none", roots: [{ name: "guide", path: "guide", deny: ["(unclosed"] }] });
  assert.throws(() => run(dir), /guide root's deny pattern/);
  const r = runNode(CHECK, ["--root", dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^docs-check: the guide root's deny pattern/);
});

test("accept drops a finding and counts it; with a path it drops only that file's", (t) => {
  const cfg = { ...SITE, accept: [{ code: "IMAGE_ORPHAN", why: "kept for the changelog" }] };
  const r = run(project(t, site({ "public/images/guide/old.webp": "x" }), cfg));
  assert.deepEqual([codes(r), r.accepted], [[], 1]);
  const two = { "docs/a.md": "# A\n\nText [x](gone.md).\n", "docs/b.md": "# B\n\nText [x](gone.md).\n" };
  const byPath = run(project(t, two, { nav: "none", accept: [{ code: "LINK_BROKEN", path: "docs/a.md" }] }));
  assert.deepEqual([byPath.findings.map((f) => f.path), byPath.accepted], [["docs/b.md"], 1]);
});

test("mkdocs: the nav names a missing page and misses a real one", (t) => {
  const files = { "mkdocs.yml": "site_name: x\nnav:\n  - Home: index.md\n  - Gone: gone.md\ntheme: material\n",
    "docs/index.md": "# Home\n\nWhat this is.\n", "docs/extra.md": "# Extra\n\nMore.\n" };
  assert.deepEqual(codes(run(project(t, files, { docsRoot: "docs" }))), ["NAV_DEAD", "NAV_MISSING"]);
});

test("mkdocs without a nav key is file-ordered", (t) => {
  assert.deepEqual(codes(run(project(t, { "mkdocs.yml": "site_name: x\n", "docs/index.md": "# Home\n\nWhat this is.\n" }, { docsRoot: "docs" }))), []);
});

test("mkdocs: a page whose name is not ASCII is still a nav entry", (t) => {
  const files = { "mkdocs.yml": "nav:\n  - Home: index.md\n  - Café: café.md\n", "docs/index.md": "# Home\n\nWhat this is.\n", "docs/café.md": "# Café\n\nOpen late.\n" };
  assert.deepEqual(codes(run(project(t, files, { docsRoot: "docs" }))), []);
});

test("mdBook: SUMMARY.md misses a page", (t) => {
  const files = { "src/SUMMARY.md": "# Summary\n\n- [Intro](intro.md)\n", "src/intro.md": "# Intro\n\nHello.\n", "src/other.md": "# Other\n\nHi.\n" };
  assert.deepEqual(codes(run(project(t, files, { docsRoot: "src", nav: "auto" }))), ["NAV_MISSING"]);
});

test("a plain docs/ folder: relative links, and <picture> naming its dark source", (t) => {
  const page = '# Export\n\nHow to export.\n\n<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="images/menu.dark.png">\n'
    + '  <img src="images/menu.png" alt="menu">\n</picture>\n\nSee [importing](importing.md) and [home](./).\n';
  const files = { "docs/README.md": "# Docs\n\nThe user docs.\n\n- [Export](export.md)\n", "docs/export.md": page,
    "docs/importing.md": "# Import\n\nHow to import.\n", "docs/images/menu.png": "x", "docs/images/menu.dark.png": "x" };
  assert.deepEqual(codes(run(project(t, files, { docsRoot: "docs", nav: "none", images: { dir: "docs/images", themes: ["light", "dark"] } }))), []);
});

test("a GitHub wiki: pages link by name from any folder, and the sidebar is the nav", (t) => {
  const files = { "wiki/Home.md": "# Home\n\nWelcome. See [[Getting Started]] and [[the API|API-Reference]].\n",
    "wiki/_Sidebar.md": "- [[Getting Started]]\n- [[API-Reference]]\n- [[Missing Page]]\n",
    "wiki/guides/Getting-Started.md": "# Getting started\n\nStart here. Then [ref](API-Reference).\n",
    "wiki/API-Reference.md": "# API\n\nThe calls.\n", "wiki/Orphan.md": "# Orphan\n\nAlone.\n" };
  const r = run(project(t, files, { target: "wiki:github", docsRoot: "wiki", nav: "sidebar" }));
  assert.deepEqual(r.findings.map((f) => [f.code, f.path]), [["NAV_MISSING", "wiki/Orphan.md"], ["NAV_DEAD", "wiki/_Sidebar.md"]]);
});

test("a GitLab wiki: the lowercase sidebar is found, and it links pages the markdown way", (t) => {
  const files = { "w/Home.md": "# Home\n\nHi [[Page|Other Text]] and [[Nope]].\n", "w/_sidebar.md": "- [P](Page)\n- [Q](Quux.md#x)\n- [e](https://example.invalid)\n",
    "w/Page.md": "# Page\n\nText.\n", "w/sub/Deep.md": "# Deep\n\n[home](Home) [up](../Page.md) [bad](sub/Nope)\n" };
  const r = run(project(t, files, { target: "wiki:gitlab", docsRoot: "w" }));
  assert.deepEqual(r.findings.map((f) => `${f.code} ${f.path}:${f.line} ${f.message}`), [
    "LINK_BROKEN w/Home.md:3 [[Nope]] resolves to no page",
    "NAV_DEAD w/_sidebar.md:0 links Quux.md#x, which is not a page",
    "NAV_MISSING w/sub/Deep.md:0 not linked from w/_sidebar.md",
    "LINK_BROKEN w/sub/Deep.md:3 sub/Nope resolves to no page",
  ]);
});

test("README-only reads just the README", (t) => {
  const files = { "README.md": "# Tool\n\nIt does a thing.\n\n![demo](docs/demo.png)\n", "docs/demo.png": "x", "AGENTS.md": "[broken](nowhere.md)\n" };
  assert.deepEqual(codes(run(project(t, files, { target: "readme", docsRoot: ".", include: ["README.md"], nav: "none" }))), []);
});

test("a docsRoot that does not exist is critical", (t) => {
  const r = run(project(t, { "a.md": "x" }, { docsRoot: "nowhere" }));
  assert.deepEqual([r.findings.map((f) => [f.code, f.path]), exitCode(r)], [[["DOCS_ROOT_MISSING", "nowhere"]], 2]);
});

test("linkBase strips the site's base path from a link, and siteRoot is where a root-relative image lives", (t) => {
  const files = { "site/content/a.md": "# A\n\nSee [b](/docs/b) and [c](/docs/c) and ![i](/img/i.png).\n", "site/content/b.md": "# B\n\nText.\n", "site/public/img/i.png": "x" };
  const r = run(project(t, files, { docsRoot: "site/content", linkBase: "/docs/", siteRoot: "site/public", nav: "none" }));
  assert.deepEqual(r.findings.map((f) => f.message), ["/docs/c resolves to no page"]);
});

test("a byte-order mark and CRLF line endings change nothing, line numbers included", (t) => {
  const files = { "docs/a.md": "\uFEFF---\r\ntitle: A\r\n---\r\n\r\nSummary line.\r\n\r\n[x](nope.md)\r\n", "docs/meta.json": `\uFEFF${JSON.stringify({ pages: ["a", "b"] })}` };
  const r = run(project(t, files, `\uFEFF${JSON.stringify({ frontmatter: ["title", "description"] })}`));
  assert.deepEqual(r.findings.map((f) => [f.code, f.path, f.line]),
    [["FRONTMATTER_MISSING", "docs/a.md", 1], ["LINK_BROKEN", "docs/a.md", 7], ["NAV_DEAD", "docs/meta.json", 0]]);
});

test("findings sort by severity, then path as plain text, then line, then code", (t) => {
  const files = { "docs/a-b/c.md": "## x\n", "docs/a/b.md": "## x\n", "docs/B.md": "## x\n\n[x](/admin/p)\n", "docs/a.md": "## x\n", "docs/admin/p.md": "# P\n\nText.\n" };
  const r = run(project(t, files, { nav: "none", roots: [{ name: "admin", path: "admin", private: true }] }));
  assert.deepEqual(r.findings.map((f) => `${f.severity} ${f.path}:${f.line} ${f.code}`), [
    "critical docs/B.md:3 ROOT_LEAK",
    "warning docs/B.md:1 SUMMARY_MISSING",
    "warning docs/a-b/c.md:1 SUMMARY_MISSING",
    "warning docs/a.md:1 SUMMARY_MISSING",
    "warning docs/a/b.md:1 SUMMARY_MISSING",
  ]);
});

test("a linked page is a page, named where the file really is; a linked folder is not entered", { skip: process.platform === "win32" && "symlinks need a privilege on Windows" }, (t) => {
  const dir = project(t, { "docs/real.md": "# Real\n\nText.\n", "other/shared.md": "## no summary\n", "other/deep/x.md": "## no summary\n" }, { nav: "none" });
  fs.symlinkSync(path.join("..", "other", "shared.md"), path.join(dir, "docs", "shared.md"));
  fs.symlinkSync(path.join("..", "other", "deep"), path.join(dir, "docs", "deep"));
  assert.deepEqual(run(dir).findings.map((f) => f.path), ["other/shared.md"]);
});

test("a glob: ** crosses folders, including none; * and ? stay inside one", () => {
  assert.ok(globRe("src/**").test("src/a/b.py"));
  assert.ok(globRe("**/tests/**").test("tests/a.py"));
  assert.ok(globRe("**/*.test.*").test("a.test.js"));
  assert.ok(!globRe("src/*.py").test("src/a/b.py"));
  assert.ok(globRe("docs/?.md").test("docs/a.md"));
  assert.ok(!globRe("docs/a.md").test("docs/aXmd"));
});

// ---- parity and staleness over real history -------------------------------------

const SURFACES = {
  docsRoot: "docs", nav: "none", images: { dir: "docs/images" },
  surfaces: [{ name: "export", code: ["src/export/**"], pages: ["docs/export.md"], shots: ["docs/images/export/**"], group: "export" }],
};

function history(t, files, config = SURFACES) {
  const { dir, git } = tempRepo(t, "docs-history-");
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  write(dir, CONFIG, JSON.stringify(config));
  const commit = (message) => { git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message); return git("rev-parse", "HEAD"); };
  commit("initial");
  return { dir, git, commit };
}

const exportRepo = (t) => history(t, { "src/export/menu.py": "a = 1\n", "src/other.py": "b = 1\n",
  "docs/export.md": "# Export\n\nHow.\n\n![m](images/export/menu.png)\n", "docs/images/export/menu.png": "v1" });

test("code without docs is PARITY_MISSING, naming the pages and the capture group", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const r = run(dir, { changed: "HEAD", tree: false });
  assert.deepEqual(r.findings, [{ code: "PARITY_MISSING", severity: "warning", path: "src/export/menu.py", line: 0,
    message: "surface export changed (1 file(s)) but none of its pages (docs/export.md) or shots changed (capture group export)" }]);
  assert.deepEqual(r.mode, ["changed"]);
});

test("untracked code counts as changed", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/new.py", "c = 1\n");
  assert.deepEqual(codes(run(dir, { changed: "HEAD", tree: false })), ["PARITY_MISSING"]);
});

test("code outside every surface, and tests inside one, are quiet", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/other.py", "b = 2\n");
  write(dir, "src/export/tests/test_menu.py", "x = 1\n");
  assert.deepEqual(codes(run(dir, { changed: "HEAD", tree: false })), []);
});

test("pages without shots is an info reminder, exit 0", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  write(dir, "docs/export.md", "# Export\n\nHow, now.\n\n![m](images/export/menu.png)\n");
  const r = run(dir, { changed: "HEAD", tree: false });
  assert.deepEqual([codes(r), exitCode(r)], [["SHOTS_UNCHANGED"], 0]);
});

test("a range with a Docs: none line stands down to info", (t) => {
  const { dir, git, commit } = exportRepo(t);
  const base = git("rev-parse", "HEAD");
  write(dir, "src/export/menu.py", "a = 3\n");
  commit("refactor export\n\nDocs: none, internal rename only.");
  assert.deepEqual(run(dir, { changed: `${base}..HEAD`, tree: false }).findings.map((f) => [f.code, f.severity]), [["PARITY_MISSING", "info"]]);
});

test("a note, such as a pull request body, stands down too", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  assert.equal(run(dir, { changed: "HEAD", tree: false, note: "Docs: n/a, no visible change" }).findings[0].severity, "info");
});

test("a surface with no name is called by its code globs, and one with no pages says none are mapped", (t) => {
  const { dir } = history(t, { "src/a/x.py": "1\n", "docs/a.md": "# A\n\nText.\n" },
    { nav: "none", surfaces: [{ code: ["src/a/**"], pages: [] }, { name: "", code: ["src/**"], exclude: ["src/a/**"] }] });
  write(dir, "src/a/x.py", "2\n");
  write(dir, "src/b.py", "1\n");
  assert.deepEqual(run(dir, { changed: "HEAD", tree: false }).findings.map((f) => f.message), [
    "surface src/a/** changed (1 file(s)) but none of its pages (none mapped) or shots changed",
    "surface src/** changed (1 file(s)) but none of its pages (none mapped) or shots changed",
  ]);
});

test("a fresh shot is not stale", (t) => {
  assert.deepEqual(codes(run(exportRepo(t).dir, { stale: true, tree: false })), []);
});

test("code changed after the shot was taken is SHOT_STALE, for the dark twin too", (t) => {
  const { dir, commit } = exportRepo(t);
  write(dir, "docs/images/export/menu.dark.png", "d1");
  commit("the dark twin");
  write(dir, "src/export/menu.py", "a = 2\n");
  const sha = commit("change the menu");
  const r = run(dir, { stale: true, tree: false });
  assert.deepEqual(r.findings.map((f) => [f.code, f.path]), [["SHOT_STALE", "docs/images/export/menu.dark.png"], ["SHOT_STALE", "docs/images/export/menu.png"]]);
  assert.match(r.findings[0].message, /^captured at [0-9a-f]{8}, and 1 file\(s\) of surface export changed since \(first: src\/export\/menu\.py\); retake capture group export$/);
  assert.ok(!r.findings[0].message.includes(sha.slice(0, 8)), "the capture commit, not the code's");
});

test("the shots manifest records a retake that produced identical bytes", (t) => {
  const { dir, commit } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const sha = commit("change the menu");
  write(dir, "docs/images/shots.json", JSON.stringify({ shots: { "export/menu.png": { commit: sha } } }));
  commit("retake: same pixels");
  assert.deepEqual(codes(run(dir, { stale: true, tree: false })), []);
});

// ---- the command ----------------------------------------------------------------

test("the command prints one line a finding, then a summary, and exits 1 on a warning", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const r = runNode(CHECK, ["--root", dir, "--changed", "HEAD", "--no-tree"]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "warning  PARITY_MISSING       src/export/menu.py  surface export changed (1 file(s)) but none of its pages (docs/export.md) or shots changed (capture group export)\n"
    + "docs-check: 0 critical, 1 warning, 0 info\n");
});

test("the command exits 2 on a critical finding and 0 when only info remains, counting what was accepted", (t) => {
  const leak = site({ "content/docs/guide/start.mdx": PAGE("Start", '<Figure src="/images/guide/start.webp" alt="x" />\n\n[deploy](/admin/deploy)') });
  const critical = runNode(CHECK, ["--root", project(t, leak, SITE)]);
  assert.equal(critical.status, 2);
  assert.match(critical.stdout, /^critical ROOT_LEAK {12}content\/docs\/guide\/start\.mdx:13 {2}a public page links into the private admin root: \/admin\/deploy$/m);
  const accepted = runNode(CHECK, ["--root", project(t, site({ "public/images/guide/old.webp": "x" }), { ...SITE, accept: [{ code: "IMAGE_ORPHAN", why: "kept" }] })]);
  assert.deepEqual([accepted.status, accepted.stdout], [0, "docs-check: 0 critical, 0 warning, 0 info, 1 accepted\n"]);
});

test("--json prints the report as one object", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const r = runNode(CHECK, ["--root", dir, "--changed", "HEAD", "--json"]);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(report), ["config", "mode", "summary", "accepted", "findings"]);
  assert.deepEqual([report.config, report.mode, report.summary, report.accepted], [CONFIG, ["tree", "changed"], { critical: 0, warning: 1, info: 0 }, 0]);
  assert.deepEqual(Object.keys(report.findings[0]), ["code", "severity", "path", "line", "message"]);
});

test("a project without the config prints one line and exits 0", (t) => {
  const r = runNode(CHECK, ["--root", project(t, { "docs/a.md": "# A" })]);
  assert.deepEqual([r.status, r.stdout], [0, `docs-check: no ${CONFIG} here; run /docs-parity:docs-init\n`]);
});

test("a value follows its flag or an equals sign, and a note may start with a dash", (t) => {
  const { dir } = exportRepo(t);
  write(dir, "src/export/menu.py", "a = 2\n");
  const spaced = runNode(CHECK, ["--root", dir, "--changed", "HEAD", "--no-tree", "--note", "- a bullet first\nDocs: none, nothing a reader sees"]);
  assert.deepEqual([spaced.status, spaced.stdout.includes("a Docs: none line says why")], [0, true]);
  const joined = runNode(CHECK, [`--root=${dir}`, "--changed=HEAD", "--no-tree", "--note=Docs: none"]);
  assert.equal(joined.stdout, spaced.stdout);
});

test("an argument the command does not know, or a flag with no value, is exit 2 with the usage", (t) => {
  const dir = project(t, { "docs/a.md": "# A\n\nText.\n" }, {});
  for (const args of [["--nope"], ["--root", dir, "--changed"], ["extra"]]) {
    const r = runNode(CHECK, args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /^docs-check: .+\nusage: docs-check\.mjs /, args.join(" "));
    assert.equal(r.stdout, "");
  }
});

test("a config that does not parse, a ref git does not know, and a folder that is no repo are errors: exit 2, one line", (t) => {
  const broken = runNode(CHECK, ["--root", project(t, { "docs/a.md": "# A\n\nText.\n" }, "{nope")]);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /^docs-check: \.agents\/docs-parity\.json does not parse/);
  const { dir } = exportRepo(t);
  const ref = runNode(CHECK, ["--root", dir, "--changed", "nope..HEAD", "--no-tree"]);
  assert.deepEqual([ref.status, ref.stdout, ref.stderr.startsWith("docs-check: ")], [2, "", true]);
  const plain = runNode(CHECK, ["--root", project(t, { "docs/a.md": "# A\n\nText.\n" }, SURFACES), "--changed", "HEAD", "--no-tree"]);
  assert.deepEqual([plain.status, plain.stderr.startsWith("docs-check: ")], [2, true]);
});

test("--config reads a config from elsewhere and names it in the report", (t) => {
  const dir = project(t, { "docs/a.md": "## no summary\n", "elsewhere/parity.json": JSON.stringify({ nav: "none", summary: false }) });
  const r = runNode(CHECK, ["--root", dir, "--config", path.join(dir, "elsewhere", "parity.json"), "--json"]);
  const report = JSON.parse(r.stdout);
  assert.deepEqual([r.status, report.findings, report.config.endsWith("elsewhere/parity.json")], [0, [], true]);
});

test("with no --root the project is the nearest folder holding the config, from the folder itself or from inside it", (t) => {
  const { dir } = tempRepo(t, "docs-nested-");
  write(dir, "packages/app/.agents/docs-parity.json", JSON.stringify({ nav: "none" }));
  write(dir, "packages/app/docs/a.md", "## no summary\n");
  write(dir, "packages/app/src/deep/x.py", "1\n");
  for (const cwd of [path.join(dir, "packages", "app"), path.join(dir, "packages", "app", "src", "deep")]) {
    const r = runNode(CHECK, [], { cwd });
    assert.deepEqual([r.status, r.stdout.split("\n")[0]], [1, "warning  SUMMARY_MISSING      docs/a.md:1  the page does not open with a summary paragraph"], cwd);
  }
  const top = runNode(CHECK, [], { cwd: dir });
  assert.match(top.stdout, /^docs-check: no \.agents\/docs-parity\.json here/);
});

test("a copy in a repository runs by itself: the file imports nothing of the plugin's", (t) => {
  const { dir } = exportRepo(t);
  const copy = write(dir, ".agents/scripts/docs-check.mjs", fs.readFileSync(CHECK, "utf8"));
  write(dir, "src/export/menu.py", "a = 2\n");
  const r = runNode(copy, ["--changed", "HEAD", "--no-tree"], { cwd: path.join(dir, "src") });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /PARITY_MISSING/);
  const imports = [...fs.readFileSync(CHECK, "utf8").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["node:child_process", "node:fs", "node:path"]);
});

test("a config written before 1.0 reads unchanged: the template the first release shipped", (t) => {
  const first = {
    target: "docs-folder", docsRoot: "docs", nav: "auto", frontmatter: ["title", "description"], summary: true, pageBudget: 120,
    roots: [
      { name: "guide", path: "guide", deny: ["`[^`]*/[^`]*\\.(ts|tsx|js|py|rs|cpp|h|go)`", "\\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\\b"] },
      { name: "developers", path: "developers" }, { name: "admin", path: "admin", private: true },
    ],
    images: { dir: "docs/images", themes: ["light", "dark"] },
    capture: "npm run capture -- {group}",
    surfaces: [{ name: "export", code: ["src/export/**"], pages: ["docs/guide/export.md"], shots: ["docs/images/export/**"], group: "export" }],
    accept: [],
  };
  const files = {
    "docs/guide/export.md": "---\ntitle: Export\ndescription: Export a file.\n---\n\nHow to export. Set `src/export/menu.ts` aside and EXPORT_DIR too.\n\n![menu](../images/export/menu.png)\n\nAsk [your admin](../admin/deploy.md).\n",
    "docs/admin/deploy.md": "---\ntitle: Deploy\ndescription: Deploy it.\n---\n\nSet EXPORT_DIR.\n",
    "docs/images/export/menu.png": "x",
  };
  const r = run(project(t, files, first));
  assert.deepEqual(r.findings.map((f) => `${f.severity} ${f.code} ${f.path}:${f.line}`), [
    "critical ROOT_LEAK docs/guide/export.md:10",
    "warning ROOT_DENY docs/guide/export.md:6",
    "warning ROOT_DENY docs/guide/export.md:6",
    "warning IMAGE_NO_DARK docs/guide/export.md:8",
  ]);
});
