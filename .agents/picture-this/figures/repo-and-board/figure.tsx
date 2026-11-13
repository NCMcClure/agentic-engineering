"use client";
// repo-and-board: the repo on the left of a seam, Miro on the right, and the
// legibility lint on the seam. Two owners, two hues: a card's words are the
// generator's (blue), its place is the board's (violet), kept in the layout
// file. The build puts the two together into one card; the lint reads it
// before it crosses and reads what Miro drew after; the board's places are
// copied home.
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, Queue } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 452 };

const WORDS_HUE = "var(--pt-hue-blue)"; // what a card says: the generator's
const PLACE_HUE = "var(--pt-hue-violet)"; // where a card sits: the board's

// The layout, in px.
const SEAM = 392;
const GEN: Box = { x: 20, y: 40, width: 200, height: 92 };
const BUILD: Box = { x: 230, y: 174, width: 120, height: 78 };
const MINI: Box = { x: 242, y: 202, width: 96, height: 38 };
const LAYOUT: Box = { x: 20, y: 330, width: 200, height: 110 };
const LINT: Box = { x: 337, y: 290, width: 110, height: 66 };
const BOARD: Box = { x: 456, y: 40, width: 288, height: 220 };
const FRAME: Box = { x: 464, y: 66, width: 272, height: 184 };
const DUMP: Box = { x: 500, y: 356, width: 190, height: 48 };

// The example frame's cards (gen-example.mjs): one row, and Value check dragged lower in Miro.
const CW = 76, CH = 28;
const ASK: Box = { x: 472, y: 96, width: CW, height: CH };
const CHECK_GEN: Box = { x: 562, y: 96, width: CW, height: CH }; // where the generator alone would put it
const CHECK: Box = { x: 562, y: 168, width: CW, height: CH }; // where someone dragged it
const BLD: Box = { x: 652, y: 96, width: CW, height: CH };

// What the generator says about that card, and what the layout file holds for each card.
const FIELDS: [string, string][] = [["title", "Value check"], ["body", "Is it worth building?"]];
const PLACES: [string, string, string][] = [["ask", "60", "120"], ["check", "520", "250"], ["build", "980", "120"]];

const WIRES: Record<string, { from: P2; to: P2; first?: "h" | "v"; via?: number; dashed?: boolean }> = {
  scene: { from: [GEN.x + GEN.width, 86], to: [290, BUILD.y], first: "h", via: 290 },
  place: { from: [120, LAYOUT.y], to: [BUILD.x, 221], first: "v", via: 221 },
  predict: { from: [290, BUILD.y + BUILD.height], to: [LINT.x, 318], first: "v", via: 318, dashed: true },
  publish: { from: [BUILD.x + BUILD.width, 213], to: [BOARD.x, 213] },
  drawn: { from: [600, BOARD.y + BOARD.height], to: [600, DUMP.y], first: "v" },
  relint: { from: [DUMP.x, 380], to: [410, LINT.y + LINT.height], first: "h", via: 410, dashed: true },
  pull: { from: [720, BOARD.y + BOARD.height], to: [LAYOUT.x + LAYOUT.width, 420], first: "v", via: 420 },
};

const WORDS: Record<string, { at: P2; anchor?: "start" | "middle" | "end" }> = {
  scene: { at: [255, 78], anchor: "middle" },
  place: { at: [128, 284], anchor: "start" },
  predict: { at: [282, 288], anchor: "end" },
  publish: { at: [SEAM + 10, 204], anchor: "middle" },
  drawn: { at: [592, 300], anchor: "end" },
  relint: { at: [446, 396], anchor: "middle" },
  pull: { at: [300, 413], anchor: "middle" },
};

const halo = (fill: string) => ({ ["--pt-halo" as string]: fill });

function Card({ box, title }: { box: Box; title: string }) {
  return (
    <g style={halo("var(--pt-top)")}>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={3} style={{ fill: "var(--pt-top)", stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
      <text className="pt-tag" x={box.x + box.width / 2} y={box.y + box.height / 2 + 3.5} textAnchor="middle" style={{ fill: WORDS_HUE }}>{title}</text>
    </g>
  );
}

/** A mouse pointer: someone's hand on the board. */
function Pointer({ at }: { at: P2 }) {
  const [x, y] = at;
  const d = `M ${x} ${y} L ${x} ${y + 13} L ${x + 3.5} ${y + 10} L ${x + 6} ${y + 15} L ${x + 8} ${y + 14} L ${x + 5.5} ${y + 9} L ${x + 10} ${y + 9} Z`;
  return <path d={d} style={{ fill: "var(--pt-top)", stroke: PLACE_HUE, strokeWidth: 1, strokeLinejoin: "round" }} />;
}

function Scene() {
  const f = useFigure();
  const { beat, p } = f.frame;
  const rest = f.on("rest");
  const lit = (id: string) => f.lit(id);

  // A pulse rides the wire its beat tells. The live beat tells two, one after the other.
  const pulse = (id: string): number | undefined => {
    if (beat.id === "live") {
      if (id === "drawn") return p < 0.42 ? ease.out(span(p, 0.02, 0.42)) : undefined;
      if (id === "relint") return p >= 0.3 ? span(p, 0.3, 0.7) : undefined;
    }
    return f.moving(id) > 0.5 ? f.phase(1) : undefined;
  };
  // Blocking findings: while there are any, the build writes nothing and the publish wire carries nothing.
  const findings = f.level("findings");
  const blocked = beat.id === "gate" && findings > 0.5 ? 1 - span(p, 0.86, 0.94) : 0;
  const judged = f.on("gate", "publish", "live", "pull", "rest");
  const status = findings > 0.5 ? `${Math.round(findings)} blocking` : "✓ clean";

  const wire = (id: string) => {
    const w = WIRES[id];
    const on = Math.max(f.moving(id), rest);
    return (
      <Elbow key={id} from={w.from} to={w.to} first={w.first} via={w.via} radius={8} dashed={w.dashed}
        pulse={pulse(id)} lit={id === "publish" && blocked > 0 ? 0.1 : 0.25 + 0.75 * on} />
    );
  };
  const word = (id: string) => {
    const w = WORDS[id];
    const fl = model.flows.find((x) => x.id === id);
    const on = Math.max(f.moving(id), rest);
    return (
      <text key={id} className="pt-tag" x={w.at[0]} y={w.at[1]} textAnchor={w.anchor}
        style={{ fill: mix("var(--pt-ink-2)", "var(--pt-ink-3)", 0.3 + 0.7 * on) }}>{fl?.label}</text>
    );
  };
  const title = (x: number, y: number, text: string, anchor: "start" | "middle" = "start", hue?: string) => (
    <g>
      {hue ? <circle cx={x + 3} cy={y - 3.5} r={3} style={{ fill: hue }} /> : null}
      <text className="pt-label" x={hue ? x + 11 : x} y={y} textAnchor={anchor}>{text}</text>
    </g>
  );
  const tag = (x: number, y: number, text: string, anchor: "start" | "middle" | "end" = "start", fill?: string) => (
    <text className="pt-tag" x={x} y={y} textAnchor={anchor} style={fill ? { fill } : undefined}>{text}</text>
  );

  // Miro's dot grid, under the frame.
  const dots: P2[] = [];
  for (let x = BOARD.x + 14; x < BOARD.x + BOARD.width - 6; x += 14) for (let y = BOARD.y + 30; y < BOARD.y + BOARD.height - 4; y += 14) dots.push([x, y]);

  return (
    <g opacity={f.present}>
      {/* Two sides of one seam, and the key to the two owners. */}
      {tag(GEN.x, 22, "the repo")}
      {tag(BOARD.x, 22, "Miro")}
      <circle cx={120} cy={18.5} r={3} style={{ fill: WORDS_HUE }} />
      {tag(127, 22, "words: from code")}
      <circle cx={244} cy={18.5} r={3} style={{ fill: PLACE_HUE }} />
      {tag(251, 22, "place: from the board")}
      <path className="pt-guide" d={`M ${SEAM} 32 L ${SEAM} ${LINT.y - 8} M ${SEAM} ${LINT.y + LINT.height + 8} L ${SEAM} ${VIEW.height - 4}`} />

      {Object.keys(WIRES).map(wire)}

      {/* The generator: what the Value check card says. */}
      <Panel box={GEN} lit={lit("generator")}>
        {title(GEN.x + 12, GEN.y + 19, "Generator", "start", WORDS_HUE)}
        {tag(GEN.x + 12, GEN.y + 34, "gen-example.mjs")}
        <path className="pt-rule" d={`M ${GEN.x + 12} ${GEN.y + 43} L ${GEN.x + GEN.width - 12} ${GEN.y + 43}`} />
        {FIELDS.map(([k, v], i) => (
          <g key={k}>
            {tag(GEN.x + 12, GEN.y + 60 + i * 16, k, "start", "var(--pt-ink-3)")}
            {tag(GEN.x + 52, GEN.y + 60 + i * 16, v, "start", WORDS_HUE)}
          </g>
        ))}
      </Panel>

      {/* The layout file: each card's place, as the board last had it. */}
      <Panel box={LAYOUT} lit={lit("layout")} accent={f.arriving("layout")}>
        {title(LAYOUT.x + 12, LAYOUT.y + 19, "Layout file", "start", PLACE_HUE)}
        {tag(LAYOUT.x + 12, LAYOUT.y + 34, "miro/example.layout.json")}
        <path className="pt-rule" d={`M ${LAYOUT.x + 12} ${LAYOUT.y + 43} L ${LAYOUT.x + LAYOUT.width - 12} ${LAYOUT.y + 43}`} />
        {PLACES.map(([k, x, y], i) => {
          const ry = LAYOUT.y + 62 + i * 16;
          return (
            <g key={k}>
              {tag(LAYOUT.x + 12, ry, k, "start", "var(--pt-ink-3)")}
              {tag(LAYOUT.x + 70, ry, `x ${x}`, "start", PLACE_HUE)}
              {tag(LAYOUT.x + 130, ry, `y ${y}`, "start", PLACE_HUE)}
            </g>
          );
        })}
      </Panel>

      {/* The build: the one card, its words from the generator and its place from the layout file. */}
      <Panel box={BUILD} lit={lit("build")} accent={f.arriving("build")}>
        {title(BUILD.x + 12, BUILD.y + 17, "Build")}
        {tag(BUILD.x + BUILD.width - 12, BUILD.y + 17, "build.mjs", "end")}
        <rect x={MINI.x} y={MINI.y} width={MINI.width} height={MINI.height} rx={3} style={{ fill: "var(--pt-top)", stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
        {tag(MINI.x + MINI.width / 2, MINI.y + 15, "Value check", "middle", WORDS_HUE)}
        {tag(MINI.x + MINI.width / 2, MINI.y + 30, "x 520  y 250", "middle", PLACE_HUE)}
      </Panel>

      {/* The lint, on the seam: one dot per blocking finding, and its verdict. */}
      <Panel box={LINT} lit={lit("lint")} accent={f.arriving("lint")}>
        {title(SEAM, LINT.y + 17, "Lint", "middle")}
        <Queue at={[SEAM - 21, LINT.y + 32]} count={4} filled={findings} lit={0.4 + 0.6 * lit("lint")} />
        <g opacity={judged}>{tag(SEAM, LINT.y + 52, status, "middle", "var(--pt-ink)")}</g>
      </Panel>

      {/* While the lint blocks, nothing goes across. */}
      <g opacity={blocked}>{tag(SEAM + 10, 230, "nothing written", "middle", "var(--pt-ink)")}</g>

      {/* The board: Miro's canvas, the example frame, and the card someone dragged. */}
      <Panel box={BOARD} lit={lit("board")} accent={f.arriving("board")}>
        {dots.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={0.9} style={{ fill: "var(--pt-line-2)" }} />)}
        {title(BOARD.x + 12, BOARD.y + 17, "Miro board")}
        <rect x={FRAME.x} y={FRAME.y} width={FRAME.width} height={FRAME.height} rx={2} style={{ fill: "var(--pt-top)", stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
        <g style={halo("var(--pt-top)")}>{tag(FRAME.x + 8, FRAME.y + 15, "Example pipeline")}</g>
        <rect x={CHECK_GEN.x} y={CHECK_GEN.y} width={CW} height={CH} rx={3} className="pt-guide" />
        <g style={halo("var(--pt-top)")}>{tag(CHECK_GEN.x + CW / 2, CHECK_GEN.y + 12, "where code", "middle", "var(--pt-ink-3)")}{tag(CHECK_GEN.x + CW / 2, CHECK_GEN.y + 23, "put it", "middle", "var(--pt-ink-3)")}</g>
        <Line from={[CHECK_GEN.x + CW / 2, CHECK_GEN.y + CH + 3]} to={[CHECK.x + CW / 2, CHECK.y - 3]} dashed />
        <Elbow from={[ASK.x + CW / 2, ASK.y + CH]} to={[CHECK.x, CHECK.y + CH / 2]} first="v" via={CHECK.y + CH / 2} radius={5} quiet />
        <Elbow from={[CHECK.x + CW, CHECK.y + CH / 2]} to={[BLD.x + CW / 2, BLD.y + CH]} first="h" via={BLD.x + CW / 2} radius={5} quiet />
        <Card box={ASK} title="Request" />
        <Card box={CHECK} title="Value check" />
        <Card box={BLD} title="Build" />
        <g style={halo("var(--pt-top)")}>{tag(CHECK.x + CW / 2, CHECK.y + CH + 15, "dragged here: x 520  y 250", "middle", PLACE_HUE)}</g>
        <Pointer at={[CHECK.x + CW + 4, CHECK.y + 4]} />
      </Panel>

      {/* The board dump: a script that runs inside Miro's own browser tab. */}
      <g>
        <path className="pt-panel" d={`M ${DUMP.x} ${DUMP.y + 2} Q ${DUMP.x} ${DUMP.y - 8} ${DUMP.x + 8} ${DUMP.y - 8} L ${DUMP.x + 62} ${DUMP.y - 8} Q ${DUMP.x + 70} ${DUMP.y - 8} ${DUMP.x + 70} ${DUMP.y}`}
          style={{ stroke: mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * lit("dump")) }} />
        <Panel box={DUMP} radius={4} lit={lit("dump")} accent={f.arriving("dump")}>
          {title(DUMP.x + 12, DUMP.y + 20, "Board dump")}
          {tag(DUMP.x + 12, DUMP.y + 36, "runs in Miro's browser tab")}
        </Panel>
      </g>

      {Object.keys(WORDS).map(word)}
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
