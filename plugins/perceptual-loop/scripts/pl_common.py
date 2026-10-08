"""Shared helpers of the perceptual-loop scripts (see core/references/contract.md).

Standard library only at import time: numpy and Pillow are imported inside the functions that need them, so a script
that only reads the config (the hook, the lock) starts fast and needs no dependencies.
"""
from __future__ import annotations

import fnmatch
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

sys.dont_write_bytecode = True

DIR_NAME = ".perceptual-loop"
DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    "reference": "reference",
    "candidates": ["candidate"],
    "shotsDir": f"{DIR_NAME}/shots",
    "render": {},
    "passes": ["beauty"],
    "regionsFrom": None,
    "budget": {"free": 3, "match": []},
    "locks": {"dir": None, "staleMinutes": 45, "apps": {}},
    "metrics": {"ssim": True, "deltaE": True, "edges": True, "detail": True},
}


class PlError(Exception):
    """A usage or environment error: the caller prints it and exits 2."""


def fail(message: str, code: int = 2) -> "NoReturn":  # type: ignore[name-defined]
    print(message, file=sys.stderr)
    raise SystemExit(code)


def emit(doc: Any, as_json: bool, text: str | None = None) -> None:
    """Print one JSON document (--json) or the human text."""
    if as_json:
        json.dump(doc, sys.stdout, indent=2, sort_keys=False)
        sys.stdout.write("\n")
    elif text is not None:
        print(text)


# ------------------------------------------------------------------------------------------------ project and config

def find_root(start: str | os.PathLike[str] | None = None) -> Path:
    """The project root: the first ancestor holding .perceptual-loop/config.json, else the first with .git, else cwd."""
    here = Path(start or os.getcwd()).resolve()
    git_root: Path | None = None
    for p in [here, *here.parents]:
        if (p / DIR_NAME / "config.json").is_file():
            return p
        if git_root is None and (p / ".git").exists():
            git_root = p
    return git_root or here


def pl_dir(root: Path | None = None) -> Path:
    env = os.environ.get("PERCEPTUAL_LOOP_DIR")
    return Path(env).resolve() if env else (root or find_root()) / DIR_NAME


def _merge(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def load_config(root: Path | None = None, required: bool = False) -> dict[str, Any]:
    root = root or find_root()
    path = pl_dir(root) / "config.json"
    if not path.is_file():
        if required:
            raise PlError(f"no {DIR_NAME}/config.json under {root}: run init.py (the build-harness skill) first")
        return dict(DEFAULT_CONFIG)
    try:
        return _merge(DEFAULT_CONFIG, json.loads(path.read_text(encoding="utf-8")))
    except json.JSONDecodeError as e:
        raise PlError(f"{path} is not valid JSON: {e}") from e


def shots_dir(root: Path | None = None, config: dict[str, Any] | None = None) -> Path:
    root = root or find_root()
    env = os.environ.get("PL_SHOTS_DIR")
    if env:
        return Path(env).resolve()
    rel = (config or load_config(root))["shotsDir"]
    p = Path(rel)
    return p if p.is_absolute() else root / p


def runs_dir(root: Path | None = None) -> Path:
    return pl_dir(root) / "runs"


def user_data_dir() -> Path:
    """Per-user folder shared by every checkout and worktree (locks, board)."""
    # Not CLAUDE_PLUGIN_DATA: a hook process has it and an agent's shell does not, and both must find the same folder.
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME") or str(Path.home() / ".local" / "state")
    return Path(base) / "perceptual-loop"


# ----------------------------------------------------------------------------------------------------- shots, groups

def all_shots(root: Path | None = None, config: dict[str, Any] | None = None) -> list[str]:
    d = shots_dir(root, config)
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.is_dir() and (p / "shot.json").is_file())


def load_groups(root: Path | None = None) -> dict[str, list[str]]:
    path = pl_dir(root) / "groups.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def match_globs(names: Iterable[str], globs: Iterable[str]) -> list[str]:
    """Names matching any plain glob and no '!'-prefixed glob, order kept."""
    globs = list(globs)
    yes = [g for g in globs if not g.startswith("!")]
    no = [g[1:] for g in globs if g.startswith("!")]
    return [n for n in names if any(fnmatch.fnmatchcase(n, g) for g in yes) and not any(fnmatch.fnmatchcase(n, g) for g in no)]


def resolve_shots(names: list[str] | None = None, group: str | None = None, match: str | None = None, all_: bool = False,
                  root: Path | None = None, config: dict[str, Any] | None = None) -> list[str]:
    """The shots a command means: explicit names (commas allowed), a group, --all, narrowed by --match (a glob)."""
    root = root or find_root()
    have = all_shots(root, config)
    picked: list[str]
    if group:
        groups = load_groups(root)
        if group not in groups:
            raise PlError(f"no group '{group}' in groups.json (have: {', '.join(sorted(groups)) or 'none'})")
        picked = match_globs(have, groups[group])
    elif all_:
        picked = list(have)
    else:
        flat = [n for raw in (names or []) for n in raw.split(",") if n]
        missing = [n for n in flat if n not in have and not any(c in n for c in "*?[")]
        if missing:
            raise PlError(f"no such shot: {', '.join(missing)}")
        picked = [n for raw in flat for n in (match_globs(have, [raw]) if any(c in raw for c in "*?[") else [raw])]
    if match:
        picked = match_globs(picked, [match])
    seen: set[str] = set()
    return [n for n in picked if not (n in seen or seen.add(n))]


def shot_path(shot: str, root: Path | None = None, config: dict[str, Any] | None = None) -> Path:
    return shots_dir(root, config) / shot


PASS_SUFFIX = {"beauty": "", "mask": ".mask", "id": ".id", "depth": ".depth", "albedo": ".albedo"}


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


# ------------------------------------------------------------------------------------------------------- flat keys

def flatten_metrics(doc: dict[str, Any]) -> dict[str, float]:
    """metrics.json -> { '<shot>/<source>/frame.ssim': v, '<shot>/<source>/region.<name>.<metric>': v }."""
    out: dict[str, float] = {}
    head = f"{doc['shot']}/{doc['source']}"
    for k, v in (doc.get("frame") or {}).items():
        if isinstance(v, (int, float)):
            out[f"{head}/frame.{k}"] = float(v)
        elif k == "wb" and isinstance(v, list) and len(v) == 3:
            # white balance is three gains: gate each, or a colour cast would never trip the gate
            for ch, g in zip("rgb", v):
                out[f"{head}/frame.wb.{ch}"] = float(g)
    for name, reg in (doc.get("regions") or {}).items():
        for k, v in reg.items():
            if isinstance(v, (int, float)) and k != "area":
                out[f"{head}/region.{name}.{k}"] = float(v)
    return out


def split_key(key: str) -> tuple[str, str, str]:
    shot, source, metric = key.split("/", 2)
    return shot, source, metric


def tolerance_for(key: str, baseline: dict[str, Any], default: float = 0.0) -> float:
    """1.5 x the entry's measured spread if it has one, else the most specific matching tolerance pattern."""
    spread = (baseline.get("spread") or {}).get(key)
    if spread is not None:
        return 1.5 * float(spread)
    _, source, metric = split_key(key)
    best: tuple[int, float] | None = None
    for pattern, tol in (baseline.get("tolerances") or {}).items():
        ps, _, pm = pattern.partition("/")
        if not fnmatch.fnmatchcase(source, ps):
            continue
        rx = "^" + re.escape(pm).replace(r"\*", r"[^.]+") + "$"
        if re.match(rx, metric):
            score = len(pattern.replace("*", ""))
            if best is None or score > best[0]:
                best = (score, float(tol))
    return best[1] if best else default


# ----------------------------------------------------------------------------------------------------------- images

def load_srgb(path: Path):
    """An image as float32 RGB in 0..1, display-encoded (sRGB). Alpha is dropped."""
    import numpy as np
    from PIL import Image

    with Image.open(path) as im:
        return np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0


def srgb_to_linear(a):
    import numpy as np

    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4).astype(np.float32)


def linear_to_srgb(a):
    import numpy as np

    a = np.clip(a, 0.0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055).astype(np.float32)


def save_srgb(path: Path, a) -> None:
    import numpy as np
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype("uint8")).save(path)


def luminance(linear):
    return 0.2126 * linear[..., 0] + 0.7152 * linear[..., 1] + 0.0722 * linear[..., 2]
