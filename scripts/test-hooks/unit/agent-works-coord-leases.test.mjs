// agent-works `aw lease` and `aw leases`: declared use that lives with a
// command or until released, and adds up.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NODE, deadPid, load, stampIn, until, world } from "./agent-works-coord-support.mjs";

const leases = await load("scripts/coord/leases.mjs");
const store = await load("scripts/coord/store.mjs");
const common = await load("lib/common.mjs");

const GB = 1024 ** 3;
const live = (w, cwd = w.proj) => w.doc(["leases", "--json"], { cwd }).leases;

test("agent-works lease: a lease lives while its command runs, and another project sees it", async (t) => {
  const w = world(t);
  const other = w.project("other");
  const run = w.spawn(["lease", "gpu", "--share", "0.5", "--mem", "12GB", "--cpu", "4", "--as", "trainer", "--for", "fine-tune",
    "--", NODE, "-e", "console.log(process.env.AW_LEASE); setTimeout(() => {}, 4000)"]);
  const rows = await until(() => {
    const found = live(w, other);
    return found.length ? found : null;
  }, 20_000, "the lease in the store");
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.resource, row.agent, row.share, row.mem, row.cpu, row.for, row.hold, row.until],
    ["gpu", "trainer", 0.5, 12 * GB, 4, "fine-tune", false, null]);
  assert.equal(row.project, w.id());
  assert.match(row.id, /^ls-[0-9a-f]{6}$/);
  assert.ok(w.aw(["leases"], { cwd: other }).stdout.includes("gpu share 0.5 12.0 GB 4 cpu  trainer (proj)  for "));
  const done = await run.done;
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout.trim(), row.id);
  assert.match(done.stderr, new RegExp(`^lease ${row.id}: gpu share 0\\.5 12\\.0 GB 4 cpu  for \\d s: "fine-tune"\\nlease ${row.id}: released \\(exit 0\\)\\n$`));
  assert.deepEqual(live(w), []);
});

test("agent-works lease: the lease goes when the command fails, cannot start, or is killed at its limit", (t) => {
  const w = world(t);
  const failing = w.aw(["lease", "gpu", "--for", "fails", "--", NODE, "-e", "process.exit(7)"]);
  assert.equal(failing.status, 7, failing.stderr);
  assert.deepEqual(live(w), []);
  const missing = w.aw(["lease", "gpu", "--for", "no such program", "--", "aw-no-such-program-xyz", "a"]);
  assert.equal(missing.status, 127);
  assert.match(missing.stderr, /could not start the command: 'aw-no-such-program-xyz' was not found/);
  assert.deepEqual(live(w), []);
  const hanging = w.aw(["lease", "gpu", "--for", "hangs", "--max-minutes", "0.02", "--", NODE, "-e", "setTimeout(() => {}, 60000)"]);
  assert.equal(hanging.status, 124, hanging.stderr);
  assert.match(hanging.stderr, /the command ran into its 0\.02 min limit: its process tree was killed/);
  assert.deepEqual(live(w), []);
  // One word after -- is a program, not a shell line.
  assert.equal(w.aw(["lease", "cpu", "--for", "shell line", "--", `${NODE} -e 0 && ${NODE} -e 0`]).status, 127);
  assert.deepEqual(live(w), []);
});

test("agent-works lease: the argument shape other plugins' skills name keeps working", { skip: process.platform === "win32" && "echo is not a program on Windows" }, (t) => {
  const w = world(t);
  const r = w.aw(["lease", "gpu", "--for", "x", "--", "echo", "hi"]);
  assert.deepEqual([r.status, r.stdout], [0, "hi\n"], r.stderr);
  assert.deepEqual(live(w), []);
});

test("agent-works lease: hold and release", (t) => {
  const w = world(t);
  const { lease, others } = w.doc(["lease", "gpu", "--share", "0.25", "--for", "notebook", "--hold", "--as", "a1", "--json"]);
  assert.deepEqual(others, []);
  assert.equal(lease.hold, true);
  assert.equal(lease.pid, process.pid, "the session, so the lease ends with it");
  assert.ok(Math.abs(store.parseIso(lease.until) - Date.now() / 1000 - 120 * 60) < 30);
  assert.deepEqual(live(w).map((r) => r.id), [lease.id]);
  const refused = w.aw(["lease", "--release", lease.id, "--as", "a2"]);
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr, `${lease.id}: held by a1 (proj), not by a2: only its holder releases a lease\n`);
  assert.equal(w.aw(["lease", "--release", lease.id, "--as", "a1"], { cwd: w.project("other") }).status, 1, "the like-named agent of another project");
  const released = w.aw(["lease", "--release", lease.id, "--as", "a1"]);
  assert.deepEqual([released.status, released.stdout], [0, `${lease.id}: released\n`]);
  assert.deepEqual(live(w), []);
  const again = w.aw(["lease", "--release", lease.id, "--as", "a1"]);
  assert.deepEqual([again.status, again.stdout], [0, `${lease.id}: no such lease (already gone)\n`]);
  const text = w.aw(["lease", "gpu", "--for", "x", "--hold", "--minutes", "5"]).stdout;
  assert.match(text, /^ls-[0-9a-f]{6}: gpu  for \d s, until \S+: "x"\nrelease it with: aw lease --release ls-[0-9a-f]{6}\n$/);
  assert.ok(Math.abs(store.parseIso(live(w)[0].until) - Date.now() / 1000 - 300) < 30);
  w.writeConfig(w.proj, { coordination: { holdMinutes: 10 } });
  const short = w.doc(["lease", "cpu", "--for", "y", "--hold", "--json"]).lease;
  assert.ok(Math.abs(store.parseIso(short.until) - Date.now() / 1000 - 600) < 30, "the project's own default");
});

test("agent-works lease: leases whose process is gone or whose time is over are dropped", (t) => {
  const w = world(t);
  fs.mkdirSync(w.home, { recursive: true });
  const base = { resource: "gpu", agent: "a", project: "p-00000000", for: "x", since: stampIn(0) };
  const file = path.join(w.home, "resources.json");
  fs.writeFileSync(file, JSON.stringify({ leases: [
    { id: "ls-dead", ...base, pid: deadPid() },
    { id: "ls-over", ...base, pid: process.pid, until: stampIn(-5) },
    { id: "ls-live", ...base, pid: process.pid, until: stampIn(600) },
    "not a lease",
  ] }));
  assert.deepEqual(leases.live(w.home, { prune: false }).map((r) => r.id), ["ls-live"]);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).leases.length, 4, "a reader that was asked not to tidy leaves the file alone");
  assert.deepEqual(live(w).map((r) => r.id), ["ls-live"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).leases.map((r) => r.id), ["ls-live"]);
  assert.deepEqual(leases.live(path.join(w.tmp, "no-store")), [], "no store: no leases, and no error");
});

test("agent-works lease: leases add up, and over-subscription is a warning, not a refusal", (t) => {
  const w = world(t);
  const other = w.project("other");
  assert.equal(w.aw(["lease", "gpu", "--share", "0.7", "--for", "a", "--hold", "--as", "a1"]).status, 0);
  const second = w.aw(["lease", "gpu", "--share", "0.6", "--mem", "2000GB", "--for", "b", "--hold", "--as", "b1"], { cwd: other });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /^also on gpu right now:\n {2}gpu share 0\.7 {2}a1 \(proj\) {2}for /);
  const doc = w.doc(["leases", "--json"]);
  assert.deepEqual([doc.totals.gpu.count, doc.totals.gpu.share, doc.totals.gpu.mem], [2, 1.3, 2000 * GB]);
  assert.ok(w.aw(["leases"]).stdout.includes("  gpu: 2 leases add up to share 1.3 2.0 TB\n"));
  assert.equal(w.doc(["leases", "--resource", "cpu", "--json"]).leases.length, 0);
  const { warnings } = w.doc(["sys", "--json"]);
  assert.ok(warnings.some((x) => x.includes("gpu is over-subscribed") && x.includes("1.3")), JSON.stringify(warnings));
});

test("agent-works lease: concurrent leases all land", async (t) => {
  const w = world(t);
  const runs = await Promise.all(Array.from({ length: 8 }, (_, i) => w.spawn(["lease", "gpu", "--share", "0.1", "--for", `n${i}`, "--hold", "--as", `a${i}`]).done));
  assert.deepEqual(runs.map((r) => r.status), Array(8).fill(0), runs.map((r) => r.stderr).join("\n"));
  assert.deepEqual(live(w).map((r) => r.agent).sort(), Array.from({ length: 8 }, (_, i) => `a${i}`));
});

test("agent-works lease: usage", (t) => {
  const w = world(t);
  const refused = (args) => w.aw(["lease", ...args]);
  assert.match(refused(["gpu", "--share", "1.5", "--for", "x", "--hold"]).stderr, /--share 1\.5: a fraction of the resource, 0 to 1/);
  assert.match(refused(["gpu", "--hold"]).stderr, /say what it is for: --for/);
  assert.match(refused(["gpu", "--for", "x"]).stderr, /either -- <command> \(the lease lives while it runs\) or --hold/);
  assert.equal(refused(["gpu", "--for", "x", "--hold", "--", "echo", "x"]).status, 2, "both");
  assert.match(refused(["gpu", "--mem", "12", "--for", "x", "--hold"]).stderr, /memory '12': a number and a unit, such as 12GB or 512MB/);
  assert.match(refused(["--for", "x", "--hold"]).stderr, /name the resource/);
  assert.equal(refused(["bad/name", "--for", "x", "--hold"]).status, 2);
  for (const args of [["gpu", "--share", "1.5", "--for", "x", "--hold"], ["gpu", "--hold"], ["gpu", "--for", "x"], ["--for", "x", "--hold"]]) {
    assert.equal(refused(args).status, 2, args.join(" "));
  }
  assert.deepEqual(live(w), []);
  assert.equal(w.aw(["leases"]).stdout, "no leases\n");
  const help = w.aw(["lease", "--help"]);
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes("aw lease --release ID") && help.stdout.includes("--max-minutes N"));
  assert.equal(w.aw(["leases", "--help"]).status, 0);
});

test("agent-works lease: memory sizes and totals", () => {
  assert.equal(leases.parseMem("12GB"), 12 * GB);
  assert.equal(leases.parseMem("512 mb"), 512 * 1024 ** 2);
  assert.equal(leases.parseMem("1.5g"), 1.5 * GB);
  assert.equal(leases.parseMem("2GiB"), 2 * GB);
  for (const bad of ["12", "lots", "GB", "-1GB"]) assert.throws(() => leases.parseMem(bad), common.AwError, bad);
  assert.deepEqual([leases.fmtBytes(12 * GB), leases.fmtBytes(512 * 1024 ** 2), leases.fmtBytes(2048), leases.fmtBytes(null)], ["12.0 GB", "512.0 MB", "2 KB", "?"]);
  assert.deepEqual(leases.totals([{ resource: "gpu", share: 0.1 }, { resource: "gpu", share: 0.2, mem: 5, cpu: 1.5 }, { resource: "cpu", cpu: 2 }]),
    { gpu: { count: 2, share: 0.3, mem: 5, cpu: 1.5 }, cpu: { count: 1, share: 0, mem: 0, cpu: 2 } });
  assert.equal(leases.totalLine("x", { count: 2, share: 0, mem: 0, cpu: 0 }), "x: 2 leases add up to nothing stated");
});
