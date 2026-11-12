// agent-works `aw note` / `aw notes` and `aw claim` / `aw claims`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { load, sleep, world } from "./agent-works-coord-support.mjs";

const store = await load("scripts/coord/store.mjs");
const claims = await load("scripts/coord/claims.mjs");

test("agent-works note: a note is one line on the project's log", (t) => {
  const w = world(t);
  const r = w.aw(["note", "merged #12:  pull before\n rendering", "--as", "a"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ {2}a {2}merged #12: pull before rendering\n$/);
  assert.equal(w.aw(["note", "second", "--as", "b"]).status, 0);
  const { notes } = w.doc(["notes", "5", "--json"]);
  assert.deepEqual(notes.map((n) => [n.agent, n.text, n.project, n.where]), [["a", "merged #12: pull before rendering", w.id(), "proj"], ["b", "second", w.id(), "proj"]]);
  assert.equal(w.doc(["notes", "1", "--json"]).notes.length, 1);
  assert.deepEqual(w.aw(["notes", "1"]).stdout.trim().split("  ").slice(1), ["b", "second"]);
  assert.equal(w.aw(["notes", "0"]).stdout, "(no notes)\n");
  assert.equal(w.aw(["notes"], { cwd: w.project("other") }).stdout, "(no notes)\n");
  assert.equal(fs.readFileSync(path.join(w.home, "projects", w.id(), "notes.log"), "utf8"), `${r.stdout}${w.aw(["notes", "1"]).stdout}`);
  const doc = w.doc(["note", "third", "--as", "c", "--json"]);
  assert.deepEqual([doc.where, doc.line.split("  ").slice(1)], [w.id(), ["c", "third"]]);
});

test("agent-works note: the argument shape other plugins' skills name keeps working", (t) => {
  const w = world(t);
  const r = w.aw(["note", "text"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.endsWith(`  session-${process.pid}  text\n`));
});

test("agent-works note: a long note is refused with a hint", (t) => {
  const w = world(t);
  const r = w.aw(["note", "x".repeat(201)]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, "aw note: note: 201 characters, and a note is one line of at most 200 (budgets.noteChars). "
    + "Put the detail in a kanban card, a memory or a file and point at it.\n");
  assert.equal(w.aw(["note", "x".repeat(200)]).status, 0);
  assert.equal(w.aw(["note", "   "]).status, 2);
  assert.equal(w.aw(["note"]).status, 2);
  assert.equal(w.aw(["note", "two", "texts"]).status, 2);
  assert.ok(w.aw(["note", "--as", "a", "--", "- starts with a dash"]).stdout.endsWith("  a  - starts with a dash\n"));
  w.writeConfig(w.proj, { budgets: { noteChars: 20 } });
  assert.equal(w.aw(["note", "x".repeat(21)]).status, 2);
  assert.equal(w.doc(["notes", "--json"]).notes.length, 2, "the refused ones were not written");
  assert.ok(w.aw(["note", "--help"]).stdout.includes("budgets.noteChars"));
});

test("agent-works note: notes across projects and the machine", async (t) => {
  const w = world(t);
  const other = w.project("other");
  w.aw(["note", "from proj", "--as", "a1"]);
  await sleep(1100); // stamps have second precision, and --all sorts by them
  w.aw(["note", "gpu driver updated: reboot pending", "--machine", "--as", "b1"], { cwd: other });
  await sleep(1100);
  w.aw(["note", "from other", "--as", "b1"], { cwd: other });
  const texts = (args, options) => w.doc(["notes", ...args, "--json"], options).notes.map((n) => n.text);
  assert.deepEqual(texts([]), ["from proj"]);
  assert.deepEqual(texts(["--project", "other"]), ["from other"]);
  assert.deepEqual(texts(["--project", "oth"]), ["from other"]);
  const machine = w.doc(["notes", "--machine", "--json"]).notes;
  assert.deepEqual(machine.map((n) => [n.agent, n.text, n.project, n.where]), [["b1@other", "gpu driver updated: reboot pending", null, "machine"]]);
  assert.ok(fs.existsSync(path.join(w.home, "notes.log")), "the machine's log sits at the top of the store");
  const everything = w.doc(["notes", "--all", "--json"]).notes;
  assert.deepEqual(everything.map((n) => [n.where, n.text]), [["proj", "from proj"], ["machine", "gpu driver updated: reboot pending"], ["other", "from other"]]);
  assert.match(w.aw(["notes", "--all"]).stdout, /\[machine\] {2}b1@other {2}gpu driver/);
  assert.equal(w.doc(["notes", "2", "--all", "--json"]).notes.length, 2);
  const none = w.aw(["notes", "--project", "nope"]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /project 'nope': none seen on this machine/);
  assert.equal(w.aw(["notes", "--all", "--machine"]).status, 2);
  assert.equal(w.aw(["notes", "many"]).status, 2);
});

test("agent-works note: the log rotates", (t) => {
  const w = world(t, { coordination: { logBytes: 400 } });
  for (let i = 0; i < 12; i++) assert.equal(w.aw(["note", `note ${String(i).padStart(2, "0")} ${"z".repeat(60)}`, "--as", "a"]).status, 0);
  assert.deepEqual(fs.readdirSync(path.join(w.home, "projects", w.id())).sort(), ["notes.log", "notes.log.1"]);
  const texts = w.doc(["notes", "50", "--json"]).notes.map((n) => n.text.split(" ")[1]);
  assert.equal(texts.at(-1), "11");
  assert.deepEqual(texts, [...texts].sort());
  assert.ok(texts.length < 12);
});

const COUNTERS = { counters: { schema: { note: "the migration number" } } };
const value = (w, args, options) => w.doc(["claim", ...args, "--json"], options).value;

test("agent-works claim: values are handed out once", (t) => {
  const w = world(t, COUNTERS);
  const first = w.aw(["claim", "schema", "--as", "a"]);
  assert.equal(first.status, 2, "nothing is known about the counter yet");
  assert.match(first.stderr, /nothing is known about 'schema' yet: say what the code holds now \(--after N\)/);
  assert.equal(value(w, ["schema", "--after", "28", "--for", "branch one", "--as", "a"]), 29);
  assert.equal(value(w, ["schema", "--as", "b"]), 30);
  const again = w.doc(["claim", "schema", "--as", "a", "--json"]);
  assert.deepEqual([again.value, again.renewed, again.claimed, again.agent, again.warnings], [29, true, true, "a", []], "asking again: the same number");
  const taken = w.aw(["claim", "schema", "--value", "30", "--as", "a"]);
  assert.equal(taken.status, 1);
  assert.match(taken.stderr, /^schema 30 is claimed by b \(for: \?; until \S+\)\. Take the next one: aw claim schema\n$/);
  const landed = w.aw(["claim", "schema", "--value", "12", "--as", "c"]);
  assert.equal(landed.status, 1);
  assert.match(landed.stderr, /schema 12 has landed already \(the highest landed value is 28\)/);
  assert.equal(value(w, ["schema", "--value", "40", "--as", "c"]), 40);
  assert.equal(value(w, ["schema", "--as", "d"]), 41);
  const text = w.aw(["claims"]).stdout;
  assert.match(text, /^schema: landed up to 28 {2}\(the migration number\)\n {4}29 {2}a {2}until \S+: "branch one"\n {4}30 {2}b {2}until \S+: "\?"\n/);
  const { counters, project } = w.doc(["claims", "--json"]);
  assert.equal(project, w.id());
  assert.deepEqual(counters.schema.claims.map((c) => c.value), [29, 30, 40, 41]);
  const said = w.aw(["claim", "schema", "--as", "e"]).stdout;
  assert.match(said, /^schema: 42 is e's until \S+\nwhen the merge has landed: aw claim schema --release --landed\n$/);
});

test("agent-works claim: release frees a value unless it landed", (t) => {
  const w = world(t, COUNTERS);
  assert.equal(value(w, ["schema", "--after", "5", "--as", "a"]), 6);
  assert.equal(value(w, ["schema", "--as", "b"]), 7);
  const none = w.aw(["claim", "schema", "--release", "--as", "c"]);
  assert.deepEqual([none.status, none.stderr], [1, "schema: c holds no claim\n"]);
  const landed = w.aw(["claim", "schema", "--release", "--landed", "--as", "b"]);
  assert.deepEqual([landed.status, landed.stdout], [0, "schema: b released 7 (landed)\n"], landed.stderr);
  assert.equal(w.aw(["claim", "schema", "--release", "--as", "a"]).stdout, "schema: a released 6 (free again)\n", "the work was dropped: 6 is free");
  assert.deepEqual(w.doc(["claims", "--json"]).counters.schema, { floor: 7, claims: [] });
  assert.equal(value(w, ["schema", "--as", "c"]), 8, "above what landed; the gap at 6 stays a gap");
  assert.deepEqual(JSON.parse(fs.readFileSync(claims.claimsPath(w.home, w.id()), "utf8")).counters.schema.floor, 7);
});

test("agent-works claim: a claim ends after its time", async (t) => {
  const w = world(t, COUNTERS);
  assert.equal(value(w, ["schema", "--after", "1", "--hours", "0", "--as", "a"]), 2);
  await sleep(2100);
  assert.deepEqual(w.doc(["claims", "--json"]).counters.schema.claims, []);
  assert.equal(value(w, ["schema", "--as", "b"]), 2, "free again");
  const doc = w.doc(["claim", "schema", "--as", "c", "--json"]);
  assert.ok(Math.abs(store.parseIso(doc.until) - Date.now() / 1000 - 72 * 3600) < 120);
});

test("agent-works claim: counters are per project, and an undeclared one warns", (t) => {
  const w = world(t, COUNTERS);
  const other = w.project("other");
  assert.equal(value(w, ["schema", "--after", "10", "--as", "a"]), 11);
  const r = w.aw(["claim", "schema", "--after", "3", "--as", "a"], { cwd: other });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^schema: 4 is a's/);
  assert.equal(r.stderr, "aw claim: 'schema' is not declared under \"counters\" in .agents/agent-works.json: claimed all the same\n", "other has no config");
  assert.doesNotMatch(w.aw(["claim", "schema", "--as", "a"]).stderr, /not declared/);
  assert.equal(w.aw(["claims"], { cwd: w.project("third") }).stdout, "(no counters)\n");
  const everything = w.doc(["claims", "--all", "--json"]).projects;
  assert.deepEqual(Object.values(everything).filter((c) => c.schema).map((c) => c.schema.claims[0].value).sort((a, b) => a - b), [4, 11]);
  assert.match(w.aw(["claims", "--all"]).stdout, /^other\n {2}schema: landed up to 3\n {6}4 {2}a {2}until /);
  assert.equal(w.aw(["claim", "bad/name", "--after", "1"]).status, 2);
  assert.equal(w.aw(["claim", "schema", "--after", "soon"]).status, 2);
  assert.equal(w.aw(["claim"]).status, 2);
  assert.equal(w.aw(["claims", "--help"]).status, 0);
});

test("agent-works claim: the argument shape other plugins' skills name keeps working", (t) => {
  const w = world(t, { counters: { counter: {} } });
  claims.claim(w.home, w.id(), "counter", "someone", { after: 0 });
  const r = w.aw(["claim", "counter"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^counter: 2 is session-${process.pid}'s until `));
});

test("agent-works claim: concurrent claims get distinct values", async (t) => {
  const w = world(t, COUNTERS);
  assert.equal(value(w, ["schema", "--after", "100", "--as", "seed"]), 101);
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => w.spawn(["claim", "schema", "--as", `a${i}`, "--json"]).done));
  assert.deepEqual(runs.map((r) => JSON.parse(r.stdout).value).sort((a, b) => a - b), [102, 103, 104, 105, 106, 107, 108, 109]);
});
