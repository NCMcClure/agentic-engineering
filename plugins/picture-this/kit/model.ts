// The model a figure is drawn from: the shape of model.json, and the lookups
// a figure needs. `pt model check` holds a file to this shape and its limits.

export type FlowKind = "write" | "read" | "event" | "query";
export type Hue = "blue" | "green" | "violet" | "yellow" | "pink";
export type Audience = "plain" | "technical";
export type Lens = "structure" | "path" | "time" | "field" | "transformation" | "difference" | "cases" | "scale";

export type Entity = {
  id: string;
  label: string;
  kind: string;
  /** A few words under the name: what it does here. */
  note?: string;
  /** Which side it belongs to, in a figure that sets two arrangements side by side. */
  group?: string;
  hue?: Hue;
  /** The entity this one is inside, or was started by: a part in a case, a session a session spawned. */
  parent?: string;
  /** The beat it comes into being in. Left out, it is there from the start. */
  born?: string;
  /** How many of it are drawn: a few, standing for however many there are. */
  repeat?: number;
  source?: string;
};
/**
 * A number that changes as the story is told: how full, how many, how far.
 * `values` gives it per beat: one number is where it stands when that beat
 * ends, reached evenly from where it stood; a list is its course through the
 * beat, evenly spaced, and may open with a jump (a tank that empties). A beat
 * left out holds the level.
 */
export type Quantity = {
  id: string;
  label: string;
  /** The entity it is a measure of. */
  of?: string;
  unit?: string;
  /** Its ceiling: the limit a meter is drawn against. */
  max?: number;
  /** Where it stands before the first beat. 0 unless said. */
  start?: number;
  values: Record<string, number | number[]>;
};
/** One unit of work, one row, one sample: whatever a view lays out many of. */
export type Row = Record<string, string | number | boolean>;
/** What a view reads beyond the things and flows: a series, a grid of cell values, or a list of rows. */
export type Table = number[] | number[][] | Row[];
export type Flow = { id: string; from: string; to: string; kind: FlowKind; label?: string; source?: string };
export type ModelBeat = {
  id: string;
  ms: number;
  focus: string[];
  flows: string[];
  rest?: boolean;
  title?: string;
  plain?: string;
  technical?: string;
};
export type Model = {
  schema: 1;
  title: string;
  /** One sentence: why this matters. Shown under the figure the whole time. */
  claim: string;
  /** What happens, in one sentence with a verb. */
  mechanism?: string;
  /** What kind of explanation this is: the lens that leads. */
  lens?: Lens;
  /** What follows from it. Optional. */
  implication?: string;
  entities: Entity[];
  flows: Flow[];
  beats: ModelBeat[];
  hero: { beat: string; at?: number };
  quantities?: Quantity[];
  /** Named tables a view draws from: cell values, units of work, the rows of a transcript. */
  data?: Record<string, Table>;
};

export function entity(model: Model, id: string): Entity {
  const found = model.entities.find((e) => e.id === id);
  if (!found) throw new Error(`no entity '${id}'`);
  return found;
}

export function flow(model: Model, id: string): Flow {
  const found = model.flows.find((f) => f.id === id);
  if (!found) throw new Error(`no flow '${id}'`);
  return found;
}

export function beat(model: Model, id: string): ModelBeat {
  const found = model.beats.find((b) => b.id === id);
  if (!found) throw new Error(`no beat '${id}'`);
  return found;
}

/** The beats that say something: every one but the rest beat. */
export function told(model: Model): ModelBeat[] {
  return model.beats.filter((b) => !b.rest);
}

/** Does the model carry a technical track at all? */
export function hasTechnical(model: Model): boolean {
  return told(model).every((b) => typeof b.technical === "string" && b.technical !== "");
}

/** The caption a beat shows a reader. The technical track falls back to the plain one. */
export function caption(model: Model, beatId: string, audience: Audience = "plain"): string {
  const b = beat(model, beatId);
  return (audience === "technical" && b.technical) || b.plain || "";
}

/** Is this entity what the beat is about? An entity a told flow touches counts. */
export function inFocus(model: Model, beatId: string, entityId: string): boolean {
  const b = beat(model, beatId);
  if (b.focus.includes(entityId)) return true;
  return b.flows.some((id) => { const f = flow(model, id); return f.from === entityId || f.to === entityId; });
}

/** Is this flow moving during the beat? */
export function flowing(model: Model, beatId: string, flowId: string): boolean {
  return beat(model, beatId).flows.includes(flowId);
}

/** The groups entities are sorted into, in the order they first appear. */
export function groups(model: Model): string[] {
  return [...new Set(model.entities.map((e) => e.group).filter((g): g is string => Boolean(g)))];
}

/**
 * The flow that leads each beat: of the flows a beat tells, the one arriving
 * furthest along (its target comes latest in the model). What it arrives at
 * is the one thing that beat is about, and the one thing that takes the accent.
 */
export function leads(model: Model): Set<string> {
  const order = new Map(model.entities.map((e, i) => [e.id, i]));
  const out = new Set<string>();
  for (const b of model.beats) {
    let best: Flow | null = null;
    for (const id of b.flows) {
      const f = model.flows.find((x) => x.id === id);
      if (f && (!best || (order.get(f.to) ?? -1) > (order.get(best.to) ?? -1))) best = f;
    }
    if (best) out.add(best.id);
  }
  return out;
}

/** The first beat that tells a flow: when its wire is drawn. */
export function firstBeatOf(model: Model, flowId: string): string | null {
  return model.beats.find((b) => b.flows.includes(flowId))?.id ?? null;
}

/** The first beat that brings an entity in, by focus or by a flow that touches it. */
export function firstBeatWith(model: Model, entityId: string): string | null {
  return model.beats.find((b) => !b.rest && inFocus(model, b.id, entityId))?.id ?? null;
}

/** The entities inside this one, or started by it, in the model's order. */
export function children(model: Model, id: string): Entity[] {
  return model.entities.filter((e) => e.parent === id);
}

/** How many things this entity is inside: 0 for one with no parent. */
export function depth(model: Model, id: string): number {
  let n = 0;
  for (let at = entity(model, id); at.parent && n < model.entities.length; at = entity(model, at.parent)) n += 1;
  return n;
}

/** How many of an entity are drawn: its `repeat`, or one. */
export function unitsOf(model: Model, id: string): number {
  return entity(model, id).repeat ?? 1;
}

export function quantity(model: Model, id: string): Quantity {
  const found = model.quantities?.find((q) => q.id === id);
  if (!found) throw new Error(`no quantity '${id}'`);
  return found;
}

const course = (v: number | number[]): number[] => (Array.isArray(v) ? v : [v]);

/**
 * Where a quantity stands in beat `index`, `p` (0 to 1) of the way through it.
 * A beat with one value is reached evenly from the level before it; a beat
 * with a list follows the list, evenly spaced; a beat with none holds.
 */
export function levelAt(model: Model, id: string, index: number, p: number): number {
  const q = quantity(model, id);
  let before = q.start ?? 0;
  for (let i = 0; i < index && i < model.beats.length; i++) {
    const v = q.values[model.beats[i].id];
    if (v !== undefined) before = course(v)[course(v).length - 1];
  }
  const now = model.beats[index] ? q.values[model.beats[index].id] : undefined;
  if (now === undefined) return before;
  const points = course(now);
  const at = Math.min(1, Math.max(0, p));
  if (points.length === 1) return before + (points[0] - before) * at;
  const along = at * (points.length - 1), i = Math.min(points.length - 2, Math.floor(along));
  return points[i] + (points[i + 1] - points[i]) * (along - i);
}

/**
 * A quantity's whole course, as the points it passes through: `at` counts in
 * beats (2.5 is half-way through the third), so a figure can draw the curve
 * up to now, or find where it falls. A fall is two points close together.
 */
export function knots(model: Model, id: string): { at: number; value: number }[] {
  const q = quantity(model, id);
  const out = [{ at: 0, value: q.start ?? 0 }];
  model.beats.forEach((b, index) => {
    const v = q.values[b.id];
    if (v === undefined) return;
    const points = course(v);
    if (points.length === 1) out.push({ at: index + 1, value: points[0] });
    else points.forEach((value, i) => out.push({ at: index + i / (points.length - 1), value }));
  });
  const last = out[out.length - 1];
  if (last.at < model.beats.length) out.push({ at: model.beats.length, value: last.value });
  return out;
}

/** Where a quantity falls: each stretch of its course that goes down, as the beat-time it starts and ends at, and from what to what. */
export function falls(model: Model, id: string): { from: number; to: number; high: number; low: number }[] {
  const points = knots(model, id);
  const out = [];
  for (let i = 1; i < points.length; i++) {
    if (points[i].value < points[i - 1].value) out.push({ from: points[i - 1].at, to: points[i].at, high: points[i - 1].value, low: points[i].value });
  }
  return out;
}

function table(model: Model, name: string): Table {
  const found = model.data?.[name];
  if (!found) throw new Error(`no data '${name}'`);
  return found;
}

/** A named table that is a list of numbers. */
export function series(model: Model, name: string): number[] {
  const t = table(model, name);
  if (!t.every((v) => typeof v === "number")) throw new Error(`data '${name}' is not a series of numbers`);
  return t as number[];
}

/** A named table that is a grid: rows of cell values. */
export function cells(model: Model, name: string): number[][] {
  const t = table(model, name);
  if (!t.every((v) => Array.isArray(v))) throw new Error(`data '${name}' is not a grid of cells`);
  return t as number[][];
}

/** A named table that is a list of rows: units of work, turns, samples. */
export function rows(model: Model, name: string): Row[] {
  const t = table(model, name);
  if (!t.every((v) => v !== null && typeof v === "object" && !Array.isArray(v))) throw new Error(`data '${name}' is not a list of rows`);
  return t as Row[];
}
