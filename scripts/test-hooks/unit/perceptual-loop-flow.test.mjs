// perceptual-loop's optical flow on known answers: a textured square moving over
// a still textured ground. The flow recovers a shift to a fraction of a pixel,
// the direction is within 5 degrees, the still region holds, a speed against a
// reference comes out at its ratio, and a flat area is unknown, never still.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PL, flowFrame, runNode, tempDir, texture } from "./perceptual-loop-fixtures.mjs";

import { decodePng, encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
import { denseFlow, bilinear } from "../../../plugins/perceptual-loop/scripts/lib/flow.mjs";
import { angleBetween } from "../../../plugins/perceptual-loop/scripts/commands/flow.mjs";
const ENV = { PL_DIR: "", PL_SHOTS_DIR: "" };

const pl = (dir, args) => runNode(PL, args, { cwd: dir, env: ENV });
const json = (r) => { assert.equal(r.stderr.includes("internal error"), false, r.stderr); return JSON.parse(r.stdout); };

/** Eight frames of the square moving (dx, dy) a frame; `flat` makes the bottom 40 % one flat grey. */
function clip(dir, dx, dy, { flat = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 8; i++) {
    const img = flowFrame(i, dx, dy);
    if (flat) img.data.fill(80, 144 * 320 * 3);
    fs.writeFileSync(path.join(dir, `${String(i).padStart(6, "0")}.png`), encodePng(img));
  }
  return dir;
}

const REGIONS = ["--region", "top=0,0,1,0.5", "--region", "bottom=0,0.6,1,1"];

test("dense flow recovers a shift of a texture to a fraction of a pixel, and a flat picture has no confidence", () => {
  const w = 200, h = 150, t = texture(w, h, { seed: 5 });
  const a = Float32Array.from(t, (v) => v / 255);
  // b(x, y) = a(x - 3, y + 2): every point moves by (+3, -2)
  const b = new Float32Array(w * h).map((_, i) => bilinear(a, w, h, (i % w) - 3, Math.floor(i / w) + 2));
  const f = denseFlow(a, b, w, h);
  let su = 0, sv = 0, n = 0;
  for (let y = 20; y < h - 20; y++) for (let x = 20; x < w - 20; x++) { su += f.u[y * w + x]; sv += f.v[y * w + x]; n++; }
  assert.ok(Math.abs(su / n - 3) < 0.05 && Math.abs(sv / n + 2) < 0.05, `mean flow (${su / n}, ${sv / n})`);
  const flat = new Float32Array(w * h).fill(0.4);
  assert.ok(denseFlow(flat, flat, w, h).confidence.every((c) => c < 1e-12), "nothing to measure in a flat picture");
  assert.equal(angleBetween(350, 10), 20);
  assert.equal(angleBetween(90, 270), 180);
});

test("flow of a square moving right: direction within 5 degrees of 0, coherent, the still region holds", () => {
  const tmp = tempDir("pl-flow-"), right = clip(path.join(tmp, "right"), 5, 0), out = ["--out", path.join(tmp, "out")];
  const r = pl(tmp, ["flow", right, ...REGIONS, "--expect-direction", "0", "--expect-static", "bottom", "--expect-moving", "top", ...out, "--json"]);
  const d = json(r), s = d.summary;
  assert.equal(d.pairs, 7);
  assert.ok(angleBetween(s.frame.direction, 0) < 5, `direction ${s.frame.direction}`);
  assert.ok(s.frame.coherence > 0.9, `coherence ${s.frame.coherence}`);
  assert.ok(s.bottom.magMax < 0.3, `the still ground moves ${s.bottom.magMax} px a frame`);
  assert.ok(s.bottom.still > 0.95, `still share ${s.bottom.still}`);
  assert.equal(r.status, 0, d.gate.failed.join("; "));
  const sheet = decodePng(fs.readFileSync(d.sheet));
  assert.ok(sheet.width <= 1568, `${sheet.width} px wide`);
  assert.equal(JSON.parse(fs.readFileSync(d.report, "utf8")).perPair.top.length, 7);

  const wrong = pl(tmp, ["flow", right, ...REGIONS, "--expect-static", "top", ...out, "--json"]);
  assert.equal(wrong.status, 1, "expecting the moving region to be static fails");
});

test("flow of a square moving down: direction within 5 degrees of 90 (+y is down), and expecting 0 fails", () => {
  const tmp = tempDir("pl-flow-"), down = clip(path.join(tmp, "down"), 0, 5);
  const r = pl(tmp, ["flow", down, ...REGIONS, "--expect-direction", "0", "--out", path.join(tmp, "out"), "--json"]);
  const d = json(r);
  assert.ok(angleBetween(d.summary.frame.direction, 90) < 5, `direction ${d.summary.frame.direction}`);
  assert.equal(r.status, 1);
  assert.match(d.gate.failed[0], /deg from the expected 0/);
});

test("flow against a reference: the speed ratio of a slower clip is between 0.3 and 0.5, a turned one is about 90 degrees off", () => {
  const tmp = tempDir("pl-flow-"), out = ["--out", path.join(tmp, "out")];
  const right = clip(path.join(tmp, "right"), 5, 0), slow = clip(path.join(tmp, "slow"), 2, 0), down = clip(path.join(tmp, "down"), 0, 5);
  const a = json(pl(tmp, ["flow", slow, "--ref", right, ...REGIONS, ...out, "--json"])).against.regions.top;
  assert.ok(a.angularError < 5, `angular error ${a.angularError}`);
  assert.ok(a.speedRatio > 0.3 && a.speedRatio < 0.5, `speed ratio ${a.speedRatio}`);
  // what moves, moves 5 px a frame; the window's halo of slower pixels round the square pulls the mean under that
  const speed = json(pl(tmp, ["flow", right, ...REGIONS, ...out, "--json"])).summary.top.speed;
  assert.ok(speed > 3.5 && speed < 5.5, `speed ${speed}`);
  const r = pl(tmp, ["flow", down, "--ref", right, ...REGIONS, "--max-angle-error", "20", ...out, "--json"]);
  const t = json(r).against.regions.top;
  assert.ok(t.angularError > 80 && t.angularError < 100, `angular error ${t.angularError}`);
  assert.equal(r.status, 1);
});

test("a flat region is unknown, never still: its share says so and an expectation of static fails", () => {
  const tmp = tempDir("pl-flow-"), flat = clip(path.join(tmp, "flat"), 5, 0, { flat: true });
  const r = pl(tmp, ["flow", flat, ...REGIONS, "--expect-static", "bottom", "--out", path.join(tmp, "out"), "--json"]);
  const d = json(r), b = d.summary.bottom;
  assert.ok(b.unknown > 0.8, `unknown share ${b.unknown}`);
  assert.ok(b.still < 0.2, `still share ${b.still}`);
  assert.ok(Math.abs(b.moving + b.still + b.unknown - 1) < 1e-3, "the three shares cover the region");
  assert.equal(r.status, 1);
  assert.match(d.gate.failed[0], /can be measured .*unknown/);
});
