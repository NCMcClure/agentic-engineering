// marvelous-miro's system map: annotations to a committed map, the import
// cross-check, the waiver, the publish gate, the generator's layout, and the
// script run as the plugin runs it (from its own directory, against --root)
// and as a repo's CI runs a copy. Small throwaway repos; each test writes
// exactly the modules it needs. Nothing here reaches Miro.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONFIG as CONFIG_PATH, exitCode, extract, generate, publishBlocker, run } from "../../../plugins/marvelous-miro/scripts/system-map.mjs";
import { lint, predictedModel } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/lint.mjs";
import { sceneFrame, sceneItems } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/miro.mjs";
import { kit as miroKit } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/scene-kit.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "marvelous-miro");
const CHECK = path.join(PLUGIN, "scripts", "system-map.mjs");
const BOARD = "https://miro.com/app/board/uXjTEST=/";
const codes = (report) => report.findings.map((f) => f.code).sort();

const MODULES = {
  "src/intake/index.mjs": [
    "// @system node intake \"Intake\" layer=service",
    "// @system calls queue \"hands on approved request\"",
    "// @system calls ext:tracker \"files the request as an issue\"",
    "// @system exposes take \"takes one request\"",
    "import { push } from \"../queue/index.mjs\";",
    "export const take = (r) => push(r);",
  ].join("\n"),
  "src/queue/index.mjs": "// @system node queue \"Queue\" layer=service\n// @system exposes push \"queues one request\"\nexport const push = (r) => r;\n",
  "web/portal/app.mjs": "// @system node portal \"Requester portal\" layer=surface\n// @system calls intake \"submits a request\"\nimport { take } from \"../../src/intake/index.mjs\";\n",
};
const CONFIG = { title: "Fixture system", externals: { tracker: "Tracker" } };

/** A git repo with the given files, the config (unless null), and, when asked, a map written and committed. */
function project(t, files = MODULES, { config = CONFIG, commitMap = true } = {}) {
  const { dir, git } = tempRepo(t, "system-map-");
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  if (config) write(dir, ".agents/system-map.json", JSON.stringify(config, null, 2) + "\n");
  if (config && commitMap) run(dir, { write: true });
  git("add", "-A");
  git("commit", "-m", "fixture");
  return { dir, git };
}

// ---- extraction ---------------------------------------------------------------

test("a repo without the config is silent and clean", (t) => {
  const { dir } = project(t, MODULES, { config: null });
  const r = run(dir);
  assert.deepEqual([r.config, r.findings, exitCode(r)], [null, [], 0]);
});

test("annotations become a sorted map of nodes, externals, and edges", (t) => {
  const { dir } = project(t);
  const map = extract(dir).map;
  assert.deepEqual(map.nodes.map((n) => [n.id, n.layer, n.path]), [
    ["portal", "surface", "web/portal"], ["intake", "service", "src/intake"], ["queue", "service", "src/queue"],
    ["ext:tracker", "external", null]]);
  assert.deepEqual(map.edges.map((e) => `${e.from}>${e.to}`), ["intake>ext:tracker", "intake>queue", "portal>intake"]);
});

test("the written map is byte-stable across runs and the fresh repo is clean", (t) => {
  const { dir } = project(t);
  const before = fs.readFileSync(path.join(dir, "diagrams/system-map.json"), "utf8");
  run(dir, { write: true });
  assert.equal(fs.readFileSync(path.join(dir, "diagrams/system-map.json"), "utf8"), before);
  assert.deepEqual(codes(run(dir)), []);
});

test("grammar examples in markdown, under .agents, and in tests are not annotations", (t) => {
  const files = { ...MODULES, "docs/how.md": "// @system node fake \"Fake\" layer=service\n",
    ".agents/rules/x.md": "// @system node fake2 \"F\" layer=service\n", "src/queue/queue.test.mjs": "// @system node fake3 \"F\" layer=service\n" };
  const { dir } = project(t, files);
  assert.equal(extract(dir).map.nodes.some((n) => n.id.startsWith("fake")), false);
});

// ---- findings -----------------------------------------------------------------

test("a code change the map does not show is MAP_STALE, and a missing map is MAP_MISSING", (t) => {
  const { dir } = project(t);
  write(dir, "src/queue/index.mjs", "// @system node queue \"Work queue\" layer=service\n");
  assert.deepEqual(codes(run(dir)), ["MAP_STALE"]);
  fs.rmSync(path.join(dir, "diagrams/system-map.json"));
  assert.deepEqual(codes(run(dir)), ["MAP_MISSING"]);
});

test("a cross-module import with no calls line is UNDECLARED_IMPORT, with its file and line", (t) => {
  const files = { ...MODULES, "src/queue/index.mjs": "// @system node queue \"Queue\" layer=service\nimport x from \"../intake/index.mjs\";\n" };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path, f.line]), [["UNDECLARED_IMPORT", "src/queue/index.mjs", 2]]);
  assert.equal(exitCode(r), 1);
});

test("imports inside one module, of packages, and of files no node owns never count as imports", (t) => {
  const files = { ...MODULES, "src/queue/store.mjs": "import fs from \"node:fs\";\nimport { push } from \"./index.mjs\";\nimport y from \"../../lib/util.mjs\";\n",
    "lib/util.mjs": "export default 1;\n" };
  assert.deepEqual(codes(run(project(t, files).dir)), ["NODE_MISSING"]); // lib/ itself is the finding, not the import
});

test("python imports, relative and absolute, are cross-checked too", (t) => {
  const files = {
    "svc/a/__init__.py": "# @system node a \"A\" layer=service\nfrom svc.b import thing\nimport os\n",
    "svc/b/__init__.py": "# @system node b \"B\" layer=service\nfrom ..a import other\n",
  };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path]), [["UNDECLARED_IMPORT", "svc/a/__init__.py"], ["UNDECLARED_IMPORT", "svc/b/__init__.py"]]);
});

test("a missing target, a duplicate id, an unknown layer, an orphan calls line, and a bad line; the unowned dirs they leave are NODE_MISSING", (t) => {
  const files = {
    "a/x.mjs": "// @system node a \"A\" layer=service\n// @system calls nowhere \"x\"\n",
    "b/x.mjs": "// @system node a \"Again\" layer=service\n",
    "c/x.mjs": "// @system node c \"C\" layer=galaxy\n",
    "d/x.mjs": "// @system calls a \"no node owns me\"\n",
    "e/x.mjs": "// @system node\n",
  };
  const { dir } = project(t, files, { commitMap: false });
  assert.deepEqual(codes(run(dir, { write: true })), ["CALLS_ORPHAN", "LAYER_UNKNOWN", "NODE_DUPLICATE", "NODE_MISSING", "NODE_MISSING", "NODE_MISSING", "PARSE", "TARGET_MISSING"]);
});

test("a file without its own node belongs to the nearest ancestor's", (t) => {
  const files = { ...MODULES, "src/intake/deep/worker.mjs": "// @system calls queue \"retries\"\nimport { push } from \"../../queue/index.mjs\";\n" };
  const { dir } = project(t, files);
  assert.deepEqual(codes(run(dir)), []);
  assert.ok(extract(dir).map.edges.some((e) => e.from === "intake" && e.label === "retries"));
});

// ---- scripts run as child processes ----------------------------------------------

const RUNNER = (call) => `// @system node a "A" layer=service\nimport { execFileSync } from "node:child_process";\nimport path from "node:path";\n${call}\n`;
const TARGET = { "tools/b/x.mjs": "// @system node b \"B\" layer=runtime\nexport {};\n" };

test("a repo script run through path.join from the file's own directory is UNDECLARED_RUN, with its line", (t) => {
  const files = { ...TARGET, "src/a/run.mjs": RUNNER('execFileSync(process.execPath, [path.join(import.meta.dirname, "..", "..", "tools", "b", "x.mjs")]);') };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path, f.line]), [["UNDECLARED_RUN", "src/a/run.mjs", 4]]);
});

test("a root-relative path, held in a variable first, counts too, and a calls line clears it", (t) => {
  const call = 'const script = path.join(root, "tools", "b", "x.mjs");\nexecFileSync(process.execPath, [script]);';
  assert.deepEqual(codes(run(project(t, { ...TARGET, "src/a/run.mjs": RUNNER(call) }).dir)), ["UNDECLARED_RUN"]);
  const declared = RUNNER(call).replace("layer=service\n", "layer=service\n// @system calls b \"runs x\"\n");
  assert.deepEqual(codes(run(project(t, { ...TARGET, "src/a/run.mjs": declared }).dir)), []);
});

test("a node command in CI YAML is a run, and a path in a file that never spawns is not", (t) => {
  const files = { ...TARGET, "ci/gate.yml": "# @system node a \"Gate\" layer=runtime\njob:\n  script:\n    - node tools/b/x.mjs --check\n",
    "src/c/notes.mjs": '// @system node c "C" layer=service\nconst where = "tools/b/x.mjs";\n' };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path, f.line]), [["UNDECLARED_RUN", "ci/gate.yml", 4]]);
});

test("in a file that spawns, a quoted path counts inside a spawn call, not as data in a table", (t) => {
  const files = { ...TARGET, "src/a/run.mjs": RUNNER('const COPIES = ["tools/b/x.mjs"];\nspawnSync(process.execPath, ["tools/b/x.mjs", "--check"]);') };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.line]), [["UNDECLARED_RUN", 5]]);
});

// ---- config nodes and the .agents default ----------------------------------------

test("config nodes stand in for what cannot carry a comment: they own their path and declare calls", (t) => {
  const cfg = { ...CONFIG, nodes: {
    hosts: { title: "Agent hosts", layer: "people", calls: [{ to: "catalog", label: "installs from" }] },
    catalog: { title: "Catalog", layer: "surface", path: "catalog" } } };
  const files = { ...MODULES, "catalog/x.mjs": "import x from \"../src/queue/index.mjs\";\n" };
  const { dir } = project(t, files, { config: cfg });
  const map = extract(dir).map;
  assert.deepEqual(map.nodes.slice(0, 2).map((n) => [n.id, n.layer, n.path]), [["hosts", "people", null], ["catalog", "surface", "catalog"]]);
  assert.ok(map.edges.some((e) => e.from === "hosts" && e.to === "catalog"));
  assert.deepEqual(run(dir).findings.map((f) => [f.code, f.path]), [["UNDECLARED_IMPORT", "catalog/x.mjs"]]);
});

test("a config node calling nothing known is TARGET_MISSING, pointed at the config", (t) => {
  const cfg = { ...CONFIG, nodes: { hosts: { title: "H", layer: "people", calls: [{ to: "nowhere", label: "x" }] } } };
  const { dir } = project(t, MODULES, { config: cfg, commitMap: false });
  assert.deepEqual(run(dir, { write: true }).findings.map((f) => [f.code, f.path]), [["TARGET_MISSING", ".agents/system-map.json"]]);
});

test(".agents is skipped by default, and a repo whose config sets its own exclude can annotate it", (t) => {
  const files = { ...MODULES, ".agents/scripts/verify.mjs": "// @system node verifiers \"Verifiers\" layer=runtime\n" };
  assert.equal(extract(project(t, files).dir).map.nodes.some((n) => n.id === "verifiers"), false);
  assert.equal(extract(project(t, files, { config: { ...CONFIG, exclude: [] } }).dir).map.nodes.some((n) => n.id === "verifiers"), true);
});

test("the board's own project is never a module: diagrams/ and a miro.config.mjs at the root are left out", (t) => {
  const files = { ...MODULES, "miro.config.mjs": "export default { board: null, views: [] };\n",
    "diagrams/src/gen-system.mjs": "export default (kit) => kit.systemMap(\"x\");\n", "diagrams/miro.config.mjs": "export default {};\n" };
  assert.deepEqual(codes(run(project(t, files).dir)), []);
  // Any other source file at the root still has to belong to something.
  assert.deepEqual(run(project(t, { ...files, "build.config.mjs": "export default {};\n" }).dir).findings.map((f) => [f.code, f.path]), [["NODE_MISSING", "."]]);
});

// ---- every module is a node ---------------------------------------------------------

test("a directory of source files no node owns is NODE_MISSING, once, at its top", (t) => {
  const files = { ...MODULES, "tools/gen/a.mjs": "export {};\n", "tools/gen/deep/b.mjs": "export {};\n", "tools/README.md": "# x\n" };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path]), [["NODE_MISSING", "tools/gen"]]);
});

test("under --changed, NODE_MISSING reports only directories the change touched", (t) => {
  const { dir } = project(t, { ...MODULES, "tools/old/a.mjs": "export {};\n" });
  assert.deepEqual(codes(run(dir, { changed: "HEAD" })), []);
  write(dir, "tools/new/a.mjs", "export {};\n");
  assert.deepEqual(run(dir, { changed: "HEAD" }).findings.map((f) => [f.code, f.path]), [["NODE_MISSING", "tools/new"]]);
});

// ---- layers and egress ---------------------------------------------------------------

test("a call up the layers is LAYER_VIOLATION at its calls line, and accept clears it", (t) => {
  const files = { ...MODULES, "src/queue/index.mjs": MODULES["src/queue/index.mjs"] + "// @system calls portal \"pings the portal\"\n" };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path, f.line]), [["LAYER_VIOLATION", "src/queue/index.mjs", 4]]);
  const cfg = { ...CONFIG, accept: [{ code: "LAYER_VIOLATION", path: "src/queue/index.mjs", why: "x" }] };
  assert.deepEqual(codes(run(project(t, files, { config: cfg }).dir)), []);
});

test("a network call outside an adapter is EGRESS_OUTSIDE_ADAPTER; inside one it is the adapter's job", (t) => {
  const svc = { ...MODULES, "src/queue/send.mjs": "await fetch(\"https://x.invalid\");\n" };
  assert.deepEqual(run(project(t, svc).dir).findings.map((f) => [f.code, f.path, f.line]), [["EGRESS_OUTSIDE_ADAPTER", "src/queue/send.mjs", 1]]);
  const adapter = { ...MODULES, "src/net/index.mjs": "// @system node net \"Net\" layer=adapter\nimport { execFileSync } from \"node:child_process\";\nexecFileSync(\"curl\", [\"-s\", u]);\nawait fetch(u);\n" };
  assert.deepEqual(codes(run(project(t, adapter).dir)), []);
});

test("spawned network CLIs, Python clients, and the config's own patterns count as egress", (t) => {
  const files = { ...MODULES,
    "src/queue/cli.mjs": "import { execFileSync } from \"node:child_process\";\nexecFileSync(\"gh\", [\"api\", p]);\n",
    "svc/p/__init__.py": "# @system node p \"P\" layer=service\nimport requests\nrequests.get(u)\n",
    "src/intake/model.mjs": "const c = new ModelClient({});\n" };
  const cfg = { ...CONFIG, egress: ["new ModelClient\\("] };
  assert.deepEqual(run(project(t, files, { config: cfg }).dir).findings.map((f) => [f.code, f.path, f.line]), [
    ["EGRESS_OUTSIDE_ADAPTER", "src/intake/model.mjs", 1], ["EGRESS_OUTSIDE_ADAPTER", "src/queue/cli.mjs", 2],
    ["EGRESS_OUTSIDE_ADAPTER", "svc/p/__init__.py", 3]]);
});

test("egress ignores a member call named fetch, and the word inside strings and comments", (t) => {
  const files = { ...MODULES, "src/queue/quiet.mjs": [
    "const loader = { fetch() { return []; } };", "await loader.fetch();",
    "const HINTS = { request: \"the native fetch()\" };", "// fetch(url) would go here", "const u = `use fetch(x)`;"].join("\n") + "\n" };
  assert.deepEqual(codes(run(project(t, files).dir)), []);
});

// ---- the public surface ----------------------------------------------------------------

test("every export of a node's entry file is classified: exposes puts it on the map, internal keeps it off", (t) => {
  const entry = [
    "// @system node lib \"Lib\" layer=adapter",
    "// @system exposes load \"reads one record\"",
    "// @system internal helper testOnly",
    "export async function load() {}",
    "export const helper = 1, other = 2;",
    "function a() {}", "const b = 1;",
    "export { a, b as testOnly };",
    "export default class Store {}",
  ].join("\n") + "\n";
  const { dir } = project(t, { ...MODULES, "src/lib/index.mjs": entry });
  const r = run(dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.line, f.message.split(" ")[0]]), [
    ["UNDECLARED_EXPORT", 5, "other"], ["UNDECLARED_EXPORT", 8, "a"], ["UNDECLARED_EXPORT", 9, "default"]]);
  assert.deepEqual(extract(dir).map.nodes.find((n) => n.id === "lib").exposes, [{ name: "load", label: "reads one record" }]);
});

test("a typed const export counts, so its exposes line is not stale and an unlisted one is reported", (t) => {
  const entry = [
    "// @system node lib \"Lib\" layer=adapter",
    "// @system exposes searchData \"the search index\"",
    "export const searchData: SearchData[] = [];",
    "export const RADIUS_VALUES: Record<string, number> = { sm: 4 }, pick = (o: Options) => o;",
    "export const handlers = { a: 1, b: (x: number) => x };",
  ].join("\n") + "\n";
  const r = run(project(t, { ...MODULES, "src/lib/index.ts": entry }).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.line, f.message.split(" ")[0]]), [
    ["UNDECLARED_EXPORT", 4, "RADIUS_VALUES"], ["UNDECLARED_EXPORT", 4, "pick"], ["UNDECLARED_EXPORT", 5, "handlers"]]);
});

test("an exposes line for a name the file no longer exports is EXPORT_STALE; Python's public defs count, _private ones do not", (t) => {
  const files = { ...MODULES,
    "src/queue/index.mjs": "// @system node queue \"Queue\" layer=service\n// @system exposes push \"queues one request\"\n// @system exposes gone \"was removed\"\nexport const push = (r) => r;\n",
    "svc/p/__init__.py": "# @system node p \"P\" layer=service\ndef run():\n    pass\ndef _hidden():\n    pass\nclass Thing:\n    def method(self):\n        pass\n" };
  const r = run(project(t, files).dir);
  assert.deepEqual(r.findings.map((f) => [f.code, f.path, f.line]), [
    ["EXPORT_STALE", "src/queue/index.mjs", 3], ["UNDECLARED_EXPORT", "svc/p/__init__.py", 2], ["UNDECLARED_EXPORT", "svc/p/__init__.py", 6]]);
});

// ---- the changed range and the waiver -------------------------------------------

test("--changed limits import findings to changed files, and Diagram: none waives them", (t) => {
  const { dir, git } = project(t, { ...MODULES, "src/queue/old.mjs": "import x from \"../intake/index.mjs\";\n" });
  assert.deepEqual(codes(run(dir, { changed: "HEAD" })), []);
  write(dir, "src/queue/new.mjs", "import x from \"../intake/index.mjs\";\n");
  assert.deepEqual(codes(run(dir, { changed: "HEAD" })), ["UNDECLARED_IMPORT"]);
  assert.deepEqual(codes(run(dir, { changed: "HEAD", note: "Diagram: none, a test seam" })), []);
  git("add", "-A");
  git("commit", "-m", "feat: seam\n\nDiagram: none, a test seam");
  assert.deepEqual(codes(run(dir, { changed: "HEAD~1..HEAD" })), []);
});

test("the waiver never clears a stale map, and accept clears one finding by code and path", (t) => {
  const { dir } = project(t);
  write(dir, "src/queue/index.mjs", "// @system node queue \"Work queue\" layer=service\nimport x from \"../intake/index.mjs\";\n");
  assert.deepEqual(codes(run(dir, { changed: "HEAD", note: "Diagram: none, why" })), ["MAP_STALE"]);
  write(dir, ".agents/system-map.json", JSON.stringify({ ...CONFIG, accept: [{ code: "UNDECLARED_IMPORT", path: "src/queue/index.mjs", why: "x" }] }));
  const r = run(dir);
  assert.deepEqual([codes(r), r.accepted], [["MAP_STALE"], 1]);
});

// ---- the board ----------------------------------------------------------------

test("publishing is refused until a board is recorded, then the map is marked published", (t) => {
  const { dir } = project(t);
  const cfg = path.join(dir, ".agents/system-map.json");
  const refused = runNode(CHECK, ["--root", dir, "--can-publish"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /no board recorded/);
  write(dir, ".agents/system-map.json", JSON.stringify({ ...CONFIG, board: BOARD }));
  assert.deepEqual(codes(run(dir)), ["BOARD_BEHIND"]);
  assert.equal(exitCode(run(dir)), 0, "a board that is behind is information, not a failure");
  const ok = runNode(CHECK, ["--root", dir, "--can-publish"]);
  assert.equal(ok.status, 0, ok.stdout);
  assert.ok(ok.stdout.includes(BOARD));
  assert.equal(runNode(CHECK, ["--root", dir, "--mark-published"]).status, 0);
  const after = JSON.parse(fs.readFileSync(cfg, "utf8"));
  assert.match(after.publishedHash, /^[0-9a-f]{16}$/);
  assert.deepEqual([after.title, after.board, after.externals], [CONFIG.title, BOARD, CONFIG.externals], "marking keeps the rest of the config");
  assert.deepEqual(codes(run(dir)), []);
});

test("no classification is asked for unless the config requires one, and then the board must be recorded as carrying it", (t) => {
  assert.equal(publishBlocker({ board: BOARD }), null);
  assert.equal(publishBlocker({ board: BOARD, requireClassification: null, classification: null }), null);
  const needs = { board: BOARD, requireClassification: "Confidential" };
  assert.match(publishBlocker(needs), /classified "Confidential"/);
  assert.match(publishBlocker({ ...needs, classification: { label: "internal", confirmed: "2026-01-01" } }), /classified "Confidential"/);
  assert.match(publishBlocker({ ...needs, classification: { label: "confidential" } }), /classified "Confidential"/, "a label nobody confirmed does not count");
  assert.equal(publishBlocker({ ...needs, classification: { label: "confidential", confirmed: "2026-01-01" } }), null);
  const { dir } = project(t, MODULES, { config: { ...CONFIG, ...needs } });
  const refused = runNode(CHECK, ["--root", dir, "--can-publish"]);
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /not publishing/);
  assert.equal(runNode(CHECK, ["--root", dir, "--mark-published"]).status, 1, "a refused board is never marked published");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".agents/system-map.json"), "utf8")).publishedHash, undefined);
});

// ---- the generator --------------------------------------------------------------

/** The kit's scene surface the generator uses, recording what it draws. */
function fakeKit() {
  const nodes = {}, arrows = [], texts = [];
  const scene = {
    nodes,
    card(id, x, y, w, h, o) { nodes[id] = { x, y, w, h, r: x + w, b: y + h, cx: x + w / 2, cy: y + h / 2, o }; },
    rect: (id, x, y, width, height) => ({ x, y, width, height }),
    box(id, el) { nodes[id] = { x: el.x, y: el.y, w: el.width, h: el.height, r: el.x + el.width, b: el.y + el.height, cx: el.x + el.width / 2, cy: el.y + el.height / 2, o: {} }; },
    text(id, x, y, str) { texts.push(str); },
    arrow(id, from, to, pts, o) { arrows.push({ id, from, to, pts, o }); },
    R: (n) => [n.r + 4, n.cy], L: (n) => [n.x - 4, n.cy], T: (n) => [n.cx, n.y - 4], B: (n) => [n.cx, n.b + 4],
  };
  const tw = (str, size) => str.length * size * 0.55;
  const wrap = (str) => [str];
  return { kit: { createScene: () => scene, tw, wrap, PAL: {}, INK: "#000", MUTED: "#555" }, scene, arrows, texts };
}

test("the generator draws one card per node, rows by layer, no overlaps, every arrow bound and its label on the caller", (t) => {
  const { dir } = project(t);
  const { kit, scene, arrows, texts } = fakeKit();
  generate(kit, path.join(dir, "diagrams/system-map.json"));
  const cards = Object.entries(scene.nodes);
  assert.equal(cards.length, 4);
  assert.deepEqual(texts, ["Fixture system"]);
  for (const [a, p] of cards) for (const [b, q] of cards) {
    if (a < b) assert.ok(p.r <= q.x || q.r <= p.x || p.b <= q.y || q.b <= p.y, `${a} overlaps ${b}`);
  }
  assert.ok(scene.nodes.portal.y < scene.nodes.intake.y && scene.nodes.intake.y < scene.nodes["ext_tracker"].y);
  assert.equal(scene.nodes.intake.y, scene.nodes.queue.y);
  assert.deepEqual(arrows.map((a) => [a.from, a.to]).sort(), [["intake", "ext_tracker"], ["intake", "queue"], ["portal", "intake"]]);
  assert.ok(arrows.every((a) => scene.nodes[a.from] && scene.nodes[a.to] && !a.o.label));
  assert.ok(scene.nodes.intake.o.body.includes("→ Queue: hands on approved request"));
  assert.ok(scene.nodes.intake.o.body.includes("• take: takes one request"));
  const again = fakeKit();
  generate(again.kit, path.join(dir, "diagrams/system-map.json"));
  assert.deepEqual(again.scene.nodes, scene.nodes);
});

test("a call that skips a row gets no connector, only its line on the calling card", (t) => {
  const files = { ...MODULES, "web/portal/app.mjs": MODULES["web/portal/app.mjs"] + "// @system calls ext:tracker \"reads status\"\n" };
  const { dir } = project(t, files);
  const { kit, scene, arrows } = fakeKit();
  generate(kit, path.join(dir, "diagrams/system-map.json"));
  assert.equal(arrows.some((a) => a.from === "portal" && a.to === "ext_tracker"), false);
  assert.ok(scene.nodes.portal.o.body.includes("→ Tracker: reads status"));
});

test("the generator orders each row so the connectors it draws between two rows do not cross", (t) => {
  // m's calls up to zz pull it right of s on neighbour centres alone, which crosses a→m
  // with b→s; swapping m and s draws both without a crossing.
  const dir = tempDir(t, "system-map-");
  const node = (id, layer) => ({ id, title: id.toUpperCase(), layer });
  const edge = (from, to, label = "x") => ({ from, to, label });
  write(dir, "map.json", JSON.stringify({ title: "Crossing fixture",
    nodes: [node("hub", "people"), node("zz", "people"), node("a", "surface"), node("b", "surface"), node("c", "surface"), node("m", "service"), node("s", "service")],
    edges: [edge("hub", "a"), edge("hub", "b"), edge("hub", "c"), edge("a", "m"), edge("b", "s"), edge("m", "zz", "x"), edge("m", "zz", "y"), edge("m", "zz", "z")] }));
  const { kit, scene, arrows } = fakeKit();
  generate(kit, path.join(dir, "map.json"));
  const spans = arrows.map(({ from, to }) => [scene.nodes[from], scene.nodes[to]]).map(([p, q]) => (p.y < q.y ? [p, q] : [q, p]));
  for (const [i, [p, q]] of spans.entries()) for (const [r, s] of spans.slice(i + 1)) {
    if (p.y !== r.y || q.y !== s.y || p === r || q === s) continue;
    assert.ok((p.cx - r.cx) * (q.cx - s.cx) >= 0, "two connectors between the same rows cross");
  }
});

/** marvelous-miro's build lint over the drawing of a map, strict, so an estimated finding blocks too. */
function lintDrawing(t, map) {
  const dir = tempDir(t, "system-map-");
  write(dir, "map.json", JSON.stringify(map));
  const items = sceneItems(generate(miroKit, path.join(dir, "map.json")).elements(), "system");
  const findings = lint(predictedModel([{ key: "system", frame: sceneFrame(items), items }]), { strict: true });
  const ends = items.filter((i) => i.kind === "connector").map((i) => `${i.refs.start}>${i.refs.end}`.replaceAll("system-r-", "")).sort();
  return { items, ends, findings: findings.map((f) => `${f.check} ${f.a} x ${f.b}`) };
}
const card = (id, layer, exports = 0) => ({ id, title: id, layer, path: `src/${id}`,
  exposes: Array.from({ length: exports }, (_, i) => ({ name: `e${i}`, label: "one export" })) });
const call = (from, to) => ({ from, to, label: "x" });

test("every card in a row takes the row's height, so an elbow below a short card never cuts through a tall one", (t) => {
  // short and other both call b, which sits under tall: below a short card the elbow
  // bends at mid-gap, which is still beside a tall card.
  const { items, findings } = lintDrawing(t, { title: "Heights",
    nodes: [card("p1", "people"), card("p2", "people"), card("p3", "people"), card("short", "service"), card("tall", "service", 12), card("other", "service"), card("b", "adapter")],
    edges: [call("p1", "short"), call("p2", "tall"), call("p3", "other"), call("short", "b"), call("other", "b")] });
  assert.deepEqual(findings, []);
  const height = (id) => items.find((i) => i.key === `system-r-${id}`).attrs.height;
  assert.deepEqual([height("short"), height("other")], [height("tall"), height("tall")]);
});

test("cards in one row that call the same cards below meet at a junction, so the lint finds nothing and every call is drawn", (t) => {
  const to = ["c1", "c2", "c3", "c4"];
  const { ends, findings } = lintDrawing(t, { title: "Fan-out",
    nodes: [card("user", "people"), card("app", "surface"), card("parts", "surface"), ...to.map((id) => card(id, "service"))],
    edges: [call("user", "app"), ...to.flatMap((t) => [call("app", t), call("parts", t)])] });
  assert.deepEqual(findings, []);
  assert.deepEqual(ends, ["app>bus-app-c1", ...to.map((t) => `bus-app-c1>${t}`), "parts>bus-app-c1", "user>app"]);
});

test("a tangle no order clears loses one connector at a time, so the build passes and every call stays on its card", (t) => {
  // A six-cycle between two rows crosses in any order, and no two cards share two callees.
  const { items, ends, findings } = lintDrawing(t, { title: "Cycle",
    nodes: ["a", "b", "c"].map((id) => card(id, "surface")).concat(["x", "y", "z"].map((id) => card(id, "service"))),
    edges: [call("a", "x"), call("a", "y"), call("b", "y"), call("b", "z"), call("c", "z"), call("c", "x")] });
  assert.deepEqual(findings, []);
  assert.equal(ends.length, 5);
  for (const id of ["a", "b", "c"]) assert.equal(items.find((i) => i.key === `system-r-${id}`).attrs["data-content"].split("→").length - 1, 2);
});

// ---- the script where it lives ----------------------------------------------------

test("the CLI checks the repo it is pointed at, or the one it is run inside, from any directory in it", (t) => {
  const { dir } = project(t);
  write(dir, "src/queue/index.mjs", "// @system node queue \"Work queue\" layer=service\n");
  const elsewhere = tempDir(t, "system-map-cwd-");
  const pointed = runNode(CHECK, ["--root", dir, "--json"], { cwd: elsewhere });
  assert.equal(pointed.status, 1, pointed.stderr);
  assert.deepEqual(JSON.parse(pointed.stdout).findings.map((f) => f.code), ["MAP_STALE"]);
  const inside = runNode(CHECK, ["--json"], { cwd: path.join(dir, "src", "queue") });
  assert.deepEqual(JSON.parse(inside.stdout).findings.map((f) => f.code), ["MAP_STALE"]);
  const fixed = runNode(CHECK, ["--write"], { cwd: dir });
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  assert.match(fixed.stdout, /system-map: 0 warning, 0 info/);
});

test("the report is one JSON object, and a finding says what to do without naming a path that may not exist", (t) => {
  const { dir } = project(t);
  write(dir, "src/queue/index.mjs", "// @system node queue \"Work queue\" layer=service\n");
  const report = JSON.parse(runNode(CHECK, ["--root", dir, "--json"]).stdout);
  assert.deepEqual(Object.keys(report), ["config", "mode", "summary", "accepted", "findings"]);
  assert.deepEqual([report.config, report.mode, report.summary], [CONFIG_PATH, ["tree"], { warning: 1, info: 0 }]);
  const [stale] = report.findings;
  assert.deepEqual(Object.keys(stale), ["code", "severity", "path", "line", "message"]);
  assert.match(stale.message, /with --write/);
  assert.doesNotMatch(stale.message, /\.agents\/scripts/);
});

test("a repo without the config gets one line that says who sets the map up, and exit 0", (t) => {
  const { dir } = project(t, MODULES, { config: null });
  const out = runNode(CHECK, ["--root", dir]);
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim().split("\n").length, 1);
  assert.match(out.stdout, /the person runs \/marvelous-miro:diagrams-init/);
  assert.equal(runNode(CHECK, ["--root", dir, "--can-publish"]).status, 1);
});

test("a config that does not parse is exit 2 with the reason on stderr, never a clean report", (t) => {
  const { dir } = project(t);
  write(dir, ".agents/system-map.json", "{ not json");
  const out = runNode(CHECK, ["--root", dir]);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /^system-map: /);
  assert.equal(out.stdout, "");
});

test("the script imports nothing but Node's own modules, so one file copied into a repo is the whole check", (t) => {
  const source = fs.readFileSync(CHECK, "utf8");
  const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.ok(imports.length >= 4);
  assert.deepEqual(imports.filter((m) => !m.startsWith("node:")), []);
  assert.doesNotMatch(source, /\bimport\s*\(/, "nothing is loaded at run time either");

  const { dir } = project(t);
  write(dir, ".agents/scripts/system-map.mjs", source);
  const copy = path.join(dir, ".agents", "scripts", "system-map.mjs");
  const clean = runNode(copy, [], { cwd: dir });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /system-map: 0 warning/, "the copy under .agents/ is not itself a module the map must own");
  write(dir, "src/queue/extra.mjs", "import x from \"../intake/index.mjs\";\n");
  const ci = runNode(copy, ["--changed", "HEAD", "--json"], { cwd: dir });
  assert.equal(ci.status, 1);
  assert.deepEqual(JSON.parse(ci.stdout).findings.map((f) => [f.code, f.path]), [["UNDECLARED_IMPORT", "src/queue/extra.mjs"]]);
});

test("the config template diagrams-init copies parses, and turns nothing on by itself", () => {
  const template = JSON.parse(fs.readFileSync(path.join(PLUGIN, "skills", "diagrams-init", "assets", "system-map.json"), "utf8"));
  assert.deepEqual([template.board, template.requireClassification, template.classification, template.publishedHash], [null, null, null, null]);
  assert.deepEqual([template.map, template.exclude, template.accept], ["diagrams/system-map.json", [".agents/**"], []]);
  assert.match(publishBlocker(template), /no board recorded/);
});

// ---- the map on a board, through the build ---------------------------------------

test("a repo's one-line generator draws the committed map through the build, with nothing imported from the plugin", (t) => {
  const { dir } = project(t);
  const S = path.join(PLUGIN, "skills", "miro-board", "scripts");
  const init = runNode(path.join(S, "init.mjs"), ["diagrams", "--board", BOARD], { cwd: dir });
  assert.equal(init.status, 0, init.stderr);
  const generator = fs.readFileSync(path.join(PLUGIN, "skills", "diagrams-init", "assets", "gen-system.mjs"), "utf8");
  assert.doesNotMatch(generator, /^import\b/m, "the generator a repo commits imports nothing");
  write(dir, "diagrams/src/gen-system.mjs", generator);
  fs.rmSync(path.join(dir, "diagrams", "src", "gen-example.mjs"));
  write(dir, "diagrams/miro.config.mjs", `export default ${JSON.stringify({ board: BOARD, views: [{ key: "system", title: CONFIG.title, gen: "./src/gen-system.mjs", strict: true }] })};\n`);
  const built = runNode(path.join(S, "build.mjs"), [], { cwd: dir });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.match(built.stdout, /system: \d+ items, a new frame/);
  const svg = fs.readFileSync(path.join(dir, "diagrams", "miro", "system.svg"), "utf8");
  for (const title of ["Intake", "Queue", "Requester portal", "Tracker"]) assert.ok(svg.includes(`&lt;b&gt;${title}&lt;/b&gt;`), `${title} has a card`);
  // The Miro project the build added is not source the map must own.
  assert.deepEqual(codes(run(dir)), []);
});
