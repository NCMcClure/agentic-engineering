"use client";
// Study: two rulers. Things stand side by side at one scale of size; under
// them a ruler true to that scale reaches out beat by beat, a dashed line
// joining each thing to its mark. Last a page frames them on a ruler of its
// own. Reach for it only when a subject's sizes and distances cannot share
// one scale.
import type { Model, Row } from "../kit/model";
import { levelAt, quantity, rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { Figure as Frame, StageProps } from "../kit/stage";
import { Label } from "../kit/label";
import { Axis } from "../kit/flat/chart";
import { Line } from "../kit/flat/connect";
import { Panel } from "../kit/flat/panel";
import { mix, spread } from "../kit/flat/geometry";
import { clamp, ease, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as unknown as Model;
const VIEW = { x: 0, y: 0, width: 650, height: 348 };

// Layout. Both rulers start under the Sun's centre (X0) and are L px long.
const X0 = 76, L = 530;
const YP = 143;                       // the ground the bodies stand over: the page's ruler, once there is a page
const PAGE = { x: 8, y: 8, width: 634, height: YP + 26 - 8 };
const YB = PAGE.y + PAGE.height;      // the page's bottom edge, where a join leaves it
const YT = 304;                       // the true ruler
const STAND = 8;                      // a body stands this far above its ruler, clear of the ticks
const SPECK = 0.8;                    // the smallest radius drawn

const BODIES = rows(model, "bodies") as (Row & { id: string; mm: number; m: number })[];
const SUN = BODIES[0];
const PLANETS = BODIES.slice(1);
const REACH = quantity(model, "reach");
const START = REACH.start ?? 1;
// One scale of size: the true ruler's opening scale, START metres across L px.
const PX_PER_MM = L / (START * 1000);
const radius = (mm: number) => Math.max(SPECK, (mm * PX_PER_MM) / 2);
const PAGE_X: Record<string, number> = Object.fromEntries([
  [SUN.id, X0],
  ...spread(PLANETS.length, 182, X0 + L).map((x, i) => [PLANETS[i].id, x] as const),
]);
// The beat a planet comes into view in: the first whose reach takes it in.
const ARRIVES: Record<string, number> = Object.fromEntries(PLANETS.map((b) =>
  [b.id, model.beats.findIndex((_, i) => levelAt(model, "reach", i, 1) >= b.m)]));
const note = (id: string) => model.entities.find((e) => e.id === id)?.note ?? "";
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The distance in view, on the kit's clock for a quantity, but even in the ratio and not the difference: a ruler pulling back halves and halves again. */
function reachAt(f: Frame): number {
  const a = levelAt(f.model, "reach", f.frame.index, 0), b = levelAt(f.model, "reach", f.frame.index, 1);
  return a === b ? b : a * (b / a) ** ease.out((f.level("reach") - a) / (b - a));
}

/** Where the distance in view stood when a beat began: the near end of the stretch that beat adds. Nothing was in view before the first. */
const stoodAt = (index: number) => (index <= 0 ? 0 : levelAt(model, "reach", index, 0));

function Scene() {
  const f = useFigure();
  const { index, p, ms, beat } = f.frame;
  const reach = reachAt(f);
  const page = f.on("page", "rest");
  const lit = (id: string) => Math.max(f.lit(id), page);
  const sunTrueR = (SUN.mm / 1000 / reach) * L / 2;
  const trueX = (m: number) => X0 + (L * m) / reach;

  // The accent: the stretch of the true ruler this beat adds, its near end sliding up to where the last beat stopped.
  const from = lerp(stoodAt(index - 1), stoodAt(index), ease.inOut(clamp(ms / 420)));
  // On the page it runs along the page's ruler, laid from the Sun outward as the page arrives.
  const laid = beat.id === "page" ? ease.out(span(p, 0.08, 0.42)) : beat.rest ? 1 : 0;

  // Graduations: every 10 cm, 1 m, 10 m and 100 m, each fading out as it closes up.
  const grades = [0.1, 1, 10, 100].map((step) => ({ step, gap: (step / reach) * L })).filter((g) => g.gap >= 4);

  // A planet's mark is on the true ruler once it is in view. It carries its distance while its beat is told, unless it sits at the ruler's end, where the distance in view is written.
  const marks = PLANETS.filter((b) => b.m <= reach * 1.0001).map((b) => {
    const told = !beat.rest && beat.id !== "page" && model.beats[index].focus.includes(b.id);
    return { at: b.m / reach, label: told && b.m / reach < 0.93 ? String(b.m) : undefined, lit: lit(b.id) };
  });
  const pageAt = (id: string) => (PAGE_X[id] - X0) / L;
  const top = lerp(YP + 9, YB, page);   // a join stops under its body, and makes room for the page's numbers

  return (
    <g opacity={f.present}>
      {/* The page, when it comes: a frame round the bodies, and a ruler of its own under them */}
      <Panel box={PAGE} here={page} />
      {/* What it frames was there before it, so it is drawn over the panel and not in it, and its words take the panel's face as it arrives */}
      <g style={{ ["--pt-halo" as string]: mix("var(--pt-top)", "var(--pt-bg)", page) }}>
      <text className="pt-tag" x={X0 + 74} y={PAGE.y + 19}>{model.beats[0].title}</text>
      <text className="pt-tag" x={PAGE.x + PAGE.width - 12} y={PAGE.y + 19} textAnchor="end" opacity={r2(page)} style={{ fill: "var(--pt-accent-ink)" }}>
        {`A page: ${REACH.max} ${REACH.unit} drawn in the room of ${START}`}
      </text>
      <Axis from={[X0, YP]} to={[X0 + L, YP]} tick={4} lit={0.35} ticks={BODIES.map((b) => ({ at: pageAt(b.id), lit: 0.4 }))} />
      <g opacity={r2(page)}>
        <Axis from={[X0, YP]} to={[X0 + L, YP]} tick={4} fill={[0, laid]} ticks={BODIES.map((b) => ({ at: pageAt(b.id), label: String(b.m) }))} />
      </g>

      {/* The bodies, side by side at one scale of size */}
      {BODIES.map((b) => {
        const x = PAGE_X[b.id], r = radius(b.mm), cy = YP - STAND - r, l = lit(b.id);
        const stroke = mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * l);
        if (b.id === SUN.id) {
          return (
            <g key={b.id} style={{ ["--pt-halo" as string]: "var(--pt-top)" }}>
              <circle className="pt-edge" cx={x} cy={cy} r={r} style={{ stroke, fill: "var(--pt-top)" }} />
              <Label entity={b.id} at={[x, cy]} dy={-2} sub={note(b.id)} here={1} lit={l} dot={false} leader={false} />
            </g>
          );
        }
        // Names sit on two levels, turn about, so a note has room beside its neighbour's.
        const name = YP - 60 - (PLANETS.indexOf(b) % 2) * 30;
        const point = cy - r - 3;
        return (
          <g key={b.id}>
            <circle className="pt-edge" cx={x} cy={r2(cy)} r={r2(r)} style={{ stroke, fill: "var(--pt-top)" }} />
            <Label entity={b.id} at={[x, r2(point)]} dy={r2(name - point)} sub={note(b.id).split(", ")[0]} here={1} lit={l} dot={false} />
          </g>
        );
      })}
      </g>

      {/* The joins: the same body in its two places */}
      <Line from={[X0, r2(top)]} to={[X0, r2(Math.max(top, YT - STAND - 2 * sunTrueR - 3))]} dashed lit={lit(SUN.id)} />
      {PLANETS.map((b) => {
        // Drawn up from its mark once the ruler has stopped, and there from then on.
        const drawn = index > ARRIVES[b.id] ? 1 : index === ARRIVES[b.id] ? ease.out(span(p, 0.4, 0.48)) : 0;
        return <Line key={b.id} from={[r2(trueX(b.m)), YT - 7]} to={[PAGE_X[b.id], r2(top)]} progress={drawn} dashed lit={lit(b.id)} />;
      })}

      {/* The true ruler: distance and size at one scale */}
      {grades.map((g) => (
        <g key={g.step} opacity={r2(clamp((g.gap - 4) / 14))}>
          <Axis from={[X0, YT]} to={[X0 + L, YT]} tick={g.gap > 60 ? 4 : 2.5} lit={0}
            ticks={Array.from({ length: Math.floor((reach * 1.0001) / g.step) }, (_, k) => ({ at: ((k + 1) * g.step) / reach, lit: 0 }))} />
        </g>
      ))}
      <Axis from={[X0, YT]} to={[X0 + L, YT]} tick={6} fill={[from / reach, 1]}
        ticks={[{ at: 0, label: "0" }, ...marks, { at: 1, label: String(Math.round(reach)) }]} />
      {sunTrueR > 0.3 ? <circle className="pt-edge" cx={X0} cy={r2(YT - STAND - sunTrueR)} r={r2(sunTrueR)} style={{ fill: "var(--pt-top)" }} /> : null}
      {sunTrueR > 24 ? (
        <g style={{ ["--pt-halo" as string]: "var(--pt-top)" }}>
          <Label entity={SUN.id} at={[X0, r2(YT - STAND - sunTrueR)]} dy={-2} sub={note(SUN.id)} here={r2(clamp((sunTrueR - 24) / 20))} lit={1} dot={false} leader={false} />
        </g>
      ) : null}
      <text className="pt-tag" x={X0 - 4} y={YT + 35}>{`${REACH.label}, in ${REACH.unit}, with sizes at the same scale`}</text>
    </g>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} viewBox={VIEW} {...props}>
      <Scene />
    </Stage>
  );
}
