"use client";
// Archetype: isolated-case loop. One small tile per beat, each showing only
// the things and flows of its own case, and only the tile being told moves.
// Reach for it when the system is a handful of separate cases: what happens
// on a hit and on a miss, on success and on failure, for each kind of request.
import type { Model } from "../kit/model";
import { told } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { line, slice } from "../kit/iso/project";
import type { P2 } from "../kit/iso/project";
import data from "./model.json";

const model = data as Model;
const beats = told(model);
const COLS = Math.min(beats.length, 3), ROWS = Math.ceil(beats.length / COLS);
const TILE = { width: 268, height: 150, gap: 22 };
const VIEW = { x: 0, y: 0, width: COLS * TILE.width + (COLS - 1) * TILE.gap, height: ROWS * TILE.height + (ROWS - 1) * TILE.gap };
const mix = (a: string, b: string, p: number) => `color-mix(in oklab, ${a} ${Math.round(p * 100)}%, ${b})`;

function Tiles() {
  const f = useFigure();
  return (
    <>
      {beats.map((beat, i) => {
        const x = (i % COLS) * (TILE.width + TILE.gap), y = Math.floor(i / COLS) * (TILE.height + TILE.gap);
        // The things this case touches, in the model's order, spaced along the tile.
        const flows = f.model.flows.filter((fl) => beat.flows.includes(fl.id));
        const ids = f.model.entities.map((e) => e.id).filter((id) => beat.focus.includes(id) || flows.some((fl) => fl.from === id || fl.to === id));
        const at = (id: string): P2 => [x + 52 + (ids.indexOf(id) * (TILE.width - 104)) / Math.max(1, ids.length - 1), y + 86];
        const on = f.frame.beat.id === beat.id ? 1 : f.frame.beat.rest ? 1 : 0;
        const ink = mix("var(--pt-line)", "var(--pt-line-2)", on);
        return (
          <g key={beat.id} opacity={0.62 + 0.38 * on}>
            <rect className="pt-edge" x={x} y={y} width={TILE.width} height={TILE.height} rx={10} style={{ stroke: ink, fill: "var(--pt-top)" }} />
            <text className="pt-label" x={x + 14} y={y + 24}>{`${String(i + 1).padStart(2, "0")} · ${beat.title}`}</text>
            {flows.map((fl) => {
              const back = ids.indexOf(fl.to) < ids.indexOf(fl.from);
              const [ax, ay] = at(fl.from), [bx, by] = at(fl.to);
              // A flow that comes back runs under the ones that go out.
              const dy = back ? 7 : flows.some((o) => o.from === fl.to && o.to === fl.from) ? -7 : 0;
              const pts: P2[] = [[ax + (back ? -11 : 11), ay + dy], [bx + (back ? 11 : -11), by + dy]];
              const live = f.moving(fl.id);
              const head = f.phase(2, 0.5) * 1.2;
              const part = live > 0 ? slice(pts, head - 0.2, head) : [];
              return (
                <g key={fl.id}>
                  <path className="pt-wire" data-kind={fl.kind} d={line(pts)} style={{ stroke: mix("var(--pt-line)", "var(--pt-line-2)", live) }} />
                  {part.length ? <path className="pt-pulse" d={line(part)} opacity={live} /> : null}
                </g>
              );
            })}
            {ids.map((id) => {
              const e = f.model.entities.find((n) => n.id === id);
              const [cx, cy] = at(id);
              const arriving = f.arriving(id) * (f.frame.beat.id === beat.id ? 1 : 0);
              return (
                <g key={id}>
                  <rect className="pt-edge" x={cx - 10} y={cy - 10} width={20} height={20} rx={4} style={{ stroke: arriving > 0 ? mix("var(--pt-accent)", ink, arriving) : ink, fill: arriving > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", arriving) : "var(--pt-top)" }} />
                  <text className="pt-tag" x={cx} y={cy + 30} textAnchor="middle">{e?.label}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} viewBox={{ ...VIEW, x: -16, y: -14, width: VIEW.width + 32, height: VIEW.height + 28 }} {...props}>
      <Tiles />
    </Stage>
  );
}
