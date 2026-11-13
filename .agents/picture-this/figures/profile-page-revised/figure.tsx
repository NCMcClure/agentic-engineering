"use client";
// profile-page-revised: the writing profile drawn as the page it is, one bar
// per line against its line budget, and the loop that changes one of those
// lines: a remark in this session, logged by the prompt hook, waiting in
// observations.jsonl until the turn ends, read by the Stop hook, and folded
// in by the helper that hook has Claude fork. The next session starts with
// the line already loaded.
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import { Bar, Panel } from "../kit/flat/panel";
import { ease, indexOf, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 504 };

// The budget is profile-budget.mjs's BUDGET; the line count is the model's quantity.
const BUDGET = 60;
const LINES = (model.quantities?.find((q) => q.id === "lines")?.start as number) ?? 52;

// The profile's shape: a title, then the four sections refine-profile.md names.
type Row = { kind: "title" | "blank" | "head" | "line"; name?: string };
const SECTIONS: [string, number][] = [["Voice", 10], ["Rhythm", 9], ["Vocabulary", 10], ["Formatting", 0]];
const PAGE: Row[] = (() => {
  const rows: Row[] = [{ kind: "title" }];
  for (const [name, n] of SECTIONS) {
    rows.push({ kind: "blank" }, { kind: "head", name });
    for (let i = 0; i < n; i++) rows.push({ kind: "line" });
  }
  while (rows.length < LINES) rows.push({ kind: "line" });
  return rows;
})();
const REVISED = 6; // a line under Voice
const NEW_LINE = '- Contractions always; "do not" only for emphasis.'; // refine-profile.md's own example
const SHORT_LINE = '- Contractions always; …';

// Layout, in px.
const SESSION = { x: 16, y: 44, width: 184, height: 340 };
const COL = { x: 224, width: 140 };
const HOOK = { x: COL.x, y: 72, width: COL.width, height: 28 };
const LEDGER = { x: COL.x, y: 136, width: COL.width, height: 66 };
const SLIP = { x: COL.x + 8, y: 170, width: COL.width - 16, height: 22 };
const STOP = { x: COL.x, y: 286, width: COL.width, height: 28 };
const HELPER = { x: COL.x, y: 336, width: COL.width, height: 44 };
const PAGE_BOX = { x: 392, y: 44, width: 352, height: 314 };
const LOG = { x: 392, y: 370, width: 300, height: 80 };
const NEXT = { x: 16, y: 460, width: 348, height: 32 };
const PITCH = 4.6;
const LINE0 = PAGE_BOX.y + 16;
const lineY = (i: number) => LINE0 + i * PITCH;
const RULE_Y = lineY(BUDGET);
const BUBBLE = { x: 64, y: 74, width: 128, height: 26 };
const TURN_Y = STOP.y + STOP.height / 2;
const LOAD_X = 718;
// A line's width on the page: fixed per line, so the page reads as written text.
const widthOf = (i: number) => 130 + ((i * 53) % 13) * 9; // ends short of the section names
const REPLY = [150, 132, 158, 96];

const r = (v: number) => Math.round(v * 100) / 100;
const onPanel = { ["--pt-halo" as string]: "var(--pt-top)" };
const flatText = { ["--pt-halo" as string]: "transparent", fill: "var(--pt-ink)" };

function frameInk(lit: number, accent: number) {
  const ink = mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * lit);
  return accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink;
}

function Box({ box, title, lit = 1, accent = 0, dashed = false }: {
  box: { x: number; y: number; width: number; height: number }; title: string; lit?: number; accent?: number; dashed?: boolean;
}) {
  return (
    <g opacity={r(0.55 + 0.45 * lit)}>
      <rect className="pt-panel" x={box.x} y={box.y} width={box.width} height={box.height} rx={6}
        style={{ stroke: frameInk(lit, accent), strokeWidth: accent > 0.5 ? 1.5 : 1, strokeDasharray: dashed ? "4 3" : undefined }} />
      {title ? <text className="pt-label" x={box.x + box.width / 2} y={box.y + box.height / 2 + 4} textAnchor="middle" style={onPanel}>{title}</text> : null}
    </g>
  );
}

/** A tinted strip that holds one line of words: the remark, the new line, a changelog row. */
function Strip({ x, y, width, accent = 0, marked = 0 }: { x: number; y: number; width: number; accent?: number; marked?: number }) {
  const fill = accent > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", Math.max(accent, 0.7 * marked))
    : marked > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", 0.7 * marked) : "var(--pt-top)";
  return <rect x={x} y={y} width={width} height={16} rx={2}
    style={{ fill, stroke: accent > 0 ? mix("var(--pt-accent)", "transparent", accent) : "none", strokeWidth: 1.25 }} />;
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  /** 0 before the beat, its progress p in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const arrive = (id: string, a = 0, b = 0.3) => ease.out(span(through(id), a, b));
  const resting = f.frame.beat.rest ? 1 : 0;

  // A wire is laid in the beat that tells it (the path to the Stop hook is there
  // from the start), and only the beat's leading wire carries a pulse.
  const toldIn: Record<string, string> = { revise: "revise", log: "revise", clear: "clear", load: "load" };
  const leads: Record<string, boolean> = { say: true, record: true, check: true, spawn: true, revise: true, clear: true, load: true };
  const wire = (id: string) => ({
    progress: toldIn[id] ? arrive(toldIn[id]) : f.laid(id),
    pulse: f.moving(id) > 0 && leads[id] ? ease.out(span(p, 0.05, 0.4)) : undefined,
    lit: Math.max(f.moving(id), resting, 0.15),
  });

  // The remark: said, then a slip in the ledger while it waits.
  const waiting = f.level("waiting");
  const said = f.on("say");
  const slipAccent = f.on("record");
  const slipMarked = f.on("check", "fork", "revise");

  const reply = ease.out(span(through("record"), 0.1, 0.45));
  const turnEnd = arrive("check");

  // The helper slides out from under the Stop hook, carrying the conversation.
  const born = ease.out(span(through("fork"), 0, 0.38));
  const helperShift = lerp(STOP.y - HELPER.y, 0, born);
  const helperLit = f.lit("helper");

  // The revision: the old bar is struck and goes, the new wording is written in.
  const rv = through("revise");
  const strike = ease.out(span(rv, 0.04, 0.16));
  const oldGone = ease.out(span(rv, 0.14, 0.22));
  const typed = Math.round(NEW_LINE.length * span(rv, 0.18, 0.4));
  const lineAccent = f.on("revise");
  const lineMarked = rv >= 1 ? 1 : 0;
  const logHere = arrive("revise", 0.22, 0.4);
  const counted = arrive("revise", 0.3, 0.42);

  const report = arrive("clear", 0.15, 0.4);
  const next = ease.out(span(through("load"), 0.2, 0.4));
  const nextAccent = f.on("load");

  const pageLit = Math.max(f.lit("profile"), 0.35);
  const logLit = f.lit("changelog");

  return (
    <g opacity={f.present}>
      {/* This session */}
      <text className="pt-label" x={SESSION.x} y={SESSION.y - 10}>This session</text>
      <Panel box={SESSION} lit={Math.max(f.lit("you"), 0.4)}>
        <text className="pt-label" x={BUBBLE.x + BUBBLE.width} y={BUBBLE.y - 8} textAnchor="end">You</text>
        <rect className="pt-panel" x={BUBBLE.x} y={BUBBLE.y} width={BUBBLE.width} height={BUBBLE.height} rx={12}
          style={{ stroke: said > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", said) : "var(--pt-line-2)", strokeWidth: said > 0.5 ? 1.5 : 1 }} />
        <text className="pt-tag" x={BUBBLE.x + BUBBLE.width / 2} y={BUBBLE.y + 17} textAnchor="middle"
          style={{ fill: said > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>"too formal"</text>
        {reply > 0 ? (
          <g opacity={r(reply)}>
            <text className="pt-label" x={SESSION.x + 10} y={124}>Claude</text>
            {REPLY.map((w, i) => (
              <Bar key={i} box={{ x: SESSION.x + 10, y: 134 + i * 9, width: w, height: 4 }} tone="quiet" here={reply} grow="left" />
            ))}
          </g>
        ) : null}
        {turnEnd > 0 ? <text className="pt-tag" x={SESSION.x + 10} y={TURN_Y - 8} opacity={r(turnEnd)}>turn ends</text> : null}
        {/* Forked: the helper starts with every message above, not only the logged remark. */}
        {born > 0 && report <= 0 ? (
          <g opacity={r(born * (0.55 + 0.45 * Math.max(helperLit, f.lit("profile"))))}>
            <text className="pt-label" x={SESSION.x + 10} y={330}>Forked from here</text>
            <text className="pt-tag" x={SESSION.x + 10} y={346}>the helper has every</text>
            <text className="pt-tag" x={SESSION.x + 10} y={360}>message above</text>
          </g>
        ) : null}
        {/* What the person is shown: the helper's report closes the session. */}
        {report > 0 ? (
          <g opacity={r(report * (0.55 + 0.45 * Math.max(f.lit("ledger"), resting)))}>
            <text className="pt-label" x={SESSION.x + 10} y={330}>Helper's report</text>
            <text className="pt-tag" x={SESSION.x + 10} y={346}>1 line revised:</text>
            <text className="pt-tag" x={SESSION.x + 10} y={360}>old and new, quoted</text>
          </g>
        ) : null}
      </Panel>
      <Line from={[SESSION.x, TURN_Y]} to={[STOP.x, TURN_Y]} progress={turnEnd} dashed />

      {/* The remark's path: prompt hook, ledger, Stop hook */}
      <Elbow from={[BUBBLE.x + BUBBLE.width, BUBBLE.y + BUBBLE.height / 2]} to={[HOOK.x, HOOK.y + HOOK.height / 2 - 1]} {...wire("say")} />
      <Box box={HOOK} title="Prompt hook" lit={f.lit("listener")} />

      <Elbow from={[HOOK.x + 40, HOOK.y + HOOK.height]} to={[LEDGER.x + 40, LEDGER.y]} first="v" {...wire("record")} />
      <text className="pt-tag" x={HOOK.x + 48} y={124} opacity={r(Math.max(f.lit("ledger"), 0.5))}>append</text>

      <Box box={LEDGER} title="" lit={f.lit("ledger")} accent={f.on("clear")} dashed={waiting <= 0.02} />
      <text className="pt-tag" x={LEDGER.x + 10} y={LEDGER.y + 18} style={onPanel} opacity={r(0.55 + 0.45 * f.lit("ledger"))}>observations.jsonl</text>
      {waiting > 0.02 ? (
        <g opacity={r(Math.min(1, waiting))}>
          <rect x={SLIP.x} y={SLIP.y} width={SLIP.width} height={SLIP.height} rx={3}
            style={{
              fill: slipAccent > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", slipAccent) : slipMarked > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", 0.6 * slipMarked) : "var(--pt-top)",
              stroke: slipAccent > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", slipAccent) : "var(--pt-line-2)",
              strokeWidth: slipAccent > 0.5 ? 1.5 : 1,
            }} />
          <text className="pt-tag" x={SLIP.x + 8} y={SLIP.y + 15} style={flatText}>tone · too formal</text>
        </g>
      ) : null}

      <Elbow from={[LEDGER.x + 40, LEDGER.y + LEDGER.height]} to={[STOP.x + 40, STOP.y]} first="v" dashed {...wire("check")} />
      <g opacity={r(Math.max(f.lit("stop"), 0.5))}>
        <text className="pt-tag" x={LEDGER.x + 48} y={240}>{waiting >= 0.5 ? "1 waiting," : "nothing"}</text>
        <text className="pt-tag" x={LEDGER.x + 48} y={253}>{waiting >= 0.5 ? "not folded in" : "waiting"}</text>
      </g>
      <Box box={STOP} title="Stop hook" lit={f.lit("stop")} accent={f.on("check")} />

      {/* The helper: forked, so it carries the conversation as well as the remark */}
      {born > 0 ? (
        <g>
          <Elbow from={[STOP.x + 40, STOP.y + STOP.height]} to={[HELPER.x + 40, HELPER.y + helperShift]} first="v" {...wire("spawn")} progress={born} />
          <g transform={`translate(0 ${r(helperShift)})`} opacity={r(born * (0.55 + 0.45 * helperLit))}>
            <rect className="pt-panel" x={HELPER.x} y={HELPER.y} width={HELPER.width} height={HELPER.height} rx={6}
              style={{ stroke: frameInk(helperLit, f.on("fork")), strokeWidth: f.on("fork") > 0.5 ? 1.5 : 1 }} />
            {/* The conversation it was forked with, in small: the same bubble and reply as this session */}
            <rect x={HELPER.x + 18} y={HELPER.y + 9} width={22} height={7} rx={3.5} style={{ fill: "none", stroke: "var(--pt-line-2)" }} />
            {REPLY.map((w, i) => (
              <Bar key={i} box={{ x: HELPER.x + 8, y: HELPER.y + 21 + i * 4, width: w / 5, height: 1.8 }} tone="quiet" />
            ))}
            <text className="pt-label" x={HELPER.x + 93} y={HELPER.y + 18} textAnchor="middle" style={onPanel}>Forked</text>
            <text className="pt-label" x={HELPER.x + 93} y={HELPER.y + 31} textAnchor="middle" style={onPanel}>helper</text>
          </g>
          <text className="pt-tag" x={HELPER.x + 48} y={329} opacity={r(span(born, 0.85, 1) * Math.max(helperLit, 0.5))}>fork</text>
        </g>
      ) : null}

      {/* From the helper: one line of the page, the changelog, and the ledger deleted */}
      <Elbow from={[HELPER.x + HELPER.width, HELPER.y + 12]} to={[PAGE_BOX.x + 8, lineY(REVISED) + 1]} via={378} {...wire("revise")} />
      <Elbow from={[HELPER.x + HELPER.width, HELPER.y + 32]} to={[LOG.x, LOG.y + 40]} via={384} {...wire("log")} />
      <Elbow from={[HELPER.x, HELPER.y + 22]} to={[LEDGER.x, SLIP.y + SLIP.height / 2]} via={210} {...wire("clear")} />
      <g opacity={r(arrive("clear") * Math.max(f.lit("ledger"), 0.5))}>
        <text className="pt-tag" x={196} y={226} textAnchor="end">the helper</text>
        <text className="pt-tag" x={196} y={239} textAnchor="end">deletes it</text>
      </g>

      {/* The profile, as a page */}
      <text className="pt-label" x={PAGE_BOX.x} y={PAGE_BOX.y - 10}>Profile</text>
      <text className="pt-tag" x={PAGE_BOX.x + PAGE_BOX.width} y={PAGE_BOX.y - 10} textAnchor="end">~/.claude/rules/write-like-me.md</text>
      <Panel box={PAGE_BOX} lit={pageLit}>
        {PAGE.map((row, i) => {
          const y = lineY(i);
          if (row.kind === "blank" || i === REVISED) return null;
          if (row.kind === "title") return <Bar key={i} box={{ x: PAGE_BOX.x + 12, y, width: 92, height: 2.6 }} tone="strong" />;
          if (row.kind === "head") return <Bar key={i} box={{ x: PAGE_BOX.x + 12, y, width: 48, height: 2.6 }} tone="strong" />;
          return <Bar key={i} box={{ x: PAGE_BOX.x + 12, y, width: widthOf(i), height: 2.2 }} tone="quiet" />;
        })}
        {PAGE.map((row, i) => row.kind === "head" ? (
          <text key={`h${i}`} className="pt-label" x={PAGE_BOX.x + PAGE_BOX.width - 12} y={lineY(i) + 5} textAnchor="end">{row.name}</text>
        ) : null)}
        {/* The budget: 60 lines, where the page stands against it, and what happens past it */}
        <text className="pt-tag" x={PAGE_BOX.x + 12} y={RULE_Y - 8}
          style={{ fill: counted > 0.5 && f.on("revise") > 0.5 ? "var(--pt-ink)" : undefined }}>
          {counted > 0 ? `${LINES} lines → ${Math.round(f.level("lines"))}: revised, not added` : `${LINES}/${BUDGET} lines — OK`}
        </text>
        <line className="pt-guide" x1={PAGE_BOX.x + 8} x2={PAGE_BOX.x + PAGE_BOX.width - 8} y1={RULE_Y} y2={RULE_Y} />
        <text className="pt-tag" x={PAGE_BOX.x + PAGE_BOX.width - 12} y={RULE_Y - 8} textAnchor="end">budget {BUDGET}</text>
        <text className="pt-tag" x={PAGE_BOX.x + PAGE_BOX.width - 12} y={RULE_Y + 13} textAnchor="end">past it: merge or evict a line</text>
      </Panel>
      {/* The one line that changes, drawn over the page so its words are never clipped */}
      <g opacity={r(0.55 + 0.45 * pageLit)}>
        {oldGone < 1 ? (
          <g opacity={r(1 - oldGone)}>
            <Bar box={{ x: PAGE_BOX.x + 12, y: lineY(REVISED), width: widthOf(REVISED), height: 2.2 }} tone="mid" />
            {strike > 0 ? <line x1={PAGE_BOX.x + 8} x2={r(PAGE_BOX.x + 8 + (widthOf(REVISED) + 8) * strike)} y1={lineY(REVISED) + 1.1} y2={lineY(REVISED) + 1.1}
              style={{ stroke: "var(--pt-accent)", strokeWidth: 1.5 }} /> : null}
          </g>
        ) : null}
        {typed > 0 ? (
          <g>
            <Strip x={PAGE_BOX.x + 6} y={lineY(REVISED) - 7} width={PAGE_BOX.width - 12} accent={lineAccent} marked={lineMarked} />
            <text className="pt-tag" x={PAGE_BOX.x + 12} y={lineY(REVISED) + 4.5}
              style={{ ...flatText, fill: lineAccent > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>{NEW_LINE.slice(0, typed)}</text>
          </g>
        ) : null}
      </g>

      {/* changelog.md: what makes an auto-applied edit reversible */}
      <Box box={LOG} title="" lit={logLit} />
      <g opacity={r(0.55 + 0.45 * logLit)}>
        <text className="pt-tag" x={LOG.x + 10} y={LOG.y + 16} style={onPanel}>changelog.md</text>
        <text className="pt-tag" x={LOG.x + LOG.width - 10} y={LOG.y + 16} textAnchor="end" style={onPanel}>undo: /write-like-me:review</text>
      </g>
      {logHere > 0 ? (
        <g opacity={r(logHere * (0.55 + 0.45 * logLit))}>
          <Strip x={LOG.x + 6} y={LOG.y + 24} width={LOG.width - 12} marked={1} />
          <Strip x={LOG.x + 6} y={LOG.y + 40} width={LOG.width - 12} marked={1} />
          <Strip x={LOG.x + 6} y={LOG.y + 56} width={LOG.width - 12} marked={1} />
          <text className="pt-tag" x={LOG.x + 12} y={LOG.y + 35} style={flatText}>## (auto)   old:</text>
          <Bar box={{ x: LOG.x + 128, y: LOG.y + 30, width: 90, height: 2.2 }} tone="mid" />
          <text className="pt-tag" x={LOG.x + 12} y={LOG.y + 51} style={flatText}>new: "Contractions always; …"</text>
          <text className="pt-tag" x={LOG.x + 12} y={LOG.y + 67} style={flatText}>(from: "too formal")</text>
        </g>
      ) : null}

      {/* The next session: it starts with the profile loaded, the new line in it */}
      <Elbow from={[LOAD_X, PAGE_BOX.y + PAGE_BOX.height]} to={[NEXT.x + NEXT.width, NEXT.y + NEXT.height / 2]} first="v" via={NEXT.y + NEXT.height / 2} dashed {...wire("load")} />
      {f.laid("load") > 0 && arrive("load") > 0 ? (
        <text className="pt-tag" x={560} y={NEXT.y + NEXT.height / 2 - 6} opacity={r(arrive("load") * Math.max(f.lit("later"), 0.5))}>loads at start</text>
      ) : null}
      {next > 0 ? (
        <g opacity={r(next * (0.55 + 0.45 * f.lit("later")))}>
          <rect className="pt-panel" x={NEXT.x} y={NEXT.y} width={NEXT.width} height={NEXT.height} rx={6} style={{ stroke: frameInk(f.lit("later"), 0) }} />
          <text className="pt-label" x={NEXT.x + 10} y={NEXT.y + 20} style={onPanel}>Next session</text>
          <Strip x={NEXT.x + 112} y={NEXT.y + 8} width={NEXT.width - 120} accent={nextAccent} marked={1} />
          <text className="pt-tag" x={NEXT.x + 118} y={NEXT.y + 19.5}
            style={{ ...flatText, fill: nextAccent > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>{SHORT_LINE}</text>
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
