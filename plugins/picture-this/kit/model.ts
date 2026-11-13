// The model a figure is drawn from: the shape of model.json, and the lookups
// a figure needs. `pt model check` holds a file to this shape and its limits.

export type FlowKind = "write" | "read" | "event" | "query";
export type Hue = "blue" | "green" | "violet" | "yellow" | "pink";
export type Audience = "plain" | "technical";

export type Entity = { id: string; label: string; kind: string; hue?: Hue; source?: string };
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
  /** What follows from it. Optional. */
  implication?: string;
  entities: Entity[];
  flows: Flow[];
  beats: ModelBeat[];
  hero: { beat: string; at?: number };
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

/** The first beat that tells a flow: when its wire is drawn. */
export function firstBeatOf(model: Model, flowId: string): string | null {
  return model.beats.find((b) => b.flows.includes(flowId))?.id ?? null;
}

/** The first beat that brings an entity in, by focus or by a flow that touches it. */
export function firstBeatWith(model: Model, entityId: string): string | null {
  return model.beats.find((b) => !b.rest && inFocus(model, b.id, entityId))?.id ?? null;
}
