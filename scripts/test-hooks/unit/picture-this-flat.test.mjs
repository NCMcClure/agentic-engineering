// picture-this's flat space: where things are before anything is drawn. The
// flat shapes (a connector, an axis, a grid of cells) are laid out with these
// numbers, and a figure asks the same functions where to put what it adds. Imported as TypeScript, so what is tested is what ships.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { REPO } from "./helpers.mjs";

const KIT = path.join(REPO, "plugins", "agentic-engineering", "skills", "picture-this", "kit");
const skip = process.features.typescript ? false : "this Node cannot import TypeScript";
const G = skip ? null : await import(new URL(`file://${path.join(KIT, "flat", "geometry.ts").split(path.sep).join("/").replace(/^([A-Za-z]:)/, "/$1")}`).href);
const box = { x: 100, y: 40, width: 200, height: 80 };

test("a point is found between two others, and a box has a middle", { skip }, () => {
  assert.deepEqual(G.between([0, 0], [100, 40], 0.25), [25, 10]);
  assert.deepEqual([G.between([10, 10], [20, 30], 0), G.between([10, 10], [20, 30], 1)], [[10, 10], [20, 30]]);
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

test("the flat geometry holds only what a figure has used: nothing for one subject's layout", { skip }, () => {
  assert.deepEqual(Object.keys(G).sort(), ["between", "cell", "elbow", "middle", "mix", "range", "slotIn", "spread", "tint"]);
});
