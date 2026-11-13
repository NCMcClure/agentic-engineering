"use client";
// The 3D shapes, matching the 2D ones in iso/shapes: placed in the same
// ground coordinates, taking the same `entity`, `here`, `lit` and `accent`,
// so a figure can be redrawn in 3D without changing where anything stands.
// Each is drawn inside a <Scene3D>.
import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { ExtrudeGeometry, LatheGeometry, Vector2 } from "three";
import type { Shape } from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import type { P3 } from "../iso/project";
import type { ShapeState } from "../iso/shapes";
import { useFigure } from "../stage";
import { Surface, blend, layerOf, useLook } from "./materials";
import type { Preset } from "./materials";

export type Shape3DState = ShapeState & {
  /** What it is made of. Clay unless said otherwise. */
  material?: Preset;
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A shape's state: its own overrides, else what the figure says of its entity. */
function useShape({ entity, here, lit, accent = 0 }: ShapeState): { here: number; lit: number; accent: number } {
  const f = useFigure();
  return { here: here ?? (entity ? f.here(entity) : 1), lit: lit ?? (entity ? f.lit(entity) : 1), accent };
}

/**
 * The group a shape is drawn in, with its origin at the middle of the shape's
 * base. A shape arrives by growing from that point, so its shadow grows with
 * it; nothing fades, because a half-seen solid still casts a whole shadow.
 */
export function Presence({ base, here, children }: { base: P3; here: number; children: ReactNode }) {
  if (here <= 0) return null;
  return <group position={[base[0], base[2], base[1]]} scale={Math.max(0.001, r3(here))}>{children}</group>;
}

/** How round an edge is: soft enough to catch the light, never more than the shape can hold. */
const edge = (...sides: number[]) => Math.min(0.09, 0.46 * Math.min(...sides));

/** A box: `at` is its far-top corner on the ground, `size` is [width along x, depth along y, height]. */
export function Block({ at, size, material = "clay", ...state }: Shape3DState & { at: P3; size: readonly [number, number, number] }) {
  const s = useShape(state);
  const [w, d, h] = size;
  return (
    <Presence base={[at[0] + w / 2, at[1] + d / 2, at[2]]} here={s.here}>
      <RoundedBox args={[w, h, d]} radius={edge(w, d, h)} smoothness={6} position={[0, h / 2, 0]} castShadow={material !== "glass"} receiveShadow={material !== "glass"} layers={layerOf(material)}>
        <Surface preset={material} lit={s.lit} accent={s.accent} />
      </RoundedBox>
    </Presence>
  );
}

/**
 * A thin slab: a surface something sits on, a screen, a device. With `dot`
 * it carries one small lamp, lit in the accent while the story is on it.
 */
export function Slab({ at, size, thickness = 0.16, dot = false, material = "clay", ...state }: Shape3DState & { at: P3; size: readonly [number, number]; thickness?: number; dot?: boolean }) {
  const s = useShape(state);
  const look = useLook();
  const [w, d] = size;
  return (
    <Presence base={[at[0] + w / 2, at[1] + d / 2, at[2]]} here={s.here}>
      <RoundedBox args={[w, thickness, d]} radius={edge(w, d, thickness)} smoothness={6} position={[0, thickness / 2, 0]} castShadow={material !== "glass"} receiveShadow={material !== "glass"} layers={layerOf(material)}>
        <Surface preset={material} lit={s.lit} accent={s.accent} />
      </RoundedBox>
      {dot ? (
        <mesh position={[w / 2 - 0.35, thickness + 0.012, -d / 2 + 0.35]}>
          <cylinderGeometry args={[0.09, 0.09, 0.03, 32]} />
          <meshStandardMaterial color={blend(look.wire, look.accent, s.lit)} roughness={0.6} metalness={0} />
        </mesh>
      ) : null}
    </Presence>
  );
}

/**
 * A stack of thin cards with air between them: a queue, a log, layers. Glass
 * unless said otherwise, so each card shows through the one above. `filled`
 * gives that many, from the bottom, the accent; left out, the top card takes it.
 */
export function Layers({ at, size, count = 3, gap = 0.21, thickness = 0.12, filled, material = "glass", ...state }: Shape3DState & { at: P3; size: readonly [number, number]; count?: number; gap?: number; thickness?: number; filled?: number }) {
  const s = useShape(state);
  const [w, d] = size;
  return (
    <Presence base={[at[0] + w / 2, at[1] + d / 2, at[2]]} here={s.here}>
      {Array.from({ length: count }, (_, i) => {
        const on = filled === undefined ? i === count - 1 : i < filled;
        return (
          <RoundedBox key={i} args={[w, thickness, d]} radius={edge(w, d, thickness)} smoothness={6} position={[0, thickness / 2 + i * (thickness + gap), 0]} castShadow={material !== "glass"} layers={layerOf(material)}>
            <Surface preset={material} lit={s.lit} accent={on ? s.accent : 0} />
          </RoundedBox>
        );
      })}
    </Presence>
  );
}

/** An upright drum with eased rims: a store. `at` is the centre of its base. */
export function Cylinder({ at, radius, height, material = "clay", ...state }: Shape3DState & { at: P3; radius: number; height: number }) {
  const s = useShape(state);
  const geometry = useMemo(() => {
    const bevel = edge(radius, height);
    const profile = [new Vector2(0, 0)];
    const arc = (cx: number, cy: number, from: number) => {
      for (let i = 0; i <= 8; i++) {
        const a = from + (i / 8) * (Math.PI / 2);
        profile.push(new Vector2(cx + Math.cos(a) * bevel, cy + Math.sin(a) * bevel));
      }
    };
    arc(radius - bevel, bevel, -Math.PI / 2);
    arc(radius - bevel, height - bevel, 0);
    profile.push(new Vector2(0, height));
    return new LatheGeometry(profile, 96);
  }, [radius, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <Presence base={at} here={s.here}>
      <mesh geometry={geometry} castShadow={material !== "glass"} receiveShadow={material !== "glass"} layers={layerOf(material)}>
        <Surface preset={material} lit={s.lit} accent={s.accent} />
      </mesh>
    </Presence>
  );
}

/**
 * A mark raised off the ground: an SVG path, filled, extruded to `height`.
 * `d` is a path's `d` in a square of `box` units (24, as most icon sets
 * draw); it is fitted to the footprint `size` at `at`, lying flat, its top
 * edge along the far side. Stroke-only icons have no area to raise.
 */
export function Icon({ d, at, size, height = 0.14, box = 24, material = "clay", ...state }: Shape3DState & { d: string; at: P3; size: readonly [number, number]; height?: number; box?: number }) {
  const s = useShape(state);
  const [w, dep] = size;
  const geometry = useMemo(() => {
    const scale = Math.min(w, dep) / box;
    const drawn = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d.replace(/"/g, "")}"/></svg>`);
    const shapes: Shape[] = drawn.paths.flatMap((path) => SVGLoader.createShapes(path));
    const bevel = Math.min(0.03, height / 3) / scale;
    const g = new ExtrudeGeometry(shapes, { depth: height / scale - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 16 });
    // The drawing's x runs along the ground's x and its y along the ground's y; it rises out of the ground.
    g.translate(-box / 2, -box / 2, bevel);
    g.scale(scale, scale, scale);
    g.rotateX(Math.PI / 2);
    g.translate(0, height, 0);
    return g;
  }, [d, w, dep, height, box]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <Presence base={[at[0] + w / 2, at[1] + dep / 2, at[2]]} here={s.here}>
      <mesh geometry={geometry} castShadow={material !== "glass"} receiveShadow={material !== "glass"} layers={layerOf(material)}>
        <Surface preset={material} lit={s.lit} accent={s.accent} />
      </mesh>
    </Presence>
  );
}

/**
 * The usual shape for an entity's kind, on a footprint of `size` at `at`: a
 * queue is a stack of glass cards, a store a drum, a client a slab with a
 * lamp, a service a matte block, anything else a clay one.
 */
export function Thing({ entity, at, size = [1.6, 1.6], height = 0.7, accent, material }: { entity: string; at: P3; size?: readonly [number, number]; height?: number; accent?: number; material?: Preset }) {
  const f = useFigure();
  const kind = f.model.entities.find((e) => e.id === entity)?.kind ?? "";
  if (/queue|log|stream|topic|buffer/.test(kind)) {
    const count = Math.max(2, Math.round(height / 0.26)), thickness = 0.12;
    return <Layers entity={entity} at={at} size={size} count={count} thickness={thickness} gap={Math.max(0.05, (height - count * thickness) / (count - 1))} accent={accent} material={material} />;
  }
  if (/store|database|db|cache|bucket|disk/.test(kind)) {
    return <Cylinder entity={entity} at={[at[0] + size[0] / 2, at[1] + size[1] / 2, at[2]]} radius={Math.min(size[0], size[1]) / 2} height={height} accent={accent} material={material} />;
  }
  if (/client|user|browser|app|device|screen/.test(kind)) return <Slab entity={entity} at={at} size={size} thickness={Math.max(0.14, height)} dot accent={accent} material={material} />;
  return <Block entity={entity} at={at} size={[size[0], size[1], height]} accent={accent} material={material ?? (/service|api|server|gateway|backend/.test(kind) ? "matte" : "clay")} />;
}
