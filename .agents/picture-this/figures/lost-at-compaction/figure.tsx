"use client";
// lost-at-compaction: the model's window drawn twice, as what it held at the
// start of each segment: once at startup, once after the compaction. The
// same hook stands over both, and its matcher decides which start it reaches.
// Under them the transcript, as a tape of entries, and what the lens prints
// from it. Every slab, status and number is the model's, read from a real
// `context-lens.mjs report` and `diagnose` on a transcript of this session.
import type { Model, Row } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, arrow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { P2 } from "../kit/flat/geometry";
import { Bar, Panel } from "../kit/flat/panel";
import { heading, line, slice, smooth } from "../kit/iso/project";
import { ease, indexOf, lerp, span, steps } from "../kit/timeline";
import data from "./model.json";

const model = data as unknown as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 442 };

const rows = (name: string) => ((model.data?.[name] ?? []) as Row[]);
const REQUESTS = rows("requests");
const STANDING = rows("standing");
const RULES = rows("rules");
const MATCHER = String(rows("matcher").find((m) => m.id === "has")?.text ?? "");
const ADDED = String(rows("matcher").find((m) => m.id === "fixed")?.text ?? "").slice(MATCHER.length);
const BOUNDARY = rows("report").find((x) => x.id === "boundary");
const FINDING = rows("finding")[0];
const PEAK = Math.max(...REQUESTS.map((q) => Number(q.tokens)));
const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A line cut at a word, with a mark that it goes on. */
const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, text.lastIndexOf(" ", n - 1)).replace(/[,.:]$/, "")}…` : text);
const plain = (text: string) => text.replace(/`/g, "");

// Layout, in px.
const RAIL = 22, TOP = 10; // the fix runs up the left margin and along the top
const HOOK = { x: 262, y: 28, width: 236, height: 58 };
const ONE = { x: 36, y: 118, width: 280, height: 212 };
const TWO = { x: 444, y: 118, width: 280, height: 212 };
const SLAB = 17, RULED = 44, PITCH = 21;
const ROW = ONE.y + 29; // the first slab's top
const RULES_Y = ROW + 2 * PITCH; // the rules' row, the same in both windows
const BAR_SCALE = 186; // px for the largest request
const MONO = 6.27; // a tag's character, in px
const ADD_X = HOOK.x + 12 + (MATCHER.length + 1) * MONO + 2; // where the matcher's missing word goes
const TAPE = { x: 36, y: 354, width: 688, height: 24 };
const TAPE_Y = TAPE.y + TAPE.height / 2;
const markX = (i: number) => (i < 6 ? ONE.x + 60 + i * 36 : TWO.x + 60 + (i - 6) * 36);
const LENS_Y = 402;
const FIX_ROUTE: P2[] = smooth([[TAPE.x + 8, LENS_Y + 29.5], [RAIL, LENS_Y + 29.5], [RAIL, TOP], [ADD_X + 27, TOP], [ADD_X + 27, HOOK.y - 1]], 6);

const r = (v: number) => Math.round(v * 100) / 100;
const INK = { fill: "var(--pt-ink)" };
const HOT = { fill: "var(--pt-accent-ink)" };
const QUIET = { fill: "var(--pt-ink-2)" }; // words the story is not on: quieter than ink, still 4.5:1
const FLAT = { ["--pt-halo" as string]: "transparent" };
const FACE = mix("var(--pt-ink)", "var(--pt-top)", 0.09); // a slab: one piece of standing context
const CHIP = mix("var(--pt-ink)", "var(--pt-top)", 0.17);

/**
 * One piece of standing context in a window: a slab when it is there, a
 * dashed place when it is not. `accent` is the beat being about it, `marked`
 * the tint the lens leaves, `said` how much of its words are written.
 */
function Slab({ box, y, height = SLAB, label, status, here = 1, accent = 0, marked = 0, missing = false, said = 1, hot = false, strong = false, children }: {
  box: typeof ONE; y: number; height?: number; label: string; status?: string; here?: number; accent?: number; marked?: number;
  missing?: boolean; said?: number; hot?: boolean; strong?: boolean; children?: React.ReactNode;
}) {
  if (here <= 0) return null;
  const base = missing ? "var(--pt-top)" : FACE;
  return (
    <g opacity={r(here)}>
      <rect x={box.x + 12} y={y} width={box.width - 24} height={height} rx={3}
        style={{
          // Tinted where the lens marked it; while the beat is about it the face clears, so a word in the accent reads on it.
          fill: marked > 0 ? mix("var(--pt-accent-soft)", base, marked) : base,
          stroke: accent > 0 ? mix("var(--pt-accent)", missing ? "var(--pt-ink-3)" : "transparent", accent) : missing ? "var(--pt-ink-3)" : "none",
          strokeWidth: accent > 0.5 ? 1.25 : 1, strokeDasharray: missing ? "5 4" : undefined,
        }} />
      {said > 0 ? (
        <g opacity={r(said)}>
          <text className="pt-tag" x={box.x + 20} y={y + 12} style={{ ...FLAT, ...INK }}>{label}</text>
          {status ? <text className="pt-tag" x={box.x + box.width - 20} y={y + 12} textAnchor="end" style={{ ...FLAT, ...(hot ? HOT : strong ? INK : {}) }}>{status}</text> : null}
          {children}
        </g>
      ) : null}
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  /** 0 before the beat, its progress in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const within = (id: string, a: number, b: number) => (index === at(id) && p > a && p < b ? span(p, a, b) : undefined);
  const resting = Boolean(f.frame.beat.rest);

  const s = through("start"), c = through("compact"), q = through("silent"), l = through("read"), d = through("finding");
  // How many requests have gone out, and how far the newest has got.
  const second = steps(c, 5, 0.02, 0.26), third = steps(q, 3, 0.06, 0.36);
  const sent = s < 0.32 ? 0 : c <= 0.02 ? 1 : c < 0.26 ? 2 + second.index : q <= 0.06 ? 6 : 6 + Math.min(3, third.index + 1);
  const growing = s < 0.32 ? 0 : c <= 0.02 ? ease.out(span(s, 0.32, 0.44)) : c < 0.26 ? ease.out(second.t) : q <= 0.06 ? 1 : ease.out(third.t);

  const startOn = f.on("start"), compactOn = f.on("compact"), silentOn = f.on("silent"), readOn = f.on("read"), findingOn = f.on("finding");

  // Segment 1: the hook's line reaches it, and the rules land.
  const ruled = ease.out(span(s, 0.12, 0.26));
  // The compaction: the second window opens with what came across, and the hook's line to it stops short.
  const crossing = span(c, 0.28, 0.4);
  const opened = ease.out(span(c, 0.32, 0.42));
  const missed = span(c, 0.34, 0.46);
  // Segment 1 is behind the story once the window has been compacted.
  const behind = resting ? 0 : index > at("compact") ? 1 : ease.out(span(c, 0.4, 0.5));
  const lit = 1 - 0.65 * behind;

  // The lens: along the tape, then a status on each slab of segment 2, in the order it lists them.
  const scan = within("read", 0.04, 0.24);
  const named = steps(l, 4, 0.2, 0.44);
  const status = (i: number) => (l <= 0.2 ? 0 : named.index > i ? 1 : named.index === i ? ease.out(named.t) : 0);
  const marked = ease.out(span(l, 0.08, 0.18));
  const before = index < at("read");

  // The finding, a line at a time, and its fix reaching the matcher.
  const line1 = ease.out(span(d, 0.04, 0.14)), line2 = ease.out(span(d, 0.16, 0.26));
  const fixLaid = span(d, 0.24, 0.42);
  const added = ease.out(span(d, 0.4, 0.47));
  const fixLine = fixLaid >= 1 ? FIX_ROUTE : slice(FIX_ROUTE, 0, fixLaid);
  const fixInk = findingOn > 0 ? mix("var(--pt-accent)", "var(--pt-line)", findingOn) : "var(--pt-line)";
  const fixPulse = within("finding", 0.46, 0.94) !== undefined ? f.phase(2) : undefined;

  const requestsOf = (segment: number) => REQUESTS.map((req, i) => ({ req, i })).filter(({ req, i }) => Number(req.segment) === segment && i < sent);
  const standing = (segment: number) => STANDING.map((row, order) => ({ row, order })).filter(({ row }) => Number(row.segment) === segment);
  // The rules keep their row in both windows, so the place they left is beside where they were.
  const slabTop = (rowsOf: { row: Row }[], k: number) => {
    const sorted = [...rowsOf].sort((a, b) => Number(b.row.of === "context") - Number(a.row.of === "context"));
    const fixed = rowsOf.filter((x) => x.row.of !== "context");
    const item = rowsOf[k];
    if (item.row.of === "context") return RULES_Y;
    const n = fixed.indexOf(item);
    return n < 2 ? ROW + n * PITCH : RULES_Y + RULED + 4 + (n - 2) * PITCH + (sorted.length ? 0 : 0);
  };
  const tapeTo = c > 0.3 ? ONE.x + ONE.width + 6 : lerp(sent > 1 ? markX(Math.min(sent, 6) - 2) : ONE.x + 36, markX(Math.max(1, Math.min(sent, 6)) - 1), growing);

  return (
    <g opacity={r(f.present)}>
      {/* The hook: one matcher, two starts */}
      <Panel box={HOOK} accent={startOn}>
        <text className="pt-label" x={HOOK.x + 12} y={HOOK.y + 18} style={startOn > 0.5 ? HOT : undefined}>SessionStart hook</text>
        <text className="pt-tag" x={HOOK.x + HOOK.width - 12} y={HOOK.y + 18} textAnchor="end">team-rules</text>
        <text className="pt-tag" x={HOOK.x + 12} y={HOOK.y + 34}>"matcher":</text>
        <text className="pt-tag" x={HOOK.x + 12} y={HOOK.y + 48} style={INK}>"{MATCHER}</text>
        {added > 0 ? <rect x={ADD_X} y={HOOK.y + 38} width={54} height={14} rx={3} opacity={r(added)} style={{ fill: "var(--pt-top)", stroke: "var(--pt-accent)", strokeWidth: 1, strokeDasharray: "4 3" }} /> : null}
        {added > 0 ? <text className="pt-tag" x={ADD_X + 3} y={HOOK.y + 48} opacity={r(added)} style={{ ...FLAT, ...HOT }}>{ADDED}</text> : null}
        <text className="pt-tag" x={r(ADD_X - 2 + added * 59)} y={HOOK.y + 48} style={INK}>"</text>
      </Panel>
      <Elbow from={[HOOK.x, HOOK.y + 40]} to={[ONE.x + 140, ONE.y]} via={ONE.x + 140} accent={startOn} lit={lit} pulse={within("start", 0.02, 0.18)} pulseLength={0.3} />
      <text className="pt-tag" x={HOOK.x - 14} y={HOOK.y + 34} textAnchor="end" style={behind > 0.5 ? undefined : INK}>startup: it runs</text>
      {missed > 0 ? <Elbow from={[HOOK.x + HOOK.width, HOOK.y + 40]} to={[TWO.x + 140, TWO.y - 20]} via={TWO.x + 140} dashed quiet head={false} progress={missed} /> : null}
      {missed > 0 ? <text className="pt-tag" x={HOOK.x + HOOK.width + 14} y={HOOK.y + 34} opacity={r(ease.out(missed))} style={INK}>compact: no match</text> : null}

      {/* Segment 1: what the window held at startup */}
      <Panel box={ONE} lit={lit}>
        <text className="pt-label" x={ONE.x + 12} y={ONE.y + 16} style={behind > 0.5 ? QUIET : undefined}>Model's window</text>
        <text className="pt-tag" x={ONE.x + ONE.width - 12} y={ONE.y + 16} textAnchor="end">segment 1: startup</text>
        <line className="pt-rule" x1={ONE.x} x2={ONE.x + ONE.width} y1={ONE.y + 23} y2={ONE.y + 23} />
        {standing(1).map(({ row }, k, all) => {
          const rules = row.of === "context";
          return (
            <Slab key={String(row.id)} box={ONE} y={slabTop(all, k)} height={rules ? RULED : SLAB} label={String(row.label)} status={row.size ? `${String(row.size)} tokens` : undefined}
              here={rules ? ruled : 1} accent={rules ? startOn : 0} marked={rules ? Math.max(startOn, marked) : 0}>
              {rules ? RULES.slice(1, 3).map((rule, i) => (
                <text key={String(rule.id)} className="pt-label-sub" x={ONE.x + 20} y={RULES_Y + 25.5 + i * 12.5} style={{ fontSize: 10.5 }}>{cut(String(rule.text), 44)}</text>
              )) : null}
            </Slab>
          );
        })}
        {sent > 0 ? <text className="pt-tag" x={ONE.x + 12} y={RULES_Y + RULED + 15} style={FLAT}>then each request, in tokens</text> : null}
        {requestsOf(1).map(({ req, i }) => {
          const here = i === sent - 1 ? growing : 1;
          const width = (BAR_SCALE * Number(req.tokens)) / PEAK;
          const y = RULES_Y + RULED + 22 + i * 11.5;
          return (
            <g key={String(req.id)}>
              <Bar box={{ x: ONE.x + 12, y, width, height: 7 }} tone={behind > 0.5 ? "quiet" : "mid"} here={here} grow="left" radius={2} />
              <text className="pt-num" x={r(ONE.x + 12 + width * here + 6)} y={y + 7} opacity={r(Math.min(1, here * 1.5))}>{num(Number(req.tokens))}</text>
            </g>
          );
        })}
      </Panel>

      {/* The compaction, between the two, at the rules' row */}
      {crossing > 0 ? (
        <g>
          <Elbow from={[ONE.x + ONE.width, RULES_Y + RULED / 2]} to={[TWO.x, RULES_Y + RULED / 2]} progress={crossing} accent={compactOn} pulse={within("compact", 0.4, 0.94) !== undefined ? f.phase(2) : undefined} pulseLength={0.3} />
          <text className="pt-label" x={(ONE.x + ONE.width + TWO.x) / 2} y={RULES_Y + RULED / 2 - 12} textAnchor="middle" opacity={r(ease.out(crossing))} style={compactOn > 0.5 ? HOT : undefined}>Compaction</text>
          <text className="pt-tag" x={(ONE.x + ONE.width + TWO.x) / 2} y={RULES_Y + RULED / 2 + 19} textAnchor="middle" opacity={r(ease.out(crossing))}>{String(BOUNDARY?.text).replace(/^Compaction 1: auto, /, "").replace(/ tokens$/, "")}</text>
        </g>
      ) : null}

      {/* Segment 2: what the window held after it */}
      <Panel box={TWO} here={opened}>
        <text className="pt-label" x={TWO.x + 12} y={TWO.y + 16}>Model's window</text>
        <text className="pt-tag" x={TWO.x + TWO.width - 12} y={TWO.y + 16} textAnchor="end">segment 2: compact</text>
        <line className="pt-rule" x1={TWO.x} x2={TWO.x + TWO.width} y1={TWO.y + 23} y2={TWO.y + 23} />
        {standing(2).map(({ row }, k, all) => {
          const lost = row.status === "lost";
          const told = status(k);
          return (
            <Slab key={String(row.id)} box={TWO} y={slabTop(all, k)} height={lost ? RULED : SLAB} label={String(row.label)} status={told > 0 ? String(row.status) : undefined}
              missing={lost} said={lost ? told : 1} accent={lost ? Math.max(compactOn, readOn * told) : 0} marked={lost ? Math.max(compactOn, told * (1 - readOn)) : 0} hot={lost && readOn > 0.5} strong={lost} />
          );
        })}
        {sent > 6 ? <text className="pt-tag" x={TWO.x + 12} y={RULES_Y + RULED + PITCH + 15} style={FLAT}>then each request, in tokens</text> : null}
        {requestsOf(2).map(({ req, i }) => {
          const here = i === sent - 1 ? growing : 1;
          const width = (BAR_SCALE * Number(req.tokens)) / PEAK;
          const y = RULES_Y + RULED + PITCH + 22 + (i - 6) * 11.5;
          return (
            <g key={String(req.id)}>
              <Bar box={{ x: TWO.x + 12, y, width, height: 7 }} tone="mid" here={here} grow="left" radius={2} />
              <text className="pt-num" x={r(TWO.x + 12 + width * here + 6)} y={y + 7} opacity={r(Math.min(1, here * 1.5))}>{num(Number(req.tokens))}</text>
            </g>
          );
        })}
      </Panel>

      {/* Claude Code writes each request to the transcript */}
      <Elbow from={[ONE.x + 150, ONE.y + ONE.height]} to={[ONE.x + 150, TAPE.y]} first="v" quiet lit={lit} />
      {opened > 0 ? <g opacity={r(opened)}><Elbow from={[TWO.x + 78, TWO.y + TWO.height]} to={[TWO.x + 78, TAPE.y]} first="v" quiet={silentOn < 0.5} accent={silentOn} pulse={within("silent", 0.04, 0.4) !== undefined ? f.phase(3) : undefined} pulseLength={0.6} /></g> : null}

      {/* The transcript: every hook run and every request, in order */}
      <text className="pt-label" x={TAPE.x} y={TAPE.y - 7} style={silentOn > 0.5 ? HOT : undefined}>Session transcript</text>
      <text className="pt-tag" x={ONE.x + 164} y={TAPE.y - 7}>~/.claude/projects/&lt;slug&gt;/&lt;id&gt;.jsonl</text>
      <g>
        <circle cx={TAPE.x + TAPE.width - 174} cy={TAPE.y - 10.5} r={3.5} style={{ fill: "var(--pt-ink)" }} />
        <text className="pt-tag" x={TAPE.x + TAPE.width - 165} y={TAPE.y - 7}>with the rules</text>
        <circle cx={TAPE.x + TAPE.width - 58} cy={TAPE.y - 10.5} r={3.5} style={{ fill: "var(--pt-bg)", stroke: "var(--pt-ink-2)", strokeWidth: 1.25 }} />
        <text className="pt-tag" x={TAPE.x + TAPE.width - 49} y={TAPE.y - 7}>without</text>
      </g>
      <rect className="pt-lane" x={TAPE.x} y={TAPE.y} width={TAPE.width} height={TAPE.height} rx={6} style={silentOn > 0 ? { stroke: mix("var(--pt-accent)", "var(--pt-rule)", silentOn) } : undefined} />
      {/* The hook's run, at the start of segment 1 */}
      {ruled > 0 ? (
        <g opacity={r(ruled)}>
          <rect x={ONE.x + 6} y={TAPE.y + 5} width={36} height={TAPE.height - 10} rx={3}
            style={{ fill: marked > 0 ? mix("var(--pt-accent-soft)", CHIP, marked) : CHIP, stroke: startOn > 0 ? mix("var(--pt-accent)", "transparent", startOn) : "none", strokeWidth: 1.25 }} />
          <text className="pt-tag" x={ONE.x + 24} y={TAPE_Y + 3.5} textAnchor="middle" style={{ ...FLAT, ...INK }}>hook</text>
        </g>
      ) : null}
      {sent > 0 ? <line className="pt-edge" x1={ONE.x + 42} x2={r(tapeTo)} y1={TAPE_Y} y2={TAPE_Y} /> : null}
      {c > 0.3 ? (
        <g opacity={r(ease.out(span(c, 0.3, 0.4)))}>
          <rect x={ONE.x + ONE.width + 6} y={TAPE.y + 5} width={TWO.x - ONE.x - ONE.width - 12} height={TAPE.height - 10} rx={3} style={{ fill: CHIP }} />
          <text className="pt-tag" x={(ONE.x + ONE.width + TWO.x) / 2} y={TAPE_Y + 3.5} textAnchor="middle" style={{ ...FLAT, ...INK }}>compact_boundary</text>
        </g>
      ) : null}
      {/* Where the hook's run would stand at the start of segment 2: the lens finds none */}
      {status(3) > 0 ? <rect x={TWO.x + 6} y={TAPE.y + 5} width={36} height={TAPE.height - 10} rx={3} opacity={r(status(3))} style={{ fill: "var(--pt-accent-soft)", stroke: mix("var(--pt-accent)", "var(--pt-ink-3)", readOn), strokeWidth: 1, strokeDasharray: "4 3" }} /> : null}
      {sent > 6 ? <line className="pt-guide" x1={TWO.x + 46} x2={r(lerp(sent > 7 ? markX(sent - 2) : TWO.x + 46, markX(sent - 1), growing))} y1={TAPE_Y} y2={TAPE_Y} /> : null}
      {REQUESTS.slice(0, sent).map((req, i) => {
        const here = i === sent - 1 ? growing : 1;
        return Number(req.carried) === 1
          ? <circle key={String(req.id)} cx={markX(i)} cy={TAPE_Y} r={r(3.5 * here)} style={{ fill: "var(--pt-ink)", stroke: "var(--pt-top)", strokeWidth: 1.5 }} />
          : <circle key={String(req.id)} cx={markX(i)} cy={TAPE_Y} r={r(3.5 * here)} style={{ fill: "var(--pt-top)", stroke: "var(--pt-ink-2)", strokeWidth: 1.25 }} />;
      })}
      {scan !== undefined ? <rect x={r(lerp(ONE.x + 3, TWO.x + 3, ease.inOut(scan)))} y={TAPE.y - 3} width={42} height={TAPE.height + 6} rx={7} style={{ fill: "none", stroke: "var(--pt-accent)", strokeWidth: 1.5 }} /> : null}

      {/* The lens reads the tape, and prints what it found */}
      <Elbow from={[TAPE.x + 37, LENS_Y - 9]} to={[TAPE.x + 37, TAPE.y + TAPE.height + 1]} first="v" quiet={readOn < 0.5} lit={before ? 0 : 1} accent={readOn} pulse={within("read", 0.02, 0.24) !== undefined ? 1 - f.phase(2) : undefined} pulseLength={0.6} />
      <text className="pt-label" x={TAPE.x + 50} y={LENS_Y} style={readOn > 0.5 ? HOT : before ? QUIET : undefined}>The lens</text>
      <text className="pt-tag" x={TAPE.x + 124} y={LENS_Y} style={before ? QUIET : INK}>context-lens.mjs diagnose</text>
      <text className="pt-tag" x={TAPE.x + 290} y={LENS_Y} style={before ? QUIET : undefined}>{d > 0.04 ? String(FINDING.summary) : "compares what each segment carried at its start"}</text>
      {line1 > 0 ? (
        <g opacity={r(line1)}>
          <circle cx={TAPE.x + 4} cy={LENS_Y + 13.5} r={3.5} style={{ fill: findingOn > 0 ? mix("var(--pt-accent)", "var(--pt-ink-3)", findingOn) : "var(--pt-ink-3)" }} />
          <text className="pt-label" x={TAPE.x + 14} y={LENS_Y + 17} style={findingOn > 0.5 ? HOT : undefined}>{String(FINDING.level)} {String(FINDING.code)}</text>
          <text className="pt-tag" x={TAPE.x + 176} y={LENS_Y + 17} style={INK}>{String(FINDING.where)}</text>
        </g>
      ) : null}
      {line2 > 0 ? (
        <g opacity={r(line2)}>
          <text className="pt-tag" x={TAPE.x + 14} y={LENS_Y + 33} style={findingOn > 0.5 ? HOT : undefined}>fix</text>
          <text className="pt-tag" x={TAPE.x + 50} y={LENS_Y + 33} style={INK}>{plain(String(FINDING.fix))}</text>
        </g>
      ) : null}
      {/* The fix names the matcher: up the margin, and down onto the word it adds */}
      {fixLine.length > 1 ? (
        <g>
          <path className="pt-link" d={line(fixLine)} style={{ stroke: fixInk }} />
          <path className="pt-link-head" d={arrow(fixLine[fixLine.length - 1], heading(fixLine))} style={{ fill: fixInk, stroke: fixInk }} />
          {fixPulse !== undefined ? <path className="pt-pulse" d={line(slice(FIX_ROUTE, fixPulse * 1.08 - 0.08, fixPulse * 1.08))} /> : null}
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
