// The pane's views, drawn from a fixture board with no host and no disk: the
// lanes under each scope and under the gates filter, the epics with their
// progress, the sprints, one card of each kind, a new card, and the settings.
// views.mjs is pure, so a tree is the board plus the pane's own choices, and
// each press reaches a callback this file records.
import assert from "node:assert/strict";
import { test } from "node:test";
import { boardConfig } from "../../../plugins/agent-works/lib/board.mjs";
import { closePreview, lanesOf, nextScope, placeAt, plannedFor, scopeLine, scopeOf } from "../../../plugins/agent-works/hooks/kanban/model.mjs";
import { footLine, pane, syncLine } from "../../../plugins/agent-works/hooks/kanban/views.mjs";
import { TABLES, find, keys, lines, need, words } from "./agent-works-pane-host.mjs";

const card = (id, title, fields = {}) => ({
  id, file: `${id}-card.md`, title, status: "backlog", order: 0, priority: "normal", labels: [], skills: [], source: "user", created: "", updated: "",
  kind: "task", owner: "", needs: "", ref: "", epic: "", sprint: "", body: "", remote: null, extra: [], ...fields,
});

/** A board with an active sprint, a planned and a closed one, an epic with two cards, an owed gate and a settled one. */
function fixture(change = {}) {
  return {
    ...boardConfig({
      startMode: "new-session",
      sprints: [
        { id: "s1", title: "Groundwork", state: "closed", closed: { at: "2030-12-01T10:00:00Z", done: 3, rolled: 1 } },
        { id: "s2", title: "Polish", goal: "Ship the pane", end: "2031-01-15", state: "active" },
        { id: "s3", title: "Later", state: "planned" },
      ],
    }),
    dir: "/repo/.agents/kanban", isOldFolder: false, exists: true,
    cards: [
      card("0001", "Faster sync", { kind: "epic", body: "Sync in under a second." }),
      card("0002", "Cache the listing", { epic: "0001", sprint: "s2", order: 1 }),
      card("0003", "Measure the sync", { epic: "0001", sprint: "s2", status: "done" }),
      card("0004", "Outside the sprint", { order: 2, needs: "a design" }),
      card("0005", "Full suite on main", { kind: "gate", sprint: "s2", order: 3, ref: "PR 7", needs: "the main checkout", source: "claude", body: "npm test\n\n## Evidence\n" }),
      card("0006", "Spotted in passing", { status: "suggested", source: "claude", labels: ["bug"] }),
      card("0007", "Draw the lanes", { status: "in-progress", sprint: "s2", session: "kid-1", priority: "high" }),
      card("0008", "Smoke on staging", { kind: "gate", status: "done", ref: "PR 5", needs: "staging", body: "## Evidence\n\nSettled 2030-12-20: ran it, it held" }),
      card("0009", "Dropped long ago", { status: "archived" }),
      card("0010", "Waits on the cache", { order: 4, after: ["0002"] }),
    ],
    ...change,
  };
}

/** Callbacks that record what a press asked for. */
function recorder() {
  const calls = [];
  const act = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); } });
  return { act, calls };
}

function draw(board, { view = { kind: "board" }, scope = null, gatesOnly = false, selected = null, queue = [], surface = "vscode", columns = 100, client = false, sync = { status: "idle", message: "" }, notice = null, draft = "", skills = [] } = {}) {
  const { act, calls } = recorder();
  const model = { board, error: null, view, selected, scope: scopeOf(board, scope), gatesOnly, queue, sync, notice, draft, skills };
  return { tree: pane(TABLES[surface], model, act, { columns, client }), calls };
}

const laneCards = (lanes) => Object.fromEntries(lanes.map((l) => [l.id, l.cards.map((c) => c.id)]));

test("scope: the active sprint by default, then the backlog, all, and one epic", () => {
  const b = fixture();
  assert.equal(scopeOf(b, null), "sprint");
  assert.deepEqual(laneCards(lanesOf(b, { scope: "sprint" })), { suggested: ["0006"], backlog: ["0002", "0005"], "in-progress": ["0007"], review: [], done: ["0003"] });
  assert.deepEqual(laneCards(lanesOf(b, { scope: "backlog" })), { suggested: ["0006"], backlog: ["0004", "0010"], "in-progress": [], review: [], done: ["0008"] });
  assert.deepEqual(laneCards(lanesOf(b, { scope: "all" })).backlog, ["0002", "0004", "0005", "0010"], "every card but the epic, which is never in a lane");
  assert.deepEqual(laneCards(lanesOf(b, { scope: "0001" })), { suggested: ["0006"], backlog: ["0002"], "in-progress": [], review: [], done: ["0003"] });

  assert.equal(scopeLine(b, "sprint"), "Sprint s2 · Polish · ends 2031-01-15 · 1/5 done");
  assert.equal(scopeLine(b, "backlog"), "Backlog: 4 card(s) in no sprint");
  assert.equal(scopeLine(b, "all"), "All cards: 8");
  assert.equal(scopeLine(b, "0001"), "Epic 0001 · Faster sync · ▰▰▰▰▱▱▱▱ 1/2");

  assert.deepEqual([nextScope(b, "sprint"), nextScope(b, "backlog"), nextScope(b, "all"), nextScope(b, "0001")], ["backlog", "all", "sprint", "sprint"]);
  const none = fixture({ sprints: [] });
  assert.equal(scopeOf(none, null), "all", "no active sprint: every card");
  assert.equal(scopeOf(none, "sprint"), "all", "a sprint scope chosen before the sprint closed falls back");
  assert.equal(scopeOf(b, "0042"), "sprint", "and so does an epic that is gone");
  assert.deepEqual([nextScope(none, "all"), nextScope(none, "backlog")], ["backlog", "all"], "the sprint is on the button only while one is active");
});

test("a card made while the board shows a scope goes into that sprint or epic", () => {
  const b = fixture();
  assert.deepEqual(plannedFor(b, "sprint"), { sprint: "active", epic: undefined });
  assert.deepEqual(plannedFor(b, "0001"), { sprint: undefined, epic: "0001" });
  assert.deepEqual(plannedFor(b, "backlog"), { sprint: undefined, epic: undefined });
  assert.deepEqual(plannedFor(fixture({ sprints: [] }), "sprint"), { sprint: undefined, epic: undefined });
});

test("the gates filter leaves only gates in the lanes, in whatever scope", () => {
  const b = fixture();
  assert.deepEqual(laneCards(lanesOf(b, { scope: "sprint", gatesOnly: true })), { backlog: ["0005"], "in-progress": [], review: [], done: [] });
  assert.deepEqual(laneCards(lanesOf(b, { scope: "all", gatesOnly: true })), { backlog: ["0005"], "in-progress": [], review: [], done: ["0008"] });
  const { tree } = draw(b, { gatesOnly: true });
  assert.equal(line(tree, "gates"), "Showing: gates (2)");
  assert.ok(!words(tree).includes("Cache the listing"));
  assert.match(words(tree), /^0005 Full suite on main gate for PR 7 · by Claude$/m);
  assert.equal(line(draw(b).tree, "gates"), "Showing: all · gates 2");
  const empty = draw(fixture({ cards: fixture().cards.filter((c) => c.kind !== "gate") }), { gatesOnly: true }).tree;
  assert.match(words(empty), /^No gates owed in this scope\. Press g for every card\.$/m);
});

const line = (tree, key, type = "Button") => lines([need(tree, key, type)])[0];

test("the board view: the scope line, the toolbar, a card's marks, and the footer", () => {
  const b = fixture();
  const { tree, calls } = draw(b);
  const drawn = lines(tree);
  assert.equal(drawn[0], "Sprint s2 · Polish · ends 2031-01-15 · 1/5 done");
  assert.deepEqual(keys(tree).filter((k) => !/-\d{4}$/.test(k)), ["new", "scope", "epics", "sprints", "mode", "gates", "settings"]);
  assert.equal(line(tree, "scope"), "Scope: sprint");
  assert.equal(line(tree, "epics"), "Epics 1");
  assert.equal(line(tree, "mode"), "Starts: new session");
  assert.ok(drawn.includes("Suggested 1") && drawn.includes("Backlog 2") && drawn.includes("In progress 1") && drawn.includes("Done 1"));
  assert.equal(line(tree, "card-0002"), "0002 Cache the listing ready ◆ Faster sync");
  assert.equal(line(tree, "card-0007"), "0007 Draw the lanes high · kid-1");
  assert.equal(line(tree, "card-0006"), "0006 Spotted in passing bug · by Claude");
  assert.ok(find(tree, "start-0002"), "a ready card has Start in its lane");
  assert.equal(find(tree, "start-0005"), null, "a gate has none");
  assert.equal(drawn.at(-1), "Ready: 1. Gates owed: 1. Suggested: 1.");

  need(tree, "scope").props.onPress();
  need(tree, "gates").props.onPress();
  need(tree, "mode").props.onPress();
  need(tree, "epics").props.onPress();
  need(tree, "right-0002").props.onPress();
  need(tree, "card-0002").props.onPress();
  need(tree, "start-0002").props.onPress();
  assert.deepEqual(calls, [["cycleScope"], ["toggleGates"], ["startMode", "queue"], ["view", { kind: "epics" }], ["shift", "0002", 1], ["open", "0002"], ["start", "0002"]]);

  const queue = draw(fixture({ startMode: "queue" }), { selected: "0002", queue: ["0002"] }).tree;
  assert.equal(line(queue, "mode"), "Starts: queue here");
  assert.equal(line(queue, "card-0002"), "0002 Cache the listing queued ◆ Faster sync");
  assert.deepEqual(keys(queue).filter((k) => !/-\d{4}$/.test(k)), ["new", "scope", "epics", "sprints", "open", "left", "right", "start", "mode", "gates", "settings"], "a selected card brings its own buttons");
  assert.ok(lines(queue).includes("0002 Cache the listing · sync off"));
});

test("the footer says why nothing is ready, from what holds the first column", () => {
  const b = fixture();
  assert.equal(footLine(b), "Ready: 1. Gates owed: 1. Suggested: 1.");
  const held = fixture({ cards: b.cards.filter((c) => !["0002", "0006"].includes(c.id)) });
  assert.equal(footLine(held), "Nothing ready: the first column holds 1 card waiting on others, 1 card needing a person, 1 gate (settled, not started). Gates owed: 1.");
  assert.equal(footLine(fixture({ cards: [] })), "Nothing ready. Gates owed: 0.");
});

test("a card whose column the board lacks is drawn in the first, and the board says so", () => {
  const b = fixture();
  b.cards.push(card("0011", "From another board", { status: "doing", sprint: "s2", order: 9 }));
  assert.deepEqual(laneCards(lanesOf(b, { scope: "sprint" })).backlog, ["0002", "0005", "0011"]);
  assert.match(words(draw(b).tree), /^1 card\(s\) name a column this board lacks; shown in the first\.$/m);
});

test("the epics view lists the open epics with their progress, opens one, and shows its cards", () => {
  const b = fixture();
  const { tree, calls } = draw(b, { view: { kind: "epics" } });
  assert.match(words(tree), /^▰▰▰▰▱▱▱▱ 1\/2 {2}Faster sync 0001$/m);
  need(tree, "open-0001").props.onPress();
  need(tree, "show-0001").props.onPress();
  need(tree, "new-epic", "Input").props.onSubmit("A bigger goal");
  need(tree, "back").props.onPress();
  assert.deepEqual(calls, [["open", "0001"], ["showEpic", "0001"], ["addEpic", "A bigger goal"], ["back"]]);

  const done = fixture();
  done.cards[0].status = "done";
  assert.match(words(draw(done, { view: { kind: "epics" } }).tree), /^No open epics\.$/m);
  const bare = draw(b, { view: { kind: "epics" }, surface: "bare" }).tree;
  assert.match(words(bare), /^Add one with \/kanban epic <title>\.$/m, "a surface with no text field names the command");
});

test("an epic's card shows its progress and its cards, and offers to break it down", () => {
  const { tree, calls } = draw(fixture(), { view: { kind: "card", id: "0001" } });
  assert.match(words(tree), /^epic Faster sync 0001$/m);
  assert.match(words(tree), /^Cards ▰▰▰▰▱▱▱▱ 1\/2$/m);
  assert.equal(line(tree, "child-0002"), "0002 [backlog] Cache the listing");
  assert.equal(line(tree, "child-0003"), "0003 [done] Measure the sync");
  assert.equal(line(tree, "start"), "Break down");
  assert.equal(find(tree, "epic", "Select"), null, "an epic is in no epic");
  need(tree, "start").props.onPress();
  need(tree, "epic-cards").props.onPress();
  need(tree, "child-0002").props.onPress();
  assert.deepEqual(calls, [["start", "0001"], ["showEpic", "0001"], ["open", "0002"]]);
});

test("the sprints view: the open sprints with their cards, start and close, their goal and end, and the closed ones", () => {
  const b = fixture();
  const { tree, calls } = draw(b, { view: { kind: "sprints" } });
  const drawn = words(tree);
  assert.match(drawn, /^s2 Polish active · 4 card\(s\) · ends 2031-01-15$/m);
  assert.match(drawn, /^Ship the pane$/m);
  assert.match(drawn, /^s3 Later planned · 0 card\(s\)$/m);
  assert.match(drawn, /^s1 Groundwork: 3 done, 1 rolled on, 2030-12-01$/m);
  assert.equal(find(tree, "start-s3"), null, "nothing starts while a sprint is active");
  need(tree, "close-s2").props.onPress();
  need(tree, "goal-s2", "Input").props.onSubmit(" Ship it all ");
  need(tree, "end-s3", "Input").props.onSubmit("2031-03-01");
  need(tree, "new-sprint", "Input").props.onSubmit("After that");
  assert.deepEqual(calls, [["sprintClose", "s2"], ["sprintEdit", "s2", { goal: "Ship it all" }], ["sprintEdit", "s3", { end: "2031-03-01" }], ["sprintNew", "After that"]]);

  const idle = fixture();
  idle.sprints[1].state = "closed";
  const planned = draw(idle, { view: { kind: "sprints" } });
  need(planned.tree, "start-s3").props.onPress();
  assert.deepEqual(planned.calls, [["sprintStart", "s3"]]);
  assert.match(words(draw(fixture({ sprints: [] }), { view: { kind: "sprints" } }).tree), /^No sprint planned\.$/m);
});

test("closing a sprint is previewed the way the CLI closes it", () => {
  const b = fixture();
  assert.equal(closePreview(b, "s2"), "1 done card(s) archived, 3 unfinished card(s) to sprint s3.");
  b.sprints[2].state = "closed";
  assert.equal(closePreview(b, "s2"), "1 done card(s) archived, 3 unfinished card(s) to the backlog.");
  assert.equal(closePreview(b, "s1"), null, "a closed sprint does not close again");
  assert.equal(closePreview(b, "s9"), null);
});

test("a task's card: its fields to edit, each change handed on as one patch", () => {
  const { tree, calls } = draw(fixture(), { view: { kind: "card", id: "0002" }, skills: ["agent-works:board", "code-diet:ladder"] });
  assert.deepEqual(keys(tree, "Select"), ["status", "kind", "epic", "sprint", "priority", "skill-pick"]);
  assert.deepEqual(keys(tree, "Input"), ["title", "owner", "labels", "skill-type", "note"]);
  assert.deepEqual(need(tree, "epic", "Select").props.options.map((o) => o.value), ["none", "0001"]);
  assert.deepEqual(need(tree, "sprint", "Select").props.options.map((o) => o.label), ["No sprint (backlog)", "s2 Polish (active)", "s3 Later (planned)"]);
  assert.equal(need(tree, "sprint", "Select").props.value, "s2");
  assert.equal(line(tree, "start"), "Start");
  need(tree, "title", "Input").props.onSubmit(" Cache every listing ");
  need(tree, "title", "Input").props.onSubmit("   ");
  need(tree, "status", "Select").props.onSelect("review");
  need(tree, "kind", "Select").props.onSelect("gate");
  need(tree, "epic", "Select").props.onSelect("none");
  need(tree, "sprint", "Select").props.onSelect("s3");
  need(tree, "priority", "Select").props.onSelect("high");
  need(tree, "owner", "Input").props.onSubmit("sam");
  need(tree, "labels", "Input").props.onSubmit("ui, , pane");
  need(tree, "skill-pick", "Select").props.onSelect("code-diet:ladder");
  need(tree, "skill-type", "Input").props.onSubmit("/agent-works:board");
  need(tree, "note", "Input").props.onSubmit("half done");
  need(tree, "archive").props.onPress();
  need(tree, "start").props.onPress();
  assert.deepEqual(calls, [
    ["patch", "0002", { title: "Cache every listing" }], ["place", "0002", "review"], ["patch", "0002", { kind: "gate" }], ["patch", "0002", { epic: "none" }],
    ["patch", "0002", { sprint: "s3" }], ["patch", "0002", { priority: "high" }], ["patch", "0002", { owner: "sam" }], ["patch", "0002", { labels: ["ui", "pane"] }],
    ["patch", "0002", { skills: ["code-diet:ladder"] }], ["patch", "0002", { skills: ["agent-works:board"] }], ["note", "0002", "half done"], ["archive", "0002"], ["start", "0002"],
  ]);

  const nudged = fixture();
  nudged.cards[1].skills = ["code-diet:ladder"];
  const again = draw(nudged, { view: { kind: "card", id: "0002" }, skills: ["code-diet:ladder"] });
  assert.equal(find(again.tree, "skill-pick", "Select"), null, "nothing left to offer");
  need(again.tree, "skill-code-diet:ladder").props.onPress();
  assert.deepEqual(again.calls, [["patch", "0002", { skills: [] }]]);
});

test("a card that is not ready has no Start, and a suggestion is accepted or dismissed", () => {
  for (const id of ["0004", "0007", "0010", "0003"]) assert.equal(find(draw(fixture(), { view: { kind: "card", id } }).tree, "start"), null, id);
  const { tree, calls } = draw(fixture(), { view: { kind: "card", id: "0006" } });
  assert.equal(line(tree, "archive"), "Dismiss");
  assert.deepEqual(need(tree, "status", "Select").props.options.map((o) => o.value), ["suggested", "backlog", "in-progress", "review", "done"]);
  need(tree, "accept").props.onPress();
  need(tree, "archive").props.onPress();
  assert.deepEqual(calls, [["accept", "0006"], ["archive", "0006"]]);
});

test("a gate's card: what it is owed for, Run it, and the evidence that settles it; never a move to done", () => {
  const { tree, calls } = draw(fixture(), { view: { kind: "card", id: "0005" }, draft: "ran it" });
  assert.match(words(tree), /^gate Full suite on main 0005 · by Claude$/m);
  assert.match(words(tree), /^for PR 7 · needs the main checkout$/m);
  assert.equal(line(tree, "start"), "Run it");
  assert.deepEqual(need(tree, "status", "Select").props.options.map((o) => o.value), ["backlog", "in-progress", "review"], "done is reached by settling");
  assert.deepEqual(keys(tree, "Input"), ["title", "owner", "ref", "needs", "labels", "skill-type", "evidence", "note"]);
  assert.equal(need(tree, "evidence", "Input").props.value, "ran it", "a redraw keeps what was typed");
  assert.ok(!lines(tree).some((l) => l.includes("## Evidence")), "an unsettled gate's empty Evidence heading is not drawn");
  need(tree, "evidence", "Input").props.onInput("ran it, 212");
  need(tree, "evidence", "Input").props.onSubmit("ran it, 212 passed");
  need(tree, "settle").props.onPress();
  need(tree, "ref", "Input").props.onSubmit("PR 8");
  need(tree, "start").props.onPress();
  assert.deepEqual(calls, [["draft", "ran it, 212"], ["settle", "0005", "ran it, 212 passed"], ["settle", "0005"], ["patch", "0005", { ref: "PR 8" }], ["start", "0005"]]);

  const settled = draw(fixture(), { view: { kind: "card", id: "0008" } }).tree;
  assert.equal(find(settled, "start"), null, "a settled gate has nothing left to run");
  assert.equal(find(settled, "evidence", "Input"), null);
  assert.ok(lines(settled).some((l) => l.includes("Settled 2030-12-20: ran it, it held")), "and shows its evidence");

  const bare = draw(fixture(), { view: { kind: "card", id: "0005" }, surface: "bare" }).tree;
  assert.equal(find(bare, "settle"), null, "no text field, nowhere to write the evidence");
  assert.match(words(bare), /^Settle it from a shell: aw board settle 0005 --evidence "<what showed it>"$/m);
  assert.deepEqual(keys(bare), ["back", "start", "archive", "right"], "and the moves are buttons");
});

test("a plan issue's card is read, not edited", () => {
  const b = fixture();
  b.cards.push(card("01-02-03", "Wire the funnel", { source: "plan", file: ".agents/plan/plan/01/02/issues/03_issue.md", sprint: "s2", body: "The issue as the base has it." }));
  const { tree } = draw(b, { view: { kind: "card", id: "01-02-03" } });
  assert.match(words(tree), /^Wire the funnel 01-02-03 · plan issue$/m);
  assert.deepEqual(keys(tree, "Input"), []);
  assert.deepEqual(keys(tree, "Select"), ["status"]);
  assert.equal(find(tree, "archive"), null);
  assert.equal(lines(tree).at(-1), ".agents/plan/plan/01/02/issues/03_issue.md");
});

test("the new-card view names where the card goes and takes its column and title", () => {
  const { tree, calls } = draw(fixture(), { view: { kind: "new", status: "review" } });
  assert.match(words(tree), /^Goes into sprint s2: the scope the board shows\.$/m);
  assert.equal(need(tree, "new-status", "Select").props.value, "review");
  need(tree, "new-status", "Select").props.onSelect("backlog");
  need(tree, "new-title", "Input").props.onSubmit("One more");
  assert.deepEqual(calls, [["view", { kind: "new", status: "backlog" }], ["add", "One more", "review"]]);
  assert.match(words(draw(fixture(), { view: { kind: "new", status: "backlog" }, scope: "0001" }).tree), /^Goes into epic 0001: the scope the board shows\.$/m);
  assert.ok(!words(draw(fixture(), { view: { kind: "new", status: "backlog" }, scope: "all" }).tree).includes("Goes into"));
  assert.match(words(draw(fixture(), { view: { kind: "new", status: "backlog" }, surface: "bare" }).tree), /^Add a card with \/kanban add <title>\.$/m);
});

test("the settings: how a card starts, sync and where it stands, and the folder", () => {
  const off = draw(fixture(), { view: { kind: "settings" } });
  assert.equal(need(off.tree, "start-mode", "Select").props.value, "new-session");
  assert.equal(line(off.tree, "sync-toggle"), "Turn sync on");
  assert.equal(find(off.tree, "sync-now"), null, "nothing to sync while it is off");
  assert.ok(lines(off.tree).includes("sync off") && lines(off.tree).includes("/repo/.agents/kanban"));
  need(off.tree, "start-mode", "Select").props.onSelect("queue");
  need(off.tree, "sync-toggle").props.onPress();
  assert.deepEqual(off.calls, [["startMode", "queue"], ["remote", true]]);

  const on = draw(fixture({ remote: { enabled: true } }), { view: { kind: "settings" }, sync: { status: "idle", message: "Synced with github: 2 pushed, 1 pulled." } });
  assert.equal(line(on.tree, "sync-toggle"), "Turn sync off");
  need(on.tree, "sync-toggle").props.onPress();
  need(on.tree, "sync-now").props.onPress();
  assert.deepEqual(on.calls, [["remote", false], ["syncNow"]]);
  assert.ok(lines(on.tree).includes("synced: Synced with github: 2 pushed, 1 pulled."));

  const b = fixture({ remote: { enabled: true } });
  assert.equal(syncLine(b, { status: "running", message: "" }), "syncing…");
  assert.equal(syncLine(b, { status: "error", message: "gh: not logged in" }), "sync failed: gh: not logged in");
  assert.equal(syncLine(b, { status: "idle", message: "" }), "sync on");

  const old = draw(fixture({ dir: "/repo/.agents/board", isOldFolder: true }), { view: { kind: "settings" } }).tree;
  assert.match(words(old), /still in \.agents\/board, the folder the board had first\. It keeps working there/);
  assert.ok(!words(off.tree).includes("the folder the board had first"));
});

test("side by side where the surface draws a Client and every lane fits; stacked everywhere else", () => {
  const b = fixture();
  const wide = draw(b, { surface: "terminal", client: true, columns: 100 }).tree;
  const client = need(wide, "board", "Client");
  assert.equal(client.props.module, "./board.client.mjs");
  assert.deepEqual(client.props.props.lanes.map((l) => [l.id, l.role, l.cards.length]), [["suggested", "suggested", 1], ["backlog", null, 2], ["in-progress", "start", 1], ["review", "review", 0], ["done", "done", 1]]);
  assert.deepEqual(client.props.props.lanes[1].cards, [
    { id: "0002", title: "Cache the listing", meta: "◆ Faster sync", mark: "ready" },
    { id: "0005", title: "Full suite on main", meta: "for PR 7 · by Claude", mark: "gate" },
  ]);
  assert.equal(find(wide, "card-0002"), null, "the cards are the Client's to draw");
  assert.ok(find(wide, "scope"), "the toolbar is drawn above it all the same");

  assert.equal(find(draw(b, { surface: "terminal", client: true, columns: 89 }).tree, "board", "Client"), null, "five lanes need 90 cells");
  assert.ok(find(draw(b, { surface: "terminal", client: true, columns: 89 }).tree, "card-0002"));
  assert.equal(find(draw(b, { surface: "terminal", client: false }).tree, "board", "Client"), null, "a surface the Client failed on");
  assert.equal(find(draw(b, { surface: "vscode", client: true }).tree, "board", "Client"), null, "a surface with no Client");

  const huge = fixture();
  for (let i = 0; i < 700; i++) huge.cards.push(card(String(2000 + i), `${"A long title ".repeat(8)}${i}`, { sprint: "s2", labels: ["one", "two", "three", "four"], order: 10 + i }));
  assert.equal(find(draw(huge, { surface: "terminal", client: true }).tree, "board", "Client"), null, "more than the host carries to a Client: stacked");
});

test("a place in a drawn lane is the CLI's index among every card of the column", () => {
  const b = fixture();
  const lanes = lanesOf(b, { scope: "sprint" });
  // The backlog on disk: 0001 (the epic), 0002, 0004, 0005, 0010; the sprint's lane draws 0002 and 0005.
  assert.equal(placeAt(b, lanes, "0007", "backlog", 0), 1, "before 0002, which sits after the epic");
  assert.equal(placeAt(b, lanes, "0007", "backlog", 1), 3, "before 0005, past the hidden 0004");
  assert.equal(placeAt(b, lanes, "0007", "backlog", 2), 4, "after the last card drawn");
  assert.equal(placeAt(b, lanes, "0005", "backlog", 0), 1, "a card moved within its lane is counted out");
  assert.equal(placeAt(b, lanes, "0002", "review", 0), undefined, "an empty lane: the end");
});

test("a board that could not be read says why, and one not read yet says so", () => {
  const { act } = recorder();
  const model = { board: null, error: "the board CLI exited 1", view: { kind: "board" } };
  assert.match(words(pane(TABLES.terminal, model, act)), /^The board could not be read: the board CLI exited 1$/m);
  assert.equal(words(pane(TABLES.terminal, { ...model, error: null }, act)), "Reading the kanban board…");
});
