"use client";
// two-folders: your project holds the studio root, which holds diagram.json
// and compiled.js; the published workflow sits in the project, outside the
// studio root. The canvas and the agent both write the one diagram.json; the
// server sees the change and the canvas reloads; only Publish crosses out.
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import { Label } from "../kit/label";
import { ease, indexOf, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 456 };

// The layout, in px.
const SERVER: Box = { x: 20, y: 20, width: 170, height: 52 };
const CANVAS: Box = { x: 20, y: 128, width: 170, height: 184 };
const AGENT: Box = { x: 500, y: 16, width: 180, height: 70 };
const PROJECT: Box = { x: 214, y: 104, width: 530, height: 340 };
const STUDIO: Box = { x: 244, y: 140, width: 236, height: 286 };
const DIAGRAM: Box = { x: 312, y: 170, width: 128, height: 96 };
const COMPILED: Box = { x: 312, y: 290, width: 128, height: 92 };
const PUBLISHED: Box = { x: 590, y: 290, width: 128, height: 92 };
const COMPILE_BTN: Box = { x: 30, y: 284, width: 64, height: 18 };
const PUBLISH_BTN: Box = { x: 104, y: 284, width: 64, height: 18 };

// The folders' faces: the studio root a step darker than the project around it, the page outside both.
const PROJECT_FACE = mix("var(--pt-left)", "var(--pt-bg)", 0.45);
const STUDIO_FACE = "var(--pt-left)";

// The little graph both editors show: A wired to B. The canvas adds C (after A); the agent adds D (after B).
const NODES = { a: [0, 0], b: [30, -16], c: [30, 16], d: [60, -16] } as const;
type NodeId = keyof typeof NODES;
const NW = 20, NH = 10;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A folder: a filled frame with a small tab on its top left. */
function Folder({ box, face }: { box: Box; face: string }) {
  const { x, y, width: w, height: h } = box;
  const r = 6, tw = 58, th = 8;
  const d = `M ${x} ${y + r} L ${x} ${y + h - r} Q ${x} ${y + h} ${x + r} ${y + h} L ${x + w - r} ${y + h} Q ${x + w} ${y + h} ${x + w} ${y + h - r} ` +
    `L ${x + w} ${y + r} Q ${x + w} ${y} ${x + w - r} ${y} L ${x + tw + th} ${y} L ${x + tw} ${y - th} L ${x + r} ${y - th} Q ${x} ${y - th} ${x} ${y - th + r} Z`;
  return <path className="pt-edge" d={d} style={{ fill: face, stroke: "var(--pt-ink-3)" }} />;
}

/** A page: a sheet with its top right corner folded. */
function Page({ box, name, here = 1, lit = 1, accent = 0, children }: {
  box: Box; name: string; here?: number; lit?: number; accent?: number; children?: React.ReactNode;
}) {
  if (here <= 0) return null;
  const { x, y, width: w, height: h } = box;
  const fold = 14;
  const ink = mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * lit);
  const stroke = accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink;
  return (
    <g opacity={r2(here)} style={{ ["--pt-halo" as string]: "var(--pt-top)" }}>
      <path className="pt-panel" d={`M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + h} L ${x} ${y + h} Z`} style={{ stroke, strokeWidth: accent > 0.5 ? 1.5 : 1 }} />
      <path className="pt-edge" d={`M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold}`} style={{ stroke }} />
      <text className="pt-tag" x={x + 9} y={y + 16} style={{ fill: "var(--pt-ink)" }}>{name}</text>
      {children}
    </g>
  );
}

/** A step a writer added: orange while it is the news, then the writer's own hue. */
type Edit = { here: number; hot: number; hue: string };

/** The graph as both editors draw it. */
function Graph({ x, y, s, c, d }: { x: number; y: number; s: number; c: Edit; d: Edit }) {
  const at = (n: NodeId): [number, number] => [x + NODES[n][0] * s, y + NODES[n][1] * s];
  const out = (n: NodeId): [number, number] => [at(n)[0] + NW * s, at(n)[1] + (NH * s) / 2];
  const inn = (n: NodeId): [number, number] => [at(n)[0], at(n)[1] + (NH * s) / 2];
  const colour = (e: Edit | null, base: string) => (!e ? base : mix("var(--pt-accent)", mix(e.hue, base, 0.85), e.hot));
  const wire = (from: NodeId, to: NodeId, e: Edit | null) => {
    const here = e ? e.here : 1;
    if (here <= 0) return null;
    const [x1, y1] = out(from), [x2, y2] = inn(to), mx = (x1 + x2) / 2;
    return <path className="pt-edge" d={`M ${r2(x1)} ${r2(y1)} C ${r2(mx)} ${r2(y1)} ${r2(mx)} ${r2(y2)} ${r2(x2)} ${r2(y2)}`} opacity={r2(here)} style={{ stroke: colour(e, "var(--pt-ink-2)"), strokeWidth: e ? 1.5 : 1 }} />;
  };
  const node = (n: NodeId, e: Edit | null) => {
    const here = e ? e.here : 1;
    if (here <= 0) return null;
    const [nx, ny] = at(n);
    const fill = !e ? "var(--pt-left)" : mix("var(--pt-accent)", mix(e.hue, "var(--pt-top)", 0.22), e.hot);
    return <rect x={r2(nx)} y={r2(ny)} width={r2(NW * s)} height={r2(NH * s)} rx={2} opacity={r2(here)} style={{ fill, stroke: colour(e, "var(--pt-line-2)"), strokeWidth: 1 }} />;
  };
  return (
    <g>
      {wire("a", "b", null)}
      {wire("a", "c", c)}
      {wire("b", "d", d)}
      {node("a", null)}
      {node("b", null)}
      {node("c", c)}
      {node("d", d)}
    </g>
  );
}

/** Words on a box: its name and its note. Only the two writers carry a dot: their hue is the hue of the step each adds. */
function Named({ entity, box }: { entity: string; box: Box }) {
  const e = model.entities.find((x) => x.id === entity);
  return <Label entity={entity} at={[box.x + 13, box.y + 16]} dx={e?.hue ? 9 : 0} dy={4} anchor="start" leader={false} dot={!!e?.hue} sub={e?.note} />;
}

/** A button on the canvas, pressed (dark) while `down`. */
function Button({ box, word, down, lit }: { box: Box; word: string; down: number; lit: number }) {
  const edge = mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * lit);
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={4} style={{ fill: mix("var(--pt-ink)", "var(--pt-top)", down * 0.85), stroke: down > 0.5 ? "var(--pt-ink)" : edge, strokeWidth: 1 }} />
      <text className="pt-tag" x={box.x + box.width / 2} y={box.y + 12.5} textAnchor="middle" style={{ fill: down > 0.5 ? "var(--pt-bg)" : "var(--pt-ink)", stroke: "none" }}>{word}</text>
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  const within = (id: string) => (index < at(id) ? 0 : index === at(id) ? p : 1);
  const now = (id: string) => (index === at(id) ? 1 : 0);

  const draw = within("draw"), hand = within("handedit"), sync = within("sync"), pub = within("publish"), comp = within("compile");
  const BLUE = "var(--pt-hue-blue)", VIOLET = "var(--pt-hue-violet)";

  // The two edits, the same kind of thing from two writers: each adds one step, and lands first where its writer works.
  const cCanvas: Edit = { here: ease.out(span(draw, 0.04, 0.16)), hot: now("draw") * (1 - span(draw, 0.34, 0.44)), hue: BLUE };
  const cDisk: Edit = { here: ease.out(span(draw, 0.38, 0.46)), hot: now("draw") * span(draw, 0.38, 0.46), hue: BLUE };
  const dDisk: Edit = { here: ease.out(span(hand, 0.38, 0.46)), hot: now("handedit") * span(hand, 0.38, 0.46) + now("sync") * (1 - span(sync, 0.02, 0.12)), hue: VIOLET };
  const dCanvas: Edit = { here: ease.out(span(sync, 0.38, 0.46)), hot: now("sync") * span(sync, 0.38, 0.46), hue: VIOLET };

  // Pulses: one trip each, done by the middle of the beat.
  const pulse = (beat: string, a: number, b: number) => (index === at(beat) ? span(p, a, b) : undefined);
  // A wire is dark only while it carries something, and everything is lit while the loop rests.
  const wireLit = (flow: string) => Math.max(f.moving(flow), f.on("rest"));
  const tagOpacity = (flow: string, here = 1) => r2(here * (0.55 + 0.45 * wireLit(flow)));

  // The person presses Compile, then Publish (and confirms it). Pressed early in the beat, let go after its middle.
  const press = (beat: string, b: number) => now(beat) * ease.out(span(b, 0.02, 0.1)) * (1 - span(b, 0.7, 0.8));
  const confirmed = now("publish") * ease.out(span(pub, 0.04, 0.12)) * (1 - span(pub, 0.7, 0.8));

  const compiledHere = f.here("compiled");
  const publishedHere = f.here("published");

  return (
    <g opacity={f.present}>
      {/* The two folders: the project, and the studio root inside it. The editors and the server sit outside both. */}
      <Folder box={PROJECT} face={PROJECT_FACE} />
      <Folder box={STUDIO} face={STUDIO_FACE} />
      <g style={{ ["--pt-halo" as string]: PROJECT_FACE }}>
        <Label entity="project" sub="Publish never writes outside it" at={[PROJECT.x + PROJECT.width - 12, PROJECT.y + 20]} dot={false} leader={false} anchor="end" dx={0} dy={0} />
      </g>
      <g style={{ ["--pt-halo" as string]: STUDIO_FACE }}>
        <Label entity="studio" sub="Compile writes only in here" at={[STUDIO.x + 12, STUDIO.y + STUDIO.height - 12]} dot={false} leader={false} anchor="start" dx={0} dy={-6} />
      </g>

      {/* Wires, under the shapes they join. Save and load go through the server; drawn straight, and said so. */}
      <Elbow from={[CANVAS.x + CANVAS.width, 196]} to={[DIAGRAM.x, 196]} pulse={pulse("draw", 0.12, 0.4)} lit={wireLit("autosave")} />
      <Elbow from={[AGENT.x + 40, AGENT.y + AGENT.height]} to={[DIAGRAM.x + DIAGRAM.width, 218]} first="v" via={218} pulse={pulse("handedit", 0.08, 0.4)} lit={wireLit("handedit")} />
      <Elbow from={[416, DIAGRAM.y]} to={[SERVER.x + SERVER.width, 46]} first="v" via={46} quiet pulse={pulse("sync", 0.04, 0.2)} lit={wireLit("watch")} />
      <Elbow from={[105, SERVER.y + SERVER.height]} to={[105, CANVAS.y]} first="v" quiet pulse={pulse("sync", 0.18, 0.28)} lit={wireLit("notify")} />
      <Elbow from={[DIAGRAM.x, 240]} to={[CANVAS.x + CANVAS.width, 240]} dashed quiet pulse={pulse("sync", 0.26, 0.4)} lit={wireLit("reload")} />
      <Elbow from={[CANVAS.x + CANVAS.width, 293]} to={[COMPILED.x, 336]} via={229} pulse={pulse("compile", 0.1, 0.38)} lit={wireLit("compile")} progress={f.laid("compile")} />
      <Elbow from={[COMPILED.x + COMPILED.width, 336]} to={[PUBLISHED.x, 336]} pulse={pulse("publish", 0.12, 0.4)} lit={wireLit("publish")} progress={f.laid("publish")} />

      {/* Wire words. */}
      <text className="pt-tag" x={278} y={176} textAnchor="middle" opacity={tagOpacity("autosave")} style={{ ["--pt-halo" as string]: STUDIO_FACE }}>save</text>
      <text className="pt-tag" x={278} y={187} textAnchor="middle" opacity={tagOpacity("autosave")} style={{ ["--pt-halo" as string]: STUDIO_FACE }}>via server</text>
      <text className="pt-tag" x={278} y={254} textAnchor="middle" opacity={tagOpacity("reload")} style={{ ["--pt-halo" as string]: STUDIO_FACE }}>load</text>
      <text className="pt-tag" x={278} y={265} textAnchor="middle" opacity={tagOpacity("reload")} style={{ ["--pt-halo" as string]: STUDIO_FACE }}>via server</text>
      <text className="pt-tag" x={300} y={40} textAnchor="middle" opacity={tagOpacity("watch")}>change</text>
      <text className="pt-tag" x={112} y={104} textAnchor="start" opacity={tagOpacity("notify")}>studio:changed</text>
      <text className="pt-tag" x={548} y={176} textAnchor="start" opacity={tagOpacity("handedit")} style={{ ["--pt-halo" as string]: PROJECT_FACE }}>hand edit</text>
      <text className="pt-tag" x={278} y={350} textAnchor="middle" opacity={tagOpacity("compile", compiledHere)} style={{ ["--pt-halo" as string]: STUDIO_FACE }}>compile</text>
      <text className="pt-tag" x={509} y={328} textAnchor="middle" opacity={tagOpacity("publish", publishedHere)} style={{ ["--pt-halo" as string]: PROJECT_FACE }}>publish</text>

      {/* The editors and the server. */}
      <Panel box={SERVER} lit={f.lit("server")} />
      <Named entity="server" box={SERVER} />
      <Panel box={AGENT} lit={f.lit("agent")} />
      <Named entity="agent" box={AGENT} />
      <text className="pt-tag" x={AGENT.x + 22} y={AGENT.y + 58}>using /workflow</text>
      <Panel box={CANVAS} lit={f.lit("canvas")} />
      <Named entity="canvas" box={CANVAS} />
      <path className="pt-rule" d={`M ${CANVAS.x} ${CANVAS.y + 46} L ${CANVAS.x + CANVAS.width} ${CANVAS.y + 46}`} />
      <Graph x={46} y={222} s={1.6} c={cCanvas} d={dCanvas} />
      <g style={{ ["--pt-halo" as string]: "var(--pt-top)" }}>
        <Button box={COMPILE_BTN} word="Compile" down={press("compile", comp)} lit={f.lit("canvas")} />
        <Button box={PUBLISH_BTN} word="Publish" down={press("publish", pub)} lit={f.lit("canvas")} />
        <text className="pt-tag" x={PUBLISH_BTN.x + PUBLISH_BTN.width} y={PUBLISH_BTN.y - 6} textAnchor="end" opacity={r2(confirmed)}>confirmed: OK</text>
      </g>

      {/* The files. */}
      <Page box={DIAGRAM} name="diagram.json" lit={f.lit("diagram")}>
        <Graph x={332} y={226} s={1.15} c={cDisk} d={dDisk} />
      </Page>
      <Page box={COMPILED} name="compiled.js" here={compiledHere} lit={f.lit("compiled")} accent={now("compile") * span(comp, 0.3, 0.38)}>
        <text className="pt-tag" x={COMPILED.x + 9} y={COMPILED.y + 44}>export const meta</text>
        <text className="pt-tag" x={COMPILED.x + 9} y={COMPILED.y + 62}>/* @workflow-graph</text>
      </Page>
      <Page box={PUBLISHED} name="my-workflow.js" here={publishedHere} lit={f.lit("published")} accent={now("publish") * span(pub, 0.12, 0.2)}>
        <text className="pt-tag" x={PUBLISHED.x + 9} y={PUBLISHED.y + 44}>export const meta</text>
        <text className="pt-tag" x={PUBLISHED.x + 9} y={PUBLISHED.y + 62}>/* @workflow-graph</text>
      </Page>
      <g style={{ ["--pt-halo" as string]: PROJECT_FACE }}>
        <Label entity="published" title=".claude/workflows/" sub="what Claude Code runs" at={[PUBLISHED.x + PUBLISHED.width / 2, PUBLISHED.y + PUBLISHED.height + 18]} dot={false} leader={false} dx={0} dy={0} />
        <text className="pt-tag" x={PUBLISHED.x + PUBLISHED.width / 2} y={PUBLISHED.y + PUBLISHED.height + 46} textAnchor="middle" opacity={publishedHere}>name set by exportPath</text>
      </g>
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
