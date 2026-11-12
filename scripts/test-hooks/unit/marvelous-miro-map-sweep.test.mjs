// marvelous-miro's whole-repo map sweep: map-sweep.mjs's units and size verdict
// over small throwaway repos, and diagrams-sync's sweep workflow run end to end
// with stubbed agents, so its routing (the tier each step runs on, the plan's
// pins and coverage, settle, the verify loop) is checked without a model.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { LARGE, sweep, unit } from "../../../plugins/marvelous-miro/scripts/map-sweep.mjs";
import { REPO, runNode, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "marvelous-miro");
const SCRIPT = path.join(PLUGIN, "scripts", "map-sweep.mjs");
const WORKFLOW = path.join(PLUGIN, "skills", "diagrams-sync", "workflows", "sweep.js");

const MODULES = {
  "src/intake/index.mjs": [
    "// @system node intake \"Intake\" layer=service",
    "// @system calls queue \"hands on approved request\"",
    "import { push } from \"../queue/index.mjs\";",
    "export const take = (r) => push(r);",
  ].join("\n"),
  "src/intake/parse.mjs": "export const parse = (s) => JSON.parse(s);\n",
  "src/queue/index.mjs": "// @system node queue \"Queue\" layer=service\n// @system exposes push \"queues one request\"\nexport const push = (r) => r;\n",
  "src/queue/store/index.mjs": "// @system node store \"Store\" layer=adapter\nexport const save = (r) => r;\n",
  "src/tools/a.mjs": "export const a = 1;\n",
  "src/tools/b.mjs": "export const b = 2;\n",
  "web/app.mjs": "import { take } from \"../src/intake/index.mjs\";\n",
};
const CONFIG = { title: "Fixture", nodes: { catalog: { title: "Catalog", layer: "runtime", path: "catalog" } } };

/** A git repo holding the config (unless null) and the given files. */
function project(t, files = MODULES, config = CONFIG) {
  const { dir } = tempRepo(t, "map-sweep-");
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  if (config) write(dir, ".agents/system-map.json", JSON.stringify(config, null, 2) + "\n");
  return dir;
}

// ---- map-sweep.mjs ------------------------------------------------------------

test("units are the annotated modules and the unowned directories, each with its findings", (t) => {
  const r = sweep(project(t));
  assert.deepEqual(r.units.map((u) => [u.dir, u.node, u.files]), [
    ["src/intake", "intake", 2], ["src/queue", "queue", 1], ["src/queue/store", "store", 1], ["src/tools", null, 2], ["web", null, 1]]);
  const intake = r.units.find((u) => u.node === "intake");
  assert.equal(intake.entry, "src/intake/index.mjs");
  assert.deepEqual(intake.codes, { UNDECLARED_EXPORT: 1 });
  assert.deepEqual(r.units.find((u) => u.dir === "web").codes, { NODE_MISSING: 1 });
  assert.deepEqual(r.units.find((u) => u.node === "store").codes, { UNDECLARED_EXPORT: 1 });
  assert.deepEqual(r.configNodes.map((u) => [u.node, u.dir, u.entry]), [["catalog", "catalog", null]]);
  assert.deepEqual(r.global.map((f) => f.code), ["MAP_MISSING"]);
  assert.equal(r.totals.modules, 6);
  assert.equal(r.totals.warnings, r.units.reduce((n, u) => n + u.findings, 0) + 1);
});

test("the repo is large from LARGE.modules modules or LARGE.files source files, and says why", (t) => {
  assert.equal(sweep(project(t)).large, false);
  const many = { ...MODULES };
  for (let i = 0; i < LARGE.modules; i++) many[`pkg/m${i}/index.mjs`] = "export const x = 1;\n";
  const r = sweep(project(t, many));
  assert.equal(r.large, true);
  assert.match(r.reason, /unowned directories/);
});

test("one unit lists the files it owns, the modules nested in it, and only its own findings", (t) => {
  const dir = project(t);
  const q = unit(dir, "src/queue");
  assert.deepEqual([q.node, q.entry, q.files, q.nested, q.findings], ["queue", "src/queue/index.mjs", ["src/queue/index.mjs"], ["src/queue/store"], []]);
  const tools = unit(dir, "src/tools/");
  assert.deepEqual([tools.node, tools.files, tools.findings.map((f) => f.code)], [null, ["src/tools/a.mjs", "src/tools/b.mjs"], ["NODE_MISSING"]]);
});

test("a repo without the map is null, and the CLI exits 1 saying who sets it up", (t) => {
  const dir = project(t, MODULES, null);
  assert.equal(sweep(dir), null);
  const res = runNode(SCRIPT, ["--root", dir]);
  assert.equal(res.status, 1);
  assert.match(JSON.parse(res.stdout).message, /the person runs \/marvelous-miro:diagrams-init/);
});

test("the CLI prints the sweep and one unit as JSON", (t) => {
  const dir = project(t);
  const all = runNode(SCRIPT, ["--root", dir]);
  assert.equal(all.status, 0, all.stderr);
  assert.equal(JSON.parse(all.stdout).units.length, 5);
  const one = runNode(SCRIPT, ["--root", dir, "--unit", "src/intake"]);
  assert.deepEqual(JSON.parse(one.stdout).findings.map((f) => f.code), ["UNDECLARED_EXPORT"]);
});

// ---- the sweep workflow, with stubbed agents ----------------------------------

const SRC = fs.readFileSync(WORKFLOW, "utf8");
const AsyncFunction = (async () => {}).constructor;

/** Run the script as the Workflow tool would, answering each agent() by its label. */
async function runWorkflow(args, respond) {
  const calls = [], logs = [];
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, ...opts });
    const out = respond(opts.label, prompt, calls);
    return out === undefined ? null : structuredClone(out);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
    let r = item;
    for (const stage of stages) { try { r = await stage(r, item, i); } catch { return null; } }
    return r;
  }));
  const body = new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", SRC.replace(/^export const meta/m, "const meta"));
  const result = await body(args, agent, parallel, pipeline, () => {}, (m) => logs.push(m), { total: null, spent: () => 0, remaining: () => Infinity });
  return { result, calls, logs, by: (label) => calls.find((c) => c.label === label) };
}

const ARGS = { root: "/repo", pluginRoot: "/plugin" };
const row = (dir, node, files, findings, extra = {}) => ({ dir, node, title: node ? node[0].toUpperCase() + node.slice(1) : null, layer: node ? "service" : null,
  entry: node ? `${dir}/index.mjs` : null, files, findings, codes: findings ? { UNDECLARED_EXPORT: findings } : {}, ...extra });
const SCAN = {
  config: ".agents/system-map.json", large: true, reason: "6 module(s)",
  totals: { modules: 6, declared: 2, config: 1, loose: 3, sourceFiles: 40, warnings: 6 },
  units: [row("src/intake", "intake", 5, 2), row("src/queue", "queue", 1, 0), row("src/tools", null, 2, 1), row("web", null, 6, 1), row("vendor/lib", null, 3, 0)],
  configNodes: [row("catalog", "catalog", 0, 0, { entry: null, layer: "runtime" })],
  global: [],
};
const unitPlan = (dir, node, entry, action, tier) => ({ dir, entry, node, title: node, layer: "service", action, tier, brief: `${node} job` });
const PLAN = {
  units: [
    unitPlan("src/intake", "intake-svc", "src/intake/index.mjs", "keep", "haiku"), // renamed, and over the haiku cap
    unitPlan("src/tools", "tools", "src/tools/index.mjs", "new", "haiku"),
    unitPlan("web", "web", "web/app.mjs", "new", "sonnet"),
    unitPlan("web/sub", "web", "web/sub/index.mjs", "new", "sonnet"), // shares an id: dropped
    // src/queue left out: put back as it stands
  ],
  config: { externals: [{ id: "tracker", title: "Tracker" }], nodes: [], exclude: ["vendor/**"], accept: [] },
  notes: [],
};
const MOVE = { code: "EGRESS_OUTSIDE_ADAPTER", path: "web/app.mjs" };

/** The happy path, with `checks` answering the Settle check and then each Verify check in turn. */
function respond(checks) {
  let check = 0;
  return (label) => {
    if (label === "scan") return SCAN;
    if (label === "plan" || label === "plan:repair") return PLAN;
    if (label === "config" || label === "settle:apply") return { ok: true, changes: ["x"] };
    if (label.startsWith("write:")) {
      const dir = label.slice(6);
      return { dir, changed: [`${dir}/index.mjs`], lines: 2, remaining: [],
        deferred: dir === "web" ? [{ kind: "move", ...MOVE, what: "fetch belongs behind an adapter" }] : [] };
    }
    if (label.startsWith("review:")) {
      const dir = label.slice(7);
      const issue = { severity: "major", path: `${dir}/index.mjs`, problem: "label says nothing", fix: "// @system calls x \"y\"" };
      return { dir, issues: dir === "src/tools" || dir === "catalog" ? [issue] : [], deferred: [] };
    }
    if (label.startsWith("fix:")) return { dir: label.slice(4), applied: 1, skipped: [], remaining: [], deferred: [] };
    if (label.startsWith("check:")) return { ok: true, warnings: checks[Math.min(check++, checks.length - 1)], info: 1 };
    if (label === "settle") {
      return { decisions: [{ action: "move", ...MOVE, item: "egress", file: "", edit: "", why: "move the fetch" },
        { action: "config", item: "catalog label", file: ".agents/system-map.json", edit: "{}", why: "reviewer" }] };
    }
    if (label.startsWith("verify:")) return { fixed: 1, unresolved: [] };
    if (label === "critique") return { notes: [] };
    throw new Error(`unexpected agent ${label}`);
  };
}

test("the meta block is a literal whose phases match the phase() calls, and nothing breaks resume", () => {
  const titles = [...SRC.matchAll(/phase\('([^']+)'\)/g)].map((m) => m[1]);
  const meta = [...SRC.slice(0, SRC.indexOf("\n}\n")).matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(titles, meta);
  assert.doesNotMatch(SRC, /Date\.now\(|Math\.random\(|new Date\(/);
});

test("args are coerced from a string and required", async () => {
  await assert.rejects(runWorkflow({ root: "/repo" }, () => SCAN), /args must be an object/);
  const { result } = await runWorkflow(JSON.stringify(ARGS), () => ({ ...SCAN, large: false }));
  assert.equal(result.skipped, "small");
});

test("a repo under the threshold stops after the scan unless forced", async () => {
  const small = { ...SCAN, large: false };
  const { result, calls } = await runWorkflow(ARGS, () => small);
  assert.deepEqual([result.skipped, calls.length], ["small", 1]);
  await assert.rejects(runWorkflow({ ...ARGS, force: true }, (label) => (label === "scan" ? small : undefined)), /planner returned nothing/);
});

test("a scan that loses modules is read again, then refused", async () => {
  const short = { ...SCAN, units: SCAN.units.slice(1) };
  const run = runWorkflow(ARGS, () => short);
  await assert.rejects(run, /lost modules twice/);
});

test("opus plans and reviews; haiku and sonnet write; the plan's ids are pinned and its gaps closed", async () => {
  const { result, calls, by, logs } = await runWorkflow(ARGS, respond([[MOVE], [MOVE, { code: "TARGET_MISSING", path: "web/app.mjs" }], [MOVE]]));
  const model = (label) => by(label)?.model;
  assert.deepEqual(["plan", "plan:repair", "review:src/intake", "review:src/queue", "review:catalog", "settle", "critique"].map(model), Array(7).fill("opus"));
  assert.deepEqual(["scan", "check:0", "check:1", "write:src/tools"].map(model), Array(4).fill("haiku"));
  assert.deepEqual(["config", "write:src/intake", "write:web", "fix:src/tools", "settle:apply", "verify:fix:1"].map(model), Array(6).fill("sonnet"));

  // The renamed module keeps its id, the omitted one is audited as it stands, the id clash is dropped.
  assert.match(by("write:src/intake").prompt, /"node":"intake"/);
  assert.equal(by("write:src/queue"), undefined, "a clean annotated module goes straight to review");
  assert.ok(by("review:src/queue"));
  assert.deepEqual(result.plan.promoted, ["src/intake"]);
  assert.equal(result.plan.dropped.length, 1);
  assert.match(result.plan.dropped[0], /web\/sub/);
  assert.deepEqual(result.plan.unplanned, [], "vendor/lib is covered by the exclude");
  assert.ok(logs.some((l) => /renamed intake/.test(l)));

  // A config node's review goes to settle, never to a fixer, and a move is parked rather than looped on.
  assert.equal(by("fix:catalog"), undefined);
  assert.match(by("settle").prompt, /catalog: label says nothing/);
  assert.equal(result.moves.length, 1);
  assert.deepEqual([result.verify.clean, result.verify.rounds, result.verify.escalated], [true, 1, false]);
  assert.deepEqual(result.verify.parked.map((f) => f.code), ["EGRESS_OUTSIDE_ADAPTER"]);
  assert.equal(calls.filter((c) => c.label.startsWith("write:")).length, 3);
});

test("the verify loop runs three sonnet rounds, escalates to opus once, and reports what is left", async () => {
  const stuck = [{ code: "TARGET_MISSING", path: "web/app.mjs" }];
  const { result, calls } = await runWorkflow(ARGS, respond([stuck]));
  const verify = calls.filter((c) => c.label.startsWith("verify:"));
  assert.deepEqual(verify.map((c) => [c.label, c.model]), [
    ["verify:fix:1", "sonnet"], ["verify:fix:2", "sonnet"], ["verify:fix:3", "sonnet"], ["verify:escalate", "opus"]]);
  assert.deepEqual([result.verify.clean, result.verify.escalated, result.verify.open.length], [false, true, 1]);
  assert.ok(result.critique, "the critic still reads a map the checker can run on");
});

test("every step is handed the plugin's own checker and work list, pointed at the repo, and never a path inside it", async () => {
  const { calls, by } = await runWorkflow(ARGS, respond([[MOVE], [MOVE]]));
  const check = 'node "/plugin/scripts/system-map.mjs" --root "/repo"';
  const list = 'node "/plugin/scripts/map-sweep.mjs" --root "/repo"';
  for (const c of calls) {
    assert.ok(c.prompt.includes(check), `${c.label} is told how to run the checker`);
    assert.ok(c.prompt.includes("/plugin/skills/diagrams-sync/references/grammar.md"), `${c.label} is pointed at the grammar`);
    assert.doesNotMatch(c.prompt, /\.agents\/scripts\//, `${c.label} is sent to a copy the repo may not have`);
    assert.match(c.prompt, /Never change git state/);
  }
  assert.ok(by("scan").prompt.includes(`Run \`${list}\``));
  assert.ok(by("write:web").prompt.includes(`${list} --unit web`));
  assert.ok(by("check:0").prompt.includes(`${check} --write`));
  for (const file of [path.join(PLUGIN, "scripts", "system-map.mjs"), path.join(PLUGIN, "scripts", "map-sweep.mjs"), path.join(PLUGIN, "skills", "diagrams-sync", "references", "grammar.md")]) {
    assert.ok(fs.existsSync(file), file);
  }
});

test("the work list and the checker agree, because the one imports the other", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.match(source, /from "\.\/system-map\.mjs";/);
  assert.doesNotMatch(source, /process\.exit\(/);
});
