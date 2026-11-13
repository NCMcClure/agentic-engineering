"use client";
// The blank stage. Where a draft starts: the stage, the clock and the model
// are set up, and nothing is drawn. Say what the view is in view.json (what
// is drawn, what moves, what each visual property means), then draw that.
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import data from "./model.json";

const model = data as Model;
// The art's box, in px. Make it the size and shape the picture needs.
const VIEW = { x: 0, y: 0, width: 720, height: 400 };

// What there is to draw with. kit/README.md has each one's props; the studies
// (`draft studies`) show them at work. Take what the view needs and no more.
//
//   The frame     useFigure(): f.frame (the beat, and how far through it), f.model,
//                 f.here / f.lit / f.arriving (an entity), f.laid / f.moving (a flow),
//                 f.level / f.share (a quantity), f.on(...beats), f.phase() (something
//                 circulating), f.present (the whole figure fading in and out with the
//                 loop); steps / span / ease / lerp in kit/timeline for what happens
//                 inside a beat. A beat is read at its middle: show its point by then.
//   Flat space    kit/flat: Panel, Bar, Tile (a box, one of a kind, a value in a square),
//                 Elbow, Line, Token, Queue (what joins, what travels, what is counted),
//                 Meter, Axis, Cells, Lanes (a level, a ruled scale, a grid, a time grid's ground),
//                 and geometry: elbow, between, cell, slotIn, spread, tint, mix
//   Isometric     kit/iso: Block, Plate, Layers, Cylinder, Face, Guide, Ground, Wire,
//                 and project / plate / block / disc
//   Words         Label (a name with a leader, at a page point or a ground point),
//                 and plain <text className="pt-label"> or "pt-tag"
//   Plain SVG     anything else, with the kit's classes: pt-edge (a thing's line),
//                 pt-guide (dashed: not a thing), pt-rule (a quiet rule)
//
// Draw as a function of the frame. Nothing may move on its own.
function Scene() {
  const f = useFigure();
  return (
    <g opacity={f.present}>
      <rect className="pt-guide" x={VIEW.x + 12} y={VIEW.y + 12} width={VIEW.width - 24} height={VIEW.height - 24} rx={10} />
      <text className="pt-tag" x={VIEW.width / 2} y={VIEW.height / 2} textAnchor="middle">nothing drawn yet</text>
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
