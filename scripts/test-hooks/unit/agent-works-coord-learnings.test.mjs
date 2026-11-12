// agent-works `aw learn`: learnings shared by every project of the machine.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { load, world } from "./agent-works-coord-support.mjs";

const learnings = await load("scripts/coord/learnings.mjs");

const FAKE_KEY = `AKIA${"ABCDEFGHIJKLMNOP"}`; // shaped like a credential, and nothing more

function add(w, topic, tags, text, options) {
  const r = w.aw(["learn", "add", "--topic", topic, "--tags", tags, "--text", text], options);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split(":")[0];
}
const ids = (rows) => rows.map((r) => r.id);

test("agent-works learn: add, show, and read from another project", (t) => {
  const w = world(t);
  const r = w.aw(["learn", "add", "--topic", "Linker runs out of memory above eight jobs", "--tags", "Linker, windows,build",
    "--text", "Measured on a 64 GB machine: twelve link jobs at once exhaust memory.\nCap the job count at eight."]);
  assert.equal(r.stdout, "0001: shared with every project on this machine (0001-linker-runs-out-of-memory-above-eight-jobs.md)\n");
  assert.deepEqual(fs.readdirSync(path.join(w.home, "learnings")), ["0001-linker-runs-out-of-memory-above-eight-jobs.md"]);
  const day = fs.readFileSync(path.join(w.home, "learnings", "0001-linker-runs-out-of-memory-above-eight-jobs.md"), "utf8").match(/created: (\S+)/)[1];
  const other = w.project("other");
  const shown = w.aw(["learn", "show", "1"], { cwd: other });
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(shown.stdout, [
    "---", "id: 0001", "topic: Linker runs out of memory above eight jobs", "tags: [linker, windows, build]", "source: proj",
    `created: ${day}`, `updated: ${day}`, "---", "",
    "Measured on a 64 GB machine: twelve link jobs at once exhaust memory.", "Cap the job count at eight.", "",
  ].join("\n"));
  const doc = w.doc(["learn", "show", "L0001", "--json"], { cwd: other });
  assert.deepEqual([doc.id, doc.tags, doc.source, doc.file], ["0001", ["linker", "windows", "build"], "proj", "0001-linker-runs-out-of-memory-above-eight-jobs.md"]);
  assert.equal(doc.created, doc.updated);
  assert.match(doc.created, /^\d{4}-\d\d-\d\d$/);
  const none = w.aw(["learn", "show", "9"]);
  assert.deepEqual([none.status, none.stderr], [2, "aw learn: learn: no learning '9' (aw learn list shows them)\n"]);
});

test("agent-works learn: the topic limit is said with the length given", (t) => {
  const w = world(t);
  const r = w.aw(["learn", "add", "--topic", "x".repeat(121), "--tags", "t", "--text", "Body."]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--topic is 121 characters, and a topic is one line of at most 120/);
  assert.equal(w.aw(["learn", "add", "--topic", "x".repeat(120), "--tags", "t", "--text", "Body."]).status, 0);
  assert.equal(w.aw(["learn", "add", "--topic", "two\nlines", "--text", "Body."]).status, 2);
  assert.ok(w.aw(["learn", "add", "--help"]).stdout.includes("120 characters at most"));
  assert.ok(w.aw(["learn", "--help"]).stdout.includes("at most 120 characters"));
});

test("agent-works learn: search ranks the topic above the tags above the body", (t) => {
  const w = world(t);
  const body = add(w, "Shell mangles paths with spaces", "shell", "Quote every path; the worktree tool does not.");
  const tag = add(w, "Parallel checkouts need their own build folders", "worktree, git", "Build outputs are not shared.");
  const topic = add(w, "A worktree has no installed dependencies", "git", "Install them after creating one.");
  const found = (...args) => ids(w.doc(["learn", "search", ...args, "--json"]).results);
  assert.deepEqual(found("worktree"), [topic, tag, body]);
  assert.equal(found("WORKTREE", "dependencies")[0], topic);
  assert.deepEqual(found("worktree", "--tag", "git"), [topic, tag]);
  assert.deepEqual(found("worktree", "--limit", "1"), [topic]);
  assert.deepEqual(found("--tag", "shell"), [body]);
  assert.deepEqual(found("paths", "spaces", "quote", "nothing-matches-this"), [body], "most of the terms is enough");
  const rows = w.doc(["learn", "search", "worktree", "--json"]).results;
  assert.deepEqual(rows.map((r) => [r.matched, r.score]), [[1, 6], [1, 4], [1, 1]]);
  assert.ok(rows.every((r) => !("body" in r)), "a search lists, it does not print bodies");
  const nothing = w.aw(["learn", "search", "zebra"]);
  assert.deepEqual([nothing.status, nothing.stdout], [1, "(nothing found)\n"]);
  const text = w.aw(["learn", "search", "worktree"]).stdout;
  assert.ok(text.startsWith(`${topic}  A worktree has no installed dependencies [git]  (proj, `));
  assert.ok(text.endsWith("read one with: aw learn show <id>\n"));
});

test("agent-works learn: list, edit and retire", (t) => {
  const w = world(t);
  const a = add(w, "First fact", "os", "Body one.");
  const b = add(w, "Second fact", "tool, os", "Body two.");
  const listed = (...args) => ids(w.doc(["learn", "list", ...args, "--json"]).learnings);
  assert.deepEqual(listed(), [a, b]);
  assert.deepEqual(listed("--tag", "tool"), [b]);
  const edited = w.aw(["learn", "edit", a, "--topic", "First fact, corrected", "--tags", "os,kernel", "--text", "Body one, corrected."]);
  assert.deepEqual([edited.status, edited.stdout], [0, `${a}: updated\n`], edited.stderr);
  const doc = w.doc(["learn", "show", a, "--json"]);
  assert.deepEqual([doc.topic, doc.tags, doc.body, doc.source], ["First fact, corrected", ["os", "kernel"], "Body one, corrected.", "proj"]);
  assert.equal(w.aw(["learn", "edit", a]).status, 2, "nothing to change");
  assert.equal(w.aw(["learn", "edit", a, "--text", `key ${FAKE_KEY}`]).status, 2);
  assert.equal(w.doc(["learn", "show", a, "--json"]).body, "Body one, corrected.", "a refused edit changes nothing");
  const retired = w.aw(["learn", "retire", b, "--reason", "fixed in the tool's next release"]);
  assert.deepEqual([retired.status, retired.stdout], [0, `${b}: retired (kept, left out of search and list unless --all)\n`], retired.stderr);
  assert.deepEqual(listed(), [a]);
  assert.equal(w.aw(["learn", "search", "second"]).status, 1);
  assert.deepEqual(ids(w.doc(["learn", "search", "second", "--all", "--json"]).results), [b]);
  const shown = w.aw(["learn", "show", b]).stdout;
  assert.match(shown, /retired: \d{4}-\d\d-\d\d\nreason: fixed in the tool's next release\n---/);
  assert.match(w.aw(["learn", "list", "--all"]).stdout, new RegExp(`^${b}  Second fact \\[tool, os\\]  \\(proj, \\S+\\)  RETIRED$`, "m"));
  assert.equal(w.aw(["learn", "list"], { cwd: w.project("other") }).stdout.split("\n").length - 1, 1, "every project reads the one store");
  assert.equal(w.aw(["learn", "retire", b, "--reason", `see ${FAKE_KEY}`]).status, 2);
});

test("agent-works learn: what looks like a credential is refused, and the refusal does not repeat it", (t) => {
  const w = world(t);
  const texts = [
    `The key is ${FAKE_KEY} in the settings.`, "password: hunter2-hunter2", "-----BEGIN RSA PRIVATE KEY-----\nabc",
    "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'", "clone https://someone:s3cretpass@host.example/repo.git",
    `token ghp_${"a".repeat(36)}`,
  ];
  for (const text of texts) {
    const r = w.aw(["learn", "add", "--topic", "A thing", "--tags", "x", "--text", text]);
    assert.equal(r.status, 2, text);
    assert.match(r.stderr, /refused, this looks like it holds /);
    assert.ok(!r.stderr.includes(text.split(/\s+/).at(-1)), "the refusal does not repeat the value");
  }
  assert.equal(w.aw(["learn", "add", "--topic", `About ${FAKE_KEY}`, "--text", "fine body"]).status, 2);
  assert.ok(!fs.existsSync(path.join(w.home, "learnings")) || !fs.readdirSync(path.join(w.home, "learnings")).some((n) => n.endsWith(".md")));
  assert.deepEqual(learnings.secretsIn("Set the password in the environment, never in the file.\nUse a token."), []);
  assert.deepEqual(learnings.secretsIn("line one\napi_key = 'abcdef123456'"), ["a password or secret written out (line 2)"]);
  assert.deepEqual(learnings.secretsIn(`${FAKE_KEY}\n\nsk-${"b".repeat(24)}`), ["an access key id (line 1)", "an API key (line 3)"]);
});

test("agent-works learn: the size cap, and usage", (t) => {
  const w = world(t);
  const long = w.aw(["learn", "add", "--topic", "Too long", "--text", "x".repeat(6001)]);
  assert.equal(long.status, 2);
  assert.match(long.stderr, /6001 characters, and a learning holds at most 6000 \(coordination\.learningChars\)/);
  w.writeConfig(w.proj, { coordination: { learningChars: 50 } });
  assert.equal(w.aw(["learn", "add", "--topic", "Short cap", "--text", "y".repeat(51)]).status, 2);
  assert.equal(w.aw(["learn", "add", "--topic", "No body"]).status, 2);
  assert.equal(w.aw(["learn", "add", "--topic", "t".repeat(121), "--text", "body"]).status, 2);
  assert.equal(w.aw(["learn", "add", "--text", "no topic"]).status, 2);
  assert.equal(w.aw(["learn", "add", "--topic", "Empty", "--text", "  "]).status, 2);
  const bare = w.aw(["learn"]);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /^usage: aw learn /);
  assert.equal(w.aw(["learn", "forget", "1"]).status, 2);
  assert.equal(w.aw(["learn", "list"]).stdout, "(no learnings)\n");
  assert.ok(!fs.existsSync(path.join(w.home, "learnings")), "a refusal writes nothing");
});

test("agent-works learn: the body from a file or from stdin, and a topic that needs quoting", (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.tmp, "lesson.md"), "From a file.\n\n- with a list\n");
  const first = w.aw(["learn", "add", "--topic", "From file", "--from-file", path.join(w.tmp, "lesson.md")]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(w.doc(["learn", "show", "1", "--json"]).body, "From a file.\n\n- with a list");
  const second = w.aw(["learn", "add", "--topic", '"Quoted" topic: with a colon', "--from-file", "-"], { stdin: "From stdin.\n" });
  assert.equal(second.status, 0, second.stderr);
  const doc = w.doc(["learn", "show", "2", "--json"]);
  assert.deepEqual([doc.body, doc.topic, doc.tags], ["From stdin.", "'Quoted' topic: with a colon", []]);
  const missing = w.aw(["learn", "add", "--topic", "Missing", "--from-file", path.join(w.tmp, "nope.md")]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /learn: cannot read /);
  fs.writeFileSync(path.join(w.proj, "near.md"), "Beside the project.\n");
  assert.equal(w.aw(["learn", "add", "--topic", "Relative", "--from-file", "near.md"]).status, 0, "a relative file is read from where the command runs");
});

test("agent-works learn: concurrent adds get distinct ids", async (t) => {
  const w = world(t);
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => w.spawn(["learn", "add", "--topic", `Fact number ${i}`, "--tags", "race", "--text", `Body ${i}.`]).done));
  assert.deepEqual(runs.map((r) => r.status), Array(8).fill(0), runs.map((r) => r.stderr).join("\n"));
  const rows = w.doc(["learn", "list", "--json"]).learnings;
  assert.deepEqual(ids(rows), ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]);
  assert.deepEqual(rows.map((r) => r.topic).sort(), Array.from({ length: 8 }, (_, i) => `Fact number ${i}`));
  assert.deepEqual(fs.readdirSync(path.join(w.home, "learnings")).filter((n) => !n.endsWith(".md")), [], "no lock or temp file is left behind");
});
