// The board: the cards plus `board.json` (columns, sprints, how a card starts,
// whether it syncs with a tracker, how many run in parallel). Every operation
// here is pure. A read returns what it found; an edit returns a change,
// `{ cards, config }`, holding only the cards it rewrote and the config when it
// changed, and never mutates its input. The caller writes the change.
//
// A refusal throws a BoardError: kind "usage" for a request that cannot be
// carried out as given (no such card, column or sprint, a sprint that cannot
// start), kind "refused" for one the loop's rules turn down. The CLI maps
// those to exit 2 and exit 1. `{cli}` in a message stands for the command the
// person typed, which the CLI fills in.
import { appendToSection, cardFile, newCard, nextId } from "./cards.mjs";

/** A request the board turns down: `kind` is "usage" (exit 2) or "refused" (exit 1). */
export class BoardError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "BoardError";
    this.kind = kind;
  }
}
const usage = (message) => new BoardError("usage", message);
const refuse = (message) => new BoardError("refused", message);

/** The status of a card an agent filed for the person to accept. */
export const SUGGESTED = "suggested";
/** The status of a card taken off the board. */
export const ARCHIVED = "archived";
/** Statuses no column draws: filed by an agent and waiting for the person, and off the board. */
export const VIRTUAL = [SUGGESTED, ARCHIVED];
/** The kinds the board knows: work, a check still owed, a goal other cards belong to. */
export const KINDS = ["task", "gate", "epic"];
/** A card's priorities, lowest first. */
export const PRIORITIES = ["low", "normal", "high"];
/** How the pane starts a card: in a session of its own, or queued in this one. */
export const START_MODES = ["new-session", "queue"];
const PRIORITY = { high: 0, normal: 1, low: 2 };
/** Days a card may sit in progress untouched before lint speaks, unless the project's config says otherwise. */
export const STALE_DAYS = 7;
/** Days a gate may stay owed before lint speaks, unless the project's config says otherwise. */
export const OWED_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;
/** A card in progress or in review that has not changed this long is named in the briefing. */
export const UNTOUCHED_MS = DAY;

const DEFAULT_COLUMNS = [
  { id: "backlog", title: "Backlog", role: null },
  { id: "in-progress", title: "In progress", role: "start" },
  { id: "review", title: "Review", role: "review" },
  { id: "done", title: "Done", role: "done" },
];
const CONFIG_KEYS = new Set(["columns", "startMode", "remote", "sprints", "parallel"]);
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);

// An entry with no id is dropped, and only the first active sprint stays active.
function sprintsOf(value) {
  let hasActive = false;
  return (Array.isArray(value) ? value : []).flatMap((one) => {
    if (!isRecord(one) || typeof one.id !== "string" || one.id === "") return [];
    let state = one.state === "active" || one.state === "closed" ? one.state : "planned";
    if (state === "active" && hasActive) state = "planned";
    if (state === "active") hasActive = true;
    const closed = isRecord(one.closed) ? { at: str(one.closed.at), done: count(one.closed.done), rolled: count(one.closed.rolled) } : null;
    return [{ id: one.id, title: str(one.title) || one.id, goal: str(one.goal), start: str(one.start), end: str(one.end), state, closed }];
  });
}

/**
 * `board.json` with its defaults filled: `{ columns, startMode, remote, sprints, parallel, extra }`. A missing file,
 * or one that is not a JSON object, reads as the defaults; a column without an id is dropped; `extra` keeps the keys
 * this version does not know, so a write hands them back.
 */
export function boardConfig(json = {}) {
  const raw = isRecord(json) ? json : {};
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).flatMap((one) => {
    if (!isRecord(one) || typeof one.id !== "string" || one.id === "") return [];
    return [{ id: one.id, title: str(one.title, one.id), role: ["start", "review", "done"].includes(one.role) ? one.role : null }];
  });
  return {
    columns: columns.length ? columns : DEFAULT_COLUMNS.map((c) => ({ ...c })),
    startMode: START_MODES.includes(raw.startMode) ? raw.startMode : "new-session",
    remote: { enabled: isRecord(raw.remote) && raw.remote.enabled === true },
    sprints: sprintsOf(raw.sprints),
    parallel: Number.isInteger(raw.parallel) && raw.parallel > 0 ? raw.parallel : 2,
    extra: Object.fromEntries(Object.entries(raw).filter(([key]) => !CONFIG_KEYS.has(key))),
  };
}

/** What `board.json` holds for `board`: its config without the cards. */
export const configOf = (board) => ({
  columns: board.columns, startMode: board.startMode ?? "new-session", remote: board.remote ?? { enabled: false },
  sprints: board.sprints ?? [], parallel: board.parallel ?? 2, extra: board.extra ?? {},
});

/** `board.json` as it is written: `sprints` only once there is one, `parallel` only when it is not 2. */
export function serializeConfig(config) {
  const { columns, startMode, remote, sprints, parallel, extra } = configOf(config);
  const doc = { columns, startMode, remote, ...(sprints.length ? { sprints } : {}), ...(parallel !== 2 ? { parallel } : {}), ...extra };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// ---- reading the board ------------------------------------------------

/**
 * The ids of the columns that play a role: start, review, or done. A board whose columns name no review role (one
 * made before the role existed) reads its `review` column as the one.
 */
export function roleIds(board, role) {
  const ids = board.columns.filter((c) => c.role === role).map((c) => c.id);
  if (ids.length || role !== "review") return ids;
  return board.columns.filter((c) => c.id === "review" && c.role === null).map((c) => c.id);
}
const backlogId = (board) => board.columns[0]?.id ?? "backlog";
/** The column a finished card goes to: the one with the done role, else the last. */
export const doneColumn = (board) => board.columns.find((c) => c.role === "done") ?? board.columns.at(-1) ?? null;
/** Whether a status is a column of this board, or one of the two no column draws. */
export const isKnownStatus = (board, status) => VIRTUAL.includes(status) || board.columns.some((c) => c.id === status);
/** A check still owed. */
export const isGate = (c) => c.kind === "gate";
/** A goal other cards belong to. */
export const isEpic = (c) => c.kind === "epic";
const isTask = (c) => c.kind !== "epic" && c.kind !== "gate";
// A plan card mirrors a planning issue: read only here, its status is the plan's to change.
const isPlan = (c) => c.source === "plan";
/** Done or archived: nothing left to work. */
export const isFinished = (board, c) => c.status === ARCHIVED || roleIds(board, "done").includes(c.status);
const afterDone = (board, c) => (c.after ?? []).every((id) => {
  const dep = board.cards.find((x) => x.id === id);
  return dep && isFinished(board, dep);
});
// A gate is owed once what it checks can be checked: a plan walkthrough waits on the issues it reviews.
const isOpenGate = (board, c) => isGate(c) && !isFinished(board, c) && afterDone(board, c);
/** The sprint the board is working in, or null. */
export const activeSprint = (board) => board.sprints.find((s) => s.state === "active") ?? null;

/** A card by id as a person types it: `7` finds `0007`. Null when there is none. */
export function findCard(board, id) {
  const wanted = String(id ?? "").trim();
  return board.cards.find((c) => c.id === wanted || c.id === wanted.padStart(4, "0")) ?? null;
}
const need = (board, id) => {
  const card = findCard(board, id);
  if (!card) throw usage(`no card with id "${id}" ({cli} list shows the ids)`);
  return card;
};

// Suggested cards sort first (they wait on the person), then the columns in
// board order, then statuses no column knows, then archived.
function rank(board, status) {
  if (status === SUGGESTED) return -1;
  const i = board.columns.findIndex((c) => c.id === status);
  return i !== -1 ? i : status === ARCHIVED ? board.columns.length + 1 : board.columns.length;
}
/** A sort for cards: by lane in board order, then by their order in the lane, then by id. */
export const byPlace = (board) => (a, b) => rank(board, a.status) - rank(board, b.status)
  || (a.order ?? Infinity) - (b.order ?? Infinity) || String(a.id).localeCompare(String(b.id));

/** The scopes a listing takes beside an epic's id. */
export const SCOPES = ["sprint", "backlog", "all", "gates", "plan"];

/**
 * A scope as a person or an agent names it: `sprint` (the active sprint's cards), `backlog` (cards in no sprint),
 * `all`, `gates` (the gates still owed), `plan` (the plan's issues), or an epic's card id. Empty is the board's
 * default: the active sprint while there is one, else all. Throws when it names nothing.
 */
export function parseScope(board, text = "") {
  const wanted = String(text ?? "").trim().toLowerCase();
  if (wanted === "") return activeSprint(board) ? "sprint" : "all";
  if (SCOPES.includes(wanted)) return wanted;
  const epic = board.cards.find((c) => isEpic(c) && (c.id === wanted || c.id === wanted.padStart(4, "0")));
  if (!epic) throw usage(`no scope "${text}": sprint, backlog, all, gates, plan, or an epic's card id`);
  return epic.id;
}

/** A scope in a few words: `sprint s2`, `backlog`, `epic 0004`, `all`. The sprint scope with no active sprint is all. */
export function scopeLabel(board, scope) {
  if (scope === "sprint") return activeSprint(board) ? `sprint ${activeSprint(board).id}` : "all";
  return SCOPES.includes(scope) ? scope : `epic ${scope}`;
}

/**
 * Whether a card belongs in the lanes of a scope. Epics are never in a lane; the Suggested lane is shown whatever
 * the scope; the sprint scope with no active sprint is every card.
 */
export function inScope(board, card, scope) {
  if (scope === "gates") return isOpenGate(board, card);
  if (isEpic(card)) return false;
  if (scope === "plan") return isPlan(card);
  if (card.status === SUGGESTED) return true;
  if (scope === "sprint") return !activeSprint(board) || card.sprint === activeSprint(board).id;
  if (scope === "backlog") return !card.sprint;
  if (scope === "all") return true;
  return card.epic === scope;
}

/** The open cards of a scope (not archived, no epics), in lane order. */
export function listing(board, scope = "all") {
  return board.cards.filter((c) => c.status !== ARCHIVED && inScope(board, c, scope)).sort(byPlace(board));
}

/** Backlog tasks nobody has to unblock: not an epic or a gate, no person needed, not blocked, every `after` card finished. */
export function ready(board) {
  const sprint = activeSprint(board)?.id;
  return board.cards
    .filter((c) => c.status === backlogId(board) && isTask(c) && !c.needs && !c.blocked && afterDone(board, c))
    // The active sprint's cards first, then priority, then the person's order.
    .sort((a, b) => (b.sprint === sprint && !!sprint) - (a.sprint === sprint && !!sprint)
      || (PRIORITY[a.priority] ?? 1) - (PRIORITY[b.priority] ?? 1) || byPlace(board)(a, b));
}

/**
 * What keeps one card out of `ready`, the first reason that holds: `{ why }` as `status` (not in the backlog),
 * `epic`, `gate` (settled, never started), `needs` (a person), `blocked`, or `waiting` (`on` the `after` cards not
 * finished). Null exactly when the card is ready.
 */
export function holdOf(board, c) {
  if (c.status !== backlogId(board)) return { why: "status", status: c.status };
  if (isEpic(c) || isGate(c)) return { why: c.kind };
  if (c.needs) return { why: "needs", needs: c.needs };
  if (c.blocked) return { why: "blocked" };
  const on = (c.after ?? []).filter((id) => {
    const dep = board.cards.find((x) => x.id === id);
    return !dep || !isFinished(board, dep);
  });
  return on.length ? { why: "waiting", on } : null;
}

/** What keeps the backlog's other cards out of `ready`, counted by the first reason that holds. Epics are not counted. */
export function held(board) {
  const out = { gates: 0, needs: 0, blocked: 0, waiting: 0 };
  const key = { gate: "gates", needs: "needs", blocked: "blocked", waiting: "waiting" };
  for (const c of board.cards.filter((x) => x.status === backlogId(board))) {
    const k = key[holdOf(board, c)?.why];
    if (k) out[k]++;
  }
  return out;
}

/** An epic's children finished out of children counted: `{ id, title, done, total }`. Archived counts as finished; a suggestion does not count yet. */
export function epicProgress(board, id) {
  const epic = need(board, id);
  if (!isEpic(epic)) throw usage(`"${id}" is no epic ({cli} epics lists them)`);
  const children = board.cards.filter((c) => c.epic === epic.id && !isEpic(c) && c.status !== SUGGESTED);
  return { id: epic.id, title: epic.title, done: children.filter((c) => isFinished(board, c)).length, total: children.length };
}

/** The epics still open: neither archived nor in a done column. */
export const openEpics = (board) => board.cards.filter((c) => isEpic(c) && !isFinished(board, c)).sort(byPlace(board));

/** `▰▰▱▱▱▱▱▱ 2/8`: progress in a line of text. */
export function progressBar({ done, total }, width = 8) {
  const filled = total === 0 ? 0 : Math.round((done / total) * width);
  return `${"▰".repeat(filled)}${"▱".repeat(width - filled)} ${done}/${total}`;
}

const norm = (title) => String(title).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * An open card (not archived, not done) whose title says the same thing, or null. With `ref` the search is for a
 * gate: the same check owed for another change is another gate.
 */
export function findDuplicate(board, title, ref) {
  const want = norm(title);
  return board.cards.find((c) => !isFinished(board, c) && norm(c.title) === want && (ref === undefined || (isGate(c) && c.ref === ref))) ?? null;
}

/** One card in a line: id, lane, kind, owner, title, then what it is for, what it needs, and where it is planned and bound. */
export function cardLine(c) {
  const more = [
    c.ref ? `for ${c.ref}` : "", c.needs ? `needs ${c.needs}` : "", c.epic ? `epic ${c.epic}` : "", c.sprint ? `sprint ${c.sprint}` : "",
    c.blocked ? "blocked" : "", c.session ? `session ${c.session}` : "", c.mr !== undefined ? `!${c.mr}` : "",
  ].filter(Boolean).join("; ");
  return `${c.id} [${c.status}] ${isPlan(c) ? "plan " : ""}${c.kind}${c.owner ? ` @${c.owner}` : ""}: ${c.title}${more ? ` (${more})` : ""}`;
}

/** A sprint in a line: id, title, state, end and goal. */
export function sprintLine(s) {
  return `Sprint ${s.id} "${s.title}" (${s.state}${s.end ? `, ends ${s.end}` : ""})${s.goal ? `: ${s.goal}` : ""}`;
}

/**
 * A listing as text: the columns, the active sprint, the open epics with their progress, the scope's cards in lane
 * order (only those of `kind`, when given), and how many open cards the scope left out.
 */
export function listingLines(board, scope, kind = null) {
  const ofKind = (c) => !kind || c.kind === kind;
  const open = board.cards.filter((c) => c.status !== ARCHIVED && !isEpic(c) && ofKind(c));
  const shown = listing(board, scope).filter(ofKind);
  const label = scopeLabel(board, scope);
  const hidden = open.length - shown.length;
  return [
    `Columns: ${board.columns.map((c) => c.id).join(", ")} (plus ${SUGGESTED})`,
    activeSprint(board) ? sprintLine(activeSprint(board)) : "",
    ...openEpics(board).map((e) => `Epic ${e.id} ${progressBar(epicProgress(board, e.id))}: ${e.title}`),
    label === "all" ? "" : `Scope: ${label}`,
    ...shown.map(cardLine),
    shown.length ? "" : "No cards in this scope.",
    hidden > 0 ? `${hidden} more open card(s) outside this scope (scope "all" lists them).` : "",
  ].filter(Boolean);
}

const inFlight = (c) => ({ id: c.id, title: c.title, ...(c.session ? { session: c.session } : {}), ...(c.mr !== undefined ? { mr: c.mr } : {}) });

/**
 * Lane counts (tasks only), the cards in flight, and the counts the person acts on. With `now` (a millisecond
 * time), `untouched` counts the cards in flight that have not changed for UNTOUCHED_MS.
 */
export function summary(board, now = null) {
  const lanes = Object.fromEntries(board.columns.map((col) => [col.id, 0]));
  for (const c of board.cards) if (isTask(c) && c.status in lanes) lanes[c.status]++;
  const inRoleCards = (role) => board.cards.filter((c) => isTask(c) && roleIds(board, role).includes(c.status));
  const inRole = (role) => inRoleCards(role).sort(byPlace(board)).map(inFlight);
  const changed = (c) => Date.parse(c.updated ?? c.created ?? "");
  return {
    lanes,
    inProgress: inRole("start"),
    review: inRole("review"),
    ready: ready(board).length,
    owed: board.cards.filter((c) => isOpenGate(board, c)).length,
    suggested: board.cards.filter((c) => c.status === SUGGESTED).length,
    sprint: activeSprint(board),
    untouched: now === null ? 0 : [...inRoleCards("start"), ...inRoleCards("review")].filter((c) => now - changed(c) >= UNTOUCHED_MS).length,
  };
}

/** One sentence for the session briefing and `status --brief`. */
export function briefLine(s) {
  const named = (cards) => (cards.length ? ` (${cards.map((c) => [c.id, c.session, c.mr !== undefined ? `!${c.mr}` : null].filter(Boolean).join(" ")).join("; ")})` : "");
  const parts = [`${s.inProgress.length} in progress${named(s.inProgress)}`, `${s.review.length} in review${named(s.review)}`];
  if (s.ready) parts.push(`${s.ready} ready`);
  if (s.owed) parts.push(`${s.owed} gate${s.owed === 1 ? "" : "s"} owed`);
  if (s.suggested) parts.push(`${s.suggested} suggested`);
  const untouched = s.untouched ? ` ${s.untouched} in flight ${s.untouched === 1 ? "has" : "have"} not changed for a day: /agent-works:sync-cards checks ${s.untouched === 1 ? "it" : "them"}.` : "";
  return `Board: ${parts.join(", ")}.${untouched}`;
}

// ---- lint -------------------------------------------------------------

/** A time as written on a card, in milliseconds; null when it is no date. A time without a zone is UTC. */
export function timeOf(stamp) {
  const text = String(stamp ?? "").trim();
  if (!text) return null;
  const full = Date.parse(/T[\d:.]+$/.test(text) ? `${text}Z` : text);
  if (!Number.isNaN(full)) return full;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const at = day ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : NaN;
  return Number.isNaN(at) ? null : at;
}

/**
 * What is wrong with the board: `[{ code, level, file, message }]`, `file` the card's file (or `board.json`, or ""
 * for the board as a whole). `board.errors` are the files nobody could read, `[{ file, message, said }]`: `said`
 * marks a message worth showing as it is. `now` is a millisecond time; `staleDays` and `owedDays` are the ages lint speaks at;
 * `grants` are the push approvals in git config, `[{ branch, text }]`.
 */
export function lint(board, now, { staleDays = STALE_DAYS, owedDays = OWED_DAYS, grants = [] } = {}) {
  const out = [];
  const warn = (code, file, message) => out.push({ code, level: "warning", file, message });
  const days = (stamp) => (timeOf(stamp) === null ? null : (now - timeOf(stamp)) / DAY);
  for (const e of board.errors ?? []) warn("KANBAN_CARD_INVALID", e.file, e.said ? e.message : "not a card: no frontmatter block (--- … ---) or no id");

  const active = activeSprint(board);
  // The end day itself still counts.
  if (active?.end && days(active.end) !== null && days(active.end) > 1) {
    warn("KANBAN_SPRINT_OVERDUE", "board.json", `sprint ${active.id} ended ${active.end} and is still active: close it ({cli} sprint close) or move its end`);
  }
  const columns = board.columns.map((c) => c.id);
  const epics = new Set(board.cards.filter(isEpic).map((c) => c.id));
  const sprints = new Set(board.sprints.map((s) => s.id));
  const seen = new Map();
  for (const c of board.cards) {
    const plan = isPlan(c);
    if (!plan) {
      if (seen.has(c.id)) warn("KANBAN_CARD_INVALID", c.file, `its id ${c.id} is also the id of ${seen.get(c.id)}`);
      else seen.set(c.id, c.file);
      const inName = /^(\d+)-/.exec(c.file ?? "");
      if (!inName) warn("KANBAN_CARD_INVALID", c.file, "the file is not named <id>-<slug>.md");
      else if (!/^\d+$/.test(c.id) || Number(inName[1]) !== Number(c.id)) warn("KANBAN_CARD_INVALID", c.file, `the file name and the id (${c.id}) disagree`);
      if (c.title.trim() === "") warn("KANBAN_CARD_INVALID", c.file, "no title");
      if (!KINDS.includes(c.kind)) warn("KANBAN_CARD_INVALID", c.file, `kind "${c.kind}" is not task, gate or epic`);
      if (isGate(c) && !c.ref) warn("KANBAN_CARD_INVALID", c.file, "a gate without ref: what is it owed for?");
      for (const key of ["created", "updated"]) if (days(c[key]) === null) warn("KANBAN_CARD_INVALID", c.file, `${key} is not a date`);
      if (c.epic && !epics.has(c.epic)) warn("KANBAN_EPIC_UNKNOWN", c.file, `epic "${c.epic}" is no epic card of this board`);
      if (c.sprint && !sprints.has(c.sprint)) warn("KANBAN_SPRINT_UNKNOWN", c.file, `sprint "${c.sprint}" is no sprint of this board ({cli} sprint list)`);
      if (!isKnownStatus(board, c.status)) {
        warn("KANBAN_STATUS_UNKNOWN", c.file, `status "${c.status}" is no column of this board (${columns.join(", ")}); the pane shows the card in the first`);
      }
    }
    if (roleIds(board, "start").includes(c.status)) {
      const age = days(c.updated ?? c.created);
      if (age !== null && age > staleDays) warn("KANBAN_STALE_START", c.file, `in ${c.status} and untouched for ${Math.trunc(age)} days: finish it, hand it back or move it out`);
    }
    if (!plan && isGate(c) && !isFinished(board, c)) {
      const age = days(c.created);
      if (age !== null && age > owedDays) warn("GATE_OWED_OLD", c.file, `owed${c.ref ? ` for ${c.ref}` : ""} for ${Math.trunc(age)} days${c.needs ? `; needs ${c.needs}` : ""}`);
    }
    // A note, never a failure: boards kept before cards carried a change request have cards in review without one.
    if (isTask(c) && board.columns.some((col) => col.role === "review" && col.id === c.status) && c.mr === undefined) {
      out.push({ code: "KANBAN_REVIEW_UNLINKED", level: "info", file: c.file, message: `in ${c.status} with no pull or merge request on the card: {cli} move ${c.id} ${c.status} --mr <number>` });
    }
  }
  // A grant outlives its card when the card was finished or abandoned by hand rather than by done or abandon.
  const bound = new Set(board.cards.filter((c) => c.branch && !isFinished(board, c)).map((c) => c.branch));
  for (const g of grants.filter((x) => !bound.has(x.branch))) {
    warn("KANBAN_GRANT_ORPHAN", "", `a push grant with no card in flight on branch ${g.branch}: git config --unset branch.${g.branch}.agentic-engineering-push, unless the person granted it by hand`);
  }
  return out;
}

/** The mechanical repairs: a duplicate id goes to the newer card's next free id, an unknown status goes to the first column. */
export function lintFix(board, at) {
  const out = new Map();
  const taken = [...board.cards];
  const groups = Map.groupBy(board.cards.filter((c) => !isPlan(c)), (c) => c.id);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [, ...newer] = [...group].sort((a, b) => String(a.created ?? "").localeCompare(String(b.created ?? "")) || a.file.localeCompare(b.file));
    for (const c of newer) {
      const id = nextId(taken);
      taken.push({ id });
      out.set(c, { ...c, id, updated: at });
    }
  }
  for (const c of board.cards.filter((x) => !isKnownStatus(board, x.status) && !isPlan(x))) {
    const base = out.get(c) ?? c;
    const said = `lint --fix moved this card to ${backlogId(board)} at ${at}: its status was "${c.status}", which is no column.`;
    out.set(c, { ...base, status: backlogId(board), updated: at, body: `${base.body ?? ""}\n\n${said}`.trim() });
  }
  return { cards: [...out.values()] };
}

// ---- editing the board ------------------------------------------------

const nextOrder = (board, status) => Math.max(0, ...board.cards.filter((c) => c.status === status && !isPlan(c)).map((c) => (Number.isFinite(c.order) ? c.order + 1 : 0)));
const stamped = (cards, at) => (at ? cards.map((c) => ({ ...c, updated: at })) : cards);

/**
 * A new card at the end of its lane (the first column unless `status`), with the next id. `fields` are the card's
 * own (`kind`, `priority`, `labels`, `skills`, `owner`, `ref`, `needs`, `epic`, `sprint`, `after`, `files`,
 * `source`, `body`); an empty one is left off. The caller checks for a duplicate first.
 */
export function addCard(board, { title, status, ...fields } = {}, at) {
  if (!String(title ?? "").trim()) throw usage("a card needs a title");
  const lane = status || backlogId(board);
  if (!isKnownStatus(board, lane)) throw usage(`no column "${lane}": the columns are ${board.columns.map((c) => c.id).join(", ")}`);
  const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  if (kept.kind && !KINDS.includes(kept.kind)) throw usage(`--kind is ${KINDS.join(", ")}, not "${kept.kind}"`);
  if (kept.priority && !PRIORITIES.includes(kept.priority)) throw usage(`--priority is ${PRIORITIES.join(", ")}, not "${kept.priority}"`);
  if (kept.epic) kept.epic = epicOf(board, kept.epic).id;
  if (kept.sprint) kept.sprint = sprintOf(board, kept.sprint).id;
  for (const id of kept.after ?? []) need(board, id);
  const card = newCard(nextId(board.cards), String(title).trim(), { ...kept, status: lane, order: nextOrder(board, lane) }, at);
  return { cards: [card] };
}

/** Move a card to a column (or a virtual status) at `index`, default the end, renumbering that lane from 0. */
export function planMove(board, id, column, { index, at, settled = false } = {}) {
  const card = need(board, id);
  if (isPlan(card)) throw refuse(`${card.id} is a plan issue: its moves run the plan's funnel, not this`);
  if (!isKnownStatus(board, column)) {
    throw usage(`no column "${column}": the columns are ${board.columns.map((c) => c.id).join(", ")} (plus ${SUGGESTED} and ${ARCHIVED})`);
  }
  if (isGate(card) && !settled && roleIds(board, "done").includes(column) && card.status !== column) {
    throw refuse(`${card.id} is a gate: settle it with the evidence instead ({cli} settle ${card.id} --evidence "<what showed it>")`);
  }
  // Plan cards keep no order of their own, so they sit after the cards that do and are never renumbered.
  const lane = board.cards.filter((c) => c.status === column && c !== card && !isPlan(c)).sort(byPlace(board));
  const slot = Math.max(0, Math.min(Number.isInteger(index) ? index : lane.length, lane.length));
  lane.splice(slot, 0, card);
  const cards = [];
  lane.forEach((c, i) => {
    if (c === card) {
      if (c.status !== column || c.order !== i) cards.push({ ...c, status: column, order: i });
    } else if (c.order !== i) cards.push({ ...c, order: i });
  });
  return { cards: stamped(cards, at) };
}

/** Put a card at `index` of the lane it is in. */
export const reorder = (board, id, index, at) => planMove(board, id, need(board, id).status, { index, at, settled: true });

function epicOf(board, id) {
  const epic = findCard(board, id);
  if (!epic || !isEpic(epic)) throw usage(`"${id}" is no epic ({cli} epics lists them)`);
  return epic;
}

// An open sprint by id, or `active` for the active one.
function sprintOf(board, id) {
  if (id === "active") {
    if (!activeSprint(board)) throw usage("no sprint is active");
    return activeSprint(board);
  }
  const sprint = board.sprints.find((s) => s.id === id && s.state !== "closed");
  if (!sprint) throw usage(`no open sprint "${id}" (open: ${board.sprints.filter((s) => s.state !== "closed").map((s) => s.id).join(", ") || "none"})`);
  return sprint;
}

const EDITABLE = ["title", "kind", "priority", "labels", "skills", "owner", "needs", "ref", "epic", "sprint", "after", "files", "body"];

/**
 * Change a card's own fields: any of `title`, `kind`, `priority`, `labels`, `skills`, `owner`, `needs`, `ref`,
 * `epic`, `sprint`, `after`, `files`, `body`. "" (or `none` for an epic or a sprint) takes a field off. The file
 * keeps its name. Plan issues are the plan's to edit.
 */
export function editCard(board, id, patch = {}, at) {
  const card = need(board, id);
  if (isPlan(card)) throw refuse(`${card.id} is a plan issue: its fields are the plan's`);
  const next = { ...card };
  for (const key of EDITABLE) {
    let value = patch[key];
    if (value === undefined) continue;
    if (key === "title" && !String(value).trim()) throw usage("a card needs a title");
    if (key === "kind" && !String(value).trim()) throw usage("a card needs a kind");
    if (key === "priority" && !PRIORITIES.includes(value)) throw usage(`--priority is ${PRIORITIES.join(", ")}, not "${value}"`);
    if (key === "epic" && value && value !== "none") {
      value = epicOf(board, value).id;
      if (value === card.id) throw usage("an epic is not a card of its own");
    }
    if (key === "sprint" && value && value !== "none") value = sprintOf(board, value).id;
    if (key === "after") for (const dep of value) need(board, dep);
    if (typeof value === "string" && key !== "body") value = value.trim();
    if (value === "" || ((key === "epic" || key === "sprint") && value === "none")) {
      if (key === "body") next.body = "";
      else delete next[key];
    } else next[key] = value;
  }
  return { cards: stamped([next], at) };
}

/** Put a card in an epic and/or a sprint; `none` takes it out. `sprint` may be `active`. */
export function planCard(board, id, { epic, sprint } = {}, at) {
  if (epic === undefined && sprint === undefined) throw usage("nothing to change: give --epic or --sprint");
  if (isPlan(need(board, id))) throw refuse(`${id} is a plan issue: its epic and sprint are the plan's`);
  return editCard(board, id, { epic, sprint }, at);
}

/** A gate: a check this session owes and cannot run, with what it refers to and what settling it needs. It joins the active sprint. */
export function owe(board, { title, ref, needs, owner, body, source } = {}, at) {
  if (!String(title ?? "").trim() || !String(ref ?? "").trim() || !String(needs ?? "").trim()) {
    throw usage("a gate needs a title, what it is owed for (--ref) and what running it needs (--needs)");
  }
  return addCard(board, {
    title, kind: "gate", ref: ref.trim(), needs: needs.trim(), owner: String(owner ?? "").trim(), sprint: activeSprint(board)?.id, source, body,
  }, at);
}

/**
 * Settle a gate: the evidence is recorded (under `## Evidence` when the card has that section, else at the end of
 * its body) and the card goes to the end of the done column. `by` names who settled it.
 */
export function settle(board, id, evidence, at, by = null) {
  const card = need(board, id);
  if (isPlan(card)) throw refuse(`${card.id} is a plan issue: it is settled by flipping it to done in the branch that records the walkthrough`);
  if (!isGate(card)) throw usage(`card ${card.id} is a ${card.kind}, not a gate: use {cli} move`);
  const done = doneColumn(board);
  if (!done) throw usage("this board has no column to settle into");
  if (card.status === done.id) throw usage(`gate ${card.id} is already settled`);
  if (!String(evidence ?? "").trim()) throw usage("a gate is settled with its evidence: the command that ran and what it showed");
  const said = `Settled ${at}${by ? ` by ${by}` : ""}: ${evidence.trim()}`;
  const body = /^## Evidence\s*$/m.test(card.body ?? "") ? appendToSection(card.body, "Evidence", said) : `${(card.body ?? "").trim()}\n\n${said}`.trim();
  const moved = planMove(board, card.id, done.id, { settled: true }).cards;
  const cards = moved.some((c) => c.id === card.id) ? moved : [...moved, { ...card, status: done.id }];
  return { cards: stamped(cards.map((c) => (c.id === card.id ? { ...c, body } : c)), at) };
}

/** Record a line under `## Notes`, dated: where a card stands, or why it moved. Plan issues keep their own record. */
export function note(board, id, text, at) {
  const card = need(board, id);
  if (isPlan(card)) throw refuse(`${card.id} is a plan issue: its record is the plan's, so say it in the branch that works it`);
  if (!String(text ?? "").trim()) throw usage('note needs the text: {cli} note <id> "<what changed>"');
  return { cards: [{ ...card, updated: at, body: appendToSection(card.body, "Notes", `- ${at}: ${text.trim().replace(/\s*\n\s*/g, " ")}`) }] };
}

/** The id the next sprint gets: `s` and one past the highest number in use. */
export const nextSprintId = (board) => `s${Math.max(0, ...board.sprints.map((s) => Number.parseInt(s.id.replace(/^s/, ""), 10) || 0)) + 1}`;

const withSprints = (board, sprints) => ({ ...configOf(board), sprints });

/** A new planned sprint, numbered after the highest so far. */
export function sprintNew(board, { title, goal = "", start = "", end = "" } = {}) {
  if (!String(title ?? "").trim()) throw usage("a sprint needs a title");
  const sprint = { id: nextSprintId(board), title: title.trim(), goal: goal.trim(), start: start.trim(), end: end.trim(), state: "planned", closed: null };
  return { cards: [], config: withSprints(board, [...board.sprints, sprint]), sprint };
}

/** Change a sprint's `title`, `goal`, `start` or `end`. */
export function sprintEdit(board, id, patch = {}) {
  const sprint = board.sprints.find((s) => s.id === id);
  if (!sprint) throw usage(`no sprint "${id}" ({cli} sprint list shows them)`);
  const next = { ...sprint };
  for (const key of ["title", "goal", "start", "end"]) if (patch[key] !== undefined) next[key] = String(patch[key]).trim();
  if (!next.title) next.title = sprint.id;
  return { cards: [], config: withSprints(board, board.sprints.map((s) => (s === sprint ? next : s))), sprint: next };
}

/** Start a planned sprint (the first planned one when no id is given). One sprint is active at a time. `day` is today's date. */
export function sprintStart(board, id, day) {
  const sprint = id ? board.sprints.find((s) => s.id === id) : board.sprints.find((s) => s.state === "planned");
  if (!sprint) throw usage(id ? `no sprint "${id}" ({cli} sprint list shows them)` : 'no planned sprint: {cli} sprint new "<title>" first');
  if (sprint.state !== "planned") throw usage(`sprint ${sprint.id} is ${sprint.state}; only a planned sprint starts`);
  if (activeSprint(board)) throw usage(`sprint ${activeSprint(board).id} is still active: close it first`);
  const started = { ...sprint, state: "active", start: sprint.start || day };
  return { cards: [], config: withSprints(board, board.sprints.map((s) => (s === sprint ? started : s))), sprint: started };
}

/**
 * Close a sprint (the active one when no id is given): its cards in a done column are archived, the rest roll on to
 * the next planned sprint, else to no sprint. The change also carries `sprint` (as closed) and `next` (or null).
 */
export function sprintClose(board, id, at) {
  const wanted = id || activeSprint(board)?.id;
  if (!wanted) throw usage("no sprint is active: name the one to close");
  const sprint = board.sprints.find((s) => s.id === wanted);
  if (!sprint || sprint.state === "closed") throw usage(`no open sprint "${wanted}"`);
  const next = board.sprints.find((s) => s.id !== wanted && s.state === "planned") ?? null;
  const cards = [];
  let done = 0;
  for (const c of board.cards.filter((x) => x.sprint === wanted && x.status !== ARCHIVED && !isPlan(x))) {
    if (roleIds(board, "done").includes(c.status)) {
      done++;
      cards.push({ ...c, status: ARCHIVED, updated: at });
    } else {
      const { sprint: _, ...rest } = c;
      cards.push({ ...rest, ...(next ? { sprint: next.id } : {}), updated: at });
    }
  }
  const closed = { ...sprint, state: "closed", closed: { at, done, rolled: cards.length - done } };
  return { cards, config: withSprints(board, board.sprints.map((s) => (s === sprint ? closed : s))), sprint: closed, next };
}

/** Back to the first column without its binding: the session, branch, worktree, change request, and grant go. A finished card is refused. */
export function abandon(board, id, at) {
  const card = need(board, id);
  if (isFinished(board, card)) throw refuse(`${card.id} is ${card.status}: there is nothing to abandon`);
  const moved = planMove(board, card.id, backlogId(board), { settled: true }).cards;
  const cards = (moved.some((c) => c.id === card.id) ? moved : [...moved, { ...card }]).map((c) => {
    if (c.id !== card.id) return c;
    const { session, branch, worktree, mr, grant, ...rest } = c;
    return rest;
  });
  return { cards: stamped(cards, at) };
}

// The file a new card is written to, for callers that hold only this module.
export { cardFile };
