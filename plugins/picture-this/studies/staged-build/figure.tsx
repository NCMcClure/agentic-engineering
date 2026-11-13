"use client";
// Study: staged build-up. The system assembles itself: each part arrives
// with the beat that first tells it, and its wire is laid as it does. Reach
// for it only when the point is why each part is there, one addition at a time.
import type { Model } from "../kit/model";
import { Stage } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { extent, grid } from "../kit/iso/place";
import { fitBox } from "../kit/iso/project";
import { IsoScene, standing } from "../kit/iso/scene";
import data from "./model.json";

const model = data as Model;
const UNIT = 44;

// Rows of three, each row in front of the last, so a longer build stays wide.
const BOX = standing(model.entities, grid(model.entities.map((e) => e.id), { columns: 3, gap: 2.6 }));
const VIEW = fitBox(extent(Object.values(BOX), 1).points, UNIT, [92, 44, 30, 44]);

export default function Figure(props: StageProps) {
  // `build` is what makes this a build-up: nothing is drawn before its beat.
  // The hero frame should be a late beat, or the still shows half a system.
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} build {...props}>
      <IsoScene boxes={BOX} />
    </Stage>
  );
}
