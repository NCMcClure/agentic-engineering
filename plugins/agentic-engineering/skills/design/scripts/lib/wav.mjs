// Sound in, as floats in -1..1, one Float32Array per channel. A WAV file of
// PCM (u8, s16, s24, s32) or float (32, 64) samples is read here, including
// WAVE_FORMAT_EXTENSIBLE, odd-sized chunks with their pad byte, and a data
// size of 0 or 0xFFFFFFFF, which is how a stream that could not seek back
// writes it: the samples then run to the end of the file. Anything else (a
// FLAC, an MP3, a video's sound track, a WAV in another codec) goes through
// ffmpeg as float32 WAV first. Integers scale as libsndfile scales them, by
// the full range of the container: s16 is v / 32768, u8 is (v - 128) / 128.
import fs from "node:fs";
import path from "node:path";
import { PlError } from "./args.mjs";
import { transcodeToWav } from "./ffmpeg.mjs";

/** The suffixes a shot's sound may have, the first found wins: <source>.wav, then the rest through ffmpeg. */
export const SOUND_SUFFIXES = [".wav", ".flac", ".ogg", ".opus", ".mp3", ".m4a", ".aac"];

const PCM = 1, FLOAT = 3, EXTENSIBLE = 0xfffe;

/** A reason the reader does not handle, so the caller may hand the file to ffmpeg. */
const unsupported = (message) => Object.assign(new PlError(message), { unsupported: true });

/** RIFF (or RF64) with the WAVE form type. */
export function isWav(buf) {
  if (buf.length < 12) return false;
  const magic = buf.toString("latin1", 0, 4);
  return (magic === "RIFF" || magic === "RF64") && buf.toString("latin1", 8, 12) === "WAVE";
}

function readFmt(b, name) {
  if (b.length < 16) throw new PlError(`${name}: the fmt chunk is ${b.length} bytes, shorter than 16`);
  const fmt = { tag: b.readUInt16LE(0), channels: b.readUInt16LE(2), rate: b.readUInt32LE(4), blockAlign: b.readUInt16LE(12), bits: b.readUInt16LE(14), extensible: false };
  if (fmt.tag === EXTENSIBLE) {
    if (b.length < 40) throw new PlError(`${name}: an extensible fmt chunk is ${b.length} bytes, shorter than 40`);
    // the sub-format GUID begins with the plain format tag
    Object.assign(fmt, { tag: b.readUInt16LE(24), extensible: true, validBits: b.readUInt16LE(18) });
  }
  return fmt;
}

const READERS = {
  [`${PCM}:1`]: ["u8", (v, i) => (v.getUint8(i) - 128) / 128],
  [`${PCM}:2`]: ["s16", (v, i) => v.getInt16(i, true) / 32768],
  [`${PCM}:3`]: ["s24", (v, i) => ((v.getUint8(i) | (v.getUint8(i + 1) << 8) | (v.getInt8(i + 2) << 16))) / 8388608],
  [`${PCM}:4`]: ["s32", (v, i) => v.getInt32(i, true) / 2147483648],
  [`${FLOAT}:4`]: ["float32", (v, i) => v.getFloat32(i, true)],
  [`${FLOAT}:8`]: ["float64", (v, i) => v.getFloat64(i, true)],
};

/**
 * A WAV file's samples: { rate, channels, frames, format, data: [Float32Array per channel] }. `format`
 * names the sample type ("s16", "float32", ...), with "extensible" after it when the fmt chunk was.
 * Throws a PlError marked `unsupported` for a file that is not a WAV or a codec this reader does not know,
 * and a plain PlError for a WAV that is broken.
 */
export function parseWav(buf, name = "sound") {
  if (!isWav(buf)) throw unsupported(`${name} is not a WAV file`);
  let fmt = null, body = null;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString("latin1", at, at + 4), size = buf.readUInt32LE(at + 4), start = at + 8;
    if (id === "fmt ") fmt = readFmt(buf.subarray(start, Math.min(buf.length, start + size)), name);
    else if (id === "data") {
      const toEnd = size === 0 || size === 0xffffffff || start + size > buf.length;
      body = buf.subarray(start, toEnd ? buf.length : start + size);
      if (toEnd) break;
    }
    at = start + size + (size & 1);
  }
  if (!fmt) throw new PlError(`${name}: a WAV file with no fmt chunk`);
  if (!body) throw new PlError(`${name}: a WAV file with no data chunk`);
  if (!fmt.channels || !fmt.rate) throw new PlError(`${name}: the fmt chunk says ${fmt.channels} channels at ${fmt.rate} Hz`);
  const width = fmt.blockAlign / fmt.channels;
  const reader = READERS[`${fmt.tag}:${width}`];
  if (!Number.isInteger(width) || !reader) {
    throw unsupported(`${name} is a WAV file with format tag ${fmt.tag} and ${fmt.bits}-bit samples, which this reader does not decode`);
  }
  const [kind, read] = reader;
  const frames = Math.floor(body.length / fmt.blockAlign);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const data = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0, at = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++, at += width) data[c][i] = read(view, at);
  }
  return { rate: fmt.rate, channels: fmt.channels, frames, format: fmt.extensible ? `${kind} extensible` : kind, data };
}

function head(file, n) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(n);
    return buf.subarray(0, fs.readSync(fd, buf, 0, n, 0));
  } finally { fs.closeSync(fd); }
}

/**
 * A sound file read as parseWav reads a WAV, plus `file`: a WAV this reader decodes directly, anything else
 * through ffmpeg (exit 2 naming the remedies when it is missing). A file with no samples is an error.
 */
export function readSound(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new PlError(`no such file: ${file}`);
  let sound;
  // only the first bytes decide, so a long video is never read whole just to learn it is not a WAV
  if (isWav(head(file, 12))) {
    try { sound = parseWav(fs.readFileSync(file), file); } catch (e) {
      if (!e.unsupported) throw e;
      sound = parseWav(transcodeToWav(file, e.message), file);
    }
  } else sound = parseWav(transcodeToWav(file, `${file} is not a WAV file`), file);
  if (!sound.frames) throw new PlError(`${file} holds no samples`);
  return { ...sound, file };
}

/** The mean of the channels, one Float32Array. */
export function mono({ data }) {
  if (data.length === 1) return data[0];
  const out = new Float32Array(data[0].length);
  for (const ch of data) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  for (let i = 0; i < out.length; i++) out[i] /= data.length;
  return out;
}

/** A shot's sound of one source: <source>.wav in the shot folder, else another sound suffix, else null. */
export function soundOf(shotDir, source) {
  for (const ext of SOUND_SUFFIXES) {
    const file = path.join(shotDir, source + ext);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* not this one */ }
  }
  return null;
}
