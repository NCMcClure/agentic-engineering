"use client";
// The worked example: an upload becomes a thumbnail. An isometric flow along
// the ground, with the store set off to one side.
import { Label } from "../kit/label";
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { fitBox } from "../kit/iso/project";
import type { P3 } from "../kit/iso/project";
import { Ground, Thing, topOf } from "../kit/iso/shapes";
import { Wire } from "../kit/iso/wire";
import data from "./model.json";

const model = data as Model;
const UNIT = 42;
const SIZE = [1.6, 1.6] as const;
// Where each thing stands on the ground, and how tall it is. Things are kept
// low and well apart: a tall shape hides the ground behind it, and that is
// where the wire to it arrives.
const AT: Record<string, P3> = {
  app: [0, 0, 0],
  api: [4, 0, 0],
  queue: [8, 0, 0],
  worker: [12, 0, 0],
  store: [12, 4, 0],
};
const HEIGHT: Record<string, number> = { app: 0.14, api: 0.7, queue: 0.78, worker: 0.6, store: 0.6 };
// Each wire crosses the gap between two things, from the face it leaves.
const WIRES: { flow: string; via: P3[]; tagAt?: number; tagOffset?: [number, number] }[] = [
  { flow: "upload", via: [[1.6, 0.5, 0], [4, 0.5, 0]], tagAt: 0.4 },
  { flow: "reply", via: [[4, 1.1, 0], [1.6, 1.1, 0]], tagAt: 0.45, tagOffset: [-10, 18] },
  { flow: "enqueue", via: [[5.6, 0.8, 0], [8, 0.8, 0]], tagAt: 0.4 },
  { flow: "take", via: [[9.6, 0.8, 0], [12, 0.8, 0]] },
  { flow: "save", via: [[12.8, 1.6, 0], [12.8, 4, 0]], tagAt: 0.45, tagOffset: [38, 4] },
];
const GROUND = { at: [-0.7, -0.7, 0] as P3, size: [15, 7] as const };
// The ground's corners and the tallest top, with room above and beside for the labels.
const VIEW = fitBox([[-0.7, -0.7, 0], [14.3, -0.7, 0], [14.3, 6.3, 0], [-0.7, 6.3, 0], [4, 0, 0.8]], UNIT, [86, 30, 22, 30]);

function Scene() {
  const f = useFigure();
  // The one thing each beat is about takes the accent while its flow moves.
  const accent = (id: string) => (id === "queue" ? f.moving("enqueue") : id === "worker" ? f.moving("take") : id === "store" ? f.moving("save") : 0);
  return (
    <>
      <Ground at={GROUND.at} size={GROUND.size} />
      {WIRES.map((w) => <Wire key={w.flow} {...w} part="line" />)}
      {Object.keys(AT).map((id) => <Thing key={id} entity={id} at={AT[id]} size={SIZE} height={HEIGHT[id]} accent={accent(id) * 0.9} />)}
      {WIRES.map((w) => <Wire key={w.flow} {...w} part="tag" />)}

      <Label entity="app" at={topOf(AT.app, SIZE, HEIGHT.app)} sub="uploads a photo" dx={-30} dy={-58} />
      <Label entity="api" at={topOf(AT.api, SIZE, HEIGHT.api)} sub="answers at once" dy={-52} />
      <Label entity="queue" at={topOf(AT.queue, SIZE, HEIGHT.queue)} sub="holds the work" dy={-52} />
      <Label entity="worker" at={topOf(AT.worker, SIZE, HEIGHT.worker)} sub="makes the thumbnail" dx={26} dy={-56} />
      <Label entity="store" at={[AT.store[0] + 0.15, AT.store[1] + 1.45, 0.3]} sub="keeps the result" dx={-58} dy={46} anchor="end" />
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
