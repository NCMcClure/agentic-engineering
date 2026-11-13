"use client";
// The frame every figure sits in. It owns the clock and the one frame loop,
// plays when the figure scrolls into view, shows the hero frame to a server,
// to a reader who asked for less motion, and to the camera, and draws the
// strip, the caption and the claim around whatever the figure draws.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import "./kit.css";
import type { Audience, Model } from "./model";
import { caption, firstBeatOf, firstBeatWith, flowing, hasTechnical, inFocus, leads, told } from "./model";
import type { Clock, Frame, Timeline } from "./timeline";
import { clamp, createClock, createTimeline, ease, frameAt, lap, lerp, outro, since, timeOf } from "./timeline";

export type StageProps = {
  /** Force a theme. Left out, the figure follows the page (.dark, [data-theme="dark"]). */
  theme?: "light" | "dark";
  /** Where to start (and, with `still`, stay): a beat, and a point inside it. Left out, the hero frame. */
  beat?: string;
  at?: number;
  /** One fixed frame: no clock, no strip. What a still is taken from. */
  still?: boolean;
  audience?: Audience;
  /** The caption and the claim under the figure. On unless turned off. */
  captions?: boolean;
  /** The pause, step and scrub strip. On unless turned off. */
  controls?: boolean;
  /** Play when scrolled into view. On unless turned off. */
  autoplay?: boolean;
  /**
   * Build up: each part arrives with the beat that first tells it. Off, every
   * part is there from the start and only the focus moves, so any frame shows
   * the whole system.
   */
  build?: boolean;
  className?: string;
};

export type ViewBox = { x: number; y: number; width: number; height: number };

/** What a figure reads to draw itself: the model, the frame, and the usual questions about them. */
export type Figure = {
  model: Model;
  tl: Timeline;
  frame: Frame;
  audience: Audience;
  /** Pixels per ground unit, for the isometric shapes. */
  unit: number;
  /** Has this entity arrived? 0 to 1; it leaves again as the loop ends. */
  here(entityId: string): number;
  /** Is the story on this entity now? 0 to 1; everything is lit while the loop rests. */
  lit(entityId: string): number;
  /** Has this flow's wire been laid? 0 to 1. */
  laid(flowId: string): number;
  /** Is this flow moving now? 0 to 1. */
  moving(flowId: string): number;
  /** Where a pulse on this flow is along its wire: 0 to 1, in whole laps per beat. */
  phase(laps?: number, offset?: number): number;
  /** Is this the one thing the beat is about? 0 to 1: it is what the beat's leading flow arrives at. */
  arriving(entityId: string): number;
};

const FigureContext = createContext<Figure | null>(null);

/** The figure being drawn. Every shape, wire and label asks it what to show. */
export function useFigure(): Figure {
  const figure = useContext(FigureContext);
  if (!figure) throw new Error("this is drawn inside a <Stage>");
  return figure;
}

const EDGE_MS = 420;

function describe(model: Model, tl: Timeline, frame: Frame, audience: Audience, unit: number, build: boolean): Figure {
  const beat = model.beats[frame.index];
  const previous = frame.index > 0 ? model.beats[frame.index - 1] : null;
  // A level that belongs to a beat changes over the beat's first moments, so
  // something lit in two beats running never dips between them.
  const blend = (level: (b: typeof beat) => number) => {
    const now = level(beat);
    if (!previous) return now;
    return lerp(level(previous), now, ease.inOut(clamp(frame.ms / Math.min(EDGE_MS, beat.ms))));
  };
  const leaving = outro(tl, frame);
  const opening = model.beats[0].id;
  const leading = leads(model);
  const moving = (id: string) => blend((b) => (!b.rest && flowing(model, b.id, id) ? 1 : 0));
  return {
    model, tl, frame, audience, unit,
    here(id) {
      const first = build ? firstBeatWith(model, id) : opening;
      return (first ? since(tl, frame, first) : 1) * leaving;
    },
    lit(id) { return blend((b) => (b.rest || inFocus(model, b.id, id) ? 1 : 0)); },
    laid(id) {
      const first = build ? firstBeatOf(model, id) : opening;
      return (first ? since(tl, frame, first, 900) : 1) * leaving;
    },
    moving,
    arriving(id) { return Math.max(0, ...model.flows.filter((fl) => fl.to === id && leading.has(fl.id)).map((fl) => moving(fl.id))); },
    phase(laps = 1, offset = 0) { return lap(frame, laps, offset); },
  };
}

/**
 * Draw what is inside at one held frame, whatever the clock says: a panel of
 * a series, a "before" that stays still beside an "after" that moves. With
 * `build`, only what has arrived by that frame is drawn.
 */
export function Hold({ beat, at = 0.5, build = false, children }: { beat: string; at?: number; build?: boolean; children: ReactNode }) {
  const f = useFigure();
  const held = useMemo(() => describe(f.model, f.tl, frameAt(f.tl, timeOf(f.tl, beat, at)), f.audience, f.unit, build), [f.model, f.tl, f.audience, f.unit, beat, at, build]);
  return <FigureContext.Provider value={held}>{children}</FigureContext.Provider>;
}

type Capture = { beats: string[]; seek(beat: string, at?: number): Promise<void> };
declare global {
  interface Window { __pt?: Capture }
}

const readyKey = (frame: Frame) => `${frame.beat.id}:${frame.p.toFixed(3)}`;

export function Stage({
  model, viewBox, unit = 40, children,
  theme, beat, at, still = false, audience: audienceProp = "plain", captions = true, controls = true, autoplay = true, build = false, className,
}: StageProps & {
  model: Model;
  /** The art's own coordinates. Left out, the figure draws HTML (cards and threads) and takes its height from it. */
  viewBox?: ViewBox;
  unit?: number;
  children: ReactNode;
}) {
  const tl = useMemo(() => createTimeline(model.beats.map((b) => ({ id: b.id, ms: b.ms, rest: b.rest }))), [model]);
  const start = useMemo(() => timeOf(tl, beat ?? model.hero.beat, at ?? model.hero.at ?? 0.5), [tl, model, beat, at]);
  const clock: Clock = useMemo(() => createClock(tl, { at: start }), [tl, start]);
  const time = useSyncExternalStore(clock.subscribe, clock.get, () => start);
  const playing = useSyncExternalStore(clock.subscribe, clock.playing, () => false);
  const frame = frameAt(tl, time);
  const [audience, setAudience] = useState<Audience>(audienceProp);
  useEffect(() => { setAudience(audienceProp); }, [audienceProp]);
  const root = useRef<HTMLElement>(null);
  const label = useId();

  // The one frame loop. It runs only while the clock plays.
  useEffect(() => {
    if (still || !playing) return;
    let id = requestAnimationFrame(function tick(now) {
      clock.tick(now);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [clock, playing, still]);

  // Play from the start the first time the figure is seen, pause when it is
  // out of view, and carry on when it returns, unless the reader paused it.
  useEffect(() => {
    const el = root.current;
    if (still || !autoplay || !el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let seen = false, byReader = false, away = false;
    const off = clock.subscribe(() => { if (!clock.playing() && !away) byReader = true; else if (clock.playing()) byReader = false; });
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        away = false;
        if (!seen) { seen = true; clock.seek(0); clock.play(); }
        else if (!byReader) clock.play();
      } else if (clock.playing()) {
        away = true;
        clock.pause();
      }
    }, { threshold: 0.35 });
    observer.observe(el);
    return () => { observer.disconnect(); off(); };
  }, [clock, autoplay, still]);

  // Tell the camera when a held frame has been painted with its fonts.
  const key = readyKey(frame);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.removeAttribute("data-pt-ready");
    if (playing) return;
    let live = true;
    const fonts = typeof document !== "undefined" && document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (live) el.setAttribute("data-pt-ready", key); })));
    return () => { live = false; };
  }, [key, playing]);

  // The camera's handle: hold any beat at any point, and say when it is painted.
  useEffect(() => {
    const el = root.current;
    const handle: Capture = {
      beats: told(model).map((b) => b.id),
      seek(to, point = 0.5) {
        clock.pause();
        clock.seek(timeOf(tl, to, point));
        const want = readyKey(clock.frame());
        return new Promise((resolve) => {
          let tries = 0;
          requestAnimationFrame(function check() {
            if (el?.getAttribute("data-pt-ready") === want || ++tries > 240) resolve();
            else requestAnimationFrame(check);
          });
        });
      },
    };
    window.__pt = handle;
    return () => { if (window.__pt === handle) delete window.__pt; };
  }, [clock, tl, model]);

  const figure = useMemo(() => describe(model, tl, frame, audience, unit, build), [model, tl, frame.t, audience, unit, build]);
  const beats = told(model);
  const shown = frame.beat.rest ? null : model.beats[frame.index];
  const number = shown ? String(beats.indexOf(shown) + 1).padStart(2, "0") : "";
  const closing = frame.beat.rest && model.implication ? model.implication : null;
  const last = beats[beats.length - 1];
  const text = shown ? caption(model, shown.id, audience) : closing ?? caption(model, last.id, audience);
  const title = shown ? shown.title : closing ? "So" : last.title;

  return (
    <figure
      ref={root}
      className={["pt-stage", "not-prose", className].filter(Boolean).join(" ")}
      data-pt-stage=""
      data-pt-theme={theme}
      data-pt-beat={frame.beat.id}
      data-pt-still={still ? "" : undefined}
      aria-labelledby={label}
    >
      <div className="pt-scroll">
        {viewBox ? (
          <div className="pt-canvas" style={{ aspectRatio: `${viewBox.width} / ${viewBox.height}` }}>
            <svg className="pt-art" viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} role="img" aria-label={model.title}>
              <FigureContext.Provider value={figure}>{children}</FigureContext.Provider>
            </svg>
          </div>
        ) : (
          <div className="pt-canvas pt-flat" role="img" aria-label={model.title}>
            <FigureContext.Provider value={figure}>{children}</FigureContext.Provider>
          </div>
        )}
      </div>

      {captions ? (
        <figcaption className="pt-words" id={label}>
          <div className="pt-caption" aria-live={playing ? "off" : "polite"}>
            <span className="pt-caption-mark">{number ? `${number} · ` : ""}{title}</span>
            <span className="pt-caption-text">{text}</span>
          </div>
          <div className="pt-claim">{model.claim}</div>
        </figcaption>
      ) : <figcaption className="pt-hidden" id={label}>{model.title}</figcaption>}

      {controls && !still ? (
        <div className="pt-strip" role="group" aria-label="Playback">
          <button type="button" className="pt-button" aria-label="Previous step" onClick={() => clock.step(-1)}><Icon d="M9.5 3.5 5 8l4.5 4.5" /></button>
          <button type="button" className="pt-button" aria-label={playing ? "Pause" : "Play"} aria-pressed={playing} onClick={() => (playing ? clock.pause() : clock.play())}>
            {playing ? <Icon d="M5.5 3.5v9M10.5 3.5v9" /> : <Icon d="M5.5 3.5 12 8l-6.5 4.5z" fill />}
          </button>
          <button type="button" className="pt-button" aria-label="Next step" onClick={() => clock.step(1)}><Icon d="M6.5 3.5 11 8l-4.5 4.5" /></button>
          <div className="pt-track">
            <input
              className="pt-scrub"
              type="range" min={0} max={tl.total - 1} step={1} value={Math.round(time)}
              aria-label="Position in the story"
              aria-valuetext={shown ? `${number}, ${shown.title}` : "end"}
              style={{ ["--pt-progress" as string]: `${(time / tl.total) * 100}%` }}
              onChange={(e) => { clock.pause(); clock.seek(Number(e.target.value)); }}
            />
            <div className="pt-ticks" aria-hidden="true">
              {tl.starts.slice(1).map((ms, i) => <i key={i} style={{ left: `${(ms / tl.total) * 100}%` }} />)}
            </div>
          </div>
          {hasTechnical(model) ? (
            <div className="pt-audience" role="group" aria-label="Detail">
              {(["plain", "technical"] as const).map((a) => (
                <button key={a} type="button" className="pt-chip" aria-pressed={audience === a} onClick={() => setAudience(a)}>{a === "plain" ? "Plain" : "Technical"}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}

function Icon({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={d} fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
