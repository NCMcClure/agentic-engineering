// agent-works lib/config.mjs: the repo's .agents/agent-works.json, its
// defaults, and the paths and budgets the rest of the plugin reads from it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, tempDir, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agent-works");
const { CONFIG, CONFIG_VERSION, DEFAULTS, OLD_BOARD, boardDir, budget, configPath, defaults, findConfig, loadConfig, merge } =
  await import(pathToFileURL(path.join(PLUGIN, "lib", "config.mjs")).href);

const real = (p) => fs.realpathSync.native(p);
const BOM = String.fromCharCode(0xfeff);

/** A project folder under a temp folder, with `text` as its config when one is given. */
function project(t, text = null) {
  const root = path.join(real(tempDir(t, "aw-config-")), "acme");
  fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
  if (text !== null) write(root, CONFIG, text);
  return root;
}

const EXPECTED = {
  version: 1,
  paths: {
    memory: ".agents/memory", kanban: ".agents/kanban", briefs: ".agents/briefs", decisions: ".agents/decisions",
    glossary: ".agents/CONTEXT.md", contracts: ".agents/contracts", plan: ".agents/plan", userDocs: "docs",
  },
  tasks: { home: "kanban" },
  claude: { twins: "generated" },
  plugins: ["agent-works", "codebase-optimizer", "perceptual-loop"],
  budgets: {
    rootAgentsLines: 200, hubLines: 40, contractLines: 120, statusLines: 120, memoryFileLines: 400, memoryFolderFiles: 12,
    indexHookChars: 160, decisionLines: 150, glossaryRowChars: 300, briefLines: 120, roundBriefLines: 80, noteChars: 200,
  },
  links: { roots: [], files: [], planned: [], notChecked: [] },
  briefs: { stray: ["*brief*.md", "agent-*.md", "handoff*.md", "handover*.md"] },
  dup: { shingleWords: 12, minWords: 14, ignore: [] },
  kanban: { staleStartDays: 7, gateOwedDays: 3, tracked: false, conflicts: { shared: [], merge: [], rederived: [] } },
  guard: {
    agentVar: "AW_AGENT", agentVarAliases: ["PL_AGENT"], ownerFiles: [], ownerFilesEdit: "ask", generated: [],
    staging: { blanket: "deny", unseen: "deny" }, locks: "warn",
    defaultBranch: { names: ["main", "master"], commit: "warn", forcePush: "ask" },
    rules: [], log: true,
  },
  resources: {},
  lockOrder: [],
  runs: [],
  counters: {},
  accept: [],
  coordination: { lockStaleMinutes: 45, agentStaleMinutes: 120, holdMinutes: 120, claimHours: 72, learningChars: 6000, logBytes: 262144 },
};

test("agent-works config: the defaults, key for key and in order", () => {
  assert.equal(CONFIG, ".agents/agent-works.json");
  assert.equal(CONFIG_VERSION, 1);
  assert.equal(OLD_BOARD, ".agents/board");
  assert.deepEqual(DEFAULTS, EXPECTED);
  assert.equal(JSON.stringify(DEFAULTS), JSON.stringify(EXPECTED));
});

test("agent-works config: DEFAULTS cannot be changed, and defaults() is a copy that can", () => {
  assert.throws(() => { DEFAULTS.budgets.hubLines = 1; }, TypeError);
  assert.throws(() => { DEFAULTS.guard.ownerFiles.push("x"); }, TypeError);
  assert.throws(() => { DEFAULTS.extra = 1; }, TypeError);
  const copy = defaults();
  copy.guard.ownerFiles.push("x");
  copy.budgets.hubLines = 1;
  assert.deepEqual(defaults(), EXPECTED);
  assert.deepEqual(DEFAULTS.guard.ownerFiles, []);
});

test("agent-works config: the documented defaults are the code's", (t) => {
  const doc = ["references", path.join("core", "references")].map((dir) => path.join(PLUGIN, dir, "guard-config.md")).find((f) => fs.existsSync(f));
  if (!doc) return t.skip("the plugin has no guard-config.md reference");
  const text = fs.readFileSync(doc, "utf8");
  assert.deepEqual(JSON.parse(text.split("```json")[1].split("```")[0]), EXPECTED);
  const table = text.split("## Key by key")[1]?.split("\n## ")[0] ?? "";
  for (const block of ["dup", "kanban", "coordination"]) for (const key of Object.keys(DEFAULTS[block])) assert.ok(table.includes(`\`${block}.${key}\``), `${block}.${key}`);
});

test("agent-works config: findConfig is the nearest config at or above the start", (t) => {
  const root = project(t);
  const sub = path.join(root, "a", "b");
  assert.equal(findConfig(sub), null);
  const file = write(root, CONFIG, "{}");
  assert.equal(findConfig(sub), file);
  assert.equal(findConfig(root), file);
  assert.equal(findConfig(write(root, "a/b/c.md", "x")), file);
  assert.equal(findConfig(path.dirname(root)), null);
  const nearer = write(root, `a/${CONFIG}`, "{}");
  assert.equal(findConfig(sub), nearer);
  // A folder of that name is not a config.
  fs.mkdirSync(path.join(root, "a", "b", ".agents", "agent-works.json"), { recursive: true });
  assert.equal(findConfig(sub), nearer);
});

test("agent-works config: loadConfig lays the file over the defaults", (t) => {
  const root = project(t);
  const sub = path.join(root, "a", "b");
  const none = loadConfig(sub);
  assert.deepEqual(none, EXPECTED);
  assert.equal("_path" in none, false);
  const file = write(root, CONFIG, JSON.stringify({
    budgets: { hubLines: 25 }, guard: { ownerFiles: ["x"], staging: { unseen: "ask" } }, name: "  Acme  ", extra: 1, plugins: [], links: null,
  }));
  const cfg = loadConfig(sub);
  assert.deepEqual([cfg.budgets.hubLines, cfg.budgets.statusLines, cfg.guard.ownerFiles], [25, 120, ["x"]]);
  assert.deepEqual(cfg.guard.staging, { blanket: "deny", unseen: "ask" });
  assert.deepEqual(cfg.guard.defaultBranch, EXPECTED.guard.defaultBranch);
  assert.deepEqual([cfg.name, cfg.extra, cfg.plugins, cfg.links], ["  Acme  ", 1, [], null]);
  assert.deepEqual([cfg._path, cfg._root, "_error" in cfg], [file, root, false]);
  assert.deepEqual(Object.keys(cfg).slice(0, Object.keys(EXPECTED).length), Object.keys(EXPECTED));
  // The defaults were not touched, and two loads share nothing.
  cfg.guard.ownerFiles.push("y");
  cfg.paths.memory = "elsewhere";
  assert.deepEqual(defaults(), EXPECTED);
  assert.deepEqual(loadConfig(sub).guard.ownerFiles, ["x"]);
  assert.equal(loadConfig(sub).paths.memory, ".agents/memory");
});

test("agent-works config: a config with a byte order mark and CRLF is read", (t) => {
  const root = project(t, `${BOM}{\r\n  "paths": { "kanban": "work/board" }\r\n}\r\n`);
  const cfg = loadConfig(root);
  assert.deepEqual([cfg.paths.kanban, cfg.paths.memory, cfg._error], ["work/board", ".agents/memory", undefined]);
});

test("agent-works config: a config that does not parse comes back as the defaults with the reason, never thrown", (t) => {
  const withoutMarks = (cfg) => Object.fromEntries(Object.entries(cfg).filter(([key]) => !key.startsWith("_")));
  for (const [text, reason] of [
    ["{ nope", /^\.agents\/agent-works\.json is not valid JSON: \S/],
    ["", /^\.agents\/agent-works\.json is not valid JSON: \S/],
    [Buffer.from([0xff, 0xfe, 0x7b, 0x7d]), /^\.agents\/agent-works\.json is not valid JSON: \S/],
    ["[1]", /^\.agents\/agent-works\.json must hold a JSON object$/],
    ['"text"', /^\.agents\/agent-works\.json must hold a JSON object$/],
    ["null", /^\.agents\/agent-works\.json must hold a JSON object$/],
  ]) {
    const root = project(t, text);
    const cfg = loadConfig(path.join(root, "a", "b"));
    assert.match(cfg._error, reason, String(text));
    assert.deepEqual([cfg._path, cfg._root], [path.join(root, ".agents", "agent-works.json"), root]);
    assert.deepEqual(withoutMarks(cfg), EXPECTED);
  }
});

test("agent-works config: merge lays one object on another, object by object", () => {
  assert.deepEqual(merge({ a: 1, b: { c: 2, d: [1] } }, { b: { d: [2], e: 3 }, f: { g: 1 } }), { a: 1, b: { c: 2, d: [2], e: 3 }, f: { g: 1 } });
  assert.deepEqual(merge({ a: { x: 1 } }, { a: 5 }), { a: 5 });
  assert.deepEqual(merge({ a: 5 }, { a: { x: 1 } }), { a: { x: 1 } });
  assert.deepEqual(merge({ a: { x: { y: 1, z: 2 } } }, { a: { x: { y: null } } }), { a: { x: { y: null, z: 2 } } });
  assert.deepEqual(merge({ a: [1, 2] }, { a: { 0: "x" } }), { a: { 0: "x" } });
  const base = { a: { x: 1 } };
  merge(base, { a: { y: 2 }, b: 1 });
  assert.deepEqual(base, { a: { x: 1 } });
  const merged = merge({ a: 1 }, JSON.parse('{"__proto__": {"polluted": true}, "b": 2}'));
  assert.deepEqual([merged.polluted, {}.polluted, Object.keys(merged)], [undefined, undefined, ["a", "b"]]);
});

test("agent-works config: configPath is a path of the config under the root", (t) => {
  const root = project(t);
  const cfg = defaults();
  assert.equal(configPath(cfg, root, "memory"), path.join(root, ".agents", "memory"));
  assert.equal(configPath(cfg, root, "glossary"), path.join(root, ".agents", "CONTEXT.md"));
  cfg.paths.memory = "notes/mem";
  assert.equal(configPath(cfg, root, "memory"), path.join(root, "notes", "mem"));
  const elsewhere = path.join(path.dirname(root), "elsewhere");
  cfg.paths.memory = elsewhere;
  assert.equal(configPath(cfg, root, "memory"), elsewhere);
  // A key the file emptied, or a `paths` it replaced with nothing, falls back to the default.
  cfg.paths.memory = "";
  assert.equal(configPath(cfg, root, "memory"), path.join(root, ".agents", "memory"));
  assert.equal(configPath({ paths: null }, root, "userDocs"), path.join(root, "docs"));
  assert.equal(configPath({}, root, "plan"), path.join(root, ".agents", "plan"));
});

test("agent-works config: boardDir honours the old folder while the new one does not exist", (t) => {
  const root = project(t);
  const cfg = loadConfig(root);
  assert.equal(boardDir(cfg, root), path.join(root, ".agents", "kanban"));
  fs.mkdirSync(path.join(root, ".agents", "board"), { recursive: true });
  assert.equal(boardDir(cfg, root), path.join(root, ".agents", "kanban"));
  write(root, ".agents/board/board.json", "{}");
  assert.equal(boardDir(cfg, root), path.join(root, ".agents", "board"));
  assert.equal(boardDir({ paths: { kanban: "work/board" } }, root), path.join(root, ".agents", "board"));
  fs.mkdirSync(path.join(root, "work", "board"), { recursive: true });
  assert.equal(boardDir({ paths: { kanban: "work/board" } }, root), path.join(root, "work", "board"));
  fs.mkdirSync(path.join(root, ".agents", "kanban"));
  assert.equal(boardDir(cfg, root), path.join(root, ".agents", "kanban"));
});

test("agent-works config: budget is a whole number, the default when the file's value is not one", () => {
  const cfg = { budgets: { hubLines: "30", statusLines: "many", noteChars: 12.9, briefLines: null, decisionLines: true, rootAgentsLines: " 7 ", contractLines: "2.5", memoryFileLines: -4, indexHookChars: [9] } };
  const read = (key) => budget(cfg, key);
  assert.deepEqual(
    ["hubLines", "statusLines", "noteChars", "briefLines", "decisionLines", "rootAgentsLines", "contractLines", "memoryFileLines", "indexHookChars", "glossaryRowChars"].map(read),
    [30, 120, 12, 120, 1, 7, 120, -4, 160, 300],
  );
  assert.equal(budget({}, "hubLines"), 40);
  assert.equal(budget({ budgets: null }, "noteChars"), 200);
  assert.equal(budget(defaults(), "roundBriefLines"), 80);
});
