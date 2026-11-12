// flow: which way, how fast, and how coherently the pixels move between
// consecutive frames of a clip, for the frame and for each region, per pair
// and over the clip; against a reference clip when one is given. Pixels with
// nothing to measure (flat colour, a straight edge) are counted as unknown,
// apart from moving and still, so a blank region never passes as static.
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { denseFlow, FLOW } from "../lib/flow.mjs";
import { median, percentile, regionsFromBoxes } from "../lib/metrics.mjs";
import { drawArrow, drawLine } from "../lib/plot.mjs";
import { writeJson } from "../lib/project.mjs";
import { canvas, fillRect, paste } from "../lib/raster.mjs";
import { fitSize, frameCaption, lumaPlane, openSequence } from "../lib/sequence.mjs";
import { gridSheet } from "../lib/sheets.mjs";
import { CLIP_FLAGS, clipInput, outputDir, parseRegions, writeSheet } from "./video.mjs";

const HELP = `usage: pl.mjs flow [CLIP] [--region NAME=x0,y0,x1,y1]... [expectations] [--ref CLIP | --against SOURCE] [--json]

Dense optical flow (pyramidal Lucas-Kanade, ${FLOW.levels} levels at 0.5, a Gaussian window of sigma ${FLOW.sigma},
${FLOW.iterations} iterations a level) between each pair of consecutive frames of a CLIP (a video file, a folder
of frames, or --shot NAME [--source ID]). For the frame and each region, per pair and over the clip:

  dx, dy, mag   the mean flow vector and the mean length of the flow, over the pixels that can be measured,
                in pixels of the original frame per frame step
  speed         the mean flow length of the moving pixels: how fast what moves moves, whatever share of
                the region it covers
  direction     of the summed vectors of the moving pixels, in degrees: 0 right, 90 down, 180 left, 270 up
  coherence     |sum of vectors| / sum of |vectors| over the moving pixels: 1 all one way, 0 every way
  moving, still, unknown
                shares of the region: longer than --min-mag, shorter, or with nothing to measure (the
                structure tensor's smaller eigenvalue under --min-confidence: flat colour, a straight edge)

  --size PX                  the flow is computed at this long side (default 480), then scaled to original pixels
  --every N                  every Nth frame (a step is then N frames)
  --min-mag PX               a pixel moves above this many original pixels a frame (default 0.25)
  --min-confidence V         below this smaller eigenvalue a pixel is unknown (default ${FLOW.minConfidence}: luma 0..1,
                             about one 8-bit level a pixel of gradient in each direction)
  --sheet-frames N           how many pairs the sheet shows, spread over the clip (default 4)

Expectations and gates, exit 1 when one is not met:
  --expect-direction [REGION=]DEG   the motion points this way, within --tolerance DEG (default 15)
  --expect-static REGION            the region's mean flow stays under --static-below PX (default 0.3) in every pair
  --expect-moving REGION            its median mean flow is at least --moving-above PX (default 0.5)
  --min-known SHARE                 an expectation needs this share of the region measurable (default 0.25);
                                    under it the answer is unknown, and unknown fails
  --ref CLIP, or --against SOURCE with --shot: a reference clip, compared pair by pair:
  --max-angle-error DEG             the median angle between its direction and the reference's, per region
  --speed-tolerance PCT             the speed within this many percent of the reference's, per region

Optical flow is the apparent motion of brightness, not of objects: a moving shadow, a reflection, or a
flickering light reads as motion, and anything faster than a few dozen analysed pixels a frame is
underestimated (raise --size or lower the step). A region's mean mixes the subject with its still
background, so mag is under the subject's own speed; speed, direction, and coherence use the moving pixels only.
Use the numbers as a gate between runs of the same shot, and the sheet to see what moved.

and --rate, --shot, --source, --out, --run, --max-width, --jpeg, --quality as for video.
Exit codes: 0 done (gates passed), 1 an expectation or gate failed, 2 usage or environment.`;

const FLAGS = {
  ...CLIP_FLAGS, region: { type: "string", multi: true }, size: { type: "int", default: 480 }, every: { type: "int", default: 1 },
  "min-mag": { type: "float", default: 0.25 }, "min-confidence": { type: "float", default: FLOW.minConfidence }, "sheet-frames": { type: "int", default: 4 },
  "expect-direction": { type: "string", multi: true }, tolerance: { type: "float", default: 15 }, "expect-static": { type: "string", multi: true },
  "expect-moving": { type: "string", multi: true }, "static-below": { type: "float", default: 0.3 }, "moving-above": { type: "float", default: 0.5 },
  "min-known": { type: "float", default: 0.25 }, ref: { type: "string" }, against: { type: "string" },
  "max-angle-error": { type: "float" }, "speed-tolerance": { type: "float" },
};

const deg = (x, y) => ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
export const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * One pair's numbers over a mask (null for the whole frame), in original pixels (`scale` per analysed pixel).
 * The unknown pixels take no part in dx, dy, and mag; they are their own share.
 */
export function measure(f, mask, { scale = 1, minMag = 0.25, minConfidence = FLOW.minConfidence } = {}) {
  let n = 0, known = 0, moving = 0, sdx = 0, sdy = 0, smag = 0, sx = 0, sy = 0, mmag = 0;
  for (let i = 0; i < f.u.length; i++) {
    if (mask && !mask[i]) continue;
    n++;
    if (!(f.confidence[i] >= minConfidence)) continue;
    const dx = f.u[i] * scale, dy = f.v[i] * scale, m = Math.hypot(dx, dy);
    known++; sdx += dx; sdy += dy; smag += m;
    if (m > minMag) { moving++; sx += dx; sy += dy; mmag += m; }
  }
  const sum = Math.hypot(sx, sy);
  return {
    dx: known ? sdx / known : null, dy: known ? sdy / known : null, mag: known ? smag / known : null, speed: moving ? mmag / moving : null,
    direction: moving && sum > 1e-9 ? deg(sx, sy) : null, coherence: moving ? sum / mmag : null,
    moving: n ? moving / n : 0, still: n ? (known - moving) / n : 0, unknown: n ? (n - known) / n : 1, _sx: sx, _sy: sy,
  };
}

const med = (rows, key) => { const v = rows.map((r) => r[key]).filter((x) => x !== null); return v.length ? median(v) : null; };

/** Over the clip: medians, so one odd pair does not move them, and the direction of every moving vector summed. */
export function summarise(rows) {
  const sx = rows.reduce((s, r) => s + r._sx, 0), sy = rows.reduce((s, r) => s + r._sy, 0);
  const mags = rows.map((r) => r.mag).filter((x) => x !== null);
  return { dx: med(rows, "dx"), dy: med(rows, "dy"), mag: med(rows, "mag"), magMax: mags.length ? Math.max(...mags) : null, speed: med(rows, "speed"),
    direction: Math.hypot(sx, sy) > 1e-9 ? deg(sx, sy) : null, coherence: med(rows, "coherence"),
    moving: med(rows, "moving"), still: med(rows, "still"), unknown: med(rows, "unknown") };
}

/** The flow of every consecutive pair of a clip: per-pair rows per region, the frame numbers, and a few pairs kept for the sheet. */
export async function analyseClip(seq, regions, { size = 480, every = 1, keep = 4, minMag = 0.25, minConfidence = FLOW.minConfidence, label = seq.label } = {}) {
  const [w, h] = fitSize(seq.width, seq.height, size);
  const scale = seq.width / w;
  const masks = [["frame", null], ...regionsFromBoxes(regions, w, h).map((r) => [r.name, r.mask])];
  const rows = Object.fromEntries(masks.map(([n]) => [n, []]));
  const pairs = Math.max(0, Math.ceil(seq.total / every) - 1);
  // the first pair always, so a clip whose frame count was estimated low still has a sheet
  const want = new Set([0, ...Array.from({ length: Math.min(keep, pairs) }, (_, i) => Math.round((i * (pairs - 1)) / Math.max(1, keep - 1)))]);
  const frames = [], kept = [];
  let prev = null, k = 0;
  for await (const f of seq.frames({ every, dims: [w, h] })) {
    const y = lumaPlane(f.img);
    if (prev) {
      const fl = denseFlow(prev.y, y, w, h, { minConfidence });
      frames.push(f.index);
      for (const [name, mask] of masks) rows[name].push(measure(fl, mask, { scale, minMag, minConfidence }));
      if (want.has(k)) kept.push({ frame: f, before: prev.img, flow: fl, scale });
      k++;
    }
    prev = { y, img: f.img };
  }
  if (!frames.length) throw new PlError(`${label}: optical flow needs at least two frames`);
  return { rows, frames, kept };
}

// ---- the sheet ---------------------------------------------------------------------------------

function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const UNKNOWN = [118, 118, 118]; // grey has no hue, so it is never a direction on the wheel

/** The key of the colour picture: hue is the direction, at the place on the disc the motion points to. */
function wheel(d = 72) {
  const out = canvas(d, d, [0, 0, 0]);
  for (let y = 0; y < d; y++) for (let x = 0; x < d; x++) {
    const px = (2 * x) / (d - 1) - 1, py = (2 * y) / (d - 1) - 1, r = Math.hypot(px, py);
    out.data.set(r > 1 ? [22, 22, 24] : hsv(deg(px, py), 1, r), (y * d + x) * 3);
  }
  return out;
}

const up = (w) => Math.max(1, Math.round(720 / w)); // drawn large enough for a thin arrow to read

/** Arrows over the dimmed earlier frame: the fastest motion of the sheet draws one grid step long. */
function arrows({ before, flow, scale }, top, minConfidence) {
  const { width: w, height: h } = before, k = up(w), out = canvas(w * k, h * k);
  for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
    const i = (Math.floor(y / k) * w + Math.floor(x / k)) * 3, o = (y * w * k + x) * 3;
    for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(((before.data[i] * 0.2126 + before.data[i + 1] * 0.7152 + before.data[i + 2] * 0.0722)) * 0.5);
  }
  const step = Math.max(8, Math.floor(w / 28)), gain = step / Math.max(top, 1e-6);
  for (let y = step >> 1; y < h; y += step) for (let x = step >> 1; x < w; x += step) {
    const i = y * w + x;
    if (!(flow.confidence[i] >= minConfidence)) { drawLine(out, x * k - 2, y * k - 2, x * k + 2, y * k + 2, UNKNOWN); drawLine(out, x * k - 2, y * k + 2, x * k + 2, y * k - 2, UNKNOWN); continue; }
    const dx = flow.u[i] * scale * gain, dy = flow.v[i] * scale * gain;
    if (Math.hypot(dx, dy) < 0.08 * step) fillRect(out, x * k - 1, y * k - 1, 3, 3, [90, 90, 95]);
    else drawArrow(out, x * k, y * k, Math.round((x + dx) * k), Math.round((y + dy) * k), [255, 220, 60], Math.max(1, k));
  }
  return out;
}

/** Direction as hue and speed as brightness; grey where the flow is unknown; the key in the corner. */
function colours({ flow, scale }, top, minConfidence) {
  const { width: w, height: h } = flow, k = up(w), out = canvas(w * k, h * k);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = flow.u[i] * scale, dy = flow.v[i] * scale;
    const c = flow.confidence[i] >= minConfidence ? hsv(deg(dx, dy), 1, Math.min(1, Math.hypot(dx, dy) / Math.max(top, 1e-6))) : UNKNOWN;
    fillRect(out, x * k, y * k, k, k, c);
  }
  paste(out, wheel(), 4, 4);
  return out;
}

function flowSheet(kept, refKept, { name, refName, minConfidence, maxWidth }) {
  const all = [...kept, ...(refKept ?? [])].flatMap(({ flow, scale }) => {
    const m = [];
    for (let i = 0; i < flow.u.length; i++) if (flow.confidence[i] >= minConfidence) m.push(Math.hypot(flow.u[i], flow.v[i]) * scale);
    return m;
  });
  const top = all.length ? percentile(all, 99.5) : 1;
  const items = kept.flatMap((p, i) => [
    { img: arrows(p, top, minConfidence), label: `motion into ${frameCaption(p.frame)}, on the frame before` },
    { img: colours(p, top, minConfidence), label: "hue direction (disc), brightness speed, grey unknown" },
    ...(refKept ? [refKept[i] ? { img: arrows(refKept[i], top, minConfidence), label: `reference ${frameCaption(refKept[i].frame)}`, colour: [140, 220, 255] }
      : { img: canvas(8, 8) }] : []),
  ]);
  const header = `flow  ${name}${refName ? `  vs ${refName}` : ""}  longest arrow ${top.toFixed(2)} px a frame  0 deg right, 90 deg down`;
  return gridSheet(items, { cols: refKept ? 3 : 2, header, maxWidth, footer: ["x: no texture to measure there (unknown, not still)"] });
}

// ---- the command -------------------------------------------------------------------------------

const pub = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => !k.startsWith("_")).map(([k, v]) => [k, v === null ? null : Number(v.toFixed(4))]));
const fmt = (v, n = 3) => (v === null ? "-" : v.toFixed(n));

function nameValue(spec, flag) {
  const at = spec.lastIndexOf("="), name = at === -1 ? "frame" : spec.slice(0, at), v = Number(spec.slice(at + 1));
  if (!name || !Number.isFinite(v)) throw new PlError(`${flag} '${spec}': write DEGREES or REGION=DEGREES`);
  return [name, v];
}

export async function run(argv) {
  const opts = parseArgs(argv, FLAGS);
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (opts._.length > 1) throw new PlError("flow takes one clip (see --help)");
  if (opts.size < 16 || opts.every < 1 || opts.sheetFrames < 1) throw new PlError("--size wants 16 or more, --every and --sheet-frames 1 or more");
  const clip = clipInput(opts, { path: opts._[0], what: "flow" });
  const seq = openSequence(clip.input, { rate: opts.rate ?? null, what: "flow" });
  const regions = parseRegions(opts.region, clip);
  const settings = { size: opts.size, every: opts.every, keep: opts.sheetFrames, minMag: opts.minMag, minConfidence: opts.minConfidence };
  const { rows, frames, kept } = await analyseClip(seq, regions, { ...settings, label: clip.name });
  const summary = Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, summarise(r)]));
  const failed = [], notes = [];
  const region = (name, flag) => {
    if (!summary[name]) throw new PlError(`${flag} ${name}: no such region (have: ${Object.keys(summary).join(", ")})`);
    return summary[name];
  };
  const unknownFails = (name, s, what) => {
    if (1 - s.unknown >= opts.minKnown) return false;
    failed.push(`${name}: expected ${what}, but only ${((1 - s.unknown) * 100).toFixed(0)} % of it can be measured (< --min-known ${opts.minKnown}): unknown`);
    return true;
  };
  for (const spec of opts.expectDirection) {
    const [name, want] = nameValue(spec, "--expect-direction"), s = region(name, "--expect-direction");
    if (unknownFails(name, s, `motion towards ${want} deg`)) continue;
    if (s.direction === null) failed.push(`${name}: expected motion towards ${want} deg, but nothing moves (no flow above --min-mag ${opts.minMag})`);
    else if (angleBetween(s.direction, want) > opts.tolerance) {
      failed.push(`${name}: direction ${s.direction.toFixed(1)} deg is ${angleBetween(s.direction, want).toFixed(1)} deg from the expected ${want} (tolerance ${opts.tolerance})`);
    }
  }
  for (const name of opts.expectStatic) {
    const s = region(name, "--expect-static");
    if (unknownFails(name, s, "static")) continue;
    if (s.magMax > opts.staticBelow) failed.push(`${name}: expected static, but its mean flow reaches ${s.magMax.toFixed(3)} px a frame (> --static-below ${opts.staticBelow})`);
  }
  for (const name of opts.expectMoving) {
    const s = region(name, "--expect-moving");
    if (unknownFails(name, s, "moving")) continue;
    if (s.mag < opts.movingAbove) failed.push(`${name}: expected moving, but its median mean flow is ${s.mag.toFixed(3)} px a frame (< --moving-above ${opts.movingAbove})`);
  }

  const doc = { input: clip.name, method: `pyramidal Lucas-Kanade on luma at long side ${Math.max(...fitSize(seq.width, seq.height, opts.size))}`,
    unit: "pixels of the original frame per frame step; direction in degrees, 0 right, 90 down", pairs: frames.length,
    summary: Object.fromEntries(Object.entries(summary).map(([n, s]) => [n, pub(s)])) };
  let refKept = null, refName = null, against = null;
  if (opts.ref || opts.against) {
    if (opts.against && !opts.shot) throw new PlError("--against names a source of the shot: use it with --shot, or give --ref CLIP");
    const rc = clipInput(opts, { path: opts.ref ?? null, role: "against", what: "reference" });
    refName = rc.name;
    const ref = await analyseClip(openSequence(rc.input, { rate: opts.rate ?? null, what: "reference" }), regions, { ...settings, label: rc.name });
    refKept = ref.kept;
    against = {};
    for (const name of Object.keys(rows)) {
      const a = rows[name], b = ref.rows[name], n = Math.min(a.length, b.length);
      const ang = [], ratio = [];
      for (let i = 0; i < n; i++) {
        if (a[i].direction !== null && b[i].direction !== null) ang.push(angleBetween(a[i].direction, b[i].direction));
        if (a[i].speed !== null && b[i].speed !== null) ratio.push(a[i].speed / b[i].speed);
      }
      const r = { pairs: n, angularError: ang.length ? Number(median(ang).toFixed(3)) : null, angularErrorMax: ang.length ? Number(Math.max(...ang).toFixed(3)) : null,
        speedRatio: ratio.length ? Number(median(ratio).toFixed(4)) : null, reference: pub(summarise(b)) };
      against[name] = r;
      if (opts.maxAngleError !== undefined && r.angularError !== null && r.angularError > opts.maxAngleError) {
        failed.push(`${name}: direction differs from the reference by ${r.angularError.toFixed(1)} deg (median) > --max-angle-error ${opts.maxAngleError}`);
      }
      if (opts.speedTolerance !== undefined && r.speedRatio !== null && Math.abs(r.speedRatio - 1) * 100 > opts.speedTolerance) {
        failed.push(`${name}: speed is ${r.speedRatio.toFixed(2)}x the reference's, outside ${opts.speedTolerance} %`);
      }
    }
    if (frames.length !== ref.frames.length) notes.push(`the clips differ in length (${frames.length} and ${ref.frames.length} pairs): compared pair by pair from the start`);
    doc.against = { reference: refName, regions: against };
  }
  doc.notes = notes;
  doc.gate = { passed: !failed.length, failed };
  const dir = outputDir(opts, clip), stem = `flow.${clip.stem}`;
  doc.sheet = writeSheet(flowSheet(kept, refKept, { name: clip.name, refName, minConfidence: opts.minConfidence, maxWidth: opts.maxWidth }), path.join(dir, `${stem}.png`), opts);
  doc.report = path.join(dir, `${stem}.json`);
  writeJson(doc.report, { ...doc, frames, perPair: Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, r.map(pub)])) });

  const w = Math.max(...Object.keys(summary).map((n) => n.length));
  const lines = [`flow of ${clip.name}: ${frames.length} frame pairs; px of the original frame a frame; 0 deg right, 90 deg down`];
  for (const [n, m] of Object.entries(summary)) {
    lines.push(`  ${n.padEnd(w)}  mean (${fmt(m.dx, 2)}, ${fmt(m.dy, 2)})  mag ${fmt(m.mag)}  speed ${fmt(m.speed, 2)}  direction ${m.direction === null ? "none" : `${m.direction.toFixed(1)} deg`}`
      + `  coherence ${fmt(m.coherence, 2)}  moving ${(m.moving * 100).toFixed(0)} %  still ${(m.still * 100).toFixed(0)} %  unknown ${(m.unknown * 100).toFixed(0)} %`);
  }
  if (against) {
    lines.push(`against ${refName}:`);
    for (const [n, a] of Object.entries(against)) {
      lines.push(`  ${n.padEnd(w)}  angular error ${a.angularError === null ? "n/a (one of them does not move)" : `${a.angularError.toFixed(1)} deg`}  speed ratio ${a.speedRatio === null ? "n/a" : `${a.speedRatio.toFixed(2)}x`}`);
    }
  }
  lines.push(...notes.map((n) => `  note: ${n}`), `  sheet: ${doc.sheet}`, `  report: ${doc.report}`, ...failed.map((f) => `  GATE FAILED: ${f}`));
  emit(doc, opts.json, lines.join("\n"));
  return failed.length ? 1 : 0;
}
