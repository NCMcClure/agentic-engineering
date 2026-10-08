# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "Pillow>=10.1"]
# ///
"""video.py: clips as things an agent can look at and measure.

  probe    what a clip is (duration, rate, size, frame count)
  frames   a clip -> numbered PNG frames
  contact  a contact sheet, each tile labelled with its frame index and time
  burst    the frames around one moment, in time order
  compare  per-frame SSIM / PSNR between two clips of the same sequence of instants

A clip is a video file, a folder of frames, or a shot's clip (`--shot NAME --source S`: frames/<source>/ or
<source>.mp4|.webm in the shot folder). Video files need the ffmpeg executable (ffprobe too if present); folders of
frames need nothing. Also the media helpers of sweep.py, flow.py, audio.py, keypoints.py and semantic.py.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import atexit
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402

IMG_EXT = (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff")
VID_EXT = (".mp4", ".webm", ".mov", ".mkv", ".avi")
PSNR_CAP = 99.0  # identical frames have infinite PSNR; JSON has no infinity


# ------------------------------------------------------------------------------------------------- shared arguments

def common_parent(seq: bool = True, every_help: str | None = None) -> argparse.ArgumentParser:
    """The flags every media script shares; used as an argparse parent."""
    p = argparse.ArgumentParser(add_help=False)
    g = p.add_argument_group("output")
    g.add_argument("--json", action="store_true", help="print one JSON document on stdout and nothing else")
    g.add_argument("--out", metavar="DIR", help="folder for pictures and reports (default: .perceptual-loop/runs/<run>/<shot>/ when the project has one)")
    g.add_argument("--run", default="adhoc", help="run name under .perceptual-loop/runs/ when --out is not given (default: adhoc)")
    g.add_argument("--max-width", type=int, default=2000, help="no picture is written wider than this many pixels (default 2000)")
    if seq:
        g = p.add_argument_group("input (one of)")
        g.add_argument("--shot", help="a shot of the store; with --source, its clip (frames/<source>/ or <source>.mp4|.webm)")
        g.add_argument("--source", help="the source whose output is measured (default: the first candidate of config.json)")
        g.add_argument("--frames", metavar="DIR", help="a folder of frames, read in name order")
        g.add_argument("--video", metavar="FILE", help="a video file (needs ffmpeg)")
        g.add_argument("--rate", type=float, help="frames per second of a frames folder, for timestamps (a video's own rate is read from it)")
        g.add_argument("--every", type=int, default=None, help=every_help or "use every Nth frame (default 1)")
    return p


def utf8_stdio() -> None:
    """Windows pipes default to a legacy code page: a degree sign or a non-ASCII path would be garbled or raise."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def default_source(args: argparse.Namespace) -> str:
    return args.source or pl.load_config()["candidates"][0]


def out_dir(args: argparse.Namespace, shot: str | None = None, need: bool = True) -> Path | None:
    """Where this command may write: --out, else the run folder of a project, else nowhere (contract: never elsewhere)."""
    if getattr(args, "out", None):
        d = Path(args.out)
    elif pl.pl_dir().is_dir():
        d = pl.runs_dir() / args.run / (shot or "_files")
    elif need:
        pl.fail("give --out DIR: there is no .perceptual-loop/ here to write into")
    else:
        return None
    d.mkdir(parents=True, exist_ok=True)
    return d


# --------------------------------------------------------------------------------------------------------- ffmpeg

def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def ffmpeg_exe(needed_for: str = "reading a video file", required: bool = True) -> str | None:
    exe = os.environ.get("PL_FFMPEG") or shutil.which("ffmpeg")
    if not exe:
        try:  # an optional provider of the binary: `uv run --with imageio-ffmpeg …`
            import imageio_ffmpeg  # type: ignore

            exe = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            exe = None
    if not exe and required:
        pl.fail(f"{needed_for} needs the ffmpeg executable, which is not on PATH.\n"
                "Install it (winget install ffmpeg / brew install ffmpeg / apt install ffmpeg), set PL_FFMPEG to its path,\n"
                "or add the bundled one for this run: uv run --no-project --with imageio-ffmpeg <script> …\n"
                "Folders of frames (--frames DIR) need no ffmpeg.")
    return exe


def _frac(s: str | None) -> float:
    try:
        a, _, b = (s or "0").partition("/")
        return float(a) / float(b or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe(path: str | Path) -> dict[str, Any]:
    """duration (s), fps, size, frame count of a video file. Frame count is the number of video packets (exact for
    every common codec, and fast: nothing is decoded); without ffprobe it is duration x fps and marked estimated."""
    path = Path(path)
    if not path.is_file():
        pl.fail(f"no such file: {path}")
    fp = shutil.which("ffprobe")
    if fp:
        r = _run([fp, "-v", "error", "-count_packets", "-show_entries",
                  "stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_packets:format=duration",
                  "-of", "json", str(path)])
        if r.returncode != 0:
            pl.fail(f"ffprobe could not read {path}: {r.stderr.strip()}")
        d = json.loads(r.stdout)
        vs = [s for s in d.get("streams", []) if s.get("codec_type") == "video"]
        if not vs:
            pl.fail(f"{path} has no video stream")
        s = vs[0]
        fps = _frac(s.get("avg_frame_rate")) or _frac(s.get("r_frame_rate"))
        return {"file": str(path), "duration": round(float(d.get("format", {}).get("duration") or 0), 4), "fps": round(fps, 4),
                "size": [int(s["width"]), int(s["height"])], "frames": int(s.get("nb_read_packets") or 0), "codec": s.get("codec_name"),
                "hasAudio": any(x.get("codec_type") == "audio" for x in d["streams"])}
    r = _run([ffmpeg_exe("probing a video file"), "-hide_banner", "-i", str(path)])  # exits 1 (no output file); the facts are on stderr
    dur = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", r.stderr)
    vid = re.search(r"Video:\s*(\w+).*?\b(\d{2,5})x(\d{2,5})\b.*?([\d.]+)\s*fps", r.stderr)
    if not vid:
        pl.fail(f"ffmpeg found no video stream in {path}")
    duration = (int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3])) if dur else 0.0
    fps = float(vid[4])
    return {"file": str(path), "duration": round(duration, 4), "fps": fps, "size": [int(vid[2]), int(vid[3])],
            "frames": int(round(duration * fps)), "frameCountEstimated": True, "codec": vid[1], "hasAudio": "Audio:" in r.stderr}


def extract(video: str | Path, out: Path, *, every: int = 1, fps: float | None = None, times: list[float] | None = None,
            first: int | None = None, last: int | None = None, info: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Frames of a video as out/000001.png …; returns [{path, index (frame number in the clip, from 0), t (seconds)}]."""
    ff = ffmpeg_exe("extracting frames")
    info = info or probe(video)
    rate = info["fps"] or 0.0
    out.mkdir(parents=True, exist_ok=True)
    pattern = str(out / "%06d.png")
    if times:
        frames = []
        for k, t in enumerate(times):
            dest = out / f"{k + 1:06d}.png"
            r = _run([ff, "-v", "error", "-y", "-ss", f"{t:.6f}", "-i", str(video), "-frames:v", "1", str(dest)])
            if r.returncode != 0 or not dest.is_file():
                pl.fail(f"ffmpeg could not read a frame at {t}s of {video}: {r.stderr.strip() or 'past the end?'}")
            frames.append({"path": dest, "index": int(round(t * rate)), "t": t})
        return frames
    every = max(1, every or 1)
    if fps:
        vf, index_of = f"fps={fps}", (lambda k: int(round(k / fps * rate)))
        time_of = lambda k: k / fps  # noqa: E731
    else:
        a = max(0, first or 0)
        b = last if last is not None else 10 ** 9
        vf = f"select=between(n\\,{a}\\,{b})*not(mod(n-{a}\\,{every}))"
        index_of = lambda k: a + k * every  # noqa: E731
        time_of = lambda k: (a + k * every) / rate if rate else None  # noqa: E731
    # the frames kept must not be re-timed into a constant rate (ffmpeg would duplicate to fill the gaps);
    # the flag for that was renamed in ffmpeg 5.1, so try the new spelling, then the old
    for sync in (["-fps_mode", "vfr"], ["-vsync", "vfr"]):
        r = _run([ff, "-v", "error", "-y", "-i", str(video), "-vf", vf, *sync, pattern])
        if r.returncode == 0:
            break
    else:
        pl.fail(f"ffmpeg could not extract frames of {video}: {r.stderr.strip()}")
    return [{"path": p, "index": index_of(k), "t": time_of(k)} for k, p in enumerate(list_frames(out))]


def temp_dir() -> Path:
    d = Path(tempfile.mkdtemp(prefix="pl-"))
    atexit.register(shutil.rmtree, d, True)
    return d


def list_frames(d: Path) -> list[Path]:
    return sorted(p for p in Path(d).iterdir() if p.suffix.lower() in IMG_EXT and p.is_file())


def open_sequence(path: str | Path | None = None, *, shot: str | None = None, source: str | None = None, rate: float | None = None,
                  every: int | None = 1, first: int | None = None, last: int | None = None, what: str = "input") -> dict[str, Any]:
    """A clip as frames on disk: {frames: [{path, index, t}], fps, label, total}. `path` is a folder of frames, a
    video file or one image; without it, the clip of a shot's source."""
    every = max(1, every or 1)
    label = str(path) if path else f"{shot}:{source}"
    if path is None:
        if not shot:
            pl.fail(f"{what}: give --frames DIR, --video FILE, or --shot NAME --source S")
        d = pl.shot_path(shot)
        if not d.is_dir():
            pl.fail(f"no such shot: {shot} (looked in {d.parent})")
        clips = [d / "frames" / source] if (d / "frames" / source).is_dir() else [d / f"{source}{e}" for e in VID_EXT if (d / f"{source}{e}").is_file()]
        if not clips:
            pl.fail(f"shot '{shot}' has no clip of source '{source}' (looked for frames/{source}/ and {source}.mp4|.webm in {d})")
        path = clips[0]
    path = Path(path)
    if path.is_dir():
        files = list_frames(path)
        if not files:
            pl.fail(f"{what}: no frames (png/jpg…) in {path}")
        picked = list(enumerate(files))[first or 0:(last + 1) if last is not None else None][::every]
        frames = [{"path": p, "index": i, "t": (i / rate if rate else None)} for i, p in picked]
        return {"frames": frames, "fps": rate, "label": label, "total": len(files)}
    if not path.is_file():
        pl.fail(f"{what}: no such file or folder: {path}")
    if path.suffix.lower() in IMG_EXT:
        return {"frames": [{"path": path, "index": 0, "t": None}], "fps": rate, "label": label, "total": 1}
    info = probe(path)
    frames = extract(path, temp_dir(), every=every, first=first, last=last, info=info)
    if not frames:
        pl.fail(f"{what}: ffmpeg gave no frames for {path}")
    return {"frames": frames, "fps": info["fps"], "label": label, "total": info["frames"]}


def sequence_from_args(args: argparse.Namespace, source: str | None = None, what: str = "input", **kw: Any) -> dict[str, Any]:
    path = args.frames or args.video
    return open_sequence(path, shot=None if path else args.shot, source=source or (None if path else default_source(args)),
                         rate=args.rate, every=args.every, what=what, **kw)


# ------------------------------------------------------------------------------------------------ regions and pixels

def parse_regions(specs: list[str] | None, shot: str | None = None) -> dict[str, list[float]]:
    """--region name=x0,y0,x1,y1 (fractions of the frame, origin top left), added to the boxes of the shot's shot.json."""
    regions: dict[str, list[float]] = {}
    if shot:
        regions.update((pl.read_json(pl.shot_path(shot) / "shot.json", {}) or {}).get("regions") or {})
    for spec in specs or []:
        name, _, box = spec.partition("=")
        try:
            v = [float(x) for x in box.split(",")]
            assert len(v) == 4 and 0 <= v[0] < v[2] <= 1 and 0 <= v[1] < v[3] <= 1
        except (ValueError, AssertionError):
            pl.fail(f"--region {spec!r}: expected name=x0,y0,x1,y1 with 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1")
        regions[name.strip()] = v
    return regions


def region_slice(box: list[float], h: int, w: int) -> tuple[slice, slice]:
    x0, y0, x1, y1 = box
    return slice(int(y0 * h), max(int(y0 * h) + 1, int(round(y1 * h)))), slice(int(x0 * w), max(int(x0 * w) + 1, int(round(x1 * w))))


def load_rgb(path: Path, max_side: int | None = None):
    """Display-encoded float32 RGB 0..1, optionally reduced so the long side is at most max_side (area filter)."""
    import numpy as np
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert("RGB")
        if max_side and max(im.size) > max_side:
            s = max_side / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.BOX)
        return np.asarray(im, dtype=np.float32) / 255.0


def luma(rgb):
    """Rec.709 luma of display-encoded values: what a step of brightness looks like, not what the light is."""
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _box(a, k: int):
    import numpy as np

    c = np.cumsum(np.cumsum(np.pad(a.astype(np.float64), ((1, 0), (1, 0))), 0), 1)
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def ssim_psnr(a, b, k: int = 7) -> tuple[float, float]:
    """Mean SSIM (uniform 7x7 window, the constants of the original paper) and PSNR of two luma images in 0..1."""
    import numpy as np

    k = min(k, min(a.shape))
    ma, mb = _box(a, k), _box(b, k)
    va, vb, cov = _box(a * a, k) - ma * ma, _box(b * b, k) - mb * mb, _box(a * b, k) - ma * mb
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    mse = float(np.mean((a.astype(np.float64) - b) ** 2))
    return float(s.mean()), (PSNR_CAP if mse < 1e-12 else min(PSNR_CAP, 10 * math.log10(1 / mse)))


# ----------------------------------------------------------------------------------------------------------- sheets

BG, FG, DIM = (22, 22, 24), (235, 235, 235), (150, 150, 155)


def font(size: int = 13):
    from PIL import ImageFont

    return ImageFont.load_default(size)


def save_sheet(img, path: Path, max_width: int = 2000) -> Path:
    from PIL import Image

    if img.width > max_width:
        img = img.resize((max_width, max(1, round(img.height * max_width / img.width))), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(path)
    return path


def tile(img, caption: str, width: int, colour=FG):
    """An image at `width` with one caption line under it."""
    from PIL import Image, ImageDraw

    im = img.convert("RGB").resize((width, max(1, round(img.height * width / img.width))), Image.LANCZOS if img.width > width else Image.NEAREST)
    out = Image.new("RGB", (width, im.height + 20), BG)
    out.paste(im, (0, 0))
    ImageDraw.Draw(out).text((3, im.height + 2), caption, fill=colour, font=font(13))
    return out


def grid(tiles: list, cols: int, gap: int = 4, title: str | None = None):
    from PIL import Image, ImageDraw

    cols = max(1, min(cols, len(tiles)))
    rows = math.ceil(len(tiles) / cols)
    tw, th = max(t.width for t in tiles), max(t.height for t in tiles)
    top = 24 if title else 0
    sheet = Image.new("RGB", (cols * tw + (cols + 1) * gap, top + rows * th + (rows + 1) * gap), BG)
    if title:
        ImageDraw.Draw(sheet).text((gap + 2, 4), title, fill=DIM, font=font(14))
    for i, t in enumerate(tiles):
        sheet.paste(t, (gap + (i % cols) * (tw + gap), top + gap + (i // cols) * (th + gap)))
    return sheet


def frame_caption(f: dict[str, Any]) -> str:
    return f"#{f['index']:06d}" + (f"  {f['t']:.2f}s" if f.get("t") is not None else "")


# --------------------------------------------------------------------------------------------------------- commands

def cmd_probe(args):
    info = probe(args.file)
    text = (f"{info['file']}\n  {info['size'][0]}x{info['size'][1]}  {info['fps']:g} fps  {info['duration']:g} s  "
            f"{info['frames']} frames{' (estimated)' if info.get('frameCountEstimated') else ''}  codec {info['codec']}"
            f"{'  +audio' if info['hasAudio'] else ''}")
    return info, text, 0


def cmd_frames(args):
    times = [float(t) for t in args.times.split(",")] if args.times else None
    if not args.out:
        pl.fail("frames: give --out DIR")
    out = Path(args.out)
    if out.is_dir() and list_frames(out):
        pl.fail(f"{out} already holds frames: give an empty folder (numbered frames of two extractions would mix)")
    frames = extract(args.file, out, every=args.every or 1, fps=args.fps, times=times)
    index = [{"file": f["path"].name, "index": f["index"], "t": f["t"]} for f in frames]
    pl.write_json(out / "frames.json", {"source": str(args.file), "frames": index})
    return {"out": str(out), "count": len(frames), "frames": index}, f"{len(frames)} frames -> {out} (frames.json maps each file to its frame index and time)", 0


def _thin(frames: list, max_tiles: int) -> list:
    step = max(1, math.ceil(len(frames) / max_tiles))
    return frames[::step]


def cmd_contact(args):
    from PIL import Image

    every = args.every
    path = args.file or args.frames or args.video
    if every is None and path and Path(path).is_file() and Path(path).suffix.lower() not in IMG_EXT:
        every = max(1, math.ceil(probe(path)["frames"] / args.max_tiles))  # do not decode a whole clip to show 24 tiles
    seq = open_sequence(path, shot=args.shot, source=None if path else default_source(args), rate=args.rate, every=every, what="contact")
    frames = _thin(seq["frames"], args.max_tiles)
    cols = args.cols or min(6, len(frames))
    tw = min(args.tile_width or 10 ** 6, (args.max_width - 4 * (cols + 1)) // cols)
    tiles = []
    for f in frames:
        with Image.open(f["path"]) as im:
            tiles.append(tile(im, frame_caption(f), min(tw, max(160, im.width))))
    sheet = grid(tiles, cols, title=f"{seq['label']}   {len(frames)} of {seq['total']} frames")
    dest = save_sheet(sheet, out_dir(args, None if path else args.shot) / (args.name or ("contact.png" if path else f"contact.{default_source(args)}.png")), args.max_width)
    return {"sheet": str(dest), "tiles": len(frames), "of": seq["total"], "frames": [f["index"] for f in frames]}, f"contact sheet ({len(frames)} of {seq['total']} frames): {dest}", 0


def cmd_burst(args):
    from PIL import Image

    path = args.file or args.frames or args.video
    is_video = bool(path) and Path(path).is_file()
    rate = probe(path)["fps"] if is_video else args.rate
    if args.frame is None and not rate:
        pl.fail("burst --at SECONDS needs the frame rate: give --rate for a folder of frames, or use --frame N")
    centre = args.frame if args.frame is not None else int(round(args.at * rate))
    first = max(0, centre - (args.count // 2) * args.step)
    seq = open_sequence(path, shot=args.shot, source=None if path else default_source(args), rate=args.rate, every=args.step,
                        first=first, last=first + (args.count - 1) * args.step, what="burst")
    frames = seq["frames"]
    cols = args.cols or len(frames)
    tw = (args.max_width - 4 * (cols + 1)) // cols
    tiles = []
    for f in frames:
        with Image.open(f["path"]) as im:
            tiles.append(tile(im, frame_caption(f) + ("  <" if f["index"] == centre else ""), min(tw, max(160, im.width)),
                              (255, 210, 90) if f["index"] == centre else FG))
    sheet = grid(tiles, cols, title=f"{seq['label']}   around frame {centre}" + (f" ({centre / rate:.2f}s)" if rate else ""))
    dest = save_sheet(sheet, out_dir(args, None if path else args.shot) / (args.name or ("burst.png" if path else f"burst.{default_source(args)}.png")), args.max_width)
    return {"sheet": str(dest), "centre": centre, "frames": [f["index"] for f in frames]}, f"burst around frame {centre} ({len(frames)} frames, time order left to right): {dest}", 0


def _signature(rgb, n: int = 4):
    """Mean luma of an n x n grid: a clip's brightness over time, kept per cell so motion that leaves the frame's
    mean unchanged still gives the alignment something to hold."""
    import numpy as np

    y = luma(rgb)
    h, w = y.shape
    return np.array([y[i * h // n:(i + 1) * h // n, j * w // n:(j + 1) * w // n].mean() for i in range(n) for j in range(n)])


def best_lag(sa, sb, max_lag: int) -> tuple[int, float | None]:
    """The lag (frames) maximising the correlation of the two clips' grid-luma series: B[i + lag] shows what A[i] shows."""
    import numpy as np

    best: tuple[int, float | None] = (0, None)
    for lag in sorted(range(-max_lag, max_lag + 1), key=abs):  # ties go to the smaller lag
        a, b = (sa[:len(sa) - lag], sb[lag:]) if lag >= 0 else (sa[-lag:], sb[:len(sb) + lag])
        n = min(len(a), len(b))
        if n < 3:
            continue
        x, y = a[:n] - a[:n].mean(0), b[:n] - b[:n].mean(0)
        den = math.sqrt(float((x * x).sum() * (y * y).sum()))
        if den < 1e-9:
            continue
        c = float((x * y).sum() / den)
        if best[1] is None or c > best[1] + 1e-9:
            best = (lag, c)
    return best


def cmd_compare(args):
    import numpy as np
    from PIL import Image

    notes: list[str] = []
    if args.a and args.b:
        seq_a = open_sequence(args.a, rate=args.rate, every=args.every, what="A")
        seq_b = open_sequence(args.b, rate=args.rate, every=args.every, what="B")
        stem = "video"
    elif args.shot:
        cfg = pl.load_config()
        src, ref = default_source(args), args.against or cfg["reference"]
        seq_a = open_sequence(shot=args.shot, source=src, rate=args.rate, every=args.every, what=src)
        seq_b = open_sequence(shot=args.shot, source=ref, rate=args.rate, every=args.every, what=ref)
        stem = f"video.{src}"
    else:
        pl.fail("compare: give two clips (video files or frame folders), or --shot NAME [--source S] [--against REF]")
    fa, fb = seq_a["frames"], seq_b["frames"]
    lag, corr = 0, None
    if args.align:
        sa = np.array([_signature(load_rgb(f["path"], 160)) for f in fa])
        sb = np.array([_signature(load_rgb(f["path"], 160)) for f in fb])
        lag, corr = best_lag(sa, sb, args.max_lag)
        if corr is None:
            notes.append("--align: brightness does not change over the clips, so there was nothing to align on; lag 0 used")
    pairs = [(fa[i], fb[i + lag]) for i in range(len(fa)) if 0 <= i + lag < len(fb)]
    if not pairs:
        pl.fail("compare: the clips have no frame in common")
    if len(fa) != len(fb):
        notes.append(f"A has {len(fa)} frames and B {len(fb)}: {len(pairs)} pairs compared")
    rows = []
    for a, b in pairs:
        ya = luma(load_rgb(a["path"], args.size))
        with Image.open(b["path"]) as im:  # B at A's analysed size, whatever its own
            yb = luma(np.asarray(im.convert("RGB").resize((ya.shape[1], ya.shape[0]), Image.BOX), dtype=np.float32) / 255.0)
        s, p = ssim_psnr(ya, yb)
        rows.append({"index": a["index"], "indexB": b["index"], "t": a["t"], "ssim": round(s, 5), "psnr": round(p, 3)})
    ss, ps = np.array([r["ssim"] for r in rows]), np.array([r["psnr"] for r in rows])
    worst = sorted(range(len(rows)), key=lambda i: rows[i]["ssim"])[:args.worst]
    doc: dict[str, Any] = {
        "a": seq_a["label"], "b": seq_b["label"], "pairs": len(rows), "lag": lag, "lagCorrelation": None if corr is None else round(corr, 4),
        "ssim": {"mean": round(float(ss.mean()), 5), "min": round(float(ss.min()), 5), "worstFrame": rows[int(ss.argmin())]["index"]},
        "psnr": {"mean": round(float(ps.mean()), 3), "min": round(float(ps.min()), 3), "worstFrame": rows[int(ps.argmin())]["index"]},
        "worst": [rows[i] for i in worst], "notes": notes,
    }
    failed = [f"{name} {got:.4g} < {want:g}" for name, got, want in (
        ("worst-frame SSIM", ss.min(), args.min_ssim), ("mean SSIM", ss.mean(), args.min_mean_ssim), ("worst-frame PSNR", ps.min(), args.min_psnr))
        if want is not None and got < want]
    doc["gate"] = {"passed": not failed, "failed": failed}
    d = out_dir(args, args.shot, need=False)
    if d:
        tw = (min(args.max_width, 1800) - 16) // 3
        with Image.open(pairs[0][0]["path"]) as im:
            tw = min(tw, max(320, im.width))  # small frames are not blown up to fill the sheet
        strip = []
        for i in sorted(worst):  # time order reads better than badness order
            a, b = pairs[i]
            with Image.open(a["path"]) as ia, Image.open(b["path"]) as ib:
                ia, ib = ia.convert("RGB"), ib.convert("RGB").resize(ia.size)
                diff = Image.fromarray(np.clip(np.abs(np.asarray(ia, dtype=np.int16) - np.asarray(ib, dtype=np.int16)) * 4, 0, 255).astype(np.uint8))
                strip += [tile(ia, f"A {frame_caption(a)}", tw), tile(ib, f"B {frame_caption(b)}", tw),
                          tile(diff, f"|A-B| x4   ssim {rows[i]['ssim']:.3f}  psnr {rows[i]['psnr']:.1f} dB", tw, (255, 210, 90))]
        doc["sheet"] = str(save_sheet(grid(strip, 3, title=f"worst {len(worst)} of {len(rows)} frames   A = {seq_a['label']}   B = {seq_b['label']}"),
                                      d / f"{stem}.worst.png", args.max_width))
        doc["perFrame"] = rows
        pl.write_json(d / f"{stem}.json", doc)
        doc["report"] = str(d / f"{stem}.json")
    else:
        notes.append("no --out and no .perceptual-loop/ here: no sheet or report written")
    text = "\n".join([
        f"{len(rows)} frame pairs   A = {seq_a['label']}   B = {seq_b['label']}" + (f"   lag {lag:+d} frames (correlation {corr:.3f})" if corr is not None else ""),
        f"  SSIM  mean {ss.mean():.4f}   worst {ss.min():.4f} at frame {doc['ssim']['worstFrame']}",
        f"  PSNR  mean {ps.mean():.2f} dB   worst {ps.min():.2f} dB at frame {doc['psnr']['worstFrame']}" + (f"   ({PSNR_CAP:g} = identical)" if ps.max() >= PSNR_CAP else ""),
        *(f"  note: {n}" for n in notes), *([f"  worst frames: {doc['sheet']}"] if "sheet" in doc else []),
        *(f"  GATE FAILED: {f}" for f in failed),
    ])
    return doc, text, 1 if failed else 0


# -------------------------------------------------------------------------------------------------------- self-test

def synth_frames(d: Path, n: int = 24, size=(160, 120), step: int = 4, ramp: bool = True, start: int = 0) -> None:
    """A light square moving right over a background that brightens: frame k is a function of k only."""
    from PIL import Image, ImageDraw

    d.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        k = start + i
        im = Image.new("RGB", size, (40 + 3 * k,) * 3 if ramp else (40, 40, 40))
        x = 10 + step * k
        ImageDraw.Draw(im).rectangle([x, 40, x + 30, 70], fill=(230, 200, 60))
        im.save(d / f"{i + 1:06d}.png")


def self_test() -> int:
    from PIL import Image, ImageDraw

    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    with tempfile.TemporaryDirectory(prefix="pl-video-test-") as t:
        tmp = Path(t)
        synth_frames(tmp / "a")
        synth_frames(tmp / "b", n=22, start=2)  # the same clip, starting two frames later
        synth_frames(tmp / "c")
        with Image.open(tmp / "c" / "000010.png") as im:
            im = im.copy()
        for y in range(0, 120, 8):  # stripes: SSIM is about structure, a flat patch of another colour barely moves it
            ImageDraw.Draw(im).rectangle([0, y, 159, y + 3], fill=(255, 255, 255))
        im.save(tmp / "c" / "000010.png")
        out = ["--out", str(tmp / "out")]
        _, d, _, _ = run(["contact", "--frames", str(tmp / "a"), "--rate", "12", "--cols", "6", *out])
        with Image.open(d["sheet"]) as im:
            check("contact sheet written, 24 tiles", d["tiles"] == 24 and im.width <= 2000, f"{im.width}x{im.height}")
        _, d, _, _ = run(["burst", "--frames", str(tmp / "a"), "--frame", "10", "--count", "5", *out])
        check("burst: frames 8..12 around frame 10", d["frames"] == [8, 9, 10, 11, 12], str(d["frames"]))
        _, d, _, code = run(["compare", str(tmp / "a"), str(tmp / "a"), "--min-ssim", "0.99", *out])
        check("compare identical clips: SSIM 1, gate passes", d["ssim"]["min"] > 0.9999 and code == 0, f"ssim {d['ssim']['min']}")
        _, d, _, _ = run(["compare", str(tmp / "b"), str(tmp / "a"), "--align", *out])
        check("compare --align finds the 2-frame offset", d["lag"] == 2 and d["ssim"]["min"] > 0.9999, f"lag {d['lag']}, ssim {d['ssim']['min']}")
        _, d, _, code = run(["compare", str(tmp / "a"), str(tmp / "c"), "--min-ssim", "0.9", *out])
        check("compare finds the one damaged frame (index 9) and the gate fails", d["ssim"]["worstFrame"] == 9 and code == 1,
              f"worst frame {d['ssim']['worstFrame']}, ssim {d['ssim']['min']}, exit {code}")
        ff = ffmpeg_exe(required=False)
        if not ff:
            print("  skip  ffmpeg is not installed: probe, frames and clip comparison were not exercised")
        else:
            clip = tmp / "a.mp4"
            for codec in (["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12"], ["-c:v", "mpeg4", "-q:v", "2"]):
                r = _run([ff, "-v", "error", "-y", "-framerate", "12", "-i", str(tmp / "a" / "%06d.png"), *codec, str(clip)])
                if r.returncode == 0:
                    break
            check("ffmpeg encoded the test clip", r.returncode == 0, r.stderr.strip()[:200])
            _, d, _, _ = run(["probe", str(clip)])
            check("probe: 24 frames, 12 fps, 160x120, 2 s", d["frames"] == 24 and abs(d["fps"] - 12) < 0.01 and d["size"] == [160, 120] and abs(d["duration"] - 2) < 0.05,
                  f"{d['frames']} frames, {d['fps']} fps, {d['size']}, {d['duration']} s")
            _, d, _, _ = run(["frames", str(clip), "--every", "6", "--out", str(tmp / "ex")])
            check("frames --every 6: frames 0, 6, 12, 18", [f["index"] for f in d["frames"]] == [0, 6, 12, 18], str([f["index"] for f in d["frames"]]))
            _, d, _, _ = run(["frames", str(clip), "--times", "0.5,1.5", "--out", str(tmp / "ex2")])
            check("frames --times 0.5,1.5: frames 6 and 18", [f["index"] for f in d["frames"]] == [6, 18], str([f["index"] for f in d["frames"]]))
            _, d, _, _ = run(["compare", str(clip), str(tmp / "a"), *out])
            check("compare clip with its source frames: 24 pairs, SSIM > 0.95", d["pairs"] == 24 and d["ssim"]["min"] > 0.95, f"ssim min {d['ssim']['min']}, psnr min {d['psnr']['min']} dB")
            _, d, _, _ = run(["burst", str(clip), "--at", "1.0", "--count", "5", *out])
            check("burst of the clip at 1.0 s: frames 10..14", d["frames"] == [10, 11, 12, 13, 14], str(d["frames"]))
    print("video.py self-test:", "passed" if ok else "FAILED")
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------------------- main

EPILOG = """what the numbers mean
  SSIM   structural similarity of luma, 1 = identical. Computed on frames reduced to --size pixels (long side), so
         it speaks of structure at that scale, not of single-pixel detail. Below about 0.9 the frames differ visibly.
  PSNR   10 log10(1 / mean squared luma error) in dB; 99 = identical. Sensitive to brightness offsets and to
         sub-pixel shifts that the eye does not see; insensitive to where the error is.
  lag    with --align: B[i + lag] is compared with A[i]. Found from brightness over time in a 4x4 grid, so two
         clips whose brightness never changes cannot be aligned (a note says so).
  Neither number says which clip is right or whether a difference matters: open the sheet of the worst frames.

exit codes: 0 done (gates passed), 1 a gate failed, 2 usage or environment error (ffmpeg missing, no such file)"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="video.py", description=__doc__, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true", help="run the built-in checks on synthetic frames (and an ffmpeg-encoded clip when ffmpeg exists) and exit")
    sub = ap.add_subparsers(dest="cmd", metavar="{probe,frames,contact,burst,compare}")
    out_only = common_parent(seq=False)

    p = sub.add_parser("probe", parents=[out_only], help="duration, fps, size and frame count of a video file")
    p.add_argument("file")
    p.set_defaults(fn=cmd_probe)

    p = sub.add_parser("frames", parents=[out_only], help="write frames of a video file as numbered PNGs into --out",
                       description="Frames of a video as --out/000001.png … plus frames.json (file -> frame index and time). Default: every frame.")
    p.add_argument("file")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--every", type=int, help="every Nth frame")
    g.add_argument("--fps", type=float, help="this many frames per second of clip time")
    g.add_argument("--times", help="the frames at these times in seconds, comma separated")
    p.set_defaults(fn=cmd_frames)

    p = sub.add_parser("contact", parents=[common_parent(every_help="show every Nth frame (default: as many as fill --max-tiles)")],
                       help="a contact sheet: tiles in time order, frame index and time under each")
    p.add_argument("file", nargs="?", help="a video file or a folder of frames (or use --frames / --video / --shot)")
    p.add_argument("--cols", type=int, help="tiles per row (default 6)")
    p.add_argument("--max-tiles", type=int, default=24, help="thin the sequence evenly to at most this many tiles (default 24)")
    p.add_argument("--tile-width", type=int, help="tile width in pixels (default: what fits --max-width)")
    p.add_argument("--name", help="file name of the sheet (default contact.png, or contact.<source>.png for a shot)")
    p.set_defaults(fn=cmd_contact)

    p = sub.add_parser("burst", parents=[common_parent(every_help=argparse.SUPPRESS)], help="the frames around one moment, in time order left to right")
    p.add_argument("file", nargs="?", help="a video file or a folder of frames (or use --frames / --video / --shot)")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--at", type=float, metavar="SECONDS", help="the moment, in seconds")
    g.add_argument("--frame", type=int, metavar="N", help="the moment, as a frame number (from 0)")
    p.add_argument("--count", type=int, default=9, help="how many frames (default 9, centred on the moment)")
    p.add_argument("--step", type=int, default=1, help="take every Nth frame around the moment (default 1)")
    p.add_argument("--cols", type=int, help="tiles per row (default: all in one row)")
    p.add_argument("--name", help="file name of the sheet (default burst.png, or burst.<source>.png for a shot)")
    p.set_defaults(fn=cmd_burst)

    p = sub.add_parser("compare", parents=[common_parent()], epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
                       help="per-frame SSIM / PSNR between two clips, the worst frames side by side",
                       description="Per-frame SSIM and PSNR of two clips of the same sequence of instants, paired by frame index "
                                   "(or after --align). With --shot: A = --source, B = --against (default: the reference).")
    p.add_argument("a", nargs="?", help="clip A: a video file or a folder of frames")
    p.add_argument("b", nargs="?", help="clip B")
    p.add_argument("--against", help="with --shot: the source to compare with (default: config.reference)")
    p.add_argument("--align", action="store_true", help="find the frame offset between the clips first (brightness over time, within --max-lag)")
    p.add_argument("--max-lag", type=int, default=5, help="largest offset --align tries, in frames (default 5)")
    p.add_argument("--size", type=int, default=480, help="compare at this many pixels on the long side (default 480)")
    p.add_argument("--worst", type=int, default=4, help="how many of the worst frames the sheet shows (default 4)")
    p.add_argument("--min-ssim", type=float, help="gate: exit 1 when the worst frame's SSIM is below this")
    p.add_argument("--min-mean-ssim", type=float, help="gate: exit 1 when the mean SSIM is below this")
    p.add_argument("--min-psnr", type=float, help="gate: exit 1 when the worst frame's PSNR (dB) is below this")
    p.set_defaults(fn=cmd_compare)
    return ap


def run(argv: list[str] | None = None):
    utf8_stdio()
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
