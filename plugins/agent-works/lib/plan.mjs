// Plan issues as board cards. The planning plugin keeps its backlog in issue
// files under .agents/plan/plan/<EE-epic>/<SS-sprint>/issues/ and owns every
// status change through one funnel, plan-status.mjs. So a plan card is read
// only: its fields come from the issue file on the base branch, its lane is
// derived, and the loop's own fields (session, branch, worktree, mr) live in a
// shadow file `plan-EE-SS-II.md` beside the cards. A move never edits an
// issue here: it says which status the funnel sets in the card's worktree.
//
// Pure: texts in, cards out. The caller reads the tree and runs the funnel.
import { BoardError, VIRTUAL } from "./board.mjs";

const ISSUE_PATH = /^\.agents\/plan\/plan\/(\d{2})-[^/]+\/(\d{2})-[^/]+\/issues\/(\d{2})_issue_[A-Z][A-Z0-9-]+\.md$/;
const DISPATCH_PATH = /^\.agents\/plan\/progress\/dispatch\/\d{2}-\d{2}\.json$/;
/** The tree paths the git side lists: plan issues live under the first, dispatch plans under the second. */
export const PLAN_PATHS = [".agents/plan/plan", ".agents/plan/progress/dispatch"];
/** A shadow file's name; the match gives the issue's coordinates. */
export const SHADOW_FILE = /^plan-(\d{2}-\d{2}-\d{2})\.md$/;
/** The fields the loop keeps on a shadow file. Everything else about a plan card comes from its issue. */
export const LOOP_KEYS = ["session", "branch", "worktree", "mr", "merged", "grant", "updated"];
const BINDING = ["session", "branch", "worktree", "mr", "grant"];

const usage = (message) => new BoardError("usage", message);
const refuse = (message) => new BoardError("refused", message);

/** The shadow file of a plan issue, by its coordinates. */
export const shadowFile = (coords) => `plan-${coords}.md`;
/** A blob worth fetching: an issue file or a dispatch plan. */
export const isPlanSource = (p) => ISSUE_PATH.test(p) || DISPATCH_PATH.test(p);

const field = (text, name) => new RegExp(`\\*\\*${name}\\*\\*:[ \\t]*(\\S+)`).exec(text)?.[1] ?? null;
const section = (text, name) => new RegExp(`^## ${name}[ \\t]*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(text)?.[1] ?? "";

// A link target resolved against the issue's folder, in posix segments.
function resolve(dir, target) {
  const out = dir.split("/");
  for (const seg of target.split("#")[0].split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

/** One issue file, or null for any other path. `Blocked by` links become coordinates. */
export function parseIssue(text, file) {
  const at = ISSUE_PATH.exec(file);
  if (!at) return null;
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const dir = file.split("/").slice(0, -1).join("/");
  const blockedBy = [];
  for (const [, target] of section(body, "Blocked by").matchAll(/\]\(([^)\s]+)\)/g)) {
    const m = ISSUE_PATH.exec(resolve(dir, target));
    if (m && !blockedBy.includes(`${m[1]}-${m[2]}-${m[3]}`)) blockedBy.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  const acceptance = [...section(body, "Acceptance criteria").matchAll(/^[ \t]*[-*][ \t]+\[([ xX])\][ \t]+(.*?)[ \t]*$/gm)]
    .map(([, box, line]) => ({ done: box !== " ", text: line }));
  return {
    coords: `${at[1]}-${at[2]}-${at[3]}`,
    title: /^#\s+(.*?)\s*$/m.exec(body)?.[1] ?? "",
    type: field(body, "Type") ?? "AFK",
    status: field(body, "Status") ?? "not-started",
    tracker: field(body, "Tracker"),
    blockedBy,
    acceptance,
    path: file,
  };
}

/** The column ids for each role, from the board's columns. */
export function laneIds(columns) {
  const role = (r, fallback) => columns.find((c) => c.role === r)?.id ?? fallback;
  return { backlog: columns[0]?.id ?? "backlog", start: role("start", "in-progress"), review: role("review", "review"), done: role("done", "done") };
}

/**
 * The lane: done is done; blocked stays in the backlog (with a badge); an open
 * change request is review; a session, a claimed worktree, or in-progress on the base is
 * in progress; anything else is the backlog.
 */
export function laneOf(status, loop, lanes) {
  if (status === "done") return lanes.done;
  if (status === "blocked") return lanes.backlog;
  if (loop.mr !== undefined) return lanes.review;
  if (loop.session || loop.worktree || status === "in-progress") return lanes.start;
  return lanes.backlog;
}

const loopOf = (shadow = {}) => Object.fromEntries(LOOP_KEYS.filter((k) => shadow[k] !== undefined).map((k) => [k, shadow[k]]));

/**
 * Cards from the plan's blobs (`{ path, text }`), with each card's shadow (parsed
 * cards keyed by coordinates). Returns `{ cards, errors }`; a dispatch file that
 * is not JSON is an error and its files are left out.
 */
export function planCards(sources, { shadows = {}, columns } = {}) {
  const lanes = laneIds(columns);
  const errors = [];
  const files = new Map();
  for (const { path, text } of sources.filter((s) => DISPATCH_PATH.test(s.path))) {
    let plan;
    try { plan = JSON.parse(text); } catch (e) {
      errors.push({ file: path, message: `${path}: ${e.message}` });
      continue;
    }
    for (const unit of (plan.waves ?? []).flatMap((w) => w.units ?? [])) {
      for (const coords of [].concat(unit.coords ?? [])) {
        files.set(coords, [...new Set([...(files.get(coords) ?? []), ...(unit.files ?? []).map(String)])]);
      }
    }
  }
  const cards = [];
  for (const { path, text } of sources) {
    const issue = parseIssue(text, path);
    if (!issue) continue;
    const loop = loopOf(shadows[issue.coords]);
    const human = issue.type === "HITL" || issue.type === "REVIEW";
    cards.push({
      id: issue.coords, title: issue.title, status: laneOf(issue.status, loop, lanes), priority: "normal",
      kind: issue.type === "REVIEW" ? "gate" : "task", source: "plan", plan: issue.coords,
      type: issue.type, planStatus: issue.status, tracker: issue.tracker,
      labels: [], skills: [], after: issue.blockedBy, files: files.get(issue.coords) ?? [], acceptance: issue.acceptance,
      ...(human ? { needs: "the person" } : {}),
      ...(issue.type === "REVIEW" ? { ref: path } : {}),
      ...(issue.status === "blocked" ? { blocked: true } : {}),
      ...loop,
      unknown: [], body: text, file: path,
    });
  }
  return { cards: cards.sort((a, b) => a.id.localeCompare(b.id)), errors };
}

/** A shadow with only the loop fields it still has, plus whatever a person added by hand. */
export function shadowAfter(card, shadow, change) {
  const next = { plan: card.plan, ...loopOf(card), ...change, unknown: shadow?.unknown ?? [], body: shadow?.body ?? "" };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next;
}

/** True when a shadow holds nothing worth keeping: no binding, no change request, nothing hand-written. */
export const shadowEmpty = (s) => !BINDING.some((k) => s[k] !== undefined) && s.merged === undefined && !s.unknown?.length && !s.body?.trim();

/**
 * What moving a plan card does: `{ status, change }`, the plan status the funnel
 * sets in the card's worktree (null for none) and the shadow fields that change.
 * In progress runs the funnel and drops any change request the card had; review records the
 * change request and leaves the issue to the child, whose branch already carries the status
 * its build gave it. Done is refused: a plan issue is done when its change merges.
 */
export function planCardMove(board, card, column, { mr, at } = {}) {
  const lanes = laneIds(board.columns);
  if (!board.columns.some((c) => c.id === column) && !VIRTUAL.includes(column)) {
    throw usage(`no column "${column}": the columns are ${board.columns.map((c) => c.id).join(", ")} (plus ${VIRTUAL.join(" and ")})`);
  }
  if (column === lanes.done) throw refuse(`${card.id} is a plan issue: it is done when its pull or merge request merges, not by a move`);
  if (!card.worktree) throw refuse(`${card.id} is a plan issue bound to no worktree: dispatch it, and its moves run the plan's funnel there`);
  if (column === lanes.start) return { status: "in-progress", change: { mr: undefined, updated: at } };
  if (column === lanes.review) {
    if (mr === undefined) throw usage(`moving plan issue ${card.id} to ${column} takes --mr <number>`);
    return { status: null, change: { mr, updated: at } };
  }
  if (column === lanes.backlog) throw refuse(`${card.id} is a plan issue: {cli} abandon ${card.id} unbinds it and sets the issue back to not-started`);
  throw refuse(`${card.id} is a plan issue: it moves only to ${lanes.start} or ${lanes.review}`);
}

/** Abandoning a plan card: back to not-started in its worktree (when it has one), and the binding dropped. */
export function planCardAbandon(card, at) {
  if (!BINDING.some((k) => card[k] !== undefined)) throw refuse(`${card.id} is bound to nothing: there is nothing to abandon`);
  return { status: card.worktree ? "not-started" : null, change: { ...Object.fromEntries(BINDING.map((k) => [k, undefined])), updated: at } };
}
