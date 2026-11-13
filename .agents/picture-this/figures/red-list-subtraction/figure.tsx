"use client";
// red-list-subtraction: one optimizer round as two lists of failing tests,
// row for row. What is failing after the change, minus what was already red
// on the round base, is what the validator counts; that goes to the repair,
// then the round lands on the branch or is reset to its base.
import type { Model, Row } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line, Queue, Token } from "../kit/flat/connect";
import { Panel } from "../kit/flat/panel";
import { mix } from "../kit/flat/geometry";
import type { P2 } from "../kit/flat/geometry";
import { clamp, ease, lerp, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 350 };

const known = model.data!.known as Row[];
const fresh = model.data!.fresh as Row[];
const rounds = model.data!.rounds as Row[];
const name = (r: Row) => String(r.label);

// Columns: the round base and its list, the change and its list, the repair, the branch.
const A = { x: 20, w: 170 };
const B = { x: 240, w: 220 };
const PANEL_Y = 28, PANEL_H = 48;
const ROW_Y = 124, PITCH = 30, ROW_H = 22;
const rowY = (i: number) => ROW_Y + i * PITCH;
const REPAIR = { x: 490, y: 150, width: 112, height: 96 };
const BRANCH_X = 676;
const COUNT_Y = 262;
const COMMIT_Y = 266;
const START_Y = 322;

const order = model.beats.map((b) => b.id);

// One test, failing: a row with its name. `accent` is the beat's focus, `marked` a tint
// the story left on it, `struck` crosses it out as a failure that does not count, `empty`
// draws it as a dashed place, `note` says why on its right.
function TestRow({ x, w, y, label, note, here = 1, accent = 0, marked = 0, struck = 0, empty = 0, lit = 1 }: {
  x: number; w: number; y: number; label?: string; note?: string; here?: number; accent?: number; marked?: number; struck?: number; empty?: number; lit?: number;
}) {
  if (here <= 0) return null;
  const solid = 1 - empty;
  const face = mix("var(--pt-accent-soft)", "var(--pt-top)", Math.max(accent, marked) * solid);
  const edge = mix(mix("var(--pt-accent)", "var(--pt-ink-3)", Math.max(accent, marked * 0.4)), "var(--pt-line-2)", 0.4 + 0.6 * lit);
  const ink = struck > 0.5 ? "var(--pt-ink-3)" : accent > 0.5 ? "var(--pt-accent-ink)" : mix("var(--pt-ink)", "var(--pt-ink-3)", lit);
  return (
    <g opacity={here}>
      {solid > 0 ? (
        <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={ROW_H - 1} rx={3} opacity={solid}
          style={{ fill: face, stroke: edge, strokeWidth: accent > 0.5 ? 1.5 : 1 }} />
      ) : null}
      {empty > 0 ? <rect className="pt-guide" x={x + 0.5} y={y + 0.5} width={w - 1} height={ROW_H - 1} rx={3} opacity={empty} /> : null}
      {label ? (
        <text className="pt-tag" x={x + 9} y={y + 14.5} opacity={1 - 0.45 * empty}
          style={{ fill: ink, ["--pt-halo" as string]: "var(--pt-bg)" }}>{label}</text>
      ) : null}
      {struck > 0 ? <path className="pt-edge" d={`M ${x + 6} ${y + ROW_H / 2} L ${x + 6 + ((label ? label.length * 6.1 + 8 : w - 12)) * struck} ${y + ROW_H / 2}`} style={{ stroke: "var(--pt-ink-2)" }} /> : null}
      {note ? (
        <text className="pt-tag" x={label ? x + w - 8 : x + w / 2} y={y + 14.5} textAnchor={label ? "end" : "middle"}
          style={{ fill: "var(--pt-ink-2)", ["--pt-halo" as string]: "var(--pt-bg)" }}>{note}</text>
      ) : null}
    </g>
  );
}

// A route the round may take next: dashed until it is taken, solid once it is.
function Route({ from, to, first, via, taken, shown = 1, lit, accent = 0, pulse }: {
  from: P2; to: P2; first?: "h" | "v"; via?: number; taken: number; shown?: number; lit: number; accent?: number; pulse?: number;
}) {
  if (shown <= 0) return null;
  return (
    <g opacity={shown}>
      {taken < 1 ? <g opacity={1 - taken}><Elbow from={from} to={to} first={first} via={via} dashed quiet lit={0.25} /></g> : null}
      <Elbow from={from} to={to} first={first} via={via} progress={taken} lit={lit} accent={accent} pulse={pulse} />
    </g>
  );
}

function Scene() {
  const f = useFigure();
  const cur = f.frame.index, p = f.frame.p;
  // How far a stretch of a beat has gone: 0 before that beat, 1 after it.
  const prog = (id: string, a: number, b: number) => {
    const i = order.indexOf(id);
    return cur < i ? 0 : cur > i ? 1 : ease.out(span(p, a, b));
  };
  const inBeat = (id: string) => cur === order.indexOf(id);
  const pulse = (flow: string) => (f.moving(flow) > 0 ? f.phase(1) : undefined);
  const resting = f.frame.beat.rest ? 1 : 0;

  // Round two takes over the change and the right-hand list at the start of `putback`.
  const two = prog("putback", 0, 0.1);
  const twoRepairing = inBeat("putback") && p > 0.06 && p < 0.33;
  const wiped = prog("putback", 0.36, 0.48);
  const newred = f.level("newred");
  const repairs = f.level("repairs");
  const used = Math.round(repairs);

  // The left list: the already-red tests, written down on the clean tree.
  const knownHere = prog("oracle", 0.05, 0.4);
  const knownAccent = inBeat("oracle") ? f.on("oracle") : 0;
  const knownMarked = cur > order.indexOf("oracle") ? 1 : 0;

  // The right list, round one: everything failing after the change.
  const oneHere = prog("check", 0, 0.18) * (1 - two);
  const join = prog("check", 0.18, 0.32);
  const strike = prog("check", 0.26, 0.38);
  const counted = prog("check", 0.32, 0.42);
  const repairOn = cur >= order.indexOf("repair");
  const freshVisible = (i: number) => (repairOn ? clamp(newred - i) : 1);

  const changeLabel = two > 0.5 ? name(rounds[1]) : name(rounds[0]);
  const changeHere = prog("change", 0, 0.3);
  const changeAccent = inBeat("change") ? f.on("change") : 0;

  const countAccent = inBeat("check") ? counted : 0;
  const shown = Math.round(newred);

  // Landing: a commit, and HEAD moves up to it; the next round starts from there.
  const commitHere = prog("land", 0.1, 0.35);
  const commitAccent = inBeat("land") ? f.on("land") : 0;
  const headUp = prog("land", 0.25, 0.42);
  const headY = lerp(START_Y, COMMIT_Y, headUp);

  const baseY = PANEL_Y + PANEL_H / 2;
  const bMid = B.x + B.w / 2;
  const aMid = A.x + A.w / 2;
  const fromCheck: P2 = [B.x + B.w, rowY(2) + ROW_H + 4];
  const toRepair: P2 = [REPAIR.x, rowY(2) + ROW_H + 4];
  // Three repairs in round two: a pulse round the fix loop for each.
  const twoPulse = twoRepairing ? (span(p, 0.06, 0.33) * 3) % 1 : undefined;

  return (
    <g opacity={f.present}>
      {/* The round base: the commit the round starts from and returns to. */}
      <Panel box={{ x: A.x, y: PANEL_Y, width: A.w, height: PANEL_H }} lit={f.lit("base")}>
        <text className="pt-label" x={A.x + 12} y={PANEL_Y + 20}>{model.entities[0].label}</text>
        <text className="pt-label-sub" x={A.x + 12} y={PANEL_Y + 37} opacity={1 - headUp}>HEAD: baseline commit</text>
        <text className="pt-label-sub" x={A.x + 12} y={PANEL_Y + 37} opacity={headUp}>HEAD: {name(rounds[0])}</text>
      </Panel>

      {/* The change: one split or one deepening, made on top of the base. */}
      {changeHere > 0 ? (
        <g opacity={changeHere}>
          {wiped < 1 ? (
            <g opacity={1 - wiped}>
              <Panel box={{ x: B.x, y: PANEL_Y, width: B.w, height: PANEL_H }} lit={f.lit("change")} accent={changeAccent}>
                <text className="pt-label" x={B.x + 12} y={PANEL_Y + 20}>{model.entities[2].label}</text>
                <text className="pt-label-sub" x={B.x + 12} y={PANEL_Y + 37}>{changeLabel}</text>
              </Panel>
            </g>
          ) : null}
          {wiped > 0 ? (
            <g opacity={wiped}>
              <rect className="pt-guide" x={B.x + 0.5} y={PANEL_Y + 0.5} width={B.w - 1} height={PANEL_H - 1} rx={8} />
              <text className="pt-label" x={B.x + 12} y={PANEL_Y + 20} style={{ fill: "var(--pt-ink-2)" }}>Discarded, not committed</text>
              <text className="pt-label-sub" x={B.x + 12} y={PANEL_Y + 37}>{changeLabel}</text>
            </g>
          ) : null}
        </g>
      ) : null}

      {/* edit: base -> change */}
      <Elbow from={[A.x + A.w, baseY]} to={[B.x, baseY]} progress={prog("change", 0, 0.3)}
        lit={f.on("change") || resting ? 1 : 0.3} pulse={pulse("edit")} />
      <text className="pt-tag" x={(A.x + A.w + B.x) / 2} y={baseY - 7} textAnchor="middle" opacity={prog("change", 0, 0.3)}>edit</text>

      {/* tests before: base -> already red */}
      <Elbow from={[aMid, PANEL_Y + PANEL_H]} to={[aMid, ROW_Y - 22]} first="v" progress={prog("oracle", 0, 0.3)}
        lit={inBeat("oracle") || resting ? 1 : 0.3} pulse={pulse("snapshot")} />
      {/* run checks: change -> validator */}
      <Elbow from={[bMid, PANEL_Y + PANEL_H]} to={[bMid, ROW_Y - 22]} first="v" progress={prog("check", 0, 0.2) * changeHere}
        lit={inBeat("check") || resting ? 1 : 0.3} pulse={pulse("submit")} />

      <text className="pt-label" x={A.x} y={ROW_Y - 8} opacity={knownHere}
        style={{ fill: knownAccent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>{model.entities[1].label}</text>
      {oneHere + two > 0 ? <text className="pt-label" x={B.x} y={ROW_Y - 8}>Failing after</text> : null}

      {/* The left list, and the places where a new failure has no partner. */}
      {known.map((k, i) => (
        <TestRow key={String(k.id)} x={A.x} w={A.w} y={rowY(i)} label={name(k)} here={knownHere}
          accent={knownAccent} marked={knownMarked} lit={f.lit("oracle")} />
      ))}
      {[2, 3].map((i) => (
        <TestRow key={i} x={A.x} w={A.w} y={rowY(i)} note="not already red" empty={1}
          here={prog("check", 0.18, 0.32) * (i === 3 ? 1 - two : 1) * (1 - wiped)} />
      ))}

      {/* known reds: the joins that cancel a failure the base already had. */}
      {known.map((k, i) => (
        <g key={`j${String(k.id)}`} opacity={1 - wiped}>
          <Line from={[A.x + A.w, rowY(i) + ROW_H / 2]} to={[B.x, rowY(i) + ROW_H / 2]} progress={join}
            lit={inBeat("check") || resting ? 1 : 0.4} quiet={false} />
          {join > 0.95 ? (
            <text className="pt-tag" x={(A.x + A.w + B.x) / 2} y={rowY(i) + ROW_H / 2 - 5} textAnchor="middle">same</text>
          ) : null}
        </g>
      ))}

      {/* The right list, round one. */}
      {known.map((k, i) => (
        <TestRow key={`b1${String(k.id)}`} x={B.x} w={B.w} y={rowY(i)} label={name(k)} note={strike > 0.9 ? "already red" : undefined}
          here={oneHere} struck={strike} lit={0.7} />
      ))}
      {fresh.filter((n) => n.round === 1).map((n, i) => {
        const v = freshVisible(i);
        return (
          <TestRow key={String(n.id)} x={B.x} w={B.w} y={rowY(2 + i)} label={name(n)} here={oneHere}
            note={v < 0.5 ? `fixed: repair ${2 - i}` : inBeat("check") && counted > 0.5 ? "new" : undefined}
            accent={inBeat("check") ? counted : 0} marked={inBeat("check") ? 0 : v} empty={1 - v} />
        );
      })}

      {/* The right list, round two: the same known reds, one new red that will not go away. */}
      {known.map((k, i) => (
        <TestRow key={`b2${String(k.id)}`} x={B.x} w={B.w} y={rowY(i)} label={name(k)} here={two * (1 - wiped)}
          note="already red" struck={1} lit={0.7} />
      ))}
      {fresh.filter((n) => n.round === 2).map((n) => (
        <TestRow key={String(n.id)} x={B.x} w={B.w} y={rowY(2)} label={name(n)} here={two}
          note={used >= 3 ? "still failing" : "new"}
          accent={inBeat("putback") ? 1 - prog("putback", 0.28, 0.36) : 0} marked={1} empty={wiped * 0.6} />
      ))}

      {/* The validator's count: failing after, minus already red. */}
      {counted > 0 ? (
        <g opacity={counted}>
          <text className="pt-label" x={B.x} y={COUNT_Y + 4}
            style={{ fill: countAccent > 0.5 ? "var(--pt-accent-ink)" : undefined }}>
            New failures {shown}
          </text>
          <text className="pt-label-sub" x={B.x} y={COUNT_Y + 20}>{model.entities[3].label}: {model.entities[3].note}</text>
        </g>
      ) : null}

      {/* The three ways out of the validator, dashed until taken. */}
      {/* new failures: validator -> repair */}
      <Route from={fromCheck} to={toRepair} shown={counted} taken={prog("repair", 0, 0.1)}
        lit={inBeat("repair") || twoRepairing || resting ? 1 : 0.3} pulse={pulse("sendback") ?? twoPulse} />
      {/* fix in place: repair -> change */}
      <Route from={[REPAIR.x + REPAIR.width / 2, REPAIR.y]} to={[B.x + B.w, baseY]} first="v" via={baseY}
        shown={counted * (1 - wiped)} taken={prog("repair", 0.02, 0.15)}
        lit={inBeat("repair") || twoRepairing || resting ? 1 : 0.3} pulse={pulse("fix") ?? twoPulse} />
      {counted > 0 ? (
        <text className="pt-tag" x={REPAIR.x + REPAIR.width / 2 + 7} y={baseY + 38} opacity={counted * (1 - wiped)}>fix in place</text>
      ) : null}
      {/* commit: validator -> branch (round one only) */}
      <Route from={[B.x + B.w + 8, COMMIT_Y]} to={[BRANCH_X - 9, COMMIT_Y]} shown={counted * (1 - two)}
        taken={prog("land", 0, 0.2)} lit={inBeat("land") || resting ? 1 : 0.3} pulse={pulse("land")} />
      {counted * (1 - two) > 0 ? (
        <text className="pt-tag" x={(B.x + B.w + BRANCH_X) / 2} y={COMMIT_Y - 6} textAnchor="middle" opacity={counted * (1 - two)}>commit if none</text>
      ) : null}
      {/* reset: the change is wiped back to the round base, over the top. */}
      <Route from={[bMid, PANEL_Y]} to={[aMid, PANEL_Y]} first="v" via={15} shown={counted}
        taken={prog("putback", 0.33, 0.45)} lit={1} accent={inBeat("putback") ? prog("putback", 0.33, 0.4) : 0}
        pulse={pulse("putback")} />
      {counted > 0 ? (
        <text className="pt-tag" x={(aMid + bMid) / 2} y={9} textAnchor="middle" opacity={counted}
          style={{ fill: inBeat("putback") && wiped > 0 ? "var(--pt-accent-ink)" : undefined }}>reset if still red after 3</text>
      ) : null}

      {/* The repair, with its three attempts. */}
      <Panel box={REPAIR} lit={f.lit("repair") || (twoRepairing ? 1 : 0)} accent={inBeat("repair") ? f.on("repair") : 0}>
        <text className="pt-label" x={REPAIR.x + 12} y={REPAIR.y + 22}>{model.entities[4].label}</text>
        <Queue at={[REPAIR.x + 18, REPAIR.y + 44]} count={3} filled={repairs} gap={18} r={5}
          accent={inBeat("repair") ? 1 : 0} lit={1} />
        <text className="pt-tag" x={REPAIR.x + 12} y={REPAIR.y + 68} style={{ fill: "var(--pt-ink)" }}>used {used} of 3</text>
        <text className="pt-tag" x={REPAIR.x + 12} y={REPAIR.y + 84}>MAX_REPAIRS 3</text>
      </Panel>

      {/* The branch: one commit per green round, and where HEAD is. */}
      <text className="pt-label" x={BRANCH_X} y={108} textAnchor="middle">{model.entities[5].label}</text>
      <text className="pt-tag" x={BRANCH_X} y={122} textAnchor="middle">optimize-codebase/auto</text>
      <path className="pt-edge" d={`M ${BRANCH_X} 136 L ${BRANCH_X} 336`} style={{ stroke: "var(--pt-line-2)" }} />
      <Token at={[BRANCH_X, START_Y]} r={5} lit={1} />
      <text className="pt-tag" x={BRANCH_X - 12} y={START_Y + 3.5} textAnchor="end">baseline commit</text>
      <Token at={[BRANCH_X, COMMIT_Y]} r={6} here={commitHere} accent={commitAccent} lit={1} />
      {commitHere > 0 ? (
        <g opacity={commitHere}>
          <text className="pt-tag" x={BRANCH_X} y={COMMIT_Y + 22} textAnchor="middle"
            style={{ fill: commitAccent > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>{name(rounds[0])}</text>
          <text className="pt-tag" x={BRANCH_X} y={COMMIT_Y + 35} textAnchor="middle">{String(rounds[0].repairs)} repairs</text>
        </g>
      ) : null}
      <text className="pt-label" x={BRANCH_X + 12} y={headY + 3.5}>HEAD</text>
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
