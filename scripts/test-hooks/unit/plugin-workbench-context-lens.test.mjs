// plugin-workbench's context-lens: a Claude Code transcript read back into
// what entered the model's context, from which plugin, and whether it
// survived a compaction. The fixture is built from the shapes real
// transcripts carry (Claude Code 2.1.30x), trimmed to the fields the reader
// uses. The live lane reads sessions through the same script, so the last
// test pins the `--json` report's shape.
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { buildSession, parseJsonl } from "../../../plugins/plugin-workbench/skills/context-lens/scripts/transcript.mjs";
import { attributeHook, loadSources, splitListing } from "../../../plugins/plugin-workbench/skills/context-lens/scripts/sources.mjs";
import { renderReport } from "../../../plugins/plugin-workbench/skills/context-lens/scripts/report.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const CLI = path.join(REPO, "plugins", "plugin-workbench", "skills", "context-lens", "scripts", "context-lens.mjs");

const hooksJson = (map) => JSON.stringify({ hooks: map });
const command = (script) => `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${script}"`;

/** A ~/.claude with three cached plugins, two of which share a command string. */
function claudeDir(t) {
  const dir = tempDir(t, "context-lens-");
  const cache = (mkt, name, version, map) => write(dir, `plugins/cache/${mkt}/${name}/${version}/hooks/hooks.json`, hooksJson(map));
  cache("agentic-engineering", "agentic-teamwork", "0.18.2", {
    SessionStart: [{ matcher: "startup|resume|clear|compact", hooks: [{ type: "command", command: command("session-start.mjs"), statusMessage: "Reading the team conventions" }] }],
    SubagentStart: [{ hooks: [{ type: "command", command: command("session-start.mjs") }] }],
    PostToolUse: [{ matcher: "Edit|MultiEdit|Write", hooks: [{ type: "command", command: command("edit-check.mjs") }] }],
    Stop: [{ hooks: [{ type: "command", command: command("stop-gate.mjs") }] }],
  });
  cache("agentic-engineering", "agent-works", "0.8.0", {
    SessionStart: [{ matcher: "startup|resume|clear|compact", hooks: [{ type: "command", command: command("session-start.mjs"), statusMessage: "Reading the board" }] }],
    Stop: [{ hooks: [{ type: "command", command: command("card-sync.mjs") }] }],
  });
  cache("agentic-engineering", "field-notes", "3.1.1", {
    SessionStart: [{ hooks: [{ type: "command", command: `${command("notes-hook.mjs")} session-start`, statusMessage: "Loading the notes" }] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: `${command("notes-hook.mjs")} prompt-submit` }] }],
  });
  cache("agentic-engineering", "perceptual-loop", "0.4.0", { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: command("guard.mjs") }] }] });
  cache("elsewhere", "other-tool", "1.0.0", { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: command("guard.mjs") }] }] });
  write(dir, "plugins/known_marketplaces.json", JSON.stringify({ "agentic-engineering": { installLocation: path.join(dir, "plugins", "marketplaces", "agentic-engineering") } }));
  write(dir, "plugins/marketplaces/agentic-engineering/.claude-plugin/marketplace.json", JSON.stringify({
    name: "agentic-engineering",
    plugins: [{ name: "agentic-teamwork" }, { name: "agent-works" }, { name: "field-notes" }, { name: "plugin-workbench" }],
  }));
  return dir;
}

const HOME = ["", "home", "someone"].join("/");
const reminder = (text) => [{ content: `<system-reminder>\n${text}\n</system-reminder>` }];
let clock = Date.parse("2026-11-06T20:00:00Z");
const at = () => new Date((clock += 1000)).toISOString();

const hookRun = (hookName, cmd, stdout, extra = {}) => ({
  type: "attachment",
  timestamp: at(),
  attachment: { type: "hook_success", hookName, hookEvent: hookName.split(":")[0], toolUseID: extra.toolUseID ?? hookName, command: cmd, stdout, stderr: "", exitCode: 0, content: extra.content ?? "" },
  ...(extra.rendered ? { rendered: extra.rendered, renderedRole: "system" } : {}),
});
const additional = (event, text) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const combined = (event, texts, toolUseID = event) => ({
  type: "attachment",
  timestamp: at(),
  attachment: { type: "hook_additional_context", hookName: event, hookEvent: event, toolUseID, content: texts },
  rendered: reminder(`${event} hook additional context: ${texts.join("\n")}`),
  renderedRole: "system",
});
const instructions = (cwd) => ({
  type: "attachment",
  timestamp: at(),
  attachment: {
    type: "instructions",
    files: [
      { path: `${HOME}/.claude/CLAUDE.md`, type: "User", content: "# mine\n" },
      { path: `${cwd}/CLAUDE.md`, type: "Project", content: "# hub\n\n@.agents/rules/ladder.md\n" },
      { path: `${cwd}/.agents/rules/ladder.md`, type: "Project", content: "# The ladder\n\nClimb, stop at the first rung that holds.\n" },
    ],
  },
  rendered: reminder("Codebase and user instructions are shown below.\n\n# mine\n# hub\n# The ladder"),
  renderedRole: "user",
});
const skills = () => ({
  type: "attachment",
  timestamp: at(),
  attachment: {
    type: "skill_listing",
    content: [
      "- browser-tools: Drive a real browser from the shell.",
      "- agentic-teamwork:ship: Land the current work: branch if needed, commit,",
      "  and open the merge request.",
      "- agentic-teamwork:ladder",
      "- agent-works:board: Use for anything on the kanban board.",
    ].join("\n"),
  },
  rendered: reminder("The following skills are available for use with the Skill tool:\n\n- browser-tools ..."),
  renderedRole: "system",
});
const assistant = (requestId, contextTokens, text = "ok") => ({
  type: "assistant",
  timestamp: at(),
  requestId,
  message: {
    id: `msg_${requestId}`,
    role: "assistant",
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, cache_read_input_tokens: contextTokens - 110, cache_creation_input_tokens: 100, output_tokens: 50 },
  },
});
const prompt = (text, kind = "human") => ({ type: "user", timestamp: at(), origin: { kind }, message: { role: "user", content: text } });

function fixture() {
  const cwd = "/srv/demo";
  const entries = [
    hookRun("SessionStart:startup", "Reading the board", additional("SessionStart", "Board: 1 in progress."), { toolUseID: "a" }),
    hookRun("SessionStart:startup", "Reading the team conventions", additional("SessionStart", "Team conventions v1. Branch: feat/x."), { toolUseID: "b" }),
    hookRun("SessionStart:startup", "Loading the notes", additional("SessionStart", "Notes: 12 files indexed."), { toolUseID: "c" }),
    combined("SessionStart", ["Board: 1 in progress.", "Team conventions v1. Branch: feat/x.", "Notes: 12 files indexed."]),
    prompt("Walk me through the install."),
    instructions(cwd),
    skills(),
    { type: "api-request-shape", shapeHash: "s1", timestamp: at(), shape: { system: [{ type: "text", text: "You are Claude Code." }], tools: [{ name: "Bash", input_schema: {} }, { name: "mcp__agent-works__list_tasks", input_schema: {} }] } },
    hookRun("UserPromptSubmit", `${command("notes-hook.mjs")} prompt-submit`, "Relevant notes: conventions.md", { content: "Relevant notes: conventions.md", rendered: reminder("UserPromptSubmit hook success: Relevant notes: conventions.md") }),
    assistant("r1", 86_000),
    assistant("r1", 86_000, "still the same request, a second block"),
    hookRun("Stop", command("stop-gate.mjs"), JSON.stringify({ systemMessage: "Before you finish:\n- no test command ran." }), { toolUseID: "stop1" }),
    { type: "attachment", timestamp: at(), attachment: { type: "hook_system_message", hookName: "Stop", hookEvent: "Stop", toolUseID: "stop1", content: "Before you finish:\n- no test command ran." } },
    { type: "system", subtype: "stop_hook_summary", timestamp: at(), toolUseID: "stop1", hookInfos: [{ command: command("stop-gate.mjs"), durationMs: 200 }, { command: command("card-sync.mjs"), durationMs: 90 }, { command: "callback" }], hookAdditionalContext: [], preventedContinuation: false },
    { type: "system", subtype: "compact_boundary", timestamp: at(), content: "Conversation compacted", compactMetadata: { trigger: "auto", preTokens: 160_000, postTokens: 20_000 } },
    instructions(cwd),
    { type: "user", timestamp: at(), isCompactSummary: true, message: { role: "user", content: "This session is being continued from a previous conversation. Summary: ..." } },
    hookRun("SessionStart:compact", "Reading the team conventions", additional("SessionStart", "Team conventions v1. Branch: feat/x."), { toolUseID: "d" }),
    combined("SessionStart", ["Team conventions v1. Branch: feat/x."]),
    assistant("r2", 21_000),
    prompt("<task-notification>done</task-notification>", "task-notification"),
    { type: "attachment", timestamp: at(), attachment: { type: "hook_non_blocking_error", hookName: "Stop", hookEvent: "Stop", stderr: "Error: Cannot find module '/opt/x/.claude/plugins/cache/agentic-engineering/agentic-teamwork/0.17.1/hooks/stop-gate.mjs'" } },
  ];
  return { cwd, entries: entries.map((e) => ({ cwd, sessionId: "abc", ...e })) };
}

test("parseJsonl keeps every parseable line and counts the rest", (t) => {
  const { entries, bad } = parseJsonl('{"type":"a"}\n\nnot json\n{"type":"b"}\n');
  assert.deepEqual(entries.map((e) => e.type), ["a", "b"]);
  assert.equal(bad, 1);
});

test("a hook is attributed by its status message, which the transcript records in place of the command", (t) => {
  const sources = loadSources({ claudeDir: claudeDir(t) });
  assert.equal(attributeHook(sources, { event: "SessionStart", command: "Reading the board" }).plugin, "agent-works");
  assert.equal(attributeHook(sources, { event: "SessionStart", command: "Reading the team conventions" }).plugin, "agentic-teamwork");
  assert.equal(attributeHook(sources, { event: "SubagentStart", command: command("session-start.mjs") }).plugin, "agentic-teamwork");
});

test("a command two plugins share is reported as either, never guessed", (t) => {
  const sources = loadSources({ claudeDir: claudeDir(t) });
  const hit = attributeHook(sources, { event: "PreToolUse", command: command("guard.mjs") });
  assert.deepEqual(hit.candidates, ["other-tool", "perceptual-loop"]);
  assert.equal(hit.plugin, "other-tool or perceptual-loop");
});

test("an unindexed hook falls back to the plugin cache path in its text", (t) => {
  const sources = loadSources({ claudeDir: claudeDir(t) });
  const hit = attributeHook(sources, { event: "Stop", command: "", text: "Cannot find module '/opt/x/.claude/plugins/cache/agentic-engineering/agentic-teamwork/0.17.1/hooks/stop-gate.mjs'" });
  assert.equal(hit.plugin, "agentic-teamwork");
  assert.equal(hit.version, "0.17.1");
  assert.equal(attributeHook(sources, { event: "Stop", command: "callback" }).plugin, "Claude Code");
});

test("focus is the plugins the focus marketplace's catalog lists", (t) => {
  const sources = loadSources({ claudeDir: claudeDir(t) });
  assert.ok(sources.focusNames.has("field-notes"));
  assert.ok(sources.focusNames.has("plugin-workbench"));
  assert.ok(!sources.focusNames.has("other-tool"));
});

test("splitListing groups skills by plugin and counts the ones listed without a description", (t) => {
  const parts = splitListing(skills().attachment.content);
  const repo = parts.find((p) => p.plugin === "agentic-teamwork");
  assert.equal(repo.count, 2);
  assert.equal(repo.bare, 1);
  assert.match(repo.text, /open the merge request/);
  assert.equal(parts.find((p) => p.plugin === null).count, 1);
});

test("SessionStart hooks land in the start phase, attributed, as model-visible context", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const start = session.events.filter((e) => e.segment === 0 && e.phase === "start" && e.kind === "hook");
  assert.deepEqual(start.map((e) => e.source.plugin), ["agent-works", "agentic-teamwork", "field-notes"]);
  assert.ok(start.every((e) => e.visibility === "model" && e.source.focus));
  assert.equal(start[1].text, "Team conventions v1. Branch: feat/x.");
  assert.equal(start[1].hookName, "SessionStart:startup");
});

test("a Stop hook's systemMessage reaches the person only, and silent Stop hooks are still listed", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const stop = session.events.filter((e) => e.event === "Stop" && e.segment === 0);
  const message = stop.find((e) => e.visibility === "person");
  assert.match(message.text, /Before you finish/);
  assert.equal(message.source.plugin, "agentic-teamwork");
  const silent = stop.filter((e) => e.visibility === "silent").map((e) => e.source.plugin);
  assert.deepEqual(silent, ["agent-works"], "stop-gate spoke, so only card-sync is silent; callbacks are skipped");
  assert.equal(stop.filter((e) => e.visibility === "person").length, 1, "the message is not counted twice");
});

test("the UserPromptSubmit hook belongs to the turn of the prompt that fired it", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const notes = session.events.find((e) => e.event === "UserPromptSubmit");
  assert.equal(notes.phase, 1);
  assert.equal(notes.source.plugin, "field-notes");
  assert.equal(notes.visibility, "model");
  assert.equal(session.turns[0].preview, "Walk me through the install.");
});

test("instructions split per file: the person's own, the repo's hub, and a rule under .agents/ by its repo-relative path", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const files = session.events.filter((e) => e.kind === "instructions" && e.segment === 0);
  assert.deepEqual(files.map((e) => e.label), ["~/.claude/CLAUDE.md", "CLAUDE.md", ".agents/rules/ladder.md"]);
  assert.deepEqual(files.map((e) => e.source.origin), ["user", "repo", "repo"]);
  const rule = files[2];
  assert.equal(rule.source.plugin, null, "a rule file is the repo's, whichever plugin first wrote it");
  assert.equal(rule.detail, "Project");
  assert.equal(rule.phase, "start");
});

test("skills, tools, and the system prompt are standing context, split by plugin", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const skillRows = session.events.filter((e) => e.kind === "skills");
  assert.deepEqual(skillRows.map((e) => e.source.plugin), [null, "agentic-teamwork", "agent-works"]);
  assert.equal(skillRows[1].detail, "2 skills, 1 without a description");
  const tools = session.events.filter((e) => e.kind === "tool-definitions" && e.segment === 0);
  assert.deepEqual(tools.map((e) => e.source.plugin), [null, "agent-works"]);
  assert.ok(session.events.some((e) => e.kind === "system-prompt" && e.phase === "start"));
  const carried = session.events.filter((e) => e.segment === 1 && e.carried);
  assert.deepEqual(carried.map((e) => e.kind), ["system-prompt", "tool-definitions", "tool-definitions"], "a compaction keeps the system prompt and tools, so they carry into the next segment");
});

test("a new request shape replaces the old one at the start, and later shows as a change in its turn", (t) => {
  const { entries } = fixture();
  const shape = (hash, tools) => ({ type: "api-request-shape", shapeHash: hash, timestamp: at(), cwd: "/srv/demo", shape: { system: [{ type: "text", text: "You are Claude Code." }], tools: tools.map((name) => ({ name, input_schema: {} })) } });
  const first = entries.findIndex((e) => e.type === "api-request-shape");
  const r1 = entries.findIndex((e) => e.requestId === "r1");
  const withShapes = [...entries.slice(0, first + 1), shape("s2", ["Bash", "Read"]), ...entries.slice(first + 1, r1 + 1), shape("s3", ["Bash", "Read", "mcp__agent-works__list_tasks"]), ...entries.slice(r1 + 1)];
  const session = buildSession(withShapes, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const start = session.events.filter((e) => e.segment === 0 && e.phase === "start" && e.kind === "tool-definitions");
  assert.deepEqual(start.map((e) => e.detail), ["2 definitions: Bash, Read"]);
  const changed = session.events.filter((e) => e.segment === 0 && e.phase === 1 && (e.kind === "tool-definitions" || e.kind === "system-prompt"));
  assert.deepEqual(changed.map((e) => e.source.plugin), ["agent-works"], "only the part that changed is news: the built-in tools and the system prompt did not");
  assert.ok(session.events.every((e, i) => e.id === i), "ids stay dense after the replaced rows are dropped");
});

test("token totals come from the API usage, one per request, not one per streamed block", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  assert.deepEqual(session.requests.map((r) => [r.segment, r.contextTokens]), [[0, 86_000], [1, 21_000]]);
  assert.equal(session.segments[0].baselineTokens, 86_000);
  assert.equal(session.segments[1].baselineTokens, 21_000);
});

test("a compaction opens a new segment, and the check names what was lost and what was kept", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  assert.equal(session.segments.length, 2);
  assert.equal(session.segments[1].startedBy, "compact");
  const [check] = session.compactions;
  assert.equal(check.trigger, "auto");
  assert.equal(check.preTokens, 160_000);
  const row = (label) => check.rows.find((r) => r.label === label);
  assert.equal(row("SessionStart · agentic-teamwork").status, "kept");
  assert.equal(row("SessionStart · agent-works").status, "lost");
  assert.equal(row("SessionStart · field-notes").status, "lost");
  assert.ok(!check.rows.some((r) => r.label.startsWith("instructions")), "a repo's rule files belong to no plugin, so the check leaves them to the timeline");
  assert.equal(row("skills · agentic-teamwork").status, "lost", "no skill listing was re-sent in this fixture");
  assert.equal(session.events.find((e) => e.kind === "summary").segment, 1);
});

test("a session that ends at its compaction has had no request to re-attach anything to", (t) => {
  const { entries } = fixture();
  const boundary = entries.findIndex((e) => e.subtype === "compact_boundary");
  const session = buildSession(entries.slice(0, boundary + 1), { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const [check] = session.compactions;
  assert.ok(!check.rows.some((r) => r.status === "lost"), JSON.stringify(check.rows));
  assert.equal(check.rows.find((r) => r.label === "SessionStart · field-notes").status, "no request yet");
  assert.equal(check.rows.find((r) => r.label === "UserPromptSubmit · field-notes").status, "no turn yet");
});

test("a conditional per-turn hook that did not speak again after a compaction is 'not since', not lost", (t) => {
  const { entries } = fixture();
  const boundary = entries.findIndex((e) => e.subtype === "compact_boundary");
  const nudge = { type: "attachment", timestamp: at(), cwd: "/srv/demo", attachment: { type: "hook_success", hookName: "PostToolUse:Write", hookEvent: "PostToolUse", toolUseID: "t1", command: command("edit-check.mjs"), stdout: additional("PostToolUse", "AGENTS.md does not name `x/`."), content: "" } };
  const withNudge = [...entries.slice(0, boundary), nudge, ...entries.slice(boundary)];
  const session = buildSession(withNudge, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const row = session.compactions[0].rows.find((r) => r.label === "PostToolUse · agentic-teamwork");
  assert.equal(row.status, "not since");
  assert.equal(session.compactions[0].rows.find((r) => r.label === "SessionStart · field-notes").status, "lost", "standing context still counts as lost");
});

test("rule files keep one label across checkouts, so a worktree switch does not read as new files", (t) => {
  const { entries } = fixture();
  const elsewhere = entries.map((e) => (e.attachment?.type === "instructions" && entries.indexOf(e) > entries.findIndex((x) => x.subtype === "compact_boundary")
    ? { ...e, attachment: { ...e.attachment, files: e.attachment.files.map((f) => ({ ...f, path: f.path.replace("/srv/demo", `${HOME}/repo/.claude/worktrees/feat-x1`) })) } }
    : e));
  const session = buildSession(elsewhere, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const labels = (segment) => session.events.filter((e) => e.kind === "instructions" && e.segment === segment).map((e) => e.label);
  assert.deepEqual(labels(1), ["~/.claude/CLAUDE.md", "CLAUDE.md", ".agents/rules/ladder.md"]);
  assert.deepEqual(labels(1), labels(0));
});

test("a transcript that opens at a compaction has nothing before it to compare, and says so", (t) => {
  const { entries } = fixture();
  const boundary = entries.findIndex((e) => e.subtype === "compact_boundary");
  const session = buildSession(entries.slice(boundary), { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const [check] = session.compactions;
  assert.equal(check.beforeRecorded, false);
  assert.ok(check.rows.every((r) => r.status === "after only"), JSON.stringify(check.rows));
});

test("an assistant entry replayed with no usage is not a request", (t) => {
  const { entries } = fixture();
  const replayed = { ...assistant("r0", 0), message: { ...assistant("r0", 0).message, usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } };
  const boundary = entries.findIndex((e) => e.subtype === "compact_boundary");
  const session = buildSession([...entries.slice(0, boundary + 1), replayed, ...entries.slice(boundary + 1)], { sources: loadSources({ claudeDir: claudeDir(t) }) });
  assert.equal(session.segments[1].baselineTokens, 21_000);
  const rule = session.events.find((e) => e.segment === 1 && e.label === ".agents/rules/ladder.md");
  assert.equal(rule.phase, "start", "context attached after a replayed message is still the segment's start");
});

test("a hook that failed is shown as an error, attributed from the path in its message", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  const error = session.events.find((e) => e.visibility === "error");
  assert.equal(error.source.plugin, "agentic-teamwork");
  assert.equal(error.source.version, "0.17.1");
});

test("a task notification starts a turn of its own", (t) => {
  const { entries } = fixture();
  const session = buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) });
  assert.deepEqual(session.turns.map((t) => t.origin), ["human", "task-notification"]);
});

test("the report names each plugin's injections by phase and flags what compaction lost", (t) => {
  const { entries } = fixture();
  const text = renderReport(buildSession(entries, { sources: loadSources({ claudeDir: claudeDir(t) }) }));
  assert.match(text, /Segment 1 \(startup\)/);
  assert.match(text, /SessionStart:startup\s+agentic-teamwork\s+model/);
  assert.match(text, /Stop\s+agentic-teamwork\s+person/);
  assert.match(text, /Compaction 1: auto, 160,000 -> 20,000 tokens/);
  assert.match(text, /lost\s+SessionStart · field-notes/);
});

const get = (port, url) => new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port, path: url }, (res) => {
    let body = "";
    res.on("data", (c) => (body += c));
    res.on("end", () => resolve({ status: res.statusCode, body }));
  }).on("error", reject);
});

test("the server lists sessions and refuses a file outside the projects folder", async (t) => {
  const dir = claudeDir(t);
  const { entries } = fixture();
  write(dir, "projects/-srv-demo/abc.jsonl", entries.map((e) => JSON.stringify({ ...e, cwd: "/srv/demo", sessionId: "abc" })).join("\n") + "\n");
  const child = spawn(process.execPath, [CLI, "serve", "--port", "0", "--claude-dir", dir], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = "";
      child.stdout.on("data", (c) => { out += c; const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(Number(m[1])); });
      child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });
    const list = JSON.parse((await get(port, "/api/sessions")).body);
    assert.equal(list.sessions.length, 1);
    assert.equal(list.sessions[0].cwd, "/srv/demo");
    const file = encodeURIComponent(list.sessions[0].file);
    const session = JSON.parse((await get(port, `/api/session?file=${file}`)).body);
    assert.equal(session.compactions.length, 1);
    const refused = await get(port, `/api/session?file=${encodeURIComponent("/etc/passwd")}`);
    assert.equal(refused.status, 403);
    const page = await get(port, "/");
    assert.match(page.body, /<title>Context Lens<\/title>/);
  } finally {
    child.kill();
  }
});

// The repo's live lane runs `report <transcript> --json` and reads these
// fields; a rename here is a silent zero there.
test("report --json prints the session with the fields its readers depend on", (t) => {
  const dir = claudeDir(t);
  const { entries } = fixture();
  const file = write(dir, "projects/-srv-demo/abc.jsonl", entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const result = runNode(CLI, ["report", file, "--json", "--claude-dir", dir]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  for (const key of ["id", "cwd", "focus", "events", "requests", "segments", "compactions", "turns", "file", "badLines"]) assert.ok(key in report, `report.${key}`);
  assert.equal(report.focus, "agentic-engineering");
  const hook = report.events.find((e) => e.kind === "hook" && e.event === "SessionStart");
  for (const key of ["id", "kind", "event", "hookName", "segment", "phase", "visibility", "text", "tokens", "label", "source"]) assert.ok(key in hook, `event.${key}`);
  assert.deepEqual(Object.keys(hook.source).filter((k) => ["plugin", "focus"].includes(k)).sort(), ["focus", "plugin"]);
  assert.deepEqual(report.requests.map((r) => [r.segment, r.contextTokens]), [[0, 86_000], [1, 21_000]]);
  assert.deepEqual(report.segments.map((s) => [s.index, s.startedBy]), [[0, "startup"], [1, "compact"]]);
  assert.equal(report.compactions[0].fromSegment, 0);

  const text = runNode(CLI, ["report", "abc", "--claude-dir", dir]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^Context Lens: /);
  const missing = runNode(CLI, ["report", "no-such-session", "--claude-dir", dir]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no transcript found for no-such-session/);
});
