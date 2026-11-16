// The CARD line: the first line of a child's final message, and the one the
// session that started it acts on. Only the start of a report is quoted back,
// so the line comes first and has one grammar:
//
//   CARD <id> <review|blocked|failed> !<number> lanes=<lane>:<pass|fail>,... owed=<items|->
//
// `!<number>` is the pull or merge request; `!-` is none (a blocked or failed
// card may have none; review always has one). `lanes=-` is no lane run, and
// `owed` lists what the child could not check: gate card ids it filed, or
// short names that become gates. Items carry no spaces or commas.
//
// Pure: strings in, strings or objects out.
import { BoardError } from "./board.mjs";

/** What a child can report its card as. */
export const CARD_STATES = ["review", "blocked", "failed"];
const LINE = /^CARD (\S+) (\S+) !(\S+) lanes=(\S+) owed=(\S+)$/;
const LANE = /^([a-z][\w-]*):(pass|fail)$/;
const ITEM = /^[^\s,]+$/;
const usage = (message) => new BoardError("usage", message);

function check({ id, state, mr, lanes, owed }) {
  if (!ITEM.test(id ?? "")) throw usage(`CARD line: id "${id}" is not a card id`);
  if (!CARD_STATES.includes(state)) throw usage(`CARD line: state "${state}" is not ${CARD_STATES.join(", ")}`);
  if (mr !== null && !(Number.isInteger(mr) && mr > 0)) throw usage(`CARD line: "!${mr}" is not a pull or merge request number`);
  if (state === "review" && mr === null) throw usage("CARD line: review needs the pull or merge request, !<number>");
  for (const l of lanes) if (!LANE.test(`${l.lane}:${l.result}`)) throw usage(`CARD line: lane "${l.lane}:${l.result}" is not <lane>:<pass|fail>`);
  for (const item of owed) if (!ITEM.test(item)) throw usage(`CARD line: owed item "${item}" has a space or a comma`);
}

/** The line for a report `{ id, state, mr, lanes: [{ lane, result }], owed: [] }`; `mr` null is `!-`. */
export function formatCardLine({ id, state, mr = null, lanes = [], owed = [] }) {
  check({ id, state, mr, lanes, owed });
  const ran = lanes.length ? lanes.map((l) => `${l.lane}:${l.result}`).join(",") : "-";
  return `CARD ${id} ${state} !${mr ?? "-"} lanes=${ran} owed=${owed.length ? owed.join(",") : "-"}`;
}

/** The first CARD line in `text`, parsed, or null when there is none. A CARD line that breaks the grammar throws. */
export function parseCardLine(text) {
  const line = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => /^CARD\s/.test(l));
  if (!line) return null;
  const m = LINE.exec(line);
  if (!m) throw usage(`CARD line "${line}" is not: ${cardLineFormat("<id>")}`);
  const [, id, state, iid, ran, owed] = m;
  const lanes = ran === "-" ? [] : ran.split(",").map((pair) => {
    const lane = LANE.exec(pair);
    if (!lane) throw usage(`CARD line: lane "${pair}" is not <lane>:<pass|fail>`);
    return { lane: lane[1], result: lane[2] };
  });
  const report = { id, state, mr: iid === "-" ? null : /^\d+$/.test(iid) ? Number(iid) : iid, lanes, owed: owed === "-" ? [] : owed.split(",") };
  check(report);
  return report;
}

/** The line's shape for a card, as a brief shows it. */
export const cardLineFormat = (id) => `CARD ${id} <${CARD_STATES.join("|")}> !<number> lanes=<lane>:<pass|fail>,... owed=<items|->`;
