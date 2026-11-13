// What a figure's model.json must be before anything is drawn from it. Pure:
// the model in, a list of findings out. The limits are the house style's, so a
// figure that passes here is small enough to read.
import fs from "node:fs";
import path from "node:path";

export const FLOW_KINDS = ["write", "read", "event", "query"];
/** The entity hues the kit's tokens define, beside the one accent. */
export const HUES = ["blue", "green", "violet", "yellow", "pink"];
export const LIMITS = {
  entities: [2, 9], beats: [2, 7], hues: 4,
  claim: 140, plain: 140, technical: 200, label: 28,
  beatMs: [1200, 8000], restMs: [400, 4000], loopMs: 30000,
};

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SOURCE = /^(.+):(\d+)$/;
const text = (v) => typeof v === "string" && v.trim() !== "";
const list = (v) => (Array.isArray(v) ? v : []);

/** `path:line` against a repo: the file exists and has that line. Returns a complaint, or null. */
function sourceProblem(source, repo) {
  const m = SOURCE.exec(source);
  if (!m) return `source '${source}' is not path:line`;
  if (!repo) return null;
  const file = path.resolve(repo, m[1]);
  if (path.relative(path.resolve(repo), file).startsWith("..")) return `source '${source}' is outside the repo`;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return `source '${source}': no such file`;
  const lines = fs.readFileSync(file, "utf8").split("\n").length;
  return Number(m[2]) >= 1 && Number(m[2]) <= lines ? null : `source '${source}': the file has ${lines} lines`;
}

/**
 * Check a parsed model. `repo` resolves sources against a checkout;
 * `requireSource` (a figure drawn from code) wants one on every entity and flow.
 * Returns { errors, warnings }, each a list of sentences.
 */
export function checkModel(model, { repo = null, requireSource = false } = {}) {
  const errors = [], warnings = [];
  const bad = (m) => errors.push(m);
  if (!model || typeof model !== "object" || Array.isArray(model)) return { errors: ["the model is not a JSON object"], warnings };

  if (model.schema !== 1) bad(`schema is ${JSON.stringify(model.schema)}, expected 1`);
  if (!text(model.title)) bad("title is missing");
  if (!text(model.claim)) bad("claim is missing: one sentence on why this matters");
  else {
    if (model.claim.length > LIMITS.claim) bad(`claim is ${model.claim.length} characters, over ${LIMITS.claim}`);
    if (/[.!?]\s+\S/.test(model.claim.trim())) bad("claim is more than one sentence");
  }
  if (model.implication !== undefined) {
    if (!text(model.implication)) bad("implication is empty: drop it or say it");
    else if (model.implication.length > LIMITS.claim) bad(`implication is ${model.implication.length} characters, over ${LIMITS.claim}`);
  }

  const ids = (items, what) => {
    const seen = new Set();
    for (const item of items) {
      const id = item?.id;
      if (!text(id) || !ID.test(id)) bad(`${what} id ${JSON.stringify(id)} is not kebab-case`);
      else if (seen.has(id)) bad(`${what} id '${id}' is used twice`);
      else seen.add(id);
    }
    return seen;
  };
  const sourced = (item, what) => {
    if (item.source === undefined) {
      if (requireSource) bad(`${what} '${item.id}' has no source: a figure drawn from code names the file and line`);
      return;
    }
    const problem = text(item.source) ? sourceProblem(item.source, repo) : "source is empty";
    if (problem) bad(`${what} '${item.id}': ${problem}`);
  };

  const entities = list(model.entities);
  const [minE, maxE] = LIMITS.entities;
  if (entities.length < minE || entities.length > maxE) bad(`${entities.length} entities: a figure holds ${minE} to ${maxE}`);
  const entityIds = ids(entities, "entity");
  let hued = 0;
  for (const e of entities) {
    if (!text(e?.label)) bad(`entity '${e?.id}' has no label`);
    else if (e.label.length > LIMITS.label) warnings.push(`entity '${e.id}': label is ${e.label.length} characters, over ${LIMITS.label}, and may not fit`);
    if (!text(e?.kind)) bad(`entity '${e?.id}' has no kind`);
    if (e?.hue !== undefined) {
      hued += 1;
      if (!HUES.includes(e.hue)) bad(`entity '${e.id}': hue '${e.hue}' is not one of ${HUES.join(", ")}`);
    }
    if (e) sourced(e, "entity");
  }
  if (hued > LIMITS.hues) bad(`${hued} entities carry a hue: at most ${LIMITS.hues}, the rest stay neutral`);

  const flows = list(model.flows);
  const flowIds = ids(flows, "flow");
  for (const f of flows) {
    if (!FLOW_KINDS.includes(f?.kind)) bad(`flow '${f?.id}': kind ${JSON.stringify(f?.kind)} is not one of ${FLOW_KINDS.join(", ")}`);
    for (const end of ["from", "to"]) if (!entityIds.has(f?.[end])) bad(`flow '${f?.id}': ${end} '${f?.[end]}' is not an entity`);
    if (f?.from !== undefined && f.from === f.to) bad(`flow '${f.id}' goes from '${f.from}' to itself`);
    if (f) sourced(f, "flow");
  }

  const beats = list(model.beats);
  const beatIds = ids(beats, "beat");
  const told = beats.filter((b) => !b?.rest);
  const [minB, maxB] = LIMITS.beats;
  if (told.length < minB || told.length > maxB) bad(`${told.length} beats: a figure tells ${minB} to ${maxB}, plus the rest beat`);
  const rests = beats.filter((b) => b?.rest);
  if (rests.length !== 1 || beats.at(-1)?.rest !== true) bad("the last beat, and only the last, is the rest beat (\"rest\": true)");
  const technical = told.filter((b) => text(b?.technical)).length;
  if (technical !== 0 && technical !== told.length) bad(`${technical} of ${told.length} beats have a technical caption: every beat, or none`);
  const usedEntities = new Set(), usedFlows = new Set();
  let total = 0;
  for (const b of beats) {
    const [lo, hi] = b?.rest ? LIMITS.restMs : LIMITS.beatMs;
    if (!Number.isInteger(b?.ms) || b.ms < lo || b.ms > hi) bad(`beat '${b?.id}': ms ${JSON.stringify(b?.ms)} is outside ${lo} to ${hi}`);
    else total += b.ms;
    for (const id of list(b?.focus)) { if (entityIds.has(id)) usedEntities.add(id); else bad(`beat '${b?.id}': focus '${id}' is not an entity`); }
    for (const id of list(b?.flows)) { if (flowIds.has(id)) usedFlows.add(id); else bad(`beat '${b?.id}': flow '${id}' is not a flow`); }
    if (b?.rest) {
      if (list(b.flows).length) bad(`the rest beat '${b.id}' moves nothing: it lists no flows`);
      continue;
    }
    if (!text(b?.title)) bad(`beat '${b?.id}' has no title`);
    if (!text(b?.plain)) bad(`beat '${b?.id}' has no plain caption`);
    else if (b.plain.length > LIMITS.plain) bad(`beat '${b.id}': plain caption is ${b.plain.length} characters, over ${LIMITS.plain}`);
    if (text(b?.technical) && b.technical.length > LIMITS.technical) bad(`beat '${b.id}': technical caption is ${b.technical.length} characters, over ${LIMITS.technical}`);
    if (!list(b?.focus).length) bad(`beat '${b?.id}' focuses on nothing`);
  }
  if (total > LIMITS.loopMs) bad(`the loop runs ${total} ms, over ${LIMITS.loopMs}`);
  for (const f of flows) {
    if (flowIds.has(f?.id) && !usedFlows.has(f.id)) bad(`flow '${f.id}' is in no beat`);
    if (usedFlows.has(f?.id)) { usedEntities.add(f.from); usedEntities.add(f.to); }
  }
  for (const id of entityIds) if (!usedEntities.has(id)) bad(`entity '${id}' is in no beat: nothing focuses on it and no told flow touches it`);

  const hero = model.hero;
  if (!hero || typeof hero !== "object") bad("hero is missing: { \"beat\": <id>, \"at\": 0.5 }");
  else {
    const beat = beats.find((b) => b?.id === hero.beat);
    if (!beatIds.has(hero.beat) || !beat) bad(`hero beat '${hero.beat}' is not a beat`);
    else if (beat.rest) bad("the hero frame cannot be the rest beat");
    if (hero.at !== undefined && !(typeof hero.at === "number" && hero.at >= 0 && hero.at <= 1)) bad(`hero at ${JSON.stringify(hero.at)} is not between 0 and 1`);
  }
  return { errors, warnings };
}
