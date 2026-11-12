// What the perceptual-loop suites share. First the plumbing: temp folders, and a
// way to run the CLI or a hook with an environment that names no real home.
// Then closed-form pictures and a seeded PRNG. No binary fixture is committed:
// every image is computed here, the same way each time, and the recorded
// numbers in the parity suite were taken from these same pixels.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "../fixtures.mjs";

export { REPO };
export const PLUGIN = path.join(REPO, "plugins", "perceptual-loop");
export const PL = path.join(PLUGIN, "scripts", "pl.mjs");

// One exit handler for every temp folder, rather than one per folder: a suite makes dozens.
const made = [];
process.on("exit", () => {
  for (const dir of made) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone already */ } }
});

/** A temp directory, removed when the test process exits. The real path, so it compares equal to what a child prints. */
export function tempDir(prefix = "pl-test-") {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

/** Write one file under a directory, creating its folders; returns the full path. */
export function write(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// One empty home per test process, so no child reads the developer's own settings:
// which plugins are enabled there decides what a session hook prints.
let home = null;
export function isolatedHome() {
  if (!home) {
    home = tempDir("pl-home-");
    write(home, ".claude/settings.json", "{}\n");
  }
  return { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude") };
}

/** Run a Node script and capture everything, without throwing on a non-zero exit. `env` is added to the process's own. */
export function runNode(script, args = [], { cwd = process.cwd(), env = {}, input = "" } = {}) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, input, encoding: "utf8", env: { ...process.env, ...isolatedHome(), ...env } });
  // A null status means the child never exited normally: say why, rather than let an assertion report "null !== 0".
  if (result.error) throw new Error(`${path.basename(script)} could not be spawned: ${result.error.message}`);
  if (result.status === null) throw new Error(`${path.basename(script)} was killed by signal ${result.signal}`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ---- pictures ------------------------------------------------------------------------------

/** mulberry32: a small, fast, seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** A linear-light picture as three Float64Array planes, from f(x, y) -> [r, g, b]. */
export function linear(width, height, f) {
  const n = width * height;
  const planes = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = f(x, y);
    const i = y * width + x;
    planes[0][i] = r; planes[1][i] = g; planes[2][i] = b;
  }
  return { width, height, planes };
}

/** Linear light to an 8-bit sRGB image ({ width, height, channels: 3, data }). */
export function u8(lin, map = (c, v) => v) {
  const { width, height, planes } = lin;
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      const v = toSrgb(Math.max(0, map(c, planes[c][i])));
      data[i * 3 + c] = Math.floor(Math.min(1, Math.max(0, v)) * 255 + 0.5);
    }
  }
  return { width, height, channels: 3, data };
}

/**
 * The test scene: smooth gradients and a ripple, two flat boxes, and a disc, kept
 * under 0.6 in linear light so +0.5 EV clips nothing. Box and disc positions
 * scale with the size, so every size shows the same picture.
 */
export function scene(width = 320, height = 240) {
  const sx = width / 320, sy = height / 240;
  return linear(width, height, (x, y) => {
    if (y >= 60 * sy && y < 140 * sy && x >= 80 * sx && x < 200 * sx) return [0.5, 0.12, 0.08];
    if (y >= 150 * sy && y < 210 * sy && x >= 30 * sx && x < 110 * sx) return [0.05, 0.3, 0.45];
    if ((x / sx - 250) ** 2 + (y / sy - 170) ** 2 < 40 ** 2) return [0.55, 0.5, 0.1];
    return [0.08 + (0.4 * x) / width, 0.1 + (0.35 * y) / height, 0.25 + 0.2 * Math.sin(x / sx / 17) * Math.cos(y / sy / 23)];
  });
}

/** A dark frame with one bright box starting at x0: for edge shifts. */
export function box(x0, width = 320, height = 240) {
  return linear(width, height, (x, y) => (y >= 80 && y < 160 && x >= x0 && x < x0 + 100 ? [0.5, 0.5, 0.5] : [0.05, 0.05, 0.05]));
}

/** A (2r+1) square box blur of an 8-bit image, edges clamped. */
export function boxBlur(img, r = 2) {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    let sum = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = Math.min(height - 1, Math.max(0, y + dy)), xx = Math.min(width - 1, Math.max(0, x + dx));
      sum += data[(yy * width + xx) * 3 + c]; n++;
    }
    out[(y * width + x) * 3 + c] = Math.floor(sum / n + 0.5);
  }
  return { width, height, channels: 3, data: out };
}

/** Uniform noise of +-amp levels on every channel, from a seed. */
export function noisy(img, amp, seed) {
  const rand = mulberry32(seed);
  const data = Uint8Array.from(img.data, (v) => Math.min(255, Math.max(0, v + Math.round((rand() * 2 - 1) * amp))));
  return { ...img, data };
}

/** An 8-bit image shifted right by dx pixels, the left edge repeated. */
export function shifted(img, dx) {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.max(0, x - dx);
    out.set(data.subarray((y * width + sx) * 3, (y * width + sx) * 3 + 3), (y * width + x) * 3);
  }
  return { width, height, channels: 3, data: out };
}

/** A flat-colour id pass: the left 30 % red, the rest blue, one stray grey pixel. */
export function idPass(width = 320, height = 240) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set(x < Math.floor((width * 3) / 10) ? [255, 0, 0] : [0, 0, 255], (y * width + x) * 3);
  }
  data.set([9, 9, 9], 0);
  return { width, height, channels: 3, data };
}

/**
 * The recorded cases: [name, reference, candidate], every pair a pure function
 * of this file. The recording and the test both build them from here.
 */
export function goldenCases() {
  const s = scene();
  const ref = u8(s);
  const flat = u8(s, (c, v) => 0.18 + (v - 0.18) * 0.7);
  return [
    ["identical", ref, ref],
    ["ev+0.3", ref, u8(s, (c, v) => v * 2 ** 0.3)],
    ["wb", ref, u8(s, (c, v) => v * [1.1, 1.0, 0.9][c])],
    ["flatter", ref, flat],
    ["blurred", ref, boxBlur(ref, 1)],
    ["noisy", ref, noisy(ref, 6, 7)],
    ["shift3", ref, shifted(ref, 3)],
    ["box-shift1", u8(box(100)), u8(box(101))],
    ["box-shift12", u8(box(100)), u8(box(112))],
    ["half-even-640x360", u8(scene(640, 360)), noisy(u8(scene(640, 360), (c, v) => v * 2 ** -0.2), 4, 11)],
    ["hd-1280x720", u8(scene(1280, 720)), shifted(u8(scene(1280, 720), (c, v) => v * [1.05, 1, 0.97][c]), 1)],
  ];
}

/** Six runs of flat metrics with known noise, one bistable entry: the input of the recorded calibration. */
export function calibrateRuns() {
  const rand = mulberry32(42);
  const shots = ["a", "b", "c", "d"];
  return Array.from({ length: 6 }, (_, run) => {
    const flat = {};
    for (const shot of shots) {
      const head = `${shot}/candidate`;
      flat[`${head}/frame.ssim`] = 0.9 + 0.0004 * rand();
      flat[`${head}/frame.deltaENorm`] = 2 + 0.01 * rand();
      flat[`${head}/frame.exposureEV`] = 0.1 + 0.001 * rand();
      flat[`${head}/region.body.edgeF1`] = 0.8 + 0.001 * rand();
      flat[`${head}/region.glass.edgeF1`] = shot === "c" ? (run % 2 ? 0.7 : 0.75) + 0.0001 * rand() : 0.8 + 0.001 * rand();
    }
    return flat;
  });
}

// ---- clips ---------------------------------------------------------------------------------

/** Frame k of a clip: a light square moving `step` px right per frame over a ground that brightens 3 levels a frame. */
export function squareFrame(k, { width = 160, height = 120, step = 4, ramp = true } = {}) {
  const data = new Uint8Array(width * height * 3), g = ramp ? 40 + 3 * k : 40, x0 = 10 + step * k;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set(x >= x0 && x <= x0 + 30 && y >= 40 && y <= 70 ? [230, 200, 60] : [g, g, g], (y * width + x) * 3);
  }
  return { width, height, channels: 3, data };
}

/** Smooth grey texture: random levels lo..hi on a grid of `cell` px, joined by smoothstep, so every pixel has a gradient. */
export function texture(width, height, { cell = 4, lo = 40, hi = 120, seed = 1 } = {}) {
  const rand = mulberry32(seed), gw = Math.ceil(width / cell) + 2, gh = Math.ceil(height / cell) + 2;
  const grid = Float64Array.from({ length: gw * gh }, () => lo + rand() * (hi - lo));
  const s = (t) => t * t * (3 - 2 * t);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = x / cell, gy = y / cell, i = Math.floor(gx), j = Math.floor(gy), u = s(gx - i), v = s(gy - j);
    const at = (a, b) => grid[b * gw + a];
    const top = at(i, j) * (1 - u) + at(i + 1, j) * u, bottom = at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u;
    out[y * width + x] = Math.round(top * (1 - v) + bottom * v);
  }
  return out;
}

/** Frame i of the flow clip: a textured 60 px square moving (dx, dy) px a frame in the top half of a still textured ground. */
export function flowFrame(i, dx, dy, { width = 320, height = 240, seed = 1 } = {}) {
  const ground = texture(width, height, { seed }), patch = texture(60, 60, { lo: 120, hi: 255, seed: seed + 1 });
  const px = 60 + dx * i, py = 30 + dy * i, data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = x >= px && x < px + 60 && y >= py && y < py + 60;
    const v = inside ? patch[(y - py) * 60 + (x - px)] : ground[y * width + x];
    data[(y * width + x) * 3] = data[(y * width + x) * 3 + 1] = data[(y * width + x) * 3 + 2] = v;
  }
  return { width, height, channels: 3, data };
}

// ---- sounds --------------------------------------------------------------------------------

/** A sine of `hz` for `seconds` at `rate`, as floats in -1..1. */
export const sine = (hz, seconds, rate, amp = 1, phase = 0) => Float64Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate + phase));

/** Gaussian noise of standard deviation `amp`, from a seed (Box-Muller over mulberry32). */
export function gaussian(n, seed, amp = 1) {
  const rnd = mulberry32(seed), out = new Float64Array(n);
  for (let i = 0; i < n; i += 2) {
    const r = Math.sqrt(-2 * Math.log(1 - rnd())), t = 2 * Math.PI * rnd();
    out[i] = amp * r * Math.cos(t);
    if (i + 1 < n) out[i + 1] = amp * r * Math.sin(t);
  }
  return out;
}

/** The bytes of a float32 WAV file: `channels` are arrays of floats in -1..1, all of one length. */
export function wavF32(channels, rate) {
  const ch = channels.length, n = channels[0].length, data = Buffer.alloc(n * ch * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) data.writeFloatLE(channels[c][i], (i * ch + c) * 4);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1"); head.writeUInt32LE(36 + data.length, 4); head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(ch, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * ch * 4, 28); head.writeUInt16LE(ch * 4, 32); head.writeUInt16LE(32, 34);
  head.write("data", 36, "latin1"); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/**
 * The recorded sounds: name -> { rate, channels }, each a pure function of this file. Short on purpose:
 * a second or two answers every measure, and the parity suite runs the CLI on each.
 */
export function goldenSounds() {
  const rate = 48000;
  const tone = sine(1000, 2, rate, 10 ** (-23 / 20));
  // a rising fundamental whose second and third harmonics are louder than it
  const f0 = (i) => 110 * 2 ** (i / rate / 2);
  const engine = new Float64Array(2 * rate);
  for (let i = 0, ph = 0; i < engine.length; i++) { ph += (2 * Math.PI * f0(i)) / rate; engine[i] = 0.2 * Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph); }
  // three decaying hits in light noise
  const hits = gaussian(2 * rate, 4, 0.001);
  for (const s of [0.25, 0.8, 1.31]) {
    const i0 = Math.round(s * rate);
    for (let i = 0; i < 4800; i++) hits[i0 + i] += 0.5 * Math.sin((2 * Math.PI * 660 * i) / rate) * Math.exp((-30 * i) / rate);
  }
  // noise under a slow swell, and the same 50 ms later at half the level
  const n = 2 * rate;
  const noise = gaussian(n, 3, 0.2).map((v, i) => v * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate)));
  const late = new Float64Array(n).map((_, i) => (i >= 2400 ? 0.5 * noise[i - 2400] : 0));
  // and a copy through a 1 kHz second-order low-pass
  const dull = new Float64Array(n);
  const k = Math.tan((Math.PI * 1000) / rate), q = Math.SQRT1_2, norm = 1 / (1 + k / q + k * k);
  const [b0, b1, b2, a1, a2] = [k * k * norm, 2 * k * k * norm, k * k * norm, 2 * (k * k - 1) * norm, (1 - k / q + k * k) * norm];
  for (let i = 0, z1 = 0, z2 = 0; i < n; i++) { const y = b0 * noise[i] + z1; z1 = b1 * noise[i] - a1 * y + z2; z2 = b2 * noise[i] - a2 * y; dull[i] = y; }
  const gap = Float64Array.from([...new Float64Array(rate / 4), ...sine(300, 0.5, rate, 0.3), ...new Float64Array(rate / 2)]);
  return {
    tone: { rate, channels: [tone, tone] },
    a220: { rate: 44100, channels: [sine(220, 1, 44100, 0.5)] },
    engine: { rate, channels: [engine] },
    hits: { rate, channels: [hits] },
    noise: { rate, channels: [noise] },
    late: { rate, channels: [late] },
    dull: { rate, channels: [dull] },
    gap: { rate, channels: [gap] },
    dc: { rate, channels: [sine(200, 1, rate, 0.1).map((v) => v + 0.05)] },
  };
}
