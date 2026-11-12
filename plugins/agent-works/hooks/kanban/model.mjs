// What the pane draws, worked out from the board: the scope the lanes are
// narrowed to, the lanes and their cards, the line that says where the sprint
// or the epic stands, and what closing a sprint would do. Pure: the board the
// CLI read and the pane's own choices in, plain data out. The rules themselves
// (what is ready, what a scope holds, an epic's progress) are lib/board.mjs's,
// the same ones the CLI answers with.
import {
  ARCHIVED, SUGGESTED, activeSprint, byPlace, epicProgress, holdOf, inScope, isEpic, isGate, isKnownStatus, openEpics, progressBar, ready, roleIds,
  sprintClose,
} from "../../lib/board.mjs";

/** A board card is never wider than this, so a longer title or tag line never reaches a Client's props. */
const CARD_CHARS = 80;
const EPIC_CHARS = 24;

export const clip = (s, n) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/** The scopes the Scope button walks: the sprint only while one is active. An epic's scope is entered from the epic. */
export const scopeCycle = (board) => (activeSprint(board) ? ["sprint", "backlog", "all"] : ["backlog", "all"]);

/**
 * The scope the lanes show: the person's choice while it still names something (the sprint scope needs an active
 * sprint, an epic's scope an epic), else the board's default: the active sprint, or every card.
 */
export function scopeOf(board, chosen) {
  const fallback = activeSprint(board) ? "sprint" : "all";
  if (chosen === null || chosen === undefined) return fallback;
  if (chosen === "sprint") return fallback;
  if (chosen === "backlog" || chosen === "all") return chosen;
  return board.cards.some((c) => c.id === chosen && isEpic(c)) ? chosen : fallback;
}

/** The scope in a word, for the Scope button: sprint, backlog, all, or epic. */
export const scopeKind = (scope) => (["sprint", "backlog", "all"].includes(scope) ? scope : "epic");

/** The scope after this one on the Scope button. */
export function nextScope(board, scope) {
  const order = scopeCycle(board);
  return order[(order.indexOf(scope) + 1) % order.length];
}

/** The open cards the lanes hold in a scope, gates only when the filter is on. Epics are never in a lane. */
export function shownCards(board, scope, gatesOnly = false) {
  return board.cards.filter((c) => c.status !== ARCHIVED && inScope(board, c, scope) && (!gatesOnly || isGate(c)));
}

/** What the lanes are narrowed to, in a line: the sprint and its progress, the backlog, an epic, or all. */
export function scopeLine(board, scope) {
  const cards = shownCards(board, scope);
  const done = roleIds(board, "done");
  const finished = cards.filter((c) => done.includes(c.status)).length;
  const sprint = activeSprint(board);
  if (scope === "sprint" && sprint) {
    return [`Sprint ${sprint.id}`, sprint.title, sprint.end ? `ends ${sprint.end}` : "", `${finished}/${cards.length} done`].filter(Boolean).join(" · ");
  }
  if (scope === "backlog") return `Backlog: ${cards.length} card(s) in no sprint`;
  if (scope === "all" || scope === "sprint") return `All cards: ${cards.length}`;
  const epic = board.cards.find((c) => c.id === scope);
  return `Epic ${scope} · ${epic?.title ?? "(gone)"} · ${progressBar(progressOf(board, scope))}`;
}

/** An epic's finished and counted cards; zeros for an id that is no epic any more. */
export function progressOf(board, id) {
  try {
    const { done, total } = epicProgress(board, id);
    return { done, total };
  } catch {
    return { done: 0, total: 0 };
  }
}

/** The sprint and epic a card made or accepted while the board shows `scope` goes into; each undefined when the scope names none. */
export function plannedFor(board, scope) {
  return {
    sprint: scope === "sprint" && activeSprint(board) ? "active" : undefined,
    epic: scopeKind(scope) === "epic" ? scope : undefined,
  };
}

function metaOf(card, epicTitle) {
  return [
    epicTitle ? `◆ ${clip(epicTitle, EPIC_CHARS)}` : "", card.source === "plan" ? "plan" : "", card.ref ? `for ${card.ref}` : "", card.owner ? `@${card.owner}` : "",
    card.remote ? `#${card.remote.number}` : "", card.blocked ? "blocked" : "", card.priority !== "normal" ? card.priority : "", (card.labels ?? []).join(", "),
    card.session ? card.session : "", card.mr !== undefined ? `!${card.mr}` : "", card.needs && !isGate(card) ? `needs ${card.needs}` : "",
    card.source === "claude" ? "by Claude" : "", card.skills?.length ? `skills: ${card.skills.length}` : "",
  ].filter(Boolean).join(" · ");
}

/**
 * The lanes as both drawings take them, plain data: Suggested first while it holds a card, then one lane per column,
 * each card `{ id, title, meta, mark }`. `mark` is `gate`, `queued` (asked to start, not started yet), `ready`, or
 * null. A card whose status names no column is drawn in the first.
 */
export function lanesOf(board, { scope, gatesOnly = false, queue = [] } = {}) {
  const shown = shownCards(board, scope, gatesOnly).sort(byPlace(board));
  const readyIds = new Set(ready(board).map((c) => c.id));
  const epics = new Map(board.cards.filter(isEpic).map((c) => [c.id, c.title]));
  const first = board.columns[0]?.id;
  const view = (c) => ({
    id: c.id, title: clip(c.title, CARD_CHARS), meta: clip(metaOf(c, c.epic ? epics.get(c.epic) ?? c.epic : ""), CARD_CHARS),
    mark: isGate(c) ? "gate" : queue.includes(c.id) ? "queued" : readyIds.has(c.id) ? "ready" : null,
  });
  const lanes = board.columns.map((col) => ({
    id: col.id, title: col.title, role: col.role ?? null,
    cards: shown.filter((c) => c.status === col.id || (col.id === first && !isKnownStatus(board, c.status))).map(view),
  }));
  const suggested = shown.filter((c) => c.status === SUGGESTED).map(view);
  if (suggested.length) lanes.unshift({ id: SUGGESTED, title: "Suggested", role: "suggested", cards: suggested });
  return lanes;
}

/**
 * The place the CLI is asked for when a card is put at `slot` of a drawn lane: its index among every card of that
 * column, the ones the scope or the gates filter hides included. Undefined puts it at the end.
 */
export function placeAt(board, lanes, id, to, slot) {
  const shown = (lanes.find((l) => l.id === to)?.cards ?? []).map((c) => c.id).filter((x) => x !== id);
  const full = board.cards.filter((c) => c.status === to && c.id !== id && c.source !== "plan").sort(byPlace(board)).map((c) => c.id);
  if (slot < shown.length) {
    const at = full.indexOf(shown[slot]);
    return at === -1 ? undefined : at;
  }
  const last = full.indexOf(shown.at(-1));
  return last === -1 ? undefined : last + 1;
}

/** What an empty board says: how to add the first card, or which scope hides the rest. */
export function emptyLine(board, scope, gatesOnly = false) {
  if (gatesOnly) return "No gates owed in this scope. Press g for every card.";
  if (scope === "all" || (scope === "sprint" && !activeSprint(board))) return "No cards yet. Add one with + New, or press n here.";
  const label = scope === "sprint" ? `sprint ${activeSprint(board).id}` : scope === "backlog" ? "the backlog" : `epic ${scope}`;
  return `No cards in ${label}. Press n to add one here, or v for another scope.`;
}

/** How many open cards name a column this board lacks. */
export const strayCount = (board) => board.cards.filter((c) => !isKnownStatus(board, c.status)).length;

/** The open gates on the board, for the filter's count. */
export const gateCount = (board) => board.cards.filter((c) => isGate(c) && c.status !== ARCHIVED).length;

export { openEpics };

/** Why a card does not start, in words, or null when it is ready. */
export function notStarting(board, card) {
  const hold = holdOf(board, card);
  if (!hold) return null;
  const backlog = board.columns[0]?.title ?? "the first column";
  if (hold.why === "status") return card.status === SUGGESTED ? `a suggestion is accepted into ${backlog} before it starts.` : `only a ready card in ${backlog} starts.`;
  if (hold.why === "needs") return `it needs ${hold.needs}.`;
  if (hold.why === "blocked") return "it is blocked.";
  if (hold.why === "waiting") return `it waits on ${hold.on.join(", ")}.`;
  return null;
}

/** What closing a sprint would do, in a sentence, worked out the way the CLI closes it; null when it cannot close. */
export function closePreview(board, id) {
  try {
    const { sprint, next } = sprintClose(board, id, "");
    return `${sprint.closed.done} done card(s) archived, ${sprint.closed.rolled} unfinished card(s) to ${next ? `sprint ${next.id}` : "the backlog"}.`;
  } catch {
    return null;
  }
}

/** How many open cards a sprint holds. */
export const sprintCount = (board, id) => board.cards.filter((c) => c.sprint === id && c.status !== ARCHIVED).length;
