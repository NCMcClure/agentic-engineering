// Where the board's lanes and cards sit in a Client region, and what a cell,
// a pointer, or a key there asks for. Pure: board.client.mjs draws from it and
// hands its listeners' events through it, and views.mjs asks it whether the
// board fits. Cells are the region's own, 0 at its top left.
//
// A lane is a column of the region `width` cells wide: its title on row 0, a
// rule on row 1, then one card per CARD_ROWS rows, each card a bordered box one
// cell narrower than its lane so neighbours never touch. Nothing here moves a
// card: a drop or a key only posts what was asked, and the pane's actions carry
// it out through the board CLI, which refuses what the board's rules refuse.

/** Rows a lane's title and its rule take above the first card. */
export const LANE_HEAD = 2;
/** Rows one card takes: its border, its title, its tags. */
export const CARD_ROWS = 4;
/** The narrowest lane a card's id and the start of its title still read in. */
export const MIN_LANE = 18;

/** Whether `lanes` lanes fit side by side in `columns` cells, each at least MIN_LANE wide. */
export const fits = (columns, lanes) => lanes > 0 && columns >= lanes * MIN_LANE;

/** Each lane's id, role and left edge, and each card's top row, for `lanes` laid out in `columns` cells. */
export function layout(lanes, columns) {
  const width = Math.max(MIN_LANE, Math.floor(columns / Math.max(1, lanes.length)));
  return {
    width,
    lanes: lanes.map((lane, i) => ({ id: lane.id, role: lane.role ?? null, x: i * width, cards: lane.cards.map((c, slot) => ({ id: c.id, y: LANE_HEAD + slot * CARD_ROWS })) })),
  };
}

/** The lane under column `x`, clamped: a drop past either edge lands in the end lane. */
export const laneAt = (box, x) => Math.max(0, Math.min(box.lanes.length - 1, Math.floor(x / box.width)));

/** The card under the cell, as `{ lane, slot, id }`, or null over a lane's head, the gap between lanes, or past the board. */
export function cardAt(box, x, y) {
  if (x < 0 || x >= box.lanes.length * box.width || x % box.width === box.width - 1 || y < LANE_HEAD) return null;
  const lane = laneAt(box, x);
  const slot = Math.floor((y - LANE_HEAD) / CARD_ROWS);
  const card = box.lanes[lane].cards[slot];
  return card ? { lane, slot, id: card.id } : null;
}

/** Where a card is: `{ lane, slot }`, or null when the board does not hold it. */
export function find(box, id) {
  for (const [lane, l] of box.lanes.entries()) {
    const slot = l.cards.findIndex((c) => c.id === id);
    if (slot !== -1) return { lane, slot };
  }
  return null;
}

/** The place in lane `lane` a card `id` dropped at row `y` would take, counted among the lane's other cards. */
export function slotAt(box, lane, y, id) {
  const others = box.lanes[lane].cards.filter((c) => c.id !== id).length;
  return Math.max(0, Math.min(others, Math.round((y - LANE_HEAD) / CARD_ROWS)));
}

/** The card a walk from `id` lands on: up and down within its lane, left and right to the nearest lane holding cards. */
export function walk(box, id, dir) {
  const from = find(box, id);
  if (!from) return box.lanes.find((l) => l.cards.length)?.cards[0].id ?? null;
  const cards = box.lanes[from.lane].cards;
  if (dir === "up") return cards[Math.max(0, from.slot - 1)].id;
  if (dir === "down") return cards[Math.min(cards.length - 1, from.slot + 1)].id;
  const step = dir === "left" ? -1 : 1;
  for (let lane = from.lane + step; lane >= 0 && lane < box.lanes.length; lane += step) {
    const there = box.lanes[lane].cards;
    if (there.length) return there[Math.min(from.slot, there.length - 1)].id;
  }
  return id;
}

const WALKS = { left: "left", h: "left", right: "right", l: "right", up: "up", k: "up", down: "down", j: "down" };
// Keys that ask for one of the pane's views or filters, whatever is selected.
const BOARD_KEYS = { v: "scope", e: "epics", p: "sprints", g: "filter" };

/**
 * What a key asks for: `{ walk }` (arrows, hjkl), `{ shift: -1 | 1 }` (Shift with left or right, or H and L: a
 * terminal may report a shifted letter either way), `{ nudge: -1 | 1 }` (Shift with up or down, or K and J),
 * `{ open: true }` (Enter), `{ card: "start" | "accept" | "archive" }` (s, a, x), `{ board }` (n, v, e, p, g), or null.
 */
export function keyIntent(event) {
  if (event.ctrl || event.meta) return null;
  const key = String(event.key ?? "");
  if (key === "return") return { open: true };
  const dir = WALKS[key.length === 1 ? key.toLowerCase() : key];
  if (dir) {
    const shifted = event.shift === true || (key.length === 1 && key !== key.toLowerCase());
    if (!shifted) return { walk: dir };
    return dir === "left" || dir === "right" ? { shift: dir === "left" ? -1 : 1 } : { nudge: dir === "up" ? -1 : 1 };
  }
  if (key === "n") return { board: "new" };
  if (BOARD_KEYS[key]) return { board: BOARD_KEYS[key] };
  if (key === "s") return { card: "start" };
  if (key === "a") return { card: "accept" };
  if (key === "x") return { card: "archive" };
  return null;
}

/**
 * One key against the board's local state: `{ state, post? }`. A walk selects another card and says so, so the
 * toolbar above the board acts on the same card. Enter asks to open the selected card, a shift to move it one lane
 * over, a nudge one place up or down its lane; s starts it, and in the Suggested lane a accepts it and x archives
 * it. The same state comes back when nothing changed, so the caller sets none.
 */
export function keyStep(local, event, box) {
  const intent = keyIntent(event);
  if (!intent) return { state: local };
  const from = find(box, local.selected);
  if (intent.board === "new") return { state: local, post: { type: "new", to: from ? box.lanes[from.lane].id : null } };
  if (intent.board) return { state: local, post: { type: intent.board } };
  if (intent.walk) {
    const selected = walk(box, local.selected, intent.walk);
    return selected === local.selected ? { state: local } : { state: { ...local, selected }, post: { type: "select", id: selected } };
  }
  if (!from) return { state: local };
  const id = local.selected;
  if (intent.open) return { state: local, post: { type: "open", id } };
  if (intent.shift) return { state: local, post: { type: "shift", id, by: intent.shift } };
  if (intent.nudge) return { state: local, post: { type: "nudge", id, by: intent.nudge } };
  if (intent.card === "start") return { state: local, post: { type: "start", id } };
  return box.lanes[from.lane].role === "suggested" ? { state: local, post: { type: intent.card, id } } : { state: local };
}

/**
 * One pointer event against the board's local state: `{ state, post? }`. A press on a card selects it; a press and
 * release on the card already selected asks to open it. Once the pointer leaves the cell it went down in, the card
 * is dragged: a release over another lane asks to move it there, at the place the pointer shows, and a release
 * elsewhere in its own lane asks for that place. A release where it started asks nothing.
 */
export function pointerStep(local, event, box) {
  if (event.type === "down") {
    if (event.button !== "left") return { state: local };
    const hit = cardAt(box, event.x, event.y);
    const down = hit ? { id: hit.id, lane: hit.lane, slot: hit.slot, x: event.x, y: event.y, wasSelected: hit.id === local.selected } : null;
    const state = { ...local, selected: hit?.id ?? local.selected, down, drag: null };
    return hit && hit.id !== local.selected ? { state, post: { type: "select", id: hit.id } } : { state };
  }
  const { down, drag } = local;
  if (event.type === "move") {
    if (!down || (!drag && event.x === down.x && event.y === down.y)) return { state: local };
    const lane = laneAt(box, event.x);
    const slot = slotAt(box, lane, event.y, down.id);
    if (drag && drag.lane === lane && drag.slot === slot && drag.x === event.x && drag.y === event.y) return { state: local };
    return { state: { ...local, drag: { id: down.id, from: down.lane, home: down.slot, lane, slot, x: event.x, y: event.y } } };
  }
  if (event.type !== "up" || !down) return { state: local };
  const state = { ...local, down: null, drag: null };
  if (drag && drag.lane !== drag.from) return { state, post: { type: "move", id: drag.id, to: box.lanes[drag.lane].id, index: drag.slot } };
  if (drag && drag.slot !== drag.home) return { state, post: { type: "nudge", id: drag.id, index: drag.slot } };
  if (!drag && down.wasSelected) return { state, post: { type: "open", id: down.id } };
  return { state };
}
