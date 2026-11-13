"use client";
// A whole isometric scene drawn from the model and a layout: the ground, a
// wire for each flow, a shape for each entity, and their labels. A figure
// that needs nothing unusual is this plus where its boxes stand; one that
// does draws its own parts beside or instead of it.
import type { ReactNode } from "react";
import { Label } from "../label";
import type { Flow, Model } from "../model";
import { useFigure } from "../stage";
import { around as goAround, between, extent, hop } from "./place";
import type { Box } from "./place";
import type { P3 } from "./project";
import { Ground, Thing, topOf } from "./shapes";
import { Wire } from "./wire";

/** How tall a kind of thing stands: a client is a slab, the rest have some height. */
export function heightOf(kind: string): number {
  return /client|user|browser|app|device|screen/.test(kind) ? 0.14 : /queue|log|stream|topic|buffer/.test(kind) ? 0.78 : 0.7;
}

/** The boxes with each one's height set from its entity's kind. */
export function standing(entities: readonly { id: string; kind: string }[], boxes: Record<string, Box>): Record<string, Box> {
  const out: Record<string, Box> = {};
  for (const e of entities) if (boxes[e.id]) out[e.id] = { ...boxes[e.id], height: heightOf(e.kind) };
  return out;
}

/** A wire as a scene draws it: the flow, the ground points it runs through, and where its word sits. */
export type Route = { flow: string; via: P3[]; tagAt: number; tagOffset: [number, number] };

/**
 * A model laid out on boxes: which entities are drawn, far ones first, the
 * wire each flow takes, and the ground they stand on. The 2D scene and the 3D
 * scene draw the same arrangement.
 */
export function arrange(model: Model, boxes: Record<string, Box>, only?: readonly string[]): { ids: string[]; order: string[]; wires: Route[]; around: ReturnType<typeof extent> } {
  const ids = (only ?? model.entities.map((e) => e.id)).filter((id) => boxes[id]);
  const shown = new Set(ids);
  const flows = model.flows.filter((fl) => shown.has(fl.from) && shown.has(fl.to));
  // Two flows between the same pair run side by side, not on top of each other.
  const shift = (fl: Flow) => (flows.some((o) => o.from === fl.to && o.to === fl.from) ? (boxes[fl.from].at[0] + boxes[fl.from].at[1] < boxes[fl.to].at[0] + boxes[fl.to].at[1] ? -0.3 : 0.3) : 0);
  // A wire between two things with another standing between them goes round
  // the front of it, each such wire on a lane of its own.
  let lanes = 0;
  const wires = flows.map((fl): Route => {
    const a = boxes[fl.from], b = boxes[fl.to];
    const blocked = ids.some((id) => id !== fl.from && id !== fl.to && between(a, b, boxes[id]));
    const via = blocked ? goAround(a, b, Math.max(a.at[1] + a.size[1], b.at[1] + b.size[1]) + 0.9 + 0.5 * lanes++) : hop(a, b, shift(fl));
    const [first, last] = [via[0], via[via.length - 1]];
    // A word sits above a wire that runs away from the reader, below one that comes back, beside one that runs forward.
    const tagOffset: [number, number] = blocked ? [0, 16] : last[1] > first[1] ? [36, 4] : last[0] < first[0] ? [-8, 17] : [0, -9];
    return { flow: fl.id, via, tagAt: blocked ? 0.5 : 0.42, tagOffset };
  });
  // Far things first, so a near one is drawn over them.
  const depth = (id: string) => boxes[id].at[0] + boxes[id].at[1];
  const order = [...ids].sort((a, b) => depth(a) - depth(b));
  const around = extent(ids.map((id) => boxes[id]), 0.7 + (lanes ? 0.5 + 0.5 * lanes : 0));
  return { ids, order, wires, around };
}

export function IsoScene({ boxes, only, ground = true, labels = true, tags = true, notes = true, rise = 52, children }: {
  /** Where each entity stands, by id. An entity with no box is not drawn. */
  boxes: Record<string, Box>;
  /** Draw only these entities, and the flows between them. */
  only?: readonly string[];
  ground?: boolean;
  labels?: boolean;
  /** The word on each wire. Off when something else draws the words. */
  tags?: boolean;
  /** The quieter second line under each name. Off for a small scene, where it would not be read. */
  notes?: boolean;
  /** How far above its thing a label sits, in px. */
  rise?: number;
  /** Drawn after the shapes and before the words: anything of the figure's own. */
  children?: ReactNode;
}) {
  const f = useFigure();
  const { order, wires, around } = arrange(f.model, boxes, only);
  const note = (id: string) => f.model.entities.find((e) => e.id === id)?.note;
  const top = (id: string): P3 => topOf(boxes[id].at, boxes[id].size, boxes[id].height);

  return (
    <>
      {ground ? <Ground at={around.at} size={around.size} /> : null}
      {wires.map((w) => <Wire key={w.flow} {...w} part="line" />)}
      {order.map((id) => <Thing key={id} entity={id} at={boxes[id].at} size={boxes[id].size} height={boxes[id].height} accent={f.arriving(id) * 0.9} />)}
      {children}
      {tags ? wires.map((w) => <Wire key={w.flow} {...w} part="tag" />) : null}
      {labels ? order.map((id) => <Label key={id} entity={id} at={top(id)} sub={notes ? note(id) : undefined} dy={-rise} />) : null}
    </>
  );
}
