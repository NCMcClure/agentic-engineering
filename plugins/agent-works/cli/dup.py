"""aw dup: a rule stated in more than one place.

    aw dup [--json] [--min-words N] [paths…]

A rule written twice is two rules the day one copy changes. This finds runs of the same words shared between the rule
surfaces of a project: the root AGENTS.md, the hubs, .agents/README.md, the briefs, and the memories of type decision.

  DUP_RULE  warning  a run of at least `dup.minWords` consecutive words (default 14) that two files share; reported
                     once per pair of places as file:line pairs

How: each file's prose is reduced to lower-case words (code fences, frontmatter, link targets and punctuation
dropped), cut into shingles of `dup.shingleWords` words (default 12), and shingles two files share are joined into
runs. Tune in .agents/agent-works.json: `dup.shingleWords`, `dup.minWords`, and `dup.ignore` (regexes; a line that
matches one is not read). Keep one copy, and make the other a link to it.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import common
from common import Finding

WORD = re.compile(r"[a-z0-9]+(?:['’][a-z]+)?")


def surfaces(root: Path, cfg: Dict[str, Any]) -> List[Path]:
    """The files that state rules."""
    out: List[Path] = []
    seen = set()

    def add(p: Path) -> None:
        if p.is_file() and p not in seen:
            seen.add(p)
            out.append(p)

    add(root / "AGENTS.md")
    for md in common.markdown_files(root):
        if md.name == "AGENTS.md":
            add(md)
    add(root / ".agents" / "README.md")
    briefs = common.config_path(cfg, root, "briefs")
    if briefs.is_dir():
        for p in sorted(briefs.rglob("*.md")):
            add(p)
    memory = common.config_path(cfg, root, "memory")
    if memory.is_dir():
        for p in sorted(memory.rglob("*.md")):
            if p.name == "INDEX.md":
                continue
            fields, _ = common.parse_frontmatter(common.read_text(p, "") or "")
            if fields and fields.get("type") == "decision":
                add(p)
    return out


def words_of(text: str, ignore: List[str]) -> List[Tuple[str, int]]:
    """(word, line number) of a file's prose."""
    out: List[Tuple[str, int]] = []
    fenced = False
    in_front = text.startswith("---")
    for n, line in enumerate(text.splitlines(), 1):
        if in_front:
            if n > 1 and line.strip() == "---":
                in_front = False
            continue
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
            continue
        if fenced or line.lstrip().startswith("<!--"):
            continue
        skip = False
        for rx in ignore:
            try:
                if re.search(rx, line):
                    skip = True
                    break
            except re.error:
                continue
        if skip:
            continue
        line = re.sub(r"\]\([^)]*\)", "]", line)  # a link's target is an address, not prose
        out += [(w, n) for w in WORD.findall(line.lower())]
    return out


def runs_between(a: List[Tuple[str, int]], b: List[Tuple[str, int]], size: int) -> List[Tuple[int, int, int]]:
    """Maximal runs of words two word lists share: (start in a, start in b, length in words), longest first."""
    if len(a) < size or len(b) < size:
        return []
    index: Dict[Tuple[str, ...], List[int]] = {}
    wa = [w for w, _ in a]
    wb = [w for w, _ in b]
    for i in range(len(wa) - size + 1):
        index.setdefault(tuple(wa[i:i + size]), []).append(i)
    hits = set()
    for j in range(len(wb) - size + 1):
        for i in index.get(tuple(wb[j:j + size]), ()):
            hits.add((i, j))
    runs = []
    for i, j in sorted(hits):
        if (i - 1, j - 1) in hits:
            continue  # not the start of its run
        n = 1
        while (i + n, j + n) in hits:
            n += 1
        runs.append((i, j, n + size - 1))
    # One report per place: drop a run that lies inside a longer one on either side (repeated boilerplate).
    runs.sort(key=lambda r: -r[2])
    kept: List[Tuple[int, int, int]] = []
    for i, j, n in runs:
        if any(ki <= i < ki + kn or kj <= j < kj + kn for ki, kj, kn in kept):
            continue
        kept.append((i, j, n))
    return kept


def findings(root: Path, cfg: Optional[Dict[str, Any]] = None, paths: Optional[List[str]] = None,
             min_words: Optional[int] = None) -> List[Finding]:
    cfg = cfg if cfg is not None else common.load_config(root)
    opts = cfg.get("dup") or {}
    size = max(4, int(opts.get("shingleWords") or 12))
    least = max(size, int(min_words or opts.get("minWords") or 14))
    ignore = [str(x) for x in opts.get("ignore") or []]
    files = [root / p for p in paths] if paths else surfaces(root, cfg)
    docs = [(f, words_of(common.read_text(f, "") or "", ignore)) for f in files if f.is_file()]
    out: List[Finding] = []
    for x in range(len(docs)):
        for y in range(x + 1, len(docs)):
            (fa, a), (fb, b) = docs[x], docs[y]
            for i, j, n in runs_between(a, b, size):
                if n < least:
                    continue
                excerpt = " ".join(w for w, _ in a[i:i + min(n, 12)])
                out.append(Finding("DUP_RULE", "warning", common.rel(fa, root), a[i][1],
                                   f"{n} words also in {common.rel(fb, root)}:{b[j][1]}: \"{excerpt}…\" "
                                   "(keep one copy, link to it from the other)"))
    return out


def run(args: argparse.Namespace) -> int:
    root = common.project_root()
    cfg = common.load_config(root)
    found = findings(root, cfg, args.paths or None, args.min_words)
    n = len(args.paths) if args.paths else len(surfaces(root, cfg))
    return common.report(found, args.json, f"dup: {n} rule surfaces", {"surfaces": n})


def register(subparsers: Any) -> None:
    p = subparsers.add_parser("dup", help="find a rule stated in more than one place", description=__doc__,
                              formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("paths", nargs="*", help="compare these files instead of the project's rule surfaces")
    p.add_argument("--min-words", type=int, help="shortest shared run that is reported (default: dup.minWords, 14)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=run)
