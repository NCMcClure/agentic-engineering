"use client";
// sound-you-can-see: a sound an agent made and cannot hear, drawn the way
// `pl audio spectrogram` draws it: time across, frequency up, a cell's weight
// its level. The chime has a click where two takes were joined. In the
// picture it is a tall line between the notes; in `pl audio onsets` it is one
// start too many, at 0.38 s. The agent crossfades the join and checks again.
// Every level, peak and number here was measured by pl on that chime.
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { Elbow, Line } from "../kit/flat/connect";
import { mix, tint } from "../kit/flat/geometry";
import { Bar, Panel } from "../kit/flat/panel";
import { Label } from "../kit/label";
import { clamp, ease, indexOf, outro, span } from "../kit/timeline";
import data from "./model.json";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 760, height: 312 };

// The picture's cells in dB under the loudest bin, top frequency first; the
// three columns the crossfade changed; the waveform's peak in each 25 ms.
const LEVELS = model.data?.levels as number[][];
const REPAIRED = model.data?.repaired as number[][];
const WAVE = model.data?.wave as number[];
const ROWS = LEVELS.length, COLS = LEVELS[0].length;
const REPAIRED_FROM = 6; // the first of those three columns
const SECONDS = 1.2, CLICK_AT = 0.38;
const LOWEST = 30, HIGHEST = 20000, RANGE = 80; // pl's own defaults: --lowest, the top of hearing, --range

// Layout, in px.
const TOP = 48, CELL_W = 12, CELL_H = 9.5;
const PLOT = { x: 240, y: TOP, width: COLS * CELL_W, height: ROWS * CELL_H };
const FLOOR = PLOT.y + PLOT.height;
const SOUND = { x: 16, y: TOP, width: 156, height: PLOT.height };
const NUM = { x: 548, y: TOP, width: 196, height: PLOT.height };
const NEXT = { x: 16, y: 244, width: 220, height: 54 };
const WAVE_X = 22, WAVE_W = 144, WAVE_Y = 114, WAVE_GAIN = 110, WAVE_FLOOR = 176;
const HEAD_Y = 22, SUB_Y = 37;
const TEXT_X = NUM.x + 10;
const LEGEND_X = PLOT.x + PLOT.width - 74;

const r = (v: number) => Math.round(v * 100) / 100;
const share = (db: number) => tint(db, -RANGE, 0, 5);
/** How heavy a cell is drawn: the quietest step is faint, as it is in pl's own picture. */
const weight = (s: number) => 0.05 + 0.83 * s ** 1.4;
const cellInk = (s: number) => mix("var(--pt-ink)", "var(--pt-top)", weight(s));
const plotX = (seconds: number) => PLOT.x + (PLOT.width * seconds) / SECONDS;
const waveX = (seconds: number) => WAVE_X + (WAVE_W * seconds) / SECONDS;
const hzY = (hz: number) => FLOOR - (PLOT.height * Math.log(hz / LOWEST)) / Math.log(HIGHEST / LOWEST);
/** A cell the click put there: louder than the repaired sound is at that time and pitch. */
const isClick = (row: number, column: number) => {
  const k = column - REPAIRED_FROM;
  return k >= 0 && k < REPAIRED.length && LEVELS[row][column] - REPAIRED[k][row] >= 6;
};
const onPanel = { ["--pt-halo" as string]: "var(--pt-top)" };
const flatText = { ["--pt-halo" as string]: "transparent" };

/** A time axis: a tick every 0.1 s, and the three that carry a number. */
function Seconds({ x, y, width }: { x: number; y: number; width: number }) {
  const named: Record<number, string> = { 0: "0", 6: "0.6", 12: "1.2 s" };
  return (
    <g>
      {Array.from({ length: 13 }, (_, i) => {
        const tx = r(x + (width * i) / 12);
        return (
          <g key={i}>
            <path className="pt-rule" d={`M ${tx} ${y} L ${tx} ${y + (named[i] ? 5 : 3)}`} style={{ stroke: "var(--pt-line-2)" }} />
            {named[i] ? <text className="pt-tag" x={tx} y={y + 17} textAnchor={i === 0 ? "start" : i === 12 ? "end" : "middle"}>{named[i]}</text> : null}
          </g>
        );
      })}
    </g>
  );
}

/** A strip behind one line of the readout: the line the beat is about, or one it marked earlier. */
function Strip({ y, accent = 0, marked = 0 }: { y: number; accent?: number; marked?: number }) {
  if (accent <= 0 && marked <= 0) return null;
  const fill = mix("var(--pt-accent-soft)", "var(--pt-top)", Math.max(accent, 0.7 * marked));
  return <rect x={NUM.x + 6} y={y - 10.5} width={NUM.width - 12} height={15} rx={2}
    style={{ fill, stroke: accent > 0 ? mix("var(--pt-accent)", "transparent", accent) : "none", strokeWidth: 1.25 }} />;
}

function Scene() {
  const f = useFigure();
  const { index, p } = f.frame;
  const at = (id: string) => indexOf(f.tl, id);
  /** 0 before the beat, its progress in it, 1 after. */
  const through = (id: string) => (index < at(id) ? 0 : index > at(id) ? 1 : p);
  const arrive = (id: string, a = 0, b = 0.3) => ease.out(span(through(id), a, b));
  // What the story built leaves before the loop starts over; what stood there from the start stays.
  const built = outro(f.tl, f.frame);

  // pl reads the sound along time: the first pass draws the picture, the second redraws it after the edit.
  const firstPass = span(through("draw"), 0.06, 0.42);
  const secondPass = span(through("clean"), 0.05, 0.38);
  const sweep = firstPass > 0 && firstPass < 1 ? firstPass : secondPass > 0 && secondPass < 1 ? secondPass : null;

  // The click: in the accent while it is being pointed at, a tint of it afterwards, gone once repaired.
  const seen = index >= at("see");
  const pointing = f.on("see");
  const cleaned = (column: number) => column < secondPass * COLS;
  const clickGone = cleaned(REPAIRED_FROM + REPAIRED.length - 1);
  const marked = arrive("see", 0.05, 0.3);

  // The readout: three commands, their answers printed in order, and the onsets answer again after the edit.
  const mp = through("measure");
  const line = (k: number) => ease.out(span(mp, 0.04 + k * 0.045, 0.1 + k * 0.045));
  const swap = span(through("clean"), 0.4, 0.48);
  const failing = swap < 0.5;
  const onsetsInk = failing ? 1 - 2 * swap : 2 * swap - 1;
  const naming = f.on("measure") * line(7);
  const passing = f.on("clean") * (failing ? 0 : onsetsInk);

  // The edit: the number travels to it, it is written, and it lands on the sound at that instant.
  const editing = f.on("fix");
  const told = arrive("fix", 0, 0.3);
  const written = arrive("fix", 0.15, 0.35);
  const sent = arrive("fix", 0.25, 0.38);
  const landed = arrive("fix", 0.36, 0.48);
  const edited = written * built;
  const done = arrive("clean", 0, 0.12);

  const frame = (lit: number, accent: number) => {
    const ink = mix("var(--pt-line)", "var(--pt-line-2)", 0.25 + 0.75 * lit);
    return accent > 0 ? mix("var(--pt-accent)", ink, accent) : ink;
  };
  const value = (y: number, text: string, shown: number, style?: Record<string, string>) => (
    shown > 0 ? <text className="pt-tag" x={TEXT_X} y={y} opacity={r(shown * built)} style={{ ...flatText, ...style }}>{text}</text> : null
  );
  /** A command is quiet until it has been run. */
  const command = (y: number, text: string, ran: number) => (
    <text className="pt-tag" x={TEXT_X} y={y} style={{ ...onPanel, fill: mix("var(--pt-ink)", "var(--pt-ink-3)", ran * built) }}>{text}</text>
  );

  return (
    <g>
      {/* What the agent made: a sound, drawn as the wave it is */}
      <text className="pt-label" x={SOUND.x} y={HEAD_Y}>What the agent made</text>
      <text className="pt-tag" x={SOUND.x} y={SUB_Y}>chime.wav · never played</text>
      <Panel box={SOUND} accent={f.on("made")}>
        {WAVE.map((peak, i) => {
          const h = Math.max(1, peak * 2 * WAVE_GAIN);
          return <Bar key={i} box={{ x: WAVE_X + i * 3, y: r(WAVE_Y - h / 2), width: 2, height: r(h) }} tone="mid" accent={f.on("made")} radius={1} />;
        })}
        <path className="pt-rule" d={`M ${WAVE_X} ${WAVE_FLOOR} L ${WAVE_X + WAVE_W} ${WAVE_FLOOR}`} style={{ stroke: "var(--pt-line-2)" }} />
        <Seconds x={WAVE_X} y={WAVE_FLOOR} width={WAVE_W} />
        {/* Where the edit lands: the join, at 0.38 s */}
        {landed > 0 ? <line x1={r(waveX(CLICK_AT))} x2={r(waveX(CLICK_AT))} y1={FLOOR} y2={r(FLOOR - (FLOOR - SOUND.y - 16) * landed)} opacity={r(built)}
          style={{ stroke: mix("var(--pt-accent)", "var(--pt-ink-3)", editing), strokeWidth: 1.5 }} /> : null}
        {sweep !== null ? <line x1={r(WAVE_X + WAVE_W * sweep)} x2={r(WAVE_X + WAVE_W * sweep)} y1={SOUND.y + 16} y2={WAVE_FLOOR}
          style={{ stroke: "var(--pt-accent)", strokeWidth: 1.5 }} /> : null}
      </Panel>

      {/* The picture pl draws: time across, frequency up, a cell's weight its level */}
      <text className="pt-label" x={PLOT.x} y={HEAD_Y}>What pl draws</text>
      <text className="pt-tag" x={PLOT.x} y={SUB_Y}>pl audio spectrogram chime.wav</text>
      {[100, 1000, 10000].map((hz) => (
        <g key={hz}>
          <path className="pt-rule" d={`M ${PLOT.x - 5} ${r(hzY(hz))} L ${PLOT.x} ${r(hzY(hz))}`} style={{ stroke: "var(--pt-line-2)" }} />
          <text className="pt-tag" x={PLOT.x - 9} y={r(hzY(hz) + 3.5)} textAnchor="end">{hz >= 1000 ? `${hz / 1000}k Hz` : `${hz} Hz`}</text>
        </g>
      ))}
      <Panel box={PLOT} radius={3}>
        <g opacity={r(built)}>
          {LEVELS.map((levels, row) => levels.map((db, column) => {
            const here = clamp(firstPass * COLS - column);
            const repaired = cleaned(column) && column >= REPAIRED_FROM && column < REPAIRED_FROM + REPAIRED.length;
            const s = share(repaired ? REPAIRED[column - REPAIRED_FROM][row] : db);
            if (here <= 0 || s <= 0) return null;
            const fill = !repaired && seen && isClick(row, column)
              ? mix(mix("var(--pt-accent)", "var(--pt-top)", 0.55 + 0.45 * s), index === at("see") ? cellInk(s) : mix("var(--pt-accent)", "var(--pt-top)", 0.26 + 0.2 * s), pointing)
              : cellInk(s);
            return <rect key={`${row}-${column}`} className="pt-cell" x={PLOT.x + column * CELL_W} y={PLOT.y + row * CELL_H} width={CELL_W} height={CELL_H}
              opacity={r(here)} style={{ fill, stroke: "var(--pt-top)" }} />;
          }))}
          {/* Where the click stood, once it is gone */}
          {clickGone ? <line className="pt-guide" x1={r(plotX(CLICK_AT))} x2={r(plotX(CLICK_AT))} y1={PLOT.y} y2={FLOOR} /> : null}
          {seen ? (
            <g opacity={r(arrive("see", 0.1, 0.35))}>
              <text className="pt-tag" x={PLOT.x + 12} y={PLOT.y + 138}>note 1</text>
              <text className="pt-tag" x={PLOT.x + 132} y={PLOT.y + 118}>note 2</text>
            </g>
          ) : null}
        </g>
        {sweep !== null ? <line x1={r(PLOT.x + PLOT.width * sweep)} x2={r(PLOT.x + PLOT.width * sweep)} y1={PLOT.y} y2={FLOOR}
          style={{ stroke: "var(--pt-accent)", strokeWidth: 1.5 }} /> : null}
      </Panel>
      {/* The frame again, over the cells, so the picture stays inside its box */}
      <rect x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} rx={3}
        style={{ fill: "none", stroke: frame(1, f.on("draw")), strokeWidth: f.on("draw") > 0.5 ? 1.5 : 1 }} />
      <Seconds x={PLOT.x} y={FLOOR} width={PLOT.width} />
      {/* The level scale, as pl's own sheet states it: the heavier the cell, the louder */}
      <text className="pt-tag" x={LEGEND_X - 4} y={FLOOR + 33} textAnchor="end">quiet</text>
      {[0.25, 0.5, 0.75, 1].map((s, i) => (
        <rect key={s} className="pt-cell" x={LEGEND_X + i * 11} y={FLOOR + 25} width={11} height={CELL_H} style={{ fill: cellInk(s), stroke: "var(--pt-bg)" }} />
      ))}
      <text className="pt-tag" x={LEGEND_X + 48} y={FLOOR + 33}>loud</text>
      {marked > 0 ? (
        <g opacity={r(marked * built)}>
          {clickGone ? null
            : <Label at={[PLOT.x + 8 * CELL_W + 1, PLOT.y + 10]} title="A click" sub="every pitch at once" dx={26} dy={5} anchor="start" dot={false} lit={Math.max(pointing, 0.4)} />}
          <path className="pt-edge" d={`M ${r(plotX(CLICK_AT))} ${FLOOR} L ${r(plotX(CLICK_AT))} ${FLOOR + 6}`}
            style={{ stroke: mix("var(--pt-accent)", "var(--pt-ink-2)", pointing), strokeWidth: 1.5 }} />
          <text className="pt-tag" x={r(plotX(CLICK_AT))} y={FLOOR + 17} textAnchor="middle"
            style={{ fill: mix("var(--pt-accent-ink)", "var(--pt-ink-2)", pointing) }}>0.38 s</text>
        </g>
      ) : null}

      {/* The numbers: what three commands print about the same sound */}
      <text className="pt-label" x={NUM.x} y={HEAD_Y}>The numbers</text>
      <text className="pt-tag" x={NUM.x} y={SUB_Y}>three checks of the same file</text>
      <Panel box={NUM}>
        {command(NUM.y + 18, "$ pl audio probe", line(0))}
        {value(NUM.y + 31, "peak -9.38 dBFS", line(0))}
        {value(NUM.y + 44, "loudness -20.4 LUFS", line(1))}
        {command(NUM.y + 62, "$ pl audio silence", line(2))}
        {value(NUM.y + 75, "ok: not silent, not clipped", line(2))}
        {command(NUM.y + 93, "$ pl audio onsets", line(4))}
        <g opacity={r(built)}>
          <Strip y={NUM.y + 145} accent={failing ? naming : passing} marked={failing ? line(7) * onsetsInk : onsetsInk} />
        </g>
        {failing ? (
          <g opacity={r(onsetsInk)}>
            {value(NUM.y + 106, "3 onsets at (s):", line(4))}
            {value(NUM.y + 119, "0.104, 0.380, 0.605", line(5))}
            {value(NUM.y + 132, "against 2 expected:", line(6))}
            {value(NUM.y + 145, "extra 0.3803", line(7), { fill: naming > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" })}
            {value(NUM.y + 160, "GATE FAILED", line(8), { fill: "var(--pt-ink)" })}
            {line(8) > 0 ? <text className="pt-tag" x={NUM.x + NUM.width - 10} y={NUM.y + 160} textAnchor="end" opacity={r(line(8) * built)} style={flatText}>exit 1</text> : null}
          </g>
        ) : (
          <g opacity={r(onsetsInk)}>
            {value(NUM.y + 106, "2 onsets at (s):", 1)}
            {value(NUM.y + 119, "0.104, 0.605", 1)}
            {value(NUM.y + 132, "against 2 expected:", 1)}
            {value(NUM.y + 145, "extra none", 1, { fill: passing > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" })}
            {value(NUM.y + 160, "GATE PASSED", 1, { fill: "var(--pt-ink)" })}
            <text className="pt-tag" x={NUM.x + NUM.width - 10} y={NUM.y + 160} textAnchor="end" opacity={r(built)} style={flatText}>exit 0</text>
          </g>
        )}
      </Panel>

      {/* What the agent does next: empty until the numbers say what, and where */}
      <Elbow from={[NUM.x + NUM.width / 2, FLOOR]} to={[NEXT.x + NEXT.width, NEXT.y + 36]} first="v" via={NEXT.y + 36} quiet
        progress={told * built} pulse={editing > 0 && index === at("fix") ? ease.out(span(p, 0.04, 0.36)) : undefined} lit={Math.max(editing, 0.2)} />
      {told > 0 && swap < 1 ? <text className="pt-tag" x={NUM.x + NUM.width / 2 - 16} y={NEXT.y + 29} textAnchor="end"
        opacity={r(span(told, 0.5, 1) * (1 - swap) * (0.55 + 0.45 * editing))}>extra 0.3803</text> : null}
      <rect className="pt-panel" x={NEXT.x} y={NEXT.y} width={NEXT.width} height={NEXT.height} rx={6}
        style={{ stroke: frame(edited, editing * written), strokeWidth: editing * written > 0.5 ? 1.5 : 1, strokeDasharray: edited < 0.5 ? "4 3" : undefined }} />
      <text className="pt-label" x={NEXT.x + 10} y={NEXT.y + 19} style={onPanel}>What the agent does next</text>
      {edited > 0 ? (
        <g opacity={r(edited)}>
          <rect x={NEXT.x + 6} y={NEXT.y + 27} width={NEXT.width - 12} height={18} rx={2}
            style={{ fill: mix("var(--pt-accent-soft)", "var(--pt-top)", Math.max(editing, 0.7)), stroke: editing > 0 ? mix("var(--pt-accent)", "transparent", editing) : "none", strokeWidth: 1.25 }} />
          <text className="pt-tag" x={NEXT.x + 12} y={NEXT.y + 39.5} style={{ ...flatText, fill: editing > 0.5 ? "var(--pt-accent-ink)" : "var(--pt-ink)" }}>crossfade 10 ms at 0.38 s</text>
          {done > 0 ? <text className="pt-tag" x={NEXT.x + NEXT.width - 12} y={NEXT.y + 39.5} textAnchor="end" opacity={r(done)} style={flatText}>done</text> : null}
        </g>
      ) : null}
      <Line from={[r(waveX(CLICK_AT)), NEXT.y]} to={[r(waveX(CLICK_AT)), FLOOR + 2]} progress={sent * built} head accent={editing} quiet={false} lit={0.3} />
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
