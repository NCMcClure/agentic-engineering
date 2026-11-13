"use client";
// Windows and what is in them. A panel is a framed box that clips what it
// holds: a context window, a screen, a page, a buffer. Rows are the bars
// stacked inside one, and they scroll by an offset the figure reads off the
// clock. A spawn is a panel that comes out of a point on a connector: one
// thing starting another. None of them knows the model: a figure works out
// what to show from the frame and hands it over.
import { useId } from "react";
import type { ReactNode } from "react";
import { anchor, bar, column, mix, windowed } from "./geometry";
import type { Box, P2 } from "./geometry";
import { Elbow } from "./connect";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** How heavy a row reads: dark for what leads, mid for the usual, light for what is quiet. */
export type Tone = "dark" | "mid" | "light";
/** One row of a column: its weight, how far it has taken the accent, and its shape within the column. */
export type RowSpec = {
  tone?: Tone;
  /** 0 to 1: the row the story is on now, filled with the accent. */
  accent?: number;
  /** 0 to 1: a row that mattered earlier and still should be findable: a tint of the accent, with its line. */
  marked?: number;
  /** Px in from the left. */
  indent?: number;
  /** Share of the width left after the indent, 0 to 1. */
  span?: number;
  height?: number;
  /** 0 to 1: how much of the row is there. A row arriving, or one being pressed flat. */
  here?: number;
};

const INK = { dark: 0.66, mid: 0.33, light: 0.13 } as const;
/** A row's fill: ink thinned into the panel's face, so the three tones hold in light and dark. */
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
      <g clipPath={`url(#${id})`}>{children}</g>
      {outline ? <path className="pt-edge" d={outline} style={{ stroke }} /> : null}
    </g>
  );
}

/** One row: a bar with rounded ends. */
export function Bar({ box, tone = "mid", accent = 0, marked = 0, here = 1, opacity = 1 }: { box: Box; tone?: Tone; accent?: number; marked?: number; here?: number; opacity?: number }) {
  if (here <= 0 || opacity <= 0 || box.width <= 0) return null;
  const base = toneFill(tone);
  const tinted = marked > 0 ? mix("var(--pt-accent-soft)", base, marked) : base;
  const fill = accent > 0 ? mix("var(--pt-accent)", tinted, accent) : tinted;
  const line = Math.max(accent, marked);
  const h = box.height * here;
  return (
    <rect
      className="pt-bar" x={box.x} y={r3(box.y + (box.height - h) / 2)} width={box.width} height={r3(h)} rx={Math.min(3, h / 2)} opacity={r3(opacity)}
      style={{ fill, stroke: line > 0 ? mix("var(--pt-accent)", "transparent", line) : "none" }}
    />
  );
}

/**
 * A column of rows inside `box`, scrolled `offset` px down it. Rows are laid
 * top to bottom, `gap` apart; one crossing the top or bottom edge fades as it
 * goes. Put it inside a Panel and the panel clips it. `bar` (in geometry)
 * gives the same row's box, for a connector that leaves from it.
 */
export function Rows({ box, rows, offset = 0, gap = 6, rowHeight = 12, fade = true }: { box: Box; rows: readonly RowSpec[]; offset?: number; gap?: number; rowHeight?: number; fade?: boolean }) {
  const slots = column(rows.map((r) => r.height ?? rowHeight), gap);
  return (
    <>
      {windowed(slots, offset, box.height).map(({ index, shown }) => {
        const row = rows[index];
        return <Bar key={index} box={bar(box, slots[index], offset, row)} tone={row.tone} accent={row.accent} marked={row.marked} here={row.here} opacity={fade ? shown : 1} />;
      })}
    </>
  );
}

/**
 * One thing starting another: a connector runs from `from` to the left side
 * of `box`, and the panel slides out of its end. `progress` (0 to 1) is the
 * whole move: the line is drawn over its first half, the panel arrives over
 * its second. Children are what the new panel holds.
 */
export function Spawn({ from, box, progress = 1, at = 0.5, via, radius, lit = 1, accent = 0, slide = 18, children }: {
  from: P2;
  box: Box;
  progress?: number;
  /** Where on the panel's left side the connector arrives, 0 (top) to 1. */
  at?: number;
  /** The x the connector turns at. Half-way unless said. */
  via?: number;
  radius?: number;
  lit?: number;
  accent?: number;
  /** How far the panel travels as it arrives, in px. */
  slide?: number;
  children?: ReactNode;
}) {
  if (progress <= 0) return null;
  const line = Math.min(1, progress * 2), arrived = Math.max(0, progress * 2 - 1);
  const eased = 1 - (1 - arrived) ** 3;
  return (
    <>
      <Elbow from={from} to={anchor(box, "left", at)} via={via} radius={radius} progress={line} lit={lit} />
      <Panel box={box} here={eased} lit={lit} accent={accent} shift={[(eased - 1) * slide, 0]}>{children}</Panel>
    </>
  );
}
