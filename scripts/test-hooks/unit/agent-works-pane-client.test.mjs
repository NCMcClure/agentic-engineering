// The board side by side: the pure layout (where every lane and card sits,
// which card is under a cell, where a key walks, what a pointer or a key asks
// for) and the surface module that draws from it inside a Client region, run
// here the way a surface runs it, its posts delivered to the pane's hooks
// module and carried out by the real board CLI.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_ROWS, LANE_HEAD, MIN_LANE, cardAt, find as place, fits, keyIntent, keyStep, laneAt, layout, pointerStep, slotAt, walk } from "../../../plugins/agent-works/hooks/kanban/layout.mjs";
import { DISPATCH, board, boardOf, find, lines, mount, need, repo, walk as walkTree, words } from "./agent-works-pane-host.mjs";

const lane = (id, role, ...cards) => ({ id, title: id, role, cards: cards.map((c) => ({ id: c })) });
// Five lanes of 20 cells in a 100-cell region: suggested holds one card, backlog three, review and done one each.
const LANES = [lane("suggested", "suggested", "0009"), lane("backlog", null, "0001", "0002", "0003"), lane("in-progress", "start"), lane("review", "review", "0004"), lane("done", "done", "0005")];
const box = layout(LANES, 100);
const NO_ONE = { selected: null, down: null, drag: null };
const on = (id) => ({ ...NO_ONE, selected: id });

test("a board fits side by side only when every lane gets its minimum width", () => {
  assert.equal(fits(4 * MIN_LANE, 4), true);
  assert.equal(fits(4 * MIN_LANE - 1, 4), false);
  assert.equal(fits(5 * MIN_LANE - 1, 5), false, "a suggestions lane needs its room too");
  assert.equal(fits(200, 0), false, "no lanes, no board");
});

test("lanes share the width evenly and cards stack under the lane head", () => {
  assert.equal(box.width, 20);
  assert.deepEqual(box.lanes.map((l) => l.x), [0, 20, 40, 60, 80]);
  assert.deepEqual(box.lanes.map((l) => l.role), ["suggested", null, "start", "review", "done"]);
  assert.deepEqual(box.lanes[1].cards.map((c) => c.y), [LANE_HEAD, LANE_HEAD + CARD_ROWS, LANE_HEAD + 2 * CARD_ROWS]);
  assert.deepEqual(layout(LANES, 103).lanes.map((l) => l.x), [0, 20, 40, 60, 80], "the remainder is left over on the right");
  assert.equal(layout(LANES, 40).width, MIN_LANE, "never narrower than the minimum");
});

test("the hit test names the lane and the card under a cell, and nothing over a head, a gap, or past the edge", () => {
  assert.deepEqual([laneAt(box, 0), laneAt(box, 19), laneAt(box, 20), laneAt(box, 99), laneAt(box, 130), laneAt(box, -4)], [0, 0, 1, 4, 4, 0]);
  assert.deepEqual(cardAt(box, 20, LANE_HEAD), { lane: 1, slot: 0, id: "0001" });
  assert.deepEqual(cardAt(box, 38, LANE_HEAD + CARD_ROWS - 1), { lane: 1, slot: 0, id: "0001" }, "the card's last cell");
  assert.deepEqual(cardAt(box, 25, LANE_HEAD + CARD_ROWS), { lane: 1, slot: 1, id: "0002" });
  assert.equal(cardAt(box, 25, 0), null, "the lane's title");
  assert.equal(cardAt(box, 25, 1), null, "its rule");
  assert.equal(cardAt(box, 39, LANE_HEAD), null, "the cell between two lanes");
  assert.equal(cardAt(box, 45, LANE_HEAD), null, "an empty lane");
  assert.equal(cardAt(box, 25, LANE_HEAD + 3 * CARD_ROWS), null, "below the last card");
  assert.equal(cardAt(box, 100, LANE_HEAD), null, "past the right edge");
  assert.equal(cardAt(box, -1, LANE_HEAD), null, "past the left edge");
  assert.deepEqual(place(box, "0004"), { lane: 3, slot: 0 });
  assert.equal(place(box, "gone"), null);
});

test("a drop's place is counted among the lane's other cards", () => {
  assert.equal(slotAt(box, 1, LANE_HEAD, "0009"), 0);
  assert.equal(slotAt(box, 1, LANE_HEAD + CARD_ROWS + 1, "0009"), 1);
  assert.equal(slotAt(box, 1, 60, "0009"), 3, "past the last card: the end");
  assert.equal(slotAt(box, 1, 60, "0002"), 2, "its own lane has one card fewer to count");
  assert.equal(slotAt(box, 2, 9, "0001"), 0, "an empty lane has one place");
  assert.equal(slotAt(box, 1, -5, "0009"), 0);
});

test("a walk moves within a lane, jumps across empty lanes, and stops at the edges", () => {
  assert.equal(walk(box, null, "down"), "0009", "nothing selected: the first card");
  assert.equal(walk(box, "gone", "left"), "0009", "a selection no longer drawn: the first card");
  assert.equal(walk(box, "0001", "down"), "0002");
  assert.equal(walk(box, "0003", "down"), "0003", "the bottom stays put");
  assert.equal(walk(box, "0001", "up"), "0001");
  assert.equal(walk(box, "0003", "right"), "0004", "the empty lane is skipped and the slot clamped");
  assert.equal(walk(box, "0004", "left"), "0001", "the same slot where the lane has it");
  assert.equal(walk(box, "0005", "right"), "0005", "the right edge stays put");
  assert.equal(walk(layout([lane("backlog", null)], 80), null, "down"), null, "an empty board selects nothing");
});

test("keys: what each asks for", () => {
  for (const [key, dir] of [["left", "left"], ["h", "left"], ["right", "right"], ["l", "right"], ["up", "up"], ["k", "up"], ["down", "down"], ["j", "down"]]) {
    assert.deepEqual(keyIntent({ key }), { walk: dir }, key);
  }
  for (const event of [{ key: "left", shift: true }, { key: "H" }, { key: "h", shift: true }]) assert.deepEqual(keyIntent(event), { shift: -1 }, JSON.stringify(event));
  for (const event of [{ key: "right", shift: true }, { key: "L" }]) assert.deepEqual(keyIntent(event), { shift: 1 }, JSON.stringify(event));
  for (const event of [{ key: "up", shift: true }, { key: "K" }]) assert.deepEqual(keyIntent(event), { nudge: -1 }, JSON.stringify(event));
  for (const event of [{ key: "down", shift: true }, { key: "J" }]) assert.deepEqual(keyIntent(event), { nudge: 1 }, JSON.stringify(event));
  assert.deepEqual(keyIntent({ key: "return" }), { open: true });
  assert.deepEqual([keyIntent({ key: "s" }), keyIntent({ key: "a" }), keyIntent({ key: "x" })], [{ card: "start" }, { card: "accept" }, { card: "archive" }]);
  assert.deepEqual(["n", "v", "e", "p", "g"].map((key) => keyIntent({ key }).board), ["new", "scope", "epics", "sprints", "filter"]);
  for (const event of [{ key: "z" }, { key: "l", ctrl: true }, { key: "s", meta: true }, { key: "tab" }, {}]) assert.equal(keyIntent(event), null, JSON.stringify(event));
});

test("a key step walks the selection and says so, opens, moves, nudges, starts, and reaches the pane's views", () => {
  let r = keyStep(NO_ONE, { key: "j" }, box);
  assert.deepEqual([r.state.selected, r.post], ["0009", { type: "select", id: "0009" }], "a walk tells the pane, whose toolbar acts on the selection");
  r = keyStep(on("0001"), { key: "down" }, box);
  assert.equal(r.state.selected, "0002");
  const here = r.state;
  assert.equal(keyStep(on("0003"), { key: "down" }, box).post, undefined, "a walk that goes nowhere says nothing");
  assert.deepEqual(keyStep(here, { key: "return" }, box).post, { type: "open", id: "0002" });
  assert.deepEqual(keyStep(here, { key: "L" }, box).post, { type: "shift", id: "0002", by: 1 });
  assert.deepEqual(keyStep(here, { key: "left", shift: true }, box).post, { type: "shift", id: "0002", by: -1 });
  assert.deepEqual(keyStep(here, { key: "K" }, box).post, { type: "nudge", id: "0002", by: -1 });
  assert.deepEqual(keyStep(here, { key: "s" }, box).post, { type: "start", id: "0002" });
  assert.equal(keyStep(here, { key: "a" }, box).post, undefined, "accept and archive by key are the Suggested lane's");
  assert.deepEqual(keyStep(on("0009"), { key: "a" }, box).post, { type: "accept", id: "0009" });
  assert.deepEqual(keyStep(on("0009"), { key: "x" }, box).post, { type: "archive", id: "0009" });
  assert.deepEqual(keyStep(here, { key: "n" }, box).post, { type: "new", to: "backlog" }, "a new card starts in the selected card's lane");
  assert.deepEqual(keyStep(NO_ONE, { key: "n" }, box).post, { type: "new", to: null });
  assert.deepEqual(["v", "e", "p", "g"].map((key) => keyStep(NO_ONE, { key }, box).post.type), ["scope", "epics", "sprints", "filter"]);
  assert.equal(keyStep(NO_ONE, { key: "return" }, box).post, undefined, "Enter with nothing selected opens nothing");
  assert.equal(keyStep(here, { key: "z" }, box).state, here, "an unknown key changes nothing");
});

const at = (l, slot) => ({ x: box.lanes[l].x + 2, y: LANE_HEAD + slot * CARD_ROWS + 1 });
const ptr = (type, where, extra = {}) => ({ type, ...where, button: "left", ...extra });

test("a press selects a card, and a second press on the selected card opens it", () => {
  let r = pointerStep(NO_ONE, ptr("down", at(1, 1)), box);
  assert.deepEqual([r.state.selected, r.post], ["0002", { type: "select", id: "0002" }]);
  r = pointerStep(r.state, ptr("up", at(1, 1)), box);
  assert.equal(r.post, undefined, "the first press only selects");
  r = pointerStep(r.state, ptr("down", at(1, 1)), box);
  assert.equal(r.post, undefined, "already selected: nothing new to say");
  r = pointerStep(r.state, ptr("up", at(1, 1)), box);
  assert.deepEqual(r.post, { type: "open", id: "0002" });
  assert.deepEqual([r.state.down, r.state.drag], [null, null]);
  assert.equal(pointerStep(NO_ONE, ptr("down", at(1, 0), { button: "right" }), box).state, NO_ONE, "another button does nothing");
  assert.equal(pointerStep(on("0002"), ptr("down", { x: 45, y: 9 }), box).state.selected, "0002", "a press on no card keeps the selection");
});

test("a drag to another lane asks to move the card to the place shown; within its lane, for that place; back home, nothing", () => {
  let r = pointerStep(NO_ONE, ptr("down", at(1, 0)), box);
  r = pointerStep(r.state, ptr("move", { x: 50, y: 5 }), box);
  assert.deepEqual(r.state.drag, { id: "0001", from: 1, home: 0, lane: 2, slot: 0, x: 50, y: 5 });
  r = pointerStep(r.state, ptr("move", { x: 70, y: 7 }), box);
  assert.deepEqual([r.state.drag.lane, r.state.drag.slot], [3, 1], "below review's one card");
  r = pointerStep(r.state, ptr("up", { x: 70, y: 7 }), box);
  assert.deepEqual(r.post, { type: "move", id: "0001", to: "review", index: 1 });
  assert.deepEqual([r.state.down, r.state.drag, r.state.selected], [null, null, "0001"]);

  r = pointerStep(NO_ONE, ptr("down", at(1, 0)), box);
  r = pointerStep(r.state, ptr("move", { x: 25, y: LANE_HEAD + 2 * CARD_ROWS + 3 }), box);
  r = pointerStep(r.state, ptr("up", { x: 25, y: LANE_HEAD + 2 * CARD_ROWS + 3 }), box);
  assert.deepEqual(r.post, { type: "nudge", id: "0001", index: 2 }, "to the end of its own lane");

  r = pointerStep(NO_ONE, ptr("down", at(1, 1)), box);
  r = pointerStep(r.state, ptr("move", { x: 60, y: 9 }), box);
  r = pointerStep(r.state, ptr("move", { x: 26, y: LANE_HEAD + CARD_ROWS }), box);
  r = pointerStep(r.state, ptr("up", { x: 26, y: LANE_HEAD + CARD_ROWS }), box);
  assert.equal(r.post, undefined, "dropped where it started: it springs back");

  r = pointerStep(NO_ONE, ptr("down", at(1, 0)), box);
  const still = pointerStep(r.state, ptr("move", at(1, 0)), box);
  assert.equal(still.state, r.state, "a move within the cell it went down in is no drag");
  assert.equal(pointerStep(NO_ONE, ptr("move", { x: 30, y: 5 }), box).state, NO_ONE, "a move with no card held is nothing");
  assert.equal(pointerStep(NO_ONE, ptr("up", { x: 30, y: 5 }), box).state, NO_ONE);
});

/** A pane open on a repository with cards in three lanes, drawn wide enough for the board side by side. */
async function sideBySide(t, options = {}) {
  const r = repo(t);
  for (const title of ["One", "Two", "Three"]) board(r.dir, "add", title);
  board(r.dir, "owe", "Full suite", "--ref", "PR 7", "--needs", "main");
  board(r.dir, "move", "0003", "review");
  const m = await mount(r.dir, options);
  await m.command("");
  const draw = (surface = "terminal") => m.draw(surface, 80);
  const lanes = () => Object.fromEntries(boardOf(r.dir).columns.map((c) => [c.id, boardOf(r.dir).cards.filter((x) => x.status === c.id).map((x) => x.id)]));
  return { r, m, draw, lanes };
}
const cell = (l, slot, width = 20) => ({ x: l * width + 3, y: LANE_HEAD + slot * CARD_ROWS + 1 });

for (const surface of ["terminal", "desktop"]) {
  test(`${surface}: the board is drawn side by side, each card a box with its id, title, mark and tags`, async (t) => {
    const { m, draw } = await sideBySide(t);
    const tree = await draw(surface);
    const c = await m.client(tree, surface);
    const drawn = lines(c.tree);
    assert.deepEqual(drawn.filter((l) => /^(Backlog|In progress|Review|Done) \d+$/.test(l)), ["Backlog 3", "In progress 0", "Review 1", "Done 0"]);
    assert.ok(drawn.includes("0001 One") && drawn.includes("ready"), drawn.join("\n"));
    assert.ok(drawn.includes("gate for PR 7"), "a gate carries its mark and what it is owed for");
    let boxes = 0;
    walkTree(c.tree, (n) => { if (n.type === "Box" && n.props.borderStyle === "round") boxes++; });
    assert.equal(boxes, 4, "one box a card");
    assert.ok(find(tree, "scope") && find(tree, "settings"), "under the same toolbar as the stacked lanes");
    assert.equal(find(tree, "card-0001"), null);
  });

  test(`${surface}: a drag to another lane moves the card through the CLI, at the place it was dropped`, async (t) => {
    const { m, draw, lanes } = await sideBySide(t);
    const c = await m.client(await draw(surface), surface);
    await c.drag(cell(0, 1), cell(2, 0));
    assert.deepEqual(c.posts.filter((p) => p.type === "move"), [{ type: "move", id: "0002", to: "review", index: 0 }]);
    assert.deepEqual(lanes(), { backlog: ["0001", "0004"], "in-progress": [], review: ["0002", "0003"], done: [] });
    c.update(await draw(surface));
    assert.deepEqual(c.props.lanes.map((l) => l.cards.map((x) => x.id)), [["0001", "0004"], [], ["0002", "0003"], []], "and the board is drawn again from the disk");
    assert.equal(c.state.selected, "0002", "the selection rides along");

    await c.drag(cell(0, 0), { x: 5, y: LANE_HEAD + 2 * CARD_ROWS });
    assert.deepEqual(lanes().backlog, ["0004", "0001"], "a drag within the lane puts it at that place");
  });
}

test("a ready card dropped on the start lane asks for the dispatch and stays put; one that is not ready says why", async (t) => {
  const { m, draw, lanes } = await sideBySide(t);
  board(m.session.cwd, "edit", "0002", "--needs", "a design");
  await m.tick();
  const c = await m.client(await draw());
  await c.drag(cell(0, 0), cell(1, 0));
  assert.deepEqual(m.seen.commandRuns, [{ command: DISPATCH, args: "0001" }]);
  assert.deepEqual(lanes()["in-progress"], [], "the dispatch moves it once its session has it");
  await c.drag(cell(0, 1), cell(1, 0));
  assert.equal(m.seen.commandRuns.length, 1);
  assert.equal(m.seen.toasts.at(-1), "0002 does not start: it needs a design.");
  assert.ok(lines(await draw()).includes("0002 does not start: it needs a design."), "under the board too");
  assert.deepEqual(lanes().backlog, ["0001", "0002", "0004"]);

  // Back from review the same lane is only a move.
  await c.drag(cell(2, 0), cell(1, 0));
  assert.deepEqual(lanes()["in-progress"], ["0003"]);
  assert.equal(m.seen.commandRuns.length, 1);
});

test("a gate dropped on done springs back, and the reason shows under the board", async (t) => {
  const { m, draw, lanes } = await sideBySide(t);
  const c = await m.client(await draw());
  await c.drag(cell(0, 2), cell(3, 0));
  assert.deepEqual(c.posts.at(-1), { type: "move", id: "0004", to: "done", index: 0 });
  assert.deepEqual(lanes().done, []);
  const tree = await draw();
  assert.ok(lines(tree).some((l) => /^0004 is a gate: settle it with the evidence instead/.test(l)), words(tree));
  c.update(tree);
  assert.deepEqual(c.props.lanes[0].cards.map((x) => x.id), ["0001", "0002", "0004"]);
});

test("keys on the board: walk, open, move a lane over, nudge, start, and the pane's views", async (t) => {
  const { m, draw, lanes } = await sideBySide(t);
  let c = await m.client(await draw());
  await c.key("j");
  assert.equal(c.state.selected, "0001");
  assert.ok(need(await draw(), "open"), "the toolbar now acts on the selected card");
  await c.key("down");
  await c.key({ key: "down", shift: true });
  assert.deepEqual(lanes().backlog, ["0001", "0004", "0002"], "Shift+down: one place down its lane");
  await c.key("K");
  assert.deepEqual(lanes().backlog, ["0001", "0002", "0004"]);
  c.update(await draw());
  await c.key("l");
  assert.equal(c.state.selected, "0003", "right, across the empty lane");
  await c.key("L");
  assert.deepEqual(lanes().done, ["0003"], "Shift+right: one lane over");
  await c.key("H");
  assert.deepEqual(lanes().review, ["0003"]);

  await c.key("h");
  assert.equal(c.state.selected, "0001", "left, to the same slot of the nearest lane with cards");
  await c.key("s");
  assert.deepEqual(m.seen.commandRuns.map((x) => x.args), ["0001"], "s starts the selected card");
  await c.key("return");
  assert.match(words(await draw()), /^One 0001$/m, "Enter opens it");
  await m.press(await draw(), "back");

  for (const [key, heading] of [["e", "Epics"], ["p", "Sprints"], ["n", "New card"]]) {
    c = await m.client(await draw());
    await c.key(key);
    assert.ok(lines(await draw()).includes(heading), `${key} shows ${heading}`);
    await m.press(await draw(), "back");
  }
  c = await m.client(await draw());
  await c.key("g");
  c.update(await draw());
  assert.deepEqual(c.props.lanes.flatMap((l) => l.cards.map((x) => x.id)), ["0004"], "g leaves only the gates");
  await c.key("v");
  assert.ok(lines(await draw()).includes("Scope: backlog"), "v walks the scope");
});

test("in the Suggested lane a accepts and x archives", async (t) => {
  const r = repo(t);
  board(r.dir, "add", "Keep this", "--suggest");
  board(r.dir, "add", "Drop that", "--suggest");
  const m = await mount(r.dir);
  await m.command("");
  const c = await m.client(await m.draw("terminal", 100));
  assert.equal(c.props.lanes[0].role, "suggested");
  await c.key("j");
  await c.key("a");
  c.update(await m.draw("terminal", 100));
  assert.equal(c.state.selected, "0001", "the accepted card stays selected, now in the first column");
  await c.key("x");
  assert.equal(boardOf(r.dir).card("0001").status, "backlog", "x archives nothing outside the Suggested lane");
  await c.key("h");
  await c.key("x");
  assert.deepEqual(boardOf(r.dir).cards.map((x) => [x.id, x.status]).sort(), [["0001", "backlog"], ["0002", "archived"]]);
  assert.equal(find(await m.draw("terminal", 72), "board", "Client") !== null, true, "with Suggested empty, four lanes fit 72 cells");
});

test("a pane too narrow for every lane, and a surface the Client failed on, get the stacked lanes", async (t) => {
  const { m, draw } = await sideBySide(t);
  assert.equal(find(await m.draw("terminal", 71), "board", "Client"), null, "four lanes need 72 cells");
  assert.ok(find(await m.draw("terminal", 71), "card-0001"));
  assert.ok(find(await draw("desktop"), "board", "Client"));
  await m.fault("desktop");
  assert.equal(find(await draw("desktop"), "board", "Client"), null, "stacked there until a reload");
  assert.ok(find(await draw("terminal"), "board", "Client"), "and still side by side where it works");
  assert.match(m.seen.toasts.at(-1), /^The board could not be drawn side by side here/);
  for (const surface of ["vscode", "mobile"]) assert.equal(find(await draw(surface), "board", "Client"), null, `${surface} draws no Client`);
});

test("an empty board says how to add the first card, inside the region", async (t) => {
  const r = repo(t);
  const m = await mount(r.dir);
  await m.command("");
  const c = await m.client(await m.draw("terminal", 80));
  assert.ok(lines(c.tree).includes("No cards yet. Add one with + New, or press n here."));
  await c.key("j");
  assert.equal(c.state, undefined, "nothing to select, no state set");
});
