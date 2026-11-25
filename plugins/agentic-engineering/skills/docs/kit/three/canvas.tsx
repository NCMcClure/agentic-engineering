"use client";
// The canvas a 3D scene is drawn in. It is the only file that starts the
// renderer, and Scene3D loads it lazily, so three.js reaches a page only once
// the page is in a browser.
//
// The scene is a function of the stage's clock, like everything else in the
// kit. The renderer draws on demand: a frame is drawn when the figure changes
// and at no other time. The one thing this file watches frames for is to say
// which frame was drawn last, which is how a still knows the picture is in.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { FigureProvider } from "../stage";
import type { Figure, ViewBox } from "../stage";
import type { Look } from "./look";
import { LookProvider } from "./materials";
import { Rig } from "./rig";

/** A frame is reported once it has been drawn this many times running: the room and the shadows are drawn into it on the way. */
const SETTLE = 2;

function Paint({ frameKey, onPaint, onLive }: { frameKey: string; onPaint: (key: string) => void; onLive: () => void }) {
  const invalidate = useThree((s) => s.invalidate);
  const seen = useRef({ key: "", frames: 0, total: 0 });
  // Every change to the figure arrives as a render of this tree: ask for one frame.
  useLayoutEffect(() => { invalidate(); });
  useFrame(() => {
    const s = seen.current;
    if (s.key !== frameKey) { s.key = frameKey; s.frames = 0; }
    s.frames += 1;
    s.total += 1;
    if (s.total === SETTLE) onLive();
    if (s.frames < SETTLE) invalidate();
    else if (s.frames === SETTLE) onPaint(frameKey);
  });
  return null;
}

export default function Canvas3D({ figure, look, viewBox, unit, frameKey, onPaint, onLive, children }: {
  figure: Figure;
  look: Look;
  viewBox: ViewBox;
  unit: number;
  /** The name of the frame the stage is holding. */
  frameKey: string;
  /** Called with a frame's name once the canvas has drawn it. */
  onPaint: (key: string) => void;
  /** Called once, when the canvas has something to show. */
  onLive: () => void;
  children: ReactNode;
}) {
  return (
    <Canvas
      orthographic flat frameloop="demand" shadows="variance" dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      camera={{ position: [60, 60, 60], near: 0.1, far: 240, zoom: 40 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {/* The renderer has a React tree of its own: the figure and the look are handed across. */}
      <FigureProvider value={figure}>
        <LookProvider value={look}>
          <Rig viewBox={viewBox} unit={unit}>{children}</Rig>
          <Paint frameKey={frameKey} onPaint={onPaint} onLive={onLive} />
        </LookProvider>
      </FigureProvider>
    </Canvas>
  );
}
