// What a 3D scene is made of and lit by, read from the kit's tokens on the
// stage. The colours and the lights live in kit.css beside the 2D ones, so a
// repo restyles both in one place and light and dark need no code of their
// own. This file imports nothing: the part of the 3D tier a page loads before
// it loads three.js.

export type Look = {
  /** Colours, as written in kit.css: hex or rgb(). */
  bg: string;
  ink: string;
  clay: string;
  matte: string;
  glass: string;
  accent: string;
  wire: string;
  floor: string;
  /** The room the shapes reflect. */
  room: string;
  glassAlpha: number;
  floorAlpha: number;
  /** Light strengths. `key`, `rim` and `fill` are lamps; `env` scales the room; `side` and `back` are its two bright panels. */
  key: number;
  rim: number;
  fill: number;
  env: number;
  side: number;
  back: number;
  /** How dark the cast shadow and the contact shadow are, 0 to 1. */
  shadow: number;
  contact: number;
};

/** A kit.css from before the 3D tier has none of its tokens: these stand in, taken from the light theme. */
const FALLBACK: Look = {
  bg: "#f5f5f3", ink: "#1c1c1b", clay: "#f3f2ee", matte: "#1f1f20", glass: "#cfd0d3", accent: "#ff5a1f", wire: "#9c9c96", floor: "#ffffff", room: "#bdbdbb",
  glassAlpha: 0.45, floorAlpha: 0.7,
  key: 2.08, rim: 1.45, fill: 0.23, env: 0.3, side: 1.2, back: 1,
  shadow: 0.2, contact: 0.42,
};

/** The look in force on an element inside a stage: its theme's tokens, as they compute there. */
export function readLook(el: Element): Look {
  const style = getComputedStyle(el);
  const text = (name: string, or: string) => style.getPropertyValue(name).trim() || or;
  const number = (name: string, or: number) => {
    const v = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(v) ? v : or;
  };
  // An older kit.css still has the 2D tokens; the 3D ones fall back to their nearest 2D neighbour before the constants.
  const bg = text("--pt-bg", FALLBACK.bg);
  const top = text("--pt-top", FALLBACK.clay);
  return {
    bg,
    ink: text("--pt-line", FALLBACK.ink),
    clay: text("--pt-clay", top),
    matte: text("--pt-matte", text("--pt-ink", FALLBACK.matte)),
    glass: text("--pt-glass", top),
    accent: text("--pt-accent", FALLBACK.accent),
    wire: text("--pt-wire", text("--pt-line-2", FALLBACK.wire)),
    floor: text("--pt-floor", top),
    room: text("--pt-light-room", FALLBACK.room),
    glassAlpha: number("--pt-glass-alpha", FALLBACK.glassAlpha),
    floorAlpha: number("--pt-floor-alpha", FALLBACK.floorAlpha),
    key: number("--pt-light-key", FALLBACK.key),
    rim: number("--pt-light-rim", FALLBACK.rim),
    fill: number("--pt-light-fill", FALLBACK.fill),
    env: number("--pt-light-env", FALLBACK.env),
    side: number("--pt-light-side", FALLBACK.side),
    back: number("--pt-light-back", FALLBACK.back),
    shadow: number("--pt-shadow", FALLBACK.shadow),
    contact: number("--pt-contact", FALLBACK.contact),
  };
}

/** Two looks that would draw the same picture. */
export function sameLook(a: Look | null, b: Look | null): boolean {
  if (!a || !b) return a === b;
  return (Object.keys(a) as (keyof Look)[]).every((k) => a[k] === b[k]);
}
