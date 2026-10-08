# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "scipy>=1.10", "soundfile>=0.12", "Pillow>=10.1"]
# ///
"""audio.py: sound as numbers and pictures an agent can check.

  probe        rate, channels, duration, peak, RMS, integrated loudness (LUFS)
  silence      the cheap sanity checks: silent? clipped? DC offset? leading / trailing silence
  spectrogram  a log-frequency, dB-scaled picture with labelled axes (optionally the pitch track on top)
  pitch        the fundamental frequency over time (YIN), against an expected frequency or curve
  onsets       when sounds start (spectral flux), against expected times
  compare      B against A: lag, level difference, log-spectral distance, octave-band differences, envelope match

A sound is a file (wav, flac, ogg …; a video's audio track when ffmpeg is installed) or a shot's sound
(`--shot NAME --source S`: <source>.wav in the shot folder). numpy + scipy only: no librosa.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import csv
import math
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import video as V  # noqa: E402


# ------------------------------------------------------------------------------------------------------------ input

def resolve(path: str | None, args, source: str | None = None, what: str = "sound") -> Path:
    if path:
        p = Path(path)
    elif getattr(args, "audio", None) and source is None:
        p = Path(args.audio)
    elif args.shot:
        src = source or V.default_source(args)
        p = pl.shot_path(args.shot) / f"{src}.wav"
        if not p.is_file():
            pl.fail(f"shot '{args.shot}' has no sound of source '{src}' (looked for {p})")
    else:
        pl.fail(f"{what}: give a file, --audio FILE, or --shot NAME --source S")
    if not p.is_file():
        pl.fail(f"no such file: {p}")
    return p


def load(path: Path):
    """-> (samples as float64 [n, channels] in -1..1, rate). A file libsndfile cannot read (mp4, mkv, aac) goes
    through ffmpeg first."""
    import soundfile as sf

    try:
        x, rate = sf.read(str(path), dtype="float64", always_2d=True)
    except Exception as e:  # noqa: BLE001  (soundfile raises its own LibsndfileError or RuntimeError by version)
        ff = V.ffmpeg_exe(f"reading the sound of {path.name} ({e})")
        tmp = V.temp_dir() / "audio.wav"
        r = V._run([ff, "-v", "error", "-y", "-i", str(path), "-vn", "-c:a", "pcm_f32le", str(tmp)])
        if r.returncode != 0:
            pl.fail(f"ffmpeg found no sound in {path}: {r.stderr.strip()}")
        x, rate = sf.read(str(tmp), dtype="float64", always_2d=True)
    if len(x) == 0:
        pl.fail(f"{path} holds no samples")
    return x, int(rate)


def db(v: float) -> float:
    return 20 * math.log10(max(float(v), 1e-12))


def r(v: float | None, n: int = 3) -> float | None:
    return None if v is None or math.isnan(v) or math.isinf(v) else round(float(v), n)


# --------------------------------------------------------------------------------------------------------- loudness

def lufs(x, rate: int) -> float | None:
    """Integrated loudness after ITU-R BS.1770-4: K-weighting (a high shelf, then a high-pass, as biquads derived
    for this sample rate), mean square in 400 ms blocks with 75 % overlap, the absolute gate at -70 LUFS and the
    relative gate 10 LU under the ungated mean. Channel weights: 1 for the first three, 1.41 for surrounds of a
    5.1 layout (LFE left out). Sample peak, not true peak, is what `probe` reports beside it."""
    import numpy as np
    from scipy.signal import lfilter

    def biquad(fc: float, q: float, gain_db: float | None):
        # the standard prints coefficients for 48 kHz only; these are the analogue prototypes they come from
        # (De Man's derivation), so any sample rate gets the same curve
        k = math.tan(math.pi * fc / rate)
        a0 = 1 + k / q + k * k
        a = [1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
        if gain_db is None:  # high-pass
            return np.array([1.0, -2.0, 1.0]), np.array(a)
        vh = 10 ** (gain_db / 20)
        vb = vh ** 0.4996667741545416
        return np.array([(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]), np.array(a)

    block, hop = int(0.4 * rate), int(0.1 * rate)
    if len(x) < block:
        return None
    y = x
    for f in (biquad(1681.974450955533, 0.7071752369554196, 3.999843853973347), biquad(38.13547087602444, 0.5003270373238773, None)):
        y = lfilter(*f, y, axis=0)
    ch = x.shape[1]
    g = np.array(([1, 1, 1, 0, 1.41, 1.41] + [1.41] * ch)[:ch]) if ch >= 5 else np.ones(ch)
    cs = np.vstack([np.zeros(ch), np.cumsum(y * y, axis=0)])
    starts = np.arange(0, len(x) - block + 1, hop)
    z = (cs[starts + block] - cs[starts]) / block  # mean square per block and channel
    loud = -0.691 + 10 * np.log10(np.maximum((z * g).sum(1), 1e-20))
    keep = loud > -70
    if not keep.any():
        return -math.inf
    rel = -0.691 + 10 * math.log10((z[keep] * g).sum(1).mean()) - 10
    keep &= loud > rel
    return float(-0.691 + 10 * math.log10((z[keep] * g).sum(1).mean()))


# ------------------------------------------------------------------------------------------------------------ pitch

def yin(x, rate: int, fmin: float, fmax: float, hop_s: float = 0.01, threshold: float = 0.15):
    """Fundamental frequency per frame by YIN (de Cheveigné & Kawahara 2002): the lag at which the signal best
    repeats, from the cumulative-mean-normalised difference function, refined by a parabola. Chosen over a plain
    autocorrelation peak because it does not favour the octave below, and over a spectral peak because the
    fundamental of an engine or a voice is often weaker than its harmonics.
    -> (times, hz, confidence = 1 - the normalised difference at that lag; near 1 = clearly periodic)"""
    import numpy as np
    from scipy.signal import resample_poly

    dec = max(1, rate // 16000) if fmax <= 2500 else 1  # lags are long enough at 16 kHz; the parabola gives the rest
    if dec > 1:
        x, rate = resample_poly(x, 1, dec), rate // dec
    tmax, tmin = int(rate / fmin) + 2, max(2, int(rate / fmax))
    w = 2 * tmax  # integrate over two periods of the lowest pitch
    length, hop = w + tmax, max(1, int(hop_s * rate))
    if len(x) < length + 1:
        x = np.pad(x, (0, length + 1 - len(x)))
    starts = np.arange(0, len(x) - length, hop)
    nfft = 1 << (length - 1).bit_length()
    times, hz, conf = (starts + w / 2) / rate, np.full(len(starts), np.nan), np.zeros(len(starts))
    for k, s in enumerate(starts):
        fr = x[s:s + length]
        cs = np.concatenate([[0.0], np.cumsum(fr * fr)])
        if cs[w] / w < 1e-9:  # silence has no pitch
            continue
        corr = np.fft.irfft(np.fft.rfft(fr, nfft) * np.conj(np.fft.rfft(fr[:w], nfft)), nfft)[:tmax + 1]
        d = cs[w] + (cs[w:w + tmax + 1] - cs[:tmax + 1]) - 2 * corr  # sum over the window of (x[j] - x[j + lag])^2
        cm = np.ones(tmax + 1)
        cm[1:] = d[1:] * np.arange(1, tmax + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
        seg = cm[tmin:tmax]
        below = np.flatnonzero(seg < threshold)
        i = int(below[0]) if len(below) else int(seg.argmin())
        while i + 1 < len(seg) and seg[i + 1] < seg[i]:  # the first dip under the threshold, followed to its bottom
            i += 1
        t = i + tmin
        if 1 <= t < tmax:
            a, b, c = cm[t - 1], cm[t], cm[t + 1]
            den = a - 2 * b + c
            off = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
            t = t + max(-1.0, min(1.0, off))
        hz[k], conf[k] = rate / t, max(0.0, 1.0 - float(seg[i]))
    return times, hz, conf


def read_curve(path: str) -> tuple[list[float], list[float]]:
    rows = []
    for row in csv.reader(Path(path).read_text(encoding="utf-8-sig").splitlines()):
        try:
            rows.append((float(row[0]), float(row[1])))
        except (ValueError, IndexError):
            continue  # a header or an empty line
    if not rows:
        pl.fail(f"{path}: expected rows of time,hz")
    rows.sort()
    return [a for a, _ in rows], [b for _, b in rows]


# ------------------------------------------------------------------------------------------------------ spectrogram

MAGMA = [(0, 0, 4), (40, 11, 84), (101, 21, 110), (159, 42, 99), (212, 72, 66), (245, 125, 21), (250, 193, 39), (252, 255, 164)]


def stft_power(x, rate: int, nfft: int, hop: int):
    from scipy.signal import stft

    if len(x) < nfft:
        import numpy as np

        x = np.pad(x, (0, nfft - len(x)))
    f, t, z = stft(x, rate, window="hann", nperseg=nfft, noverlap=nfft - hop, boundary=None, padded=False)
    return f, t, (z.real ** 2 + z.imag ** 2)


def spectrogram_image(x, rate: int, title: str, max_width: int, db_range: float, fmin: float, track=None):
    """Frequency on a log axis (pitch and harmonics are evenly spaced to the ear, and a linear axis spends most
    of the picture above 5 kHz), level in dB under the loudest bin of the file."""
    import numpy as np
    from PIL import Image, ImageDraw

    nfft = 1 << round(math.log2(rate * 0.085))  # about 85 ms: 12 Hz bins, enough to part low harmonics
    hop = max(1, min(nfft // 8, len(x) // 1200 or 1))
    f, t, p = stft_power(x, rate, nfft, hop)
    level = 10 * np.log10(np.maximum(p, 1e-20))
    level = np.clip(level - level.max(), -db_range, 0)
    fmax = min(rate / 2, 20000.0)
    left, right, top, bottom, rows = 62, 14, 28, 34, 380
    width = max(200, min(max_width, 1600) - left - right)
    edges = np.geomspace(fmin, fmax, rows + 1) / (rate / nfft)  # row boundaries, in bins
    img = np.empty((rows, level.shape[1]))
    for i in range(rows):
        lo, hi = edges[i], edges[i + 1]
        if hi - lo >= 1:  # several bins in the row: keep the loudest, so a thin harmonic is not skipped
            img[i] = level[int(lo):int(math.ceil(hi)) + 1].max(0)
        else:  # the row is thinner than a bin: interpolate
            c = (lo + hi) / 2
            j = min(int(c), level.shape[0] - 2)
            img[i] = level[j] * (1 - (c - j)) + level[j + 1] * (c - j)
    cols = np.minimum((np.arange(width) * img.shape[1] / width).astype(int), img.shape[1] - 1)
    if img.shape[1] > width:  # more frames than pixels: the loudest of each pixel's frames
        b = np.linspace(0, img.shape[1], width + 1).astype(int)
        img = np.stack([img[:, b[i]:max(b[i] + 1, b[i + 1])].max(1) for i in range(width)], 1)
    else:
        img = img[:, cols]
    lut = np.array(MAGMA, dtype=np.float64)
    v = (img[::-1] + db_range) / db_range * (len(lut) - 1)
    i0 = np.clip(v.astype(int), 0, len(lut) - 2)
    rgb = (lut[i0] * (1 - (v - i0))[..., None] + lut[i0 + 1] * (v - i0)[..., None]).astype(np.uint8)
    out = Image.new("RGB", (left + width + right, top + rows + bottom), V.BG)
    out.paste(Image.fromarray(rgb), (left, top))
    dr = ImageDraw.Draw(out)
    dur = len(x) / rate
    X = lambda s: left + width * s / dur  # noqa: E731
    Y = lambda hz: top + rows * (1 - math.log(hz / fmin) / math.log(fmax / fmin))  # noqa: E731
    dr.text((left, 6), f"{title}    0 dB = loudest bin, black = {-db_range:g} dB or less", fill=V.DIM, font=V.font(13))
    for hz in (20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000):
        if fmin <= hz <= fmax:
            dr.line([left - 4, Y(hz), left, Y(hz)], fill=V.DIM)
            dr.text((6, Y(hz) - 7), f"{hz // 1000}k Hz" if hz >= 1000 else f"{hz} Hz", fill=V.FG, font=V.font(12))
    step = next(s for s in (0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 10 ** 9) if dur / s <= 12)
    for k in range(int(dur / step) + 1):
        dr.line([X(k * step), top + rows, X(k * step), top + rows + 4], fill=V.DIM)
        dr.text((X(k * step) - 8, top + rows + 7), f"{k * step:g}", fill=V.FG, font=V.font(12))
    dr.text((left + width - 52, top + rows + 19), "seconds", fill=V.DIM, font=V.font(12))
    if track is not None:
        for s, hz in zip(*track):
            if not math.isnan(hz) and fmin <= hz <= fmax:
                dr.ellipse([X(s) - 1.5, Y(hz) - 1.5, X(s) + 1.5, Y(hz) + 1.5], fill=(90, 255, 235))
        dr.text((left + width - 190, 6), "dots: fundamental (YIN)", fill=(90, 255, 235), font=V.font(13))
    return out


# --------------------------------------------------------------------------------------------------------- commands

def cmd_probe(args):
    import numpy as np

    path = resolve(args.file, args)
    x, rate = load(path)
    peak, rms, loud = float(np.abs(x).max()), float(np.sqrt((x ** 2).mean())), lufs(x, rate)
    doc = {"file": str(path), "rate": rate, "channels": x.shape[1], "samples": len(x), "duration": r(len(x) / rate, 4),
           "peakDb": r(db(peak), 2), "rmsDb": r(db(rms), 2), "lufs": r(loud, 2), "loudnessMethod": "ITU-R BS.1770-4, K-weighted, gated; sample peak (not true peak)"}
    loud_s = "n/a (shorter than 0.4 s)" if loud is None else ("below -70 (silent)" if math.isinf(loud) else f"{loud:.1f} LUFS")
    text = (f"{path}\n  {rate} Hz  {x.shape[1]} ch  {len(x) / rate:.3f} s\n  peak {db(peak):.2f} dBFS   RMS {db(rms):.2f} dBFS   integrated loudness {loud_s}")
    return doc, text, 0


def cmd_silence(args):
    import numpy as np

    path = resolve(args.file, args)
    x, rate = load(path)
    m = x.mean(1)
    win = max(1, int(0.02 * rate))
    n = len(m) // win
    frames = np.sqrt((m[:n * win].reshape(n, win) ** 2).mean(1)) if n else np.array([np.sqrt((m ** 2).mean())])
    quiet = 20 * np.log10(np.maximum(frames, 1e-12)) < args.silence_db
    loud_idx = np.flatnonzero(~quiet)
    hot = np.abs(x) >= args.clip_level
    # a run of full-scale samples is a flat top; a single one is just a peak that touches the ceiling
    run3 = hot[:-2] & hot[1:-1] & hot[2:] if len(x) > 2 else hot[:0]
    dc = x.mean(0)
    rms = float(np.sqrt((x ** 2).mean()))
    problems = []
    if db(rms) < args.silence_db:
        problems.append(f"silent (RMS {db(rms):.1f} dBFS < {args.silence_db:g})")
    if run3.any():
        problems.append(f"clipped ({int(hot.sum())} samples at full scale, in runs of 3 or more)")
    if float(np.abs(dc).max()) > args.max_dc:
        problems.append(f"DC offset {float(dc[np.abs(dc).argmax()]):+.4f} (> {args.max_dc:g})")
    if args.expect_silent:
        problems = [] if db(rms) < args.silence_db else [f"expected silence, but RMS is {db(rms):.1f} dBFS"]
    doc = {"file": str(path), "rmsDb": r(db(rms), 2), "peakDb": r(db(np.abs(x).max()), 2), "silent": db(rms) < args.silence_db, "silentShare": r(float(quiet.mean()), 4),
           "leadingSilence": r((loud_idx[0] if len(loud_idx) else n) * win / rate, 3), "trailingSilence": r((n - 1 - loud_idx[-1] if len(loud_idx) else n) * win / rate, 3),
           "clipped": bool(run3.any()), "clippedSamples": int(hot.sum()), "dcOffset": [r(float(v), 5) for v in dc], "problems": problems,
           "gate": {"passed": not problems, "failed": problems}}
    text = (f"{path}\n  RMS {db(rms):.1f} dBFS   peak {doc['peakDb']} dBFS   quiet {quiet.mean() * 100:.0f} % of the time (under {args.silence_db:g} dBFS)"
            f"   leading {doc['leadingSilence']} s   trailing {doc['trailingSilence']} s\n  samples at full scale: {doc['clippedSamples']}   DC offset: {doc['dcOffset']}\n  "
            + ("ok: " + ("silent, as expected" if args.expect_silent else "not silent, not clipped, no DC offset") if not problems else "\n  ".join("FOUND: " + p for p in problems)))
    return doc, text, 1 if problems else 0


def cmd_spectrogram(args):
    path = resolve(args.file, args)
    x, rate = load(path)
    m = x.mean(1)
    track = None
    if args.pitch:
        t, hz, conf = yin(m, rate, args.fmin_pitch, args.fmax_pitch)
        hz[conf < args.min_confidence] = math.nan
        track = (t, hz)
    img = spectrogram_image(m, rate, f"{path.name}   {rate} Hz, {len(m) / rate:.2f} s", args.max_width, args.range, args.fmin, track)
    dest = V.save_sheet(img, V.out_dir(args, None if args.file else args.shot) / (args.name or f"{path.stem}.spectrogram.png"), args.max_width)
    return {"file": str(path), "sheet": str(dest), "fmin": args.fmin, "rangeDb": args.range}, f"spectrogram: {dest}", 0


def cmd_pitch(args):
    import numpy as np

    path = resolve(args.file, args)
    x, rate = load(path)
    t, hz, conf = yin(x.mean(1), rate, args.fmin, args.fmax)
    voiced = (conf >= args.min_confidence) & ~np.isnan(hz)
    doc: dict[str, Any] = {"file": str(path), "method": "YIN, 10 ms hop", "frames": int(len(t)), "voicedShare": r(float(voiced.mean()) if len(t) else 0.0, 4),
                           "medianHz": r(float(np.median(hz[voiced])), 3) if voiced.any() else None,
                           "minHz": r(float(hz[voiced].min()), 3) if voiced.any() else None, "maxHz": r(float(hz[voiced].max()), 3) if voiced.any() else None}
    failed: list[str] = []
    lines = [f"{path}", f"  pitch (YIN): {int(voiced.sum())} of {len(t)} frames periodic (confidence >= {args.min_confidence:g})"
             + (f"   median {doc['medianHz']} Hz   range {doc['minHz']}..{doc['maxHz']} Hz" if voiced.any() else "")]
    if args.expect_hz is not None or args.expect_csv:
        if args.expect_csv:
            ct, ch = read_curve(args.expect_csv)
            want = np.interp(t, ct, ch)
            inside = (t >= ct[0]) & (t <= ct[-1])
        else:
            want, inside = np.full(len(t), args.expect_hz), np.ones(len(t), bool)
        use = voiced & inside
        if not use.any():
            failed.append("no periodic frame to compare with the expected pitch")
            doc["expected"] = {"frames": 0}
        else:
            ratio = hz[use] / want[use]
            err = np.abs(ratio - 1) * 100
            octave = float((np.abs(np.abs(np.log2(ratio)) - 1) < 0.06).mean())  # an octave off: the usual way a pitch tracker is wrong
            e = doc["expected"] = {"frames": int(use.sum()), "medianErrorPct": r(float(np.median(err)), 3), "withinTolerance": r(float((err <= args.tolerance).mean()), 4),
                                   "tolerancePct": args.tolerance, "octaveErrors": r(octave, 4), "medianRatio": r(float(np.median(ratio)), 5)}
            lines.append(f"  against the expected pitch: median error {e['medianErrorPct']} %   {e['withinTolerance'] * 100:.1f} % of {e['frames']} frames within ±{args.tolerance:g} %"
                         f"   median ratio {e['medianRatio']}" + (f"   ({octave * 100:.0f} % of frames are an octave off: tracker or signal?)" if octave > 0.05 else ""))
            if args.max_error_pct is not None and e["medianErrorPct"] > args.max_error_pct:
                failed.append(f"median pitch error {e['medianErrorPct']} % > --max-error-pct {args.max_error_pct:g}")
            if args.min_share is not None and e["withinTolerance"] < args.min_share:
                failed.append(f"only {e['withinTolerance'] * 100:.1f} % of frames within ±{args.tolerance:g} % (< --min-share {args.min_share:g})")
    doc["gate"] = {"passed": not failed, "failed": failed}
    doc["track"] = {"t": [round(float(v), 3) for v in t], "hz": [r(float(v), 2) for v in hz], "confidence": [round(float(v), 3) for v in conf]}
    return doc, "\n".join(lines + [f"  GATE FAILED: {f}" for f in failed]), 1 if failed else 0


def find_onsets(x, rate: int, sensitivity: float, min_gap: float):
    """Spectral flux: the summed rise of the log-compressed spectrum between consecutive 23 ms frames, peaks above
    a moving median. Finds starts that add energy somewhere in the spectrum (hits, notes, a door); a slow swell or
    a change of pitch at constant level has no onset in this sense."""
    import numpy as np
    from scipy.signal import find_peaks
    from scipy.ndimage import median_filter

    nfft = 1 << round(math.log2(rate * 0.023))
    hop = nfft // 4
    _, t, p = stft_power(x, rate, nfft, hop)
    mag = np.sqrt(p)
    if mag.max() <= 1e-9:
        return np.array([]), np.array([])
    c = np.log1p(100 * mag / mag.max())
    flux = np.concatenate([[0.0], np.maximum(c[:, 1:] - c[:, :-1], 0).sum(0)])
    flux /= max(flux.max(), 1e-12)
    thr = median_filter(flux, size=max(3, int(0.2 * rate / hop)), mode="nearest") + sensitivity
    peaks, _ = find_peaks(flux, height=thr, distance=max(1, int(min_gap * rate / hop)))
    # the flux peaks when the start of the sound is about a quarter of the way into the Hann window
    return np.maximum(t[peaks] + (nfft * 0.25 - hop / 2) / rate, 0.0), flux[peaks]


def cmd_onsets(args):
    import numpy as np

    path = resolve(args.file, args)
    x, rate = load(path)
    times, strength = find_onsets(x.mean(1), rate, args.sensitivity, args.min_gap)
    doc: dict[str, Any] = {"file": str(path), "method": "spectral flux", "onsets": [round(float(v), 4) for v in times], "strength": [round(float(v), 3) for v in strength]}
    lines = [f"{path}", f"  {len(times)} onsets at (s): {', '.join(f'{v:.3f}' for v in times) or 'none'}"]
    failed: list[str] = []
    want = [float(v) for v in args.expect_times.split(",")] if args.expect_times else ([float(row[0]) for row in csv.reader(Path(args.expect_csv).read_text(encoding="utf-8-sig").splitlines())
                                                                                      if row and row[0].replace(".", "", 1).strip().isdigit()] if args.expect_csv else None)
    if want is not None:
        free, matched, missed = list(times), [], []
        for w in want:  # each expected time takes the nearest free onset within the tolerance
            near = min(free, key=lambda v: abs(v - w), default=None)
            if near is not None and abs(near - w) * 1000 <= args.tolerance_ms:
                matched.append((w, float(near)))
                free.remove(near)
            else:
                missed.append(w)
        off = [abs(b - a) * 1000 for a, b in matched]
        e = doc["expected"] = {"matched": len(matched), "missed": [round(v, 4) for v in missed], "extra": [round(float(v), 4) for v in free],
                               "meanOffsetMs": r(float(np.mean(off)), 2) if off else None, "maxOffsetMs": r(float(max(off)), 2) if off else None,
                               "meanSignedOffsetMs": r(float(np.mean([(b - a) * 1000 for a, b in matched])), 2) if off else None, "toleranceMs": args.tolerance_ms}
        lines.append(f"  against {len(want)} expected: {len(matched)} matched within ±{args.tolerance_ms:g} ms"
                     + (f" (mean offset {e['meanOffsetMs']} ms, largest {e['maxOffsetMs']} ms, signed mean {e['meanSignedOffsetMs']:+} ms: + = late)" if off else "")
                     + f"   missed {e['missed'] or 'none'}   extra {e['extra'] or 'none'}")
        if args.max_offset_ms is not None and off and max(off) > args.max_offset_ms:
            failed.append(f"largest onset offset {max(off):.1f} ms > --max-offset-ms {args.max_offset_ms:g}")
        if args.max_missed is not None and len(missed) > args.max_missed:
            failed.append(f"{len(missed)} expected onsets missed (> --max-missed {args.max_missed})")
        if args.max_extra is not None and len(free) > args.max_extra:
            failed.append(f"{len(free)} onsets not expected (> --max-extra {args.max_extra})")
    doc["gate"] = {"passed": not failed, "failed": failed}
    return doc, "\n".join(lines + [f"  GATE FAILED: {f}" for f in failed]), 1 if failed else 0


def envelope(x, rate: int, win_s: float = 0.01):
    import numpy as np

    win = max(1, int(win_s * rate))
    n = len(x) // win
    return np.sqrt((x[:n * win].reshape(n, win) ** 2).mean(1))


def find_lag(a, b, rate: int, max_s: float) -> tuple[float, float, str]:
    """How much later B is than A, in seconds (negative: earlier), its normalised correlation, and what it was read
    from: the waveforms (sample-accurate, needs the same signal) or, when those do not correlate, the 10 ms
    loudness envelopes (works between two different renderings of the same event, to a few ms)."""
    import numpy as np
    from scipy.signal import correlate

    def peak(u, v, limit: int) -> tuple[float, float]:
        c = correlate(v, u, mode="full", method="fft")
        zero = len(u) - 1
        lo, hi = max(0, zero - limit), min(len(c), zero + limit + 1)
        i = lo + int(c[lo:hi].argmax())
        off = 0.0
        if 0 < i < len(c) - 1:
            den = c[i - 1] - 2 * c[i] + c[i + 1]
            off = 0.5 * (c[i - 1] - c[i + 1]) / den if abs(den) > 1e-20 else 0.0
        return i - zero + off, float(c[i] / max(math.sqrt(float((u * u).sum() * (v * v).sum())), 1e-20))

    lag, corr = peak(a - a.mean(), b - b.mean(), int(max_s * rate))
    if corr >= 0.3:
        return lag / rate, corr, "waveform"
    ea, eb = envelope(a, rate, 0.001), envelope(b, rate, 0.001)
    lag, corr = peak(ea - ea.mean(), eb - eb.mean(), int(max_s * 1000))
    return lag / 1000, corr, "envelope"


OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


def cmd_compare(args):
    import numpy as np
    from scipy.signal import resample_poly

    if args.a and args.b:
        pa, pb = resolve(args.a, args), resolve(args.b, args)
    elif args.shot:  # A is what B is judged against
        pa, pb = resolve(None, args, args.against or pl.load_config()["reference"]), resolve(None, args, V.default_source(args))
    else:
        pl.fail("compare: give two files (A = the reference, B = the candidate), or --shot NAME [--source S] [--against REF]")
    (xa, ra), (xb, rb) = load(pa), load(pb)
    notes: list[str] = []
    a, b = xa.mean(1), xb.mean(1)
    if rb != ra:
        g = math.gcd(ra, rb)
        b = resample_poly(b, ra // g, rb // g)
        notes.append(f"B resampled from {rb} to {ra} Hz")
    rate = ra
    level = db(np.sqrt((b ** 2).mean())) - db(np.sqrt((a ** 2).mean()))
    lag, corr, lag_from = find_lag(a, b, rate, args.max_search_ms / 1000)
    if lag_from == "envelope":
        notes.append("the waveforms do not correlate (different renderings?): lag read from the loudness envelopes, good to a few ms")
    s = int(round(lag * rate))
    a2, b2 = (a[:len(a) - s], b[s:]) if s >= 0 else (a[-s:], b[:len(b) + s])
    n = min(len(a2), len(b2))
    if n < 2048:
        pl.fail("compare: less than 2048 samples overlap after alignment")
    a2, b2 = a2[:n], b2[:n] * 10 ** (-level / 20)  # aligned and level-matched: what is left is the shape of the sound
    _, _, sa = stft_power(a2, rate, 2048, 512)
    f, _, sb = stft_power(b2, rate, 2048, 512)
    floor = sa.max() * 1e-8  # 80 dB under A's loudest bin: differences in the noise floor are not the sound
    la, lb = 10 * np.log10(np.maximum(sa, floor)), 10 * np.log10(np.maximum(sb, floor))
    lsd = float(np.sqrt(((la - lb) ** 2).mean(0)).mean())
    ma, mb = sa.mean(1), sb.mean(1) * 10 ** (level / 10)  # the bands carry the level difference again
    bands = {}
    for c in OCTAVES:
        sel = (f >= c / math.sqrt(2)) & (f < c * math.sqrt(2))
        if sel.any() and c * math.sqrt(2) <= rate / 2 * 1.01 and ma[sel].sum() > floor:
            bands[f"{c:g}"] = r(10 * math.log10(max(mb[sel].sum(), 1e-30) / ma[sel].sum()), 2)
    ea, eb = envelope(a2, rate), envelope(b2, rate)
    env = float(np.corrcoef(ea, eb)[0, 1]) if ea.std() > 1e-9 and eb.std() > 1e-9 else None
    if env is None:
        notes.append("an envelope is flat: no envelope correlation")
    failed = [f"{name} {got:.3f} > {want:g}" for name, got, want in (("|lag| ms", abs(lag * 1000), args.max_lag_ms), ("|level difference| dB", abs(level), args.max_level_db),
                                                                     ("log-spectral distance dB", lsd, args.max_lsd)) if want is not None and got > want]
    if args.min_envelope_corr is not None and (env is None or env < args.min_envelope_corr):
        failed.append(f"envelope correlation {env if env is None else round(env, 3)} < {args.min_envelope_corr:g}")
    doc = {"a": str(pa), "b": str(pb), "lagMs": r(lag * 1000, 3), "lagFrom": lag_from, "lagCorrelation": r(corr, 4), "levelDb": r(level, 3), "lsdDb": r(lsd, 3),
           "bandsDb": bands, "envelopeCorrelation": r(env, 4), "overlapSeconds": r(n / rate, 3), "notes": notes, "gate": {"passed": not failed, "failed": failed}}
    text = "\n".join([
        f"B = {pb}\nA = {pa}   (B is measured against A)",
        f"  lag {lag * 1000:+.2f} ms (+ = B later; from the {lag_from}, correlation {corr:.3f})   level {level:+.2f} dB (+ = B louder)",
        f"  after aligning and level-matching: log-spectral distance {lsd:.2f} dB   envelope correlation {'n/a' if env is None else f'{env:.3f}'}",
        "  octave bands, B - A (dB): " + "  ".join(f"{k}: {v:+.1f}" for k, v in bands.items()),
        *(f"  note: {x}" for x in notes), *(f"  GATE FAILED: {x}" for x in failed)])
    return doc, text, 1 if failed else 0


# -------------------------------------------------------------------------------------------------------- self-test

def self_test() -> int:
    import numpy as np
    import soundfile as sf

    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    with tempfile.TemporaryDirectory(prefix="pl-audio-test-") as t_:
        tmp = Path(t_)
        rate = 48000
        t = np.arange(rate * 3) / rate
        out = ["--out", str(tmp / "out")]

        def wav(name: str, x, sr: int = rate) -> str:
            sf.write(str(tmp / name), x, sr, subtype="FLOAT")
            return str(tmp / name)

        tone = 10 ** (-23 / 20) * np.sin(2 * np.pi * 1000 * t)
        _, d, _, _ = run(["probe", wav("tone.wav", np.stack([tone, tone], 1))])
        check("probe: a 1 kHz stereo sine peaking at -23 dBFS is -23.0 LUFS (the EBU reference signal)", abs(d["lufs"] + 23.0) <= 0.1 and abs(d["peakDb"] + 23) < 0.01 and abs(d["rmsDb"] + 26.01) < 0.02,
              f"{d['lufs']} LUFS, peak {d['peakDb']} dBFS, RMS {d['rmsDb']} dBFS, {d['duration']} s")
        for hz in (82.41, 220.0, 440.0):
            _, d, _, code = run(["pitch", wav("p.wav", 0.5 * np.sin(2 * np.pi * hz * t[:rate])), "--expect-hz", str(hz), "--max-error-pct", "1"])
            check(f"pitch: a {hz:g} Hz tone within 1 %", code == 0 and abs(d["medianHz"] / hz - 1) < 0.01, f"median {d['medianHz']} Hz, error {d['expected']['medianErrorPct']} %")
        # a sweep with harmonics, like an engine run up: fundamental 60 -> 240 Hz, the 2nd and 3rd harmonic louder than it
        f0 = 60 * (240 / 60) ** (t / 3)
        ph = 2 * np.pi * np.cumsum(f0) / rate
        engine = 0.2 * np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)
        (tmp / "f0.csv").write_text("time,hz\n" + "\n".join(f"{a:.3f},{b:.3f}" for a, b in zip(t[::480], f0[::480])), encoding="utf-8")
        _, d, _, code = run(["pitch", wav("engine.wav", engine), "--expect-csv", str(tmp / "f0.csv"), "--tolerance", "2", "--max-error-pct", "1", "--min-share", "0.95", "--fmax", "600"])
        check("pitch: a 60 -> 240 Hz sweep whose harmonics are louder than its fundamental, against a time,hz curve", code == 0,
              f"median error {d['expected']['medianErrorPct']} %, {d['expected']['withinTolerance'] * 100:.1f} % within 2 %, octave errors {d['expected']['octaveErrors']}")
        _, d, _, code = run(["pitch", str(tmp / "engine.wav"), "--expect-hz", "500", "--max-error-pct", "1", "--fmax", "600"])
        check("pitch: the wrong expectation fails the gate", code == 1, f"exit {code}")
        _, d, _, _ = run(["spectrogram", str(tmp / "engine.wav"), "--pitch", *out])
        from PIL import Image
        with Image.open(d["sheet"]) as im:
            check("spectrogram written, no wider than --max-width", im.width <= 2000 and im.height > 300, f"{im.width}x{im.height}")
        rng = np.random.default_rng(3)
        noise = 0.2 * rng.standard_normal(rate * 2) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t[:rate * 2]))
        late = 0.5 * np.concatenate([np.zeros(int(0.05 * rate)), noise])[:len(noise)]
        _, d, _, code = run(["compare", wav("a.wav", noise), wav("b.wav", late), "--max-lsd", "1"])
        check("compare: a copy 50 ms late at half amplitude: lag 50 ± 1 ms, level -6.0 ± 0.1 dB, same spectrum",
              abs(d["lagMs"] - 50) <= 1 and abs(d["levelDb"] + 6.02) <= 0.1 and d["lsdDb"] < 0.5 and d["envelopeCorrelation"] > 0.99 and code == 0,
              f"lag {d['lagMs']} ms, level {d['levelDb']} dB, LSD {d['lsdDb']} dB, envelope {d['envelopeCorrelation']}")
        _, d, _, code = run(["compare", str(tmp / "a.wav"), str(tmp / "b.wav"), "--max-lag-ms", "10", "--max-level-db", "1"])
        check("compare: --max-lag-ms 10 and --max-level-db 1 fail on it", code == 1 and len(d["gate"]["failed"]) == 2, f"{d['gate']['failed']}")
        from scipy.signal import butter, lfilter
        dull = lfilter(*butter(2, 1000 / (rate / 2)), noise)
        _, d, _, _ = run(["compare", str(tmp / "a.wav"), wav("dull.wav", dull)])
        check("compare: a 1 kHz low-passed copy loses its high octave bands and has a large spectral distance", d["bandsDb"]["8000"] < -20 and abs(d["bandsDb"]["250"]) < 1 and d["lsdDb"] > 5,
              f"250 Hz {d['bandsDb']['250']} dB, 8 kHz {d['bandsDb']['8000']} dB, LSD {d['lsdDb']} dB")
        other = 0.2 * np.random.default_rng(4).standard_normal(rate * 2) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * (t[:rate * 2] - 0.03)))
        _, d, _, _ = run(["compare", str(tmp / "a.wav"), wav("other.wav", other)])
        check("compare: different noise with the same 3 Hz swell 30 ms later: lag read from the envelopes", d["lagFrom"] == "envelope" and abs(d["lagMs"] - 30) < 8,
              f"lag {d['lagMs']} ms from the {d['lagFrom']}")
        hits = np.zeros(rate * 2)
        for s in (0.25, 0.8, 1.31):
            i = int(s * rate)
            hits[i:i + 4800] += 0.5 * np.sin(2 * np.pi * 660 * t[:4800]) * np.exp(-t[:4800] * 30)
        _, d, _, code = run(["onsets", wav("hits.wav", hits + 0.001 * rng.standard_normal(len(hits))), "--expect-times", "0.25,0.8,1.31", "--max-offset-ms", "15", "--max-missed", "0", "--max-extra", "0"])
        check("onsets: three hits found within 15 ms, none missed, none extra", code == 0, f"{d['onsets']}, largest offset {d['expected']['maxOffsetMs']} ms")
        _, d, _, code = run(["onsets", str(tmp / "hits.wav"), "--expect-times", "0.25,0.5,0.8", "--max-missed", "0"])
        check("onsets: an expected hit that is not there fails the gate", code == 1 and d["expected"]["missed"] == [0.5] and len(d["expected"]["extra"]) == 1,
              f"missed {d['expected']['missed']}, extra {d['expected']['extra']}")
        _, d, _, c0 = run(["silence", wav("zero.wav", np.zeros(rate))])
        check("silence: digital silence is found", d["silent"] and c0 == 1)
        _, d, _, c1 = run(["silence", wav("clip.wav", np.clip(1.5 * np.sin(2 * np.pi * 200 * t[:rate]), -1, 1))])
        check("silence: a clipped sine is found", d["clipped"] and c1 == 1, f"{d['clippedSamples']} samples at full scale")
        _, d, _, c2 = run(["silence", wav("dc.wav", 0.1 * np.sin(2 * np.pi * 200 * t[:rate]) + 0.05)])
        check("silence: a DC offset of 0.05 is found", c2 == 1 and abs(d["dcOffset"][0] - 0.05) < 1e-3, f"{d['dcOffset']}")
        _, d, _, c3 = run(["silence", str(tmp / "a.wav")])
        check("silence: ordinary sound passes", c3 == 0 and not d["problems"])
    print("audio.py self-test:", "passed" if ok else "FAILED")
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------------------- main

EPILOG = """what the numbers mean, and what they do not
  LUFS       integrated loudness after ITU-R BS.1770-4 (K-weighting, 400 ms blocks, -70 LUFS and -10 LU gates).
             Peak is the largest sample, not the true (inter-sample) peak. Loudness says nothing about the mix.
  pitch      the fundamental by YIN, every 10 ms, with a confidence (1 = cleanly periodic). It is one pitch per
             frame: chords, two engines or noise give a low confidence or a wrong value. Octave errors happen;
             `octaveErrors` says how often the track sat an octave from the expectation. An engine's firing
             frequency is rpm / 60 x cylinders / 2 (four-stroke): give it with --expect-hz or --expect-csv.
  onsets     starts of sounds that add energy in the spectrum, to about 10 ms. Not slow swells, not pitch changes.
  lag        how much later B is than A (cross-correlation; sub-sample on the waveforms, a few ms when it has to
             fall back to the loudness envelopes because the two are different renderings).
  level      RMS of B over RMS of A in dB (-6.02 = half the amplitude).
  LSD        log-spectral distance in dB between A and B after aligning and level-matching, floored 80 dB under
             A's loudest bin: 0 = same spectrum over time, about 1 = hard to hear, above 3 = a different timbre.
             Two different noise recordings of the same thing never reach 0; compare runs, not absolutes.
  bands      B - A per octave band in dB, level included: where the difference in tone sits.
  envelope   correlation of the 10 ms loudness envelopes after alignment: does it swell and fall the same way.
  None of them says which sound is right or whether a listener would mind: look at the spectrogram, and listen.

exit codes: 0 done (gates passed, `silence` found nothing), 1 a gate failed or `silence` found a problem,
            2 usage or environment error"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="audio.py", description=__doc__, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true", help="run the built-in checks on synthetic sounds and exit")
    sub = ap.add_subparsers(dest="cmd", metavar="{probe,silence,spectrogram,pitch,onsets,compare}")
    common = V.common_parent(seq=False)
    g = common.add_argument_group("input (one of)")
    g.add_argument("--shot", help="a shot of the store; with --source, its sound (<source>.wav)")
    g.add_argument("--source", help="the source whose sound is measured (default: the first candidate of config.json)")
    g.add_argument("--audio", metavar="FILE", help="a sound file (the same as giving it as the argument)")

    def add(name: str, fn, help_: str, file: bool = True, **kw):
        p = sub.add_parser(name, parents=[common], help=help_, description=kw.pop("description", help_), epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
        if file:
            p.add_argument("file", nargs="?", help="a sound file (or use --audio / --shot)")
        p.set_defaults(fn=fn)
        return p

    add("probe", cmd_probe, "rate, channels, duration, peak and RMS in dBFS, integrated loudness in LUFS")
    p = add("silence", cmd_silence, "sanity checks: silent, clipped, DC offset; exit 1 when one is found")
    p.add_argument("--silence-db", type=float, default=-60.0, help="RMS below this many dBFS is silence (default -60)")
    p.add_argument("--clip-level", type=float, default=0.999, help="a sample at or above this magnitude is at full scale (default 0.999); three in a row is clipping")
    p.add_argument("--max-dc", type=float, default=0.005, help="largest mean of a channel that is not a DC offset (default 0.005 of full scale)")
    p.add_argument("--expect-silent", action="store_true", help="the sound should be silent: exit 1 when it is not")
    p = add("spectrogram", cmd_spectrogram, "a log-frequency, dB-scaled spectrogram PNG with time and frequency axes")
    p.add_argument("--fmin", type=float, default=30.0, help="lowest frequency shown, Hz (default 30)")
    p.add_argument("--range", type=float, default=80.0, help="dB shown under the loudest bin (default 80)")
    p.add_argument("--pitch", action="store_true", help="draw the fundamental-frequency track over it")
    p.add_argument("--fmin-pitch", type=float, default=50.0, help="lowest pitch looked for by --pitch (default 50)")
    p.add_argument("--fmax-pitch", type=float, default=1000.0, help="highest pitch looked for by --pitch (default 1000)")
    p.add_argument("--min-confidence", type=float, default=0.8, help="pitch frames under this confidence are not drawn (default 0.8)")
    p.add_argument("--name", help="file name of the picture (default <file>.spectrogram.png)")
    p = add("pitch", cmd_pitch, "the fundamental frequency over time (YIN), optionally against an expected pitch")
    p.add_argument("--fmin", type=float, default=50.0, help="lowest pitch looked for, Hz (default 50); lower costs longer windows")
    p.add_argument("--fmax", type=float, default=1000.0, help="highest pitch looked for, Hz (default 1000)")
    p.add_argument("--min-confidence", type=float, default=0.8, help="frames under this confidence count as not periodic (default 0.8)")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--expect-hz", type=float, metavar="F", help="the pitch the whole sound should have")
    g.add_argument("--expect-csv", metavar="FILE", help="rows of time,hz (a header is skipped): the pitch over time, interpolated; frames outside its times are left out")
    p.add_argument("--tolerance", type=float, default=3.0, metavar="PCT", help="a frame is right within this many percent of the expectation (default 3; a semitone is 5.9)")
    p.add_argument("--max-error-pct", type=float, help="gate: largest allowed median relative error, percent")
    p.add_argument("--min-share", type=float, help="gate: smallest allowed share (0..1) of frames within --tolerance")
    p = add("onsets", cmd_onsets, "when sounds start (spectral flux), optionally against expected times")
    p.add_argument("--sensitivity", type=float, default=0.1, help="how far above the moving median a peak of the flux (0..1) must rise (default 0.1; lower finds more)")
    p.add_argument("--min-gap", type=float, default=0.05, help="smallest time between two onsets, seconds (default 0.05)")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--expect-times", help="expected onset times in seconds, comma separated")
    g.add_argument("--expect-csv", metavar="FILE", help="expected onset times, first column")
    p.add_argument("--tolerance-ms", type=float, default=50.0, help="an onset matches an expected time within this (default 50 ms)")
    p.add_argument("--max-offset-ms", type=float, help="gate: largest allowed offset of a matched onset")
    p.add_argument("--max-missed", type=int, help="gate: most expected onsets that may be missing")
    p.add_argument("--max-extra", type=int, help="gate: most onsets that may be unexpected")
    p = add("compare", cmd_compare, "B against A: lag, level, log-spectral distance, octave bands, envelope", file=False,
            description="Compare sound B (the candidate) with sound A (the reference). With --shot: A = --against (default: the reference), B = --source.")
    p.add_argument("a", nargs="?", help="sound A: what B is measured against")
    p.add_argument("b", nargs="?", help="sound B")
    p.add_argument("--against", help="with --shot: the source that is A (default: config.reference)")
    p.add_argument("--max-search-ms", type=float, default=2000.0, help="largest lag looked for (default 2000 ms)")
    p.add_argument("--max-lag-ms", type=float, help="gate: largest allowed |lag|, ms")
    p.add_argument("--max-level-db", type=float, help="gate: largest allowed |level difference|, dB")
    p.add_argument("--max-lsd", type=float, help="gate: largest allowed log-spectral distance, dB")
    p.add_argument("--min-envelope-corr", type=float, help="gate: smallest allowed envelope correlation")
    return ap


def run(argv: list[str] | None = None):
    V.utf8_stdio()
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.self_test:
        raise SystemExit(self_test())
    if not args.cmd:
        ap.print_help(sys.stderr)
        raise SystemExit(2)
    try:
        doc, text, code = args.fn(args)
    except pl.PlError as e:
        pl.fail(str(e))
    return args, doc, text, code


def main() -> None:
    args, doc, text, code = run()
    pl.emit(doc, args.json, text)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
