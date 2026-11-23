#!/usr/bin/env node
// aw learn: learnings shared across the projects of this machine. One Markdown
// file per learning, <store>/learnings/<id>-<slug>.md, with frontmatter: id,
// topic, tags, source, created, updated, and retired and reason once it no
// longer holds.
import fs from "node:fs";
import path from "node:path";
import { AwError, emit, intArg, ioOf, parseArgs, parseFrontmatter, readStdin, readText, runMain, splitLines, today } from "../../lib/common.mjs";
import * as store from "./store.mjs";

/** A topic is the line a search prints: one line, and short enough to scan. */
export const TOPIC_CHARS = 120;

const USAGE = `usage: aw learn <add|search|show|list|edit|retire> ...

Learnings shared across the projects of this machine: what one project found out that the next one would pay for.

  aw learn add --topic "<one line>" --tags a,b (--text "..." | --from-file F)      F may be - for stdin
  aw learn search <terms...> [--tag t] [--limit N] [--all] [--json]
  aw learn show ID          aw learn list [--tag t] [--all] [--json]
  aw learn edit ID [--topic ...] [--tags ...] [--text ... | --from-file F]
  aw learn retire ID [--reason "..."]

What belongs here: facts about the machine, a tool, an operating system, an engine or a library that hold whatever
the project is (a compiler that runs out of memory at a certain job count, a shell that mangles a path, an API that
lies). What does not: anything about one project's code, design or decisions (that is the project's own memory), and
never secrets or proprietary content: every project on the machine reads this store. A learning that looks like it
holds a credential is refused.

Limits: --topic is one line of at most ${TOPIC_CHARS} characters; the body holds at most coordination.learningChars (6000).

One Markdown file per learning in <store>/learnings, with frontmatter: id, topic, tags, source (the project it came
from), created, updated, and retired once it no longer holds. Search ranks a term found in the topic above one found
in the tags above one found in the body. Exit codes: 0 done (search: something found), 1 nothing found, 2 usage or
refused.

Options:
  --topic TEXT     one line that says what was learned (${TOPIC_CHARS} characters at most)
  --tags a,b       comma-separated: the tool, the platform, the kind of trap
  --text TEXT      the learning itself: the fact, how it was established, how to apply it
  --from-file F    read the body from a file (- for stdin)
  --tag T          search, list: only learnings with this tag
  --limit N        search: at most this many (default 10)
  --all            search, list: also retired ones
  --reason TEXT    retire: why it no longer holds
  --json           print one JSON document`;

// What a credential tends to look like. A refusal names the kind and the line, never the text.
const SECRETS = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an access key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a hosting token", /\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bglpat-[A-Za-z0-9_-]{16,}/],
  ["an API key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["a chat token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["a bearer token", /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
  ["a credential in a URL", /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/],
  ["a password or secret written out",
    /\b(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"]?[^\s'"<>{}$]{8,}/i],
];
const WORD = /[a-z0-9][a-z0-9_.+#-]*/g;

/** The folder the learnings live in. */
export const folder = (home) => path.join(home, "learnings");

/** What looks like a credential in a text, as "kind (line N)": the first kind found on each line. */
export function secretsIn(text) {
  const found = [];
  splitLines(String(text)).forEach((line, i) => {
    const hit = SECRETS.find(([, pattern]) => pattern.test(line));
    if (hit) found.push(`${hit[0]} (line ${i + 1})`);
  });
  return found;
}

function tagsOf(text) {
  const raw = Array.isArray(text) ? text.join(",") : String(text ?? "");
  const seen = [];
  for (const part of raw.toLowerCase().split(/[,\s]+/)) {
    const tag = part.replace(/[^a-z0-9_.+#-]/g, "");
    if (tag && !seen.includes(tag)) seen.push(tag);
  }
  return seen;
}

const slug = (topic) => topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/^-+|-+$/g, "") || "learning";

function render(fields, body) {
  const lines = ["---"];
  for (const key of ["id", "topic", "tags", "source", "created", "updated", "retired", "reason"]) {
    let value = fields[key];
    if (value === null || value === undefined || value === "") continue;
    if (key === "tags") value = `[${value.join(", ")}]`;
    else if (["topic", "reason", "source"].includes(key) && ("\"'[".includes(String(value)[0]) || String(value).trim() !== String(value))) {
      value = `"${String(value).replaceAll('"', "'")}"`;
    }
    lines.push(`${key}: ${value}`);
  }
  return `${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

function load(file) {
  const text = readText(file);
  if (text === null) return null;
  const [fields, body] = parseFrontmatter(text);
  if (!fields || !fields.id) return null;
  return { ...fields, id: String(fields.id), topic: String(fields.topic || ""), tags: tagsOf(fields.tags), body: body.trim(), file: path.basename(file) };
}

/** Every learning in the store, by file name; retired ones only with `includeRetired`. */
export function every(home, includeRetired = false) {
  let names;
  try { names = fs.readdirSync(folder(home)).filter((n) => n.endsWith(".md")).sort(); } catch { return []; }
  return names.map((n) => load(path.join(folder(home), n))).filter((r) => r && (includeRetired || !r.retired));
}

function normId(text) {
  const digits = String(text).replace(/\D/g, "");
  return digits ? String(Number(digits)).padStart(4, "0") : "";
}

function find(home, ident) {
  const want = normId(ident);
  const hit = want ? every(home, true).find((r) => r.id === want) : null;
  if (!hit) throw new AwError(`learn: no learning '${ident}' (aw learn list shows them)`);
  return hit;
}

function check(topicGiven, body, limit) {
  const topic = topicGiven.trim();
  const chars = [...topic].length;
  if (!topic || topic.includes("\n")) throw new AwError(`learn: --topic is one line of at most ${TOPIC_CHARS} characters that says what was learned`);
  if (chars > TOPIC_CHARS) {
    throw new AwError(`learn: --topic is ${chars} characters, and a topic is one line of at most ${TOPIC_CHARS}: `
      + "say what was learned; the evidence and the detail go in the body");
  }
  if (!body.trim()) throw new AwError("learn: an empty learning: give the body with --text or --from-file (- reads stdin)");
  if ([...body].length > limit) {
    throw new AwError(`learn: ${[...body].length} characters, and a learning holds at most ${store.g(limit)} `
      + "(coordination.learningChars). Keep the fact, the evidence and how to apply it; leave the story out.");
  }
  const found = secretsIn(`${topic}\n${body}`);
  if (found.length) {
    throw new AwError(`learn: refused, this looks like it holds ${found.slice(0, 5).join("; ")}. Every project on `
      + "this machine reads shared learnings: write the lesson without the value.");
  }
}

// One writer at a time picks the next id or rewrites a learning.
const locked = (home, fn) => store.withFileLock(path.join(folder(home), "index"), fn);

/** Publish a learning: checked (one-line topic, size, nothing that looks like a credential), numbered, written. Gives its fields and `file`. */
export function add(home, { topic, tags = [], body, source, limit = store.SETTINGS.learningChars }) {
  check(topic, body, limit);
  fs.mkdirSync(folder(home), { recursive: true });
  return locked(home, () => {
    const ids = every(home, true).filter((r) => /^\d+$/.test(r.id)).map((r) => Number(r.id));
    const day = today();
    const fields = { id: String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, "0"), topic: topic.trim(), tags, source, created: day, updated: day };
    const file = `${fields.id}-${slug(topic)}.md`;
    store.write(path.join(folder(home), file), render(fields, body));
    return { ...fields, file };
  });
}

const count = (text, term) => text.split(term).length - 1;

function score(row, terms) {
  const topic = row.topic.toLowerCase();
  const topicWords = topic.match(WORD) ?? [];
  const body = row.body.toLowerCase();
  let matched = 0;
  let weight = 0;
  for (const t of terms) {
    let w = 0;
    if (topicWords.includes(t)) w += 6;
    else if (topic.includes(t)) w += 3;
    if (row.tags.includes(t)) w += 4;
    else if (row.tags.some((tag) => tag.includes(t))) w += 2;
    w += Math.min(count(body, t), 3);
    if (w) {
      matched += 1;
      weight += w;
    }
  }
  return [matched, weight];
}

/**
 * Learnings matching any of the terms, best first: most terms matched, then weight (the topic counts most, then the
 * tags, then the body). No terms: every learning. `tag` narrows to one tag.
 */
export function search(home, terms, { tag = null, includeRetired = false } = {}) {
  const words = terms.flatMap((t) => String(t).toLowerCase().match(WORD) ?? []);
  const rows = [];
  for (const r of every(home, includeRetired)) {
    if (tag && !r.tags.includes(tag.toLowerCase())) continue;
    const [matched, weight] = words.length ? score(r, words) : [1, 0];
    if (matched) rows.push({ ...r, matched, score: weight });
  }
  const text = (r) => `${r.updated || ""}\n${r.id}`;
  return rows.sort((a, b) => b.matched - a.matched || b.score - a.score || (text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0));
}

const lineOf = (r) => `${r.id}  ${r.topic}${r.tags.length ? ` [${r.tags.join(", ")}]` : ""}  (${r.source || "?"}, ${r.updated || r.created || "?"})${r.retired ? "  RETIRED" : ""}`;

const shown = (r, withBody = false) => Object.fromEntries(Object.entries(r).filter(([k]) => withBody || k !== "body"));

function bodyArg(values, io) {
  if (values.text !== undefined) return String(values.text);
  if (values["from-file"] === "-") return readStdin(io);
  if (values["from-file"]) {
    const text = readText(path.resolve(io.cwd, values["from-file"]));
    if (text === null) throw new AwError(`learn: cannot read ${values["from-file"]}`);
    return text;
  }
  return null;
}

function rewrite(home, r, changes) {
  const { body = null, ...rest } = changes;
  const { body: was, file, matched: _matched, score: _score, ...kept } = r;
  const fields = { ...kept, ...rest, updated: today() };
  store.write(path.join(folder(home), file), render(fields, body ?? was));
  return { ...fields, file };
}

// ------------------------------------------------------------------------------------------------------- commands

const BODY = { text: { type: "string" }, "from-file": { type: "string" }, json: { type: "boolean" } };
const JSON_FLAG = { json: { type: "boolean" } };

function oneId(positionals, verb) {
  if (positionals.length !== 1) throw new AwError(`learn ${verb}: give one id: aw learn ${verb} ID`);
  return positionals[0];
}

const VERBS = {
  async add(argv, io) {
    const { values, positionals } = parseArgs(argv, { topic: { type: "string" }, tags: { type: "string" }, ...BODY });
    if (positionals.length) throw new AwError(`learn add: unexpected '${positionals[0]}'`);
    if (values.topic === undefined) throw new AwError('learn add: say what was learned: --topic "<one line>"');
    const ctx = store.context(io);
    const body = bodyArg(values, io);
    if (body === null) throw new AwError("learn add: give the body with --text or --from-file (- reads stdin)");
    ctx.stamp();
    const row = add(ctx.home, { topic: values.topic, tags: tagsOf(values.tags ?? ""), body, source: ctx.name, limit: store.setting(ctx.cfg, "learningChars") });
    store.say(io, row, values.json, `${row.id}: shared with every project on this machine (${row.file})`);
    return 0;
  },

  async search(argv, io) {
    const { values, positionals } = parseArgs(argv, { tag: { type: "string" }, limit: { type: "string" }, all: { type: "boolean" }, ...JSON_FLAG });
    const limit = Math.max(intArg(values.limit, "--limit", 10), 0);
    const rows = search(store.homeOf(io.env), positionals, { tag: values.tag ?? null, includeRetired: values.all === true }).slice(0, limit);
    const lines = rows.map(lineOf);
    if (rows.length) lines.push("read one with: aw learn show <id>");
    store.say(io, { results: rows.map((r) => shown(r)) }, values.json, lines.length ? lines.join("\n") : "(nothing found)");
    return rows.length ? 0 : 1;
  },

  async show(argv, io) {
    const { values, positionals } = parseArgs(argv, JSON_FLAG);
    const home = store.homeOf(io.env);
    const r = find(home, oneId(positionals, "show"));
    store.say(io, shown(r, true), values.json, (readText(path.join(folder(home), r.file)) ?? "").replace(/\n+$/, ""));
    return 0;
  },

  async list(argv, io) {
    const { values, positionals } = parseArgs(argv, { tag: { type: "string" }, all: { type: "boolean" }, ...JSON_FLAG });
    if (positionals.length) throw new AwError(`learn list: unexpected '${positionals[0]}'`);
    const rows = every(store.homeOf(io.env), values.all === true).filter((r) => !values.tag || r.tags.includes(values.tag.toLowerCase()));
    store.say(io, { learnings: rows.map((r) => shown(r)) }, values.json, rows.length ? rows.map(lineOf).join("\n") : "(no learnings)");
    return 0;
  },

  async edit(argv, io) {
    const { values, positionals } = parseArgs(argv, { topic: { type: "string" }, tags: { type: "string" }, ...BODY });
    const ctx = store.context(io);
    const r = find(ctx.home, oneId(positionals, "edit"));
    const body = bodyArg(values, io);
    const changes = {};
    if (values.topic) changes.topic = values.topic.trim();
    if (values.tags !== undefined) changes.tags = tagsOf(values.tags);
    if (body !== null) changes.body = body;
    if (!Object.keys(changes).length) throw new AwError("learn edit: nothing to change: --topic, --tags, --text or --from-file");
    check(changes.topic ?? r.topic, changes.body ?? r.body, store.setting(ctx.cfg, "learningChars"));
    const row = locked(ctx.home, () => rewrite(ctx.home, r, changes));
    store.say(io, row, values.json, `${row.id}: updated`);
    return 0;
  },

  async retire(argv, io) {
    const { values, positionals } = parseArgs(argv, { reason: { type: "string" }, ...JSON_FLAG });
    const home = store.homeOf(io.env);
    const r = find(home, oneId(positionals, "retire"));
    const reason = (values.reason ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (secretsIn(reason).length) throw new AwError("learn retire: the reason looks like it holds a credential");
    const row = locked(home, () => rewrite(home, r, { retired: today(), reason }));
    store.say(io, row, values.json, `${row.id}: retired (kept, left out of search and list unless --all)`);
    return 0;
  },
};

/** `aw learn <verb> ...`; resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  if (argv.includes("--help") || argv.includes("-h")) {
    emit(io, USAGE);
    return 0;
  }
  const [verb, ...rest] = argv;
  if (!verb || !Object.hasOwn(VERBS, verb)) {
    io.stderr.write(`${verb ? `aw learn: no action '${verb}'\n\n` : ""}${USAGE}\n`);
    return 2;
  }
  return VERBS[verb](store.glue(rest, ["--topic", "--tags", "--text", "--reason"]), io);
}

runMain(import.meta.url, main, "aw learn");
