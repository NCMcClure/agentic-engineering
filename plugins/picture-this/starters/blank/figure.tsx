"use client";
// Archetype: draw your own. The stage, the clock and the model are set up and
// the drawing is left to you: an exploded view, a cutaway, a time grid, a
// field, a mapping, a zoom. Reach for it when the lens calls for a view that
// has no starter yet, or the subject has a shape of its own worth drawing.
import { Label } from "../kit/label";
import type { Model } from "../kit/model";
import { Stage, useFigure } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { disc, fitBox, plate } from "../kit/iso/project";
import type { P3 } from "../kit/iso/project";
import { Face, Guide } from "../kit/iso/shapes";
import data from "./model.json";

const model = data as Model;
const UNIT = 40;

// What follows is a placeholder that works for any model: each entity as a
// slab, pulled apart along one axis, with a guide back to where it sits. It
// shows the helpers at work. Replace it with the picture the lens calls for.
//
// The tools:
//   project([x, y, z], UNIT)       a ground point on the screen (x down-right, y down-left, z up)
//   plate / block / disc           the outlines of a slab, a box, a circle on the ground
//   <Face points tone entity />    any outline, in the house style; tone is which way it faces
//   <Guide from to />              a dashed line: where a part returns to, a path through space
//   <Label entity at dx dy />      a flat name with a leader
//   useFigure()                    f.here, f.lit, f.arriving for an entity; f.laid, f.moving for a
//                                  flow; f.phase() for something circulating; f.frame for the rest
// Draw as a function of the frame. Nothing may move on its own.
const W = 4.2, D = 3, GAP = 1.5;
const ids = model.entities.map((e) => e.id);
// The first entity is the top part.
const rest = (id: string) => (ids.length - 1 - ids.indexOf(id)) * 0.22;
const apart = (id: string) => (ids.length - 1 - ids.indexOf(id)) * GAP;
const TOP = (ids.length - 1) * GAP;
const VIEW = fitBox([[0, 0, TOP + 0.4], [W, 0, 0], [0, D, 0], [W, D, 0], [0, D, TOP]], UNIT, [30, 190, 30, 60]);

function Scene() {
  const f = useFigure();
  // Together while the loop rests, apart while the story is told.
  const spread = f.frame.beat.rest ? 1 - f.frame.p : f.frame.index === 0 ? Math.min(1, f.frame.p * 3) : 1;
  const z = (id: string) => rest(id) + (apart(id) - rest(id)) * spread;
  const bottomUp = [...ids].reverse();
  return (
    <>
      {/* The axis the parts were pulled along, at two corners. */}
      <Guide from={[0, D, z(ids[ids.length - 1])]} to={[0, D, z(ids[0])]} />
      <Guide from={[W, 0, z(ids[ids.length - 1])]} to={[W, 0, z(ids[0])]} />
      {bottomUp.map((id, i) => {
        const hole = disc(W / 2, D / 2, z(id), 0.5, UNIT);
        return (
          <g key={id}>
            <Face entity={id} points={plate(0, 0, z(id), W, D, UNIT)} accent={f.arriving(id) * 0.9} />
            {/* A detail of the part's own: here, every other one has a hub. */}
            {i % 2 === 0 ? <ellipse className="pt-edge" cx={hole.cx} cy={hole.cy} rx={hole.rx} ry={hole.ry} style={{ fill: "var(--pt-bg)", stroke: "var(--pt-line-2)" }} /> : null}
          </g>
        );
      })}
      {ids.map((id) => {
        const corner: P3 = [W, D * 0.5, z(id)];
        return <Label key={id} entity={id} at={corner} sub={f.model.entities.find((e) => e.id === id)?.note} dx={64} dy={-2} anchor="start" />;
      })}
    </>
  );
}

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={UNIT} viewBox={VIEW} {...props}>
      <Scene />
    </Stage>
  );
}
