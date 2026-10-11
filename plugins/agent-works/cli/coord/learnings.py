"""Learnings shared across the projects of this machine: what one project found out that the next one would pay for.

  aw learn add --topic "<one line>" --tags a,b (--text "..." | --from-file F)      F may be - for stdin
  aw learn search <terms...> [--tag t] [--limit N] [--all] [--json]
  aw learn show ID          aw learn list [--tag t] [--all] [--json]
  aw learn edit ID [--topic ...] [--tags ...] [--text ... | --from-file F]
  aw learn retire ID [--reason "..."]

What belongs here: facts about the machine, a tool, an operating system, an engine or a library that hold whatever
the project is (a compiler that runs out of memory at a certain job count, a shell that mangles a path, an API that
lies). What does not: anything about one project's code, design or decisions (that is the project's own memory), and
never secrets or proprietary content: every project on the machine reads this store. A learning that looks like it
holds a credential is refused.

One Markdown file per learning in <store>/learnings, with frontmatter: id, topic, tags, source (the project it came
from), created, updated, and retired once it no longer holds. Search ranks a term found in the topic above one found
in the tags above one found in the body. Exit codes: 0 done (search: something found), 1 nothing found, 2 usage or
refused.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import common, store

sys.dont_write_bytecode = True

# What a credential tends to look like. A refusal names the kind and the line, never the text.
SECRETS: List[Tuple[str, str]] = [
    ("a private key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("an access key id", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    ("a hosting token", r"\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bglpat-[A-Za-z0-9_-]{16,}"),
    ("an API key", r"\bsk-[A-Za-z0-9_-]{20,}"),
    ("a chat token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    ("a bearer token", r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{20,}"),
    ("a credential in a URL", r"[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@"),
    ("a password or secret written out",
     r"(?i)\b(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['\"]?[^\s'\"<>{}$]{8,}"),
]
_WORD = re.compile(r"[a-z0-9][a-z0-9_.+#-]*")


def folder() -> Path:
    return store.home() / "learnings"


def secrets_in(text: str) -> List[str]:
    """What looks like a credential, as "kind (line N)"."""
    found = []
    for n, line in enumerate(text.splitlines(), 1):
        for kind, pattern in SECRETS:
            if re.search(pattern, line):
                found.append(f"{kind} (line {n})")
                break
    return found


def _tags(text: Any) -> List[str]:
    if isinstance(text, list):
        text = ",".join(str(t) for t in text)
    seen: List[str] = []
    for t in re.split(r"[,\s]+", str(text or "").lower()):
        t = re.sub(r"[^a-z0-9_.+#-]", "", t)
        if t and t not in seen:
            seen.append(t)
    return seen


def _slug(topic: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:48].strip("-") or "learning"


def _render(fields: Dict[str, Any], body: str) -> str:
    lines = ["---"]
    for key in ("id", "topic", "tags", "source", "created", "updated", "retired", "reason"):
        value = fields.get(key)
        if value in (None, ""):
            continue
        if key == "tags":
            value = "[" + ", ".join(value) + "]"
        elif key in ("topic", "reason", "source") and (str(value)[:1] in "\"'[" or str(value).strip() != str(value)):
            value = '"' + str(value).replace('"', "'") + '"'
        lines.append(f"{key}: {value}")
    return "\n".join(lines) + "\n---\n\n" + body.strip() + "\n"


def load(p: Path) -> Optional[Dict[str, Any]]:
    text = common.read_text(p)
    if text is None:
        return None
    fields, body = common.parse_frontmatter(text)
    if not fields or not fields.get("id"):
        return None
    return {**fields, "id": str(fields["id"]), "topic": str(fields.get("topic") or ""), "tags": _tags(fields.get("tags")),
            "body": body.strip(), "file": p.name}


def every(include_retired: bool = False) -> List[Dict[str, Any]]:
    try:
        files = sorted(p for p in folder().iterdir() if p.suffix == ".md")
    except OSError:
        return []
    rows = [r for r in (load(p) for p in files) if r]
    return [r for r in rows if include_retired or not r.get("retired")]


def _norm_id(text: str) -> str:
    digits = re.sub(r"\D", "", str(text))
    return f"{int(digits):04d}" if digits else ""


def find(ident: str) -> Dict[str, Any]:
    want = _norm_id(ident)
    hit = next((r for r in every(True) if r["id"] == want), None) if want else None
    if hit is None:
        raise store.CoordError(f"learn: no learning '{ident}' (aw learn list shows them)")
    return hit


def check(topic: str, body: str, limit: float) -> None:
    topic = topic.strip()
    if not topic or "\n" in topic or len(topic) > 120:
        raise store.CoordError("learn: --topic is one line of at most 120 characters that says what was learned")
    if not body.strip():
        raise store.CoordError("learn: an empty learning: give the body with --text or --from-file (- reads stdin)")
    if len(body) > limit:
        raise store.CoordError(f"learn: {len(body)} characters, and a learning holds at most {limit:g} "
                               f"(coordination.learningChars). Keep the fact, the evidence and how to apply it; "
                               f"leave the story out.")
    found = secrets_in(topic + "\n" + body)
    if found:
        raise store.CoordError("learn: refused, this looks like it holds " + "; ".join(found[:5]) + ". Every project on "
                               "this machine reads shared learnings: write the lesson without the value.")


def add(topic: str, tags: List[str], body: str, source: str, limit: float) -> Dict[str, Any]:
    check(topic, body, limit)
    d = folder()
    d.mkdir(parents=True, exist_ok=True)
    with store.FileLock(d / "index"):  # the next id is read and taken in one step
        ids = [int(r["id"]) for r in every(True) if r["id"].isdigit()]
        ident = f"{(max(ids) if ids else 0) + 1:04d}"
        today = common.today()
        fields = {"id": ident, "topic": topic.strip(), "tags": tags, "source": source, "created": today, "updated": today}
        p = d / f"{ident}-{_slug(topic)}.md"
        store.write(p, _render(fields, body))
    return {**fields, "file": p.name}


def score(row: Dict[str, Any], terms: List[str]) -> Tuple[int, int]:
    """(how many of the terms it matches, its weight): topic counts most, then tags, then the body."""
    topic_words = _WORD.findall(row["topic"].lower())
    body_low = row["body"].lower()
    matched = weight = 0
    for t in terms:
        w = 0
        if t in topic_words:
            w += 6
        elif t in row["topic"].lower():
            w += 3
        if t in row["tags"]:
            w += 4
        elif any(t in tag for tag in row["tags"]):
            w += 2
        w += min(body_low.count(t), 3)
        if w:
            matched += 1
            weight += w
    return matched, weight


def search(terms: List[str], tag: Optional[str] = None, include_retired: bool = False) -> List[Dict[str, Any]]:
    words = [w for t in terms for w in _WORD.findall(t.lower())]
    rows = []
    for r in every(include_retired):
        if tag and tag.lower() not in r["tags"]:
            continue
        matched, weight = score(r, words) if words else (1, 0)
        if matched:
            rows.append({**r, "matched": matched, "score": weight})
    return sorted(rows, key=lambda r: (-r["matched"], -r["score"], str(r.get("updated") or ""), r["id"]))


def _line(r: Dict[str, Any]) -> str:
    tags = f" [{', '.join(r['tags'])}]" if r["tags"] else ""
    retired = "  RETIRED" if r.get("retired") else ""
    return f"{r['id']}  {r['topic']}{tags}  ({r.get('source') or '?'}, {r.get('updated') or r.get('created') or '?'}){retired}"


def _public(r: Dict[str, Any], with_body: bool = False) -> Dict[str, Any]:
    return {k: v for k, v in r.items() if with_body or k != "body"}


def _body_arg(a: Any) -> Optional[str]:
    if getattr(a, "text", None) is not None:
        return str(a.text)
    if getattr(a, "from_file", None) == "-":
        return sys.stdin.read()
    if getattr(a, "from_file", None):
        text = common.read_text(a.from_file)
        if text is None:
            raise store.CoordError(f"learn: cannot read {a.from_file}")
        return text
    return None


# ------------------------------------------------------------------------------------------------------- commands

def cmd_add(a: Any) -> int:
    ctx = store.Context()
    body = _body_arg(a)
    if body is None:
        raise store.CoordError("learn add: give the body with --text or --from-file (- reads stdin)")
    ctx.stamp()
    row = add(a.topic, _tags(a.tags), body, ctx.name, store.setting(ctx.cfg, "learningChars"))
    store.emit(row, a.json, f"{row['id']}: shared with every project on this machine ({row['file']})")
    return 0


def cmd_search(a: Any) -> int:
    rows = search(a.terms, a.tag, a.all)[: max(a.limit, 0)]
    lines = [_line(r) for r in rows]
    if rows:
        lines.append("read one with: aw learn show <id>")
    store.emit({"results": [_public(r) for r in rows]}, a.json, "\n".join(lines) if lines else "(nothing found)")
    return 0 if rows else 1


def cmd_show(a: Any) -> int:
    r = find(a.id)
    text = common.read_text(folder() / r["file"]) or ""
    store.emit(_public(r, True), a.json, text.rstrip("\n"))
    return 0


def cmd_list(a: Any) -> int:
    rows = [r for r in every(a.all) if not a.tag or a.tag.lower() in r["tags"]]
    store.emit({"learnings": [_public(r) for r in rows]}, a.json, "\n".join(_line(r) for r in rows) if rows else "(no learnings)")
    return 0


def _rewrite(r: Dict[str, Any], **changes: Any) -> Dict[str, Any]:
    body = changes.pop("body", None)
    fields = {**{k: v for k, v in r.items() if k not in ("body", "file", "matched", "score")}, **changes, "updated": common.today()}
    store.write(folder() / r["file"], _render(fields, body if body is not None else r["body"]))
    return {**fields, "file": r["file"]}


def cmd_edit(a: Any) -> int:
    ctx = store.Context()
    r = find(a.id)
    body = _body_arg(a)
    changes: Dict[str, Any] = {}
    if a.topic:
        changes["topic"] = a.topic.strip()
    if a.tags is not None:
        changes["tags"] = _tags(a.tags)
    if body is not None:
        changes["body"] = body
    if not changes:
        raise store.CoordError("learn edit: nothing to change: --topic, --tags, --text or --from-file")
    check(changes.get("topic", r["topic"]), changes.get("body", r["body"]), store.setting(ctx.cfg, "learningChars"))
    with store.FileLock(folder() / "index"):
        row = _rewrite(r, **changes)
    store.emit(row, a.json, f"{row['id']}: updated")
    return 0


def cmd_retire(a: Any) -> int:
    r = find(a.id)
    reason = " ".join((a.reason or "").split())
    if secrets_in(reason):
        raise store.CoordError("learn retire: the reason looks like it holds a credential")
    with store.FileLock(folder() / "index"):
        row = _rewrite(r, retired=common.today(), reason=reason)
    store.emit(row, a.json, f"{row['id']}: retired (kept, left out of search and list unless --all)")
    return 0


def register(subparsers: Any) -> None:
    import argparse

    p = subparsers.add_parser("learn", help="learnings shared across projects: add, search, show, list, edit, retire",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.set_defaults(func=lambda a: (p.print_help(sys.stderr), 2)[1])
    sub = p.add_subparsers(dest="learn_command", metavar="<action>")

    def body(q: Any) -> None:
        q.add_argument("--text", help="the learning itself: the fact, how it was established, how to apply it")
        q.add_argument("--from-file", metavar="F", help="read the body from a file (- for stdin)")
        q.add_argument("--json", action="store_true", help="print one JSON document")

    q = sub.add_parser("add", help="publish a learning that is not about one project")
    q.add_argument("--topic", required=True, help="one line that says what was learned")
    q.add_argument("--tags", default="", help="comma-separated: the tool, the platform, the kind of trap")
    body(q)
    q.set_defaults(func=cmd_add)

    q = sub.add_parser("search", help="find learnings by words (topic counts most, then tags, then the body)")
    q.add_argument("terms", nargs="*")
    q.add_argument("--tag", help="only learnings with this tag")
    q.add_argument("--limit", type=int, default=10)
    q.add_argument("--all", action="store_true", help="also retired ones")
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_search)

    q = sub.add_parser("show", help="print one learning")
    q.add_argument("id")
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_show)

    q = sub.add_parser("list", help="every learning, one line each")
    q.add_argument("--tag", help="only learnings with this tag")
    q.add_argument("--all", action="store_true", help="also retired ones")
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_list)

    q = sub.add_parser("edit", help="correct a learning's topic, tags or body")
    q.add_argument("id")
    q.add_argument("--topic")
    q.add_argument("--tags")
    body(q)
    q.set_defaults(func=cmd_edit)

    q = sub.add_parser("retire", help="mark a learning as no longer true (kept, out of search)")
    q.add_argument("id")
    q.add_argument("--reason", help="why it no longer holds")
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_retire)
