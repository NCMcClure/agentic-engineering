// agent-works scripts/machine-doctor.mjs: what the area needs on this
// machine (Node, git, and the command line of the forge the remote is on),
// and the two things a machine coming from the separate plugins leans on:
// a Claude Code build that installs a dependency with a stub's update, and
// the switch that stops it.
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
/** A reader of the Claude Code build that starts no process: this version, or none found. */
const build = (version) => () => (version ? { version } : { none: "no claude on the PATH, and no session naming its own" });
const current = build(machine.CLAUDE_CODE_FLOOR);
const rows = (report) => report.map((c) => [c.id, c.hard, c.status]);
const row = (report, id) => report.find((c) => c.id === id);

test("agent-works machine-doctor: Node, git, the forge's command line, the build and the switch are all there", (t) => {
  const [dir, which] = bin(t, "git", "gh");
  const report = machine.checks({ root: dir, env: {}, which, claude: current, run: remote("git@github.com:acme/widgets.git") });
  assert.deepEqual(rows(report), [["node", true, "ok"], ["git", true, "ok"], ["forge", false, "ok"], ["claude", false, "ok"], ["deps", false, "ok"]]);
  assert.equal(report[0].detail, `Node ${process.versions.node}`);
  assert.equal(report[1].detail, path.join(dir, "git"));
  assert.equal(report[2].detail, `gh for github.com: ${path.join(dir, "gh")}`);
  assert.equal(report[3].detail, `Claude Code ${machine.CLAUDE_CODE_FLOOR}`);
  assert.equal(machine.passes(report), true);
  assert.deepEqual(machine.hardGaps({}, { which }), []);
  assert.ok(machine.render(report).startsWith("machine: 5 ok; hard prerequisites ok\n  ok            node   Node "));
});

test("agent-works machine-doctor: an old Node and a missing git are hard, with the fix on the next line", (t) => {
  const [dir, which] = bin(t);
  const report = machine.checks({ root: dir, env: {}, which, claude: current, nodeVersion: "20.11.1" });
  assert.deepEqual(rows(report).slice(0, 3), [["node", true, "misconfigured"], ["git", true, "missing"], ["forge", false, "skipped"]]);
  assert.equal(report[0].detail, "Node 20.11.1 is older than 22");
  assert.ok(report[0].fix.startsWith("install Node 22 or newer"));
  assert.equal(report[2].detail, "needs git first");
  assert.equal(machine.passes(report), false);
  assert.deepEqual(machine.hardGaps({}, { which, nodeVersion: "20.11.1" }), ["Node 20.11.1 is older than 22", "git is not installed"]);
  const text = machine.render(report);
  assert.ok(text.startsWith("machine: 1 misconfigured, 1 missing, 1 skipped, 2 ok; hard prerequisites failing: node, git\n"), text);
  assert.ok(text.includes("\n  missing       git    git is not on the PATH\n                       fix: install git from "), text);
});

test("agent-works machine-doctor: the forge is the one the remote is on, and a missing command line only warns", (t) => {
  const [dir, which] = bin(t, "git");
  const checks = (options) => machine.checks({ env: {}, which, claude: current, ...options });
  let report = checks({ root: dir, run: remote("https://gitlab.com/acme/widgets.git") });
  assert.deepEqual(rows(report)[2], ["forge", false, "missing"]);
  assert.equal(report[2].detail, "glab is not on the PATH, and the remote is on gitlab.com");
  assert.ok(report[2].fix.includes("https://gitlab.com/gitlab-org/cli"));
  assert.equal(machine.passes(report), true);
  report = checks({ root: dir, run: remote("https://github.com/acme/widgets.git") });
  assert.equal(report[2].detail, "gh is not on the PATH, and the remote is on github.com");
  report = checks({ root: dir, run: remote("https://git.example.org/acme/widgets.git") });
  assert.deepEqual([report[2].status, report[2].detail], ["skipped", "the remote's host (git.example.org) names no forge this plugin knows: cards stay local"]);
  report = checks({ root: dir, run: remote(null) });
  assert.deepEqual([report[2].status, report[2].detail], ["skipped", "no remote named origin: cards stay local"]);
  report = checks({ root: null });
  assert.deepEqual([report[2].status, report[2].detail], ["skipped", "not inside a repository"]);
});

test("agent-works machine-doctor: a build older than the floor warns with both ways out, and no claude to ask is skipped", (t) => {
  const [dir, which] = bin(t, "git");
  const checks = (claude) => row(machine.checks({ root: dir, env: {}, which, claude, run: remote(null) }), "claude");
  const old = checks(build("2.1.99"));
  assert.deepEqual([old.hard, old.status], [false, "misconfigured"]);
  assert.ok(old.detail.startsWith(`Claude Code 2.1.99 is older than ${machine.CLAUDE_CODE_FLOOR}: `), old.detail);
  assert.match(old.detail, /a stub that depends on agentcraft@agentic-engineering/);
  assert.match(old.fix, /updates Claude Code/);
  assert.match(old.fix, /claude plugin install agentcraft@agentic-engineering/);
  assert.equal(checks(build("2.2.0")).status, "ok");
  assert.equal(checks(build("3.0.0")).status, "ok");
  const none = checks(build(null));
  assert.deepEqual([none.status, none.detail, none.fix], ["skipped", "no claude on the PATH, and no session naming its own", undefined]);
  // A soft check never fails the machine.
  assert.equal(machine.passes(machine.checks({ root: dir, env: {}, which, claude: build("2.1.99"), run: remote(null) })), true);
});

test("agent-works machine-doctor: versions compare part by part as numbers, and the build is read from what claude prints", (t) => {
  assert.equal(machine.olderThan("2.1.99", "2.1.321"), true, "99 is less than 321, whatever the strings say");
  assert.equal(machine.olderThan("2.1.321", "2.1.321"), false);
  assert.equal(machine.olderThan("2.2.0", "2.1.321"), false);
  assert.equal(machine.olderThan("1.9.999", "2.1.321"), true);
  const [, which] = bin(t);
  assert.deepEqual(machine.claudeCodeVersion({}, which), { none: "no claude on the PATH, and no session naming its own" });
  // The program a session names is asked before the PATH is: here it is this Node, whose `v24.7.0` is no
  // bare version, so the answer says which program printed none.
  const asked = machine.claudeCodeVersion({ CLAUDE_CODE_EXECPATH: process.execPath }, which);
  assert.deepEqual(asked, { none: `${process.execPath} --version printed no version` });
});

test("agent-works machine-doctor: the switch that stops a dependency install warns when it is set, and unset, 0 or false is ok", (t) => {
  const [dir, which] = bin(t, "git");
  const deps = (env) => row(machine.checks({ root: dir, env, which, claude: current, run: remote(null) }), "deps");
  const name = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";
  for (const env of [{}, { [name]: "" }, { [name]: "0" }, { [name]: "false" }, { [name]: " False " }]) {
    assert.deepEqual([deps(env).hard, deps(env).status], [false, "ok"], JSON.stringify(env));
  }
  for (const value of ["1", "true", "yes"]) {
    const set = deps({ [name]: value });
    assert.equal(set.status, "misconfigured", value);
    assert.ok(set.detail.startsWith(`${name} is set: Claude Code installs no dependency while it is`), set.detail);
    assert.match(set.fix, /runs the update once without the variable/);
  }
});

test("agent-works machine-doctor: run by itself it prints the report, as text or JSON, and exits 1 on a hard gap", (t) => {
  const dir = tempDir(t, "aw-machine-run-");
  const file = path.join(PLUGIN, "scripts", "machine-doctor.mjs");
  // No claude is found from an empty PATH entry of its own, so the run starts none.
  const env = { ...process.env, CLAUDE_CODE_EXECPATH: "" };
  let r = runNode(file, ["--json", "--root", dir], { cwd: dir, env });
  const doc = JSON.parse(r.stdout);
  assert.deepEqual([r.stderr, Object.keys(doc), doc.checks.map((c) => c.id)], ["", ["ok", "checks"], ["node", "git", "forge", "claude", "deps"]]);
  assert.equal(r.status, doc.ok ? 0 : 1);
  r = runNode(file, [], { cwd: dir, env });
  assert.ok(r.stdout.startsWith("machine: "), r.stdout);
  r = runNode(file, ["--help"], { cwd: dir });
  assert.deepEqual([r.status, r.stdout.startsWith("usage: aw doctor --machine [--json]\n")], [0, true]);
  assert.match(r.stdout, /2\.1\.321/);
  r = runNode(file, ["--nope"], { cwd: dir });
  assert.deepEqual([r.status, r.stdout], [2, ""]);
  assert.ok(r.stderr.startsWith("machine-doctor: "), r.stderr);
});
