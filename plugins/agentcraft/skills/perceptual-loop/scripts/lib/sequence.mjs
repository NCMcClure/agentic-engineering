// A clip as one frame source, whatever it is on disk: a folder of pictures
// read in name order, a video file decoded through ffmpeg, or one picture.
// Frames arrive one at a time as RGB8 at the size asked for (the area mean
// when shrinking), each with its number in the clip and its time, so every
// motion command reads a clip the same way and a long one never sits in memory.
//
// A frame's number is its index in a video (from 0). In a folder it is the
// number in the file name when every name is a number, so frame 17 is the file
// 000017.png and a contact sheet of the folder says the same, else its
// position in name order (from 0).
import fs from "node:fs";
import path from "node:path";
import { PlError } from "./args.mjs";
import { probe, rawFrames, selectFilter } from "./ffmpeg.mjs";
import { readImage, resize } from "./image.mjs";
import { IMAGE_SUFFIXES } from "./sheets.mjs";

export const VIDEO_SUFFIXES = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi", ".gif"]);

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** w x h brought down so the long side is at most `size` (never up), each side at least 1. */
export function fitSize(width, height, size) {
  if (!size || Math.max(width, height) <= size) return [width, height];
  const s = size / Math.max(width, height);
  return [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))];
}

/** Rec.709 luma of display-encoded values, in 0..1: what a step of brightness looks like, not what the light is. */
export function lumaPlane({ width, height, data }) {
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
  return out;
}

/** A shot's clip of one source: the folder frames/<source>/, else <source>.mp4 (or another video suffix), else null. */
export function clipOf(shotDir, source) {
  const folder = path.join(shotDir, "frames", source);
  if (isDir(folder)) return folder;
  for (const ext of VIDEO_SUFFIXES) if (isFile(path.join(shotDir, source + ext))) return path.join(shotDir, source + ext);
  return null;
}

function folderEntries(dir) {
  const files = fs.readdirSync(dir).filter((f) => IMAGE_SUFFIXES.has(path.extname(f).toLowerCase())).sort();
  const stems = files.map((f) => path.basename(f, path.extname(f)));
  const numbered = stems.every((s) => /^\d+$/.test(s)) && new Set(stems.map(Number)).size === stems.length;
  return files.map((f, i) => ({ index: numbered ? Number(stems[i]) : i, file: path.join(dir, f) }));
}

/**
 * Open a clip: { kind: "frames" | "video" | "image", label, fps, total, width, height, frames(opts) }.
 * `rate` gives a folder of frames its frames per second (a video's own rate is read from it).
 * frames({ every, first, last, at, size, dims }) is an async iterator of { index, t, img, file? }: every Nth
 * frame numbered `first` to `last`, or the numbers listed in `at`, at `dims` ([w, h]) or with the long side at
 * most `size`. In a folder `every` counts files; in a video it counts frame numbers, which is the same thing.
 */
export function openSequence(input, { rate = null, what = "input" } = {}) {
  if (!input) throw new PlError(`${what}: give a video file or a folder of frames`);
  const label = String(input);
  if (isDir(input)) {
    const entries = folderEntries(input);
    if (!entries.length) throw new PlError(`${what}: no pictures (png, jpg, ...) in ${input}`);
    const head = readImage(entries[0].file);
    return sequence({ kind: "frames", label, fps: rate, total: entries.length, width: head.width, height: head.height, entries });
  }
  if (!isFile(input)) throw new PlError(`${what}: no such file or folder: ${input}`);
  const ext = path.extname(input).toLowerCase();
  if (IMAGE_SUFFIXES.has(ext)) {
    const head = readImage(input);
    return sequence({ kind: "image", label, fps: rate, total: 1, width: head.width, height: head.height, entries: [{ index: 0, file: input }] });
  }
  const info = probe(input);
  return sequence({ kind: "video", label, fps: info.fps || rate, total: info.frames, width: info.size[0], height: info.size[1], file: input, info });
}

function sequence(seq) {
  const timeOf = (index) => (seq.fps ? index / seq.fps : null);
  seq.frames = async function* frames({ every = 1, first = 0, last = null, at = null, size = null, dims = null } = {}) {
    const [w, h] = dims ?? fitSize(seq.width, seq.height, size);
    every = Math.max(1, every);
    if (seq.kind !== "video") {
      let picked;
      if (at) picked = seq.entries.filter((e) => at.includes(e.index));
      else picked = seq.entries.filter((e) => e.index >= first && (last === null || e.index <= last)).filter((_, k) => k % every === 0);
      for (const e of picked) {
        const img = readImage(e.file);
        yield { index: e.index, t: timeOf(e.index), file: e.file, img: img.width === w && img.height === h ? img : resize(img, w, h, { area: true }) };
      }
      return;
    }
    const wanted = at ? [...new Set(at)].filter((n) => n >= 0).sort((a, b) => a - b) : null;
    if (wanted && !wanted.length) return;
    const plain = !wanted && every === 1 && first === 0 && last === null;
    let k = 0;
    for await (const data of rawFrames(seq.file, { filter: plain ? null : selectFilter({ every, first, last, at: wanted }), width: w, height: h })) {
      const index = wanted ? wanted[k] : first + k * every;
      k++;
      yield { index, t: timeOf(index), img: { width: w, height: h, channels: 3, data } };
    }
  };
  return seq;
}

/** Every frame the options pick, in an array. For the commands that need the whole clip at once. */
export async function collect(seq, opts) {
  const out = [];
  for await (const f of seq.frames(opts)) out.push(f);
  return out;
}

/** "#17  1.42 s": a frame's number, and its time when the clip has a rate. */
export const frameCaption = (f) => `#${f.index}${f.t !== null && f.t !== undefined ? `  ${f.t.toFixed(2)} s` : ""}`;
