"use client";
// Archetype: isometric flow in 3D. The isometric flow built from clay, glass
// and soft shadows: things stand in a line and each flow is a wire, with
// pulses while it is told. Reach for it when the story is a path and the
// figure is a page's centrepiece. It needs three.js where it is shown.
import type { Model } from "../kit/model";
import { Stage } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { extent, row } from "../kit/iso/place";
import { fitBox } from "../kit/iso/project";
import { standing } from "../kit/iso/scene";
import { IsoScene3D } from "../kit/three/iso";
import data from "./model.json";

const model = data as Model;
const UNIT = 42;

// Where each thing stands: a row, in the model's order, exactly as in 2D. A
// tall shape hides the ground behind it, so things are kept low and apart.
const BOX = standing(model.entities, row(model.entities.map((e) => e.id)));
// Move a box by giving it a new place. Here the store steps out of the line,
// in front of the worker that writes to it.
if (BOX.store && BOX.worker) BOX.store = { ...BOX.store, at: [BOX.worker.at[0], 4, 0] };

// Room above for the labels, and to the right for the shadows, which fall that way.
const VIEW = fitBox(extent(Object.values(BOX)).points, UNIT, [96, 64, 36, 44]);

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} {...props}>
      <IsoScene3D boxes={BOX} />
    </Stage>
  );
}
