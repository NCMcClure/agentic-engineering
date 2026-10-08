"""Blind a before/after pair for an unanchored critic.

A critic that can read "before" in a file name is not blind. This copies the two pictures (and an optional
reference) to neutral names, A.png and B.png (and R.png), in a folder of their own, and decides which of them is the
earlier one from the comparison's id, so the choice is repeatable and nobody has to remember to alternate. The key
(which letter is the "before") goes to the caller and into key.json one level above the pictures: it is never passed
to the critic and never sits in the folder the critic is pointed at.

    blind.py --id ID --before FILE --after FILE [--reference FILE] [--out DIR] [--json]
    blind.py reveal --key FILE            print the key of one comparison (for the caller, after the judgement)

Standard library only. Exit 0 done, 2 usage or environment error.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402


def a_is_before(comparison_id: str) -> bool:
    """Half of all ids put the earlier picture on A: from the id, so a re-run gives the same labelling."""
    return hashlib.sha256(comparison_id.encode("utf-8")).digest()[0] % 2 == 0


def blind(comparison_id: str, before: Path, after: Path, reference: Path | None, out: Path | None) -> dict:
    for f in (before, after, reference):
        if f is not None and not f.is_file():
            raise pl.PlError(f"no such picture: {f}")
    base = out or Path(tempfile.mkdtemp(prefix="pl-blind-"))
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in comparison_id) or "comparison"
    # Pictures in <base>/<id>/view/, the key beside that folder: the critic is given only paths under view/.
    view = base / safe / "view"
    view.mkdir(parents=True, exist_ok=True)
    first = a_is_before(comparison_id)
    images = {"A": view / f"A{before.suffix.lower()}", "B": view / f"B{after.suffix.lower()}"}
    shutil.copyfile(before if first else after, images["A"])
    shutil.copyfile(after if first else before, images["B"])
    if reference is not None:
        images["R"] = view / f"R{reference.suffix.lower()}"
        shutil.copyfile(reference, images["R"])
    doc = {"id": comparison_id, "images": {k: str(v) for k, v in images.items()}, "aIs": "before" if first else "after"}
    key = base / safe / "key.json"
    pl.write_json(key, doc)
    return {**doc, "key": str(key)}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        if argv[:1] == ["reveal"]:
            ap = argparse.ArgumentParser(prog="blind.py reveal", description="Print the key of a blinded comparison.")
            ap.add_argument("--key", required=True, metavar="FILE")
            ap.add_argument("--json", action="store_true")
            args = ap.parse_args(argv[1:])
            doc = pl.read_json(Path(args.key))
            if not doc:
                raise pl.PlError(f"no key at {args.key}")
            pl.emit(doc, args.json, f"{doc['id']}: A is the {doc['aIs']}, B is the {'after' if doc['aIs'] == 'before' else 'before'}")
            return 0
        ap = argparse.ArgumentParser(prog="blind.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
        ap.add_argument("--id", required=True, metavar="ID", help="the comparison's name (a shot name): decides which letter is the earlier picture")
        ap.add_argument("--before", required=True, metavar="FILE")
        ap.add_argument("--after", required=True, metavar="FILE")
        ap.add_argument("--reference", metavar="FILE", help="copied as R: shown to the critic as a reference that is not assumed to be right")
        ap.add_argument("--out", metavar="DIR", help="where to put <id>/view/A.png … and <id>/key.json (default: a new temp folder)")
        ap.add_argument("--json", action="store_true", help="print one JSON document: {id, images: {A, B, R?}, aIs, key}")
        args = ap.parse_args(argv)
        doc = blind(args.id, Path(args.before), Path(args.after), Path(args.reference) if args.reference else None,
                    Path(args.out).resolve() if args.out else None)
    except pl.PlError as e:
        pl.fail(str(e))
    lines = [f"{k}: {v}" for k, v in doc["images"].items()]
    lines.append(f"key (not for the critic): {doc['key']}")
    pl.emit(doc, args.json, "\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
