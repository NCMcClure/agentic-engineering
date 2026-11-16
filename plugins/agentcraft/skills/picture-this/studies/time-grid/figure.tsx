"use client";
// Study: time grid. Stages down the side, ticks along the top, and a token
// per unit of work that steps one cell a tick and leaves its trail behind it,
// so every moment is on the page at once. Reach for it only when the subject
// is work moving through stages in time, and when it overlaps is the point.
import { Lanes, Meter } from "../kit/flat/chart";
import { Token } from "../kit/flat/connect";
import { middle, slotIn } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { line } from "../kit/iso/project";
import type { Hue, Model } from "../kit/model";
import { entity, quantity, rows, unitsOf } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { ease, lerp } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
// The stages are the model's entities, in order; the last one is the unit that moves through them.
const UNIT = "server";
const stages = model.entities.filter((e) => e.id !== UNIT);
const units = unitsOf(model, UNIT);
const HUES: Hue[] = ["blue", "green", "violet", "yellow"];
// How many ticks each beat covers: the story's clock, in the model.
const spans = rows(model, "ticks");
const TICKS = Math.max(...spans.map((s) => Number(s.to))) + 1;
// A unit waits in the first stage, spends one tick in each stage between, and stays in the last.
const between = stages.length - 2;
const stageAt = (unit: number, tick: number) => Math.min(stages.length - 1, Math.max(0, tick - unit * between));

const VIEW = { x: 0, y: 0, width: 720, height: 316 };
const GRID: Box = { x: 152, y: 58, width: 470, height: 220 };
const METER: Box = { x: 664, y: 58, width: 12, height: 220 };

function Grid() {
  const f = useFigure();
  // The tick the clock is on, as a number that runs through each beat's span.
  const span = spans.find((s) => s.at === f.frame.beat.id);
  const now = span ? lerp(Number(span.from), Number(span.to), f.frame.p) : TICKS - 1;
  const whole = Math.min(TICKS - 1, Math.floor(now)), step = ease.inOut(now - whole);
  // Each unit keeps its own place across a cell, so two in one stage sit side by side.
  const at = (unit: number, tick: number): P2 => {
    const [x, y] = middle(slotIn(GRID, TICKS, stages.length, tick, stageAt(unit, tick)));
    return [x + (unit - (units - 1) / 2) * 11, y];
  };
  const serving = quantity(f.model, "serving");
  return (
    <g opacity={f.present}>
      <Lanes box={GRID} rows={stages.map((s) => s.label)} columns={TICKS} now={now + 0.5} />
      {Array.from({ length: units }, (_, u) => {
        const trail = Array.from({ length: whole + 1 }, (_, t) => at(u, t));
        const [ax, ay] = at(u, whole), [bx, by] = at(u, Math.min(TICKS - 1, whole + 1));
        const here: P2 = [lerp(ax, bx, step), lerp(ay, by, step)];
        return (
          <g key={u}>
            <path className="pt-wire" d={line([...trail, here])} />
            {trail.map((p, t) => <Token key={t} at={p} r={3} hue={HUES[u % HUES.length]} lit={0.25} />)}
            <Token at={here} r={6} hue={HUES[u % HUES.length]} />
          </g>
        );
      })}
      {/* The units, named once, over the gutter. */}
      {Array.from({ length: units }, (_, u) => <Token key={u} at={[20 + u * 66, 24]} r={4} hue={HUES[u % HUES.length]} label={`${entity(f.model, UNIT).label}-${u + 1}`} />)}
      <Meter box={METER} value={f.share("serving")} ticks={serving.max} />
      <text className="pt-label" x={METER.x + METER.width / 2} y={GRID.y - 26} textAnchor="middle">{serving.label}</text>
      <text className="pt-tag" x={METER.x + METER.width / 2} y={GRID.y - 12} textAnchor="middle">{`${Math.round(f.level("serving"))} of ${serving.max}`}</text>
    </g>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} viewBox={VIEW} {...props}>
      <Grid />
    </Stage>
  );
}
