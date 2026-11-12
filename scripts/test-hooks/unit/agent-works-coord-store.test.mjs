// agent-works scripts/coord/store.mjs: the machine-wide store itself.
// Read-modify-write under contention between real processes, rotation,
// processes and their liveness, identity, the list of projects, and running a
// command as a program.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { NODE, PLUGIN, deadPid, load, world } from "./agent-works-coord-support.mjs";

const store = await load("scripts/coord/store.mjs");
const common = await load("lib/common.mjs");
const config = await load("lib/config.mjs");
const STORE_URL = JSON.stringify(pathToFileURL(path.join(PLUGIN, "scripts", "coord", "store.mjs")).href);

const INCREMENT = `
import * as store from ${STORE_URL};
const [file, times, who] = process.argv.slice(-3);
for (let i = 0; i < Number(times); i++) {
  store.updateJson(file, {}, (doc) => {
    doc.n = (doc.n ?? 0) + 1;
    (doc.who ??= []).push(who);
  });
}
`;

const APPEND = `
import * as store from ${STORE_URL};
const [file, times, who] = process.argv.slice(-3);
for (let i = 0; i < Number(times); i++) store.appendLine(file, who + " " + i + " " + "x".repeat(80));
`;

test("agent-works store: a read-modify-write loses nothing between processes", async (t) => {
  const w = world(t);
  const file = path.join(w.home, "counter.json");
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => w.script(INCREMENT, [file, 25, `p${i}`]).done));
  assert.deepEqual(runs.map((r) => r.status), Array(8).fill(0), runs.map((r) => r.stderr).join("\n"));
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(doc.n, 200);
  for (let i = 0; i < 8; i++) assert.equal(doc.who.filter((x) => x === `p${i}`).length, 25);
  assert.deepEqual(fs.readdirSync(w.home), ["counter.json"], "no lock or temp file is left behind");
});

test("agent-works store: appends from several processes all arrive whole", async (t) => {
  const w = world(t);
  const file = path.join(w.home, "log.txt");
  const runs = await Promise.all(Array.from({ length: 6 }, (_, i) => w.script(APPEND, [file, 30, `w${i}`]).done));
  assert.deepEqual(runs.map((r) => r.status), Array(6).fill(0), runs.map((r) => r.stderr).join("\n"));
  const lines = store.logLines(file);
  assert.equal(lines.length, 180);
  assert.ok(lines.every((line) => line.split(" ").length === 3 && line.endsWith("x".repeat(80))));
  const seen = new Set(lines.map((line) => line.split(" ").slice(0, 2).join(" ")));
  for (let wr = 0; wr < 6; wr++) for (let i = 0; i < 30; i++) assert.ok(seen.has(`w${wr} ${i}`), `w${wr} ${i}`);
});

test("agent-works store: a log rotates and keeps one older generation", (t) => {
  const w = world(t);
  const file = path.join(w.home, "notes.log");
  for (let i = 0; i < 40; i++) store.appendLine(file, `line ${String(i).padStart(2, "0")} ${"y".repeat(40)}`, 500);
  assert.ok(fs.statSync(`${file}.1`).isFile());
  assert.ok(fs.statSync(file).size < 600);
  const lines = store.logLines(file);
  assert.equal(lines.at(-1).split(" ")[1], "39");
  assert.deepEqual(lines, [...lines].sort(), "the older generation comes first");
  assert.ok(lines.length < 40, "what was older than that is gone");
});

test("agent-works store: a lock file left by a dead process is broken, a live holder's is respected", (t) => {
  const w = world(t);
  const target = path.join(w.home, "thing.json");
  fs.mkdirSync(w.home, { recursive: true });
  const lk = `${target}.lk`;
  fs.writeFileSync(lk, `${deadPid()} 0`);
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(lk, old, old);
  const started = Date.now();
  store.updateJson(target, {}, (doc) => { doc.ok = true; });
  assert.ok(Date.now() - started < 10_000);
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { ok: true });
  assert.ok(!fs.existsSync(lk));

  fs.writeFileSync(lk, `${process.pid} 0`);
  assert.throws(() => store.withFileLock(target, () => null, { timeout: 1 }), (e) => e instanceof common.AwError && /the store is busy/.test(e.message));
  fs.unlinkSync(lk);
});

test("agent-works store: the lock is given back when the change throws", (t) => {
  const w = world(t);
  const target = path.join(w.home, "thing.json");
  assert.throws(() => store.updateJson(target, {}, () => { throw new RangeError("mid-change"); }), RangeError);
  assert.deepEqual(fs.readdirSync(w.home), [], "neither the lock nor half a file is left");
});

test("agent-works store: a damaged file starts over instead of failing", (t) => {
  const w = world(t);
  const file = path.join(w.home, "resources.json");
  fs.mkdirSync(w.home, { recursive: true });
  fs.writeFileSync(file, "{ not json");
  store.updateJson(file, { leases: [] }, (doc) => { doc.leases.push(1); });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { leases: [1] });
  fs.writeFileSync(file, "[1, 2]");
  store.updateJson(file, { leases: [] }, (doc) => { doc.leases.push(2); });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { leases: [2] }, "a document of the wrong kind starts over too");
});

test("agent-works store: pid liveness", () => {
  assert.equal(store.pidAlive(process.pid), true);
  assert.equal(store.pidAlive(String(process.pid)), true);
  assert.equal(store.pidAlive(deadPid()), false);
  for (const bad of [0, -1, null, undefined, "x", "", 1.5, "12abc"]) assert.equal(store.pidAlive(bad), false, String(bad));
});

test("agent-works store: the process table and what runs", () => {
  const table = store.processTable();
  assert.ok(table.has(process.pid), "this process is listed");
  const [, name] = table.get(process.pid);
  assert.ok(name.length > 0);
  assert.ok(store.running([name.slice(0, 4).toUpperCase()]).includes(name), "by prefix, case ignored");
  assert.deepEqual(store.running([]), []);
  assert.deepEqual(store.running(["aw-no-such-process-xyz"]), []);
});

test("agent-works store: the session's process and the agent's name", (t) => {
  const w = world(t);
  const env = w.env();
  assert.equal(store.sessionPid(env), process.pid, "AW_SESSION_PID wins");
  delete env.AW_SESSION_PID;
  const found = store.sessionPid(env);
  assert.notEqual(found, process.pid);
  assert.ok(store.pidAlive(found));
  // The host names its own process to the shells and hooks it starts: one name for a session's every call, also
  // where the ancestry breaks. A process that is gone is not believed.
  assert.equal(store.sessionPid({ ...env, CLAUDE_PID: String(process.ppid) }), process.ppid);
  assert.equal(store.sessionPid({ ...env, CLAUDE_PID: String(deadPid()) }), found);
  assert.equal(store.sessionPid({ ...env, CLAUDE_PID: String(process.ppid), AW_SESSION_PID: "4242" }), 4242);

  const cfg = config.loadConfig(w.proj);
  const named = { ...env, AW_SESSION_PID: "4242" };
  assert.equal(store.identity(cfg, null, named), "session-4242");
  assert.equal(store.identity(cfg, "a-1", named), "a-1");
  assert.throws(() => store.identity(cfg, "Bad_Name", named), common.AwError);
  assert.equal(store.identity(cfg, null, { ...named, AW_AGENT: "Explore Agent_2" }), "explore-agent-2", "a name from the environment is tidied, not refused");
  assert.equal(store.identity(cfg, null, { ...named, PL_AGENT: "older" }), "older", "an alias of the agent variable");
});

test("agent-works store: time helpers", () => {
  assert.equal(store.isoAt(0), "1970-01-01T00:00:00Z");
  assert.equal(store.parseIso("1970-01-01T00:01:00Z"), 60);
  assert.equal(store.parseIso("yesterday"), null);
  assert.equal(store.parseIso("1970-01-01T00:01:00.000Z"), null, "only the store's own shape");
  assert.equal(store.ageSeconds(null), 0);
  assert.ok(Math.abs(store.ageSeconds(store.isoAt(Date.now() / 1000 - 100)) - 100) < 3);
  assert.deepEqual([store.ago(30), store.ago(600), store.ago(7200)], ["30 s", "10 min", "2.0 h"]);
  assert.deepEqual([5, 0.3, 12.5, 0, 1.3000000000000003, 30].map(store.g), ["5", "0.3", "12.5", "0", "1.3", "30"]);
});

test("agent-works store: settings come from the config or the defaults, and names are plain", () => {
  assert.deepEqual({ ...store.SETTINGS }, { ...config.DEFAULTS.coordination });
  assert.deepEqual({ ...store.SETTINGS }, { lockStaleMinutes: 45, agentStaleMinutes: 120, holdMinutes: 120, claimHours: 72, learningChars: 6000, logBytes: 262144 });
  assert.equal(store.setting({}, "lockStaleMinutes"), 45);
  assert.equal(store.setting(null, "lockStaleMinutes"), 45);
  assert.equal(store.setting({ coordination: { lockStaleMinutes: 5 } }, "lockStaleMinutes"), 5);
  assert.equal(store.setting({ coordination: { lockStaleMinutes: "soon" } }, "lockStaleMinutes"), 45);
  assert.throws(() => store.checkName("../escape", "resource name"), common.AwError);
  assert.equal(store.checkName("gpu-0.a_b", "resource name"), "gpu-0.a_b");
  assert.equal(store.numArg(undefined, "--wait", 480), 480);
  assert.equal(store.numArg("0.5", "--wait", 480), 0.5);
  assert.throws(() => store.numArg("soon", "--wait"), common.AwError);
  assert.deepEqual(store.glue(["sim", "--for", "- a list", "--as", "a", "--for", "--", "prog", "--for", "x"], ["--for"]),
    ["sim", "--for=- a list", "--as", "a", "--for", "--", "prog", "--for", "x"], "a free text may start with a dash; the command's own words are left alone");
});

test("agent-works store: projects seen are listed once per repository", (t) => {
  const w = world(t);
  const other = w.project("other");
  const deep = path.join(other, "src", "deep");
  fs.mkdirSync(deep, { recursive: true });
  assert.equal(w.aw(["note", "from proj"]).status, 0);
  assert.equal(w.aw(["note", "from other"], { cwd: deep }).status, 0);
  assert.equal(w.aw(["note", "again"], { cwd: other }).status, 0);
  const seen = JSON.parse(fs.readFileSync(path.join(w.home, "projects.json"), "utf8"));
  assert.deepEqual(Object.values(seen).map((v) => v.name).sort(), ["other", "proj"]);
  assert.deepEqual(new Set(Object.values(seen).map((v) => v.root)), new Set([common.posix(w.proj), common.posix(other)]));
  assert.deepEqual(new Set(Object.keys(seen)), new Set([common.projectId(w.proj), common.projectId(deep)]));
  assert.deepEqual(store.findProject(w.home, "oth"), [common.projectId(other)]);
  assert.deepEqual(store.findProject(w.home, "OTHER"), [common.projectId(other)]);
  assert.equal(store.projectLabel(common.projectId(other), store.projects(w.home)), "other");
  assert.equal(store.projectLabel("gone-0123abcd", store.projects(w.home)), "gone");
  assert.equal(store.projectLabel(null, {}), "?");
});

test("agent-works store: the config's name is the project's name in the store", (t) => {
  const w = world(t);
  const named = w.project("named", { version: 1, name: "Cardan" });
  assert.equal(w.aw(["note", "from named"], { cwd: named }).status, 0);
  const seen = JSON.parse(fs.readFileSync(path.join(w.home, "projects.json"), "utf8"));
  assert.equal(seen[common.projectId(named)].name, "Cardan");
  assert.match(common.projectId(named), /^named-[0-9a-f]{8}$/);
});

test("agent-works store: the store is AW_HOME, and nothing is written outside it", (t) => {
  const w = world(t);
  assert.equal(store.homeOf(w.env()), w.home);
  assert.equal(w.aw(["note", "here"]).status, 0);
  assert.deepEqual(fs.readdirSync(w.tmp).sort(), ["proj", "store"]);
  assert.deepEqual(fs.readdirSync(w.proj), [".git"], "the project itself is not written to");
});

test("agent-works store: a command runs as a program with its arguments, its code passed through", async () => {
  const run = (command, options = {}) => store.runChild(command, { env: { ...process.env }, ...options });
  assert.deepEqual(await run([NODE, "-e", "process.exit(7)"]), [7, false]);
  assert.deepEqual(await run([NODE, "-e", "process.exit(Number(process.env.AW_TEST_CODE))"], { extra: { AW_TEST_CODE: "5" } }), [5, false]);
  assert.deepEqual(await run(["AW_TEST_CODE=9", NODE, "-e", "process.exit(Number(process.env.AW_TEST_CODE))"]), [9, false], "leading NAME=value words are its environment");
  const errors = [];
  assert.deepEqual(await run(["aw-no-such-program-xyz", "a"], { onError: (why) => errors.push(why) }), [127, false]);
  assert.match(errors[0], /was not found/);
  // One word is a program too, never a shell line.
  assert.deepEqual(await run([`${NODE} -e 0 && ${NODE} -e 0`], { onError: () => {} }), [127, false]);
  let ticks = 0;
  const started = Date.now();
  assert.deepEqual(await run([NODE, "-e", "setTimeout(() => {}, 60000)"], { maxSeconds: 0.4, tick: () => { ticks++; }, tickMs: 100 }), [124, true]);
  assert.ok(Date.now() - started < 15_000);
  assert.ok(ticks >= 1, "the tick runs while the command does");
  assert.deepEqual(store.splitAssignments(["A=1", "B=two words", "prog", "C=3"]), [{ A: "1", B: "two words" }, ["prog", "C=3"]]);
  assert.deepEqual(store.splitAssignments(["A=1"]), [{}, ["A=1"]], "the last word is always the program");
});
