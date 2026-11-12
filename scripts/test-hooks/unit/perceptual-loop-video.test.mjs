// perceptual-loop's clips: a folder of frames and a video file read as one frame
// source, the area reduction, box SSIM and PSNR, and the video command on
// synthetic clips (contact, burst, compare with a damaged frame and an offset).
// The ffmpeg cases encode a clip in the test and skip when ffmpeg is missing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PL, runNode, squareFrame, tempDir } from "./perceptual-loop-fixtures.mjs";

import { decodePng, encodePng } from "../../../plugins/perceptual-loop/scripts/lib/png.mjs";
import { resize } from "../../../plugins/perceptual-loop/scripts/lib/image.mjs";
import { boxSsimPsnr, PSNR_CAP } from "../../../plugins/perceptual-loop/scripts/lib/metrics.mjs";
import * as seqLib from "../../../plugins/perceptual-loop/scripts/lib/sequence.mjs";
import { rawFrames, selectFilter } from "../../../plugins/perceptual-loop/scripts/lib/ffmpeg.mjs";
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const ENV = { PL_DIR: "", PL_SHOTS_DIR: "", PL_FFMPEG: "", PL_FFPROBE: "" };

const pl = (dir, args, env = {}) => runNode(PL, args, { cwd: dir, env: { ...ENV, ...env } });
const json = (r) => { assert.equal(r.stderr.includes("internal error"), false, r.stderr); return JSON.parse(r.stdout); };

/** Frames k = start .. start + n - 1 of the square clip, as <dir>/<i>.png numbered from 0. */
function clip(dir, { n = 24, start = 0, ...opts } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, `${String(i).padStart(6, "0")}.png`), encodePng(squareFrame(start + i, opts)));
  return dir;
}

// ---- the pieces ------------------------------------------------------------------------------

test("the area reduction is the mean of each output pixel's footprint", () => {
  const img = { width: 4, height: 2, channels: 1, data: Uint8Array.from([0, 100, 200, 50, 10, 110, 210, 60]) };
  assert.deepEqual([...resize(img, 2, 1, { area: true }).data], [55, 130]);
  // a footprint of one and a half pixels takes half of the pixel it shares
  const row = { width: 3, height: 1, channels: 1, data: Uint8Array.from([0, 90, 180]) };
  assert.deepEqual([...resize(row, 2, 1, { area: true }).data], [30, 150]);
  assert.deepEqual(seqLib.fitSize(1920, 1080, 480), [480, 270]);
  assert.deepEqual(seqLib.fitSize(320, 240, 480), [320, 240], "never enlarged");
});

test("box SSIM is 1 and PSNR the cap for identical frames; PSNR follows the squared error", () => {
  const w = 40, h = 30, a = new Float32Array(w * h).map((_, i) => ((i * 37) % 101) / 100);
  const same = boxSsimPsnr(a, a, w, h);
  assert.ok(Math.abs(same.ssim - 1) < 1e-12);
  assert.equal(same.psnr, PSNR_CAP);
  const b = a.map((v) => v + 0.1);
  assert.ok(Math.abs(boxSsimPsnr(a, b, w, h).psnr - 20) < 1e-4, "an offset of 0.1 is 20 dB");
  const scrambled = a.map((_, i) => a[(i * 7919) % a.length]);
  assert.ok(boxSsimPsnr(a, scrambled, w, h).ssim < 0.3, "structure that does not match scores low");
});

test("a folder is one frame source: numbered files keep their numbers, every/first/last/at pick, times come from the rate", async () => {
  const dir = tempDir("pl-seq-");
  for (const n of [0, 6, 12, 18]) fs.writeFileSync(path.join(dir, `${String(n).padStart(6, "0")}.png`), encodePng(squareFrame(n)));
  const seq = seqLib.openSequence(dir, { rate: 12 });
  assert.equal(seq.kind, "frames");
  assert.deepEqual([seq.total, seq.width, seq.height], [4, 160, 120]);
  const all = await seqLib.collect(seq, {});
  assert.deepEqual(all.map((f) => f.index), [0, 6, 12, 18]);
  assert.deepEqual(all.map((f) => f.t), [0, 0.5, 1, 1.5]);
  assert.deepEqual((await seqLib.collect(seq, { every: 2 })).map((f) => f.index), [0, 12]);
  assert.deepEqual((await seqLib.collect(seq, { first: 6, last: 12 })).map((f) => f.index), [6, 12]);
  assert.deepEqual((await seqLib.collect(seq, { at: [18, 6] })).map((f) => f.index), [6, 18]);
  const small = await seqLib.collect(seq, { size: 80 });
  assert.deepEqual([small[0].img.width, small[0].img.height], [80, 60]);
  // names that are not all numbers: the position in name order
  const named = tempDir("pl-seq-");
  for (const n of ["b", "a", "c"]) fs.writeFileSync(path.join(named, `${n}.png`), encodePng(squareFrame(0)));
  assert.deepEqual((await seqLib.collect(seqLib.openSequence(named), {})).map((f) => [f.index, path.basename(f.file)]), [[0, "a.png"], [1, "b.png"], [2, "c.png"]]);
});

test("the select filter keeps frames by number, with its commas escaped", () => {
  assert.equal(selectFilter({ every: 6 }), "select=gte(n\\,0)*not(mod(n-0\\,6))");
  assert.equal(selectFilter({ first: 3, last: 9 }), "select=between(n\\,3\\,9)");
  assert.equal(selectFilter({ at: [4, 8] }), "select=eq(n\\,4)+eq(n\\,8)");
});

// ---- the command on folders --------------------------------------------------------------------

test("video contact and burst draw sheets of a folder: tiles in time order, the moment in the middle", () => {
  const tmp = tempDir("pl-video-"), a = clip(path.join(tmp, "a")), out = path.join(tmp, "out");
  const c = json(pl(tmp, ["video", "contact", a, "--rate", "12", "--cols", "6", "--out", out, "--json"]));
  assert.equal(c.tiles, 24);
  const sheet = decodePng(fs.readFileSync(c.sheet));
  assert.ok(sheet.width <= 1568, `${sheet.width} px wide`);
  const thin = json(pl(tmp, ["video", "contact", a, "--max-tiles", "6", "--out", out, "--json"]));
  assert.deepEqual(thin.frames, [0, 4, 8, 12, 16, 20], "a long clip is thinned evenly to --max-tiles");
  const b = json(pl(tmp, ["video", "burst", a, "--frame", "10", "--count", "5", "--out", out, "--json"]));
  assert.deepEqual(b.frames, [8, 9, 10, 11, 12]);
  assert.equal(b.centre, 10);
  const at = json(pl(tmp, ["video", "burst", a, "--at", "1", "--rate", "12", "--count", "3", "--out", out, "--json"]));
  assert.deepEqual(at.frames, [11, 12, 13]);
  const no = pl(tmp, ["video", "burst", a, "--at", "1", "--out", out]);
  assert.equal(no.status, 2);
  assert.match(no.stderr, /--rate/);
});

test("video compare: identical clips pass, a damaged frame is found and fails the gate, --align finds an offset", () => {
  const tmp = tempDir("pl-video-"), out = ["--out", path.join(tmp, "out")];
  const a = clip(path.join(tmp, "a")), late = clip(path.join(tmp, "late"), { n: 22, start: 2 }), damaged = clip(path.join(tmp, "damaged"));
  const f = path.join(damaged, "000009.png"), img = decodePng(fs.readFileSync(f));
  // stripes: SSIM is about structure, and a flat patch of another colour would barely move it
  for (let y = 0; y < img.height; y++) if (y % 8 < 4) for (let x = 0; x < img.width; x++) img.data.set([255, 255, 255], (y * img.width + x) * 3);
  fs.writeFileSync(f, encodePng(img));

  const same = pl(tmp, ["video", "compare", a, a, "--min-ssim", "0.99", ...out, "--json"]);
  const s = json(same);
  assert.equal(same.status, 0);
  assert.equal(s.pairs, 24);
  assert.ok(s.ssim.min > 0.9999, `ssim ${s.ssim.min}`);
  assert.equal(s.psnr.min, PSNR_CAP);
  assert.ok(fs.existsSync(s.sheet) && fs.existsSync(s.report));

  const bad = pl(tmp, ["video", "compare", a, damaged, "--min-ssim", "0.9", ...out, "--json"]);
  const d = json(bad);
  assert.equal(bad.status, 1, "the gate fails");
  assert.equal(d.ssim.worstFrame, 9);
  assert.equal(d.worst[0].index, 9);
  assert.match(d.gate.failed[0], /worst-frame SSIM/);
  assert.equal(JSON.parse(fs.readFileSync(d.report, "utf8")).perFrame.length, 24);

  const al = json(pl(tmp, ["video", "compare", late, a, "--align", ...out, "--json"]));
  assert.equal(al.lag, 2);
  assert.ok(al.ssim.min > 0.9999, `ssim ${al.ssim.min} after aligning`);
  assert.equal(al.pairs, 22);
  const unaligned = json(pl(tmp, ["video", "compare", late, a, ...out, "--json"]));
  assert.ok(unaligned.ssim.min < 0.99, "without --align the offset shows");
  assert.match(unaligned.notes.join(" "), /A has 22 frames and B 24/);
});

test("without ffmpeg a video is refused with exit 2 and both remedies, and a folder still works", () => {
  const tmp = tempDir("pl-video-");
  fs.writeFileSync(path.join(tmp, "clip.mp4"), "not really a video");
  const gone = { PL_FFMPEG: path.join(tmp, "no-ffmpeg"), PL_FFPROBE: path.join(tmp, "no-ffprobe") };
  for (const args of [["video", "probe", "clip.mp4"], ["video", "contact", "clip.mp4"], ["sweep", "clip.mp4"]]) {
    const r = pl(tmp, args, gone);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    assert.match(r.stderr, /needs ffmpeg, which was not found/);
    assert.match(r.stderr, /PL_FFMPEG/);
    assert.match(r.stderr, /folder of PNG frames needs no ffmpeg/);
  }
  const ok = pl(tmp, ["video", "contact", clip(path.join(tmp, "f"), { n: 3 }), "--out", path.join(tmp, "out"), "--json"], gone);
  assert.equal(ok.status, 0, ok.stderr);
});

// ---- the command on a video made by ffmpeg ------------------------------------------------------

test("a video made with ffmpeg: probe, raw frames, frames by number, compare with its source, burst at a time", { skip: !hasFfmpeg }, async () => {
  const tmp = tempDir("pl-video-"), a = clip(path.join(tmp, "a")), file = path.join(tmp, "a.mp4"), out = ["--out", path.join(tmp, "out")];
  let enc;
  for (const codec of [["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12"], ["-c:v", "mpeg4", "-q:v", "2"]]) {
    enc = spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "12", "-i", path.join(a, "%06d.png"), ...codec, file], { encoding: "utf8" });
    if (enc.status === 0) break;
  }
  assert.equal(enc.status, 0, enc.stderr);

  const p = json(pl(tmp, ["video", "probe", file, "--json"]));
  assert.deepEqual([p.frames, p.fps, p.size], [24, 12, [160, 120]]);
  assert.ok(Math.abs(p.duration - 2) < 0.05, `${p.duration} s`);

  let count = 0;
  for await (const data of rawFrames(file, { width: 80, height: 60 })) { assert.equal(data.length, 80 * 60 * 3); count++; }
  assert.equal(count, 24, "one rawvideo frame at a time, all of them");
  const seq = seqLib.openSequence(file);
  const picked = await seqLib.collect(seq, { every: 6, size: 80 });
  assert.deepEqual(picked.map((f) => [f.index, f.t]), [[0, 0], [6, 0.5], [12, 1], [18, 1.5]]);
  let early = 0;
  for await (const f of seq.frames({ size: 40 })) { if (++early === 3) break; }
  assert.equal(early, 3, "leaving the loop early stops ffmpeg without an error");

  const fr = json(pl(tmp, ["video", "frames", file, "--every", "6", "--out", path.join(tmp, "ex"), "--json"]));
  assert.deepEqual(fr.frames.map((f) => [f.file, f.index]), [["000000.png", 0], ["000006.png", 6], ["000012.png", 12], ["000018.png", 18]]);
  assert.deepEqual((await seqLib.collect(seqLib.openSequence(path.join(tmp, "ex")), {})).map((f) => f.index), [0, 6, 12, 18], "the folder reads back with the video's numbers");
  const again = pl(tmp, ["video", "frames", file, "--every", "6", "--out", path.join(tmp, "ex")]);
  assert.equal(again.status, 2, "a folder that already holds frames is refused");
  const times = json(pl(tmp, ["video", "frames", file, "--times", "0.5,1.5", "--out", path.join(tmp, "ex2"), "--json"]));
  assert.deepEqual(times.frames.map((f) => f.index), [6, 18]);

  const cmp = json(pl(tmp, ["video", "compare", file, a, ...out, "--json"]));
  assert.equal(cmp.pairs, 24);
  assert.ok(cmp.ssim.min > 0.95, `ssim ${cmp.ssim.min}, psnr ${cmp.psnr.min} dB`);
  const b = json(pl(tmp, ["video", "burst", file, "--at", "1.0", "--count", "5", ...out, "--json"]));
  assert.deepEqual(b.frames, [10, 11, 12, 13, 14]);
  const c = json(pl(tmp, ["video", "contact", file, ...out, "--json"]));
  assert.equal(c.tiles, 24);
  assert.ok(decodePng(fs.readFileSync(c.sheet)).width <= 1568);
});
