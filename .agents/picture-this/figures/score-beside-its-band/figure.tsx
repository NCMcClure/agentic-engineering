"use client";
// score-beside-its-band: one shot's frame.ssim, run after run, beside the band
// the gate allows it. The band is measured from the candidate's own quiet runs
// and sits round its own accepted score; the reference (ssim 1) is far above,
// past a break in the axis, and the band never aims at it.
import type { Model } from "../kit/model";
import { rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Line } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import { clamp, ease, indexOf, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 744, height: 400 };

// The score's scale: 0.944 at the bottom of the plot, 0.966 at its top.
const LO = 0.944, HI = 0.966, Y_LO = 352, Y_HI = 112;
const y = (v: number) => Y_LO - ((v - LO) / (HI - LO)) * (Y_LO - Y_HI);
const AXIS_X = 96, PLOT_END = 540;
const Y_REF = 54; // ssim 1.0000, past the break

const RUNS = rows(model, "runs");
const CAL = RUNS.filter((r) => r.at === "quiet");
const ITER = RUNS.find((r) => r.id === "iterate")!;
const runX = (i: number) => 142 + i * 40; // cal1..cal6
const ITER_X = 410;
const VERDICTS = rows(model, "verdicts");
const WOB_HI = Math.max(...CAL.map((r) => r.ssim as number)), WOB_LO = Math.min(...CAL.map((r) => r.ssim as number));

const COL = 572; // the right column: the sheet and the look
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const ACC = "var(--pt-accent)";

/** One stand-in picture on the sheet: a ball over a floor. `shadow` is what the change added. */
function Thumb({ x, name, shadow }: { x: number; name: string; shadow: boolean }) {
  const w = 50, h = 44, top = 110;
  return (
    <g>
      <rect className="pt-panel" x={x} y={top} width={w} height={h} rx={3} />
      <path className="pt-rule" d={`M ${x + 3} ${top + 34} L ${x + w - 3} ${top + 34}`} style={{ stroke: "var(--pt-line-2)" }} />
      {shadow ? <ellipse cx={x + w / 2} cy={top + 34} rx={13} ry={3.2} style={{ fill: "var(--pt-ink-2)" }} /> : null}
      <circle cx={x + w / 2} cy={top + 22} r={8} style={{ fill: mix("var(--pt-ink-2)", "var(--pt-top)", 0.45), stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
      <text className="pt-tag" x={x + w / 2} y={top + h + 13} textAnchor="middle">{name}</text>
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const at = (id: string) => indexOf(f.tl, id);
  const i = f.frame.index, p = f.frame.p;
  const resting = f.frame.beat.rest ? 1 : 0;
  const inBeat = (id: string) => (i === at(id) ? 1 : 0);

  // the accepted score in baseline.json, and what it was before this shot's update
  const accepted = f.level("accepted");
  const oldLevel = model.quantities!.find((q) => q.id === "accepted")!.start!;
  const tol = f.level("tol");
  const bandPx = (tol / (HI - LO)) * (Y_LO - Y_HI);
  const bandSeen = clamp(tol / 0.002);

  // quiet runs drop in one at a time over the first two fifths of their beat; the one arriving takes the accent
  const calStart = (k: number) => 0.03 + k * 0.06;
  const calHere = (k: number) => (i > at("quiet") ? 1 : inBeat("quiet") * ease.out(span(p, calStart(k), calStart(k) + 0.06)));
  const newest = inBeat("quiet") ? Math.min(5, Math.max(0, Math.floor((p - 0.03) / 0.06))) : -1;
  const quietOn = f.on("quiet");

  // the iterate run: arrives at the old score, then falls to its own
  const iterHere = i > at("change") ? 1 : inBeat("change") * ease.out(span(p, 0, 0.12));
  const score = i >= at("change") ? f.level("score") : (ITER.ssim as number);
  const iterAccent = f.on("change");
  const beyond = i > at("change") ? 1 : inBeat("change") * ease.out(span(p, 0.3, 0.42));

  const bandAccent = f.on("band");
  const levelAccent = f.on("accept");
  const look = i >= at("look") ? (i > at("look") ? 1 : ease.out(span(p, 0, 0.15))) : 0;
  const verdictAccent = f.on("look");
  const accepting = i >= at("accept") ? (i > at("accept") ? 1 : ease.out(span(p, 0, 0.4))) : 0;

  const ink = (lit: number) => mix("var(--pt-ink-2)", "var(--pt-line-2)", lit);
  const edge = (a: number, lit = 1) => (a > 0 ? mix(ACC, mix("var(--pt-line)", "var(--pt-line-2)", lit), a) : mix("var(--pt-line)", "var(--pt-line-2)", lit));

  const lit = (...ids: string[]) => Math.max(resting, ...ids.map((e) => f.lit(e)));
  const runsLit = lit("runs", "candidate");
  const levelLit = lit("baseline", "tolerance", "gate");

  const yOld = y(oldLevel), yNow = y(accepted);
  const bandFill = mix("var(--pt-accent-soft)", "var(--pt-top)", bandSeen);
  const gateQuiet = i >= at("accept") ? 0.5 : 1;

  return (
    <g opacity={f.present}>
      {/* the axis: ssim, with a break before the reference */}
      <path className="pt-edge" d={`M ${AXIS_X} ${Y_LO + 8} L ${AXIS_X} 100 M ${AXIS_X} 82 L ${AXIS_X} ${Y_REF - 6}`} />
      <path className="pt-edge" d={`M ${AXIS_X - 6} 102 L ${AXIS_X + 6} 96 M ${AXIS_X - 6} 86 L ${AXIS_X + 6} 80`} />
      {[0.95, 0.955, 0.96, 0.965].map((v) => (
        <g key={v}>
          <path className="pt-edge" d={`M ${AXIS_X - 4} ${y(v)} L ${AXIS_X} ${y(v)}`} />
          <path className="pt-rule" d={`M ${AXIS_X + 1} ${y(v)} L ${PLOT_END} ${y(v)}`} />
          <text className="pt-num" x={AXIS_X - 8} y={y(v) + 3.5} textAnchor="end">{v.toFixed(3)}</text>
        </g>
      ))}
      <text className="pt-label" x={AXIS_X - 8} y={Y_LO + 22} textAnchor="end">frame.ssim</text>

      {/* the reference's own score: the line the gate never aims at */}
      <path className="pt-guide" d={`M ${AXIS_X} ${Y_REF} L ${PLOT_END} ${Y_REF}`} />
      <text className="pt-num" x={AXIS_X - 8} y={Y_REF + 3.5} textAnchor="end">1.000</text>
      <text className="pt-label" x={AXIS_X + 10} y={Y_REF - 8}>Reference</text>
      <text className="pt-tag" x={AXIS_X + 88} y={Y_REF - 8}>its own ssim is 1: each score is measured against it, never aimed at it</text>

      {/* the band: the tolerance either side of the accepted score, the whole width (baseline.json holds one value per entry) */}
      {bandSeen > 0 ? (
        <g>
          <rect x={AXIS_X + 1} y={r3(yNow - bandPx)} width={PLOT_END - AXIS_X - 1} height={r3(2 * bandPx)} style={{ fill: bandFill, stroke: "none" }} />
          {[-1, 1].map((s) => (
            <path key={s} className="pt-edge" d={`M ${AXIS_X + 1} ${r3(yNow + s * bandPx)} L ${PLOT_END} ${r3(yNow + s * bandPx)}`}
              style={{ stroke: edge(bandAccent, 0.35 * levelLit), strokeDasharray: "2 3", strokeWidth: bandAccent > 0.5 ? 1.5 : 1 }} />
          ))}
        </g>
      ) : null}
      {/* what the accepted score was, once it is replaced: dashed, since baseline.json keeps no history */}
      {accepting > 0 ? (
        <g opacity={r3(accepting)}>
          <path className="pt-guide" d={`M ${AXIS_X + 1} ${yOld} L ${PLOT_END} ${yOld}`} />
          <text className="pt-tag" x={PLOT_END} y={yOld - 6} textAnchor="end">was {oldLevel.toFixed(4)}</text>
        </g>
      ) : null}
      <path className="pt-edge" d={`M ${AXIS_X + 1} ${r3(yNow)} L ${PLOT_END} ${r3(yNow)}`} style={{ stroke: edge(levelAccent, levelLit), strokeWidth: levelAccent > 0 ? 2.5 : "var(--pt-hair-bold)" }} />

      {/* names on the band */}
      <text className="pt-label" x={PLOT_END} y={r3(yNow - bandPx - 22)} textAnchor="end" style={{ fill: levelAccent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>baseline.json</text>
      <text className="pt-tag" x={PLOT_END} y={r3(yNow - bandPx - 9)} textAnchor="end">accepted {accepted.toFixed(4)}</text>
      {bandSeen > 0 ? (
        <text className="pt-tag" x={PLOT_END} y={r3(yNow + bandPx + 13)} textAnchor="end" style={{ fill: bandAccent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>
          {accepting > 0.5 ? "tolerance ± 0.0020, kept as it was" : `tolerance ± ${tol.toFixed(4)}`}
        </text>
      ) : null}

      {/* the band beat: the widest wobble, cal3 to cal2, times 2.5 */}
      {bandAccent > 0 ? (
        <g opacity={r3(bandAccent)}>
          {[WOB_HI, WOB_LO].map((v) => (
            <path key={v} className="pt-edge" d={`M 128 ${r3(y(v))} L ${runX(5) + 10} ${r3(y(v))}`} style={{ stroke: ACC }} />
          ))}
          <path className="pt-edge" d={`M 128 ${r3(y(WOB_HI))} L 128 ${r3(y(WOB_LO))}`} style={{ stroke: ACC, strokeWidth: 2 }} />
          <path className="pt-leader" d={`M 128 ${r3(y(WOB_HI) - 2)} L 128 ${r3(yNow - bandPx - 20)}`} style={{ stroke: ACC }} />
          <text className="pt-label" x={122} y={r3(yNow - bandPx - 38)} style={{ fill: "var(--pt-accent-ink)" }}>widest wobble 0.0008</text>
          <text className="pt-tag" x={122} y={r3(yNow - bandPx - 25)} style={{ fill: "var(--pt-accent-ink)" }}>cal3 to cal2, x 2.5 = 0.002 either side</text>
        </g>
      ) : null}

      {/* the quiet runs; the one arriving is measured against the reference */}
      {CAL.map((r, k) => {
        const h = calHere(k);
        if (h <= 0) return null;
        const x = runX(k), v = r.ssim as number;
        const a = k === newest ? quietOn : 0;
        return (
          <g key={String(r.id)} opacity={r3(h)}>
            {a > 0 ? (
              <g opacity={r3(a)}>
                <path className="pt-guide" d={`M ${x} ${Y_REF + 4} L ${x} ${y(v) - 8}`} />
                <text className="pt-tag" x={x + 6} y={92}>ssim against the reference</text>
              </g>
            ) : null}
            <circle className="pt-token" cx={x} cy={r3(y(v))} r={4.5} style={{ fill: a > 0 ? mix(ACC, ink(runsLit), a) : ink(runsLit) }} />
          </g>
        );
      })}

      {/* the run after the change */}
      {iterHere > 0 ? (
        <g opacity={r3(iterHere)}>
          {beyond > 0 ? (
            <g opacity={r3(beyond * gateQuiet * (0.45 + 0.55 * Math.max(iterAccent, resting, f.on("look", "accept"))))}>
              <Line from={[ITER_X + 12, yOld]} to={[ITER_X + 12, y(score) + 4]} head accent={iterAccent} />
              <text className="pt-tag" x={ITER_X - 4} y={r3((yOld + y(score)) / 2 - 6)} textAnchor="end">moved {(score - oldLevel).toFixed(4)}</text>
              <text className="pt-label" x={ITER_X - 4} y={r3((yOld + y(score)) / 2 + 9)} textAnchor="end" style={{ fill: iterAccent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>gate: beyond</text>
              <text className="pt-tag" x={ITER_X - 4} y={r3((yOld + y(score)) / 2 + 22)} textAnchor="end">exit 1</text>
            </g>
          ) : null}
          <circle className="pt-token" cx={ITER_X} cy={r3(y(score))} r={5.5}
            style={{ fill: iterAccent > 0 ? mix(ACC, ink(runsLit), iterAccent) : ink(runsLit) }} />
        </g>
      ) : null}

      {/* the runs, named in order */}
      {CAL.map((r, k) => (
        <text key={String(r.id)} className="pt-tag" x={runX(k)} y={Y_LO + 22} textAnchor="middle" opacity={r3(0.3 + 0.7 * calHere(k))}>{String(r.label)}</text>
      ))}
      <text className="pt-tag" x={ITER_X} y={Y_LO + 22} textAnchor="middle" opacity={r3(0.3 + 0.7 * iterHere)}>iterate</text>
      <text className="pt-tag" x={242} y={Y_LO + 38} textAnchor="middle" opacity={r3(0.3 + 0.7 * calHere(5))}>quiet runs: same shot, nothing changed</text>
      <path className="pt-rule" d={`M 136 ${Y_LO + 28} L 136 ${Y_LO + 32} L 348 ${Y_LO + 32} L 348 ${Y_LO + 28}`} opacity={r3(0.3 + 0.7 * calHere(5))} />

      {/* the look: the sheet, and one of six verdicts */}
      {look > 0 ? (
        <g opacity={r3(look * (0.55 + 0.45 * lit("sheet", "agent")))}>
          <path className="pt-guide" d={`M ${PLOT_END + 6} ${r3(y(score))} L 560 ${r3(y(score))} L 560 206 L ${COL - 4} 206`} />
          <text className="pt-label" x={COL} y={84}>Sheet</text>
          <text className="pt-tag" x={COL} y={97}>stand-in pictures</text>
          <Thumb x={COL} name="ref" shadow={false} />
          <Thumb x={COL + 55} name="before" shadow={false} />
          <Thumb x={COL + 110} name="after" shadow />
          <text className="pt-tag" x={COL + 160} y={182} textAnchor="end">after: a contact shadow</text>
          <text className="pt-label" x={COL} y={210}>Agent's look</text>
          {VERDICTS.map((v, k) => {
            const chosen = v.chosen === true;
            const a = chosen ? verdictAccent : 0;
            const yy = 228 + k * 15;
            return (
              <g key={String(v.id)}>
                <circle cx={COL + 6} cy={yy - 3.5} r={3} style={{ fill: chosen ? (a > 0 ? mix(ACC, "var(--pt-accent-soft)", a) : "var(--pt-accent-soft)") : "none", stroke: chosen && a > 0 ? ACC : "var(--pt-line-2)", strokeWidth: 1 }} />
                <text className={chosen ? "pt-label" : "pt-tag"} x={COL + 16} y={yy} style={{ fill: chosen ? (a > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)") : "var(--pt-ink-3)" }}>{String(v.label)}</text>
              </g>
            );
          })}
        </g>
      ) : null}

      {/* the accept beat: the agent runs a targeted update, for this shot only */}
      {accepting > 0 ? (
        <g opacity={r3(accepting * (0.55 + 0.45 * Math.max(levelAccent, resting)))}>
          <text className="pt-label" x={COL} y={330} style={{ fill: levelAccent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>the agent runs</text>
          <text className="pt-tag" x={COL} y={344}>baseline update</text>
          <text className="pt-tag" x={COL} y={357}>--shots &lt;this shot&gt;</text>
          <text className="pt-tag" x={COL} y={370}>why goes in its report</text>
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
