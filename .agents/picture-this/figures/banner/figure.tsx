"use client";
// banner: the root README's banner, after the LinkedIn one and the portfolio
// it came from (nmcclure.com). The portfolio's hairline columns, its header
// rule, its crosshair, and its line "I build..." with the words that follow
// rolling past one at a time; the house style's page, ink and one accent.
// The picture on the left is the builder.
//
// It loops without a seam: the rest beat brings the first word back, so the
// last frame runs into the first, and nothing fades at the loop's edges.
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { mix } from "../kit/flat/geometry";
import { clamp, ease } from "../kit/timeline";
import data from "./model.json";
import "./banner.css";

const model = data as Model;
const VIEW = { x: 0, y: 0, width: 1200, height: 300 };
const AVATAR = new URL("./avatar.jpg", import.meta.url).href;

// The words that follow "I build", in the order the portfolio says them.
const WORDS = model.beats.filter((b) => !b.rest).map((b) => model.entities.find((e) => e.id === b.id)?.label ?? b.id);

// Layout, in px.
const COLUMN = 150; // the portfolio's grid
const HEADER = 48; // the rule under the header row
const FACE = { x: 140, y: 174, r: 88 };
const LINE = { x: 560, y: 198, pitch: 96 }; // where the words start, the baseline they stop on, and a line's height
const SLIDE_MS = 720;
const MARK = { x: 1132, y: 252, r: 11, reach: 34 };

/** How far the words have rolled: a whole number while one is being told, moving at the start of the next beat. */
function rolled(index: number, ms: number): number {
  if (index === 0) return 0; // the loop's first beat opens where the rest left it
  return index - 1 + ease.inOut(clamp(ms / SLIDE_MS));
}

function Banner() {
  const f = useFigure();
  const at = rolled(f.frame.index, f.frame.ms);
  const loop = f.frame.t / f.tl.total; // 0 to 1 round the whole loop
  const blink = 0.5 - 0.5 * Math.cos(f.phase(2) * 2 * Math.PI); // the status dot: two whole laps a beat
  const drift = Math.sin(loop * 2 * Math.PI) * 14;
  const lines = [-2, -1, 0, 1, 2].map((d) => Math.round(at) + d);

  return (
    <>
      <rect className="bn-ground" x={0} y={0} width={VIEW.width} height={VIEW.height} />
      {Array.from({ length: VIEW.width / COLUMN - 1 }, (_, i) => (
        <line key={i} className="bn-rule" x1={(i + 1) * COLUMN} y1={HEADER} x2={(i + 1) * COLUMN} y2={VIEW.height} />
      ))}

      {/* The words, rolling up past the line they stop on. */}
      <clipPath id="bn-window"><rect x={0} y={HEADER} width={VIEW.width} height={VIEW.height - HEADER} /></clipPath>
      <g clipPath="url(#bn-window)">
        <text className="bn-line" x={LINE.x - 18} y={LINE.y} textAnchor="end" style={{ fill: "var(--pt-ink-2)" }}>I build</text>
        {lines.map((k) => {
          const near = 1 - clamp(Math.abs(k - at)); // 1 on the line, 0 a line away
          const word = WORDS[((k % WORDS.length) + WORDS.length) % WORDS.length];
          const quiet = mix("var(--pt-ink-3)", "var(--pt-rule)", 0.42);
          return (
            <text key={k} className="bn-line" x={LINE.x} y={LINE.y + (k - at) * LINE.pitch} style={{ fill: mix("var(--pt-ink)", quiet, ease.inOut(near)) }}>
              {word.replace(/\.$/, "")}
              <tspan style={{ fill: mix("var(--pt-accent)", quiet, ease.inOut(near)) }}>.</tspan>
            </text>
          );
        })}
      </g>

      {/* The header row, as on the portfolio. */}
      <rect className="bn-ground" x={0} y={0} width={VIEW.width} height={HEADER} />
      <line className="bn-rule" x1={0} y1={HEADER} x2={VIEW.width} y2={HEADER} />
      <text className="bn-name" x={52} y={30}>nick mcclure</text>
      <text className="bn-mono" x={2 * COLUMN + 12} y={29}>agentic engineering / 12 plugins for claude code</text>
      <text className="bn-mono" x={VIEW.width - 40} y={29} textAnchor="end">currently creating something...</text>
      <circle cx={VIEW.width - 40 - 224} cy={25.5} r={3} style={{ fill: mix("var(--pt-ink)", "var(--pt-ink-3)", blink) }} />

      {/* The builder. */}
      <clipPath id="bn-face"><circle cx={FACE.x} cy={FACE.y} r={FACE.r} /></clipPath>
      <circle className="bn-ground" cx={FACE.x} cy={FACE.y} r={FACE.r + 10} />
      <image href={AVATAR} x={FACE.x - FACE.r} y={FACE.y - FACE.r} width={FACE.r * 2} height={FACE.r * 2} clipPath="url(#bn-face)" preserveAspectRatio="xMidYMid slice" />
      <circle className="bn-ring" cx={FACE.x} cy={FACE.y} r={FACE.r} />
      <circle className="bn-rule" cx={FACE.x} cy={FACE.y} r={FACE.r + 10} />

      {/* The portfolio's crosshair, drifting a little along its own line. */}
      <line className="bn-mark" x1={MARK.x - MARK.reach} y1={MARK.y} x2={MARK.x + MARK.reach} y2={MARK.y} />
      <circle className="bn-mark" cx={MARK.x + drift} cy={MARK.y} r={MARK.r} />
    </>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={1} viewBox={VIEW} {...props} captions={false} controls={false}>
      <Banner />
    </Stage>
  );
}
