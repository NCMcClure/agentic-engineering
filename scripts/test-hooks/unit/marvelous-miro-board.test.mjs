// marvelous-miro's board side: the lint's rules on the smallest board that breaks
// each, and the build, pull, live, and setup scripts end to end on a throwaway
// project. Nothing here reaches Miro, Chrome, or the network: the Miro side is
// faked. A create result is made from the frame the build wrote, a read is that
// result with one card moved, and a live dump is written by hand in the shape
// the browser script returns. Every board is geometry with filler text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { CHECKS, caption, lint, liveModel, pointAt, predictedModel, route } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/lint.mjs";
import { autosize, measureHtml } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/measure.mjs";
import { sceneItems } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/miro.mjs";
import { createScene } from "../../../plugins/marvelous-miro/skills/miro-board/scripts/scene-kit.mjs";
import { ARGS, PACKAGE, PROFILE } from "../../../plugins/marvelous-miro/skills/browser-setup/scripts/miro-browser.mjs";
import { report } from "../../../plugins/marvelous-miro/skills/browser-setup/scripts/check-setup.mjs";
import { REPO, runNode, tempDir } from "./helpers.mjs";

const PLUGIN = join(REPO, "plugins", "marvelous-miro");
const plugin = join(PLUGIN, "skills");
const S = join(plugin, "miro-board", "scripts");
const setup = join(plugin, "browser-setup", "scripts", "check-setup.mjs");
const BOARD = "https://miro.com/app/board/uXjTEST=/";
const run = (script, args, cwd, env = {}) => runNode(script, args, { cwd, env: { ...process.env, ...env } });

// ── the lint ────────────────────────────────────────────────────────────────
const frame = { x: 0, y: 0, width: 2000, height: 1000 };
const card = (key, x, y, w = 200, h = 80, content = "<b>Card</b><br>one line", attrs = {}) => ({
  key, kind: "shape", tag: "rect", attrs: { x, y, width: w, height: h, ...(content ? { "data-content": content, "data-font-size": "14" } : {}), ...attrs } });
const box = (key, x, y, w, h, attrs = {}) => card(key, x, y, w, h, null, attrs);
const text = (key, x, y, w = 100, body = "filler") => ({ key, kind: "text", tag: "textArea", attrs: { x, y, width: w, "font-size": "14" }, body });
const conn = (key, start, end, sides, extra = {}) => ({
  key, kind: "connector", tag: "line", refs: { start, end },
  attrs: { "data-shape": "elbowed", "data-start-side": sides[0], "data-end-side": sides[1], ...extra } });
const straight = { "data-shape": "straight" };
const sample = (key, x, y, dashed) => ({ key, kind: "divider", tag: "line", attrs: { x1: x, y1: y, x2: x + 30, y2: y, ...(dashed ? { "data-line-style": "dashed" } : {}) } });
const findings = (items, opts) => lint(predictedModel([{ key: "f", frame, items }]), opts);
const checks = (items, opts) => findings(items, opts).map((f) => f.check);
// A live dump (board-dump.js's shape) with routes given as points: cards { id: rect },
// lines [{ id, start, end, pts, captions: [[text, position, width]] }].
const dump = (cards, lines) => [
  { id: "F", type: "frame", b: { left: 0, top: 0, width: 2000, height: 1000 } },
  ...Object.entries(cards).map(([id, [x, y, w, h]]) => ({ id, type: "shape", parentId: "F", b: { left: x, top: y, width: w, height: h }, content: "<p>Card</p>", fs: 14, meas: [17, 40] })),
  ...lines.map(({ id, start, end, pts, captions = [] }) => ({ id, type: "line", start, end, startSide: "right", endSide: "left", aligned: true,
    pts: pts.map(([x, y]) => ({ x, y })), captions: captions.map(([t, position, w]) => ({ text: t, position, tav: "middle", w, fs: 14 })) })),
];
const liveChecks = (cards, lines) => lint(liveModel(dump(cards, lines), { f: "F" })).map((f) => f.check);
const frames2 = (gap) => lint(predictedModel([{ key: "f", frame, items: [] }, { key: "g", frame: { x: 2000 + gap, y: 0, width: 500, height: 500 }, items: [] }])).map((f) => f.check);

// One failing and one passing board per check, each the smallest that shows the rule.
const LONG = "<b>Title</b><br>a body long enough to wrap onto a third line in a narrow card";
const hub = [card("hub", 100, 300), card("a", 600, 100), card("b", 600, 500), conn("x", "hub", "a", ["right", "left"], { "data-content": "first" })];
const band = (inner) => [box("band", 50, 50, 600, 300), card("a", 100, 150), card("c", 100, 260, 200, 60), ...inner];
const cross4 = { a: [100, 300, 200, 80], b: [700, 300, 200, 80], c: [400, 50, 200, 80], d: [400, 600, 200, 80] };
const row4 = { a: [100, 100, 200, 80], b: [900, 100, 200, 80], c: [100, 400, 200, 80], d: [900, 400, 200, 80] };
const legend = (stroke, extra = []) => [card("a", 100, 100, 200, 80, undefined, { fill: "#eeeeee", stroke: "#111111" }),
  box("sw", 100, 300, 30, 18, { fill: "#dddddd", stroke }), text("sw-l", 140, 300), ...extra];
const FIX = {
  overflow: [() => checks([card("a", 100, 100, 200, 40, LONG)]), () => checks([card("a", 100, 100)])],
  text_text: [() => checks([text("t", 100, 100, 200), text("u", 100, 110, 200)]), () => checks([text("t", 100, 100, 200), text("u", 100, 140, 200)])],
  text_card: [() => checks([card("a", 100, 100), text("t", 150, 120)]), () => checks([card("a", 100, 100), text("t", 100, 200)])],
  card_card: [() => checks([card("a", 100, 100), card("b", 250, 120)]), () => checks([card("a", 100, 100), card("b", 340, 100)])],
  badge_text: [() => checks([card("a", 100, 100), card("p", 120, 115, 60, 20, "pill")]), () => checks([card("a", 100, 100), card("p", 190, 148, 100, 22, "pill")])],
  gap: [() => checks([card("a", 100, 100), card("b", 305, 100)]), () => checks([card("a", 100, 100), card("b", 340, 100)])],
  outside_frame: [() => checks([card("a", 1900, 100)]), () => checks([card("a", 1700, 100)])],
  frame_frame: [() => frames2(30), () => frames2(100)],
  card_border: [() => checks([box("band", 50, 50, 600, 300), card("a", 100, 100), card("b", 400, 100), card("c", 550, 250)]),
    () => checks([box("band", 50, 50, 600, 300), card("a", 100, 100), card("b", 400, 100), card("c", 700, 250)])],
  legend_coverage: [() => checks(legend("#222222")), () => checks(legend("#111111"))],
  label_card: [() => checks([card("a", 100, 100), card("b", 700, 100), card("c", 480, 145, 100, 60), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "calls" })]),
    () => checks([card("a", 100, 100), card("b", 700, 100), card("c", 480, 200, 100, 60), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "calls" })])],
  label_text: [() => checks([card("a", 100, 100), card("b", 700, 100), text("t", 480, 145), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "calls" })]),
    () => checks([card("a", 100, 100), card("b", 700, 100), text("t", 480, 200), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "calls" })])],
  // Two captions Miro drew on top of each other; on a predicted board that is a caption_collision.
  label_label: [() => liveChecks(cross4, [{ id: "x", start: "a", end: "b", pts: [[300, 340], [700, 340]], captions: [["filler", 0.5, 26]] },
    { id: "y", start: "c", end: "d", pts: [[500, 130], [500, 600]], captions: [["filler", 210 / 470, 26]] }]),
  () => liveChecks(cross4, [{ id: "x", start: "a", end: "b", pts: [[300, 340], [700, 340]], captions: [["filler", 0.5, 26]] },
    { id: "y", start: "c", end: "d", pts: [[500, 130], [500, 600]], captions: [["filler", 0.15, 26]] }])],
  label_border: [() => checks(band([card("b", 1000, 150), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "filler text" })])),
    () => checks(band([card("b", 450, 150, 150, 80), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "filler text" })]))],
  // The fan from the hub's right side passes: the captions' boxes stay clear of each other's routes.
  caption_collision: [() => checks([...hub, card("c", 100, 200), card("d", 700, 200), conn("z", "c", "d", ["right", "left"], straight)]),
    () => checks([...hub, conn("y", "hub", "b", ["right", "left"])])],
  caption_run: [() => checks([card("a", 100, 100), card("b", 600, 140), conn("x", "a", "b", ["right", "left"], { "data-content": "filler text" })]),
    () => checks([card("a", 100, 100), card("b", 600, 100), conn("x", "a", "b", ["right", "left"], { ...straight, "data-content": "filler text" })])],
  line_card: [() => checks([card("a", 100, 100), card("b", 900, 100), card("c", 450, 110, 200, 60), conn("x", "a", "b", ["right", "left"], straight)]),
    () => checks([card("a", 100, 100), card("b", 900, 100), card("c", 450, 300, 200, 60), conn("x", "a", "b", ["right", "left"], straight)])],
  line_near: [() => checks([card("a", 100, 100), card("b", 900, 100), card("c", 450, 143, 200, 60), conn("x", "a", "b", ["right", "left"], straight)]),
    () => checks([card("a", 100, 100), card("b", 900, 100), card("c", 450, 160, 200, 60), conn("x", "a", "b", ["right", "left"], straight)])],
  line_text: [() => checks([card("a", 100, 100), card("b", 900, 100), text("t", 450, 132), conn("x", "a", "b", ["right", "left"], straight)]),
    () => checks([card("a", 100, 100), card("b", 900, 100), text("t", 450, 170), conn("x", "a", "b", ["right", "left"], straight)])],
  line_label: [() => liveChecks(cross4, [{ id: "x", start: "a", end: "b", pts: [[300, 340], [700, 340]], captions: [["filler", 0.5, 26]] }, { id: "y", start: "c", end: "d", pts: [[500, 130], [500, 600]] }]),
    () => liveChecks(cross4, [{ id: "x", start: "a", end: "b", pts: [[300, 340], [700, 340]], captions: [["filler", 0.5, 26]] }, { id: "y", start: "c", end: "d", pts: [[600, 130], [600, 600]] }])],
  line_line: [() => liveChecks(row4, [{ id: "x", start: "a", end: "b", pts: [[300, 140], [900, 140]] }, { id: "y", start: "c", end: "d", pts: [[400, 141], [800, 141]] }]),
    () => liveChecks(row4, [{ id: "x", start: "a", end: "b", pts: [[300, 140], [900, 140]] }, { id: "y", start: "c", end: "d", pts: [[400, 300], [800, 300]] }])],
  line_cross: [() => checks([card("a", 100, 300), card("b", 900, 300), card("c", 400, 50), card("d", 400, 600), conn("x", "a", "b", ["right", "left"], straight), conn("y", "c", "d", ["bottom", "top"], straight)]),
    () => checks([card("a", 100, 300), card("b", 900, 300), card("c", 400, 50), card("d", 400, 200), conn("x", "a", "b", ["right", "left"], straight), conn("y", "c", "d", ["bottom", "top"], straight)])],
  line_parallel: [() => liveChecks(row4, [{ id: "x", start: "a", end: "b", pts: [[300, 140], [900, 140]] }, { id: "y", start: "c", end: "d", pts: [[300, 150], [900, 150]] }]),
    () => liveChecks(row4, [{ id: "x", start: "a", end: "b", pts: [[300, 140], [900, 140]] }, { id: "y", start: "c", end: "d", pts: [[300, 170], [900, 170]] }])],
  diagonal: [() => checks([card("a", 100, 100), card("b", 600, 300), conn("x", "a", "b", ["right", "left"], straight)]),
    () => checks([card("a", 100, 100), card("b", 600, 100), conn("x", "a", "b", ["right", "left"], straight)])],
  direction: [() => checks([card("a", 900, 100), card("b", 100, 100), conn("x", "a", "b", ["left", "right"], straight)], { strict: ["f"] }),
    () => checks([card("a", 100, 100), card("b", 900, 100), conn("x", "a", "b", ["right", "left"], straight)], { strict: ["f"] })],
};

test("lint: every check has a failing and a passing board", () => {
  assert.deepEqual(Object.keys(FIX).sort(), [...CHECKS].sort());
});
for (const [check, [fail, pass]] of Object.entries(FIX)) {
  test(`lint ${check}: the failing board has it, the passing one does not`, () => {
    assert.ok(fail().includes(check), `failing board: ${JSON.stringify(fail())}`);
    assert.ok(!pass().includes(check), `passing board: ${JSON.stringify(pass())}`);
  });
}

test("lint: a clean pair of cards and one labeled connector passes", () => {
  assert.deepEqual(checks([card("a", 100, 100), card("b", 600, 100), conn("x", "a", "b", ["right", "left"], { "data-content": "calls" })]), []);
});

test("lint: a pill inside its card is that card's badge, not a second card", () => {
  // The card comes first, as kit.card() draws it: the pill must still find it as host.
  const pill = { key: "p", kind: "shape", tag: "rect", attrs: { x: 190, y: 148, width: 100, height: 22, "data-content": "filler pill", "data-font-size": "12" } };
  assert.ok(!checks([card("a", 100, 100, 200, 80), pill]).includes("card_card"));
});

test("lint: a legend's line samples list exactly the connector styles in use", () => {
  const two = [card("a", 100, 100), card("b", 600, 100), conn("x", "a", "b", ["right", "left"], straight)];
  const listed = (dashed) => findings([...two, sample("s", 100, 309, dashed), text("s-l", 142, 300)]).filter((f) => f.check === "legend_coverage").map((f) => `${f.b} ${f.extra}`);
  assert.deepEqual(listed(true).sort(), ["dashed listed, not in use", "solid in use, not listed"]);
  assert.deepEqual(listed(false), []);
});

test("lint: a borderless tint behind the cards is a backdrop, not a style the legend must list", () => {
  const tint = card("t", 400, 60, 300, 200, "<b>Zone</b>", { fill: "#abcdef", stroke: "#abcdef" });
  assert.ok(!checks(legend("#111111", [tint])).includes("legend_coverage"));
  assert.ok(checks(legend("#111111", [{ ...tint, attrs: { ...tint.attrs, stroke: "#123456" } }])).includes("legend_coverage"));
});

test("lint: a jog under 1px does not break a caption's straight run", () => {
  const items = [card("a", 100, 100), card("b", 700, 100.5), conn("x", "a", "b", ["right", "left"], { "data-content": "filler" })];
  assert.equal(predictedModel([{ key: "f", frame, items }]).lines[0].P.length, 4);
  assert.ok(!checks(items).includes("caption_run"));
});

// Crossings between two routes given as points: b runs straight along y = 340 unless given.
const crossCount = (a, b = [[300, 340], [900, 340]]) => {
  const f = lint(liveModel(dump(row4, [{ id: "x", start: "a", end: "b", pts: b }, { id: "y", start: "c", end: "d", pts: a }]), { f: "F" })).find((x) => x.check === "line_cross");
  return f ? parseInt(f.extra, 10) : 0;
};

test("line_cross: a route that bends exactly on another's run and carries on across crosses once", () => {
  assert.equal(crossCount([[600, 500], [500, 500], [500, 800]], [[300, 300], [700, 700]]), 1);
});

test("line_cross: a short shared stretch the routes leave on opposite sides is one crossing", () => {
  assert.equal(crossCount([[500, 200], [500, 340], [505, 340], [505, 500]]), 1);
});

test("line_cross: a bend that touches another route and turns back is no crossing", () => {
  assert.equal(crossCount([[500, 200], [500, 340], [505, 340], [505, 200]]), 0);
});

test("line_cross: a crossing at a route's bend point is counted once, not once per segment", () => {
  assert.equal(crossCount([[500, 200], [500, 340], [500, 500]]), 1);
  assert.equal(crossCount([[500, 200], [500, 300], [500.3, 300], [500.3, 500]]), 1);
});

test("caption_run: a caption that fits its run but is centered near the bend hangs over it", () => {
  // The midpoint of a 300 + 260 elbow is 20px from the bend; the 60px caption reaches 10px past it.
  const items = [card("a", 100, 100), card("b", 500, 400), conn("x", "a", "b", ["right", "top"], { "data-content": "filler text" })];
  const f = findings(items).find((x) => x.check === "caption_run");
  assert.match(f?.extra ?? "", /60px on a 300px run, 10px past its end/);
});

// Strict-frame direction over edges between cards placed by center offset from the start card.
const directionOf = (offsets) => {
  const items = offsets.flatMap(([dx, dy], i) => [card(`s${i}`, 300, 400), card(`e${i}`, 300 + dx, 400 + dy), conn(`x${i}`, `s${i}`, `e${i}`, ["right", "left"])]);
  return findings(items, { strict: true }).find((f) => f.check === "direction");
};

test("direction: an edge reads backward only when it ends up, left, or up-left of its start", () => {
  assert.equal(directionOf([[-800, 200]]), undefined, "a fan-out down and to the left reads down");
  assert.equal(directionOf([[100, -300]]), undefined, "an edge up and to the right reads right");
  assert.ok(directionOf([[-800, 0]]), "left");
  assert.ok(directionOf([[0, -300]]), "up");
  assert.ok(directionOf([[-400, -200]]), "up and to the left");
});

test("direction: at least 80% of main edges read right or down, and dashed or two-headed ones do not count", () => {
  const right = [400, 0], left = [-400, 0];
  assert.equal(directionOf([right, right, right, right, left]), undefined);
  assert.match(directionOf([right, right, right, left])?.a ?? "", /^3 of 4 main edges/);
  const items = [card("a", 900, 100), card("b", 100, 100), conn("x", "a", "b", ["left", "right"], { ...straight, "stroke-dasharray": "5,5" }),
    card("c", 900, 300), card("d", 100, 300), conn("y", "c", "d", ["left", "right"], { ...straight, "data-arrow": "both" })];
  assert.ok(!checks(items, { strict: true }).includes("direction"));
});

test("lint: direction runs only on a strict frame", () => {
  const back = [card("a", 900, 100), card("b", 100, 100), conn("x", "a", "b", ["left", "right"], straight)];
  assert.ok(!checks(back).includes("direction"));
  assert.ok(checks(back, { strict: true }).includes("direction"));
});

// ── what the lint predicts Miro draws ───────────────────────────────────────
const estOf = (items, check = "line_card") => findings(items).find((f) => f.check === check)?.est;

test("route: Miro's elbow between facing sides bends once in the middle", () => {
  assert.deepEqual(route([0, 0, 100, 100], [300, 200, 400, 300], ["right", "left"], "elbowed"), [[100, 50], [200, 50], [200, 250], [300, 250]]);
});

test("route: a facing elbow whose ends line up is the straight line Miro draws", () => {
  assert.deepEqual(route([0, 0, 100, 100], [300, 0, 400, 100], ["right", "left"], "elbowed"), [[100, 50], [300, 50]]);
});

// Both geometries are routes as Miro draws them: it never leaves or enters a side on a
// leg shorter than 30px, and detours through the gap between the two boxes instead.
test("route: facing sides under 60px apart take 30px stubs through the gap between the boxes", () => {
  assert.deepEqual(route([2649, 830, 2867, 966], [2430, 1096, 2604, 1202], ["left", "right"], "elbowed"),
    [[2649, 898], [2619, 898], [2619, 1031], [2634, 1031], [2634, 1149], [2604, 1149]]);
});

test("route: a perpendicular elbow whose first leg is under 30px takes a 30px stub and detours", () => {
  assert.deepEqual(route([3322, 830, 3544, 966], [3199, 1096, 3403, 1202], ["left", "top"], "elbowed"),
    [[3322, 898], [3292, 898], [3292, 1031], [3301, 1031], [3301, 1096]]);
});

test("route: legs of 30px or more keep the default elbow", () => {
  assert.deepEqual(route([0, 0, 100, 100], [160, 200, 260, 300], ["right", "left"], "elbowed"), [[100, 50], [130, 50], [130, 250], [160, 250]]);
  assert.deepEqual(route([0, 0, 100, 100], [100, 200, 160, 300], ["right", "top"], "elbowed"), [[100, 50], [130, 50], [130, 200]]);
});

test("route: caption sits halfway along the route, tw + 8 wide, turned on a vertical run", () => {
  const P = [[0, 0], [100, 0], [100, 200], [200, 200]];
  assert.deepEqual(pointAt(P, 0.5), [[100, 100], [0, 200]]);
  const c = caption(P, 0.5, "filler", 26);
  assert.deepEqual(c.r.map((v) => Math.round(v * 100) / 100), [89.85, 83, 110.15, 117]);
  assert.equal(c.run, 200);
  assert.equal(c.over, 0);
});

test("est: a caption and a line on the same predicted route carry the same est", () => {
  // The caption lands on the elbow's bend, where a third card sits.
  const items = [card("a", 100, 100), card("b", 600, 400), card("c", 330, 300, 140, 60),
    conn("x", "a", "b", ["right", "left"], { "data-content": "a fairly long caption here" })];
  const f = findings(items);
  const est = (check) => f.find((x) => x.check === check).est;
  assert.equal(est("label_card"), est("line_card"));
  assert.equal(est("line_card"), false);
});

test("est: a caption finding on an estimated route is estimated too", () => {
  // The perpendicular route runs through c, so the route is an estimate; so is its caption on c.
  const items = [card("a", 100, 100), card("b", 700, 400), card("c", 600, 110, 140, 60), conn("x", "a", "b", ["right", "top"], { "data-content": "filler" })];
  assert.equal(estOf(items, "line_card"), true);
  assert.equal(estOf(items, "label_card"), true);
});

test("predict: a text widget is as tall as its lines from its y, even under a taller pulled height", () => {
  const t = { ...text("t", 100, 100, 200), attrs: { ...text("t", 100, 100, 200).attrs, height: 60 } };
  assert.deepEqual(checks([t, card("a", 100, 128)]), []);
  assert.ok(checks([t, card("a", 100, 124)]).includes("gap"));
});

test("est: facing, aligned, and same-side elbows are firm", () => {
  assert.equal(estOf([card("a", 100, 100), card("b", 700, 100), card("c", 450, 110, 100, 60), conn("x", "a", "b", ["right", "left"])]), false);
  // Two top/top cards in one row: the 30px detour is not a degenerate leg.
  assert.equal(estOf([card("a", 100, 300), card("b", 700, 300), card("c", 450, 250, 100, 40), conn("x", "a", "b", ["top", "top"])]), false);
});

test("est: a perpendicular elbow through a box, a degenerate leg, or a route back through its own end is estimated", () => {
  assert.equal(estOf([card("a", 100, 100), card("b", 700, 400), card("c", 500, 110, 100, 60), conn("x", "a", "b", ["right", "top"])]), true);
  assert.equal(estOf([card("a", 100, 100), card("b", 200, 400), card("c", 150, 250, 100, 60), conn("x", "a", "b", ["bottom", "left"])]), true);
  assert.equal(estOf([card("a", 600, 100), card("b", 100, 300), card("c", 380, 200, 140, 60), conn("x", "a", "b", ["right", "left"])]), true);
});

test("strict: every finding on a strict frame blocks, estimated or not", () => {
  const items = [card("a", 100, 100), card("b", 700, 400), card("c", 500, 110, 100, 60), conn("x", "a", "b", ["right", "top"])];
  const blocking = (opts) => findings(items, opts).find((f) => f.check === "line_card").blocking;
  assert.equal(blocking(), false);
  assert.equal(blocking({ strict: ["f"] }), true);
  assert.equal(blocking({ strict: ["g"] }), false);
  assert.equal(blocking({ strict: true }), true);
});

test("measure: autosize gives the smallest card the overflow check passes", () => {
  const title = "Filler title", body = ["a body line long enough to wrap at this width", "and one more"];
  const { width, height } = autosize(title, body, { maxW: 220 });
  assert.ok(width <= 220);
  const html = `<b>${title}</b><br>${body.join("<br>")}`;
  assert.ok(!checks([card("a", 100, 100, width, height, html)]).includes("overflow"));
  assert.ok(checks([card("a", 100, 100, width, height - 10, html)]).includes("overflow"));
  assert.deepEqual(measureHtml(html, width - 16, 14), [height - 16, width - 16]);
});

// ── the loop on a throwaway project ─────────────────────────────────────────
const project = (t) => {
  const root = tempDir(t, "miro-test-");
  const dir = join(root, "diagrams");
  const r = run(join(S, "init.mjs"), [dir, "--board", BOARD], root);
  assert.equal(r.status, 0, r.stderr);
  return dir;
};
// The fake Miro: what canvas_create_from_svg hands back is the same svg, each item carrying a board id.
const created = (svg) => { let n = 1000; return svg.replace(/ id="([\w-]+)"/g, (m) => `${m} data-miro-id="${9000000000000000000n + BigInt(n++)}"`); };

test("loop: init, create, pull, publish, then the board is up to date", (t) => {
  const dir = project(t);
  let r = run(join(S, "build.mjs"), [], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /example: 8 items, a new frame/);
  const result = join(dir, "miro", "create-example.json");
  writeFileSync(result, JSON.stringify({ svg: created(readFileSync(join(dir, "miro", "example.svg"), "utf8")) }));
  r = run(join(S, "pull.mjs"), [result], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(readFileSync(join(dir, "miro", "board.json"), "utf8")).frames.example.id);
  assert.equal(run(join(S, "build.mjs"), ["--published"], dir).status, 0);
  r = run(join(S, "build.mjs"), [], dir);
  assert.match(r.stdout, /example: 8 items, board up to date/);
});

test("loop: a card moved on the board survives the build and nothing else is resent", (t) => {
  const dir = project(t);
  run(join(S, "build.mjs"), [], dir);
  const svg = created(readFileSync(join(dir, "miro", "example.svg"), "utf8"));
  const result = join(dir, "miro", "create-example.json");
  writeFileSync(result, JSON.stringify({ svg }));
  run(join(S, "pull.mjs"), [result], dir);
  run(join(S, "build.mjs"), ["--published"], dir);
  // A read after someone dragged the store card 40px right in Miro.
  const read = join(dir, "miro", "read.svg");
  writeFileSync(read, svg.replace(/(<rect id="example-r-store"[^>]*?) x="(\d+)"/, (m, head, x) => `${head} x="${Number(x) + 40}"`));
  assert.equal(run(join(S, "pull.mjs"), [read], dir).status, 0);
  const r = run(join(S, "build.mjs"), [], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /example: 1 of 8 items to publish/);
  assert.match(readFileSync(join(dir, "miro", "example.update.svg"), "utf8"), /data-miro-id="\d+" x="\d+"/);
});

test("loop: the build writes nothing while the lint finds a collision", (t) => {
  const dir = project(t);
  writeFileSync(join(dir, "src", "gen-example.mjs"), `export default ({ createScene }) => {
  const s = createScene();
  s.card("a", 60, 60, 300, 100, { color: "blue", title: "One", body: ["first"] });
  s.card("b", 200, 90, 300, 100, { color: "blue", title: "Two", body: ["second"] });
  return s;
};\n`);
  const r = run(join(S, "build.mjs"), [], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /card_card/);
  assert.match(r.stderr, /nothing written/);
  assert.ok(!existsSync(join(dir, "miro", "example.svg")));
});

// Without a height the canvas tool guesses one and Miro centres the text in it (a 40px
// title landed 33px low on a live board); sent at Miro's own 1.143 fs per line, it lands
// at its y, where the lint measures it.
test("scene: a loose text goes out with Miro's text height, 1.143 fs per line", () => {
  const s = createScene();
  s.text("t", 40, 40, "Title\nSecond line", { size: 40 });
  const item = sceneItems(s.elements(), "v").find((i) => i.tag === "textArea");
  assert.equal(item.attrs.height, Math.round(2 * 1.143 * 40));
});

// A project whose config lists the given views, each with its own generator source.
const projectWith = (t, views) => {
  const dir = project(t);
  const list = views.map(({ key, src, ...v }) => {
    writeFileSync(join(dir, "src", `gen-${key}.mjs`), src);
    return { key, title: key, gen: `./src/gen-${key}.mjs`, ...v };
  });
  writeFileSync(join(dir, "miro.config.mjs"), `export default ${JSON.stringify({ board: BOARD, views: list })};\n`);
  return dir;
};
const collide = `export default ({ createScene }) => {
  const s = createScene();
  s.card("a", 60, 60, 300, 100, { color: "blue", title: "One", body: ["first"] });
  s.card("b", 200, 90, 300, 100, { color: "blue", title: "Two", body: ["second"] });
  return s;
};\n`;
// A perpendicular connector whose one-corner route runs through the card between: a
// finding on a route the predictor is known to miss, so estimated.
const detour = `export default ({ createScene }) => {
  const s = createScene();
  s.card("a", 60, 60, 240, 100, { color: "blue", title: "One", body: ["first"] });
  s.card("c", 400, 70, 160, 80, { color: "blue", title: "Two", body: ["second"] });
  s.card("b", 700, 400, 240, 100, { color: "blue", title: "Three", body: ["third"] });
  s.arrow("x", "a", "b", [s.R(s.nodes.a), s.T(s.nodes.b)]);
  return s;
};\n`;

test("loop: an off-board view is linted too, and its finding blocks the build", (t) => {
  const dir = projectWith(t, [{ key: "slide", src: collide, offBoard: true }]);
  const r = run(join(S, "build.mjs"), [], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /card_card/);
  assert.ok(!existsSync(join(dir, "miro", "slide.svg")));
});

test("loop: an estimated finding warns, and blocks once the view is strict", (t) => {
  let dir = projectWith(t, [{ key: "detour", src: detour }]);
  let r = run(join(S, "build.mjs"), [], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /legibility warnings[\s\S]*line_card \(est\)/);
  dir = projectWith(t, [{ key: "detour", src: detour, strict: true }]);
  r = run(join(S, "build.mjs"), [], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /line_card \(est\)/);
  assert.match(r.stderr, /nothing written/);
});

test("live: prepare stages the dump script inside the project; check needs a dump", (t) => {
  const dir = realpathSync(project(t));
  const r = run(join(S, "live.mjs"), ["prepare"], dir);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.board, BOARD);
  // Both paths sit inside the project, which is all the browser server may read or write.
  const inside = (p) => realpathSync.native(join(p, "..")).startsWith(realpathSync.native(dir));
  assert.ok(existsSync(out.sourcePath) && inside(out.sourcePath));
  assert.ok(inside(out.filePath));
  assert.equal(run(join(S, "live.mjs"), ["check"], dir).status, 2);
});


test("live: a faked dump of what Miro drew is linted, so a clean board passes and an overlap fails", (t) => {
  const dir = project(t);
  writeFileSync(join(dir, "miro", "board.json"), JSON.stringify({ url: BOARD, frames: { example: { id: "F" } }, ids: {} }));
  const check = (cards) => {
    writeFileSync(join(dir, "miro", "live-dump.json"), JSON.stringify(dump(cards, [])));
    return run(join(S, "live.mjs"), ["check", "--frames", "example", "--verbose"], dir);
  };
  const clean = check({ a: [100, 100, 200, 80], b: [400, 100, 200, 80] });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /live board legible: no findings/);
  const overlap = check({ a: [100, 100, 200, 80], b: [250, 120, 200, 80] });
  assert.equal(overlap.status, 1);
  assert.match(overlap.stdout, /card_card/);
  assert.match(overlap.stdout, /1 legibility finding\(s\) on the live board/);
});

test("init: a board URL that is not Miro's is refused, and an existing config is never overwritten", (t) => {
  const root = tempDir(t, "miro-init-");
  const bad = run(join(S, "init.mjs"), ["diagrams", "--board", "https://example.invalid/board/x"], root);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /not a Miro board URL/);
  assert.ok(!existsSync(join(root, "diagrams")));
  assert.equal(run(join(S, "init.mjs"), ["diagrams", "--board", BOARD], root).status, 0);
  const again = run(join(S, "init.mjs"), ["diagrams", "--board", BOARD], root);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /exists; edit it instead/);
});

test("init: what lands in the repo is the board's URL and nothing that grants access", (t) => {
  const dir = project(t);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "miro", "board.json"), "utf8")), { url: BOARD, frames: {}, ids: {} });
  assert.deepEqual(readFileSync(join(dir, ".gitignore"), "utf8").trim().split("\n"), ["miro/live-dump.json", "miro/board-dump.js"]);
});

// ── the plugin as a whole ───────────────────────────────────────────────────
const sources = readdirSync(PLUGIN, { recursive: true }).map(String).filter((f) => /\.(mjs|js)$/.test(f)).sort();

test("scripts end by setting process.exitCode, never process.exit", () => {
  // An exit while stdout or stderr is still draining into a pipe can cut the output
  // short, so a refusal reads as a crash.
  assert.ok(sources.length > 15, "the walk found the plugin's scripts");
  assert.deepEqual(sources.filter((f) => /process\.exit\(/.test(readFileSync(join(PLUGIN, f), "utf8"))), []);
});

test("the plugin ships Node only, and no script names a token, a password, or a cookie", () => {
  const all = readdirSync(PLUGIN, { recursive: true }).map(String);
  assert.deepEqual(all.filter((f) => /\.(py|sh|bash|zsh|ps1)$/.test(f)), []);
  for (const f of sources.filter((x) => !x.endsWith("critical-context.mjs"))) {
    const text = readFileSync(join(PLUGIN, f), "utf8");
    assert.doesNotMatch(text, /\b[A-Z_]*(TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z_]*\b/, `${f} reads a credential from the environment`);
    assert.doesNotMatch(text, /document\.cookie|localStorage|sessionStorage|Authorization/i, `${f} reaches for a session`);
  }
});

// ── browser setup ───────────────────────────────────────────────────────────
const setupEnv = (dir, extra = {}) => ({ ...process.env, MARVELOUS_MIRO_CHROME: join(dir, "no-chrome"), MARVELOUS_MIRO_DESKTOP_CONFIG: join(dir, "claude_desktop_config.json"), ...extra });

test("setup: the report names a missing Chrome, and is quiet about one that is there", (t) => {
  const dir = tempDir(t, "miro-setup-");
  const missing = report({ root: dir, env: setupEnv(dir) });
  assert.equal(missing.ok, false);
  assert.equal(missing.chrome, null);
  assert.ok(missing.fixes.some((f) => f.startsWith("Google Chrome is not installed:")), missing.fixes.join(" | "));
  const found = report({ root: dir, env: setupEnv(dir, { MARVELOUS_MIRO_CHROME: process.execPath }) });
  assert.equal(found.chrome, process.execPath);
  assert.ok(!found.fixes.some((f) => f.includes("Chrome is not installed")));
});

test("setup: a Miro project is one with a config at the root or in diagrams/", (t) => {
  const bare = tempDir(t, "miro-setup-");
  assert.equal(report({ root: bare, env: setupEnv(bare) }).project, null);
  const nested = project(t);
  assert.equal(report({ root: join(nested, ".."), env: setupEnv(bare) }).project, join(nested, "miro.config.mjs"));
  assert.equal(report({ root: nested, env: setupEnv(bare) }).project, join(nested, "miro.config.mjs"));
});

test("setup: the CLI prints the report as JSON and exits 1 while the browser server cannot start", (t) => {
  const dir = tempDir(t, "miro-setup-");
  const r = run(setup, [], dir, setupEnv(dir));
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.profile.path, PROFILE);
});

test("setup: writing Claude Desktop's config keeps its other servers and a backup", (t) => {
  const dir = tempDir(t, "miro-desktop-");
  const cfg = join(dir, "claude_desktop_config.json");
  writeFileSync(cfg, JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" }));
  const shown = run(setup, ["--desktop"], dir, setupEnv(dir));
  assert.equal(shown.status, 0, shown.stderr);
  assert.deepEqual(JSON.parse(readFileSync(cfg, "utf8")).mcpServers, { other: { command: "x" } }, "printing the entry writes nothing");
  const r = run(setup, ["--desktop", "--write"], dir, setupEnv(dir));
  assert.equal(r.status, 0, r.stderr);
  const after = JSON.parse(readFileSync(cfg, "utf8"));
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.mcpServers.other, { command: "x" });
  assert.ok(after.mcpServers["miro-browser"].args.some((a) => a.startsWith("chrome-devtools-mcp@")));
  assert.ok(existsSync(`${cfg}.bak`));
});

test("setup: a Desktop config that does not parse is left alone", (t) => {
  const dir = tempDir(t, "miro-desktop-");
  const cfg = join(dir, "claude_desktop_config.json");
  writeFileSync(cfg, "{ not json");
  const r = run(setup, ["--desktop", "--write"], dir, setupEnv(dir));
  assert.equal(r.status, 1);
  assert.equal(readFileSync(cfg, "utf8"), "{ not json");
});

test("the browser server is one pinned package with a profile of its own, and .mcp.json starts it", () => {
  assert.match(PACKAGE, /^chrome-devtools-mcp@\d+\.\d+\.\d+$/);
  assert.ok(ARGS.includes(PACKAGE) && ARGS.includes(`--userDataDir=${PROFILE}`) && ARGS.includes("--no-usage-statistics"));
  assert.ok(PROFILE.startsWith(os.homedir()) && PROFILE.includes("marvelous-miro"));
  const servers = JSON.parse(readFileSync(join(PLUGIN, ".mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(Object.keys(servers), ["miro-browser"]);
  const [script] = servers["miro-browser"].args;
  assert.equal(servers["miro-browser"].command, "node");
  assert.ok(existsSync(join(PLUGIN, script.replace("${CLAUDE_PLUGIN_ROOT}/", ""))), script);
});
