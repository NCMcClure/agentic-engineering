#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""A lint for agent reports and PR bodies: claims need evidence, and a metric is not a verdict.

  evidence_lint.py [FILE | -] [--reference-name NAME ...] [--window N] [--json]

Reads markdown from FILE or stdin. Code blocks and quoted lines (>) are not linted. Rules:

  metric-verdict   (a) "worse", "regressed", "degraded", "better" within N words (default 8) of a metric (ssim,
                   deltaE, PSNR, score ...) in a sentence that does not say what the picture shows ("in the
                   picture", "shows", "looks"). "Because <metric> dropped" does not excuse it. A number that moved says the pictures differ, not which is right.
  bare-claim       (b) "verified", "confirmed", "works", "passes", "fixed" in a sentence with no artifact: a path, a
                   command or name in backticks, a number with a unit, a count, a test name, an issue or commit.
                   The artifact may also be in the next sentence, or under a line that ends with a colon.
  reference-target (c) a target set against the reference ("within 10 % of the reference", "get deltaE below 2"):
                   look work aims at the candidate being right, not at a distance from the reference.
  no-count         (d, hint) "all tests pass"-style totals with no count.
  no-skipped       (e, hint) "full pass" / "all gates" claims in a report that never says what was skipped or not run.

Exit 1 when a rule (a)-(c) fires, else 0 (hints alone do not fail); 2 on a usage error. The rules are few on
purpose: negated, conditional and planned statements ("not verified", "should pass", "to be confirmed") are left
alone.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

I = re.IGNORECASE
METRIC = re.compile(r"(?<![\w.])(ssim|delta ?e(?:2000|norm)?|Δe(?:2000)?|psnr|lpips|edgef1|scores?|metrics?)(?![\w])", I)
VERDICT = re.compile(r"\b(worse|worsened|regress(?:ed|es|ion)|degrad(?:ed|es|ation)|better)\b", I)
PICTURE = re.compile(r"\b(shows?|showing|visibl[ey]|by eye|looks?|looking at|in the (?:picture|image|frame|sheet|crop|render)s?)\b", I)

# A claim is the word used as a finished fact about the work; "how it works", "render passes" and "a fixed seed" are not.
CLAIM = re.compile(
    r"\b(?:(verified|confirmed)"
    r"|(?:is|are|was|were|now|been|got|gets|it's|that's)\s+(fixed)"
    r"|^\W*(fixed)\b"
    r"|(?:it|this|that|which|everything|all|fix|change|feature|now|still|also|import|build|export|page|hook|script)\s+(?:now\s+|still\s+|all\s+)?(works)"
    r"|(?:tests?|suite|gates?|checks?|build|ci|lint|typecheck|it|this|everything|all|that)\s+(?:now\s+|still\s+|all\s+)?(pass(?:es|ed)?))\b", I)
HEDGE = re.compile(r"\b(not|never|no|cannot|without|should|must|will|would|could|might|may|to|needs?|once|until|if|when|whether|"
                   r"before|todo|expect(?:ed)?|plan(?:ned)?|hope|assum\w+|how|why|what|can|unless|ensure|check)\b|n't", I)


def hedged(before: str) -> bool:
    """Negated, conditional or planned: one of the four words before the claim says it is not a finished fact."""
    return bool(HEDGE.search(" ".join(before.split()[-4:])))



ARTIFACT = re.compile(
    r"`[^`]+`"                                                   # a command, a name
    r"|[\w.-]+[/\\][\w./\\-]+"                                   # a path
    r"|\b[\w-]+\.(?:png|jpe?g|webp|json|jsonl|md|log|txt|html|mp4|webm|wav|py|ts|tsx|js|cpp|h|lua|ps1|sh|ya?ml|toml)\b"
    r"|\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds?|min|minutes?|h|hours?|%|px|fps|hz|db|ev|kb|mb|gb|x|shots?|tests?|checks?|frames?|runs?|"
    r"files?|cases?|passed|failed|of\s+\d+)(?![\w])"             # a number with a unit, a count
    r"|\b\d+\s?/\s?\d+\b"                                        # 31/31
    r"|\btest_\w+|\b\w+(?:Test|Spec)\b|\b\w+(?:\.\w+){2,}\b"     # a test name
    r"|#\d+\b|\b[0-9a-f]{7,40}\b|https?://\S+"                   # an issue, a commit, a link
    r"|\[[^\]]+\]\([^)]+\)", I)                                  # a markdown link
TARGET_CUE = re.compile(r"\b(target|goal|aim(?:ing)?|until|must|should|needs? to|get|bring|reach|push|drive|criteri\w+|success|accept\w*|done when|threshold)\b", I)
THRESHOLD = re.compile(r"(ssim|delta ?e(?:2000|norm)?|Δe(?:2000)?|psnr|lpips|edgef1)\W{0,3}(?:\w+\W+){0,3}?"
                       r"(below|under|above|over|at least|at most|less than|more than|greater than|<=?|>=?|≤|≥)\s*\d", I)
TOTAL = re.compile(r"\b(?:all|every(?:thing)?)\s+(?:the\s+|of the\s+)?(?:\w+\s+){0,2}?(?:pass(?:es|ed)?|green|succeed(?:s|ed)?|ok)\b|\bno\s+(?:test\s+)?failures\b|\beverything\s+is\s+green\b", I)
COUNT = re.compile(r"\b\d+\s*(?:of\s+\d+|/\s*\d+|tests?|checks?|shots?|cases?|passed|pass|gates?|entries|files?|ok)\b|`[^`]+`", I)
FULL_CLAIM = re.compile(r"\b(full (?:pass|suite|run)|all (?:the )?gates|whole suite|every gate)\b", I)
SKIPPED = re.compile(r"\b(skipped|not run|did not run|didn't run|not checked|not verified|not tested|not covered|untested|left out|out of scope|nothing (?:was )?skipped)\b", I)

FIX = {
    "metric-verdict": "say what changed in the picture and judge that (wrong, less-plausible, more-correct, different-ok); give the number as 'moved from X to Y'",
    "bare-claim": "name the evidence: the command and its result, the file or sheet, the test, the measured number",
    "reference-target": "aim at the candidate being right (the asset shown faithfully, nothing missing); keep the metric as a regression gate against its own baseline",
    "no-count": "give the count and the command: '31 of 31 pass (`npm test`)'",
    "no-skipped": "add what was skipped or not run, or say that nothing was",
}


def sentences(text: str) -> list[dict[str, Any]]:
    """The sentences of the prose with their line numbers; a block is a paragraph, a list item, a heading or a table row."""
    blocks: list[list[tuple[int, str]]] = []
    cur: list[tuple[int, str]] = []
    fence = None
    for no, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        m = re.match(r"\s*(```+|~~~+)", line)
        if m:
            fence = None if fence else m.group(1)[0]
            cur and blocks.append(cur)
            cur = []
            continue
        if fence or re.match(r"\s*>", line) or re.match(r" {4,}\S", line) and not cur:
            continue
        starts = re.match(r"\s*(?:[-*+]|\d+[.)])\s+|\s*#{1,6}\s|\s*\|", line)
        if not line.strip() or starts:
            cur and blocks.append(cur)
            cur = []
        if line.strip():
            cur.append((no, line))
        if line.strip() and re.match(r"\s*(?:#{1,6}\s|\|)", line):
            blocks.append(cur)
            cur = []
    cur and blocks.append(cur)
    out: list[dict[str, Any]] = []
    for b, block in enumerate(blocks):
        joined, starts_at = "", []
        for no, line in block:
            starts_at.append((len(joined), no))
            joined += re.sub(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|^\s*#{1,6}\s+", "", line).strip() + " "
        # a sentence ends at . ! ? followed by a space and a capital, a digit or an opening mark; code spans are kept whole
        masked = re.sub(r"`[^`]*`", lambda m: "\x00" * len(m.group(0)), joined)
        cuts = [0] + [m.end() for m in re.finditer(r"(?<=[.!?])[\"')\]]?\s+(?=[\"'(\[`*_]?[A-Z0-9\x00])", masked)] + [len(joined)]
        for a, z in zip(cuts, cuts[1:]):
            s = joined[a:z].strip()
            if s:
                at = a + len(joined[a:z]) - len(joined[a:z].lstrip())
                line_no = max((no for off, no in starts_at if off <= at), default=block[0][0])
                out.append({"line": line_no, "text": s, "block": b})
    return out


def near(a: re.Match, b: re.Match, text: str, window: int) -> bool:
    lo, hi = sorted((a, b), key=lambda m: m.start())
    return len(text[lo.end():hi.start()].split()) <= window


def lint(text: str, reference_names: list[str] | None = None, window: int = 8) -> list[dict[str, Any]]:
    refs = "|".join(["reference", "ref", "original", "mock(?:up)?", "ground truth", *[re.escape(n) for n in reference_names or []]])
    within = re.compile(rf"\bwithin\s+\d+(?:\.\d+)?\s?(?:%|percent|pct)\s+of\s+(?:the\s+)?(?:{refs})\b", I)
    sents = sentences(text)
    found: list[dict[str, Any]] = []

    def add(rule: str, s: dict[str, Any], hint: bool = False) -> None:
        found.append({"line": s["line"], "rule": rule, "hint": hint, "sentence": s["text"], "fix": FIX[rule]})

    for i, s in enumerate(sents):
        t = s["text"]
        if t.rstrip().endswith("?"):
            continue
        nxt = sents[i + 1] if i + 1 < len(sents) else None
        # (a) a verdict read off a metric
        if not PICTURE.search(t) and any(near(v, m, t, window) for v in VERDICT.finditer(t) for m in METRIC.finditer(t)
                                         if not hedged(t[:v.start()])):
            add("metric-verdict", s)
        # (c) a target against the reference
        if within.search(t) or (THRESHOLD.search(t) and TARGET_CUE.search(t) and not re.search(r"\b(tolerances?|baseline|gate)\b", t, I)):
            add("reference-target", s)
        # (b) a claim with no artifact
        claim = next((m for m in CLAIM.finditer(t) if not hedged(t[:m.start(m.lastindex)])), None)
        bare = False
        if claim and not ARTIFACT.search(t):
            follows = nxt is not None and (nxt["block"] == s["block"] or t.rstrip().endswith(":")) and ARTIFACT.search(nxt["text"])
            if not follows:
                bare = True
                add("bare-claim", s)
        # (d) a total with no count
        if not bare and TOTAL.search(t) and not COUNT.search(t) and not hedged(t[:TOTAL.search(t).start()]):
            add("no-count", s, hint=True)
    # (e) a full pass claimed, nothing said about what was left out
    if not SKIPPED.search(text):
        first = next((s for s in sents if FULL_CLAIM.search(s["text"]) and not hedged(s["text"][:FULL_CLAIM.search(s["text"]).start()])), None)
        if first:
            add("no-skipped", first, hint=True)
    return sorted(found, key=lambda f: (f["line"], f["rule"]))


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(prog="evidence_lint.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", default="-", help="a markdown file, or - for stdin (default)")
    ap.add_argument("--reference-name", action="append", metavar="NAME", help="what this project calls its reference (repeatable), for rule (c)")
    ap.add_argument("--window", type=int, default=8, metavar="N", help="words between a verdict and a metric for rule (a) (default 8)")
    ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    a = ap.parse_args(argv)
    try:
        text = sys.stdin.buffer.read().decode("utf-8-sig", "replace") if a.file == "-" else Path(a.file).read_text(encoding="utf-8-sig")
    except OSError as e:
        print(f"cannot read {a.file}: {e}", file=sys.stderr)
        return 2
    found = lint(text, a.reference_name, a.window)
    failing = [f for f in found if not f["hint"]]
    if a.json:
        json.dump({"findings": found, "failing": len(failing), "hints": len(found) - len(failing)}, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        for f in found:
            print(f"{a.file if a.file != '-' else 'stdin'}:{f['line']}: {'hint ' if f['hint'] else ''}{f['rule']}: {f['sentence']}\n    fix: {f['fix']}")
        print(f"{len(failing)} finding(s), {len(found) - len(failing)} hint(s)" if found else "no findings")
    return 1 if failing else 0


if __name__ == "__main__":
    sys.exit(main())
