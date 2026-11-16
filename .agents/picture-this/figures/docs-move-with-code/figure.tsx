"use client";
// docs-move-with-code: one surface from .agents/docs-parity.json, drawn as the
// three things it ties together: a source file, the page that describes it
// and the screenshot that shows it. One line of the code changes; the page
// and the shot are behind until the sentence is rewritten and the picture
// retaken. Under them, what docs-check says of the change at each step. The
// file contents and every line of the checker's output come from a scratch
// repo with exactly this surface, run through plugins/agentcraft/skills/docs-parity.
import { useId } from "react";
import type { Model, Row } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, indexOf, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as unknown as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 386 };

const rows = (name: string) => ((model.data?.[name] ?? []) as Row[]);
const OLD = String(rows("words").find((w) => w.id === "old")?.label ?? "CSV");
const NEW = String(rows("words").find((w) => w.id === "new")?.label ?? "Spreadsheet");
const VERDICTS = rows("verdicts");

// Layout, in px. Three panels in a row inside the surface's frame.
const FRAME = { x: 16, y: 22, width: 728, height: 302 };
const TOP = 88, HEIGHT = 222;
const CODE = { x: 30, y: TOP, width: 242, height: HEIGHT };
const PAGE = { x: 294, y: TOP, width: 232, height: HEIGHT };
const SHOT = { x: 548, y: TOP, width: 182, height: HEIGHT };
const HEAD = 22; // a panel's file-name strip

// src/export/menu.tsx, lines 3 to 11. Line 8 is the one that changes.
const SOURCE: [number, string][] = [
  [3, "export function FormatMenu() {"],
  [4, "  return ("],
  [5, '    <Menu title="Format">'],
  [6, "      <Item>PDF</Item>"],
  [7, "      <Item>PNG</Item>"],
  [8, ""],
  [9, "    </Menu>"],
  [10, "  );"],
  [11, "}"],
];
const CHANGED = 5;
const PITCH = 17;
const lineY = (i: number) => TOP + 40 + i * PITCH;

// The picture: the Format menu, the same size in the page and as its own file.
const PIC = { width: 150, height: 84 };
const PIC_Y = TOP + 104;
const COPY: [number, number] = [PAGE.x + 12, PIC_Y];
const FILE: [number, number] = [SHOT.x + 16, PIC_Y];
const ITEM = 14; // one row of the menu
const itemY = (i: number) => 38 + i * ITEM; // a row's middle, from the picture's top
const ROW_Y = PIC_Y + itemY(2);
const SENTENCE_Y = TOP + 204;
const GAP_X = (CODE.x + CODE.width + PAGE.x) / 2;

const STRIP_Y = 348;

const r = (v: number) => Math.round(v * 100) / 100;
const FLAT = { ["--pt-halo" as string]: "transparent" };
const INK = { fill: "var(--pt-ink)" };
const HOT = { fill: "var(--pt-accent-ink)" };
const QUIET = { fill: "var(--pt-ink-2)" };

/** The word as it stands while it is being rewritten: the old one deleted, then the new one typed. */
function retype(t: number, from = 0.06, mid = 0.2, to = 0.42): string {
  if (t <= from) return OLD;
  if (t < mid) return OLD.slice(0, Math.round(OLD.length * (1 - span(t, from, mid))));
  return NEW.slice(0, Math.round(NEW.length * span(t, mid, to)));
}

/** The row the story is about, in each of its three places: quiet, tinted while it is behind, lined while it is being changed. */
function Band({ x, y, width, height = 16, marked = 0, accent = 0 }: { x: number; y: number; width: number; height?: number; marked?: number; accent?: number }) {
  // Tinted while it is behind; while it is being changed the face clears, so the word in the accent reads on it.
  const base = marked > 0 ? mix("var(--pt-accent-soft)", "var(--pt-left)", marked) : "var(--pt-left)";
  return (
    <rect x={x} y={y} width={width} height={height} rx={3}
      style={{
        fill: accent > 0 ? mix("var(--pt-top)", base, accent) : base,
        stroke: accent > 0 ? mix("var(--pt-accent)", "transparent", accent) : "none",
        strokeWidth: 1.25,
      }} />
  );
}

/** A panel's file name, and whether this change has touched the file. */
function Header({ box, file, state, hot = false }: { box: typeof CODE; file: string; state?: string; hot?: boolean }) {
  return (
    <g>
      <text className="pt-tag" x={box.x + 12} y={box.y + 15} style={INK}>{file}</text>
      {state ? <text className="pt-tag" x={box.x + box.width - 12} y={box.y + 15} textAnchor="end" style={hot ? HOT : undefined}>{state}</text> : null}
      <line className="pt-rule" x1={box.x} x2={box.x + box.width} y1={box.y + HEAD} y2={box.y + HEAD} />
    </g>
  );
}

/** The screenshot: the Format menu the code makes. `sweep` (0 to 1) is how much of it has been retaken, from the top. */
function Picture({ at, sweep = 0, marked = 0, accent = 0 }: { at: [number, number]; sweep?: number; marked?: number; accent?: number }) {
  const id = `pt-shot-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [x, y] = at;
  const cut = r(PIC.height * sweep);
  const item = (label: string, i: number) => (
    <text className="pt-label-sub" x={x + 26} y={y + itemY(i) + 3.8} style={accent > 0.5 && i === 2 ? HOT : INK}>{label}</text>
  );
  return (
    <g>
      <rect x={x} y={y} width={PIC.width} height={PIC.height} rx={4} style={{ fill: "var(--pt-left)", stroke: "var(--pt-line-2)", strokeWidth: 1 }} />
      <rect className="pt-panel" x={x + 12} y={y + 7} width={126} height={70} rx={4} />
      <text className="pt-label" x={x + 26} y={y + 21.5} style={FLAT}>Format</text>
      <path d={`M ${x + 120} ${y + 16} l 7 0 l -3.5 4.5 z`} style={{ fill: "var(--pt-ink-2)" }} />
      <line className="pt-rule" x1={x + 12} x2={x + 138} y1={y + 28} y2={y + 28} />
      <Band x={x + 17} y={y + itemY(2) - 7} width={116} height={14} marked={marked} accent={accent} />
      {item("PDF", 0)}
      {item("PNG", 1)}
      <clipPath id={`${id}-old`}><rect x={x} y={y + cut} width={PIC.width} height={PIC.height - cut} /></clipPath>
      <clipPath id={`${id}-new`}><rect x={x} y={y} width={PIC.width} height={cut} /></clipPath>
      <g clipPath={`url(#${id}-old)`}>{item(OLD, 2)}</g>
      <g clipPath={`url(#${id}-new)`}>{item(NEW, 2)}</g>
      {sweep > 0 && sweep < 1 ? <line x1={x} x2={x + PIC.width} y1={y + cut} y2={y + cut} style={{ stroke: "var(--pt-accent)", strokeWidth: 1.5 }} /> : null}
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

  // The code: line 8 is retyped.
  const codeT = through("change");
  const codeWord = retype(codeT);
  const codeAccent = f.on("change");
  const codeChanged = codeT >= 0.42;

  // The check: what is behind is marked, in the order the change reaches it.
  const b = through("behind");
  const pageIn = ease.out(span(b, 0.18, 0.3));
  const copyIn = ease.out(span(b, 0.22, 0.34));
  const shotIn = ease.out(span(b, 0.3, 0.42));

  // The page: its sentence is rewritten.
  const w = through("rewrite");
  const pageWord = retype(w, 0.14, 0.24, 0.4);
  const pageAccent = f.on("rewrite");
  const pageMarked = pageIn * (1 - span(w, 0.9, 1));
  const pageChanged = w >= 0.4;

  // The shot: retaken from the top down, then the page shows the new file.
  const k = through("retake");
  const shotSweep = span(k, 0.08, 0.28);
  const copySweep = span(k, 0.34, 0.44);
  const shotAccent = f.on("retake");
  const shotMarked = shotIn * (1 - span(k, 0.9, 1));
  const copyMarked = copyIn * (1 - span(k, 0.44, 0.5));
  const shotRetaken = k >= 0.28;

  // What docs-check says of the change as it stands.
  const said = k >= 0.46 ? 3 : w >= 0.44 ? 2 : b >= 0.36 ? 1 : 0;
  const saidIn = said === 3 ? ease.out(span(k, 0.46, 0.5)) : said === 2 ? ease.out(span(w, 0.44, 0.5)) : ease.out(span(b, 0.36, 0.48));
  const verdict = said > 0 ? VERDICTS[said - 1] : null;
  const telling = f.on("behind");
  const surfaceOn = f.on("surface");

  // The thread leaves the changed line's band and ends on the sentence's band and on the picture.
  const fromCode: [number, number] = [CODE.x + CODE.width - 5, lineY(CHANGED)];
  const toSentence: [number, number] = [PAGE.x + 5, SENTENCE_Y];
  const toPicture: [number, number] = [COPY[0], ROW_Y];
  const ran = index >= at("behind");
  const joinFrom = COPY[0] + PIC.width, joinTo = FILE[0];
  const carried = within("retake", 0.28, 0.36);

  return (
    <g>
      {/* The surface: one entry in the config, and what ties the three together */}
      <rect x={FRAME.x} y={FRAME.y} width={FRAME.width} height={FRAME.height} rx={12}
        style={{ fill: "none", stroke: surfaceOn > 0 ? mix("var(--pt-accent)", "var(--pt-line-2)", surfaceOn) : "var(--pt-line-2)", strokeWidth: surfaceOn > 0.5 ? 1.5 : 1 }} />
      <text className="pt-label" x={CODE.x} y={45} style={surfaceOn > 0.5 ? HOT : undefined}>Surface: export</text>
      <text className="pt-tag" x={CODE.x + 124} y={45}>in .agents/docs-parity.json</text>

      {([[CODE, "Code", "src/export/**"], [PAGE, "Pages", "docs/exporting.md"], [SHOT, "Shots", "docs/images/export/**"]] as const).map(([box, role, glob]) => (
        <g key={role}>
          <text className="pt-label" x={box.x} y={72}>{role}</text>
          <text className="pt-tag" x={box.x + 44} y={72}>{glob}</text>
        </g>
      ))}

      {/* Code: the source file */}
      <Panel box={CODE}>
        <Header box={CODE} file="menu.tsx" state={codeChanged ? "changed" : undefined} />
        <Band x={CODE.x + 5} y={lineY(CHANGED) - 8} width={CODE.width - 10} marked={0} accent={codeAccent} />
        {SOURCE.map(([n, text], i) => (
          <g key={n}>
            <text className="pt-tag" x={CODE.x + 24} y={lineY(i) + 3.5} textAnchor="end" style={FLAT}>{n}</text>
            {i === CHANGED ? (
              <text className="pt-tag" x={CODE.x + 34} y={lineY(i) + 3.5} style={{ ...FLAT, ...INK, whiteSpace: "pre" }}>
                {"      <Item>"}<tspan style={codeAccent > 0.5 ? HOT : undefined}>{codeWord}</tspan>{"</Item>"}
              </text>
            ) : (
              <text className="pt-tag" x={CODE.x + 34} y={lineY(i) + 3.5} style={{ ...FLAT, ...INK, whiteSpace: "pre" }}>{text}</text>
            )}
          </g>
        ))}
      </Panel>

      {/* Page: the documentation a reader opens, the picture set into it */}
      <Panel box={PAGE}>
        <Header box={PAGE} file="exporting.md" state={pageChanged ? "changed" : pageIn > 0.5 ? "not changed" : undefined} hot={!pageChanged} />
        <text className="pt-label-sub" x={PAGE.x + 12} y={TOP + 44} style={{ ...INK, fontSize: 15, fontWeight: 650 }}>Exporting</text>
        <text className="pt-label-sub" x={PAGE.x + 12} y={TOP + 62}>Save a report as a file you can share</text>
        <text className="pt-label-sub" x={PAGE.x + 12} y={TOP + 76}>or open in another app.</text>
        <text className="pt-label-sub" x={PAGE.x + 12} y={TOP + 97} style={{ ...INK, fontWeight: 650 }}>Choose a format</text>
        <Picture at={COPY} sweep={copySweep} marked={copyMarked} />
        <Band x={PAGE.x + 5} y={SENTENCE_Y - 8} width={PAGE.width - 10} marked={pageMarked} accent={pageAccent} />
        <text className="pt-label-sub" x={PAGE.x + 12} y={SENTENCE_Y + 3.8} style={INK}>
          Open <tspan style={{ fontWeight: 650 }}>Format</tspan> and choose <tspan style={{ fontWeight: 650, ...(pageAccent > 0.5 ? HOT : {}) }}>{pageWord}</tspan>.
        </text>
      </Panel>

      {/* Shot: the screenshot, a file the capture harness writes */}
      <Panel box={SHOT}>
        <Header box={SHOT} file="menu.png" state={shotRetaken ? "retaken" : shotIn > 0.5 ? "not changed" : undefined} hot={!shotRetaken} />
        <text className="pt-label" x={SHOT.x + 16} y={TOP + 42}>Capture harness</text>
        <text className="pt-tag" x={SHOT.x + 16} y={TOP + 56}>runs group export</text>
        <text className="pt-tag" x={SHOT.x + 16} y={TOP + 69}>from the built product</text>
        <Elbow from={[FILE[0] + PIC.width / 2, TOP + 77]} to={[FILE[0] + PIC.width / 2, PIC_Y - 3]} first="v" quiet accent={shotAccent} pulse={within("retake", 0.02, 0.1)} pulseLength={0.4} />
        <Picture at={FILE} sweep={shotSweep} marked={shotMarked} accent={shotAccent} />
      </Panel>

      {/* The thread: from the changed line to the sentence and the picture that depend on it */}
      <Elbow from={fromCode} to={toSentence} via={GAP_X} radius={6} quiet pulse={within("behind", 0.03, 0.22) ?? within("rewrite", 0.02, 0.16)} pulseLength={0.3} />
      <Elbow from={fromCode} to={toPicture} via={GAP_X} radius={6} quiet pulse={within("behind", 0.03, 0.22)} pulseLength={0.3} />
      {/* The picture in the page is the shot's own file */}
      <Line from={[joinTo, ROW_Y]} to={[joinFrom, ROW_Y]} dashed head />
      {carried !== undefined ? (
        <path className="pt-pulse" d={`M ${r(lerp(joinTo, joinFrom, carried))} ${ROW_Y} L ${r(Math.min(joinTo, lerp(joinTo, joinFrom, carried) + 26))} ${ROW_Y}`} />
      ) : null}

      {/* What the checker says of the change */}
      <text className="pt-tag" x={CODE.x} y={STRIP_Y} style={ran ? INK : QUIET}>docs-check --changed HEAD</text>
      <text className="pt-tag" x={CODE.x + 172} y={STRIP_Y} style={ran ? undefined : QUIET}>run by the Stop hook as the turn ends, and by docs-sync</text>
      {verdict ? (
        <g opacity={r(saidIn)}>
          {verdict.code ? (
            <g>
              <circle cx={CODE.x + 5} cy={STRIP_Y + 18.5} r={3.5} style={{ fill: said === 1 && telling > 0 ? mix("var(--pt-accent)", "var(--pt-ink-3)", telling) : "var(--pt-ink-3)" }} />
              <text className="pt-label" x={CODE.x + 16} y={STRIP_Y + 22} style={said === 1 && telling > 0.5 ? HOT : undefined}>{String(verdict.code)}</text>
              <text className="pt-tag" x={CODE.x + (said === 1 ? 126 : 134)} y={STRIP_Y + 22} style={INK}>{String(verdict.says)}</text>
            </g>
          ) : (
            <text className="pt-tag" x={CODE.x} y={STRIP_Y + 22} style={INK}>{String(verdict.summary)}</text>
          )}
          {said === 1 ? (
            <g>
              <Line from={[378, STRIP_Y + 18.5]} to={[462, STRIP_Y + 18.5]} head accent={telling} />
              <text className="pt-label" x={474} y={STRIP_Y + 22}>Agent</text>
              <text className="pt-tag" x={522} y={STRIP_Y + 22}>told before the turn ends</text>
            </g>
          ) : (
            <text className="pt-tag" x={SHOT.x + SHOT.width} y={STRIP_Y + 22} textAnchor="end">{said === 2 ? "info only, exit 0" : "exit 0"}</text>
          )}
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
