"use client";
// drifted-to-organized: the repo drawn as what it is, a file listing, each
// source file with a bar as long as it has lines. The listing itself changes
// as the optimizer's three stages run: loose files slide into folders and two
// AGENTS.md hubs are written, pieces are carved out of the long file into
// files of their own (one turns a test red and goes back), and three thin
// modules fold into the client they wrap. Across the top is the run plan the
// person approved, which is also the order of the work; on the right, the
// check each change faces and the branch its commits land on.
//
// The listing is this figure's own: rows are placed here, from the clock,
// between one snapshot of the tree and the next.
import { Elbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box } from "../kit/flat/geometry";
import { Bar, Panel, toneFill } from "../kit/flat/panel";
import type { Model, Row } from "../kit/model";
import { rows } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { clamp, ease, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;

// ── The page ────────────────────────────────────────────────────────────────
const VIEW = { x: 0, y: 0, width: 760, height: 444 };
const PLAN: Box = { x: 16, y: 12, width: 728, height: 54 };
const TREE: Box = { x: 16, y: 94, width: 462, height: 337 };
const CHECK: Box = { x: 494, y: 94, width: 250, height: 168 };
const BRANCH: Box = { x: 494, y: 278, width: 250, height: 153 };

/** One row of the listing, and where its parts sit. */
const PITCH = 19;
const ROW0 = TREE.y + 7 + PITCH / 2;
const NAME_X = TREE.x + 28;
const INDENT = 16;
/** Where every file's bar starts, so lengths compare; px per line of code. */
const BAR_X = TREE.x + 188;
const PER_LINE = 0.1;
const BAR_H = 8;

// ── The model, read once ────────────────────────────────────────────────────
const by = (table: string) => new Map(rows(model, table).map((r) => [String(r.id), r]));
const FILES = by("files"), PIECES = by("pieces"), HUBS = by("hubs"), CHECKS = by("checks"), LIMITS = by("limits");
const STAGES = rows(model, "plan"), COMMITS = rows(model, "commits"), FAILURES = rows(model, "failures");
const num = (r: Row | undefined, key: string) => Number(r?.[key] ?? 0);
const GOD = num(FILES.get("invoice"), "lines"), GOD_END = num(FILES.get("invoice"), "ends");
const CLIENT = num(FILES.get("client"), "lines"), CLIENT_END = num(FILES.get("client"), "ends");
const TARGET = num(LIMITS.get("target"), "value"), REPAIRS = num(LIMITS.get("repairs"), "value");
const lines = (id: string) => num(PIECES.get(id) ?? FILES.get(id), "lines");
/** Where in the long file's bar each piece is cut from: its right end, at the time it is carved. */
const CUT_FROM: Record<string, number> = {
  pdfRender: GOD - lines("pdfRender"),
  taxRules: GOD - lines("taxRules"),
  dunning: GOD - lines("taxRules") - lines("dunning"),
};
const BEATS = model.beats.map((b) => b.id);

// ── The tree, as snapshots ──────────────────────────────────────────────────
// A snapshot is the listing at one moment: each row's id and how deep it sits,
// in the order `ls` gives. The figure draws the tree between two of them.
type Kind = "dir" | "file" | "hub";
const NODE: Record<string, { name: string; kind: Kind }> = {
  pkg: { name: "package.json", kind: "file" },
  exportOrders: { name: "exportOrders.ts", kind: "file" }, migrate: { name: "migrate.ts", kind: "file" }, invoice: { name: "invoice.ts", kind: "file" },
  client: { name: "client.ts", kind: "file" }, retry: { name: "retry.ts", kind: "file" }, send: { name: "send.ts", kind: "file" }, sign: { name: "sign.ts", kind: "file" },
  pdfRender: { name: "pdfRender.ts", kind: "file" }, taxRules: { name: "taxRules.ts", kind: "file" }, dunning: { name: "dunning.ts", kind: "file" },
  src: { name: "src/", kind: "dir" }, gateway: { name: "gateway/", kind: "dir" }, tests: { name: "tests/", kind: "dir" },
  scripts: { name: "scripts/", kind: "dir" }, billing: { name: "billing/", kind: "dir" },
  hubRoot: { name: "AGENTS.md", kind: "hub" }, hubSrc: { name: "AGENTS.md", kind: "hub" },
};
type Slot = readonly [id: string, depth: number];
const GATEWAY: Slot[] = [["gateway", 1], ["client", 2], ["retry", 2], ["send", 2], ["sign", 2]];
const DRIFTED: Slot[] = [["exportOrders", 0], ["invoice", 0], ["migrate", 0], ["pkg", 0], ["src", 0], ...GATEWAY, ["tests", 0]];
// Tidying, in the order it is drawn: the new folders open with a place for each file, the files
// travel into them, and the root closes over where they were.
const PLACE: Record<string, string> = { exportOrders: "placeA", migrate: "placeB", invoice: "placeC" };
const OPENED: Slot[] = [["exportOrders", 0], ["invoice", 0], ["migrate", 0], ["pkg", 0], ["scripts", 0], ["placeA", 1], ["placeB", 1], ["src", 0], ["billing", 1], ["placeC", 2], ...GATEWAY, ["tests", 0]];
const LANDED: Slot[] = [["leftA", 0], ["leftB", 0], ["leftC", 0], ["pkg", 0], ["scripts", 0], ["exportOrders", 1], ["migrate", 1], ["src", 0], ["billing", 1], ["invoice", 2], ...GATEWAY, ["tests", 0]];
const TIDIED: Slot[] = [["pkg", 0], ["scripts", 0], ["exportOrders", 1], ["migrate", 1], ["src", 0], ["billing", 1], ["invoice", 2], ...GATEWAY, ["tests", 0]];
const withBilling = (files: string[], gateway: Slot[] = GATEWAY): Slot[] => [
  ["hubRoot", 0], ["pkg", 0], ["scripts", 0], ["exportOrders", 1], ["migrate", 1], ["src", 0], ["hubSrc", 1],
  ["billing", 1], ...files.map((id): Slot => [id, 2]), ...gateway, ["tests", 0],
];
const HUBBED = withBilling(["invoice"]);
const TRIED = withBilling(["invoice", "pdfRender"]);
const ONE_OUT = withBilling(["invoice", "taxRules"]);
const SPLIT = withBilling(["dunning", "invoice", "taxRules"]);
const DEEP = withBilling(["dunning", "invoice", "taxRules"], [["gateway", 1], ["client", 2]]);

type Pos = { row: number; depth: number; o: number };
/**
 * The tree part of the way from one snapshot to the next. A row in both
 * travels (`move` says how far, per row); a row only in the second is shown
 * in place (`show`); a row only in the first stays where it was and goes (`hide`).
 */
function between(a: Slot[], b: Slot[], move: (id: string) => number, show = 1, hide = 0): Map<string, Pos> {
  const at = (s: Slot[]) => new Map(s.map(([id, depth], row) => [id, { row, depth }]));
  const from = at(a), to = at(b), out = new Map<string, Pos>();
  for (const [id, p] of from) {
    const q = to.get(id);
    out.set(id, q ? { row: lerp(p.row, q.row, move(id)), depth: lerp(p.depth, q.depth, move(id)), o: 1 } : { ...p, o: 1 - hide });
  }
  for (const [id, q] of to) if (!from.has(id)) out.set(id, { ...q, o: show });
  return out;
}

/** When, inside its beat, each thing happens: [from, to] as shares of the beat. Everything settles before the middle. */
const T = {
  plan: { found: [[0.04, 0.12], [0.13, 0.21], [0.22, 0.3]], yes: [0.34, 0.44] },
  tidy: { open: [0.03, 0.13], files: { exportOrders: [0.1, 0.2], migrate: [0.17, 0.27], invoice: [0.24, 0.34] } as Record<string, number[]>, close: [0.34, 0.44] },
  hubs: { room: [0.03, 0.14], written: [0.08, 0.2], lines: [0.14, 0.3], checks: [0.32, 0.36, 0.4], commit: [0.42, 0.49] },
  undone: { carve: [0.03, 0.13], checks: [0.15, 0.18, 0.21], failed: [0.2, 0.25], repairs: [0.26, 0.3, 0.34], back: [0.38, 0.48], close: [0.88, 0.98] },
  split: { carve: [[0.03, 0.13], [0.25, 0.35]], checks: [[0.14, 0.16, 0.18], [0.36, 0.38, 0.4]], commit: [[0.19, 0.24], [0.41, 0.47]] },
  deepen: { fold: { retry: [0.05, 0.2], send: [0.09, 0.24], sign: [0.13, 0.28] } as Record<string, number[]>, close: [0.21, 0.33], grow: [0.14, 0.3], checks: [0.35, 0.38, 0.41], commit: [0.43, 0.5] },
};

function treeAt(beat: string, p: number): Map<string, Pos> {
  const e = ([a, b]: number[]) => ease.out(span(p, a, b));
  // A new row is shown once the rows around it have made room, so no name is drawn over another.
  const late = ([a, b]: number[]) => e([a + (b - a) * 0.45, b]);
  if (beat === "plan") return between(DRIFTED, DRIFTED, () => 0);
  if (beat === "tidy") {
    if (p >= T.tidy.close[0]) {
      const tree = between(LANDED, TIDIED, () => e(T.tidy.close));
      for (const id of ["leftA", "leftB", "leftC"]) tree.delete(id);
      return tree;
    }
    const tree = between(DRIFTED, OPENED, () => e(T.tidy.open), late(T.tidy.open));
    for (const [id, place] of Object.entries(PLACE)) {
      const from = tree.get(id)!, to = tree.get(place)!, k = e(T.tidy.files[id]);
      tree.set(id, { row: lerp(from.row, to.row, k), depth: lerp(from.depth, to.depth, k), o: 1 });
      tree.delete(place);
    }
    return tree;
  }
  if (beat === "hubs") return between(TIDIED, HUBBED, () => e(T.hubs.room), e(T.hubs.written));
  if (beat === "undone") return p < 0.5 ? between(HUBBED, TRIED, () => e(T.undone.carve), late(T.undone.carve)) : between(TRIED, HUBBED, () => e(T.undone.close), 1, e(T.undone.close));
  if (beat === "split") return p < 0.22 ? between(HUBBED, ONE_OUT, () => e(T.split.carve[0]), late(T.split.carve[0])) : between(ONE_OUT, SPLIT, () => e(T.split.carve[1]), late(T.split.carve[1]));
  if (beat === "deepen") return between(SPLIT, DEEP, () => e(T.deepen.close));
  return between(DEEP, DEEP, () => 0);
}

// ── Small parts ─────────────────────────────────────────────────────────────
const r = (v: number) => Math.round(v * 100) / 100;
const thousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const onFace = { ["--pt-halo" as string]: "transparent" };
const ink = (accent: number, quiet = false) =>
  accent > 0 ? mix("var(--pt-accent-ink)", "var(--pt-ink)", accent) : quiet ? "var(--pt-ink-2)" : "var(--pt-ink)";
const fileName = (accent = 0, quiet = false) => ({ fontSize: 11, letterSpacing: 0, fill: ink(accent, quiet) });

/** A passed check, a failed one, or one not run yet: a tick, a cross, or an empty ring. */
function Mark({ x, y, k, failed = false }: { x: number; y: number; k: number; failed?: boolean }) {
  const stroke = { fill: "none", stroke: "var(--pt-ink)", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g>
      {k < 1 ? <circle cx={x} cy={y} r={4.5} opacity={r(1 - k)} style={{ fill: "none", stroke: "var(--pt-ink-3)", strokeDasharray: "2 2.4" }} /> : null}
      {k > 0 ? (
        <g opacity={r(k)}>
          {failed
            ? <path d={`M ${x - 3.6} ${y - 3.6} L ${x + 3.6} ${y + 3.6} M ${x + 3.6} ${y - 3.6} L ${x - 3.6} ${y + 3.6}`} style={{ ...stroke, strokeWidth: 2 }} />
            : <path d={`M ${x - 4} ${y + 0.2} L ${x - 1.2} ${y + 3.2} L ${x + 4.2} ${y - 3.4}`} style={stroke} />}
        </g>
      ) : null}
    </g>
  );
}

function Folder({ x, y }: { x: number; y: number }) {
  return <path d={`M ${x} ${y - 4} h 3.4 l 1.4 1.7 h 5.2 v 6.3 h -10 z`} style={{ fill: toneFill("mid"), stroke: "none" }} />;
}

/** A hub's mark: the diamond the root of a tree is drawn with. */
function Diamond({ x, y, accent = 0 }: { x: number; y: number; accent?: number }) {
  return <path d={`M ${x + 5} ${y - 4.6} l 4.6 4.6 l -4.6 4.6 l -4.6 -4.6 z`} style={{ fill: accent > 0 ? mix("var(--pt-accent)", "var(--pt-ink)", accent) : "var(--pt-ink)", stroke: "none" }} />;
}

// ── The scene ───────────────────────────────────────────────────────────────
function Scene() {
  const f = useFigure();
  const { beat, p } = f.frame;
  const id = beat.id, now = BEATS.indexOf(id);
  const is = (b: string) => id === b;
  const past = (b: string) => now > BEATS.indexOf(b);
  const e = ([a, b]: number[]) => ease.out(span(p, a, b));
  /** The accent while a beat tells something: up as it starts, down before the beat ends. */
  const told = ([a, b]: number[], off = [0.9, 1]) => e([a, b]) * (1 - span(p, off[0], off[1]));
  /** Something that happens in one beat and stays: 0 before, its course in the beat, 1 after. */
  const since = (b: string, window: number[]) => (is(b) ? e(window) : past(b) ? 1 : 0);

  const tree = treeAt(id, p);
  const y = (row: number) => ROW0 + row * PITCH;
  const rowY = (key: string) => y(tree.get(key)?.row ?? 0);

  // How far each piece is out of the long file: 0 still in it, 1 a file of its own.
  const out: Record<string, number> = {
    pdfRender: is("undone") ? e(T.undone.carve) - e(T.undone.back) : 0,
    taxRules: since("split", T.split.carve[0]),
    dunning: since("split", T.split.carve[1]),
  };
  const godLines = GOD - Object.keys(out).reduce((sum, key) => sum + lines(key) * out[key], 0);
  const clientLines = lerp(CLIENT, CLIENT_END, since("deepen", T.deepen.grow));
  const putBack = is("undone") ? e(T.undone.back) : 0;

  // What the beat is about: the one kind of thing in the accent.
  const accent: Record<string, number> = {
    exportOrders: is("tidy") ? told([0.1, 0.2]) : 0, migrate: is("tidy") ? told([0.1, 0.2]) : 0, invoice: is("tidy") ? told([0.1, 0.2]) : 0,
    hubRoot: is("hubs") ? told(T.hubs.written) : 0, hubSrc: is("hubs") ? told(T.hubs.written) : 0,
    pdfRender: is("undone") ? span(p, 0, 0.04) * (1 - span(p, 0.9, 0.98)) : 0,
    taxRules: is("split") ? clamp(out.taxRules * 4) * (1 - span(p, 0.92, 1)) : 0,
    dunning: is("split") ? clamp(out.dunning * 4) * (1 - span(p, 0.92, 1)) : 0,
    client: is("deepen") ? told([0.08, 0.2]) : 0,
  };

  // What the scan found, as a tint on the rows it found it in. It is gone when the work starts.
  const found = T.plan.found.map((window) => (is("plan") ? e(window) * (1 - span(p, 0.94, 1)) : 0));
  const said = STAGES.map((_, i) => since("plan", T.plan.found[i]));
  const yes = since("plan", T.plan.yes);
  const yesAccent = is("plan") ? told(T.plan.yes, [0.94, 1]) : 0;

  // The commits, and the stage each one closes.
  const landed = [since("hubs", T.hubs.commit), since("split", T.split.commit[0]), since("split", T.split.commit[1]), since("deepen", T.deepen.commit)];
  const done = [landed[0], landed[2], landed[3]];
  const current = is("tidy") || is("hubs") ? 0 : is("undone") || is("split") ? 1 : is("deepen") ? 2 : -1;
  const head = landed.reduce((n, k) => n + (k >= 0.5 ? 1 : 0), 0);

  // The check: which run is under way, and how each of its three steps came out.
  const runs: Record<string, { at: number[]; failed?: number }[]> = {
    hubs: [{ at: T.hubs.checks }],
    undone: [{ at: T.undone.checks, failed: 1 }],
    split: T.split.checks.map((at) => ({ at })),
    deepen: [{ at: T.deepen.checks }],
  };
  const run = (runs[id] ?? []).filter((x) => p >= x.at[0] - 0.03).pop();
  // Before a beat's first run, the last round's marks are still there, and clear as the beat starts.
  const carried = is("rest") ? 1 : past("hubs") ? 1 - span(p, 0, 0.04) : 0;
  const failedStep = run ? run.failed : is("split") ? 1 : undefined;
  const checked = (i: number) => (run ? ease.out(span(p, run.at[i], run.at[i] + 0.03)) : carried);
  const steps = ["smoke", "tests", past("hubs") ? "lint" : "gate"].map((key) => CHECKS.get(key)!);
  const failing = is("undone") && run ? e(T.undone.failed) * (1 - span(p, 0.92, 1)) : 0;
  const repaired = T.undone.repairs.map((at) => (is("undone") ? ease.out(span(p, at, at + 0.03)) : 0));
  const passed = run ? (run.failed === undefined ? ease.out(span(p, run.at[2] + 0.02, run.at[2] + 0.06)) : 0) : is("split") ? 0 : carried;

  // The target the long file is split down to: drawn while that stage runs.
  const target = is("split") ? e([0, 0.06]) : is("deepen") ? 1 - e([0, 0.12]) : 0;
  const targetX = BAR_X + TARGET * PER_LINE;
  const lastInBilling = Math.max(...["invoice", "pdfRender", "taxRules", "dunning"].map((key) => tree.get(key)?.row ?? 0));

  /** Is this file travelling to its folder right now? 0 at rest, 1 in flight. */
  const moving = (key: string) => {
    const k = is("tidy") && T.tidy.files[key] ? e(T.tidy.files[key]) : 0;
    return clamp(Math.min(k, 1 - k) * 12);
  };

  const flagged = (key: string) => {
    const of = String(FILES.get(key)?.of ?? "");
    return { loose: of === "loose" || key === "invoice" ? found[0] : 0, long: key === "invoice" ? found[1] : 0, thin: of === "thin" ? found[2] : 0 };
  };

  return (
    <g>
      {/* The run plan: what the person is shown, and then the order of the work */}
      <Panel box={PLAN}>
        <text className="pt-label" x={PLAN.x + 12} y={PLAN.y + 23}>Run plan</text>
        <text className="pt-tag" x={PLAN.x + 12} y={PLAN.y + 41}>read-only scan</text>
        {STAGES.map((stage, i) => {
          const x = PLAN.x + 118 + i * 168, cy = PLAN.y + 19;
          const on = current === i ? 1 : 0, closed = done[i];
          return (
            <g key={String(stage.id)}>
              {on ? <rect x={x - 6} y={PLAN.y + 5} width={162} height={PLAN.height - 10} rx={5} style={{ fill: "var(--pt-left)" }} /> : null}
              <circle cx={x + 8} cy={cy} r={7} style={{ fill: closed > 0 ? mix("var(--pt-ink)", "var(--pt-top)", closed) : "var(--pt-top)", stroke: on || closed > 0 ? "var(--pt-ink)" : "var(--pt-ink-3)", strokeWidth: on ? 1.5 : 1 }} />
              {closed > 0.5
                ? <path d={`M ${x + 4.6} ${cy + 0.2} L ${x + 7} ${cy + 2.8} L ${x + 11.6} ${cy - 2.8}`} style={{ fill: "none", stroke: "var(--pt-top)", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" }} />
                : <text className="pt-num" x={x + 8} y={cy + 3.4} textAnchor="middle" style={{ fill: on ? "var(--pt-ink)" : "var(--pt-ink-2)" }}>{i + 1}</text>}
              <text className="pt-label" x={x + 22} y={PLAN.y + 23} style={{ ...(on ? { ["--pt-halo" as string]: "var(--pt-left)" } : {}), fill: on || closed > 0.5 || is("plan") ? "var(--pt-ink)" : "var(--pt-ink-2)" }}>{String(stage.stage)}</text>
              {said[i] > 0 ? <text className="pt-tag" x={x + 1} y={PLAN.y + 41} opacity={r(said[i])} style={on ? { ["--pt-halo" as string]: "var(--pt-left)" } : undefined}>{String(stage.found)}</text> : null}
            </g>
          );
        })}
<line className="pt-rule" x1={PLAN.x + 106} x2={PLAN.x + 106} y1={PLAN.y + 9} y2={PLAN.y + PLAN.height - 9} />
        <line className="pt-rule" x1={PLAN.x + 620} x2={PLAN.x + 620} y1={PLAN.y + 9} y2={PLAN.y + PLAN.height - 9} />
        {/* The go-ahead: nothing below moves before it */}
        <text className="pt-tag" x={PLAN.x + 672} y={PLAN.y + 17} textAnchor="middle" style={{ fill: yes > 0.5 ? "var(--pt-ink)" : undefined }}>you approve it</text>
        <rect x={PLAN.x + 645} y={PLAN.y + 24} width={54} height={21} rx={10.5}
          style={{
            fill: yesAccent > 0 ? mix("var(--pt-accent)", "var(--pt-top)", yesAccent) : "var(--pt-top)",
            stroke: yesAccent > 0 ? mix("var(--pt-accent)", "var(--pt-ink)", yesAccent) : yes > 0.5 ? "var(--pt-ink)" : "var(--pt-ink-3)",
            strokeWidth: yes > 0.5 ? 1.5 : 1, strokeDasharray: yes > 0.5 ? undefined : "3 3",
          }} />
        <text className="pt-label" x={PLAN.x + 672} y={PLAN.y + 38.5} textAnchor="middle"
          style={{ ...onFace, fill: yesAccent > 0.5 ? "var(--pt-bg)" : yes > 0.5 ? "var(--pt-ink)" : "var(--pt-ink-3)" }}>{yes > 0.5 ? "Yes" : "Yes?"}</text>
      </Panel>

      {/* The repo, as a listing: a bar per source file, as long as the file has lines */}
      <text className="pt-label" x={TREE.x} y={TREE.y - 9}>Your repo</text>
      <text className="pt-tag" x={TREE.x + TREE.width} y={TREE.y - 9} textAnchor="end">bar = lines in the file</text>
      <Panel box={TREE}>
        {/* What the scan found, tinted where it found it */}
        {[...tree].map(([key, at]) => {
          const flag = flagged(key), cy = y(at.row);
          return (
            <g key={`flag-${key}`}>
              {flag.loose > 0 || flag.thin > 0 ? <rect x={TREE.x + 6} y={cy - 8} width={BAR_X - TREE.x - 14} height={16} rx={3} style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", Math.max(flag.loose, flag.thin)) }} /> : null}
              {flag.long > 0 ? <rect x={BAR_X - 6} y={cy - 8} width={GOD * PER_LINE + 52} height={16} rx={3} style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", flag.long) }} /> : null}
              {flag.thin > 0 ? <rect x={BAR_X - 6} y={cy - 8} width={46} height={16} rx={3} style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", flag.thin) }} /> : null}
            </g>
          );
        })}

        {/* The line the long file is split down to */}
        {target > 0 ? (
          <g opacity={r(target)}>
            <line className="pt-guide" x1={targetX} x2={targetX} y1={rowY("billing") + 8} y2={y(lastInBilling) + 8} />
            <text className="pt-tag" x={targetX} y={rowY("billing") + 3.5} textAnchor="middle">target: under {thousands(TARGET)} lines</text>
          </g>
        ) : null}

        {/* The rows. A file on the move is drawn last, on a face of its own, so it passes over the rows it crosses. */}
        {[...tree].sort(([a], [b]) => (moving(a) > 0 ? 1 : 0) - (moving(b) > 0 ? 1 : 0)).map(([key, at]) => {
          if (at.o <= 0) return null;
          const carried = moving(key);
          const node = NODE[key], cy = y(at.row), x = NAME_X + at.depth * INDENT;
          const a = accent[key] ?? 0;
          const ghost = key === "pdfRender" && putBack > 0.6;
          const file = FILES.get(key);
          const length = key === "invoice" ? godLines : key === "client" ? clientLines : file ? num(file, "lines") : 0;
          // A thin module being folded in: its name goes first, and its lines are drawn below, travelling.
          const folding = is("deepen") && T.deepen.fold[key] ? T.deepen.fold[key] : null;
          const named = folding ? 1 - e([folding[0], folding[0] + 0.07]) : 1;
          const hub = HUBS.get(key);
          const typed = hub ? Math.round(String(hub.names).length * since("hubs", T.hubs.lines)) : 0;
          return (
            <g key={key} opacity={r(at.o)}>
              {carried > 0 ? <rect x={x - 6} y={cy - 8.5} width={BAR_X - x + num(FILES.get(key), "lines") * PER_LINE + 46} height={17} rx={3} opacity={r(carried)} style={{ fill: "var(--pt-top)" }} /> : null}
              {node.kind === "dir" ? <Folder x={x - 14} y={cy} /> : node.kind === "hub" ? <Diamond x={x - 14} y={cy} accent={a} /> : null}
              <text className="pt-tag" x={r(x)} y={r(cy + 3.8)} opacity={r(named)} style={fileName(ghost ? 0 : a, ghost)}>{node.name}</text>
              {ghost ? <line x1={x - 2} x2={x + node.name.length * 6.7 + 2} y1={cy} y2={cy} style={{ stroke: "var(--pt-ink-3)", strokeWidth: 1 }} opacity={r(span(putBack, 0.6, 1))} /> : null}
              {/* A source file's bar and its line count */}
              {length > 0 && !folding ? (
                <g>
                  <Bar box={{ x: BAR_X, y: cy - BAR_H / 2, width: Math.max(2.5, r(length * PER_LINE)), height: BAR_H }} tone="mid" accent={a} radius={2} />
                  {<text className="pt-num" x={r(key === "invoice" && length <= TARGET ? lerp(BAR_X + length * PER_LINE, targetX, target) + 6 : BAR_X + Math.max(2.5, length * PER_LINE) + 6)} y={r(cy + 3.4)} style={{ fill: a > 0.5 ? "var(--pt-accent-ink)" : undefined }}>{thousands(length)}</text>}
                </g>
              ) : null}
              {folding && named > 0 ? <text className="pt-num" x={r(BAR_X + Math.max(2.5, length * PER_LINE) + 6)} y={r(cy + 3.4)} opacity={r(named)}>{thousands(length)}</text> : null}
              {/* A hub's own lines: one for each folder beside it */}
              {hub && typed > 0 ? <text className="pt-tag" x={BAR_X} y={r(cy + 3.6)} style={a > 0 ? { fill: mix("var(--pt-accent-ink)", "var(--pt-ink-2)", a) } : undefined}>one line each: {String(hub.names).slice(0, typed)}</text> : null}
              {key === "client" && since("deepen", T.deepen.grow) > 0.6 ? <text className="pt-tag" x={BAR_X + CLIENT_END * PER_LINE + 40} y={r(cy + 3.6)} opacity={r(span(since("deepen", T.deepen.grow), 0.6, 1))}>1 module, was 4</text> : null}
            </g>
          );
        })}

        {/* The pieces: each leaves the long file's bar for a row of its own, and one comes back */}
        {[...PIECES.keys()].map((key) => {
          const k = out[key], at = tree.get(key);
          if (!(is("undone") && key === "pdfRender") && !(k > 0 && at)) return null;
          const from: [number, number] = [BAR_X + CUT_FROM[key] * PER_LINE, rowY("invoice")];
          const to: [number, number] = [BAR_X, at ? y(at.row) : from[1]];
          const width = lines(key) * PER_LINE;
          const back = key === "pdfRender" ? putBack : 0;
          return (
            <g key={`piece-${key}`}>
              {/* Where it was tried: an empty place, and the way it went back */}
              {back > 0.5 && at ? (
                <g opacity={r(span(back, 0.5, 1) * at.o)}>
                  <rect className="pt-guide" x={to[0] + 0.5} y={to[1] - BAR_H / 2 + 0.5} width={width - 1} height={BAR_H - 1} rx={2} />
                  <Elbow from={[to[0] + width + 4, to[1]]} to={[from[0] + width / 2, from[1] + BAR_H / 2 + 2]} via={from[0] + width / 2} radius={5} dashed quiet />
                  <text className="pt-tag" x={from[0] + width / 2 + 9} y={to[1] + 3.6}>put back</text>
                </g>
              ) : null}
              <Bar box={{ x: r(lerp(from[0], to[0], k)), y: r(lerp(from[1], to[1], k) - BAR_H / 2), width, height: BAR_H }} tone="mid" accent={accent[key] ?? 0} radius={2} />
              {k > 0.9 ? <text className="pt-num" x={r(lerp(from[0], to[0], k) + width + 6)} y={r(lerp(from[1], to[1], k) + 3.4)} opacity={r(span(k, 0.9, 1))} style={{ fill: (accent[key] ?? 0) > 0.5 ? "var(--pt-accent-ink)" : undefined }}>{thousands(lines(key))}</text> : null}
            </g>
          );
        })}
        {/* The thin modules' lines: each travels to the end of the client's bar, which grows to take them */}
        {is("deepen") ? Object.entries(T.deepen.fold).map(([key, window]) => {
          const at = tree.get(key), k = e(window);
          if (!at || k >= 1) return null;
          const width = Math.max(2.5, lines(key) * PER_LINE);
          return <Bar key={`fold-${key}`} box={{ x: r(lerp(BAR_X, BAR_X + clientLines * PER_LINE - width, k)), y: r(lerp(y(at.row), rowY("client"), k) - BAR_H / 2), width, height: BAR_H }} tone="mid" accent={accent.client} radius={2} />;
        }) : null}
      </Panel>

      {/* The check every change faces */}
      <Panel box={CHECK}>
        <text className="pt-label" x={CHECK.x + 12} y={CHECK.y + 21}>Check</text>
        <text className="pt-tag" x={CHECK.x + CHECK.width - 12} y={CHECK.y + 21} textAnchor="end">after every change</text>
        {steps.map((step, i) => {
          const cy = CHECK.y + 44 + i * 20, failed = failedStep === i;
          return (
            <g key={String(step.id)}>
              <Mark x={CHECK.x + 18} y={cy} k={checked(i)} failed={failed} />
              <text className="pt-tag" x={CHECK.x + 32} y={cy + 3.6} style={{ fontSize: 10.5, fill: "var(--pt-ink)" }}>{String(step.name)}</text>
              <text className="pt-tag" x={CHECK.x + CHECK.width - 12} y={cy + 3.6} textAnchor="end"
                style={failed && checked(i) > 0.5 ? { fill: "var(--pt-ink)" } : undefined}>{failed && checked(i) > 0.5 ? "1 new failure" : String(step.runs)}</text>
            </g>
          );
        })}
        <line className="pt-rule" x1={CHECK.x + 12} x2={CHECK.x + CHECK.width - 12} y1={CHECK.y + 98} y2={CHECK.y + 98} />
        {passed > 0 ? (
          <g opacity={r(passed)}>
            <text className="pt-tag" x={CHECK.x + 12} y={CHECK.y + 118} style={{ fill: "var(--pt-ink)" }}>0 new failures</text>
            <text className="pt-tag" x={CHECK.x + CHECK.width - 12} y={CHECK.y + 118} textAnchor="end">committed</text>
          </g>
        ) : null}
        {/* The one round that reds: only the failure the change brought counts, and three repairs do not clear it */}
        {failing > 0 ? (
          <g opacity={r(failing)}>
            {FAILURES.map((row, i) => (
              <g key={String(row.id)}>
                <text className="pt-tag" x={CHECK.x + 12} y={CHECK.y + 118 + i * 16} style={{ fill: row.counts ? "var(--pt-ink)" : "var(--pt-ink-2)" }}>{String(row.test)}</text>
                <text className="pt-tag" x={CHECK.x + CHECK.width - 12} y={CHECK.y + 118 + i * 16} textAnchor="end" style={{ fill: row.counts ? "var(--pt-ink)" : "var(--pt-ink-2)" }}>{String(row.says)}</text>
              </g>
            ))}
            <text className="pt-label" x={CHECK.x + 12} y={CHECK.y + 156}>Repair</text>
            {repaired.map((k, i) => (
              <circle key={i} cx={CHECK.x + 72 + i * 14} cy={CHECK.y + 152.5} r={4.5}
                style={{ fill: k > 0 ? mix("var(--pt-ink)", "var(--pt-top)", k * 0.72) : "var(--pt-top)", stroke: "var(--pt-ink-3)", strokeDasharray: k > 0 ? undefined : "2 3" }} />
            ))}
            <text className="pt-tag" x={CHECK.x + 112} y={CHECK.y + 156} style={{ fill: "var(--pt-ink)" }}>
              {repaired.filter((k) => k >= 0.5).length < REPAIRS ? `try ${Math.max(1, repaired.filter((k) => k >= 0.5).length)} of ${REPAIRS}` : `${REPAIRS} tries, still red`}
            </text>
          </g>
        ) : null}
      </Panel>

      {/* The branch the work lands on */}
      <Panel box={BRANCH}>
        <text className="pt-label" x={BRANCH.x + 12} y={BRANCH.y + 21}>Branch</text>
        <text className="pt-tag" x={BRANCH.x + BRANCH.width - 12} y={BRANCH.y + 21} textAnchor="end">never pushed</text>
        <text className="pt-tag" x={BRANCH.x + 12} y={BRANCH.y + 40} style={{ fill: "var(--pt-ink)" }}>{model.entities.find((x) => x.id === "branch")?.label}</text>
        {(() => {
          const lineY = BRANCH.y + 78, x0 = BRANCH.x + 24, pitch = 48;
          const reach = landed.reduce((sum, k) => sum + k, 0);
          return (
            <g>
              {reach > 0 ? <line x1={x0} x2={r(x0 + reach * pitch)} y1={lineY} y2={lineY} style={{ stroke: "var(--pt-ink)", strokeWidth: 1.5 }} /> : null}
              <circle cx={x0} cy={lineY} r={4.5} style={{ fill: "var(--pt-top)", stroke: "var(--pt-ink)", strokeWidth: 1.5 }} />
              <text className="pt-tag" x={x0} y={lineY + 19} textAnchor="middle">start</text>
              {landed.map((k, i) => k > 0 ? <circle key={i} cx={x0 + (i + 1) * pitch} cy={lineY} r={r(4.5 * k)} style={{ fill: "var(--pt-ink)" }} /> : null)}
              {head > 0 ? <text className="pt-tag" x={x0 + head * pitch} y={lineY - 11} textAnchor="middle" style={{ fill: "var(--pt-ink)" }}>HEAD</text> : null}
              {putBack > 0.5
                ? <text className="pt-tag" x={BRANCH.x + 12} y={BRANCH.y + 122} opacity={r(span(putBack, 0.5, 1) * (1 - span(p, 0.92, 1)))} style={{ fill: "var(--pt-ink)" }}>reset to HEAD: nothing committed</text>
                : head > 0 ? <text className="pt-tag" x={BRANCH.x + 12} y={BRANCH.y + 122} style={{ fill: "var(--pt-ink)" }}>{String(COMMITS[head - 1].says)}</text> : null}
              <text className="pt-tag" x={BRANCH.x + 12} y={BRANCH.y + 138}>one commit per round that passes</text>
            </g>
          );
        })()}
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
