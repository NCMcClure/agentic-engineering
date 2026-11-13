// picture-this's rounds: three drafts of one model on three archetypes, laid
// out in the repo's scratch folder so a chosen one lands by a copy. A round is
// fair while every draft still draws the round's model and the kit is as it
// was given, and `draft check` is what says so.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { archetypes, run as draft } from "../../../plugins/picture-this/scripts/commands/draft.mjs";
import { kit } from "../../../plugins/picture-this/scripts/commands/kit.mjs";
import { run as land } from "../../../plugins/picture-this/scripts/commands/land.mjs";
import { PtError } from "../../../plugins/picture-this/scripts/lib/args.mjs";
import { checkModel } from "../../../plugins/picture-this/scripts/lib/model-check.mjs";
import { kitFiles } from "../../../plugins/picture-this/scripts/lib/owned.mjs";
import { REPO, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "picture-this");
const STARTERS = path.join(PLUGIN, "starters");
const MODEL = fs.readFileSync(path.join(STARTERS, "iso-flow", "model.json"), "utf8");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const NAMES = ["blank", "card-flow", "case-loop", "iso-flow", "layer-stack", "series", "split", "staged-build"];

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

test("there are eight starters, each one that says when to reach for it, with a model that passes", () => {
  const all = archetypes();
  assert.deepEqual(all.map((a) => a.name), NAMES);
  for (const a of all) {
    assert.match(a.about, /Reach for it when /, `${a.name}: its first comment says when it fits`);
    assert.ok(a.about.length < 420, `${a.name}: the comment is the header, not the whole file's`);
    const source = read(STARTERS, a.name, "figure.tsx");
    assert.match(source, /^"use client";\n\/\/ Archetype: /, a.name);
    assert.match(source, /export default function Figure\(props: StageProps\)/, `${a.name}: a figure is a default export taking the stage's props`);
    assert.match(source, /import data from "\.\/model\.json";/, `${a.name}: it draws the model beside it`);
    assert.match(source, /<Stage model=\{model\}[^>]*\{\.\.\.props\}>/, `${a.name}: the props reach the stage, or the camera cannot hold a frame`);
    for (const m of source.matchAll(/from "(\.\.\/kit\/[^"]+)"/g)) {
      const base = path.join(STARTERS, a.name, m[1]).replace(`${path.sep}starters${path.sep}`, path.sep);
      assert.ok([".ts", ".tsx"].some((ext) => fs.existsSync(base + ext)), `${a.name}: ${m[1]} is in the kit`);
    }
    assert.deepEqual(checkModel(JSON.parse(read(STARTERS, a.name, "model.json"))).errors, [], `${a.name}: its example model`);
  }
});

test("draft new lays a round out: the model in every draft, a starter each, and the kit they share", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "iso-flow,layer-stack,card-flow"], { cwd: w.repo }));
  assert.equal(status, 0);
  const round = path.join(w.drafts, "round-1");
  assert.deepEqual(fs.readdirSync(round).sort(), ["a", "b", "c", "kit", "round.json"]);
  for (const [id, archetype] of [["a", "iso-flow"], ["b", "layer-stack"], ["c", "card-flow"]]) {
    assert.equal(read(round, id, "figure.tsx"), read(STARTERS, archetype, "figure.tsx"), `${id} starts as the ${archetype} starter`);
    assert.deepEqual(JSON.parse(read(round, id, "model.json")), JSON.parse(MODEL));
  }
  for (const rel of kitFiles(path.join(PLUGIN, "kit"))) assert.ok(fs.existsSync(path.join(round, "kit", rel)), `kit/${rel}`);
  const record = JSON.parse(read(round, "round.json"));
  assert.deepEqual(record.drafts, [{ id: "a", archetype: "iso-flow" }, { id: "b", archetype: "layer-stack" }, { id: "c", archetype: "card-flow" }]);
  assert.equal(record.kit, "the plugin's");
  assert.equal(out, [
    `round-1: 3 drafts of "How an upload becomes a thumbnail" in .agents/picture-this/drafts/round-1/`,
    "  round-1/a  iso-flow      .agents/picture-this/drafts/round-1/a/figure.tsx",
    "  round-1/b  layer-stack   .agents/picture-this/drafts/round-1/b/figure.tsx",
    "  round-1/c  card-flow     .agents/picture-this/drafts/round-1/c/figure.tsx",
    "lens: path. The API hands each upload to a queue, and a worker takes the jobs off it one at a time.",
    "each starts as its archetype's starter, drawing this model: make it this model's picture, then `sheet round-1/<id>`",
    "",
  ].join("\n"));
  assert.equal(w.git("status", "--porcelain", "--", ".agents"), "", "a round is scratch: git is never offered it");

  assert.equal((await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "split,series"], { cwd: w.repo }))).status, 0);
  assert.ok(fs.existsSync(path.join(w.drafts, "round-2", "b", "figure.tsx")), "the next round gets the next number");
  assert.equal((await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "split,series", "--round", "wider"], { cwd: w.repo }))).status, 0);
  assert.ok(fs.existsSync(path.join(w.drafts, "wider", "round.json")));
});

test("a round draws with the repo's own kit once it has one, edits and all", async (t) => {
  const w = world(t);
  await quiet(() => kit(["install"], { cwd: w.repo }));
  const own = path.join(w.repo, ".agents", "picture-this", "figures", "kit", "kit.css");
  fs.appendFileSync(own, "\n/* this repo's accent */\n");
  await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "iso-flow,series"], { cwd: w.repo }));
  assert.match(read(w.drafts, "round-1", "kit", "kit.css"), /this repo's accent/);
  assert.equal(JSON.parse(read(w.drafts, "round-1", "round.json")).kit, ".agents/picture-this/figures/kit");
  assert.equal((await quiet(() => draft(["check", "round-1"], { cwd: w.repo }))).status, 0, "the repo's edit is the kit the round was given, not a draft's doing");
});

test("draft new refuses a round it could not compare fairly, before it writes anything", async (t) => {
  const w = world(t);
  const refused = async (args, pattern) => assert.rejects(() => quiet(() => draft(args, { cwd: w.repo })), (e) => e instanceof PtError && e.code === 2 && pattern.test(e.message), args.join(" "));
  await refused(["new"], /usage: node pt\.mjs draft new/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,blueprint"], /no archetype 'blueprint': there is blank, card-flow, case-loop, iso-flow/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,blank"], /blank needs the view it will draw: blank:<view>/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,blank:Time Grid"], /is not a view name/);
  await refused(["new", "--model", "model.json", "--archetypes", "blank:exploded,blank:exploded"], /the same archetype twice/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,iso-flow,series"], /the same archetype twice/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow"], /1 archetype: a round has 2 to 4 drafts/);
  await refused(["new", "--model", "model.json", "--archetypes", "card-flow,case-loop,iso-flow,layer-stack,series"], /5 archetypes: a round has 2 to 4/);
  await refused(["new", "--model", "absent.json", "--archetypes", "iso-flow,series"], /cannot read/);
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,series", "--round", "Round One"], /is not a round name/);
  await refused(["paint"], /usage:/);
  assert.equal(fs.existsSync(w.drafts), false);

  const bad = JSON.parse(MODEL);
  bad.beats[0].focus = ["ghost"];
  write(w.repo, "bad.json", JSON.stringify(bad));
  const { status, out } = await quiet(() => draft(["new", "--model", "bad.json", "--archetypes", "iso-flow,series"], { cwd: w.repo }));
  assert.equal(status, 1);
  assert.match(out, /error: beat 'answer': focus 'ghost' is not an entity\nthe model does not pass, so no round was made: every draft would draw the same mistake/);
  const strict = await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "iso-flow,series", "--require-source"], { cwd: w.repo }));
  assert.equal(strict.status, 1, "a figure drawn from code needs its sources before it is drawn three times");
  assert.equal(fs.existsSync(w.drafts), false);

  await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "iso-flow,series", "--round", "first"], { cwd: w.repo }));
  await refused(["new", "--model", "model.json", "--archetypes", "iso-flow,series", "--round", "first"], /round 'first' is already there/);
});

test("a round may hold views that have no starter, each on the blank one under its own name", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "layer-stack,blank:exploded,blank:cutaway"], { cwd: w.repo }));
  assert.equal(status, 0);
  const round = path.join(w.drafts, "round-1");
  assert.equal(read(round, "b", "figure.tsx"), read(STARTERS, "blank", "figure.tsx"));
  assert.equal(read(round, "c", "figure.tsx"), read(STARTERS, "blank", "figure.tsx"));
  assert.deepEqual(JSON.parse(read(round, "round.json")).drafts.map((d) => d.archetype), ["layer-stack", "blank:exploded", "blank:cutaway"]);
  assert.match(out, / {2}round-1\/b {2}blank:exploded /);
  assert.equal((await quiet(() => draft(["check", "round-1"], { cwd: w.repo }))).status, 0);
});

test("a round is not started for a subject nobody has put into one sentence", async (t) => {
  const w = world(t);
  const bare = JSON.parse(MODEL);
  delete bare.mechanism;
  delete bare.lens;
  write(w.repo, "bare.json", JSON.stringify(bare));
  const { status, out } = await quiet(() => draft(["new", "--model", "bare.json", "--archetypes", "iso-flow,series"], { cwd: w.repo }));
  assert.equal(status, 1);
  assert.match(out, /error: mechanism is missing: one sentence with a verb, saying what happens/);
  assert.match(out, /error: lens is missing: one of structure, path, time, field, transformation, difference, cases, scale/);
  assert.equal(fs.existsSync(w.drafts), false);
});

test("draft check passes a round whose drafts were redrawn, and names what makes one unfair", async (t) => {
  const w = world(t);
  await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "iso-flow,layer-stack,card-flow"], { cwd: w.repo }));
  const round = path.join(w.drafts, "round-1");
  fs.appendFileSync(path.join(round, "a", "figure.tsx"), "\n// redrawn for this model\n");
  const fair = await quiet(() => draft(["check", "round-1"], { cwd: w.repo }));
  assert.equal(fair.status, 0, "the figure is the draft's to change");
  assert.equal(fair.out, "ok: round-1 is fair: a iso-flow, b layer-stack, c card-flow\n");
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
  await quiet(() => draft(["new", "--model", "model.json", "--archetypes", "iso-flow,layer-stack"], { cwd: w.repo }));
  assert.equal((await quiet(() => land(["round-1/b", "--as", "upload-path"], { cwd: w.repo }))).status, 0);
  const figures = path.join(w.repo, ".agents", "picture-this", "figures");
  const source = read(figures, "upload-path", "figure.tsx");
  for (const m of source.matchAll(/from "(\.\.\/kit\/[^"]+)"/g)) {
    const base = path.join(figures, "upload-path", m[1]);
    assert.ok([".ts", ".tsx"].some((ext) => fs.existsSync(base + ext)), `${m[1]} resolves from the landed figure`);
  }
});
