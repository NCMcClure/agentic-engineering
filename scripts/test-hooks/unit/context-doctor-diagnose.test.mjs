// The context-doctor area's findings: what the lens read from a transcript,
// measured against thresholds.mjs. Each test builds a transcript from the
// shapes real ones carry, reads it through the lens, and asks what
// `diagnose` raises: one case that trips a finding, and the nearest case that
// must not.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { CODES, LEVELS, diagnose, renderDiagnosis, summary } from "../../../plugins/agentic-engineering/skills/context-doctor/scripts/diagnose.mjs";
import { loadSources } from "../../../plugins/agentic-engineering/skills/context-doctor/scripts/sources.mjs";
import * as thresholds from "../../../plugins/agentic-engineering/skills/context-doctor/scripts/thresholds.mjs";
import { buildSession } from "../../../plugins/agentic-engineering/skills/context-doctor/scripts/transcript.mjs";
import { DENYLIST } from "../../../plugins/agentic-engineering/hooks/critical-context.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const AREA = path.join(REPO, "plugins", "agentic-engineering", "skills", "context-doctor");
const CLI = path.join(AREA, "scripts", "context-lens.mjs");
const CWD = "/srv/demo";

const command = (script) => `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"`;
const inArea = (area, script) => `node "\${CLAUDE_PLUGIN_ROOT}/skills/${area}/hooks/${script}"`;
const START = "startup|resume|clear|compact";

/** A ~/.claude with one plugin of two areas in the focus marketplace, and one plugin from elsewhere. */
function claudeDir(t) {
  const dir = tempDir(t, "context-doctor-");
  const root = "plugins/cache/agentic-engineering/agentic-engineering/1.1.0";
  write(dir, `${root}/hooks/hooks.json`, JSON.stringify({ hooks: {
    SessionStart: [{ matcher: START, hooks: [{ type: "command", command: command("session-start.mjs"), statusMessage: "Reading what applies here" }] }],
    SubagentStart: [{ hooks: [{ type: "command", command: command("session-start.mjs") }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: inArea("write-like-me", "nudge.mjs") }] }],
    Stop: [{ hooks: [{ type: "command", command: inArea("agentic-teamwork", "stop-gate.mjs") }] }],
  } }));
  for (const area of ["agentic-teamwork", "write-like-me"]) write(dir, `${root}/skills/${area}/routes/go/ROUTE.md`, "---\nname: go\n---\n");
  write(dir, "plugins/cache/elsewhere/other-tool/1.0.0/hooks/hooks.json", JSON.stringify({ hooks: {
    SessionStart: [{ matcher: START, hooks: [{ type: "command", command: command("hello.mjs"), statusMessage: "Saying hello" }] }],
  } }));
  write(dir, "plugins/known_marketplaces.json", JSON.stringify({ "agentic-engineering": { installLocation: path.join(dir, "plugins", "marketplaces", "agentic-engineering") } }));
  write(dir, "plugins/marketplaces/agentic-engineering/.claude-plugin/marketplace.json", JSON.stringify({ name: "agentic-engineering", plugins: [{ name: "agentic-engineering" }] }));
  return dir;
}

let clock = Date.parse("2026-11-15T20:00:00Z");
const at = () => new Date((clock += 1000)).toISOString();

const hookRun = (hookName, cmd, stdout, extra = {}) => ({
  type: "attachment",
  timestamp: at(),
  attachment: { type: "hook_success", hookName, hookEvent: hookName.split(":")[0], toolUseID: extra.toolUseID ?? `${hookName}-${clock}`, command: cmd, stdout, stderr: "", exitCode: 0, content: "" },
});
const additional = (event, text) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const started = (text, how = "startup", cmd = "Reading what applies here") => hookRun(`SessionStart:${how}`, cmd, additional("SessionStart", text));
const failed = (event, stderr) => ({ type: "attachment", timestamp: at(), attachment: { type: "hook_non_blocking_error", hookName: event, hookEvent: event, stderr } });
const prompt = (text = "Go on.") => ({ type: "user", timestamp: at(), origin: { kind: "human" }, message: { role: "user", content: text } });
const assistant = (requestId, contextTokens = 50_000) => ({
  type: "assistant",
  timestamp: at(),
  requestId,
  message: { id: `msg_${requestId}`, role: "assistant", content: [{ type: "text", text: "ok" }], usage: { input_tokens: 10, cache_read_input_tokens: contextTokens - 110, cache_creation_input_tokens: 100, output_tokens: 50 } },
});
const toolUse = (id, name, input) => ({
  type: "assistant",
  timestamp: at(),
  requestId: id,
  message: { id: `msg_${id}`, role: "assistant", content: [{ type: "tool_use", id, name, input }], usage: { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 100, output_tokens: 5 } },
});
const toolResult = (id, extra = {}) => ({ type: "user", timestamp: at(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok", ...extra }] } });
const compact = () => ({ type: "system", subtype: "compact_boundary", timestamp: at(), content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 160_000, postTokens: 20_000 } });
const listing = (lines) => ({ type: "attachment", timestamp: at(), attachment: { type: "skill_listing", content: lines.join("\n") } });
const rules = (content) => ({ type: "attachment", timestamp: at(), attachment: { type: "instructions", files: [{ path: `${CWD}/.agents/rules/team.md`, type: "Project", content }] } });

const read = (t, entries, extra = {}) => ({ ...buildSession(entries.map((e) => ({ cwd: CWD, sessionId: "abc", ...e })), { sources: loadSources({ claudeDir: claudeDir(t) }) }), ...extra });
const codes = (findings) => findings.map((f) => f.code);
const only = (findings, code) => {
  const hits = findings.filter((f) => f.code === code);
  assert.equal(hits.length, 1, `${code}: ${JSON.stringify(codes(findings))}`);
  return hits[0];
};

/** A session where nothing is wrong: a small start, a turn, a compaction that brings the start back. */
const clean = () => [
  started("Team conventions v1."),
  listing(["- agentic-engineering:start-here: Use when a person asks what is here.", "- agentic-engineering:agentic-teamwork: Use for the team's git conventions."]),
  prompt(), assistant("r1"),
  compact(),
  started("Team conventions v1.", "compact"),
  listing(["- agentic-engineering:start-here: Use when a person asks what is here.", "- agentic-engineering:agentic-teamwork: Use for the team's git conventions."]),
  assistant("r2", 21_000),
];

test("a session where nothing went wrong has no findings, and says what that covers", (t) => {
  const session = read(t, clean());
  const findings = diagnose(session);
  assert.deepEqual(findings, []);
  const text = renderDiagnosis(session, findings);
  assert.match(text, /^Context Doctor: /);
  assert.match(text, /No findings: nothing in this transcript went over a cap/);
  assert.deepEqual(summary(session, findings).counts, { critical: 0, warning: 0, info: 0 });
});

test("a hook over the host's cap is critical, one near it a warning, and one under neither", (t) => {
  const big = (n) => "x".repeat(n);
  const over = only(diagnose(read(t, [started(big(10_001)), prompt(), assistant("r1")])), "HOOK_OVER_CAP");
  assert.deepEqual([over.level, over.owner, over.segment], ["critical", "agentic-engineering", 0]);
  assert.match(over.what, /printed 10,001 characters/);
  assert.equal(over.events.length, 1);
  // At the cap exactly the host still sends the text.
  const near = only(diagnose(read(t, [started(big(10_000)), prompt(), assistant("r1")])), "HOOK_NEAR_CAP");
  assert.equal(near.level, "warning");
  assert.match(near.what, /within 0 of the 10,000/);
  assert.equal(only(diagnose(read(t, [started(big(8_000)), prompt(), assistant("r1")])), "HOOK_NEAR_CAP").level, "warning");
  assert.deepEqual(diagnose(read(t, [started(big(7_999)), prompt(), assistant("r1")])), []);
});

test("start context a compaction did not bring back is critical, and the cause is read from what ran after it", (t) => {
  const lost = (afterCompaction) => only(diagnose(read(t, [started("Team conventions v1."), prompt(), assistant("r1"), compact(), ...afterCompaction, assistant("r2", 21_000)])), "COMPACT_LOST");
  const matcher = lost([]);
  assert.deepEqual([matcher.level, matcher.owner, matcher.segment, matcher.compaction], ["critical", "agentic-engineering", 1, 0]);
  assert.match(matcher.what, /before compaction 1 and no request after it carried it\. No SessionStart hook of its ran/);
  assert.match(matcher.fix, /Add `compact` to the SessionStart matcher/);
  const silent = lost([hookRun("SessionStart:compact", "Reading what applies here", "")]);
  assert.match(silent.what, /ran after the compaction and printed nothing/);
  assert.match(silent.fix, /whatever started the session/);
  assert.equal(silent.events.length, 1, "the silent run is where to look");
  const broke = lost([failed("SessionStart", "Error: Cannot find module '/opt/x/.claude/plugins/cache/agentic-engineering/agentic-engineering/1.0.0/hooks/session-start.mjs'")]);
  assert.match(broke.what, /failed on the run after the compaction/);
});

test("a session that ends at its compaction has lost nothing yet", (t) => {
  const findings = diagnose(read(t, [started("Team conventions v1."), prompt(), assistant("r1"), compact()]));
  assert.deepEqual(codes(findings), []);
});

test("context that came back only because the session was resumed is a warning, with the requests that went without", (t) => {
  const entries = [started("Team conventions v1."), prompt(), assistant("r1"), compact(), assistant("r2", 21_000), assistant("r3", 22_000), started("Team conventions v1.", "resume"), prompt(), assistant("r4", 23_000)];
  const findings = diagnose(read(t, entries));
  const late = only(findings, "COMPACT_ONLY_RESUME");
  assert.deepEqual([late.level, late.owner, late.segment, late.compaction], ["warning", "agentic-engineering", 1, 0]);
  assert.match(late.what, /came back only on a later resume: 2 requests went out without it first/);
  assert.ok(!codes(findings).includes("COMPACT_LOST"), "the lens reads it as kept, which is what hides it");
  // The same resume after a hook that did match `compact` is only a repeat.
  const kept = diagnose(read(t, [started("Team conventions v1."), prompt(), assistant("r1"), compact(), started("Team conventions v1.", "compact"), assistant("r2", 21_000), started("Team conventions v1.", "resume"), assistant("r3", 22_000)]));
  assert.deepEqual(codes(kept), ["RESUME_REPEAT"]);
  assert.match(kept[0].what, /entered segment 2 2 times \(compact, resume\)/);
  assert.equal(kept[0].level, "info");
});

test("a call the host refused is critical and quotes what the host said; a skill called twice is a warning", (t) => {
  const entries = [
    started("Team conventions v1."), prompt(),
    toolUse("t1", "Skill", { skill: "other-tool:setup" }), toolResult("t1", { is_error: true, content: "This skill can only be started by the user." }),
    toolUse("t2", "Skill", { skill: "agentic-engineering:agentic-teamwork", args: "ship" }), toolResult("t2"),
    prompt(),
    toolUse("t3", "Skill", { skill: "agentic-engineering:agentic-teamwork", args: "land" }), toolResult("t3"),
    toolUse("t4", "Skill", { skill: "agentic-engineering:write-like-me" }), toolResult("t4"),
  ];
  const findings = diagnose(read(t, entries));
  const refused = only(findings, "SKILL_REFUSED");
  assert.deepEqual([refused.level, refused.owner, refused.turn], ["critical", "other-tool", 1]);
  assert.match(refused.what, /refused 1 call on other-tool:setup: "This skill can only be started by the user"\. /);
  assert.match(refused.fix, /`user-invocable: false`/);
  const again = only(findings, "SKILL_REINVOKED");
  assert.deepEqual([again.level, again.owner, again.turn], ["warning", "agentic-teamwork", 2]);
  assert.match(again.what, /called 2 times in segment 1 \(turns 1, 2\)/);
  assert.equal(findings[0].code, "SKILL_REFUSED", "critical first");
});

test("the same skill called once on each side of a compaction is not called twice", (t) => {
  const call = (id) => [toolUse(id, "Skill", { skill: "agentic-engineering:agentic-teamwork" }), toolResult(id)];
  const findings = diagnose(read(t, [started("v1"), prompt(), ...call("t1"), compact(), started("v1", "compact"), prompt(), ...call("t2")]));
  assert.ok(!codes(findings).includes("SKILL_REINVOKED"), JSON.stringify(codes(findings)));
});

test("a hook that failed is a warning, and a missing file is read as an update that replaced the plugin's root", (t) => {
  const gone = only(diagnose(read(t, [started("v1"), prompt(), assistant("r1"), failed("Stop", "Error: Cannot find module '/opt/x/.claude/plugins/cache/agentic-engineering/agentic-engineering/1.0.0/skills/agentic-teamwork/hooks/stop-gate.mjs'")])), "HOOK_FAILED");
  assert.deepEqual([gone.level, gone.owner, gone.turn], ["warning", "agentic-teamwork", 1]);
  assert.match(gone.what, /Its Stop hook failed 1 time: Error: Cannot find module/);
  assert.match(gone.fix, /an update replaces the plugin's root/);
  const other = only(diagnose(read(t, [started("v1"), prompt(), assistant("r1"), failed("Stop", "TypeError: x is not a function at /opt/x/.claude/plugins/cache/agentic-engineering/agentic-engineering/1.0.0/skills/agentic-teamwork/hooks/stop-gate.mjs")])), "HOOK_FAILED");
  assert.match(other.fix, /Run the hook's command by hand/);
  // The host wraps a failure in its own preamble and Node adds a stack: the finding quotes the error's own line.
  const wrapped = only(diagnose(read(t, [started("v1"), prompt(), assistant("r1"), failed("Stop", "Failed with non-blocking status code: node:internal/modules/cjs/loader:1413\n  throw err;\n  ^\n\nError: Cannot find module '/opt/x/.claude/plugins/cache/agentic-engineering/agentic-engineering/1.0.0/skills/agentic-teamwork/hooks/stop-gate.mjs'\n    at Function._resolveFilename (node:internal/modules/cjs/loader:1410:15)")])), "HOOK_FAILED");
  assert.match(wrapped.what, /failed 1 time: Error: Cannot find module '[^']+stop-gate\.mjs'\. A hook that fails/);
});

test("a hook whose every output was a systemMessage is a warning; one that also told the model is not", (t) => {
  const stop = (stdout) => hookRun("Stop", inArea("agentic-teamwork", "stop-gate.mjs"), JSON.stringify(stdout));
  const person = only(diagnose(read(t, [started("v1"), prompt(), assistant("r1"), stop({ systemMessage: "Before you finish: no test ran." }), prompt(), assistant("r2"), stop({ systemMessage: "Before you finish: no test ran." })])), "HOOK_PERSON_ONLY");
  assert.deepEqual([person.level, person.owner, person.events.length], ["warning", "agentic-teamwork", 2]);
  assert.match(person.what, /Every Stop output from it \(2 runs\) was a systemMessage: the person saw "Before you finish: no test ran\."/);
  const both = diagnose(read(t, [started("v1"), prompt(), assistant("r1"), stop({ systemMessage: "Before you finish: no test ran.", decision: "block", reason: "No test ran." })]));
  assert.deepEqual(codes(both), []);
});

test("the same hook text on five turns repeats; on four, or changing each turn, it does not", (t) => {
  const nudge = (text) => hookRun("UserPromptSubmit", inArea("write-like-me", "nudge.mjs"), additional("UserPromptSubmit", text));
  const turns = (n, text = () => "Write in the person's voice: no em-dashes.") => Array.from({ length: n }, (_, i) => [prompt(), nudge(text(i)), assistant(`r${i}`)]).flat();
  const repeats = only(diagnose(read(t, [started("v1"), ...turns(5)])), "HOOK_REPEATS");
  assert.deepEqual([repeats.level, repeats.owner, repeats.events.length], ["warning", "write-like-me", 5]);
  assert.match(repeats.what, /on 5 turns, ~55 in all: "Write in the person's voice: no em-dashes\."/);
  assert.deepEqual(codes(diagnose(read(t, [started("v1"), ...turns(4)]))), []);
  assert.deepEqual(codes(diagnose(read(t, [started("v1"), ...turns(6, (i) => `Draft ${i} of the summary is open.`)]))), []);
});

test("a long line that two sources both put in at the start is said twice; a short one, or one source twice, is not", (t) => {
  const rule = "- Never force push, never --no-verify, never push unless the person asked.";
  const twice = only(diagnose(read(t, [started(`Critical, from agentic-teamwork:\n${rule}`), rules(`# Team rules\n\n${rule}\n`), prompt(), assistant("r1")])), "DUP_TEXT");
  assert.deepEqual([twice.level, twice.owner, twice.events.length], ["warning", "agentic-engineering", 2]);
  assert.match(twice.what, /1 line \(72 characters\) reached the model twice at the start, from the SessionStart hook of agentic-engineering and from \.agents\/rules\/team\.md/);
  assert.deepEqual(codes(diagnose(read(t, [started("- Never force push."), rules("- Never force push.\n"), prompt(), assistant("r1")]))), []);
  // A resume prints the hook again: the host's repeat, not the plugin's duplicate.
  assert.deepEqual(codes(diagnose(read(t, [started(rule), started(rule, "resume"), prompt(), assistant("r1")]))), ["RESUME_REPEAT"]);
});

test("critical lines over their total are a warning, counted once however often a resume printed them", (t) => {
  const block = (owner, chars) => `Critical, from ${owner}:\n- ${"y".repeat(chars - `Critical, from ${owner}:\n- `.length)}`;
  const under = `${block("agentic-teamwork", 4_000)}\n\n${block("write-like-me", 3_500)}`;
  const resumed = diagnose(read(t, [started(under), started(under, "resume"), prompt(), assistant("r1")]));
  assert.ok(!codes(resumed).includes("CRITICAL_TOTAL_OVER"), "7,500 exactly, printed twice, is still 7,500");
  const over = only(diagnose(read(t, [started(`${block("agentic-teamwork", 4_000)}\n\n${block("write-like-me", 3_501)}`), prompt(), assistant("r1")])), "CRITICAL_TOTAL_OVER");
  assert.equal(over.level, "warning");
  assert.match(over.what, /2 owners came to 7,501 characters at the start of segment 1, over the 7,500 they are held to\. The largest: agentic-teamwork 4,000, write-like-me 3,501\./);
});

test("the last route read before a compaction and not read again is a warning", (t) => {
  const route = (name) => `/opt/x/.claude/plugins/cache/agentic-engineering/agentic-engineering/1.1.0/skills/agentic-teamwork/routes/${name}/ROUTE.md`;
  const reading = (id, name) => [toolUse(id, "Read", { file_path: route(name) }), toolResult(id)];
  const before = [started("v1"), prompt(), ...reading("t1", "tdd"), ...reading("t2", "ship"), compact(), started("v1", "compact")];
  const gone = only(diagnose(read(t, [...before, prompt(), assistant("r2", 21_000)])), "ROUTE_NOT_REREAD");
  assert.deepEqual([gone.level, gone.owner, gone.segment, gone.compaction], ["warning", "agentic-teamwork", 1, 0]);
  assert.match(gone.what, /The ship route of agentic-teamwork was the last route read before compaction 1 \(turn 1\)/);
  assert.deepEqual(codes(diagnose(read(t, [...before, prompt(), ...reading("t3", "ship")]))), []);
  assert.deepEqual(codes(diagnose(read(t, before))), [], "no request after the compaction yet");
});

test("skills of a focus plugin listed by name only are a warning; another marketplace's are its own business", (t) => {
  const bare = only(diagnose(read(t, [started("v1"), listing(["- agentic-engineering:start-here", "- agentic-engineering:agentic-teamwork", "- agentic-engineering:write-like-me: Use for prose.", "- other-tool:setup"]), prompt(), assistant("r1")])), "LISTING_BARE");
  // One finding for the plugin, over the listing of each of its areas and of the skill a person types.
  assert.deepEqual([bare.level, bare.owner, bare.events.length], ["warning", "agentic-engineering", 3]);
  assert.match(bare.what, /2 of 3 skills from agentic-engineering were listed by name only: start-here, agentic-teamwork\./);
  assert.deepEqual(codes(diagnose(read(t, [started("v1"), listing(["- agentic-engineering:start-here: Use when a person asks.", "- other-tool:setup"]), prompt(), assistant("r1")]))), []);
});

test("a searcher that started with plugin context is a warning on the session that started it; a builder is not", (t) => {
  const sub = (agentType) => ({ agentType, session: read(t, [hookRun("SubagentStart", command("session-start.mjs"), additional("SubagentStart", "Critical, from agentic-teamwork:\n- Never force push.")), prompt("Find the config loader."), assistant("s1", 9_000)]) });
  const main = read(t, [started("v1"), prompt(), assistant("r1")]);
  const told = only(diagnose(main, { subagents: [sub("Explore"), sub("Explore"), sub("general-purpose")] }), "SUBAGENT_CONTEXT");
  assert.deepEqual([told.level, told.owner, told.events], ["warning", "agentic-engineering", []]);
  assert.match(told.what, /2 Explore subagents started with ~\d+ tokens of its context/);
  assert.deepEqual(codes(diagnose(main, { subagents: [sub("general-purpose")] })), []);
  // A subagent's own transcript, diagnosed directly, carries its agent type and points at the event.
  const own = sub("Plan").session;
  const direct = only(diagnose({ ...own, agentType: "Plan" }), "SUBAGENT_CONTEXT");
  assert.equal(direct.events.length, 1);
});

test("what limits the reading is said: hooks no plugin claimed, unreadable lines, a transcript that opens at a compaction", (t) => {
  const loose = only(diagnose(read(t, [hookRun("SessionStart:startup", "node ~/.claude/my-hook.mjs", additional("SessionStart", "From settings.json.")), prompt(), assistant("r1")])), "UNATTRIBUTED");
  assert.deepEqual([loose.level, loose.owner, loose.events.length], ["info", null, 1]);
  assert.match(loose.what, /1 hook output could not be tied to a plugin \(SessionStart:startup\)/);
  const partial = only(diagnose(read(t, [compact(), started("v1", "compact"), assistant("r1", 21_000)], { badLines: 2 })), "TRANSCRIPT_PARTIAL");
  assert.equal(partial.level, "info");
  assert.match(partial.what, /2 lines of the transcript could not be read; it opens at a compaction/);
  assert.match(only(diagnose(read(t, [started("v1"), prompt()])), "TRANSCRIPT_PARTIAL").what, /records no API request/);
});

test("findings come most serious first, and the text names each with where it is and its fix", (t) => {
  const entries = [
    hookRun("SessionStart:startup", "node ~/.claude/my-hook.mjs", additional("SessionStart", "From settings.json.")),
    started("Team conventions v1."), listing(["- agentic-engineering:agentic-teamwork"]),
    prompt(), assistant("r1"), compact(), assistant("r2", 21_000),
  ];
  const session = read(t, entries);
  const findings = diagnose(session);
  assert.deepEqual(codes(findings), ["COMPACT_LOST", "COMPACT_LOST", "LISTING_BARE", "UNATTRIBUTED"]);
  // A hook's context names its hook and why; the host's listing is one finding and says it is the host's.
  assert.match(findings[1].what, /^The skill listing of agentic-teamwork \(~\d+ tokens\) was in the window before compaction 1 and the transcript records no copy sent after it\./);
  assert.match(findings[1].fix, /The host sends this, not the plugin/);
  assert.deepEqual(findings.map((f) => f.level), ["critical", "critical", "warning", "info"]);
  for (const f of findings) {
    assert.equal(CODES[f.code], f.level);
    for (const key of ["code", "level", "owner", "segment", "turn", "compaction", "events", "what", "fix"]) assert.ok(key in f, `${f.code}.${key}`);
    for (const id of f.events) assert.ok(session.events[id], `${f.code} points at event ${id}`);
  }
  const text = renderDiagnosis(session, findings);
  assert.match(text, /\n2 critical, 1 warning, 1 note\./);
  assert.match(text, /\ncritical COMPACT_LOST · agentic-engineering · segment 2\n {2}what {2}Its SessionStart context .*\n {2}fix {3}Add `compact`/);
  assert.match(text, /\nwarning {2}LISTING_BARE · agentic-engineering · segment 1\n/);
  assert.deepEqual(summary(session, findings).counts, { critical: 2, warning: 1, info: 1 });
});

test("every code is one of the three levels, and the route's table lists each with the same level", () => {
  const route = fs.readFileSync(path.join(AREA, "routes", "diagnose", "ROUTE.md"), "utf8");
  for (const [code, level] of Object.entries(CODES)) {
    assert.ok(LEVELS.includes(level), code);
    assert.match(route, new RegExp(`\\| ${level} \\| \`${code}\` \\|`), `${code} in the route's table as ${level}`);
  }
  assert.equal((route.match(/^\| (?:critical|warning|info) \| `/gm) ?? []).length, Object.keys(CODES).length, "no row for a finding nothing raises");
});

test("the thresholds are the gate's, the scanner's, and the session hook's own numbers", () => {
  const constant = (file, name) => {
    const m = new RegExp(`const ${name} = ([\\d_]+);`).exec(fs.readFileSync(path.join(REPO, file), "utf8"));
    assert.ok(m, `${name} in ${file}`);
    return Number(m[1].replace(/_/g, ""));
  };
  const scanner = "plugins/agentic-engineering/skills/plugin-workbench/core/scripts/plugin-scan.mjs";
  assert.equal(thresholds.HOOK_OUTPUT_CAP, constant("scripts/validate.mjs", "HOOK_OUTPUT_CAP"));
  assert.equal(thresholds.HOOK_OUTPUT_CAP, constant(scanner, "HOOK_OUTPUT_CAP"));
  assert.equal(thresholds.CRITICAL_TOTAL, constant("scripts/validate.mjs", "CRITICAL_TOTAL"));
  assert.equal(thresholds.CRITICAL_TOTAL, constant(scanner, "CRITICAL_TOTAL_CAP"));
  assert.ok(thresholds.HOOK_OUTPUT_NEAR < thresholds.HOOK_OUTPUT_CAP);
  assert.deepEqual([...thresholds.QUIET_AGENTS].sort(), [...DENYLIST].sort(), "the agents the session hook says nothing to");
});

const get = (port, url) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path: url }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => resolve({ status: res.statusCode, body }));
  }).on("error", reject);
});

/** A transcript on disk with a quiet subagent beside it, as the host lays them out. */
function onDisk(t) {
  const dir = claudeDir(t);
  const jsonl = (entries, id) => entries.map((e) => JSON.stringify({ cwd: CWD, sessionId: id, ...e })).join("\n") + "\n";
  const file = write(dir, "projects/-srv-demo/abc.jsonl", jsonl([started("Team conventions v1."), prompt(), assistant("r1"), compact(), assistant("r2", 21_000)], "abc"));
  write(dir, "projects/-srv-demo/abc/subagents/agent-1.jsonl", jsonl([hookRun("SubagentStart", command("session-start.mjs"), additional("SubagentStart", "Critical, from agentic-teamwork:\n- Never force push.")), prompt("Find it."), assistant("s1", 9_000)], "abc"));
  write(dir, "projects/-srv-demo/abc/subagents/agent-1.meta.json", JSON.stringify({ agentType: "Explore", description: "find the loader" }));
  return { dir, file };
}

test("diagnose prints the findings as text and as JSON, reads the session's quiet subagents, and fails only for no transcript", (t) => {
  const { dir, file } = onDisk(t);
  const text = runNode(CLI, ["diagnose", "abc", "--claude-dir", dir]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Context Doctor: /);
  assert.match(text.stdout, /critical COMPACT_LOST · agentic-engineering · segment 2/);
  assert.match(text.stdout, /warning {2}SUBAGENT_CONTEXT · agentic-engineering\n {2}what {2}1 Explore subagent started/);
  assert.ok(text.stdout.trimEnd().endsWith(file), "the transcript it read is the last line");

  const json = runNode(CLI, ["diagnose", file, "--json", "--claude-dir", dir]);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  for (const key of ["id", "title", "cwd", "version", "file", "requests", "peakTokens", "compactions", "counts", "thresholds", "findings"]) assert.ok(key in report, `report.${key}`);
  assert.deepEqual(report.counts, { critical: 1, warning: 1, info: 0 });
  assert.deepEqual(report.findings.map((f) => f.code), ["COMPACT_LOST", "SUBAGENT_CONTEXT"]);
  assert.equal(report.thresholds.HOOK_OUTPUT_CAP, 10_000);
  assert.equal(report.peakTokens, 50_000);

  // The subagent's own transcript says what it is by the file beside it.
  const sub = JSON.parse(runNode(CLI, ["diagnose", path.join(dir, "projects/-srv-demo/abc/subagents/agent-1.jsonl"), "--json", "--claude-dir", dir]).stdout);
  assert.deepEqual(sub.findings.map((f) => [f.code, f.events.length]), [["SUBAGENT_CONTEXT", 1]]);

  const missing = runNode(CLI, ["diagnose", "no-such-session", "--claude-dir", dir]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no transcript found for no-such-session/);
});

test("the page is sent the findings with the session, and draws them", async (t) => {
  const { dir, file } = onDisk(t);
  const child = spawn(process.execPath, [CLI, "serve", "--port", "0", "--claude-dir", dir], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (c) => { out += c; const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
      child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    const session = JSON.parse((await get(port, `/api/session?file=${encodeURIComponent(file)}`)).body);
    assert.deepEqual(session.findings.map((f) => f.code), ["COMPACT_LOST", "SUBAGENT_CONTEXT"]);
    const app = (await get(port, "/app.js")).body;
    assert.match(app, /function findingsView\(/);
    assert.match(app, /s\.findings/);
  } finally {
    child.kill();
  }
});

test("report --json stays the lens's reading alone: findings are diagnose's to print", (t) => {
  const { dir, file } = onDisk(t);
  const report = JSON.parse(runNode(CLI, ["report", file, "--json", "--claude-dir", dir]).stdout);
  assert.equal("findings" in report, false);
});
