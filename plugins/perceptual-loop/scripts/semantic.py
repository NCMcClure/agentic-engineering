# /// script
# requires-python = ">=3.10"
# dependencies = ["torch>=2.2", "torchvision>=0.17", "open_clip_torch>=2.24", "lpips>=0.1.4", "numpy>=1.24", "Pillow>=10.1"]
# ///
"""semantic.py: how alike are two pictures, or a picture and a description, when no pixel lines up?

For work with NO PIXEL-ALIGNED REFERENCE (generated images, a restyled scene, a redesign), where SSIM and ΔE say
nothing useful. Two learned signals:

  CLIP    cosine similarity of image embeddings (do the pictures show the same kind of thing), and of an image
          with a text prompt (does the picture show what the words say)
  LPIPS   learned perceptual distance between two pictures (0 = identical; layout and texture, more than content)

  similarity A B        CLIP cosine and LPIPS of two pictures
  text IMAGE --prompt   image-text scores, and a softmax over the prompts given: "is it more X than Y" as a number
  rank IMAGES…          order pictures by closeness to a prompt or to a reference picture
  batch                 over shots of the store: writes semantic.<source>.json beside the run's metrics
  drift IMAGES…         over iterations in order: is each closer to the reference / prompt than the one before

HEAVY, and the first run DOWNLOADS: the packages (torch, torchvision, open_clip, lpips: about 0.7 GB installed on
Windows and macOS, where PyPI's torch is the CPU build; about 5 GB on Linux, where it bundles CUDA) into uv's cache,
and the models into the libraries' own user caches, never into the project:
  CLIP   ViT-B-32 / laion2b_s34b_b79k   about 600 MB   Hugging Face cache (~/.cache/huggingface, or $HF_HOME)
  LPIPS  AlexNet backbone               about 233 MB   torch hub cache (~/.cache/torch, or $TORCH_HOME)
         (--lpips-net squeeze: 5 MB; vgg: 528 MB)
--cache-dir DIR puts both under DIR instead. --metrics clip or --metrics lpips loads only that one.
--device auto uses CUDA (or Apple MPS) when this torch build has it, else the CPU; a pair of pictures takes well
under a second on a CPU once the models are loaded. For CUDA on Windows the CUDA build of torch must be asked for
(a 2.6 GB download; the two --reinstall-package flags are needed once, when uv already cached the CPU build for
this script, and the cached environment then stays on CUDA):
  uv run --no-project --index https://download.pytorch.org/whl/cu128 --reinstall-package torch --reinstall-package torchvision semantic.py …
CPU and CUDA agree to about four decimals, not exactly: keep a baseline to one device.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import contextlib
import math
import os
import tempfile
import time
import warnings
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import video as V  # noqa: E402

CAVEAT = ("similarity signals, not verdicts: CLIP is weak at counting, reading text, fine geometry, left/right and small details; "
          "LPIPS needs roughly the same layout. Use them to gate a candidate against its own earlier run and to rank; look before judging.")


class Models:
    """Loaded on first use; everything a model library prints goes to stderr so --json stays one document."""

    def __init__(self, args):
        self.args = args
        if args.cache_dir:  # before the libraries are imported: they read these at import or first download
            root = Path(args.cache_dir).resolve()
            os.environ["TORCH_HOME"], os.environ["HF_HOME"] = str(root / "torch"), str(root / "huggingface")
        os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        warnings.filterwarnings("ignore")
        try:
            with contextlib.redirect_stdout(sys.stderr):
                import torch
        except ImportError as e:
            pl.fail(f"semantic.py needs torch, which could not be imported on Python {sys.version.split()[0]} ({e}).\nRun it as `uv run --no-project semantic.py …`: uv installs it.")
        self.torch = torch
        want = args.device
        have = "cuda" if torch.cuda.is_available() else ("mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
        if want == "cuda" and have != "cuda":
            pl.fail(f"--device cuda: this torch build ({torch.__version__}) has no CUDA. PyPI's torch for Windows and macOS is CPU-only; ask for the CUDA build:\n"
                    "  uv run --no-project --index https://download.pytorch.org/whl/cu128 --reinstall-package torch --reinstall-package torchvision semantic.py …\n"
                    "(2.6 GB, once) or use --device auto / cpu.")
        self.device = have if want == "auto" else want
        self._clip = self._lpips = None

    def clip(self):
        if self._clip is None:
            t0 = time.time()
            with contextlib.redirect_stdout(sys.stderr):
                import open_clip

                kw = {"cache_dir": str(Path(self.args.cache_dir).resolve() / "open_clip")} if self.args.cache_dir else {}
                try:
                    model, _, pre = open_clip.create_model_and_transforms(self.args.model, pretrained=self.args.pretrained, device=self.device, **kw)
                except Exception as e:  # noqa: BLE001  (no network, unknown model name, …)
                    pl.fail(f"could not load CLIP {self.args.model}/{self.args.pretrained}: {e}\nThe first run downloads about 600 MB from huggingface.co; "
                            "see `python -c \"import open_clip; print(open_clip.list_pretrained())\"` for valid names.")
            self._clip = (model.eval(), pre, open_clip.get_tokenizer(self.args.model))
            print(f"semantic.py: CLIP {self.args.model}/{self.args.pretrained} on {self.device}, loaded in {time.time() - t0:.1f} s", file=sys.stderr)
        return self._clip

    def lpips(self):
        if self._lpips is None:
            t0 = time.time()
            with contextlib.redirect_stdout(sys.stderr):
                import lpips

                try:
                    self._lpips = lpips.LPIPS(net=self.args.lpips_net, verbose=False).to(self.device).eval()
                except Exception as e:  # noqa: BLE001
                    pl.fail(f"could not load LPIPS ({self.args.lpips_net}): {e}\nThe first run downloads the backbone's weights from download.pytorch.org.")
            print(f"semantic.py: LPIPS {self.args.lpips_net} on {self.device}, loaded in {time.time() - t0:.1f} s", file=sys.stderr)
        return self._lpips

    def embed_images(self, paths: list[Path]):
        from PIL import Image

        model, pre, _ = self.clip()
        out = []
        with self.torch.no_grad():
            for i in range(0, len(paths), 16):
                batch = []
                for p in paths[i:i + 16]:
                    with Image.open(p) as im:
                        batch.append(pre(im.convert("RGB")))
                e = model.encode_image(self.torch.stack(batch).to(self.device)).float()
                out.append(e / e.norm(dim=-1, keepdim=True))
        return self.torch.cat(out)

    def embed_texts(self, texts: list[str]):
        model, _, tok = self.clip()
        with self.torch.no_grad():
            e = model.encode_text(tok(texts).to(self.device)).float()
        return e / e.norm(dim=-1, keepdim=True)

    def logit_scale(self) -> float:
        return float(self.clip()[0].logit_scale.exp())

    def lpips_distance(self, a: Path, b: Path) -> float:
        """LPIPS of A against B, both at B's shape reduced to --lpips-size on the long side: the distance is
        computed feature by feature at the same place, so the two must be the same size, and a full-resolution
        render costs seconds on a CPU for no change in the answer that matters."""
        import numpy as np
        from PIL import Image

        with Image.open(b) as ib, Image.open(a) as ia:
            s = min(1.0, self.args.lpips_size / max(ib.size))
            size = (max(32, round(ib.width * s)), max(32, round(ib.height * s)))
            ts = [self.torch.from_numpy(np.asarray(im.convert("RGB").resize(size, Image.BICUBIC), dtype=np.float32) / 127.5 - 1).permute(2, 0, 1)[None].to(self.device)
                  for im in (ia, ib)]
        with self.torch.no_grad():
            return float(self.lpips()(ts[0], ts[1]).item())


_LOADED: dict[tuple, Models] = {}


def models(args) -> Models:
    """One set of models per process and setting: a second command in the same run (the self-test) reuses them."""
    key = (args.device, args.cache_dir, args.model, args.pretrained, args.lpips_net)
    if key not in _LOADED:
        _LOADED[key] = Models(args)
    _LOADED[key].args = args
    return _LOADED[key]


def want(args, name: str) -> bool:
    return name in args.metrics.split(",")


def image(path: str | Path) -> Path:
    p = Path(path)
    if not p.is_file():
        pl.fail(f"no such picture: {p}")
    return p


def r(v: float | None, n: int = 4) -> float | None:
    return None if v is None or math.isnan(v) else round(float(v), n)


def pair_scores(m: Models, a: Path, b: Path, args) -> dict[str, float]:
    out: dict[str, float] = {}
    if want(args, "clip"):
        e = m.embed_images([a, b])
        out["clip"] = r(float(e[0] @ e[1]))
    if want(args, "lpips"):
        out["lpips"] = r(m.lpips_distance(a, b))
    return out


# --------------------------------------------------------------------------------------------------------- commands

def cmd_similarity(args):
    m = models(args)
    a, b = image(args.a), image(args.b)
    s = pair_scores(m, a, b, args)
    failed = []
    if args.min_clip is not None and s.get("clip", 1) < args.min_clip:
        failed.append(f"CLIP cosine {s['clip']} < --min-clip {args.min_clip:g}")
    if args.max_lpips is not None and s.get("lpips", 0) > args.max_lpips:
        failed.append(f"LPIPS {s['lpips']} > --max-lpips {args.max_lpips:g}")
    doc = {"a": str(a), "b": str(b), **s, "model": model_names(args), "notes": [CAVEAT], "gate": {"passed": not failed, "failed": failed}}
    text = "\n".join([f"A = {a}\nB = {b}", "  " + "   ".join(([f"CLIP cosine {s['clip']:.4f} (1 = same content to the model)"] if "clip" in s else [])
                                                               + ([f"LPIPS {s['lpips']:.4f} (0 = identical; above about 0.5 = little in common)"] if "lpips" in s else [])),
                      f"  note: {CAVEAT}", *(f"  GATE FAILED: {f}" for f in failed)])
    return doc, text, 1 if failed else 0


def model_names(args) -> dict[str, str]:
    return {"clip": f"{args.model}/{args.pretrained}", "lpips": args.lpips_net}


def text_scores(m: Models, paths: list[Path], prompts: list[str]):
    """-> (cosine [image, prompt], softmax over the prompts per image at CLIP's own temperature)"""
    cos = m.embed_images(paths) @ m.embed_texts(prompts).T
    return cos.cpu().numpy(), (cos * m.logit_scale()).softmax(dim=-1).cpu().numpy()


def cmd_text(args):
    m = models(args)
    img = image(args.image)
    prompts = list(args.prompt) + list(args.against_prompt or [])
    cos, prob = text_scores(m, [img], prompts)
    rows = [{"prompt": p, "role": "prompt" if i < len(args.prompt) else "against", "cosine": r(float(cos[0, i])), "probability": r(float(prob[0, i]))} for i, p in enumerate(prompts)]
    share = float(sum(x["probability"] for x in rows if x["role"] == "prompt"))
    failed = []
    if args.min_probability is not None and share < args.min_probability:
        failed.append(f"the prompts take {share:.3f} of the softmax < --min-probability {args.min_probability:g}")
    if args.min_cosine is not None and rows[0]["cosine"] < args.min_cosine:
        failed.append(f"cosine with the first prompt {rows[0]['cosine']} < --min-cosine {args.min_cosine:g}")
    notes = [CAVEAT, "cosines of an image with a text are small numbers (0.15 to 0.35 is the usual range): compare them with each other, never with image-image cosines"]
    if len(prompts) == 1:
        notes.append("one prompt only: its probability is 1 by construction; add --against-prompt alternatives to make it mean something")
    doc = {"image": str(img), "scores": rows, "promptProbability": r(share), "model": model_names(args)["clip"], "notes": notes, "gate": {"passed": not failed, "failed": failed}}
    w = max(len(p) for p in prompts)
    text = "\n".join([f"{img}", *(f"  {x['role']:<7}  {x['prompt']:<{w}}  cosine {x['cosine']:.4f}  probability {x['probability']:.3f}" for x in rows),
                      f"  the prompt(s) take {share:.3f} of the softmax over these {len(prompts)} texts", *(f"  note: {n}" for n in notes), *(f"  GATE FAILED: {f}" for f in failed)])
    return doc, text, 1 if failed else 0


def scores_against(m: Models, paths: list[Path], args) -> list[dict[str, Any]]:
    """Each picture against --ref (CLIP cosine, LPIPS) and/or --prompt (text cosine); `score` is the one that ranks:
    the prompt's cosine when a prompt is given, else the CLIP cosine with the reference, else minus LPIPS."""
    if not (args.prompt or args.ref):
        pl.fail("give --prompt TEXT and/or --ref IMAGE to measure against")
    rows: list[dict[str, Any]] = [{"image": str(p)} for p in paths]
    if args.prompt:
        cos, _ = text_scores(m, paths, [args.prompt])
        for row, c in zip(rows, cos[:, 0]):
            row["text"] = r(float(c))
    if args.ref:
        ref = image(args.ref)
        if want(args, "clip"):
            e = m.embed_images([ref, *paths])
            for row, c in zip(rows, (e[1:] @ e[0]).cpu().numpy()):
                row["clip"] = r(float(c))
        if want(args, "lpips"):
            for row, p in zip(rows, paths):
                row["lpips"] = r(m.lpips_distance(p, ref))
    for row in rows:
        row["score"] = row["text"] if "text" in row else (row["clip"] if "clip" in row else -row["lpips"])
    return rows


def expand(items: list[str]) -> list[Path]:
    out: list[Path] = []
    for it in items:
        p = Path(it)
        out += V.list_frames(p) if p.is_dir() else [image(p)]
    if not out:
        pl.fail("no pictures given")
    return out


def table(rows: list[dict[str, Any]], extra: str = "") -> list[str]:
    keys = [k for k in ("text", "clip", "lpips") if k in rows[0]]
    return [f"  {row.get(extra, ''):>4}  " + "  ".join(f"{k} {row[k]:.4f}" for k in keys) + f"   {row['image']}" for row in rows]


def cmd_rank(args):
    m = models(args)
    rows = sorted(scores_against(m, expand(args.images), args), key=lambda x: -x["score"])
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    doc = {"by": "text" if args.prompt else ("clip" if "clip" in rows[0] else "lpips"), "prompt": args.prompt, "ref": args.ref, "ranking": rows, "model": model_names(args), "notes": [CAVEAT]}
    text = "\n".join([f"ranked by {'the prompt' if args.prompt else 'closeness to the reference'}, best first" + (f": {args.prompt!r}" if args.prompt else ""),
                      *table(rows, "rank"), f"  note: {CAVEAT}", "  note: small gaps (under about 0.01 of cosine) are not a ranking: the model cannot tell those apart reliably"])
    return doc, text, 0


def cmd_drift(args):
    m = models(args)
    rows = scores_against(m, expand(args.images), args)
    regress = []
    for i, row in enumerate(rows):
        row["step"] = i
        row["delta"] = None if i == 0 else r(row["score"] - rows[i - 1]["score"])
        row["closer"] = None if i == 0 else row["delta"] > 0
        if i and row["delta"] < -args.slack:
            regress.append(i)
    best = max(range(len(rows)), key=lambda i: rows[i]["score"])
    total = rows[-1]["score"] - rows[0]["score"]
    failed = []
    if args.require_improving:
        if regress:
            failed.append(f"step(s) {regress} moved away by more than --slack {args.slack:g}")
        if total <= 0 and len(rows) > 1:
            failed.append(f"the last iteration is not closer than the first ({total:+.4f})")
    doc = {"by": "text" if args.prompt else ("clip" if "clip" in rows[0] else "-lpips"), "prompt": args.prompt, "ref": args.ref, "steps": rows, "best": best,
           "total": r(total), "regressions": regress, "model": model_names(args), "notes": [CAVEAT], "gate": {"passed": not failed, "failed": failed}}
    arrow = lambda row: "      " if row["delta"] is None else (f"{row['delta']:+.4f} " + ("closer" if row["closer"] else "AWAY  "))  # noqa: E731
    keys = [k for k in ("text", "clip", "lpips") if k in rows[0]]
    text = "\n".join([f"drift over {len(rows)} iterations towards " + (f"the prompt {args.prompt!r}" if args.prompt else f"the reference {args.ref}") + f" (score = {doc['by']})",
                      *(f"  {row['step']:>3}  " + "  ".join(f"{k} {row[k]:.4f}" for k in keys) + f"   {arrow(row)}  {row['image']}" for row in rows),
                      f"  first to last {total:+.4f}; best is iteration {best}" + (f"; moved away at {regress}" if regress else ""),
                      f"  note: {CAVEAT}", *(f"  GATE FAILED: {f}" for f in failed)])
    return doc, text, 1 if failed else 0


def cmd_batch(args):
    cfg = pl.load_config()
    source, against = args.source or cfg["candidates"][0], args.against or cfg["reference"]
    shots = pl.resolve_shots(args.shots, args.group, args.match, args.all)
    if not shots:
        pl.fail("no shots: name them, or give --group NAME or --all")
    run_dir = Path(args.out) if args.out else pl.runs_dir() / args.run
    m = models(args)
    docs, failed, lines = [], [], []
    for shot in shots:
        d = pl.shot_path(shot)
        cand, ref = pl.pass_file(d, source), pl.pass_file(d, against)
        doc: dict[str, Any] = {"shot": shot, "source": source, "against": against, "frame": {}, "model": model_names(args), "notes": [CAVEAT]}
        if not cand.is_file():
            doc["notes"].append(f"no picture of '{source}' ({cand.name}): nothing measured")
        else:
            if ref.is_file():
                doc["frame"].update(pair_scores(m, cand, ref, args))
            else:
                doc["notes"].append(f"no picture of '{against}' ({ref.name}): no image-image scores")
            prompt = args.prompt or ((pl.read_json(d / "shot.json", {}) or {}).get("meta") or {}).get("prompt")
            if prompt and want(args, "clip"):
                doc["prompt"] = prompt
                doc["frame"]["clipText"] = r(float(text_scores(m, [cand], [prompt])[0][0, 0]))
        f = doc["frame"]
        for name, key, bad in (("--min-clip", "clip", lambda v: v < args.min_clip), ("--max-lpips", "lpips", lambda v: v > args.max_lpips), ("--min-text", "clipText", lambda v: v < args.min_text)):
            limit = getattr(args, name[2:].replace("-", "_"))
            if limit is not None and (key not in f or bad(f[key])):
                failed.append(f"{shot}: {key} {f.get(key, 'not measured')} fails {name} {limit:g}")
        pl.write_json(run_dir / shot / f"semantic.{source}.json", doc)
        docs.append(doc)
        lines.append(f"  {shot:<{max(len(s) for s in shots)}}  " + ("  ".join(f"{k} {v:.4f}" for k, v in f.items()) or "nothing measured") + "".join(f"   ({n})" for n in doc["notes"][1:]))
    out = {"source": source, "against": against, "run": str(run_dir), "shots": docs, "gate": {"passed": not failed, "failed": failed}}
    text = "\n".join([f"semantic scores of '{source}' against '{against}', {len(shots)} shots -> {run_dir}/<shot>/semantic.{source}.json", *lines,
                      f"  note: {CAVEAT}", *(f"  GATE FAILED: {f}" for f in failed)])
    return out, text, 1 if failed else 0


# -------------------------------------------------------------------------------------------------------- self-test

def self_test(argv: list[str]) -> int:
    from PIL import Image, ImageDraw, ImageFilter

    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    opts = [a for a in argv if a != "--self-test"]  # --device, --cache-dir, --lpips-net … apply to the test too
    t0 = time.time()
    with tempfile.TemporaryDirectory(prefix="pl-semantic-test-") as t:
        tmp = Path(t)
        red = Image.new("RGB", (256, 256), (245, 245, 245))
        ImageDraw.Draw(red).rectangle([64, 64, 192, 192], fill=(215, 30, 30))
        blue = Image.new("RGB", (256, 256), (245, 245, 245))
        ImageDraw.Draw(blue).ellipse([64, 64, 192, 192], fill=(30, 60, 215))
        red.save(tmp / "red_square.png")
        blue.save(tmp / "blue_circle.png")
        # iterations towards the red square, each a step the model can see: wrong colour and shape, right colour, right shape.
        # (A cross-fade would not do: half of each is neither to CLIP, and scores lower than the start.)
        red_circle = Image.new("RGB", (256, 256), (245, 245, 245))
        ImageDraw.Draw(red_circle).ellipse([64, 64, 192, 192], fill=(215, 30, 30))
        near = Image.new("RGB", (256, 256), (245, 245, 245))
        ImageDraw.Draw(near).rectangle([70, 68, 198, 196], fill=(205, 40, 35))
        for i, im in enumerate((blue, red_circle, near.filter(ImageFilter.GaussianBlur(1)))):
            im.save(tmp / f"iter{i}.png")
        R, B = str(tmp / "red_square.png"), str(tmp / "blue_circle.png")
        _, d, _, code = run(["similarity", R, R, "--min-clip", "0.999", "--max-lpips", "0.001", *opts])
        check("identical pictures: CLIP cosine 1, LPIPS 0, gates pass", abs(d["clip"] - 1) < 1e-3 and abs(d["lpips"]) < 1e-4 and code == 0, f"clip {d['clip']}, lpips {d['lpips']}")
        _, d, _, code = run(["similarity", R, B, "--min-clip", "0.999", *opts])
        check("a red square against a blue circle: less alike on both, gate fails", d["clip"] < 0.98 and d["lpips"] > 0.05 and code == 1, f"clip {d['clip']}, lpips {d['lpips']}")
        _, d, _, code = run(["text", R, "--prompt", "a red square", "--against-prompt", "a blue circle", "--min-probability", "0.5", *opts])
        s = {x["prompt"]: x for x in d["scores"]}
        check("text: the red square is 'a red square' rather than 'a blue circle'", s["a red square"]["cosine"] > s["a blue circle"]["cosine"] and d["promptProbability"] > 0.9 and code == 0,
              f"cosine {s['a red square']['cosine']} vs {s['a blue circle']['cosine']}, probability {d['promptProbability']}")
        _, d, _, code = run(["text", B, "--prompt", "a red square", "--against-prompt", "a blue circle", "--min-probability", "0.5", *opts])
        check("text: and the blue circle is not; the gate fails", d["promptProbability"] < 0.1 and code == 1, f"probability {d['promptProbability']}")
        _, d, _, _ = run(["rank", B, R, "--prompt", "a red square", *opts])
        check("rank by prompt puts the red square first", Path(d["ranking"][0]["image"]).name == "red_square.png", f"{[(Path(x['image']).name, x['text']) for x in d['ranking']]}")
        its = [str(tmp / f"iter{i}.png") for i in range(3)]
        _, d, _, code = run(["drift", *its, "--ref", R, "--require-improving", *opts])
        check("drift towards a reference: every iteration closer, gate passes", all(x["closer"] for x in d["steps"][1:]) and code == 0 and d["steps"][2]["lpips"] < d["steps"][0]["lpips"],
              f"clip {[x['clip'] for x in d['steps']]}, lpips {[x['lpips'] for x in d['steps']]}")
        _, d, _, code = run(["drift", *reversed(its), "--prompt", "a red square", "--require-improving", *opts])
        check("drift the other way against the prompt: reported as moving away, gate fails", d["regressions"] and code == 1, f"text {[x['text'] for x in d['steps']]}")
        # batch over a two-shot store in the temp folder
        root = tmp / "proj"
        for shot, (c, ref) in {"same": (red, red), "other": (blue, red)}.items():
            d_ = root / ".perceptual-loop" / "shots" / shot
            d_.mkdir(parents=True)
            pl.write_json(d_ / "shot.json", {"name": shot, "meta": {"prompt": "a red square"}})
            c.save(d_ / "candidate.png")
            ref.save(d_ / "reference.png")
        pl.write_json(root / ".perceptual-loop" / "config.json", {"version": 1})
        here = os.getcwd()
        os.chdir(root)
        try:
            _, d, _, code = run(["batch", "--all", "--run", "t", "--max-lpips", "0.05", *opts])
        finally:
            os.chdir(here)
        by = {x["shot"]: x["frame"] for x in d["shots"]}
        wrote = (root / ".perceptual-loop" / "runs" / "t" / "other" / "semantic.candidate.json").is_file()
        check("batch: semantic.<source>.json per shot, the prompt read from shot.json, the differing shot fails --max-lpips",
              wrote and by["same"]["lpips"] < 1e-4 and by["other"]["lpips"] > 0.05 and by["same"]["clipText"] > by["other"]["clipText"] and code == 1 and len(d["gate"]["failed"]) == 1, f"{by}")
    print(f"semantic.py self-test: {'passed' if ok else 'FAILED'}   ({time.time() - t0:.1f} s including model loads)")
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------------------- main

EPILOG = """what the numbers mean
  CLIP cosine (image, image)   1 = the same picture to the model. Unrelated photographs still score 0.4 to 0.6,
                               two renders of one scene 0.85 to 0.98: the useful range is narrow and depends on
                               the content, so compare with the shot's own earlier value, not with a fixed bar.
  CLIP cosine (image, text)    usually 0.15 to 0.35. Only differences between prompts for the same picture, or
                               between pictures for the same prompt, mean anything.
  probability                  softmax over the texts given, at CLIP's own temperature: how much more the
                               picture is "X" than "Y" among exactly those alternatives. It always sums to 1,
                               so a wrong set of alternatives gives a confident, meaningless answer.
  LPIPS                        learned perceptual distance, 0 = identical. Both pictures are resized to the
                               reference's shape (long side --lpips-size) first. It compares features at the
                               same place: two good pictures with different layouts are far apart.
what they do not mean
  These are a model's notion of similarity with known blind spots: counting ("three cars" vs "four"), written
  text, fine geometry and proportions, left/right and spatial relations, small or thin details, and anything
  outside what the model saw in training (they also inherit its biases). A higher score is not "better": it is
  "closer to this reference or prompt, as this model sees it". Use them as a regression gate against a candidate's
  own earlier run and as a ranking aid over many candidates; the verdict is made by looking.

exit codes: 0 done (gates passed), 1 a gate failed, 2 usage or environment error (a package or a model missing)"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="semantic.py", description=__doc__, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    for p in (ap, common):  # accepted before or after the subcommand
        dflt = (lambda v: v) if p is ap else (lambda v: argparse.SUPPRESS)
        g = p.add_argument_group("models")
        g.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default=dflt("auto"), help="auto (default): CUDA or MPS when this torch build has it, else the CPU")
        g.add_argument("--cache-dir", metavar="DIR", default=dflt(None), help="keep downloaded models under DIR (default: the libraries' user caches: "
                       "~/.cache/huggingface and ~/.cache/torch, or $HF_HOME and $TORCH_HOME). Never the project")
        g.add_argument("--model", default=dflt("ViT-B-32"), help="open_clip model name (default ViT-B-32, about 600 MB)")
        g.add_argument("--pretrained", default=dflt("laion2b_s34b_b79k"), help="open_clip pretrained tag (default laion2b_s34b_b79k)")
        g.add_argument("--lpips-net", choices=["alex", "squeeze", "vgg"], default=dflt("alex"), help="LPIPS backbone: alex (default, the authors' recommendation; 233 MB download), "
                       "squeeze (5 MB), vgg (528 MB). Values of different backbones are not comparable")
        g.add_argument("--lpips-size", type=int, default=dflt(512), help="LPIPS is computed at this long side (default 512)")
        g.add_argument("--metrics", default=dflt("clip,lpips"), help="which image-image signals to compute: clip, lpips or clip,lpips (default both)")
        g.add_argument("--json", action="store_true", default=dflt(False), help="print one JSON document on stdout and nothing else (model progress goes to stderr)")
    ap.add_argument("--self-test", action="store_true", help="run the built-in checks on synthetic pictures (loads, and on the first run downloads, both models)")
    sub = ap.add_subparsers(dest="cmd", metavar="{similarity,text,rank,batch,drift}")
    fmt = {"epilog": EPILOG, "formatter_class": argparse.RawDescriptionHelpFormatter, "parents": [common]}

    p = sub.add_parser("similarity", help="CLIP cosine and LPIPS of two pictures", **fmt)
    p.add_argument("a", help="the candidate picture")
    p.add_argument("b", help="the reference picture (LPIPS is computed at its shape)")
    p.add_argument("--min-clip", type=float, help="gate: smallest allowed CLIP cosine")
    p.add_argument("--max-lpips", type=float, help="gate: largest allowed LPIPS")
    p.set_defaults(fn=cmd_similarity)

    p = sub.add_parser("text", help="how well a picture matches prompts, and which of several it matches more", **fmt)
    p.add_argument("image")
    p.add_argument("--prompt", action="append", required=True, help="what the picture should show; repeatable")
    p.add_argument("--against-prompt", action="append", help="an alternative it should NOT be; repeatable. The softmax runs over all prompts and alternatives")
    p.add_argument("--min-probability", type=float, help="gate: smallest allowed share of the softmax taken by the --prompt texts")
    p.add_argument("--min-cosine", type=float, help="gate: smallest allowed cosine with the first --prompt")
    p.set_defaults(fn=cmd_text)

    def target(p):
        p.add_argument("images", nargs="+", help="pictures, or folders of pictures (read in name order)")
        p.add_argument("--prompt", help="measure against this text")
        p.add_argument("--ref", metavar="IMAGE", help="measure against this picture")

    p = sub.add_parser("rank", help="order pictures by closeness to a prompt or a reference picture", **fmt)
    target(p)
    p.set_defaults(fn=cmd_rank)

    p = sub.add_parser("drift", help="over iterations in the order given: is each closer than the one before", **fmt)
    target(p)
    p.add_argument("--slack", type=float, default=0.005, help="a step may move away by this much of the score without counting as a regression (default 0.005)")
    p.add_argument("--require-improving", action="store_true", help="gate: exit 1 when a step moves away by more than --slack, or the last is not closer than the first")
    p.set_defaults(fn=cmd_drift)

    p = sub.add_parser("batch", help="over shots: semantic.<source>.json beside the run's metrics", **fmt,
                       description="For each shot: CLIP cosine and LPIPS of <source>.png against <against>.png, and the cosine with a prompt (--prompt, else the shot's "
                                   "shot.json meta.prompt). Written as <run>/<shot>/semantic.<source>.json with the numbers under `frame`, like metrics.json.")
    p.add_argument("shots", nargs="*", help="shot names or globs (commas allowed)")
    p.add_argument("--group", help="a group of groups.json")
    p.add_argument("--all", action="store_true", help="every shot")
    p.add_argument("--match", metavar="GLOB", help="narrow the selection")
    p.add_argument("--source", help="the candidate source (default: the first candidate of config.json)")
    p.add_argument("--against", help="the source to compare with (default: config.reference)")
    p.add_argument("--prompt", help="one prompt for every shot (default: each shot's meta.prompt, when it has one)")
    p.add_argument("--run", default="adhoc", help="run name: output goes to .perceptual-loop/runs/NAME/<shot>/ (default: adhoc; give the name of the compare run to sit beside its metrics)")
    p.add_argument("--out", metavar="DIR", help="write the run here instead (DIR/<shot>/semantic.<source>.json)")
    p.add_argument("--min-clip", type=float, help="gate: smallest allowed CLIP cosine of a shot")
    p.add_argument("--max-lpips", type=float, help="gate: largest allowed LPIPS of a shot")
    p.add_argument("--min-text", type=float, help="gate: smallest allowed cosine with the prompt")
    p.set_defaults(fn=cmd_batch)
    return ap


def run(argv: list[str] | None = None):
    V.utf8_stdio()
    argv = sys.argv[1:] if argv is None else argv
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.self_test:
        raise SystemExit(self_test(argv))
    if not args.cmd:
        ap.print_help(sys.stderr)
        raise SystemExit(2)
    if not set(args.metrics.split(",")) <= {"clip", "lpips"} or not args.metrics:
        pl.fail("--metrics: expected clip, lpips or clip,lpips")
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
