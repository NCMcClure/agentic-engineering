"use client";
// Boxes, bars and tiles. A panel is a framed box that clips what it holds: a
// page, a screen, a case, a buffer. A bar is one of a kind of thing, its
// length or height saying how much. A tile is a square that holds a value.
// None of them knows the model: a figure works out what to show from the
// frame and hands it over.
import { useId } from "react";
import type { ReactNode } from "react";
import { mix } from "./geometry";
import type { Box, P2 } from "./geometry";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** How heavy a shape reads against the page: strong for what leads, mid for the usual, quiet for what is in the background. The same in light and dark. */
export type Tone = "strong" | "mid" | "quiet";

// Each step is at least 1.8:1 against the next and against the panel's face, in light and in dark.
const INK = { strong: 0.72, mid: 0.44, quiet: 0.24 } as const;
/** A tone's fill: ink thinned into the panel's face, so the three weights hold in light and dark. */
export const toneFill = (tone: Tone = "mid") => mix("var(--pt-ink)", "var(--pt-top)", INK[tone]);

/**
 * A framed box. What is inside is clipped to it, so a column can scroll
 * through. `here` (0 to 1) fades it in, `lit` dims it when the story is
 * elsewhere, `accent` takes its frame toward the accent, and `shift` moves
 * the whole panel, in px, for one that slides into place.
 */
export function Panel({ box, radius = 8, here = 1, lit = 1, accent = 0, shift = [0, 0], open = "", children }: {
  box: Box;
  radius?: number;
  here?: number;
  lit?: number;
  accent?: number;
  shift?: P2;
  /** Sides drawn open, as a window on something longer than itself: any of "top" and "bottom". */
  open?: string;
  children?: ReactNode;
}) {
  const id = `pt-clip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  if (here <= 0) return null;
  const ink = mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * lit);
  const stroke = accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink;
  const { x, y, width, height } = box;
  const top = open.includes("top"), bottom = open.includes("bottom");
  // An open side has no edge and square corners: the box runs on past the picture.
  const outline = top || bottom
    ? [`M ${x} ${top ? y : y + height} L ${x} ${top ? y + height : y}`, `M ${x + width} ${top ? y : y + height} L ${x + width} ${top ? y + height : y}`,
      ...(top ? [] : [`M ${x} ${y} L ${x + width} ${y}`]), ...(bottom ? [] : [`M ${x} ${y + height} L ${x + width} ${y + height}`])].join(" ")
    : null;
  return (
    <g opacity={r3(here)} transform={shift[0] || shift[1] ? `translate(${r3(shift[0])} ${r3(shift[1])})` : undefined}>
      <clipPath id={id}><rect x={x} y={y} width={width} height={height} rx={outline ? 0 : radius} /></clipPath>
      <rect className="pt-panel" x={x} y={y} width={width} height={height} rx={outline ? 0 : radius} style={{ stroke: outline ? "none" : stroke }} />
      <g clipPath={`url(#${id})`} style={{ ["--pt-halo" as string]: "var(--pt-top)" }}>{children}</g>
      {outline ? <path className="pt-edge" d={outline} style={{ stroke }} /> : null}
    </g>
  );
}

/**
 * A bar: one of a kind of thing whose length or height says how much, or
 * simply one item in a row of them. `tone` is its weight; `accent` (0 to 1)
 * takes it to the accent, for the one the beat is about; `marked` leaves a
 * tint of the accent on one the story marked earlier; `here` (0 to 1) is how
 * much of it has arrived, grown from `grow` ("middle", or the side it stands
 * on); `outline` draws it empty; `label` writes a word or a number on it.
 */
export function Bar({ box, tone = "mid", accent = 0, marked = 0, here = 1, opacity = 1, outline = false, grow = "middle", radius = 3, label }: {
  box: Box; tone?: Tone; accent?: number; marked?: number; here?: number; opacity?: number; outline?: boolean;
  grow?: "middle" | "bottom" | "top" | "left"; radius?: number; label?: string;
}) {
  if (here <= 0 || opacity <= 0 || box.width <= 0) return null;
  const upright = grow !== "left";
  const w = upright ? box.width : box.width * here, h = upright ? box.height * here : box.height;
  const x = box.x, y = grow === "middle" ? box.y + (box.height - h) / 2 : grow === "bottom" ? box.y + box.height - h : box.y;
  const r = Math.min(radius, w / 2, h / 2);
  const base = toneFill(tone);
  const tinted = marked > 0 ? mix("var(--pt-accent-soft)", base, marked) : base;
  const line = Math.max(accent, marked);
  const style = outline
    ? { fill: accent > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", accent) : "var(--pt-top)", stroke: accent > 0 ? mix("var(--pt-accent)", "var(--pt-ink-2)", accent) : "var(--pt-ink-2)" }
    : { fill: accent > 0 ? mix("var(--pt-accent)", tinted, accent) : tinted, stroke: line > 0 ? mix("var(--pt-accent)", "transparent", line) : "none" };
  // Words on a bar are the page colour only where the bar is dark enough to carry them: not on a tinted one.
  const dark = !outline && (accent > 0.5 || (tone === "strong" && marked < 0.5));
  return (
    <g opacity={r3(opacity)}>
      <rect className="pt-bar" x={r3(x) + (outline ? 0.5 : 0)} y={r3(y) + (outline ? 0.5 : 0)} width={Math.max(0, r3(w) - (outline ? 1 : 0))} height={Math.max(0, r3(h) - (outline ? 1 : 0))} rx={r} style={style} />
      {label && h >= 10 && w >= 10 ? <text className="pt-num" x={r3(x + w / 2)} y={r3(y + h / 2 + 3.5)} textAnchor="middle" style={{ fill: dark ? "var(--pt-bg)" : undefined }}>{label}</text> : null}
    </g>
  );
}

/**
 * One square tile that holds a value: a cell of a table, a number in a
 * list, a slot. It can stand anywhere and be moved by the frame. `share` (0
 * to 1) tints it by how large its value is; `accent` takes it to the accent;
 * `marked` leaves a tint; `empty` draws a dashed place nothing is in yet.
 */
export function Tile({ box, label, share = 0, accent = 0, marked = 0, here = 1, empty = false, size = 9.5, tintAccent = false }: {
  box: Box; label?: string; share?: number; accent?: number; marked?: number; here?: number; empty?: boolean;
  /** The numeral's size, in px. */
  size?: number;
  /** Tint in the accent, not the ink: for a field that is the whole subject, with nothing else orange. */
  tintAccent?: boolean;
}) {
  if (here <= 0) return null;
  if (empty) return <rect className="pt-guide" x={box.x + 0.5} y={box.y + 0.5} width={box.width - 1} height={box.height - 1} rx={2} opacity={r3(here)} />;
  // The darkest tint stays light enough for a numeral in ink to read on it, in both themes.
  const base = tintAccent ? mix("var(--pt-accent)", "var(--pt-top)", share * 0.85) : mix("var(--pt-ink)", "var(--pt-top)", 0.06 + share * 0.38);
  const tinted = marked > 0 ? mix("var(--pt-accent-soft)", base, marked) : base;
  const fill = accent > 0 ? mix("var(--pt-accent)", tinted, accent) : tinted;
  const dark = accent > 0.5 || (tintAccent && share > 0.7 && marked < 0.5);
  return (
    <g opacity={r3(here)}>
      <rect className="pt-cell" x={box.x} y={box.y} width={box.width} height={box.height} rx={2} style={{ fill, stroke: marked > 0 && accent <= 0 ? mix("var(--pt-accent)", "var(--pt-bg)", marked) : undefined }} />
      {label !== undefined ? <text className="pt-num" x={r3(box.x + box.width / 2)} y={r3(box.y + box.height / 2 + size * 0.36)} textAnchor="middle" style={{ fill: dark ? "var(--pt-bg)" : "var(--pt-ink)", fontSize: size }}>{label}</text> : null}
    </g>
  );
}
