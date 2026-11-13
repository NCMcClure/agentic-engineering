"use client";
// A 3D scene inside a stage. It is written where the 2D art is, as a child of
// the <Stage>, and draws into a canvas the stage keeps under the art, so the
// labels over it stay flat SVG. The scene reads the same figure the 2D shapes
// read: `here`, `lit`, `arriving`, `laid`, `moving` and `phase` mean the same.
//
// The canvas and three.js are loaded when the page is in a browser, never on
// a server: until the first frame is drawn (and for good where there is no
// WebGL) the `fallback` is shown in its place, drawn in 2D at the same frame.
import { Component, Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useBackdrop, useFigure } from "../stage";
import { readLook, sameLook } from "./look";
import type { Look } from "./look";
import { createPortal } from "react-dom";

const Canvas3D = lazy(() => import("./canvas"));

/** A canvas that cannot be made (no WebGL, a lost context) leaves the fallback standing. */
class Guard extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** The tokens in force where the canvas sits, read again whenever the page or the stage changes theme. */
function useLook(slot: HTMLElement | null): Look | null {
  const [look, setLook] = useState<Look | null>(null);
  useEffect(() => {
    if (!slot) return;
    const read = () => setLook((before) => { const now = readLook(slot); return sameLook(before, now) ? before : now; });
    read();
    // A theme is a class or an attribute somewhere above the stage.
    const watcher = new MutationObserver(read);
    watcher.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "data-theme", "data-pt-theme"] });
    return () => watcher.disconnect();
  }, [slot]);
  return look;
}

export function Scene3D({ fallback, children }: {
  /** The same scene in 2D shapes: what a server, a first paint, and a browser without WebGL show. */
  fallback?: ReactNode;
  /** The 3D shapes. They are drawn inside the canvas, and may call useFigure(). */
  children: ReactNode;
}) {
  const figure = useFigure();
  const { slot, viewBox, frameKey } = useBackdrop();
  const look = useLook(slot);
  // The last frame the canvas drew, by name: the stage and the camera wait for it.
  const [painted, setPainted] = useState("");
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const first = useCallback(() => setLive(true), []);

  if (!slot || !viewBox || failed) return <>{fallback}</>;
  return (
    <>
      {live ? null : fallback}
      {createPortal(
        <div className="pt-three" data-pt-paints={painted} style={{ position: "absolute", inset: 0 }}>
          {look ? (
            <Guard onFail={fail}>
              <Suspense fallback={null}>
                <Canvas3D figure={figure} look={look} viewBox={viewBox} unit={figure.unit} frameKey={frameKey} onPaint={setPainted} onLive={first}>
                  {children}
                </Canvas3D>
              </Suspense>
            </Guard>
          ) : null}
        </div>,
        slot,
      )}
    </>
  );
}
