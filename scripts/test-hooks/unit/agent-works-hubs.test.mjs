// agent-works scripts/hubs.mjs: the hub contract, the skip marker, what
// verify-hubs.mjs adds in a git repository, and the JSON other plugins read.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { HAS_GIT, codes, common, config, project, script } from "./agent-works-homes.mjs";

const hubs = await script("hubs.mjs");
const NEEDS_GIT = { skip: !HAS_GIT && "needs git" };

const verify = (p, excludes = [], cfg = null) => hubs.verify(p.root, excludes, cfg);

function goodTree(p) {
  p.write("AGENTS.md", "# Root\n\n- `apps/` — the applications\n- `tools/` — scripts\n");
  p.write("apps/AGENTS.md", "# apps\n\n- [web/](web/AGENTS.md) — the site\n- `api/` — the service\n");
  p.write("apps/web/AGENTS.md", "# web\n\n| Path | What |\n|---|---|\n| `src/` | code |\n");
  p.write("apps/web/src/main.ts", "x");
  p.write("apps/api/server.py", "x");
  p.write("tools/run.sh", "x");
}

test("agent-works hubs: a tree without code is clean", (t) => {
  const p = project(t);
  p.write("README.md", "hi");
  assert.deepEqual(verify(p), { findings: [], hubs: 0, claude_chain: false });
});

test("agent-works hubs: a good tree is clean, with list items, links and table rows as child lines", (t) => {
  const p = project(t);
  goodTree(p);
  const res = verify(p);
  assert.deepEqual([codes(res.findings), res.hubs], [[], 3]);
});

test("agent-works hubs: without a root file nothing is critical; with one, code beside a hub is", (t) => {
  const p = project(t);
  p.write("pkg/AGENTS.md", "# pkg\n- `sub/`\n");
  p.write("pkg/loose.py", "x");
  p.write("pkg/sub/a.py", "x");
  const res = verify(p);
  assert.ok(codes(res.findings).some(([code, where]) => code === "HUB_ROOT_MISSING" && where === "."));
  const isolation = (found) => found.filter((f) => f.code === "HUB_ISOLATION").map((f) => [f.path, f.level]);
  assert.deepEqual(isolation(res.findings), [["pkg", "warning"]]);
  p.write("AGENTS.md", "# Root\n- `pkg/`\n");
  assert.deepEqual(isolation(verify(p).findings), [["pkg", "critical"]]);
  assert.equal(common.exitFor(verify(p).findings), 2);
});

test("agent-works hubs: a non-leaf code directory without a hub, and one that mixes loose code with code folders", (t) => {
  const p = project(t);
  p.write("AGENTS.md", "# Root\n- `a/`\n- `b/`\n");
  p.write("a/x/one.py", "x");
  p.write("b/loose.py", "x");
  p.write("b/y/two.py", "x");
  p.write("a/x/__init__.py", "");
  assert.deepEqual(codes(verify(p).findings), [["HUB_MISSING", "a"], ["HUB_MIXED_DIR", "b"]]);
});

test("agent-works hubs: package markers and manifests beside a hub do not break isolation", (t) => {
  const p = project(t);
  p.write("AGENTS.md", "# Root\n- `pkg/`\n");
  p.write("pkg/AGENTS.md", "# pkg\n- `core/`\n");
  p.write("pkg/__init__.py", "");
  p.write("pkg/package.json", "{}");
  p.write("pkg/README.md", "x");
  p.write("pkg/core/a.py", "x");
  assert.deepEqual(codes(verify(p).findings), []);
});

test("agent-works hubs: dot-directories, dependency folders, an archive, the marker's prefixes and --exclude are never walked", (t) => {
  const p = project(t);
  p.write("AGENTS.md", "# Root\n- `src/`\n\n<!-- verify-agents-tree: skip generated/ data/fixtures -->\n");
  p.write("src/a.py", "x");
  for (const skipped of [".agents/plan/plan/verify.py", ".agents/scripts/x/y.py", ".plan/plan/v.py", "node_modules/m/i.js",
    "archive/old/a/b.py", ".hidden/a/b.py", "generated/a/b.py", "data/fixtures/a/b.py", "extra/a/b.py"]) p.write(skipped, "x");
  assert.deepEqual(codes(verify(p).findings), [["HUB_MISSING", "extra"], ["HUB_UNLISTED_CHILD", "AGENTS.md"]]);
  assert.deepEqual(codes(verify(p, ["extra/"]).findings), []);
});

test("agent-works hubs: the root file and a hub have a size budget, and the budgets are settings", (t) => {
  const p = project(t);
  goodTree(p);
  p.write("apps/AGENTS.md", `# apps\n- \`web/\`\n- \`api/\`\n${"line\n".repeat(40)}`);
  p.write("AGENTS.md", `# Root\n- \`apps/\`\n- \`tools/\`\n${"line\n".repeat(200)}`);
  const found = verify(p).findings;
  assert.deepEqual(codes(found), [["HUB_SIZE", "apps/AGENTS.md"], ["ROOT_SIZE", "AGENTS.md"]]);
  assert.ok(found.find((f) => f.code === "HUB_SIZE").message.includes("43 lines, the budget is 40"));
  const roomy = config.merge(config.defaults(), { budgets: { hubLines: 50, rootAgentsLines: 300 } });
  assert.deepEqual(codes(verify(p, [], roomy).findings), []);
});

test("agent-works hubs: a line that leads with a child that is gone, and a code folder no line names", (t) => {
  const p = project(t);
  goodTree(p);
  p.write("apps/AGENTS.md", "# apps\n\n- `web/` — the site\n- `gone/` — was here\n- [old.md](old.md) — a page\n"
    + "- `make build` — a command, not a child\n- `<name>/` and `*.ts` are patterns\n```\n- `fenced/` is an example\n```\n");
  const got = common.sortFindings(verify(p).findings);
  assert.deepEqual(got.map((f) => [f.code, f.path, f.line]),
    [["HUB_STALE_CHILD", "apps/AGENTS.md", 4], ["HUB_STALE_CHILD", "apps/AGENTS.md", 5], ["HUB_UNLISTED_CHILD", "apps/AGENTS.md", 0]]);
  assert.ok(got[0].message.includes("`gone/`"));
  assert.ok(got[2].message.includes("`api/`"));
  // The root file is prose as well as a hub: a bullet that leads with a file name is no child line there, a
  // folder that is gone still is.
  const root = p.read("AGENTS.md");
  p.write("AGENTS.md", `${root}\n- \`INDEX.md\` files are never dated\n- \`vanished/\` — was here\n`);
  const stale = verify(p).findings.filter((f) => f.code === "HUB_STALE_CHILD" && f.path === "AGENTS.md").map((f) => f.message);
  assert.equal(stale.length, 1);
  assert.ok(stale[0].includes("`vanished/`"));
});

test("agent-works hubs: the CLAUDE.md chain is checked only where the root CLAUDE.md imports @AGENTS.md", (t) => {
  const p = project(t);
  goodTree(p);
  p.write("apps/CLAUDE.md", "own words");
  p.write("tools/CLAUDE.md", "@AGENTS.md\n");
  assert.deepEqual(codes(verify(p).findings), []);
  p.write("CLAUDE.md", "@AGENTS.md\n");
  const res = verify(p);
  assert.equal(res.claude_chain, true);
  assert.deepEqual(codes(res.findings), [["CLAUDE_CHAIN", "apps/CLAUDE.md"], ["CLAUDE_CHAIN", "apps/web"], ["CLAUDE_CHAIN", "tools/CLAUDE.md"]]);
});

test("agent-works hubs: a symlink to AGENTS.md is a twin beside a hub, and one at the root opts into nothing", { skip: process.platform === "win32" && "a checkout there holds no symlink" }, async (t) => {
  const fs = await import("node:fs");
  const p = project(t);
  goodTree(p);
  fs.symlinkSync("AGENTS.md", p.at("CLAUDE.md"));
  assert.deepEqual([verify(p).claude_chain, codes(verify(p).findings)], [false, []]);
  fs.rmSync(p.at("CLAUDE.md"));
  p.write("CLAUDE.md", "@AGENTS.md\n");
  for (const dir of ["apps/", "apps/web/"]) fs.symlinkSync("AGENTS.md", p.at(`${dir}CLAUDE.md`));
  assert.deepEqual([verify(p).claude_chain, codes(verify(p).findings)], [true, []]);
  fs.rmSync(p.at("apps/CLAUDE.md"));
  fs.symlinkSync("web/AGENTS.md", p.at("apps/CLAUDE.md"));
  assert.deepEqual(verify(p).findings.map((f) => [f.code, f.path, f.message]), [["CLAUDE_CHAIN", "apps/CLAUDE.md", "must be a symlink to AGENTS.md, or exactly '@AGENTS.md'"]]);
});

test("agent-works hubs: the command other plugins run, `aw hubs . --json`", async (t) => {
  const p = project(t);
  let [code, out, err] = await p.aw("hubs", ".", "--json");
  assert.deepEqual([code, err], [0, ""]);
  let doc = JSON.parse(out);
  assert.deepEqual([doc.summary, doc.findings], [{ critical: 0, warning: 0, info: 0 }, []]);
  assert.deepEqual(Object.keys(doc), ["root", "hubs", "claude_chain", "summary", "findings"]);
  p.write("src/deep/a.py", "x");
  [code, out] = await p.aw("hubs", ".", "--json");
  doc = JSON.parse(out);
  assert.equal(code, 1);
  assert.deepEqual(doc.summary, { critical: 0, warning: 3, info: 0 }); // no root hub; "." and "src" are non-leaf
  assert.deepEqual(Object.keys(doc.findings[0]), ["code", "level", "path", "line", "message"]);
  assert.deepEqual([...new Set(doc.findings.map((f) => f.code))].sort(), ["HUB_MISSING", "HUB_ROOT_MISSING"]);
  p.write("AGENTS.md", "# Root\n- `src/`\n");
  p.write("src/AGENTS.md", "# src\n- `deep/`\n");
  p.write("src/loose.py", "x");
  [code, out] = await p.aw("hubs", ".", "--json");
  assert.deepEqual([code, JSON.parse(out).summary.critical], [2, 1]);
  // without a path the root is found from below
  [code, out] = await p.awIn(p.at("src/deep"), "hubs", "--json", "--exclude", "src");
  assert.deepEqual([code, JSON.parse(out).findings], [0, []]);
  [code, out] = await p.aw("hubs", p.root);
  assert.equal(code, 2);
  assert.ok(out.includes("HUB_ISOLATION"));
  assert.ok(out.trimEnd().endsWith("hubs: 2, CLAUDE.md chain not opted in: 1 critical"), out);
  [code, out, err] = await p.aw("hubs", "no/such/dir");
  assert.deepEqual([code, out], [2, ""]);
  assert.match(err, /^aw hubs: .*no\/such\/dir is not a directory\n$/);
  assert.equal((await p.aw("hubs", "--help"))[0], 0);
  assert.equal((await p.aw("hubs", "--nope"))[0], 2);
});

test("agent-works hubs: --exclude takes every prefix up to the next option", async (t) => {
  const p = project(t);
  p.write("AGENTS.md", "# Root\n");
  p.write("one/a/b.py", "x");
  p.write("two/a/b.py", "x");
  const [code, out] = await p.aw("hubs", "--exclude", "one", "two/", "--json");
  assert.deepEqual([code, JSON.parse(out).findings], [0, []]);
  assert.equal((await p.aw("hubs", "--exclude", "one", "--exclude", "two"))[0], 0);
  assert.equal((await p.aw("hubs", "--exclude", "one"))[0], 1);
});

// ---- in a git repository: what a hub says of its own directory is read by verify-hubs.mjs --------------------

test("agent-works hubs: in a git repository a Layout line is a bullet that opens with the path in a code span", NEEDS_GIT, (t) => {
  const p = project(t, { git: "real" });
  p.write("AGENTS.md", "# Root\n\n- `apps/` - the applications\n- `tools/` - scripts\n");
  p.write("apps/AGENTS.md", "# apps\n\n- `web/` - the site\n- `api/` - the service\n");
  p.write("apps/web/AGENTS.md", "# web\n\n- `src/` - code\n");
  p.write("apps/web/src/main.ts", "x");
  p.write("apps/api/server.py", "x");
  p.write("tools/run.sh", "x");
  assert.deepEqual([codes(verify(p).findings), verify(p).hubs], [[], 3]);
  // A link or a table row names nothing there, and every folder git would commit wants its line, code or not.
  p.write("apps/AGENTS.md", "# apps\n\n- [web/](web/AGENTS.md) - the site\n\n| Path | What |\n|---|---|\n| `api/` | the service |\n");
  p.write("docs/guide.md", "words\n");
  const found = common.sortFindings(verify(p).findings);
  assert.deepEqual(found.map((f) => [f.code, f.level, f.path, f.line]), [
    ["HUB_UNLISTED_CHILD", "warning", "AGENTS.md", 0], ["HUB_UNLISTED_CHILD", "warning", "apps/AGENTS.md", 0],
    ["HUB_UNLISTED_CHILD", "warning", "apps/AGENTS.md", 0],
  ]);
  assert.ok(found[0].message.includes("`docs/`"));
  assert.deepEqual(found.slice(1).map((f) => /`(\w+)\/`/.exec(f.message)[1]).sort(), ["api", "web"]);
});

test("agent-works hubs: in a git repository a stale line carries its line number, and an ignored path is not stale", NEEDS_GIT, (t) => {
  const p = project(t, { git: "real" });
  p.write(".gitignore", "build/\n");
  p.write("AGENTS.md", "# Root\n\n- `src/` - the code\n- `build/` - output, never committed\n- `gone/` - was here\n- `notes.md` - gone too\n");
  p.write("src/a.py", "x");
  const found = common.sortFindings(verify(p).findings);
  assert.deepEqual(found.map((f) => [f.code, f.path, f.line, f.message]), [
    ["HUB_STALE_CHILD", "AGENTS.md", 5, "lists `gone/`, which is not there"], ["HUB_STALE_CHILD", "AGENTS.md", 6, "lists `notes.md`, which is not there"],
  ]);
});

test("agent-works hubs: in a git repository loose code is one HUB_ISOLATION a directory, with the marker's exemptions", NEEDS_GIT, (t) => {
  const p = project(t, { git: "real" });
  p.write("AGENTS.md", "# Root\n\n- `pkg/` - the package\n");
  p.write("pkg/AGENTS.md", "# pkg\n\n- `core/` - the core\n");
  p.write("pkg/one.py", "x");
  p.write("pkg/two.py", "x");
  p.write("pkg/vite.config.ts", "x");
  p.write("pkg/__init__.py", "");
  p.write("pkg/core/a.py", "x");
  let found = verify(p).findings;
  assert.deepEqual(found.map((f) => [f.code, f.level, f.path]), [["HUB_ISOLATION", "critical", "pkg"]]);
  assert.equal(found[0].message, "source files sit directly beside AGENTS.md (one.py, two.py): move the code into sub-directories");
  p.write("AGENTS.md", "# Root\n\n- `pkg/` - the package\n\n<!-- verify-hubs: exempt one.py two.py -->\n");
  assert.deepEqual(verify(p).findings, []);
  // Without a root file the tree is still ramping in: a warning.
  p.remove("AGENTS.md");
  found = verify(p).findings.filter((f) => f.code === "HUB_ISOLATION");
  assert.deepEqual(found.map((f) => [f.level, f.path]), [["warning", "pkg"]]);
});

test("agent-works hubs: in a git repository a CLAUDE.md with content of its own beside a hub is always a finding", NEEDS_GIT, (t) => {
  const p = project(t, { git: "real" });
  p.write("AGENTS.md", "# Root\n\n- `src/` - the code\n");
  p.write("src/AGENTS.md", "# src\n\n- `deep/` - deeper\n");
  p.write("src/deep/a.py", "x");
  p.write("src/CLAUDE.md", "own words\n");
  const res = verify(p);
  assert.equal(res.claude_chain, false);
  assert.deepEqual(res.findings.map((f) => [f.code, f.level, f.path]), [["CLAUDE_CHAIN", "warning", "src/CLAUDE.md"]]);
  assert.ok(res.findings[0].message.startsWith("has content of its own"));
  p.write("src/CLAUDE.md", "@AGENTS.md\n");
  assert.deepEqual(verify(p).findings, []);
});

test("agent-works hubs: in a git repository the skip rules still hold, and a path below the top is read from disk", NEEDS_GIT, async (t) => {
  const p = project(t, { git: "real" });
  p.write("AGENTS.md", "# Root\n\n- `src/` - the code\n- `vendor/` - not ours\n- `extra/` - more\n");
  p.write("src/a.py", "x");
  p.write("vendor/lib/AGENTS.md", "# lib\n");
  p.write("vendor/lib/loose.py", "x");
  p.write("extra/AGENTS.md", "# extra\n");
  p.write("extra/loose.py", "x");
  p.write("extra/sub/a.py", "x");
  assert.deepEqual(codes(verify(p).findings), [["HUB_ISOLATION", "extra"], ["HUB_UNLISTED_CHILD", "extra/AGENTS.md"]]);
  assert.deepEqual(codes(verify(p, ["extra"]).findings), []);
  // `aw hubs extra`: the tree is that folder, which git cannot answer for by itself.
  const [code, out] = await p.aw("hubs", "extra", "--json");
  const doc = JSON.parse(out);
  assert.equal(code, 2);
  assert.equal(doc.root, common.posix(path.join(p.root, "extra")));
  assert.deepEqual(doc.findings.map((f) => [f.code, f.path]), [["HUB_ISOLATION", "."], ["HUB_UNLISTED_CHILD", "AGENTS.md"]]);
});
