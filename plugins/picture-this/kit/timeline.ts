// One clock per figure. A figure is drawn as a pure function of the time on
// this clock, so any instant can be reproduced: the still in a README is an
// exact frame, and a 3D scene can read the same clock. Nothing here touches
// the DOM, the wall clock, or React.

export type Beat = { id: string; ms: number; rest?: boolean };
export type Timeline = { beats: Beat[]; starts: number[]; total: number };
/** Where the clock is: the beat it is in, and how far through that beat (0 to 1). */
export type Frame = { t: number; index: number; beat: Beat; p: number; ms: number };

export function createTimeline(beats: Beat[]): Timeline {
  if (!beats.length) throw new Error("a timeline needs at least one beat");
  const starts: number[] = [];
  let total = 0;
  for (const beat of beats) {
    if (!(beat.ms > 0)) throw new Error(`beat '${beat.id}' needs a duration`);
    starts.push(total);
    total += beat.ms;
  }
  return { beats, starts, total };
}

/** The frame at time t (ms). Time wraps, so the loop has no end. */
export function frameAt(tl: Timeline, t: number): Frame {
  const at = ((t % tl.total) + tl.total) % tl.total;
  let index = tl.beats.length - 1;
  while (index > 0 && tl.starts[index] > at) index -= 1;
  const beat = tl.beats[index];
  const ms = at - tl.starts[index];
  return { t: at, index, beat, p: ms / beat.ms, ms };
}

export function indexOf(tl: Timeline, beatId: string): number {
  const index = tl.beats.findIndex((b) => b.id === beatId);
  if (index === -1) throw new Error(`no beat '${beatId}'`);
  return index;
}

/** The time at a point inside a beat: 0 its start, 0.5 its middle. */
export function timeOf(tl: Timeline, beatId: string, at = 0.5): number {
  const index = indexOf(tl, beatId);
  return tl.starts[index] + tl.beats[index].ms * clamp(at);
}

export const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;
/** How far p has travelled from a to b, held at 0 before and 1 after. */
export const span = (p: number, a: number, b: number): number => clamp((p - a) / (b - a));

/**
 * Which of `count` equal steps p is in, between `from` and `to` of a beat,
 * and how far through that step (0 to 1): for events that happen one after
 * another, a comparison at a time, a card at a time. Before `from` it is the
 * first step not begun; after `to`, the last one finished.
 */
export function steps(p: number, count: number, from = 0, to = 1): { index: number; t: number; done: number } {
  const n = Math.max(1, Math.round(count));
  // Rounded past the ninth place, so a step's edge is its edge whatever the arithmetic left behind.
  const along = Math.round(span(p, from, to) * n * 1e9) / 1e9;
  const index = Math.min(n - 1, Math.floor(along));
  const t = clamp(along - index);
  return { index, t, done: t >= 1 ? index + 1 : index };
}

export const ease = {
  linear: (p: number): number => p,
  out: (p: number): number => 1 - (1 - p) ** 3,
  in: (p: number): number => p ** 3,
  inOut: (p: number): number => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
};

/**
 * Has this beat begun? 0 before it, easing to 1 over `enterMs` once it starts,
 * and 1 from then to the end of the loop. What a part that arrives and stays is drawn with.
 */
export function since(tl: Timeline, frame: Frame, beatId: string, enterMs = 600): number {
  const index = indexOf(tl, beatId);
  if (frame.index < index) return 0;
  if (frame.index > index) return 1;
  return ease.out(clamp(frame.ms / Math.min(enterMs, frame.beat.ms)));
}

/**
 * Is this beat the one being told? 0 outside it, rising over `edgeMs` as it
 * starts and falling over `edgeMs` as it ends. What a highlight is drawn with.
 */
export function during(tl: Timeline, frame: Frame, beatId: string, edgeMs = 400): number {
  if (frame.index !== indexOf(tl, beatId)) return 0;
  const edge = Math.min(edgeMs, frame.beat.ms / 2);
  return ease.inOut(Math.min(clamp(frame.ms / edge), clamp((frame.beat.ms - frame.ms) / edge)));
}

/**
 * The loop's last moments: 1 until `ms` before the end, then down to 0, so
 * what has built up leaves before the loop starts over instead of vanishing.
 */
export function outro(tl: Timeline, frame: Frame, ms = 500): number {
  return ease.inOut(clamp((tl.total - frame.t) / Math.min(ms, tl.beats[tl.beats.length - 1].ms)));
}

/**
 * The phase (0 to 1) of something that circulates while a beat is told, making
 * a whole number of laps per beat so the beat and its progress fix the picture.
 */
export function lap(frame: Frame, laps = 1, offset = 0): number {
  const phase = (frame.p * Math.max(1, Math.round(laps)) + offset) % 1;
  return phase < 0 ? phase + 1 : phase;
}

export type Clock = {
  /** The time now, in ms. */
  get(): number;
  frame(): Frame;
  playing(): boolean;
  play(): void;
  pause(): void;
  seek(t: number): void;
  /** Pause on the middle of the next (1) or previous (-1) told beat. */
  step(direction: 1 | -1): void;
  /** Advance to a timestamp (ms, from any monotonic source). Whoever owns the frame loop calls this. */
  tick(now: number): void;
  subscribe(listener: () => void): () => void;
};

/** A clock over a timeline. It keeps no timer of its own: `tick` moves it. */
export function createClock(tl: Timeline, options: { at?: number; playing?: boolean } = {}): Clock {
  let t = options.at ?? 0;
  let running = options.playing ?? false;
  let last: number | null = null;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const told = tl.beats.map((b, i) => (b.rest ? -1 : i)).filter((i) => i !== -1);
  return {
    get: () => t,
    frame: () => frameAt(tl, t),
    playing: () => running,
    play() { if (!running) { running = true; last = null; changed(); } },
    pause() { if (running) { running = false; last = null; changed(); } },
    seek(to) { t = ((to % tl.total) + tl.total) % tl.total; last = null; changed(); },
    step(direction) {
      const here = frameAt(tl, t).index;
      const at = told.indexOf(here);
      const next = at === -1
        ? (direction === 1 ? 0 : told.length - 1)
        : (at + direction + told.length) % told.length;
      running = false;
      last = null;
      t = tl.starts[told[next]] + tl.beats[told[next]].ms / 2;
      changed();
    },
    tick(now) {
      if (!running) { last = null; return; }
      if (last !== null) {
        const dt = now - last;
        // A tab that slept does not jump the story ahead.
        if (dt > 0) { t = (t + Math.min(dt, 100)) % tl.total; changed(); }
      }
      last = now;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
