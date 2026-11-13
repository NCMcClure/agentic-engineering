"use client";
// Study: before, rule, after. Number tiles start as a list, are cut and merged
// back into two sorted runs, and those stand as columns over the row they are
// merged into: each step the smaller of the two front tiles rides a line down
// to the next place. Reach for it only when the subject turns one arrangement
// into another by a rule applied to one element at a time.
import type { Model } from "../kit/model";
import { cells, entity, flow, quantity, rows, unitsOf } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, Queue, onElbow } from "../kit/flat/connect";
import { range, tint } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel, Tile } from "../kit/flat/panel";
import { Label } from "../kit/label";
import { ease, indexOf, lerp, span, steps } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 640, height: 380 };

// The subject, from the model: the list at each level of merging, and the last merge item by item.
const LEVELS = cells(model, "levels");
const STEPS = rows(model, "last-merge");
const N = LEVELS[0].length;
const HALF = N / 2;
const { lo: LO, hi: HI } = range(LEVELS);
const COMPARED = quantity(model, "compared");

// The layout, in px.
const S = 36; // a tile
const CX = VIEW.width / 2;
const ROW_Y = 44; // the list
const CUT = [18, 12, 8]; // the gap a cut opens: halves, quarters, ones
const TICK = [12, 8, 4]; // how far its mark hangs under the row
const COL_X = [CX - 14 - S, CX + 14]; // the two runs, side by side
const COL_TOP = 120;
const FRONT_Y = COL_TOP + (HALF - 1) * S; // a run's front is the bottom of its column
const PAIR: Box = { x: COL_X[0] - 5, y: FRONT_Y - 5, width: COL_X[1] + S - COL_X[0] + 10, height: S + 10 };
const LANE_Y = 293; // where a taken tile crosses to its place
const OUT_X = CX - (N * S) / 2; // the merged run
const OUT_Y = 322;

const square = (x: number, y: number): Box => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, width: S, height: S });
/** How deep the cut at boundary b is: 0 the first cut (in half), 2 the last (to ones). */
const depthOf = (b: number) => { let d = 0; for (let size = HALF; b % size !== 0; size /= 2) d += 1; return d; };
const DEPTHS = depthOf(1) + 1;
/** A number's size as its tile's tint: the smallest still a shade off the page. */
const shade = (value: number) => 0.12 + 0.88 * tint(value, LO, HI, HI - LO + 1);

/** Where place i of the row starts, given the gap at each boundary. The row stays centred. */
function rowX(i: number, gap: readonly number[]): number {
  let total = 0, before = 0;
  for (let b = 1; b < N; b++) {
    total += gap[b];
    if (b <= i) before += gap[b];
  }
  return CX - (N * S + total) / 2 + i * S + before;
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const within = (id: string) => (index < at(id) ? 0 : index === at(id) ? p : 1);
  const cp = within("cut"), pp = within("pairs"), fp = within("fronts");

  // Cutting: three cuts, each opening its gaps, all made by the middle of the beat.
  const cutAt = (d: number) => 0.06 + 0.14 * d;
  const cut = Array.from({ length: DEPTHS }, (_, d) => ease.out(span(cp, cutAt(d), cutAt(d) + 0.14)));
  const cutting = (d: number) => (index === at("cut") ? span(p, cutAt(d), cutAt(d) + 0.04) * (1 - span(p, cutAt(d) + 0.2, cutAt(d) + 0.3)) : 0);

  // Merging: each level is one sweep along the row, a run at a time, left to right.
  const sweep = [steps(pp, N / 2, 0.08, 0.56), steps(pp, N / 4, 0.62, 0.94)];
  const merged = (level: number, k: number) => (k < sweep[level].index ? 1 : k === sweep[level].index ? sweep[level].t : 0);
  const slide = (m: number) => ease.inOut(span(m, 0.15, 0.5)); // a gap closes as the larger tiles slide right over it
  const gap = Array.from({ length: N }, (_, b) => {
    if (b === 0) return 0;
    const d = depthOf(b), level = DEPTHS - 1 - d;
    return CUT[d] * cut[d] * (level < sweep.length ? 1 - slide(merged(level, Math.floor(b / 2 ** (level + 1)))) : 1);
  });
  const feed = span(fp, 0, 0.22); // the two fours go down to stand as the two runs, front first
  const stood = ease.inOut(feed);

  // The last merge: one step per item taken. `step` is the one under way and q how far through it.
  let step = 0, q = 0;
  if (index === at("fronts")) q = steps(p, 1, 0.24, 0.88).t;
  else if (index === at("drain")) {
    const s = steps(p, STEPS.length - 1);
    step = 1 + s.index;
    q = s.t;
  } else if (index > at("drain")) step = STEPS.length;
  const now = step < STEPS.length ? STEPS[step] : null;
  const decided = span(q, 0.1, 0.28); // the comparison is made
  const take = ease.out(span(q, 0.3, 1)); // the smaller travels
  const down = ease.out(span(q, 0.68, 1)); // the next one steps to the front
  const stands = 1 - span(q, 0.55, 0.68); // the comparison still stands, until the next one steps up
  const sideOf = (from: unknown) => (from === "left" ? 0 : 1);
  const taken = (side: number) => STEPS.slice(0, step).filter((s) => sideOf(s.from) === side).length;
  const front = (side: number): P2 => [COL_X[side], FRONT_Y];
  const place = (j: number): P2 => [OUT_X + j * S, OUT_Y];
  const merging = f.on("fronts", "drain") * stood;

  const tiles = LEVELS[0].map((value) => {
    const i0 = LEVELS[0].indexOf(value), i1 = LEVELS[1].indexOf(value), i2 = LEVELS[2].indexOf(value);
    const side = i2 < HALF ? 0 : 1, r = i2 % HALF;
    const mine = ease.inOut(span(feed, r * 0.12, r * 0.12 + 0.64));
    if (mine <= 0) {
      // In the row. In a merge the larger tiles slide right, and a smaller one drops out, passes under them, and comes up in front.
      const m1 = merged(0, Math.floor(i0 / 2)), m2 = merged(1, Math.floor(i1 / 4));
      const across = (a: number, b: number, m: number) => (b < a ? ease.inOut(span(m, 0.2, 0.7)) : slide(m));
      const under = (a: number, b: number, m: number) => (b < a ? (ease.out(span(m, 0, 0.15)) - ease.inOut(span(m, 0.7, 0.95))) * (S + 2) : 0);
      return { value, accent: 0, x: lerp(lerp(rowX(i0, gap), rowX(i1, gap), across(i0, i1, m1)), rowX(i2, gap), across(i1, i2, m2)), y: ROW_Y + under(i0, i1, m1) + under(i1, i2, m2) };
    }
    if (feed < 1) {
      // A run leaves the row front first: each tile drops out, passes under to its column and falls to the lowest free slot.
      const [x, y] = onElbow([rowX(i2, gap), ROW_Y], [COL_X[side], FRONT_Y - r * S], mine, { first: "v", via: ROW_Y + S + 2 });
      return { value, accent: 0, x, y };
    }
    const j = STEPS.findIndex((s) => s.value === value);
    if (j < step) return { value, accent: 0, x: place(j)[0], y: place(j)[1] };
    if (j === step) {
      const [x, y] = onElbow(front(side), place(j), take, { first: "v", via: LANE_Y - S / 2 });
      return { value, accent: decided * (1 - span(q, 0.92, 1)), x, y };
    }
    const slot = r - taken(side) - (now && sideOf(now.from) === side ? down : 0);
    return { value, accent: 0, x: COL_X[side], y: FRONT_Y - slot * S };
  });
  // The one in flight is drawn last, over the rest.
  const order = [...tiles].sort((a, b) => a.accent - b.accent);

  // The run being merged in the row now, if one is.
  const making = sweep.map((s, level) => {
    const glow = index === at("pairs") ? span(s.t, 0, 0.15) * (1 - span(s.t, 0.85, 1)) : 0;
    if (glow <= 0) return null;
    const length = 2 ** (level + 1), a = s.index * length, x = rowX(a, gap) - 4;
    return <Panel key={level} box={{ x, y: ROW_Y - 4, width: rowX(a + length - 1, gap) + S + 4 - x, height: S + 8 }} radius={6} accent={1} here={glow} />;
  });
  // A level counts from the moment its sweep begins; the one under way is the orange one.
  const levels = index < at("pairs") ? 0 : span(pp, 0.06, 0.1) + span(pp, 0.6, 0.64) + span(fp, 0, 0.04);
  // A comparison counts from the moment it is made: its pip arrives over the first two fifths of its step, and holds.
  const level = f.level("compared"), whole = Math.floor(level + 1e-9);
  const compared = whole + span(level - whole, 0, 0.4);
  const dim = (id: string) => 0.62 + 0.38 * f.lit(id);
  const mid = FRONT_Y + S / 2;

  return (
    <g opacity={f.present}>
      {/* Places: where the list was, where each run stands, where the merged run is built. */}
      <Tile box={{ x: OUT_X, y: ROW_Y, width: N * S, height: S }} empty here={stood} />
      {COL_X.map((x) => <Tile key={x} box={{ x, y: COL_TOP, width: S, height: HALF * S }} empty />)}
      <Tile box={{ x: OUT_X, y: OUT_Y, width: N * S, height: S }} empty />
      {Array.from({ length: N - 1 }, (_, i) => <Line key={i} from={[OUT_X + (i + 1) * S, OUT_Y + 6]} to={[OUT_X + (i + 1) * S, OUT_Y + S - 6]} lit={0} />)}

      {/* The two halves of the list go down to be the two runs, and each run offers its front. */}
      {[0, 1].map((side) => {
        const out = side ? 1 : -1, lit = f.lit(side ? "right" : "left");
        return (
          <g key={side}>
            <Elbow from={[CX + out * (CUT[0] / 2 + (HALF * S) / 2), ROW_Y + S + 8]} to={[COL_X[side] + S / 2, COL_TOP - 4]} first="v" via={ROW_Y + S + 22} quiet lit={lit} />
            <Elbow from={[COL_X[side] + S / 2 + out * (S / 2 + 18), COL_TOP + 8]} to={[side ? PAIR.x + PAIR.width : PAIR.x, mid]} first="v" via={mid} quiet lit={lit} />
          </g>
        );
      })}

      {/* A cut: a mark in each gap it opens, longer for an earlier cut, orange while it is being made. */}
      {gap.map((width, b) => {
        if (b === 0 || width <= 0.2) return null;
        const d = depthOf(b), x = Math.round((rowX(b, gap) - width / 2) * 100) / 100;
        return (
          <g key={b} opacity={Math.min(1, (2 * width) / CUT[d]) * (1 - stood)}>
            <Line from={[x, ROW_Y - (d === 0 ? 10 : 2)]} to={[x, ROW_Y + S + TICK[d]]} accent={cutting(d)} lit={0} />
          </g>
        );
      })}

      {/* What holds the accent: the run being merged, the two fronts, the list once it is in order. */}
      {making}
      <Panel box={PAIR} radius={6} accent={1} here={merging} />
      <Panel box={{ x: OUT_X - 4, y: OUT_Y - 4, width: N * S + 8, height: S + 8 }} radius={6} accent={1} here={f.on("sorted")} />

      {/* The line the smaller one takes, from under its front to the next place. */}
      {now && decided > 0 ? (
        <g opacity={1 - span(q, 0.92, 1)}>
          <Elbow from={[COL_X[sideOf(now.from)] + S / 2, PAIR.y + PAIR.height]} to={[place(step)[0] + S / 2, OUT_Y - 3]} first="v" via={LANE_Y} accent={1} progress={decided} />
        </g>
      ) : null}

      {order.map((t) => {
        const box = square(t.x, t.y), share = shade(t.value);
        return (
          <g key={t.value}>
            <Tile box={box} share={share} accent={t.accent} />
            {/* The numeral is written here, in the ink: the numbers are the picture, and must read on every tint. */}
            <text className="pt-num" x={box.x + S / 2} y={box.y + S / 2 + 5.5} textAnchor="middle" style={{ fontSize: 15, fill: t.accent > 0.5 || share > 0.8 ? "var(--pt-bg)" : "var(--pt-ink)" }}>{t.value}</text>
          </g>
        );
      })}

      {/* The comparison, written between the fronts. The one just taken stays written at its front while it travels, so a still reads the whole of it. */}
      {now && now.against !== undefined && feed >= 1 ? (
        <g opacity={stands} style={{ fill: "var(--pt-accent)" }}>
          <text className="pt-num" x={CX} y={mid + 5.5} textAnchor="middle" style={{ fontSize: 16, fill: "inherit" }}>{sideOf(now.from) === 0 ? "<" : ">"}</text>
          <text className="pt-num" x={COL_X[sideOf(now.from)] + S / 2} y={mid + 5.5} textAnchor="middle" opacity={span(q, 0.34, 0.42)} style={{ fontSize: 15, fill: "inherit" }}>{String(now.value)}</text>
        </g>
      ) : null}

      {/* Words. */}
      <Label entity="list" at={[128, ROW_Y + 16]} dx={0} dy={0} anchor="end" sub={entity(model, "list").note} dot={false} leader={false} />
      <text className="pt-tag" x={CX} y={ROW_Y - 16} textAnchor="middle" opacity={f.moving("cut")}>{flow(model, "cut").label}</text>
      <Label entity="level" at={[513, ROW_Y + 16]} dx={0} dy={0} anchor="start" sub={entity(model, "level").note} dot={false} leader={false} />
      <g opacity={dim("level")}>
        <Queue at={[582, ROW_Y + 12.5]} count={unitsOf(model, "level")} filled={levels} gap={13} r={5} accent={f.on("pairs", "fronts", "drain")} />
      </g>
      <Label entity="left" at={[COL_X[0] - 28, COL_TOP + 24]} dx={0} dy={0} anchor="end" sub={entity(model, "left").note} dot={false} leader={false} />
      <Label entity="right" at={[COL_X[1] + S + 28, COL_TOP + 24]} dx={0} dy={0} anchor="start" sub={entity(model, "right").note} dot={false} leader={false} />
      <Label entity="fronts" at={[COL_X[1] + S + 28, FRONT_Y - 2]} dx={0} dy={0} anchor="start" sub={entity(model, "fronts").note} dot={false} leader={false} />
      <g opacity={dim("fronts")}>
        <Queue at={[COL_X[1] + S + 32.5, FRONT_Y + 26]} count={COMPARED.max ?? 0} filled={compared} gap={12} accent={merging} />
        <text className="pt-tag" x={COL_X[1] + S + 44 + 12 * (COMPARED.max ?? 0)} y={FRONT_Y + 29.5}>{Math.ceil(level - 1e-9)} of {COMPARED.max} {COMPARED.unit}</text>
      </g>
      <text className="pt-tag" x={OUT_X - 10} y={LANE_Y + 3.5} textAnchor="end" opacity={f.moving("take") * stood}>{flow(model, "take").label}</text>
      <Label entity="merged" at={[OUT_X, OUT_Y + S / 2]} dx={-30} dy={4} anchor="end" sub={entity(model, "merged").note} />
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
