// agent-works `aw sys`: readings that are optional, the picture beside them,
// and "quiet enough to measure?".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NODE, load, until, world } from "./agent-works-coord-support.mjs";

const sysinfo = await load("scripts/coord/sysinfo.mjs");

const GB = 1024 ** 3;
const GPU_TEXT = `0, GPU-aaaa, Vendor Model 9000, 37, 4096, 32768, 55
1, GPU-bbbb, Vendor Model 9000, [N/A], [N/A], 32768, [N/A]
garbage line
`;
const APPS_TEXT = `4321, C:\\Program Files\\Tool, Inc\\render.exe, 2048, GPU-aaaa
77, /usr/bin/python3, [N/A], GPU-aaaa
88, [Insufficient Permissions], [N/A], GPU-bbbb
`;

const picture = (over = {}) => ({
  at: "2026-01-01T00:00:00Z", gpus: sysinfo.parseGpus(GPU_TEXT), cpu: { count: 8, percent: 12, load1: null },
  memory: { total: 64 * GB, available: 32 * GB }, leases: [], locks: [], agents: [], projects: { "p-1": "alpha", "p-2": "beta" }, ...over,
});
const lease = (agent, project, resource = "gpu", fields = {}) => ({ id: "ls-x", resource, agent, project, for: "work", ...fields });

test("agent-works sys: GPU rows are read from the vendor tool's lines", () => {
  const rows = sysinfo.parseGpus(GPU_TEXT);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].index, rows[0].uuid, rows[0].name, rows[0].util, rows[0].memUsed, rows[0].memTotal, rows[0].temp],
    [0, "GPU-aaaa", "Vendor Model 9000", 37, 4 * GB, 32 * GB, 55]);
  assert.deepEqual([rows[1].util, rows[1].memUsed, rows[1].temp], [null, null, null]);
  assert.deepEqual(sysinfo.parseGpus(""), []);
  assert.deepEqual(sysinfo.parseGpuProcesses(APPS_TEXT).map((r) => [r.pid, r.name, r.mem, r.uuid]),
    [[4321, "render.exe", 2 * GB, "GPU-aaaa"], [77, "python3", null, "GPU-aaaa"], [88, "[Insufficient Permissions]", null, "GPU-bbbb"]]);
});

test("agent-works sys: warnings name over-subscription and undeclared load", () => {
  assert.deepEqual(sysinfo.warningsOf(picture({ gpus: null })), []);
  assert.deepEqual(sysinfo.warningsOf(picture()), [], "37 % is under the busy-and-undeclared mark");
  const hot = picture();
  hot.gpus[0].util = 91;
  assert.deepEqual(sysinfo.warningsOf(hot), ["GPU 0 reads 91 % and nobody has declared it: an undeclared run, or the owner's own work"]);
  hot.leases = [lease("a", "p-1")];
  assert.deepEqual(sysinfo.warningsOf(hot), [], "declared now");
  const over = picture({ leases: [lease("a", "p-1", "gpu", { share: 0.6, mem: 40 * GB, cpu: 6 }), lease("b", "p-2", "gpu", { share: 0.6, mem: 30 * GB, cpu: 6 }),
    lease("c", "p-2", "ram", { mem: 80 * GB })] });
  assert.deepEqual(sysinfo.warningsOf(over), [
    "gpu is over-subscribed: the leases add up to a share of 1.2 (a (alpha), b (beta))",
    "GPU memory is over-subscribed: leases for 70.0 GB on 64.0 GB (a (alpha), b (beta))",
    "memory is over-subscribed: leases for 80.0 GB on 64.0 GB (c (beta))",
    "processors are over-subscribed: leases for 12 of 8 (a (alpha), b (beta))",
  ]);
  const unknown = picture({ gpus: null, memory: null, leases: [lease("a", "p-1", "gpu", { mem: 4000 * GB })] });
  assert.deepEqual(sysinfo.warningsOf(unknown), [], "nothing to hold the number against");
});

test("agent-works sys: the reasons a machine is not quiet", () => {
  const quiet = picture();
  quiet.gpus[0].util = 2;
  assert.deepEqual(sysinfo.quietReasons(quiet, "me", "p-1", 10), []);
  assert.deepEqual(sysinfo.quietReasons(picture(), "me", "p-1", 10), ["GPU 0 reads 37 % (threshold 10 %)"]);
  assert.deepEqual(sysinfo.quietReasons(picture(), "me", "p-1", 50), []);
  const mine = { ...quiet, leases: [lease("me", "p-1")], locks: [{ resource: "gpu-exclusive", scope: "machine", agent: "me", project: "p-1" }] };
  assert.deepEqual(sysinfo.quietReasons(mine, "me", "p-1", 10), [], "my own declarations do not count");
  const theirs = {
    ...quiet,
    leases: [lease("me", "p-2"), lease("b", "p-2", "cpu")],
    locks: [{ resource: "renderer", scope: "machine", agent: "b", project: "p-2", for: "bake" }, { resource: "sim", scope: "p-2", agent: "b", project: "p-2" }],
  };
  assert.deepEqual(sysinfo.quietReasons(theirs, "me", "p-1", 10),
    ['me (beta) holds a lease on gpu: "work"', 'b (beta) holds the lock on renderer: "bake"'], "the like-named agent's GPU lease, and the machine lock");
  assert.equal(sysinfo.quietReasons(theirs, "me", "p-1", 10, { strict: true }).length, 4);
  assert.deepEqual(sysinfo.quietReasons(quiet, "me", "p-1", 10, { cpuUnder: 5 }), ["CPU reads 12 % (threshold 5 %)"]);
  assert.deepEqual(sysinfo.quietReasons(picture({ gpus: null }), "me", "p-1", 10), [], "no reading is not a reason");
});

test("agent-works sys: the record line", () => {
  assert.equal(sysinfo.recordLine(picture()),
    "2026-01-01T00:00:00Z; gpu0 37 % 4.0 GB/32.0 GB; gpu1 ? ?/32.0 GB; cpu 12 %; mem 50 %; leases 0; locks 0; agents 0");
  assert.equal(sysinfo.recordLine(picture({ gpus: null, cpu: {}, memory: null })), "2026-01-01T00:00:00Z; gpu: no reading; cpu: no reading; leases 0; locks 0; agents 0");
  assert.equal(sysinfo.recordLine(picture({ gpus: null, cpu: { load1: 1.5 } })), "2026-01-01T00:00:00Z; gpu: no reading; load 1.5; mem 50 %; leases 0; locks 0; agents 0");
});

test("agent-works sys: every probe answers or says nothing", async () => {
  const c = await sysinfo.cpu(0.05);
  assert.ok(c.count >= 1);
  assert.ok(c.percent === null || (c.percent >= 0 && c.percent <= 100));
  assert.ok(c.load1 === null || c.load1 >= 0);
  const m = sysinfo.memory();
  assert.ok(m === null || (m.available > 0 && m.available <= m.total));
  const here = process.cwd();
  const rows = sysinfo.disks([["here", here], ["also here", here], ["nowhere", path.join(here, "no", "such")]]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].of, ["here", "also here", "nowhere"], "a missing folder is measured where it would live");
  assert.ok(rows[0].free > 0 && rows[0].free <= rows[0].total);
  assert.deepEqual(sysinfo.probe(["aw-no-such-program-xyz"]), [null, true], "a missing tool is no reading");
  assert.deepEqual(sysinfo.probe([NODE, "-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 300 }), [null, false], "too slow: no reading");
  assert.deepEqual(sysinfo.probe([NODE, "-e", "process.exit(3)"]), [null, false], "a failing tool is no reading");
  assert.deepEqual(sysinfo.probe([NODE, "-e", "console.log('ok')"]), ["ok\n", false]);
});

/** A PATH on which the vendor's GPU tool is not found. */
function noGpuTool(w) {
  const empty = path.join(w.tmp, "empty-path");
  fs.mkdirSync(empty, { recursive: true });
  return { env: { PATH: empty, Path: empty } };
}

test("agent-works sys: readings stand beside declarations, and the JSON carries the same", (t) => {
  const w = world(t);
  const other = w.project("other");
  w.aw(["agent", "start", "--name", "a1"]);
  w.aw(["agent", "start", "--name", "b1"], { cwd: other });
  w.aw(["lease", "gpu", "--share", "0.5", "--mem", "8GB", "--for", "bake", "--hold", "--as", "b1"], { cwd: other });
  w.aw(["lock", "acquire", "gpu-exclusive", "--as", "a1", "--for", "benchmark", "--wait", "0"]);
  const r = w.aw(["sys"], noGpuTool(w));
  assert.equal(r.status, 0, r.stderr);
  for (const part of ["  gpu     no GPU reading (nvidia-smi is not on the path)\n", "\n  cpu     ", "\n  memory  ", "\n  disk    ",
    "\nleases\n  gpu share 0.5 8.0 GB  b1 (other)  for ", '\nlocks\n  gpu-exclusive [machine]  a1 (proj)  for 0', "\nagents\n  other: b1\n  proj (this project): a1\n", "\nrecord: "]) {
    assert.ok(r.stdout.includes(part), `${JSON.stringify(part)} in:\n${r.stdout}`);
  }
  assert.match(r.stdout, /^machine at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n/);
  assert.match(r.stdout, /record: \S+; gpu: no reading; .*leases 1; locks 1; agents 2\n$/);
  const doc = w.doc(["sys", "--json"], noGpuTool(w));
  assert.equal(doc.gpus, null);
  assert.equal(doc.gpuNote, "no GPU reading (nvidia-smi is not on the path)");
  for (const key of ["at", "project", "gpus", "gpuNote", "cpu", "memory", "disks", "leases", "locks", "agents", "projects", "totals", "warnings"]) assert.ok(key in doc, key);
  assert.deepEqual(doc.leases.map((x) => [x.resource, x.agent]), [["gpu", "b1"]]);
  assert.deepEqual(doc.locks.map((x) => [x.resource, x.agent, x.scope]), [["gpu-exclusive", "a1", "machine"]]);
  assert.deepEqual(doc.agents.map((x) => x.name).sort(), ["a1", "b1"]);
  assert.deepEqual(Object.values(doc.projects).sort(), ["other", "proj"]);
  assert.ok(doc.disks.some((d) => d.of.includes("store")));
  assert.deepEqual(doc.totals, { gpu: { count: 1, share: 0.5, mem: 8 * GB, cpu: 0 } });
});

test("agent-works sys: works with whatever this machine has", (t) => {
  const w = world(t);
  const doc = w.doc(["sys", "--json"]); // a GPU or none: both are fine
  assert.ok(doc.gpus === null || Array.isArray(doc.gpus));
  assert.deepEqual(doc.leases, []);
  const text = w.aw(["sys"]).stdout;
  assert.match(text, /\nleases: none\nlocks: none\nagents: none registered\n/);
  assert.match(text, /\nrecord: /);
  assert.equal(w.aw(["sys", "--help"]).status, 0);
  assert.equal(w.aw(["sys", "--quiet-for", "lunch"]).status, 2);
  assert.equal(w.aw(["sys", "--gpu-under", "low"]).status, 2);
});

test("agent-works sys: quiet for timing", (t) => {
  const w = world(t);
  const other = w.project("other");
  const quiet = ["sys", "--quiet-for", "timing", "--gpu-under", "101", "--as", "me"]; // whatever the GPU reads, it passes
  const yes = w.aw(quiet);
  assert.equal(yes.status, 0, yes.stdout + yes.stderr);
  assert.match(yes.stdout, /^quiet for timing: yes\n(?: {2}\(.*\)\n)?record: /);
  const held = w.doc(["lease", "gpu", "--for", "training", "--hold", "--as", "b1", "--json"], { cwd: other }).lease.id;
  const no = w.aw(quiet);
  assert.equal(no.status, 1);
  assert.match(no.stdout, /^quiet for timing: NO\n {2}- b1 \(other\) holds a lease on gpu: "training"\n/);
  const doc = w.doc([...quiet, "--json"]);
  assert.deepEqual([doc.quiet.ok, doc.quiet.reasons.length, doc.quiet.for, doc.quiet.gpuUnder, doc.quiet.cpuUnder, doc.quiet.strict], [false, 1, "timing", 101, null, false]);
  assert.equal(w.aw([...quiet.slice(0, -1), "b1"], { cwd: other }).status, 0, "its own lease does not count against it");
  w.aw(["lease", "--release", held, "--as", "b1"], { cwd: other });
  w.aw(["lock", "acquire", "gpu-exclusive", "--as", "b1", "--for", "bench", "--wait", "0"], { cwd: other });
  const locked = w.aw(quiet);
  assert.equal(locked.status, 1);
  assert.match(locked.stdout, /b1 \(other\) holds the lock on gpu-exclusive: "bench"/);
  w.aw(["lock", "release", "gpu-exclusive", "--as", "b1"], { cwd: other });
  w.aw(["lock", "acquire", "sim", "--as", "b1", "--for", "its own", "--wait", "0"], { cwd: other });
  assert.equal(w.aw(quiet).status, 0, "another project's own lock is not machine noise ...");
  assert.equal(w.aw([...quiet, "--strict"]).status, 1, "... unless asked to count everything");
  const blind = w.aw(["sys", "--quiet-for", "timing", "--gpu-under", "0"], noGpuTool(w));
  assert.equal(blind.status, 0, blind.stdout);
  assert.match(blind.stdout, /\(no GPU reading \(nvidia-smi is not on the path\): judged by the declarations alone\)/);
});

test("agent-works sys: the argument shape other plugins' skills name keeps working", (t) => {
  const w = world(t);
  const r = w.aw(["sys", "--quiet-for", "timing"], noGpuTool(w));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^quiet for timing: yes\n/);
});

test("agent-works sys: quiet waits for a lease to end", async (t) => {
  const w = world(t);
  const other = w.project("other");
  const busy = w.spawn(["lease", "gpu", "--for", "short job", "--as", "b1", "--", NODE, "-e", "setTimeout(() => {}, 5000)"], { cwd: other });
  await until(() => w.doc(["leases", "--json"]).leases.length, 20_000, "the lease in the store");
  assert.equal(w.aw(["sys", "--quiet-for", "timing", "--gpu-under", "101", "--as", "me"]).status, 1);
  const waited = w.aw(["sys", "--quiet-for", "timing", "--gpu-under", "101", "--as", "me", "--wait", "30", "--interval", "0.3"]);
  assert.equal(waited.status, 0, waited.stdout);
  assert.match(waited.stderr, /^not quiet yet: b1 \(other\) holds a lease on gpu: "short job"\n$/, "said once, not once per poll");
  assert.match(waited.stdout, /^quiet for timing: yes \(after [\d.]+ s\)\n/);
  assert.equal((await busy.done).status, 0);
  const doc = w.doc(["sys", "--quiet-for", "timing", "--gpu-under", "101", "--strict", "--wait", "0.5", "--interval", "0.2", "--as", "me", "--json"]);
  assert.equal(doc.quiet.ok, true, JSON.stringify(doc.quiet));
  assert.ok(doc.quiet.waitedSeconds >= 0);
});
