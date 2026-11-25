// ffmpeg, the one external tool: found on PATH or named by PL_FFMPEG
// (PL_FFPROBE for ffprobe). It turns a picture that is not a PNG into one,
// and a sound that is not a WAV into a float32 WAV, through a pipe, so the PNG
// decoder and the WAV reader read everything; it says what a video
// file is (probe); and it decodes a clip as rawvideo rgb24 at the size asked
// for, which is read one frame at a time, so a long clip never sits in memory.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PlError } from "./args.mjs";

function findExe(name, envVar) {
  const named = process.env[envVar];
  if (named) return fs.existsSync(named) ? named : null;
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

export const ffmpegPath = () => findExe("ffmpeg", "PL_FFMPEG");
export const ffprobePath = () => findExe("ffprobe", "PL_FFPROBE");

/** The ffmpeg executable, or exit 2 naming what needed it and both remedies. */
export function needFfmpeg(neededFor) {
  const exe = ffmpegPath();
  if (exe) return exe;
  throw new PlError(`${neededFor} needs ffmpeg, which was not found. Install it (brew install ffmpeg, apt install ffmpeg, `
    + "winget install ffmpeg) or point PL_FFMPEG at it. A folder of PNG frames needs no ffmpeg.");
}

const lastLine = (text) => String(text ?? "").trim().split("\n").at(-1);

/** The first frame of any picture ffmpeg reads, as PNG bytes (8-bit RGB). */
export function transcodeToPng(file) {
  const exe = ffmpegPath();
  if (!exe) {
    throw new PlError(`${file} is not a PNG, and reading it needs ffmpeg, which was not found. `
      + "Either install ffmpeg (or point PL_FFMPEG at it), or convert the picture to PNG first.");
  }
  const r = spawnSync(exe, ["-v", "error", "-nostdin", "-i", file, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "image2pipe", "-c:v", "png", "-"],
    { maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0 || !r.stdout?.length) {
    throw new PlError(`ffmpeg could not read ${file}: ${lastLine(r.stderr ?? r.error?.message) || `exit ${r.status}`}`);
  }
  return r.stdout;
}

/**
 * The sound of any file ffmpeg reads (a FLAC, an MP3, a video's sound track) as the bytes of a float32 WAV,
 * through a pipe, so the WAV reader reads everything. `why` says why the reader passed it on. A stream to a
 * pipe cannot seek back to write its sizes, so the data size is a placeholder the reader treats as "to the end".
 */
export function transcodeToWav(file, why) {
  const exe = ffmpegPath();
  if (!exe) {
    throw new PlError(`${why}, and reading it needs ffmpeg, which was not found. Install it (brew install ffmpeg, apt install ffmpeg, `
      + "winget install ffmpeg) or point PL_FFMPEG at it, or convert the sound to a PCM or float WAV first.");
  }
  const r = spawnSync(exe, ["-v", "error", "-nostdin", "-i", file, "-vn", "-c:a", "pcm_f32le", "-f", "wav", "-"], { maxBuffer: 2 ** 31 - 1 });
  if (r.error || r.status !== 0 || !r.stdout?.length) {
    throw new PlError(`ffmpeg found no sound in ${file}: ${lastLine(r.stderr ?? r.error?.message) || `exit ${r.status}`}`);
  }
  return r.stdout;
}

/** "30000/1001" or "25" as a number; 0 when it is not one. */
function rate(text) {
  const [a, b = "1"] = String(text ?? "0").split("/");
  const v = Number(a) / Number(b);
  return Number.isFinite(v) ? v : 0;
}

/**
 * What a video file is: { file, duration (s), fps, size: [w, h], frames, codec, hasAudio }. With ffprobe the
 * frame count is the number of video packets (exact for every common codec, and nothing is decoded); without
 * it, duration x fps read from ffmpeg's banner, marked `frameCountEstimated`.
 */
export function probe(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new PlError(`no such file: ${file}`);
  const fp = ffprobePath();
  if (fp) {
    const r = spawnSync(fp, ["-v", "error", "-count_packets", "-show_entries",
      "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_packets:format=duration", "-of", "json", file], { encoding: "utf8" });
    if (r.error || r.status !== 0) throw new PlError(`ffprobe could not read ${file}: ${lastLine(r.stderr ?? r.error?.message) || `exit ${r.status}`}`);
    const doc = JSON.parse(r.stdout || "{}");
    const streams = doc.streams ?? [];
    const v = streams.find((s) => s.codec_type === "video");
    if (!v) throw new PlError(`${file} has no video stream`);
    return {
      file, duration: Number(Number(doc.format?.duration ?? 0).toFixed(4)), fps: Number((rate(v.avg_frame_rate) || rate(v.r_frame_rate)).toFixed(4)),
      size: [Number(v.width), Number(v.height)], frames: Number(v.nb_read_packets ?? 0), codec: v.codec_name ?? null,
      hasAudio: streams.some((s) => s.codec_type === "audio"),
    };
  }
  // ffmpeg with no output file exits 1, and the facts are on stderr
  const r = spawnSync(needFfmpeg("probing a video file"), ["-hide_banner", "-nostdin", "-i", file], { encoding: "utf8" });
  const err = r.stderr ?? "";
  const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(err);
  const vid = /Video:\s*(\w+).*?\b(\d{2,5})x(\d{2,5})\b.*?([\d.]+)\s*fps/.exec(err);
  if (!vid) throw new PlError(`ffmpeg found no video stream in ${file}${lastLine(err) ? `: ${lastLine(err)}` : ""}`);
  const duration = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  const fps = Number(vid[4]);
  return { file, duration: Number(duration.toFixed(4)), fps, size: [Number(vid[2]), Number(vid[3])], frames: Math.round(duration * fps),
    frameCountEstimated: true, codec: vid[1], hasAudio: err.includes("Audio:") };
}

/**
 * The ffmpeg filter that keeps frames by their number n in the clip: every Nth from `first` to `last`, or the
 * listed numbers. Commas inside a filter's arguments are escaped, since a bare comma separates filters.
 */
export function selectFilter({ every = 1, first = 0, last = null, at = null } = {}) {
  if (at) return `select=${at.map((n) => `eq(n\\,${n})`).join("+")}`;
  const range = last === null ? `gte(n\\,${first})` : `between(n\\,${first}\\,${last})`;
  return `select=${range}${every > 1 ? `*not(mod(n-${first}\\,${every}))` : ""}`;
}

// The kept frames must not be re-timed to a constant rate, or ffmpeg duplicates frames to fill the gaps. The
// flag for that was renamed in ffmpeg 5.1: the new spelling first, then the old one for an older ffmpeg.
const SYNC = [["-fps_mode", "vfr"], ["-vsync", "vfr"]];
const OLD_FFMPEG = /fps_mode|Unrecognized option|Option not found/i;

/**
 * A clip decoded as rawvideo rgb24 at width x height (scaled with the area filter), one frame at a time:
 * an async iterator of Uint8Array(width * height * 3). `filter` picks the frames (selectFilter, or fps=F).
 * Leaving the loop early stops ffmpeg.
 */
export async function* rawFrames(file, { filter = null, width, height }) {
  const exe = needFfmpeg("reading a video file");
  const bytes = width * height * 3;
  const vf = `${filter ? `${filter},` : ""}scale=${width}:${height}:flags=area`;
  for (const [n, sync] of SYNC.entries()) {
    const child = spawn(exe, ["-v", "error", "-nostdin", "-i", file, "-vf", vf, ...sync, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d) => { stderr += d; });
    const closed = new Promise((resolve) => {
      child.on("error", (e) => resolve({ code: null, error: e }));
      child.on("close", (code) => resolve({ code }));
    });
    let frame = new Uint8Array(bytes), at = 0, count = 0;
    try {
      for await (const chunk of child.stdout) {
        for (let off = 0; off < chunk.length;) {
          const take = Math.min(bytes - at, chunk.length - off);
          frame.set(chunk.subarray(off, off + take), at);
          at += take; off += take;
          if (at === bytes) { count++; yield frame; frame = new Uint8Array(bytes); at = 0; }
        }
      }
      const { code, error } = await closed;
      if (code === 0) return;
      if (count === 0 && n === 0 && OLD_FFMPEG.test(stderr)) continue;
      throw new PlError(`ffmpeg could not decode ${file}: ${lastLine(stderr) || error?.message || `exit ${code}`}`);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  }
}

/**
 * Frames of a video written by ffmpeg as PNG files `<dir>/%06d.png`, numbered from 0 in the order kept:
 * `filter` picks them (selectFilter, or fps=F). Returns the files written, in order.
 */
export function writePngFrames(file, dir, { filter = null } = {}) {
  const exe = needFfmpeg("extracting frames");
  fs.mkdirSync(dir, { recursive: true });
  let r;
  for (const [n, sync] of SYNC.entries()) {
    r = spawnSync(exe, ["-v", "error", "-nostdin", "-y", "-i", file, ...(filter ? ["-vf", filter] : []), ...sync, "-start_number", "0",
      path.join(dir, "%06d.png")], { encoding: "utf8" });
    if (r.status === 0) break;
    if (!(n === 0 && OLD_FFMPEG.test(r.stderr ?? ""))) break;
  }
  if (r.error || r.status !== 0) throw new PlError(`ffmpeg could not extract frames of ${file}: ${lastLine(r.stderr ?? r.error?.message) || `exit ${r.status}`}`);
  return fs.readdirSync(dir).filter((f) => /^\d{6}\.png$/.test(f)).sort().map((f) => path.join(dir, f));
}

/** One frame at `t` seconds, written as a PNG file. */
export function writePngAt(file, t, dest) {
  const exe = needFfmpeg("extracting frames");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = spawnSync(exe, ["-v", "error", "-nostdin", "-y", "-ss", t.toFixed(6), "-i", file, "-frames:v", "1", dest], { encoding: "utf8" });
  if (r.error || r.status !== 0 || !fs.existsSync(dest)) {
    throw new PlError(`ffmpeg could not read a frame at ${t} s of ${file}: ${lastLine(r.stderr ?? r.error?.message) || "past the end?"}`);
  }
  return dest;
}
