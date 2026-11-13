"use client";
// Study: isometric flow. Things stand in a line on the ground and each
// flow is a wire between two of them, with pulses while it is told. Reach for
// it only when the story is a path: a request, a job, a message going somewhere.
import type { Model } from "../kit/model";
import { Stage } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { extent, row } from "../kit/iso/place";
import { fitBox } from "../kit/iso/project";
import { IsoScene, standing } from "../kit/iso/scene";
import data from "./model.json";

const model = data as Model;
const UNIT = 42;

// Where each thing stands: a row, in the model's order. Things are kept low
// and well apart, because a tall shape hides the ground behind it, which is
// where the wire to it arrives.
const BOX = standing(model.entities, row(model.entities.map((e) => e.id)));
// Move a box by giving it a new place. Here the store steps out of the line,
// in front of the worker that writes to it.
if (BOX.store && BOX.worker) BOX.store = { ...BOX.store, at: [BOX.worker.at[0], 4, 0] };

// Room above for the labels, a little at the sides and below.
const VIEW = fitBox(extent(Object.values(BOX)).points, UNIT, [88, 40, 30, 40]);

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} {...props}>
      <IsoScene boxes={BOX} />
    </Stage>
  );
}
