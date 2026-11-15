// The live lane's skills part, the pure half: what a transcript shows about a
// skill (reach.mjs), a trigger session read into its cell and the cells into
// the baseline's numbers (measure.mjs), the two checks over them, and the
// prompt table. The sessions themselves run only under `npm run test:live`.
//
// The transcripts under fixtures/live-lane/ are recorded: real haiku sessions
// on Claude Code 2.1.314, cut down to the entries and fields the detector
// reads, long strings capped, the skill listing cut to the lines a test reads,
// and machine paths replaced with /work and /tmp. The detector reads a
// plugin's and a skill's name as data, so the names in them are only names: a
// skill named there need not be one this tree ships.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter } from "../../lib.mjs";
import { auditLines, baselineRecord, loadChecks, measureCell, measureFixture, measureTriggers, readBaseline, regressions, runChecks, skillsRefusal, skillsTable, stopOf, suspects, unlockedLines } from "../live/measure.mjs";
import { MERGED, acrossCompaction, calls, listing, listingSizes, offered, parseTranscript, reached, reaches } from "../live/reach.mjs";
import { NO_MCP, SKILL_SESSION_ARGS, pool } from "../live/session.mjs";
import { COMPACTION, MOST_REFERENCED, TRIGGERS, labelOf, names } from "../live/triggers.mjs";
import { REPO, tempDir, write } from "./helpers.mjs";

// A skill's address as a plugin's skill, built and never written out.
const old = (plugin, skill) => [plugin, skill].join(":");
const recorded = (name) => parseTranscript(fs.readFileSync(path.join(import.meta.dirname, "..", "fixtures", "live-lane", `${name}.jsonl`), "utf8"));
const TDD = { plugin: "agentic-teamwork", skill: "tdd" };
const SHOT = { plugin: "perceptual-loop", skill: "shot-harness" };
const ROUTER = { plugin: "perceptual-loop", skill: "perceptual-loop" };
const CHECKOUT = "/work/agentic-engineering/plugins";
/** The skill session's result when the skill in use came back after the compaction. */
const KEPT = { skill: "agentic-teamwork tdd", compacted: true, before: "skill", after: "reattached", kept: true };

/** One tool call and its result, in the transcript's shape. `result: null` is a call the session never got an answer to. */
function call(name, input, result = {}) {
  const id = `toolu_${name}_${JSON.stringify(input)}`;
  const use = { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } };
  return result === null ? [use] : [use, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok", ...result }] } }];
}
const read = (file_path, result) => call("Read", { file_path }, result);
const invoke = (skill, result) => call("Skill", { skill }, result);

// The lane's token rows, read from the lens. The lens names an area where a
// plugin holds areas, and splits one hook's critical lines by the area each
// block names, so a row carries the same name on both sides of the plugins
// becoming areas of one plugin.
const lensEvent = (kind, plugin, tokens, extra = {}) => ({ segment: 0, phase: "start", kind, tokens, visibility: "model", source: { plugin, focus: true }, ...extra });
const lensReport = (events) => ({ requests: [{ segment: 0, contextTokens: 1000 }], segments: [{ index: 0 }], compactions: [], events });

test("the lane's rows are a plugin's as they were, where each hook's critical block is its own", () => {
  const m = measureFixture({ main: lensReport([
    lensEvent("hook", "agent-works", 120, { event: "SessionStart", blocks: [{ owner: "agent-works", tokens: 80 }] }),
    lensEvent("skills", "agent-works", 300, { names: ["a", "b"], detail: "2 skills, 1 without a description" }),
    lensEvent("hook", "agent-works", 0, { event: "Stop", phase: 1, visibility: "silent" }),
  ]) });
  assert.deepEqual(m.start, { "agent-works": 420 });
  assert.deepEqual(m.sessionStart, { "agent-works": 120 });
  assert.deepEqual(m.skills, { "agent-works": { tokens: 300, skills: 2, bare: 1 } });
  assert.deepEqual(m.stop, { "agent-works": { model: 0, person: 0, silent: 1, error: 0 } });
});

test("the lane's rows are an area's where the lens names one, and one session hook's blocks go to the area each names", () => {
  const inArea = (area) => ({ source: { plugin: "agentcraft", area, focus: true } });
  const m = measureFixture({ main: lensReport([
    lensEvent("hook", "agentcraft", 200, { event: "SessionStart", blocks: [{ owner: "agent-works", tokens: 80 }, { owner: "docs-parity", tokens: 40 }] }),
    lensEvent("skills", "agentcraft", 90, { names: ["agentcraft:agent-works"], ...inArea("agent-works") }),
    lensEvent("skills", "agentcraft", 30, { names: ["agentcraft:start-here"] }),
    lensEvent("hook", "agentcraft", 0, { event: "Stop", phase: 1, visibility: "silent", ...inArea("agent-works") }),
  ]) });
  // What the hook says for every area at once stays the plugin's.
  assert.deepEqual(m.sessionStart, { "agent-works": 80, "docs-parity": 40, agentcraft: 80 });
  assert.deepEqual(m.start, { "agent-works": 170, "docs-parity": 40, agentcraft: 110 });
  assert.deepEqual(m.skills, { "agent-works": { tokens: 90, skills: 1, bare: 0 }, agentcraft: { tokens: 30, skills: 1, bare: 0 } });
  assert.deepEqual(m.stop, { "agent-works": { model: 0, person: 0, silent: 1, error: 0 } });
});

test("a skill invoked through the Skill tool is reached", () => {
  const entries = recorded("skill-then-read");
  assert.equal(reached(entries, ROUTER), "skill");
  assert.equal(reached(entries, { plugin: "agentic-teamwork", skill: "hubs" }), null);
});

test("a skill whose SKILL.md was read by path is reached, and a reference file beside it is not", () => {
  const entries = recorded("skill-then-read");
  assert.equal(reached(entries, SHOT), "read");
  // The same session read references/doctrine.md and the fixture's README: neither is a skill.
  assert.deepEqual(reaches(entries).map((r) => [`${r.plugin}:${r.skill}`, r.via]), [[old("perceptual-loop", "perceptual-loop"), "skill"], [old("perceptual-loop", "shot-harness"), "read"]]);
});

test("a Skill call the host refused is a call, not a reach", () => {
  // Recorded: the model was told to invoke a disable-model-invocation skill, and the host refused.
  const entries = recorded("skill-refused");
  assert.deepEqual(calls(entries).map((c) => [c.name, c.input.skill, c.ok]), [["Skill", old("perceptual-loop", "shot-harness"), false]]);
  assert.equal(reached(entries, SHOT), null);
  assert.deepEqual(reaches(entries), []);
});

test("a Read that failed, or that never got its result, is not a reach", () => {
  const file = `${CHECKOUT}/agentic-teamwork/skills/tdd/SKILL.md`;
  assert.equal(reached(read(file), TDD), "read");
  assert.equal(reached(read(file, { is_error: true, content: "File does not exist." }), TDD), null);
  assert.equal(reached(read(file, null), TDD), null);
  assert.equal(reached(invoke(old("agentic-teamwork", "tdd"), null), TDD), null);
});

test("a skill of the same name in another plugin, or in no plugin, is not this one", () => {
  assert.equal(reached(invoke(old("agentic-teamwork", "tdd")), TDD), "skill");
  assert.equal(reached(invoke(old("superpowers", "tdd")), TDD), null);
  assert.equal(reached(invoke("tdd"), TDD), null);
  assert.equal(reached(read(`${CHECKOUT}/superpowers/skills/tdd/SKILL.md`), TDD), null);
  assert.equal(reached(read("/elsewhere/.claude/skills/tdd/SKILL.md"), TDD), null);
  // It is still something the session opened, so the audit trail shows it.
  assert.deepEqual(reaches(read("/elsewhere/.claude/skills/tdd/SKILL.md")).map((r) => [r.plugin, r.skill]), [[null, "tdd"]]);
});

test("once the plugins are areas a route is reached by its ROUTE.md under its own area, and an area reaches only the area", () => {
  const area = `${CHECKOUT}/${MERGED}/skills/agentic-teamwork`;
  assert.equal(reached(read(`${area}/routes/tdd/ROUTE.md`), TDD), "read");
  assert.equal(reached(read(`${area}/routes/tdd/references/lanes.md`), TDD), null);
  assert.equal(reached(read(`${CHECKOUT}/${MERGED}/skills/planning/routes/tdd/ROUTE.md`), TDD), null);
  assert.equal(reached(read(`${area}/SKILL.md`), TDD), null);
  assert.equal(reached(invoke(old(MERGED, "agentic-teamwork")), TDD), null);
  // An area is the former router skill of its plugin.
  assert.equal(reached(read(`${CHECKOUT}/${MERGED}/skills/perceptual-loop/SKILL.md`), ROUTER), "read");
  assert.equal(reached(invoke(old(MERGED, "perceptual-loop")), ROUTER), "skill");
});

test("a session that answered without opening a skill reached nothing", () => {
  assert.deepEqual(reaches(recorded("names-only")), []);
});

test("listing says whether the session's skill listing described a skill, named it only, or left it out", () => {
  const full = recorded("skill-then-read");
  assert.equal(listing(full, TDD), "described");
  assert.equal(listing(full, { plugin: "agentic-teamwork", skill: "ladder" }), "name");
  assert.equal(listing(full, { plugin: "agentic-teamwork", skill: "no-such-skill" }), "absent");
  // A 200k window: the budget holds the names and no description.
  assert.equal(listing(recorded("names-only"), TDD), "name");
});

const listed = (content) => [{ type: "attachment", attachment: { type: "skill_listing", content } }];

test("listingSizes gives each plugin's share of the session's skill listing: its entries, how many kept a description, and their characters", () => {
  // Recorded at the default window: three of the four entries kept a description, cut here to a few words.
  const full = listingSizes(recorded("skill-then-read"));
  assert.deepEqual(Object.keys(full), ["agentic-teamwork", "perceptual-loop"]);
  assert.deepEqual([full["perceptual-loop"].skills, full["perceptual-loop"].described], [1, 1]);
  assert.deepEqual([full["agentic-teamwork"].skills, full["agentic-teamwork"].described], [3, 2]);
  // Recorded at 200k: the same four entries, names only.
  assert.deepEqual(listingSizes(recorded("names-only")), {
    "perceptual-loop": { skills: 1, described: 0, characters: `- ${old("perceptual-loop", "perceptual-loop")}`.length },
    "agentic-teamwork": { skills: 3, described: 0, characters: `- ${old("agentic-teamwork", "hubs")}`.length + `- ${old("agentic-teamwork", "ladder")}`.length + `- ${old("agentic-teamwork", "tdd")}`.length },
  });
});

test("listingSizes counts a description's every line for its plugin, leaves out a skill in no plugin, and reads only the first listing", () => {
  const door = `- ${old("boards", "boards")}: Draws boards from code.\n  Routes: frame: draw a frame.`;
  const entries = [...listed(`- docx: Word documents.\n${door}\n- ${old("planning", "grill")}`), ...listed(`- ${old("planning", "grill")}: Interviews the person.`)];
  assert.deepEqual(listingSizes(entries), {
    boards: { skills: 1, described: 1, characters: door.length },
    planning: { skills: 1, described: 0, characters: `- ${old("planning", "grill")}`.length },
  });
});

test("a transcript with no skill listing has no sizes", () => {
  assert.equal(listingSizes(recorded("names-only").filter((e) => e.type !== "attachment")), null);
  assert.equal(listingSizes([]), null);
});

test("a skill invoked before a compaction and re-attached after it is kept", () => {
  assert.deepEqual(acrossCompaction(recorded("compaction-reattached"), TDD), { compacted: true, before: "skill", after: "reattached", kept: true });
});

test("a skill read by path before a compaction, whose file the host restored after it, is kept", () => {
  const entries = recorded("compaction-restored");
  assert.deepEqual(acrossCompaction(entries, TDD), { compacted: true, before: "read", after: "restored", kept: true });
  // The restored file is tdd's, so it keeps nothing for another skill.
  assert.deepEqual(acrossCompaction(entries, { plugin: "agentic-teamwork", skill: "hubs" }), { compacted: true, before: null, after: null, kept: false });
});

test("a skill neither re-attached, restored, nor read again after the compaction is lost", () => {
  const entries = recorded("compaction-lost");
  assert.deepEqual(acrossCompaction(entries, TDD), { compacted: true, before: "skill", after: null, kept: false });
  // The same session, had it opened the skill again afterwards.
  const again = [...entries, ...read(`${CHECKOUT}/agentic-teamwork/skills/tdd/SKILL.md`)];
  assert.deepEqual(acrossCompaction(again, TDD), { compacted: true, before: "skill", after: "read", kept: true });
  // A read that failed afterwards brings nothing back.
  const failed = [...entries, ...read(`${CHECKOUT}/agentic-teamwork/skills/tdd/SKILL.md`, { is_error: true })];
  assert.equal(acrossCompaction(failed, TDD).kept, false);
});

test("a session that never compacted keeps nothing across one", () => {
  assert.deepEqual(acrossCompaction(recorded("skill-then-read"), ROUTER), { compacted: false, before: "skill", after: null, kept: false });
});

test("offered lists every tool a session was given, inline or deferred", () => {
  // Recorded with the flags a skill session runs under.
  assert.deepEqual(offered(recorded("locked-session")), ["Glob", "Grep", "Read", "Skill"]);
  const deferred = { type: "attachment", attachment: { type: "deferred_tools_delta", addedNames: ["mcp__example__send", "Bash"] } };
  assert.deepEqual(offered([...recorded("locked-session"), deferred]), ["Bash", "Glob", "Grep", "Read", "Skill", "mcp__example__send"]);
  assert.deepEqual(offered(recorded("names-only")), []);
});

test("a skill session's arguments leave it four read-only tools and no MCP server", () => {
  const after = (flag) => SKILL_SESSION_ARGS[SKILL_SESSION_ARGS.indexOf(flag) + 1];
  assert.equal(after("--tools"), "Skill,Read,Glob,Grep");
  assert.ok(SKILL_SESSION_ARGS.includes("--strict-mcp-config"));
  assert.ok(!SKILL_SESSION_ARGS.includes("--mcp-config"));
  // A mod registers its tools without an MCP config, so they are denied by
  // name, and the host names them by the plugin that loads the mod.
  const mod = fs.readFileSync(path.join(REPO, "plugins", "agent-works", "hooks", "kanban", "tools.mjs"), "utf8");
  const denied = after("--disallowedTools");
  assert.deepEqual(NO_MCP, ["--strict-mcp-config", "--disallowedTools", denied]);
  assert.ok(mod.includes(`${denied}__`), `${denied} is not the prefix the mod's tools carry`);
});

test("stopOf reads why a session ended from its result", () => {
  // The fields of recorded results: a finished session, and one run with --max-turns 1.
  assert.equal(stopOf({ subtype: "success", is_error: false, terminal_reason: "completed" }), "ended");
  assert.equal(stopOf({ subtype: "error_max_turns", is_error: true, terminal_reason: "max_turns" }), "max-turns");
  assert.equal(stopOf({ subtype: "error_max_budget_usd", is_error: true }), "budget");
  assert.equal(stopOf({ subtype: "error_during_execution", is_error: true }), "error");
  assert.equal(stopOf(null), "error");
});

test("measureCell tells a reach from a miss from a session that was not measured, and keeps what the session did", () => {
  const hubs = { plugin: "agentic-teamwork", skill: "hubs" };
  const routed = measureCell(SHOT, recorded("skill-then-read"), "ended");
  assert.equal(routed.outcome, "read");
  assert.equal(routed.listing, "absent");
  assert.deepEqual(routed.calls.slice(0, 3), [`Skill ${old("perceptual-loop", "perceptual-loop")}`, "Read references/doctrine.md", "Read shot-harness/SKILL.md"]);
  // Reached is reached, however the session ended afterwards.
  assert.equal(measureCell(SHOT, recorded("skill-then-read"), "max-turns").outcome, "read");
  // A session that ended on its own without the skill missed it.
  assert.deepEqual(measureCell(hubs, recorded("names-only"), "ended"), { outcome: "miss", listing: "name", calls: [], offered: [] });
  assert.deepEqual(measureCell(SHOT, recorded("skill-refused"), "ended").calls, [`Skill ${old("perceptual-loop", "shot-harness")} (failed)`]);
  assert.equal(measureCell(SHOT, recorded("skill-refused"), "ended").outcome, "miss");
  // One that was cut off or errored first was not measured, which is not a miss.
  assert.equal(measureCell(hubs, recorded("names-only"), "max-turns").outcome, "max-turns");
  assert.deepEqual(measureCell(hubs, null, "error"), { outcome: "error", listing: null, calls: [], offered: [] });
  assert.deepEqual(measureCell({ plugin: "agent-works", skill: "board" }, recorded("locked-session"), "ended").offered, ["Glob", "Grep", "Read", "Skill"]);
});

const ROWS = [
  { plugin: "perceptual-loop", skill: "shot-harness", fixture: "standard", named: false, person: true, prompt: "x" },
  { plugin: "agentic-teamwork", skill: "hubs", fixture: "standard", named: true, person: false, prompt: "y" },
];

test("measureTriggers records, per prompt and window, each pass's outcome and what the listing held", () => {
  const cells = {
    "shot-harness@default": [{ outcome: "read", listing: "absent" }, { outcome: "miss", listing: "absent" }],
    "shot-harness@200k": [{ outcome: "max-turns", listing: "absent" }],
    "hubs@default": [{ outcome: "error", listing: null }, { outcome: "skill", listing: "described" }],
  };
  const m = measureTriggers(ROWS, ["default", "200k"], (skill, window) => cells[`${skill}@${window}`] ?? []);
  assert.deepEqual(m, {
    // No session at 200k: the window stays empty, and the check fails it.
    hubs: { skill: "agentic-teamwork hubs", fixture: "standard", named: true, person: false, listing: { default: "described", "200k": null }, reached: { default: ["error", "skill"], "200k": [] } },
    "shot-harness": { skill: "perceptual-loop shot-harness", fixture: "standard", named: false, person: true, listing: { default: "absent", "200k": "absent" }, reached: { default: ["read", "miss"], "200k": ["max-turns"] } },
  });
  assert.deepEqual(Object.keys(m), ["hubs", "shot-harness"]);
});

const skillsRun = (reachedIn, extra = {}) => ({
  fixtures: {},
  skills: {
    windows: { default: 1000000, "200k": 200000 },
    triggers: { hubs: { skill: "agentic-teamwork hubs", fixture: "standard", named: true, person: false, listing: { default: "described", "200k": "name" }, reached: reachedIn } },
    compaction: KEPT,
    ...extra,
  },
});
const checkIn = async (file) => (await loadChecks()).find((c) => c.file === file);
const triggerCheck = () => checkIn("triggers.mjs");

test("every check under live/checks/ has the extension shape, and the two that read the skills part say so", async () => {
  const checks = await loadChecks();
  for (const c of checks) {
    assert.equal(typeof c.name, "string", c.file);
    assert.equal(typeof c.check, "function", c.file);
    assert.ok(c.part === undefined || c.part === "skills", `${c.file}: part ${c.part}`);
  }
  assert.deepEqual(checks.filter((c) => c.part === "skills").map((c) => c.file), ["skill-compaction.mjs", "triggers.mjs"]);
  assert.deepEqual(runChecks(checks.filter((c) => c.part === "skills"), skillsRun({ default: ["skill"], "200k": ["skill"] }), null).map((r) => [r.part, r.failures]), [["skills", []], ["skills", []]]);
});

test("the trigger check fails only a prompt the baseline reached in every pass and this run reached in none", async () => {
  const check = await triggerCheck();
  const now = skillsRun({ default: ["miss"], "200k": ["miss"] });
  assert.deepEqual(check.check({ run: now, baseline: null }), []);
  // A baseline written before the skills part existed has nothing to compare with.
  assert.deepEqual(check.check({ run: now, baseline: { fixtures: {} } }), []);
  // Reached in some baseline passes: reported in the table, never failed.
  const baseline = skillsRun({ default: ["skill", "skill", "read"], "200k": ["skill", "miss", "skill"] });
  const failures = check.check({ run: now, baseline });
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.ok(failures[0].includes("hubs") && failures[0].includes("default") && failures[0].includes("agentic-teamwork hubs"), failures[0]);
  // Reaching it another way is still reaching it: read by path, where the Skill tool was.
  assert.deepEqual(check.check({ run: skillsRun({ default: ["read"], "200k": ["miss"] }), baseline }), []);
  // One reach among this run's passes is enough.
  assert.deepEqual(check.check({ run: skillsRun({ default: ["miss", "skill", "miss"], "200k": ["miss"] }), baseline }), []);
});

test("the trigger check reports a session that was cut off as not measured, never as a miss", async () => {
  const check = await triggerCheck();
  const baseline = skillsRun({ default: ["skill", "skill", "skill"], "200k": ["miss", "miss", "miss"] });
  const failures = check.check({ run: skillsRun({ default: ["max-turns"], "200k": ["miss"] }), baseline });
  assert.equal(failures.length, 1, failures.join("\n"));
  assert.match(failures[0], /hubs at default.*not measured \(max-turns\)/);
  assert.doesNotMatch(failures[0], /in none now/);
});

test("the trigger check fails a prompt with no session, a session offered more than its tools, and a lane that ran no prompts", async () => {
  const check = await triggerCheck();
  assert.ok(check.check({ run: skillsRun({ default: ["skill"], "200k": [] }), baseline: null }).some((f) => f.includes("hubs") && f.includes("200k")));
  const unlocked = ["hubs at default, pass 1: offered mcp__example__send"];
  assert.deepEqual(check.check({ run: skillsRun({ default: ["skill"], "200k": ["miss"] }, { unlocked }), baseline: null }), unlocked);
  assert.ok(check.check({ run: { fixtures: {} }, baseline: null }).length);
});

test("the skill-compaction check fails a skill lost at the compaction, one never reached before it, and a skill session that did not run", async () => {
  const check = await checkIn("skill-compaction.mjs");
  const run = (compaction, partial = false) => ({ fixtures: {}, skills: { ...(compaction ? { compaction } : {}), partial } });
  assert.deepEqual(check.check({ run: run(KEPT) }), []);
  assert.deepEqual(check.check({ run: run({ ...KEPT, after: "restored" }) }), []);
  assert.deepEqual(check.check({ run: run({ ...KEPT, after: "read" }) }), []);
  assert.ok(check.check({ run: run({ ...KEPT, after: null, kept: false }) }).some((f) => f.includes("agentic-teamwork tdd") && f.includes("lost")));
  assert.ok(check.check({ run: run({ ...KEPT, before: null, after: null, kept: false }) }).some((f) => f.includes("before the compaction")));
  assert.ok(check.check({ run: run({ ...KEPT, compacted: false, after: null, kept: false }) }).some((f) => f.includes("no compaction")));
  assert.ok(check.check({ run: run(null) }).some((f) => f.includes("did not run")));
  assert.ok(check.check({ run: { fixtures: {} } }).some((f) => f.includes("did not run")));
  // --only left the skill session's fixture out: nothing ran, and nothing is claimed.
  assert.deepEqual(check.check({ run: run(null, true) }), []);
});

// A recording that fails the trigger check must not become the baseline.
// Written over a prompt that stopped reaching its skill, the new baseline
// holds the misses, and no later run can fail that prompt again.
const WINDOW_NAMES = ["default", "200k"];
const reachedIn = (now, was, confirm) => regressions(
  { hubs: { skill: "agentic-teamwork hubs", reached: now, ...(confirm ? { confirm } : {}) } }, WINDOW_NAMES,
  { hubs: { reached: was } });

test("regressions names a prompt reached in every baseline pass at a window and in no session there now", () => {
  assert.deepEqual(reachedIn({ default: ["miss", "miss", "miss"], "200k": ["miss"] }, { default: ["skill", "read", "skill"], "200k": ["miss", "skill", "skill"] }),
    [{ name: "hubs", window: "default", skill: "agentic-teamwork hubs", was: 3, now: 3 }]);
});

test("a prompt is no regression when a rerun reached it, when a session was not measured, or when the baseline reached it only in some passes", () => {
  const always = { default: ["skill", "skill", "skill"], "200k": ["skill", "skill", "skill"] };
  assert.deepEqual(reachedIn({ default: ["miss"], "200k": ["skill"] }, always, { default: ["miss", "read"] }), []);
  // Cut off before it reached anything: not measured, which the check reports on its own line.
  assert.deepEqual(reachedIn({ default: ["max-turns", "miss"], "200k": ["skill"] }, always), []);
  assert.deepEqual(reachedIn({ default: ["miss"], "200k": ["miss"] }, { default: ["skill", "miss", "skill"], "200k": [] }), []);
  // The reruns count as sessions of this run.
  assert.deepEqual(reachedIn({ default: ["miss"], "200k": ["skill"] }, always, { default: ["miss", "miss"] }).map((r) => r.now), [3]);
  assert.deepEqual(regressions(undefined, WINDOW_NAMES, null), []);
});

test("a recording is refused when a prompt stopped reaching its skill, and the refusal says which and what to do", () => {
  const clean = { lost: 0, compaction: true, unlocked: 0, regressed: [] };
  assert.deepEqual(skillsRefusal(clean), []);
  const [reason] = skillsRefusal({ ...clean, regressed: [{ name: "readme", window: "default", skill: "docs-parity readme", was: 3, now: 3 }] });
  assert.match(reason, /^1 prompt stopped reaching its skill \(readme at default\)/);
  assert.match(reason, /could never fail it again/);
  assert.match(reason, /scripts\/test-hooks\/README\.md/);
  assert.match(skillsRefusal({ ...clean, regressed: [{ name: "readme", window: "default" }, { name: "ship", window: "200k" }] })[0], /^2 prompts stopped reaching their skill \(readme at default, ship at 200k\)/);
});

test("a recording is still refused for a session not measured, a skill session that did not run, and a session offered more than its tools", () => {
  const clean = { lost: 0, compaction: true, unlocked: 0, regressed: [] };
  assert.deepEqual(skillsRefusal({ ...clean, lost: 1 }), ["1 trigger session was not measured"]);
  assert.deepEqual(skillsRefusal({ ...clean, lost: 2, compaction: false, unlocked: 3 }), ["2 trigger sessions were not measured", "the skill session did not run", "3 sessions were offered more than their tools"]);
});

// With no baseline a run has nothing to compare against, so every check that
// reads one passes and a recording is written unopposed: right for the first
// recording ever, wrong for a baseline that is there and cannot be read.
test("a baseline that is not there reads as none, and one that does not parse is an error", (t) => {
  const dir = tempDir(t, "live-baseline-");
  assert.equal(readBaseline(path.join(dir, "baseline.json")), null);
  write(dir, "baseline.json", '{ "skills": { "passes": 3 } }\n');
  assert.deepEqual(readBaseline(path.join(dir, "baseline.json")), { skills: { passes: 3 } });
  // A merge left its markers in the file: it must not read as a first recording.
  write(dir, "baseline.json", '{\n<<<<<<< HEAD\n  "skills": {}\n=======\n}\n');
  assert.throws(() => readBaseline(path.join(dir, "baseline.json")), /baseline\.json does not parse .*: a baseline that cannot be read is not a missing one/);
});

test("writing the skills part of the baseline leaves the fixtures and their stamp alone", () => {
  const previous = { claudeCodeVersion: "2.1.314", date: "2026-11-07", model: "haiku", pluginsTree: "aaa", costUsd: 0.08, expectedFailures: { "question.mjs": ["a known one"] }, fixtures: { standard: { firstRequestTokens: 41297 } } };
  const stamp = { claudeCodeVersion: "2.1.400", date: "2026-11-12", model: "claude-haiku-5-5", pluginsTree: "bbb" };
  const now = { fixtures: { standard: { firstRequestTokens: 30000 } }, fixturesCostUsd: 0.2, skills: { passes: 3, sessions: 7, costUsd: 0.1, ...skillsRun({ default: ["skill"], "200k": ["miss"] }).skills } };

  const skillsOnly = baselineRecord(previous, ["skills"], stamp, now);
  assert.deepEqual({ ...skillsOnly, skills: null }, { ...previous, skills: null });
  assert.deepEqual(skillsOnly.skills, { ...stamp, ...now.skills });

  const both = baselineRecord(skillsOnly, ["fixtures", "skills"], { ...stamp, date: "2026-12-01" }, now);
  assert.equal(both.date, "2026-12-01");
  assert.equal(both.costUsd, 0.2);
  assert.equal(both.fixtures.standard.firstRequestTokens, 30000);
  assert.equal(both.skills.date, "2026-12-01");
  assert.deepEqual(Object.keys(baselineRecord(null, ["fixtures", "skills"], stamp, now)), ["claudeCodeVersion", "date", "model", "pluginsTree", "costUsd", "fixtures", "skills"]);
});

test("skillsTable shows each prompt per window against the baseline, the totals read apart, and the compaction result", () => {
  const now = skillsRun({ default: ["read"], "200k": ["miss"] }).skills;
  const baseline = { ...skillsRun({ default: ["skill", "skill", "read"], "200k": ["miss", "skill", "miss"] }).skills, compaction: { ...KEPT, after: null, kept: false } };
  const table = skillsTable(baseline, now);
  const lines = table.split("\n");
  assert.match(lines.find((l) => l.includes("hubs") && l.includes("default")), /agentic-teamwork hubs\s+standard\s+yes\s+default\s+described\s+3 of 3 \(1 by read\)\s+read/);
  assert.match(lines.find((l) => l.includes("hubs") && l.includes("200k")), /200k\s+name\s+1 of 3\s+miss/);
  assert.match(table, /reached at default \(1,000,000 tokens\): 1 of 1 sessions \(baseline 3 of 3\)/);
  assert.match(table, /reached at 200k \(200,000 tokens\): 0 of 1 sessions \(baseline 1 of 3\)/);
  assert.match(table, /prompts that name their skill: 1 of 2 \(baseline 4 of 6\)/);
  assert.match(table, /prompts that do not: 0 of 0 \(baseline 0 of 0\)/);
  // A skill only a person can start is refused when called, so its rows are totalled apart.
  assert.match(table, /skills a session can call: 1 of 2 \(baseline 4 of 6\)/);
  assert.match(table, /skills only a person can start: 0 of 0 \(baseline 0 of 0\)/);
  assert.match(table, /agentic-teamwork tdd kept \(skill re-attached\); baseline lost/);
  assert.match(skillsTable(null, now), /no baseline/);
  assert.match(skillsTable(null, { ...now, compaction: { ...KEPT, after: "restored" } }), /kept \(file restored\)/);
  assert.match(skillsTable(null, { ...now, compaction: { ...KEPT, after: "read" } }), /kept \(read again\)/);
  // Each plugin's share of the listing per window, beside the baseline's where it recorded one.
  const share = (characters, described = 1, skills = 1) => ({ skills, described, characters });
  const doors = { default: { "system-map": share(312), "but-first-planning": share(4100, 17, 18) }, "200k": { "system-map": share(31, 0) } };
  const before = { default: { "system-map": share(1870, 2, 2) } };
  const sized = skillsTable({ ...baseline, listing: before }, { ...now, listing: doors }).split("\n");
  assert.ok(sized.includes("listing at default: system-map 312 characters, 1 of 1 described (baseline 1,870, 2 of 2)"));
  assert.ok(sized.includes("listing at default: but-first-planning 4,100 characters, 17 of 18 described (baseline not recorded)"));
  assert.ok(sized.includes("listing at 200k: system-map 31 characters, 0 of 1 described (baseline not recorded)"));
  assert.ok(skillsTable(null, { ...now, listing: doors }).split("\n").includes("listing at default: system-map 312 characters, 1 of 1 described"));
  // A run that read no listing at a window says so, and one with no listing part prints no such line.
  assert.match(skillsTable(null, { ...now, listing: { default: null } }), /^listing at default: not read$/m);
  assert.doesNotMatch(table, /^listing at/m);
  // A session cut off before it reached anything is neither a reach nor a miss.
  const cut = skillsTable(null, skillsRun({ default: ["max-turns"], "200k": [] }).skills);
  assert.match(cut, /not measured \(max-turns\)/);
  assert.match(cut, /no session/);
  assert.match(cut, /reached at default \(1,000,000 tokens\): 0 of 0 sessions, 1 not measured/);
});

// Where a row's instructions are, in either shape of the tree: a plugin's
// skill, or, once the plugins are areas of one plugin, a route's document
// under its area or the SKILL.md of an area (a row that carries one name twice).
const PLUGINS = path.join(REPO, "plugins");
function skillFile({ plugin, skill }) {
  const area = path.join(PLUGINS, MERGED, "skills", plugin);
  const candidates = [path.join(area, "routes", skill, "ROUTE.md"), ...(plugin === skill ? [path.join(area, "SKILL.md")] : []), path.join(PLUGINS, plugin, "skills", skill, "SKILL.md")];
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}
/** Every skill and route document the tree ships: what a listing or an area's table can show. */
function described(dir = PLUGINS, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== "node_modules" && e.name !== "app") described(path.join(dir, e.name), out);
    else if (e.name === "SKILL.md" || e.name === "ROUTE.md") out.push(path.join(dir, e.name));
  }
  return out;
}
const frontmatter = (file) => parseFrontmatter(fs.readFileSync(file, "utf8")) ?? {};
const words = (text) => String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
const runs = (text, n = 4) => { const w = words(text); return new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(" "))); };

test("every trigger prompt is for a real skill, runs where the plugins speak, and asks in a person's words", () => {
  assert.ok(TRIGGERS.length > 0);
  const skills = TRIGGERS.map((t) => t.skill);
  assert.equal(new Set(skills).size, skills.length, "a skill has two prompts");
  for (const t of TRIGGERS) {
    assert.ok(skillFile(t), `${labelOf(t)} is not in this tree`);
    // Where nothing settles the repo's mode, the session asks the plugins question before anything else.
    assert.ok(["standard", "portable"].includes(t.fixture), `${t.skill}: fixture ${t.fixture}`);
    assert.ok(typeof t.prompt === "string" && t.prompt.length > 20, `${t.skill}: no prompt`);
    // The prompt has to reach the skill by what it asks for, never by an address or a slash command.
    assert.doesNotMatch(t.prompt, /(^|\s)\/[a-z]/, `${t.skill}: a slash command`);
    assert.ok(!t.prompt.includes(`${t.plugin}:`) && !t.prompt.includes(`${MERGED}:`), `${t.skill}: an address`);
  }
});

test("a row is marked person exactly when only a person can start its skill today", () => {
  for (const t of TRIGGERS) {
    const file = skillFile(t);
    // A route's document is never refused; the mark then stays as the row was recorded.
    if (path.basename(file) !== "SKILL.md" || t.plugin === t.skill) continue;
    assert.equal(t.person, frontmatter(file)["disable-model-invocation"] === true || frontmatter(file)["disable-model-invocation"] === "true", `${labelOf(t)}: person is ${t.person}`);
  }
  assert.ok(TRIGGERS.some((t) => t.person) && TRIGGERS.some((t) => !t.person));
});

test("a row's label is its plugin and skill, or one name for a skill named after its plugin, and never an address", () => {
  assert.equal(labelOf({ plugin: "agentic-teamwork", skill: "ship" }), "agentic-teamwork ship");
  assert.equal(labelOf({ plugin: "perceptual-loop", skill: "perceptual-loop" }), "perceptual-loop");
  for (const t of TRIGGERS) assert.ok(!labelOf(t).includes(":"), labelOf(t));
});

test("no trigger prompt shares a run of four words with any description in the tree", () => {
  const descriptions = described().map((file) => [path.relative(PLUGINS, file), runs(frontmatter(file).description)]);
  assert.ok(descriptions.length > 50, "the tree's skills were not found");
  for (const t of TRIGGERS) {
    const said = [...runs(t.prompt)];
    for (const [file, theirs] of descriptions) {
      assert.deepEqual(said.filter((run) => theirs.has(run)), [], `${t.skill}: lifted from the description in ${file}`);
    }
  }
});

test("each row says whether its prompt names its skill, and the table has prompts of both kinds", () => {
  assert.equal(names("This change is finished and tested. Ship it.", "ship"), true);
  assert.equal(names("Our team Miro board needs a frame.", "miro-board"), true);
  assert.equal(names("The hub verifier exits 1 here.", "hubs"), true);
  assert.equal(names("The architecture diagram no longer matches the code.", "diagrams-sync"), false);
  assert.equal(names("Fix the landing page.", "land"), true);
  assert.equal(names("See it through to merged once CI passes.", "land"), false);
  for (const t of TRIGGERS) assert.equal(t.named, names(t.prompt, t.skill), t.skill);
  assert.ok(TRIGGERS.some((t) => t.named) && TRIGGERS.some((t) => !t.named));
});

test("the prompt table covers every skill the tree refers to five times or more, and one more in every plugin", () => {
  const skills = new Set(TRIGGERS.map((t) => t.skill));
  assert.equal(MOST_REFERENCED.length, 18);
  for (const skill of MOST_REFERENCED) assert.ok(skills.has(skill), `no prompt for ${skill}`);
  const plugins = [...new Set(TRIGGERS.map((t) => t.plugin))];
  assert.equal(plugins.length, 12);
  for (const plugin of plugins) {
    assert.ok(TRIGGERS.some((t) => t.plugin === plugin && !MOST_REFERENCED.includes(t.skill)), `${plugin} has no prompt beyond the most-referenced`);
  }
  // The rows the bar is read on.
  assert.equal(TRIGGERS.length, 30);
});

test("the compaction scenario works inside a real skill, named outright, with a prompt on each side of the compaction", () => {
  assert.ok(skillFile(COMPACTION));
  assert.notEqual(COMPACTION.plugin, COMPACTION.skill);
  assert.ok(COMPACTION.before.includes(COMPACTION.plugin) && COMPACTION.before.includes(COMPACTION.skill));
  assert.ok(typeof COMPACTION.before === "string" && COMPACTION.before.length > 20);
  assert.ok(typeof COMPACTION.after === "string" && COMPACTION.after.length > 20);
});

test("pool runs jobs a few at a time and returns their results in order", async () => {
  let running = 0;
  let most = 0;
  const job = (value, ms) => async () => {
    running += 1;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    running -= 1;
    return value;
  };
  assert.deepEqual(await pool(2, [job("a", 15), job("b", 1), job("c", 5), job("d", 1)]), ["a", "b", "c", "d"]);
  assert.equal(most, 2);
  assert.deepEqual(await pool(4, []), []);
});

test("the audit trail names every session that did not reach its skill, and the lock lines every one offered more than its tools", () => {
  const board = { plugin: "agent-works", skill: "board" };
  const cells = [
    { row: SHOT, window: "default", pass: 1, cell: measureCell(SHOT, recorded("skill-then-read"), "ended") },
    { row: SHOT, window: "200k", pass: 1, cell: measureCell(SHOT, recorded("skill-refused"), "ended") },
    { row: SHOT, window: "200k", pass: 2, cell: measureCell(SHOT, recorded("names-only"), "max-turns") },
    { row: SHOT, window: "200k", pass: 3, cell: measureCell(SHOT, null, "error") },
    { row: board, window: "default", pass: 1, cell: measureCell(board, recorded("locked-session"), "ended") },
  ];
  assert.deepEqual(auditLines(cells), [
    `shot-harness at 200k, pass 1: miss; Skill ${old("perceptual-loop", "shot-harness")} (failed)`,
    "shot-harness at 200k, pass 2: not measured (max-turns); no tool call",
    "shot-harness at 200k, pass 3: not measured (error); no tool call",
  ]);
  // The recorded sessions before the lock carry no tool list; the locked one shows its four.
  const lines = unlockedLines(cells, ["Skill", "Read", "Glob", "Grep"]);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.startsWith("shot-harness") && l.includes("recorded no tool list")));
  assert.deepEqual(unlockedLines(cells.slice(4), ["Skill", "Read"]), ["board at default, pass 1: offered Glob, Grep"]);
});

test("a prompt the baseline reached in every pass and this run missed is a suspect, to be run again before it is called a regression", () => {
  const hubs = { plugin: "agentic-teamwork", skill: "hubs" };
  const cell = (window, outcome) => ({ row: hubs, window, pass: 1, cell: { outcome, listing: "described", calls: [], offered: [] } });
  const before = { hubs: { reached: { default: ["skill", "skill", "read"], "200k": ["skill", "miss", "skill"] } } };
  assert.deepEqual(suspects([cell("default", "miss"), cell("200k", "miss")], before), [{ row: hubs, window: "default" }]);
  // Reached now, not measured now, or nothing to compare with: nothing to confirm.
  assert.deepEqual(suspects([cell("default", "skill")], before), []);
  assert.deepEqual(suspects([cell("default", "max-turns")], before), []);
  assert.deepEqual(suspects([cell("default", "miss")], undefined), []);
});

test("sessions run again to confirm a miss are kept apart from the pass, so the totals stay one sample per prompt", () => {
  const cells = [{ outcome: "miss", listing: "described" }, { outcome: "miss", listing: "described", confirm: true }, { outcome: "skill", listing: "described", confirm: true }];
  const m = measureTriggers(ROWS.slice(1), ["default"], () => cells);
  assert.deepEqual(m.hubs.reached, { default: ["miss"] });
  assert.deepEqual(m.hubs.confirm, { default: ["miss", "skill"] });
  const now = { windows: { default: 1000000 }, triggers: m, compaction: KEPT };
  const table = skillsTable(null, now);
  assert.match(table, /miss, rerun 1 of 2/);
  assert.match(table, /reached at default \(1,000,000 tokens\): 0 of 1 sessions/);
});

test("the trigger check fails a confirmed miss, and passes a miss that a rerun reached", async () => {
  const check = await triggerCheck();
  const baseline = skillsRun({ default: ["skill", "skill", "skill"], "200k": ["miss", "miss", "miss"] });
  const withConfirm = (confirm) => {
    const run = skillsRun({ default: ["miss"], "200k": ["miss"] });
    run.skills.triggers.hubs.confirm = { default: confirm };
    return run;
  };
  assert.deepEqual(check.check({ run: withConfirm(["miss", "skill"]), baseline }), []);
  const failures = check.check({ run: withConfirm(["miss", "miss"]), baseline });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /hubs at default.*every baseline pass \(3\).*none of 3 now/);
  assert.match(check.check({ run: withConfirm(["max-turns"]), baseline })[0], /not measured \(max-turns\)/);
});
