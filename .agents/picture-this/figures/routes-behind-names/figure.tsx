"use client";
// names-and-routes: the plugin as a table. Inside the frame, the fourteen
// names a session lists; outside it, one tile per route, to the real counts.
// A person's typed line reaches start-here, which hands off to one area; an
// agent's call reaches the same row. The row opens into its named routes,
// and one of them fills: the only document read.
import type { Model, Row } from "../kit/model";
import { entity, flow, rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box } from "../kit/flat/geometry";
import { Bar, Panel } from "../kit/flat/panel";
import { ease, indexOf, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const VIEW = { x: 0, y: 0, width: 760, height: 434 };

// ── The model, read once ────────────────────────────────────────────────────
const AREAS = rows(model, "areas");
const ROUTES = rows(model, "routes");
const AREA = entity(model, "area").label;
const AI = AREAS.findIndex((a) => a.id === AREA);
const TOTAL = AREAS.reduce((n, a) => n + Number(a.routes), 0);
const TAKEN = ROUTES.findIndex((r) => r.taken === true);
const MOST = Math.max(...AREAS.map((a) => Number(a.routes)));
const [PREFIX, ROUTE_WORD] = (flow(model, "call").label ?? "").split(" ");

// ── The page ────────────────────────────────────────────────────────────────
const FS = 10, CW = FS * 0.6; // code type: mono, so a character is 0.6 of its size
const LIST_X = 236, LIST_W = 140; // the areas' frame
const DOOR: Box = { x: 186, y: 44, width: LIST_X + LIST_W - 186, height: 24 }; // start-here sticks out to the left
const Y0 = DOOR.y + DOOR.height / 2;
const PITCH = 22, FIRST = Y0 + 32, OPEN = 24; // an opened row gains a second line
const TILES_X = 392, TILE = { w: 12, h: 15, pitch: 19, ear: 4 };
const DROP_X = 208; // where the hand-off comes down, left of the areas' frame
const rowY = (i: number, open: number) => FIRST + i * PITCH + (i > AI ? open * OPEN : 0);
const Y2 = rowY(AI, 0);

// The opened row's chips: each route's name, in the table's order.
const CHIP_PAD = 5, CHIP_GAP = 4;
const chipW = (r: Row) => String(r.label).length * CW + CHIP_PAD * 2;
const CHIP_X: number[] = [];
ROUTES.reduce((x, r) => { CHIP_X.push(x); return x + chipW(r) + CHIP_GAP; }, TILES_X);

const PROMPT: Box = { x: 14, y: Y0 - 11, width: 146, height: 22 };
const CALL: Box = { x: 14, y: Y2 - 16, width: 176, height: 32 };
const INDEX: Box = { x: 14, y: 176, width: 112, height: 13 * 5 + 11 };
/** A page with its corner folded: a document. `ear` 0 is a plain box. */
const page = (x: number, y: number, w: number, h: number, ear: number) => `M ${r3(x)} ${r3(y)} H ${r3(x + w - ear)} L ${r3(x + w)} ${r3(y + ear)} V ${r3(y + h)} H ${r3(x)} Z`;

const code = { fontSize: FS, letterSpacing: 0 } as const;

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const after = (id: string) => (index < at(id) ? 0 : index === at(id) ? p : 1);
  // What the story has left stays readable: a tag at this floor is 4.4:1 on the page.
  const dim = (lit: number) => r3(0.86 + 0.14 * lit);

  const typed = ease.out(span(after("typed"), 0.02, 0.3));
  const hand = ease.out(span(after("handoff"), 0.04, 0.3));
  const open = ease.inOut(span(after("handoff"), 0.22, 0.46));
  const named = span(open, 0.86, 1);
  const hook = ease.out(span(after("index"), 0.02, 0.3));
  const told = ease.out(span(after("index"), 0.16, 0.4));
  const call = ease.out(span(after("called"), 0.04, 0.34));
  const read = ease.out(span(after("read"), 0.06, 0.36));
  const filled = ease.out(span(after("read"), 0.3, 0.44));
  const count = f.level("taken") >= 0.5 ? 1 : 0;

  const onArea = f.on("handoff", "called", "read", "rest");
  const listBottom = rowY(AREAS.length - 1, open) + 13;
  const LIST: Box = { x: LIST_X, y: FIRST - 13, width: LIST_W, height: listBottom - (FIRST - 13) };
  const shipX = CHIP_X[TAKEN] + chipW(ROUTES[TAKEN]) / 2;

  return (
    <g opacity={f.present}>
      {/* What a session lists: fourteen names. */}
      <text className="pt-label" x={DOOR.x} y={28}>agentcraft lists</text>
      <text className="pt-tag" x={DOOR.x + 126} y={28}>14 names</text>
      <rect className="pt-panel" x={DOOR.x} y={DOOR.y} width={DOOR.width} height={DOOR.height} rx={6}
        style={{ stroke: mix("var(--pt-accent)", mix("var(--pt-line)", "var(--pt-line-2)", f.on("listed")), f.on("listed", "typed", "handoff")), fill: mix("var(--pt-accent-soft)", "var(--pt-top)", f.on("typed", "handoff")) }} />
      <text className="pt-tag" x={DOOR.x + 10} y={Y0 + 3.5} style={{ ...code, fill: "var(--pt-ink)", fontWeight: 700, ["--pt-halo" as string]: "transparent" }}>start-here</text>
      <text className="pt-tag" x={DOOR.x + DOOR.width - 8} y={Y0 + 3.5} textAnchor="end" style={{ ["--pt-halo" as string]: "transparent" }}>typed by a person</text>
      <Panel box={LIST} radius={6} accent={f.on("listed")}>
        {AREAS.map((a, i) => {
          const y = rowY(i, open), mine = i === AI;
          return (
            <g key={String(a.id)}>
              {mine && onArea > 0 ? <rect x={LIST.x + 1} y={y - 11} width={LIST.width - 2} height={22 + open * OPEN} style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", onArea) }} /> : null}
              <text className="pt-tag" x={LIST.x + 10} y={y + 3.5} style={{ ...code, fill: "var(--pt-ink)", fontWeight: mine ? 700 : 500, ["--pt-halo" as string]: "transparent" }}>{String(a.label)}</text>
              {mine && named > 0 ? <text className="pt-tag" x={LIST.x + 10} y={r3(y + open * OPEN + 1)} opacity={r3(named)} style={{ ["--pt-halo" as string]: "transparent" }}>SKILL.md: {ROUTES.length} routes</text> : null}
            </g>
          );
        })}
      </Panel>
      <text className="pt-tag" x={LIST.x} y={listBottom + 18}>13 areas: an agent calls one by name.</text>
      <text className="pt-tag" x={LIST.x} y={listBottom + 31}>Typed by a person, the host refuses it.</text>

      {/* What is on disk: one tile per route, never listed. */}
      <text className="pt-label" x={TILES_X} y={28}>Routes</text>
      <text className="pt-tag" x={TILES_X + 56} y={28}>{TOTAL} documents on disk, none listed</text>
      <text className="pt-tag" x={VIEW.width - 14} y={28} textAnchor="end" style={{ fill: count ? "var(--pt-accent-ink)" : "var(--pt-ink-2)", fontWeight: count ? 700 : 500 }}>read: {count} of {TOTAL}</text>
      {typed > 0 ? <text className="pt-tag" x={TILES_X} y={Y0 + 3.5} opacity={r3(typed)}>{entity(model, "start").note}</text> : null}
      {AREAS.map((a, i) => {
        const y = rowY(i, open), n = Number(a.routes);
        if (i === AI) return null;
        return (
          <g key={String(a.id)}>
            {Array.from({ length: n }, (_, k) => (
              <path key={k} className="pt-panel" d={page(TILES_X + k * TILE.pitch, y - TILE.h / 2, TILE.w, TILE.h, TILE.ear)} style={{ strokeLinejoin: "round", stroke: "var(--pt-ink-3)" }} />
            ))}
            <text className="pt-num" x={TILES_X + n * TILE.pitch + 4} y={y + 3.5}>{n}</text>
          </g>
        );
      })}
      {/* The called area's row: its tiles widen into named routes, and one is read. */}
      {ROUTES.map((r, k) => {
        const x = lerp(TILES_X + k * TILE.pitch, CHIP_X[k], open), w = lerp(TILE.w, chipW(r), open), h = lerp(TILE.h, 16, open);
        const mine = k === TAKEN, fill = mine ? filled : 0;
        return (
          <g key={String(r.id)}>
            <path className="pt-panel" d={page(x, Y2 - h / 2, w, h, TILE.ear)}
              style={{ strokeLinejoin: "round", fill: fill > 0 ? mix("var(--pt-accent-soft)", "var(--pt-top)", fill) : undefined, stroke: fill > 0 ? "var(--pt-accent)" : mix("var(--pt-ink-2)", "var(--pt-ink-3)", named), strokeWidth: fill > 0 ? 1.5 + fill : undefined }} />
            {named > 0 ? <text className="pt-tag" x={r3(x + w / 2)} y={Y2 + 3.5} textAnchor="middle" opacity={r3(named)} style={{ ...code, fill: "var(--pt-ink)", fontWeight: mine ? 700 : 500, ["--pt-halo" as string]: "transparent" }}>{String(r.label)}</text> : null}
          </g>
        );
      })}
      {open < 0.12 ? <text className="pt-num" x={TILES_X + ROUTES.length * TILE.pitch + 4} y={Y2 + 3.5} opacity={r3(1 - open * 8)}>{ROUTES.length}</text> : null}
      {/* The read: from the area's table to the one route, by path. */}
      <Elbow from={[LIST_X + LIST_W, Y2 + OPEN - 2]} to={[shipX, Y2 + 9]} first="h" via={shipX} radius={6} progress={read} accent={f.on("read")} />
      {read > 0 ? (
        <g opacity={r3(read)}>
          <text className="pt-tag" x={shipX + 12} y={Y2 + OPEN + 1.5} style={{ ...code, fill: "var(--pt-ink)", fontWeight: 700 }}>{entity(model, "route").label}</text>
          <text className="pt-tag" x={shipX + 12 + entity(model, "route").label.length * CW + 10} y={Y2 + OPEN + 1.5}>{flow(model, "read").label}</text>
        </g>
      ) : null}

      {/* A person: the one thing they type. */}
      {typed > 0 ? (
        <g opacity={r3(typed * dim(f.lit("person")))}>
          <text className="pt-label" x={PROMPT.x} y={PROMPT.y - 8}>{entity(model, "person").label}</text>
          <rect className="pt-panel" x={PROMPT.x} y={PROMPT.y} width={PROMPT.width} height={PROMPT.height} rx={5} style={{ stroke: mix("var(--pt-accent)", "var(--pt-line-2)", f.on("typed")) }} />
          <text className="pt-tag" x={PROMPT.x + 9} y={Y0 + 3.5} style={{ ...code, fill: "var(--pt-ink)", ["--pt-halo" as string]: "transparent" }}>{flow(model, "type").label}</text>
        </g>
      ) : null}
      <Line from={[PROMPT.x + PROMPT.width, Y0]} to={[DOOR.x - 1, Y0]} progress={typed} head quiet={false} accent={f.on("typed")} lit={f.lit("person")} />

      {/* The hand-off: start-here calls one area, once. */}
      <Elbow from={[DROP_X, DOOR.y + DOOR.height]} to={[LIST_X - 1, Y2]} first="v" via={Y2} radius={7} progress={hand} accent={f.on("handoff")} lit={f.on("handoff", "rest") > 0 ? 1 : 0.4} />

      {hand > 0 ? <text className="pt-tag" x={DROP_X - 7} y={CALL.y - 8} textAnchor="end" opacity={r3(hand * dim(f.on("handoff", "rest")))}>{flow(model, "handoff").label}: calls the area</text> : null}

      {/* An agent: the area by name, the route as the first word. */}
      {hook > 0 ? (
        <g opacity={r3(hook * dim(f.lit("agent")))}>
          <text className="pt-label" x={CALL.x} y={CALL.y + CALL.height + 15}>{entity(model, "agent").label}</text>
          <rect className="pt-panel" x={CALL.x} y={CALL.y} width={CALL.width} height={CALL.height} rx={5} style={{ stroke: mix("var(--pt-accent)", "var(--pt-line-2)", f.on("called")) }} />
          <text className="pt-tag" x={CALL.x + 9} y={Y2 - 2.5} style={{ ...code, fill: call > 0 ? "var(--pt-ink)" : "var(--pt-ink-2)", ["--pt-halo" as string]: "transparent" }}>{PREFIX}</text>
          <text className="pt-tag" x={CALL.x + 9} y={Y2 + 10.5} style={{ ...code, fill: call > 0 ? "var(--pt-ink)" : "var(--pt-ink-2)", fontWeight: 700, ["--pt-halo" as string]: "transparent" }}>{ROUTE_WORD}</text>
          <text className="pt-tag" x={CALL.x + 9 + ROUTE_WORD.length * CW + 8} y={Y2 + 10.5} style={{ ["--pt-halo" as string]: "transparent" }}>the route, first word</text>
        </g>
      ) : null}
      <Line from={[CALL.x + CALL.width, Y2]} to={[LIST_X - 1, Y2]} progress={call} head quiet={false} accent={f.on("called")} lit={f.lit("agent")} />

      {/* The route index: one hook prints each area's routes by name. */}
      {hook > 0 ? (
        <g opacity={r3(hook * dim(f.lit("index")))}>
          <Panel box={INDEX} radius={5} accent={f.on("index")}>
            {AREAS.map((a, i) => (
              <Bar key={String(a.id)} box={{ x: INDEX.x + 8, y: INDEX.y + 7 + i * 5, width: 10 + (Number(a.routes) / MOST) * (INDEX.width - 26), height: 3 }} tone={i === AI ? "strong" : "mid"} radius={1.5} />
            ))}
          </Panel>
          <text className="pt-label" x={INDEX.x} y={INDEX.y + INDEX.height + 17}>{entity(model, "index").label}</text>
          <text className="pt-tag" x={INDEX.x} y={INDEX.y + INDEX.height + 31}>one hook prints it as a</text>
          <text className="pt-tag" x={INDEX.x} y={INDEX.y + INDEX.height + 43}>session starts: {TOTAL} names</text>
        </g>
      ) : null}
      <Line from={[INDEX.x + 40, INDEX.y]} to={[INDEX.x + 40, CALL.y + CALL.height + 22]} progress={told} head accent={f.on("index")} lit={f.lit("index")} />
      {told > 0 ? <text className="pt-tag" x={INDEX.x + 48} y={INDEX.y - 7} opacity={r3(told * dim(f.lit("index")))}>{flow(model, "names").label}</text> : null}
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
