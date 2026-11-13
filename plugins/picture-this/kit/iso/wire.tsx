"use client";
// A wire between two things, and the pulses that travel it. The wire is laid
// when its flow's beat begins and stays; pulses run only while the flow is
// being told. The line's style says what kind of flow it is.
import { useFigure } from "../stage";
import type { FlowKind } from "../model";
import { along, heading, line, project, slice, smooth } from "./project";
import type { P2, P3 } from "./project";

const mix = (a: string, b: string, p: number) => `color-mix(in oklab, ${a} ${Math.round(p * 100)}%, ${b})`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function Wire({
  flow, via, radius = 12, kind, laid, moving, pulses = 1, laps = 2, tag, tagAt = 0.5, tagOffset = [0, -9], part,
}: {
  /** The flow this wire carries: its kind, label, and timing come from the model. */
  flow?: string;
  /** The ground points it runs through, in order, from its source. */
  via: readonly P3[];
  radius?: number;
  kind?: FlowKind;
  /** Override how much of the wire is laid (0 to 1). */
  laid?: number;
  /** Override whether it is moving (0 to 1). */
  moving?: number;
  /** Pulses on the wire at once. */
  pulses?: number;
  /** Laps a pulse makes per beat. */
  laps?: number;
  /** A word on the wire. Left out, the flow's label. */
  tag?: string;
  tagAt?: number;
  tagOffset?: readonly [number, number];
  /**
   * Draw only the line, or only the word. A figure draws its lines before its
   * shapes and its words after them, so a word is never behind a shape. Left
   * out, both are drawn here.
   */
  part?: "line" | "tag";
}) {
  const f = useFigure();
  const found = flow ? f.model.flows.find((x) => x.id === flow) : undefined;
  const type: FlowKind = kind ?? found?.kind ?? "event";
  const drawn = laid ?? (flow ? f.laid(flow) : 1);
  const live = moving ?? (flow ? f.moving(flow) : 0);
  if (drawn <= 0) return null;

  const pts = smooth(via.map((p) => project(p, f.unit)), radius);
  // A read is asked for at the far end and comes back: its pulses run home.
  const path = type === "read" ? [...pts].reverse() : pts;
  const stroke = mix("var(--pt-line)", "var(--pt-line-2)", live);
  const laidPts = slice(pts, 0, drawn);
  // The mark that says which way a write goes sits part-way along: in an
  // isometric view a wire often arrives behind the thing it arrives at.
  const markAt = 0.66;
  const mark = along(pts, markAt);
  const angle = heading(slice(pts, markAt - 0.04, markAt));
  // Whatever the lap count, a pulse is half-way along at the middle of the beat, where the hero frame is taken.
  const centred = 0.5 - ((laps * 0.5) % 1);
  const word = tag ?? found?.label;
  const [tx, ty] = along(pts, tagAt);
  const length = 0.16;

  const words = word && part !== "line" ? (
    <text className="pt-tag" x={tx + tagOffset[0]} y={ty + tagOffset[1]} textAnchor="middle" opacity={r3(drawn * (0.6 + 0.4 * live))}>{word}</text>
  ) : null;
  if (part === "tag") return words;

  return (
    <g data-flow={flow}>
      <path className="pt-wire" data-kind={type} d={line(laidPts)} style={{ stroke }} />
      {type === "write" && drawn > markAt ? (
        <path className="pt-wire-head" d={chevron(mark, angle, 6)} style={{ stroke }} />
      ) : null}
      {live > 0 ? Array.from({ length: pulses }, (_, i) => {
        const head = f.phase(laps, i / pulses + centred) * (1 + length);
        const part = slice(path, head - length, head);
        return part.length ? <path key={i} className="pt-pulse" d={line(part)} opacity={r3(live)} /> : null;
      }) : null}
      {words}
    </g>
  );
}

/** An open arrowhead at a point, facing the way the line arrives. */
function chevron([x, y]: P2, degrees: number, size: number): string {
  const wing = (turn: number): P2 => {
    const a = ((degrees + turn) * Math.PI) / 180;
    return [Math.round((x + Math.cos(a) * size) * 100) / 100, Math.round((y + Math.sin(a) * size) * 100) / 100];
  };
  const [ax, ay] = wing(150), [bx, by] = wing(-150);
  return `M ${ax} ${ay} L ${x} ${y} L ${bx} ${by}`;
}
