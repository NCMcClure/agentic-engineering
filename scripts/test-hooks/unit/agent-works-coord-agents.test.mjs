// agent-works `aw who` and `aw agent`: who is running, across projects, with
// what they hold; and what the session hook and `aw status` ask of the library.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { deadPid, load, sleep, stampIn, world } from "./agent-works-coord-support.mjs";

const agents = await load("scripts/coord/agents.mjs");
const store = await load("scripts/coord/store.mjs");
const common = await load("lib/common.mjs");
const locks = await load("scripts/locks.mjs");
const leases = await load("scripts/coord/leases.mjs");
const claims = await load("scripts/coord/claims.mjs");

const who = (w, cwd = w.proj) => w.doc(["who", "--json"], { cwd });

test("agent-works who: agents of two projects with their locks and leases", (t) => {
  const w = world(t);
  const other = w.project("other");
  assert.equal(w.aw(["who"]).stdout, "nobody: no agent registered, no lock or lease held\n");
  const r = w.aw(["agent", "start", "--name", "a1", "--session", "s-1"]);
  assert.deepEqual([r.status, r.stdout], [0, `a1: registered in proj (pid ${process.pid})\n`], r.stderr);
  w.aw(["agent", "start", "--name", "b1"], { cwd: other });
  w.aw(["agent", "start", "--name", "b2"], { cwd: path.join(other, ".git") }); // anywhere inside the repository
  w.aw(["lock", "acquire", "gpu-exclusive", "--as", "a1", "--for", "benchmark", "--wait", "0"]);
  w.aw(["lock", "acquire", "sim", "--as", "b1", "--for", "a run", "--wait", "0"], { cwd: other });
  w.aw(["lease", "gpu", "--share", "0.3", "--for", "bake", "--hold", "--as", "b1"], { cwd: other });
  w.aw(["lease", "cpu", "--cpu", "8", "--for", "compile", "--hold", "--as", "ghost"], { cwd: other }); // never registered
  const doc = who(w, other);
  const by = Object.fromEntries(doc.agents.map((a) => [a.name, a]));
  assert.deepEqual(Object.keys(by).sort(), ["a1", "b1", "b2", "ghost"]);
  assert.deepEqual([by.a1.pid, by.a1.session, by.a1.registered, by.a1.id], [process.pid, "s-1", true, `a1@${w.id()}#${process.pid}`]);
  assert.equal(by.a1.root, common.posix(w.proj));
  assert.equal(by.a1.worktree, common.posix(w.proj));
  assert.deepEqual(by.a1.locks.map((x) => [x.resource, x.scope]), [["gpu-exclusive", "machine"]]);
  assert.deepEqual(by.b1.locks.map((x) => x.resource), ["sim"]);
  assert.deepEqual(by.b1.leases.map((x) => [x.resource, x.share]), [["gpu", 0.3]]);
  assert.deepEqual([by.b2.locks, by.b2.leases, by.b2.session], [[], [], null]);
  assert.deepEqual([by.ghost.registered, by.ghost.leases.map((x) => x.resource), by.ghost.id], [false, ["cpu"], `ghost@${w.id(other)}`]);
  assert.deepEqual(Object.values(doc.projects).map((p) => p.name).sort(), ["other", "proj"]);
  assert.deepEqual(doc.projects[w.id()], { name: "proj", root: common.posix(w.proj) });
  assert.notEqual(by.a1.project, by.b1.project);
  assert.deepEqual([doc.locks.length, doc.leases.length], [2, 2]);
  const text = w.aw(["who"]).stdout;
  for (const part of [`other  (${common.posix(other)})\n`, `proj  (${common.posix(w.proj)})\n`, `  a1  pid ${process.pid}, up `, '      lock  gpu-exclusive [machine] for 0',
    '      lock  sim [project] for 0', '      lease gpu share 0.3  for ', "  ghost  (not registered: seen only through what it holds)\n      lease cpu 8 cpu  for "]) {
    assert.ok(text.includes(part), `${JSON.stringify(part)} in:\n${text}`);
  }
  assert.ok(text.indexOf("other  (") < text.indexOf("proj  ("), "grouped by project, by name");
});

test("agent-works agent: beat and stop", async (t) => {
  const w = world(t);
  const first = w.doc(["agent", "start", "--name", "a1", "--json"]);
  await sleep(1100);
  assert.equal(w.aw(["agent", "beat", "--name", "a1"]).stdout, `a1: still here in proj (pid ${process.pid})\n`);
  const [entry] = who(w).agents;
  assert.equal(entry.started, first.started);
  assert.ok(entry.beat > first.beat);
  assert.equal(who(w).agents.length, 1, "a beat is not a second entry");
  assert.match(w.aw(["agent", "beat", "--name", "b9"]).stdout, /^b9: registered/, "a beat from a stranger registers it");
  assert.equal(w.aw(["agent", "stop", "--name", "a1"]).stdout, "a1: left\n");
  assert.equal(w.aw(["agent", "stop", "--name", "a1"]).stdout, "a1: was not registered\n");
  assert.deepEqual(w.doc(["agent", "stop", "--name", "a1", "--json"]), { stopped: false, name: "a1", project: w.id() });
  assert.deepEqual(who(w).agents.map((a) => a.name), ["b9"]);
  assert.equal(w.aw(["agent", "wave"]).status, 2);
  assert.equal(w.aw(["agent"]).status, 2);
  assert.equal(w.aw(["agent", "--help"]).status, 0);
  assert.equal(w.aw(["who", "--help"]).status, 0);
});

test("agent-works agent: the name comes from the agent variable or the session", (t) => {
  const w = world(t);
  assert.match(w.aw(["agent", "start"]).stdout, new RegExp(`^session-${process.pid}: registered`));
  assert.match(w.aw(["agent", "start"], { env: { AW_AGENT: "worker-3" } }).stdout, /^worker-3: registered/);
  assert.match(w.aw(["agent", "start"], { env: { PL_AGENT: "older" } }).stdout, /^older: registered/);
  const bad = w.aw(["agent", "start", "--name", "Bad Name"]);
  assert.deepEqual([bad.status, bad.stderr], [2, "aw agent: agent name 'Bad Name': lower-case letters, digits and '-' only\n"]);
  assert.deepEqual(who(w).agents.map((a) => a.name).sort(), ["older", `session-${process.pid}`, "worker-3"]);
});

test("agent-works agent: the session hook's registration and a later command are one agent", (t) => {
  // The session hook and each tool call are separate processes with separate ancestries. What ties them to one
  // session is the process the host names (CLAUDE_PID): the hook registers it, a later command finds the same
  // name, and what that command takes is listed under the one entry.
  const w = world(t, { version: 1 });
  const env = w.env({ CLAUDE_PID: String(process.pid) });
  delete env.AW_SESSION_PID;
  const entry = agents.start(store.context({ cwd: w.proj, env }), { session: "s-9" });
  assert.deepEqual([entry.name, entry.pid, entry.session], [`session-${process.pid}`, process.pid, "s-9"]);
  const later = (args) => w.aw(args, { env: { CLAUDE_PID: String(process.pid), AW_SESSION_PID: "" } });
  assert.equal(later(["lock", "acquire", "sim", "--for", "x", "--wait", "0"]).status, 0);
  assert.equal(later(["lease", "gpu", "--share", "0.2", "--for", "y", "--hold"]).status, 0);
  const listed = JSON.parse(later(["who", "--json"]).stdout).agents;
  assert.deepEqual(listed.map((a) => [a.name, a.pid, a.session, a.registered, a.locks.length, a.leases.length]),
    [[`session-${process.pid}`, process.pid, "s-9", true, 1, 1]]);
  assert.equal(later(["lock", "release", "sim"]).status, 0, "the same name again: its own lock");
  const again = agents.start(store.context({ cwd: w.proj, env }), { session: "s-10" });
  assert.deepEqual([again.session, again.started, agents.live(w.home).length], ["s-10", entry.started, 1], "a second start is a beat, with the new session id");
});

test("agent-works agent: agents whose process is gone are dropped", (t) => {
  const w = world(t);
  w.aw(["agent", "start", "--name", "alive"]);
  w.aw(["agent", "start", "--name", "gone", "--pid", deadPid()]);
  const file = path.join(w.home, "agents.jsonl");
  const stale = { id: "old", name: "silent", project: "p-00000000", pid: null, started: stampIn(-9 * 3600), beat: stampIn(-9 * 3600) };
  const fresh = { ...stale, id: "new", name: "pidless", beat: stampIn(0) };
  fs.appendFileSync(file, `${JSON.stringify(stale)}\n${JSON.stringify(fresh)}\nnot json\n`);
  assert.deepEqual(agents.live(w.home, null, { prune: false }).map((a) => a.name).sort(), ["alive", "pidless"]);
  assert.equal(fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length, 5, "a reader that was asked not to tidy leaves the file alone");
  assert.deepEqual(who(w).agents.map((a) => a.name).sort(), ["alive", "pidless"]);
  const kept = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).name);
  assert.deepEqual(kept.sort(), ["alive", "pidless"], "the store itself was tidied");
  const text = w.aw(["who"]).stdout;
  assert.match(text, /^p\n {2}pidless {2}pid \?, up 9\.0 h, last beat \d s ago\n/m, "an agent of a project nobody has seen is listed under its id's name");
});

test("agent-works agent: concurrent starts all register", async (t) => {
  const w = world(t);
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => w.spawn(["agent", "start", "--name", `a${i}`]).done));
  assert.deepEqual(runs.map((r) => r.status), Array(8).fill(0), runs.map((r) => r.stderr).join("\n"));
  assert.deepEqual(who(w).agents.map((a) => a.name).sort(), Array.from({ length: 8 }, (_, i) => `a${i}`));
  const lines = fs.readFileSync(path.join(w.home, "agents.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 8);
  assert.ok(lines.every((line) => JSON.parse(line).pid === process.pid));
});

test("agent-works agent: what the status command reads: every lock, every lease, a project's claims", (t) => {
  const w = world(t, { resources: { editor: {} }, counters: { schema: {} } });
  const other = w.project("other");
  assert.deepEqual([locks.allLocks(w.home), leases.live(w.home, { prune: false }), claims.read(w.home, w.id())], [[], [], {}], "no store yet: nothing, and no error");
  w.aw(["lock", "acquire", "editor", "--as", "a1", "--for", "an import", "--wait", "0"]);
  w.aw(["lock", "acquire", "gpu", "--as", "b1", "--for", "bench", "--wait", "0"], { cwd: other });
  w.aw(["lock", "acquire", "editor", "--as", "c1", "--for", "queued", "--wait", "0"]);
  w.aw(["lease", "gpu", "--share", "0.4", "--for", "bake", "--hold", "--as", "b1"], { cwd: other });
  w.aw(["claim", "schema", "--after", "3", "--for", "a branch", "--as", "a1"]);
  w.aw(["claim", "schema", "--after", "50", "--as", "b1"], { cwd: other });
  const held = locks.allLocks(w.home);
  assert.deepEqual(held.map((l) => [l.resource, l.scope, l.held, l.agent, l.project, l.for, l.pid, l.waiting]),
    [["gpu", "machine", true, "b1", w.id(other), "bench", process.pid, []], ["editor", w.id(), true, "a1", w.id(), "an import", process.pid, []]]);
  assert.ok(held.every((l) => /^\d{4}-/.test(l.since) && /^\d{4}-/.test(l.refreshed) && typeof l.heldMinutes === "number"));
  assert.deepEqual(locks.allLocks(w.home, { withQueues: true }).find((l) => l.resource === "editor").waiting.map((x) => x.agent), ["c1"]);
  assert.deepEqual(leases.live(w.home, { prune: false }).map((l) => [l.resource, l.agent, l.project, l.share, l.mem, l.for]), [["gpu", "b1", w.id(other), 0.4, null, "bake"]]);
  const mine = claims.read(w.home, w.id());
  assert.deepEqual([mine.schema.floor, mine.schema.claims.map((c) => [c.agent, c.value, c.for])], [3, [["a1", 4, "a branch"]]]);
  assert.deepEqual(claims.read(w.home, w.id(other)).schema.claims.map((c) => c.value), [51]);
});
