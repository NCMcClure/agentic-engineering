// perceptual-loop's sweep, on known answers: a ramp with one pop is flagged at
// the frame it lands on, at the ratio the steps give; a still region holds;
// a wobble has flicker; constant speed has no judder and a repeated frame is
// named, from positions and from pixels; and the plot fits its width.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PL, runNode, squareFrame, tempDir } from "./perceptual-loop-fixtures.mjs";

import { decodePng, encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
import * as sweep from "../../../plugins/perceptual-loop/scripts/commands/sweep.mjs";
const ENV = { PL_DIR: "", PL_SHOTS_DIR: "" };

const pl = (dir, args) => runNode(PL, args, { cwd: dir, env: ENV });
const json = (r) => { assert.equal(r.stderr.includes("internal error"), false, r.stderr); return JSON.parse(r.stdout); };
const name = (i) => `${String(i).padStart(6, "0")}.png`;

/** 40 frames: the top half dims up 2 levels a frame, with one pop of 20 levels landing on frame 17; the bottom half holds at 60. */
function ramp(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 40; i++) {
    const w = 64, h = 48, data = new Uint8Array(w * h * 3).fill(60), v = 30 + 2 * i + (i >= 17 ? 20 : 0);
    data.fill(v, 0, w * 24 * 3);
    fs.writeFileSync(path.join(dir, name(i)), encodePng({ width: w, height: h, channels: 3, data }));
  }
  return dir;
}

test("a jump is a step against the local median step; flicker is the RMS of the second difference", () => {
  const v = Array.from({ length: 40 }, (_, i) => 2 * i + (i >= 17 ? 20 : 0));
  const st = sweep.analyseSeries(v, v.map((_, i) => i), { floor: 1e-9 });
  assert.equal(st.worstJump.frame, 17);
  assert.equal(st.worstJump.ratio, 11);
  assert.equal(st.worstJump.localMedianStep, 2);
  assert.deepEqual(st.flagged, [17]);
  assert.equal(st.maxStep.step, 22);
  const straight = sweep.analyseSeries(v.map((_, i) => 3 * i), v.map((_, i) => i), { floor: 1e-9 });
  assert.equal(straight.flicker, 0, "a straight ramp has no flicker");
  assert.deepEqual(straight.flagged, [], "and a fast change is allowed to be fast");
  assert.match(sweep.analyseSeries([1, 2], [0, 1]).note, /fewer than 3/);
});

test("judder: 0 at constant speed, a repeated frame and a dropped one are named", () => {
  const even = Array.from({ length: 40 }, (_, i) => [3 * i, 1.5 * i]), frames = even.map((_, i) => i);
  assert.ok(sweep.judder(even, frames).judder < 1e-9);
  const dup = [...even.slice(0, 12), even[11], ...even.slice(12, 39)];
  const d = sweep.judder(dup, frames);
  assert.deepEqual(d.repeated, [12]);
  assert.ok(d.judder > 0.1);
  const skip = [...even.slice(0, 20), ...even.slice(21), [3 * 40, 1.5 * 40]];
  assert.deepEqual(sweep.judder(skip, frames).dropped, [20]);
});

test("a table reads as CSV with or without a header, or as JSONL with arrays spread into columns", () => {
  const tmp = tempDir("pl-sweep-");
  const csv = path.join(tmp, "a.csv"), bare = path.join(tmp, "b.csv"), jl = path.join(tmp, "c.jsonl");
  fs.writeFileSync(csv, "t,exposure,label\n0,1.5,x\n1,1.25,y\n");
  fs.writeFileSync(bare, "0,1.5\n1,1.25\n");
  fs.writeFileSync(jl, '{"pos":[1,2],"v":3}\n{"pos":[4,5],"v":6}\n');
  assert.deepEqual(sweep.readTable(csv), { t: [0, 1], exposure: [1.5, 1.25] }, "a column with no number is dropped");
  assert.deepEqual(sweep.readTable(bare), { c0: [0, 1], c1: [1.5, 1.25] });
  assert.deepEqual(sweep.readTable(jl), { "pos.0": [1, 4], "pos.1": [2, 5], v: [3, 6] });
});

test("sweep of a ramp with a pop: flagged at frame 17 at about 11x the local step, the still region holds, the gate fails", () => {
  const tmp = tempDir("pl-sweep-"), frames = ramp(path.join(tmp, "ramp")), out = ["--out", path.join(tmp, "out")];
  const base = [frames, "--region", "top=0,0,1,0.5", "--region", "bottom=0,0.5,1,1"];
  const r = pl(tmp, ["sweep", ...base, "--expect", "top.luma=rising", "--expect", "bottom.*=steady", "--max-ratio", "6", ...out, "--json"]);
  const d = json(r);
  const top = d.series["top.luma"];
  assert.equal(top.worstJump.frame, 17);
  assert.ok(top.worstJump.ratio > 9 && top.worstJump.ratio < 13, `ratio ${top.worstJump.ratio}`);
  assert.deepEqual(top.flagged, [17]);
  assert.deepEqual(d.series["bottom.luma"].flagged, [], "the still region is not flagged");
  assert.equal(d.series["bottom.luma"].expect.ok, true, "and holds steady");
  assert.equal(top.expect.ok, true, "the rising one rises");
  assert.equal(r.status, 1, "--max-ratio 6 fails the gate");
  assert.ok(d.gate.failed.some((f) => /jump at frame 17/.test(f)), d.gate.failed.join("; "));
  const plot = decodePng(fs.readFileSync(d.plot));
  assert.ok(plot.width <= 1568, `${plot.width} px wide`);
  assert.equal(JSON.parse(fs.readFileSync(d.report, "utf8")).values["top.luma"].length, 40);

  const still = pl(tmp, ["sweep", ...base, "--series", "bottom.*", "--max-ratio", "6", "--max-step", "0.01", ...out, "--json"]);
  assert.equal(still.status, 0, "gating only the still region passes");
  assert.deepEqual(Object.keys(json(still).series).sort(), ["bottom.b", "bottom.g", "bottom.luma", "bottom.r"]);
  const falling = pl(tmp, ["sweep", ...base, "--series", "top.luma", "--expect", "falling", ...out, "--json"]);
  assert.equal(falling.status, 1);
  assert.match(json(falling).gate.failed[0], /expected falling: 39 of 39 steps go the other way/);
});

test("sweep of values: a wobbling column has far more flicker than a smooth one", () => {
  const tmp = tempDir("pl-sweep-"), file = path.join(tmp, "v.csv");
  const rows = ["t,smooth,wobble", ...Array.from({ length: 60 }, (_, i) => `${i},${Math.sin(i / 8).toFixed(6)},${(Math.sin(i / 8) + (i % 2 ? 0.05 : -0.05)).toFixed(6)}`)];
  fs.writeFileSync(file, rows.join("\n"));
  const d = json(pl(tmp, ["sweep", "--values", file, "--columns", "smooth,wobble", "--out", path.join(tmp, "out"), "--json"]));
  assert.ok(d.series.wobble.flicker > 10 * d.series.smooth.flicker, `smooth ${d.series.smooth.flicker}, wobble ${d.series.wobble.flicker}`);
});

test("sweep of positions and of pixels: judder 0 at constant speed, a repeated frame found and gated", () => {
  const tmp = tempDir("pl-sweep-"), out = ["--out", path.join(tmp, "out")];
  const even = Array.from({ length: 40 }, (_, i) => ({ x: 3 * i, y: 1.5 * i }));
  const dup = [...even.slice(0, 12), even[11], ...even.slice(12, 39)];
  for (const [n, pts] of [["even", even], ["dup", dup]]) fs.writeFileSync(path.join(tmp, `${n}.jsonl`), pts.map((p) => JSON.stringify(p)).join("\n"));
  const a = pl(tmp, ["sweep", "--positions", path.join(tmp, "even.jsonl"), "--max-judder", "0.05", ...out, "--json"]);
  assert.equal(a.status, 0);
  assert.ok(json(a).motion.judder < 1e-9);
  const b = pl(tmp, ["sweep", "--positions", path.join(tmp, "dup.jsonl"), "--max-judder", "0.05", ...out, "--json"]);
  assert.equal(b.status, 1);
  assert.deepEqual(json(b).motion.repeated, [12]);

  // from pixels: a square moving at constant speed, with frame 8 a copy of frame 7
  const sq = path.join(tmp, "sq");
  fs.mkdirSync(sq);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(sq, name(i)), encodePng(squareFrame(i === 8 ? 7 : i, { ramp: false })));
  const t = json(pl(tmp, ["sweep", sq, "--track", ...out, "--json"]));
  assert.deepEqual(t.motion.repeated, [8]);
  assert.deepEqual(t.identicalFrames, [8]);
  const smooth = path.join(tmp, "smooth");
  fs.mkdirSync(smooth);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(smooth, name(i)), encodePng(squareFrame(i, { ramp: false })));
  const s = json(pl(tmp, ["sweep", smooth, "--track", ...out, "--json"]));
  assert.ok(s.motion.judder < 0.05, `judder ${s.motion.judder} of a square at constant speed`);
  assert.deepEqual(s.motion.repeated, []);
});

test("sweep refuses what it cannot do with exit 2", () => {
  const tmp = tempDir("pl-sweep-");
  for (const [args, rx] of [[[], /give a clip/], [["--values", "nope.csv"], /no such file/], [["--positions", "x", "--track"], /--track reads the motion from a clip/]]) {
    const r = pl(tmp, ["sweep", ...args]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, rx);
  }
});
