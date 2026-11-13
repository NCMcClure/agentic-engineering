"use client";
// three-buckets: the change on the left, one surface of the map in the middle
// as three buckets (Code, Pages, Shots), and what acts on the verdict on the
// right. A changed file is a chip; the bucket it lands in is the glob it
// matched. A surface with a full Code bucket and empty Pages and Shots buckets
// is PARITY_MISSING, and the agent is told before the turn ends.
import type { Model, Row } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, onElbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, indexOf, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 720, height: 420 };

// The changed files, from the model: which bucket each lands in, and in which beat.
const CHANGED = (model.data?.changed ?? []) as Row[];
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

// The layout, in px.
const TRAY: Box = { x: 14, y: 64, width: 172, height: 324 };
const CARD: Box = { x: 244, y: 40, width: 240, height: 348 };
const BX = CARD.x + 14, BW = CARD.width - 28;
const BUCKET: Record<string, Box> = {
  code: { x: BX, y: 76, width: BW, height: 84 },
  pages: { x: BX, y: 172, width: BW, height: 84 },
  shots: { x: BX, y: 268, width: BW, height: 108 },
};
const GLOB: Record<string, string> = { code: "src/export/**", pages: "docs/exporting.md", shots: "docs/images/export/**" };
const HUE: Record<string, string> = { code: "var(--pt-hue-blue)", pages: "var(--pt-hue-green)", shots: "var(--pt-hue-green)" };
const NAME: Record<string, string> = { code: "Code", pages: "Pages", shots: "Shots" };
const RIGHT_X = 532, RIGHT_W = 176;
const CHECK: Box = { x: RIGHT_X, y: 64, width: RIGHT_W, height: 92 };
const HOOK: Box = { x: RIGHT_X, y: 196, width: RIGHT_W, height: 62 };
const AGENT: Box = { x: RIGHT_X, y: 304, width: RIGHT_W, height: 60 };
const CHIP_H = 22;
const LANE = CARD.x + CARD.width + 24; // the lane the agent's edits come back along
const SHOT_DIR = "docs/images/export/";

/** Where chip k of a bucket sits once it has landed: under the glob, one below another. */
function slot(bucket: string, k: number): P2 {
  const b = BUCKET[bucket];
  return [b.x + 10, b.y + 48 + k * (CHIP_H + 4)];
}
const chipWidth = (label: string) => Math.round(label.length * 6.3 + 28);

function Chip({ at, label, hue, lit = 1, here = 1 }: { at: P2; label: string; hue: string; lit?: number; here?: number }) {
  if (here <= 0) return null;
  const w = chipWidth(label);
  return (
    <g opacity={here}>
      <rect x={at[0]} y={at[1]} width={w} height={CHIP_H} rx={4} style={{ fill: "var(--pt-top)", stroke: mix("var(--pt-line)", "var(--pt-line-2)", lit), strokeWidth: 1 }} />
      <circle cx={at[0] + 10} cy={at[1] + CHIP_H / 2} r={3} style={{ fill: hue }} />
      <text className="pt-tag" x={at[0] + 18} y={at[1] + CHIP_H / 2 + 3.5} style={{ stroke: "none", fill: "var(--pt-ink)" }}>{label}</text>
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const within = (id: string) => (index < at(id) ? 0 : index === at(id) ? p : 1);
  const cp = within("change"), fp = within("flagged"), tp = within("told"), pp = within("page-first"), sp = within("catch-up");

  // change: the code file is listed in the tray, then slides into the Code bucket.
  const codeLabel = String(CHANGED.find((r) => r.of === "code")!.label);
  const listed = span(cp, 0, 0.1);
  const codeSlide = ease.out(span(cp, 0.1, 0.4));
  const codeAt: P2 = [TRAY.x + 8 + (slot("code", 0)[0] - TRAY.x - 8) * codeSlide, slot("code", 0)[1]];

  // flagged: the hook runs the check; probes find nothing under Pages or Shots; the verdict is written.
  const runs = span(fp, 0.02, 0.14);
  const probe = span(fp, 0.12, 0.3);
  const flagLaid = span(fp, 0.28, 0.38);
  const missing = span(fp, 0.34, 0.42) * (1 - span(pp, 0.36, 0.44));
  // told: the finding goes back down to the hook, and on to the agent as a note.
  const findingsLaid = span(tp, 0.02, 0.16);
  const tellLaid = span(tp, 0.14, 0.32);
  // The hook's part is over once the agent has its note: its wires leave.
  const hookDone = 1 - span(pp, 0, 0.14);

  // page-first: the page rides in; the verdict drops to info. catch-up: the two shots ride in; clean.
  const docRows = CHANGED.filter((r) => r.of !== "code");
  const ride = (r: Row) => (r.of === "pages" ? ease.out(span(pp, 0.08, 0.36)) : ease.out(span(sp, 0.08, 0.36)));
  const reminder = span(pp, 0.36, 0.44) * (1 - span(sp, 0.36, 0.44));
  const clean = span(sp, 0.36, 0.44);
  const filled = (id: string) => (id === "code" ? codeSlide >= 0.5 : docRows.some((r) => r.of === id && ride(r) >= 1));
  const tint = (id: string) => (id === "code" ? 0 : span(fp, 0.24, 0.34) * (1 - (id === "pages" ? span(pp, 0.3, 0.4) : span(sp, 0.3, 0.4))));

  // The one accent of each beat.
  const accentOf: Record<string, number> = {
    surface: f.on("map"),
    code: f.on("change") * span(cp, 0.3, 0.42),
    checker: f.on("flagged") * missing,
    agent: f.on("told") * tellLaid,
    pages: f.on("page-first") * span(pp, 0.26, 0.38),
    shots: f.on("catch-up") * span(sp, 0.26, 0.38),
  };
  const lit = (id: string) => f.lit(id);

  return (
    <g opacity={f.present}>
      {/* The change: every file changed since HEAD, each row level with the bucket it matches. */}
      <text className="pt-label" x={TRAY.x} y={TRAY.y - 24}>This change</text>
      <text className="pt-tag" x={TRAY.x} y={TRAY.y - 10}>git diff --name-only HEAD</text>
      <rect className="pt-guide" x={TRAY.x} y={TRAY.y} width={TRAY.width} height={TRAY.height} rx={8} style={{ stroke: mix("var(--pt-ink-3)", "var(--pt-line-2)", lit("diff")) }} />
      {CHANGED.map((r, k) => {
        const id = String(r.of);
        const full = String(r.label);
        const nth = CHANGED.filter((o, j) => j < k && o.of === r.of).length;
        const y = slot(id, nth)[1] + CHIP_H / 2 + 3.5;
        const shown = id === "code" ? listed : span(ride(r), 0.85, 1);
        return shown > 0 ? (
          <g key={String(r.id)} opacity={shown}>
            <circle cx={TRAY.x + (id === "shots" ? 22 : 14)} cy={y - 3.5} r={3} style={{ fill: HUE[id] }} />
            <text className="pt-tag" x={TRAY.x + (id === "shots" ? 30 : 22)} y={y}>{id === "shots" ? base(full) : full}</text>
          </g>
        ) : null;
      })}
      {/* The two shots share a folder: written once above them, so each path is whole. */}
      {docRows.some((r) => r.of === "shots" && ride(r) > 0.85) ? (
        <text className="pt-tag" x={TRAY.x + 22} y={slot("shots", 0)[1] - 2} opacity={span(sp, 0.32, 0.36)}>{SHOT_DIR}</text>
      ) : null}

      {/* The surface: one card from the config, three buckets, each headed by its glob. */}
      <text className="pt-label" x={CARD.x} y={CARD.y - 22}>Surface: export</text>
      <text className="pt-tag" x={CARD.x} y={CARD.y - 8}>in .agents/docs-parity.json</text>
      <Panel box={CARD} radius={10} lit={lit("surface")} accent={accentOf.surface} />
      {(["code", "pages", "shots"] as const).map((id) => {
        const b = BUCKET[id];
        const marked = tint(id);
        const accent = accentOf[id];
        const ink = mix("var(--pt-line)", "var(--pt-line-2)", lit(id));
        return (
          <g key={id}>
            <rect x={b.x} y={b.y} width={b.width} height={b.height} rx={6}
              className={filled(id) ? "pt-edge" : "pt-guide"}
              style={{ fill: marked > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", marked) : "var(--pt-top)",
                stroke: accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink, strokeWidth: accent > 0.5 ? 1.5 : 1 }} />
            <circle cx={b.x + 14} cy={b.y + 17} r={3.5} style={{ fill: HUE[id] }} />
            <text className="pt-label" x={b.x + 24} y={b.y + 21} style={{ ["--pt-halo" as string]: "var(--pt-top)" }}>{NAME[id]}</text>
            <text className="pt-tag" x={b.x + 24} y={b.y + 36} style={{ stroke: "none" }}>{GLOB[id]}</text>
            {marked > 0.05 ? (
              <text className="pt-tag" x={b.x + 12} y={b.y + 64} opacity={marked} style={{ stroke: "none", fill: "var(--pt-accent-ink)" }}>nothing changed here</text>
            ) : null}
          </g>
        );
      })}

      {/* match-code: the code file slides out of the tray into the Code bucket. */}
      {listed > 0 ? <Chip at={codeAt} label={codeLabel} hue={HUE.code} lit={lit("code")} here={listed} /> : null}

      {/* match-pages, match-shots: dashed probes that find no file under the docs globs. */}
      {(["pages", "shots"] as const).map((id) => {
        const y = BUCKET[id].y + 30;
        const gone = 1 - span(pp, 0, 0.12);
        return probe > 0 && gone > 0 ? (
          <g key={id} opacity={gone}>
            <Line from={[TRAY.x + TRAY.width, y]} to={[BUCKET[id].x - 2, y]} progress={probe} dashed head lit={lit(id)} />
            <text className="pt-tag" x={(TRAY.x + TRAY.width + CARD.x) / 2} y={y - 7} textAnchor="middle" opacity={span(probe, 0.6, 1)}>no match</text>
          </g>
        ) : null;
      })}

      {/* docs-check and its verdict. */}
      <Panel box={CHECK} lit={lit("checker")} accent={accentOf.checker}>
        <text className="pt-label" x={CHECK.x + 14} y={CHECK.y + 22}>docs-check</text>
        <text className="pt-tag" x={CHECK.x + 14} y={CHECK.y + 37}>--changed HEAD</text>
        <line x1={CHECK.x + 14} x2={CHECK.x + CHECK.width - 14} y1={CHECK.y + 48} y2={CHECK.y + 48} style={{ stroke: "var(--pt-rule)" }} />
        {missing > 0 ? (
          <g opacity={missing}>
            <text className="pt-label" x={CHECK.x + 14} y={CHECK.y + 66} style={{ fill: mix("var(--pt-accent-ink)", "var(--pt-ink)", f.on("flagged")) }}>PARITY_MISSING</text>
            <text className="pt-tag" x={CHECK.x + 14} y={CHECK.y + 81}>warning: no docs moved</text>
          </g>
        ) : null}
        {reminder > 0 ? (
          <g opacity={reminder}>
            <text className="pt-label" x={CHECK.x + 14} y={CHECK.y + 66}>SHOTS_UNCHANGED</text>
            <text className="pt-tag" x={CHECK.x + 14} y={CHECK.y + 81}>info: page is enough</text>
          </g>
        ) : null}
        {clean > 0 ? (
          <g opacity={clean}>
            <text className="pt-label" x={CHECK.x + 14} y={CHECK.y + 66}>0 findings</text>
            <text className="pt-tag" x={CHECK.x + 14} y={CHECK.y + 81}>exit 0</text>
          </g>
        ) : null}
      </Panel>

      {/* The Stop hook: it runs docs-check as the turn ends, and passes the finding on as a note. */}
      <Panel box={HOOK} lit={lit("stophook")}>
        <text className="pt-label" x={HOOK.x + 14} y={HOOK.y + 22}>Stop hook</text>
        <text className="pt-tag" x={HOOK.x + 14} y={HOOK.y + 37}>stop-check.mjs</text>
        <text className="pt-tag" x={HOOK.x + 14} y={HOOK.y + 51}>warns, never blocks</text>
      </Panel>
      <g opacity={hookDone}>
        <Elbow from={[HOOK.x + 36, HOOK.y]} to={[CHECK.x + 36, CHECK.y + CHECK.height]} progress={runs} lit={lit("stophook")} quiet />
        {runs > 0 ? <text className="pt-tag" x={HOOK.x + 44} y={(CHECK.y + CHECK.height + HOOK.y) / 2 + 3} opacity={runs}>runs</text> : null}
        <Elbow from={[CHECK.x + 112, CHECK.y + CHECK.height]} to={[HOOK.x + 112, HOOK.y]} progress={findingsLaid} lit={lit("stophook")} quiet />
        {findingsLaid > 0 ? <text className="pt-tag" x={HOOK.x + 120} y={(CHECK.y + CHECK.height + HOOK.y) / 2 + 3} opacity={findingsLaid}>finding</text> : null}
        {/* flag: the surface's verdict, read out by docs-check. */}
        <Elbow from={[CARD.x + CARD.width, CHECK.y + 62]} to={[CHECK.x, CHECK.y + 62]} progress={flagLaid}
          accent={accentOf.checker} lit={lit("checker")} />
      </g>

      {/* tell: the note reaches the agent. */}
      <Panel box={AGENT} lit={lit("agent")} accent={accentOf.agent}>
        <text className="pt-label" x={AGENT.x + 14} y={AGENT.y + 22}>Agent</text>
        <text className="pt-label pt-label-sub" x={AGENT.x + 14} y={AGENT.y + 40}>still holding the change</text>
      </Panel>
      <g opacity={hookDone}>
        <Elbow from={[HOOK.x + 36, HOOK.y + HOOK.height]} to={[AGENT.x + 36, AGENT.y]} progress={tellLaid}
          accent={accentOf.agent} lit={lit("agent")} pulse={index === at("told") ? span(tp, 0.14, 0.4) : undefined} />
        {tellLaid > 0 ? (
          <g opacity={tellLaid}>
            <text className="pt-tag" x={HOOK.x + 44} y={HOOK.y + HOOK.height + 18}>a note: one more go</text>
            <text className="pt-tag" x={HOOK.x + 44} y={HOOK.y + HOOK.height + 31}>said once per finding</text>
          </g>
        ) : null}
      </g>

      {/* rewrite, retake: the agent's edits come back along the lane into Pages, then Shots. */}
      {(["pages", "shots"] as const).map((id, k) => {
        const b = BUCKET[id];
        const laid = id === "pages" ? span(pp, 0, 0.12) : span(sp, 0, 0.12);
        return (
          <Elbow key={id} from={[AGENT.x, AGENT.y + 20 + k * 22]} to={[b.x + b.width + 2, b.y + 48 + CHIP_H / 2]} first="h" via={LANE} progress={laid}
            lit={lit(id)} quiet />
        );
      })}
      {docRows.map((r) => {
        const id = String(r.of);
        const label = id === "pages" ? String(r.label) : base(String(r.label));
        const nth = docRows.filter((o) => o.of === r.of).indexOf(r);
        const land = slot(id, nth);
        const q = ride(r);
        if (q <= 0) return null;
        const w = chipWidth(label);
        const from: P2 = [AGENT.x - 4, AGENT.y + 20 + (id === "pages" ? 0 : 22)];
        const end: P2 = [land[0] + w, land[1] + CHIP_H / 2];
        const tip = q >= 1 ? end : onElbow(from, end, q, { first: "h", via: LANE });
        return <Chip key={String(r.id)} at={[tip[0] - w, tip[1] - CHIP_H / 2]} label={label} hue={HUE[id]} lit={lit(id)} />;
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
