// picture-this's flat space: where things are before anything is drawn. The
// flat shapes (a window of rows, a connector, a grid of cells) are laid out
// with these numbers, and a figure asks the same functions where to anchor
// what it adds. Imported as TypeScript, so what is tested is what ships.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const KIT = path.join(REPO, "plugins", "picture-this", "kit");
const skip = process.features.typescript ? false : "this Node cannot import TypeScript";
const G = skip ? null : await import(new URL(`file://${path.join(KIT, "flat", "geometry.ts").split(path.sep).join("/").replace(/^([A-Za-z]:)/, "/$1")}`).href);
const box = { x: 100, y: 40, width: 200, height: 80 };

test("a box has anchors on its sides, and can be pulled in", { skip }, () => {
  assert.deepEqual([G.anchor(box, "left"), G.anchor(box, "right"), G.anchor(box, "top"), G.anchor(box, "bottom")], [[100, 80], [300, 80], [200, 40], [200, 120]]);
  assert.deepEqual(G.anchor(box, "right", 0.25), [300, 60]);
  assert.deepEqual(G.inset(box, 10), { x: 110, y: 50, width: 180, height: 60 });
  assert.deepEqual(G.inset(box, 60).height, 0, "never inside out");
  assert.deepEqual(G.middle(box), [200, 80]);
});

test("an elbow leaves along one axis, turns at right angles, and drops corners that are not corners", { skip }, () => {
  assert.deepEqual(G.elbow([0, 0], [100, 60]), [[0, 0], [50, 0], [50, 60], [100, 60]], "sideways, turning half-way");
  assert.deepEqual(G.elbow([0, 0], [100, 60], { via: 30 }), [[0, 0], [30, 0], [30, 60], [100, 60]]);
  assert.deepEqual(G.elbow([0, 0], [100, 60], { first: "v" }), [[0, 0], [0, 30], [100, 30], [100, 60]], "up and down first");
  assert.deepEqual(G.elbow([0, 0], [100, 60], { via: 100 }), [[0, 0], [100, 0], [100, 60]], "a turn at the far point's own x is one turn");
  assert.deepEqual(G.elbow([0, 20], [100, 20]), [[0, 20], [100, 20]], "two points already level are a straight line");
  assert.deepEqual(G.elbow([40, 0], [40, 90], { first: "v" }), [[40, 0], [40, 90]]);
  for (const route of [G.elbow([0, 0], [100, 60]), G.elbow([10, 80], [-40, 5], { first: "v", via: 50 })]) {
    for (let i = 1; i < route.length; i++) assert.ok(route[i][0] === route[i - 1][0] || route[i][1] === route[i - 1][1], "every leg runs along an axis");
  }
});

test("rows stack into a column, and a window over it says which show and how much of each", { skip }, () => {
  const slots = G.column([12, 12, 20, 12], 6);
  assert.deepEqual(slots, [{ y: 0, height: 12 }, { y: 18, height: 12 }, { y: 36, height: 20 }, { y: 62, height: 12 }]);
  assert.equal(G.columnHeight(slots), 74);
  assert.equal(G.columnHeight([]), 0);
  assert.deepEqual(G.column([10, 10], 0, 5).map((s) => s.y), [5, 15]);
  assert.deepEqual(G.windowed(slots, 0, 40), [
    { index: 0, y: 0, height: 12, shown: 1 }, { index: 1, y: 18, height: 12, shown: 1 }, { index: 2, y: 36, height: 20, shown: 0.2 },
  ], "the row crossing the bottom edge is a fifth in view");
  assert.deepEqual(G.windowed(slots, 24, 40).map((r) => [r.index, r.y, r.shown]), [[1, -6, 0.5], [2, 12, 1], [3, 38, 0.17]], "scrolled, the first row has left and the second is half gone");
  assert.deepEqual(G.windowed(slots, 500, 40), []);
  assert.equal(G.scrollTo(slots, 3, 40), 34, "the offset that puts the last row's bottom on the window's bottom");
  assert.equal(G.scrollTo(slots, 0, 40), -28, "a column shorter than its window has not scrolled yet");
  assert.equal(G.scrollTo(slots, 99, 40), 34, "past the end is the end");
});

test("a row's bar is found on the page, where a connector can leave from it", { skip }, () => {
  const slots = G.column([12, 12, 12], 6);
  assert.deepEqual(G.bar(box, slots[1]), { x: 100, y: 58, width: 200, height: 12 });
  assert.deepEqual(G.bar(box, slots[2], 10, { indent: 20, span: 0.5 }), { x: 120, y: 66, width: 90, height: 12 });
  assert.deepEqual(G.anchor(G.bar(box, slots[1]), "right"), [300, 64]);
});

test("a box is cut into cells, and square cells are laid from an origin", { skip }, () => {
  assert.deepEqual(G.slotIn(box, 4, 2, 0, 0), { x: 100, y: 40, width: 50, height: 40 });
  assert.deepEqual(G.slotIn(box, 4, 2, 3, 1), { x: 250, y: 80, width: 50, height: 40 });
  assert.deepEqual(G.cell(2, 1, 30, 2, [10, 10]), { x: 74, y: 42, width: 30, height: 30 });
  assert.deepEqual(G.spread(3, 0, 100), [0, 50, 100]);
  assert.deepEqual(G.spread(1, 0, 100), [50]);
  assert.deepEqual(G.spread(0, 0, 100), []);
});

test("a value becomes one of a few tints, and a colour is mixed from two tokens", { skip }, () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((v) => G.tint(v, 0, 4, 5)), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(G.tint(0.6, 0, 1, 3), 0.5, "rounded to the nearest step");
  assert.deepEqual([G.tint(-5, 0, 4), G.tint(9, 0, 4), G.tint(3, 3, 3)], [0, 1, 0], "held to its range, and a flat range is no tint");
  assert.deepEqual(G.range([[3, 1], [4, 1]]), { lo: 1, hi: 4 });
  assert.deepEqual(G.range([]), { lo: 0, hi: 0 });
  assert.equal(G.mix("var(--pt-accent)", "var(--pt-top)", 0.256), "color-mix(in oklab, var(--pt-accent) 26%, var(--pt-top))");
  assert.equal(G.mix("a", "b", 7), "color-mix(in oklab, a 100%, b)");
});
