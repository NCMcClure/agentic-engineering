"use client";
// ledger-to-verdict: the scorecard as a ledger folded right. Six rows of
// grade tiles (blue: plugin-scan.mjs graded it; yellow: the model did), each
// row folded into its dimension's bar, the bars stacked into one 0-100
// column ruled at the tier floors, then the weak tiles raised to 4 to price
// each fix. Every move after the grades is plugin-scan.mjs arithmetic.
import type { Model, Row } from "../kit/model";
import { rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import { Bar, Panel, Tile, toneFill } from "../kit/flat/panel";
import { ease, indexOf, lerp, span, steps } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 740, height: 476 };

const CHECKS = rows(model, "checks");
const DIMS = rows(model, "dimensions");
const TIERS = rows(model, "tiers");
const FIXES = rows(model, "fix-deltas");

// The ledger.
const ROW0 = 118, ROW_H = 50; // a dimension's row: its centre
const TX = 150, UNIT = 14, GAP = 3, TH = 24; // a tile: width is UNIT per point of check weight
// The dimension bars.
const BX = 404, BAR_PER = 1.3; // px per point of score
// The 0-100 column.
const GX = 584, GW = 26, G_TOP = 150, G_BOT = 396;
// The script's side: everything right of the divide is plugin-scan.mjs --score.
const DIVIDE = 398, ZONE_TOP = 98, ZONE_BOT = 466;
const PER_PT = (G_BOT - G_TOP) / 100;
const gy = (v: number) => G_BOT - v * PER_PT;

const rowY = (i: number) => ROW0 + i * ROW_H;
const dimIndex = (id: string) => DIMS.findIndex((d) => d.id === id);
const num = (v: Row[string]) => (typeof v === "number" ? v : 0);

// Where each check's tile sits in its row.
const TILE = new Map<string, { x: number; y: number; w: number; dim: number }>();
const ROW_END: number[] = [];
DIMS.forEach((d, i) => {
  let x = TX;
  for (const c of CHECKS.filter((c) => c.dim === d.id)) {
    const w = num(c.weight) * UNIT;
    TILE.set(String(c.id), { x, y: rowY(i) - TH / 2, w, dim: i });
    x += w + GAP;
  }
  ROW_END[i] = x - GAP;
});

const APPLIES = DIMS.filter((d) => d.applicable === true);
const TOTAL_W = APPLIES.reduce((n, d) => n + num(d.weight), 0);
const share = (d: Row) => num(d.weight) / TOTAL_W;
// What each applicable dimension adds to the composite, stacked from the bottom.
const STACK = (() => {
  let base = 0;
  return APPLIES.map((d) => {
    const add = num(d.score) * share(d);
    const seg = { id: String(d.id), from: base, to: base + add };
    base += add;
    return seg;
  });
})();
const MECH = CHECKS.filter((c) => c.kind === "m" && c.grade !== "n/a");
const JUDG = CHECKS.filter((c) => c.kind === "j" && c.grade !== "n/a");
const HUE = { m: "var(--pt-hue-blue)", j: "var(--pt-hue-yellow)" } as const;

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const now = (id: string) => index === at(id);
  const past = (id: string) => index > at(id);

  // Grading: one tile at a time, the script's then the model's.
  const sScan = steps(p, MECH.length, 0.04, 0.44);
  const sGrade = steps(p, JUDG.length, 0.04, 0.44);
  // The ring stays on the last one written until well past the middle.
  const ringOn = p < 0.72 ? 1 : 1 - span(p, 0.72, 0.82);
  const graded = (c: Row): { on: boolean; accent: number } => {
    const list = c.kind === "m" ? MECH : JUDG;
    const beat = c.kind === "m" ? "scan" : "grade";
    const k = list.indexOf(c);
    if (k < 0) return { on: false, accent: 0 };
    if (past(beat)) return { on: true, accent: 0 };
    if (!now(beat)) return { on: false, accent: 0 };
    const s = c.kind === "m" ? sScan : sGrade;
    return { on: k < s.done || (k === s.index && s.t > 0), accent: k === s.index ? ringOn : 0 };
  };

  // Folding: one dimension at a time, its bar grown to its score.
  const sFold = steps(p, APPLIES.length, 0.04, 0.44);
  const folded = (k: number) => (past("fold") ? 1 : now("fold") ? (k < sFold.index ? 1 : k === sFold.index ? ease.out(sFold.t) : 0) : 0);
  // Weighing: each bar slides into the column, all landed by two fifths.
  const sWeigh = steps(p, APPLIES.length, 0.04, 0.4);
  const moved = (k: number) => (past("weigh") ? 1 : now("weigh") ? (k < sWeigh.index ? 1 : k === sWeigh.index ? ease.out(sWeigh.t) : 0) : 0);
  const weighed = past("weigh") ? 1 : now("weigh") ? span(p, 0.3, 0.42) : 0; // weights shown as shares
  // Ranking: the fixes, best first.
  const sRank = steps(p, FIXES.length, 0.04, 0.36);
  const listed = (k: number) => (past("rank") ? 1 : now("rank") ? (k < sRank.index ? 1 : k === sRank.index ? ease.out(sRank.t) : 0) : 0);
  const ranking = now("rank") ? 1 : 0;
  const top = String(FIXES[0].check);
  const fixRank = (id: string) => FIXES.findIndex((x) => x.check === id);

  const composite = f.level("composite");
  const verdict = TIERS.find((t) => composite >= num(t.floor)) ?? TIERS[TIERS.length - 1];
  const tierOn = f.here("verdict");
  const tierAccent = now("verdict") ? span(p, 0.08, 0.3) : 0;
  const numberAccent = now("weigh") ? span(p, 0.36, 0.44) : 0;

  const textTone = (lit: number) => mix("var(--pt-ink)", "var(--pt-ink-3)", lit);
  // "Being worked on now": a soft fill and an orange ring, the same everywhere.
  const ring = (a: number) => ({ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", a), stroke: mix("var(--pt-accent)", "var(--pt-line-2)", a), strokeWidth: 1.5 });
  const after = composite + num(FIXES[0].delta);

  return (
    <g opacity={f.present} style={{ ["--pt-halo" as string]: "var(--pt-left)" }}>
      {/* The target, read twice: by the script and by the model. */}
      <g opacity={0.55 + 0.45 * f.lit("target")}>
        <path className="pt-edge" d="M 20 24 h 11 l 4 4 h 15 v 18 h -30 Z" style={{ fill: "var(--pt-top)" }} />
        <text className="pt-label" x={58} y={34}>{f.model.entities[0].label}</text>
        <text className="pt-label pt-label-sub" x={58} y={48}>read as data</text>
      </g>
      <Elbow from={[162, 36]} to={[218, 24]} via={190} dashed lit={f.lit("scanner")} pulse={f.moving("scan") > 0 ? f.phase(1) : undefined} head />
      <Elbow from={[162, 36]} to={[218, 58]} via={190} dashed lit={f.lit("grader")} pulse={f.moving("read") > 0 ? f.phase(1) : undefined} head />
      {/* The two graders, each keyed by the strip its tiles carry. */}
      <g opacity={0.55 + 0.45 * f.lit("scanner")}>
        <rect x={224} y={21} width={12} height={3} rx={1} style={{ fill: HUE.m }} />
        <text className="pt-label" x={242} y={26}>plugin-scan.mjs</text>
        <text className="pt-label pt-label-sub" x={242} y={39}>grades what a rule settles</text>
      </g>
      <g opacity={0.55 + 0.45 * f.lit("grader")}>
        <rect x={224} y={55} width={12} height={3} rx={1} style={{ fill: HUE.j }} />
        <text className="pt-label" x={242} y={60}>model grader</text>
        <text className="pt-label pt-label-sub" x={242} y={73}>a grade, a file, a quote</text>
      </g>
      <Elbow from={[364, 22]} to={[382, 86]} first="h" via={382} lit={f.lit("mcheck")} pulse={f.moving("mgrade") > 0 ? f.phase(1) : undefined} />
      <Elbow from={[336, 56]} to={[366, 86]} first="h" via={366} lit={f.lit("jcheck")} pulse={f.moving("jgrade") > 0 ? f.phase(1) : undefined} />

      {/* The divide: right of it, every number is plugin-scan.mjs arithmetic. */}
      <rect x={DIVIDE} y={ZONE_TOP} width={VIEW.width - DIVIDE - 6} height={ZONE_BOT - ZONE_TOP} rx={8} style={{ fill: "var(--pt-left)", stroke: "var(--pt-rule)", strokeWidth: 1 }} />
      <line className="pt-edge" x1={DIVIDE} x2={DIVIDE} y1={ZONE_TOP - 14} y2={ZONE_BOT} style={{ strokeWidth: 1.5 }} />
      <text className="pt-label" x={DIVIDE + 10} y={ZONE_TOP - 6}>plugin-scan.mjs --score</text>
      <text className="pt-label pt-label-sub" x={DIVIDE + 184} y={ZONE_TOP - 6}>every number here</text>

      {/* The ledger: a row per dimension, a tile per check. */}
      <Panel box={{ x: 14, y: 88, width: 378, height: 304 }} lit={1}>
        {DIMS.map((d, i) => {
          const y = rowY(i);
          const applies = d.applicable === true;
          const lit = f.lit("dims");
          const pct = applies ? `${(share(d) * 100).toFixed(1)}%` : "n/a";
          return (
            <g key={String(d.id)}>
              <text className="pt-label" x={26} y={y - 2} style={{ fill: textTone(applies ? 1 : 0.2) }}>{String(d.id)}</text>
              <text className="pt-tag" x={140} y={y - 2} textAnchor="end" opacity={1 - weighed}>{`w ${d.weight}`}</text>
              <text className="pt-tag" x={140} y={y - 2} textAnchor="end" opacity={weighed} style={{ fill: applies ? "var(--pt-ink)" : undefined }}>{pct}</text>
              <text className="pt-label pt-label-sub" x={26} y={y + 12} opacity={0.6 + 0.4 * lit}>{String(d.label)}</text>
            </g>
          );
        })}
        {CHECKS.map((c) => {
          const t = TILE.get(String(c.id))!;
          const box = { x: t.x, y: t.y, width: t.w, height: TH };
          if (c.grade === "n/a") return <Tile key={String(c.id)} box={box} empty />;
          const born = c.kind === "j" ? f.here("jcheck") : 1;
          if (born <= 0) return null;
          const g = graded(c);
          const r = fixRank(String(c.id));
          const fixed = ranking && r >= 0 && listed(r) > 0.5;
          const isTop = fixed && c.id === top;
          if (!g.on) return <Tile key={String(c.id)} box={box} empty here={born} />;
          const a = Math.max(g.accent, isTop ? 1 : 0);
          return (
            <g key={String(c.id)}>
              {a > 0 ? (
                <g>
                  <rect x={t.x} y={t.y} width={t.w} height={TH} rx={2} style={ring(a)} />
                  <text className="pt-num" x={t.x + t.w / 2} y={t.y + TH / 2 + 3.4} textAnchor="middle" style={{ fill: "var(--pt-ink)" }}>{isTop ? "4" : String(c.grade)}</text>
                </g>
              ) : (
                <Tile box={box} label={String(c.grade)} share={num(c.grade) / 4 * 0.6} />
              )}
              <rect x={t.x + 2} y={t.y + TH - 3.5} width={t.w - 4} height={2.5} rx={1} style={{ fill: HUE[c.kind as "m" | "j"] }} />
              {fixed ? <text className="pt-tag" x={t.x + t.w / 2} y={t.y - 4} textAnchor="middle" style={{ fill: isTop ? "var(--pt-accent-ink)" : undefined }}>{String(c.id)}</text> : null}
            </g>
          );
        })}
      </Panel>

      {/* The key, under the ledger. */}
      <g>
        <rect x={26} y={408} width={12} height={3} rx={1} style={{ fill: HUE.m }} />
        <text className="pt-label pt-label-sub" x={46} y={413}>graded by plugin-scan.mjs, by rule</text>
        <rect x={26} y={425} width={12} height={3} rx={1} style={{ fill: HUE.j }} />
        <text className="pt-label pt-label-sub" x={46} y={430}>graded by the model, with a file and a quote</text>
        <rect x={26} y={438} width={7} height={10} rx={1} style={{ fill: toneFill("quiet") }} />
        <rect x={33 + 2} y={438} width={14} height={10} rx={1} style={{ fill: toneFill("quiet") }} />
        <text className="pt-label pt-label-sub" x={56} y={447}>a tile's width: how much its check counts</text>
        <rect x={26.5} y={455} width={11} height={10} rx={2} style={ring(1)} />
        <text className="pt-label pt-label-sub" x={46} y={464}>orange ring: the step happening now</text>
      </g>

      {/* Each row folds into its dimension's bar: length the score, thickness the weight. */}
      {DIMS.map((d, i) => {
        const y = rowY(i), h = num(d.weight);
        if (d.applicable !== true) {
          return (
            <g key={String(d.id)} opacity={f.here("dims")}>
              <rect className="pt-guide" x={BX} y={y - h / 2} width={40} height={h} rx={2} />
              <text className="pt-tag" x={BX + 48} y={y + 3.5}>n/a: no workflows</text>
            </g>
          );
        }
        const k = APPLIES.indexOf(d);
        const grown = folded(k);
        const gone = moved(k);
        const len = num(d.score) * BAR_PER;
        const active = now("fold") && k === sFold.index ? ringOn : 0;
        return (
          <g key={String(d.id)}>
            {index >= at("fold") ? <Elbow from={[ROW_END[i] + 4, y]} to={[BX - 4, y]} lit={f.lit("dims")}
              pulse={now("fold") && k === sFold.index && sFold.t < 1 ? sFold.t : undefined} /> : null}
            {grown > 0 ? (active > 0
              ? <rect x={BX} y={y - h / 2} width={len * grown} height={h} rx={2} style={ring(active)} />
              : <Bar box={{ x: BX, y: y - h / 2, width: len * grown, height: h }} tone={gone > 0 ? "quiet" : "mid"} grow="left" radius={2} />
            ) : null}
            {grown > 0.98 ? <text className="pt-num" x={BX + len + 6} y={y + 3.5}>{num(d.score).toFixed(1)}</text> : null}
          </g>
        );
      })}

      {/* The 0-100 column the bars stack into. */}
      <g opacity={f.here("composite")}>
        <rect className="pt-panel" x={GX} y={G_TOP} width={GW} height={G_BOT - G_TOP} rx={2} />
        <text className="pt-num" x={GX - 6} y={G_TOP + 3.5} textAnchor="end">100</text>
        <text className="pt-num" x={GX - 6} y={G_BOT + 3.5} textAnchor="end">0</text>
        <text className="pt-label" x={GX + GW / 2} y={118} textAnchor="middle">{f.model.entities.find((e) => e.id === "composite")!.label}</text>
        <text x={GX + GW / 2} y={140} textAnchor="middle" className="pt-label"
          style={{ fontSize: 17, letterSpacing: 0, fill: mix("var(--pt-accent-ink)", "var(--pt-ink)", numberAccent) }}>{composite.toFixed(1)}</text>
      </g>
      {APPLIES.map((d, k) => {
        const q = moved(k);
        if (q <= 0) return null;
        const i = dimIndex(String(d.id));
        const seg = STACK[k];
        const h0 = num(d.weight), w0 = num(d.score) * BAR_PER;
        const x = lerp(BX, GX + 1, q), w = lerp(w0, GW - 2, q);
        const y1 = lerp(rowY(i) - h0 / 2, gy(seg.to), q), h = lerp(h0, (seg.to - seg.from) * PER_PT, q);
        const active = now("weigh") && k === sWeigh.index && sWeigh.t < 1 ? 1 : 0;
        return (
          <g key={`seg-${d.id}`}>
            <rect x={x} y={y1} width={w} height={h} rx={1.5}
              style={active ? ring(1) : { fill: toneFill("mid"), stroke: "var(--pt-top)", strokeWidth: 1 }} />
            {q >= 1 ? <text className="pt-num" x={GX + GW / 2} y={gy((seg.from + seg.to) / 2) + 3.5} textAnchor="middle" style={{ fill: "var(--pt-bg)" }}>{seg.id}</text> : null}
          </g>
        );
      })}

      {/* The tiers: where the composite lands. */}
      <g opacity={tierOn}>
        {TIERS.map((t, k) => {
          const floor = num(t.floor);
          const ceil = k === 0 ? 100 : num(TIERS[k - 1].floor);
          const mid = (floor + ceil) / 2;
          const here = t.id === verdict.id;
          return (
            <g key={String(t.id)}>
              {floor > 0 ? <line className="pt-edge" x1={GX - 4} x2={GX + GW + 4} y1={gy(floor)} y2={gy(floor)} /> : null}
              {floor > 0 ? <text className="pt-num" x={GX - 6} y={gy(floor) + 3.5} textAnchor="end">{floor}</text> : null}
              {here ? <path className="pt-edge" d={`M ${GX + GW + 8} ${gy(ceil) + 2} h 3 V ${gy(floor) - 2} h -3`}
                style={{ stroke: mix("var(--pt-accent)", "var(--pt-line)", tierAccent) }} /> : null}
              <text className="pt-tag" x={GX + GW + 16} y={gy(here ? floor + 4 : mid) + 3.5}
                style={{ fill: here ? mix("var(--pt-accent-ink)", "var(--pt-ink)", tierAccent) : "var(--pt-ink-3)" }}>{String(t.id)}</text>
            </g>
          );
        })}
      </g>

      {/* fix_deltas: each weak check raised to 4 and re-scored, best first. */}
      <g opacity={f.here("fixdeltas")}>
        <Elbow from={[GX + GW / 2, G_BOT + 6]} to={[442, 420]} first="v" via={410} lit={f.lit("fixdeltas")}
          pulse={f.moving("rescore") > 0 ? f.phase(1) : undefined} />
        {FIXES.map((x, k) => {
          const shown = listed(k);
          if (shown <= 0) return null;
          const first = k === 0 && ranking ? 1 : 0;
          const bx = 404 + k * 82;
          return (
            <g key={String(x.id)} opacity={shown}>
              <rect x={bx} y={424} width={76} height={24} rx={4}
                style={first ? ring(1) : { fill: "var(--pt-top)", stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
              <text className="pt-num" x={bx + 8} y={440}>{k + 1}</text>
              <text className="pt-label" x={bx + 20} y={440}>{String(x.check)}</text>
              <text className="pt-num" x={bx + 68} y={440} textAnchor="end" style={{ fill: first ? "var(--pt-accent-ink)" : undefined }}>{`+${num(x.delta).toFixed(1)}`}</text>
            </g>
          );
        })}
        <text className="pt-tag" x={404} y={460}>fix_deltas: raise one check to 4, re-score</text>
      </g>
      {/* The top fix's gain, drawn on the column above where the composite stands. */}
      {ranking && listed(0) > 0 ? (
        <g>
          <rect x={GX + 1} y={gy(composite + num(FIXES[0].delta) * listed(0))} width={GW - 2} height={num(FIXES[0].delta) * PER_PT * listed(0)} rx={1.5}
            style={{ ...ring(1), strokeDasharray: "3 2", strokeWidth: 1 }} />
          <text className="pt-tag" x={GX + GW + 16} y={gy(after) + 3.5} opacity={listed(0)} style={{ fill: "var(--pt-accent-ink)" }}>{`${after.toFixed(1)} if ${top} = 4`}</text>
        </g>
      ) : null}
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
