"use client";
// Archetype: lifted layer stack. Each entity is a layer, the first on top,
// and the layer a flow arrives at lifts and takes the accent. Reach for it
// when the system is layers: a request passing down through them, a platform
// built on another.
import { Label } from "../kit/label";
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { fitBox } from "../kit/iso/project";
import type { P3 } from "../kit/iso/project";
import { Plate } from "../kit/iso/shapes";
import { Wire } from "../kit/iso/wire";
import data from "./model.json";

const model = data as Model;
const UNIT = 40;
const W = 5.4, D = 3.6, GAP = 1.05, THICK = 0.18, LIFT = 0.22;
const ids = model.entities.map((e) => e.id);
// The first entity is the top layer.
const level = (id: string) => (ids.length - 1 - ids.indexOf(id)) * GAP;
const TOP = (ids.length - 1) * GAP + THICK + LIFT;
// The stack, the risers to its right, and room to the left for the labels.
const VIEW = fitBox([[0, 0, TOP], [W, 0, 0], [W + 3.4, D * 0.5, 0], [0, D, 0], [W, D, 0], [0, D, TOP]], UNIT, [34, 44, 30, 200]);

function Scene() {
  const f = useFigure();
  // The layer the beat is about lifts, and takes the accent.
  const z = (id: string) => level(id) + f.arriving(id) * LIFT;
  // Each flow is a short riser off the stack's right edge, from one layer to
  // another. They are spread along the edge so no two share a line.
  const n = f.model.flows.length;
  const riser = (fl: { from: string; to: string }, i: number): P3[] => {
    const x = W + 0.5, y = D * (n > 1 ? 0.14 + (0.72 * i) / (n - 1) : 0.5);
    return [[W, y, z(fl.from) + THICK / 2], [x, y, z(fl.from) + THICK / 2], [x, y, z(fl.to) + THICK / 2], [W, y, z(fl.to) + THICK / 2]];
  };
  const bottomUp = [...ids].reverse();
  return (
    <>
      {bottomUp.map((id) => <Plate key={id} entity={id} at={[0, 0, z(id)]} size={[W, D]} thickness={THICK} accent={f.arriving(id) * 0.9} />)}
      {f.model.flows.map((fl, i) => <Wire key={fl.id} flow={fl.id} via={riser(fl, i)} radius={7} tagAt={0.5} tagOffset={[34, 4]} />)}
      {ids.map((id) => {
        const e = f.model.entities.find((x) => x.id === id);
        return <Label key={id} entity={id} at={[0, D, z(id) + THICK]} sub={e?.note} dx={-54} dy={-2} anchor="end" />;
      })}
    </>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} {...props}>
      <Scene />
    </Stage>
  );
}
