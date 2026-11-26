// The kanban board inside a Client region: the surface module views.mjs names.
// It runs on the surface's drawing thread, away from the engine, so it moves
// nothing itself. Its props are the lanes as plain data (model.mjs lanesOf);
// its local state is the selection and a press or drag in progress. A pointer
// or a key goes through layout.mjs, which says what it asks for, and `post`
// hands that to the pane: select or open a card, move one to another lane or
// another place, start it, or show another view. The pane carries it out
// through the board CLI and draws the board again, so a drop the board refuses
// leaves the card where its props have it: it springs back, and the reason
// shows under the board.
//
// State is set only from a listener, never while drawing: a module that sets
// it on three renders in a row with no input between is unmounted as a loop.
import { CARD_ROWS, LANE_HEAD, keyStep, layout, pointerStep } from "./layout.mjs";

const GHOST_CHARS = 28;

const LANE_COLOR = { suggested: "suggestion", start: "claude", review: "suggestion", done: "success" };
const MARK_COLOR = { gate: "warning", ready: "success", queued: "claude" };

export default function Board(props, surface) {
  const { Box, Text } = surface.elements;
  const columns = surface.columns > 0 ? surface.columns : props.columns;
  const box = layout(props.lanes, columns);
  let local = surface.state ?? { selected: props.selected ?? null, down: null, drag: null };
  const apply = ({ state, post }) => {
    if (state !== local) {
      local = state;
      surface.setState(state);
    }
    if (post) surface.post(post);
  };
  surface.onPointer((event) => apply(pointerStep(local, event, box)));
  surface.onKey((event) => apply(keyStep(local, event, box)));

  const { drag } = local;
  const lanes = props.lanes.map((lane, i) => {
    const title = { weight: "semibold", wrap: "truncate-end", ...(LANE_COLOR[lane.role] ? { color: LANE_COLOR[lane.role] } : {}), ...(drag && i === drag.lane ? { inverse: true } : {}) };
    const children = [
      Text({ ...title, children: [`${lane.title} `, Text({ dimColor: true, children: String(lane.cards.length) })] }),
      Text({ dimColor: true, children: "─".repeat(box.width - 1) }),
      ...lane.cards.map((card) => cardBox(surface.elements, card, box.width, card.id === local.selected, card.id === drag?.id)),
    ];
    return Box({ flexDirection: "column", width: box.width, children });
  });

  const kids = [Box({ flexDirection: "row", children: lanes })];
  if (!props.lanes.some((lane) => lane.cards.length)) kids.push(Text({ dimColor: true, children: props.empty ?? "" }));
  const dragged = drag && props.lanes.flatMap((l) => l.cards).find((c) => c.id === drag.id);
  if (dragged) {
    // Where the card would land, then the card under the pointer.
    kids.push(Box({ position: "absolute", top: LANE_HEAD + drag.slot * CARD_ROWS, left: drag.lane * box.width, children: [Text({ color: "claude", children: `▶${"━".repeat(Math.max(1, box.width - 3))}` })] }));
    const label = ` ${`${dragged.id} ${dragged.title}`.slice(0, GHOST_CHARS).trimEnd()} `;
    const left = Math.max(0, Math.min(drag.x + 2, columns - label.length));
    kids.push(Box({ position: "absolute", top: drag.y + 1, left, children: [Text({ inverse: true, children: label })] }));
  }
  return Box({ flexDirection: "column", position: "relative", children: kids });
}

/** One card: a bordered box one cell narrower than its lane, its id and title, then its mark and tags. */
function cardBox(E, card, width, selected, dragged) {
  const { Box, Text } = E;
  const meta = [];
  if (card.mark) meta.push(Text({ color: MARK_COLOR[card.mark], children: card.mark }));
  if (card.mark && card.meta) meta.push(" ");
  if (card.meta) meta.push(card.meta);
  return Box({
    flexDirection: "column", width: width - 1, height: CARD_ROWS, paddingX: 1,
    borderStyle: "round", borderColor: selected ? "claude" : "subtle", ...(selected ? {} : { borderDimColor: true }),
    children: [
      Text({ wrap: "truncate-end", ...(selected ? { weight: "semibold" } : {}), ...(dragged ? { dimColor: true } : {}), children: `${card.id} ${card.title}` }),
      Text({ wrap: "truncate-end", dimColor: true, children: meta.length ? meta : "" }),
    ],
  });
}
