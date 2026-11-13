"use client";
// four-commands-one-answer: the agent's one Bash call, cut where a shell cuts
// it, each git call dropped onto the repo it really runs in, ruled on by that
// repo's own settings, and the strongest ruling made the answer for the line.
// Across is shell order; down is repo, then judge, then verdict.
import type { Model, Row } from "../kit/model";
import { entity, flow, rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, Token } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { P2 } from "../kit/flat/geometry";
import { Panel, Tile } from "../kit/flat/panel";
import { Label } from "../kit/label";
import { ease, indexOf, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 404 };

// The command line, from the model's data: four commands joined by " && ".
const COMMANDS = rows(model, "commands");
const SEP = " && ";
const FS = 11; // the command's type size; mono, so a character is 0.6 of it
const CW = FS * 0.6;
const X0 = 176; // where the line's text starts
const LINE_Y = 34, LINE_H = 26;
const starts: number[] = [];
COMMANDS.reduce((at, c) => { starts.push(at); return at + String(c.label).length + SEP.length; }, 0);
const TOTAL = starts[starts.length - 1] + String(COMMANDS[COMMANDS.length - 1].label).length;
const cx = (char: number) => X0 + char * CW;
/** Where a command's verb sits in the line: the drop to its repo leaves from there. */
const verbX = (c: Row, i: number) => {
  const text = String(c.label), verb = String(c.verb);
  const at = verb === "push" ? text.lastIndexOf(verb) : text.indexOf(verb);
  return Math.round(cx(starts[i] + at + verb.length / 2) * 10) / 10;
};

// The places down the page.
const ROW: Record<string, number> = { app: 146, docs: 192, site: 238 };
const ROW_X0 = X0 - 4, ROW_X1 = 716;
const JUDGE_Y = 292;
const VERDICT_Y = 352;
const VBOX = { x: 628, y: VERDICT_Y - 16, width: 92, height: 30 };

const DROP = COMMANDS.map((c, i) => verbX(c, i));
const repoOf = (c: Row) => String(c.of);
const GIT = COMMANDS.map((c, i) => ({ c, i, x: DROP[i] })).filter(({ c }) => c.verb !== "cd");
const CD = COMMANDS.findIndex((c) => c.verb === "cd");
const RULING: Record<string, string> = { app: "rules-app", docs: "rules-docs", site: "rules-site" };

// The working folder's route: along app, a dip into docs for the git -C call only, then down to site at the cd.
const DOCS_X = DROP[COMMANDS.findIndex((c) => c.of === "docs")];
const CD_X = DROP[CD];
const ROUTE: P2[] = [
  [ROW_X0, ROW.app], [DOCS_X - 9, ROW.app], [DOCS_X - 9, ROW.docs], [DOCS_X + 9, ROW.docs], [DOCS_X + 9, ROW.app],
  [CD_X, ROW.app], [CD_X, ROW.site], [ROW_X1, ROW.site],
];
const SEGS = ROUTE.slice(1).map((p, i) => Math.hypot(p[0] - ROUTE[i][0], p[1] - ROUTE[i][1]));
const LENGTH = SEGS.reduce((a, b) => a + b, 0);
/** The route up to a share of its length, and the point it has reached. */
function routeTo(share: number): { pts: P2[]; tip: P2 } {
  let left = share * LENGTH;
  const pts: P2[] = [ROUTE[0]];
  for (let i = 0; i < SEGS.length; i++) {
    const [a, b] = [ROUTE[i], ROUTE[i + 1]];
    if (left >= SEGS[i]) { pts.push(b); left -= SEGS[i]; continue; }
    const t = left / SEGS[i];
    const tip: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    pts.push(tip);
    return { pts, tip };
  }
  return { pts, tip: ROUTE[ROUTE.length - 1] };
}
/** How far along the route a point on it lies, as a share. */
function shareAt(target: P2): number {
  let run = 0;
  for (let i = 0; i < SEGS.length; i++) {
    const [a, b] = [ROUTE[i], ROUTE[i + 1]];
    const onX = a[1] === b[1] && target[1] === a[1] && (target[0] - a[0]) * (target[0] - b[0]) <= 0;
    const onY = a[0] === b[0] && target[0] === a[0] && (target[1] - a[1]) * (target[1] - b[1]) <= 0;
    if (onX || onY) return (run + Math.hypot(target[0] - a[0], target[1] - a[1])) / LENGTH;
    run += SEGS[i];
  }
  return 1;
}
const path = (pts: readonly P2[]) => pts.map(([x, y], i) => `${i ? "L" : "M"} ${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`).join(" ");
const r3 = (v: number) => Math.round(v * 1000) / 1000;

const chipW = (text: string) => text.length * 7.6 + 18;
function Chip({ x, y, text, accent, marked, quiet, here }: { x: number; y: number; text: string; accent: number; marked: number; quiet: boolean; here: number }) {
  if (here <= 0) return null;
  const w = chipW(text);
  const fill = accent > 0 ? mix("var(--pt-accent)", marked > 0 ? "var(--pt-accent-soft)" : "var(--pt-top)", accent) : marked > 0 ? "var(--pt-accent-soft)" : "var(--pt-top)";
  const stroke = accent > 0 ? "var(--pt-accent)" : marked > 0 ? "var(--pt-accent-ink)" : quiet ? "var(--pt-line-2)" : "var(--pt-ink-2)";
  return (
    <g opacity={r3(here)}>
      <rect x={x - w / 2} y={y - 10} width={w} height={20} rx={4} className="pt-edge" style={{ fill, stroke, strokeDasharray: quiet ? "3 3" : undefined }} />
      <text className="pt-label" x={x} y={y + 4} textAnchor="middle" style={{ ["--pt-halo" as string]: "transparent", fill: accent > 0.5 ? "var(--pt-bg)" : quiet ? "var(--pt-ink-2)" : "var(--pt-ink)" }}>{text}</text>
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const after = (id: string) => (index < at(id) ? 0 : index === at(id) ? p : 1);
  const dim = (id: string) => 0.55 + 0.45 * f.lit(id);

  // Cut: the line splits at each && by the beat's middle.
  const cut = ease.out(span(after("split"), 0.06, 0.38));
  // Walk: the folder runs the route, settled before the middle.
  const walk = ease.inOut(span(after("where"), 0.04, 0.46));
  const route = routeTo(walk);
  // Judge: one call at a time, all three ruled by the middle.
  const ruled = GIT.map((_, k) => ease.out(span(after("judge"), 0.06 + 0.12 * k, 0.14 + 0.12 * k)));
  const current = index === at("judge") ? Math.min(GIT.length - 1, ruled.filter((r) => r >= 1).length) : -1;
  const RANKS = { nothing: 0, allow: 1, ask: 2, deny: 3 } as const;
  const rank = GIT.reduce((best, g, k) => (ruled[k] >= 0.5 ? Math.max(best, RANKS[String(g.c.decision) as keyof typeof RANKS] ?? 0) : best), 0);
  // Verdict: the strongest drops in and refuses the line.
  const decide = ease.out(span(after("strictest"), 0.05, 0.4));
  const verdictAccent = f.on("strictest", "rest") * decide;

  const lineLit = dim("line");
  const lineRight = cx(TOTAL) + 8;
  return (
    <g opacity={f.present}>
      {/* The line as the agent sent it: one panel, then four slips once it is cut. */}
      <Panel box={{ x: X0 - 8, y: LINE_Y, width: lineRight - X0 + 8, height: LINE_H }} radius={5} here={1 - cut} lit={lineLit} accent={f.on("whole")} />
      {COMMANDS.map((c, i) => {
        const x = cx(starts[i]) - 6, w = String(c.label).length * CW + 12;
        return (
          <g key={String(c.id)} opacity={r3(cut)}>
            <rect className="pt-panel" x={x} y={LINE_Y} width={w} height={LINE_H} rx={5}
              style={{ fill: decide > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", decide) : undefined, stroke: decide > 0 ? mix("var(--pt-accent-ink)", "var(--pt-line-2)", decide) : undefined }} />
          </g>
        );
      })}
      <text className="pt-tag" x={X0} y={LINE_Y + 17} style={{ fontSize: FS, letterSpacing: 0, fill: mix("var(--pt-ink)", "var(--pt-ink-2)", lineLit), ["--pt-halo" as string]: "transparent" }}>
        {COMMANDS.map((c, i) => (
          <tspan key={String(c.id)}>
            {String(c.label)}
            {i < COMMANDS.length - 1 ? <tspan style={{ fill: mix("var(--pt-accent-ink)", "var(--pt-ink-3)", f.on("split")), fontWeight: 700 }} opacity={r3(1 - 0.45 * cut * (1 - f.on("split")))}>{SEP}</tspan> : null}
          </tspan>
        ))}
      </text>
      {/* The cuts, at each &&: a notch above and below the line, orange while they are made. */}
      {COMMANDS.slice(0, -1).map((c, i) => {
        const x = Math.round(cx(starts[i] + String(c.label).length + SEP.length / 2) * 10) / 10, reach = 12 * cut * f.on("split");
        const stroke = mix("var(--pt-accent)", "var(--pt-line-2)", f.on("split"));
        return reach > 0.2 ? (
          <g key={String(c.id)}>
            <path className="pt-pulse" d={`M ${x} ${LINE_Y - 2} L ${x} ${r3(LINE_Y - 2 - reach)}`} style={{ stroke, strokeWidth: 2 }} />
            <path className="pt-pulse" d={`M ${x} ${LINE_Y + LINE_H + 2} L ${x} ${r3(LINE_Y + LINE_H + 2 + reach)}`} style={{ stroke, strokeWidth: 2 }} />
          </g>
        ) : null;
      })}
      {/* The quoted message is one word: the git push in it is never a push. */}
      {(() => {
        const text = String(COMMANDS[0].label), q0 = text.indexOf("\""), q1 = text.lastIndexOf("\"") + 1;
        const a = cx(q0), b = cx(q1), y = LINE_Y + LINE_H + 5;
        return (
          <g opacity={r3(cut * (0.5 + 0.5 * f.on("split")))}>
            <path className="pt-edge" d={`M ${a} ${y - 3} L ${a} ${y} L ${b} ${y} L ${b} ${y - 3}`} style={{ stroke: "var(--pt-ink-3)" }} />
            <text className="pt-tag" x={(a + b) / 2} y={y + 12} textAnchor="middle">one word, not a push</text>
          </g>
        );
      })()}

      {/* The repos, a row each, and the route the working folder takes along them. */}
      {(["app", "docs", "site"] as const).map((id) => (
        <g key={id} opacity={r3(dim(id))}>
          <line className="pt-rule" x1={ROW_X0} y1={ROW[id]} x2={ROW_X1} y2={ROW[id]} style={{ stroke: "var(--pt-line-2)" }} />
        </g>
      ))}
      {walk > 0 ? <path className="pt-guide" d={path(route.pts)} style={{ stroke: mix("var(--pt-accent)", "var(--pt-ink)", f.on("where")) }} /> : null}
      {walk >= shareAt([CD_X, ROW.site]) ? <text className="pt-tag" x={CD_X + 7} y={(ROW.docs + ROW.site) / 2 + 3} style={{ fill: "var(--pt-ink)" }}>cd: moves the rest</text> : null}
      {walk >= shareAt([DOCS_X - 9, ROW.docs]) ? <text className="pt-tag" x={DOCS_X - 15} y={(ROW.app + ROW.docs) / 2 + 3} textAnchor="end" style={{ fill: "var(--pt-ink)" }}>git -C: moves this command only</text> : null}

      {/* Each command drops from its verb to where it runs. */}
      {COMMANDS.map((c, i) => {
        const x = DROP[i], isCd = c.verb === "cd";
        const y = isCd ? ROW.app : ROW[repoOf(c)];
        const land = span(walk, shareAt([x, y]) - 0.04, shareAt([x, y]));
        const lit = f.on("where") ? 1 : 0.5;
        return (
          <g key={String(c.id)}>
            <Line from={[x, LINE_Y + LINE_H + (i === 0 ? 20 : 2)]} to={[x, y - (isCd ? 0 : 6)]} progress={land} lit={lit} head={!isCd} />
            {!isCd ? <Token at={[x, y]} r={5} hue={entity(model, repoOf(c)).hue} here={land} lit={dim(repoOf(c))} /> : null}
          </g>
        );
      })}
      {walk > 0 && walk < 1 ? <Token at={route.tip} r={5} accent={f.on("where")} /> : null}

      {/* The judge: each git call ruled by its own repo's settings. */}
      <line className="pt-rule" x1={ROW_X0} y1={JUDGE_Y} x2={ROW_X1} y2={JUDGE_Y} />
      {GIT.map((g, k) => {
        const id = repoOf(g.c), y0 = ROW[id] + 7;
        const word = (flow(model, RULING[id]).label ?? "").toUpperCase();
        const quiet = g.c.decision === "none";
        return (
          <g key={id}>
            <Line from={[g.x, y0]} to={[g.x, JUDGE_Y - 12]} progress={ruled[k]} head lit={f.on("judge") ? 1 : 0.5} />
            {ruled[k] > 0 ? <text className="pt-tag" x={k === 0 ? g.x + chipW(word) / 2 + 6 : g.x - chipW(word) / 2 - 6} textAnchor={k === 0 ? "start" : "end"} y={JUDGE_Y + 3.5} opacity={r3(ruled[k])}>{g.c.verb === "commit" ? "judgeCommit" : "judgePush"}</text> : null}
            {quiet && ruled[k] > 0 ? <text className="pt-tag" x={g.x - chipW(word) / 2} y={JUDGE_Y + 24} opacity={r3(ruled[k])}>if no junk or key is staged</text> : null}
            <Chip x={g.x} y={JUDGE_Y} text={word} here={ruled[k]} quiet={quiet}
              accent={k === current ? 1 : 0} marked={g.c.decision === "deny" && k !== current ? 0 : 0} />
          </g>
        );
      })}

      {/* The cd is not a git call: it moves the folder and is never judged. */}
      {(() => {
        const shown = ease.out(span(after("judge"), 0.06, 0.14));
        return shown > 0 ? (
          <g opacity={r3(shown)}>
            <Line from={[CD_X, ROW.site + 6]} to={[CD_X, ROW.site + 30]} dashed lit={0.5} />
            <text className="pt-tag" x={CD_X + 6} y={ROW.site + 26}>not judged</text>
          </g>
        ) : null;
      })()}
      {/* The verdict: the guard's ranks, and the one answer for the whole call. */}
      <text className="pt-label" x={250} y={VERDICT_Y + 4}>
        {(["allow", "ask", "deny"] as const).map((name, n) => (
          <tspan key={name}>
            <tspan style={{ fill: rank === RANKS[name] ? "var(--pt-ink)" : "var(--pt-ink-3)", fontWeight: rank === RANKS[name] ? 700 : 500 }}>{name} {RANKS[name]}</tspan>
            {n < 2 ? <tspan style={{ fill: "var(--pt-ink-3)" }}>{"  <  "}</tspan> : null}
          </tspan>
        ))}
      </text>
      {GIT.filter((g) => g.c.decision !== "none").map((g) => {
        const deny = g.c.decision === "deny";
        return deny
          ? <Elbow key={String(g.c.id)} from={[g.x, JUDGE_Y + 10]} to={[g.x, VBOX.y - 1]} first="v" progress={decide} accent={verdictAccent} />
          : <Elbow key={String(g.c.id)} from={[g.x + chipW("ASK") / 2, JUDGE_Y]} to={[VBOX.x - 4, VERDICT_Y - 1]} first="h" quiet lit={0.3} progress={decide} />;
      })}
      <Tile box={VBOX} empty here={1 - decide} />
      {decide > 0 ? (
        <g opacity={r3(decide)}>
          <rect className="pt-edge" x={VBOX.x} y={VBOX.y} width={VBOX.width} height={VBOX.height} rx={4}
            style={{ fill: mix("var(--pt-accent)", "var(--pt-accent-soft)", verdictAccent), stroke: "var(--pt-accent)" }} />
          <text className="pt-label" x={VBOX.x + VBOX.width / 2} y={VBOX.y + 19} textAnchor="middle" style={{ fontSize: 12, fill: verdictAccent > 0.5 ? "var(--pt-bg)" : "var(--pt-accent-ink)", ["--pt-halo" as string]: "transparent" }}>DENY</text>
          <text className="pt-tag" x={VBOX.x + VBOX.width} y={VBOX.y + VBOX.height + 16} textAnchor="end">permissionDecision: deny</text>
        </g>
      ) : null}

      {/* Words, in the left column. */}
      <Label entity="line" at={[24, LINE_Y + 12]} dx={0} dy={0} anchor="start" sub={entity(model, "line").note} dot={false} leader={false} />
      <Label entity="segments" at={[24, 92]} dx={0} dy={0} anchor="start" sub={entity(model, "segments").note} dot={false} leader={false} />
      {(["app", "docs", "site"] as const).map((id) => (
        <Label key={id} entity={id} at={[26, ROW[id] - 4]} dx={8} dy={0} anchor="start" sub={entity(model, id).note} leader={false} />
      ))}
      <Label entity="folder" at={[ROW_X0 + 70, 116]} dx={0} dy={0} anchor="start" sub={entity(model, "folder").note} dot={false} leader={false} />
      <Label entity="judge" at={[24, JUDGE_Y - 4]} dx={0} dy={0} anchor="start" sub={entity(model, "judge").note} dot={false} leader={false} />
      <Label entity="verdict" at={[24, VERDICT_Y - 4]} dx={0} dy={0} anchor="start" sub={entity(model, "verdict").note} dot={false} leader={false} />
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
