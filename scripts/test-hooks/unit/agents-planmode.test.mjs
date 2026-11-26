// The plan-mode rules, pure: what an `## Orchestration` section must carry,
// the waves it makes, the text a planning session and an approved one read,
// and the gates that hold a session to its plan. The hooks that call these
// are covered in their own suites; this is the contract they build on.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO } from "./helpers.mjs";

const LIB = path.join(REPO, "plugins", "agentic-engineering", "skills", "agents", "lib");
const load = (name) => import(pathToFileURL(path.join(LIB, name)).href);
const {
  PLAN_LINE_CHARS, RUNS, UNIT_MODELS, agentGate, familyOf, handoff, idleAsk, instructions, parseOrchestration, planLine, pointer, progress,
  refusal, remaining, sessionGate, stateOf, unitOf, wavesOf,
} = await load("planmode.mjs");
const { MODEL_FLOORS, MODEL_PINS, MODEL_TIERS } = await load("cards.mjs");

const HEAD = "| Unit | What | Runs as | After | Files | Model | Why this model |\n|---|---|---|---|---|---|---|";
const plan = (rows, after = "") => `# A plan\n\nSome context.\n\n## Orchestration\n\n${HEAD}\n${rows.join("\n")}\n${after}\n## Verification\n\n1. npm test\n`;
const row = (...cells) => `| ${cells.join(" | ")} |`;
const GOOD = plan([
  row("U1", "Probe", "here", "-", "-", "-", "needs the owner"),
  row("U2", "Rules", "subagent", "-", "`lib/a.mjs`, `test/a.test.mjs`", "opus", "edge cases"),
  row("U3", "Gate", "subagent", "U1, U2", "`hooks/b.mjs`", "sonnet", "known pattern"),
  row("U4", "Follow", "subagent", "U1, U2", "`hooks/c.mjs`", "sonnet", "known pattern"),
  row("U5", "Wiring", "here", "U3, U4", "-", "-", "one writer"),
]);
const AT = "2026-11-19T10:00:00.000Z";
const LATER = Date.parse(AT) + 60 * 60 * 1000;
const findingFor = (md, re) => assert.ok(parseOrchestration(md).findings.some((f) => re.test(f)), parseOrchestration(md).findings.join("\n"));

test("the unit models are model pins, and the run kinds are three", () => {
  assert.deepEqual(UNIT_MODELS, ["fable", "opus", "sonnet"]);
  assert.deepEqual(UNIT_MODELS, MODEL_TIERS.slice(0, MODEL_TIERS.indexOf(MODEL_FLOORS.subagent) + 1), "read from the tiers, down to the subagent floor");
  for (const m of UNIT_MODELS) assert.ok(MODEL_PINS.includes(m));
  assert.deepEqual(RUNS, ["session", "subagent", "here"]);
});

test("a clean table parses to its units, with backticks and dashes cleared", () => {
  const p = parseOrchestration(GOOD);
  assert.deepEqual(p.findings, []);
  assert.equal(p.none, null);
  assert.equal(p.approval, false);
  assert.equal(p.units.length, 5);
  assert.deepEqual(p.units[0], { id: "U1", what: "Probe", runs: "here", after: [], files: [], model: null, why: "needs the owner" });
  assert.deepEqual(p.units[1].files, ["lib/a.mjs", "test/a.test.mjs"]);
  assert.deepEqual(p.units[2].after, ["U1", "U2"]);
  assert.equal(p.units[2].model, "sonnet");
});

test("columns are found by header keyword, in any order and any case", () => {
  const md = "## Orchestration\n\n| why this model | MODEL | files | after | runs as | unit | what |\n|-|-|-|-|-|-|-|\n| mechanical | sonnet | `a.mjs` | - | subagent | U1 | thing |\n";
  const p = parseOrchestration(md);
  assert.deepEqual(p.findings, []);
  assert.deepEqual(p.units[0], { id: "U1", what: "thing", runs: "subagent", after: [], files: ["a.mjs"], model: "sonnet", why: "mechanical" });
});

test("a section quoted inside a code fence is not the plan's; the last real one is", () => {
  const quoted = "```markdown\n## Orchestration\n\n" + HEAD + "\n" + row("U1", "x", "bogus", "-", "a", "opus", "y") + "\n```\n";
  const p = parseOrchestration(`# Plan\n\n${quoted}\n${GOOD}`);
  assert.deepEqual(p.findings, []);
  assert.equal(p.units.length, 5);
  const twice = parseOrchestration(`${plan([row("U1", "x", "subagent", "-", "a", "opus", "y")])}\n${GOOD}`);
  assert.equal(twice.units.length, 5);
  findingFor(`# Plan\n\n${quoted}`, /no `## Orchestration` section/);
});

test("the opt-out line carries its reason, and one inside a fence does not count", () => {
  assert.deepEqual(parseOrchestration("# Plan\n\nOrchestration: none, one file and one test.\n"), { none: "one file and one test.", units: [], approval: false, findings: [] });
  findingFor("# Plan\n\nOrchestration: none\n", /opt-out line gives no reason/);
  findingFor("# Plan\n\n```\nOrchestration: none, quoted\n```\n", /no `## Orchestration` section/);
});

test("the section ends at the next heading, a subsection stays inside it, and CRLF reads the same", () => {
  const rows = [row("U1", "a", "subagent", "-", "a.mjs", "opus", "y")];
  const sub = plan(rows, "\n### Notes\n\n| U9 | not a unit row | subagent | - | b.mjs | opus | y |\n");
  assert.deepEqual(parseOrchestration(sub).units.map((u) => u.id), ["U1"], "the table is the first run of rows");
  assert.deepEqual(parseOrchestration(GOOD.replace(/\n/g, "\r\n")), parseOrchestration(GOOD));
  findingFor("## Orchestration\n\n| Unit | What |\n|---|---|\n| U1 | a |\n", /no `Runs`, `After`, `Files` and `Model` column/);
});

test("the session floor and the forge's noun are read, not written twice", () => {
  findingFor(plan([row("U1", "a", "session", "-", "a", "sonnet", "y")], "\nApproval: yes.\n"), new RegExp(`never runs below ${MODEL_FLOORS.session}: write ${MODEL_FLOORS.session}`));
  findingFor(plan([row("U1", "a", "session", "-", "a", "opus", "y")]), /opens its pull or merge request without asking/);
});

test("the approval line counts only after the table, inside the section", () => {
  const rows = [row("U1", "API", "session", "-", "`src/api/`", "opus", "own request")];
  assert.equal(parseOrchestration(plan(rows, "\nApproval: approving this plan approves starting each session unit.\n")).approval, true);
  assert.equal(parseOrchestration(plan(rows)).approval, false);
  findingFor(plan(rows), /no `Approval:` line/);
  assert.deepEqual(parseOrchestration(plan(rows, "\nApproval: yes, it starts them.\n")).findings, []);
  findingFor(`Approval: before the section\n\n${plan(rows)}`, /no `Approval:` line/);
});

test("each broken rule is a finding that says what to write", () => {
  findingFor("# Plan\n\nNothing here.\n", /no `## Orchestration` section.*`Orchestration: none, <why>`/);
  findingFor(plan([]), /no rows/);
  findingFor(plan([row("X1", "a", "subagent", "-", "a", "opus", "y")]), /X1.*U<number>/);
  findingFor(plan([row("U1", "a", "subagent", "-", "a", "opus", "y"), row("U1", "b", "subagent", "-", "b", "opus", "y")]), /U1 is listed twice/);
  findingFor(plan([row("U1", "a", "agent", "-", "a", "opus", "y")]), /U1 runs as "agent".*session, subagent, or here/);
  findingFor(plan([row("U1", "a", "subagent", "-", "a", "haiku", "y")]), /U1's model is "haiku".*fable, opus, or sonnet/);
  findingFor(plan([row("U1", "a", "subagent", "-", "a", "-", "y")]), /U1 names no model/);
  findingFor(plan([row("U1", "a", "session", "-", "a", "sonnet", "y")], "\nApproval: yes.\n"), /U1 is a session on sonnet.*opus/);
  findingFor(plan([row("U1", "a", "subagent", "U9", "a", "opus", "y")]), /U1 waits on U9, which is no unit/);
  findingFor(plan([row("U1", "a", "subagent", "U2", "a", "opus", "y"), row("U2", "b", "subagent", "-", "b", "opus", "y")]), /U1 waits on U2, which is listed below it/);
  findingFor(plan([row("U1", "a", "subagent", "-", "-", "opus", "y")]), /U1 names no files/);
  findingFor(plan([row("U1", "a", "subagent", "-", "src/", "opus", "y"), row("U2", "b", "subagent", "-", "src/index.mjs", "opus", "y")]), /U1 and U2 start together and both change src\/index\.mjs/);
});

test("a here unit may leave model and files empty; two sessions may share a file", () => {
  assert.deepEqual(parseOrchestration(plan([row("U1", "a", "here", "-", "-", "-", "y")])).findings, []);
  const sessions = plan([row("U1", "a", "session", "-", "src/", "opus", "y"), row("U2", "b", "session", "-", "src/", "opus", "y")], "\nApproval: yes.\n");
  assert.deepEqual(parseOrchestration(sessions).findings, []);
  const ordered = plan([row("U1", "a", "subagent", "-", "src/", "opus", "y"), row("U2", "b", "subagent", "U1", "src/", "opus", "y")]);
  assert.deepEqual(parseOrchestration(ordered).findings, []);
});

test("waves are the topological layers of After", () => {
  assert.deepEqual(wavesOf(parseOrchestration(GOOD).units), [["U1", "U2"], ["U3", "U4"], ["U5"]]);
  assert.deepEqual(wavesOf([{ id: "U1", after: [] }, { id: "U2", after: ["U1"] }, { id: "U3", after: [] }, { id: "U4", after: ["U2", "U3"] }]), [["U1", "U3"], ["U2"], ["U4"]]);
  assert.deepEqual(wavesOf([]), []);
});

test("the planning text fits its budget and names every rule", () => {
  const text = instructions();
  assert.ok(text.length <= 1250, `instructions are ${text.length} characters`);
  assert.match(text, /own worktree and pull or merge request/, "right for either forge");
  assert.match(text, /`subagent` \(an Agent call, default\)/, "a unit is a subagent unless told otherwise");
  assert.match(text, /`session` \([^)]*\): only if the person asked for one/, "a session is written only on the person's word");
  for (const s of ["## Orchestration", "| Unit | What | Runs as | After | Files | Model | Why this model |", "session", "subagent", "here", "sonnet", "opus", "fable", "Approval:", "Orchestration: none, <why>", "ExitPlanMode"]) {
    assert.ok(text.includes(s), `instructions name ${s}`);
  }
  assert.doesNotMatch(text, new RegExp(`${String.fromCharCode(0x2014)}| -- `));
  const one = pointer();
  assert.ok(one.length >= 160 && one.length <= 300, `pointer is ${one.length} characters`);
  assert.match(one, /## Orchestration/);
  assert.match(one, /Orchestration: none, <why>/);
  assert.match(one, /ExitPlanMode/);
  assert.equal(one.split(/\.\s/).length, 1);
  const no = refusal(["U1 names no files: list them."]);
  assert.match(no, /- U1 names no files: list them\./);
  assert.ok(no.endsWith(text));
});

const STATE = stateOf(parseOrchestration(GOOD), { planFile: "/plans/p.md", at: AT });
const ev = (t, unit, at = AT) => ({ t, unit, at });

test("the state carries the units and their waves", () => {
  assert.equal(STATE.v, 1);
  assert.equal(STATE.planFile, "/plans/p.md");
  assert.equal(STATE.at, AT);
  assert.equal(STATE.units.length, 5);
  assert.deepEqual(STATE.waves, [["U1", "U2"], ["U3", "U4"], ["U5"]]);
});

test("the handoff lists the waves and the rules, and leaves session lines out when there are none", () => {
  const cli = 'node "/x/board.mjs"';
  const text = handoff(STATE, { cli });
  assert.match(text, /U2 \(subagent, opus\)/);
  assert.match(text, /U1 \(here\)/);
  assert.match(text, /in one message/);
  assert.match(text, /description.*starts with/);
  assert.doesNotMatch(text, /grant/);
  const withSession = stateOf(parseOrchestration(plan([
    row("U1", "Rules", "subagent", "-", "lib/a.mjs", "opus", "y"),
    row("U2", "API", "session", "U1", "src/api/", "opus", "own request"),
    row("U3", "Web", "session", "-", "src/web/", "fable", "hard"),
    row("U4", "Docs", "subagent", "U1", "docs/", "sonnet", "y"),
    row("U5", "Wire", "here", "U4", "-", "-", "y"),
  ], "\nApproval: yes.\n")), { planFile: "/p.md", at: AT });
  const long = handoff(withSession, { cli });
  assert.ok(long.length <= 1500, `handoff is ${long.length} characters`);
  assert.ok(long.includes(`${cli} epic`));
  assert.ok(long.includes(`${cli} add "<what>" --epic`));
  assert.match(long, /--model <the plan's model> --from-file <its done criteria from the plan, under "## Done when">/, "a card is briefed from that heading");
  assert.ok(long.includes(`${cli} grant`));
  assert.ok(long.includes(`plan approved ${AT}`));
  assert.match(long, /\/agentic-engineering:agents dispatch/);
  assert.match(long, /once those finish/);
});

test("progress and the unit an Agent call names", () => {
  assert.deepEqual(progress(STATE, [ev("start", "U2"), ev("returned", "U2"), ev("start", "U9"), ev("start", "U2")]), { started: ["U2"], returned: ["U2"] });
  assert.equal(unitOf(STATE, { description: "U2 rules and state", prompt: "x" }), "U2");
  assert.equal(unitOf(STATE, { description: "  U3: the gate" }), "U3");
  assert.equal(unitOf(STATE, { description: "explore the repo", prompt: "U4 follow\nmore" }), "U4");
  assert.equal(unitOf(STATE, { description: "explore", prompt: "find U4 in here" }), null);
  assert.equal(unitOf(STATE, { description: "U9 nothing" }), null);
  assert.equal(unitOf(STATE, { description: "U21 nothing" }), null);
  assert.equal(unitOf(STATE, {}), null);
});

test("the Agent gate lets unnamed calls pass and holds a named one to the plan", () => {
  assert.equal(agentGate(null, [], { description: "U2 x", model: "opus" }), null);
  assert.equal(agentGate(STATE, [], { description: "explore", model: "haiku" }), null);
  assert.deepEqual(agentGate(STATE, [], { description: "U2 rules", model: "opus" }), { start: "U2" });
  assert.match(agentGate(STATE, [], { description: "U2 rules" }).deny, /model: "opus"/);
  assert.match(agentGate(STATE, [], { description: "U2 rules", model: "sonnet" }).deny, /model: "opus"/);
  assert.match(agentGate(STATE, [], { description: "U1 probe", model: "opus" }).deny, /U1 runs as here/);
  // U3 waits on U1 (here) and U2 (subagent). Only a subagent is seen
  // returning, so a here or session unit it waits on never holds it.
  const early = agentGate(STATE, [ev("start", "U2")], { description: "U3 gate", model: "sonnet" });
  assert.match(early.deny, /waits on U2 /);
  assert.doesNotMatch(early.deny, /U1/);
  assert.deepEqual(agentGate(STATE, [ev("start", "U2"), ev("returned", "U2")], { description: "U3 gate", model: "sonnet" }), { start: "U3" });
});

test("model families from aliases and ids", () => {
  assert.equal(familyOf("opus"), "opus");
  assert.equal(familyOf("claude-opus-5-5"), "opus");
  assert.equal(familyOf("us.anthropic.claude-opus-4-8[1m]"), "opus");
  assert.equal(familyOf("Sonnet"), "sonnet");
  assert.equal(familyOf("claude-haiku-4-5"), "haiku");
  assert.equal(familyOf("fable"), "fable");
  assert.equal(familyOf("inherit"), null);
  assert.equal(familyOf(undefined), null);
});

test("the session gate holds a start to the card's pin and its after cards", () => {
  const card = { id: "0042", model: "opus", after: [] };
  assert.equal(sessionGate(card, null, { name: "card-0042", model: "claude-opus-5-5" }), null);
  assert.match(sessionGate(card, null, { name: "card-0042", model: "sonnet" }).deny, /opus/);
  assert.match(sessionGate(card, null, { name: "card-0042" }).deny, /opus/);
  assert.equal(sessionGate({ id: "0042", model: "inherit" }, null, { name: "card-0042" }), null);
  assert.equal(sessionGate({ id: "0042" }, null, { name: "card-0042", model: "haiku" }), null);
  assert.match(sessionGate({ id: "0042", after: ["0040"] }, { why: "waiting", on: ["0040"] }, { name: "card-0042" }).deny, /0040/);
  assert.equal(sessionGate({ id: "0042" }, { why: "needs", needs: "a person" }, { name: "card-0042" }), null);
});

test("remaining: in force until every subagent unit returns, or three days pass", () => {
  const now = LATER;
  assert.equal(remaining(null, [], { now }), null);
  const r = remaining(STATE, [ev("start", "U2")], { now });
  assert.deepEqual(r.units.map((u) => u.id), ["U1", "U2", "U3", "U4", "U5"]);
  assert.deepEqual(r.started, ["U2"]);
  const all = ["U2", "U3", "U4"].map((u) => ev("returned", u));
  assert.equal(remaining(STATE, all, { now }), null);
  assert.equal(remaining(STATE, [], { now: Date.parse(AT) + 4 * 24 * 3600 * 1000 }), null);
  const recent = new Date(Date.parse(AT) + 3 * 24 * 3600 * 1000).toISOString();
  assert.notEqual(remaining(STATE, [ev("start", "U2", recent)], { now: Date.parse(AT) + 4 * 24 * 3600 * 1000 }), null);
  const sessionsOnly = stateOf(parseOrchestration(plan([row("U1", "API", "session", "-", "src/", "opus", "y")], "\nApproval: yes.\n")), { planFile: "/p.md", at: AT });
  assert.notEqual(remaining(sessionsOnly, [], { now }), null);
});

test("the stop ask holds only before anything started or was filed", () => {
  const now = LATER;
  const text = idleAsk(STATE, [], { cardsSince: 0, now });
  assert.match(text, /U1, U2/);
  assert.match(text, /wave one/i);
  assert.match(text, /why the plan changed/);
  assert.equal(idleAsk(STATE, [ev("start", "U2")], { cardsSince: 0, now }), null);
  assert.equal(idleAsk(STATE, [], { cardsSince: 1, now }), null);
  assert.equal(idleAsk(null, [], { cardsSince: 0, now }), null);
});

test("the plan line names what is left, the next wave, and the file", () => {
  const line = planLine(STATE, [ev("returned", "U2")], { now: LATER });
  assert.ok(line.length <= 280, `plan line is ${line.length} characters`);
  assert.match(line, /approved plan's orchestration is in force/);
  assert.match(line, /4 of 5 units left/);
  assert.match(line, /U1/);
  assert.match(line, /\/plans\/p\.md/);
  assert.equal(planLine(null, [], { now: LATER }), null);
  assert.equal(PLAN_LINE_CHARS, 280);
  const longPath = stateOf(parseOrchestration(GOOD), { planFile: `/${"deep/".repeat(60)}p.md`, at: AT });
  const short = planLine(longPath, [], { now: LATER });
  assert.match(short, /5 of 5 units left, next wave U1, U2\.$/, "a path that does not fit is left out, never cut");
  assert.equal(planLine(STATE, [], { now: LATER, max: short.length }), short, "and so is one the caller has no room for");
  assert.equal(planLine(STATE, [], { now: LATER, max: 40 }), null, "no room for the line at all");
  assert.equal(planLine({ v: 1, at: AT }, [], { now: LATER }), null, "a state with no units is no plan");
});
