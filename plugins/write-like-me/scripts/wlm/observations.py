"""Append/read/clear the style-feedback observation ledger."""

import json
import time

from . import paths


def append(record: dict) -> None:
    paths.ensure_dirs()
    record.setdefault("ts", time.time())
    with paths.observations_path().open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def pending() -> list:
    p = paths.observations_path()
    if not p.exists():
        return []
    records = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def clear() -> None:
    p = paths.observations_path()
    if p.exists():
        p.unlink()
