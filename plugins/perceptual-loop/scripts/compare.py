# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "pillow>=10", "scipy>=1.10"]
# ///
"""Compare each candidate's beauty pass with the reference's, per shot: the numbers of the loop.

Writes one metrics.<source>.json per shot and candidate (the contract's metrics.json) into the run folder.
The numbers say how far two pictures are apart; they never say which one is right.

What is measured on what:
  ssim, deltaE                    the candidate as it is (what a person sees)
  exposureEV, wb, contrast        the fit that brings the candidate to the reference's exposure and white balance
  deltaENorm, edges, detailLog2   the candidate after that fit, so they speak of colour, structure and sharpness
                                  instead of repeating "it is brighter" three more times
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import groups as gr  # noqa: E402

EDGE_THRESHOLD = 0.015   # gradient of L*/100 per pixel after a 1 px blur: a step of about 4 L* still counts
DEFAULT_MIN_REGION_AREA = 0.002
ROUND = 5


# ------------------------------------------------------------------------------------------------------------ colour

def _srgb_lut():
    import numpy as np

    return pl.srgb_to_linear(np.arange(256, dtype=np.float32) / 255.0)


def to_linear(u8):
    """uint8 sRGB -> float32 linear, through a table: files hold 256 levels, so the power function runs 256 times."""
    return _srgb_lut()[u8]


def to_lab(lin):
    """Linear sRGB (D65) -> CIE L*a*b*, float32."""
    import numpy as np

    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]], np.float32)
    white = np.array([0.95047, 1.0, 1.08883], np.float32)
    xyz = (lin.reshape(-1, 3) @ (m.T / white)).astype(np.float32)
    f = np.where(xyz > 216 / 24389, np.cbrt(np.maximum(xyz, 0)), (24389 / 27 * xyz + 16) / 116).astype(np.float32)
    lab = np.empty_like(f)
    lab[:, 0] = 116 * f[:, 1] - 16
    lab[:, 1] = 500 * (f[:, 0] - f[:, 1])
    lab[:, 2] = 200 * (f[:, 1] - f[:, 2])
    return lab.reshape(lin.shape)


def ciede2000(lab1, lab2):
    """CIEDE2000 per pixel (Sharma, Wu, Dalal 2005), vectorised, in radians and float32."""
    import numpy as np

    pi, tau, p7 = np.float32(np.pi), np.float32(2 * np.pi), np.float32(25.0 ** 7)
    l1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    l2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]

    def pow7(x):
        x2 = x * x
        return x2 * x2 * x2 * x

    cb7 = pow7((np.hypot(a1, b1) + np.hypot(a2, b2)) * 0.5)
    g = 1 + 0.5 * (1 - np.sqrt(cb7 / (cb7 + p7)))
    a1p, a2p = a1 * g, a2 * g
    c1, c2 = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1, h2 = np.arctan2(b1, a1p), np.arctan2(b2, a2p)
    h1 = np.where(h1 < 0, h1 + tau, h1)
    h2 = np.where(h2 < 0, h2 + tau, h2)
    grey = (c1 * c2) == 0  # hue is undefined for a neutral colour: it must not contribute
    dh = h2 - h1
    dh = np.where(dh > pi, dh - tau, np.where(dh < -pi, dh + tau, dh))
    dh = np.where(grey, 0, dh)
    hs = h1 + h2
    hb = np.where(grey, hs, np.where(np.abs(h1 - h2) > pi, np.where(hs < tau, hs + tau, hs - tau), hs) * 0.5)
    t = (1 - 0.17 * np.cos(hb - np.radians(30)) + 0.24 * np.cos(2 * hb)
         + 0.32 * np.cos(3 * hb + np.radians(6)) - 0.20 * np.cos(4 * hb - np.radians(63)))
    cb = (c1 + c2) * 0.5
    lq = ((l1 + l2) * 0.5 - 50) ** 2
    sl = 1 + 0.015 * lq / np.sqrt(20 + lq)
    sc = 1 + 0.045 * cb
    sh = 1 + 0.015 * cb * t
    cbp7 = pow7(cb)
    rt = -np.sin(np.radians(60) * np.exp(-(((np.degrees(hb) - 275) / 25) ** 2))) * 2 * np.sqrt(cbp7 / (cbp7 + p7))
    dl = (l2 - l1) / sl
    dc = (c2 - c1) / sc
    dhh = 2 * np.sqrt(c1 * c2) * np.sin(dh * 0.5) / sh
    return np.sqrt(np.maximum(dl * dl + dc * dc + dhh * dhh + rt * dc * dhh, 0)).astype(np.float32)


# ----------------------------------------------------------------------------------------------------- normalisation

def fit_exposure(ref_lin, cand_lin) -> dict[str, Any]:
    """Per-channel gains (linear light) that bring the candidate to the reference, and what they mean.

    The fit is the median of log ratios over block means of the mid-tones. Block means, because two renderers
    never agree to the pixel and a per-pixel ratio across a misaligned edge is meaningless. A median, because a
    part of the picture that really differs (an object missing, a lamp lit) must not be explained away as
    exposure. Mid-tones, because clipped and near-black pixels have lost the ratio.
    """
    import numpy as np

    h, w = ref_lin.shape[:2]
    block = max(1, round(max(h, w) / 256))
    hh, ww = max(block, h // block * block), max(block, w // block * block)

    def cells(a):
        return a[:hh, :ww].reshape(hh // block, block, ww // block, block, 3).mean((1, 3)).reshape(-1, 3)

    cr, cc = cells(ref_lin), cells(cand_lin)
    weights = np.array([0.2126, 0.7152, 0.0722], np.float32)
    lr, lc = cr @ weights, cc @ weights
    mid = ((lr > 0.01) & (lc > 0.01) & (lr < 0.8) & (lc < 0.8)
           & (cr.min(1) > 0.002) & (cc.min(1) > 0.002) & (cr.max(1) < 0.9) & (cc.max(1) < 0.9))
    rough = int(mid.sum()) < 50
    if rough:  # a nearly black, white or pure-coloured picture: fit on everything rather than on nothing
        mid = np.ones_like(mid)
    floor = 1e-4
    ratio = 2.0 ** np.median(np.log2(np.maximum(cc[mid], floor) / np.maximum(cr[mid], floor)), axis=0)
    ratio = np.clip(ratio, 1 / 16, 16)
    ev = float(np.median(np.log2(np.maximum(lc[mid], floor) / np.maximum(lr[mid], floor))))
    # contrast: how wide the candidate's tonal range is next to the reference's, in stops (exposure cancels out)
    pr = np.percentile(np.log2(np.maximum(lr, floor)), [5, 95])
    pc = np.percentile(np.log2(np.maximum(lc, floor)), [5, 95])
    spread_r, spread_c = float(pr[1] - pr[0]), float(pc[1] - pc[0])
    return {
        "gains": (1.0 / ratio).astype(np.float32),
        "exposureEV": ev,
        "wb": [float(x) for x in ratio / ratio[1]],  # the candidate's channels against the reference's, green = 1
        "contrast": spread_c / spread_r if spread_r > 1e-3 else 1.0,
        "rough": rough,
    }


# ---------------------------------------------------------------------------------------------------- structure maps

def ssim_map(x, y):
    """SSIM per pixel on lightness in 0..1 (Wang et al. 2004: gaussian window, sigma 1.5)."""
    from scipy.ndimage import gaussian_filter

    def g(a):
        return gaussian_filter(a, 1.5, truncate=3.5, mode="reflect")

    mx, my = g(x), g(y)
    sxx, syy, sxy = g(x * x) - mx * mx, g(y * y) - my * my, g(x * y) - mx * my
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    return ((2 * mx * my + c1) * (2 * sxy + c2)) / ((mx * mx + my * my + c1) * (sxx + syy + c2))


def edge_map(light):
    """Thin edges of a lightness image: Sobel on a slightly blurred picture, kept where the gradient peaks."""
    import numpy as np
    from scipy.ndimage import gaussian_filter, sobel

    s = gaussian_filter(light, 1.0, mode="reflect")
    gx, gy = sobel(s, axis=1) / 8, sobel(s, axis=0) / 8
    mag = np.hypot(gx, gy)
    p = np.pad(mag, 1)
    # non-maximum suppression along the dominant axis only: enough to thin a line to 1-2 px, and cheap
    peak = np.where(np.abs(gx) >= np.abs(gy),
                    (mag >= p[1:-1, :-2]) & (mag > p[1:-1, 2:]), (mag >= p[:-2, 1:-1]) & (mag > p[2:, 1:-1]))
    return (mag > EDGE_THRESHOLD) & peak


def match_edges(ref_edge, cand_edge, tolerance: int):
    """Which edge pixels of each picture have an edge of the other within `tolerance` pixels."""
    from scipy.ndimage import maximum_filter

    size = 2 * tolerance + 1
    near_cand = maximum_filter(cand_edge.view("uint8"), size=size).view(bool) if tolerance else cand_edge
    near_ref = maximum_filter(ref_edge.view("uint8"), size=size).view(bool) if tolerance else ref_edge
    return ref_edge & near_cand, cand_edge & near_ref


def edge_scores(ref_hit: int, ref_total: int, cand_hit: int, cand_total: int) -> tuple[float, float, float]:
    """(F1, recall, precision). No edges on either side is agreement (1); edges on one side only is 0."""
    recall = ref_hit / ref_total if ref_total else 1.0
    precision = cand_hit / cand_total if cand_total else 1.0
    if not ref_total and not cand_total:
        return 1.0, 1.0, 1.0
    f1 = 2 * recall * precision / (recall + precision) if recall + precision else 0.0
    return f1, recall, precision


def analyse(ref_u8, cand_u8, edge_tolerance: int = 2, want: dict[str, bool] | None = None) -> dict[str, Any]:
    """Frame metrics and the per-pixel maps behind them (sheet.py draws the maps, regions average them)."""
    import numpy as np
    from scipy.ndimage import laplace

    want = {"ssim": True, "deltaE": True, "edges": True, "detail": True, **(want or {})}
    ref_lin, cand_lin = to_linear(ref_u8), to_linear(cand_u8)
    fit = fit_exposure(ref_lin, cand_lin)
    lab_r = to_lab(ref_lin)
    lab_n = to_lab(cand_lin * fit["gains"])
    lab_c = to_lab(cand_lin) if want["ssim"] or want["deltaE"] else None
    light_r, light_n = lab_r[..., 0] / 100, lab_n[..., 0] / 100

    frame: dict[str, Any] = {}
    maps: dict[str, Any] = {"gains": fit["gains"]}
    if want["ssim"]:
        maps["ssim"] = ssim_map(light_r, lab_c[..., 0] / 100)
        frame["ssim"] = float(maps["ssim"].mean())
    if want["deltaE"]:
        frame["deltaE"] = float(ciede2000(lab_r, lab_c).mean())
        maps["deltaENorm"] = ciede2000(lab_r, lab_n)
        frame["deltaENorm"] = float(maps["deltaENorm"].mean())
    frame.update(exposureEV=fit["exposureEV"], wb=fit["wb"], contrast=fit["contrast"])
    if want["edges"]:
        er, ec = edge_map(light_r), edge_map(light_n)
        hr, hc = match_edges(er, ec, edge_tolerance)
        maps.update(refEdge=er, candEdge=ec, refHit=hr, candHit=hc)
        frame["edgeF1"], frame["edgeRecall"], frame["edgePrecision"] = edge_scores(int(hr.sum()), int(er.sum()), int(hc.sum()), int(ec.sum()))
    if want["detail"]:
        # variance of the Laplacian = energy in the finest detail; after normalisation, or a brighter picture
        # would read as a sharper one
        vr, vc = float(laplace(light_r).var()), float(laplace(light_n).var())
        frame["detailLog2"] = float(np.log2((vc + 1e-10) / (vr + 1e-10)))
    return {"frame": frame, "maps": maps, "rough": fit["rough"]}


# ------------------------------------------------------------------------------------------------------------ regions

def _pack(rgb_u8):
    import numpy as np

    a = rgb_u8.astype(np.uint32)
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]


def _safe_name(name: str) -> str:
    # a region's name is one part of a flat key (`region.<name>.<metric>`): it may hold neither '.' nor '/'
    return name.replace(".", "_").replace("/", "_")


def regions_from_id(id_u8, names: dict[str, list[int]], min_area: float) -> list[dict[str, Any]]:
    """One region per flat colour of an id pass that covers at least `min_area` of the frame.

    Anti-aliased borders make many tiny colours; the area floor drops them, so they need no special case.
    """
    import numpy as np

    packed = _pack(id_u8)
    colours, counts = np.unique(packed, return_counts=True)
    by_colour = {(int(c[0]) << 16) | (int(c[1]) << 8) | int(c[2]): n for n, c in names.items()}
    out = []
    for colour, count in zip(colours.tolist(), counts.tolist()):
        if count / packed.size >= min_area:
            out.append({"name": _safe_name(by_colour.get(colour, f"id_{colour:06X}")), "mask": packed == colour, "colour": colour})
    return out


def regions_from_mask(mask_u8) -> list[dict[str, Any]]:
    subject = mask_u8 > 127
    return [{"name": "subject", "mask": subject}, {"name": "background", "mask": ~subject}]


def regions_from_boxes(boxes: dict[str, list[float]], size: tuple[int, int]) -> list[dict[str, Any]]:
    import numpy as np

    w, h = size
    out = []
    for name, (x0, y0, x1, y1) in boxes.items():
        mask = np.zeros((h, w), bool)
        mask[max(0, round(y0 * h)):min(h, round(y1 * h)), max(0, round(x0 * w)):min(w, round(x1 * w))] = True
        out.append({"name": _safe_name(name), "mask": mask})
    return out


def load_u8(path: Path, size: tuple[int, int] | None = None, mode: str = "RGB", nearest: bool = False):
    """A pass as uint8, brought to `size` (w, h) if it has another: Lanczos for pictures, nearest for id/mask."""
    import numpy as np
    from PIL import Image

    with Image.open(path) as im:
        im = im.convert(mode)
        native = im.size
        if size and im.size != size:
            im = im.resize(size, Image.Resampling.NEAREST if nearest else Image.Resampling.LANCZOS)
        return np.asarray(im), native


def cut_regions(shot_dir: Path, shot_doc: dict, source: str, size: tuple[int, int], min_area: float) -> tuple[str | None, list[dict[str, Any]]]:
    """The regions of a shot, cut once from one source so that every run and every candidate measures the same pixels."""
    id_file, mask_file = pl.pass_file(shot_dir, source, "id"), pl.pass_file(shot_dir, source, "mask")
    if id_file.is_file():
        names = pl.read_json(shot_dir / "ids.json", {}) or {}
        return "id", regions_from_id(load_u8(id_file, size, nearest=True)[0], names, min_area)
    if mask_file.is_file():
        kind, regions = "mask", regions_from_mask(load_u8(mask_file, size, "L", nearest=True)[0])
    elif shot_doc.get("regions"):
        kind, regions = "boxes", regions_from_boxes(shot_doc["regions"], size)
    else:
        return None, []
    return kind, [r for r in regions if r["mask"].mean() >= min_area]


def region_metrics(mask, maps: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {"area": float(mask.mean())}
    if "ssim" in maps:
        out["ssim"] = float(maps["ssim"][mask].mean())
    if "deltaENorm" in maps:
        out["deltaENorm"] = float(maps["deltaENorm"][mask].mean())
    if "refEdge" in maps:
        count = lambda a: int((a & mask).sum())  # noqa: E731
        out["edgeF1"] = edge_scores(count(maps["refHit"]), count(maps["refEdge"]), count(maps["candHit"]), count(maps["candEdge"]))[0]
    return out


def _iou(a, b) -> float:
    union = int((a | b).sum())
    return int((a & b).sum()) / union if union else 1.0


# ------------------------------------------------------------------------------------------------------- one shot

def _rounded(v: Any) -> Any:
    if isinstance(v, float):
        return round(v, ROUND)
    if isinstance(v, list):
        return [_rounded(x) for x in v]
    if isinstance(v, dict):
        return {k: _rounded(x) for k, x in v.items()}
    return v


def _script_hash() -> str:
    return hashlib.sha1(Path(__file__).read_bytes()).hexdigest()[:12]


def _cache_key(files: list[Path], options: dict[str, Any]) -> str:
    """Inputs by size and mtime, the options, and this script: any of them changing makes the old numbers stale."""
    stamp = []
    for f in files:
        try:
            st = f.stat()
            stamp.append([f.name, st.st_size, st.st_mtime_ns])
        except FileNotFoundError:
            stamp.append([f.name, None, None])
    return hashlib.sha1(json.dumps([stamp, options, _script_hash()], sort_keys=True).encode()).hexdigest()


def metrics_file(run_dir: Path, shot: str, source: str) -> Path:
    return run_dir / shot / f"metrics.{source}.json"


def compare_one(task: dict[str, Any]) -> dict[str, Any]:
    """One shot, one candidate. Returns the metrics document; a failure is a document with `error`, never a raise."""
    shot, source, reference = task["shot"], task["source"], task["reference"]
    shot_dir, out = Path(task["shotDir"]), Path(task["out"])
    regions_src = task["regionsFrom"]
    head = {"shot": shot, "source": source, "against": reference}
    passes = [pl.pass_file(shot_dir, s, p) for s in dict.fromkeys([reference, source, regions_src]) for p in ("beauty", "id", "mask")]
    key = _cache_key([*passes, shot_dir / "shot.json", shot_dir / "ids.json"],
                     {k: task[k] for k in ("reference", "regionsFrom", "edgeTolerance", "minRegionArea", "want")})
    if not task["force"]:
        old = pl.read_json(out)
        if old and old.get("cacheKey") == key:
            return {**old, "cached": True}
    try:
        ref_file, cand_file = pl.pass_file(shot_dir, reference), pl.pass_file(shot_dir, source)
        absent = [f.name for f in (ref_file, cand_file) if not f.is_file()]
        if absent:
            raise pl.PlError(f"missing pass: {', '.join(absent)}")
        notes: list[str] = []
        ref, (w, h) = load_u8(ref_file)
        cand, (cw, ch) = load_u8(cand_file, (w, h))
        if (cw, ch) != (w, h):
            if abs((cw / ch) / (w / h) - 1) > 0.01:
                raise pl.PlError(f"{source} is {cw}x{ch}, {reference} is {w}x{h}: the aspect differs by more than 1 %")
            notes.append(f"{source} resized from {cw}x{ch} to the reference's {w}x{h}")
        an = analyse(ref, cand, task["edgeTolerance"], task["want"])
        if an["rough"]:
            notes.append("few mid-tone pixels: the exposure and white-balance fit used the whole frame and is rough")

        shot_doc = pl.read_json(shot_dir / "shot.json", {}) or {}
        kind, regions = cut_regions(shot_dir, shot_doc, regions_src, (w, h), task["minRegionArea"])
        out_regions: dict[str, Any] = {}
        # iou needs the candidate's own cut of the same thing; when the candidate IS the regions' source it would be 1
        own = None
        if source != regions_src and kind in ("id", "mask") and pl.pass_file(shot_dir, source, kind).is_file():
            own = load_u8(pl.pass_file(shot_dir, source, kind), (w, h), "RGB" if kind == "id" else "L", nearest=True)[0]
            own = _pack(own) if kind == "id" else own > 127
        for r in regions:
            m = region_metrics(r["mask"], an["maps"])
            if own is not None:
                theirs = own == r["colour"] if kind == "id" else (own if r["name"] == "subject" else ~own)
                m["iou"] = _iou(r["mask"], theirs)
            out_regions[r["name"]] = m
        doc = {**head, "size": [w, h], "regionsFrom": regions_src if kind else None, "regionsKind": kind,
               "frame": an["frame"], "regions": out_regions, "notes": notes}
    except Exception as e:  # noqa: BLE001  one bad shot must not take the run down; the entry says what happened
        doc = {**head, "error": str(e) if isinstance(e, (pl.PlError, OSError)) else f"{type(e).__name__}: {e}", "notes": []}
    doc = _rounded(doc)
    doc["cacheKey"] = key
    pl.write_json(out, doc)
    return doc


def run_compare(root: Path, config: dict[str, Any], shots: list[str], sources: list[str], run_dir: Path,
                jobs: int | None = None, force: bool = False, edge_tolerance: int = 2) -> list[dict[str, Any]]:
    """Compare every (shot, source) against the reference; documents come back in the order asked."""
    baseline = pl.read_json(pl.pl_dir(root) / "baseline.json", {}) or {}
    common = {
        "reference": config["reference"], "regionsFrom": config.get("regionsFrom") or config["reference"],
        "edgeTolerance": edge_tolerance, "minRegionArea": float(baseline.get("minRegionArea", DEFAULT_MIN_REGION_AREA)),
        "want": {k: bool(config["metrics"].get(k, True)) for k in ("ssim", "deltaE", "edges", "detail")}, "force": force,
    }
    tasks = [{**common, "shot": s, "source": src, "shotDir": str(pl.shot_path(s, root, config)),
              "out": str(metrics_file(run_dir, s, src))} for s in shots for src in sources]
    jobs = max(1, min(jobs or min(os.cpu_count() or 1, 8), len(tasks)))
    if jobs == 1:  # a worker process costs about half a second of imports: not worth it for one comparison
        return [compare_one(t) for t in tasks]
    with ProcessPoolExecutor(max_workers=jobs) as pool:
        return list(pool.map(compare_one, tasks))


def table(docs: list[dict[str, Any]]) -> str:
    def cell(doc, k, fmt):
        v = doc.get("frame", {}).get(k)
        return format(v, fmt) if v is not None else "-"

    rows = [("shot", "source", "ssim", "ΔE norm", "EV", "edge F1", "")]
    for d in docs:
        tail = f"ERROR: {d['error']}" if "error" in d else "(cached)" if d.get("cached") else ""
        rows.append((d["shot"], d["source"], cell(d, "ssim", ".4f"), cell(d, "deltaENorm", ".2f"),
                     cell(d, "exposureEV", "+.2f"), cell(d, "edgeF1", ".3f"), tail))
    widths = [max(len(r[i]) for r in rows) for i in range(7)]
    return "\n".join("  ".join(c.ljust(widths[i]) if i < 2 else c.rjust(widths[i]) if i < 6 else c for i, c in enumerate(r)).rstrip() for r in rows)


# ----------------------------------------------------------------------------------------------------------- self-test

def self_test() -> int:
    """Synthetic pictures with known answers. Prints one line per check; exit 1 if any fails."""
    import numpy as np
    from scipy.ndimage import gaussian_filter

    results: list[tuple[bool, str]] = []

    def check(ok: bool, what: str) -> None:
        results.append((bool(ok), what))

    def u8(lin):
        return (np.clip(pl.linear_to_srgb(lin), 0, 1) * 255 + 0.5).astype(np.uint8)

    h, w = 240, 320
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # a scene in linear light, kept under 0.6 so that +0.5 EV clips nothing
    scene = np.stack([0.08 + 0.4 * xx / w, 0.10 + 0.35 * yy / h, 0.25 + 0.2 * np.sin(xx / 17) * np.cos(yy / 23)], -1).astype(np.float32)
    scene[60:140, 80:200] = [0.5, 0.12, 0.08]
    scene[150:210, 30:110] = [0.05, 0.3, 0.45]
    scene[(xx - 250) ** 2 + (yy - 170) ** 2 < 40 ** 2] = [0.55, 0.5, 0.1]
    ref = u8(scene)

    # CIEDE2000 against published pairs (Sharma et al., table 1)
    pairs = [((50, 2.6772, -79.7751), (50, 0, -82.7485), 2.0425), ((50, 2.5, 0), (50, 0, -2.5), 4.3065),
             ((50, 2.5, 0), (73, 25, -18), 27.1492), ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
             ((2.0776, 0.0795, -1.1350), (0.9033, -0.0636, -0.5514), 0.9082)]
    got = ciede2000(np.array([p[0] for p in pairs], np.float32), np.array([p[1] for p in pairs], np.float32))
    worst = max(abs(float(g) - p[2]) for g, p in zip(got, pairs))
    check(worst < 2e-3, f"CIEDE2000 matches the published pairs (largest error {worst:.5f})")

    f = analyse(ref, ref)["frame"]
    check(f["ssim"] == 1.0 and f["deltaE"] == 0 and f["deltaENorm"] == 0 and f["edgeF1"] == 1.0 and f["exposureEV"] == 0
          and f["detailLog2"] == 0 and f["contrast"] == 1.0,
          f"identical pictures: ssim {f['ssim']}, ΔE {f['deltaE']}, edge F1 {f['edgeF1']}, EV {f['exposureEV']}")

    f = analyse(ref, u8(scene * 2 ** 0.5))["frame"]
    check(abs(f["exposureEV"] - 0.5) < 0.03, f"+0.5 EV is recovered: {f['exposureEV']:+.4f}")
    check(f["deltaENorm"] < 0.5 < f["deltaE"], f"+0.5 EV: ΔE {f['deltaE']:.2f} before normalisation, {f['deltaENorm']:.3f} after")
    check(f["edgeF1"] > 0.97 and abs(f["detailLog2"]) < 0.05, f"+0.5 EV leaves structure alone: edge F1 {f['edgeF1']:.3f}, detail {f['detailLog2']:+.3f}")

    f = analyse(ref, u8(scene * np.array([1.1, 1.0, 0.9], np.float32)))["frame"]
    check(all(abs(a - b) < 0.02 for a, b in zip(f["wb"], [1.1, 1.0, 0.9])) and f["deltaENorm"] < 0.5,
          f"a white-balance shift of [1.1, 1, 0.9] is recovered: {[round(x, 3) for x in f['wb']]}, ΔE norm {f['deltaENorm']:.3f}")

    def box(x0):
        a = np.full((h, w, 3), 0.05, np.float32)
        a[80:160, x0:x0 + 100] = 0.5
        return u8(a)

    near, far = analyse(box(100), box(101))["frame"], analyse(box(100), box(112))["frame"]
    check(near["edgeF1"] > 0.98, f"an edge moved by 1 px (inside the tolerance of 2) still matches: edge F1 {near['edgeF1']:.3f}")
    check(far["edgeF1"] < 0.75, f"an edge moved by 12 px lowers edge F1: {far['edgeF1']:.3f}")

    blurred = (gaussian_filter(ref.astype(np.float32), (2, 2, 0)) + 0.5).astype(np.uint8)
    f = analyse(ref, blurred)["frame"]
    check(f["detailLog2"] < -1 and f["ssim"] < 1, f"a blurred copy has less detail: detailLog2 {f['detailLog2']:+.2f}, ssim {f['ssim']:.3f}")

    f = analyse(ref, u8(0.18 + (scene - 0.18) * 0.7))["frame"]
    check(f["contrast"] < 0.95, f"a flatter copy has a contrast ratio under 1: {f['contrast']:.3f}")

    ids = np.zeros((h, w, 3), np.uint8)
    ids[:, : w * 3 // 10] = [255, 0, 0]
    ids[:, w * 3 // 10:] = [0, 0, 255]
    ids[0, 0] = [9, 9, 9]  # a stray pixel, under the area floor
    regions = {r["name"]: float(r["mask"].mean()) for r in regions_from_id(ids, {"left": [255, 0, 0]}, 0.002)}
    check(set(regions) == {"left", "id_0000FF"} and abs(regions["left"] - 0.3) < 1e-3 and abs(regions["id_0000FF"] - 0.7) < 1e-3,
          f"a two-colour id pass gives two regions with the right areas: {({k: round(v, 3) for k, v in regions.items()})}")

    an = analyse(box(100), box(112))
    left = np.zeros((h, w), bool)
    left[:, :50] = True
    m = region_metrics(left, an["maps"])
    check(m["edgeF1"] == 1.0 and m["ssim"] > 0.999, f"a region the change does not touch is untouched: edge F1 {m['edgeF1']}, ssim {m['ssim']:.4f}")

    for ok, what in results:
        print(("ok    " if ok else "FAIL  ") + what)
    failed = sum(not ok for ok, _ in results)
    print(f"{len(results) - failed} of {len(results)} checks hold")
    return 1 if failed else 0


# ----------------------------------------------------------------------------------------------------------------- cli

def resolve_run_dir(root: Path, run: str | None, out: str | None) -> Path:
    if out:
        return Path(out).resolve()
    return pl.runs_dir(root) / (run or time.strftime("%Y%m%d-%H%M%S"))


def main(argv: list[str] | None = None) -> int:
    gr.utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    gr.add_selection(ap)
    ap.add_argument("--source", action="append", metavar="ID", help="candidate source to compare (repeatable; default: every candidate of the config)")
    ap.add_argument("--run", metavar="NAME", help="run name: output goes to .perceptual-loop/runs/NAME/<shot>/ (default: a timestamp)")
    ap.add_argument("--out", metavar="DIR", help="write the run here instead (DIR/<shot>/metrics.<source>.json)")
    ap.add_argument("--edge-tolerance", type=int, default=2, metavar="PX", help="how far apart two edges may be and still match (default 2)")
    ap.add_argument("--jobs", type=int, metavar="N", help="parallel comparisons (default: the CPU count, at most 8)")
    ap.add_argument("--force", action="store_true", help="compare even when inputs, options and this script are unchanged")
    ap.add_argument("--json", action="store_true", help="print the list of metrics documents as JSON and nothing else")
    ap.add_argument("--self-test", action="store_true", help="check the metrics on synthetic pictures with known answers, then exit")
    args = ap.parse_args(argv)
    if args.self_test:
        return self_test()
    try:
        root = pl.find_root()
        config = pl.load_config(root, required=True)
        shots = gr.selected(args, root, config)
        sources = args.source or list(config["candidates"])
        if config["reference"] in sources:
            raise pl.PlError(f"'{config['reference']}' is the reference: compare candidates against it, not itself")
        run_dir = resolve_run_dir(root, args.run, args.out)
        started = time.perf_counter()
        docs = run_compare(root, config, shots, sources, run_dir, args.jobs, args.force, args.edge_tolerance)
    except pl.PlError as e:
        pl.fail(str(e))
    for d in docs:
        d.pop("cacheKey", None)
    text = f"{table(docs)}\n{len(docs)} comparisons in {time.perf_counter() - started:.1f} s -> {run_dir}"
    pl.emit(docs, args.json, text)
    return 1 if any("error" in d for d in docs) else 0


if __name__ == "__main__":
    raise SystemExit(main())
