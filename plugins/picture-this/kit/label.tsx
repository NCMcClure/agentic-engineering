"use client";
// A flat, upright label with a hairline leader to the thing it names. Labels
// never lie on the isometric plane: text skewed onto a surface stops being
// readable long before the geometry stops being pretty.
import { useFigure } from "./stage";
import { project } from "./iso/project";
import type { P2, P3 } from "./iso/project";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function Label({
  entity, at, title, sub, dx = 0, dy = -46, anchor = "middle", here, lit,
}: {
  /** The entity it names: the title, the hue of its dot, its arrival and focus come from the model. */
  entity?: string;
  /** Where the leader starts: a ground point [x, y, z], or, in a flat figure, a point on the page [x, y]. */
  at: P3 | P2;
  title?: string;
  /** A second, quieter line: a role, a file, a number. */
  sub?: string;
  /** Where the text sits from the point, in px. Up by default. */
  dx?: number;
  dy?: number;
  anchor?: "start" | "middle" | "end";
  here?: number;
  lit?: number;
}) {
  const f = useFigure();
  const found = entity ? f.model.entities.find((e) => e.id === entity) : undefined;
  const h = here ?? (entity ? f.here(entity) : 1);
  const l = lit ?? (entity ? f.lit(entity) : 1);
  if (h <= 0) return null;
  const [x, y] = at.length === 2 ? at : project(at, f.unit);
  const tx = x + dx, ty = y + dy;
  const above = dy < 0;
  // The leader stops short of the text: under its last line when the text is
  // above, over its first when below, and at its near end when it is to the side.
  const sideways = Math.abs(dx) > Math.abs(dy) * 1.5;
  const sx = sideways ? tx + (dx < 0 ? 7 : -7) : tx;
  const stop = sideways ? ty - 4 : above ? ty + (sub ? 20 : 6) : ty - 13;
  const text = title ?? found?.label ?? "";
  const dot = found?.hue ? `var(--pt-hue-${found.hue})` : undefined;
  return (
    <g opacity={r3(h * (0.62 + 0.38 * l))} data-label={entity}>
      <path className="pt-leader" d={`M ${x} ${y} L ${sx} ${stop}`} />
      <circle className="pt-dot" cx={x} cy={y} r={found?.hue ? 2.75 : 1.75} style={dot ? { fill: dot } : undefined} />
      <text className="pt-label" x={tx} y={ty} textAnchor={anchor}>{text}</text>
      {sub ? <text className="pt-label pt-label-sub" x={tx} y={ty + 14} textAnchor={anchor}>{sub}</text> : null}
    </g>
  );
}
