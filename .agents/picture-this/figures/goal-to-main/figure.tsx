"use client";
// worktree-branches: a round of work as the repo's own graph. The plan's
// issues become the board's cards, each card starts a branch off main, and
// the followed branch carries one commit per thing an area asked for. The
// areas' names step down over the commits they asked for; delivery's
// line runs on to the merge, because it opens the branch with a test and
// closes it with ship and land. main runs along the bottom, takes the merge,
// and is where code works. Every hand-off drawn is a flow in
// the model, with the path:line that names it.
import type { Model, Row } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, indexOf, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as unknown as Model;
const VIEW = { x: 0, y: 30, width: 760, height: 414 };
const BESIDE = (model.data?.beside ?? []) as Row[];

// The layout, in px.
const PLAN: Box = { x: 16, y: 124, width: 130, height: 126 };
const BOARD: Box = { x: 166, y: 124, width: 146, height: 126 };
const ROWS = [62, 84, 106].map((dy) => PLAN.y + dy); // an issue, and the card it becomes
const ISSUES = ["01-02-03", "01-02-04", "01-02-05"];
const GOAL: P2 = [24, 94];

const MAIN_Y = 322, MAIN_END = 748;
const LANE = [206, 252, 286]; // the three branches, one per card
const START = [340, 352, 364]; // where each leaves main
const MERGE = [694, 600, 578]; // where each comes back
const STUB = 358; // how far the followed branch has got when its session starts

// The followed branch's commits: what each holds, the area that asked for it,
// and the stretch of its beat the story's dot takes to reach it.
const COMMITS: { x: number; area: string; holds: string; beat: string; t: [number, number] }[] = [
  { x: 382, area: "delivery", holds: "test", beat: "build", t: [0.04, 0.2] },
  { x: 426, area: "code", holds: "code", beat: "build", t: [0.27, 0.43] },
  { x: 470, area: "perceptual-loop", holds: "shots", beat: "look", t: [0.06, 0.3] },
  { x: 514, area: "docs-parity", holds: "page", beat: "same-change", t: [0.04, 0.15] },
  { x: 558, area: "writing", holds: "prose", beat: "same-change", t: [0.2, 0.3] },
  { x: 602, area: "system-map", holds: "@system", beat: "same-change", t: [0.35, 0.45] },
];
const STAIR_TOP = 62, STAIR = 20;
const nameY = (i: number) => STAIR_TOP + i * STAIR;
const REQUEST: P2 = [664, LANE[0]]; // the merge request: opened, not a commit
const STAGES = [716, 736]; // code's commits on main
// delivery's line, from the end of its name to the merge it lands.
const NAME_END = COMMITS[0].x + 6 + 124;
const RAIL = `M ${NAME_END} ${nameY(0)} L ${MERGE[0] - 8} ${nameY(0)} Q ${MERGE[0]} ${nameY(0)} ${MERGE[0]} ${nameY(0) + 8} L ${MERGE[0]} ${LANE[0] - 9}`;
const RAIL_LENGTH = MERGE[0] - 8 - NAME_END + 12.6 + (LANE[0] - 9 - nameY(0) - 8);

const r = (v: number) => Math.round(v * 100) / 100;
const INK = { fill: "var(--pt-ink)" };
const QUIET = { fill: "var(--pt-ink-2)" };
const HOT = { fill: "var(--pt-accent-ink)" };
const FLAT = { ["--pt-halo" as string]: "transparent" };
const tone = (lit: number, hot: number) => (hot > 0.5 ? HOT : lit > 0.5 ? INK : QUIET);

/** A commit: a dot on a branch. A ring is something that is not a commit yet: a request open, a session waiting. */
function Commit({ at, here = 1, accent = 0, quiet = false, ring = false }: { at: P2; here?: number; accent?: number; quiet?: boolean; ring?: boolean }) {
  if (here <= 0) return null;
  const base = quiet ? "var(--pt-line-2)" : "var(--pt-ink)";
  const c = accent > 0 ? mix("var(--pt-accent)", base, accent) : base;
  return <circle cx={at[0]} cy={at[1]} r={r((quiet ? 3 : 4.5) * (0.5 + 0.5 * here))} opacity={r(Math.min(1, here * 2))}
    style={{ fill: ring ? "var(--pt-bg)" : c, stroke: ring ? c : "var(--pt-bg)", strokeWidth: 1.5 }} />;
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const resting = !!f.frame.beat.rest;
  /** 0 before the beat, its progress in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const on = (id: string) => (resting ? 0 : f.on(id));

  const g = through("grill"), c = through("cards"), b = through("build"), l = through("look"), s = through("same-change"), d = through("land"), k = through("keep");

  // The plan: the spec, then an issue at a time.
  const specIn = ease.out(span(g, 0.16, 0.26));
  const issueIn = (i: number) => ease.out(span(g, 0.24 + i * 0.07, 0.33 + i * 0.07));
  // The board: a card per issue, then the yes, then the first card starts its session.
  const cardIn = (i: number) => ease.out(span(c, 0.08 + i * 0.05, 0.18 + i * 0.05));
  const granted = ease.out(span(c, 0.26, 0.32));
  const started = span(c, 0.3, 0.42);
  const grown = span(c, 0.36, 0.48); // the branches leave main
  const column = d >= 0.46 ? "done" : d >= 0.16 ? "review" : c >= 0.3 ? "in progress" : "backlog";
  const others = d >= 0.9 ? "done" : d >= 0.3 ? "review" : b >= 0.1 ? "in progress" : "backlog";

  // How far along the followed branch the work has got, as an x.
  let reach = lerp(START[0] + 8, STUB, ease.out(span(c, 0.42, 0.5)));
  for (const one of COMMITS) reach = lerp(reach, one.x, ease.inOut(span(through(one.beat), one.t[0], one.t[1])));
  reach = lerp(reach, REQUEST[0], ease.inOut(span(d, 0.03, 0.14)));
  const turn = ease.inOut(span(d, 0.26, 0.32)); // on to the corner
  const drop = ease.inOut(span(d, 0.32, 0.45)); // the merge: down into main
  const along = lerp(MERGE[0], STAGES[1], ease.inOut(span(k, 0.06, 0.42)));

  const made = (i: number) => span(through(COMMITS[i].beat), COMMITS[i].t[1] - 0.04, COMMITS[i].t[1] + 0.02);
  // The one commit the story is on now.
  const current = COMMITS.reduce((last, _, i) => (made(i) > 0.5 ? i : last), -1);
  const onBranch = index >= at("build") && index <= at("same-change");
  const merged = drop >= 1;

  // Where the story's dot is.
  const tip = lerp(reach, MERGE[0] - 8, turn);
  const dot: P2 | null = resting ? null
    : index === at("grill") ? [GOAL[0], lerp(GOAL[1], PLAN.y - 9, ease.inOut(span(g, 0.03, 0.14)))]
    : index === at("cards") ? (c < 0.3 ? [lerp(PLAN.x + PLAN.width + 10, BOARD.x - 9, ease.inOut(span(c, 0.03, 0.12))), ROWS[0]] : c < 0.42 ? null : [reach, LANE[0]])
    : index <= at("same-change") ? [reach, LANE[0]]
    : index === at("land") ? (d < 0.32 ? [tip, LANE[0]] : [MERGE[0], lerp(LANE[0] + 8, MAIN_Y, drop)])
    : [along, MAIN_Y];

  const hot: Record<string, number> = {
    "planning": on("grill"),
    "agent-works": on("cards"),
    "delivery": Math.max(onBranch && current === 0 ? on("build") : 0, on("land")),
    "code": onBranch && current === 1 ? on("build") : 0,
    "perceptual-loop": onBranch && current === 2 ? on("look") : 0,
    "docs-parity": onBranch && current === 3 ? on("same-change") : 0,
    "writing": onBranch && current === 4 ? on("same-change") : 0,
    "system-map": onBranch && current === 5 ? on("same-change") : 0,
    "code": on("keep"),
  };
  const lit: Record<string, number> = {
    "planning": specIn, "agent-works": cardIn(0), "code": span(k, 0.1, 0.2),
    ...Object.fromEntries(COMMITS.map((one, i) => [one.area, made(i)])),
  };
  if (resting) for (const key of Object.keys(lit)) lit[key] = 1;

  // The other two sessions: quieter, a step behind, and home before the round ends.
  const otherReach = (n: number) => START[n] + 8 + (MERGE[n] - 8 - START[n] - 8) * Math.min(1, span(c, 0.48, 1) * 0.05 + b * 0.3 + l * 0.12 + s * 0.3 + span(d, 0, 0.6) * 0.23);
  const railIn = span(d, 0.03, 0.26);
  const waits = index === at("look") ? span(l, 0.32, 0.42) * (1 - span(l, 0.88, 0.97)) : 0;

  return (
    <g opacity={f.present}>
      {/* main: the heavy line every branch leaves and comes back to */}
      <line x1={16} x2={MAIN_END} y1={MAIN_Y} y2={MAIN_Y} style={{ stroke: "var(--pt-line)", strokeWidth: 2.5, strokeLinecap: "round" }} />
      <text className="pt-label" x={16} y={MAIN_Y + 18}>main</text>

      {/* The goal */}
      <Commit at={GOAL} />
      <text className="pt-tag" x={GOAL[0] + 11} y={GOAL[1] + 3.5} style={INK}>a goal bigger than one change</text>
      <Elbow from={[GOAL[0], GOAL[1] + 8]} to={[GOAL[0], PLAN.y - 1]} first="v" quiet accent={on("grill") * 0.9} />

      {/* The plan: planning */}
      <Panel box={PLAN} accent={on("grill")}>
        <text className="pt-tag" x={PLAN.x + 10} y={PLAN.y + 15} style={INK}>.agents/plan/</text>
        <line className="pt-rule" x1={PLAN.x} x2={PLAN.x + PLAN.width} y1={PLAN.y + 22} y2={PLAN.y + 22} />
        <text className="pt-tag" x={PLAN.x + 10} y={PLAN.y + 40} opacity={r(specIn)}>spec, grilled</text>
        {ISSUES.map((id, i) => (
          <text key={id} className="pt-tag" x={PLAN.x + 10} y={ROWS[i] + 3.5} opacity={r(issueIn(i))} style={INK}>{`issue ${id}`}</text>
        ))}
      </Panel>
      <text className="pt-label" x={PLAN.x} y={PLAN.y + PLAN.height + 18} style={tone(lit["planning"], hot["planning"])}>planning</text>

      {/* An issue becomes a card */}
      {ROWS.map((y, i) => (
        <Elbow key={y} from={[PLAN.x + PLAN.width + 3, y]} to={[BOARD.x - 2, y]} quiet progress={span(c, 0.03 + i * 0.05, 0.12 + i * 0.05)} accent={i === 0 ? on("cards") * (1 - span(c, 0.3, 0.4)) * 0.9 : 0} />
      ))}

      {/* The board: agent-works */}
      <Panel box={BOARD} accent={on("cards")}>
        <text className="pt-tag" x={BOARD.x + 10} y={BOARD.y + 15} style={INK}>board</text>
        <line className="pt-rule" x1={BOARD.x} x2={BOARD.x + BOARD.width} y1={BOARD.y + 22} y2={BOARD.y + 22} />
        <text className="pt-tag" x={BOARD.x + 10} y={BOARD.y + 40} opacity={r(granted)}>yes: aw board grant</text>
        {ISSUES.map((id, i) => {
          const mine = i === 0;
          const hotCard = mine ? on("cards") * span(c, 0.26, 0.34) : 0;
          return (
            <g key={id} opacity={r(cardIn(i))} style={FLAT}>
              <rect x={BOARD.x + 5} y={ROWS[i] - 9} width={BOARD.width - 10} height={18} rx={4}
                style={{ fill: hotCard > 0 ? mix("var(--pt-accent-soft)", "var(--pt-left)", hotCard) : "var(--pt-left)", stroke: hotCard > 0 ? mix("var(--pt-accent)", "transparent", hotCard) : "none", strokeWidth: 1.25 }} />
              <text className="pt-tag" x={BOARD.x + 11} y={ROWS[i] + 3.5} style={INK}>{id}</text>
              <text className="pt-tag" x={BOARD.x + BOARD.width - 11} y={ROWS[i] + 3.5} textAnchor="end" style={hotCard > 0.5 ? HOT : mine && column !== "backlog" ? INK : undefined}>{mine ? column : others}</text>
            </g>
          );
        })}
      </Panel>
      <text className="pt-label" x={BOARD.x} y={BOARD.y + BOARD.height + 18} style={tone(lit["agent-works"], hot["agent-works"])}>agent-works</text>

      {/* A card starts its session: not a branch, so dashed */}
      <Elbow from={[BOARD.x + BOARD.width + 3, ROWS[0]]} to={[START[0], LANE[0] - 2]} first="h" via={START[0]} radius={6} dashed quiet progress={started} accent={on("cards") * 0.9} />

      {/* The two other branches: one per card */}
      {[1, 2].map((n) => {
        const x = otherReach(n);
        const home = x >= MERGE[n] - 8.5;
        return (
          <g key={n}>
            {grown > 0 ? <path className="pt-edge" d={`M ${START[n]} ${MAIN_Y} L ${START[n]} ${r(lerp(MAIN_Y, LANE[n] + 8, grown))}`} style={{ stroke: "var(--pt-line-2)" }} /> : null}
            {grown >= 1 ? <path className="pt-edge" d={`M ${START[n]} ${LANE[n] + 8} Q ${START[n]} ${LANE[n]} ${START[n] + 8} ${LANE[n]} L ${r(x)} ${LANE[n]}${home ? ` Q ${MERGE[n]} ${LANE[n]} ${MERGE[n]} ${LANE[n] + 8} L ${MERGE[n]} ${MAIN_Y}` : ""}`} style={{ stroke: "var(--pt-line-2)" }} /> : null}
            {grown >= 1 ? <text className="pt-tag" x={START[n] + 10} y={LANE[n] - 6}>{ISSUES[n]}</text> : null}
            {[0.34, 0.56, 0.78].map((share, j) => {
              const cx = r(START[n] + (MERGE[n] - START[n]) * share);
              return x > cx && !(n === 1 && j === 0) ? <Commit key={j} at={[cx, LANE[n]]} quiet /> : null;
            })}
            {home ? <Commit at={[MERGE[n], MAIN_Y]} quiet /> : null}
          </g>
        );
      })}
      {/* The second session waits its turn for the one renderer the sessions share */}
      {l > 0.3 ? <Commit at={[COMMITS[2].x, LANE[1]]} quiet ring={index === at("look") && l < 0.9} /> : null}
      {waits > 0 ? (
        <g opacity={r(waits)}>
          <path className="pt-guide" d={`M ${COMMITS[2].x} ${LANE[0] + 8} L ${COMMITS[2].x} ${LANE[1] - 7}`} />
          <text className="pt-tag" x={COMMITS[2].x + 9} y={LANE[1] - 14}>resource-locks: one renderer, one turn</text>
        </g>
      ) : null}

      {/* The followed branch */}
      {grown > 0 ? <path className="pt-edge" d={`M ${START[0]} ${MAIN_Y} L ${START[0]} ${r(lerp(MAIN_Y, LANE[0] + 8, grown))}`} style={{ strokeWidth: 1.5 }} /> : null}
      {grown >= 1 ? (
        <path className="pt-edge" style={{ strokeWidth: 1.5 }}
          d={`M ${START[0]} ${LANE[0] + 8} Q ${START[0]} ${LANE[0]} ${START[0] + 8} ${LANE[0]} L ${r(tip)} ${LANE[0]}${drop > 0 ? ` Q ${MERGE[0]} ${LANE[0]} ${MERGE[0]} ${LANE[0] + 8} L ${MERGE[0]} ${r(lerp(LANE[0] + 8, MAIN_Y, drop))}` : ""}`} />
      ) : null}
      {grown >= 1 ? <text className="pt-tag" x={START[0] + 10} y={LANE[0] + 17} style={INK}>{ISSUES[0]}</text> : null}

      {/* delivery's line runs on: the branch it opened with a test, it ships and lands */}
      {railIn > 0 ? <path d={RAIL} pathLength={1} strokeDasharray={`${r(railIn)} 1`} style={{ fill: "none", stroke: on("land") > 0 ? mix("var(--pt-accent)", "var(--pt-ink-3)", on("land")) : "var(--pt-ink-3)", strokeWidth: 1 }} /> : null}

      {/* Each commit: what it holds, and the area that asked for it */}
      {COMMITS.map((one, i) => {
        const here = made(i);
        const h = index === at("land") ? (i === 0 ? on("land") : 0) : hot[one.area];
        return (
          <g key={one.area}>
            {here > 0 ? <path d={`M ${one.x} ${LANE[0] - 8} L ${one.x} ${nameY(i) + 5}`} opacity={r(here)} style={{ fill: "none", stroke: h > 0 ? mix("var(--pt-accent)", "var(--pt-ink-3)", h) : "var(--pt-ink-3)", strokeWidth: 1 }} /> : null}
            <text className="pt-label" x={one.x + 6} y={nameY(i) + 3.6} style={tone(lit[one.area], hot[one.area])}>{one.area}</text>
            {here > 0 ? <text className="pt-tag" x={one.x + 6} y={LANE[0] - 9} opacity={r(here)} style={h > 0.5 && index !== at("land") ? HOT : INK}>{one.holds}</text> : null}
            <Commit at={[one.x, LANE[0]]} here={here} accent={index === at("land") ? 0 : h} />
          </g>
        );
      })}

      {/* The merge request, the review, and the merge */}
      {d > 0.12 && !merged ? <Commit at={REQUEST} ring here={span(d, 0.12, 0.16)} /> : null}
      {d > 0.12 ? <text className="pt-tag" x={REQUEST[0]} y={LANE[0] + 17} textAnchor="middle" opacity={r(span(d, 0.12, 0.18))} style={INK}>ship</text> : null}
      {d > 0.16 ? <text className="pt-tag" x={MERGE[0] - 9} y={r((LANE[0] + MAIN_Y) / 2 + 3.5)} textAnchor="end" opacity={r(span(d, 0.16, 0.24))} style={INK}>review</text> : null}
      {merged ? <text className="pt-tag" x={MERGE[0] - 9} y={MAIN_Y - 10} textAnchor="end" style={on("land") > 0.5 ? HOT : INK}>land</text> : null}
      {merged ? <Commit at={[MERGE[0], MAIN_Y]} /> : null}

      {/* code: stages on main, each behind the repo's own tests */}
      {STAGES.map((x, i) => <Commit key={x} at={[x, MAIN_Y]} here={ease.out(span(k, 0.2 + i * 0.18, 0.26 + i * 0.18))} />)}
      <text className="pt-label" x={MAIN_END - 4} y={MAIN_Y + 18} textAnchor="end" style={tone(lit["code"], hot["code"])}>code</text>
      <text className="pt-tag" x={MAIN_END - 4} y={MAIN_Y + 32} textAnchor="end" opacity={r(resting ? 1 : span(k, 0.2, 0.3))}>in stages, tests green after each</text>

      {/* The story's dot */}
      {dot ? <circle cx={r(dot[0])} cy={r(dot[1])} r={5.5} style={{ fill: "var(--pt-accent)", stroke: "var(--pt-bg)", strokeWidth: 1.5 }} /> : null}

      {/* Beside the path: asked for by name, and handed to by no other area */}
      <line className="pt-rule" x1={16} x2={MAIN_END} y1={370} y2={370} />
      <text className="pt-tag" x={16} y={390}>beside the path</text>
      {BESIDE.map((row, i) => {
        const x = 136 + (i % 2) * 306, y = 390 + Math.floor(i / 2) * 30;
        return (
          <g key={String(row.id)}>
            <text className="pt-label" x={x} y={y} style={resting ? INK : QUIET}>{String(row.label)}</text>
            <text className="pt-tag" x={x} y={y + 13}>{String(row.does)}</text>
          </g>
        );
      })}
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
