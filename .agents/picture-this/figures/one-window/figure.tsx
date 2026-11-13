"use client";
// Transcript: every session's context window is a column of its turns, the
// newest at the bottom. The orchestrator's runs off the top and bottom of the
// picture; a row that hands a task off turns orange and a smaller window
// slides out to its right on a connector. A gauge at the left of a window is
// its tokens against the threshold, to one scale, and a window that reaches it
// is pressed into a few lines and gets the hook's rows back.
//
// The scrolling column is this figure's own: rows are placed here, from the
// clock, and drawn as plain bars in the kit's classes and tokens.
import { Meter } from "../kit/flat/chart";
import { Elbow, Token, onElbow } from "../kit/flat/connect";
import { mix } from "../kit/flat/geometry";
import type { Box, P2 } from "../kit/flat/geometry";
import { Panel } from "../kit/flat/panel";
import type { Model, Row } from "../kit/model";
import { entity, falls, firstBeatWith, flow, knots, levelAt, quantity, rows, series } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { clamp, ease, lerp, since, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;

// ── The page ────────────────────────────────────────────────────────────────
const VIEW = { x: 0, y: 0, width: 648, height: 452 };
const ORCH: Box = { x: 106, y: 0, width: 164, height: 452 };
/** Where the orchestrator's newest row sits: older rows rise from here. */
const NOW = 352;
/** The threshold, in px: the same in every window. */
const GAUGE = 104;
const CARD_A: Box = { x: 404, y: 30, width: 104, height: GAUGE + 16 };
const CARD_B: Box = { x: 404, y: 200, width: 104, height: GAUGE + 16 };
const SUB: Box = { x: 574, y: 50, width: 64, height: 76 };
const HOOK: Box = { x: 296, y: 398, width: 84, height: 28 };
const ORCH_GAUGE: Box = { x: ORCH.x + 8, y: NOW - GAUGE, width: 7, height: GAUGE };
const ORCH_ROWS = { x: ORCH.x + 24, width: ORCH.width - 34 };
const RIGHT = ORCH.x + ORCH.width;
/** Where a row's words start, under the newest row: clear of the gauge, which ends at NOW. */
const SAYS_X = ORCH.x + 12;
/** Where each connector turns, left to right: card-12's, the report's way back, card-13's, the note's, the subagent's, the hook's way round to card-13. */
const VIA = { a: 300, back: 316, b: 332, note: 533, sub: 540, round: 552 };

// A row's weight is who spoke. Three steps of ink on the panel's face, set so
// that each is at least 1.8:1 from the next and from the face in both themes.
type Weight = "strong" | "mid" | "quiet";
const INK: Record<Weight, number> = { strong: 0.72, mid: 0.44, quiet: 0.24 };
type Shape = { weight: Weight; h: number; indent: number; span: number };
const shapes = (person: number, agent: number, tool: number, indent: number): Record<string, Shape> => ({
  person: { weight: "strong", h: person, indent: 0, span: 0.8 },
  agent: { weight: "mid", h: agent, indent: 0, span: 1 },
  tool: { weight: "quiet", h: tool, indent, span: 1 },
  hook: { weight: "mid", h: agent, indent: 0, span: 1 },
});
const WIDE = shapes(14, 10, 12, 20);
const GAP = 6;
const CHILD = { shapes: shapes(6, 6, 6, 10), gap: 4, summary: 11 };
const HELPER = { shapes: shapes(4, 4, 4, 7), gap: 3, summary: 0 };
const TINY = shapes(2, 2, 2, 3);
/** How tall the lines a window is pressed into stand, in the orchestrator. */
const SUMMARY = 26;
/** The cards the figure does not draw in full: small windows in a row under card-13, level with the newest row, filled from the right. */
const CHIP = { y: NOW - 5 - 16, width: 15, height: 32, pitch: 17.8, slots: 7 };
const chipBox = (k: number): Box => ({ x: CARD_B.x + (CHIP.slots - 1 - k) * CHIP.pitch, y: CHIP.y, width: CHIP.width, height: CHIP.height });
const LANE_Y = NOW - 5;

// ── The model, read once ────────────────────────────────────────────────────
const turns = rows(model, "turns");
const oneCard = rows(model, "one-card");
const childTurns = rows(model, "child-turns");
const cards = series(model, "cards-before-full")[0];
const beatAt = (id: string) => model.beats.findIndex((b) => b.id === id);
const roles = [...new Set(turns.map((t) => String(t.role)))];
const hookRows = turns.filter((t) => t.role === "hook").length;
/** What the hook gives a child back: its card, and its cadence. */
const CHILD_HOOK_ROWS = 2;
/** Tokens one row of a child's window stands for, in the quantity's unit. */
const PER_ROW = 9;

// A quantity's course through story time (the beat's number plus how far
// through it the clock is), as the kit gives it, and two readings of it.
type Knot = { at: number; value: number };
type Fall = { from: number; to: number; high: number; low: number };

/** Everything a window has taken in by now: its level, with what a compaction took out put back. */
function gain(course: Knot[], u: number): number {
  let sum = 0;
  for (let i = 1; i < course.length; i++) {
    const a = course[i - 1], b = course[i];
    if (u < a.at) break;
    if (b.value > a.value) sum += (b.value - a.value) * (b.at > a.at ? clamp((u - a.at) / (b.at - a.at)) : 1);
  }
  return sum;
}

/** When a rising level first reaches a value, after `from`. */
function when(course: Knot[], level: number, from: number): number {
  for (let i = 1; i < course.length; i++) {
    const a = course[i - 1], b = course[i];
    if (b.at <= from || b.value <= a.value) continue;
    if (level >= a.value && level <= b.value) return a.at + (b.at - a.at) * ((level - a.value) / (b.value - a.value));
  }
  return from;
}

const CONTEXT = knots(model, "context"), CONTEXT_A = knots(model, "context-a"), CONTEXT_B = knots(model, "context-b");
/** When each window is compacted: the stretch its level falls over. */
const FULL: Fall | null = falls(model, "context")[0] ?? null, FULL_B: Fall | null = falls(model, "context-b")[0] ?? null;
const FULL_BEAT = FULL ? Math.floor(FULL.from) : model.beats.length;

// The orchestrator's turns, each with the moment it is added. A turn that
// starts a session or takes a report comes early in its beat, so the beat's
// middle shows what it did; the turns that follow it come after the middle.
type Turn = { role: string; says: string; starts: string; reports: boolean; at: number; grow: number; fast: boolean; pressed: boolean };
/** The cards worked before the window fills: when each is started, and when it is done. */
const MORE: { from: number; done: number }[] = [];
const ORCH_TURNS: Turn[] = (() => {
  const out: Turn[] = [];
  const put = (t: Row, at: number, grow: number, fast = false) => out.push({
    role: String(t.role), says: String(t.says), starts: t.starts ? String(t.starts) : "", reports: Boolean(t.reports),
    at, grow, fast, pressed: FULL ? at < FULL.from : false,
  });
  model.beats.forEach((b, i) => {
    const group = turns.filter((t) => t.at === b.id);
    if (!group.length) return;
    // A row rises into place over about a third of a second.
    const grow = 340 / b.ms;
    if (FULL && i === FULL_BEAT) {
      // Many tasks later: one card's turns, as many times over as the model says, at the rate the level climbs.
      const lo = levelAt(model, "context", i, 0), count = cards * oneCard.length;
      for (let k = 0; k < cards; k++) {
        const card = { from: 0, done: 0 };
        oneCard.forEach((t, j) => {
          const at = when(CONTEXT, lerp(lo, FULL.high, (k * oneCard.length + j + 1) / (count + 1)), i);
          put(t, at, 70 / b.ms, true);
          if (t.starts) card.from = at;
          card.done = at;
        });
        MORE.push(card);
      }
      // Then what the hook writes back, as the last of the window is emptied, and the turn after.
      let next = FULL.to - 0.02;
      for (const t of group) {
        if (t.role === "hook") { put(t, next, grow); next += 0.025; }
        else put(t, Math.max(next + 0.1, i + 0.72), grow);
      }
      return;
    }
    if (i > FULL_BEAT) {
      // After its compaction the round carries on: these come once the beat's own subject has been told.
      group.forEach((t, j) => put(t, i + lerp(0.58, 0.82, group.length > 1 ? j / (group.length - 1) : 0), grow));
      return;
    }
    const key = group.findIndex((t) => t.starts || t.reports);
    const keyAt = key < 0 ? 0 : group[key].reports ? 0.4 : 0.05;
    group.forEach((t, j) => {
      const p = key < 0 ? lerp(0.04, 0.86, j / (group.length - 1 || 1))
        : j < key ? lerp(0.01, keyAt, j / key)
        : j === key ? keyAt
        : lerp(0.58, 0.86, (j - key - 1) / Math.max(1, group.length - key - 2));
      put(t, i + p, grow);
    });
  });
  return out;
})();
const pressedHeight = ORCH_TURNS.reduce((sum, t) => sum + (t.pressed ? WIDE[t.role].h + GAP : 0), 0);
const ORCH_MIN = pressedHeight ? SUMMARY / pressedHeight : 1;
const lastPressed = ORCH_TURNS.reduce((last, t, i) => (t.pressed ? i : last), -1);
const turnOf = (test: (t: Turn) => boolean) => ORCH_TURNS.findIndex(test);
const drawnSession = (id: string) => model.entities.some((e) => e.id === id);
const STARTS_A = turnOf((t) => t.starts === "child-a"), STARTS_B = turnOf((t) => t.starts === "child-b");
/** The turn that starts the next card, after the compaction: its session is one more small window. */
const STARTS_NEXT = turnOf((t) => !t.fast && t.starts !== "" && !drawnSession(t.starts));
const REPORT = turnOf((t) => t.reports);
const FIRST_HOOK = turnOf((t) => t.role === "hook");
/** The turns whose words are shown: the ones that start a session the figure names, and the one line that comes back. */
const SAID = ORCH_TURNS.map((t, i) => (!t.fast && (t.reports || drawnSession(t.starts)) ? i : -1)).filter((i) => i >= 0);
/** The turn that closes card-12, the last of the beat its report lands in: after it the session is finished. */
const CLOSES = ORCH_TURNS.reduce((last, t, i) => (Math.floor(t.at) === Math.floor(ORCH_TURNS[REPORT].at) ? i : last), REPORT);
const DONE_AT = ORCH_TURNS[CLOSES].at + ORCH_TURNS[CLOSES].grow;
/** The word that turn uses for it: "aw board done 12". */
const DONE_WORD = ORCH_TURNS[CLOSES].says.split(" ").slice(-2)[0];

// When each session is started, in story time: its row turns orange, the
// connector is drawn, then the window slides out, all settled before the
// beat's middle. `until` is when the row stops being the turn handing off
// now and keeps only the tint.
type Hand = { draw: [number, number]; slide: [number, number]; until: number };
const hand = (beat: string, draw: [number, number], slide: [number, number], until: number): Hand => {
  const i = beatAt(beat);
  return { draw: [i + draw[0], i + draw[1]], slide: [i + slide[0], i + slide[1]], until: i + until };
};
const HANDS: Record<string, Hand> = {
  "child-a": hand("hand-off", [0.17, 0.3], [0.27, 0.46], 0.9),
  "child-b": hand("fan-out", [0.13, 0.21], [0.19, 0.32], 0.3),
  subagent: hand("fan-out", [0.33, 0.4], [0.38, 0.5], 0.9),
};
/** When card-12's turn hands the subagent its task, and which of card-12's rows that is: the agent's turn just added. */
const DELEGATE_AT = beatAt("fan-out") + 0.31;
const DELEGATES = Math.floor(gain(CONTEXT_A, DELEGATE_AT) / PER_ROW);
const SUB_FROM = gain(CONTEXT_A, HANDS.subagent.slide[0]);
/** The next card, after the compaction: started the same way, late in its beat. */
const NEXT: Hand | null = STARTS_NEXT < 0 ? null : (() => {
  const at = ORCH_TURNS[STARTS_NEXT].at;
  return { draw: [at + 0.06, at + 0.13], slide: [at + 0.11, at + 0.24], until: at };
})();

// ── A window's rows ─────────────────────────────────────────────────────────
type Placed = { index: number; top: number; h: number; here: number; role: string; pre: boolean };

/**
 * A child's rows at story time `u`, stacked up from `bottom`: one row per
 * PER_ROW of what the window has taken in, the newest rising into place. With
 * a `fall`, the rows from before it are pressed flat as the level drops, and
 * the first rows after it are the hook's.
 */
function childStack(course: Knot[], u: number, bottom: number, look: typeof CHILD, fall: Fall | null, skip = 0, shift = 0) {
  const total = Math.max(0, gain(course, u) - skip) / PER_ROW;
  const before = fall ? Math.max(0, gain(course, fall.from) - skip) / PER_ROW : Infinity;
  const pre = Math.min(total, before), post = total - pre;
  const c = fall ? span(u, fall.from, fall.to) : 0;
  const pitch = look.shapes.agent.h + look.gap;
  const press = fall ? lerp(1, look.summary / (before * pitch), ease.out(c)) : 1;
  const out: Placed[] = [];
  let y = bottom;
  for (let j = Math.ceil(post) - 1; j >= 0; j--) {
    const here = clamp(post - j);
    const role = j < CHILD_HOOK_ROWS ? "hook" : String(childTurns[(j - CHILD_HOOK_ROWS) % childTurns.length].role);
    const h = look.shapes[role].h;
    out.push({ index: j, top: y + pitch * (1 - here) - h, h, here, role, pre: false });
    y -= pitch * here;
  }
  const summaryBottom = y;
  for (let i = Math.ceil(pre) - 1; i >= 0; i--) {
    const here = clamp(pre - i);
    const role = String(childTurns[(i + shift) % childTurns.length].role);
    const h = look.shapes[role].h * press;
    out.push({ index: i, top: y + pitch * press * (1 - here) - h, h, here, role, pre: true });
    y -= pitch * press * here;
  }
  return { rows: out, c, press, summaryBottom };
}

/**
 * One turn: a bar in its speaker's weight, or an outlined bar for a row the
 * hook wrote. `accent` takes it to the accent (the turn the beat is about);
 * `marked` leaves the tint and its hairline on a turn that handed a task off.
 */
function TurnBar({ x, width, top, h, role, shape, accent = 0, marked = 0, opacity = 1 }: { x: number; width: number; top: number; h: number; role: string; shape: Shape; accent?: number; marked?: number; opacity?: number }) {
  if (h < 0.3 || opacity <= 0.01) return null;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const box = { x: x + shape.indent, y: r2(top), width: (width - shape.indent) * shape.span, height: r2(h) };
  const outlined = role === "hook";
  const base = outlined ? "var(--pt-top)" : mix("var(--pt-ink)", "var(--pt-top)", INK[shape.weight]);
  const tinted = marked > 0 ? mix("var(--pt-accent-soft)", base, marked) : base;
  const fill = accent > 0 ? mix("var(--pt-accent)", tinted, accent) : tinted;
  const edge = outlined ? "var(--pt-ink-2)" : "transparent";
  const line = Math.max(accent, marked);
  const stroke = line > 0 ? mix("var(--pt-accent)", edge, line) : outlined ? edge : "none";
  const inset = stroke === "none" ? 0 : 0.5;
  return (
    <rect
      className="pt-bar" x={box.x + inset} y={box.y + inset} width={Math.max(0, box.width - 2 * inset)} height={Math.max(0, box.height - 2 * inset)}
      rx={Math.min(3, box.height / 2)} opacity={Math.round(opacity * 1000) / 1000} style={{ fill, stroke }}
    />
  );
}

/** The few thin lines a window's rows are pressed into. */
function Summary({ x, width, bottom, height, lines, opacity }: { x: number; width: number; bottom: number; height: number; lines: number; opacity: number }) {
  if (opacity <= 0.01) return null;
  const pitch = height / lines, h = pitch * 0.56;
  return (
    <>
      {Array.from({ length: lines }, (_, n) => (
        <TurnBar key={n} x={x} width={width * (n === lines - 1 ? 0.55 : 1)} top={bottom - height + n * pitch} h={h} role="agent" shape={WIDE.agent} opacity={opacity} />
      ))}
    </>
  );
}

/**
 * A window's tokens against the threshold. The fill turns orange only as it
 * reaches the line; once the window has been compacted a pale band stays for
 * the rest of the beat, from where the level stood down to where it is now:
 * what was taken out.
 */
function Gauge({ box, share, lit, fall, u }: { box: Box; share: number; lit: number; fall: Fall | null; u: number }) {
  const taken = fall ? span(u, fall.from, fall.from + 0.04) * (1 - span(u, Math.floor(fall.from) + 0.92, Math.floor(fall.from) + 1)) : 0;
  const top = box.y + 1, bottom = box.y + box.height * (1 - share);
  return (
    <>
      <Meter box={box} value={share} threshold={1} accent={span(share, 0.96, 1)} lit={lit} />
      {taken > 0.01 && bottom - top > 1 ? (
        <rect className="pt-bar" x={box.x + 1} y={top} width={box.width - 2} height={bottom - top} rx={2} opacity={taken}
          style={{ fill: "var(--pt-accent-soft)", stroke: mix("var(--pt-accent)", "var(--pt-accent-soft)", 0.7) }} />
      ) : null}
    </>
  );
}

/** A finished session's face: the page's colour, where a running one is white. */
function Finished({ box, done }: { box: Box; done: number }) {
  return done > 0.01 ? <rect x={box.x} y={box.y} width={box.width} height={box.height} opacity={done} style={{ fill: "var(--pt-bg)" }} /> : null;
}

/**
 * A child's window: its gauge, its rows, and the lines they are pressed into.
 * `slide` (0 to 1) is how far it has slid out of its connector's end.
 */
function Window({ box, look, stack, share, lit, slide, marks, gauge = true, fall = null, u, done = 0 }: {
  box: Box; look: typeof CHILD; stack: ReturnType<typeof childStack>; share: number; lit: number; slide: number;
  marks?: (row: Placed) => { accent?: number; marked?: number };
  gauge?: boolean; fall?: Fall | null; u: number; done?: number;
}) {
  const x = box.x + (gauge ? 23 : 8), width = box.width - (gauge ? 31 : 16);
  const dim = lerp(0.78, 1, lit) * lerp(1, 0.6, done);
  return (
    <Panel box={box} here={clamp(slide * 1.6)} lit={lit * (1 - done)} shift={[(slide - 1) * 24, 0]}>
      <Finished box={box} done={done} />
      {gauge ? <Gauge box={{ x: box.x + 8, y: box.y + 8, width: 7, height: GAUGE }} share={share} lit={1 - 0.5 * done} fall={fall} u={u} /> : null}
      {stack.rows.map((row) => {
        if (row.top + row.h < box.y || row.top > box.y + box.height) return null;
        const mark = marks ? marks(row) : {};
        return (
          <TurnBar
            key={`${row.pre ? "a" : "b"}${row.index}`} x={x} width={width} top={row.top} h={row.h} role={row.role} shape={look.shapes[row.role]}
            accent={mark.accent} marked={mark.marked} opacity={dim * clamp(row.here * 1.5) * (row.pre ? clamp((stack.press - 0.03) / 0.15) : 1)}
          />
        );
      })}
      <Summary x={x} width={width} bottom={stack.summaryBottom} height={look.summary} lines={3} opacity={dim * span(stack.c, 0.45, 0.8)} />
    </Panel>
  );
}

/** A small window: a card the figure does not draw in full. Closed, and the page's colour, once its line is back. */
function Chip({ box, slide, done, bars }: { box: Box; slide: number; done: number; bars: number }) {
  if (slide <= 0) return null;
  return (
    <Panel box={box} radius={3} here={clamp(slide * 1.6)} lit={0.35 * (1 - done)} shift={[(slide - 1) * 10, 0]}>
      <Finished box={box} done={done} />
      {childTurns.slice(0, 5).map((t, n) => (
        <TurnBar key={n} x={box.x + 3} width={box.width - 6} top={box.y + 5 + n * 5} h={2} role={String(t.role)} shape={TINY[String(t.role)]} opacity={clamp(bars - n) * lerp(1, 0.7, done)} />
      ))}
    </Panel>
  );
}

/** Words that fit a width: broken at spaces into lines of at most `max` letters. */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  for (const word of text.split(" ")) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= max) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out;
}

function Scene() {
  const f = useFigure();
  const u = f.frame.index + f.frame.p;
  const lit = (id: string) => f.lit(id);
  const moving = (id: string) => f.moving(id);
  const suffix = (id: string) => (quantity(f.model, id).unit ?? "").split(" ")[0];
  const reading = (id: string) => `${Math.round(f.level(id))}${suffix(id)}`;
  const ceiling = (id: string) => `${quantity(f.model, id).max}${suffix(id)}`;
  const fade = (until: number) => 1 - span(u, until, until + 0.08);
  /** A pulse running a stretch of story time, or nothing outside it. */
  const run = (from: number, to: number) => (u > from && u < to ? span(u, from, to) : undefined);

  // The orchestrator's rows, stacked up from NOW, each new one rising into
  // place under the last. The rows from before its compaction are pressed
  // flat as its level falls: fast at first, then settling.
  const c = FULL ? span(u, FULL.from, FULL.to) : 0;
  const press = lerp(1, ORCH_MIN, ease.out(c));
  const placed: { top: number; h: number; here: number }[] = [];
  let y = NOW, summaryBottom = NOW;
  for (let i = ORCH_TURNS.length - 1; i >= 0; i--) {
    const t = ORCH_TURNS[i];
    if (i === lastPressed) summaryBottom = y;
    const here = ease.out(span(u, t.at, t.at + t.grow));
    const k = t.pressed ? press : 1;
    const h = WIDE[t.role].h * k, pitch = (WIDE[t.role].h + GAP) * k;
    placed[i] = { top: y + pitch * (1 - here) - h, h, here };
    y -= pitch * here;
  }
  const middle = (i: number) => placed[i].top + placed[i].h / 2;
  const share = f.share("context");
  /** A turn arrives in its speaker's tone and then turns orange. */
  const turnsOrange = (t: Turn) => span(u, t.at + t.grow * 0.7, t.at + t.grow * 0.7 + 0.05);
  const accentOf = (t: Turn) => {
    if (t.fast) return 0;
    if (t.starts) return HANDS[t.starts] ? turnsOrange(t) * fade(HANDS[t.starts].until) : 0;
    if (t.reports || t.role === "hook") return fade(Math.floor(t.at) + 0.9);
    return 0;
  };
  const markedOf = (t: Turn) => (t.starts ? (t.fast ? 1 : turnsOrange(t)) : 0);
  const summaryNamed = span(c, 0.6, 0.9) * (1 - span(u, FULL_BEAT + 0.9, FULL_BEAT + 1));

  // The children: when each is started, what its window holds, and whether it has finished.
  const drawn = (h: Hand) => span(u, h.draw[0], h.draw[1]);
  /** The pulse leads the line as it is drawn, and runs off its end. */
  const pulse = (h: Hand) => run(h.draw[0], h.draw[1] + (h.draw[1] - h.draw[0]) * 0.18);
  const slid = (h: Hand) => ease.out(span(u, h.slide[0], h.slide[1]));
  const done = span(u, DONE_AT, DONE_AT + 0.08);
  const stackA = childStack(CONTEXT_A, u, CARD_A.y + CARD_A.height - 8, CHILD, null);
  const stackB = childStack(CONTEXT_B, u, CARD_B.y + CARD_B.height - 8, CHILD, FULL_B);
  const stackS = childStack(CONTEXT_A, u, SUB.y + SUB.height - 8, HELPER, null, SUB_FROM, 10);
  const delegating = stackA.rows.find((r) => r.pre && r.index === DELEGATES);
  const delegateY = clamp(delegating ? delegating.top + delegating.h / 2 : CARD_A.y + CARD_A.height - 11, CARD_A.y + 12, CARD_A.y + CARD_A.height - 11);
  const delegated = span(u, DELEGATE_AT, DELEGATE_AT + 0.04);

  // Started-by. A connector lasts as long as the row it leaves from. A
  // finished session's goes when its row leaves the picture; a running
  // session's runs on from the top edge, and once the rows are pressed into
  // the summary it becomes a dashed tie to the window's edge.
  const fromA: P2 = [RIGHT, Math.max(-14, middle(STARTS_A))], toA: P2 = [CARD_A.x, CARD_A.y + 26];
  const fromB: P2 = [RIGHT, Math.max(-14, middle(STARTS_B))], toB: P2 = [CARD_B.x, CARD_B.y + 26];
  const fromS: P2 = [CARD_A.x + CARD_A.width, delegateY], toS: P2 = [SUB.x, SUB.y + 18];
  const heldA = c > 0 ? 0 : lerp(1, span(middle(STARTS_A), -10, 14), done);
  const heldB = 1 - span(c, 0, 0.3), tied = span(c, 0.3, 1);

  // The cards worked before the window fills: each starts from the newest
  // row, along one lane, into the next place in the row.
  const chipSlide = MORE.map((card) => ease.out(span(u, card.from, card.from + 0.04)));
  const newest = MORE.reduce((k, card, i) => (u >= card.from ? i : k), 0);
  const laneEnd = MORE.length ? lerp(newest > 0 ? chipBox(newest - 1).x : chipBox(0).x, chipBox(newest).x, newest > 0 ? chipSlide[newest] : 1) : 0;
  const laneOn = MORE.length ? span(u, MORE[0].from - 0.03, MORE[0].from) * (1 - span(c, 0, 0.4)) : 0;
  const lanePulse = MORE.map((card) => run(card.from - 0.025, card.from + 0.01)).find((p) => p !== undefined);
  const nextSlide = NEXT ? slid(NEXT) : 0;
  const fromN: P2 = [RIGHT, STARTS_NEXT >= 0 ? middle(STARTS_NEXT) : LANE_Y], toN: P2 = [chipBox(CHIP.slots - 1).x, LANE_Y];

  // The note, and the report on its way back.
  const talk = beatAt("talk"), report = beatAt("report");
  const noteFrom: P2 = [CARD_A.x + CARD_A.width, CARD_A.y + CARD_A.height - 12], noteTo: P2 = [CARD_B.x + CARD_B.width, CARD_B.y + 14];
  const noteAt = span(u, talk + 0.15, talk + 0.85);
  const noteHere = u >= talk && u < talk + 1 ? span(u, talk + 0.1, talk + 0.16) * (1 - span(u, talk + 0.85, talk + 0.92)) : 0;
  const backFrom: P2 = [CARD_A.x, CARD_A.y + CARD_A.height - 20], backTo: P2 = [RIGHT, middle(REPORT)];
  const backAt = ease.out(span(u, report + 0.18, ORCH_TURNS[REPORT].at + 0.02));
  const backShown = (u >= report + 0.18 ? 1 : 0) * (1 - span(u, report + 0.86, report + 0.98));

  // The hook: there from the beat that first tells it. What it writes is an
  // event, so its line to the orchestrator is drawn as it writes and goes
  // when that beat ends.
  const hookBeat = firstBeatWith(f.model, "hook") ?? model.beats[0].id;
  const hookHere = since(f.tl, f.frame, hookBeat);
  const hookLit = lit("hook");
  const toOrch: P2 = [RIGHT, middle(FIRST_HOOK + Math.floor(hookRows / 2))];
  const wroteOrch = FULL ? span(u, FULL.to - 0.07, FULL.to - 0.02) : 0;
  const keptOrch = 1 - span(u, FULL_BEAT + 0.9, FULL_BEAT + 1);
  const wroteCard = FULL_B ? span(u, FULL_B.to - 0.05, FULL_B.to + 0.02) : 0;
  const hookMark = (row: Placed) => (!row.pre && row.role === "hook" && FULL_B ? { accent: fade(Math.floor(FULL_B.to) + 0.9) } : {});
  const afterHook = placed[FIRST_HOOK + hookRows]?.here ?? 0;

  return (
    <g opacity={f.present}>
      {/* The orchestrator's window: it runs on past the picture, above and below. */}
      <Panel box={ORCH} open="top bottom" lit={lit("orchestrator")}>
        <Gauge box={ORCH_GAUGE} share={share} lit={1} fall={FULL} u={u} />
        {ORCH_TURNS.map((t, i) => {
          const at = placed[i];
          if (at.top + at.h < -4 || at.top > VIEW.height || at.here <= 0) return null;
          return (
            <TurnBar
              key={i} x={ORCH_ROWS.x} width={ORCH_ROWS.width} top={at.top} h={at.h} role={t.role} shape={WIDE[t.role]}
              accent={accentOf(t)} marked={markedOf(t)} opacity={clamp(at.here * 1.5) * (t.pressed ? clamp((press - 0.03) / 0.15) : 1)}
            />
          );
        })}
        <Summary x={ORCH_ROWS.x} width={ORCH_ROWS.width} bottom={summaryBottom} height={SUMMARY} lines={4} opacity={span(c, 0.45, 0.8)} />
        {/* What the row that matters says, under it, until the next row is added. */}
        {SAID.map((i) => {
          const shown = span(placed[i].here, 0.6, 1) * (1 - span(placed[i + 1]?.here ?? 0, 0, 0.4));
          if (shown <= 0.01) return null;
          return wrap(ORCH_TURNS[i].says, 22).map((words, n) => (
            <text key={`${i}-${n}`} className="pt-tag" x={SAYS_X} y={NOW + 16 + n * 12} opacity={shown}>{words}</text>
          ));
        })}
        {FIRST_HOOK >= 0 ? <text className="pt-tag" x={SAYS_X} y={NOW + 16} opacity={span(placed[FIRST_HOOK + hookRows - 1].here, 0.6, 1) * (1 - span(afterHook, 0, 0.4))}>{flow(f.model, "reinject").label}</text> : null}
      </Panel>
      {/* The lines its rows were pressed into, named where they are while the beat is about them. */}
      {summaryNamed > 0.01 ? (
        <g opacity={summaryNamed}>
          <path className="pt-leader" d={`M ${ORCH_ROWS.x + ORCH_ROWS.width + 3} ${summaryBottom - SUMMARY / 2 - 2} L ${RIGHT + 6} ${summaryBottom - SUMMARY / 2 - 2}`} />
          <text className="pt-tag" x={RIGHT + 9} y={summaryBottom - SUMMARY / 2 + 1}>compacted</text>
        </g>
      ) : null}

      {/* Who it is, the key to the rows, and the one scale. */}
      <text className="pt-label" x={8} y={28}>{entity(f.model, "orchestrator").label}</text>
      {roles.map((role, n) => (
        <g key={role} opacity={role === "hook" ? hookHere : 1}>
          <TurnBar x={12} width={24} top={46 + n * 14} h={7} role={role} shape={{ ...WIDE[role], h: 7, indent: WIDE[role].indent ? 6 : 0 }} />
          <text className="pt-tag" x={44} y={53 + n * 14}>{role}</text>
        </g>
      ))}
      <g opacity={hookHere}>
        <Summary x={12} width={24} bottom={46 + roles.length * 14 + 9} height={10} lines={3} opacity={1} />
        <text className="pt-tag" x={44} y={53 + roles.length * 14}>compacted</text>
      </g>
      <text className="pt-tag" x={ORCH.x - 5} y={ORCH_GAUGE.y + 3} textAnchor="end">{`${quantity(f.model, "context").max}${quantity(f.model, "context").unit ?? ""}`}</text>
      <text className="pt-tag" x={ORCH.x - 5} y={NOW - GAUGE * share + 3} textAnchor="end" opacity={span(GAUGE * (1 - share), 10, 16)}>{reading("context")}</text>

      {/* Started-by: from the row that handed the task off to the window it started. Under the windows, which slide out of the line's end. */}
      {heldA > 0.01 ? (
        <g opacity={heldA}>
          <Elbow from={fromA} to={toA} via={VIA.a} progress={drawn(HANDS["child-a"])} pulse={pulse(HANDS["child-a"])} lit={lerp(0.25, 1, lit("child-a")) * (1 - 0.55 * moving("report")) * (1 - done)} />
        </g>
      ) : null}
      {heldB > 0.01 ? <g opacity={heldB}><Elbow from={fromB} to={toB} via={VIA.b} progress={drawn(HANDS["child-b"])} pulse={pulse(HANDS["child-b"])} lit={lerp(0.25, 1, lit("child-b"))} /></g> : null}
      {tied > 0.01 ? <g opacity={tied}><Elbow from={[RIGHT, toB[1]]} to={toB} dashed lit={lerp(0.45, 1, lit("child-b"))} /></g> : null}
      <Elbow from={fromS} to={toS} via={VIA.sub} progress={drawn(HANDS.subagent)} pulse={pulse(HANDS.subagent)} lit={lerp(0.25, 1, lit("subagent")) * (1 - done)} />
      {laneOn > 0.01 ? <g opacity={laneOn}><Elbow from={[RIGHT, LANE_Y]} to={[laneEnd, LANE_Y]} pulse={lanePulse} pulseLength={0.3} lit={0.6} /></g> : null}
      {NEXT ? <Elbow from={fromN} to={toN} via={VIA.a} progress={drawn(NEXT)} lit={0.6} /> : null}

      {/* The sessions it starts, each a window of its own, and the one a child starts. */}
      <Window box={CARD_A} look={CHILD} stack={stackA} share={f.share("context-a")} lit={lit("child-a")} slide={slid(HANDS["child-a"])} u={u} done={done}
        marks={(row) => (row.pre && row.index === DELEGATES ? { marked: delegated, accent: delegated * fade(HANDS.subagent.until) } : {})} />
      <Window box={CARD_B} look={CHILD} stack={stackB} share={f.share("context-b")} lit={lit("child-b")} slide={slid(HANDS["child-b"])} u={u} fall={FULL_B} marks={hookMark} />
      <Window box={SUB} look={HELPER} stack={stackS} share={0} lit={lit("subagent")} slide={slid(HANDS.subagent)} u={u} gauge={false} done={done} />

      {/* Each card's name, and its level over the one ceiling; a finished card says so. */}
      <g opacity={slid(HANDS["child-a"])}>
        <text className="pt-label" x={CARD_A.x} y={CARD_A.y - 8}>{entity(f.model, "child-a").label}</text>
        <text className="pt-tag" x={CARD_A.x + CARD_A.width + 13} y={CARD_A.y - 8} textAnchor="end" opacity={1 - done}>{`${reading("context-a")}/${ceiling("context-a")}`}</text>
        <text className="pt-tag" x={CARD_A.x + CARD_A.width + 13} y={CARD_A.y - 8} textAnchor="end" opacity={done}>{DONE_WORD}</text>
      </g>
      <g opacity={slid(HANDS["child-b"])}>
        <text className="pt-label" x={CARD_B.x} y={CARD_B.y - 8}>{entity(f.model, "child-b").label}</text>
        <text className="pt-tag" x={CARD_B.x + CARD_B.width + 13} y={CARD_B.y - 8} textAnchor="end">{`${reading("context-b")}/${ceiling("context-b")}`}</text>
      </g>
      <text className="pt-label" x={SUB.x} y={SUB.y - 8} opacity={slid(HANDS.subagent)}>{entity(f.model, "subagent").label}</text>

      {/* The cards worked before the window fills, then the next one after it: small windows, closed once their line is back. */}
      {MORE.map((card, k) => <Chip key={k} box={chipBox(k)} slide={chipSlide[k]} done={span(u, card.done, card.done + 0.03)} bars={5} />)}
      {NEXT ? <Chip box={chipBox(CHIP.slots - 1)} slide={nextSlide} done={0} bars={1 + 2 * span(u, NEXT.slide[1], NEXT.slide[1] + 0.3)} /> : null}
      {MORE.length ? (
        <text className="pt-tag" x={chipBox(MORE.length - 1).x} y={CHIP.y + CHIP.height + 13} opacity={ease.out(span(u, MORE[0].from, MORE[MORE.length - 1].done))}>
          {`${cards} cards before full`}
        </text>
      ) : null}
      <text className="pt-tag" x={(VIA.a + CARD_A.x) / 2} y={toA[1] - 7} textAnchor="middle" opacity={moving("dispatch-a") * drawn(HANDS["child-a"])}>{flow(f.model, "dispatch-a").label}</text>
      <text className="pt-tag" x={(VIA.b + CARD_B.x) / 2} y={toB[1] - 7} textAnchor="middle" opacity={moving("dispatch-b") * drawn(HANDS["child-b"])}>{flow(f.model, "dispatch-b").label}</text>
      <text className="pt-tag" x={(VIA.sub + SUB.x) / 2} y={toS[1] - 7} textAnchor="middle" opacity={moving("delegate") * drawn(HANDS.subagent)}>{flow(f.model, "delegate").label}</text>

      {/* What is said between sessions: a note across, and one line back. */}
      <g opacity={since(f.tl, f.frame, "talk") * slid(HANDS["child-b"]) * (1 - done)}>
        <Elbow from={noteFrom} to={noteTo} via={VIA.note} quiet lit={lerp(0.2, 1, moving("note"))} />
        <text className="pt-tag" x={VIA.note + 9} y={(noteFrom[1] + noteTo[1]) / 2 + 3} opacity={moving("note")}>{flow(f.model, "note").label}</text>
        <Token at={onElbow(noteFrom, noteTo, noteAt, { via: VIA.note })} r={5.5} accent={1} here={noteHere} />
      </g>
      {backShown > 0.01 ? (
        <g opacity={backShown}>
          <Elbow from={backFrom} to={backTo} via={VIA.back} quiet accent={1} progress={backAt} head={backAt >= 1} />
          <text className="pt-tag" x={(VIA.back + CARD_A.x) / 2} y={backFrom[1] - 7} textAnchor="middle" opacity={span(backAt, 0.1, 0.3)}>{flow(f.model, "report").label}</text>
          <Token at={onElbow(backFrom, backTo, backAt, { via: VIA.back })} r={4.5} accent={1} here={1 - span(backAt, 0.92, 1)} />
        </g>
      ) : null}

      {/* The hook: the instruction rows it holds, and where it writes them back. */}
      {hookHere > 0 ? (
        <g opacity={hookHere}>
          <Panel box={HOOK} radius={6} lit={hookLit}>
            {Array.from({ length: hookRows }, (_, n) => (
              <TurnBar key={n} x={HOOK.x + 8} width={HOOK.width - 16} top={HOOK.y + 5 + n * 7} h={4} role="hook" shape={WIDE.hook} opacity={lerp(0.6, 1, hookLit)} />
            ))}
          </Panel>
          <text className="pt-label" x={HOOK.x + HOOK.width / 2} y={HOOK.y + HOOK.height + 15} textAnchor="middle">{entity(f.model, "hook").label}</text>
          {wroteOrch > 0 && keptOrch > 0.01 && FULL ? (
            <g opacity={keptOrch}>
              <Elbow from={[HOOK.x, HOOK.y + 14]} to={toOrch} via={HOOK.x - 12} progress={wroteOrch} lit={lerp(0.3, 1, moving("reinject"))}
                pulse={run(FULL.to - 0.07, FULL.to + 0.06)} pulseLength={0.3} />
            </g>
          ) : null}
          {wroteCard > 0 && FULL_B ? (
            <>
              <Elbow from={[HOOK.x + HOOK.width, HOOK.y + 14]} to={[CARD_B.x + CARD_B.width, CARD_B.y + CARD_B.height - 12]} via={VIA.round} progress={wroteCard} lit={lerp(0.3, 1, moving("reinject-child"))}
                pulse={run(FULL_B.to - 0.05, FULL_B.to + 0.19)} pulseLength={0.22} />
              <text className="pt-tag" x={HOOK.x + HOOK.width + 8} y={HOOK.y + 28} opacity={wroteCard * moving("reinject-child")}>{flow(f.model, "reinject-child").label}</text>
            </>
          ) : null}
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
