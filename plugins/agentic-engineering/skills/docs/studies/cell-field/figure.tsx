"use client";
// Study: cell field. A grid of cells, each tinted by its value and carrying
// its number, filled in the order the rule fills them, with the accent on the
// cell being worked out. Reach for it only when the subject is a quantity
// spread over a space, and where it is large or small is the point.
import { Cells } from "../kit/flat/chart";
import { cell } from "../kit/flat/geometry";
import type { P2 } from "../kit/flat/geometry";
import { Label } from "../kit/label";
import type { Model } from "../kit/model";
import { cells, entity } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { clamp, ease } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const grid = cells(model, "edits");
// The two words are the entities' own labels: one letter per row, one per column, after an empty first.
const down = ["", ...entity(model, "from").label.toUpperCase()], across = ["", ...entity(model, "to").label.toUpperCase()];
const SIZE = 38, GAP = 3, AT: P2 = [262, 80];
const VIEW = { x: 0, y: 0, width: 720, height: 322 };
const box = (r: number, c: number) => cell(c, r, SIZE, GAP, AT);
// The cells the rule fills, in the order it fills them: every one off the two edges, row by row.
const inner = grid.flatMap((row, r) => row.map((_, c) => [r, c] as const)).filter(([r, c]) => r > 0 && c > 0);
const LAST = inner[inner.length - 1];

function Table() {
  const f = useFigure();
  const beat = f.frame.beat.id, p = f.frame.p;
  const index = f.frame.index;
  // How many inner cells are filled, and which one is being worked out.
  const done = beat === "one" ? 0 : beat === "fill" ? Math.min(inner.length - 1, Math.floor(p * inner.length)) : index > 2 ? inner.length : 0;
  const at = beat === "one" || beat === "fill" ? inner[done] : beat === "corner" ? LAST : null;
  const shown = (r: number, c: number) => {
    if (r === 0 || c === 0) return index === 0 ? ease.out(clamp(p * 2.5 - (r + c) * 0.18)) : 1;
    const order = inner.findIndex(([ir, ic]) => ir === r && ic === c);
    if (index === 0) return 0;
    if (beat === "one") return order === 0 ? ease.out(clamp(p * 2 - 0.6)) : 0;
    return order <= done ? 1 : 0;
  };
  const differ = at ? down[at[0]] !== across[at[1]] : false;
  const three = at ? [grid[at[0]][at[1] - 1], grid[at[0] - 1][at[1]], grid[at[0] - 1][at[1] - 1]] : [];
  const told = beat === "one" || beat === "fill";
  return (
    <g opacity={f.present}>
      {across.map((letter, c) => <text key={c} className="pt-label" x={box(0, c).x + SIZE / 2} y={AT[1] - 12} textAnchor="middle">{letter || "·"}</text>)}
      {down.map((letter, r) => <text key={r} className="pt-label" x={AT[0] - 14} y={box(r, 0).y + SIZE / 2 + 4} textAnchor="end">{letter || "·"}</text>)}
      <Cells at={AT} values={grid} size={SIZE} gap={GAP} numbers shown={shown} mark={at ?? undefined} marked={beat === "corner" ? ease.out(clamp(p * 2)) : 1} />
      {/* The three cells the one being worked out reads from. */}
      {told && at ? [[at[0], at[1] - 1], [at[0] - 1, at[1]], [at[0] - 1, at[1] - 1]].map(([r, c]) => {
        const b = box(r, c);
        return <rect key={`${r}-${c}`} className="pt-edge" x={b.x + 0.5} y={b.y + 0.5} width={SIZE - 1} height={SIZE - 1} rx={2} style={{ fill: "none" }} />;
      }) : null}
      {/* The rule, with this cell's own numbers in it. */}
      {told && at ? (
        <g>
          <text className="pt-label" x={500} y={126}>{`${down[at[0]]} ${differ ? "≠" : "="} ${across[at[1]]}`}</text>
          <text className="pt-tag" x={500} y={148}>{`smallest of ${three.join(", ")}`}</text>
          <text className="pt-tag" x={500} y={164}>{differ ? `plus 1, is ${grid[at[0]][at[1]]}` : `and nothing added, is ${grid[at[0]][at[1]]}`}</text>
        </g>
      ) : null}
      <Label entity="from" at={[AT[0] - 30, box(2, 0).y + SIZE / 2]} sub={entity(f.model, "from").note} dx={-70} dy={-4} anchor="end" />
      <Label entity="to" at={[box(0, 2).x + SIZE / 2, AT[1] - 26]} sub={entity(f.model, "to").note} dx={0} dy={-34} />
      {beat === "corner" || f.frame.beat.rest ? <Label entity="answer" at={[box(LAST[0], LAST[1]).x + SIZE, box(LAST[0], LAST[1]).y + SIZE / 2]} sub={entity(f.model, "answer").note} dx={56} dy={-4} anchor="start" /> : null}
    </g>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} viewBox={VIEW} {...props}>
      <Table />
    </Stage>
  );
}
