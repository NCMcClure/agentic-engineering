"""Spec-tree structural verifier (count-agnostic).

Read-only, stdlib only. Validates the progressive-disclosure specification
under `.plan/spec/` authored by the `spec-1-specify` skill:

  * every content file (non-index, non-README) carries valid frontmatter
    (tags, summary, created, updated; relates-to optional);
  * `index.md` files are navigation hubs and carry NO frontmatter;
  * `relates-to` cross-links resolve to real files;
  * a root `spec/index.md` exists.

Exits 0 clean, 1 on warnings only, 2 on any critical violation.
Reports the actual discovered counts, e.g.:
    OK: 4 categories, 17 content files, 6 index hubs, 0 broken links

The `assets/` and `scripts/` directories are skipped (site chrome, not docs),
as is `prototypes/` (throwaway HTML design artifacts, not docs).
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

SPEC_ROOT = Path(__file__).resolve().parent.parent   # .plan/spec/  (script is in spec/scripts/)

SKIP_DIRS = {"assets", "scripts", ".site", "prototypes"}
DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
RELATES_LINE_RE = re.compile(r"^\s*-\s*(.+?)\s*$")
SIZE_WARN_LINES = 200


def parse_frontmatter(text: str):
    """Return (frontmatter_dict_or_None, had_block). Minimal YAML — flat keys,
    inline `[a, b]` lists, and `key:` followed by `- item` lines."""
    if not text.startswith("---"):
        return None, False
    end = text.find("\n---", 3)
    if end == -1:
        return None, False
    block = text[3:end].strip("\n")
    data: dict[str, object] = {}
    lines = block.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.strip().startswith("#"):
            i += 1
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not m:
            i += 1
            continue
        key, val = m.group(1), m.group(2).strip()
        if val == "":
            items = []
            j = i + 1
            while j < len(lines) and re.match(r"^\s*-\s+", lines[j]):
                items.append(re.sub(r"^\s*-\s+", "", lines[j]).strip())
                j += 1
            data[key] = items
            i = j
        elif val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            data[key] = [s.strip() for s in inner.split(",") if s.strip()] if inner else []
            i += 1
        else:
            data[key] = val.strip().strip('"').strip("'")
            i += 1
    return data, True


def verify() -> int:
    failures: list[str] = []   # critical -> exit 2
    warnings: list[str] = []   # exit 1 if no failures

    if not (SPEC_ROOT / "index.md").exists():
        failures.append("spec/: missing root index.md")

    categories = sorted(
        p.name for p in SPEC_ROOT.iterdir() if p.is_dir() and p.name not in SKIP_DIRS
    )

    content_files: list[Path] = []
    index_hubs: list[Path] = []

    for md in sorted(SPEC_ROOT.rglob("*.md")):
        if any(part in SKIP_DIRS for part in md.relative_to(SPEC_ROOT).parts):
            continue
        rel = md.relative_to(SPEC_ROOT)
        text = md.read_text()

        if md.name == "index.md":
            index_hubs.append(md)
            fm, had = parse_frontmatter(text)
            if had:
                warnings.append(f"spec/{rel}: index.md should be a navigation hub with no frontmatter")
            continue
        if md.name == "README.md":
            continue

        content_files.append(md)
        fm, had = parse_frontmatter(text)
        if not had:
            failures.append(f"spec/{rel}: MISSING_FRONTMATTER (content file has no --- block)")
            continue
        for field in ("tags", "summary", "created", "updated"):
            if field not in fm:
                failures.append(f"spec/{rel}: INVALID_FRONTMATTER (missing '{field}')")
        if isinstance(fm.get("tags"), list) and not fm["tags"]:
            warnings.append(f"spec/{rel}: EMPTY_TAGS")
        for datef in ("created", "updated"):
            v = fm.get(datef)
            if isinstance(v, str) and v and not DATE_RE.match(v):
                failures.append(f"spec/{rel}: INVALID_FRONTMATTER ('{datef}' must be YYYY-MM, got '{v}')")
        # relates-to link integrity
        rel_to = fm.get("relates-to", [])
        if isinstance(rel_to, list):
            for link in rel_to:
                link = str(link).split("#")[0].strip()
                if not link or link.startswith("http"):
                    continue
                if not (md.parent / link).resolve().exists():
                    failures.append(f"spec/{rel}: relates-to link does not resolve: {link}")

        if text.count("\n") > SIZE_WARN_LINES:
            warnings.append(f"spec/{rel}: oversized (> {SIZE_WARN_LINES} lines) — consider splitting")

    for w in warnings:
        print(f"WARN: {w}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} failure(s), {len(warnings)} warning(s)")
        return 2

    print(
        f"OK: {len(categories)} categories, {len(content_files)} content files, "
        f"{len(index_hubs)} index hubs, 0 broken links"
    )
    return 1 if warnings else 0


if __name__ == "__main__":
    sys.exit(verify())
