// What a figure's model.json must be before anything is drawn from it. Pure:
// the model in, a list of findings out. The limits are the house style's, so a
// figure that passes here is small enough to read.
import fs from "node:fs";
import path from "node:path";

export const FLOW_KINDS = ["write", "read", "event", "query"];
/** What kind of explanation a figure is: what hides the mechanism picks the picture. */
export const LENSES = ["structure", "path", "time", "field", "transformation", "difference", "cases", "scale"];
/** The entity hues the kit's tokens define, beside the one accent. */
export const HUES = ["blue", "green", "violet", "yellow", "pink"];
export const LIMITS = {
  entities: [2, 9], beats: [2, 7], hues: 4,
  claim: 140, mechanism: 160, plain: 140, technical: 200, label: 28, note: 36, groups: 3,
  beatMs: [1200, 8000], restMs: [400, 4000], loopMs: 30000,
  repeat: [2, 24], quantities: 4, course: 8, tables: 8, cells: 600,
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
export function checkModel(model, { repo = null, requireSource = false, requireMethod = false } = {}) {
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
  // The method's two lines: what happens, in one sentence, and the lens that leads.
  if (model.mechanism === undefined) {
    if (requireMethod) bad("mechanism is missing: one sentence with a verb, saying what happens");
  } else if (!text(model.mechanism)) bad("mechanism is empty");
  else {
    if (model.mechanism.length > LIMITS.mechanism) bad(`mechanism is ${model.mechanism.length} characters, over ${LIMITS.mechanism}`);
    if (/[.!?]\s+\S/.test(model.mechanism.trim())) bad("mechanism is more than one sentence");
  }
  if (model.lens === undefined) {
    if (requireMethod) bad(`lens is missing: one of ${LENSES.join(", ")}`);
  } else if (!LENSES.includes(model.lens)) bad(`lens ${JSON.stringify(model.lens)} is not one of ${LENSES.join(", ")}`);
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
    if (e?.note !== undefined && (!text(e.note) || e.note.length > LIMITS.note)) bad(`entity '${e.id}': note is ${text(e.note) ? `${e.note.length} characters, over ${LIMITS.note}` : "empty"}`);
    if (e?.group !== undefined && !text(e.group)) bad(`entity '${e.id}': group is empty`);
    if (e?.hue !== undefined) {
      hued += 1;
      if (!HUES.includes(e.hue)) bad(`entity '${e.id}': hue '${e.hue}' is not one of ${HUES.join(", ")}`);
    }
    if (e?.repeat !== undefined && !(Number.isInteger(e.repeat) && e.repeat >= LIMITS.repeat[0] && e.repeat <= LIMITS.repeat[1])) {
      bad(`entity '${e.id}': repeat ${JSON.stringify(e.repeat)} is not a whole number from ${LIMITS.repeat[0]} to ${LIMITS.repeat[1]}: draw a few, standing for the many`);
    }
    if (e?.parent !== undefined) {
      if (!entityIds.has(e.parent)) bad(`entity '${e.id}': parent '${e.parent}' is not an entity`);
      else if (e.parent === e.id) bad(`entity '${e.id}' is its own parent`);
    }
    if (e) sourced(e, "entity");
  }
  // Nothing is inside itself, however long the way round.
  const parentOf = new Map(entities.filter((e) => entityIds.has(e?.parent) && e.parent !== e.id).map((e) => [e.id, e.parent]));
  for (const id of parentOf.keys()) {
    const seen = new Set([id]);
    let at = parentOf.get(id);
    while (at && !seen.has(at)) { seen.add(at); at = parentOf.get(at); }
    if (at === id) bad(`entity '${id}' is inside itself: its parents come back round to it`);
  }
  const grouped = new Set(entities.map((e) => e?.group).filter(Boolean));
  if (grouped.size > LIMITS.groups) bad(`${grouped.size} groups: a figure sets at most ${LIMITS.groups} arrangements side by side`);
  if (grouped.size && entities.some((e) => !e?.group)) bad("some entities have a group and some have none: every one, or none");
  if (hued === 1) warnings.push("one entity carries a hue: a hue tells things apart, and one alone leaves a reader wondering what it means");
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

  // A thing that comes into being during the story is not told before it does.
  const order = new Map(beats.map((b, i) => [b?.id, i]));
  for (const e of entities) {
    if (e?.born === undefined) continue;
    const birth = beats.find((b) => b?.id === e.born);
    if (!birth || birth.rest) { bad(`entity '${e.id}': born '${e.born}' is not a beat that is told`); continue; }
    for (const b of beats.slice(0, order.get(e.born))) {
      const touches = list(b?.focus).includes(e.id) || list(b?.flows).some((id) => flows.some((f) => f?.id === id && (f.from === e.id || f.to === e.id)));
      if (touches) bad(`beat '${b.id}' tells '${e.id}' before it is born in '${e.born}'`);
    }
  }

  // Numbers that change as the story is told.
  const number = (v) => typeof v === "number" && Number.isFinite(v);
  if (model.quantities !== undefined) {
    const quantities = list(model.quantities);
    if (!Array.isArray(model.quantities)) bad("quantities is not a list");
    if (quantities.length > LIMITS.quantities) bad(`${quantities.length} quantities: a figure follows at most ${LIMITS.quantities}`);
    ids(quantities, "quantity");
    for (const q of quantities) {
      const name = `quantity '${q?.id}'`;
      if (!text(q?.label)) bad(`${name} has no label`);
      if (q?.of !== undefined && !entityIds.has(q.of)) bad(`${name}: of '${q.of}' is not an entity`);
      if (q?.unit !== undefined && !text(q.unit)) bad(`${name}: unit is empty`);
      if (q?.max !== undefined && !(number(q.max) && q.max > 0)) bad(`${name}: max ${JSON.stringify(q.max)} is not a number above 0`);
      if (q?.start !== undefined && !(number(q.start) && q.start >= 0)) bad(`${name}: start ${JSON.stringify(q.start)} is not a number from 0 up`);
      const values = q?.values && typeof q.values === "object" && !Array.isArray(q.values) ? Object.entries(q.values) : null;
      if (!values || !values.length) { bad(`${name} has no values: say where it stands at the end of a beat, { "<beat>": <number> }`); continue; }
      for (const [beatId, value] of values) {
        if (!beatIds.has(beatId)) { bad(`${name}: '${beatId}' is not a beat`); continue; }
        const course = Array.isArray(value) ? value : [value];
        if (!course.length || course.length > LIMITS.course) bad(`${name}: beat '${beatId}' has ${course.length} values: one, or a course of 2 to ${LIMITS.course}`);
        for (const v of [...course, ...(q.start !== undefined ? [q.start] : [])]) {
          if (!number(v) || v < 0) bad(`${name}: ${JSON.stringify(v)} in beat '${beatId}' is not a number from 0 up`);
          else if (number(q.max) && v > q.max) bad(`${name}: ${v} in beat '${beatId}' is over its max, ${q.max}`);
        }
      }
    }
  }

  // What a view reads beyond things and flows: series, grids of cell values, rows.
  if (model.data !== undefined) {
    const tables = model.data && typeof model.data === "object" && !Array.isArray(model.data) ? Object.entries(model.data) : null;
    if (!tables) bad("data is not an object of named tables");
    else {
      if (tables.length > LIMITS.tables) bad(`${tables.length} tables of data: a figure reads at most ${LIMITS.tables}`);
      let total = 0;
      for (const [name, value] of tables) {
        const where = `data '${name}'`;
        if (!ID.test(name)) bad(`${where}: the name is not kebab-case`);
        if (!Array.isArray(value) || !value.length) { bad(`${where} is not a list with something in it: numbers, rows of numbers, or rows of named values`); continue; }
        if (value.every(number)) total += value.length;
        else if (value.every((row) => Array.isArray(row) && row.length && row.every(number))) {
          if (value.some((row) => row.length !== value[0].length)) bad(`${where}: its rows are not all ${value[0].length} cells wide`);
          total += value.length * value[0].length;
        } else if (value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
          total += value.length;
          const seen = new Set();
          value.forEach((row, i) => {
            for (const [key, v] of Object.entries(row)) {
              if (!["string", "number", "boolean"].includes(typeof v)) bad(`${where}: row ${i + 1}, '${key}' is not a word, a number, or true or false`);
            }
            if (row.id !== undefined) { if (seen.has(row.id)) bad(`${where}: row id '${row.id}' is used twice`); seen.add(row.id); }
            if (row.of !== undefined && !entityIds.has(row.of)) bad(`${where}: row ${i + 1}, of '${row.of}' is not an entity`);
            if (row.at !== undefined && !beatIds.has(row.at)) bad(`${where}: row ${i + 1}, at '${row.at}' is not a beat`);
          });
        } else bad(`${where} mixes kinds: all numbers, all rows of numbers, or all rows of named values`);
      }
      if (total > LIMITS.cells) bad(`${total} values of data: a figure draws a few standing for the many, at most ${LIMITS.cells}`);
    }
  }

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
