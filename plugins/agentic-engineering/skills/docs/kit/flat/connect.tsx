"use client";
// What joins things in flat space, and what travels. An elbow is a
// right-angled connector with rounded corners and an arrowhead, between any
// two points; a line is a straight one. A token is one unit of work, and a
// queue is a row of them: waiting, or counted.
import { along, heading, line, slice, smooth } from "../iso/project";
import { elbow, mix } from "./geometry";
import type { P2 } from "./geometry";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** A filled arrowhead whose tip is at a point, facing the way the line arrives. */
export function arrow([x, y]: P2, degrees: number, size = 7): string {
  const wing = (turn: number): P2 => {
    const a = ((degrees + turn) * Math.PI) / 180;
    return [Math.round((x + Math.cos(a) * size) * 100) / 100, Math.round((y + Math.sin(a) * size) * 100) / 100];
  };
  const [ax, ay] = wing(152), [bx, by] = wing(-152);
  return `M ${x} ${y} L ${ax} ${ay} L ${bx} ${by} Z`;
}

/** The corners of an elbow, rounded, as the points its line is drawn through: for placing something on it. */
export function elbowPoints(from: P2, to: P2, { first, via, radius = 10 }: { first?: "h" | "v"; via?: number; radius?: number } = {}): P2[] {
  return smooth(elbow(from, to, { first, via }), radius);
}

/**
 * A right-angled connector from one point to another. `progress` (0 to 1)
 * draws that much of it, from its start. `pulse` (0 to 1) puts the accent on
 * a short length of it, there: something passing along it now. `lit` dims it
 * when the story is elsewhere. `quiet` draws a thinner, greyer line, for what
 * is said between things as against what starts them.
 */
export function Elbow({ from, to, first, via, radius = 10, progress = 1, head = true, pulse, pulseLength = 0.18, accent = 0, lit = 1, quiet = false, dashed = false }: {
  from: P2;
  to: P2;
  /** Leave sideways ("h") or up and down ("v"). Sideways unless said. */
  first?: "h" | "v";
  /** Where it turns: an x for "h", a y for "v". Half-way unless said. */
  via?: number;
  radius?: number;
  progress?: number;
  head?: boolean;
  pulse?: number;
  /** How long the pulse is, as a share of the line. */
  pulseLength?: number;
  /** 0 to 1: take the whole line to the accent, for the one connector the beat is about. */
  accent?: number;
  lit?: number;
  quiet?: boolean;
  dashed?: boolean;
}) {
  if (progress <= 0) return null;
  const pts = elbowPoints(from, to, { first, via, radius });
  const laid = progress >= 1 ? pts : slice(pts, 0, progress);
  if (laid.length < 2) return null;
  const ink = quiet ? mix("var(--pt-ink-2)", "var(--pt-line-2)", lit) : mix("var(--pt-line)", "var(--pt-line-2)", lit);
  const stroke = accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink;
  const tip = laid[laid.length - 1];
  const length = pulseLength;
  const on = pulse === undefined ? [] : slice(pts, pulse * (1 + length) - length, pulse * (1 + length));
  return (
    <g>
      <path className="pt-link" data-quiet={quiet ? "" : undefined} d={line(laid)} style={{ stroke, strokeDasharray: dashed ? "3 4" : undefined }} />
      {head ? <path className="pt-link-head" d={arrow(tip, heading(laid), quiet ? 5.5 : 7)} style={{ fill: stroke, stroke }} /> : null}
      {on.length > 1 ? <path className="pt-pulse" d={line(on)} /> : null}
    </g>
  );
}

/**
 * A straight line from one point to another: a join between the same thing
 * in two places, a trail, a leader. Dashed says it is not a thing. `head`
 * puts an arrowhead on its end, `progress` (0 to 1) draws part of it,
 * `accent` takes it to the accent, `lit` dims it.
 */
export function Line({ from, to, progress = 1, head = false, dashed = false, accent = 0, lit = 1, quiet = true }: {
  from: P2; to: P2; progress?: number; head?: boolean; dashed?: boolean; accent?: number; lit?: number; quiet?: boolean;
}) {
  if (progress <= 0) return null;
  const pts: P2[] = [from, [from[0] + (to[0] - from[0]) * Math.min(1, progress), from[1] + (to[1] - from[1]) * Math.min(1, progress)]];
  const ink = quiet ? mix("var(--pt-ink-2)", "var(--pt-line-2)", lit) : mix("var(--pt-line)", "var(--pt-line-2)", lit);
  const stroke = accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink;
  return (
    <g>
      <path className={dashed ? "pt-guide" : "pt-link"} data-quiet={quiet ? "" : undefined} d={line(pts)} style={{ stroke }} />
      {head ? <path className="pt-link-head" d={arrow(pts[1], heading(pts), quiet ? 5.5 : 7)} style={{ fill: stroke, stroke }} /> : null}
    </g>
  );
}

/**
 * One unit of work: a dot. It takes a hue to be told from its neighbours, or
 * the accent when the beat is about it. `label` is a word beside it.
 */
export function Token({ at, r = 5, hue, accent = 0, here = 1, lit = 1, label, labelAt = "right" }: {
  at: P2;
  r?: number;
  hue?: "blue" | "green" | "violet" | "yellow" | "pink";
  accent?: number;
  here?: number;
  lit?: number;
  label?: string;
  labelAt?: "right" | "below" | "above";
}) {
  if (here <= 0) return null;
  const base = hue ? `var(--pt-hue-${hue})` : "var(--pt-ink-2)";
  const dimmed = mix(base, "var(--pt-line-2)", 0.35 + 0.65 * lit);
  const fill = accent > 0 ? mix("var(--pt-accent)", dimmed, accent) : dimmed;
  const [x, y] = at;
  const text = labelAt === "right" ? { x: x + r + 6, y: y + 3.5, anchor: "start" as const } : { x, y: labelAt === "below" ? y + r + 13 : y - r - 6, anchor: "middle" as const };
  return (
    <g opacity={r3(here)}>
      <circle className="pt-token" cx={x} cy={y} r={r3(r * (0.6 + 0.4 * here))} style={{ fill }} />
      {label ? <text className="pt-tag" x={text.x} y={text.y} textAnchor={text.anchor}>{label}</text> : null}
    </g>
  );
}

/**
 * Tokens in a row from `at`, `gap` apart, running `dir`: work waiting, or a
 * count kept in pips. `count` is how many places there are and `filled` how
 * many hold a token (it may be a fraction: the last one is arriving). Empty
 * places are drawn as rings.
 */
export function Queue({ at, count, filled = count, gap = 14, r = 4.5, dir = "right", hue, lit = 1, accent = 0 }: {
  at: P2;
  count: number;
  filled?: number;
  /** 0 to 1: take the newest token to the accent: the one just counted. */
  accent?: number;
  gap?: number;
  r?: number;
  dir?: "right" | "left" | "down" | "up";
  hue?: "blue" | "green" | "violet" | "yellow" | "pink";
  lit?: number;
}) {
  const step: P2 = dir === "right" ? [gap, 0] : dir === "left" ? [-gap, 0] : dir === "down" ? [0, gap] : [0, -gap];
  return (
    <g>
      {Array.from({ length: count }, (_, i) => {
        const here = Math.min(1, Math.max(0, filled - i));
        const p: P2 = [at[0] + step[0] * i, at[1] + step[1] * i];
        return (
          <g key={i}>
            <circle className="pt-token-place" cx={p[0]} cy={p[1]} r={r} />
            <Token at={p} r={r} hue={hue} here={here} lit={lit} accent={i === Math.ceil(filled) - 1 ? accent : 0} />
          </g>
        );
      })}
    </g>
  );
}

/** A point `p` (0 to 1) of the way along an elbow: where a token riding it is. */
export function onElbow(from: P2, to: P2, p: number, options: { first?: "h" | "v"; via?: number; radius?: number } = {}): P2 {
  return along(elbowPoints(from, to, options), p);
}
