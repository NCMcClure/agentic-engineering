// picture-this's pure core: the clock a figure is drawn from, the isometric
// projection, and the lookups over a model. These are the kit's own files,
// imported as TypeScript, so what is tested is what gets copied into a repo.
// Node strips the types itself from 22.18; an older Node skips the suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const KIT = path.join(REPO, "plugins", "picture-this", "kit");
const skip = process.features.typescript ? false : "this Node cannot import TypeScript";
const load = (rel) => import(new URL(`file://${path.join(KIT, rel).split(path.sep).join("/").replace(/^([A-Za-z]:)/, "/$1")}`).href);
const T = skip ? null : await load("timeline.ts");
const I = skip ? null : await load("iso/project.ts");
const M = skip ? null : await load("model.ts");
const P = skip ? null : await load("iso/place.ts");
const model = JSON.parse(fs.readFileSync(path.join(REPO, "plugins", "picture-this", "studies", "iso-flow", "model.json"), "utf8"));
const beats = [{ id: "a", ms: 3000 }, { id: "b", ms: 2000 }, { id: "rest", ms: 1000, rest: true }];
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} is not ${expected}`);

test("a timeline lays its beats end to end", { skip }, () => {
  const tl = T.createTimeline(beats);
  assert.deepEqual(tl.starts, [0, 3000, 5000]);
  assert.equal(tl.total, 6000);
  assert.throws(() => T.createTimeline([]), /at least one beat/);
  assert.throws(() => T.createTimeline([{ id: "x", ms: 0 }]), /beat 'x' needs a duration/);
});

test("a frame says which beat the clock is in and how far through, and time wraps", { skip }, () => {
  const tl = T.createTimeline(beats);
  assert.deepEqual(T.frameAt(tl, 3500), { t: 3500, index: 1, beat: beats[1], p: 0.25, ms: 500 });
  assert.equal(T.frameAt(tl, 0).index, 0);
  assert.equal(T.frameAt(tl, 2999.9).index, 0);
  assert.equal(T.frameAt(tl, 3000).index, 1, "a boundary belongs to the beat that starts there");
  assert.equal(T.frameAt(tl, 6000).t, 0, "the end of the loop is its start");
  assert.equal(T.frameAt(tl, 6500).t, 500);
  assert.equal(T.frameAt(tl, -500).t, 5500, "time before zero wraps too");
});

test("timeOf is the time at a point inside a beat", { skip }, () => {
  const tl = T.createTimeline(beats);
  assert.equal(T.timeOf(tl, "b"), 4000, "the middle, by default");
  assert.equal(T.timeOf(tl, "b", 0), 3000);
  assert.equal(T.timeOf(tl, "a", 0.25), 750);
  assert.equal(T.timeOf(tl, "b", 7), 5000, "a point past the end is held at the end");
  assert.throws(() => T.timeOf(tl, "nope"), /no beat 'nope'/);
});

test("since: nothing before the beat, easing in as it starts, and there from then on", { skip }, () => {
  const tl = T.createTimeline(beats);
  const at = (t) => T.since(tl, T.frameAt(tl, t), "b");
  assert.equal(at(2999), 0);
  assert.equal(at(3000), 0);
  near(at(3300), 0.875, "half way through a 600 ms entry, eased out");
  assert.equal(at(3600), 1);
  assert.equal(at(5500), 1, "still there in the rest beat");
  assert.equal(T.since(tl, T.frameAt(tl, 100), "a", 5000), T.ease.out(100 / 3000), "an entry is never longer than its beat");
});

test("during: a highlight that rises as the beat starts and falls as it ends", { skip }, () => {
  const tl = T.createTimeline(beats);
  const at = (t) => T.during(tl, T.frameAt(tl, t), "b");
  assert.equal(at(2000), 0);
  assert.equal(at(3000), 0);
  near(at(3200), 0.5);
  assert.equal(at(4000), 1);
  near(at(4800), 0.5);
  assert.equal(at(5000), 0, "the next beat has begun");
});

test("outro: what has built up leaves over the loop's last moments", { skip }, () => {
  const tl = T.createTimeline(beats);
  const at = (t) => T.outro(tl, T.frameAt(tl, t));
  assert.equal(at(0), 1);
  assert.equal(at(5500), 1);
  near(at(5750), 0.5);
  near(at(5999), T.ease.inOut(1 / 500));
});

test("lap: a whole number of laps per beat, so the beat and its progress fix the picture", { skip }, () => {
  const tl = T.createTimeline(beats);
  near(T.lap(T.frameAt(tl, 1500)), 0.5);
  near(T.lap(T.frameAt(tl, 1500), 2), 0, "two laps: back at the start half way through");
  near(T.lap(T.frameAt(tl, 750), 2), 0.5);
  near(T.lap(T.frameAt(tl, 1500), 1, 0.25), 0.75);
  near(T.lap(T.frameAt(tl, 1500), 1, -0.75), 0.75, "an offset before zero wraps");
  near(T.lap(T.frameAt(tl, 1500), 0.4), 0.5, "less than one lap is one lap");
  assert.equal(T.lap(T.frameAt(tl, 0), 3), T.lap(T.frameAt(tl, 3000), 3), "every beat starts its laps from the same place");
});

test("the easing curves run from 0 to 1, and span and clamp hold their ends", { skip }, () => {
  for (const [name, fn] of Object.entries(T.ease)) {
    near(fn(0), 0, name);
    near(fn(1), 1, name);
  }
  near(T.ease.inOut(0.5), 0.5);
  assert.equal(T.lerp(10, 20, 0.25), 12.5);
  assert.equal(T.span(0.5, 0.25, 0.75), 0.5);
  assert.equal(T.span(0.1, 0.25, 0.75), 0);
  assert.equal(T.span(0.9, 0.25, 0.75), 1);
  assert.equal(T.clamp(4, 1, 3), 3);
});

test("a clock moves only when it is ticked, and only while it plays", { skip }, () => {
  const tl = T.createTimeline(beats);
  const clock = T.createClock(tl);
  let calls = 0;
  const off = clock.subscribe(() => { calls += 1; });
  clock.tick(1000);
  assert.equal(clock.get(), 0, "paused: a tick moves nothing");
  clock.play();
  clock.tick(1000);
  assert.equal(clock.get(), 0, "the first tick only sets the mark");
  clock.tick(1016);
  assert.equal(clock.get(), 16);
  clock.tick(9000);
  assert.equal(clock.get(), 116, "a tab that slept moves the story on by a tenth of a second, no more");
  clock.pause();
  clock.tick(9500);
  assert.equal(clock.get(), 116);
  clock.play();
  clock.tick(20000);
  clock.tick(20050);
  assert.equal(clock.get(), 166, "time spent paused is not caught up");
  assert.ok(calls >= 5, "subscribers hear every change");
  off();
  const before = calls;
  clock.seek(100);
  assert.equal(calls, before, "an unsubscribed listener hears nothing");
});

test("seek wraps, and step pauses on the middle of the next told beat", { skip }, () => {
  const tl = T.createTimeline(beats);
  const clock = T.createClock(tl, { at: 100, playing: true });
  assert.equal(clock.playing(), true);
  clock.step(1);
  assert.equal(clock.playing(), false);
  assert.equal(clock.get(), 4000, "from a to the middle of b");
  clock.step(1);
  assert.equal(clock.get(), 1500, "past the last told beat is the first: the rest beat is never stepped to");
  clock.step(-1);
  assert.equal(clock.get(), 4000);
  clock.seek(5500);
  clock.step(1);
  assert.equal(clock.get(), 1500, "from the rest beat, forward is the first beat");
  clock.seek(5500);
  clock.step(-1);
  assert.equal(clock.get(), 4000, "and back is the last");
  clock.seek(6100);
  assert.equal(clock.get(), 100);
  clock.seek(-100);
  assert.equal(clock.get(), 5900);
  assert.equal(clock.frame().beat.id, "rest");
});

test("isometric axes: x down to the right, y down to the left, z straight up", { skip }, () => {
  assert.deepEqual(I.project([1, 0, 0], 100), [86.6, 50]);
  assert.deepEqual(I.project([0, 1, 0], 100), [-86.6, 50]);
  assert.deepEqual(I.project([0, 0, 1], 100), [0, -100]);
  assert.deepEqual(I.project([0, 0, 0]), [0, 0]);
  assert.deepEqual(I.project([1, 1, 1], 100), [0, 0], "one step along each axis lands back on the origin");
  assert.ok(Object.is(I.project([1, 1, 1], 100)[0], 0), "never a negative zero in an attribute");
});

test("a plate is four corners and a block is the three faces that show", { skip }, () => {
  assert.deepEqual(I.plate(0, 0, 0, 2, 1, 50), [[0, 0], [86.6, 50], [43.3, 75], [-43.3, 25]]);
  const b = I.block(0, 0, 0, 1, 1, 1, 100);
  assert.deepEqual(b.top, [[0, -100], [86.6, -50], [0, 0], [-86.6, -50]]);
  assert.deepEqual(b.left, [[-86.6, -50], [0, 0], [0, 100], [-86.6, 50]]);
  assert.deepEqual(b.right, [[86.6, -50], [0, 0], [0, 100], [86.6, 50]]);
  assert.equal(I.points(b.top), "0,-100 86.6,-50 0,0 -86.6,-50");
});

test("smooth rounds a corner into a short arc that starts and ends on the original lines", { skip }, () => {
  const corner = [[0, 0], [100, 0], [100, 100]];
  assert.deepEqual(I.smooth(corner), corner, "no radius, no change");
  const round = I.smooth(corner, 10, 2);
  assert.deepEqual(round, [[0, 0], [90, 0], [97.5, 2.5], [100, 10], [100, 100]]);
  assert.equal(I.smooth(corner, 10).length, 9, "six segments a corner by default");
  const tight = I.smooth([[0, 0], [10, 0], [10, 100]], 40, 2);
  assert.deepEqual([tight[1], tight[3]], [[5, 0], [10, 5]], "the radius is at most half the shorter side");
  assert.deepEqual(I.smooth([[0, 0], [5, 5]], 10), [[0, 0], [5, 5]]);
  assert.equal(I.line(corner), "M 0 0 L 100 0 L 100 100");
  assert.equal(I.line([]), "");
});

test("slice is the stretch of a polyline between two fractions of its length", { skip }, () => {
  const corner = [[0, 0], [100, 0], [100, 100]];
  assert.deepEqual(I.slice(corner, 0.25, 0.75), [[50, 0], [100, 0], [100, 50]]);
  assert.deepEqual(I.slice(corner, 0, 0.25), [[0, 0], [50, 0]]);
  assert.deepEqual(I.slice(corner, 0.6, 2), [[100, 20], [100, 100]], "past the end is the end");
  assert.deepEqual(I.slice(corner, 0.5, 0.5), []);
  assert.deepEqual(I.slice(corner, 0.8, 0.2), []);
  assert.deepEqual(I.slice([[1, 1]], 0, 1), []);
});

test("heading is the way a line ends, and a disc is the ellipse a ground circle shows as", { skip }, () => {
  assert.equal(I.heading([[0, 0], [100, 0]]), 0);
  assert.equal(I.heading([[0, 0], [100, 0], [100, 100]]), 90);
  assert.equal(I.heading([[0, 0], [-10, 0]]), 180);
  assert.equal(I.heading([[0, 0], [10, 10], [10, 10]]), 45, "a repeated last point does not lose the direction");
  assert.equal(I.heading([[3, 3]]), 0);
  assert.deepEqual(I.disc(0, 0, 0, 1, 100), { cx: 0, cy: 0, rx: 122.47, ry: 70.71 });
  assert.deepEqual(I.disc(1, 1, 1, 0.5, 100), { cx: 0, cy: 0, rx: 61.24, ry: 35.36 });
});

test("along, centre and bounds measure a set of points", { skip }, () => {
  const corner = [[0, 0], [100, 0], [100, 100]];
  assert.deepEqual(I.along(corner, 0), [0, 0]);
  assert.deepEqual(I.along(corner, 0.25), [50, 0]);
  assert.deepEqual(I.along(corner, 0.75), [100, 50]);
  assert.deepEqual(I.along(corner, 1), [100, 100]);
  assert.deepEqual(I.along(corner, 4), [100, 100]);
  assert.deepEqual(I.along([[3, 4]], 0.5), [3, 4]);
  assert.deepEqual(I.centre(I.plate(0, 0, 0, 2, 2, 50)), [0, 50]);
  assert.deepEqual(I.bounds(I.plate(0, 0, 0, 2, 1, 50)), { x: -43.3, y: 0, width: 129.9, height: 75 });
});

test("the model lookups find what a figure needs, and say what they cannot find", { skip }, () => {
  assert.equal(M.entity(model, "api").label, "API");
  assert.equal(M.flow(model, "save").to, "store");
  assert.throws(() => M.entity(model, "nope"), /no entity 'nope'/);
  assert.throws(() => M.flow(model, "nope"), /no flow 'nope'/);
  assert.throws(() => M.beat(model, "nope"), /no beat 'nope'/);
  assert.deepEqual(M.told(model).map((b) => b.id), ["answer", "work", "save"]);
  assert.equal(M.hasTechnical(model), true);
  assert.equal(M.caption(model, "work"), "A worker picks the job up when it is free and makes the thumbnail.");
  assert.match(M.caption(model, "work", "technical"), /^The resizer takes one job/);
  const plain = structuredClone(model);
  for (const b of plain.beats) delete b.technical;
  assert.equal(M.hasTechnical(plain), false);
  assert.equal(M.caption(plain, "work", "technical"), M.caption(plain, "work"), "with no technical track, the plain one is shown");
  assert.equal(M.caption(model, "rest"), "");
});

test("focus, flow and first appearance follow the beats", { skip }, () => {
  assert.equal(M.inFocus(model, "answer", "api"), true);
  assert.equal(M.inFocus(model, "answer", "worker"), false);
  assert.equal(M.inFocus(model, "save", "store"), true);
  assert.equal(M.inFocus(model, "rest", "api"), false);
  assert.equal(M.flowing(model, "work", "take"), true);
  assert.equal(M.flowing(model, "work", "save"), false);
  assert.equal(M.firstBeatOf(model, "save"), "save");
  assert.equal(M.firstBeatOf(model, "nope"), null);
  assert.equal(M.firstBeatWith(model, "queue"), "answer");
  assert.equal(M.firstBeatWith(model, "worker"), "work");
  assert.equal(M.firstBeatWith(model, "store"), "save");
});

test("a row and a grid place boxes, and a grid's rows run back and forth", { skip }, () => {
  const r = P.row(["a", "b", "c"]);
  assert.deepEqual([r.a.at, r.b.at, r.c.at], [[0, 0, 0], [4, 0, 0], [8, 0, 0]]);
  assert.deepEqual(P.row(["a", "b"], { gap: 2, y: 5 }).b.at, [3.6, 5, 0]);
  const g = P.grid(["a", "b", "c", "d", "e"], { columns: 3, gap: 2.4 });
  assert.deepEqual([g.a.at, g.c.at], [[0, 0, 0], [8, 0, 0]]);
  assert.deepEqual([g.d.at, g.e.at], [[8, 4, 0], [4, 4, 0]], "the second row starts in front of where the first ended");
});

test("a wire crosses the gap from the face it leaves, turns once when it must, and goes round what stands between", { skip }, () => {
  const r = P.row(["a", "b", "c"]);
  assert.deepEqual(P.hop(r.a, r.b), [[1.6, 0.8, 0], [4, 0.8, 0]]);
  assert.deepEqual(P.hop(r.b, r.a), [[4, 0.8, 0], [1.6, 0.8, 0]], "back the other way, from the other face");
  assert.deepEqual(P.hop(r.a, r.b, -0.3), [[1.6, 0.5, 0], [4, 0.5, 0]], "shifted, to run beside its pair");
  const front = { at: [0, 4, 0], size: [1.6, 1.6], height: 0.7 };
  assert.deepEqual(P.hop(r.a, front), [[0.8, 1.6, 0], [0.8, 4, 0]]);
  assert.deepEqual(P.hop(front, r.a), [[0.8, 4, 0], [0.8, 1.6, 0]]);
  const corner = { at: [4, 4, 0], size: [1.6, 1.6], height: 0.7 };
  assert.deepEqual(P.hop(r.a, corner), [[0.8, 1.6, 0], [0.8, 4.8, 0], [4, 4.8, 0]], "out of the front, along, and in at the side");
  assert.equal(P.between(r.a, r.c, r.b), true);
  assert.equal(P.between(r.a, r.b, r.c), false);
  assert.equal(P.between(r.a, r.c, corner), false, "what stands in another row is not in the way");
  assert.deepEqual(P.around(r.a, r.c, 2.5), [[0.8, 1.6, 0], [0.8, 2.5, 0], [8.8, 2.5, 0], [8.8, 1.6, 0]]);
  const e = P.extent([r.a, r.c], 0.5);
  assert.deepEqual([e.at, e.size], [[-0.5, -0.5, 0], [10.6, 2.6]]);
  assert.equal(e.points.length, 6);
});

test("each beat has one leading flow: the one that arrives furthest along", { skip }, () => {
  assert.deepEqual([...M.leads(model)].sort(), ["enqueue", "save", "take"], "of upload, enqueue and reply, the queue is furthest along");
  assert.deepEqual(M.groups(model), []);
  const split = JSON.parse(fs.readFileSync(path.join(REPO, "plugins", "picture-this", "studies", "split", "model.json"), "utf8"));
  assert.deepEqual(M.groups(split), ["Without a queue", "With a queue"]);
});

test("the kit's model type and the checker agree on kinds and hues", { skip }, async () => {
  const { FLOW_KINDS, HUES } = await import("../../../plugins/picture-this/scripts/lib/model-check.mjs");
  const source = fs.readFileSync(path.join(KIT, "model.ts"), "utf8");
  const { LENSES } = await import("../../../plugins/picture-this/scripts/lib/model-check.mjs");
  const union = (name) => [...source.match(new RegExp(`export type ${name} = ([^;]+);`))[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(union("Lens"), LENSES);
  assert.deepEqual(union("FlowKind"), FLOW_KINDS);
  assert.deepEqual(union("Hue"), HUES);
});

test("a quantity is read off the clock: one value is reached evenly, a course is followed, a beat left out holds", { skip }, () => {
  const m = { ...model, quantities: [{ id: "waiting", label: "Jobs waiting", max: 10, start: 2, values: { answer: 6, save: [8, 0, 4] } }] };
  const at = (beat, p) => M.levelAt(m, "waiting", m.beats.findIndex((b) => b.id === beat), p);
  assert.deepEqual([at("answer", 0), at("answer", 0.5), at("answer", 1)], [2, 4, 6], "from where it started to the beat's one value");
  assert.deepEqual([at("work", 0), at("work", 0.7)], [6, 6], "a beat with no value holds the level");
  assert.deepEqual([at("save", 0), at("save", 0.25), at("save", 0.5), at("save", 0.75), at("save", 1)], [8, 4, 0, 2, 4], "a course opens with a jump and is followed evenly");
  assert.equal(at("rest", 0.5), 4, "and the rest holds where the story left it");
  assert.equal(M.levelAt(m, "waiting", 0, 7), 6, "progress past the end is the end");
  assert.throws(() => M.levelAt(m, "missing", 0, 0), /no quantity 'missing'/);
});

test("the model answers what is inside what, how many of a thing there are, and what its tables hold", { skip }, () => {
  const m = structuredClone(model);
  m.entities[2].parent = "api";
  m.entities[3].parent = "queue";
  m.entities[3].repeat = 3;
  m.data = { sizes: [1, 2, 3], heat: [[0, 1], [2, 3]], jobs: [{ id: "j1", label: "resize" }] };
  assert.deepEqual(M.children(m, "api").map((e) => e.id), ["queue"]);
  assert.deepEqual(["api", "queue", "worker"].map((id) => M.depth(m, id)), [0, 1, 2]);
  assert.deepEqual([M.unitsOf(m, "worker"), M.unitsOf(m, "api")], [3, 1]);
  assert.deepEqual(M.series(m, "sizes"), [1, 2, 3]);
  assert.deepEqual(M.cells(m, "heat"), [[0, 1], [2, 3]]);
  assert.deepEqual(M.rows(m, "jobs"), [{ id: "j1", label: "resize" }]);
  assert.throws(() => M.cells(m, "sizes"), /data 'sizes' is not a grid of cells/);
  assert.throws(() => M.rows(m, "heat"), /data 'heat' is not a list of rows/);
  assert.throws(() => M.series(m, "absent"), /no data 'absent'/);
});

test("the kit's model type carries every field the checker reads", { skip }, () => {
  const source = fs.readFileSync(path.join(KIT, "model.ts"), "utf8");
  for (const field of ["parent?: string", "born?: string", "repeat?: number", "quantities?: Quantity[]", "data?: Record<string, Table>"]) assert.ok(source.includes(field), field);
});

test("a quantity's course can be drawn whole, and says where it falls", { skip }, () => {
  const m = { ...model, quantities: [{ id: "waiting", label: "Jobs waiting", max: 10, start: 2, values: { answer: 6, save: [8, 0, 4] } }] };
  assert.deepEqual(M.knots(m, "waiting"), [
    { at: 0, value: 2 }, { at: 1, value: 6 }, { at: 2, value: 8 }, { at: 2.5, value: 0 }, { at: 3, value: 4 }, { at: 4, value: 4 },
  ], "beat-time: the third beat's course runs from 2 to 3, and the last level is held to the loop's end");
  assert.deepEqual(M.falls(m, "waiting"), [{ from: 2, to: 2.5, high: 8, low: 0 }]);
  for (const k of M.knots(m, "waiting")) {
    const index = Math.min(m.beats.length - 1, Math.floor(k.at)), p = k.at - index;
    if (k.at !== 2) near(M.levelAt(m, "waiting", index, p), k.value, `the course agrees with levelAt at ${k.at}`);
  }
});
