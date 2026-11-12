// One card is one markdown file: `---` fenced frontmatter of one-line
// `key: value` pairs, then a markdown body. A person edits these by hand, so
// the reader is forgiving and the writer is strict.
//
// The reader takes CRLF, a byte order mark, keys in any order, and three ways
// of writing a value: JSON (`"text"`, `["a","b"]`), a list that is not quite
// JSON (`[a, 'b', ]`), single quotes, or the bare text. It knows one nested
// block, `remote:` (the issue a card is linked to), whose keys are the indented
// lines under it. A line it does not know (another key, a comment) is kept
// verbatim with the indented and blank lines under it and written back after
// the board's own keys. An indented line under any other known key is not part
// of the format and is dropped at the next write.
//
// The writer gives one canonical form: known keys in KNOWN_KEYS order, a key
// left out when it holds its default, the `remote` block, the unknown lines,
// LF only, one blank line before the body.
//
// Pure: no I/O. The CLI, the hooks and the pane all share this file.

/** The write order of the one-line keys. `remote`, the nested block, follows them. */
export const KNOWN_KEYS = [
  "id", "title", "status", "order", "priority", "labels", "skills", "source", "created", "updated",
  "kind", "owner", "needs", "ref", "epic", "sprint", "after", "files", "plan", "grant", "session", "branch", "worktree", "mr", "merged",
];
const NESTED = "remote";
const KNOWN = new Set([...KNOWN_KEYS, NESTED]);
const LISTS = new Set(["labels", "skills", "after", "files"]);
// One-line text a card may leave out: read trimmed, absent when empty.
const TEXTS = ["created", "updated", "owner", "needs", "ref", "epic", "sprint", "plan", "grant", "session", "branch", "worktree", "merged"];
// Left out on write when they hold these.
const IMPLIED = { priority: "normal", kind: "task" };
const PAIR = /^([ \t]*)([\w-]+):[ \t]*(.*)$/;

/** The two headings a card's done criteria sit under: the one written now, and the one earlier cards carry. */
export const DONE_HEADINGS = ["Done when", "Done looks like"];

function scalar(text) {
  const value = text.trim();
  if (value.startsWith("[") || value.startsWith('"')) {
    try { return JSON.parse(value); } catch {
      if (value.startsWith("[") && value.endsWith("]")) {
        return value.slice(1, -1).split(",").map((part) => part.trim().replace(/^['"]|['"]$/g, "")).filter((part) => part !== "");
      }
    }
  }
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

const strings = (value) => (Array.isArray(value) ? value.map(String).filter((s) => s !== "") : typeof value === "string" && value !== "" ? [value] : []);
const oneLine = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" || typeof value === "boolean" ? String(value) : "");

function remoteOf(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const number = Number(value.number);
  if (!Number.isInteger(number) || number <= 0) return undefined;
  return {
    provider: value.provider === "gitlab" ? "gitlab" : "github",
    number,
    url: String(value.url ?? ""),
    updatedAt: String(value.updatedAt ?? ""),
    syncedHash: String(value.syncedHash ?? ""),
  };
}

/**
 * Read a card from a file's text. `file` is the name it was read from: the id falls back to its leading digits, the
 * title to the name, and errors name it. Throws when the text has no frontmatter block or no id can be found.
 */
export function parseCard(text, file = "") {
  const name = String(file).split(/[\\/]/).pop();
  const lines = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const close = lines[0] === "---" ? lines.findIndex((line, i) => i > 0 && /^---[ \t]*$/.test(line)) : -1;
  if (close === -1) throw new Error(`${name || "card"}: no --- fenced frontmatter`);

  const data = {};
  const unknown = [];
  let nested = null;
  let extra = null;
  for (const line of lines.slice(1, close)) {
    const pair = PAIR.exec(line);
    if (pair && pair[1] === "") {
      const [, , key, value] = pair;
      nested = null;
      extra = null;
      if (!KNOWN.has(key)) unknown.push(extra = { key, lines: [line] });
      else if (value.trim() !== "") data[key] = scalar(value);
      else if (key === NESTED) data[key] = nested = {};
    } else if (/^[^ \t]/.test(line)) {
      // Not indented and no key the board knows (a comment, say): it and what hangs under it are kept.
      nested = null;
      unknown.push(extra = { key: null, lines: [line] });
    } else if (extra) extra.lines.push(line);
    else if (pair && nested) nested[pair[2]] = scalar(pair[3]);
  }

  // A plan issue's shadow file has no id of its own: its coordinates stand in.
  const id = String(data.id ?? /^(\d+)/.exec(name)?.[1] ?? data.plan ?? "");
  if (id === "") throw new Error(`${name || "card"}: no id, in the frontmatter or the file name`);
  const card = {
    id,
    file: name,
    title: String(data.title ?? name.replace(/\.md$/, "")),
    status: String(data.status ?? "backlog"),
    order: Number(data.order) || 0,
    priority: data.priority === "low" || data.priority === "high" ? data.priority : "normal",
    labels: strings(data.labels),
    skills: strings(data.skills),
    source: data.source === "claude" ? "claude" : "user",
    kind: oneLine(data.kind) || "task",
    after: strings(data.after),
    files: strings(data.files),
  };
  for (const key of TEXTS) {
    const value = oneLine(data[key]);
    if (value !== "") card[key] = value;
  }
  const mr = Number(data.mr);
  if (Number.isInteger(mr) && mr > 0) card.mr = mr;
  const remote = remoteOf(data.remote);
  if (remote) card.remote = remote;
  card.unknown = unknown.map((entry) => ({ key: entry.key, text: entry.lines.join("\n") }));
  card.body = lines.slice(close + 1).join("\n").replace(/^\n/, "").replace(/\s+$/, "");
  return card;
}

// A string a bare value cannot hold, or that would read back as something else, is written as a JSON string.
function writeValue(value) {
  if (typeof value === "number") return String(value);
  const s = String(value);
  return s === "" || /^["'[]/.test(s) || /^\s|\s$/.test(s) || /[\r\n]/.test(s) ? JSON.stringify(s) : s;
}

/** Write a card in canonical form. */
export function serializeCard(card) {
  const out = ["---"];
  for (const key of KNOWN_KEYS) {
    const value = card[key];
    if (value === undefined || value === null || value === IMPLIED[key] || (value === "" && key !== "title")) continue;
    if (LISTS.has(key)) {
      if (value.length) out.push(`${key}: ${JSON.stringify(value)}`);
      continue;
    }
    out.push(`${key}: ${writeValue(value)}`);
  }
  if (card.remote) {
    out.push(
      "remote:", `  provider: ${card.remote.provider}`, `  number: ${card.remote.number}`, `  url: ${card.remote.url}`,
      `  updatedAt: ${card.remote.updatedAt}`, `  syncedHash: ${card.remote.syncedHash}`,
    );
  }
  for (const { text } of card.unknown ?? []) out.push(text);
  out.push("---");
  const body = String(card.body ?? "").replace(/\r\n?/g, "\n").trim();
  return `${out.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

/** Lowercase ascii, `-` separated, at most 48 characters, never empty. Accented letters keep their base letter. */
export function slugify(title) {
  const slug = String(title).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "");
  return slug || "card";
}

/** The next four-digit id: one past the highest plain number in use. Ids that are not numbers (plan issues) are skipped. */
export function nextId(cards) {
  const top = Math.max(0, ...cards.map((c) => (/^\d+$/.test(c.id ?? "") ? Number(c.id) : 0)));
  return String(top + 1).padStart(4, "0");
}

/** The file a new card is written to: its id and the slug of its title. A card that has a file keeps it. */
export const cardFile = (card) => `${card.id}-${slugify(card.title)}.md`;

/** A new card with every default filled; `fields` wins. `at` is its created and updated time. */
export function newCard(id, title, fields = {}, at = "") {
  const card = {
    id, file: "", title, status: "backlog", order: 0, priority: "normal", labels: [], skills: [], source: "user",
    kind: "task", after: [], files: [], ...(at ? { created: at, updated: at } : {}), unknown: [], body: "", ...fields,
  };
  for (const key of Object.keys(card)) if (card[key] === undefined) delete card[key];
  card.file ||= cardFile(card);
  return card;
}

const VIEW_EXTRAS = ["after", "files", "plan", "grant", "session", "branch", "worktree", "mr", "merged", "blocked", "type", "planStatus", "tracker"];

/**
 * A card as every `--json` output gives it: the board's own fields always present (`owner`, `needs`, `ref`, `epic`,
 * `sprint`, `created` and `updated` as "" when the card has none, `remote` null, `extra` the unknown lines), then the
 * loop's fields a card carries only once it has them (`after`, `files`, `session`, `branch`, `worktree`, `mr`, ...).
 */
export function cardView(card) {
  const text = (key) => card[key] ?? "";
  const view = {
    id: card.id, file: card.file, title: card.title, status: card.status, order: card.order ?? 0, priority: card.priority ?? "normal",
    labels: card.labels ?? [], skills: card.skills ?? [], source: card.source ?? "user", created: text("created"), updated: text("updated"),
    kind: card.kind ?? "task", owner: text("owner"), needs: text("needs"), ref: text("ref"), epic: text("epic"), sprint: text("sprint"),
    body: card.body ?? "", remote: card.remote ?? null, extra: (card.unknown ?? []).flatMap((entry) => entry.text.split("\n")),
  };
  for (const key of VIEW_EXTRAS) {
    const value = card[key];
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) view[key] = value;
  }
  return view;
}

/** A body split at its `## ` headings: `[{ head, text }]`, the part before the first heading with head null. */
export function sections(body) {
  const out = [{ head: null, lines: [] }];
  for (const line of String(body ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) out.push({ head: h[1], lines: [] });
    else out.at(-1).lines.push(line);
  }
  return out.map((s) => ({ head: s.head, text: s.lines.join("\n").trim() }));
}

/** One `## <head>` section of a card body, trimmed, or "". */
export function section(body, head) {
  return sections(body).find((s) => s.head === head)?.text ?? "";
}

/** The card's done criteria: what stands under `## Done when`, or under the heading earlier cards used. */
export function doneCriteria(body) {
  for (const head of DONE_HEADINGS) {
    const text = section(body, head);
    if (text) return text;
  }
  return "";
}

/**
 * `line` added at the end of the `## <head>` section of a body, after its last line; a body without the section
 * gets it at the end. Gives the new body.
 */
export function appendToSection(body, head, line) {
  const lines = String(body ?? "").replace(/\r\n?/g, "\n").trim().split("\n");
  const at = lines.findIndex((l) => l.trim() === `## ${head}`);
  if (at === -1) lines.push(...(lines.join("") ? [""] : []), `## ${head}`, "", line);
  else {
    let end = lines.findIndex((l, i) => i > at && /^## /.test(l));
    if (end === -1) end = lines.length;
    while (end > at + 1 && lines[end - 1] === "") end--;
    const add = end === at + 1 ? ["", line] : [line];
    if (/^## /.test(lines[end] ?? "")) add.push("");
    lines.splice(end, 0, ...add);
  }
  return lines.join("\n").trim();
}
