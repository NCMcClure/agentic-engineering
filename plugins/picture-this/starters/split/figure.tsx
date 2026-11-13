"use client";
// Archetype: A/B split. Two arrangements of the same job, one behind the
// other, each named. Reach for it when the point is a difference: before and
// after, without and with, their way and ours.
import type { Model } from "../kit/model";
import { groups } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { extent, row } from "../kit/iso/place";
import type { Box } from "../kit/iso/place";
import { fitBox, project } from "../kit/iso/project";
import { IsoScene, standing } from "../kit/iso/scene";
import data from "./model.json";

const model = data as Model;
const UNIT = 38;
const ROW_GAP = 5.4;
// Each group is a row of its own, the first at the back.
const SIDES = groups(model).map((name, i) => {
  const ids = model.entities.filter((e) => e.group === name).map((e) => e.id);
  return { name, ids, boxes: standing(model.entities, row(ids, { y: i * ROW_GAP })) };
});
const BOX: Record<string, Box> = Object.assign({}, ...SIDES.map((s) => s.boxes));
// Room on the left for each side's name, above for the labels.
const VIEW = fitBox(extent(Object.values(BOX)).points, UNIT, [86, 36, 28, 170]);

function Sides() {
  const f = useFigure();
  return (
    <>
      {SIDES.map((side) => {
        const around = extent(Object.values(side.boxes));
        // The name sits off the row's near-left corner.
        const [x, y] = project([around.at[0], around.at[1] + around.size[1], 0], UNIT);
        const lit = Math.max(...side.ids.map((id) => f.lit(id)));
        return (
          <g key={side.name}>
            <IsoScene boxes={BOX} only={side.ids} />
            <text className="pt-label" x={x - 14} y={y + 4} textAnchor="end" opacity={0.62 + 0.38 * lit}>{side.name}</text>
          </g>
        );
      })}
    </>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} {...props}>
      <Sides />
    </Stage>
  );
}
