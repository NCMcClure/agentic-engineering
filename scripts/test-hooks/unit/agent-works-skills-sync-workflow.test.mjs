// The sync-cards workflow run end to end with stubbed agents, so its routing
// is checked without a model: opus assesses and confirms, the investigator is
// haiku for in-flight and backlog and sonnet for suggested, settled cards are
// not investigated, confirm batches run one after another, and the report
// sorts each card into applied, proposed, kept, failed, or a violation of
// what its scope allows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const WORKFLOW = path.join(REPO, "plugins", "agent-works", "skills", "sync-cards", "workflows", "sync.js");
const SRC = fs.readFileSync(WORKFLOW, "utf8");
const AsyncFunction = (async () => {}).constructor;

/** Run the script as the Workflow tool would, answering each agent() by its label. */
async function runWorkflow(args, respond) {
  const calls = [], logs = [];
  let active = 0, peak = 0;
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, ...opts });
    const writes = opts.label.startsWith("confirm:");
    if (writes) peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    if (writes) active--;
    const out = respond(opts.label, prompt);
    return out === undefined ? null : structuredClone(out);
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const pipeline = () => { throw new Error("the sync does not pipeline"); };
  const body = new AsyncFunction("args", "agent", "parallel", "pipeline", "phase", "log", "budget", SRC.replace(/^export const meta/m, "const meta"));
  const result = await body(args, agent, parallel, pipeline, () => {}, (m) => logs.push(m), { total: null, spent: () => 0, remaining: () => Infinity });
  return { result, calls, logs, peak, by: (label) => calls.find((c) => c.label === label), all: (prefix) => calls.filter((c) => c.label.startsWith(prefix)) };
}

const ARGS = { root: "/repo", pluginRoot: "/plugin/" };
const SHA = "a".repeat(40);
const assess = (ids, settled = []) => ({ cards: ids.map((id) => (settled.includes(id) ? { id, verdict: "settled", why: "card shows it" } : { id, verdict: "investigate", why: "?", brief: `check ${id}`, checks: [`git log --grep ${id}`] })) });
const report = (id, state, extra = {}) => ({ id, status: "in-progress", state, confidence: "high", evidence: [{ check: "gh pr view", saw: state }], summary: state, ...extra });

test("agent-works sync workflow: in-flight: opus assesses and confirms, haiku investigates, settled cards are left alone", async () => {
  const ids = ["0001", "0002", "0003", "0004"];
  const { result, by, all } = await runWorkflow({ ...ARGS, scope: "in-flight", ids }, (label) => {
    if (label === "assess:0") return assess(ids, ["0004"]);
    if (label === "investigate:0001") return report("0001", "merged", { sha: SHA, mr: { iid: 12, state: "merged", merge_commit_sha: SHA } });
    if (label === "investigate:0002") return report("0002", "abandoned");
    if (label === "investigate:0003") return report("0003", "active");
    if (label === "confirm:0") {
      return { cards: [
        { id: "0001", state: "merged", action: "apply", command: `done 0001 --merged ${SHA}`, why: "!12 merged", ran: true },
        { id: "0002", state: "abandoned", action: "propose", command: "abandon 0002", why: "!9 closed unmerged" },
        { id: "0003", state: "active", action: "keep", why: "already in progress" },
      ] };
    }
  });
  assert.deepEqual([by("assess:0").model, by("assess:0").effort], ["opus", "medium"]);
  assert.deepEqual(all("investigate:").map((c) => [c.label, c.model, c.effort]), [["investigate:0001", "haiku", "low"], ["investigate:0002", "haiku", "low"], ["investigate:0003", "haiku", "low"]]);
  assert.equal(by("investigate:0004"), undefined, "a settled card is not investigated");
  assert.deepEqual([by("confirm:0").model, by("confirm:0").effort], ["opus", "medium"]);
  assert.match(by("assess:0").prompt, /node "\/plugin\/scripts\/aw\.mjs" board evidence 0001 0002 0003 0004 --json/);
  assert.match(by("confirm:0").prompt, /- merged: `done <id> --merged <full merge commit sha>` \(only with the full merge commit sha\)/);
  assert.match(by("confirm:0").prompt, /- abandoned: `abandon <id>`/);
  assert.match(by("investigate:0001").prompt, /gh pr view <number>.*\n.*glab mr view <number>/, "either forge");
  assert.deepEqual(result.applied, [{ id: "0001", state: "merged", command: `done 0001 --merged ${SHA}`, why: "!12 merged" }]);
  assert.deepEqual(result.proposed, [{ id: "0002", state: "abandoned", action: "abandon", command: "abandon 0002", why: "!9 closed unmerged" }]);
  assert.deepEqual(result.kept.map((k) => [k.id, k.by]), [["0004", "assess"], ["0003", "confirm"]]);
  assert.deepEqual([result.failed, result.violations], [[], []]);
  assert.equal(result.investigator, "haiku");
});

test("agent-works sync workflow: suggested: sonnet investigates, nothing is applied, and an apply anyway is a violation", async () => {
  const ids = ["0010", "0011"];
  const { result, all, by } = await runWorkflow({ ...ARGS, scope: "suggested", ids }, (label) => {
    if (label === "assess:0") return assess(ids);
    if (label.startsWith("investigate:")) return report(label.split(":")[1], label.endsWith("0010") ? "worth-doing" : "landed", { status: "suggested" });
    if (label === "confirm:0") {
      return { cards: [
        { id: "0010", state: "worth-doing", action: "propose", why: "still broken" },
        { id: "0011", state: "landed", action: "apply", command: "move 0011 done", why: "shipped in abc", ran: true },
      ] };
    }
  });
  assert.deepEqual(all("investigate:").map((c) => [c.model, c.effort]), [["sonnet", "medium"], ["sonnet", "medium"]]);
  assert.match(by("confirm:0").prompt, /- none: this scope moves nothing/);
  assert.match(by("confirm:0").prompt, /- worth-doing: `move <id> backlog`/);
  assert.deepEqual(result.proposed, [{ id: "0010", state: "worth-doing", action: "accept", command: "move 0010 backlog", why: "still broken" }]);
  assert.deepEqual(result.violations, [{ id: "0011", state: "landed", command: "move 0011 done", why: "shipped in abc" }]);
  assert.equal(result.investigator, "sonnet");
});

test("agent-works sync workflow: backlog: a lost assess chunk is investigated whole, confirm batches run one at a time, and losses are failures", async () => {
  const ids = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(4, "0"));
  const { result, all, peak, logs } = await runWorkflow({ ...ARGS, scope: "backlog", ids: ids.join(",") }, (label, prompt) => {
    if (label === "assess:0") return assess(ids.slice(0, 15), ids.slice(0, 10));
    if (label === "assess:1") return undefined;
    if (label === "investigate:0011") return undefined;
    if (label.startsWith("investigate:")) return report(label.split(":")[1], "unstarted", { status: "backlog" });
    if (label.startsWith("confirm:")) {
      const batch = [...prompt.matchAll(/^Card (\d{4}):/gm)].map((m) => m[1]);
      return { cards: batch.map((id) => (id === "0012"
        ? { id, state: "started", action: "apply", command: "move 0012 in-progress", why: "feat/x ahead 3", ran: false, error: "board: no card 0012" }
        : { id, state: "unstarted", action: "keep", why: "nothing found" })) };
    }
  });
  assert.equal(all("assess:").length, 2, "15 cards per assess");
  assert.equal(all("investigate:").length, 10, "5 unsettled from the first chunk and all 5 of the lost one");
  assert.equal(all("confirm:").length, 2, "9 reports in batches of 8");
  assert.equal(peak, 1, "two confirms never run at once");
  assert.deepEqual(result.failed, [
    { id: "0012", step: "apply", command: "move 0012 in-progress", error: "board: no card 0012" },
    { id: "0011", step: "investigate", error: "the investigator returned nothing" },
  ]);
  assert.equal(result.kept.length, 10 + 8);
  assert.ok(logs.some((l) => /1 chunk\(s\) lost/.test(l)));
});

test("agent-works sync workflow: a confirm that returns nothing leaves its cards unconfirmed, not kept", async () => {
  const { result } = await runWorkflow({ ...ARGS, scope: "in-flight", ids: ["0001"] }, (label) => {
    if (label === "assess:0") return assess(["0001"]);
    if (label === "investigate:0001") return report("0001", "merged", { sha: SHA });
  });
  assert.deepEqual(result.failed, [{ id: "0001", step: "confirm", error: "confirm returned nothing" }]);
  assert.deepEqual(result.kept, []);
});

test("agent-works sync workflow: args are checked, and no cards is no run", async () => {
  await assert.rejects(runWorkflow({ root: "/r" }, () => undefined), /args must be an object/);
  await assert.rejects(runWorkflow({ ...ARGS, scope: "everything", ids: ["0001"] }, () => undefined), /scope is one of in-flight, backlog, suggested/);
  const { result, calls } = await runWorkflow(JSON.stringify({ ...ARGS, scope: "backlog", ids: [] }), () => undefined);
  assert.equal(result.skipped, "no cards");
  assert.equal(calls.length, 0);
});
