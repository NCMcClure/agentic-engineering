"use client";
// cut-by-cut: review --apply as a grid of turns. One column per confirmed
// cut, in order; rows are how far a cut got: the branch (landed), the working
// tree (tried, alone), the checks' verdict on that cut, and the one repair.
// Waiting cuts are stacked at the left; the report at the right counts only
// what landed, with what was put back left as a dashed remainder.
import type { Model } from "../kit/model";
import { rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, Token, onElbow } from "../kit/flat/connect";
import { between, mix } from "../kit/flat/geometry";
import type { P2 } from "../kit/flat/geometry";
import { Bar, Panel, Tile } from "../kit/flat/panel";
import { ease, indexOf, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 740, height: 330 };

// The cuts, from the model: tag, lines, and whether it landed.
const CUTS = rows(model, "cuts").map((c) => ({
  tag: String(c.label).split(":")[0],
  lines: Number(c.span),
  landed: String(c.outcome).startsWith("applied"),
}));
const PREDICTED_MAX = 22; // the predicted quantity's max, in lines
const LOST = CUTS.filter((c) => !c.landed).reduce((n, c) => n + c.lines, 0);

// The layout, in px.
const COL = [215, 345, 475]; // one column per cut's turn
const CW = 112, CH = 24; // a cut card
const Y_BRANCH = 58;
const TREE = { x: 148, y: 132, width: 390, height: 46 };
const Y_TREE = TREE.y + TREE.height / 2;
const TILE = { w: 90, h: 24, y: 218 };
const REPAIR = { w: 132, h: 28, y: 280 };
const STACK_X = 22, STACK_Y = 116, STACK_GAP = 29;
const BASE_X = 150;
const Y_RESTORE = 100; // where the restore runs across, under the branch
const REPORT = { x: 574, y: 30, width: 150, height: 168 };
const BAR_X = REPORT.x + 14, BAR_W = 122, BAR_SCALE = BAR_W / PREDICTED_MAX;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A flow told as a line with its head, and the accent riding it while it moves. */
function Travel({ from, to, t, write = false, show = 1 }: { from: P2; to: P2; t: number; write?: boolean; show?: number }) {
  if (show <= 0 || t <= 0) return null;
  const moving = t < 1;
  return (
    <g opacity={r2(show)}>
      <Line from={from} to={to} head quiet={!write} progress={Math.min(1, t * 1.15)} accent={moving ? 1 : 0} />
      {moving ? <Token at={between(from, to, ease.out(t))} r={4} accent={1} /> : null}
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const within = (id: string) => (index < at(id) ? 0 : index === at(id) ? p : 1);
  const resting = index === at("rest");

  // Each cut's turn, as the beats tell it. Every move settles before its beat's middle.
  const enter = [ease.out(span(within("cut1"), 0.04, 0.28)), ease.out(span(within("red"), 0.04, 0.16)), ease.out(span(within("third"), 0.04, 0.26))];
  const rise = [ease.out(span(within("land"), 0.05, 0.38)), 0, ease.out(span(within("report"), 0.04, 0.24))];
  const gone = [0, ease.out(span(within("putback"), 0.22, 0.4)), 0];

  // The checks run down from the tree to that cut's verdict.
  const checkT = [span(within("cut1"), 0.28, 0.4), span(within("red"), 0.16, 0.24), span(within("third"), 0.26, 0.38)];
  const tail = span(within("red"), 0.24, 0.31);
  const fix = span(within("red"), 0.31, 0.38);
  const recheck = span(within("red"), 0.38, 0.45);
  const restore = ease.out(span(within("putback"), 0.04, 0.26));
  const beginPulse = span(within("begin"), 0.06, 0.42);
  const tallyPulse = span(within("report"), 0.26, 0.46);
  // The put-back cut's empty place leaves the tree as the next cut starts; the branch keeps a ring for it.
  const placeShown = gone[1] * (1 - ease.out(span(within("third"), 0, 0.12)));
  const ring = ease.out(span(within("putback"), 0.36, 0.5));

  const card = (i: number) => {
    const from: P2 = [STACK_X + CW / 2, STACK_Y + i * STACK_GAP + CH / 2];
    const inTree: P2 = [COL[i], Y_TREE];
    let [x, y] = enter[i] <= 0 ? from : enter[i] < 1 ? onElbow(from, inTree, enter[i], { first: "v", via: Y_TREE }) : inTree;
    const r = rise[i];
    y = lerp(y, Y_BRANCH, r);
    return { x, y, w: lerp(CW, 10, r), h: lerp(CH, 10, r), show: (1 - gone[i]) * (r >= 1 ? 0 : 1) };
  };
  const cardAccent = [f.on("cut1", "land") * (1 - span(within("land"), 0.3, 0.38)), 0, f.on("third")];

  const lit = (id: string) => (resting ? 1 : f.lit(id));
  const realized = f.level("realized");
  const predicted = f.level("predicted");
  const ink2 = "var(--pt-ink-2)";
  const verdict = (i: number) => (checkT[i] >= 1 ? (CUTS[i].landed ? "green" : "red") : null);
  const repairSays = recheck >= 1 ? "fix tried: still red" : fix >= 1 ? "fix tried, re-checking" : tail >= 1 ? "reading the error" : "one fix allowed";

  return (
    <g opacity={f.present}>
      {/* The branch: a git line from the base commit to the report, a dot per landed cut. */}
      <text className="pt-label" x={STACK_X} y={Y_BRANCH - 4}>Branch</text>
      <text className="pt-label pt-label-sub" x={STACK_X} y={Y_BRANCH + 11}>one commit per cut</text>
      <Elbow from={[BASE_X, Y_BRANCH]} to={[REPORT.x, Y_BRANCH]} lit={0.55 + 0.45 * lit("branch")}
        pulse={beginPulse > 0 && beginPulse < 1 ? beginPulse : tallyPulse > 0 && tallyPulse < 1 ? tallyPulse : undefined} />
      <circle className="pt-token" cx={BASE_X} cy={Y_BRANCH} r={5} style={{ fill: mix("var(--pt-accent)", "var(--pt-ink)", f.on("begin")) }} />
      <text className="pt-tag" x={BASE_X} y={Y_BRANCH - 12} textAnchor="middle">base</text>
      {beginPulse > 0 && beginPulse < 1 ? <text className="pt-tag" x={lerp(BASE_X, REPORT.x, beginPulse)} y={Y_BRANCH + 18} textAnchor="middle" style={{ fill: "var(--pt-accent-ink)" }}>base</text> : null}
      {tallyPulse > 0 && tallyPulse < 1 ? <text className="pt-tag" x={lerp(BASE_X, REPORT.x, tallyPulse)} y={Y_BRANCH + 18} textAnchor="middle" style={{ fill: "var(--pt-accent-ink)" }}>net</text> : null}
      {CUTS.map((c, i) => {
        if (!c.landed || rise[i] < 1) return null;
        const accent = i === 0 ? f.on("land") : 0;
        return (
          <g key={`commit-${i}`}>
            <circle className="pt-token" cx={COL[i]} cy={Y_BRANCH} r={r2(5.5 + 1.5 * accent)} style={{ fill: mix("var(--pt-accent)", "var(--pt-ink)", accent) }} />
            <text className="pt-tag" x={COL[i]} y={Y_BRANCH - 12} textAnchor="middle">{`${c.tag} −${c.lines}`}</text>
          </g>
        );
      })}
      {/* No commit for the cut that was put back: an empty, marked place on the branch. */}
      {ring > 0 ? (
        <g opacity={r2(ring)}>
          <circle className="pt-guide" cx={COL[1]} cy={Y_BRANCH} r={5.5} style={{ fill: "var(--pt-accent-soft)" }} />
          <text className="pt-tag" x={COL[1]} y={Y_BRANCH - 12} textAnchor="middle">{`${CUTS[1].tag}: no commit`}</text>
        </g>
      ) : null}

      {/* The working tree: one band, a column per turn, one cut in it at a time. */}
      <rect className="pt-lane" x={TREE.x} y={TREE.y} width={TREE.width} height={TREE.height} rx={6} />
      <text className="pt-label" x={TREE.x + TREE.width} y={TREE.y - 8} textAnchor="end">Working tree</text>
      {index === at("begin") ? <text className="pt-tag" x={TREE.x + 12} y={Y_TREE + 3.5} opacity={r2(span(p, 0.1, 0.3))}>clean: no uncommitted tracked change</text> : null}
      {placeShown > 0 ? (
        <g opacity={r2(placeShown)}>
          <rect className="pt-guide" x={COL[1] - CW / 2} y={Y_TREE - CH / 2} width={CW} height={CH} rx={3} style={{ fill: "var(--pt-accent-soft)" }} />
          <text className="pt-num" x={COL[1]} y={Y_TREE + 3.5} textAnchor="middle">file restored</text>
        </g>
      ) : null}

      {/* Put back: the file is copied from the last commit (HEAD, the first cut's) over the tree. */}
      {within("putback") > 0 && index === at("putback") ? (
        <g>
          <Elbow from={[COL[0], Y_BRANCH + 7]} to={[COL[1] + 42, TREE.y]} first="v" via={Y_RESTORE} progress={restore} accent={1} />
          <text className="pt-tag" x={(COL[0] + COL[1] + 42) / 2 + 4} y={Y_RESTORE - 6} textAnchor="middle" opacity={r2(span(p, 0.1, 0.24))} style={{ fill: "var(--pt-accent-ink)" }}>git checkout HEAD -- file</text>
        </g>
      ) : null}

      {/* The checks: one verdict per cut, under its column, named for the cut it judged. */}
      <text className="pt-label" x={STACK_X} y={TILE.y + 9}>Checks</text>
      <text className="pt-label pt-label-sub" x={STACK_X} y={TILE.y + 24}>only the ones green before</text>
      {COL.map((x, i) => {
        const v = verdict(i);
        const box = { x: x - TILE.w / 2, y: TILE.y, width: TILE.w, height: TILE.h };
        return <g key={`check-${i}`} opacity={r2(0.62 + 0.38 * lit("checks"))}>{v ? <Tile box={box} label={`${CUTS[i].tag}: ${v}`} share={0.15} /> : <Tile box={box} empty />}</g>;
      })}
      {CUTS.map((_, i) => <Travel key={`ck-${i}`} from={[COL[i], TREE.y + TREE.height]} to={[COL[i], TILE.y]} t={checkT[i]} show={i === 1 ? 1 - gone[1] : 1} />)}

      {/* The one repair, born when a cut goes red: it reads the error and tries one fix. */}
      {f.here("repair") > 0 ? (
        <g opacity={r2(f.here("repair"))}>
          <text className="pt-label" x={STACK_X} y={REPAIR.y + 11}>Repair, once</text>
          <text className="pt-label pt-label-sub" x={STACK_X} y={REPAIR.y + 26}>reads the error, one fix</text>
          <Panel box={{ x: COL[1] - REPAIR.w / 2, y: REPAIR.y, width: REPAIR.w, height: REPAIR.h }} radius={5} lit={lit("repair")} accent={f.on("red")}>
            <text className="pt-num" x={COL[1]} y={REPAIR.y + REPAIR.h / 2 + 3.5} textAnchor="middle">{repairSays}</text>
          </Panel>
        </g>
      ) : null}
      <Travel from={[COL[1], TILE.y + TILE.h]} to={[COL[1], REPAIR.y]} t={tail} show={1 - gone[1]} />
      <Travel from={[COL[1] - 50, REPAIR.y]} to={[COL[1] - 50, TREE.y + TREE.height]} t={fix} write show={1 - gone[1]} />
      <Travel from={[COL[1] + 50, TREE.y + TREE.height]} to={[COL[1] + 50, REPAIR.y]} t={recheck} show={recheck > 0 && recheck < 1 ? 1 : 0} />

      {/* Commits: a green cut rises from the tree into the branch. */}
      {CUTS.map((c, i) => (c.landed ? <Travel key={`cm-${i}`} from={[COL[i] - 30, TREE.y]} to={[COL[i] - 30, Y_BRANCH + 8]} t={rise[i]} write show={rise[i] < 1 ? 1 : 0} /> : null))}

      {/* The cuts, waiting in the stack, then each in its turn. */}
      <text className="pt-label" x={STACK_X} y={STACK_Y - 9}>Confirmed cuts</text>
      {CUTS.map((c, i) => {
        const k = card(i);
        if (k.show <= 0) return null;
        const label = k.w > 80 ? `${c.tag}  ${c.lines} lines` : undefined;
        return (
          <g key={`card-${i}`} opacity={r2(k.show)}>
            <Bar box={{ x: r2(k.x - k.w / 2), y: r2(k.y - k.h / 2), width: r2(k.w), height: r2(k.h) }} outline accent={cardAccent[i]} label={label} />
          </g>
        );
      })}

      {/* The report: realized beside predicted, lines to one scale; the dashed rest is what was put back. */}
      <Panel box={REPORT} lit={lit("report")} accent={f.on("report") * 0.6}>
        <text className="pt-label" x={BAR_X} y={REPORT.y + 22}>Report</text>
        <text className="pt-label pt-label-sub" x={BAR_X} y={REPORT.y + 37}>realized beside predicted</text>
        <text className="pt-tag" x={BAR_X} y={REPORT.y + 66}>predicted</text>
        <Bar box={{ x: BAR_X, y: REPORT.y + 72, width: r2(predicted * BAR_SCALE), height: 16 }} outline label={`${Math.round(predicted)} lines`} />
        <text className="pt-tag" x={BAR_X} y={REPORT.y + 112}>realized</text>
        <rect className="pt-guide" x={BAR_X} y={REPORT.y + 118} width={BAR_W} height={16} rx={3} />
        <Bar box={{ x: BAR_X, y: REPORT.y + 118, width: r2(Math.max(0, realized) * BAR_SCALE), height: 16 }} grow="left" tone="strong" accent={f.on("report")}
          label={realized >= 10 ? `${Math.round(realized)} lines` : undefined} />
        {realized < 10 ? <text className="pt-num" x={r2(BAR_X + Math.max(0, realized) * BAR_SCALE + 6)} y={REPORT.y + 129.5} style={{ fill: ink2 }}>{`${Math.round(realized)} lines`}</text> : null}
        {within("report") > 0 ? <text className="pt-tag" x={BAR_X + BAR_W} y={REPORT.y + 152} textAnchor="end" opacity={r2(index === at("report") ? span(p, 0.3, 0.42) : 1)}>{`dashed: ${LOST} put back`}</text> : null}
      </Panel>
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
