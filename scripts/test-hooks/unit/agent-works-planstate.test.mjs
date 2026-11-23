// An approved plan's state on disk: plan.json and an append-only plan.log
// under the work tree's own git dir, so the main checkout and each worktree
// keep their own, a context clear keeps it, and removing the worktree drops it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, tempDir, tempRepo, write } from "./helpers.mjs";

const { appendPlanEvent, dropPlanState, locate, planStateDir, readPlanState, writePlanState } = await import(
  pathToFileURL(path.join(REPO, "plugins", "agentic-engineering", "skills", "agent-works", "scripts", "io.mjs")).href);

function repoWithWorktree(t) {
  const main = tempRepo(t, "plan-state-");
  write(main.dir, "README.md", "fixture\n");
  write(main.dir, ".gitignore", ".claude/\n");
  main.git("add", "-A");
  main.git("commit", "-q", "-m", "fixture");
  const worktree = path.join(main.dir, ".claude", "worktrees", "child");
  main.git("worktree", "add", "-q", "-b", "feat/child", worktree);
  return { main: main.dir, worktree };
}

const STATE = { v: 1, planFile: "/plans/p.md", at: "2026-11-19T10:00:00.000Z", units: [{ id: "U1", runs: "subagent", after: [], files: ["a"], model: "opus" }], waves: [["U1"]] };

test("locate names the work tree's own git dir", (t) => {
  const r = repoWithWorktree(t);
  const main = locate(r.main);
  const wt = locate(r.worktree);
  assert.equal(fs.realpathSync.native(main.gitDir), fs.realpathSync.native(path.join(r.main, ".git")));
  assert.equal(planStateDir(main), path.join(main.gitDir, "agent-works"));
  assert.notEqual(wt.gitDir, main.gitDir);
  assert.equal(wt.commonDir, main.commonDir);
  assert.ok(path.isAbsolute(wt.gitDir));
});

test("no state reads as null", (t) => {
  const r = repoWithWorktree(t);
  assert.equal(readPlanState(locate(r.main)), null);
});

test("state and events round-trip, and a write truncates the log", (t) => {
  const r = repoWithWorktree(t);
  const loc = locate(r.main);
  writePlanState(loc, STATE);
  assert.deepEqual(readPlanState(loc), { state: STATE, events: [] });
  appendPlanEvent(loc, { t: "start", unit: "U1", at: "2026-11-19T10:01:00.000Z" });
  appendPlanEvent(loc, { t: "returned", unit: "U1", at: "2026-11-19T10:02:00.000Z" });
  assert.deepEqual(readPlanState(loc).events.map((e) => e.t), ["start", "returned"]);
  writePlanState(loc, { ...STATE, at: "2026-11-19T11:00:00.000Z" });
  assert.deepEqual(readPlanState(loc).events, []);
  assert.equal(fs.readdirSync(planStateDir(loc)).filter((f) => f.endsWith(".tmp")).length, 0);
});

test("a malformed log line is skipped, and a malformed plan.json is no state", (t) => {
  const r = repoWithWorktree(t);
  const loc = locate(r.main);
  writePlanState(loc, STATE);
  appendPlanEvent(loc, { t: "start", unit: "U1", at: "2026-11-19T10:01:00.000Z" });
  fs.appendFileSync(path.join(planStateDir(loc), "plan.log"), "{not json\n\n");
  appendPlanEvent(loc, { t: "returned", unit: "U1", at: "2026-11-19T10:02:00.000Z" });
  assert.deepEqual(readPlanState(loc).events.map((e) => e.t), ["start", "returned"]);
  fs.writeFileSync(path.join(planStateDir(loc), "plan.json"), "{half");
  assert.equal(readPlanState(loc), null);
});

test("an event appended before any state waits in the log, and a state with no log has no events", (t) => {
  const r = repoWithWorktree(t);
  const loc = locate(r.main);
  appendPlanEvent(loc, { t: "start", unit: "U1", at: "2026-11-19T10:01:00.000Z" });
  assert.equal(readPlanState(loc), null);
  writePlanState(loc, STATE);
  fs.rmSync(path.join(planStateDir(loc), "plan.log"));
  assert.deepEqual(readPlanState(loc), { state: STATE, events: [] });
});

test("the main checkout and a worktree keep separate state", (t) => {
  const r = repoWithWorktree(t);
  const main = locate(r.main);
  const wt = locate(r.worktree);
  writePlanState(wt, STATE);
  appendPlanEvent(wt, { t: "start", unit: "U1", at: "2026-11-19T10:01:00.000Z" });
  assert.equal(readPlanState(main), null);
  assert.equal(readPlanState(wt).events.length, 1);
  writePlanState(main, { ...STATE, planFile: "/plans/other.md" });
  assert.equal(readPlanState(wt).state.planFile, "/plans/p.md");
  assert.equal(readPlanState(main).events.length, 0);
});

test("drop removes both files, and dropping nothing is fine", (t) => {
  const r = repoWithWorktree(t);
  const loc = locate(r.main);
  dropPlanState(loc);
  writePlanState(loc, STATE);
  appendPlanEvent(loc, { t: "start", unit: "U1", at: "2026-11-19T10:01:00.000Z" });
  dropPlanState(loc);
  assert.equal(readPlanState(loc), null);
  assert.equal(fs.existsSync(path.join(planStateDir(loc), "plan.log")), false);
  dropPlanState(loc);
});

test("nothing it writes shows in git status", (t) => {
  const r = repoWithWorktree(t);
  const loc = locate(r.worktree);
  writePlanState(loc, STATE);
  appendPlanEvent(loc, { t: "start", unit: "U1", at: "2026-11-19T10:01:00.000Z" });
  assert.equal(execFileSync("git", ["-C", r.worktree, "status", "--porcelain"], { encoding: "utf8" }), "");
});

test("outside a repository there is nowhere to keep a plan: nothing is read, written, or thrown", (t) => {
  const loc = locate(tempDir(t, "plan-state-loose-"));
  assert.deepEqual([loc.git, loc.gitDir, planStateDir(loc)], [false, null, null]);
  assert.equal(writePlanState(loc, STATE), false);
  appendPlanEvent(loc, { t: "start", unit: "U1", at: STATE.at });
  dropPlanState(loc);
  assert.equal(readPlanState(loc), null);
});

test("a plan.json that is not a plan's state is no state", (t) => {
  const r = repoWithWorktree(t);
  const loc = locate(r.main);
  writePlanState(loc, STATE);
  fs.writeFileSync(path.join(planStateDir(loc), "plan.json"), '{"v":1}');
  assert.equal(readPlanState(loc), null);
});
