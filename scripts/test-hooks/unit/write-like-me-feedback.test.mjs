// write-like-me's feedback detector and its ledger. The detector's answers are
// pinned prompt by prompt: which label a prompt earns and the exact words that
// earned it, since those words are quoted back to the model and kept in the
// ledger. A prompt that earns nothing matters as much as one that does:
// ordinary code review must never be taken for a remark about voice.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PATTERNS, detect, excerpt, stripHarnessNoise } from "../../../plugins/write-like-me/scripts/wlm/feedback.mjs";
import { append, clear, pending } from "../../../plugins/write-like-me/scripts/wlm/observations.mjs";
import { tempDir } from "./helpers.mjs";

// [prompt, label, matched words], or [prompt, null] for a prompt that is not style feedback.
const PINNED = [
  ["this is too formal for a team update", "tone", "too formal"],
  ["Way TOO Wordy, trim it", "tone", "TOO Wordy"],
  ["too salesy", "tone", "too salesy"],
  ["can you be less corporate here", "tone", "less corporate"],
  ["less enthusiastic please", "tone", "less enthusiastic"],
  ["make the intro more conversational", "tone", "more conversational"],
  ["more concise", "tone", "more concise"],
  ["this sounds like AI", "ai-sounding", "sounds like AI"],
  ["It reads like a robot wrote it", "ai-sounding", "reads like a robot"],
  ["feels like an LLM", "ai-sounding", "feels like an LLM"],
  ["sound like chatgpt", "ai-sounding", "sound like chatgpt"],
  ["that looks ai-generated to me", "ai-sounding", "ai-generated"],
  ["very AI sounding", "ai-sounding", "AI sounding"],
  ["ai written", "ai-sounding", "ai written"],
  ["humanize this paragraph", "ai-sounding", "humanize"],
  ["please de-ai the summary", "ai-sounding", "de-ai"],
  ["deai it", "ai-sounding", "deai"],
  ["that's not my voice", "voice", "not my voice"],
  ["this isn't in my style", "voice", "isn't in my style"],
  ["isnt my tone", "voice", "isnt my tone"],
  ["it doesn't sound like me", "voice", "doesn't sound like me"],
  ["doesnt sound like me at all", "voice", "doesnt sound like me"],
  ["I wouldn't say that", "voice", "I wouldn't say"],
  ["i would not phrase it that way", "voice", "i would not phrase it"],
  ["I never write like this", "voice", "I never write"],
  ["i wouldnt say it", "voice", "i wouldnt say"],
  ["make it sound like me", "voice", "make it sound like me"],
  ["have it sound more like me", "voice", "have it sound more like me"],
  ["stop using em-dashes", "style-rule", "stop using em-dashes"],
  ["stop using the word delve", "style-rule", "stop using the word"],
  ["don't use bullet points", "style-rule", "don't use bullet"],
  ["dont use emojis in emails", "style-rule", "dont use emojis"],
  ["never use semicolons", "style-rule", "never use semicolons"],
  ["avoid using headers", "style-rule", "avoid using headers"],
  ["no more using exclamation marks", "style-rule", "no more using exclamation"],
  ["quit writing lists", "style-rule", "quit writing lists"],
  ["avoid saying the phrase circle back", "style-rule", "avoid saying the phrase"],
  ["stop saying \"leverage\"", "style-rule", "stop saying \""],
  ["never say 'synergy'", "style-rule", "never say '"],
  ["don't say \u201crobust\u201d", "style-rule", "don't say \u201c"],
  ["quit saying \u2018seamless\u2019", "style-rule", "quit saying \u2018"],
  ["stop em dashes", "style-rule", "stop em dashes"],
  ["stop using the emdash", "style-rule", "stop using the emdash"],
  ["stop the em-dash", "style-rule", "stop the em-dash"],
  ["fewer bullets please", "style-rule", "fewer bullets"],
  ["fewer headings", "style-rule", "fewer headings"],
  ["make it warmer", "rewrite", "make it warmer"],
  ["make this punchier", "rewrite", "make this punchier"],
  ["make it simpler and shorter", "rewrite", "make it simpler"],
  ["rewrite it in my voice", "rewrite", "rewrite it in my voice"],
  ["rewrite this to sound natural", "rewrite", "rewrite this to sound"],
  ["rewrite that more casually", "rewrite", "rewrite that more"],
  ["this function is too slow", null],
  ["the test is too flaky; make it more robust", null],
  ["stop using global state", null],
  ["don't use var, use const", null],
  ["add more tests", null],
  ["fix the bug in parser.py", null],
  ["rewrite this function in Rust", null],
  ["", null],
  ["   ", null],
  ["too formal and also sounds like ai", "tone", "too formal"],
  ["sounds like ai and too formal", "tone", "too formal"],
  ["<task-notification>the report said the text was too formal</task-notification> carry on", null],
  ["<system-reminder>\nnot my voice\n</system-reminder>\nplease continue", null],
  ["<SYSTEM-REMINDER>too wordy</SYSTEM-REMINDER> ok", null],
  ["<task-notification>too formal</system-reminder> still open", "tone", "too formal"],
  ["<task-notification>a</task-notification> too stiff <system-reminder>b</system-reminder>", "tone", "too stiff"],
  ["line one\n[SYSTEM NOTIFICATION - NOT USER INPUT] the agent said too formal\nline three", null],
  ["prefix [system notification - not user input] too formal", null],
  ["first too casual\n[SYSTEM NOTIFICATION - NOT USER INPUT] x\nlast", "tone", "too casual"],
  ["carriage\r[SYSTEM NOTIFICATION - NOT USER INPUT] too formal\rmore casual", null],
  ["sep\u2028[SYSTEM NOTIFICATION - NOT USER INPUT]\u2028too stiff", null],
  ["\u00e9too formal", null],
  ["too formal\u00e9", null],
  ["TOO FORMAL", "tone", "TOO FORMAL"],
  ["Too\u00a0formal", null],
  ["too  formal", null],
  ["it's tooformal", null],
  ["nottoo formal", null],
  ["9too formal", null],
  ["_too formal", null],
  ["too formal_", null],
  ["\u017ftop using emojis", "style-rule", "\u017ftop using emojis"],
  ["sounds like a bot", "ai-sounding", "sounds like a bot"],
  ["read like an ai", "ai-sounding", "read like an ai"],
  ["sounds like a ai", "ai-sounding", "sounds like a ai"],
  ["more human, less robotic", "tone", "more human"],
  ["less stiff; more direct", "tone", "less stiff"],
  ["don\u2019t use emojis", null],
  ["doesn\u2019t sound like me", null],
  ["never write headers again", "style-rule", "never write headers"],
  ["don't write greetings", "style-rule", "don't write greetings"],
  ["no more using sign-offs", "style-rule", "no more using sign-offs"],
  ["stop using sign offs", "style-rule", "stop using sign offs"],
  ["avoid use the word very", "style-rule", "avoid use the word"],
  ["stop using em dash", "style-rule", "stop using em dash"],
  ["stop using emdashes everywhere", "style-rule", "stop using emdashes"],
  ["never using dashes", "style-rule", "never using dashes"],
  ["make it tighter.", "rewrite", "make it tighter"],
  ["Make This Friendlier!", "rewrite", "Make This Friendlier"],
  ["rewrite it more", "rewrite", "rewrite it more"],
  ["i wouldn't write this. too flowery.", "tone", "too flowery"],
  ["I would n't say this", "voice", "I would n't say"],
  ["i wouldn\u2019t say that", null],
  ["\u{1f600} too chirpy \u{1f600}", "tone", "too chirpy"],
  ["The K sign: too formaL", "tone", "too formaL"],
  ["ai-generated\ntoo formal", "tone", "too formal"],
  ["de-AI", "ai-sounding", "de-AI"],
  ["humanizer", null],
  ["dehumanize", null],
  ["fewer lists and fewer emojis", "style-rule", "fewer lists"],
  ["more natural-sounding", "tone", "more natural"],
  ["more casually", null],
  ["less formality", null],
  ["sounds li\u212ae ai", "ai-sounding", "sounds li\u212ae ai"],
  ["A\u0130 written", "ai-sounding", "A\u0130 written"],
  ["stop using the word \u201cdelve\u201d", "style-rule", "stop using the word"],
  ["too formal\r\n", "tone", "too formal"],
  ["<task-notification>\ntoo formal\n</TASK-NOTIFICATION>\nmore direct", "tone", "more direct"],
];

test("every pinned prompt earns its label and its exact matched words, or nothing", () => {
  assert.ok(PINNED.length > 100, "the table is the detector's contract");
  for (const [prompt, label, phrase] of PINNED) {
    assert.deepEqual(detect(prompt), label ? [label, phrase] : null, JSON.stringify(prompt));
  }
});

test("every pattern is reached by at least one pinned prompt", () => {
  const labels = new Set(PATTERNS.map(([label]) => label));
  assert.deepEqual([...labels], ["tone", "ai-sounding", "voice", "style-rule", "rewrite"]);
  for (const label of labels) assert.ok(PINNED.some((row) => row[1] === label), label);
});

test("the first pattern in the list wins, wherever its words sit in the prompt", () => {
  assert.deepEqual(detect("sounds like ai and too formal"), ["tone", "too formal"]);
  assert.deepEqual(detect("make it warmer, it reads like a bot"), ["ai-sounding", "reads like a bot"]);
});

test("a word boundary counts letters and digits of any alphabet", () => {
  for (const prompt of ["\u00e9too formal", "too formal\u00e9", "9too formal", "too formal_", "\u0434too formal"]) assert.equal(detect(prompt), null, JSON.stringify(prompt));
  assert.deepEqual(detect("\u00bftoo formal?"), ["tone", "too formal"]);
});

test("case is ignored the way every alphabet folds it", () => {
  assert.deepEqual(detect("A\u0130 written"), ["ai-sounding", "A\u0130 written"]);
  assert.deepEqual(detect("a\u0131-generated"), ["ai-sounding", "a\u0131-generated"]);
  assert.deepEqual(detect("\u017ftop using emojis"), ["style-rule", "\u017ftop using emojis"]);
  assert.deepEqual(detect("sounds li\u212ae ai"), ["ai-sounding", "sounds li\u212ae ai"]);
});

test("what the harness injected is taken out before matching", () => {
  assert.equal(stripHarnessNoise("<task-notification>too formal</task-notification> carry on"), " carry on");
  assert.equal(stripHarnessNoise("a <SYSTEM-REMINDER>\nnot my voice\n</system-reminder> b"), "a  b");
  assert.equal(stripHarnessNoise("<task-notification>x</system-reminder> y"), "<task-notification>x</system-reminder> y", "a block closes with its own tag");
  assert.equal(stripHarnessNoise("one\nnote [SYSTEM NOTIFICATION - NOT USER INPUT] too formal\nthree"), "one\n\nthree");
  assert.equal(stripHarnessNoise("[system notification - not user input] x"), "");
});

test("a marker line ends at a line feed and nowhere else", () => {
  assert.equal(stripHarnessNoise("a\r[SYSTEM NOTIFICATION - NOT USER INPUT]\rtoo formal"), "");
  assert.equal(stripHarnessNoise("a\u2028[SYSTEM NOTIFICATION - NOT USER INPUT]\u2028too stiff"), "");
  assert.equal(stripHarnessNoise("too casual\r\n[SYSTEM NOTIFICATION - NOT USER INPUT]\r\nlast"), "too casual\r\n\nlast");
});

test("the excerpt is the person's words, trimmed, at most 300 characters", () => {
  assert.equal(excerpt("  <system-reminder>x</system-reminder>\n  too wordy  \n"), "too wordy");
  assert.equal(excerpt(`too wordy: ${"x".repeat(400)}`).length, 300);
  const faces = excerpt(`too formal ${"\u{1F600}".repeat(400)}`);
  assert.equal(Array.from(faces).length, 300, "counted in characters, so a face is never cut in half");
  assert.equal(faces.codePointAt(faces.length - 2), 0x1f600);
});

// ---- the ledger -------------------------------------------------------------

test("append writes one JSON line per record and stamps it in seconds", (t) => {
  const env = { WLM_HOME: tempDir(t, "wlm-ledger-") };
  const before = Date.now() / 1000;
  append({ session_id: "s1", label: "tone", phrase: "too formal", prompt_excerpt: "too formal \u201creally\u201d" }, env);
  append({ session_id: "", label: "rewrite", phrase: "make it warmer", prompt_excerpt: "make it warmer", ts: 5 }, env);
  const text = fs.readFileSync(path.join(env.WLM_HOME, "observations.jsonl"), "utf8");
  assert.ok(text.endsWith("\n"));
  const [first, second] = text.trimEnd().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(Object.keys(first), ["session_id", "label", "phrase", "prompt_excerpt", "ts"]);
  assert.equal(first.prompt_excerpt, "too formal \u201creally\u201d");
  assert.ok(first.ts >= before && first.ts < before + 60, "seconds since the epoch, not milliseconds");
  assert.equal(second.ts, 5, "a record's own stamp is kept");
  assert.ok(fs.statSync(path.join(env.WLM_HOME, "samples")).isDirectory() && fs.statSync(path.join(env.WLM_HOME, "state")).isDirectory(), "the data home is laid out on first write");
});

test("pending reads a ledger with spaced separators, raw non-ASCII, CRLF endings, and skips what is not a record", (t) => {
  const env = { WLM_HOME: tempDir(t, "wlm-ledger-") };
  assert.deepEqual(pending(env), [], "no ledger, nothing pending");
  fs.writeFileSync(path.join(env.WLM_HOME, "observations.jsonl"), [
    '{"session_id": "s1", "label": "tone", "phrase": "too formal", "prompt_excerpt": "This draft is too formal, and it sounds like AI.", "ts": 1794466073.793261}',
    '{"session_id": "s1", "label": "style-rule", "phrase": "don\'t say \u201c", "prompt_excerpt": "don\'t say \u201crobust\u201d ever", "ts": 1794466073.8376021}\r',
    "",
    "   ",
    "{torn",
    '{"session_id":"s2","label":"rewrite","phrase":"make it warmer","prompt_excerpt":"make it warmer","ts":1794466073.904}',
  ].join("\n") + "\n");
  const records = pending(env);
  assert.deepEqual(records.map((r) => r.label), ["tone", "style-rule", "rewrite"]);
  assert.equal(records[0].ts, 1794466073.793261);
  assert.equal(records[1].phrase, "don't say \u201c");
  clear(env);
  assert.deepEqual(pending(env), []);
  clear(env);
});

test("the ledger refuses to guess a data home", () => {
  assert.throws(() => pending({}), /neither WLM_HOME nor CLAUDE_PLUGIN_DATA/);
  assert.throws(() => append({ label: "tone" }, { WLM_HOME: "", CLAUDE_PLUGIN_DATA: "" }), /neither WLM_HOME nor CLAUDE_PLUGIN_DATA/);
});
