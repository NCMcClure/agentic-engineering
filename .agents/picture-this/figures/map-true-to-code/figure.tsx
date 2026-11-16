"use client";
// map-true-to-code: the code on the left as the three files it is, the system
// map on the right as the diagram those files' `@system` lines describe. A
// `node` line draws a box and a `calls` line an arrow, one at a time. Then an
// import arrives with no `calls` line above it: the check prints its finding,
// and the arrow the map lacks is a dashed place on it until the line is
// written. Last, the same three cards land on the Miro board.
//
// Every line of code and of output is the scratch repo's own, kept in the
// model's data: the files, the checker's stdout, git's stat, and the boxes
// the plugin's generator gives the board.
import type { Model, Row } from "../kit/model";
import { rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { ease, indexOf, outro, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 382 };

// ── The model, read once ────────────────────────────────────────────────────
const byId = (table: string) => Object.fromEntries(rows(model, table).map((row) => [String(row.id), row])) as Record<string, Row>;
const LINE = byId("lines"), OUT = byId("output");
const NODES = rows(model, "nodes"), EDGES = byId("edges"), CARDS = rows(model, "cards");
const say = (row: Row) => String(row.text);

// ── The page ────────────────────────────────────────────────────────────────
const PITCH = 14, SIZE = 10;
/** A window on the top of a file: `slots` lines tall. */
const file = (y: number, slots: number): Box => ({ x: 16, y, width: 310, height: slots * PITCH + 12 });
const CART = file(28, 5), ORDERS = file(136, 3), STOCK = file(216, 2);
const MAP: Box = { x: 346, y: 28, width: 398, height: 228 };
const TERM: Box = { x: 16, y: 290, width: 512, height: 78 };
const BOARD: Box = { x: 548, y: 290, width: 196, height: 78 };
/** The baseline of a line of code or output, `slot` lines down a panel. */
const lineY = (box: Box, slot: number) => box.y + 17 + slot * PITCH;

// The map's boxes: one row per layer, the caller centred over the two it reaches, as the generator lays them.
const CARD = { width: 88, height: 38 };
const AT: Record<string, P2> = { cart: [527, 58], orders: [406, 188], stock: [648, 188] };
const ROW: Record<string, number> = { surface: 58, service: 188 };
const GAP_Y = 142; // half-way between the rows: where an elbow turns
const bottom = (id: string): P2 => [AT[id][0] + CARD.width / 2, AT[id][1] + CARD.height];
const top = (id: string): P2 => [AT[id][0] + CARD.width / 2, AT[id][1]];
/** Where an edge's words sit: over its run, each side of the stem the two calls from Cart share. */
const WORDS: Record<string, P2> = { "cart-orders": [504, GAP_Y - 6], "cart-stock": [640, GAP_Y - 6], "orders-stock": [571, AT.orders[1] + CARD.height / 2 - 6] };

// The board, to the generator's own proportions: its cards' boxes, a sixth of their size.
const MINI = 0.165;
const frame = { x: Math.min(...CARDS.map((c) => Number(c.x))), y: Math.min(...CARDS.map((c) => Number(c.y))) };
const span2 = { width: Math.max(...CARDS.map((c) => Number(c.x) + Number(c.width))) - frame.x, height: Math.max(...CARDS.map((c) => Number(c.y) + Number(c.height))) - frame.y };
const ORIGIN: P2 = [BOARD.x + (BOARD.width - span2.width * MINI) / 2, BOARD.y + (BOARD.height - span2.height * MINI) / 2];
const mini = (id: string): Box => {
  const c = CARDS.find((card) => card.id === id) as Row;
  return { x: ORIGIN[0] + (Number(c.x) - frame.x) * MINI, y: ORIGIN[1] + (Number(c.y) - frame.y) * MINI, width: Number(c.width) * MINI, height: Number(c.height) * MINI };
};
const PUBLISH_X = BOARD.x + BOARD.width / 2;

const r = (v: number) => Math.round(v * 100) / 100;
const flat = { ["--pt-halo" as string]: "transparent" };

/**
 * One of `n` turns taken one after another between `from` and `to` of a beat:
 * `t` is how far through its turn it is, `now` whether it is the one being
 * told, `done` whether it has been. The last turn holds until `hold`.
 */
function turn(q: number, k: number, n: number, from: number, to: number, hold: number) {
  const w = (to - from) / n, start = from + k * w, end = k === n - 1 ? hold : start + w;
  return { t: span(q, start, start + w), now: span(q, start, start + 0.03) * (1 - span(q, end, end + 0.05)), done: span(q, end, end + 0.05) };
}

/** The tint behind a line the story is on (`accent`) or was on (`marked`). */
function Strip({ box, y, accent = 0, marked = 0, inset = 4 }: { box: Box; y: number; accent?: number; marked?: number; inset?: number }) {
  const on = Math.max(accent, 0.75 * marked);
  if (on <= 0) return null;
  return <rect x={box.x + inset} y={r(y - 10)} width={box.width - 2 * inset} height={PITCH} rx={2}
    style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", on), stroke: accent > 0 ? mix("var(--pt-accent)", "transparent", accent) : "none", strokeWidth: 1 }} />;
}

/** One line of code or of output, in the mono face, with its spaces kept. */
function Mono({ x, y, text, tone = "ink", accent = 0, opacity = 1, anchor }: { x: number; y: number; text: string; tone?: "ink" | "soft"; accent?: number; opacity?: number; anchor?: "end" }) {
  if (opacity <= 0 || !text) return null;
  const ink = tone === "ink" ? "var(--pt-ink)" : "var(--pt-ink-2)";
  return <text className="pt-num" x={x} y={r(y)} textAnchor={anchor} opacity={r(opacity)}
    style={{ fontSize: SIZE, whiteSpace: "pre", fill: accent > 0 ? mix("var(--pt-accent-ink)", ink, accent) : ink }}>{text}</text>;
}

type Shown = { id: string; slot: number; accent?: number; marked?: number; typed?: number; opacity?: number; quiet?: boolean };

/** A file: its name, and the top of it as numbered lines. */
function File({ box, name, lines, lit }: { box: Box; name: string; lines: Shown[]; lit: number }) {
  const slots = Math.round((box.height - 12) / PITCH);
  return (
    <g>
      <text className="pt-tag" x={box.x + 2} y={box.y - 7} opacity={r(0.6 + 0.4 * lit)}>{name}</text>
      <Panel box={box} radius={6} lit={Math.max(lit, 0.35)}>
        <g opacity={r(0.55 + 0.45 * lit)}>
          {lines.map((l) => <g key={l.id} opacity={r(l.opacity ?? 1)}><Strip box={box} y={lineY(box, l.slot)} accent={l.accent} marked={l.marked} /></g>)}
          {Array.from({ length: slots }, (_, i) => <Mono key={i} x={box.x + 20} y={lineY(box, i)} text={String(i + 1)} tone="soft" anchor="end" />)}
          {lines.map((l) => {
            const text = say(LINE[l.id]);
            return <Mono key={l.id} x={box.x + 30} y={lineY(box, l.slot)} opacity={l.opacity ?? 1} text={l.typed === undefined ? text : text.slice(0, Math.round(text.length * l.typed))} tone={l.quiet ? "soft" : "ink"} accent={l.accent} />;
          })}
        </g>
      </Panel>
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  /** 0 before the beat, its progress in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const win = (id: string, a: number, b: number) => ease.out(span(through(id), a, b));
  // What the story builds leaves under the loop's last moments, so the loop starts where it ends.
  const leaving = outro(f.tl, f.frame);

  // Beat 1: each `node` line, then its box. Beat 2: each `calls` line, then its arrow.
  const nodeTurn = (k: number) => turn(through("nodes"), k, 3, 0.05, 0.59, 0.8);
  const callTurn = (k: number) => turn(through("calls"), k, 2, 0.05, 0.45, 0.72);
  const nodeLine = (k: number) => ({ accent: nodeTurn(k).now, marked: nodeTurn(k).done * (1 - span(through("calls"), 0, 0.1)) });
  const callLine = (k: number) => ({ accent: callTurn(k).now, marked: callTurn(k).done * (1 - span(through("drift"), 0, 0.1)) });

  // Beat 3: the import is typed in at line 4. Beat 5: its `calls` line goes in above it.
  const pushedAgain = win("level", 0.04, 0.12) * leaving;
  const importTyped = span(through("drift"), 0.14, 0.4);
  const importAccent = span(through("drift"), 0.12, 0.16) * (1 - span(through("check"), 0, 0.08));
  const importMarked = span(through("check"), 0, 0.08) * (1 - span(through("board"), 0, 0.12));
  const callTyped = span(through("level"), 0.12, 0.3);
  const callAccent = span(through("level"), 0.1, 0.13) * (1 - span(through("board"), 0, 0.12));

  const codeLit = Math.max(f.lit("code"), f.lit("annotations"), f.lit("imports"));
  const cart: Shown[] = [
    { id: "cart-node", slot: 0, ...nodeLine(0) },
    { id: "cart-calls-orders", slot: 1, ...callLine(0) },
    { id: "cart-import-orders", slot: 2 },
    ...(importTyped > 0 ? [{ id: "cart-import-stock", slot: 3 + pushedAgain, typed: importTyped, accent: importAccent, marked: importMarked, opacity: leaving }] : []),
    ...(callTyped > 0 ? [{ id: "cart-calls-stock", slot: 3, typed: callTyped, accent: callAccent, opacity: leaving }] : []),
  ];
  const orders: Shown[] = [
    { id: "orders-node", slot: 0, ...nodeLine(1) },
    { id: "orders-calls-stock", slot: 1, ...callLine(1) },
    { id: "orders-import-stock", slot: 2 },
  ];
  const stock: Shown[] = [{ id: "stock-node", slot: 0, ...nodeLine(2) }, { id: "stock-shelf", slot: 1, quiet: true }];

  // The map: boxes, then arrows, then the one it lacks.
  const mapLit = f.lit("map");
  const box = (id: string, k: number) => ({ here: ease.out(span(nodeTurn(k).t, 0.04, 0.4)) * leaving, accent: nodeTurn(k).now });
  const drawn = (k: number) => ({ progress: ease.out(span(callTurn(k).t, 0.05, 0.7)), accent: callTurn(k).now });
  const missing = win("check", 0.22, 0.4) * (1 - span(through("level"), 0.32, 0.4));
  const declared = win("level", 0.32, 0.46);
  const declaredAccent = span(through("level"), 0.32, 0.35) * (1 - span(through("board"), 0, 0.12));

  // The terminal: the map written, the check failing, the map written again.
  const termLit = Math.max(f.lit("checker"), 0.45);
  // Once the code has moved on, what the last run printed is no longer true of it: the prompt waits.
  const wrote = 1 - span(through("drift"), 0.02, 0.12);
  const phaseA = Math.max(wrote, 1 - leaving);
  const idle = span(through("drift"), 0.1, 0.16) * (1 - span(through("check"), 0.02, 0.05));
  const phaseB = span(through("check"), 0.04, 0.06) * (1 - span(through("level"), 0.24, 0.28));
  const phaseC = span(through("level"), 0.28, 0.32) * leaving;
  const tx = TERM.x + 12, exitX = TERM.x + TERM.width - 12;
  /** A command as far as it has been typed: the prompt is there before the first key. */
  const typedOf = (row: Row, share: number) => say(row).slice(0, Math.max(1, Math.round(say(row).length * share)));

  // The board: the same three cards, last.
  const boardLit = f.lit("board");
  const landed = win("board", 0.2, 0.42) * leaving;
  const publishing = f.moving("publish");

  const edge = (id: string, progress: number, accent: number, dashed = false) => {
    const e = EDGES[id], from = String(e.from), to = String(e.to);
    const level = AT[from][1] === AT[to][1];
    const a: P2 = level ? [AT[from][0] + CARD.width, AT[from][1] + CARD.height / 2] : bottom(from);
    const b: P2 = level ? [AT[to][0], AT[to][1] + CARD.height / 2] : top(to);
    return <Elbow from={a} to={b} first={level ? "h" : "v"} via={level ? undefined : GAP_Y} radius={8} progress={progress} accent={accent} dashed={dashed} lit={0.2 + 0.8 * mapLit} />;
  };
  const words = (id: string, here: number, accent: number) => here > 0 ? (
    <text className="pt-tag" x={WORDS[id][0]} y={WORDS[id][1]} textAnchor="middle" opacity={r(here * (0.55 + 0.45 * mapLit))}
      style={{ fill: accent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>{String(EDGES[id].label)}</text>
  ) : null;

  return (
    <g>
      {/* The code: three files, each the top of what the scratch repo holds */}
      <File box={CART} name="cart/index.mjs" lines={cart} lit={codeLit} />
      <File box={ORDERS} name="orders/index.mjs" lines={orders} lit={codeLit} />
      <File box={STOCK} name="stock/index.mjs" lines={stock} lit={codeLit} />

      {/* The map: the committed file, drawn as the diagram it describes */}
      <text className="pt-label" x={MAP.x + 2} y={MAP.y - 7} opacity={r(0.6 + 0.4 * mapLit)}>System map</text>
      <text className="pt-tag" x={MAP.x + MAP.width - 2} y={MAP.y - 7} textAnchor="end" opacity={r(0.6 + 0.4 * mapLit)}>diagrams/system-map.json</text>
      <Panel box={MAP} lit={Math.max(mapLit, 0.35)}>
        {Object.entries(ROW).map(([layer, y]) => (
          <text key={layer} className="pt-tag" x={MAP.x + 10} y={y + CARD.height / 2 + 3} opacity={r(0.6 + 0.4 * mapLit)}>{layer}</text>
        ))}
        <g opacity={r(leaving)}>
          {missing > 0 ? <g opacity={r(Math.min(1, missing * 3))}>{edge("cart-stock", missing, 1, true)}</g> : null}
          {edge("cart-stock", declared, declaredAccent)}
          {edge("cart-orders", drawn(0).progress, drawn(0).accent)}
          {edge("orders-stock", drawn(1).progress, drawn(1).accent)}
          {words("cart-orders", span(drawn(0).progress, 0.6, 1), drawn(0).accent)}
          {words("orders-stock", span(drawn(1).progress, 0.6, 1), drawn(1).accent)}
          {words("cart-stock", span(declared, 0.6, 1), declaredAccent)}
          {missing > 0 ? (
            <text className="pt-tag" x={WORDS["cart-stock"][0]} y={WORDS["cart-stock"][1]} textAnchor="middle" opacity={r(span(missing, 0.7, 1) * (1 - span(through("level"), 0.3, 0.36)))}
              style={{ fill: "var(--pt-accent-ink)" }}>not on the map</text>
          ) : null}
        </g>
        {NODES.map((n, k) => {
          const id = String(n.id), { here, accent } = box(id, k), [x, y] = AT[id];
          if (here <= 0) return null;
          const ink = mix("var(--pt-line)", "var(--pt-line-2)", 0.2 + 0.8 * mapLit);
          return (
            <g key={id} opacity={r(here)} transform={`translate(0 ${r((1 - here) * 6)})`}>
              <rect x={x} y={y} width={CARD.width} height={CARD.height} rx={5}
                style={{ fill: accent > 0 ? mix("var(--pt-accent-soft)", "var(--pt-bg)", accent) : "var(--pt-bg)", stroke: accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink, strokeWidth: accent > 0.5 ? 1.5 : 1 }} />
              <g opacity={r(0.55 + 0.45 * mapLit)} style={flat}>
                <text className="pt-label" x={x + CARD.width / 2} y={y + 17} textAnchor="middle">{String(n.title)}</text>
                <text className="pt-tag" x={x + CARD.width / 2} y={y + 30} textAnchor="middle">{String(n.path)}/</text>
              </g>
            </g>
          );
        })}
      </Panel>

      {/* The check: what the script printed, and how it exited */}
      <text className="pt-label" x={TERM.x + 2} y={TERM.y - 7} opacity={r(0.6 + 0.4 * termLit)}>The check</text>
      <text className="pt-tag" x={TERM.x + TERM.width - 2} y={TERM.y - 7} textAnchor="end" opacity={r(0.6 + 0.4 * termLit)}>run as the turn ends, by diagrams-sync, and in CI</text>
      <Panel box={TERM} radius={6} lit={Math.max(termLit, 0.35)}>
        <g opacity={r(0.55 + 0.45 * termLit)}>
          {phaseA > 0 ? (
            <g opacity={r(phaseA)}>
              <Mono x={tx} y={lineY(TERM, 0)} text={say(OUT.write)} />
              <Mono x={tx} y={lineY(TERM, 1)} text={say(OUT.clean)} tone="soft" opacity={wrote > 0 && through("level") <= 0 ? win("calls", 0.38, 0.46) : 0} />
              <Mono x={exitX} y={lineY(TERM, 1)} text={`exit ${OUT.clean.exit}`} tone="soft" anchor="end" opacity={wrote > 0 && through("level") <= 0 ? win("calls", 0.38, 0.46) : 0} />
            </g>
          ) : null}
          <Mono x={tx} y={lineY(TERM, 0)} text="$" opacity={idle} />
          {phaseB > 0 ? (
            <g opacity={r(phaseB)}>
              <Mono x={tx} y={lineY(TERM, 0)} text={typedOf(OUT.check, span(through("check"), 0.05, 0.18))} />
              <g opacity={r(win("check", 0.2, 0.28))}>
                <Strip box={TERM} y={lineY(TERM, 1)} marked={1} inset={6} />
                <Strip box={TERM} y={lineY(TERM, 2)} marked={1} inset={6} />
                <Mono x={tx} y={lineY(TERM, 1)} text={say(OUT.finding)} />
                <Mono x={tx} y={lineY(TERM, 2)} text={say(OUT["finding-more"])} />
              </g>
              <Mono x={tx} y={lineY(TERM, 3)} text={say(OUT.failed)} tone="soft" opacity={win("check", 0.3, 0.38)} />
              <Mono x={exitX} y={lineY(TERM, 3)} text={`exit ${OUT.failed.exit}`} accent={1} anchor="end" opacity={win("check", 0.3, 0.38)} />
            </g>
          ) : null}
          {phaseC > 0 ? (
            <g opacity={r(phaseC)}>
              <Mono x={tx} y={lineY(TERM, 0)} text={typedOf(OUT.write, span(through("level"), 0.28, 0.36))} />
              <Mono x={tx} y={lineY(TERM, 1)} text={say(OUT.clean)} tone="soft" opacity={win("level", 0.4, 0.46)} />
              <Mono x={exitX} y={lineY(TERM, 1)} text={`exit ${OUT.clean.exit}`} tone="soft" anchor="end" opacity={win("level", 0.4, 0.46)} />
              <Mono x={tx} y={lineY(TERM, 2)} text={say(OUT.stat)} opacity={win("level", 0.56, 0.62)} />
              <Mono x={tx} y={lineY(TERM, 3)} text={say(OUT["stat-map"])} tone="soft" opacity={win("level", 0.64, 0.7)} />
            </g>
          ) : null}
        </g>
      </Panel>

      {/* The board: the same map, drawn where people look */}
      <text className="pt-label" x={BOARD.x + 2} y={BOARD.y - 7} opacity={r(0.6 + 0.4 * boardLit)}>Miro board</text>
      <text className="pt-tag" x={PUBLISH_X + 9} y={MAP.y + MAP.height + 18} opacity={r(0.5 + 0.5 * boardLit)}>publish</text>
      <Elbow from={[PUBLISH_X, MAP.y + MAP.height]} to={[PUBLISH_X, BOARD.y]} first="v" quiet lit={Math.max(boardLit, 0.3)}
        pulse={publishing > 0 ? ease.out(span(p, 0.04, 0.3)) : undefined} pulseLength={0.4} />
      <Panel box={BOARD} radius={6} lit={Math.max(boardLit, 0.35)} accent={f.on("board")}>
        {landed > 0 ? (
          <g opacity={r(landed)}>
            <Elbow from={[mini("cart").x + mini("cart").width / 2, mini("cart").y + mini("cart").height]} to={[mini("orders").x + mini("orders").width / 2, mini("orders").y]} first="v" radius={4} quiet />
            <Elbow from={[mini("cart").x + mini("cart").width / 2, mini("cart").y + mini("cart").height]} to={[mini("stock").x + mini("stock").width / 2, mini("stock").y]} first="v" radius={4} quiet />
            <Elbow from={[mini("orders").x + mini("orders").width, mini("orders").y + mini("orders").height / 2]} to={[mini("stock").x, mini("stock").y + mini("stock").height / 2]} quiet />
            {CARDS.map((c) => {
              const b = mini(String(c.id));
              return <rect key={String(c.id)} x={r(b.x)} y={r(b.y)} width={r(b.width)} height={r(b.height)} rx={3} style={{ fill: "var(--pt-bg)", stroke: "var(--pt-line)", strokeWidth: 1 }} />;
            })}
          </g>
        ) : null}
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
