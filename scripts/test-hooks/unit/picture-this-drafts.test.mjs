// picture-this's rounds: three drafts of one model, each a different view,
// laid out in the repo's scratch folder so a chosen one lands by a copy. A
// draft starts on the blank stage unless its view names a study; it says what
// it draws before it is drawn. A round is fair while every draft still draws
// the round's model and the kit is as it was given, and `draft check` is what
// says so.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BLANK, STATEMENT, studies, run as draft } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/commands/draft.mjs";
import { kit } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/commands/kit.mjs";
import { run as land } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/commands/land.mjs";
import { PtError } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/lib/args.mjs";
import { checkModel } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/lib/model-check.mjs";
import { drawsIn3d, hasThree, kitFiles } from "../../../plugins/agentic-engineering/skills/picture-this/scripts/lib/owned.mjs";
import { REPO, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-engineering", "skills", "picture-this");
const STUDIES = path.join(PLUGIN, "studies");
const BLANK_STAGE = path.join(PLUGIN, "blank", "figure.tsx");
const MODEL = fs.readFileSync(path.join(STUDIES, "iso-flow", "model.json"), "utf8");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const NAMES = ["before-after", "card-flow", "case-loop", "cell-field", "iso-flow", "iso-flow-3d", "layer-stack", "layer-stack-3d", "series", "split", "staged-build", "time-grid", "two-rulers"];
const IN_3D = ["iso-flow-3d", "layer-stack-3d"];
/** The studies that draw the worked example every path study shares; the others bring a subject of their own. */
const OWN_SUBJECT = ["before-after", "cell-field", "time-grid", "two-rulers"];

function world(t) {
  const { dir, git } = tempRepo(t, "pt-drafts-");
  const repo = fs.realpathSync(dir);
  const model = write(repo, "model.json", MODEL);
  return { repo, git, model, drafts: path.join(repo, ".agents", "picture-this", "drafts") };
}
async function quiet(fn) {
  const real = process.stdout.write;
  let out = "";
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { return { status: await fn(), out }; } finally { process.stdout.write = real; }
}
/** What a drafter does before `draft check`: say what each view draws, and draw it. */
function drawn(round, ids = ["a", "b", "c"]) {
  for (const id of ids) {
    const dir = path.join(round, id);
    if (!fs.existsSync(dir)) continue;
    const view = JSON.parse(read(dir, "view.json"));
    fs.writeFileSync(path.join(dir, "view.json"), JSON.stringify({ ...view, drawn: "Each thing as a box in a line on the ground.", moves: "A pulse along the wire the beat tells.", means: "Left to right is the order the job travels." }));
    fs.appendFileSync(path.join(dir, "figure.tsx"), "\n// drawn for this model\n");
  }
}

test("the studies are worked figures, two of them in 3D, each saying when its view is the right one, with a model that passes", () => {
  const all = studies();
  assert.deepEqual(all.map((a) => a.name), NAMES);
  assert.ok(!NAMES.includes(BLANK), "the blank stage is where a draft starts, not a study");
  assert.deepEqual(NAMES.filter((name) => drawsIn3d(path.join(STUDIES, name, "figure.tsx"))), IN_3D);
  for (const name of IN_3D) {
    const source = read(STUDIES, name, "figure.tsx");
    assert.match(all.find((a) => a.name === name).about, /It needs three\.js where it is shown/, `${name}: says what it costs`);
    assert.doesNotMatch(source, /from "(three|@react-three\/[a-z]+)"/, `${name}: a figure draws with the kit, which is what imports three.js`);
    assert.match(source, /fallback=|IsoScene3D/, `${name}: something stands in until the canvas has drawn`);
    assert.equal(read(STUDIES, name, "model.json"), read(STUDIES, name.replace(/-3d$/, ""), "model.json"), `${name}: draws the same example as its 2D twin`);
  }
  const figure = (dir, name) => {
    const source = read(dir, "figure.tsx");
    assert.match(source, /export default function Figure\(props: StageProps\)/, `${name}: a figure is a default export taking the stage's props`);
    assert.match(source, /import data from "\.\/model\.json";/, `${name}: it draws the model beside it`);
    assert.match(source, /<Stage model=\{model\}[^>]*\{\.\.\.props\}>/, `${name}: the props reach the stage, or the camera cannot hold a frame`);
    for (const m of source.matchAll(/from "(\.\.\/kit\/[^"]+)"/g)) {
      const base = path.join(PLUGIN, m[1].replace(/^\.\.\//, ""));
      assert.ok([".ts", ".tsx"].some((ext) => fs.existsSync(base + ext)), `${name}: ${m[1]} is in the kit`);
    }
    assert.deepEqual(checkModel(JSON.parse(read(dir, "model.json"))).errors, [], `${name}: its example model`);
    return source;
  };
  for (const a of all) {
    assert.match(a.about, /Reach for it only when /, `${a.name}: its first comment says when its view is the right one`);
    assert.ok(a.about.length < 420, `${a.name}: the comment is the header, not the whole file's`);
    assert.match(figure(path.join(STUDIES, a.name), a.name), /^"use client";\n\/\/ Study: /, a.name);
  }
  // A study for a lens the path studies cannot show brings a subject of its own, and says which lens.
  for (const name of OWN_SUBJECT) {
    const model = JSON.parse(read(STUDIES, name, "model.json"));
    assert.notEqual(model.title, JSON.parse(MODEL).title, `${name}: its own subject`);
    assert.notEqual(model.lens, "path", `${name}: a lens the path studies do not cover`);
  }
  const blank = figure(path.join(PLUGIN, "blank"), "blank");
  assert.match(blank, /^"use client";\n\/\/ The blank stage\. /);
  assert.match(blank, /nothing drawn yet/, "the blank stage draws no picture of its own to be taken for one");
  assert.doesNotMatch(blank, /from "\.\.\/kit\/(iso|flat|flow|three)\//, "and reaches for no shape until the view asks for one");
});

test("draft new lays a round out: the model in every draft, the blank stage unless a view names a study, and the kit they share", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => draft(["new", "--model", "model.json", "--views", "handoff,stages,layers=layer-stack"], { cwd: w.repo }));
  assert.equal(status, 0);
  const round = path.join(w.drafts, "round-1");
  assert.deepEqual(fs.readdirSync(round).sort(), ["a", "b", "c", "kit", "round.json"]);
  for (const [id, view, base] of [["a", "handoff", BLANK], ["b", "stages", BLANK], ["c", "layers", "layer-stack"]]) {
    assert.equal(read(round, id, "figure.tsx"), base === BLANK ? read(BLANK_STAGE) : read(STUDIES, base, "figure.tsx"), `${id} starts from ${base}`);
    assert.deepEqual(JSON.parse(read(round, id, "model.json")), JSON.parse(MODEL));
    assert.deepEqual(JSON.parse(read(round, id, "view.json")), { view, base, drawn: "", moves: "", means: "" }, `${id}: its view is there to be stated`);
  }
  for (const rel of kitFiles(path.join(PLUGIN, "kit"), { three: false })) assert.ok(fs.existsSync(path.join(round, "kit", rel)), `kit/${rel}`);
  assert.equal(hasThree(path.join(round, "kit")), false, "a round with no 3D draft is not given the 3D tier");
  const record = JSON.parse(read(round, "round.json"));
  assert.deepEqual(record.drafts.map(({ id, view, base }) => ({ id, view, base })), [{ id: "a", view: "handoff", base: BLANK }, { id: "b", view: "stages", base: BLANK }, { id: "c", view: "layers", base: "layer-stack" }]);
  assert.equal(record.kit, "the plugin's");
  assert.equal(out, [
    `round-1: 3 views of "How an upload becomes a thumbnail" in .agents/picture-this/drafts/round-1/`,
    "  round-1/a  handoff        from the blank stage        .agents/picture-this/drafts/round-1/a/figure.tsx",
    "  round-1/b  stages         from the blank stage        .agents/picture-this/drafts/round-1/b/figure.tsx",
    "  round-1/c  layers         from the layer-stack study  .agents/picture-this/drafts/round-1/c/figure.tsx",
    "lens: path. The API hands each upload to a queue, and a worker takes the jobs off it one at a time.",
    "state each view in its view.json before drawing it (drawn, moves, means), draw it, then `sheet round-1/<id>`",
    "",
  ].join("\n"));
  assert.equal(w.git("status", "--porcelain", "--", ".agents"), "", "a round is scratch: git is never offered it");

  assert.equal((await quiet(() => draft(["new", "--model", "model.json", "--views", "sides,panels"], { cwd: w.repo }))).status, 0);
  assert.ok(fs.existsSync(path.join(w.drafts, "round-2", "b", "figure.tsx")), "the next round gets the next number");
  assert.equal((await quiet(() => draft(["new", "--model", "model.json", "--views", "sides,panels", "--round", "wider"], { cwd: w.repo }))).status, 0);
  assert.ok(fs.existsSync(path.join(w.drafts, "wider", "round.json")));
});

test("a round where every draft starts from a study is made, and asked whether those views are the subject's own", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => draft(["new", "--model", "model.json", "--views", "path=iso-flow,cards=card-flow"], { cwd: w.repo }));
  assert.equal(status, 0);
  assert.match(out, /\nevery draft starts from a study: a round is rarely all studies\. Is each one's view this subject's own, or the nearest template\?\n$/);
  const mixed = await quiet(() => draft(["new", "--model", "model.json", "--views", "path=iso-flow,ledger"], { cwd: w.repo }));
  assert.doesNotMatch(mixed.out, /every draft starts from a study/);
});

test("a round with a 3D draft gets the kit's 3D tier, borrowed from the plugin when the repo's kit has none", async (t) => {
  const w = world(t);
  const first = await quiet(() => draft(["new", "--model", "model.json", "--views", "path,lit-path=iso-flow-3d"], { cwd: w.repo }));
  assert.equal(first.status, 0);
  assert.match(first.out, /\na 3D draft is in the round: the studio draws it, and nothing is added to the repo unless it is the one landed\n$/);
  for (const rel of kitFiles(path.join(PLUGIN, "kit"))) assert.ok(fs.existsSync(path.join(w.drafts, "round-1", "kit", rel)), `kit/${rel}`);
  assert.equal(JSON.parse(read(w.drafts, "round-1", "round.json")).three, undefined, "the plugin's kit came whole");
  drawn(path.join(w.drafts, "round-1"));
  assert.equal((await quiet(() => draft(["check", "round-1"], { cwd: w.repo }))).status, 0);
  assert.equal(fs.existsSync(path.join(w.repo, ".agents", "picture-this", "figures")), false, "drafting in 3D puts nothing in the repo's figures");

  // The repo has its own kit, without the 3D tier: the round borrows the plugin's, and is held to it.
  await quiet(() => kit(["install"], { cwd: w.repo }));
  await quiet(() => draft(["new", "--model", "model.json", "--views", "glass=layer-stack-3d,panels"], { cwd: w.repo }));
  const round = path.join(w.drafts, "round-2");
  assert.deepEqual([JSON.parse(read(round, "round.json")).kit, JSON.parse(read(round, "round.json")).three], [".agents/picture-this/figures/kit", "the plugin's"]);
  assert.equal(hasThree(path.join(round, "kit")), true);
  assert.equal(hasThree(path.join(w.repo, ".agents", "picture-this", "figures", "kit")), false, "and the repo's own kit is left as it was");
  drawn(round);
  assert.equal((await quiet(() => draft(["check", "round-2"], { cwd: w.repo }))).status, 0);
  fs.appendFileSync(path.join(round, "kit", "three", "rig.tsx"), "\n// brighter\n");
  const unfair = await quiet(() => draft(["check", "round-2"], { cwd: w.repo }));
  assert.equal(unfair.status, 1);
  assert.match(unfair.out, /error: round-2\/kit\/three\/rig\.tsx was edited: drafts draw with the kit as it is/);

  // Landing the 3D draft is what puts the 3D tier in the repo.
  assert.equal((await quiet(() => land(["round-2/a", "--as", "stack"], { cwd: w.repo }))).status, 0);
  assert.equal(hasThree(path.join(w.repo, ".agents", "picture-this", "figures", "kit")), true);
});

test("a round draws with the repo's own kit once it has one, edits and all", async (t) => {
  const w = world(t);
  await quiet(() => kit(["install"], { cwd: w.repo }));
  const own = path.join(w.repo, ".agents", "picture-this", "figures", "kit", "kit.css");
  fs.appendFileSync(own, "\n/* this repo's accent */\n");
  await quiet(() => draft(["new", "--model", "model.json", "--views", "path,panels"], { cwd: w.repo }));
  assert.match(read(w.drafts, "round-1", "kit", "kit.css"), /this repo's accent/);
  assert.equal(JSON.parse(read(w.drafts, "round-1", "round.json")).kit, ".agents/picture-this/figures/kit");
  drawn(path.join(w.drafts, "round-1"));
  assert.equal((await quiet(() => draft(["check", "round-1"], { cwd: w.repo }))).status, 0, "the repo's edit is the kit the round was given, not a draft's doing");
});

test("draft new refuses a round it could not compare fairly, before it writes anything", async (t) => {
  const w = world(t);
  const refused = async (args, pattern) => assert.rejects(() => quiet(() => draft(args, { cwd: w.repo })), (e) => e instanceof PtError && e.code === 2 && pattern.test(e.message), args.join(" "));
  await refused(["new"], /usage: node pt\.mjs draft new/);
  await refused(["new", "--model", "model.json", "--views", "path,plan=blueprint"], /no study 'blueprint': there is before-after, card-flow, case-loop, cell-field, iso-flow.*A view with no study starts on the blank stage: leave the =<study> off/);
  await refused(["new", "--model", "model.json", "--views", "path,iso-flow"], /'iso-flow' is a study's name, not a view of this subject: name the view for what it draws, and write <view>=iso-flow/);
  await refused(["new", "--model", "model.json", "--views", "path,Time Grid"], /is not a view name/);
  await refused(["new", "--model", "model.json", "--views", "path,ledger="], /is not a view: <view>, or <view>=<study>/);
  await refused(["new", "--model", "model.json", "--views", "exploded,exploded"], /the same view twice/);
  await refused(["new", "--model", "model.json", "--views", "one=iso-flow,two=iso-flow,panels"], /the same study twice: two drafts from one study compare shades of one picture/);
  await refused(["new", "--model", "model.json", "--views", "path"], /1 view: a round has 2 to 4 drafts/);
  await refused(["new", "--model", "model.json", "--views", "a,b,c,d,e"], /5 views: a round has 2 to 4/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,series"], /--archetypes is now --views/);
  await refused(["new", "--model", "absent.json", "--views", "path,panels"], /cannot read/);
  await refused(["new", "--model", "model.json", "--views", "path,panels", "--round", "Round One"], /is not a round name/);
  await refused(["paint"], /usage:/);
  await refused(["archetypes"], /usage:/);
  assert.equal(fs.existsSync(w.drafts), false);

  const bad = JSON.parse(MODEL);
  bad.beats[0].focus = ["ghost"];
  write(w.repo, "bad.json", JSON.stringify(bad));
  const { status, out } = await quiet(() => draft(["new", "--model", "bad.json", "--views", "path,panels"], { cwd: w.repo }));
  assert.equal(status, 1);
  assert.match(out, /error: beat 'answer': focus 'ghost' is not an entity\nthe model does not pass, so no round was made: every draft would draw the same mistake/);
  const strict = await quiet(() => draft(["new", "--model", "model.json", "--views", "path,panels", "--require-source"], { cwd: w.repo }));
  assert.equal(strict.status, 1, "a figure drawn from code needs its sources before it is drawn three times");
  assert.equal(fs.existsSync(w.drafts), false);

  await quiet(() => draft(["new", "--model", "model.json", "--views", "path,panels", "--round", "first"], { cwd: w.repo }));
  await refused(["new", "--model", "model.json", "--views", "path,panels", "--round", "first"], /round 'first' is already there/);
});

test("draft studies lists the worked figures, and says what they are for", async () => {
  const { status, out } = await quiet(() => draft(["studies"]));
  assert.equal(status, 0);
  assert.match(out, /^Worked figures, each drawing one view\. Read one to learn a technique; start a draft from one \(<view>=<study>\) only when its view is the subject's view\.\n/);
  for (const name of NAMES) assert.match(out, new RegExp(`^${name}\n  `, "m"));
  assert.doesNotMatch(out, /^blank$/m);
});

test("a round is not started for a subject nobody has put into one sentence", async (t) => {
  const w = world(t);
  const bare = JSON.parse(MODEL);
  delete bare.mechanism;
  delete bare.lens;
  write(w.repo, "bare.json", JSON.stringify(bare));
  const { status, out } = await quiet(() => draft(["new", "--model", "bare.json", "--views", "path,panels"], { cwd: w.repo }));
  assert.equal(status, 1);
  assert.match(out, /error: mechanism is missing: one sentence with a verb, saying what happens/);
  assert.match(out, /error: lens is missing: one of structure, path, time, field, transformation, difference, cases, scale/);
  assert.equal(fs.existsSync(w.drafts), false);
});

test("draft check wants every view stated and drawn, and then shows each in its own words", async (t) => {
  const w = world(t);
  await quiet(() => draft(["new", "--model", "model.json", "--views", "handoff,layers=layer-stack"], { cwd: w.repo }));
  const round = path.join(w.drafts, "round-1");
  const fresh = await quiet(() => draft(["check", "round-1"], { cwd: w.repo }));
  assert.equal(fresh.status, 1, "a round nobody has drawn is not ready to be shown");
  assert.match(fresh.out, /error: round-1\/a: its view is not stated\. Before drawing, say in view\.json what is drawn: the shapes on the page and what each one is \(drawn\); what moves, and what that motion says about the subject \(moves\); what each visual property means: position, size, tone, the accent \(means\)/);
  assert.match(fresh.out, /error: round-1\/a: its figure\.tsx is still the blank stage: nothing is drawn yet/);
  assert.match(fresh.out, /error: round-1\/b: its figure\.tsx is still the layer-stack study as shipped: a study is where a draft starts, and this model's picture is not drawn yet/);

  // A statement too short to say anything is not one.
  fs.writeFileSync(path.join(round, "a", "view.json"), JSON.stringify({ view: "handoff", base: BLANK, drawn: "boxes", moves: "A pulse along the wire the beat tells.", means: "Left to right is the order the job travels." }));
  assert.match((await quiet(() => draft(["check", "round-1"], { cwd: w.repo }))).out, /round-1\/a: its view is not stated\. Before drawing, say in view\.json what is drawn: [^;]*\(drawn\)\n/);

  drawn(round);
  const fair = await quiet(() => draft(["check", "round-1"], { cwd: w.repo }));
  assert.equal(fair.status, 0);
  assert.equal(fair.out, [
    "ok: round-1 is fair: a handoff, b layers",
    "  a  handoff, from the blank stage",
    "     drawn: Each thing as a box in a line on the ground.",
    "     moves: A pulse along the wire the beat tells.",
    "     means: Left to right is the order the job travels.",
    "  b  layers, from the layer-stack study",
    "     drawn: Each thing as a box in a line on the ground.",
    "     moves: A pulse along the wire the beat tells.",
    "     means: Left to right is the order the job travels.",
    "",
  ].join("\n"));
  const asJson = JSON.parse((await quiet(() => draft(["check", "round-1", "--json"], { cwd: w.repo }))).out);
  for (const key of STATEMENT) assert.equal(typeof asJson.drafts[0][key], "string", `--json carries ${key}`);

  // A draft that quietly became another view is a different round.
  fs.writeFileSync(path.join(round, "a", "view.json"), JSON.stringify({ ...JSON.parse(read(round, "a", "view.json")), view: "towers" }));
  assert.match((await quiet(() => draft(["check", "round-1"], { cwd: w.repo }))).out, /round-1\/a: its view\.json names towers from blank, and the round made it handoff from blank: a different view is a new round/);
});

test("draft check passes a round whose drafts were redrawn, and names what makes one unfair", async (t) => {
  const w = world(t);
  await quiet(() => draft(["new", "--model", "model.json", "--views", "path=iso-flow,layers=layer-stack,cards=card-flow"], { cwd: w.repo }));
  const round = path.join(w.drafts, "round-1");
  drawn(round);
  const fair = await quiet(() => draft(["check", "round-1"], { cwd: w.repo }));
  assert.equal(fair.status, 0, "the figure is the draft's to change");
  assert.match(fair.out, /^ok: round-1 is fair: a path, b layers, c cards\n/);
  assert.equal((await quiet(() => draft(["check", round], { cwd: w.repo }))).status, 0, "a round is found by its folder too");

  const changed = JSON.parse(MODEL);
  changed.entities.pop();
  fs.writeFileSync(path.join(round, "b", "model.json"), JSON.stringify(changed));
  fs.appendFileSync(path.join(round, "kit", "kit.css"), "\n.pt-stage { --pt-accent: hotpink; }\n");
  fs.rmSync(path.join(round, "c", "figure.tsx"));
  const { status, out } = await quiet(() => draft(["check", "round-1"], { cwd: w.repo }));
  assert.equal(status, 1);
  assert.match(out, /error: round-1\/b: its model\.json was changed: every draft draws the round's model, so the comparison is about form\. To change the model, start a new round/);
  assert.match(out, /error: round-1\/c: no figure\.tsx/);
  assert.match(out, /error: round-1\/kit\/kit\.css was edited: drafts draw with the kit as it is/);

  await assert.rejects(() => quiet(() => draft(["check", "round-9"], { cwd: w.repo })), /no round 'round-9': `draft new` makes one/);
  await assert.rejects(() => quiet(() => draft(["check"], { cwd: w.repo })), /usage:/);
});

test("a draft from a round lands as a figure whose imports resolve where it lands", async (t) => {
  const w = world(t);
  await quiet(() => draft(["new", "--model", "model.json", "--views", "path=iso-flow,layers=layer-stack"], { cwd: w.repo }));
  assert.equal((await quiet(() => land(["round-1/b", "--as", "upload-path"], { cwd: w.repo }))).status, 0);
  const figures = path.join(w.repo, ".agents", "picture-this", "figures");
  const source = read(figures, "upload-path", "figure.tsx");
  for (const m of source.matchAll(/from "(\.\.\/kit\/[^"]+)"/g)) {
    const base = path.join(figures, "upload-path", m[1]);
    assert.ok([".ts", ".tsx"].some((ext) => fs.existsSync(base + ext)), `${m[1]} resolves from the landed figure`);
  }
  assert.equal(fs.existsSync(path.join(figures, "upload-path", "view.json")), false, "a view's statement is the round's, not the figure's");
});
