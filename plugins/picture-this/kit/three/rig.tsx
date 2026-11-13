"use client";
// The rig every 3D scene stands in: an orthographic camera at the kit's own
// isometric angle, so a ground point lands on the same pixel as in 2D and a
// flat label over the canvas points at the right thing; a key lamp with soft
// shadows, a rim lamp, and a small lit room for the shapes to reflect; and a
// ground that only shows what falls on it.
//
// Nothing is tone-mapped, and the lamps are set so a top face gets exactly
// its own colour: an accent top is the accent, not a washed-out cousin.
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Camera, Color, Mesh, ShaderMaterial } from "three";
import type { Group } from "three";
import type { ViewBox } from "../stage";
import { layerOf, useLook } from "./materials";

/** Screen px per world unit, for one px per ground unit along an axis: an axis shows sqrt(2/3) of its length. */
const AXIS = Math.sqrt(1.5);
const COS = Math.cos(Math.PI / 6);
const DISTANCE = 60;
/** The key lamp's direction (from upper left, a little in front) and the rim's (from behind, right). */
const KEY: [number, number, number] = [-5 / 15.81, 9 / 15.81, 12 / 15.81];
const RIM: [number, number, number] = [12, 6, -8];
/** How wide the cast shadow's soft edge is, in ground units. */
const SOFT = 0.25;
const SHADOW_MAP = 1024;
/** How much of a solid's contact shadow glass leaves. */
const GLASS_SHADE = 0.45;
/** The layer the contact shadows' own sheets are drawn on. */
const SHEET = 2;

/**
 * The ground a view box looks at: the ground point at its middle, and the
 * radius that holds everything in view. The scene is moved so that point is
 * the origin, which is where the camera and the lamps aim.
 */
export function frameOf(viewBox: ViewBox, unit: number): { centre: [number, number]; radius: number } {
  const mx = viewBox.x + viewBox.width / 2, my = viewBox.y + viewBox.height / 2;
  const along = my / unit, across = mx / (2 * COS * unit);
  return {
    centre: [along + across, along - across],
    radius: Math.hypot(viewBox.width / (COS * unit), (2 * viewBox.height) / unit) / (2 * Math.SQRT2),
  };
}

/** The camera, held at the isometric angle and zoomed so the canvas shows exactly the view box. */
export function IsoCamera({ viewBox, unit }: { viewBox: ViewBox; unit: number }) {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    camera.position.set(DISTANCE, DISTANCE, DISTANCE);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.zoom = (width / viewBox.width) * unit * AXIS;
    camera.near = 0.1;
    camera.far = DISTANCE * 4;
    // Glass is on a layer of its own (see layerOf), and so are the contact shadows' sheets: the camera sees them all.
    camera.layers.enable(layerOf("glass"));
    camera.layers.enable(SHEET);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, width, viewBox.width, unit, invalidate]);
  return null;
}

/** The lamps: a key that casts the shadows, a rim for the far edges, and a fill so no face goes black. */
export function Lights({ radius }: { radius: number }) {
  const look = useLook();
  const far = radius + 30;
  return (
    <>
      <ambientLight intensity={look.fill} />
      <directionalLight
        position={[KEY[0] * far, KEY[1] * far, KEY[2] * far]} intensity={look.key} castShadow
        shadow-mapSize={[SHADOW_MAP, SHADOW_MAP]} shadow-radius={(SOFT * SHADOW_MAP) / (2 * radius)} shadow-blurSamples={25} shadow-bias={-0.0002} shadow-normalBias={0}
        shadow-camera-left={-radius} shadow-camera-right={radius} shadow-camera-top={radius} shadow-camera-bottom={-radius} shadow-camera-near={1} shadow-camera-far={2 * far}
      />
      <directionalLight position={RIM} intensity={look.rim} />
    </>
  );
}

/** The room the shapes reflect: a soft ceiling, a panel to the left, a strip behind. Drawn once per theme. */
export function Room() {
  const look = useLook();
  return (
    <Environment key={`${look.room}/${look.side}/${look.back}`} resolution={256} frames={1} environmentIntensity={look.env}>
      <color attach="background" args={[look.room]} />
      <Lightformer form="rect" intensity={2} position={[0, 12, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
      <Lightformer form="rect" intensity={look.side} position={[-14, 5, 6]} rotation-y={Math.PI / 2} scale={[16, 8, 1]} />
      <Lightformer form="rect" intensity={look.back} position={[10, 2.5, -14]} scale={[18, 3, 1]} />
    </Environment>
  );
}

const POOL_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
// A round pool of the floor colour, fading out. The fade is over so few
// levels of grey that it would show as rings, so each pixel's level is nudged
// by a fixed amount that depends only on where the pixel is.
const POOL_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGrain;
varying vec2 vUv;
float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d = clamp(1.0 - length(vUv - 0.5) * 2.0, 0.0, 1.0);
  float a = d * d * (3.0 - 2.0 * d) * uOpacity;
  a += (grain(gl_FragCoord.xy) - 0.5) * uGrain * step(0.002, a);
  gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}`;

/**
 * The ground: a pool of lifted floor under the scene, so there is something
 * for a shadow to fall on in the dark; the key lamp's shadow; and a soft
 * contact shadow where each thing meets the floor. Nothing else of it shows:
 * the page colour is the stage's own.
 */
export function Ground({ radius }: { radius: number }) {
  const look = useLook();
  const pool = useMemo(() => {
    const floor = new Color(look.floor), page = new Color(look.bg);
    // One step of the screen's 256 levels, as a share of the pool's opacity.
    const step = Math.max(...(["r", "g", "b"] as const).map((c) => Math.abs(new Color().copyLinearToSRGB(floor)[c] - new Color().copyLinearToSRGB(page)[c])));
    return new ShaderMaterial({
      vertexShader: POOL_VERTEX, fragmentShader: POOL_FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { uColor: { value: floor }, uOpacity: { value: look.floorAlpha }, uGrain: { value: Math.min(0.25, 1 / (255 * Math.max(step, 0.004))) } },
    });
  }, [look.floor, look.bg, look.floorAlpha]);
  // Two contact shadows, laid one on the other. The first is cast by
  // everything and is faint: it is all that glass leaves. The second is cast
  // by what is solid, and brings a solid's shadow up to full strength.
  const faint = look.contact * GLASS_SHADE, rest = 1 - (1 - look.contact) / (1 - faint);
  const all = useRef<Group>(null), solid = useRef<Group>(null);
  useLayoutEffect(() => {
    for (const group of [all.current, solid.current]) {
      group?.traverse((part) => {
        // The sheet a shadow is shown on is kept where only the scene's camera sees it, so neither shadow falls into the other.
        if (part instanceof Mesh) part.layers.set(SHEET);
        if (part instanceof Camera && group === all.current) part.layers.enable(layerOf("glass"));
      });
    }
  }, []);
  const blur = (1.1 * 24) / (2 * radius);
  return (
    <>
      {/* Three see-through layers a hair apart, all just under the ground. Each is given its turn, floor first, or the pool would be laid over the shadows. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.003} material={pool} renderOrder={-3}>
        <planeGeometry args={[2 * radius, 2 * radius]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.002} receiveShadow renderOrder={-2}>
        <planeGeometry args={[4 * radius, 4 * radius]} />
        <shadowMaterial transparent opacity={look.shadow} />
      </mesh>
      {/* Below zero on purpose: drei blurs each shadow on a sheet it leaves at the world's origin, which its camera, looking up from here, must have in front of it. At zero or above, the shadow blurs away to nothing. */}
      <ContactShadows ref={all} position={[0, -0.001, 0]} scale={2 * radius} resolution={1024} far={1.2} blur={blur} opacity={faint} color="#000000" renderOrder={-1} />
      <ContactShadows ref={solid} position={[0, -0.001, 0]} scale={2 * radius} resolution={1024} far={1.2} blur={blur} opacity={rest} color="#000000" renderOrder={-1} />
    </>
  );
}

/** Camera, lamps, room and ground around a scene, with the scene moved so the middle of the view is the origin. */
export function Rig({ viewBox, unit, children }: { viewBox: ViewBox; unit: number; children: ReactNode }) {
  const { centre, radius } = useMemo(() => frameOf(viewBox, unit), [viewBox, unit]);
  return (
    <>
      <IsoCamera viewBox={viewBox} unit={unit} />
      <Lights radius={radius} />
      <Room />
      <Ground radius={radius} />
      <group position={[-centre[0], 0, -centre[1]]}>{children}</group>
    </>
  );
}
