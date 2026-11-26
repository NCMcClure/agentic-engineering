"use client";
// motion-between-frames: a clip an agent made, which a model only ever sees
// one still at a time, and what perceptual-loop's motion commands hand back.
// `pl sweep --track` turns the clip into a trace of how far the ball moved
// each frame, with the one frame that stands out flagged; `pl video burst`
// lays out the frames round it; `pl flow` draws which way and how far things
// moved between them. The numbers go to the agent, the agent fixes that step,
// and the same commands come back flat.
//
// Every number here was measured by running those commands on a 24-frame
// synthetic clip (320 x 180, a spotted ball moving 8 px a frame, one step
// skipped going into frame 13) and on the same clip with the step put back:
// `pl sweep <clip> --track --size 320 --max-judder 0.05`, `pl video burst
// <clip> --frame 13 --count 3`, and `pl flow <clip> --region ball=...`.
import type { ReactNode } from "react";
import type { Model } from "../kit/model";
import { rows, series } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, arrow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel, toneFill } from "../kit/flat/panel";
import { ease, indexOf, lerp, outro, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 412 };

// The clip, as it was rendered: the frame, the floor line, the ball.
const FRAME = { width: 320, height: 180, floor: 136, cy: 100, r: 36 };
const X = series(model, "x"), X_FIXED = series(model, "x-fixed");
const STEPS = series(model, "steps"), STEPS_FIXED = series(model, "steps-fixed");
const PAIRS = rows(model, "pairs");
const REPORT = rows(model, "report");
const FLAGGED = Number(REPORT[0].dropped);
const LAST = X.length - 1;

// Layout, in px. Three columns: what the agent made, what pl draws, the numbers.
const SCREEN: Box = { x: 28, y: 36, width: 164, height: 92.25 };
const SCRUB = { x0: 36, x1: 184, y: 143 };
const STILL: Box = { x: 28, y: 240, width: 72, height: 40.5 };
const AGENT: Box = { x: 28, y: 356, width: 164, height: 44 };
const PLOT: Box = { x: 214, y: 36, width: 352, height: 100 };
const CHART = { x0: 272, x1: 554, y0: 64, y1: 112 };
const BURST = { y: 162, width: 104, height: 58.5, xs: [214, 338, 462], frames: [FLAGGED - 1, FLAGGED, FLAGGED + 1] };
const FLOW = { y: 250, width: 170, height: 95.6, xs: [214, 396] };
const NUM: Box = { x: 588, y: 36, width: 156, height: 170 };
const ROWS = [58, 76, 94, 112, 142, 160, 178, 196];
// Between two frames of the burst: where the flow of that pair hangs from.
const GAPS = [(BURST.xs[0] + BURST.width + BURST.xs[1]) / 2, (BURST.xs[1] + BURST.width + BURST.xs[2]) / 2];
const RETURN_Y = 378;

const r = (v: number) => Math.round(v * 100) / 100;
const flatText = { ["--pt-halo" as string]: "transparent" };

/** A plot's vertical range, as plot.mjs takes it: the values' own, or 4 floors wide when they are flatter than that. */
function rangeOf(values: number[], floor = 0.002) {
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 4 * floor) { const mid = (lo + hi) / 2; lo = mid - 2 * floor; hi = mid + 2 * floor; }
  return { lo, hi };
}
const RANGE = rangeOf(STEPS), RANGE_FIXED = rangeOf(STEPS_FIXED);
const tick = (v: number) => Number(v.toPrecision(4)).toString();
const frameX = (frame: number) => CHART.x0 + ((CHART.x1 - CHART.x0) * frame) / LAST;
const valueY = (v: number, range: { lo: number; hi: number }) => CHART.y1 - ((CHART.y1 - CHART.y0) * (v - range.lo)) / (range.hi - range.lo);
const fileOf = (frame: number) => `${String(frame).padStart(6, "0")}.png`;

/** One frame of the clip in a box: the wall, the floor, the ball where it is. `before` is the dimmed frame a flow sheet draws on. */
function Still({ box, cx, lit = 1, accent = 0, before = false, children }: {
  box: Box; cx: number; lit?: number; accent?: number; before?: boolean; children?: ReactNode;
}) {
  const s = box.width / FRAME.width;
  const bx = box.x + cx * s, by = box.y + FRAME.cy * s, rad = FRAME.r * s;
  const off = rad * 0.42;
  return (
    <Panel box={box} radius={3} lit={lit} accent={accent}>
      <rect x={box.x} y={r(box.y + FRAME.floor * s)} width={box.width} height={r(box.height - FRAME.floor * s)} style={{ fill: "var(--pt-left)" }} />
      <circle cx={r(bx)} cy={r(by)} r={r(rad)} style={{ fill: toneFill(before ? "quiet" : "strong") }} />
      {!before ? ([[0, 0], [-off, -off], [off, -off], [-off, off], [off, off]] as P2[]).map(([dx, dy], i) => (
        <circle key={i} cx={r(bx + dx)} cy={r(by + dy)} r={r(Math.max(1.1, rad * 0.15))} style={{ fill: toneFill("quiet") }} />
      )) : null}
      {children}
    </Panel>
  );
}

/** A small arrow to the right: the motion of one patch between two frames. */
function Arrow({ from, length, accent = 0 }: { from: P2; length: number; accent?: number }) {
  if (length < 1) return null;
  const to: P2 = [r(from[0] + length), from[1]];
  const stroke = accent > 0 ? mix("var(--pt-accent)", "var(--pt-line)", accent) : "var(--pt-line)";
  return (
    <g>
      <path className="pt-link" d={`M ${r(from[0])} ${from[1]} L ${to[0]} ${to[1]}`} style={{ stroke }} />
      <path className="pt-link-head" d={arrow(to, 0, 4)} style={{ fill: stroke, stroke }} />
    </g>
  );
}

/** A place a picture will be: dashed, because nothing is there yet. */
function Place({ box, here }: { box: Box; here: number }) {
  if (here >= 1) return null;
  return <rect className="pt-guide" x={box.x + 0.5} y={box.y + 0.5} width={box.width - 1} height={box.height - 1} rx={3} opacity={r(0.7 * (1 - here))} style={{ stroke: "var(--pt-line-2)" }} />;
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  /** 0 before the beat, its progress in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const arrive = (id: string, a = 0, b = 0.3) => ease.out(span(through(id), a, b));
  const dim = (lit: number) => r(0.62 + 0.38 * lit);
  const resting = f.frame.beat.rest ? 1 : 0;

  // The fix: the agent's step is put back, and everything measured again reads the fixed clip.
  const morph = ease.inOut(span(through("fix"), 0.32, 0.44));
  const mended = morph >= 0.5;
  // What pl drew leaves as the loop ends, so the next pass starts on the clip alone.
  const leaving = outro(f.tl, f.frame);
  const xs = mended ? X_FIXED : X;

  // Which frame the player shows: it plays, pl reads it through, then it goes back to the flagged frame.
  const playing = index === at("clip");
  const reading = index === at("trace");
  const frame = playing ? Math.round(LAST * span(p, 0.08, 0.9))
    : reading ? Math.round(LAST * span(p, 0.06, 0.36))
      : index === at("burst") ? Math.round(lerp(LAST, FLAGGED, ease.out(span(p, 0, 0.25))))
        : resting ? Math.round(lerp(FLAGGED, 0, ease.inOut(span(p, 0.5, 0.95))))
          : FLAGGED;
  const headX = lerp(SCRUB.x0, SCRUB.x1, frame / LAST);
  const headAccent = Math.max(f.on("clip"), reading && p < 0.38 ? 1 : 0);

  // The trace: drawn up to the frame pl has read, then the flagged frame takes the accent.
  const plotHere = arrive("trace", 0, 0.08);
  const read = LAST * span(through("trace"), 0.06, 0.36);
  const flag = ease.out(span(through("trace"), 0.36, 0.44)) * (1 - ease.out(span(through("fix"), 0.3, 0.4)));
  const flagNow = f.on("trace");
  const range = morph < 0.5 ? RANGE : RANGE_FIXED;
  const points: P2[] = STEPS.map((v, i) => [frameX(i + 1), lerp(valueY(v, RANGE), valueY(STEPS_FIXED[i], RANGE_FIXED), morph)]);
  const drawn = points.filter((_, i) => i + 1 <= read);
  if (drawn.length && drawn.length < points.length) {
    const next = points[drawn.length], last = drawn[drawn.length - 1], t = read - drawn.length;
    if (t > 0) drawn.push([lerp(last[0], next[0], t), lerp(last[1], next[1], t)]);
  }
  const judder = mended ? Number(REPORT[1].judder) : Number(REPORT[0].judder);

  // The burst and the flow sheet.
  const burstHere = arrive("burst", 0.08, 0.34);
  const flowHere = arrive("flow", 0.02, 0.2);
  const grown = ease.out(span(through("flow"), 0.14, 0.4));
  const flowNow = f.on("flow");

  // The numbers.
  const sweepRows = ease.out(span(through("trace"), 0.38, 0.46));
  const flowRows = ease.out(span(through("flow"), 0.34, 0.44));
  const report = mended ? REPORT[1] : REPORT[0];

  // The agent's move.
  const told = ease.out(span(through("fix"), 0, 0.16));
  const acting = ease.out(span(through("fix"), 0.16, 0.3));
  const fixNow = f.on("fix");
  const remade = fixNow * ease.out(span(through("fix"), 0.3, 0.4));

  const clipLit = Math.max(f.lit("clip"), 0.5);
  const stillLit = f.lit("still");
  const agentLit = f.lit("agent");
  const traceLit = f.lit("trace");
  const burstLit = f.lit("burst");
  const arrowsLit = f.lit("arrows");
  const numbersLit = f.lit("numbers");

  const wire = (id: string, shown = 1) => ({
    progress: shown,
    pulse: f.moving(id) > 0 ? ease.out(span(p, 0.04, 0.34)) : undefined,
    lit: Math.max(f.moving(id), resting, 0.2),
  });

  return (
    <g>
      {/* What the agent made: the clip, in a player */}
      <text className="pt-label" x={SCREEN.x} y={22}>What the agent made</text>
      <g opacity={dim(clipLit)}>
        <Still box={SCREEN} cx={xs[frame]} />
        <line className="pt-edge" x1={SCRUB.x0} x2={SCRUB.x1} y1={SCRUB.y} y2={SCRUB.y} style={{ stroke: "var(--pt-line-2)" }} />
        {X.map((_, i) => {
          const x = r(lerp(SCRUB.x0, SCRUB.x1, i / LAST));
          const marked = Math.max(i === FLAGGED ? flag : 0, i >= FLAGGED ? remade : 0);
          return <line key={i} className="pt-edge" x1={x} x2={x} y1={SCRUB.y - (marked > 0.5 ? 5 : 3)} y2={SCRUB.y + (marked > 0.5 ? 5 : 3)}
            style={{ stroke: marked > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", marked) : "var(--pt-line-2)" }} />;
        })}
        <circle cx={r(headX)} cy={SCRUB.y} r={4} style={{ fill: headAccent > 0 ? mix("var(--pt-accent)", "var(--pt-ink)", headAccent) : "var(--pt-ink)", stroke: "var(--pt-bg)", strokeWidth: 1.5 }} />
        <text className="pt-tag" x={SCREEN.x} y={161}>{fileOf(frame)}</text>
        <text className="pt-tag" x={SCREEN.x + SCREEN.width} y={161} textAnchor="end">{X.length} frames</text>
      </g>

      {/* What a model is handed: one still of it */}
      <Line from={[64, 168]} to={[64, STILL.y - 3]} head lit={Math.max(stillLit, 0.3)} />
      <g opacity={dim(stillLit)}>
        <Still box={STILL} cx={xs[FLAGGED]} />
        <text className="pt-label" x={STILL.x + STILL.width + 10} y={STILL.y + 17}>One still</text>
        <text className="pt-tag" x={STILL.x + STILL.width + 10} y={STILL.y + 31}>looks fine</text>
      </g>
      <Elbow from={[64, STILL.y + STILL.height + 2]} to={[64, AGENT.y - 2]} first="v" quiet {...wire("see")} />

      {/* The agent: a model, so stills are all it sees */}
      <g opacity={dim(agentLit)}>
        <rect className="pt-panel" x={AGENT.x} y={AGENT.y} width={AGENT.width} height={AGENT.height} rx={6}
          style={{ stroke: fixNow > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", fixNow) : "var(--pt-line-2)", strokeWidth: fixNow > 0.5 ? 1.5 : 1 }} />
        <text className="pt-label" x={AGENT.x + 10} y={AGENT.y + 18} style={flatText}>The agent</text>
        <text className="pt-tag" x={AGENT.x + 10} y={AGENT.y + 33} style={{ ...flatText, fill: fixNow > 0.5 ? "var(--pt-accent-ink)" : undefined }}>
          {acting * leaving > 0.5 ? "fixes the step into 13" : "a model: it sees stills"}
        </text>
      </g>

      {/* pl reads the clip: one trunk, a branch to each picture */}
      {([["track", 82], ["around", BURST.y + BURST.height / 2], ["between", FLOW.y + FLOW.height / 2]] as [string, number][])
        .sort((a, b) => f.moving(a[0]) - f.moving(b[0]))
        .map(([id, y]) => <Elbow key={id} from={[SCREEN.x + SCREEN.width, 82]} to={[PLOT.x, y]} via={203} quiet {...wire(id)} />)}

      {/* What pl draws for the model: the trace */}
      <text className="pt-label" x={PLOT.x} y={22}>What pl draws</text>
      <text className="pt-label" x={NUM.x} y={22}>The numbers</text>
      <Place box={PLOT} here={plotHere * leaving} />
      {BURST.xs.map((x, i) => <Place key={`b${i}`} box={{ x, y: BURST.y, width: BURST.width, height: BURST.height }} here={burstHere * leaving} />)}
      {FLOW.xs.map((x, i) => <Place key={`f${i}`} box={{ x, y: FLOW.y, width: FLOW.width, height: FLOW.height }} here={flowHere * leaving} />)}
      <Place box={NUM} here={sweepRows * leaving} />
      <g opacity={r(leaving)}>
      {plotHere > 0 ? <text className="pt-tag" x={PLOT.x + PLOT.width} y={22} textAnchor="end" opacity={r(plotHere)}>pl sweep --track</text> : null}
      <g opacity={dim(Math.max(traceLit, 0.6))}>
        <Panel box={PLOT} radius={4} here={plotHere}>
          <text className="pt-tag" x={PLOT.x + 10} y={PLOT.y + 17}>motion: step length per frame</text>
          {read >= LAST ? (
            <text className="pt-tag" x={PLOT.x + PLOT.width - 10} y={PLOT.y + 17} textAnchor="end"
              style={{ fill: flag > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>judder {judder.toFixed(3)}</text>
          ) : null}
          <rect className="pt-rule" x={CHART.x0} y={CHART.y0 - 4} width={CHART.x1 - CHART.x0} height={CHART.y1 - CHART.y0 + 8} />
          <text className="pt-tag" x={CHART.x0 - 8} y={CHART.y0 + 4} textAnchor="end">{tick(range.hi)}</text>
          <text className="pt-tag" x={CHART.x0 - 8} y={CHART.y1 + 3} textAnchor="end">{tick(range.lo)}</text>
          <text className="pt-tag" x={CHART.x0} y={PLOT.y + PLOT.height - 7}>frame 0</text>
          <text className="pt-tag" x={CHART.x1} y={PLOT.y + PLOT.height - 7} textAnchor="end">frame {LAST}</text>
          {flag > 0 ? (
            <g opacity={r(flag)}>
              <line x1={r(frameX(FLAGGED))} x2={r(frameX(FLAGGED))} y1={CHART.y0 - 4} y2={CHART.y1 + 4}
                style={{ stroke: "var(--pt-accent)", strokeWidth: flagNow > 0.5 ? 2.5 : 1 }} />
              <text className="pt-tag" x={r(frameX(FLAGGED) + 7)} y={CHART.y0 + 6} style={{ fill: "var(--pt-accent-ink)" }}>{FLAGGED}</text>
            </g>
          ) : null}
          {drawn.length > 1 ? <path className="pt-link" d={`M ${drawn.map(([x, y]) => `${r(x)} ${r(y)}`).join(" L ")}`} style={{ stroke: "var(--pt-ink)" }} /> : null}
          {points.map(([x, y], i) => i + 1 <= read ? (
            <rect key={i} x={r(x - 1.5)} y={r(y - 1.5)} width={3} height={3} style={{ fill: "var(--pt-ink)" }} />
          ) : null)}
        </Panel>
      </g>

      {/* The frames round the flagged one */}
      {burstHere > 0 ? (
        <g opacity={r(burstHere)}>
          <text className="pt-tag" x={PLOT.x} y={BURST.y - 8}>pl video burst --frame {FLAGGED}</text>
          {/* From the flagged frame on the trace to the same frame, enlarged: gone once nothing is flagged. */}
          <g opacity={r(1 - morph)}>
            <Line from={[r(frameX(FLAGGED)), CHART.y1 + 7]} to={[BURST.xs[1] + BURST.width / 2 + 10, BURST.y - 3]} dashed head lit={Math.max(burstLit, 0.4)} />
          </g>
        </g>
      ) : null}
      {BURST.xs.map((x, i) => {
        const box = { x, y: BURST.y, width: BURST.width, height: BURST.height };
        const centre = BURST.frames[i] === FLAGGED;
        const marked = centre ? 1 - morph : 0;
        return (
          <g key={i}>
            <g opacity={dim(Math.max(burstLit, 0.6))}>
              <Panel box={box} radius={3} here={burstHere} shift={[0, r(-8 * (1 - burstHere))]} />
              {burstHere > 0 ? (
                <g opacity={r(burstHere)} transform={`translate(0 ${r(-8 * (1 - burstHere))})`}>
                  <Still box={box} cx={xs[BURST.frames[i]]} accent={centre ? f.on("burst") * marked : 0} />
                  <text className="pt-tag" x={x + 7} y={BURST.y + 14}
                    style={{ ["--pt-halo" as string]: "var(--pt-top)", fill: marked > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>
                    #{BURST.frames[i]}{centre ? " <" : ""}
                  </text>
                </g>
              ) : null}
            </g>
          </g>
        );
      })}

      {/* The motion between each pair: arrows on the frame before */}
      {flowHere > 0 ? <text className="pt-tag" x={PLOT.x} y={FLOW.y - 8} opacity={r(flowHere)}>pl flow</text> : null}
      {FLOW.xs.map((x, i) => {
        const box = { x, y: FLOW.y, width: FLOW.width, height: FLOW.height };
        const pair = PAIRS[i];
        const into = Number(pair.into);
        const s = FLOW.width / FRAME.width;
        const bx = x + xs[into - 1] * s, by = FLOW.y + FRAME.cy * s, rowGap = 10, starts = [-16, 3];
        // The fastest motion on the sheet is drawn a little over one grid step long, the rest to that scale.
        const speed = lerp(Number(pair.speed), Number(pair.speedFixed), morph);
        const length = (speed / 16) * 17 * grown;
        const hot = into === FLAGGED ? flowNow * (1 - morph) : 0;
        return (
          <g key={i}>
            {flowHere > 0 ? (
              <g opacity={r(flowHere * dim(Math.max(arrowsLit, 0.6)))}>
                <Line from={[GAPS[i], BURST.y + BURST.height + 3]} to={[GAPS[i], FLOW.y - 3]} head lit={Math.max(arrowsLit, 0.4)} />
                <Still box={box} cx={xs[into - 1]} before>
                  {[-1, 0, 1].flatMap((gy) => starts.map((dx) => (
                    <Arrow key={`${dx}${gy}`} from={[bx + dx, r(by + gy * rowGap)]} length={length} accent={hot} />
                  )))}
                </Still>
                <text className="pt-tag" x={x + 7} y={FLOW.y + 14} style={{ ["--pt-halo" as string]: "var(--pt-top)", fill: "var(--pt-ink)" }}>into #{into}</text>
              </g>
            ) : null}
          </g>
        );
      })}

      {/* The numbers */}
      <Elbow from={[PLOT.x + PLOT.width, 86]} to={[NUM.x, 86]} quiet {...wire("flagged", sweepRows)} />
      <Elbow from={[FLOW.xs[1] + FLOW.width, FLOW.y + FLOW.height / 2]} to={[NUM.x, 168]} via={577} quiet {...wire("speed", flowHere)} />
      <g opacity={dim(Math.max(numbersLit, 0.6))}>
        <Panel box={NUM} radius={4} here={sweepRows}>
          {([
            ["judder", Number(report.judder).toFixed(3), 0],
            ["dropped", Number(report.dropped) < 0 ? "none" : `before #${report.dropped}`, mended ? 0 : flagNow],
            ["step / median", `${Number(report.ratio).toFixed(2)}×`, 0],
            [`judder ≤ ${report.bound}`, report.passed ? "passed" : "FAILED", 0],
          ] as [string, string, number][]).map(([key, value, hot], i) => (
            <g key={key}>
              {hot > 0 ? <rect x={NUM.x + 5} y={ROWS[i] - 12} width={NUM.width - 10} height={17} rx={2} style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", hot) }} /> : null}
              <text className="pt-tag" x={NUM.x + 10} y={ROWS[i]} style={flatText}>{key}</text>
              <text className="pt-num" x={NUM.x + NUM.width - 10} y={ROWS[i]} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--pt-ink)" }}>{value}</text>
            </g>
          ))}
          {flowRows > 0 ? (
            <g opacity={r(flowRows)}>
              <line className="pt-rule" x1={NUM.x + 10} x2={NUM.x + NUM.width - 10} y1={124} y2={124} />
              {([
                [`into #${FLAGGED}`, `${(mended ? 8 : 16).toFixed(2)} px`, mended ? 0 : flowNow],
                ["other pairs", "8.00 px", 0],
                ["direction", "0° right", 0],
                ["coherence", "1.00", 0],
              ] as [string, string, number][]).map(([key, value, hot], i) => (
                <g key={key}>
                  {hot > 0 ? <rect x={NUM.x + 5} y={ROWS[i + 4] - 12} width={NUM.width - 10} height={17} rx={2} style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", hot) }} /> : null}
                  <text className="pt-tag" x={NUM.x + 10} y={ROWS[i + 4]} style={flatText}>{key}</text>
                  <text className="pt-num" x={NUM.x + NUM.width - 10} y={ROWS[i + 4]} textAnchor="end" style={{ fontSize: 11.5, fill: "var(--pt-ink)" }}>{value}</text>
                </g>
              ))}
            </g>
          ) : null}
        </Panel>
      </g>

      {/* What the agent does next: the numbers are its work list, and it fixes that step */}
      {told > 0 ? (
        <g>
          <Elbow from={[NUM.x + NUM.width / 2, NUM.y + NUM.height]} to={[AGENT.x + AGENT.width, RETURN_Y]} first="v" via={RETURN_Y} {...wire("worklist", told)} />
          <text className="pt-tag" x={390} y={RETURN_Y - 9} textAnchor="middle" opacity={r(span(told, 0.6, 1))}>frame 13 · the ball · twice too far</text>
        </g>
      ) : null}
      {acting > 0 ? (
        <Elbow from={[AGENT.x, RETURN_Y]} to={[SCREEN.x, 82]} via={12} progress={acting} accent={fixNow} lit={Math.max(fixNow, resting, 0.2)} />
      ) : null}
      </g>
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
