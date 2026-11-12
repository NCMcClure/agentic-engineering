// agent-works `aw lock` the way parallel sessions use it: real processes on
// one temp store, one or several temp projects. A race with one winner, a queue
// served in ask order, a waiter that times out and keeps its place, a holder
// that is killed, the time limit, scopes, lock order, and what the guard asks.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NODE, deadPid, load, sleep, stampIn, until, world } from "./agent-works-coord-support.mjs";

const locks = await load("scripts/locks.mjs");
const common = await load("lib/common.mjs");
const config = await load("lib/config.mjs");

const FAST = ["--poll", "0.2"];
const QUEUED = 3;
const RESOURCES = { sim: { scope: "project", processes: [], match: [] }, editor: { scope: "project", maxMinutes: 5 } };
const CONFIG = { resources: RESOURCES };

const lock = (w, args, options) => w.aw(["lock", ...args], options);
const holder = (w, resource = "sim", cwd = w.proj) => lock(w, ["holder", resource], { cwd }).stdout.trim();
const row = (w, resource, cwd = w.proj) => w.doc(["lock", "status", "--json"], { cwd }).resources.find((r) => r.resource === resource);
const acquire = (w, resource, as, extra = [], options = {}) => lock(w, ["acquire", resource, "--as", as, "--for", "x", "--wait", "0", ...extra], options);

test("agent-works lock: a race has exactly one holder", async (t) => {
  const w = world(t, CONFIG);
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => w.spawn(["lock", "acquire", "sim", "--as", `r-${i}`, "--for", "race", "--wait", "0"]).done));
  const codes = runs.map((r) => r.status);
  assert.deepEqual([...codes].sort(), [0, ...Array(7).fill(QUEUED)], JSON.stringify(runs));
  const winner = `r-${codes.indexOf(0)}`;
  assert.equal(holder(w), winner);
  const refused = lock(w, ["release", "sim", "--as", "someone-else"]);
  assert.equal(refused.status, 1, "only the holder releases");
  assert.match(refused.stderr, new RegExp(`sim: held by ${winner}, not by someone-else: only the holder releases`));
  assert.equal(holder(w), winner);
  const again = lock(w, ["acquire", "sim", "--as", winner, "--for", "again", "--wait", "0"]);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, `sim: held by ${winner} (refreshed)\n`);
  assert.equal(row(w, "sim").for, "again");
  assert.equal(lock(w, ["release", "sim", "--as", winner]).stdout, `sim: released by ${winner}\n`);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);
});

test("agent-works lock: the queue serves in ask order", async (t) => {
  const w = world(t, CONFIG);
  assert.equal(acquire(w, "sim", "first").status, 0);
  const order = path.join(w.tmp, "order.txt");
  const waiters = [];
  for (const name of ["c-late", "a-mid", "b-last"]) { // names sort differently from the ask order on purpose
    waiters.push(w.spawn(["lock", "run", "sim", "--as", name, "--for", "queued", "--wait", "40", ...FAST, "--",
      NODE, "-e", "require('node:fs').appendFileSync(process.argv[1], process.argv[2] + '\\n'); setTimeout(() => {}, 300)", order, name]));
    await until(() => row(w, "sim").waiting.some((x) => x.agent === name), 20_000, `${name} in the queue`);
  }
  assert.deepEqual(row(w, "sim").waiting.map((x) => x.agent), ["c-late", "a-mid", "b-last"]);
  assert.equal(lock(w, ["release", "sim", "--as", "first"]).status, 0);
  assert.deepEqual((await Promise.all(waiters.map((x) => x.done))).map((r) => r.status), [0, 0, 0]);
  assert.deepEqual(fs.readFileSync(order, "utf8").split("\n").filter(Boolean), ["c-late", "a-mid", "b-last"]);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);
  assert.deepEqual(row(w, "sim").waiting, []);
});

test("agent-works lock: a waiter that times out is still queued, and keeps its place", async (t) => {
  const w = world(t, CONFIG);
  acquire(w, "sim", "first");
  const started = Date.now();
  const early = lock(w, ["acquire", "sim", "--as", "early", "--for", "x", "--wait", "1", ...FAST]);
  assert.equal(early.status, QUEUED);
  assert.ok(Date.now() - started >= 900, "it waited its --wait out");
  assert.match(early.stderr, /sim: waiting; held by first \(for: x; since /);
  assert.match(early.stderr, /sim: STILL QUEUED after 1 s \(held by first .*Not a failure: the place in the queue is kept for 10 min\. Run the same command again\./);
  assert.equal(early.stdout, "");
  const late = w.spawn(["lock", "acquire", "sim", "--as", "late", "--for", "x", "--wait", "40", ...FAST]);
  await until(() => row(w, "sim").waiting.length === 2, 20_000, "late in the queue");
  lock(w, ["release", "sim", "--as", "first"]);
  await sleep(1200); // late polls every 0.2 s, yet the free lock is not its to take
  assert.equal(lock(w, ["holder", "sim"]).status, 1);
  assert.equal(acquire(w, "sim", "early").status, 0, "asks again: still first");
  assert.equal(lock(w, ["release", "sim", "--as", "early"]).status, 0);
  assert.equal((await late.done).status, 0);
  assert.equal(holder(w), "late");
});

test("agent-works lock: a silent waiter is passed over but stays listed", async (t) => {
  const w = world(t, CONFIG);
  acquire(w, "sim", "first");
  assert.equal(acquire(w, "sim", "gone").status, QUEUED);
  lock(w, ["release", "sim", "--as", "first"]);
  await sleep(1500);
  assert.equal(acquire(w, "sim", "next", ["--live", "1"]).status, 0);
  assert.deepEqual(row(w, "sim").waiting.map((x) => x.agent), ["gone"]);
  lock(w, ["release", "sim", "--as", "next"]);
  // ... and its ticket is thrown away once nobody polled it for --keep seconds
  assert.equal(acquire(w, "sim", "next", ["--live", "1", "--keep", "1"]).status, 0);
  assert.deepEqual(row(w, "sim").waiting, []);
});

test("agent-works lock: run passes the exit code through, sets the agent variable, and always releases", (t) => {
  const w = world(t, CONFIG);
  const run = (...command) => lock(w, ["run", "sim", "--as", "runner", "--for", "a run", "--wait", "0", "--", ...command]);
  const failing = run(NODE, "-e", "console.log('agent=' + process.env.AW_AGENT); process.exit(7)");
  assert.equal(failing.status, 7, failing.stderr);
  assert.match(failing.stdout, /agent=runner/);
  assert.match(failing.stderr, /^sim: held by runner; limit 30 min\nsim: released by runner \(exit 7\)\n$/);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);

  const missing = run("aw-no-such-program-xyz", "a");
  assert.equal(missing.status, 127);
  assert.match(missing.stderr, /sim: could not start the command: 'aw-no-such-program-xyz' was not found/);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);

  // One word after -- is a program, not a shell line: a line that needs a shell is the caller's to wrap.
  const line = run(`${NODE} -e 0 && ${NODE} -e 0`);
  assert.equal(line.status, 127);
  assert.match(line.stderr, /wrap a shell line yourself/);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);

  const assigned = run("AW_TEST_GREETING=hello there", NODE, "-e", "console.log(process.env.AW_TEST_GREETING)");
  assert.deepEqual([assigned.status, assigned.stdout], [0, "hello there\n"], assigned.stderr);
});

test("agent-works lock: the argument shapes other plugins' skills name keep working", { skip: process.platform === "win32" && "echo is not a program on Windows" }, (t) => {
  const w = world(t);
  const r = lock(w, ["run", "gpu", "--for", "x", "--", "echo", "hi"]);
  assert.deepEqual([r.status, r.stdout], [0, "hi\n"], r.stderr);
  assert.equal(lock(w, ["holder", "gpu"]).status, 1);
});

test("agent-works lock: run sets the project's own agent variable and keeps the command's flags", (t) => {
  const w = world(t, { resources: RESOURCES, guard: { agentVar: "ACME_AGENT" } });
  const show = path.join(w.tmp, "show.cjs");
  fs.writeFileSync(show, "console.log(process.env.ACME_AGENT, process.env.AW_AGENT, JSON.stringify(process.argv.slice(2)));\n");
  const r = lock(w, ["run", "sim", "--for", "flags", "--wait", "0", "--", NODE, show, "--as", "x", "--json", "--", "-v"], { env: { ACME_AGENT: "from-env" } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'from-env from-env ["--as","x","--json","--","-v"]', "the name came from the variable");
});

test("agent-works lock: run kills the command's whole tree at its limit, releases, and leaves a note", async (t) => {
  const w = world(t, CONFIG);
  const marker = path.join(w.tmp, "grandchild.txt");
  // The command starts a grandchild that would write the marker after 4 s: the whole tree must die.
  const inner = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 4000)`;
  const code = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(inner)}], { stdio: 'ignore' }); setTimeout(() => {}, 60000)`;
  const started = Date.now();
  const r = lock(w, ["run", "sim", "--as", "runner", "--for", "hangs", "--wait", "0", "--max-minutes", "0.02", "--", NODE, "-e", code]);
  assert.equal(r.status, 124, r.stderr);
  assert.ok(Date.now() - started < 20_000);
  assert.match(r.stderr, /sim: the command ran into its 0\.02 min limit: its process tree was killed\nsim: released by runner \(exit 124\)\n$/);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);
  assert.match(w.aw(["notes"]).stdout, /runner {2}sim: run killed at its 0\.02 min limit \(hangs\)/);
  await sleep(Math.max(0, started + 5000 - Date.now()));
  assert.ok(!fs.existsSync(marker), "the grandchild outlived the kill");
});

test("agent-works lock: a run that is asked to stop stops its command and releases", { skip: process.platform === "win32" && "no signals to forward on Windows" }, async (t) => {
  const w = world(t, CONFIG);
  const run = w.spawn(["lock", "run", "sim", "--as", "runner", "--for", "interrupted", "--wait", "0", "--", NODE, "-e", "setTimeout(() => {}, 60000)"]);
  await until(() => holder(w) === "runner", 20_000, "the run holding the lock");
  await sleep(300); // the command is up
  run.child.kill("SIGTERM");
  const r = await run.done;
  assert.equal(r.status, 143, r.stderr);
  assert.match(r.stderr, /sim: released by runner \(exit 143\)/);
  assert.equal(lock(w, ["holder", "sim"]).status, 1);
});

test("agent-works lock: the lock of a run that was killed is taken over at once, with a note", async (t) => {
  const w = world(t, CONFIG);
  const pidFile = path.join(w.tmp, "command.pid");
  const run = w.spawn(["lock", "run", "sim", "--as", "doomed", "--for", "crashes", "--wait", "0", "--", NODE, "-e",
    "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 20000)", pidFile]);
  await until(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8"), 20_000, "the command running under the lock");
  const held = row(w, "sim");
  assert.deepEqual([held.agent, held.stale], ["doomed", false]);
  run.child.kill("SIGKILL"); // no chance to release, or to stop its command
  await run.exited;
  try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL"); } catch { /* gone already */ }
  assert.equal(holder(w), "doomed", "the lock file outlives its holder");
  assert.equal(row(w, "sim").stale, true);
  assert.match(lock(w, ["status"]).stdout, /sim \[project\]: held by doomed .* STALE \(not refreshed\)/);
  const taker = acquire(w, "sim", "taker");
  assert.equal(taker.status, 0, taker.stderr);
  assert.equal(taker.stdout, "sim: held by taker (taken over from doomed (stale))\n");
  assert.match(w.aw(["notes"]).stdout, /taker {2}took over sim from doomed: its run is gone and no process of it running \(was for: crashes\)/);
});

test("agent-works lock: a ghost run's lock is taken over, a plain hold with a fresh stamp never is", (t) => {
  const w = world(t, CONFIG);
  const scope = w.id();
  const dir = path.join(w.home, "locks", scope);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = stampIn(0);
  const ghost = { agent: "ghost", project: scope, for: "crashed", pid: deadPid(), run: true, since: stamp, refreshed: stamp };
  fs.writeFileSync(path.join(dir, "sim.lock"), JSON.stringify(ghost));
  const r = acquire(w, "sim", "taker");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /taken over from ghost/);
  assert.match(w.aw(["notes"]).stdout, /its run is gone/);
  fs.writeFileSync(path.join(dir, "editor.lock"), JSON.stringify({ ...ghost, run: false }));
  assert.equal(acquire(w, "editor", "taker").status, QUEUED, "whatever its pid");
});

test("agent-works lock: a lock nobody refreshed is taken over, unless its application still runs", async (t) => {
  const w = world(t, { resources: { sim: { processes: [] } }, coordination: { lockStaleMinutes: 0.04 } });
  acquire(w, "sim", "sleeper", [], {});
  assert.equal(acquire(w, "sim", "taker").status, QUEUED, "not stale yet");
  await sleep(3000);
  const r = acquire(w, "sim", "taker");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /taken over from sleeper/);
  assert.match(w.aw(["notes"]).stdout, /took over sim from sleeper: not refreshed since /);

  // The same staleness, but a process of the resource runs: the lock stands.
  const table = (await load("scripts/coord/store.mjs")).processTable();
  const mine = table.get(process.pid)[1];
  w.writeConfig(w.proj, { resources: { busy: { processes: [mine] } }, coordination: { lockStaleMinutes: 0.04 } });
  const free = acquire(w, "busy", "a");
  assert.equal(free.status, QUEUED, "the application runs without a lock: wait");
  assert.match(free.stderr, /runs without a lock .* --despite-running takes the lock anyway/);
  assert.equal(acquire(w, "busy", "a", ["--despite-running"]).status, 0);
  await sleep(3000);
  const blocked = acquire(w, "busy", "b");
  assert.equal(blocked.status, QUEUED);
  assert.match(blocked.stderr, /not refreshed for 0 min but .* is running/);
  assert.ok(row(w, "busy").running.includes(mine));
});

test("agent-works lock: a held lock blocks a run, and status shows the hold", (t) => {
  const w = world(t, CONFIG);
  lock(w, ["acquire", "editor", "--as", "holder", "--for", "long job", "--wait", "0"]);
  const r = lock(w, ["run", "editor", "--as", "other", "--for", "x", "--wait", "0", "--", NODE, "-e", "console.log('ran')"]);
  assert.equal(r.status, QUEUED);
  assert.match(r.stderr, /STILL QUEUED/);
  assert.doesNotMatch(r.stdout, /ran/);
  const held = row(w, "editor");
  assert.deepEqual([held.agent, held.maxMinutes, held.overdue, held.scope, held.for], ["holder", 5, false, w.id(), "long job"]);
  const text = lock(w, ["status"]).stdout;
  assert.match(text, /editor \[project\]: held by holder for 0(\.\d)? of 5 min, since \S+, refreshed \S+, for: long job\n {4}1\. other waiting since /);
  assert.match(text, /^gpu \[machine\]: free$/m);
  // a hold past its maximum is flagged
  const doc = w.doc(["lock", "status", "--json"]);
  assert.equal(doc.dir, common.posix(path.join(w.home, "locks")));
  const file = path.join(doc.dir, held.scope, "editor.lock");
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), since: stampIn(-600) }));
  assert.match(lock(w, ["status"]).stdout, /for 10(\.\d)? of 5 min OVERDUE/);
  assert.match(lock(w, ["status", "editor"]).stdout, /editor/);
  assert.doesNotMatch(lock(w, ["status", "editor"]).stdout, /sim/);
});

test("agent-works lock: usage", (t) => {
  const w = world(t, CONFIG);
  assert.equal(acquire(w, "sim", "Bad_Name").status, 2);
  assert.equal(acquire(w, "bad/name", "a").status, 2);
  const noFor = lock(w, ["acquire", "sim", "--as", "a", "--wait", "0"]);
  assert.deepEqual([noFor.status, noFor.stderr], [2, 'aw lock: lock acquire: say what it is for: --for "<what, how long>"\n']);
  const noCommand = lock(w, ["run", "sim", "--as", "a", "--for", "x", "--wait", "0"]);
  assert.deepEqual([noCommand.status, noCommand.stderr], [2, "aw lock: lock run: no command after --\n"]);
  assert.equal(lock(w, ["acquire", "sim", "--as", "a", "--for", "x", "--wait", "soon"]).status, 2);
  assert.equal(lock(w, ["acquire", "sim", "--as", "a", "--for", "x", "--nope"]).status, 2);
  const help = lock(w, ["--help"]);
  assert.equal(help.status, 0);
  for (const part of ["aw lock run RESOURCE", "aw lock acquire RESOURCE", "aw lock release RESOURCE", "aw lock status [RESOURCE]", "3 = STILL QUEUED", "lockOrder"]) {
    assert.ok(help.stdout.includes(part), part);
  }
  assert.equal(lock(w, ["run", "--help"]).status, 0);
  const bare = lock(w, []);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /^usage: aw lock /);
  assert.equal(lock(w, ["steal", "sim"]).status, 2);
  const free = lock(w, ["release", "sim", "--as", "a"]);
  assert.deepEqual([free.status, free.stdout], [0, "sim: already free\n"]);
  assert.equal(holder(w), "");
  assert.deepEqual(w.doc(["lock", "release", "sim", "--as", "a", "--json"]), { resource: "sim", released: false, holder: null });
  assert.deepEqual(fs.existsSync(path.join(w.home, "locks")), false, "nothing was written for all that");
});

test("agent-works lock: a worktree shares the locks of its repository, another project does not", (t) => {
  const w = world(t, CONFIG);
  const real = path.join(w.tmp, "real");
  fs.mkdirSync(real);
  const git = (...args) => execFileSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args],
    { cwd: real, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  w.writeConfig(real, { resources: { sim: {} } });
  git("init", "-q", ".");
  git("commit", "-q", "--allow-empty", "-m", "init");
  const wt = path.join(w.tmp, "wt");
  git("worktree", "add", "-q", wt, "-b", "wt");
  w.writeConfig(wt, { resources: { sim: {} } });
  const sub = path.join(wt, "deep", "er");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(acquire(w, "sim", "main-agent", [], { cwd: real }).status, 0);
  assert.equal(holder(w, "sim", sub), "main-agent");
  assert.equal(w.id(real), w.id(wt));
  assert.equal(lock(w, ["holder", "sim"], { cwd: w.proj }).status, 1, "another project: its own sim");
  assert.equal(lock(w, ["release", "sim", "--as", "main-agent"], { cwd: sub }).status, 0, "released from the worktree");
});

test("agent-works lock: two projects contend for a machine resource", async (t) => {
  const w = world(t, CONFIG);
  const machine = { resources: { renderer: { scope: "machine" } } };
  const [a, b] = [w.project("alpha", machine), w.project("beta", machine)];
  assert.equal(lock(w, ["acquire", "renderer", "--as", "a1", "--for", "alpha's run", "--wait", "0"], { cwd: a }).status, 0);
  // the same agent name in another project is somebody else
  const r = lock(w, ["acquire", "renderer", "--as", "a1", "--for", "beta's run", "--wait", "0"], { cwd: b });
  assert.equal(r.status, QUEUED);
  assert.match(r.stderr, /a1 \(alpha\)/);
  const held = row(w, "renderer", b);
  assert.deepEqual([held.scope, held.agent, held.for, held.project], ["machine", "a1", "alpha's run", w.id(a)]);
  assert.equal(held.waiting[0].agent, `a1@${w.id(b)}`);
  assert.match(lock(w, ["status"], { cwd: b }).stdout, /renderer \[machine\]: held by a1 \(alpha\) for 0(\.\d)? of 30 min/);
  assert.equal(lock(w, ["release", "renderer", "--as", "a1"], { cwd: b }).status, 1, "not beta's to release");
  assert.equal(holder(w, "renderer", b), "a1");
  const waiter = w.spawn(["lock", "run", "renderer", "--as", "a1", "--for", "beta's run", "--wait", "30", ...FAST, "--", NODE, "-e", "console.log('beta ran')"], { cwd: b });
  await sleep(800);
  assert.equal(lock(w, ["release", "renderer", "--as", "a1"], { cwd: a }).status, 0);
  const done = await waiter.done;
  assert.deepEqual([done.status, done.stdout.trim()], [0, "beta ran"], done.stderr);
  assert.equal(lock(w, ["holder", "renderer"], { cwd: a }).status, 1);
});

test("agent-works lock: a built-in machine resource races across projects", async (t) => {
  const w = world(t);
  const roots = [w.project("alpha"), w.project("beta"), w.project("gamma", { resources: {} })];
  const runs = await Promise.all(Array.from({ length: 9 }, (_, i) => w.spawn(["lock", "acquire", "gpu-exclusive", "--as", "bench", "--for", "race", "--wait", "0"], { cwd: roots[i % 3] }).done));
  // three agents named alike per project: the three of one project count as one holder refreshing
  const winners = new Set(runs.map((r, i) => (r.status === 0 ? i % 3 : null)).filter((x) => x !== null));
  assert.equal(winners.size, 1, JSON.stringify(runs.map((r) => r.status)));
  const held = roots.map((cwd) => w.doc(["lock", "holder", "gpu-exclusive", "--json"], { cwd }));
  assert.equal(new Set(held.map((h) => h.project)).size, 1);
  assert.ok(held.every((h) => h.scope === "machine" && h.holder === "bench"));
});

test("agent-works lock: a project resource does not block another project", (t) => {
  const w = world(t, CONFIG);
  const other = w.project("other", CONFIG);
  assert.equal(acquire(w, "sim", "a1").status, 0);
  assert.equal(acquire(w, "sim", "b1", [], { cwd: other }).status, 0);
  assert.deepEqual([holder(w), holder(w, "sim", other)], ["a1", "b1"]);
  assert.equal(lock(w, ["release", "sim", "--as", "b1"], { cwd: other }).status, 0);
  assert.equal(holder(w), "a1");
  const rows = w.doc(["lock", "status", "--all", "--json"], { cwd: other }).resources;
  assert.deepEqual(rows.filter((r) => r.resource === "sim" && r.held).map((r) => r.agent), ["a1"]);
  assert.match(lock(w, ["status", "--all"], { cwd: other }).stdout, /sim \[proj\]: held by a1/);
  assert.doesNotMatch(lock(w, ["status"], { cwd: other }).stdout, /held by a1/, "without --all another project's locks are not shown");
});

test("agent-works lock: an undeclared resource is an ad hoc project lock, with a warning", (t) => {
  const w = world(t, CONFIG);
  const bare = w.project("bare");
  const r = acquire(w, "anything", "a", [], { cwd: bare });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /^aw lock: 'anything' is not declared under "resources" in \.agents\/agent-works\.json: locked for this project only, ad hoc\./);
  assert.equal(lock(w, ["holder", "anything"]).status, 1, "this project's own, and free");
  const doc = w.doc(["lock", "acquire", "nope", "--as", "a", "--for", "x", "--wait", "0", "--json"]);
  assert.deepEqual([doc.held, doc.scope, doc.agent, doc.project, doc.note], [true, w.id(), "a", w.id(), ""]);
  assert.match(doc.warnings[0], /not declared/);
  assert.doesNotMatch(acquire(w, "sim", "a").stderr, /not declared/);
  assert.doesNotMatch(acquire(w, "gpu", "a").stderr, /not declared/, "the built-in machine resources need no declaring");
});

test("agent-works lock: taking locks against lockOrder warns, and never refuses", (t) => {
  const w = world(t, { resources: RESOURCES, lockOrder: ["sim", "editor"] });
  assert.doesNotMatch(acquire(w, "sim", "a").stderr, /lock order/);
  const second = acquire(w, "editor", "a");
  assert.equal(second.status, 0);
  assert.doesNotMatch(second.stderr, /lock order/, "sim, then editor: the order");
  lock(w, ["release", "sim", "--as", "a"]);
  const back = acquire(w, "sim", "a");
  assert.equal(back.status, 0, "a warning, not a refusal");
  assert.match(back.stderr, /aw lock: lock order: sim comes before editor \(lockOrder: sim -> editor\) and you hold editor already\./);
  assert.doesNotMatch(acquire(w, "sim", "b").stderr, /lock order/, "b holds nothing");

  assert.equal(locks.orderWarning("a", ["b"], ["a", "c"]), null);
  assert.equal(locks.orderWarning("x", ["a"], ["a", "b"]), null);
  assert.match(locks.orderWarning("a", ["c", "z"], ["a", "b", "c"]), /release c and take them in order/);
});

test("agent-works lock: a lock written with earlier field names is read", (t) => {
  const w = world(t, CONFIG);
  const dir = path.join(w.home, "locks", w.id());
  fs.mkdirSync(dir, { recursive: true });
  const stamp = stampIn(0);
  fs.writeFileSync(path.join(dir, "sim.lock"), JSON.stringify({ holder: "old-agent", what: "an import", since: stamp, refreshed: stamp }));
  const held = row(w, "sim");
  assert.deepEqual([held.agent, held.for], ["old-agent", "an import"]);
  assert.equal(lock(w, ["release", "sim", "--as", "old-agent"]).status, 0);
});

test("agent-works lock: the files on disk are the ones every version of the plugin reads", (t) => {
  const w = world(t, { resources: { ...RESOURCES, renderer: { scope: "machine", processes: ["aw-no-such-app"] } } });
  acquire(w, "sim", "a1");
  acquire(w, "sim", "b1");
  acquire(w, "renderer", "a1");
  const project = w.id();
  const doc = JSON.parse(fs.readFileSync(path.join(w.home, "locks", project, "sim.lock"), "utf8"));
  assert.deepEqual(Object.keys(doc), ["resource", "scope", "agent", "project", "for", "pid", "since", "refreshed", "run"]);
  assert.deepEqual([doc.resource, doc.scope, doc.agent, doc.project, doc.for, doc.pid, doc.run], ["sim", project, "a1", project, "x", process.pid, false]);
  assert.match(doc.since, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(doc.refreshed, doc.since);
  const ticket = fs.readFileSync(path.join(w.home, "locks", project, "sim.queue", "b1"), "utf8");
  assert.ok(Math.abs(Number(ticket) - Date.now() / 1000) < 60, "a ticket holds when its waiter first asked, in seconds");
  const machine = JSON.parse(fs.readFileSync(path.join(w.home, "locks", "machine", "renderer.lock"), "utf8"));
  assert.deepEqual([machine.scope, machine.project, machine.processes], ["machine", project, ["aw-no-such-app"]]);
  const ran = lock(w, ["run", "editor", "--as", "a1", "--for", "y", "--wait", "0", "--", NODE, "-e",
    `console.log(require('node:fs').readFileSync(${JSON.stringify(path.join(w.home, "locks", project, "editor.lock"))}, 'utf8'))`]);
  const running = JSON.parse(ran.stdout);
  assert.deepEqual([running.run, running.maxMinutes, typeof running.pid], [true, 5, "number"]);
  assert.notEqual(running.pid, process.pid, "a run's lock names the run's own process");
});

test("agent-works lock: what the guard asks, without starting a process", async (t) => {
  const w = world(t, CONFIG);
  const at = w.at();
  const cfg = config.loadConfig(w.proj);
  assert.equal(locks.holder("sim", cfg, at), null);
  assert.equal(locks.holds("a1", "sim", cfg, at), false);
  assert.deepEqual(locks.lockHolders(cfg, at, "a1"), { holders: {}, mine: new Set() });
  lock(w, ["acquire", "sim", "--as", "a1", "--for", "guarded", "--wait", "0"]);
  const held = locks.holder("sim", cfg, at);
  assert.deepEqual([held.agent, held.for, held.scope], ["a1", "guarded", common.projectId(w.proj)]);
  assert.equal(locks.holds("a1", "sim", cfg, at), true);
  assert.equal(locks.holds("a2", "sim", cfg, at), false);
  assert.equal(locks.holds(null, "sim", cfg, at), false);
  await sleep(1100);
  assert.equal(locks.refresh("a1", "sim", cfg, at), true);
  assert.equal(locks.refresh("a2", "sim", cfg, at), false);
  const refreshed = locks.holder("sim", cfg, at).refreshed;
  assert.ok(refreshed > held.refreshed);
  await sleep(1100);
  assert.deepEqual(locks.lockHolders(cfg, at, "a1"), { holders: { sim: "a1" }, mine: new Set(["sim"]) });
  assert.ok(locks.holder("sim", cfg, at).refreshed > refreshed, "asking as the holder keeps the lock fresh");
  assert.deepEqual(locks.lockHolders(cfg, at, "a2", ["sim", "editor"]), { holders: { sim: "a1" }, mine: new Set() });
  assert.deepEqual(locks.lockHolders(cfg, at, null), { holders: { sim: "a1" }, mine: new Set() });
  assert.deepEqual(locks.heldBy(w.home, "a1", common.projectId(w.proj)), ["sim"]);
  // a machine resource: held by an agent of another project, so not by the like-named one here
  const other = w.project("other");
  lock(w, ["acquire", "gpu-exclusive", "--as", "a1", "--for", "x", "--wait", "0"], { cwd: other });
  assert.equal(locks.holder("gpu-exclusive", cfg, at).scope, "machine");
  assert.equal(locks.holds("a1", "gpu-exclusive", cfg, at), false);
  assert.equal(locks.holds("a1", "gpu-exclusive", config.loadConfig(other), w.at(other)), true);
  assert.equal(locks.scopeOf("gpu", { resources: { gpu: { scope: "project" } } }, w.proj), "machine", "a built-in machine resource stays one");
  const all = locks.allLocks(w.home);
  assert.deepEqual(all.map((r) => [r.resource, r.scope, r.agent, r.held]), [["gpu-exclusive", "machine", "a1", true], ["sim", common.projectId(w.proj), "a1", true]]);
});
