// Keeping the board in step with the work, two ways.
//
// A card and the session working it. An agent deep in a task forgets to move
// its card, so the board drifts from what is true. The card-sync hook watches a
// session's tool calls for what moves a card (work on its branch, a pull or
// merge request opened or merged, a board command) and keeps a ledger per
// session; the first half of this file reads that ledger against the board and
// says what, if anything, to tell the session: at once when an event owes a
// move the card does not show, on a backing-off timer while work goes on under
// a card nobody updated, and when the session or a subagent stops. `signals`
// reads the facts `board evidence` gathers, for a sweep over the cards.
//
// A card and its issue. A board with `remote.enabled` keeps each card in step
// with an issue on GitHub or GitLab. The second half is that mapping, both
// forges: which labels, milestone, parent and state say a card's column,
// sprint and epic, how an issue reads back as a card, and which side wins when
// both changed. The command does the calls.
//
// Pure: no I/O. `now` is a millisecond time; ledger and card times are ISO.
import { ARCHIVED, SUGGESTED, UNTOUCHED_MS, isEpic, isFinished, roleIds } from "./board.mjs";
import { cardFile, doneCriteria, section, slugify } from "./cards.mjs";
import { parseCardLine } from "./report.mjs";

const MINUTE = 60 * 1000;
/** The first reminder comes after this long of work under a card nobody updated, then twice as long each time, up to NUDGE_CAP_MS. */
export const NUDGE_MS = 20 * MINUTE;
const NUDGE_CAP_MS = 3 * 60 * MINUTE;
/** A stop asks about plain work on a card again only this long after it last asked. */
export const ASK_MS = 30 * MINUTE;
const KEEP_EVENTS = 200;
const KEEP_MS = 24 * 60 * MINUTE;
const ID = /^(?:\d{4}|\d{2}-\d{2}-\d{2})$/;
// Work under a card, and the work a subagent is asked about: what left its worktree.
const WORK = new Set(["edit", "commit", "push"]);
const SHIPPED = new Set(["commit", "push", "mr-open", "mr-merge"]);
// Board verbs that act on a card, as opposed to reading it.
const TOUCH = new Set(["claim", "move", "note", "done", "abandon", "settle", "plan", "bind", "grant", "edit", "reorder"]);
const TOOL_VERBS = { move_task: "move", plan_task: "plan", settle_gate: "settle" };

const time = (iso) => Date.parse(iso ?? "") || 0;
const changed = (card) => time(card.updated ?? card.created);
const live = (board, c) => Boolean(c) && c.kind === "task" && c.status !== SUGGESTED && !isFinished(board, c);

// ---- one tool call ----------------------------------------------------

const STREAMS = ["stdout", "stderr", "output", "result"];

/** A tool's output as text: a Bash result is an object of streams, sometimes a JSON string of one, and a raw string is itself. */
function text(output) {
  if (output === null || output === undefined) return "";
  let value = output;
  if (typeof output === "string") {
    try { value = JSON.parse(output); } catch { return output; }
  }
  if (value && typeof value === "object" && STREAMS.some((k) => typeof value[k] === "string")) {
    return STREAMS.map((k) => value[k]).filter((s) => typeof s === "string").join("\n");
  }
  return typeof output === "string" ? output : JSON.stringify(output);
}

/**
 * What one tool call did that a card cares about, or null: `{ kind, ids }`
 * with kind `edit`, `commit`, `push`, `mr-open` (with `mr`), `mr-merge`
 * (`mr`, and `sha` when the output names it), or `board` (`verb`, and
 * `column` for a move). `ids` are the cards the call named; the hook adds the
 * card the session is working.
 */
export function observe({ tool = "", input = {}, output } = {}) {
  const mcp = /^mcp__(?:plugin_)?agent-works[\w-]*__(\w+)$/.exec(String(tool));
  if (mcp) {
    const verb = TOOL_VERBS[mcp[1]];
    if (!verb || !input?.id) return null;
    return { kind: "board", verb, ids: [String(input.id)], ...(input.column ? { column: String(input.column) } : {}) };
  }
  if (typeof input?.command === "string") return shell(input.command, text(output));
  if (/edit|write/i.test(String(tool)) && (input?.file_path || input?.path || input?.notebook_path)) return { kind: "edit", ids: [] };
  return null;
}

const MERGE_COMMANDS = [
  /\bmr\.mjs["']?\s+merge\s+[!#]?(\d+)/, /\bglab\s+mr\s+merge\s+!?(\d+)/, /\bgh\s+pr\s+merge\s+#?(\d+)/,
  /\bglab\s+api\b[^|;&\n]*merge_requests\/(\d+)\/merge\b/, /\bgh\s+api\b[^|;&\n]*pulls\/(\d+)\/merge\b/,
];
const OPEN_COMMAND = /\b(?:glab\s+mr\s+create|gh\s+pr\s+create|mr\.mjs["']?\s+open)\b/;
// A board command, however it is spelled: the script itself, the dispatcher, or `aw` on the PATH.
const BOARD_COMMAND = /(?:\bboard\.mjs["']?|\baw(?:\.mjs)?["']?(?:\s+--root\s+\S+)?\s+(?:board|kanban))\s+([a-z]+)\b([^|;&\n]*)/g;

// One command line can do several things; the furthest a card would move wins.
function shell(command, out) {
  const merge = MERGE_COMMANDS.map((re) => re.exec(command)).find(Boolean);
  if (merge) {
    const sha = /\bmerged at ([0-9a-f]{7,40})\b/.exec(out)?.[1] ?? /"(?:merge_commit_sha|sha)"\s*:\s*"([0-9a-f]{7,40})"/.exec(out)?.[1];
    // A refused merge says why and merged nothing.
    if (sha || (/\bmerged\b/i.test(out) && !/\bnot merged\b/i.test(out))) return { kind: "mr-merge", ids: [], mr: Number(merge[1]), ...(sha ? { sha } : {}) };
  }
  if (OPEN_COMMAND.test(command)) {
    const number = /\/(?:merge_requests|pull)\/(\d+)/.exec(out)?.[1] ?? /[!#](\d+) opened\b/.exec(out)?.[1];
    if (number) return { kind: "mr-open", ids: [], mr: Number(number) };
  }
  const git = (verb) => new RegExp(`\\bgit\\b(?:\\s+-[cC]\\s+\\S+)*\\s+${verb}\\b`).test(command);
  if (git("push")) return { kind: "push", ids: [] };
  if (git("commit") && !/nothing (added )?to commit/.test(out)) return { kind: "commit", ids: [] };
  for (const [, verb, rest] of command.matchAll(BOARD_COMMAND)) {
    if (!TOUCH.has(verb)) continue;
    const words = rest.split(/[\s,"']+/).filter(Boolean);
    const ids = words.filter((w) => ID.test(w));
    if (!ids.length) continue;
    const column = verb === "move" ? words[words.indexOf(ids[0]) + 1] : undefined;
    return { kind: "board", verb, ids, ...(column && !column.startsWith("-") ? { column } : {}) };
  }
  return null;
}

// ---- the ledger -------------------------------------------------------

/**
 * A session's ledger, read from whatever the file held: `events` (what each
 * call did and the cards it was about, a day's worth), `asked` (what a stop
 * last asked about each card), `told` (the last reminder per card), and
 * `focus` (the card this session moved into progress itself).
 */
export function ledgerOf(json) {
  const j = json && typeof json === "object" ? json : {};
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  return { v: 1, events: Array.isArray(j.events) ? j.events : [], asked: obj(j.asked), told: obj(j.told), focus: typeof j.focus === "string" ? j.focus : null };
}

/** The card a session works: the one its branch is bound to, else the one it last moved into progress itself. */
export function working(board, { branch = null, focus = null } = {}) {
  return (branch && board.cards.find((c) => c.branch === branch && live(board, c)))
    || (focus && board.cards.find((c) => c.id === focus && live(board, c))) || null;
}

/** The cards one event is about: those it names, the cards whose change it merged, and else the card the session works. */
export function cardsOf(board, event, { branch = null, focus = null } = {}) {
  const named = event.ids.filter((id) => board.cards.some((c) => c.id === id));
  if (event.kind === "board") return named;
  if (event.kind === "mr-merge") {
    return [...new Set([...named, ...board.cards.filter((c) => c.mr === event.mr && live(board, c)).map((c) => c.id)])];
  }
  const mine = working(board, { branch, focus });
  return [...new Set([...named, ...(mine ? [mine.id] : [])])];
}

/**
 * The ledger after one event, `{ ...event, ids, agent }` at ISO time `at`: it
 * joins the log, and a board verb moves the focus. A move into progress of a
 * card no child session holds makes it this session's; moving that card on,
 * closing it, or abandoning it lets go.
 */
export function record(ledger, event, { at, now, board }) {
  const events = ledger.events.filter((e) => now - time(e.at) < KEEP_MS).slice(-(KEEP_EVENTS - 1));
  let focus = ledger.focus;
  if (event.kind === "board" && event.ids.length === 1) {
    const [id] = event.ids;
    const card = board.cards.find((c) => c.id === id);
    const start = roleIds(board, "start").includes(event.column);
    if ((event.verb === "claim" || (event.verb === "move" && start)) && card && !card.session) focus = id;
    else if (focus === id && ["move", "done", "abandon"].includes(event.verb)) focus = null;
  }
  return { ...ledger, events: [...events, { at, ...event }], focus };
}

// ---- what the session is told -----------------------------------------

/**
 * The move a card is owed by what these events did since the card last
 * changed: `{ to, key, why, args }` (`args` for the board CLI), or null when
 * the card already shows it. A merged change owes done, an opened one owes review
 * with its number, and work on a card still in the backlog owes in progress.
 */
export function drift(board, card, events, { worktree = false } = {}) {
  if (!live(board, card)) return null;
  const mine = events.filter((e) => e.ids?.includes(card.id) && time(e.at) > changed(card));
  const merged = mine.findLast((e) => e.kind === "mr-merge");
  if (merged) {
    return {
      to: "done", key: `done:${merged.mr}`, why: `!${merged.mr} merged${merged.sha ? ` at ${merged.sha.slice(0, 12)}` : ""}`,
      args: `done ${card.id} --merged ${merged.sha ?? "<merge commit sha>"}`,
    };
  }
  const opened = mine.findLast((e) => e.kind === "mr-open");
  if (opened && !(roleIds(board, "review").includes(card.status) && card.mr === opened.mr)) {
    return { to: "review", key: `review:${opened.mr}`, why: `!${opened.mr} opened`, args: `move ${card.id} ${roleIds(board, "review")[0] ?? "review"} --mr ${opened.mr}` };
  }
  if (card.status === board.columns[0].id && mine.some((e) => WORK.has(e.kind))) {
    const start = roleIds(board, "start")[0] ?? "in-progress";
    return { to: start, key: "start", why: "work on it began", args: worktree ? `claim ${card.id}` : `move ${card.id} ${start}` };
  }
  return null;
}

/**
 * Whether a reminder is due for a card worked under while nobody updated it:
 * the card's last change and the last reminder are both at least NUDGE_MS old,
 * doubling with each reminder since the card last changed, up to NUDGE_CAP_MS.
 * `{ since, work }` when one is due, else null.
 */
export function stale(card, events, told = {}, now) {
  const since = changed(card);
  const work = events.filter((e) => e.ids?.includes(card.id) && WORK.has(e.kind) && time(e.at) > since);
  if (!work.length) return null;
  // The backoff starts over once the card has changed.
  const n = told.updated === (card.updated ?? null) ? told.n ?? 0 : 0;
  const wait = Math.min(NUDGE_MS * 2 ** n, NUDGE_CAP_MS);
  return now - Math.max(since, n ? time(told.at) : 0) >= wait ? { since, work: tally(work) } : null;
}

/**
 * What to tell a session right after a tool call about the cards it was on:
 * `{ text, told }` with the ledger's new `told` entries, or null. A drift is
 * told once per move it owes; a stale card on the timer.
 */
export function afterTool(board, ledger, ids, { now, cli, worktree = false }) {
  const lines = [];
  const told = {};
  for (const id of ids) {
    const card = board.cards.find((c) => c.id === id);
    if (!live(board, card)) continue;
    const before = ledger.told[id] ?? {};
    const d = drift(board, card, ledger.events, { worktree });
    if (d) {
      if (before.drift === d.key) continue;
      told[id] = { ...before, drift: d.key };
      lines.push(`Card ${label(card)} is in ${card.status}, and ${d.why}: move it now, ${cli} ${d.args}`);
      continue;
    }
    const s = stale(card, ledger.events, before, now);
    if (!s) continue;
    const n = before.updated === (card.updated ?? null) ? (before.n ?? 0) + 1 : 1;
    told[id] = { ...before, at: new Date(now).toISOString(), n, updated: card.updated ?? null };
    lines.push(`Card ${label(card)} has said ${card.status} for ${ago(now - s.since)} while this session kept working on it (${s.work}). `
      + `If that still holds, carry on. If it is in review, done, or blocked, move it now (${cli} move ${card.id} <column>), `
      + `or record where it stands: ${cli} note ${card.id} "<what changed>".`);
  }
  return lines.length ? { text: lines.join("\n"), told } : null;
}

/** The CARD line in a final message, or null when there is none or it does not parse. */
function cardLine(message) {
  try { return parseCardLine(message); } catch { return null; }
}

/**
 * What a stop asks before the session (or, with `agent`, one subagent) ends:
 * `{ text, asked }` with the ledger's new `asked` entries, or null to let it
 * stop. It asks about a card it owes a move (once per move), about a CARD line
 * the board does not show, and about work on a card since the card and the
 * last question: for the session, edits, commits, and pushes, at most once
 * per ASK_MS; for a subagent, only what left its worktree.
 */
export function stopAsk(board, ledger, { now, cli, agent = null, lastMessage = "", worktree = false }) {
  const items = [];
  const asked = {};
  const at = new Date(now).toISOString();
  const keyOf = (id) => (agent ? `${agent}:${id}` : id);
  const report = agent ? null : cardLine(lastMessage);
  if (report?.state === "review") {
    const card = board.cards.find((c) => c.id === report.id);
    if (live(board, card) && !(roleIds(board, "review").includes(card.status) && card.mr === report.mr)) {
      const key = `line:${report.mr}`;
      if (ledger.asked[keyOf(card.id)]?.drift !== key) {
        asked[keyOf(card.id)] = { at, drift: key };
        items.push(`${label(card)}: your CARD line says review !${report.mr}, and the board has it in ${card.status}. ${cli} move ${card.id} review --mr ${report.mr}`);
      }
    }
  }
  const events = agent ? ledger.events.filter((e) => e.agent === agent) : ledger.events;
  for (const id of new Set(events.flatMap((e) => e.ids ?? []))) {
    const card = board.cards.find((c) => c.id === id);
    if (asked[keyOf(id)] || !live(board, card)) continue;
    const before = ledger.asked[keyOf(id)] ?? {};
    const d = drift(board, card, events, { worktree });
    if (d) {
      if (before.drift === d.key) continue;
      asked[keyOf(id)] = { at, drift: d.key };
      items.push(`${label(card)} is in ${card.status}, and ${d.why}. ${cli} ${d.args}`);
      continue;
    }
    const kinds = agent ? SHIPPED : WORK;
    const work = events.filter((e) => e.ids?.includes(id) && kinds.has(e.kind) && time(e.at) > Math.max(changed(card), time(before.at)));
    if (!work.length || (!agent && before.at && now - time(before.at) < ASK_MS)) continue;
    asked[keyOf(id)] = { at };
    items.push(`${label(card)} is in ${card.status}, after ${tally(work)} since it last changed.`);
  }
  if (!items.length) return null;
  const list = items.map((i) => `- ${i}`).join("\n");
  const text = agent
    ? `Before you finish: your work touched cards the board tracks.\n${list}\nIf your work changed where a card stands, update it (${cli} move <id> <column>), or say in your final report what changed, so the session that owns the card can.`
    : `Before you stop, check the cards this session worked on:\n${list}\nMove each card whose state changed (${cli} move <id> <column>, or done <id> --merged <sha> once its change merged), or record where it stands (${cli} note <id> "<text>"). If every card already shows where it stands, say so in one line and stop.`;
  return { text, asked };
}

// ---- presenting -------------------------------------------------------

const label = (card) => `${card.id} "${card.title}"`;
const plural = (n, one, many = `${one}s`) => (n === 1 ? `${/^[aeiou]/.test(one) ? "an" : "a"} ${one}` : `${n} ${many}`);

/** "3 edits, a commit, a push": what a run of events did. */
export function tally(events) {
  const n = (kind) => events.filter((e) => e.kind === kind).length;
  const parts = [["edit", "edit"], ["commit", "commit"], ["push", "push", "pushes"], ["mr-open", "change request opened", "change requests opened"]]
    .filter(([kind]) => n(kind)).map(([kind, one, many]) => plural(n(kind), one, many));
  return parts.join(", ") || "work";
}

/** A span as people say it: "35 min", "3 h", "2 days". */
export function ago(ms) {
  const min = Math.max(0, Math.round(ms / MINUTE));
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 36 ? `${h} h` : `${Math.round(h / 24)} days`;
}

// ---- the sweep ----------------------------------------------------------

/** The sweep's scopes, the first the default. */
export const SWEEP_SCOPES = ["in-flight", "backlog", "suggested"];

/** The cards a sweep looks at: in-flight (tasks in progress or in review, plan issues too), backlog (loose tasks waiting to start), or suggested. Null for no such scope. */
export function sweepCards(board, scope) {
  const flight = [...roleIds(board, "start"), ...roleIds(board, "review")];
  const pick = {
    "in-flight": (c) => c.kind === "task" && flight.includes(c.status),
    backlog: (c) => c.kind === "task" && c.source !== "plan" && c.status === board.columns[0].id,
    suggested: (c) => c.status === SUGGESTED,
  }[scope];
  if (!pick) return null;
  return board.cards.filter(pick);
}

// A card body's sections, for callers that hold only this module.
export { doneCriteria, section };

/**
 * What the local evidence says about one card, a plain line each, for the
 * sweep's assessor. `facts` is what `board evidence` gathered: `base` (the
 * ref read), `branch` (`name`, `guessed`, `local`, `remote`, `ahead`,
 * `lastAt`), `merge` (`sha`, `via`) or null, `mentions` and `touched`
 * (commits on the base), and `worktree` (`path`, `exists`, `dirty`, `branch`)
 * or null.
 */
export function signals(card, facts, now) {
  const out = [];
  const b = facts.branch ?? {};
  const name = `${b.guessed ? "the default branch " : ""}${b.name}`;
  if (facts.merge) out.push(`merged into ${facts.base} at ${facts.merge.sha.slice(0, 12)} (${facts.merge.via})`);
  if (b.local || b.remote) {
    const where = [b.local && "local", b.remote && "origin"].filter(Boolean).join(" and ");
    const ahead = Number.isInteger(b.ahead) ? `, ${b.ahead} commit${b.ahead === 1 ? "" : "s"} ahead of ${facts.base}` : "";
    out.push(`${name} exists (${where})${ahead}${b.lastAt ? `, last commit ${ago(now - time(b.lastAt))} ago` : ""}`);
  } else if (!b.guessed) out.push(`${name} is on the card but exists neither locally nor on origin`);
  const wt = facts.worktree;
  if (wt) out.push(wt.exists ? `worktree ${wt.path} on ${wt.branch ?? "a detached HEAD"}, ${wt.dirty} uncommitted change${wt.dirty === 1 ? "" : "s"}` : `worktree ${wt.path} is gone`);
  if (card.mr !== undefined && !facts.merge) out.push(`!${card.mr} is on the card: its state is the forge's to say`);
  if (facts.mentions?.length) out.push(`named by ${facts.mentions.length} commit${facts.mentions.length === 1 ? "" : "s"} on ${facts.base}: ${facts.mentions[0]}`);
  if (facts.touched?.length) out.push(`its files changed on ${facts.base} since it was filed: ${facts.touched.length} commit${facts.touched.length === 1 ? "" : "s"}, latest ${facts.touched[0]}`);
  if (!out.length) out.push("no branch, worktree, merge, or commit found for it");
  const since = changed(card);
  if (since && now - since >= UNTOUCHED_MS) out.push(`the card has not changed for ${ago(now - since)}`);
  return out;
}

// ---- a card and its issue -------------------------------------------------
//
// An issue as the board reads it, the same for both forges:
//   { number, title, body, url, updatedAt, isOpen, status, labels, milestone, parent, isEpic }
// `status` is a column id, null when the remote names none; `labels` are the
// card's own (the board's are taken out); `milestone` is its title or null;
// `parent` is what the issue names as its epic, `{ number, isEpic }` (a parent
// issue, or a GitLab group epic) or `{ label }` (an `epic:<card id>` label), or
// null; `isEpic` marks a GitLab group epic, whose number is the epic's iid.

const STATUS_LABEL = "status:";
const EPIC_LABEL = "epic:";
/** The label that says a card's column where the remote has no board. */
export const statusLabel = (column) => `${STATUS_LABEL}${column}`;
/** The label that names a card's epic where the remote has no parent link to give it. */
export const epicLabel = (id) => `${EPIC_LABEL}${id}`;
/** A label the board keeps for itself: a column or an epic, never one of the card's own. */
export const isBoardLabel = (label) => label.startsWith(STATUS_LABEL) || label.startsWith(EPIC_LABEL);
/** The column a `status:` label names, or null. */
export const statusOf = (labels) => labels.find((l) => l.startsWith(STATUS_LABEL))?.slice(STATUS_LABEL.length) ?? null;
/** The epic an `epic:` label names, as a parent `{ label }`, or null. */
export function epicOfLabels(labels) {
  const label = labels.find((l) => l.startsWith(EPIC_LABEL));
  return label === undefined ? null : { label: label.slice(EPIC_LABEL.length) };
}
/** A sprint's milestone: matched by title, so a milestone renamed on the remote stops being the sprint's. */
export const milestoneTitle = (sprint) => sprint.title.trim() || sprint.id;
/** Where a linked issue lives, so a GitLab epic and an issue of the same number stay apart. */
export const remoteKey = (number, epic) => `${epic ? "epic" : "issue"}#${number}`;
/** Whether a linked issue's address is a GitLab group epic's. */
export const isEpicUrl = (url) => /\/-\/epics\/\d+/.test(String(url));
const keyOfCard = (card) => (card.remote ? remoteKey(card.remote.number, isEpicUrl(card.remote.url)) : null);
const bodyOf = (value) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "");
const dig = (value, ...keys) => keys.reduce((at, key) => (at !== null && typeof at === "object" ? at[key] : undefined), value);
const arr = (value) => (Array.isArray(value) ? value : []);
const doneId = (columns) => columns.find((c) => c.role === "done")?.id ?? null;

/**
 * A remote board's column names as local columns: the first that reads as in progress starts tasks, the last that
 * reads as finished closes issues.
 */
export function adoptColumns(names) {
  const columns = names.map((title) => ({ id: slugify(title), title, role: null }));
  const start = columns.find((c) => /progress|doing|active|wip/i.test(c.title));
  const done = columns.findLast((c) => /done|closed|complete|shipped|merged/i.test(c.title));
  if (start) start.role = "start";
  if (done && done !== start) done.role = "done";
  return columns;
}

function hashOf(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

/** What of a card the remote holds too: a change here is a change to push. */
export const cardHash = (card) => hashOf(JSON.stringify([card.title, card.status, String(card.body ?? "").trim(), [...(card.labels ?? [])].sort()]));

/**
 * What a linked card holds on the remote once its planning is mapped too: its cardHash, plus its epic and sprint (a
 * parent issue, a milestone) when either is set, so a card planned into neither keeps the hash it last synced under.
 */
export function remoteHash(card) {
  if (!card.epic && !card.sprint) return cardHash(card);
  return hashOf(JSON.stringify([cardHash(card), card.epic ?? "", card.sprint ?? ""]));
}

/** Suggested and archived cards stay on this machine: never pushed, never pulled. */
export const isLocalOnly = (card) => card.status === SUGGESTED || card.status === ARCHIVED;

/** `card` linked to `issue` as it now stands on both sides. */
export function linked(card, provider, issue) {
  return { ...card, remote: { provider, number: issue.number, url: issue.url, updatedAt: issue.updatedAt, syncedHash: remoteHash(card) } };
}

const put = (card, key, value) => {
  const next = { ...card };
  if (value) next[key] = value;
  else delete next[key];
  return next;
};

/** The card as the remote has it: its title, body, labels, column, and the sprint and epic given as `theirs`. */
export function pulled(card, provider, issue, theirs) {
  let next = { ...card, title: issue.title, body: issue.body, labels: issue.labels, status: issue.status ?? card.status };
  next = put(put(next, "sprint", theirs.sprint), "epic", theirs.epic);
  return linked(remoteHash(next) === remoteHash(card) ? next : { ...next, updated: issue.updatedAt }, provider, issue);
}

/**
 * A milestone as a sprint id, matched by title: `{ sprint, unmatched }`. No milestone is no sprint. A milestone the
 * board has no sprint for stays the tracker's: the card keeps `fallback` and `unmatched` names the milestone.
 */
export function sprintOfIssue(board, issue, fallback = "") {
  if (issue.milestone === null) return { sprint: "", unmatched: null };
  const sprint = board.sprints.find((s) => milestoneTitle(s) === issue.milestone);
  return sprint ? { sprint: sprint.id, unmatched: null } : { sprint: fallback, unmatched: issue.milestone };
}

/** A parent issue (or an `epic:<id>` label) as the id of the epic card it is; `fallback` when no card is. */
export function epicOfIssue(cards, issue, fallback = "") {
  const parent = issue.parent;
  if (parent === null) return "";
  const epic = "label" in parent
    ? cards.find((c) => c.id === parent.label && isEpic(c))
    : cards.find((c) => isEpic(c) && keyOfCard(c) === remoteKey(parent.number, parent.isEpic));
  return epic?.id ?? fallback;
}

/**
 * What a card is planned into, as the remote should show it: `{ sprint, epic }`, the sprint object (null when the
 * board knows none) and `{ id, remote: { number, isEpic } | null }` for the epic, read from `byId` (a Map of the
 * cards as the pass has them so far).
 */
export function planOf(card, board, byId) {
  const sprint = card.sprint ? board.sprints.find((s) => s.id === card.sprint) ?? null : null;
  if (!card.epic || isEpic(card)) return { sprint, epic: null };
  const epic = byId.get(card.epic);
  return { sprint, epic: { id: card.epic, remote: epic?.remote ? { number: epic.remote.number, isEpic: isEpicUrl(epic.remote.url) } : null } };
}

/**
 * What one linked card needs, given `theirs` (the card as `pulled` from its issue): `same` (nothing differs),
 * `touch` (only the link's bookkeeping differs: write it, nothing moved), `push` (only the card changed, or both
 * did and the card is newer) or `pull` (the issue changed, or both did and the issue is newer).
 */
export function decide(card, issue, theirs) {
  if (remoteHash(theirs) === remoteHash(card)) return JSON.stringify(theirs) === JSON.stringify(card) ? "same" : "touch";
  const localChanged = remoteHash(card) !== card.remote.syncedHash;
  const remoteNewer = issue.updatedAt !== card.remote.updatedAt && issue.updatedAt > (card.updated ?? "");
  return localChanged && !remoteNewer ? "push" : "pull";
}

/** A new card for an open issue no card is linked to: `kind` epic when other issues hang from it. */
export function cardFromIssue(id, provider, issue, { status, order, kind = "task", epic = "", sprint = "" }) {
  const card = {
    id, file: "", title: issue.title, status, order, priority: "normal", labels: issue.labels, skills: [], source: "user",
    created: issue.updatedAt, updated: issue.updatedAt, kind, after: [], files: [], unknown: [], body: issue.body,
  };
  card.file = cardFile(card);
  return linked(put(put(card, "epic", epic), "sprint", sprint), provider, issue);
}

/** The keys of the issues other issues name as their parent. */
export function parentKeys(issues) {
  return new Set(issues.flatMap(({ parent }) => (parent !== null && "number" in parent ? [remoteKey(parent.number, parent.isEpic)] : [])));
}

// ---- GitHub ---------------------------------------------------------------

/** The repository's most recent project board with its Status field, read once. */
export const GITHUB_PROJECT_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        id number
        owner { ... on Organization { login } ... on User { login } }
        field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
      }
    }
  }
}`;

/** The hundred most recently changed issues, with the parent and the project's Status where the server has them. */
export const githubIssuesQuery = (hasProject, hasSubIssues) => `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        id number title body url updatedAt state
        labels(first: 30) { nodes { name } }
        milestone { title }
        ${hasSubIssues ? "parent { number }" : ""}
        ${hasProject ? 'projectItems(first: 10) { nodes { id project { id } fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } } } }' : ""}
      }
    }
  }
}`;

/**
 * A project node as the board uses it, or null when it has no Status field with options: `{ id, number, owner,
 * fieldId, columns, options }`, `columns` adopted from the option names and `options` a Map of column id to option id.
 */
export function githubProject(node) {
  const [id, fieldId, owner, number] = [dig(node, "id"), dig(node, "field", "id"), dig(node, "owner", "login"), dig(node, "number")];
  const named = arr(dig(node, "field", "options")).filter((o) => typeof o?.id === "string" && typeof o?.name === "string");
  if (typeof id !== "string" || typeof fieldId !== "string" || typeof owner !== "string" || typeof number !== "number" || !named.length) return null;
  const columns = adoptColumns(named.map((o) => o.name));
  return { id, number, owner, fieldId, columns, options: new Map(columns.map((c, i) => [c.id, named[i].id])) };
}

/**
 * A GitHub issue node (from the issues query, or the plain issue an edit answers) as an issue, or null. `ctx` is
 * `{ project, columns }`: with a project the column is its Status option, else the `status:` label; an open issue
 * that names none is in the first column, a closed one in the done column. `nodeId` and `itemId` ride along for
 * the calls that need them.
 */
export function githubIssue(node, { project = null, columns }) {
  const number = dig(node, "number");
  if (typeof number !== "number") return null;
  const all = arr(dig(node, "labels", "nodes") ?? dig(node, "labels")).map((l) => (typeof l === "string" ? l : l?.name)).filter((l) => typeof l === "string");
  const isOpen = String(dig(node, "state")).toUpperCase() === "OPEN";
  const done = doneId(columns);
  const parent = dig(node, "parent", "number");
  const milestone = dig(node, "milestone", "title") ?? (typeof dig(node, "milestone") === "string" ? node.milestone : null);
  let status = isOpen ? statusOf(all) ?? columns[0]?.id ?? null : done;
  let itemId = null;
  if (project) {
    const item = arr(dig(node, "projectItems", "nodes")).find((one) => dig(one, "project", "id") === project.id);
    itemId = typeof dig(item, "id") === "string" ? item.id : null;
    const column = [...project.options].find(([, option]) => option === dig(item, "fieldValueByName", "optionId"))?.[0];
    status = isOpen ? column ?? null : done ?? column ?? null;
  }
  return {
    number, title: String(dig(node, "title") ?? ""), body: bodyOf(dig(node, "body")), url: String(dig(node, "url") ?? ""),
    updatedAt: String(dig(node, "updatedAt") ?? ""), isOpen, status, labels: all.filter((l) => !isBoardLabel(l)),
    milestone: typeof milestone === "string" ? milestone : null,
    parent: typeof parent === "number" ? { number: parent, isEpic: false } : epicOfLabels(all), isEpic: false,
    nodeId: typeof dig(node, "id") === "string" ? node.id : null, itemId,
  };
}

/**
 * An issue as the forge layer answers a write (`{ number, title, body, state, labels, url, milestone, updatedAt }`)
 * as an issue here; the column and the parent are the ones just written, which that answer does not name.
 */
export function issueOfForge(seen, { status, parent = null }) {
  return {
    number: seen.number, title: String(seen.title ?? ""), body: bodyOf(seen.body), url: String(seen.url ?? ""), updatedAt: String(seen.updatedAt ?? ""),
    isOpen: seen.state !== "closed", status, labels: arr(seen.labels).filter((l) => !isBoardLabel(l)), milestone: seen.milestone ?? null, parent, isEpic: false,
  };
}

/** The epic's issue to hang a card from, when sub-issues can say it; null leaves it to a label. */
export const githubParent = (plan, hasSubIssues) => (hasSubIssues && plan.epic?.remote && !plan.epic.remote.isEpic ? plan.epic.remote.number : null);

/** The labels a card's issue carries on GitHub: its own, its column where there is no project, its epic where no parent link can say it. */
export function githubLabels(card, plan, { hasProject, hasSubIssues }) {
  return [
    ...(card.labels ?? []),
    ...(hasProject ? [] : [statusLabel(card.status)]),
    ...(plan.epic !== null && githubParent(plan, hasSubIssues) === null ? [epicLabel(plan.epic.id)] : []),
  ];
}

/** The labels an issue carried when it was read, the board's own put back, to tell which to add and which to take off. */
export function githubHad(was, hasProject) {
  return [
    ...was.labels,
    ...(hasProject || was.status === null ? [] : [statusLabel(was.status)]),
    ...(was.parent !== null && "label" in was.parent ? [epicLabel(was.parent.label)] : []),
  ];
}

// ---- GitLab ---------------------------------------------------------------

const OPEN = "open";
const CLOSED = "closed";

/**
 * A project's issue board as local columns, or null when it has no lists: each list is a label, with Open and
 * Closed around them. `{ columns, labelOf }`, `labelOf` a Map of column id to the list's label. `boards` is the
 * answer of the boards endpoint.
 */
export function gitlabBoard(boards) {
  const lists = arr(dig(arr(boards)[0], "lists")).filter((l) => typeof l?.label?.name === "string")
    .sort((a, b) => Number(a.position) - Number(b.position)).map((l) => l.label.name);
  if (!lists.length) return null;
  const middle = adoptColumns(lists).map((c) => ({ ...c, role: c.role === "done" ? null : c.role }));
  return {
    columns: [{ id: OPEN, title: "Open", role: null }, ...middle, { id: CLOSED, title: "Closed", role: "done" }],
    labelOf: new Map(middle.map((c, i) => [c.id, lists[i]])),
  };
}

/**
 * A GitLab issue (or group epic) as an issue, or null. `ctx` is `{ board, columns, hasEpics }`: with a board the
 * column is the list whose label the issue carries, else the `status:` label. A group epic has no column while it
 * is open, no milestone and no parent. `epicId` rides along: the global id of the epic the issue belongs to.
 */
export function gitlabIssue(raw, { board = null, columns, hasEpics = false }) {
  if (raw === null || typeof raw !== "object" || typeof raw.iid !== "number") return null;
  const all = arr(raw.labels).map(String);
  const isOpen = raw.state !== "closed" && raw.state !== "closed_state";
  const isGroupEpic = isEpicUrl(raw.web_url ?? "");
  const listLabels = board ? [...board.labelOf.values()] : [];
  const listed = board ? [...board.labelOf].find(([, label]) => all.includes(label))?.[0] : undefined;
  const open = board ? listed ?? OPEN : statusOf(all) ?? columns[0]?.id ?? null;
  const epic = raw.epic;
  const inEpic = hasEpics && epic !== null && typeof epic === "object" && typeof epic.iid === "number";
  return {
    number: raw.iid, title: String(raw.title ?? ""), body: bodyOf(raw.description), url: String(raw.web_url ?? ""),
    updatedAt: String(raw.updated_at ?? ""), isOpen,
    // An epic has no column on the remote: open keeps the card's, closed is done.
    status: isOpen ? (isGroupEpic ? null : open) : doneId(columns),
    labels: all.filter((l) => !isBoardLabel(l) && !listLabels.includes(l)),
    milestone: isGroupEpic ? null : typeof raw.milestone?.title === "string" ? raw.milestone.title : null,
    parent: isGroupEpic ? null : inEpic ? { number: epic.iid, isEpic: true } : epicOfLabels(all),
    isEpic: isGroupEpic,
    globalId: typeof raw.id === "number" ? raw.id : null,
    epicId: inEpic && typeof epic.id === "number" ? epic.id : null,
  };
}

/**
 * The fields a card's issue is written with on GitLab. `ctx` is `{ board, epicId, milestoneId }`: `epicId` the
 * global id of the group epic the card belongs to (null leaves the epic to a label), `milestoneId` its sprint's
 * milestone (null for no sprint). With `was`, the issue as read, a milestone or an epic it had and the card has
 * not is cleared with 0.
 */
export function gitlabFields(card, plan, was, { board = null, epicId = null, milestoneId = null }) {
  const column = board ? board.labelOf.get(card.status) : statusLabel(card.status);
  const labels = [...(card.labels ?? []), ...(column ? [column] : []), ...(plan.epic !== null && epicId === null ? [epicLabel(plan.epic.id)] : [])];
  const hadEpic = Boolean(was) && was.parent !== null && "number" in was.parent;
  const milestone = milestoneId !== null ? String(milestoneId) : was && was.milestone !== null ? "0" : null;
  return {
    title: card.title, description: card.body ?? "", labels: labels.join(","),
    ...(milestone === null ? {} : { milestone_id: milestone }),
    ...(epicId !== null ? { epic_id: String(epicId) } : hadEpic ? { epic_id: "0" } : {}),
  };
}
