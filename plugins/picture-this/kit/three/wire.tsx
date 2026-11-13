"use client";
// A wire between two things, in 3D, and the pulses that travel it. It takes
// the same ground points as the 2D wire and means the same: laid when its
// flow's beat begins, moving only while the flow is told, a heavier line for a
// write, dashes for a query, dots for a read whose mark and pulses run home.
// Wires and pulses are drawn in their token colour exactly, unlit: they are
// marks on the picture, not objects in it. The word on a wire stays flat SVG:
// draw it with the 2D wire's part="tag".
import { useEffect, useLayoutEffect, useMemo } from "react";
import { BufferGeometry, CurvePath, DataTexture, DoubleSide, Float32BufferAttribute, LineCurve3, NearestFilter, QuadraticBezierCurve3, RepeatWrapping, TubeGeometry, Vector3 } from "three";
import type { FlowKind } from "../model";
import type { P3 } from "../iso/project";
import { useFigure } from "../stage";
import { blend, useLook } from "./materials";

const SIDES = 8;
/** Indices in one step of a tube: a ring of quads, two triangles each. */
const PER_STEP = SIDES * 6;
/** How thick a pulse is: its radius, in ground units. */
const PULSE = 0.055;
/** A wire lies just above the ground it runs along. */
const LIFT = 0.024;
/** The way the camera looks, toward the eye: marks are turned to face it. */
const EYE = new Vector3(1, 1, 1).normalize();

/** The line through the ground points, each corner rounded by `radius`, as one path measured by length. */
function route(via: readonly P3[], radius: number): CurvePath<Vector3> {
  const pts = via.map(([x, y, z]) => new Vector3(x, z + LIFT, y));
  const path = new CurvePath<Vector3>();
  const add = (a: Vector3, b: Vector3) => { if (a.distanceTo(b) > 1e-6) path.add(new LineCurve3(a, b)); };
  let from = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const corner = pts[i];
    const before = corner.distanceTo(pts[i - 1]), after = corner.distanceTo(pts[i + 1]);
    const r = Math.min(radius, before / 2, after / 2);
    if (r <= 1e-6) continue;
    const a = corner.clone().add(pts[i - 1].clone().sub(corner).multiplyScalar(r / before));
    const b = corner.clone().add(pts[i + 1].clone().sub(corner).multiplyScalar(r / after));
    add(from, a);
    path.add(new QuadraticBezierCurve3(a, corner, b));
    from = b;
  }
  add(from, pts[pts.length - 1]);
  return path;
}

/** A strip of on and off, repeated along a wire: what makes a line dashed or dotted. */
function dashes(on: number, off: number, repeats: number): DataTexture {
  const n = on + off, data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) data.set(i < on ? [255, 255, 255, 255] : [0, 0, 0, 255], i * 4);
  const texture = new DataTexture(data, n, 1);
  texture.wrapS = RepeatWrapping;
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.repeat.set(repeats, 1);
  texture.needsUpdate = true;
  return texture;
}

export function Wire({ flow, via, radius = 0.28, kind, laid, moving, pulses = 1, laps = 2 }: {
  /** The flow this wire carries: its kind and timing come from the model. */
  flow?: string;
  /** The ground points it runs through, in order, from its source. */
  via: readonly P3[];
  /** How round its corners are, in ground units. */
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
}) {
  const f = useFigure();
  const look = useLook();
  const found = flow ? f.model.flows.find((x) => x.id === flow) : undefined;
  const type: FlowKind = kind ?? found?.kind ?? "event";
  const drawn = laid ?? (flow ? f.laid(flow) : 1);
  const live = moving ?? (flow ? f.moving(flow) : 0);
  const thick = type === "write" ? 0.03 : 0.021;

  const made = useMemo(() => {
    const path = route(via, radius);
    const length = path.getLength();
    // Short enough steps that a pulse sliced out of the tube moves by less than a pixel at a time.
    const steps = Math.max(8, Math.ceil(length / 0.012));
    const line = new TubeGeometry(path, steps, thick, SIDES, false);
    const pulse = new TubeGeometry(path, steps, PULSE, SIDES, false);
    const pattern = type === "query" ? dashes(3, 3, length / 0.36) : type === "read" ? dashes(1, 2, length / 0.2) : null;
    return { path, steps, line, pulse, pattern };
  }, [via, radius, thick, type]);
  useEffect(() => () => { made.line.dispose(); made.pulse.dispose(); made.pattern?.dispose(); }, [made]);

  // A read is asked for at the far end and comes back: its mark and pulses run home.
  const home = type === "read";
  // The mark that says which way the wire runs sits part-way along it, as in 2D:
  // a wire often arrives behind the thing it arrives at. It is turned to face the eye.
  const markAt = 0.66;
  const mark = useMemo(() => {
    const p = made.path.getPointAt(home ? 1 - markAt : markAt);
    const t = made.path.getTangentAt(home ? 1 - markAt : markAt).multiplyScalar(home ? -1 : 1).normalize();
    const side = new Vector3().crossVectors(t, EYE).normalize();
    const long = type === "write" ? 0.34 : 0.28, wide = type === "write" ? 0.15 : 0.12;
    const tip = p.clone().addScaledVector(t, long / 2), back = p.clone().addScaledVector(t, -long / 2);
    const corners = [back.clone().addScaledVector(side, wide), back.clone().addScaledVector(side, -wide), tip].map((v) => v.addScaledVector(EYE, 0.06));
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(corners.flatMap((v) => [v.x, v.y, v.z]), 3));
    return g;
  }, [made, home, type]);
  useEffect(() => () => mark.dispose(), [mark]);

  const laidSteps = Math.round(Math.min(1, Math.max(0, drawn)) * made.steps);
  useLayoutEffect(() => { made.line.setDrawRange(0, laidSteps * PER_STEP); }, [made, laidSteps]);

  if (drawn <= 0) return null;
  // Whatever the lap count, a pulse is half-way along at the middle of the beat, where the hero frame is taken.
  const centred = 0.5 - ((laps * 0.5) % 1);
  const length = 0.16;
  const runs = live > 0 ? Array.from({ length: pulses }, (_, i) => {
    const head = f.phase(laps, i / pulses + centred) * (1 + length);
    return [Math.max(0, head - length), Math.min(1, head)] as const;
  }) : [];
  const color = blend(look.wire, look.ink, live * 0.85);
  return (
    <group>
      <mesh geometry={made.line}>
        <meshBasicMaterial color={color} toneMapped={false} alphaMap={made.pattern} alphaTest={made.pattern ? 0.5 : 0} />
      </mesh>
      {drawn > markAt ? <mesh geometry={mark}><meshBasicMaterial color={color} toneMapped={false} side={DoubleSide} /></mesh> : null}
      {runs.map(([a, b], i) => (b > a ? <Pulse key={i} tube={made.pulse} steps={made.steps} path={made.path} from={home ? 1 - b : a} to={home ? 1 - a : b} color={look.accent} /> : null))}
    </group>
  );
}

/**
 * One pulse: the stretch of the wire between two points along it (0 to 1,
 * from the wire's source). The stretch is a slice of a tube built once; its
 * round ends are placed exactly, and they are what is seen to move.
 */
function Pulse({ tube, steps, path, from, to, color }: { tube: TubeGeometry; steps: number; path: CurvePath<Vector3>; from: number; to: number; color: string }) {
  const slice = useMemo(() => {
    const g = new BufferGeometry();
    g.setIndex(tube.getIndex());
    g.setAttribute("position", tube.getAttribute("position"));
    return g;
  }, [tube]);
  const first = Math.floor(from * steps), last = Math.ceil(to * steps);
  useLayoutEffect(() => { slice.setDrawRange(first * PER_STEP, (last - first) * PER_STEP); }, [slice, first, last]);
  return (
    <group>
      <mesh geometry={slice}><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      {[from, to].map((p, i) => (
        <mesh key={i} position={path.getPointAt(p)}><sphereGeometry args={[PULSE, 16, 12]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
      ))}
    </group>
  );
}
