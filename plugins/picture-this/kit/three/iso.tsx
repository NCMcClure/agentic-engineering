"use client";
// A whole isometric scene in 3D, drawn from the model and a layout: the same
// arrangement IsoScene draws in 2D, with the same boxes. The shapes and wires
// are 3D; the words on the wires and the labels stay flat SVG over the canvas.
// Before the canvas has drawn, and wherever it cannot, the 2D scene stands in.
import type { ReactNode } from "react";
import type { Box } from "../iso/place";
import type { P3 } from "../iso/project";
import { IsoScene, arrange } from "../iso/scene";
import { Wire as Word } from "../iso/wire";
import { Label } from "../label";
import { useFigure } from "../stage";
import type { Preset } from "./materials";
import { Scene3D } from "./scene";
import { Thing } from "./shapes";
import { Wire } from "./wire";

/**
 * Where a label over a 3D shape should point: just above the far top corner
 * of its box, straight above the middle of its top. A leader ending there
 * touches the shape's outline and never crosses a lit face.
 */
export function apex(box: Box, lift = 0.1): P3 {
  const [w, d] = box.size, spare = (w - d) / 2;
  return [box.at[0] + Math.max(0, spare), box.at[1] + Math.max(0, -spare), box.at[2] + box.height + lift];
}

export function IsoScene3D({ boxes, only, labels = true, tags = true, notes = true, rise = 40, materials, children }: {
  /** Where each entity stands, by id. An entity with no box is not drawn. */
  boxes: Record<string, Box>;
  /** Draw only these entities, and the flows between them. */
  only?: readonly string[];
  labels?: boolean;
  /** The word on each wire. */
  tags?: boolean;
  /** The quieter second line under each name. */
  notes?: boolean;
  /** How far above its thing a label sits, in px. */
  rise?: number;
  /** What an entity is made of, by id, where its kind's usual material is not wanted. */
  materials?: Record<string, Preset>;
  /** More 3D shapes of the figure's own, drawn in the same canvas. */
  children?: ReactNode;
}) {
  const f = useFigure();
  const { order, wires } = arrange(f.model, boxes, only);
  const note = (id: string) => f.model.entities.find((e) => e.id === id)?.note;
  return (
    <>
      <Scene3D fallback={<IsoScene boxes={boxes} only={only} labels={false} tags={false} />}>
        {wires.map((w) => <Wire key={w.flow} flow={w.flow} via={w.via} />)}
        {order.map((id) => <Thing key={id} entity={id} at={boxes[id].at} size={boxes[id].size} height={boxes[id].height} accent={f.arriving(id)} material={materials?.[id]} />)}
        {children}
      </Scene3D>
      {tags ? wires.map((w) => <Word key={w.flow} {...w} part="tag" />) : null}
      {labels ? order.map((id) => <Label key={id} entity={id} at={apex(boxes[id])} sub={notes ? note(id) : undefined} dy={-rise} />) : null}
    </>
  );
}
