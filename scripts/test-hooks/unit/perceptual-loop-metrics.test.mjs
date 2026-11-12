// perceptual-loop's metrics: CIEDE2000 against Sharma's published pairs, and known
// answers on closed-form pictures (an exposure or white-balance change is
// recovered, an edge shift inside the tolerance still matches, a blur loses
// detail, a flatter picture loses contrast, an id pass gives its areas).
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { box, boxBlur, idPass, scene, u8 } from "./perceptual-loop-fixtures.mjs";

import { ciede2000 } from "../../../plugins/perceptual-loop/scripts/lib/color.mjs";
import { analyse, regionsFromId, regionsFromBoxes, regionsFromMask, regionMetrics, pyRound, percentile, median } from "../../../plugins/perceptual-loop/scripts/lib/metrics.mjs";

// Sharma, Wu and Dalal (2005), table 1: the 34 pairs and their published differences.
const SHARMA = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425], [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412], [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
  [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0], [[50, -0.9009, -85.5211], [50, 0, -82.7485], 1.0],
  [[50, 0, 0], [50, -1, 2], 2.3669], [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792], [[50, 2.49, -0.001], [50, -2.49, 0.001], 7.1792],
  [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195], [[50, 2.49, -0.001], [50, -2.49, 0.0012], 7.2195],
  [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045], [[50, -0.001, 2.49], [50, 0.001, -2.49], 4.8045],
  [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461], [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
  [[50, 2.5, 0], [73, 25, -18], 27.1492], [[50, 2.5, 0], [61, -5, 29], 22.8977],
  [[50, 2.5, 0], [56, -27, -3], 31.903], [[50, 2.5, 0], [58, 24, 15], 19.4535],
  [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0], [[50, 2.5, 0], [50, 3.2972, 0], 1.0],
  [[50, 2.5, 0], [50, 1.8634, 0.5757], 1.0], [[50, 2.5, 0], [50, 3.2592, 0.335], 1.0],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644], [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
  [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731], [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373], [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
  [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441], [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377], [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
];

test("CIEDE2000 matches all 34 of Sharma's published pairs to 1e-4, in both orders", () => {
  assert.equal(SHARMA.length, 34);
  SHARMA.forEach(([p, q, want], i) => {
    assert.ok(Math.abs(ciede2000(...p, ...q) - want) < 1e-4, `pair ${i + 1}: ${ciede2000(...p, ...q)} vs ${want}`);
    assert.ok(Math.abs(ciede2000(...q, ...p) - want) < 1e-4, `pair ${i + 1} reversed`);
  });
});

test("Python semantics: half-even rounding, numpy's linear percentile and median", () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, -2.5, 2.4, 2.6, 1.25].map(pyRound), [0, 2, 2, 4, -2, 2, 3, 1]);
  assert.ok(Math.abs(percentile([1, 2, 3, 4], 5) - 1.15) < 1e-12);
  assert.ok(Math.abs(percentile([1, 2, 3, 4], 95) - 3.85) < 1e-12);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

const ref = u8(scene());

test("identical pictures give the ideal value of every metric", () => {
  const f = analyse(ref, ref).frame;
  assert.deepEqual(
    { ssim: f.ssim, deltaE: f.deltaE, deltaENorm: f.deltaENorm, edgeF1: f.edgeF1, exposureEV: f.exposureEV, detailLog2: f.detailLog2, contrast: f.contrast, wb: f.wb },
    { ssim: 1, deltaE: 0, deltaENorm: 0, edgeF1: 1, exposureEV: 0, detailLog2: 0, contrast: 1, wb: [1, 1, 1] },
  );
  assert.deepEqual(Object.keys(f), ["ssim", "deltaE", "deltaENorm", "exposureEV", "wb", "contrast", "edgeF1", "edgeRecall", "edgePrecision", "detailLog2"]);
});

test("+0.5 EV is recovered, and normalisation takes it out of colour, edges, and detail", () => {
  const f = analyse(ref, u8(scene(), (c, v) => v * 2 ** 0.5)).frame;
  assert.ok(Math.abs(f.exposureEV - 0.5) < 0.03, `EV ${f.exposureEV}`);
  assert.ok(f.deltaENorm < 0.5 && f.deltaE > 0.5, `deltaE ${f.deltaE}, normalised ${f.deltaENorm}`);
  assert.ok(f.edgeF1 > 0.97 && Math.abs(f.detailLog2) < 0.05, `edgeF1 ${f.edgeF1}, detail ${f.detailLog2}`);
});

test("a white-balance shift of [1.1, 1, 0.9] is recovered", () => {
  const f = analyse(ref, u8(scene(), (c, v) => v * [1.1, 1.0, 0.9][c])).frame;
  f.wb.forEach((g, i) => assert.ok(Math.abs(g - [1.1, 1, 0.9][i]) < 0.02, `wb ${f.wb}`));
  assert.ok(f.deltaENorm < 0.5, `normalised deltaE ${f.deltaENorm}`);
});

test("an edge moved 1 px still matches; moved 12 px it does not", () => {
  const near = analyse(u8(box(100)), u8(box(101))).frame;
  const far = analyse(u8(box(100)), u8(box(112))).frame;
  assert.ok(near.edgeF1 > 0.98, `1 px: ${near.edgeF1}`);
  assert.ok(far.edgeF1 < 0.75, `12 px: ${far.edgeF1}`);
});

test("a blurred copy has less detail, and a flatter copy less contrast", () => {
  const blurred = analyse(ref, boxBlur(ref, 2)).frame;
  assert.ok(blurred.detailLog2 < -1 && blurred.ssim < 1, `detail ${blurred.detailLog2}`);
  const flat = analyse(ref, u8(scene(), (c, v) => 0.18 + (v - 0.18) * 0.7)).frame;
  assert.ok(flat.contrast < 0.95, `contrast ${flat.contrast}`);
});

test("an id pass gives one region per flat colour above the area floor, in packed-colour order", () => {
  const regions = regionsFromId(idPass(), { left: [255, 0, 0] }, 0.002);
  assert.deepEqual(regions.map((r) => r.name), ["id_0000FF", "left"]);
  const area = (r) => r.mask.reduce((s, v) => s + v, 0) / r.mask.length;
  assert.ok(Math.abs(area(regions[1]) - 0.3) < 1e-3 && Math.abs(area(regions[0]) - 0.7) < 1e-3);
});

test("mask and box regions, and a region the change never touched", () => {
  const mask = { width: 4, height: 2, channels: 1, data: Uint8Array.from([0, 255, 128, 127, 0, 0, 200, 0]) };
  const [subject, background] = regionsFromMask(mask);
  assert.deepEqual([...subject.mask], [0, 1, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...background.mask], [1, 0, 0, 1, 1, 1, 0, 1]);
  const [b] = regionsFromBoxes({ "top.left/x": [0, 0, 0.5, 0.5] }, 4, 2);
  assert.equal(b.name, "top_left_x");
  assert.deepEqual([...b.mask], [1, 1, 0, 0, 0, 0, 0, 0]);

  const an = analyse(u8(box(100)), u8(box(112)));
  const left = new Uint8Array(320 * 240);
  for (let y = 0; y < 240; y++) for (let x = 0; x < 50; x++) left[y * 320 + x] = 1;
  const m = regionMetrics(left, an.maps);
  assert.equal(m.edgeF1, 1);
  assert.ok(m.ssim > 0.999, `ssim ${m.ssim}`);
});
