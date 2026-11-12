# /// script
# requires-python = ">=3.10"
# dependencies = ["mediapipe>=0.10.14", "numpy>=1.24", "Pillow>=10.1"]
# ///
# debt: stays Python while the pose model it wraps ships for Python only, move to Node when that changes
"""keypoints.py: where are a character's joints, and do two pictures agree about them?

  detect   pose keypoints (33 per person; optionally hands and faces) of an image or of frames, as JSON
  compare  a candidate against a reference: per-joint distance in torso lengths (PCK@0.1 / @0.2, mean error),
           limb angle differences (elbow, knee, shoulder, hip, neck), left/right swap, and for sequences the
           error of each joint's trajectory and its jitter. A sheet shows both skeletons on both pictures.

Detection is MediaPipe's landmarker models (the Tasks API), run on the CPU. The FIRST RUN DOWNLOADS the model it
needs into the user's cache, never into the project: pose `full` 9 MB (`lite` 6 MB, `heavy` 29 MB), hands 7.5 MB,
face 3.6 MB, from storage.googleapis.com/mediapipe-models. The cache is --cache-dir, else $PL_CACHE_DIR, else
%LOCALAPPDATA%\\perceptual-loop\\models (Windows) or ~/.cache/perceptual-loop/models. The mediapipe package itself
(about 21 MB, plus opencv-contrib 51 MB and matplotlib as its dependencies) is installed by `uv run` on first use;
it has wheels for CPython 3.10 and later on Windows x64, macOS and Linux (x64, arm64).

An input is an image, a folder of frames, a video file, or a shot (`--shot NAME --source S`: its beauty picture,
or with --clip its clip).

An optional extra of the perceptual-loop plugin, and its only Python beside semantic.py: the rest of the plugin is Node and
runs without this file. Start it through the CLI (`node pl.mjs keypoints ...`, which finds uv or a Python) or directly
(`uv run --no-project keypoints.py ...`). It stands alone: nothing is imported from the plugin.
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
import time
import urllib.request
from pathlib import Path
from typing import Any

# ------------------------------------------------------------------------------------------------------- the project
# What this script shares with the Node CLI (scripts/lib/project.mjs), restated here so the file runs on its own:
# where a project keeps its perceptual state, its config, its shots.

DIR_NAME = ".agents/perceptual"
OLD_DIR_NAME = ".perceptual-loop"  # the first layout's folder: read in place while a repo has not been moved
DEFAULT_CONFIG: dict[str, Any] = {"version": 1, "reference": "reference", "candidates": ["candidate"], "shotsDir": f"{DIR_NAME}/shots"}
PASS_SUFFIX = {"beauty": "", "mask": ".mask", "id": ".id", "depth": ".depth", "albedo": ".albedo"}
IMG_EXT = (".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff")


class PlError(Exception):
    """A usage or environment error: the caller prints it and exits 2."""


def fail(message: str, code: int = 2):
    print(message, file=sys.stderr)
    raise SystemExit(code)


def emit(doc: Any, as_json: bool, text: str | None = None) -> None:
    """Print one JSON document (--json) or the human text."""
    if as_json:
        json.dump(doc, sys.stdout, indent=2, sort_keys=False)
        sys.stdout.write("\n")
    elif text is not None:
        print(text)


def utf8_stdio() -> None:
    """Windows pipes default to a legacy code page: a degree sign or a non-ASCII path would be garbled or raise."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def _on_old_layout(root: Path) -> bool:
    return not (root / DIR_NAME / "config.json").is_file() and (root / OLD_DIR_NAME / "config.json").is_file()


def find_root(start: str | os.PathLike[str] | None = None) -> Path:
    """The project root: the first ancestor holding the state folder's config.json, else the first with .git, else cwd."""
    here = Path(start or os.getcwd()).resolve()
    git_root: Path | None = None
    for p in [here, *here.parents]:
        if (p / DIR_NAME / "config.json").is_file() or (p / OLD_DIR_NAME / "config.json").is_file():
            return p
        if git_root is None and (p / ".git").exists():
            git_root = p
    return git_root or here


def pl_dir(root: Path | None = None) -> Path:
    env = os.environ.get("PL_DIR") or os.environ.get("PERCEPTUAL_LOOP_DIR")
    if env:
        return Path(env).resolve()
    root = root or find_root()
    return root / (OLD_DIR_NAME if _on_old_layout(root) else DIR_NAME)


def load_config(root: Path | None = None) -> dict[str, Any]:
    root = root or find_root()
    path = pl_dir(root) / "config.json"
    if not path.is_file():
        return dict(DEFAULT_CONFIG)
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise PlError(f"{path} is not valid JSON: {e}") from e
    config = {**DEFAULT_CONFIG, **doc}
    if "shotsDir" not in doc and _on_old_layout(root):
        config["shotsDir"] = f"{OLD_DIR_NAME}/shots"
    return config


def shots_dir(root: Path | None = None, config: dict[str, Any] | None = None) -> Path:
    root = root or find_root()
    env = os.environ.get("PL_SHOTS_DIR")
    if env:
        return Path(env).resolve()
    rel = str((config or load_config(root))["shotsDir"]).replace("\\", "/")
    # a config that still spells the first layout's folder is read from the state folder once that folder has moved
    if (rel == OLD_DIR_NAME or rel.startswith(OLD_DIR_NAME + "/")) and not (root / OLD_DIR_NAME).exists():
        return pl_dir(root) / rel[len(OLD_DIR_NAME):].lstrip("/")
    p = Path(rel)
    return p if p.is_absolute() else root / p


def runs_dir(root: Path | None = None) -> Path:
    return pl_dir(root) / "runs"


def shot_path(shot: str, root: Path | None = None, config: dict[str, Any] | None = None) -> Path:
    return shots_dir(root, config) / shot


def pass_file(shot_dir: Path, source: str, pass_: str = "beauty") -> Path:
    return shot_dir / f"{source}{PASS_SUFFIX[pass_]}.png"


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def list_frames(d: Path) -> list[Path]:
    return sorted(p for p in Path(d).iterdir() if p.suffix.lower() in IMG_EXT and p.is_file())


# ------------------------------------------------------------------------------------------- clips, frames and sheets
# A clip is a folder of frames, a video file (through the ffmpeg executable), or a shot's clip.

VID_EXT = (".mp4", ".webm", ".mov", ".mkv", ".avi")
BG, FG, DIM = (22, 22, 24), (235, 235, 235), (150, 150, 155)


def common_parent(every_help: str | None = None) -> argparse.ArgumentParser:
    """The output and input flags, as an argparse parent."""
    p = argparse.ArgumentParser(add_help=False)
    g = p.add_argument_group("output")
    g.add_argument("--json", action="store_true", help="print one JSON document on stdout and nothing else")
    g.add_argument("--out", metavar="DIR", help=f"folder for pictures and reports (default: {DIR_NAME}/runs/<run>/<shot>/ when the project has one)")
    g.add_argument("--run", default="adhoc", help=f"run name under {DIR_NAME}/runs/ when --out is not given (default: adhoc)")
    g.add_argument("--max-width", type=int, default=2000, help="no picture is written wider than this many pixels (default 2000)")
    g = p.add_argument_group("input (one of)")
    g.add_argument("--shot", help="a shot of the store; with --source, its clip (frames/<source>/ or <source>.mp4|.webm)")
    g.add_argument("--source", help="the source whose output is measured (default: the first candidate of config.json)")
    g.add_argument("--frames", metavar="DIR", help="a folder of frames, read in name order")
    g.add_argument("--video", metavar="FILE", help="a video file (needs ffmpeg)")
    g.add_argument("--rate", type=float, help="frames per second of a frames folder, for timestamps (a video's own rate is read from it)")
    g.add_argument("--every", type=int, default=None, help=every_help or "use every Nth frame (default 1)")
    return p


def default_source(args: argparse.Namespace) -> str:
    return args.source or load_config()["candidates"][0]


def out_dir(args: argparse.Namespace, shot: str | None = None, need: bool = True) -> Path | None:
    """Where this command may write: --out, else the run folder of a project, else nowhere."""
    if getattr(args, "out", None):
        d = Path(args.out)
    elif pl_dir().is_dir():
        d = runs_dir() / args.run / (shot or "_files")
    elif need:
        fail(f"give --out DIR: there is no {DIR_NAME}/ here to write into")
    else:
        return None
    d.mkdir(parents=True, exist_ok=True)
    return d


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def ffmpeg_exe(needed_for: str = "reading a video file") -> str:
    exe = os.environ.get("PL_FFMPEG") or shutil.which("ffmpeg")
    if not exe:
        fail(f"{needed_for} needs the ffmpeg executable, which is not on PATH.\n"
             "Install it (winget install ffmpeg / brew install ffmpeg / apt install ffmpeg) or set PL_FFMPEG to its path.\n"
             "Folders of frames (--frames DIR) need no ffmpeg.")
    return exe


def _frac(s: str | None) -> float:
    try:
        a, _, b = (s or "0").partition("/")
        return float(a) / float(b or 1)
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe(path: Path) -> dict[str, Any]:
    """The rate and frame count of a video file: from ffprobe when it is there, else from what ffmpeg prints."""
    fp = os.environ.get("PL_FFPROBE") or shutil.which("ffprobe")
    if fp:
        r = _run([fp, "-v", "error", "-count_packets", "-show_entries", "stream=codec_type,avg_frame_rate,r_frame_rate,nb_read_packets", "-of", "json", str(path)])
        if r.returncode != 0:
            fail(f"ffprobe could not read {path}: {r.stderr.strip()}")
        vs = [s for s in json.loads(r.stdout).get("streams", []) if s.get("codec_type") == "video"]
        if not vs:
            fail(f"{path} has no video stream")
        return {"fps": round(_frac(vs[0].get("avg_frame_rate")) or _frac(vs[0].get("r_frame_rate")), 4), "frames": int(vs[0].get("nb_read_packets") or 0)}
    r = _run([ffmpeg_exe("probing a video file"), "-hide_banner", "-i", str(path)])  # exits 1 (no output file); the facts are on stderr
    dur = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", r.stderr)
    vid = re.search(r"Video:.*?([\d.]+)\s*fps", r.stderr)
    if not vid:
        fail(f"ffmpeg found no video stream in {path}")
    duration = (int(dur[1]) * 3600 + int(dur[2]) * 60 + float(dur[3])) if dur else 0.0
    return {"fps": float(vid[1]), "frames": int(round(duration * float(vid[1])))}


def extract(video: Path, out: Path, every: int, info: dict[str, Any]) -> list[dict[str, Any]]:
    """Every Nth frame of a video as out/000001.png ...; returns [{path, index (frame number in the clip, from 0), t (seconds)}]."""
    ff = ffmpeg_exe("extracting frames")
    rate = info["fps"] or 0.0
    out.mkdir(parents=True, exist_ok=True)
    vf = f"select=not(mod(n\\,{every}))"
    # the frames kept must not be re-timed into a constant rate (ffmpeg would duplicate to fill the gaps);
    # the flag for that was renamed in ffmpeg 5.1, so try the new spelling, then the old
    for sync in (["-fps_mode", "vfr"], ["-vsync", "vfr"]):
        r = _run([ff, "-v", "error", "-y", "-i", str(video), "-vf", vf, *sync, str(out / "%06d.png")])
        if r.returncode == 0:
            break
    else:
        fail(f"ffmpeg could not extract frames of {video}: {r.stderr.strip()}")
    return [{"path": p, "index": k * every, "t": (k * every / rate if rate else None)} for k, p in enumerate(list_frames(out))]


def temp_dir() -> Path:
    d = Path(tempfile.mkdtemp(prefix="pl-"))
    atexit.register(shutil.rmtree, d, True)
    return d


def open_sequence(path: str | Path | None = None, *, shot: str | None = None, source: str | None = None, rate: float | None = None,
                  every: int | None = 1, what: str = "input") -> dict[str, Any]:
    """A clip as frames on disk: {frames: [{path, index, t}], fps}. `path` is a folder of frames, a video file or
    one image; without it, the clip of a shot's source."""
    every = max(1, every or 1)
    if path is None:
        if not shot:
            fail(f"{what}: give --frames DIR, --video FILE, or --shot NAME --source S")
        d = shot_path(shot)
        if not d.is_dir():
            fail(f"no such shot: {shot} (looked in {d.parent})")
        clips = [d / "frames" / source] if (d / "frames" / source).is_dir() else [d / f"{source}{e}" for e in VID_EXT if (d / f"{source}{e}").is_file()]
        if not clips:
            fail(f"shot '{shot}' has no clip of source '{source}' (looked for frames/{source}/ and {source}.mp4|.webm in {d})")
        path = clips[0]
    path = Path(path)
    if path.is_dir():
        files = list_frames(path)
        if not files:
            fail(f"{what}: no frames (png/jpg...) in {path}")
        return {"frames": [{"path": p, "index": i, "t": (i / rate if rate else None)} for i, p in list(enumerate(files))[::every]], "fps": rate}
    if not path.is_file():
        fail(f"{what}: no such file or folder: {path}")
    if path.suffix.lower() in IMG_EXT:
        return {"frames": [{"path": path, "index": 0, "t": None}], "fps": rate}
    info = probe(path)
    frames = extract(path, temp_dir(), every, info)
    if not frames:
        fail(f"{what}: ffmpeg gave no frames for {path}")
    return {"frames": frames, "fps": info["fps"]}


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

POSE = ["nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer", "left_ear", "right_ear", "mouth_left",
        "mouth_right", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index",
        "right_index", "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle", "left_heel", "right_heel",
        "left_foot_index", "right_foot_index"]
# the joints a body pose is judged by: the model's eye, mouth, finger and foot points wander too much to gate on
BODY = ["nose", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee",
        "left_ankle", "right_ankle"]
BONES = [("left_shoulder", "right_shoulder"), ("left_hip", "right_hip"), ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
         ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"), ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
         ("left_hip", "left_knee"), ("left_knee", "left_ankle"), ("right_hip", "right_knee"), ("right_knee", "right_ankle")]
ANGLES = {f"{s}_{n}": (f"{s}_{a}", f"{s}_{b}", f"{s}_{c}") for s in ("left", "right")
          for n, (a, b, c) in {"elbow": ("shoulder", "elbow", "wrist"), "knee": ("hip", "knee", "ankle"), "shoulder": ("elbow", "shoulder", "hip"), "hip": ("shoulder", "hip", "knee")}.items()}
MODELS = {
    "pose-lite": "pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    "pose-full": "pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    "pose-heavy": "pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
    "hands": "hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
    "face": "face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
}
BASE_URL = "https://storage.googleapis.com/mediapipe-models/"


# ----------------------------------------------------------------------------------------------------------- models

def cache_dir(args) -> Path:
    if getattr(args, "cache_dir", None) or os.environ.get("PL_CACHE_DIR"):
        return Path(args.cache_dir or os.environ["PL_CACHE_DIR"])
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "perceptual-loop" / "models"


def model_bytes(name: str, args) -> bytes:
    dest = cache_dir(args) / Path(MODELS[name]).name
    if not dest.is_file():
        dest.parent.mkdir(parents=True, exist_ok=True)
        url = BASE_URL + MODELS[name]
        print(f"keypoints.py: downloading the {name} model to {dest} (once) …", file=sys.stderr)
        t0 = time.time()
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                data = resp.read()
        except Exception as e:  # noqa: BLE001
            raise PlError(f"could not download {url}: {e}\nFetch it by hand and put it at {dest} (or point --cache-dir at a folder that has it).") from e
        tmp = dest.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        print(f"keypoints.py: {len(data) / 1e6:.1f} MB in {time.time() - t0:.1f} s", file=sys.stderr)
    return dest.read_bytes()


class Detector:
    """MediaPipe landmarkers in IMAGE mode: every frame is detected on its own, so the same picture always gives
    the same keypoints (the VIDEO mode tracks between frames, which is smoother but depends on what came before)."""

    def __init__(self, args):
        try:
            import mediapipe as mp
            from mediapipe.tasks.python import BaseOptions, vision
        except ImportError as e:
            fail(f"keypoints.py needs the mediapipe package, which could not be imported on Python {sys.version.split()[0]} ({e}).\n"
                    "mediapipe publishes wheels for CPython 3.10 and later on Windows x64, macOS and Linux x64/arm64.\n"
                    "Run it as `uv run --no-project keypoints.py …` (uv installs it), or pick an interpreter: `uv run --python 3.12 --no-project keypoints.py …`.")
        self.mp = mp
        # the model is handed over as bytes: a path makes MediaPipe on Windows look for it relative to its own folder
        opt = lambda name: BaseOptions(model_asset_buffer=model_bytes(name, args))  # noqa: E731
        conf = args.min_detection
        self.pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
            base_options=opt(f"pose-{args.model}"), num_poses=args.max_people, min_pose_detection_confidence=conf, min_pose_presence_confidence=conf))
        self.hands = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=opt("hands"), num_hands=2 * args.max_people, min_hand_detection_confidence=conf)) if args.hands else None
        self.face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
            base_options=opt("face"), num_faces=args.max_people, min_face_detection_confidence=conf)) if args.face else None

    def __call__(self, path: Path) -> dict[str, Any]:
        import numpy as np
        from PIL import Image

        with Image.open(path) as im:
            rgb = np.ascontiguousarray(np.asarray(im.convert("RGB")))
        img = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)
        people = [{"pose": {n: [round(p.x, 5), round(p.y, 5), round(p.z, 5), round(float(p.visibility or 0), 3)] for n, p in zip(POSE, lm)}}
                  for lm in self.pose.detect(img).pose_landmarks]
        people.sort(key=lambda p: -torso(p["pose"], rgb.shape[1] / rgb.shape[0]))  # the largest person first
        doc: dict[str, Any] = {"image": str(path), "size": [rgb.shape[1], rgb.shape[0]], "people": people}
        if self.hands:
            res = self.hands.detect(img)
            doc["hands"] = [{"handedness": h[0].category_name, "points": [[round(p.x, 5), round(p.y, 5), round(p.z, 5)] for p in lm]} for lm, h in zip(res.hand_landmarks, res.handedness)]
        if self.face:
            doc["faces"] = [{"points": [[round(p.x, 5), round(p.y, 5), round(p.z, 5)] for p in lm]} for lm in self.face.detect(img).face_landmarks]
        return doc


# --------------------------------------------------------------------------------------------------------- geometry

def xy(pose: dict[str, list[float]], name: str, aspect: float):
    """A joint in image heights (x scaled by the aspect ratio), so a distance means the same in x and y."""
    import numpy as np

    return np.array([pose[name][0] * aspect, pose[name][1]])


def mid(pose, a: str, b: str, aspect: float):
    return (xy(pose, a, aspect) + xy(pose, b, aspect)) / 2


def torso(pose, aspect: float) -> float:
    import numpy as np

    return float(np.linalg.norm(mid(pose, "left_shoulder", "right_shoulder", aspect) - mid(pose, "left_hip", "right_hip", aspect)))


def angle_at(a, b, c) -> float:
    import numpy as np

    u, v = a - b, c - b
    den = float(np.linalg.norm(u) * np.linalg.norm(v))
    return math.degrees(math.acos(max(-1.0, min(1.0, float(u @ v) / den)))) if den > 1e-12 else math.nan


def limb_angles(pose, aspect: float, min_vis: float) -> dict[str, float]:
    """Angles in the picture plane (the model's depth is a guess, so a limb pointing at the camera reads oddly)."""
    out = {}
    for name, (a, b, c) in ANGLES.items():
        if min(pose[a][3], pose[b][3], pose[c][3]) >= min_vis:
            out[name] = angle_at(xy(pose, a, aspect), xy(pose, b, aspect), xy(pose, c, aspect))
    if min(pose[n][3] for n in ("nose", "left_shoulder", "right_shoulder", "left_hip", "right_hip")) >= min_vis:
        sh = mid(pose, "left_shoulder", "right_shoulder", aspect)
        out["neck"] = angle_at(mid(pose, "left_hip", "right_hip", aspect), sh, xy(pose, "nose", aspect))
    return out


def swap_lr(name: str) -> str:
    return "right" + name[4:] if name.startswith("left") else ("left" + name[5:] if name.startswith("right") else name)


def compare_pose(cand, ref, aspect: float, joints: list[str], min_vis: float, align: str) -> dict[str, Any]:
    """One person against one person. Distances are in the REFERENCE's torso lengths (mid-shoulder to mid-hip), so
    they do not depend on how large the character is in the picture. `align` root: both are first moved to their
    own torso centre and scaled by their own torso, which compares the pose and forgives where the character stands."""
    import numpy as np

    t_ref, t_cand = torso(ref, aspect), torso(cand, aspect)
    if t_ref < 1e-6:
        return {"note": "the reference's torso has no length: nothing to normalise by"}

    def place(pose, name: str, t: float):
        p = xy(pose, name, aspect)
        if align == "root":
            centre = (mid(pose, "left_shoulder", "right_shoulder", aspect) + mid(pose, "left_hip", "right_hip", aspect)) / 2
            return (p - centre) / max(t, 1e-6)
        return p / t_ref

    def errors(rename) -> dict[str, float]:
        return {j: float(np.linalg.norm(place(cand, rename(j), t_cand) - place(ref, j, t_ref)))
                for j in joints if ref[j][3] >= min_vis and cand[rename(j)][3] >= min_vis}

    err, swapped = errors(lambda j: j), errors(swap_lr)
    if not err:
        return {"note": f"no joint is visible (>= {min_vis:g}) in both"}
    e = np.array(list(err.values()))
    sided = [j for j in err if j != swap_lr(j) and j in swapped]
    straight, crossed = (float(np.mean([err[j] for j in sided])), float(np.mean([swapped[j] for j in sided]))) if sided else (0.0, 0.0)
    ac, ar = limb_angles(cand, aspect, min_vis), limb_angles(ref, aspect, min_vis)
    ang = {k: abs(ac[k] - ar[k]) for k in ar if k in ac and not math.isnan(ac[k]) and not math.isnan(ar[k])}
    return {"joints": len(err), "of": len(joints), "meanError": float(e.mean()), "maxError": float(e.max()), "worstJoint": max(err, key=err.get),
            "pck01": float((e < 0.1).mean()), "pck02": float((e < 0.2).mean()), "perJoint": err,
            "angles": ang, "maxAngle": max(ang.values()) if ang else None, "worstAngle": max(ang, key=ang.get) if ang else None,
            # the same limbs fit much better when the candidate's left is read as right: a mirrored or swapped character
            "swap": {"suspected": bool(sided) and straight > 0.15 and crossed < 0.5 * straight, "meanError": straight, "meanErrorSwapped": crossed},
            "scale": t_cand / t_ref}


def match_people(cand: list, ref: list, aspect: float) -> list[tuple[int, int]]:
    """Each reference person takes the nearest free candidate (torso centres), largest reference first."""
    import numpy as np

    centre = lambda p: (mid(p["pose"], "left_shoulder", "right_shoulder", aspect) + mid(p["pose"], "left_hip", "right_hip", aspect)) / 2  # noqa: E731
    free, pairs = list(range(len(cand))), []
    for i, rp in enumerate(ref):
        if free:
            j = min(free, key=lambda k: float(np.linalg.norm(centre(cand[k]) - centre(rp))))
            pairs.append((j, i))
            free.remove(j)
    return pairs


# ------------------------------------------------------------------------------------------------------------ sheet

def draw_skeleton(dr, pose, size, colour, min_vis: float, width: int = 3) -> None:
    w, h = size
    pt = lambda n: (pose[n][0] * w, pose[n][1] * h)  # noqa: E731
    for a, b in BONES:
        if min(pose[a][3], pose[b][3]) >= min_vis:
            dr.line([pt(a), pt(b)], fill=colour, width=width)
    for n in BODY:
        if pose[n][3] >= min_vis:
            x, y = pt(n)
            rad = width + (2 if n.startswith("left") else 0)  # left joints drawn larger: a swap is visible
            dr.ellipse([x - rad, y - rad, x + rad, y + rad], fill=colour, outline=(0, 0, 0))


REF_COL, CAND_COL = (70, 220, 255), (255, 150, 40)


def pair_tiles(cand_doc, ref_doc, caption: str, tw: int, min_vis: float) -> list:
    from PIL import Image, ImageDraw

    tiles = []
    for doc, label in ((ref_doc, "reference"), (cand_doc, "candidate")):
        with Image.open(doc["image"]) as im:
            im = im.convert("RGB")
        scale = max(1.0, 900 / im.width)
        im = im.resize((round(im.width * scale), round(im.height * scale)))
        dr = ImageDraw.Draw(im)
        for p in ref_doc["people"]:
            draw_skeleton(dr, p["pose"], im.size, REF_COL, min_vis)
        for p in cand_doc["people"]:
            draw_skeleton(dr, p["pose"], im.size, CAND_COL, min_vis, 2)
        tiles.append(tile(im, f"{label} picture   {caption}", tw))
    return tiles


# --------------------------------------------------------------------------------------------------------- commands

def frames_of(path: str | None, args, source: str | None, what: str) -> list[dict[str, Any]]:
    if path:
        return open_sequence(path, rate=args.rate, every=args.every, what=what)["frames"]
    if not args.shot:
        fail(f"{what}: give an image, a folder of frames, a video, or --shot NAME --source S")
    if args.clip:
        return open_sequence(shot=args.shot, source=source, rate=args.rate, every=args.every, what=what)["frames"]
    p = pass_file(shot_path(args.shot), source)
    if not p.is_file():
        fail(f"shot '{args.shot}' has no picture of source '{source}' ({p})")
    return [{"path": p, "index": 0, "t": None}]


def rounded(o: Any) -> Any:
    if isinstance(o, float):
        return None if math.isnan(o) else round(o, 4)
    if isinstance(o, dict):
        return {k: rounded(v) for k, v in o.items()}
    return [rounded(v) for v in o] if isinstance(o, list) else o


def cmd_detect(args):
    frames = frames_of(args.input or args.frames or args.video, args, default_source(args) if args.shot else None, "detect")
    det = Detector(args)
    docs = [{"index": f["index"], **det(f["path"])} for f in frames]
    counts = [len(d["people"]) for d in docs]
    doc = {"model": f"mediapipe pose_landmarker_{args.model}", "coordinates": "x, y in 0..1 of the image width and height (origin top left), z relative depth, then visibility 0..1",
           "frames": docs, "peoplePerFrame": counts}
    notes = []
    if not any(counts):
        notes.append("no person was found: the model answers for photographic or rendered human figures seen mostly whole; stick figures, tiny or heavily stylised characters are missed")
    doc["notes"] = notes
    d = out_dir(args, args.shot if not (args.input or args.frames or args.video) else None, need=False)
    if d:
        write_json(d / args.name, doc)
        doc["report"] = str(d / args.name)
    text = f"{len(docs)} picture(s): people found per picture {counts}" + (f"\n  keypoints: {doc['report']}" if d else "") + "".join(f"\n  note: {n}" for n in notes)
    return doc, text, 0


def cmd_compare(args):
    import numpy as np

    cfg_ref = None if (args.candidate and args.reference) else (args.against or load_config()["reference"])
    cf = frames_of(args.candidate, args, None if args.candidate else default_source(args), "candidate")
    rf = frames_of(args.reference, args, cfg_ref, "reference")
    det = Detector(args)
    joints = BODY if args.joints == "body" else POSE
    n = min(len(cf), len(rf))
    notes = [f"candidate has {len(cf)} frames and reference {len(rf)}: the first {n} are compared"] if len(cf) != len(rf) else []
    rows, tracks = [], {"cand": [], "ref": []}
    docs = []
    for k in range(n):
        cd, rd = det(cf[k]["path"]), det(rf[k]["path"])
        aspect = rd["size"][0] / rd["size"][1]
        pairs = match_people(cd["people"], rd["people"], aspect)
        people = [compare_pose(cd["people"][i]["pose"], rd["people"][j]["pose"], aspect, joints, args.min_visibility, args.align) for i, j in pairs]
        rows.append({"index": cf[k]["index"], "peopleCandidate": len(cd["people"]), "peopleReference": len(rd["people"]), "people": people})
        docs.append((cd, rd))
        for key, d in (("cand", cd), ("ref", rd)):  # the largest person's joints over time, in reference torso lengths
            t = torso(rd["people"][0]["pose"], aspect) if rd["people"] else math.nan
            tracks[key].append([list(xy(d["people"][0]["pose"], j, aspect) / t) if d["people"] and t > 1e-6 else [math.nan, math.nan] for j in joints])
    scored = [(r["index"], p) for r in rows for p in r["people"] if "pck02" in p]
    failed: list[str] = []
    miss = [r["index"] for r in rows if r["peopleCandidate"] != r["peopleReference"]]
    if miss:
        notes.append(f"the number of people differs in frame(s) {miss[:10]}: candidate {[r['peopleCandidate'] for r in rows if r['index'] in miss][:10]}, "
                     f"reference {[r['peopleReference'] for r in rows if r['index'] in miss][:10]}")
    if not scored:
        notes.append("no person was found in both: nothing was compared (the detector misses stick figures, tiny or heavily stylised characters)")
        summary = None
        if args.min_pck is not None or args.max_angle_deg is not None:
            failed.append("nothing to gate: no person found in both pictures")
    else:
        angs = [p["maxAngle"] for _, p in scored if p["maxAngle"] is not None]
        worst = min(scored, key=lambda s: s[1]["pck02"])
        summary = {"compared": len(scored), "pck01": float(np.mean([p["pck01"] for _, p in scored])), "pck02": float(np.mean([p["pck02"] for _, p in scored])),
                   "meanError": float(np.mean([p["meanError"] for _, p in scored])), "maxAngle": max(angs) if angs else None,
                   "worstFrame": worst[0], "swapSuspected": [i for i, p in scored if p["swap"]["suspected"]]}
        if args.min_pck is not None and (summary["pck02"] < args.min_pck or miss):
            failed.append(f"PCK@0.2 {summary['pck02']:.3f} < --min-pck {args.min_pck:g}" if summary["pck02"] < args.min_pck else "a person is missing or extra in the candidate")
        if args.max_angle_deg is not None and angs and max(angs) > args.max_angle_deg:
            w = max((p for _, p in scored if p["maxAngle"] is not None), key=lambda p: p["maxAngle"])
            failed.append(f"limb angle differs by {w['maxAngle']:.1f}° at the {w['worstAngle']} > --max-angle-deg {args.max_angle_deg:g}")
    doc: dict[str, Any] = {"model": f"mediapipe pose_landmarker_{args.model}", "unit": "reference torso lengths (mid-shoulder to mid-hip)", "align": args.align,
                           "joints": args.joints, "summary": summary, "frames": rows, "notes": notes}
    if n >= 4 and scored:
        c, rr = np.array(tracks["cand"]), np.array(tracks["ref"])
        jit = lambda a: np.sqrt(np.nanmean(np.sum(np.diff(a, 2, axis=0) ** 2, axis=2), axis=0))  # noqa: E731  RMS second difference per joint
        with np.errstate(all="ignore"):
            terr = np.nanmean(np.linalg.norm(c - rr, axis=2), axis=0)
            jc, jr = jit(c), jit(rr)
        doc["trajectories"] = {"note": "the largest person of each frame; jitter = RMS of the second difference of a joint's position over frames",
                               "perJoint": {j: {"meanError": float(terr[i]), "jitter": float(jc[i]), "jitterReference": float(jr[i])} for i, j in enumerate(joints)},
                               "meanError": float(np.nanmean(terr)), "jitter": float(np.nanmean(jc)), "jitterReference": float(np.nanmean(jr))}
    doc["gate"] = {"passed": not failed, "failed": failed}
    shot = None if args.candidate else args.shot
    d = out_dir(args, shot, need=False)
    stem = f"keypoints.{default_source(args)}" if shot else "keypoints"
    if d:
        show = sorted({0, n - 1, *([[r["index"] for r in rows].index(summary["worstFrame"])] if summary else [])})[:3]
        tw = (min(args.max_width, 1800) - 12) // 2
        tiles = []
        for k in show:
            p = rows[k]["people"][0] if rows[k]["people"] and "pck02" in rows[k]["people"][0] else None
            cap = f"#{rows[k]['index']}  " + (f"PCK@0.2 {p['pck02']:.2f}  mean {p['meanError']:.2f} torso" if p else "no person in both")
            tiles += pair_tiles(docs[k][0], docs[k][1], cap, tw, args.min_visibility)
        title = "pose   blue = reference skeleton, orange = candidate skeleton, both drawn on both pictures; left-side joints are the larger dots"
        doc["sheet"] = str(save_sheet(grid(tiles, 2, title=title), d / f"{stem}.png", args.max_width))
        doc["report"] = str(d / f"{stem}.json")
        write_json(d / f"{stem}.json", rounded(doc))
    else:
        notes.append("no --out and no .agents/perceptual/ here: no sheet or report written")
    lines = [f"pose of {n} picture(s), candidate against reference; distances in reference torso lengths, align = {args.align}"]
    if summary:
        lines.append(f"  PCK@0.1 {summary['pck01']:.3f}   PCK@0.2 {summary['pck02']:.3f}   mean joint error {summary['meanError']:.3f}   "
                     + (f"largest limb-angle difference {summary['maxAngle']:.1f}°" if summary["maxAngle"] is not None else "no limb angle measurable")
                     + (f"   worst frame {summary['worstFrame']}" if n > 1 else ""))
        for i, p in scored[:1] if n == 1 else []:
            lines.append("  per joint: " + "  ".join(f"{j.replace('left_', 'L ').replace('right_', 'R ')} {e:.2f}" for j, e in p["perJoint"].items()))
            lines.append("  angles (°): " + "  ".join(f"{j.replace('left_', 'L ').replace('right_', 'R ')} {e:.0f}" for j, e in p["angles"].items()))
        if summary["swapSuspected"]:
            lines.append(f"  LEFT/RIGHT SWAP suspected in frame(s) {summary['swapSuspected'][:10]}: the limbs fit at least twice as well with the candidate's sides exchanged")
    if "trajectories" in doc:
        t = doc["trajectories"]
        lines.append(f"  trajectories: mean error {t['meanError']:.3f}   jitter {t['jitter']:.4f} (reference {t['jitterReference']:.4f})")
    lines += [f"  note: {x}" for x in notes]
    if "sheet" in doc:
        lines.append(f"  sheet: {doc['sheet']}\n  report: {doc['report']}")
    lines += [f"  GATE FAILED: {x}" for x in failed]
    return rounded(doc), "\n".join(lines), 1 if failed else 0


# -------------------------------------------------------------------------------------------------------- self-test

def stick(dx: float = 0.0) -> dict[str, list[float]]:
    """A standing figure's keypoints, for testing the arithmetic without a model (image 1:1; torso 0.25)."""
    p = {n: [0.5 + dx, 0.2, 0.0, 0.0] for n in POSE}
    for name, (x, y) in {"nose": (0.5, 0.2), "left_shoulder": (0.6, 0.3), "right_shoulder": (0.4, 0.3), "left_elbow": (0.65, 0.42), "right_elbow": (0.35, 0.42),
                         "left_wrist": (0.72, 0.5), "right_wrist": (0.33, 0.55), "left_hip": (0.56, 0.55), "right_hip": (0.44, 0.55), "left_knee": (0.57, 0.72),
                         "right_knee": (0.43, 0.72), "left_ankle": (0.58, 0.9), "right_ankle": (0.42, 0.9)}.items():
        p[name] = [x + dx, y, 0.0, 1.0]
    return p


def self_test() -> int:
    from PIL import Image, ImageDraw

    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    ref = stick()
    same = compare_pose(stick(), ref, 1.0, BODY, 0.5, "none")
    check("arithmetic: identical poses: error 0, PCK 1, angles 0", same["meanError"] < 1e-9 and same["pck01"] == 1 and same["maxAngle"] < 1e-6)
    moved = stick()
    moved["left_wrist"][0] += 0.1  # 0.4 torso lengths
    m = compare_pose(moved, ref, 1.0, BODY, 0.5, "none")
    check("arithmetic: one wrist moved 0.4 torso: PCK@0.2 = 12/13, worst joint and elbow angle say so",
          abs(m["pck02"] - 12 / 13) < 1e-9 and m["worstJoint"] == "left_wrist" and abs(m["maxError"] - 0.4) < 1e-6 and m["worstAngle"] == "left_elbow" and m["maxAngle"] > 15,
          f"PCK@0.2 {m['pck02']:.3f}, max error {m['maxError']:.2f} at {m['worstJoint']}, {m['worstAngle']} differs {m['maxAngle']:.1f}°")
    shifted = compare_pose(stick(0.1), ref, 1.0, BODY, 0.5, "none")
    rooted = compare_pose(stick(0.1), ref, 1.0, BODY, 0.5, "root")
    check("arithmetic: the same pose standing 0.4 torso to the side: PCK 0 unaligned, 1 with --align root", shifted["pck02"] == 0 and rooted["pck02"] == 1 and shifted["maxAngle"] < 1e-6,
          f"mean error {shifted['meanError']:.2f} -> {rooted['meanError']:.2g}")
    mirrored = {n: list(ref[swap_lr(n)]) for n in POSE}
    s = compare_pose(mirrored, ref, 1.0, BODY, 0.5, "none")
    check("arithmetic: left and right exchanged: swap suspected", s["swap"]["suspected"] and not m["swap"]["suspected"] and not same["swap"]["suspected"],
          f"mean error {s['swap']['meanError']:.2f}, with sides exchanged {s['swap']['meanErrorSwapped']:.2f}")
    with tempfile.TemporaryDirectory(prefix="pl-keypoints-test-") as t:
        tmp = Path(t)
        im = Image.new("RGB", (320, 240), (90, 120, 150))
        ImageDraw.Draw(im).rectangle([120, 60, 200, 200], fill=(200, 180, 60))
        im.save(tmp / "blank.png")
        photo = os.environ.get("PL_TEST_PHOTO")  # a real photograph of a person, if the caller has one: the only way to exercise detection
        t0 = time.time()
        try:
            _, d, _, code = run(["detect", str(tmp / "blank.png"), "--out", str(tmp / "out")])
            check("model: loads and runs; a picture without a person gives no people and a note, exit 0", d["peoplePerFrame"] == [0] and code == 0 and d["notes"],
                  f"{time.time() - t0:.1f} s including model load")
            _, d, _, code = run(["compare", str(tmp / "blank.png"), str(tmp / "blank.png"), "--min-pck", "0.9", "--out", str(tmp / "out")])
            check("model: comparing two pictures without a person compares nothing, says so, and a gate then fails", d["summary"] is None and code == 1 and Path(d["sheet"]).is_file())
            if photo and Path(photo).is_file():
                with Image.open(photo) as im:
                    im = im.convert("RGB")
                im.save(tmp / "a.png")
                im.transpose(Image.FLIP_LEFT_RIGHT).save(tmp / "flip.png")
                _, d, _, _ = run(["detect", str(tmp / "a.png"), "--out", str(tmp / "out")])
                check("photo: a person is found", d["peoplePerFrame"][0] >= 1, f"people {d['peoplePerFrame']}")
                _, d, _, code = run(["compare", str(tmp / "a.png"), str(tmp / "a.png"), "--min-pck", "0.99", "--out", str(tmp / "out")])
                check("photo: against itself: PCK 1, error 0 (detection is deterministic)", code == 0 and d["summary"]["meanError"] < 1e-6, f"mean error {d['summary']['meanError']}")
                _, d, _, _ = run(["compare", str(tmp / "flip.png"), str(tmp / "a.png"), "--align", "root", "--out", str(tmp / "out")])
                check("photo: against its mirror image: the pose differs", d["summary"]["meanError"] > 0.05,
                      f"mean error {d['summary']['meanError']}, PCK@0.2 {d['summary']['pck02']}, max angle {d['summary']['maxAngle']}")
            else:
                print("  skip  detection on a real person was NOT exercised: no photograph is bundled (set PL_TEST_PHOTO=/path/to/a/photo to include one)")
        except SystemExit:  # run() has printed why (no network for the model download, most likely)
            print("  skip  the model could not be loaded (see above), so detection was not exercised")
    print("keypoints.py self-test:", "passed" if ok else "FAILED")
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------------------- main

EPILOG = """what the numbers mean
  distances   between a candidate joint and the reference joint, in the reference's torso lengths (mid-shoulder
              to mid-hip): 0.1 is a tenth of a torso, a few centimetres on an adult.
  PCK@0.1/0.2 the share of joints (nose, shoulders, elbows, wrists, hips, knees, ankles; those visible in both)
              closer than 0.1 / 0.2 torso. --min-pck gates PCK@0.2.
  angles      difference of the elbow, knee, shoulder, hip and neck angles in the picture plane, in degrees.
  swap        the limbs fit at least twice as well with the candidate's left and right exchanged.
  jitter      for sequences: RMS of the second difference of a joint's position over frames, beside the
              reference's own. Each frame is detected independently, so some jitter is the detector's.
what they do not mean
  The keypoints are a model's estimate, not ground truth: occluded limbs are guessed, depth (z) is weak, and the
  detector's own error is around 0.05 to 0.1 torso lengths, more on hands and feet. It was trained on photographs
  of people: stylised, non-human or tiny characters are often missed (the output says when nobody was found, and
  a gate then fails rather than pass on nothing). People are matched by position, not identity, and trajectories
  follow the largest person only. Angles are 2D: a limb pointing at the camera reads as a different angle.
  Without --align root the position in the frame counts, which is right for two renders of the same shot and
  wrong for a pose reference drawn at another place or size.

exit codes: 0 done (gates passed), 1 a gate failed, 2 usage or environment error (mediapipe or a model missing)"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="keypoints.py", description=__doc__, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-test", action="store_true", help="check the arithmetic on synthetic keypoints, then the model on a synthetic picture (and on $PL_TEST_PHOTO if set)")
    sub = ap.add_subparsers(dest="cmd", metavar="{detect,compare}")
    common = common_parent(every_help="use every Nth frame of a clip (default 1)")
    g = common.add_argument_group("detection")
    g.add_argument("--model", choices=["lite", "full", "heavy"], default="full", help="pose model: lite 6 MB, full 9 MB (default), heavy 29 MB and the most accurate")
    g.add_argument("--max-people", type=int, default=4, help="most people looked for per picture (default 4)")
    g.add_argument("--min-detection", type=float, default=0.5, help="detection confidence below which a person is not reported (default 0.5)")
    g.add_argument("--hands", action="store_true", help="also detect hands (21 points each; downloads 7.5 MB once)")
    g.add_argument("--face", action="store_true", help="also detect faces (478 points each; downloads 3.6 MB once)")
    g.add_argument("--cache-dir", metavar="DIR", help="where models are kept (default: $PL_CACHE_DIR, else the user's cache; never the project)")
    g.add_argument("--clip", action="store_true", help="with --shot: use the source's clip instead of its picture")
    p = sub.add_parser("detect", parents=[common], help="keypoints of an image or of frames, as JSON", epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", nargs="?", help="an image, a folder of frames or a video (or use --frames / --video / --shot)")
    p.add_argument("--name", default="keypoints.detect.json", help="file name of the keypoints written to --out (default keypoints.detect.json)")
    p.set_defaults(fn=cmd_detect)
    p = sub.add_parser("compare", parents=[common], help="a candidate's pose against a reference's", epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
                       description="Compare the pose in CANDIDATE with the pose in REFERENCE (images, frame folders or videos, paired by frame). "
                                   "With --shot: candidate = --source, reference = --against (default: config.reference). --hands and --face are detected by `detect` only.")
    p.add_argument("candidate", nargs="?")
    p.add_argument("reference", nargs="?")
    p.add_argument("--against", help="with --shot: the reference source")
    p.add_argument("--align", choices=["none", "root"], default="none", help="none (default): positions in the frame are compared as they are; root: each pose is moved to "
                   "its torso centre and scaled by its own torso first (compares the pose, not where or how large the character is)")
    p.add_argument("--joints", choices=["body", "all"], default="body", help="body (default): the 13 main joints; all: the model's 33 points, including eyes, fingers and feet")
    p.add_argument("--min-visibility", type=float, default=0.5, help="a joint is used when its visibility is at least this in both (default 0.5)")
    p.add_argument("--min-pck", type=float, help="gate: smallest allowed PCK@0.2 (0..1), mean over people and frames; also fails when a person is missing or extra")
    p.add_argument("--max-angle-deg", type=float, help="gate: largest allowed limb-angle difference, degrees")
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
    except PlError as e:
        fail(str(e))
    return args, doc, text, code


def main() -> None:
    args, doc, text, code = run()
    emit(doc, args.json, text)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
