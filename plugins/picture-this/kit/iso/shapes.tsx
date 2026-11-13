"use client";
// Hairline isometric shapes. Each is placed in ground coordinates and drawn
// from the figure's frame: it arrives when its entity's beat begins, is drawn
// in full ink while the story is on it, and steps back when it is not.
import type { ReactNode } from "react";
import { useFigure } from "../stage";
import { block, disc, plate, points, project } from "./project";
import type { P3 } from "./project";

export type ShapeState = {
  /** The entity this shape stands for: its arrival and focus come from the model. */
  entity?: string;
  /** Override the arrival (0 to 1). */
  here?: number;
  /** Override the focus (0 to 1). */
  lit?: number;
  /** How far to take the accent (0 to 1): for the one thing the beat is about. */
  accent?: number;
};

const mix = (a: string, b: string, p: number) => `color-mix(in oklab, ${a} ${Math.round(p * 100)}%, ${b})`;
const RISE = 16;

/** The group a shape is drawn in: it fades and settles in as it arrives, and dims when the story is elsewhere. */
export function Presence({ entity, here, lit, children }: ShapeState & { children: ReactNode }) {
  const f = useFigure();
  const h = here ?? (entity ? f.here(entity) : 1);
  const l = lit ?? (entity ? f.lit(entity) : 1);
  if (h <= 0) return null;
  return (
    <g opacity={Math.round(h * 1000) / 1000} transform={`translate(0 ${Math.round((h - 1) * RISE * 100) / 100})`} data-entity={entity} data-lit={l > 0.5 ? "" : undefined}>
      {children}
    </g>
  );
}

/**
 * The colours a shape is drawn in. A shape the story is not on keeps its
 * faces solid, so it still hides what is behind it; they only move toward the
 * page colour, and its edges toward the quiet line.
 */
function useEdge({ entity, lit, accent = 0 }: ShapeState): { stroke: string; top: string; left: string; right: string } {
  const f = useFigure();
  const l = lit ?? (entity ? f.lit(entity) : 1);
  const ink = mix("var(--pt-line)", "var(--pt-line-2)", l);
  const face = (name: string) => mix(`var(--pt-${name})`, "var(--pt-bg)", 0.4 + 0.6 * l);
  return {
    stroke: accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink,
    top: accent > 0 ? mix("var(--pt-accent-soft)", face("top"), accent) : face("top"),
    left: face("left"),
    right: face("right"),
  };
}

/** A box: `at` is its far-top corner on the ground, `size` is [width along x, depth along y, height]. */
export function Block({ at, size, ...state }: ShapeState & { at: P3; size: readonly [number, number, number] }) {
  const f = useFigure();
  const edge = useEdge(state);
  const faces = block(at[0], at[1], at[2], size[0], size[1], size[2], f.unit);
  return (
    <Presence {...state}>
      <polygon className="pt-edge" points={points(faces.left)} style={{ stroke: edge.stroke, fill: edge.left }} />
      <polygon className="pt-edge" points={points(faces.right)} style={{ stroke: edge.stroke, fill: edge.right }} />
      <polygon className="pt-edge" points={points(faces.top)} style={{ stroke: edge.stroke, fill: edge.top }} />
    </Presence>
  );
}

/** A thin slab: a surface something sits on, or a screen. */
export function Plate({ at, size, thickness = 0.14, ...state }: ShapeState & { at: P3; size: readonly [number, number]; thickness?: number }) {
  return <Block at={at} size={[size[0], size[1], thickness]} {...state} />;
}

/** A stack of thin slabs with air between them: a queue, a log, layers. `filled` lights that many from the bottom. */
export function Layers({ at, size, count = 4, gap = 0.2, thickness = 0.1, filled, ...state }: ShapeState & { at: P3; size: readonly [number, number]; count?: number; gap?: number; thickness?: number; filled?: number }) {
  const f = useFigure();
  const edge = useEdge(state);
  const plain = useEdge({ ...state, accent: 0 });
  return (
    <Presence {...state}>
      {Array.from({ length: count }, (_, i) => {
        const faces = block(at[0], at[1], at[2] + i * (thickness + gap), size[0], size[1], thickness, f.unit);
        const on = filled === undefined ? i === count - 1 : i < filled;
        const use = on ? edge : plain;
        return (
          <g key={i}>
            <polygon className="pt-edge" points={points(faces.left)} style={{ stroke: use.stroke, fill: use.left }} />
            <polygon className="pt-edge" points={points(faces.right)} style={{ stroke: use.stroke, fill: use.right }} />
            <polygon className="pt-edge" points={points(faces.top)} style={{ stroke: use.stroke, fill: use.top }} />
          </g>
        );
      })}
    </Presence>
  );
}

/** An upright drum: a store. `at` is the centre of its base. */
export function Cylinder({ at, radius, height, bands = 0, ...state }: ShapeState & { at: P3; radius: number; height: number; bands?: number }) {
  const f = useFigure();
  const edge = useEdge(state);
  const base = disc(at[0], at[1], at[2], radius, f.unit);
  const top = disc(at[0], at[1], at[2] + height, radius, f.unit);
  const body = `M ${top.cx - top.rx} ${top.cy} L ${base.cx - base.rx} ${base.cy} A ${base.rx} ${base.ry} 0 0 0 ${base.cx + base.rx} ${base.cy} L ${top.cx + top.rx} ${top.cy} A ${top.rx} ${top.ry} 0 0 1 ${top.cx - top.rx} ${top.cy} Z`;
  return (
    <Presence {...state}>
      <path className="pt-edge" d={body} style={{ stroke: edge.stroke, fill: edge.left }} />
      {Array.from({ length: bands }, (_, i) => {
        const band = disc(at[0], at[1], at[2] + (height * (i + 1)) / (bands + 1), radius, f.unit);
        return <path key={i} className="pt-edge" d={`M ${band.cx - band.rx} ${band.cy} A ${band.rx} ${band.ry} 0 0 0 ${band.cx + band.rx} ${band.cy}`} style={{ stroke: edge.stroke }} />;
      })}
      <ellipse className="pt-edge" cx={top.cx} cy={top.cy} rx={top.rx} ry={top.ry} style={{ stroke: edge.stroke, fill: edge.top }} />
    </Presence>
  );
}

/** A dotted outline on the ground: a boundary, a zone, the footprint of what is not built yet. */
export function Ground({ at, size, ...state }: ShapeState & { at: P3; size: readonly [number, number] }) {
  const f = useFigure();
  return (
    <Presence {...state}>
      <polygon className="pt-ground" points={points(plate(at[0], at[1], at[2], size[0], size[1], f.unit))} />
    </Presence>
  );
}

/**
 * The usual shape for an entity's kind, on a footprint of `size` at `at`: a
 * queue is a stack, a store a drum, a client a slab, anything else a block.
 */
export function Thing({ entity, at, size = [1.6, 1.6], height = 0.7, accent }: { entity: string; at: P3; size?: readonly [number, number]; height?: number; accent?: number }) {
  const f = useFigure();
  const kind = f.model.entities.find((e) => e.id === entity)?.kind ?? "";
  if (/queue|log|stream|topic|buffer/.test(kind)) return <Layers entity={entity} at={at} size={size} count={Math.max(2, Math.round(height / 0.26))} gap={0.16} accent={accent} />;
  if (/store|database|db|cache|bucket|disk/.test(kind)) {
    const r = Math.min(size[0], size[1]) / 2;
    return <Cylinder entity={entity} at={[at[0] + size[0] / 2, at[1] + size[1] / 2, at[2]]} radius={r} height={height} bands={2} accent={accent} />;
  }
  if (/client|user|browser|app|device|screen/.test(kind)) return <Plate entity={entity} at={at} size={size} accent={accent} />;
  return <Block entity={entity} at={at} size={[size[0], size[1], height]} accent={accent} />;
}

/** Where a label for something on a footprint should point: the middle of its top. */
export function topOf(at: P3, size: readonly [number, number], height = 0): P3 {
  return [at[0] + size[0] / 2, at[1] + size[1] / 2, at[2] + height];
}

/** A ground point on the screen, at the figure's scale: for anything drawn by hand beside the shapes. */
export function useProject(): (p: P3) => readonly [number, number] {
  const f = useFigure();
  return (p) => project(p, f.unit);
}
