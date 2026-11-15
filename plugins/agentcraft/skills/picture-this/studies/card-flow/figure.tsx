"use client";
// Study: card-and-thread flow. Flat cards the page lays out, joined by
// soft threads, with a pulse on the thread being told. Reach for it only when the
// labels are long, the notes matter, or the figure sits in running prose.
import { Flow } from "../kit/flow/flow";
import type { Model } from "../kit/model";
import { Stage } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import data from "./model.json";

const model = data as Model;

// Where each card sits: rows of ids, null for an empty cell. Start with one
// row in the model's order; put a side resource under what uses it.
const ids = model.entities.map((e) => e.id);
const main = ids.filter((id) => id !== "store");
const ROWS: (string | null)[][] = ids.includes("store") && ids.includes("worker")
  ? [main, main.map((id) => (id === "worker" ? "store" : null))]
  : [ids];

export default function Figure(props: StageProps) {
  // No viewBox: this figure draws HTML and takes its height from the cards.
  return (
    <Stage model={model} {...props}>
      <Flow rows={ROWS} />
    </Stage>
  );
}
