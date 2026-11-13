"use client";
// folders-climb: the plan tree as nested folders, with the six status chips
// that `plan-status.mjs set` keeps in step, numbered in the order cmdSet
// writes them. The change starts at issue 07 and climbs: each hop runs up
// through a folder wall, a parent's own Status is worked out from its
// children (a dotted bracket, with its reason), then the same command adds
// the ledger row and, last, across the network line, closes the ticket.
import type { Model } from "../kit/model";
import { rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, indexOf, outro, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 428 };

// The statuses, from the model: what each surface said before, and after.
const STATUS = Object.fromEntries(rows(model, "statuses").map((r) => [String(r.of), { was: String(r.was), now: String(r.now) }]));

// The example's names. The folder slugs (auth, login), the evidence and #42 are illustrative.
const EPIC_DIR = "01-auth", SPRINT_DIR = "03-login";
const EVIDENCE = "logout test green";

// The tree: plan/ holds epic 01, which holds sprint 03, which holds the issues.
const INDEX: Box = { x: 16, y: 16, width: 454, height: 346 };
const EPIC: Box = { x: 28, y: 58, width: 430, height: 296 };
const SPRINT: Box = { x: 40, y: 148, width: 406, height: 198 };
const CARD_Y = 214, CARD_H = 92, CARD_W = 118;
const CARDS = [52, 184, 316]; // 07 first, then the two other issues
const BAR: Box = { x: 16, y: 378, width: 598, height: 36 };
const LEDGER: Box = { x: 480, y: 148, width: 138, height: 108 };
const TICKET: Box = { x: 636, y: 148, width: 112, height: 108 };
const NET_X = 627;

// The column the change climbs: every parent chip is on it, and the hops run up x = CLIMB.
const COL = 290, CHIP_W = 138, CLIMB = 400;
const Y = { index: 38, epicStatus: 80, epicRow: 116, sprintStatus: 170, sprintRow: 192, issue: CARD_Y + 38 };
const ROW04 = 140; // the epic's other sprint, 04, beside 03 in its Sprints table
const ROW04_W = 117;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A status as the file holds it. `n` is its place in cmdSet's order; `same` marks one worked out again and found unchanged. */
function Chip({ x, cy, w = CHIP_W, n, word, same = false, accent, marked, lit = 1 }: {
  x: number; cy: number; w?: number; n?: number; word: string; same?: boolean; accent: number; marked: number; lit?: number;
}) {
  const ink = mix("var(--pt-ink)", "var(--pt-ink-3)", 0.35 + 0.65 * lit);
  const fill = mix("var(--pt-accent-soft)", "var(--pt-top)", Math.max(marked, accent));
  const stroke = accent > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", accent) : "var(--pt-line-2)";
  const text = accent > 0 ? mix("var(--pt-accent-ink)", ink, accent) : ink;
  const halo = { ["--pt-halo" as string]: fill };
  const wx = x + (n ? 22 : 8);
  return (
    <g>
      <rect x={x} y={cy - 9} width={w} height={18} rx={4} style={{ fill, stroke, strokeWidth: accent > 0.5 ? 1.5 : 1 }} />
      {n ? <text className="pt-tag" x={x + 8} y={cy + 3.5} style={{ fill: "var(--pt-ink-3)", ...halo }}>{n}</text> : null}
      <text className="pt-tag" x={wx} y={cy + 3.5} style={{ fill: text, ...halo }}>
        {word}
        {same ? <tspan style={{ fill: "var(--pt-ink-3)" }}>{"  same"}</tspan> : null}
      </text>
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const reset = outro(f.tl, f.frame) < 0.5; // under the fade, the tree goes back to how the loop starts
  const prog = (id: string) => {
    if (reset) return 0;
    const i = indexOf(f.tl, id);
    return index < i ? 0 : index > i ? 1 : p;
  };
  const after = (id: string, at: number) => (prog(id) >= at ? 1 : 0);
  const now = (id: string, at: number) => f.on(id) * ease.out(span(prog(id), at, at + 0.08));
  const grow = (id: string, a: number, b: number) => ease.out(span(prog(id), a, b));
  const tone = (id: string) => mix("var(--pt-ink)", "var(--pt-ink-3)", 0.35 + 0.65 * f.lit(id));
  // While a beat's line travels it takes the accent; the chip takes it on arrival.
  const travel = (id: string, a: number, b: number) => f.on(id) * (1 - span(prog(id), b, b + 0.08)) * (prog(id) >= a ? 1 : 0);

  /** A surface: its word before and after `at` in beat `id`, and whether it flipped or was found the same. */
  const surface = (of: string, id: string, at: number, handOff = 1) => {
    const done = after(id, at), s = STATUS[of], changed = s.was !== s.now;
    return { word: done ? s.now : s.was, same: !!done && !changed, accent: now(id, at) * handOff, marked: done && changed ? 1 : 0 };
  };

  const name = (x: number, cy: number, text: string, id: string) => (
    <text className="pt-label" x={x} y={cy + 3.5} style={{ fill: tone(id) }}>{text}</text>
  );
  const field = (right: number, cy: number, text: string, anchor: "end" | "start" = "end") => (
    <text className="pt-tag" x={right} y={cy + 3.5} textAnchor={anchor}>{text}</text>
  );
  const chipTop = (cy: number) => cy - 9, chipBottom = (cy: number) => cy + 9;

  // The six plan surfaces, in the order cmdSet writes them. In a beat that writes a row and then
  // a Status, the row hands the accent on to the Status.
  const s1 = surface("issue", "ask", 0.3);
  const s2 = { ...surface("issue", "sprint", 0.2, 1 - span(prog("sprint"), 0.2, 0.26)) };
  const s3 = surface("sprint", "sprint", 0.4);
  const s4 = { ...surface("sprint", "epic", 0.2, 1 - span(prog("epic"), 0.2, 0.26)) };
  const s5 = surface("epic", "epic", 0.38);
  const s6 = surface("index", "index", 0.3);
  const tk = surface("ticket", "ticket", 0.32);
  const inStep = reset ? 0 : Math.round(f.level("surfaces"));

  return (
    <g opacity={f.present}>
      {/* The network: the repo on the left, the forge on the right. */}
      <Line from={[NET_X, 18]} to={[NET_X, 420]} dashed lit={0.4} />
      <text className="pt-tag" x={NET_X - 8} y={28} textAnchor="end">repo</text>
      <text className="pt-tag" x={NET_X + 8} y={28}>forge</text>

      {/* The tree, outermost first. */}
      <Panel box={INDEX} lit={0.3 + 0.7 * f.lit("index")} />
      <Panel box={EPIC} lit={0.3 + 0.7 * f.lit("epic")} />
      <Panel box={SPRINT} lit={0.3 + 0.7 * f.lit("sprint")} />

      {/* plan/index.md: one row per epic. */}
      {name(30, Y.index, "plan/index.md", "index")}
      {field(COL - 8, Y.index, "## Epics · 01")}
      {/* epic.md: its own Status, and one row per sprint. */}
      {name(42, Y.epicStatus, `${EPIC_DIR}/epic.md`, "epic")}
      {field(COL - 8, Y.epicStatus, "**Status**:")}
      {field(42, Y.epicRow, "## Sprints", "start")}
      {field(COL - 8, Y.epicRow, "03")}
      {/* sprint.md: its own Status, and one row per issue (07's shown). */}
      {name(54, Y.sprintStatus, `${SPRINT_DIR}/sprint.md`, "sprint")}
      {field(COL - 8, Y.sprintStatus, "**Status**:")}
      {field(COL - 8, Y.sprintRow, "## Issues · 07")}

      {/* The issue files: 07, then the two others. */}
      {CARDS.map((x, i) => {
        const mine = i === 0;
        const id = mine ? "issue" : "siblings";
        const ticked = mine ? grow("ask", 0.3, 0.42) : 1;
        return (
          <g key={x}>
            <rect className="pt-panel" x={x} y={CARD_Y} width={CARD_W} height={CARD_H} rx={6}
              style={{ stroke: mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * f.lit(id)) }} />
            {name(x + 10, CARD_Y + 16, mine ? "issue 07" : "other issue", id)}
            {mine
              ? <Chip x={x + 10} cy={Y.issue} w={100} n={1} word={s1.word} accent={s1.accent} marked={s1.marked} lit={f.lit(id)} />
              : <Chip x={x + 10} cy={Y.issue} w={84} word={STATUS.siblings.now} accent={0} marked={0} lit={f.lit(id)} />}
            {[0, 1, 2].map((b) => {
              const on = Math.min(1, Math.max(0, ticked * 3 - b));
              const bx = x + 10 + b * 14, by = CARD_Y + 56;
              return (
                <g key={b}>
                  <rect x={bx} y={by} width={9} height={9} rx={1.5} style={{ fill: "var(--pt-top)", stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
                  {on > 0 ? <path className="pt-edge" d={`M ${bx + 2} ${by + 4.5} L ${bx + 4} ${by + 7} L ${bx + 7.5} ${by + 2}`} opacity={r2(on)} style={{ stroke: tone(id) }} /> : null}
                </g>
              );
            })}
            <text className="pt-tag" x={x + 54} y={CARD_Y + 64}>criteria</text>
            {mine ? <text className="pt-tag" x={x + 10} y={CARD_Y + 82}>**Tracker**: #42</text> : null}
          </g>
        );
      })}

      {/* 1. The command writes issue 07, in from below on the left, clear of the bracket. */}
      <Elbow from={[90, BAR.y]} to={[90, CARD_Y + CARD_H + 1]} first="v" progress={grow("ask", 0.04, 0.28)}
        accent={travel("ask", 0.04, 0.28)} lit={f.lit("command")} />

      {/* 2. 07's row in sprint.md: up out of the card, across to the column, up into the row. */}
      <Elbow from={[136, chipTop(Y.issue)]} to={[CLIMB, chipBottom(Y.sprintRow) + 1]} first="v" via={CARD_Y - 7} radius={6}
        progress={grow("sprint", 0.04, 0.2)} accent={travel("sprint", 0.04, 0.2)} lit={f.lit("sprint")} />
      {/* 3. The sprint's own Status, worked out from every issue file: a dotted bracket under all three. */}
      {(() => {
        const g = grow("sprint", 0.2, 0.4), acc = travel("sprint", 0.2, 0.4);
        if (g <= 0) return null;
        const yb = CARD_Y + CARD_H + 12, xr = 438;
        const stroke = acc > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", acc) : mix("var(--pt-ink-2)", "var(--pt-line-2)", f.lit("sprint"));
        const d = `M ${CARDS[0] + CARD_W / 2} ${CARD_Y + CARD_H} L ${CARDS[0] + CARD_W / 2} ${yb} L ${xr} ${yb} L ${xr} ${Y.sprintStatus} L ${COL + CHIP_W + 3} ${Y.sprintStatus}`;
        return (
          <g opacity={r2(g)}>
            {CARDS.slice(1).map((x) => <path key={x} className="pt-wire" data-kind="read" d={`M ${x + CARD_W / 2} ${CARD_Y + CARD_H} L ${x + CARD_W / 2} ${yb}`} style={{ stroke }} />)}
            <path className="pt-wire" data-kind="read" d={d} style={{ stroke }} />
            <path d={`M ${COL + CHIP_W + 3} ${Y.sprintStatus} l 6 -3.5 l 0 7 z`} style={{ fill: stroke }} />
            <text className="pt-tag" x={xr - 6} y={yb + 15} textAnchor="end">rollup: every issue done, so done</text>
          </g>
        );
      })()}

      {/* 4. The sprint's row in epic.md, up through the sprint's wall. */}
      <Elbow from={[CLIMB, chipTop(Y.sprintStatus)]} to={[CLIMB, chipBottom(Y.epicRow) + 1]} first="v" progress={grow("epic", 0.04, 0.2)}
        accent={travel("epic", 0.04, 0.2)} lit={f.lit("epic")} />
      {/* 5. The epic's own Status, worked out from both its sprints' rows, with the reason it stays. */}
      {(() => {
        const g = grow("epic", 0.2, 0.38), acc = travel("epic", 0.2, 0.38);
        if (g <= 0) return null;
        const stroke = acc > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", acc) : mix("var(--pt-ink-2)", "var(--pt-line-2)", f.lit("epic"));
        const x4 = ROW04 + ROW04_W / 2, x3 = COL + 30, ym = r2((chipTop(Y.epicRow) + chipBottom(Y.epicStatus)) / 2);
        return (
          <g opacity={r2(g)}>
            <path className="pt-wire" data-kind="read" d={`M ${x4} ${chipTop(Y.epicRow)} L ${x4} ${ym} L ${x3} ${ym}`} style={{ stroke }} />
            <path className="pt-wire" data-kind="read" d={`M ${x3} ${chipTop(Y.epicRow)} L ${x3} ${chipBottom(Y.epicStatus) + 6}`} style={{ stroke }} />
            <path d={`M ${x3} ${chipBottom(Y.epicStatus) + 1} l -3.5 6 l 7 0 z`} style={{ fill: stroke }} />
            <text className="pt-tag" x={CLIMB - 10} y={chipBottom(Y.epicRow) + 14} textAnchor="end">rollup: 04 not started, so in-progress</text>
          </g>
        );
      })()}

      {/* 6. The epic's row in plan/index.md, up through the epic's wall. */}
      <Elbow from={[CLIMB, chipTop(Y.epicStatus)]} to={[CLIMB, chipBottom(Y.index) + 1]} first="v" progress={grow("index", 0.05, 0.3)}
        accent={travel("index", 0.05, 0.3)} lit={f.lit("index")} />

      {/* The chips, over their lines. */}
      <Chip x={COL} cy={Y.index} n={6} {...s6} lit={f.lit("index")} />
      <Chip x={COL} cy={Y.epicStatus} n={5} {...s5} lit={f.lit("epic")} />
      <Chip x={COL} cy={Y.epicRow} n={4} {...s4} lit={f.lit("epic")} />
      <Chip x={ROW04} cy={Y.epicRow} w={ROW04_W} word={`04 · ${"not-started"}`} accent={0} marked={0} lit={f.lit("epic")} />
      <Chip x={COL} cy={Y.sprintStatus} n={3} {...s3} lit={f.lit("sprint")} />
      <Chip x={COL} cy={Y.sprintRow} n={2} {...s2} lit={f.lit("sprint")} />

      {/* The command, under the tree, and how many of the six plan surfaces are in step. */}
      <Panel box={BAR} radius={6} lit={0.3 + 0.7 * f.lit("command")}>
        <text className="pt-tag" x={BAR.x + 14} y={BAR.y + 22} style={{ fill: tone("command") }}>$ plan-status.mjs set 01-03-07 done --evidence "{EVIDENCE}"</text>
        <text className="pt-tag" x={BAR.x + BAR.width - 14} y={BAR.y + 22} textAnchor="end" style={{ fill: tone("command") }}>{inStep}/6 surfaces in step</text>
      </Panel>

      {/* The completed ledger: a row arrives only for a done with evidence. */}
      <rect className="pt-panel" x={LEDGER.x} y={LEDGER.y} width={LEDGER.width} height={LEDGER.height} rx={6}
        style={{ stroke: mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * f.lit("ledger")) }} />
      {name(LEDGER.x + 10, LEDGER.y + 16, "progress/", "ledger")}
      <text className="pt-tag" x={LEDGER.x + 10} y={LEDGER.y + 35}>completed/{EPIC_DIR}.md</text>
      <Line from={[LEDGER.x + 10, LEDGER.y + 44]} to={[LEDGER.x + LEDGER.width - 10, LEDGER.y + 44]} lit={0} />
      {f.here("ledger") > 0 ? (
        <g opacity={r2(f.here("ledger"))}>
          <Chip x={LEDGER.x + 10} cy={LEDGER.y + 60} w={118} word="01-03/07 · #42" accent={now("ledger", 0.3)} marked={1} lit={f.lit("ledger")} />
          <text className="pt-tag" x={LEDGER.x + 10} y={LEDGER.y + 84}>evidence:</text>
          <text className="pt-tag" x={LEDGER.x + 10} y={LEDGER.y + 98}>"{EVIDENCE}"</text>
        </g>
      ) : null}
      <Elbow from={[LEDGER.x + LEDGER.width / 2, BAR.y]} to={[LEDGER.x + LEDGER.width / 2, LEDGER.y + LEDGER.height + 1]} first="v"
        progress={grow("ledger", 0.05, 0.3)} accent={travel("ledger", 0.05, 0.3)} lit={f.lit("ledger")} />

      {/* The ticket, past the network: the one 07's Tracker field names, moved last. */}
      <rect className="pt-panel" x={TICKET.x} y={TICKET.y} width={TICKET.width} height={TICKET.height} rx={6}
        style={{ stroke: mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * f.lit("ticket")) }} />
      {name(TICKET.x + 10, TICKET.y + 16, "ticket #42", "ticket")}
      <text className="pt-tag" x={TICKET.x + 10} y={TICKET.y + 35}>via gh / glab</text>
      <Chip x={TICKET.x + 10} cy={TICKET.y + 60} w={92} word={tk.word} accent={tk.accent} marked={tk.marked} lit={f.lit("ticket")} />
      <Elbow from={[BAR.x + BAR.width, BAR.y + BAR.height / 2]} to={[TICKET.x + TICKET.width / 2, TICKET.y + TICKET.height + 1]} first="h"
        via={TICKET.x + TICKET.width / 2} progress={grow("ticket", 0.05, 0.32)} accent={travel("ticket", 0.05, 0.32)} lit={f.lit("ticket")} />
    </g>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} viewBox={VIEW} {...props}>
      <Scene />
    </Stage>
  );
}
