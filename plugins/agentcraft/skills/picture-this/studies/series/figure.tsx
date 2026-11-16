"use client";
// Study: static series. One small panel per beat, each a held frame of
// the same scene with one more idea in it than the last. Nothing moves but
// the mark under the panel being told. Reach for it only when the figure must work
// as a still: a README, a printed page, a slide.
import type { Model } from "../kit/model";
import { told } from "../kit/model";
import { Hold, Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { extent, row } from "../kit/iso/place";
import { fitBox } from "../kit/iso/project";
import { IsoScene, standing } from "../kit/iso/scene";
import data from "./model.json";

const model = data as Model;
// Small panels: names only, and things a little further apart than a single scene needs.
const UNIT = 24;
const BOX = standing(model.entities, row(model.entities.map((e) => e.id), { gap: 2.0 }));
if (BOX.store && BOX.worker) BOX.store = { ...BOX.store, at: [BOX.worker.at[0], 4.4, 0] };

// One panel's own picture, and the panels laid in a row.
const PANEL = fitBox(extent(Object.values(BOX)).points, UNIT, [44, 22, 14, 22]);
const beats = told(model);
const GUTTER = 28, CAPTION = 46;
const VIEW = { x: 0, y: 0, width: beats.length * PANEL.width + (beats.length - 1) * GUTTER, height: PANEL.height + CAPTION };

function Panels() {
  const f = useFigure();
  return (
    <>
      {beats.map((beat, i) => {
        const x = i * (PANEL.width + GUTTER);
        const on = f.frame.beat.id === beat.id || f.frame.beat.rest;
        return (
          <g key={beat.id}>
            <svg x={x} y={0} width={PANEL.width} height={PANEL.height} viewBox={`${PANEL.x} ${PANEL.y} ${PANEL.width} ${PANEL.height}`} overflow="visible">
              {/* Held at the middle of its beat, with only what has arrived by then. */}
              <Hold beat={beat.id} build>
                <IsoScene boxes={BOX} notes={false} rise={34} />
              </Hold>
            </svg>
            <path className="pt-edge" d={`M ${x} ${PANEL.height + 10} L ${x + PANEL.width} ${PANEL.height + 10}`} style={{ stroke: on ? "var(--pt-accent)" : "var(--pt-line-2)" }} />
            <text className="pt-label" x={x} y={PANEL.height + 30} opacity={on ? 1 : 0.62}>{`${String.fromCharCode(97 + i)} · ${beat.title}`}</text>
          </g>
        );
      })}
    </>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} {...props}>
      <Panels />
    </Stage>
  );
}
