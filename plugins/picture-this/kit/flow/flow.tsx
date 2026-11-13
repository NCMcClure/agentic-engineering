"use client";
// The flat style: real cards laid out by the page, with threads measured from
// them and drawn behind. Reach for it when the words matter more than the
// shape of the system: long labels, many notes, a reader who will read.
// Threads are drawn only once the cards have been measured, so a server
// renders the cards alone.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { along, line, slice } from "../iso/project";
import type { P2 } from "../iso/project";
import { useFigure } from "../stage";

type Rect = { x: number; y: number; width: number; height: number };
const Anchors = createContext<Record<string, Rect>>({});
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const mix = (a: string, b: string, p: number) => `color-mix(in oklab, ${a} ${Math.round(p * 100)}%, ${b})`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The cards and their threads. `rows` places each entity on a grid: a list of
 * rows, each a list of ids, with null for an empty cell.
 */
export function Flow({ rows, children }: { rows: readonly (readonly (string | null)[])[]; children?: ReactNode }) {
  const f = useFigure();
  const root = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Record<string, Rect>>({});
  useIsoLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const next: Record<string, Rect> = {};
      for (const card of el.querySelectorAll<HTMLElement>("[data-pt-anchor]")) {
        const r = card.getBoundingClientRect();
        next[card.dataset.ptAnchor ?? ""] = { x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height };
      }
      setAnchors((before) => (JSON.stringify(before) === JSON.stringify(next) ? before : next));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [rows]);
  const columns = Math.max(...rows.map((r) => r.length));
  return (
    <div ref={root} className="pt-flow" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      <Anchors.Provider value={anchors}>
        <Threads part="line" />
        {rows.flatMap((ids, r) => ids.map((id, c) => (id ? <Card key={id} entity={id} row={r + 1} column={c + 1} /> : null)))}
        {children}
        <Threads part="tag" />
      </Anchors.Provider>
      {/* The frame is read so the cards and threads redraw with the clock. */}
      <span hidden data-pt-frame={f.frame.beat.id} />
    </div>
  );
}

function Card({ entity, row, column }: { entity: string; row: number; column: number }) {
  const f = useFigure();
  const e = f.model.entities.find((x) => x.id === entity);
  if (!e) return null;
  const here = f.here(entity), lit = f.lit(entity), on = f.arriving(entity);
  const edge = mix("var(--pt-line)", "var(--pt-line-2)", lit);
  return (
    <div
      className="pt-card" data-pt-anchor={entity}
      style={{
        gridRow: row, gridColumn: column, opacity: r3(here),
        borderColor: on > 0 ? mix("var(--pt-accent)", edge, on) : edge,
        background: on > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", on) : mix("var(--pt-top)", "var(--pt-bg)", 0.4 + 0.6 * lit),
      }}
    >
      <span className="pt-card-name" style={{ opacity: r3(0.62 + 0.38 * lit) }}>
        {e.hue ? <i className="pt-card-dot" style={{ background: `var(--pt-hue-${e.hue})` }} /> : null}
        {e.label}
      </span>
      {e.note ? <span className="pt-card-note" style={{ opacity: r3(0.62 + 0.38 * lit) }}>{e.note}</span> : null}
    </div>
  );
}

/** A soft S-curve from one card's edge to another's, as points. */
function thread(a: Rect, b: Rect, shift: number): P2[] {
  const sideways = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  let from: P2, to: P2, c1: P2, c2: P2;
  if (sideways) {
    const right = b.x > a.x;
    from = [right ? a.x + a.width : a.x, a.y + a.height / 2 + shift];
    to = [right ? b.x : b.x + b.width, b.y + b.height / 2 + shift];
    const dx = (to[0] - from[0]) / 2;
    c1 = [from[0] + dx, from[1]]; c2 = [to[0] - dx, to[1]];
  } else {
    const down = b.y > a.y;
    from = [a.x + a.width / 2 + shift, down ? a.y + a.height : a.y];
    to = [b.x + b.width / 2 + shift, down ? b.y : b.y + b.height];
    const dy = (to[1] - from[1]) / 2;
    c1 = [from[0], from[1] + dy]; c2 = [to[0], to[1] - dy];
  }
  const out: P2[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    out.push([
      Math.round((u ** 3 * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * to[0]) * 100) / 100,
      Math.round((u ** 3 * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * to[1]) * 100) / 100,
    ]);
  }
  return out;
}

/** The threads behind the cards (`line`), or the words on them, drawn over the cards (`tag`). */
function Threads({ part }: { part: "line" | "tag" }) {
  const f = useFigure();
  const anchors = useContext(Anchors);
  const flows = f.model.flows.filter((fl) => anchors[fl.from] && anchors[fl.to]);
  if (!flows.length) return null;
  const length = 0.16;
  return (
    <svg className="pt-threads" aria-hidden="true">
      {flows.map((fl) => {
        const paired = flows.some((o) => o.from === fl.to && o.to === fl.from);
        const forward = f.model.entities.findIndex((e) => e.id === fl.from) < f.model.entities.findIndex((e) => e.id === fl.to);
        const pts = thread(anchors[fl.from], anchors[fl.to], paired ? (forward ? -7 : 7) : 0);
        const laid = f.laid(fl.id), live = f.moving(fl.id);
        if (laid <= 0) return null;
        const path = fl.kind === "read" ? [...pts].reverse() : pts;
        const head = f.phase(2, 0.5) * (1 + length);
        const pulse = live > 0 ? slice(path, head - length, head) : [];
        const [tx, ty] = along(pts, 0.5);
        if (part === "tag") {
          return fl.label ? <text key={fl.id} className="pt-tag" x={tx} y={ty + (paired && !forward ? 17 : -9)} textAnchor="middle" opacity={r3(laid * (0.6 + 0.4 * live))}>{fl.label}</text> : null;
        }
        return (
          <g key={fl.id}>
            <path className="pt-wire" data-kind={fl.kind} d={line(slice(pts, 0, laid))} style={{ stroke: mix("var(--pt-line)", "var(--pt-line-2)", live) }} />
            {pulse.length ? <path className="pt-pulse" d={line(pulse)} opacity={r3(live)} /> : null}
          </g>
        );
      })}
    </svg>
  );
}
