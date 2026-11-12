// agent-works scripts/machine-doctor.mjs: what the plugin needs on this
// machine: Node, git, and the command line of the forge the remote is on.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PLUGIN, script } from "./agent-works-homes.mjs";
import { runNode, tempDir } from "./helpers.mjs";

const machine = await script("machine-doctor.mjs");
/** A folder holding programs of the given names, and a lookup that knows no other folder: `[dir, which]`. */
function bin(t, ...names) {
  const dir = tempDir(t, "aw-machine-bin-");
  for (const name of names) fs.writeFileSync(path.join(dir, name), "");
  const which = (name) => (fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : null);
  return [dir, which];
}
/** A runner for `detect`: git answers with this remote URL, nothing else runs. */
const remote = (url) => (cmd, argv) => (cmd === "git" && argv[0] === "remote" && url ? { status: 0, stdout: `${url}\n`, stderr: "" } : { status: 1, stdout: "", stderr: "" });
const rows = (report) => report.map((c) => [c.id, c.hard, c.status]);

test("agent-works machine-doctor: Node, git and the forge's command line are all there", (t) => {
  const [dir, which] = bin(t, "git", "gh");
  const report = machine.checks({ root: dir, env: {}, which, run: remote("git@github.com:acme/widgets.git") });
  assert.deepEqual(rows(report), [["node", true, "ok"], ["git", true, "ok"], ["forge", false, "ok"]]);
  assert.equal(report[0].detail, `Node ${process.versions.node}`);
  assert.equal(report[1].detail, path.join(dir, "git"));
  assert.equal(report[2].detail, `gh for github.com: ${path.join(dir, "gh")}`);
  assert.equal(machine.passes(report), true);
  assert.deepEqual(machine.hardGaps({}, { which }), []);
  assert.ok(machine.render(report).startsWith("machine: 3 ok; hard prerequisites ok\n  ok            node   Node "));
});

test("agent-works machine-doctor: an old Node and a missing git are hard, with the fix on the next line", (t) => {
  const [dir, which] = bin(t);
  const report = machine.checks({ root: dir, env: {}, which, nodeVersion: "20.11.1" });
  assert.deepEqual(rows(report), [["node", true, "misconfigured"], ["git", true, "missing"], ["forge", false, "skipped"]]);
  assert.equal(report[0].detail, "Node 20.11.1 is older than 22");
  assert.ok(report[0].fix.startsWith("install Node 22 or newer"));
  assert.equal(report[2].detail, "needs git first");
  assert.equal(machine.passes(report), false);
  assert.deepEqual(machine.hardGaps({}, { which, nodeVersion: "20.11.1" }), ["Node 20.11.1 is older than 22", "git is not installed"]);
  const text = machine.render(report);
  assert.ok(text.startsWith("machine: 1 misconfigured, 1 missing, 1 skipped; hard prerequisites failing: node, git\n"), text);
  assert.ok(text.includes("\n  missing       git    git is not on the PATH\n                       fix: install git from "), text);
});

test("agent-works machine-doctor: the forge is the one the remote is on, and a missing command line only warns", (t) => {
  const [dir, which] = bin(t, "git");
  let report = machine.checks({ root: dir, env: {}, which, run: remote("https://gitlab.com/acme/widgets.git") });
  assert.deepEqual(rows(report)[2], ["forge", false, "missing"]);
  assert.equal(report[2].detail, "glab is not on the PATH, and the remote is on gitlab.com");
  assert.ok(report[2].fix.includes("https://gitlab.com/gitlab-org/cli"));
  assert.equal(machine.passes(report), true);
  report = machine.checks({ root: dir, env: {}, which, run: remote("https://github.com/acme/widgets.git") });
  assert.equal(report[2].detail, "gh is not on the PATH, and the remote is on github.com");
  report = machine.checks({ root: dir, env: {}, which, run: remote("https://git.example.org/acme/widgets.git") });
  assert.deepEqual([report[2].status, report[2].detail], ["skipped", "the remote's host (git.example.org) names no forge this plugin knows: cards stay local"]);
  report = machine.checks({ root: dir, env: {}, which, run: remote(null) });
  assert.deepEqual([report[2].status, report[2].detail], ["skipped", "no remote named origin: cards stay local"]);
  report = machine.checks({ root: null, env: {}, which });
  assert.deepEqual([report[2].status, report[2].detail], ["skipped", "not inside a repository"]);
});

test("agent-works machine-doctor: run by itself it prints the report, as text or JSON, and exits 1 on a hard gap", (t) => {
  const dir = tempDir(t, "aw-machine-run-");
  const file = path.join(PLUGIN, "scripts", "machine-doctor.mjs");
  let r = runNode(file, ["--json", "--root", dir], { cwd: dir });
  const doc = JSON.parse(r.stdout);
  assert.deepEqual([r.stderr, Object.keys(doc), doc.checks.map((c) => c.id)], ["", ["ok", "checks"], ["node", "git", "forge"]]);
  assert.equal(r.status, doc.ok ? 0 : 1);
  r = runNode(file, [], { cwd: dir });
  assert.ok(r.stdout.startsWith("machine: "), r.stdout);
  r = runNode(file, ["--help"], { cwd: dir });
  assert.deepEqual([r.status, r.stdout.startsWith("usage: aw doctor --machine [--json]\n")], [0, true]);
  r = runNode(file, ["--nope"], { cwd: dir });
  assert.deepEqual([r.status, r.stdout], [2, ""]);
  assert.ok(r.stderr.startsWith("machine-doctor: "), r.stderr);
});
