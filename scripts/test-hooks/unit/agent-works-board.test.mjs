// The board's rules, without a disk: how board.json reads, where a moved card
// lands, what a scope shows, what is ready to start, how a sprint closes, how
// a check nobody could run is owed and later settled, and what lint reports.
// Every operation is pure and returns the cards (and the board config) it
// changed, so these tests build a board in memory and read the change back.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoardError, abandon, addCard, boardConfig, briefLine, cardLine, configOf, doneColumn, editCard, epicProgress, findCard, findDuplicate, held, holdOf,
  inScope, isKnownStatus, lint, lintFix, listing, listingLines, nextSprintId, note, openEpics, owe, parseScope, planCard, planMove, progressBar, ready,
  reorder, roleIds, scopeLabel, serializeConfig, settle, sprintClose, sprintEdit, sprintLine, sprintNew, sprintStart, summary, timeOf,
} from "../../../plugins/agent-works/lib/board.mjs";

const T0 = "2026-10-01T09:00:00.000Z";
const AT = "2026-10-20T12:00:00.000Z";
const NOW = Date.parse(AT);
const DAY = 24 * 60 * 60 * 1000;

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, status: "backlog", order: Number(id), priority: "normal", kind: "task", source: "user",
  labels: [], skills: [], after: [], files: [], unknown: [], body: "", file: `${id}-card-${id}.md`,
  created: T0, updated: T0, ...over,
});
const board = (cards, config = {}) => ({ ...boardConfig(config), cards });
const ids = (cards) => cards.map((c) => c.id);
const byId = (change, id) => change.cards.find((c) => c.id === id);
const refused = (fn, pattern) => assert.throws(fn, (e) => e instanceof BoardError && e.kind === "refused" && pattern.test(e.message));
const usage = (fn, pattern) => assert.throws(fn, (e) => e instanceof BoardError && e.kind === "usage" && pattern.test(e.message));
const sprint = (id, state, more = {}) => ({ id, title: `Sprint ${id}`, goal: "", start: "", end: "", state, closed: null, ...more });

// ---- board.json ---------------------------------------------------------

// A board.json a person edited: comments stand for what each line pins.
const SPRINT_CONFIG = `{
  "columns": [
    { "id": "todo", "title": "To do" },
    { "id": "doing", "title": "Doing", "role": "start" },
    { "title": "no id" },
    { "id": "done", "title": "Done", "role": "done" }
  ],
  "sprints": [
    { "id": "s1", "title": "First", "state": "closed", "closed": { "at": "2026-01-14T00:00:00.000Z", "done": 4, "rolled": 1 } },
    { "id": "s2", "title": "Second", "goal": "Ship it", "start": "2026-01-15", "end": "2026-01-29", "state": "active" },
    { "id": "s3", "state": "active" },
    { "title": "no id" },
    { "id": "s4", "title": "", "state": "someday", "closed": "no" }
  ],
  "theme": "dark"
}`;

test("boardConfig fills the four default columns, no sprints, new sessions, no tracker, two in parallel", () => {
  const c = boardConfig();
  assert.deepEqual(c.columns.map((col) => [col.id, col.title, col.role]), [["backlog", "Backlog", null], ["in-progress", "In progress", "start"], ["review", "Review", "review"], ["done", "Done", "done"]]);
  assert.deepEqual([c.sprints, c.startMode, c.remote, c.parallel, c.extra], [[], "new-session", { enabled: false }, 2, {}]);
  assert.deepEqual(boardConfig("not an object").columns, c.columns);
  assert.deepEqual(boardConfig({ columns: [], startMode: "soon", remote: { enabled: "yes" }, parallel: 0 }), c);
  assert.deepEqual([boardConfig({ parallel: 4 }).parallel, boardConfig({ startMode: "queue" }).startMode, boardConfig({ remote: { enabled: true } }).remote.enabled], [4, "queue", true]);
});

test("board.json sprints read with their defaults: no id no sprint, one active at most", () => {
  const c = boardConfig(JSON.parse(SPRINT_CONFIG));
  assert.deepEqual(c.columns, [{ id: "todo", title: "To do", role: null }, { id: "doing", title: "Doing", role: "start" }, { id: "done", title: "Done", role: "done" }]);
  assert.deepEqual(c.sprints, [
    sprint("s1", "closed", { title: "First", closed: { at: "2026-01-14T00:00:00.000Z", done: 4, rolled: 1 } }),
    sprint("s2", "active", { title: "Second", goal: "Ship it", start: "2026-01-15", end: "2026-01-29" }),
    sprint("s3", "planned", { title: "s3" }),
    sprint("s4", "planned", { title: "s4" }),
  ]);
  assert.equal(nextSprintId(c), "s5");
  assert.deepEqual(c.extra, { theme: "dark" });
  // What is written reads back the same, and keeps the key nobody here knows.
  const written = serializeConfig(c);
  assert.deepEqual(boardConfig(JSON.parse(written)), c);
  assert.deepEqual(Object.keys(JSON.parse(written)), ["columns", "startMode", "remote", "sprints", "theme"]);
  assert.deepEqual(Object.keys(JSON.parse(serializeConfig(boardConfig()))), ["columns", "startMode", "remote"]);
  assert.equal(JSON.parse(serializeConfig({ ...boardConfig(), parallel: 3 })).parallel, 3);
  assert.deepEqual(configOf({ ...c, cards: [], errors: [] }), c);
});

test("roles: a board made before the review role reads its review column as the one", () => {
  const before = board([], { columns: [{ id: "backlog", title: "Backlog", role: null }, { id: "in-progress", title: "In progress", role: "start" }, { id: "review", title: "Review", role: null }, { id: "done", title: "Done", role: "done" }] });
  assert.deepEqual([roleIds(before, "review"), roleIds(before, "start"), roleIds(before, "done")], [["review"], ["in-progress"], ["done"]]);
  const own = board([], { columns: [{ id: "todo", title: "To do" }, { id: "check", title: "Check", role: "review" }, { id: "review", title: "Old" }] });
  assert.deepEqual(roleIds(own, "review"), ["check"]);
  assert.equal(doneColumn(own).id, "review", "no done role: the last column");
  assert.ok(isKnownStatus(own, "suggested") && isKnownStatus(own, "archived") && isKnownStatus(own, "check") && !isKnownStatus(own, "done"));
});

// ---- finding and listing --------------------------------------------------

test("a card is found by its id as a person types it", () => {
  const b = board([card("0007"), card("01-02-03", { source: "plan" })]);
  assert.deepEqual([findCard(b, "7").id, findCard(b, " 0007 ").id, findCard(b, "01-02-03").id, findCard(b, "8")], ["0007", "0007", "01-02-03", null]);
});

test("scopes: the active sprint, the cards in no sprint, an epic's cards, the gates owed, the plan", () => {
  const b = board([
    card("0001", { kind: "epic" }), card("0002", { sprint: "s1", epic: "0001" }), card("0003"), card("0004", { status: "suggested" }),
    card("0005", { kind: "gate", ref: "x", sprint: "s1" }), card("0006", { status: "archived", sprint: "s1" }), card("0007", { kind: "gate", ref: "y", status: "done" }),
    card("01-01-01", { source: "plan", order: undefined }),
  ], { sprints: [sprint("s1", "active")] });
  assert.deepEqual(["", "sprint", "BACKLOG", "all", "gates", "plan", "1", "0001"].map((s) => parseScope(b, s)), ["sprint", "sprint", "backlog", "all", "gates", "plan", "0001", "0001"]);
  usage(() => parseScope(b, "0002"), /no scope "0002": sprint, backlog, all, gates, plan, or an epic's card id/);
  assert.equal(parseScope(board([]), ""), "all", "no active sprint: everything");
  assert.deepEqual(["sprint", "backlog", "all", "0001", "gates"].map((s) => scopeLabel(b, s)), ["sprint s1", "backlog", "all", "epic 0001", "gates"]);
  assert.equal(scopeLabel(board([]), "sprint"), "all");

  assert.deepEqual(ids(listing(b, "sprint")), ["0004", "0002", "0005"], "a suggestion shows in every scope, an epic in none");
  assert.deepEqual(ids(listing(b, "backlog")), ["0004", "0003", "01-01-01", "0007"]);
  assert.deepEqual(ids(listing(b, "all")), ["0004", "0002", "0003", "0005", "01-01-01", "0007"]);
  assert.deepEqual(ids(listing(b, "0001")), ["0004", "0002"]);
  assert.deepEqual(ids(listing(b, "gates")), ["0005"]);
  assert.deepEqual(ids(listing(b, "plan")), ["01-01-01"]);
  assert.equal(inScope(board([card("0002", { sprint: "s9" })]), card("0002", { sprint: "s9" }), "sprint"), true);

  assert.deepEqual(listingLines(b, "sprint"), [
    "Columns: backlog, in-progress, review, done (plus suggested)",
    'Sprint s1 "Sprint s1" (active)',
    "Epic 0001 ▱▱▱▱▱▱▱▱ 0/1: Card 0001",
    "Scope: sprint s1",
    "0004 [suggested] task: Card 0004",
    "0002 [backlog] task: Card 0002 (epic 0001; sprint s1)",
    "0005 [backlog] gate: Card 0005 (for x; sprint s1)",
    '3 more open card(s) outside this scope (scope "all" lists them).',
  ]);
  assert.deepEqual(listingLines(b, "all", "gate").slice(3), ["0005 [backlog] gate: Card 0005 (for x; sprint s1)", "0007 [done] gate: Card 0007 (for y)"]);
  assert.deepEqual(listingLines(board([]), "all"), ["Columns: backlog, in-progress, review, done (plus suggested)", "No cards in this scope."]);
});

test("a card in a line: owner, what it is for and needs, where it is planned and bound", () => {
  assert.equal(cardLine(card("0009", { kind: "gate", owner: "kim", ref: "#213", needs: "a phone", epic: "0001", sprint: "s2" })), "0009 [backlog] gate @kim: Card 0009 (for #213; needs a phone; epic 0001; sprint s2)");
  assert.equal(cardLine(card("0002", { status: "review", session: "card-0002", mr: 12 })), "0002 [review] task: Card 0002 (session card-0002; !12)");
  assert.equal(cardLine(card("01-01-01", { source: "plan", blocked: true })), "01-01-01 [backlog] plan task: Card 01-01-01 (blocked)");
  assert.equal(sprintLine(sprint("s1", "active", { title: "Polish", end: "2026-03-01", goal: "Ship" })), 'Sprint s1 "Polish" (active, ends 2026-03-01): Ship');
  assert.deepEqual([progressBar({ done: 2, total: 8 }), progressBar({ done: 1, total: 3 }, 4), progressBar({ done: 0, total: 0 })], ["▰▰▱▱▱▱▱▱ 2/8", "▰▱▱▱ 1/3", "▱▱▱▱▱▱▱▱ 0/0"]);
});

test("ready is the backlog nobody has to unblock: the sprint's first, then by priority, then in order", () => {
  const b = board([
    card("0001", { priority: "low" }), card("0002", { priority: "high" }), card("0003", { sprint: "s1" }), card("0004", { needs: "a person" }),
    card("0005", { after: ["0001"] }), card("0006", { after: ["0009"] }), card("0007", { kind: "gate", ref: "x" }), card("0008", { kind: "epic" }),
    card("0009", { status: "done" }), card("0010", { status: "in-progress" }), card("0011", { blocked: true }),
  ], { sprints: [sprint("s1", "active")] });
  assert.deepEqual(ids(ready(b)), ["0003", "0002", "0006", "0001"]);
  assert.deepEqual(held(b), { gates: 1, needs: 1, blocked: 1, waiting: 1 });
  assert.deepEqual([holdOf(b, b.cards[0]), holdOf(b, b.cards[3]), holdOf(b, b.cards[4]), holdOf(b, b.cards[6]), holdOf(b, b.cards[7]), holdOf(b, b.cards[9]), holdOf(b, b.cards[10])],
    [null, { why: "needs", needs: "a person" }, { why: "waiting", on: ["0001"] }, { why: "gate" }, { why: "epic" }, { why: "status", status: "in-progress" }, { why: "blocked" }]);
});

test("an epic's progress counts its cards, finished or archived, and not a suggestion", () => {
  const b = board([
    card("0001", { kind: "epic" }), card("0002", { epic: "0001", status: "done" }), card("0003", { epic: "0001", status: "archived" }), card("0004", { epic: "0001" }),
    card("0005", { epic: "0001", status: "suggested" }), card("0006", { kind: "epic", status: "done" }), card("0007", { kind: "epic", status: "archived" }),
  ]);
  assert.deepEqual(epicProgress(b, "1"), { id: "0001", title: "Card 0001", done: 2, total: 3 });
  usage(() => epicProgress(b, "0002"), /"0002" is no epic/);
  assert.deepEqual(ids(openEpics(b)), ["0001"]);
});

test("a duplicate is an open card of the same title; for a gate, one owed for the same thing", () => {
  const b = board([card("0001", { title: "Fix the Flaky  Sync!" }), card("0002", { title: "Shipped", status: "done" }), card("0003", { title: "Run smoke", kind: "gate", ref: "#1" }), card("0004", { title: "Gone", status: "archived" })]);
  assert.equal(findDuplicate(b, "fix the flaky sync").id, "0001");
  assert.equal(findDuplicate(b, "Fíx the flaky sync").id, "0001");
  assert.equal(findDuplicate(b, "shipped"), null, "a finished card is no duplicate");
  assert.equal(findDuplicate(b, "gone"), null);
  assert.equal(findDuplicate(b, "run smoke", "#1").id, "0003");
  assert.equal(findDuplicate(b, "run smoke", "#2"), null, "the same check owed for another change is another gate");
  assert.equal(findDuplicate(b, "fix the flaky sync", "#1"), null);
});

// ---- adding and moving ------------------------------------------------------

test("addCard takes the next id and the end of its lane, and names its file once", () => {
  const b = board([card("0003", { order: 4 }), card("0009", { status: "review", order: 0 }), card("01-01-01", { source: "plan" })], { sprints: [sprint("s1", "active")] });
  const [c] = addCard(b, { title: "  Café menu ", labels: ["a"], owner: "", sprint: "active", after: ["3"].map((id) => findCard(b, id).id), body: "Body" }, AT).cards;
  assert.deepEqual([c.id, c.file, c.title, c.status, c.order, c.sprint, c.created, c.updated, c.owner, c.after], ["0010", "0010-cafe-menu.md", "Café menu", "backlog", 5, "s1", AT, AT, undefined, ["0003"]]);
  assert.deepEqual([addCard(b, { title: "x", status: "review" }, AT).cards[0].order, addCard(b, { title: "x", status: "done" }, AT).cards[0].order, addCard(b, { title: "x", status: "suggested" }, AT).cards[0].status], [1, 0, "suggested"]);
  usage(() => addCard(b, { title: " " }, AT), /a card needs a title/);
  usage(() => addCard(b, { title: "x", status: "nowhere" }, AT), /no column "nowhere": the columns are backlog, in-progress, review, done$/);
  usage(() => addCard(b, { title: "x", epic: "0003" }, AT), /"0003" is no epic/);
  usage(() => addCard(b, { title: "x", sprint: "s9" }, AT), /no open sprint "s9" \(open: s1\)/);
  usage(() => addCard(b, { title: "x", kind: "spike" }, AT), /--kind is task, gate, epic/);
  usage(() => addCard(b, { title: "x", after: ["0404"] }, AT), /no card with id "0404"/);
});

test("planMove puts a card at an index of its lane and renumbers that lane from 0", () => {
  const b = board([card("0001", { status: "review", order: 0 }), card("0002", { status: "review", order: 1 }), card("0003")]);
  const change = planMove(b, "3", "review", { index: 1, at: AT });
  assert.deepEqual(change.cards.map((c) => [c.id, c.status, c.order, c.updated]), [["0003", "review", 1, AT], ["0002", "review", 2, AT]]);
  assert.deepEqual(planMove(b, "0003", "review").cards.map((c) => [c.id, c.order]), [["0003", 2]], "the end by default; nothing else is rewritten");
  assert.deepEqual(planMove(b, "0002", "review").cards, [], "already there");
  assert.deepEqual(reorder(b, "0002", 0, AT).cards.map((c) => [c.id, c.order]), [["0002", 0], ["0001", 1]]);
  assert.deepEqual(planMove(b, "0003", "archived").cards.map((c) => [c.status, c.order]), [["archived", 0]]);
  usage(() => planMove(b, "0404", "review"), /no card with id "0404" \(\{cli\} list shows the ids\)/);
  usage(() => planMove(b, "0003", "nowhere"), /no column "nowhere": the columns are backlog, in-progress, review, done \(plus suggested and archived\)/);
});

test("a gate is not moved to done, and a plan issue is not moved at all", () => {
  const b = board([card("0001", { kind: "gate", ref: "x" }), card("01-01-01", { source: "plan" }), card("0002", { status: "backlog", order: 9 })]);
  refused(() => planMove(b, "0001", "done"), /0001 is a gate: settle it with the evidence instead \(\{cli\} settle 0001/);
  assert.equal(byId(planMove(b, "0001", "review"), "0001").status, "review");
  refused(() => planMove(b, "01-01-01", "review"), /plan issue/);
  assert.deepEqual(planMove(b, "0002", "backlog", { index: 0 }).cards.map((c) => [c.id, c.order]), [["0002", 0]], "a plan card is never renumbered");
});

test("editCard changes a card's own fields, takes one off with an empty value, and keeps its file", () => {
  const b = board([card("0001", { kind: "epic" }), card("0002", { owner: "kim", epic: "0001", sprint: "s1", labels: ["a"] }), card("01-01-01", { source: "plan" })], { sprints: [sprint("s1", "planned"), sprint("s2", "closed")] });
  const [c] = editCard(b, "2", { title: " New title ", owner: "", epic: "none", sprint: "s1", labels: ["b", "c"], priority: "high", body: "Text", kind: "gate", ref: "#4" }, AT).cards;
  assert.deepEqual([c.title, c.file, c.owner, c.epic, c.sprint, c.labels, c.priority, c.body, c.kind, c.ref, c.updated], ["New title", "0002-card-0002.md", undefined, undefined, "s1", ["b", "c"], "high", "Text", "gate", "#4", AT]);
  assert.equal(editCard(b, "2", { body: "" }, AT).cards[0].body, "");
  usage(() => editCard(b, "2", { title: " " }, AT), /needs a title/);
  usage(() => editCard(b, "2", { priority: "urgent" }, AT), /--priority is low, normal, high/);
  usage(() => editCard(b, "2", { sprint: "s2" }, AT), /no open sprint "s2" \(open: s1\)/);
  usage(() => editCard(b, "1", { epic: "1" }, AT), /an epic is not a card of its own/);
  refused(() => editCard(b, "01-01-01", { title: "x" }, AT), /plan issue/);
  assert.deepEqual([planCard(b, "2", { sprint: "none" }, AT).cards[0].sprint, planCard(b, "2", { epic: "1" }, AT).cards[0].epic], [undefined, "0001"]);
  usage(() => planCard(b, "2", {}, AT), /nothing to change: give --epic or --sprint/);
  usage(() => planCard(b, "2", { sprint: "active" }, AT), /no sprint is active/);
});

// ---- gates ----------------------------------------------------------------

test("owe files a gate with what it is for and what it needs, in the active sprint", () => {
  const b = board([card("0004")], { sprints: [sprint("s1", "active")] });
  const [gate] = owe(b, { title: "Run the smoke gate", ref: " #213 ", needs: "the main checkout", owner: "kim", body: "`npm run smoke`" }, AT).cards;
  assert.deepEqual([gate.id, gate.kind, gate.status, gate.ref, gate.needs, gate.owner, gate.sprint, gate.body, gate.order], ["0005", "gate", "backlog", "#213", "the main checkout", "kim", "s1", "`npm run smoke`", 5]);
  for (const missing of [{ ref: "x", needs: "y" }, { title: "t", needs: "y" }, { title: "t", ref: "x" }]) usage(() => owe(b, missing, AT), /a gate needs a title, what it is owed for \(--ref\) and what running it needs \(--needs\)/);
});

test("settle records the evidence and moves the gate to the end of done", () => {
  const b = board([card("0001", { kind: "gate", ref: "x", body: "`npm run smoke`" }), card("0002", { status: "done", order: 0 }), card("0003"), card("0004", { kind: "gate", ref: "y", status: "done" }),
    card("0005", { kind: "gate", ref: "z", body: "## Evidence\n\n## Notes" })]);
  const change = settle(b, "1", " 27 of 27 ", AT, "w1");
  assert.deepEqual(change.cards.map((c) => [c.id, c.status, c.order, c.updated]), [["0004", "done", 1, AT], ["0001", "done", 2, AT]], "the done lane is renumbered with it");
  assert.equal(byId(change, "0001").body, `\`npm run smoke\`\n\nSettled ${AT} by w1: 27 of 27`);
  assert.equal(byId(settle(b, "5", "looked", AT), "0005").body, `## Evidence\n\nSettled ${AT}: looked\n\n## Notes`);
  usage(() => settle(b, "3", "x", AT), /card 0003 is a task, not a gate: use \{cli\} move/);
  usage(() => settle(b, "4", "x", AT), /gate 0004 is already settled/);
  usage(() => settle(b, "1", " ", AT), /settled with its evidence/);
  const custom = board([card("0001", { kind: "gate", ref: "x", status: "todo" })], { columns: [{ id: "todo", title: "To do" }, { id: "shipped", title: "Shipped", role: "done" }] });
  assert.equal(settle(custom, "1", "ok", AT).cards[0].status, "shipped");
});

test("a note lands under Notes, dated, on one line", () => {
  const b = board([card("0001", { body: "## Done when\n\n- x\n\n## Notes" })]);
  assert.equal(note(b, "1", "waiting\non a reader", AT).cards[0].body, `## Done when\n\n- x\n\n## Notes\n\n- ${AT}: waiting on a reader`);
});

// ---- sprints --------------------------------------------------------------

test("a sprint is planned, started and closed: done cards archived, the rest rolled on", () => {
  let b = board([card("0001", { sprint: "s1", status: "done" }), card("0002", { sprint: "s1" }), card("0003", { sprint: "s1", status: "archived" }), card("0004")]);
  const planned = sprintNew(b, { title: " Polish ", goal: "Ship", end: "2026-03-01" });
  assert.deepEqual(planned.sprint, sprint("s1", "planned", { title: "Polish", goal: "Ship", end: "2026-03-01" }));
  usage(() => sprintNew(b, { title: "" }), /a sprint needs a title/);
  b = { ...b, ...planned.config };
  b = { ...b, ...sprintNew(b, { title: "Next" }).config };
  assert.deepEqual(b.sprints.map((s) => s.id), ["s1", "s2"]);
  assert.equal(sprintEdit(b, "s2", { goal: " Tidy " }).sprint.goal, "Tidy");
  usage(() => sprintEdit(b, "s9", {}), /no sprint "s9"/);

  const started = sprintStart(b, "s1", "2026-02-01");
  assert.deepEqual([started.sprint.state, started.sprint.start], ["active", "2026-02-01"]);
  assert.equal(sprintStart(b, undefined, "2026-02-01").sprint.id, "s1", "the first planned one");
  b = { ...b, ...started.config };
  usage(() => sprintStart(b, "s2", "2026-02-02"), /sprint s1 is still active: close it first/);
  usage(() => sprintStart(b, "s1", "2026-02-02"), /sprint s1 is active; only a planned sprint starts/);
  usage(() => sprintStart(b, "s9", "2026-02-02"), /no sprint "s9"/);

  const closed = sprintClose(b, undefined, AT);
  assert.deepEqual(closed.cards.map((c) => [c.id, c.status, c.sprint, c.updated]), [["0001", "archived", "s1", AT], ["0002", "backlog", "s2", AT]]);
  assert.deepEqual([closed.sprint.state, closed.sprint.closed, closed.next.id], ["closed", { at: AT, done: 1, rolled: 1 }, "s2"]);
  b = { ...b, ...closed.config };
  usage(() => sprintClose(b, "s1", AT), /no open sprint "s1"/);
  usage(() => sprintClose(b, undefined, AT), /no sprint is active: name the one to close/);
  const last = sprintClose({ ...b, cards: [card("0002", { sprint: "s2" })] }, "s2", AT);
  assert.deepEqual([last.cards[0].sprint, last.next], [undefined, null], "no planned sprint left: back to no sprint");
});

// ---- summary and lint ---------------------------------------------------------

test("summary counts tasks by lane and names what is in flight; the brief line says it in a sentence", () => {
  const b = board([
    card("0001", { status: "in-progress", session: "card-0001", updated: new Date(NOW - 2 * DAY).toISOString() }), card("0002", { status: "review", mr: 12 }), card("0003"),
    card("0004", { kind: "gate", ref: "x" }), card("0005", { status: "suggested" }), card("0006", { kind: "epic" }),
  ]);
  const s = summary(b, NOW);
  assert.deepEqual(s.lanes, { backlog: 1, "in-progress": 1, review: 1, done: 0 });
  assert.deepEqual([s.inProgress, s.review, s.ready, s.owed, s.suggested, s.untouched, s.sprint], [[{ id: "0001", title: "Card 0001", session: "card-0001" }], [{ id: "0002", title: "Card 0002", mr: 12 }], 1, 1, 1, 2, null]);
  assert.equal(briefLine(summary(b)), "Board: 1 in progress (0001 card-0001), 1 in review (0002 !12), 1 ready, 1 gate owed, 1 suggested.");
  assert.equal(briefLine(summary(board([]))), "Board: 0 in progress, 0 in review.");
});

test("times on a card read as dates, with or without a zone", () => {
  assert.deepEqual([timeOf("2026-01-03T10:00:00.000Z"), timeOf("2026-01-03T10:00:00"), timeOf("2026-01-03"), timeOf("soon"), timeOf("")],
    [Date.parse("2026-01-03T10:00:00Z"), Date.parse("2026-01-03T10:00:00Z"), Date.parse("2026-01-03T00:00:00Z"), null, null]);
});

test("lint names what is wrong, card by card", () => {
  const old = new Date(NOW - 30 * DAY).toISOString();
  const b = {
    ...board([
      card("0001"), card("0001", { file: "0002-twin.md" }), card("0003", { file: "by-hand.md" }), card("0004", { file: "0005-other.md" }), card("0006", { title: " " }),
      card("0007", { kind: "spike" }), card("0008", { kind: "gate" }), card("0009", { created: undefined, updated: "soon" }), card("0010", { epic: "0099", sprint: "s7" }),
      card("0011", { status: "blocked" }), card("0012", { status: "in-progress", updated: old }), card("0013", { kind: "gate", ref: "#9", needs: "main", created: old }),
      card("0014", { kind: "gate", ref: "#8", status: "done", created: old }), card("0015", { status: "review" }), card("0016", { status: "review", mr: 3, branch: "feat/x" }),
      card("01-01-01", { source: "plan", status: "in-progress", file: ".agents/plan/plan/01-a/01-b/issues/01_issue_X.md", created: undefined, updated: undefined }),
    ], { sprints: [sprint("s1", "active", { end: "2026-10-18" })] }),
    errors: [{ file: "0020-broken.md", message: "0020-broken.md: no --- fenced frontmatter" }, { file: "board.json", message: "not valid JSON", said: true }],
  };
  const found = lint(b, NOW, { grants: [{ branch: "feat/x", text: "ok" }, { branch: "feat/gone", text: "left" }] });
  const said = found.map((f) => `${f.code} ${f.level} ${f.file}: ${f.message}`);
  for (const line of [
    "KANBAN_CARD_INVALID warning 0020-broken.md: not a card: no frontmatter block (--- … ---) or no id",
    "KANBAN_CARD_INVALID warning board.json: not valid JSON",
    "KANBAN_SPRINT_OVERDUE warning board.json: sprint s1 ended 2026-10-18 and is still active: close it ({cli} sprint close) or move its end",
    "KANBAN_CARD_INVALID warning 0002-twin.md: its id 0001 is also the id of 0001-card-0001.md",
    "KANBAN_CARD_INVALID warning 0002-twin.md: the file name and the id (0001) disagree",
    "KANBAN_CARD_INVALID warning by-hand.md: the file is not named <id>-<slug>.md",
    "KANBAN_CARD_INVALID warning 0005-other.md: the file name and the id (0004) disagree",
    "KANBAN_CARD_INVALID warning 0006-card-0006.md: no title",
    'KANBAN_CARD_INVALID warning 0007-card-0007.md: kind "spike" is not task, gate or epic',
    "KANBAN_CARD_INVALID warning 0008-card-0008.md: a gate without ref: what is it owed for?",
    "KANBAN_CARD_INVALID warning 0009-card-0009.md: created is not a date",
    "KANBAN_CARD_INVALID warning 0009-card-0009.md: updated is not a date",
    'KANBAN_EPIC_UNKNOWN warning 0010-card-0010.md: epic "0099" is no epic card of this board',
    'KANBAN_SPRINT_UNKNOWN warning 0010-card-0010.md: sprint "s7" is no sprint of this board ({cli} sprint list)',
    'KANBAN_STATUS_UNKNOWN warning 0011-card-0011.md: status "blocked" is no column of this board (backlog, in-progress, review, done); the pane shows the card in the first',
    "KANBAN_STALE_START warning 0012-card-0012.md: in in-progress and untouched for 30 days: finish it, hand it back or move it out",
    "GATE_OWED_OLD warning 0013-card-0013.md: owed for #9 for 30 days; needs main",
    "KANBAN_REVIEW_UNLINKED info 0015-card-0015.md: in review with no pull or merge request on the card: {cli} move 0015 review --mr <number>",
    "KANBAN_GRANT_ORPHAN warning : a push grant with no card in flight on branch feat/gone: git config --unset branch.feat/gone.agentic-engineering-push, unless the person granted it by hand",
  ]) assert.ok(said.includes(line), `${line}\n  in\n${said.join("\n")}`);
  assert.ok(!said.some((l) => /0014|0016|01_issue_X|feat\/x\b/.test(l)), "a settled gate, a linked review, a plan issue and a grant in use are fine");
  assert.equal(found.length, 20);
  // The ages are the caller's to set; the last day of a sprint still counts.
  assert.ok(!lint(b, NOW, { staleDays: 40, owedDays: 40 }).some((f) => ["KANBAN_STALE_START", "GATE_OWED_OLD"].includes(f.code)));
  assert.deepEqual(lint(board([], { sprints: [sprint("s1", "active", { end: "2026-10-20" })] }), NOW), []);
  assert.deepEqual(lint(board([card("0001"), card("0002", { kind: "gate", ref: "#1", needs: "x" })]), Date.parse(T0) + DAY), []);
});

test("lintFix gives the newer of two cards a fresh id and brings a lost card back to the first column", () => {
  const b = board([card("0001", { created: "2026-01-01T00:00:00.000Z" }), card("0001", { file: "0002-twin.md", created: "2026-02-01T00:00:00.000Z", status: "blocked", body: "Text" }), card("0005")]);
  const { cards } = lintFix(b, AT);
  assert.deepEqual(cards.map((c) => [c.id, c.status, c.updated]), [["0006", "backlog", AT]]);
  assert.equal(cards[0].body, `Text\n\nlint --fix moved this card to backlog at ${AT}: its status was "blocked", which is no column.`);
  assert.deepEqual(lintFix(board([card("0001")]), AT).cards, []);
});

test("abandon takes a card back to the first column without its binding", () => {
  const b = board([card("0001", { status: "review", session: "s", branch: "feat/x", worktree: "/w", mr: 4, grant: "g", files: ["a"] }), card("0002", { status: "done" }), card("0003", { session: "s" })]);
  const [c] = abandon(b, "1", AT).cards.filter((x) => x.id === "0001");
  assert.deepEqual([c.status, c.session, c.branch, c.worktree, c.mr, c.grant, c.files, c.updated], ["backlog", undefined, undefined, undefined, undefined, undefined, ["a"], AT]);
  assert.equal(abandon(b, "3", AT).cards.find((x) => x.id === "0003").session, undefined, "already in the first column: the binding still goes");
  refused(() => abandon(b, "2", AT), /0002 is done: there is nothing to abandon/);
});
