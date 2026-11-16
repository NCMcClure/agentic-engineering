"use client";
// toward-a-reference: a rendered picture measured against its reference, and
// where. On the left the two pictures of one shot; in the middle the pictures
// pl draws for a model (the colour-difference map, then one box of both
// pictures enlarged); on the right the numbers, for the whole frame and for
// that box alone. The agent fixes what the box shows and the loop runs again.
//
// Everything measured here was measured: the scene below was rendered twice as
// real PNGs, `pl.mjs iterate cabin` compared each with the reference, and the
// cells are the means of the dE2000 map those runs drew. model.json has them.
import type { Model, Row } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line } from "../kit/flat/connect";
import { mix, tint } from "../kit/flat/geometry";
import type { Box } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, indexOf, lerp, outro, span } from "../kit/timeline";
import data from "./model.json";

const model = data as unknown as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 388 };

// What was measured.
const FIRST = model.data?.["heat-first"] as number[][];
const SECOND = model.data?.["heat-second"] as number[][];
const NUMBERS = model.data?.numbers as Row[];
type Sun = { x: number; y: number; r: number };
const SUNS = Object.fromEntries((model.data?.suns as Row[]).map((s) => [s.id, s as unknown as Sun])) as Record<"reference" | "first" | "second", Sun>;
const BOX = model.data?.box as number[]; // x0, y0, x1, y1 in 0..1 of the frame, as --box takes it
const DE_MAX = 20; // the sheet's fixed scale: dE2000 of 20 and above is the top tint
const STEPS = 5;

// The scene, in 0..1 of a 3:2 frame: the same shapes the measured PNGs were drawn from.
type Pt = readonly [number, number];
const RIDGE: Pt[] = [[0, 0.72], [0.30, 0.34], [0.52, 0.62], [0.66, 0.48], [1, 0.74], [1, 1], [0, 1]];
const HILL: Pt[] = [[0, 0.80], [0.25, 0.70], [0.55, 0.78], [1, 0.66], [1, 1], [0, 1]];
const CABIN: Pt[] = [[0.30, 0.76], [0.30, 0.62], [0.28, 0.62], [0.37, 0.52], [0.46, 0.62], [0.44, 0.62], [0.44, 0.76]];
const WINDOW: Pt[] = [[0.325, 0.655], [0.365, 0.655], [0.365, 0.705], [0.325, 0.705]];
const WHOLE = [0, 0, 1, 1];

// Layout, in px: three columns, two rows.
const PW = 216, PH = 144;
const C1 = 16, C2 = 268, C3 = 520, R1 = 42, R2 = 232;
const REF: Box = { x: C1, y: R1, width: PW, height: PH };
const REN: Box = { x: C1, y: R2, width: PW, height: PH };
const HEAT: Box = { x: C2, y: R1, width: PW, height: PH };
const TILE = 104;
const TILE_A: Box = { x: C2, y: R2, width: TILE, height: TILE };
const TILE_B: Box = { x: C2 + PW - TILE, y: R2, width: TILE, height: TILE };
const NUM1: Box = { x: C3, y: R1, width: 224, height: PH };
const NUM2: Box = { x: C3, y: R2, width: 224, height: PH };
const COLS = FIRST[0].length, ROWS = FIRST.length, CELL = PW / COLS;
const boxIn = (p: Box): Box => ({ x: p.x + BOX[0] * p.width, y: p.y + BOX[1] * p.height, width: (BOX[2] - BOX[0]) * p.width, height: (BOX[3] - BOX[1]) * p.height });
const HEAT_BOX = boxIn(HEAT);

const r = (v: number) => Math.round(v * 100) / 100;
const ink = (share: number) => mix("var(--pt-ink)", "var(--pt-top)", share);
/** A cell's tone for its share of the fixed scale: blank at none, and the lowest step dark enough to count. */
const heat = (share: number) => ink(share <= 0 ? 0 : Math.min(1, share * 4) * 0.14 + 0.72 * share);
const lerpBox = (a: Box, b: Box, p: number): Box => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), width: lerp(a.width, b.width, p), height: lerp(a.height, b.height, p) });
const onPanel = { ["--pt-halo" as string]: "var(--pt-top)" };

/** The scene, or one window of it (x0, y0, x1, y1 in 0..1), drawn to fill a box. Each disc is one state of the sun. */
function Scene({ box, view = WHOLE, suns }: { box: Box; view?: number[]; suns: { sun: Sun; opacity?: number; accent?: number }[] }) {
  const sx = box.width / (view[2] - view[0]), sy = box.height / (view[3] - view[1]);
  const at = ([u, v]: Pt) => `${r(box.x + (u - view[0]) * sx)},${r(box.y + (v - view[1]) * sy)}`;
  const shape = (pts: Pt[], share: number) => <polygon points={pts.map(at).join(" ")} style={{ fill: ink(share) }} />;
  return (
    <g>
      {suns.map(({ sun, opacity = 1, accent = 0 }, i) => opacity > 0 ? (
        <circle key={i} cx={r(box.x + (sun.x - view[0]) * sx)} cy={r(box.y + (sun.y - view[1]) * sy)} r={r(sun.r * sy)} opacity={r(opacity)}
          style={{ fill: accent > 0 ? mix("var(--pt-accent)", ink(0.6), accent) : ink(0.6) }} />
      ) : null)}
      {shape(RIDGE, 0.17)}
      {shape(HILL, 0.36)}
      {shape(CABIN, 0.8)}
      {shape(WINDOW, 0)}
    </g>
  );
}

/** One group of the readout: three numbers, as the first run and the second measured them. */
function Readout({ box, rows, one, two, hotOne = 0, hotTwo = 0, lit = 1 }: { box: Box; rows: Row[]; one: number; two: number; hotOne?: number; hotTwo?: number; lit?: number }) {
  const x0 = box.x + 106, x1 = box.x + 160, x2 = box.x + 212;
  const value = (v: number, digits: number) => v.toFixed(digits);
  return (
    <g opacity={r(0.6 + 0.4 * lit)}>
      <text className="pt-tag" x={x0} y={box.y + 22} textAnchor="end" style={{ ...onPanel, fill: "var(--pt-ink-3)" }}>if same</text>
      <text className="pt-tag" x={x1} y={box.y + 22} textAnchor="end" style={onPanel}>run 1</text>
      <text className="pt-tag" x={x2} y={box.y + 22} textAnchor="end" style={onPanel}>run 2</text>
      <line className="pt-rule" x1={box.x + 12} x2={box.x + box.width - 12} y1={box.y + 31} y2={box.y + 31} />
      {rows.map((row, i) => {
        const y = box.y + 54 + i * 32;
        const first = row.first as number, second = row.second as number, digits = row.digits as number;
        return (
          <g key={row.id as string}>
            <text className="pt-label" x={box.x + 12} y={y} style={onPanel}>{row.name as string}</text>
            <text className="pt-tag" x={box.x + 12} y={y + 13} style={onPanel}>{row.what as string}</text>
            <text className="pt-num" x={x0} y={y + 5} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--pt-ink-3)" }}>{String(row.same)}</text>
            {one > 0 ? (
              <text className="pt-num" x={x1} y={y + 5} textAnchor="end" opacity={r(one)}
                style={{ fontSize: 11.5, fill: hotOne > 0.5 ? "var(--pt-accent-ink)" : two > 0.5 ? "var(--pt-ink-2)" : "var(--pt-ink)" }}>{value(first, digits)}</text>
            ) : <text className="pt-num" x={x1} y={y + 5} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--pt-ink-3)" }}>–</text>}
            {two > 0 ? (
              <text className="pt-num" x={x2} y={y + 5} textAnchor="end" opacity={r(two)}
                style={{ fontSize: 11.5, fill: hotTwo > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>{value(second, digits)}</text>
            ) : <text className="pt-num" x={x2} y={y + 5} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--pt-ink-3)" }}>–</text>}
          </g>
        );
      })}
    </g>
  );
}

function Figure_() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  /** 0 before the beat, its progress in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const arrive = (id: string, a = 0, b = 0.3) => ease.out(span(through(id), a, b));
  const resting = f.frame.beat.rest ? 1 : 0;
  // What the story built up goes before the loop starts over, so the first frame and the last agree.
  const leaving = outro(f.tl, f.frame);

  // The map: drawn column by column in its beat, then drawn again from the second run.
  const drawn = through("map");
  const second = arrive("again", 0.1, 0.4);
  const share = (row: number, col: number) => {
    const shown = ease.out(span(drawn, 0.06 + (0.3 * col) / COLS, 0.14 + (0.3 * col) / COLS));
    return lerp(tint(FIRST[row][col], 0, DE_MAX, STEPS) * shown, tint(SECOND[row][col], 0, DE_MAX, STEPS), second) * leaving;
  };

  // The box, and the same box of both pictures opening out of it.
  const boxed = arrive("crop", 0.03, 0.16) * leaving;
  const opened = arrive("crop", 0.14, 0.42);
  const tileA = lerpBox(HEAT_BOX, TILE_A, opened), tileB = lerpBox(HEAT_BOX, TILE_B, opened);
  const cropNow = f.on("crop");

  // The numbers: the frame's, then the box's; the second run beside the first.
  const frameOne = arrive("numbers", 0.05, 0.2) * leaving, boxOne = arrive("numbers", 0.2, 0.4);
  const frameTwo = arrive("again", 0.2, 0.4) * leaving, boxTwo = arrive("again", 0.26, 0.44);
  const boxPanel = arrive("numbers", 0.08, 0.26) * leaving;

  // The fix: the render's sun goes where the reference has it. The loop's last moments put the first render back.
  const fixed = arrive("fix", 0.14, 0.42);
  const sunNow: Sun = { x: lerp(SUNS.first.x, SUNS.second.x, fixed), y: lerp(SUNS.first.y, SUNS.second.y, fixed), r: lerp(SUNS.first.r, SUNS.second.r, fixed) };
  const fixing = f.on("fix");
  // The enlarged box is a picture pl drew of the first render: it shows the new one when it is drawn again.
  const redrawn = arrive("again", 0.1, 0.4);
  const sunCropped: Sun = { x: lerp(SUNS.first.x, SUNS.second.x, redrawn), y: lerp(SUNS.first.y, SUNS.second.y, redrawn), r: lerp(SUNS.first.r, SUNS.second.r, redrawn) };
  const rendered = [{ sun: sunNow, opacity: fixed > 0 ? leaving : 1, accent: fixing }, ...(fixed > 0 && leaving < 1 ? [{ sun: SUNS.first, opacity: 1 - leaving }] : [])];

  const pulse = (id: string, a = 0.04, b = 0.4) => (f.moving(id) > 0 && p < b + 0.02 ? ease.out(span(p, a, b)) : undefined);
  const wireLit = (id: string) => Math.max(f.moving(id), resting, 0.2);
  const frameOf = (id: string) => Math.max(f.lit(id), 0.45);
  const again = f.on("again");

  return (
    <g>
      {/* What the agent made, and what it is measured against */}
      <text className="pt-label" x={REF.x} y={REF.y - 10}>Reference</text>
      <text className="pt-tag" x={REF.x + PW} y={REF.y - 10} textAnchor="end">reference.png</text>
      <Panel box={REF} lit={frameOf("reference")}>
        <Scene box={REF} suns={[{ sun: SUNS.reference }]} />
      </Panel>
      <text className="pt-label" x={REN.x} y={REN.y - 10}>Agent&apos;s render</text>
      <text className="pt-tag" x={REN.x + PW} y={REN.y - 10} textAnchor="end">candidate.png</text>
      <Panel box={REN} lit={frameOf("render")} accent={Math.max(f.on("render"), fixing)}>
        <Scene box={REN} suns={rendered} />
      </Panel>
      {boxed > 0 ? [REF, REN].map((pic, i) => {
        const b = boxIn(pic);
        return <rect key={i} className="pt-guide" x={r(b.x)} y={r(b.y)} width={r(b.width)} height={r(b.height)} rx={2} opacity={r(boxed)} />;
      }) : null}

      {/* Both pictures go to the comparison */}
      <Elbow from={[REF.x + PW, R1 + 58]} to={[HEAT.x, R1 + 58]} pulse={pulse("match", 0.02, again > 0 ? 0.2 : 0.3)} lit={wireLit("match")} />
      <Elbow from={[REN.x + PW, R2 + 30]} to={[HEAT.x, R1 + 88]} via={C1 + PW + 18} radius={8} pulse={pulse("compare", 0.02, again > 0 ? 0.2 : 0.3)} lit={wireLit("compare")} />

      {/* The picture pl draws: where they differ, on the sheet's fixed scale */}
      <text className="pt-label" x={HEAT.x} y={HEAT.y - 10}>Where they differ</text>
      <g>
        <text className="pt-tag" x={HEAT.x + PW - 66} y={HEAT.y - 10} textAnchor="end">ΔE</text>
        {Array.from({ length: STEPS }, (_, i) => (
          <rect key={i} x={HEAT.x + PW - 62 + i * 8} y={HEAT.y - 17.5} width={7} height={7} rx={1.5}
            style={{ fill: heat(i / (STEPS - 1)), stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
        ))}
        <text className="pt-tag" x={HEAT.x + PW} y={HEAT.y - 10} textAnchor="end">20+</text>
      </g>
      <Panel box={HEAT} lit={frameOf("heat")} accent={f.on("map")}>
        {FIRST.map((cells, row) => cells.map((_, col) => (
          <rect key={`${row}-${col}`} className="pt-cell" x={r(HEAT.x + col * CELL)} y={r(HEAT.y + row * CELL)} width={CELL} height={CELL}
            style={{ fill: heat(share(row, col)) }} />
        )))}
      </Panel>

      {/* How far, as numbers: the whole frame */}
      <Elbow from={[HEAT.x + PW, R1 + 72]} to={[NUM1.x, R1 + 72]} pulse={pulse("score", again > 0 ? 0.2 : 0.04, 0.4)} lit={wireLit("score")} />
      <text className="pt-label" x={NUM1.x} y={NUM1.y - 10}>Whole frame</text>
      <Panel box={NUM1} lit={frameOf("whole")}>
        <Readout box={NUM1} rows={NUMBERS.filter((n) => n.of === "whole")} one={frameOne} two={frameTwo} />
      </Panel>

      {/* The same three numbers for the box alone: not there until the agent names a box */}
      {boxPanel < 1 ? <rect className="pt-guide" x={NUM2.x + 0.5} y={NUM2.y + 0.5} width={NUM2.width - 1} height={NUM2.height - 1} rx={8} opacity={r(1 - boxPanel)} /> : null}
      {boxPanel > 0 ? (
        <g opacity={r(leaving)}>
          <text className="pt-label" x={NUM2.x} y={NUM2.y - 10} opacity={r(arrive("numbers", 0.08, 0.26))}>Inside the box</text>
          <Elbow from={[TILE_B.x + TILE, R2 + 72]} to={[NUM2.x, R2 + 72]} progress={arrive("numbers", 0.08, 0.3)} pulse={pulse("region", again > 0 ? 0.22 : 0.16, 0.42)} lit={wireLit("region")} />
          <Panel box={NUM2} here={arrive("numbers", 0.08, 0.26)} lit={frameOf("inside")} accent={Math.max(f.on("numbers"), again)}>
            <Readout box={NUM2} rows={NUMBERS.filter((n) => n.of === "inside")} one={boxOne} two={boxTwo} hotOne={f.on("numbers")} hotTwo={again} />
          </Panel>
        </g>
      ) : null}

      {/* The fix goes back to the render */}
      {through("fix") > 0 && leaving > 0 ? (
        <g opacity={r(leaving)}>
          <Elbow from={[TILE_A.x, R2 + 86]} to={[REN.x + PW, R2 + 86]} progress={arrive("fix", 0, 0.14)} accent={fixing} pulse={pulse("fix", 0.02, 0.3)} lit={wireLit("fix")} />
          <text className="pt-tag" x={C1 + PW + 18} y={R2 + 76} textAnchor="middle" opacity={r(arrive("fix", 0.08, 0.2))}
            style={{ fill: fixing > 0.5 ? "var(--pt-accent-ink)" : undefined }}>fix</text>
        </g>
      ) : null}

      {/* The box the agent draws on the map, and that box of both pictures, enlarged */}
      {boxed > 0 ? (
        <g opacity={r(boxed)}>
          <Line from={[HEAT_BOX.x, HEAT_BOX.y + HEAT_BOX.height]} to={[tileA.x, tileA.y]} dashed lit={Math.max(cropNow, 0.4)} />
          <Line from={[HEAT_BOX.x + HEAT_BOX.width, HEAT_BOX.y + HEAT_BOX.height]} to={[tileB.x + tileB.width, tileB.y]} dashed lit={Math.max(cropNow, 0.4)} />
          <rect x={r(HEAT_BOX.x)} y={r(HEAT_BOX.y)} width={r(HEAT_BOX.width)} height={r(HEAT_BOX.height)} rx={2}
            style={{ fill: "none", stroke: mix("var(--pt-accent)", "var(--pt-ink-2)", cropNow), strokeWidth: 1.5 }} />
        </g>
      ) : null}
      {opened <= 0 || leaving < 1 ? [TILE_A, TILE_B].map((t, i) => (
        <rect key={i} className="pt-guide" x={t.x + 0.5} y={t.y + 0.5} width={t.width - 1} height={t.height - 1} rx={6} opacity={r(opened <= 0 ? 1 : 1 - leaving)} />
      )) : null}
      {opened > 0 && leaving > 0 ? (
        <g opacity={r(leaving)}>
          <Panel box={tileA} radius={6} here={Math.min(1, opened * 3)} lit={frameOf("crop")} accent={cropNow}>
            <Scene box={tileA} view={BOX} suns={[{ sun: SUNS.reference }]} />
          </Panel>
          <Panel box={tileB} radius={6} here={Math.min(1, opened * 3)} lit={frameOf("crop")} accent={cropNow}>
            <Scene box={tileB} view={BOX} suns={[{ sun: sunCropped }]} />
          </Panel>
          <g opacity={r(span(opened, 0.8, 1))}>
            <text className="pt-label" x={C2 + PW / 2} y={R2 - 10} textAnchor="middle">The box, enlarged</text>
            <text className="pt-tag" x={TILE_A.x + TILE / 2} y={R2 + TILE + 15} textAnchor="middle">reference</text>
            <text className="pt-tag" x={TILE_B.x + TILE / 2} y={R2 + TILE + 15} textAnchor="middle">candidate</text>
            <text className="pt-tag" x={C2 + PW / 2} y={R2 + TILE + 33} textAnchor="middle">--box {BOX.join(",")} --zoom 3</text>
          </g>
        </g>
      ) : null}
    </g>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} viewBox={VIEW} {...props}>
      <Figure_ />
    </Stage>
  );
}
