// picture-this's model check: what a model.json must be before a figure is
// drawn from it. The rules are tested on the function, the messages and exit
// codes on the CLI, since a skill reads those lines back to the person.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkModel, FLOW_KINDS, HUES, LENSES, LIMITS } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/lib/model-check.mjs";
import { main, COMMANDS } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/pt.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-engineering", "skills", "picture-this");
const PT = path.join(PLUGIN, "scripts", "pt.mjs");
const FIXTURE = path.join(PLUGIN, "studies", "iso-flow", "model.json");
const good = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
/** The fixture with one edit, checked. */
const broken = (edit, options) => { const m = good(); edit(m); return checkModel(m, options); };
const has = (result, pattern) => assert.ok(result.errors.some((e) => pattern.test(e)), `expected ${pattern} in\n  ${result.errors.join("\n  ")}`);

test("the worked example passes with nothing to say", () => {
  assert.deepEqual(checkModel(good()), { errors: [], warnings: [] });
});

test("something that is not a model is one error, not a crash", () => {
  for (const value of [null, [], "x", 3]) assert.deepEqual(checkModel(value).errors, ["the model is not a JSON object"]);
  assert.ok(checkModel({}).errors.length > 3, "an empty object names what is missing");
});

test("the schema, the title and the one-sentence claim are required", () => {
  has(broken((m) => { m.schema = 2; }), /schema is 2/);
  has(broken((m) => { delete m.title; }), /title is missing/);
  has(broken((m) => { m.claim = "  "; }), /claim is missing/);
  has(broken((m) => { m.claim = "It answers first. Then it works."; }), /more than one sentence/);
  has(broken((m) => { m.claim = "x".repeat(LIMITS.claim + 1); }), /claim is 141 characters/);
  has(broken((m) => { m.implication = ""; }), /implication is empty/);
});

test("the mechanism is one sentence and the lens is one of eight, and a round requires both", () => {
  assert.deepEqual(LENSES, ["structure", "path", "time", "field", "transformation", "difference", "cases", "scale"]);
  has(broken((m) => { m.lens = "flow"; }), /lens "flow" is not one of structure, path, time/);
  has(broken((m) => { m.mechanism = "It queues. Then it works."; }), /mechanism is more than one sentence/);
  has(broken((m) => { m.mechanism = "x".repeat(161); }), /mechanism is 161 characters, over 160/);
  has(broken((m) => { m.mechanism = " "; }), /mechanism is empty/);
  const bare = (options) => broken((m) => { delete m.mechanism; delete m.lens; }, options);
  assert.deepEqual(bare().errors, [], "a model checked on its own may leave them out");
  has(bare({ requireMethod: true }), /mechanism is missing: one sentence with a verb/);
  has(bare({ requireMethod: true }), /lens is missing: one of structure/);
});

test("ids are kebab-case and unique within their list", () => {
  has(broken((m) => { m.entities[0].id = "Your_App"; }), /entity id "Your_App" is not kebab-case/);
  has(broken((m) => { m.entities[1].id = "app"; }), /entity id 'app' is used twice/);
  has(broken((m) => { m.flows[1].id = "upload"; }), /flow id 'upload' is used twice/);
  has(broken((m) => { m.beats[1].id = "answer"; }), /beat id 'answer' is used twice/);
});

test("a figure holds two to nine entities, at most four of them hued", () => {
  has(broken((m) => { m.entities = m.entities.slice(0, 1); }), /1 entities: a figure holds 2 to 9/);
  has(broken((m) => { for (let i = 0; i < 6; i++) m.entities.push({ id: `extra-${i}`, label: "Extra", kind: "service" }); }), /11 entities/);
  has(broken((m) => { m.entities[0].hue = "orange"; }), /hue 'orange' is not one of blue, green, violet, yellow, pink/);
  has(broken((m) => { m.entities.forEach((e, i) => { e.hue = HUES[i % HUES.length]; }); }), /5 entities carry a hue: at most 4/);
  assert.match(broken((m) => { m.entities[3].hue = "blue"; }).warnings[0], /one entity carries a hue: a hue tells things apart/);
  assert.deepEqual(broken((m) => { m.entities[3].hue = "blue"; m.entities[4].hue = "green"; }).warnings, []);
  const long = broken((m) => { m.entities[0].label = "A label that is far too long to fit"; });
  assert.deepEqual(long.errors, []);
  assert.match(long.warnings[0], /label is 35 characters/);
});

test("a note is short, and groups are for every entity or none", () => {
  has(broken((m) => { m.entities[0].note = "x".repeat(37); }), /entity 'app': note is 37 characters, over 36/);
  has(broken((m) => { m.entities[0].note = " "; }), /entity 'app': note is empty/);
  has(broken((m) => { m.entities[0].group = "Before"; }), /some entities have a group and some have none: every one, or none/);
  has(broken((m) => { m.entities.forEach((e, i) => { e.group = `side ${i % 4}`; }); }), /4 groups: a figure sets at most 3 arrangements side by side/);
  assert.deepEqual(broken((m) => { m.entities.forEach((e, i) => { e.group = i < 2 ? "Before" : "After"; }); }).errors, []);
});

test("a flow joins two different entities and has a known kind", () => {
  assert.deepEqual(FLOW_KINDS, ["write", "read", "event", "query"]);
  has(broken((m) => { m.flows[0].kind = "push"; }), /flow 'upload': kind "push" is not one of write, read, event, query/);
  has(broken((m) => { m.flows[0].to = "nowhere"; }), /flow 'upload': to 'nowhere' is not an entity/);
  has(broken((m) => { m.flows[0].to = "app"; }), /flow 'upload' goes from 'app' to itself/);
});

test("every entity and every flow is told by some beat", () => {
  has(broken((m) => { m.entities.push({ id: "cache", label: "Cache", kind: "store" }); }), /entity 'cache' is in no beat/);
  has(broken((m) => { m.beats[2].flows = []; }), /flow 'save' is in no beat/);
  has(broken((m) => { m.beats[0].focus.push("ghost"); }), /beat 'answer': focus 'ghost' is not an entity/);
  has(broken((m) => { m.beats[0].flows.push("ghost"); }), /beat 'answer': flow 'ghost' is not a flow/);
});

test("the beats are few, captioned, timed, and end on one rest beat", () => {
  has(broken((m) => { m.beats = [m.beats[0], m.beats.at(-1)]; }), /1 beats: a figure tells 2 to 7/);
  has(broken((m) => { m.beats.pop(); }), /only the last, is the rest beat/);
  has(broken((m) => { m.beats.unshift(m.beats.pop()); }), /only the last, is the rest beat/);
  has(broken((m) => { m.beats.at(-1).flows = ["save"]; }), /the rest beat 'rest' moves nothing/);
  has(broken((m) => { delete m.beats[0].plain; }), /beat 'answer' has no plain caption/);
  has(broken((m) => { m.beats[0].plain = "x".repeat(141); }), /plain caption is 141 characters/);
  has(broken((m) => { delete m.beats[1].technical; }), /2 of 3 beats have a technical caption: every beat, or none/);
  has(broken((m) => { m.beats[0].ms = 500; }), /beat 'answer': ms 500 is outside 1200 to 8000/);
  has(broken((m) => { m.beats[0].ms = "3000"; }), /ms "3000" is outside/);
  has(broken((m) => { m.beats[0].focus = []; }), /beat 'answer' focuses on nothing/);
  has(broken((m) => { for (let i = 0; i < 4; i++) m.beats.splice(1, 0, { ...m.beats[0], id: `more-${i}`, ms: 8000 }); }), /the loop runs 42400 ms, over 30000/);
  assert.deepEqual(broken((m) => { for (const b of m.beats) delete b.technical; }).errors, [], "no technical track at all is fine");
});

test("the hero frame is a told beat, at a point inside it", () => {
  has(broken((m) => { delete m.hero; }), /hero is missing/);
  has(broken((m) => { m.hero.beat = "nope"; }), /hero beat 'nope' is not a beat/);
  has(broken((m) => { m.hero.beat = "rest"; }), /cannot be the rest beat/);
  has(broken((m) => { m.hero.at = 1.5; }), /hero at 1\.5 is not between 0 and 1/);
});

test("a source is path:line, and against a repo the file and the line exist", (t) => {
  const repo = tempDir(t, "pt-model-");
  write(repo, "src/api.ts", "one\ntwo\nthree\n");
  has(broken((m) => { m.entities[1].source = "src/api.ts"; }), /source 'src\/api\.ts' is not path:line/);
  assert.deepEqual(broken((m) => { m.entities[1].source = "src/api.ts:2"; }, { repo }).errors, []);
  assert.deepEqual(broken((m) => { m.entities[1].source = "anything:9"; }).errors, [], "with no repo, only the shape is checked");
  has(broken((m) => { m.entities[1].source = "src/gone.ts:2"; }, { repo }), /no such file/);
  has(broken((m) => { m.entities[1].source = "src/api.ts:40"; }, { repo }), /the file has 4 lines/);
  has(broken((m) => { m.entities[1].source = "../outside.ts:1"; }, { repo }), /outside the repo/);
  const strict = checkModel(good(), { repo, requireSource: true });
  assert.equal(strict.errors.length, 10, "five entities and five flows, none sourced");
  assert.match(strict.errors[0], /entity 'app' has no source: a figure drawn from code names the file and line/);
});

test("the CLI prints one line per finding and exits 0, 1 or 2", (t) => {
  const dir = tempDir(t, "pt-model-cli-");
  const ok = runNode(PT, ["model", "check", FIXTURE]);
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, `ok: ${FIXTURE} (5 entities, 5 flows, 3 beats)\n`);

  const m = good();
  m.flows[0].kind = "push";
  m.entities[0].label = "A label that is far too long to fit";
  const file = write(dir, "model.json", JSON.stringify(m));
  const failed = runNode(PT, ["model", "check", file]);
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, [
    `error: flow 'upload': kind "push" is not one of write, read, event, query`,
    "warning: entity 'app': label is 35 characters, over 28, and may not fit",
    `${file}: 1 error`,
    "",
  ].join("\n"));

  const json = JSON.parse(runNode(PT, ["model", "check", file, "--json"]).stdout);
  assert.equal(json.ok, false);
  assert.equal(json.errors.length, 1);

  assert.equal(runNode(PT, ["model", "check", write(dir, "broken.json", "{ nope")]).status, 1, "not JSON is a failed check");
  const missing = runNode(PT, ["model", "check", path.join(dir, "absent.json")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  assert.equal(runNode(PT, ["model"]).status, 2, "no subcommand is a usage error");
  assert.equal(runNode(PT, ["model", "check", FIXTURE, "--nope"]).status, 2);
  const help = runNode(PT, ["model", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: node pt\.mjs model check/);
});

test("pt with no command, or one it does not know, prints the usage and exits 2", async () => {
  const none = runNode(PT, []);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /^usage: node pt\.mjs <command>/);
  const unknown = runNode(PT, ["paint"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /^unknown command 'paint'\nusage:/);
  const help = runNode(PT, ["--help"]);
  assert.equal(help.status, 0);
  for (const name of Object.keys(COMMANDS)) assert.match(help.stdout, new RegExp(`^  ${name} `, "m"));

  const said = [];
  assert.equal(await main(["paint"], { out: (s) => said.push(s), err: (s) => said.push(s) }), 2, "importing pt.mjs does not run it");
  assert.match(said.join(""), /unknown command 'paint'/);
});

test("every command in the table has its file and its function", async () => {
  for (const [name, [file, fn]] of Object.entries(COMMANDS)) {
    const mod = await import(`../../../plugins/agentic-engineering/skills/picture-this/scripts/commands/${file}.mjs`);
    assert.equal(typeof mod[fn], "function", `${name}: commands/${file}.mjs exports ${fn}`);
  }
});

test("a thing may be inside another, and nothing is inside itself", () => {
  assert.deepEqual(broken((m) => { m.entities[2].parent = "api"; }).errors, []);
  has(broken((m) => { m.entities[2].parent = "ghost"; }), /entity 'queue': parent 'ghost' is not an entity/);
  has(broken((m) => { m.entities[2].parent = "queue"; }), /entity 'queue' is its own parent/);
  has(broken((m) => { m.entities[1].parent = "queue"; m.entities[2].parent = "worker"; m.entities[3].parent = "api"; }), /entity 'api' is inside itself: its parents come back round to it/);
});

test("a thing that comes into being is born in a told beat, and is not told before it", () => {
  assert.deepEqual(broken((m) => { m.entities[3].born = "work"; }).errors, []);
  has(broken((m) => { m.entities[3].born = "later"; }), /entity 'worker': born 'later' is not a beat that is told/);
  has(broken((m) => { m.entities[3].born = "rest"; }), /entity 'worker': born 'rest' is not a beat that is told/);
  has(broken((m) => { m.entities[1].born = "work"; }), /beat 'answer' tells 'api' before it is born in 'work'/);
});

test("a repeated unit is a few, standing for the many", () => {
  assert.deepEqual(LIMITS.repeat, [2, 24]);
  assert.deepEqual(broken((m) => { m.entities[3].repeat = 3; }).errors, []);
  for (const bad of [1, 25, 2.5, "3"]) has(broken((m) => { m.entities[3].repeat = bad; }), /entity 'worker': repeat .* is not a whole number from 2 to 24/);
});

test("a quantity names its beats, stays between 0 and its max, and takes one value or a short course per beat", () => {
  const withQuantity = (edit = () => {}, options) => broken((m) => {
    m.quantities = [{ id: "waiting", label: "Jobs waiting", of: "queue", unit: "jobs", max: 8, values: { answer: 3, work: [3, 6, 1] } }];
    edit(m.quantities[0], m);
  }, options);
  assert.deepEqual(withQuantity().errors, []);
  has(withQuantity((q) => { q.id = "Jobs Waiting"; }), /quantity id "Jobs Waiting" is not kebab-case/);
  has(withQuantity((q) => { delete q.label; }), /quantity 'waiting' has no label/);
  has(withQuantity((q) => { q.of = "ghost"; }), /quantity 'waiting': of 'ghost' is not an entity/);
  has(withQuantity((q) => { q.max = 0; }), /quantity 'waiting': max 0 is not a number above 0/);
  has(withQuantity((q) => { q.values = {}; }), /quantity 'waiting' has no values/);
  has(withQuantity((q) => { q.values.later = 2; }), /quantity 'waiting': 'later' is not a beat/);
  has(withQuantity((q) => { q.values.work = 9; }), /quantity 'waiting': 9 in beat 'work' is over its max, 8/);
  has(withQuantity((q) => { q.values.work = -1; }), /quantity 'waiting': -1 in beat 'work' is not a number from 0 up/);
  has(withQuantity((q) => { q.values.work = Array(LIMITS.course + 1).fill(1); }), /beat 'work' has 9 values: one, or a course of 2 to 8/);
  has(withQuantity((q, m) => { m.quantities = Array.from({ length: 5 }, (_, i) => ({ ...q, id: `q-${i}` })); }), /5 quantities: a figure follows at most 4/);
  has(broken((m) => { m.quantities = { waiting: 1 }; }), /quantities is not a list/);
});

test("data is named tables of one kind each: a series, a grid of cells, or rows that name real things", () => {
  const withData = (data) => broken((m) => { m.data = data; });
  assert.deepEqual(withData({ sizes: [1, 2, 3], heat: [[0, 1], [2, 3]], jobs: [{ id: "j1", of: "queue", at: "work", label: "resize", big: true, kb: 240 }] }).errors, []);
  has(withData([1, 2]), /data is not an object of named tables/);
  has(withData({ "Cell Values": [1] }), /data 'Cell Values': the name is not kebab-case/);
  has(withData({ heat: [] }), /data 'heat' is not a list with something in it/);
  has(withData({ heat: [[1, 2], [3]] }), /data 'heat': its rows are not all 2 cells wide/);
  has(withData({ heat: [1, [2]] }), /data 'heat' mixes kinds/);
  has(withData({ jobs: [{ id: "a" }, { id: "a" }] }), /data 'jobs': row id 'a' is used twice/);
  has(withData({ jobs: [{ of: "ghost" }] }), /data 'jobs': row 1, of 'ghost' is not an entity/);
  has(withData({ jobs: [{ at: "later" }] }), /data 'jobs': row 1, at 'later' is not a beat/);
  has(withData({ jobs: [{ tags: ["a"] }] }), /data 'jobs': row 1, 'tags' is not a word, a number, or true or false/);
  has(withData({ heat: Array.from({ length: 25 }, () => Array(25).fill(1)) }), /625 values of data: a figure draws a few standing for the many, at most 600/);
  has(withData(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`t-${i}`, [1]]))), /9 tables of data: a figure reads at most 8/);
});

test("every model the plugin ships passes, the ones written before these fields among them", () => {
  const dirs = [path.join(PLUGIN, "blank"), ...fs.readdirSync(path.join(PLUGIN, "studies")).map((name) => path.join(PLUGIN, "studies", name))];
  for (const dir of dirs) {
    const model = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));
    assert.deepEqual(checkModel(model, { requireMethod: true }).errors, [], path.basename(dir));
  }
});
