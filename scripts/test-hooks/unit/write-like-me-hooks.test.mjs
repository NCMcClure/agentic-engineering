// write-like-me's three hooks, each run as a host runs it: one payload on
// stdin, stdout and the exit code read back. Every run gets a throwaway home
// and data dir, so the person's own profile and ledger are never read or
// written. What a hook prints is pinned whole, since the model reads it; what
// it leaves on disk is pinned by shape, since the next run reads that.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { hookCommand } from "../../lib.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "write-like-me");
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;

const NUDGE = "write-like-me: no writing profile found. Run /write-like-me:calibrate once to teach Claude your voice.";
const HONOR = (phrase) => `write-like-me: the user just gave style feedback about your prose ("${phrase}"). Honor it in this response, and treat it as a durable preference about their voice, not a one-off. It has been recorded and will be folded into their writing profile.`;
// Seconds since the epoch with a fraction, the one format a stamp file holds.
const STAMP = /^\d{10}(\.\d+)?$/;
// A ledger line as a data dir may hold it: spaced separators, non-ASCII kept as typed.
const LEDGER_LINE = '{"session_id": "s1", "label": "tone", "phrase": "too formal", "prompt_excerpt": "too formal \u201creally\u201d", "ts": 1700000000.123456}\n';

/** A throwaway home and data dir, and a way to run a hook against them. */
function person(t) {
  const home = tempDir(t, "wlm-home-");
  const data = path.join(home, "data");
  const run = (script, payload, env = {}) => {
    const out = runNode(path.join(PLUGIN, "hooks", script), [], {
      cwd: home,
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      env: { ...process.env, HOME: home, USERPROFILE: home, WLM_HOME: data, WLM_PROFILE: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_PROJECT_DIR: "", ...env },
    });
    return { ...out, parsed: out.stdout.trim() ? JSON.parse(out.stdout) : null };
  };
  const state = (name) => path.join(data, "state", name);
  const files = () => (fs.existsSync(data) ? fs.readdirSync(data, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(data, f)).isFile()).map((f) => f.split(path.sep).join("/")).sort() : []);
  return { home, data, run, state, files, profile: path.join(home, ".claude", "rules", "write-like-me.md") };
}

const quiet = (out, what) => {
  assert.equal(out.status, 0, what);
  assert.equal(out.stdout, "", what);
  assert.equal(out.stderr, "", what);
};

// ---- what is registered -----------------------------------------------------

test("hooks.json registers the three hooks behind the Node guard, the session hook for every kind of start", () => {
  assert.deepEqual(Object.keys(HOOKS).sort(), ["SessionStart", "Stop", "UserPromptSubmit"]);
  const [start] = HOOKS.SessionStart;
  assert.equal(start.matcher, "startup|resume|clear|compact");
  assert.equal(start.hooks[0].command, hookCommand("write-like-me", "hooks/session-start.mjs", { loud: true }));
  assert.ok(start.hooks[0].statusMessage);
  assert.equal(HOOKS.UserPromptSubmit[0].hooks[0].command, hookCommand("write-like-me", "hooks/prompt-submit.mjs"));
  assert.equal(HOOKS.Stop[0].hooks[0].command, hookCommand("write-like-me", "hooks/stop.mjs"));
  for (const event of Object.keys(HOOKS)) assert.equal(HOOKS[event].length, 1, `${event} runs one hook`);
});

test("the plugin ships no Python and no shell", () => {
  const stray = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => /\.(py|pyc|sh|bash)$/.test(f));
  assert.deepEqual(stray, []);
});

// ---- SessionStart: the calibrate nudge --------------------------------------

test("session start with no profile nudges the person once, then stays quiet for a day", (t) => {
  const p = person(t);
  const first = p.run("session-start.mjs", { hook_event_name: "SessionStart", source: "startup", session_id: "s1" });
  assert.equal(first.status, 0);
  assert.deepEqual(first.parsed, { systemMessage: NUDGE });
  assert.match(fs.readFileSync(p.state("last-nudge"), "utf8"), STAMP);
  assert.ok(fs.statSync(path.join(p.data, "samples")).isDirectory(), "the data home is laid out");
  for (const source of ["resume", "clear", "compact"]) quiet(p.run("session-start.mjs", { hook_event_name: "SessionStart", source, session_id: "s1" }), source);
});

test("session start nudges again once the last nudge is a day old, and when its stamp is unreadable", (t) => {
  for (const stamp of [String(Date.now() / 1000 - 90000), `${Math.floor(Date.now() / 1000) - 90000}.4196968`, "soon\n", ""]) {
    const p = person(t);
    write(p.data, "state/last-nudge", stamp);
    assert.deepEqual(p.run("session-start.mjs", { source: "startup" }).parsed, { systemMessage: NUDGE }, JSON.stringify(stamp));
    assert.match(fs.readFileSync(p.state("last-nudge"), "utf8"), STAMP);
  }
});

test("session start honors a recent stamp written with a seven-digit fraction", (t) => {
  const p = person(t);
  write(p.data, "state/last-nudge", `${Math.floor(Date.now() / 1000) - 600}.4196968`);
  quiet(p.run("session-start.mjs", { source: "startup" }), "ten minutes ago is not a day ago");
});

test("session start says nothing when a profile exists, at the default path or the overridden one", (t) => {
  const p = person(t);
  write(p.home, ".claude/rules/write-like-me.md", "# Writing profile\n");
  quiet(p.run("session-start.mjs", { source: "startup" }), "default path");
  assert.deepEqual(p.files(), [], "and it leaves the data dir alone");

  const q = person(t);
  const elsewhere = write(q.home, "voice.md", "# Writing profile\n");
  quiet(q.run("session-start.mjs", { source: "startup" }, { WLM_PROFILE: elsewhere }), "WLM_PROFILE");
});

test("session start falls back to CLAUDE_PLUGIN_DATA, and is silent when there is no data home at all", (t) => {
  const p = person(t);
  const out = p.run("session-start.mjs", { source: "startup" }, { WLM_HOME: "", CLAUDE_PLUGIN_DATA: path.join(p.home, "plugin-data") });
  assert.deepEqual(out.parsed, { systemMessage: NUDGE });
  assert.ok(fs.existsSync(path.join(p.home, "plugin-data", "state", "last-nudge")));
  quiet(p.run("session-start.mjs", { source: "startup" }, { WLM_HOME: "", CLAUDE_PLUGIN_DATA: "" }), "no data home");
});

test("session start is silent on stdin it cannot read, and writes nothing", (t) => {
  const p = person(t);
  for (const stdin of ["", "   ", "{not json", "[1,2]", "null", '"text"']) quiet(p.run("session-start.mjs", stdin), JSON.stringify(stdin));
  assert.deepEqual(p.files(), []);
});

// ---- UserPromptSubmit: record the feedback, tell the model ------------------

test("a prompt with style feedback is recorded and the model is told to honor it", (t) => {
  const p = person(t);
  const out = p.run("prompt-submit.mjs", { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: "This draft is too formal, and it sounds like AI." });
  assert.equal(out.status, 0);
  assert.deepEqual(out.parsed, { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: HONOR("too formal") } });

  const quoted = p.run("prompt-submit.mjs", { session_id: "s1", prompt: "<system-reminder>too wordy</system-reminder>\n  don't say \u201crobust\u201d ever  " });
  assert.deepEqual(quoted.parsed, { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: HONOR("don't say \u201c") } });

  const anonymous = p.run("prompt-submit.mjs", { prompt: "make it warmer" });
  assert.equal(anonymous.parsed.hookSpecificOutput.additionalContext, HONOR("make it warmer"));

  const records = fs.readFileSync(path.join(p.data, "observations.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const now = Date.now() / 1000;
  for (const r of records) assert.ok(r.ts > now - 60 && r.ts <= now + 1, "stamped in seconds");
  assert.deepEqual(records.map(({ ts, ...rest }) => rest), [
    { session_id: "s1", label: "tone", phrase: "too formal", prompt_excerpt: "This draft is too formal, and it sounds like AI." },
    { session_id: "s1", label: "style-rule", phrase: "don't say \u201c", prompt_excerpt: "don't say \u201crobust\u201d ever" },
    { session_id: "", label: "rewrite", phrase: "make it warmer", prompt_excerpt: "make it warmer" },
  ]);
});

test("a prompt without style feedback is left alone", (t) => {
  const p = person(t);
  for (const prompt of ["fix the failing test", "this function is too slow", "<task-notification>the summary was too formal</task-notification> continue", ""]) {
    quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt }), JSON.stringify(prompt));
  }
  quiet(p.run("prompt-submit.mjs", { session_id: "s1" }), "no prompt");
  quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt: 5 }), "a prompt that is not text");
  assert.deepEqual(p.files(), []);
});

test("the prompt hook is silent on stdin it cannot read, and when the feedback has nowhere to go", (t) => {
  const p = person(t);
  for (const stdin of ["", "{not json", "[1,2]", "null"]) quiet(p.run("prompt-submit.mjs", stdin), JSON.stringify(stdin));
  quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt: "too formal" }, { WLM_HOME: "", CLAUDE_PLUGIN_DATA: "" }), "no data home: nothing recorded, so nothing promised");
  assert.deepEqual(p.files(), []);
});

// ---- Stop: fold pending feedback into the profile ---------------------------

const stop = (sessionId, extra = {}) => ({ hook_event_name: "Stop", session_id: sessionId, stop_hook_active: false, ...extra });
const DIRECTIVE = /^Create a forked subagent with 'sonnet' model\. Subagent initial message is: 'Read & execute writing-profile refinement rules: (.+)\. Profile: (.+)\. Data dir: (.+)\.'$/;
/** The block the model reads: the fixed sentence, and the three paths it needs, each absolute. */
function assertDirective(parsed, p, profile = p.profile) {
  assert.deepEqual(Object.keys(parsed ?? {}), ["decision", "reason"]);
  assert.equal(parsed.decision, "block");
  const [, rules, namedProfile, dataDir] = DIRECTIVE.exec(parsed.reason) ?? assert.fail(parsed.reason);
  assert.equal(fs.realpathSync.native(rules), fs.realpathSync.native(path.join(PLUGIN, "hooks", "refine-profile.md")), "the rules file that ships with the plugin");
  assert.equal(namedProfile, profile);
  assert.equal(dataDir, p.data);
}

test("stop with pending feedback hands the model the refinement, as a block it reads", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  const out = p.run("stop.mjs", stop("s1"));
  assert.equal(out.status, 0);
  assert.equal(out.stderr, "");
  assertDirective(out.parsed, p);
  assert.deepEqual(p.files(), ["observations.jsonl", "state/last-refined", "state/refine-fired-s1"]);
  assert.match(fs.readFileSync(p.state("last-refined"), "utf8"), STAMP);
  assert.equal(fs.readFileSync(p.state("refine-fired-s1"), "utf8"), fs.readFileSync(p.state("last-refined"), "utf8"));
  assert.equal(fs.readFileSync(path.join(p.data, "observations.jsonl"), "utf8"), LEDGER_LINE, "the ledger is the subagent's to clear");
});

test("stop fires once per session, and not again in any session for an hour", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  assert.ok(p.run("stop.mjs", stop("s1")).parsed);
  quiet(p.run("stop.mjs", stop("s1")), "same session");
  quiet(p.run("stop.mjs", stop("s2")), "another session inside the cooldown");
  assert.deepEqual(p.files(), ["observations.jsonl", "state/last-refined", "state/refine-fired-s1"]);

  // Past the cooldown the same session is still held by its own flag.
  fs.writeFileSync(p.state("last-refined"), String(Date.now() / 1000 - 4000));
  quiet(p.run("stop.mjs", stop("s1")), "same session after the cooldown");
  assertDirective(p.run("stop.mjs", stop("s2")).parsed, p);
});

test("stop never re-enters the turn it caused", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  quiet(p.run("stop.mjs", stop("s1", { stop_hook_active: true })), "stop_hook_active");
  assert.deepEqual(p.files(), ["observations.jsonl"], "and it stamps nothing");
});

test("stop is quiet when learning is paused, and when nothing readable is pending", (t) => {
  const paused = person(t);
  write(paused.data, "observations.jsonl", LEDGER_LINE);
  write(paused.data, "state/refine-disabled", "");
  quiet(paused.run("stop.mjs", stop("s1")), "refine-disabled");

  const empty = person(t);
  quiet(empty.run("stop.mjs", stop("s1")), "no ledger");
  assert.deepEqual(empty.files(), []);

  const torn = person(t);
  write(torn.data, "observations.jsonl", "\n  \n{broken\n");
  quiet(torn.run("stop.mjs", stop("s1")), "blank and unparseable lines only");
  assert.deepEqual(torn.files(), ["observations.jsonl"]);
});

test("stop reads a cooldown stamp with a long fraction, and sweeps the flags of sessions a day gone", (t) => {
  const recent = person(t);
  write(recent.data, "observations.jsonl", LEDGER_LINE);
  write(recent.data, "state/last-refined", `${Math.floor(Date.now() / 1000) - 600}.3645241`);
  quiet(recent.run("stop.mjs", stop("s9")), "ten minutes into the cooldown");

  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  write(p.data, "state/last-refined", `${Math.floor(Date.now() / 1000) - 4000}.570105`);
  write(p.data, "state/refine-fired-old", "1");
  write(p.data, "state/refine-fired-recent", "1");
  const dayAgo = new Date(Date.now() - 90_000_000);
  fs.utimesSync(p.state("refine-fired-old"), dayAgo, dayAgo);
  assertDirective(p.run("stop.mjs", stop("s3")).parsed, p);
  assert.deepEqual(p.files(), ["observations.jsonl", "state/last-refined", "state/refine-fired-recent", "state/refine-fired-s3"]);
});

test("stop names the overridden profile, and files a session without an id under one flag", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  const elsewhere = path.join(p.home, "elsewhere", "voice.md");
  assertDirective(p.run("stop.mjs", { hook_event_name: "Stop" }, { WLM_PROFILE: elsewhere }).parsed, p, elsewhere);
  assert.ok(fs.existsSync(p.state("refine-fired-unknown")));
});

test("a session id cannot place its flag outside the state folder", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  assert.ok(p.run("stop.mjs", stop("../../escaped")).parsed);
  assert.deepEqual(p.files(), ["observations.jsonl", "state/last-refined", "state/refine-fired-.._.._escaped"]);
  assert.deepEqual(fs.readdirSync(p.home).sort(), ["data"]);
});

test("stop is silent on stdin it cannot read and without a data home, pending feedback or not", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  for (const stdin of ["", "{not json", "[1,2]", "null"]) quiet(p.run("stop.mjs", stdin), JSON.stringify(stdin));
  quiet(p.run("stop.mjs", stop("s1"), { WLM_HOME: "", CLAUDE_PLUGIN_DATA: "" }), "no data home");
  assert.deepEqual(p.files(), ["observations.jsonl"]);
});

// ---- the whole loop ---------------------------------------------------------

test("feedback given in a prompt is what the next stop acts on", (t) => {
  const p = person(t);
  quiet(p.run("stop.mjs", stop("s1")), "nothing said yet");
  assert.ok(p.run("prompt-submit.mjs", { session_id: "s1", prompt: "stop using em-dashes" }).parsed);
  assertDirective(p.run("stop.mjs", stop("s1")).parsed, p);
});
