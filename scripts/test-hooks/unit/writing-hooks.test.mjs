// writing's two hooks, each run as a host runs it: one payload on
// stdin, stdout and the exit code read back. Every run gets a throwaway home
// and data dir, so the person's own profile and ledger are never read or
// written. What a hook prints is pinned whole, since the model reads it; what
// it leaves on disk is pinned by shape, since the next run reads that.
//
// The area ships in a plugin every session loads, so the first thing pinned is
// what a person who never built a writing profile gets from it: nothing, and
// no file anywhere.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const ROOT = path.join(REPO, "plugins", "agentic-engineering");
const PLUGIN = path.join(ROOT, "skills", "writing");
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8")).hooks;

const HONOR = (phrase) => `writing: the user just gave style feedback about your prose ("${phrase}"). Honor it in this response, and treat it as a durable preference about their voice, not a one-off. It has been recorded and will be folded into their writing profile.`;
// Seconds since the epoch with a fraction, the one format a stamp file holds.
const STAMP = /^\d{10}(\.\d+)?$/;
// A ledger line as a data dir may hold it: spaced separators, non-ASCII kept as typed.
const LEDGER_LINE = '{"session_id": "s1", "label": "tone", "phrase": "too formal", "prompt_excerpt": "too formal “really”", "ts": 1700000000.123456}\n';
const FEEDBACK = "This draft is too formal, and it sounds like AI.";

/** Every file under `dir`, with forward slashes. */
const filesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => f.split(path.sep).join("/")).sort() : []);

/** A throwaway home and data dir, and a way to run a hook against them. The person has a writing profile unless `profile` is false. */
function person(t, { profile = true } = {}) {
  const home = tempDir(t, "wlm-home-");
  const data = path.join(home, "data");
  if (profile) write(home, ".claude/rules/write-like-me.md", "# Writing profile\n");
  const run = (script, payload, env = {}) => {
    const out = runNode(path.join(PLUGIN, "hooks", script), [], {
      cwd: home,
      input: typeof payload === "string" ? payload : JSON.stringify(payload),
      env: { ...process.env, HOME: home, USERPROFILE: home, WLM_HOME: data, WLM_PROFILE: "", CLAUDE_PLUGIN_DATA: "", CLAUDE_PROJECT_DIR: "", ...env },
    });
    return { ...out, parsed: out.stdout.trim() ? JSON.parse(out.stdout) : null };
  };
  const state = (name) => path.join(data, "state", name);
  // The host's data directories: the plugin's, in which the area has a folder, and the one the area had as a plugin of its own.
  const plugins = path.join(home, "plugins", "data");
  const hosted = {
    home: path.join(plugins, "agentic-engineering-agentic-engineering", "writing"),
    former: path.join(plugins, "write-like-me-agentic-engineering"),
    env: { WLM_HOME: "", CLAUDE_PLUGIN_DATA: path.join(plugins, "agentic-engineering-agentic-engineering") },
  };
  return { home, data, run, state, files: () => filesIn(data), profile: path.join(home, ".claude", "rules", "write-like-me.md"), hosted };
}

const quiet = (out, what) => {
  assert.equal(out.status, 0, what);
  assert.equal(out.stdout, "", what);
  assert.equal(out.stderr, "", what);
};

// ---- what is registered -----------------------------------------------------

test("the plugin's hooks.json runs the prompt hook and the stop hook once each, and every hook of this area it names is shipped", () => {
  const mine = Object.entries(HOOKS).flatMap(([event, groups]) => groups.flatMap((group) => group.hooks.map((hook) => [event, /skills\/writing\/hooks\/([\w-]+\.mjs)/.exec(hook.command)?.[1]])))
    .filter(([, script]) => script);
  for (const [, script] of mine) assert.ok(fs.existsSync(path.join(PLUGIN, "hooks", script)), script);
  const on = (event) => mine.filter(([e]) => e === event).map(([, script]) => script);
  assert.deepEqual(on("UserPromptSubmit"), ["prompt-submit.mjs"]);
  assert.deepEqual(on("Stop"), ["stop.mjs"]);
  // The area has nothing to say at session start: the profile is a rules file the host loads, and a person
  // without one is offered the calibration by the entry skill. So it registers nothing there, and ships no hook for it.
  assert.deepEqual(on("SessionStart"), []);
  assert.deepEqual(mine.map(([event]) => event).sort(), ["Stop", "UserPromptSubmit"]);
  assert.equal(fs.existsSync(path.join(PLUGIN, "hooks", "session-start.mjs")), false);
});

test("the plugin ships no Python and no shell", () => {
  const stray = fs.readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => /\.(py|pyc|sh|bash)$/.test(f));
  assert.deepEqual(stray, []);
});

// ---- a person with no writing profile: nothing, from either hook -----------

test("without a writing profile no hook says anything or leaves a file, whatever the session does", (t) => {
  const p = person(t, { profile: false });
  quiet(p.run("prompt-submit.mjs", { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: FEEDBACK }), "style feedback in a prompt");
  quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt: "fix the failing test" }), "an ordinary prompt");
  quiet(p.run("stop.mjs", { hook_event_name: "Stop", session_id: "s1", stop_hook_active: false }), "stop");
  assert.deepEqual(fs.readdirSync(p.home), [], "no data home, no stamp, no ledger");

  // Through the plugin's own data directory it is the same: the area's folder in it is never made.
  for (const [script, payload] of [["prompt-submit.mjs", { session_id: "s1", prompt: FEEDBACK }], ["stop.mjs", { session_id: "s1" }]]) {
    quiet(p.run(script, payload, p.hosted.env), `${script}, the plugin's data dir`);
  }
  assert.deepEqual(fs.readdirSync(p.home), []);
});

test("without a writing profile a ledger that is waiting stays as it is, in this data home and in the old plugin's", (t) => {
  const p = person(t, { profile: false });
  write(p.data, "observations.jsonl", LEDGER_LINE);
  quiet(p.run("stop.mjs", { hook_event_name: "Stop", session_id: "s1", stop_hook_active: false }), "pending feedback, no profile");
  quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt: FEEDBACK }), "more feedback, no profile");
  assert.deepEqual(p.files(), ["observations.jsonl"], "no state folder, no stamp");
  assert.equal(fs.readFileSync(path.join(p.data, "observations.jsonl"), "utf8"), LEDGER_LINE);

  // What the area kept as a plugin of its own is not copied for a person with no profile.
  write(p.hosted.former, "observations.jsonl", LEDGER_LINE);
  for (const [script, payload] of [["prompt-submit.mjs", { session_id: "s1", prompt: FEEDBACK }], ["stop.mjs", { session_id: "s1" }]]) {
    quiet(p.run(script, payload, p.hosted.env), `${script}, a former ledger`);
  }
  assert.equal(fs.existsSync(path.dirname(p.hosted.home)), false, "the plugin's data dir is not made");
  assert.deepEqual(filesIn(p.hosted.former), ["observations.jsonl"]);
});

test("a profile at the overridden path counts, and one at the default path does not when the override names another", (t) => {
  const p = person(t, { profile: false });
  const elsewhere = write(p.home, "voice.md", "# Writing profile\n");
  const out = p.run("prompt-submit.mjs", { session_id: "s1", prompt: FEEDBACK }, { WLM_PROFILE: elsewhere });
  assert.equal(out.parsed.hookSpecificOutput.additionalContext, HONOR("too formal"));

  const q = person(t);
  quiet(q.run("prompt-submit.mjs", { session_id: "s1", prompt: FEEDBACK }, { WLM_PROFILE: path.join(q.home, "no-such-profile.md") }), "WLM_PROFILE names a file that is not there");
  assert.deepEqual(q.files(), []);
});

// ---- UserPromptSubmit: record the feedback, tell the model ------------------

test("a prompt with style feedback is recorded and the model is told to honor it", (t) => {
  const p = person(t);
  const out = p.run("prompt-submit.mjs", { hook_event_name: "UserPromptSubmit", session_id: "s1", prompt: FEEDBACK });
  assert.equal(out.status, 0);
  assert.deepEqual(out.parsed, { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: HONOR("too formal") } });

  const quoted = p.run("prompt-submit.mjs", { session_id: "s1", prompt: "<system-reminder>too wordy</system-reminder>\n  don't say “robust” ever  " });
  assert.deepEqual(quoted.parsed, { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: HONOR("don't say “") } });

  const anonymous = p.run("prompt-submit.mjs", { prompt: "make it warmer" });
  assert.equal(anonymous.parsed.hookSpecificOutput.additionalContext, HONOR("make it warmer"));

  const records = fs.readFileSync(path.join(p.data, "observations.jsonl"), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
  const now = Date.now() / 1000;
  for (const r of records) assert.ok(r.ts > now - 60 && r.ts <= now + 1, "stamped in seconds");
  assert.deepEqual(records.map(({ ts, ...rest }) => rest), [
    { session_id: "s1", label: "tone", phrase: "too formal", prompt_excerpt: FEEDBACK },
    { session_id: "s1", label: "style-rule", phrase: "don't say “", prompt_excerpt: "don't say “robust” ever" },
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

test("with no WLM_HOME the ledger is in the area's folder of the plugin's data directory", (t) => {
  const p = person(t);
  // A prompt with no feedback in it makes no folder there: with no old plugin's directory there is nothing to bring across.
  quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt: "fix the failing test" }, p.hosted.env), "an ordinary prompt");
  assert.deepEqual(fs.readdirSync(p.home), [".claude"]);
  const out = p.run("prompt-submit.mjs", { session_id: "s1", prompt: FEEDBACK }, p.hosted.env);
  assert.equal(out.stderr, "");
  assert.equal(out.parsed.hookSpecificOutput.additionalContext, HONOR("too formal"));
  assert.deepEqual(filesIn(p.hosted.home), ["observations.jsonl"]);
  // With no old plugin's directory beside it there was nothing to copy, and none is made.
  assert.deepEqual(fs.readdirSync(path.join(p.home, "plugins", "data")), ["agentic-engineering-agentic-engineering"]);
  assert.deepEqual(fs.readdirSync(path.dirname(p.hosted.home)), ["writing"], "the plugin's directory holds this area's folder and no loose file");
});

// ---- Stop: fold pending feedback into the profile ---------------------------

const stop = (sessionId, extra = {}) => ({ hook_event_name: "Stop", session_id: sessionId, stop_hook_active: false, ...extra });
const DIRECTIVE = /^Create a forked subagent with 'sonnet' model\. Subagent initial message is: 'Read & execute writing-profile refinement rules: (.+)\. Profile: (.+)\. Data dir: (.+)\.'$/;
/** The block the model reads: the fixed sentence, and the three paths it needs, each absolute. */
function assertDirective(parsed, p, profile = p.profile, data = p.data) {
  assert.deepEqual(Object.keys(parsed ?? {}), ["decision", "reason"]);
  assert.equal(parsed.decision, "block");
  const [, rules, namedProfile, dataDir] = DIRECTIVE.exec(parsed.reason) ?? assert.fail(parsed.reason);
  assert.equal(fs.realpathSync.native(rules), fs.realpathSync.native(path.join(PLUGIN, "hooks", "refine-profile.md")), "the rules file that ships with the plugin");
  assert.equal(namedProfile, profile);
  assert.equal(dataDir, data);
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
  const p = person(t, { profile: false });
  write(p.data, "observations.jsonl", LEDGER_LINE);
  const elsewhere = write(p.home, "elsewhere/voice.md", "# Writing profile\n");
  assertDirective(p.run("stop.mjs", { hook_event_name: "Stop" }, { WLM_PROFILE: elsewhere }).parsed, p, elsewhere);
  assert.ok(fs.existsSync(p.state("refine-fired-unknown")));
});

test("a session id cannot place its flag outside the state folder", (t) => {
  const p = person(t);
  write(p.data, "observations.jsonl", LEDGER_LINE);
  assert.ok(p.run("stop.mjs", stop("../../escaped")).parsed);
  assert.deepEqual(p.files(), ["observations.jsonl", "state/last-refined", "state/refine-fired-.._.._escaped"]);
  assert.deepEqual(fs.readdirSync(p.home).sort(), [".claude", "data"]);
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

// ---- what the area kept as a plugin of its own ------------------------------

test("the ledger, samples and changelog the old plugin kept are copied in once, and the old directory is left as it was", (t) => {
  const p = person(t);
  const { home, former, env } = p.hosted;
  write(former, "observations.jsonl", LEDGER_LINE);
  write(former, "changelog.md", "# Profile changes\n");
  write(former, "samples/emails/one.md", "a sample\n");
  write(former, "state/last-refined", "1700000000.5");
  const kept = ["changelog.md", "observations.jsonl", "samples/emails/one.md", "state/last-refined"];

  // The first prompt, whatever it asks, brings the old plugin's data across before its turn starts, and says nothing of it.
  quiet(p.run("prompt-submit.mjs", { session_id: "s1", prompt: "fix the failing test" }, env), "an ordinary prompt");
  assert.deepEqual(filesIn(home), kept);
  assert.deepEqual(filesIn(former), kept, "copied, not moved");

  // The stop that follows finds that feedback pending, and says only what it always says.
  const out = p.run("stop.mjs", stop("s1"), env);
  assert.equal(out.stderr, "");
  assertDirective(out.parsed, p, p.profile, home);
  assert.deepEqual(filesIn(home), [...kept, "state/refine-fired-s1"]);
  assert.equal(fs.readFileSync(path.join(home, "observations.jsonl"), "utf8"), LEDGER_LINE);
  assert.equal(fs.readFileSync(path.join(home, "samples", "emails", "one.md"), "utf8"), "a sample\n");
  assert.deepEqual(filesIn(former), kept, "copied, not moved");
  assert.equal(fs.readFileSync(path.join(former, "state", "last-refined"), "utf8"), "1700000000.5", "and the old plugin's stamps are its own still");

  // The old plugin, still installed, goes on writing to its own directory: none of that is brought across, and nothing here is overwritten.
  fs.writeFileSync(path.join(former, "observations.jsonl"), "{broken\n");
  write(former, "samples/emails/two.md", "written since\n");
  const next = p.run("prompt-submit.mjs", { session_id: "s2", prompt: "make it warmer" }, env);
  assert.equal(next.parsed.hookSpecificOutput.additionalContext, HONOR("make it warmer"));
  const ledger = fs.readFileSync(path.join(home, "observations.jsonl"), "utf8");
  assert.ok(ledger.startsWith(LEDGER_LINE), "the copied line is still first");
  assert.deepEqual(ledger.trimEnd().split("\n").map((line) => JSON.parse(line).phrase), ["too formal", "make it warmer"]);
  assert.deepEqual(filesIn(home), [...kept, "state/refine-fired-s1"]);
});

test("WLM_HOME is the person's own choice of data home: nothing is copied into it", (t) => {
  const p = person(t);
  write(p.hosted.former, "observations.jsonl", LEDGER_LINE);
  quiet(p.run("stop.mjs", stop("s1"), { CLAUDE_PLUGIN_DATA: p.hosted.env.CLAUDE_PLUGIN_DATA }), "nothing pending in WLM_HOME");
  assert.deepEqual(p.files(), []);
  assert.equal(fs.existsSync(path.dirname(p.hosted.home)), false);
});
