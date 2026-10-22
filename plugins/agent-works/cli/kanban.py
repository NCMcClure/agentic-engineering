"""aw kanban: the task board for agents and scripts that run without the pane.

    aw kanban list [--json] [--status S] [--kind K] [--all]
    aw kanban add "<title>" [--details T | --from-file F] [--kind K] [--priority P] [--labels a,b] [--skills a,b]
                            [--owner O] [--ref R] [--needs N] [--status S | --suggest] [--source user|claude]
    aw kanban move <id> <status>
    aw kanban plan <id> [--epic ID|none] [--sprint ID|active|none]
    aw kanban epics
    aw kanban sprint list | new "<title>" [--goal G] [--end YYYY-MM-DD] | start <id> | close [<id>]
    aw kanban owe "<title>" --ref R --needs N [--details T | --from-file F] [--owner O]
    aw kanban settle <id> --evidence "<the command and its result>"
    aw kanban lint [--json]

This file is the twin of the pane's ``hooks/kanban/cards.ts``: the same card grammar, read and written line for line the
same way, so a card either side writes survives the other's next write. The golden cards in ``tests/fixtures/cards``
hold the two together. What this side never does: start an agent, or sync with a remote tracker (the pane does both).

The card grammar (it is not YAML):

- a file ``<id>-<slug>.md``: ``---``, frontmatter lines, ``---``, a blank line, the body in markdown;
- ``key: value`` lines. A value that starts with ``[`` or ``"`` is JSON (a list that is not JSON is split at its
  commas), ``'…'`` is taken without its quotes, anything else is the text as written. No block scalars, no comments
  after a value;
- one level of nesting, for ``remote:`` alone (the key with no value, then indented ``key: value`` lines); any
  other known key with no value reads as absent;
- a known key's list is one line; a YAML block list under ``labels:`` reads as empty and is not written back;
- a line that is not indented and is not a key the board knows (an unknown key, a comment) is kept verbatim with
  the indented and blank lines under it, and written back after the board's own keys, in the order read;
- an indented or blank line under a known key (other than ``remote``'s own keys) is dropped at the next write;
- indentation is spaces or tabs; a file may use LF or CRLF and is written with LF.

Known differences from the pane's parser, none of which a card written by either side meets: numbers in exotic
spellings (hex, ``Infinity``) for ``order`` read as 0 here, and whitespace other than ASCII and the common Unicode
spaces is trimmed by each language's own rule.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import common
from common import Finding

SUGGESTED = "suggested"
ARCHIVED = "archived"
CONFIG_FILE = "board.json"
TASK = "task"
GATE = "gate"
EPIC = "epic"
KINDS = (TASK, GATE, EPIC)
SPRINT_STATES = ("planned", "active", "closed")
PRIORITIES = ("low", "normal", "high")
LOCK_FILE = ".aw-kanban.lock"

# Days before lint speaks; a project overrides them under "kanban" in .agents/agent-works.json.
STALE_START_DAYS = common.DEFAULTS["kanban"]["staleStartDays"]
GATE_OWED_DAYS = common.DEFAULTS["kanban"]["gateOwedDays"]

DEFAULT_COLUMNS: List[Dict[str, Any]] = [
    {"id": "backlog", "title": "Backlog", "role": None},
    {"id": "in-progress", "title": "In progress", "role": "start"},
    {"id": "review", "title": "Review", "role": None},
    {"id": "done", "title": "Done", "role": "done"},
]

KNOWN_KEYS = frozenset(
    ["id", "title", "status", "order", "priority", "labels", "skills", "source", "created", "updated",
     "kind", "owner", "needs", "ref", "epic", "sprint", "remote"])

_FRONTMATTER = re.compile(r"---\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)(.*)\Z", re.S)
_PAIR = re.compile(r"^([ \t]*)([\w-]+):[ \t]*(.*)$", re.A)
_NUMBER = re.compile(r"^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$")
_CARD_NAME = re.compile(r"^\d+-.*\.md$")


# ----------------------------------------------------------------------------------- JavaScript's view of a value

def _js_str(value: Any) -> str:
    """``String(value)`` as the pane's JavaScript gives it, for the values a frontmatter line can hold."""
    if isinstance(value, str):
        return value
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return ",".join("" if v is None else _js_str(v) for v in value)
    return "[object Object]"


def _js_number(value: Any) -> Any:
    """``Number(value) || 0``: an int where the number is whole, so it prints as the pane prints it."""
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        if text == "" or not _NUMBER.match(text):
            return 0
        number = float(text)
    elif isinstance(value, list):
        return _js_number(_js_str(value))  # Number([3]) is 3: an array is its text first
    else:
        return 0
    if number != number or number in (float("inf"), float("-inf")):
        return 0
    return int(number) if number.is_integer() else number


def _refuse_constant(name: str) -> Any:
    raise ValueError(name)  # JSON.parse knows no NaN or Infinity


def _dumps(value: Any) -> str:
    """``JSON.stringify(value)``: no spaces between items, text outside ASCII left as it is."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


# ------------------------------------------------------------------------------------------------- the card grammar

def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48].rstrip("-")
    return slug or "card"


def file_name(card_id: str, title: str) -> str:
    return f"{card_id}-{slugify(title)}.md"


def _leading_int(text: str) -> int:
    m = re.match(r"\s*[+-]?\d+", text or "")
    return int(m.group(0)) if m else 0


def next_id(cards: List[Dict[str, Any]]) -> str:
    highest = max([_leading_int(c["id"]) for c in cards] + [0])
    return str(highest + 1).rjust(4, "0")


def _parse_scalar(text: str) -> Any:
    value = text.strip()
    if value.startswith("[") or value.startswith('"'):
        try:
            return json.loads(value, parse_constant=_refuse_constant)
        except (ValueError, RecursionError):
            if value.startswith("[") and value.endswith("]"):
                parts = [re.sub(r"""^['"]|['"]$""", "", part.strip()) for part in value[1:-1].split(",")]
                return [part for part in parts if part != ""]
    if len(value) > 1 and value.startswith("'") and value.endswith("'"):
        return value[1:-1]
    return value


def parse_frontmatter(text: str) -> Optional[Tuple[Dict[str, Any], List[str], str]]:
    """(data, extra, body), or None when the text does not open with a frontmatter block."""
    match = _FRONTMATTER.match(text)
    if not match:
        return None
    data: Dict[str, Any] = {}
    extra: List[str] = []
    nested: Optional[Dict[str, Any]] = None
    is_extra = False
    for line in re.split(r"\r?\n", match.group(1)):
        pair = _PAIR.match(line)
        if pair and pair.group(1) == "":
            key, value = pair.group(2), pair.group(3)
            nested = None
            is_extra = key not in KNOWN_KEYS
            if is_extra:
                extra.append(line)
            elif value.strip() != "":
                data[key] = _parse_scalar(value)
            elif key == "remote":
                nested = {}
                data[key] = nested
        elif line[:1] not in ("", " ", "\t"):
            # Not indented and no key the board knows (a comment, say): it and what hangs under it are kept.
            nested = None
            is_extra = True
            extra.append(line)
        elif is_extra:
            extra.append(line)
        elif pair and nested is not None:
            nested[pair.group(2)] = _parse_scalar(pair.group(3))
    body = re.sub(r"^\r?\n", "", match.group(2)).rstrip()
    return data, extra, body


def _strings(value: Any) -> List[str]:
    if isinstance(value, list):
        return [s for s in (_js_str(v) for v in value) if s != ""]
    return [value] if isinstance(value, str) and value != "" else []


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return _js_str(value)
    return ""


def _remote(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    number = _js_number(value.get("number"))
    if not isinstance(number, int) or number <= 0:
        return None

    def field(key: str) -> str:
        v = value.get(key)
        return "" if v is None else _js_str(v)

    return {
        "provider": "gitlab" if value.get("provider") == "gitlab" else "github",
        "number": number,
        "url": field("url"),
        "updatedAt": field("updatedAt"),
        "syncedHash": field("syncedHash"),
    }


def parse_card(file: str, text: str) -> Optional[Dict[str, Any]]:
    """The card of a file's text, with the same keys and values the pane's ``parseCard`` gives; None when it is none."""
    parsed = parse_frontmatter(text)
    if parsed is None:
        return None
    data, extra, body = parsed
    in_name = re.match(r"(\d+)", file)
    raw_id = data.get("id")
    card_id = _js_str(raw_id) if raw_id is not None else (in_name.group(1) if in_name else "")
    if card_id == "":
        return None

    def string(key: str, default: str) -> str:
        v = data.get(key)
        return default if v is None else _js_str(v)

    kind = _text(data.get("kind"))
    return {
        "id": card_id,
        "file": file,
        "title": string("title", re.sub(r"\.md$", "", file)),
        "status": string("status", "backlog"),
        "order": _js_number(data.get("order")),
        "priority": data.get("priority") if data.get("priority") in ("low", "high") else "normal",
        "labels": _strings(data.get("labels")),
        "skills": _strings(data.get("skills")),
        "source": "claude" if data.get("source") == "claude" else "user",
        "created": string("created", ""),
        "updated": string("updated", ""),
        "kind": kind or TASK,
        "owner": _text(data.get("owner")),
        "needs": _text(data.get("needs")),
        "ref": _text(data.get("ref")),
        "epic": _text(data.get("epic")),
        "sprint": _text(data.get("sprint")),
        "body": body,
        "remote": _remote(data.get("remote")),
        "extra": extra,
    }


def serialize_card(card: Dict[str, Any]) -> str:
    """The card as its file, byte for byte what the pane's ``serializeCard`` writes."""
    lines = [
        "---",
        f"id: {_dumps(card['id'])}",
        f"title: {_dumps(card['title'])}",
        f"status: {card['status']}",
        f"order: {_js_str(card['order'])}",
        f"priority: {card['priority']}",
        f"labels: {_dumps(card['labels'])}",
        f"skills: {_dumps(card['skills'])}",
        f"source: {card['source']}",
        f"created: {card['created']}",
        f"updated: {card['updated']}",
    ]
    if card.get("kind") not in (TASK, "", None):
        lines.append(f"kind: {card['kind']}")
    for key in ("owner", "needs", "ref", "epic", "sprint"):
        if card.get(key):
            lines.append(f"{key}: {_dumps(card[key])}")
    remote = card.get("remote")
    if remote:
        lines += [
            "remote:",
            f"  provider: {remote['provider']}",
            f"  number: {_js_str(remote['number'])}",
            f"  url: {remote['url']}",
            f"  updatedAt: {remote['updatedAt']}",
            f"  syncedHash: {remote['syncedHash']}",
        ]
    lines += list(card.get("extra") or [])
    lines += ["---", ""]
    body = (card.get("body") or "").strip()
    if body:
        lines += [body, ""]
    return "\n".join(lines)


def new_card(card_id: str, title: str, status: str, order: int, now: str, **more: Any) -> Dict[str, Any]:
    card: Dict[str, Any] = {
        "id": card_id, "file": file_name(card_id, title), "title": title, "status": status, "order": order,
        "priority": "normal", "labels": [], "skills": [], "source": "user", "created": now, "updated": now,
        "kind": TASK, "owner": "", "needs": "", "ref": "", "epic": "", "sprint": "", "body": "", "remote": None,
        "extra": [],
    }
    card.update(more)
    return card


def is_gate(card: Dict[str, Any]) -> bool:
    return card.get("kind") == GATE


def is_epic(card: Dict[str, Any]) -> bool:
    return card.get("kind") == EPIC


# -------------------------------------------------------------------------------------------------------- the board

def _count(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _sprints(value: Any) -> List[Dict[str, Any]]:
    """The sprints of board.json as the pane reads them: no id, no sprint; only the first active one stays active."""
    out: List[Dict[str, Any]] = []
    has_active = False
    for one in value if isinstance(value, list) else []:
        if not isinstance(one, dict) or not isinstance(one.get("id"), str) or one["id"] == "":
            continue
        state = one.get("state") if one.get("state") in ("active", "closed") else "planned"
        if state == "active" and has_active:
            state = "planned"
        has_active = has_active or state == "active"
        closed = one.get("closed")
        out.append({
            "id": one["id"],
            "title": one["title"] if isinstance(one.get("title"), str) and one["title"] != "" else one["id"],
            "goal": one["goal"] if isinstance(one.get("goal"), str) else "",
            "start": one["start"] if isinstance(one.get("start"), str) else "",
            "end": one["end"] if isinstance(one.get("end"), str) else "",
            "state": state,
            "closed": {"at": closed["at"] if isinstance(closed.get("at"), str) else "",
                       "done": _count(closed.get("done")), "rolled": _count(closed.get("rolled"))}
            if isinstance(closed, dict) else None,
        })
    return out


def parse_config(text: Optional[str]) -> Dict[str, Any]:
    """``board.json`` as the pane reads it: its columns, else the four default ones, and its sprints."""
    fallback = {"columns": [dict(c) for c in DEFAULT_COLUMNS], "startMode": "new-session", "remote": {"enabled": False},
                "sprints": []}
    try:
        raw = json.loads(text or "")
    except ValueError:
        return fallback
    if not isinstance(raw, dict):
        return fallback
    columns = []
    for one in raw.get("columns") if isinstance(raw.get("columns"), list) else []:
        if not isinstance(one, dict) or not isinstance(one.get("id"), str) or one["id"] == "":
            continue
        role = one.get("role") if one.get("role") in ("start", "done") else None
        columns.append({"id": one["id"], "title": one["title"] if isinstance(one.get("title"), str) else one["id"],
                        "role": role})
    remote = raw.get("remote") if isinstance(raw.get("remote"), dict) else {}
    return {
        "columns": columns or fallback["columns"],
        "startMode": raw.get("startMode") if raw.get("startMode") in ("queue", "new-session") else "new-session",
        "remote": {"enabled": remote.get("enabled") is True},
        "sprints": _sprints(raw.get("sprints")),
    }


def serialize_config(config: Dict[str, Any]) -> str:
    """board.json byte for byte as the pane's ``serializeConfig`` writes it: ``sprints`` only once there is one."""
    out = {key: config[key] for key in ("columns", "startMode", "remote")}
    if config.get("sprints"):
        out["sprints"] = config["sprints"]
    return json.dumps(out, ensure_ascii=False, indent=2) + "\n"


def resolve(start: common.Pathish = None) -> Tuple[Path, bool, Path]:
    """(the kanban folder, whether it is the old ``.agents/board``, the root it hangs from).

    The root is the MAIN working tree, so every worktree works one board; outside a repository, the project root.
    The folder is ``paths.kanban`` of the config; the old folder is honoured while the new one does not exist.
    """
    root = common.main_root(start) or common.project_root(start)
    cfg = common.load_config(start)
    folder = common.kanban_dir(cfg, root)
    is_old = folder == Path(root) / common.OLD_KANBAN_REL and common.config_path(cfg, root, "kanban") != folder
    return folder, is_old, Path(root)


def load(folder: Path) -> Dict[str, Any]:
    """The board on disk: {dir, config, cards, invalid}; ``invalid`` names the card-like files that are no card."""
    config = parse_config(common.read_text(folder / CONFIG_FILE))
    cards: List[Dict[str, Any]] = []
    invalid: List[str] = []
    names = sorted(p.name for p in folder.iterdir() if p.is_file() and p.name.endswith(".md")) if folder.is_dir() else []
    for name in names:
        text = _read(folder / name)
        card = parse_card(name, text) if text is not None else None
        if card is not None:
            cards.append(card)
        elif _CARD_NAME.match(name) or (text or "").startswith("---"):
            invalid.append(name)
    return {"dir": folder, "config": config, "cards": cards, "invalid": invalid}


def _read(path: Path) -> Optional[str]:
    # Bytes, not text mode: a card's line endings are the parser's business, and it accepts both.
    try:
        return path.read_bytes().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None


def column_ids(config: Dict[str, Any]) -> List[str]:
    return [c["id"] for c in config["columns"]]


def is_known_status(config: Dict[str, Any], status: str) -> bool:
    return status in (SUGGESTED, ARCHIVED) or status in column_ids(config)


def done_column(config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    done = [c for c in config["columns"] if c["role"] == "done"]
    return done[0] if done else (config["columns"][-1] if config["columns"] else None)


def _by_order(card: Dict[str, Any]) -> Tuple[float, str]:
    return (card["order"], card["id"])


def plan_move(cards: List[Dict[str, Any]], card_id: str, to: str) -> List[Dict[str, Any]]:
    """The cards a move to the end of lane ``to`` changes, with their new status and order (the lane renumbered)."""
    moved = next((c for c in cards if c["id"] == card_id), None)
    if moved is None:
        return []
    lane = sorted((c for c in cards if c["status"] == to and c["id"] != card_id), key=_by_order)
    lane.append(dict(moved, status=to))
    changed = []
    for order, card in enumerate(lane):
        before = next(c for c in cards if c["id"] == card["id"])
        if before["order"] != order or before["status"] != card["status"]:
            changed.append(dict(card, order=order))
    return changed


def _normalize(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def find_duplicate(board: Dict[str, Any], title: str, ref: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """An open card of the same title; with ``ref``, a gate owed for that same thing."""
    done = {c["id"] for c in board["config"]["columns"] if c["role"] == "done"}
    wanted = _normalize(title)
    for card in board["cards"]:
        if card["status"] == ARCHIVED or card["status"] in done or _normalize(card["title"]) != wanted:
            continue
        if ref is None or (is_gate(card) and card["ref"] == ref):
            return card
    return None


def card_line(card: Dict[str, Any]) -> str:
    owner = f" @{card['owner']}" if card["owner"] else ""
    owed = "; ".join(p for p in (f"for {card['ref']}" if card["ref"] else "",
                                 f"needs {card['needs']}" if card["needs"] else "",
                                 f"epic {card['epic']}" if card.get("epic") else "",
                                 f"sprint {card['sprint']}" if card.get("sprint") else "") if p)
    return f"{card['id']} [{card['status']}] {card['kind']}{owner}: {card['title']}" + (f" ({owed})" if owed else "")


# ----------------------------------------------------------------------------------------------- epics and sprints

def active_sprint(config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    return next((s for s in config.get("sprints") or [] if s["state"] == "active"), None)


def next_sprint_id(config: Dict[str, Any]) -> str:
    return f"s{max([_leading_int(s['id'][1:] if s['id'].startswith('s') else s['id']) for s in config.get('sprints') or []] + [0]) + 1}"


def default_scope(config: Dict[str, Any]) -> Dict[str, Any]:
    return {"kind": "sprint"} if active_sprint(config) else {"kind": "all"}


def in_scope(config: Dict[str, Any], card: Dict[str, Any], scope: Dict[str, Any]) -> bool:
    """The pane's ``inScope``: epics are in no lane, Suggested is in every scope, no active sprint is every card."""
    if is_epic(card):
        return False
    if card["status"] == SUGGESTED:
        return True
    kind = scope["kind"]
    if kind == "sprint":
        active = active_sprint(config)
        return active is None or card["sprint"] == active["id"]
    if kind == "backlog":
        return card["sprint"] == ""
    if kind == "epic":
        return card["epic"] == scope["id"]
    return True


def scope_label(config: Dict[str, Any], scope: Dict[str, Any]) -> str:
    if scope["kind"] == "sprint":
        active = active_sprint(config)
        return f"sprint {active['id']}" if active else "all"
    if scope["kind"] == "epic":
        return f"epic {scope['id']}"
    return scope["kind"]


def parse_scope(text: str, board: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """``sprint``, ``backlog``, ``all`` or an epic's id; empty is the board's default; None names nothing."""
    wanted = (text or "").strip().lower()
    if wanted == "":
        return default_scope(board["config"])
    if wanted in ("sprint", "backlog", "all"):
        return {"kind": wanted}
    epic = next((c for c in board["cards"] if is_epic(c) and c["id"] in (wanted, wanted.rjust(4, "0"))), None)
    return {"kind": "epic", "id": epic["id"]} if epic else None


def done_ids(config: Dict[str, Any]) -> set:
    return {c["id"] for c in config["columns"] if c["role"] == "done"}


def epic_progress(board: Dict[str, Any], epic_id: str) -> Tuple[int, int]:
    """(done, total) of an epic's cards; an archived card counts as finished."""
    done = done_ids(board["config"])
    children = [c for c in board["cards"] if c["epic"] == epic_id and not is_epic(c) and c["status"] != SUGGESTED]
    return sum(1 for c in children if c["status"] == ARCHIVED or c["status"] in done), len(children)


def open_epics(board: Dict[str, Any]) -> List[Dict[str, Any]]:
    done = done_ids(board["config"])
    return sorted((c for c in board["cards"] if is_epic(c) and c["status"] != ARCHIVED and c["status"] not in done),
                  key=_by_order)


def progress_bar(done: int, total: int, width: int = 8) -> str:
    filled = 0 if total == 0 else int(done / total * width + 0.5)  # Math.round, for the halves a count can make
    return f"{'▰' * filled}{'▱' * (width - filled)} {done}/{total}"


def sprint_line(sprint: Dict[str, Any]) -> str:
    when = f", ends {sprint['end']}" if sprint["end"] else ""
    goal = f": {sprint['goal']}" if sprint["goal"] else ""
    return f'Sprint {sprint["id"]} "{sprint["title"]}" ({sprint["state"]}{when}){goal}'


def listing(board: Dict[str, Any], scope: Dict[str, Any], kind: Optional[str] = None) -> List[str]:
    """The pane's ``listing``: columns, active sprint, open epics, the scope's cards, and how many it left out."""
    config = board["config"]
    order = [SUGGESTED, *column_ids(config)]
    rank = {cid: i for i, cid in enumerate(order)}
    open_cards = [c for c in board["cards"] if c["status"] != ARCHIVED and not is_epic(c)]
    shown = sorted((c for c in open_cards if in_scope(config, c, scope) and (kind is None or c["kind"] == kind)),
                   key=lambda c: (rank.get(c["status"], len(order)), c["order"], c["id"]))
    active = active_sprint(config)
    hidden = len([c for c in open_cards if kind is None or c["kind"] == kind]) - len(shown)
    label = scope_label(config, scope)
    lines = [f"Columns: {', '.join(column_ids(config))} (plus {SUGGESTED})"]
    if active:
        lines.append(sprint_line(active))
    lines += [f"Epic {e['id']} {progress_bar(*epic_progress(board, e['id']))}: {e['title']}" for e in open_epics(board)]
    if label != "all":
        lines.append(f"Scope: {label}")
    lines += [card_line(c) for c in shown]
    if not shown:
        lines.append("No cards in this scope.")
    if hidden > 0:
        lines.append(f'{hidden} more open card(s) outside this scope (scope "all" lists them).')
    return lines


def plan_sprint_close(board: Dict[str, Any], sprint_id: str, now: str
                      ) -> Optional[Tuple[List[Dict[str, Any]], Dict[str, Any], Optional[Dict[str, Any]]]]:
    """The pane's ``planSprintClose``: (changed cards, new config, the sprint the rest rolls to); None if not open."""
    config = board["config"]
    sprint = next((s for s in config["sprints"] if s["id"] == sprint_id), None)
    if sprint is None or sprint["state"] == "closed":
        return None
    done = done_ids(config)
    nxt = next((s for s in config["sprints"] if s["id"] != sprint_id and s["state"] == "planned"), None)
    cards = [dict(c, status=ARCHIVED) if c["status"] in done else dict(c, sprint=nxt["id"] if nxt else "")
             for c in board["cards"] if c["sprint"] == sprint_id and c["status"] != ARCHIVED]
    archived = sum(1 for c in cards if c["status"] == ARCHIVED)
    closed = {"at": now, "done": archived, "rolled": len(cards) - archived}
    sprints = [dict(s, state="closed", closed=closed) if s["id"] == sprint_id else s for s in config["sprints"]]
    return cards, dict(config, sprints=sprints), nxt


def find_card(cards: List[Dict[str, Any]], card_id: str) -> Optional[Dict[str, Any]]:
    wanted = card_id.strip()
    return next((c for c in cards if c["id"] in (wanted, wanted.rjust(4, "0"))), None)


def now_iso() -> str:
    """UTC with milliseconds, as the pane stamps cards (``toISOString``): the sync compares these as text."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


# ---------------------------------------------------------------------------------------------------------- writes

class _Lock:
    """One writer at a time in a kanban folder, so two agents never allocate the same id. Held for milliseconds."""

    def __init__(self, folder: Path):
        self.path = folder / LOCK_FILE

    def __enter__(self) -> "_Lock":
        for _ in range(200):
            if common.exclusive_create(self.path, str(os.getpid())):
                return self
            try:
                if time.time() - self.path.stat().st_mtime > 10:
                    self.path.unlink()  # left by a writer that died
                    continue
            except OSError:
                pass
            time.sleep(0.025)
        raise common.AwError(f"the kanban folder is locked by another writer ({self.path.name})")

    def __exit__(self, *exc: Any) -> None:
        try:
            self.path.unlink()
        except OSError:
            pass


def write_cards(folder: Path, cards: List[Dict[str, Any]], stamp: Optional[str] = None) -> None:
    stamp = stamp or now_iso()
    for card in cards:
        common.atomic_write(folder / card["file"], serialize_card(dict(card, updated=stamp)))


def write_config(folder: Path, config: Dict[str, Any]) -> None:
    common.atomic_write(folder / CONFIG_FILE, serialize_config(config))


def add_card(folder: Path, title: str, status: Optional[str] = None, **more: Any) -> Dict[str, Any]:
    """Allocate the next id and write the card at the end of its lane (the first column unless ``status``)."""
    folder.mkdir(parents=True, exist_ok=True)
    with _Lock(folder):
        board = load(folder)
        lane = status or (column_ids(board["config"]) or ["backlog"])[0]
        order = max([c["order"] + 1 for c in board["cards"] if c["status"] == lane] + [0])
        now = now_iso()
        card = new_card(next_id(board["cards"]), title, lane, order, now, **more)
        common.atomic_write(folder / card["file"], serialize_card(card))
    return card


def move_card(folder: Path, card_id: str, status: str) -> Dict[str, Any]:
    with _Lock(folder):
        board = load(folder)
        card = find_card(board["cards"], card_id)
        if card is None:
            raise common.AwError(f'no card with id "{card_id}" (aw kanban list shows the ids)')
        if not is_known_status(board["config"], status):
            raise common.AwError(
                f'no column "{status}": the columns are {", ".join(column_ids(board["config"]))} '
                f"(plus {SUGGESTED} and {ARCHIVED})")
        write_cards(folder, plan_move(board["cards"], card["id"], status))
        return dict(card, status=status)


def _epic_of(board: Dict[str, Any], epic_id: str) -> Dict[str, Any]:
    epic = find_card(board["cards"], epic_id)
    if epic is None or not is_epic(epic):
        raise common.AwError(f'"{epic_id}" is no epic (aw kanban epics lists them)')
    return epic


def _sprint_of(config: Dict[str, Any], sprint_id: str) -> Dict[str, Any]:
    """An open sprint by id, or ``active`` for the active one."""
    if sprint_id == "active":
        active = active_sprint(config)
        if active is None:
            raise common.AwError("no sprint is active")
        return active
    sprint = next((s for s in config["sprints"] if s["id"] == sprint_id and s["state"] != "closed"), None)
    if sprint is None:
        open_ids = [s["id"] for s in config["sprints"] if s["state"] != "closed"]
        raise common.AwError(f'no open sprint "{sprint_id}" (open: {", ".join(open_ids) or "none"})')
    return sprint


def plan_card(folder: Path, card_id: str, epic: Optional[str], sprint: Optional[str]) -> Dict[str, Any]:
    """Puts a card in an epic and/or a sprint; ``none`` takes it out."""
    with _Lock(folder):
        board = load(folder)
        card = find_card(board["cards"], card_id)
        if card is None:
            raise common.AwError(f'no card with id "{card_id}" (aw kanban list shows the ids)')
        changed = dict(card)
        if epic is not None:
            changed["epic"] = "" if epic == "none" else _epic_of(board, epic)["id"]
            if changed["epic"] == card["id"]:
                raise common.AwError("an epic is not a card of its own")
        if sprint is not None:
            changed["sprint"] = "" if sprint == "none" else _sprint_of(board["config"], sprint)["id"]
        write_cards(folder, [changed])
        return changed


def add_sprint(folder: Path, title: str, goal: str = "", end: str = "") -> Dict[str, Any]:
    folder.mkdir(parents=True, exist_ok=True)
    with _Lock(folder):
        config = load(folder)["config"]
        sprint = {"id": next_sprint_id(config), "title": title, "goal": goal, "start": "", "end": end,
                  "state": "planned", "closed": None}
        write_config(folder, dict(config, sprints=[*config["sprints"], sprint]))
        return sprint


def start_sprint(folder: Path, sprint_id: str) -> Dict[str, Any]:
    with _Lock(folder):
        config = load(folder)["config"]
        sprint = next((s for s in config["sprints"] if s["id"] == sprint_id), None)
        if sprint is None:
            raise common.AwError(f'no sprint "{sprint_id}" (aw kanban sprint list shows them)')
        if sprint["state"] != "planned":
            raise common.AwError(f"sprint {sprint_id} is {sprint['state']}; only a planned sprint starts")
        active = active_sprint(config)
        if active is not None:
            raise common.AwError(f"sprint {active['id']} is still active: close it first")
        started = dict(sprint, state="active", start=sprint["start"] or now_iso()[:10])
        write_config(folder, dict(config, sprints=[started if s["id"] == sprint_id else s for s in config["sprints"]]))
        return started


def close_sprint(folder: Path, sprint_id: Optional[str]) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """Archives the sprint's done cards and rolls the rest on; (the closed sprint, the sprint they rolled to)."""
    with _Lock(folder):
        board = load(folder)
        if not sprint_id:
            active = active_sprint(board["config"])
            if active is None:
                raise common.AwError("no sprint is active: name the one to close")
            sprint_id = active["id"]
        stamp = now_iso()
        plan = plan_sprint_close(board, sprint_id, stamp)
        if plan is None:
            raise common.AwError(f'no open sprint "{sprint_id}"')
        cards, config, nxt = plan
        write_cards(folder, cards, stamp)
        write_config(folder, config)
        return next(s for s in config["sprints"] if s["id"] == sprint_id), nxt


def settle_gate(folder: Path, card_id: str, evidence: str, by: Optional[str] = None) -> Dict[str, Any]:
    with _Lock(folder):
        board = load(folder)
        card = find_card(board["cards"], card_id)
        if card is None:
            raise common.AwError(f'no card with id "{card_id}" (aw kanban list shows the ids)')
        if not is_gate(card):
            raise common.AwError(f"card {card['id']} is a {card['kind']}, not a gate: use aw kanban move")
        done = done_column(board["config"])
        if done is None:
            raise common.AwError("this board has no column to settle into")
        if card["status"] == done["id"]:
            raise common.AwError(f"gate {card['id']} is already settled")
        stamp = now_iso()
        note = f"Settled {stamp}{f' by {by}' if by else ''}: {evidence.strip()}"
        body = f"{card['body'].strip()}\n\n{note}".strip()
        changed = plan_move(board["cards"], card["id"], done["id"])
        if not any(c["id"] == card["id"] for c in changed):
            changed.append(card)
        write_cards(folder, [dict(c, body=body) if c["id"] == card["id"] else c for c in changed], stamp)
        return dict(card, status=done["id"], body=body)


# ------------------------------------------------------------------------------------------------------------ lint

def _age_days(stamp: str) -> Optional[float]:
    text = (stamp or "").strip()
    if not text:
        return None
    try:
        when = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith(("Z", "z")) else text)
    except ValueError:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text)
        if not m:
            return None
        try:
            when = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
        except ValueError:
            return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - when).total_seconds() / 86400.0


def _days(cfg: Dict[str, Any], key: str, default: int) -> float:
    try:
        return float((cfg.get("kanban") or {}).get(key, default))
    except (TypeError, ValueError, AttributeError):
        return float(default)


def _untracked(folder: Path, root: Path) -> bool:
    """Neither committed nor ignored: the board would be lost with the working tree, or committed by accident."""
    code, out = common.git(["ls-files", "--", str(folder)], cwd=root)
    if code != 0 or out.strip():
        return False
    code, _ = common.git(["check-ignore", "-q", str(folder)], cwd=root)
    return code == 1


def findings(start: common.Pathish = None) -> List[Finding]:
    """What lint and doctor report about the board. Never raises; an absent board has no findings."""
    out: List[Finding] = []
    try:
        folder, is_old, root = resolve(start)
        cfg = common.load_config(start)
    except Exception:
        return out
    if not folder.is_dir():
        return out
    where = common.rel(folder, root)
    if is_old:
        out.append(Finding("KANBAN_OLD_FOLDER", "warning", where, 0,
                           "the cards are still in .agents/board; move the folder to "
                           f"{common.rel(common.config_path(cfg, root, 'kanban'), root)} (aw setup does it)"))
    try:
        board = load(folder)
    except OSError as e:
        out.append(Finding("KANBAN_CARD_INVALID", "warning", where, 0, f"the folder cannot be read: {e}"))
        return out
    for name in board["invalid"]:
        out.append(Finding("KANBAN_CARD_INVALID", "warning", f"{where}/{name}", 0,
                           "not a card: no frontmatter block (--- … ---) or no id"))
    config = board["config"]
    seen: Dict[str, str] = {}
    start_ids = {c["id"] for c in config["columns"] if c["role"] == "start"}
    done_ids = {c["id"] for c in config["columns"] if c["role"] == "done"}
    epic_ids = {c["id"] for c in board["cards"] if is_epic(c)}
    sprint_ids = {s["id"] for s in config["sprints"]}
    active = active_sprint(config)
    if active is not None and active["end"]:
        age = _age_days(active["end"])
        if age is not None and age > 1:  # the end day itself still counts
            out.append(Finding("KANBAN_SPRINT_OVERDUE", "warning", f"{where}/{CONFIG_FILE}", 0,
                               f"sprint {active['id']} ended {active['end']} and is still active: close it "
                               "(aw kanban sprint close) or move its end"))
    stale_after = _days(cfg, "staleStartDays", STALE_START_DAYS)
    owed_after = _days(cfg, "gateOwedDays", GATE_OWED_DAYS)
    for card in board["cards"]:
        path = f"{where}/{card['file']}"
        problems = []
        if card["id"] in seen:
            problems.append(f"its id {card['id']} is also the id of {seen[card['id']]}")
        seen.setdefault(card["id"], card["file"])
        in_name = re.match(r"(\d+)-", card["file"])
        if in_name is None:
            problems.append("the file is not named <id>-<slug>.md")
        elif _leading_int(in_name.group(1)) != _leading_int(card["id"]) or not re.match(r"^\d+$", card["id"]):
            problems.append(f"the file name and the id ({card['id']}) disagree")
        if card["title"].strip() == "":
            problems.append("no title")
        if card["kind"] not in KINDS:
            problems.append(f'kind "{card["kind"]}" is not task, gate or epic')
        if is_gate(card) and not card["ref"]:
            problems.append("a gate without ref: what is it owed for?")
        for key in ("created", "updated"):
            if _age_days(card[key]) is None:
                problems.append(f"{key} is not a date")
        for problem in problems:
            out.append(Finding("KANBAN_CARD_INVALID", "warning", path, 0, problem))
        if card["epic"] and card["epic"] not in epic_ids:
            out.append(Finding("KANBAN_EPIC_UNKNOWN", "warning", path, 0,
                               f'epic "{card["epic"]}" is no epic card of this board'))
        if card["sprint"] and card["sprint"] not in sprint_ids:
            out.append(Finding("KANBAN_SPRINT_UNKNOWN", "warning", path, 0,
                               f'sprint "{card["sprint"]}" is no sprint of this board (aw kanban sprint list)'))
        if not is_known_status(config, card["status"]):
            out.append(Finding("KANBAN_STATUS_UNKNOWN", "warning", path, 0,
                               f'status "{card["status"]}" is no column of this board '
                               f'({", ".join(column_ids(config))}); the pane shows the card in the first'))
        if card["status"] in start_ids:
            age = _age_days(card["updated"])
            if age is not None and age > stale_after:
                out.append(Finding("KANBAN_STALE_START", "warning", path, 0,
                                   f"in {card['status']} and untouched for {int(age)} days: finish it, hand it "
                                   "back or move it out"))
        if is_gate(card) and card["status"] not in done_ids and card["status"] != ARCHIVED:
            age = _age_days(card["created"])
            if age is not None and age > owed_after:
                owed = f" for {card['ref']}" if card["ref"] else ""
                out.append(Finding("GATE_OWED_OLD", "warning", path, 0,
                                   f"owed{owed} for {int(age)} days"
                                   + (f"; needs {card['needs']}" if card["needs"] else "")))
    if _untracked(folder, root):
        out.append(Finding("KANBAN_UNTRACKED", "warning", where, 0,
                           "the kanban folder is neither committed nor ignored: commit it (a shared board) or "
                           "git-ignore it (a local board, or one synced with a tracker)"))
    return out


# -------------------------------------------------------------------------------------------------------- commands

def _body(args: argparse.Namespace) -> str:
    source = getattr(args, "from_file", None)
    if source:
        text = sys.stdin.read() if source == "-" else common.read_text(source)
        if text is None:
            raise common.AwError(f"cannot read {source}")
        return text.strip()
    return (getattr(args, "details", None) or "").strip()


def _list(text: Optional[str]) -> List[str]:
    return [part.strip() for part in (text or "").split(",") if part.strip()]


def _source(args: argparse.Namespace) -> str:
    given = getattr(args, "source", None)
    if given:
        return given
    return "claude" if common.agent_name() or os.environ.get("CLAUDECODE") else "user"


def card_json(card: Dict[str, Any]) -> Dict[str, Any]:
    return dict(card)


def cmd_list(args: argparse.Namespace) -> int:
    folder, is_old, _root = resolve()
    board = load(folder)
    # --status and --all look across the whole board; otherwise the listing is the scope's, as list_tasks gives it.
    scope = {"kind": "all"} if args.status or args.all else parse_scope(args.scope or "", board)
    if scope is None:
        raise common.AwError(f'no scope "{args.scope}": sprint, backlog, all, or an epic\'s card id')
    if not args.json and not args.status and not args.all:
        if not folder.is_dir():
            common.emit(f"No board yet: {common.posix(folder)} does not exist.")
            return 0
        common.emit("\n".join(listing(board, scope, args.kind)))
        return 0
    cards = sorted(board["cards"], key=lambda c: (c["status"], c["order"], c["id"]))
    if args.status:
        cards = [c for c in cards if c["status"] == args.status]
    elif not args.all:
        cards = [c for c in cards if c["status"] != ARCHIVED and (is_epic(c) or in_scope(board["config"], c, scope))]
    if args.kind:
        cards = [c for c in cards if c["kind"] == args.kind]
    order = {cid: i for i, cid in enumerate([SUGGESTED, *column_ids(board["config"])])}
    cards.sort(key=lambda c: (order.get(c["status"], len(order)), c["order"], c["id"]))
    if args.json:
        common.emit({"dir": common.posix(folder), "oldFolder": is_old, "columns": board["config"]["columns"],
                     "sprints": board["config"]["sprints"], "scope": scope_label(board["config"], scope),
                     "cards": [card_json(c) for c in cards]}, True)
        return 0
    lines = [f"Columns: {', '.join(column_ids(board['config']))} (plus {SUGGESTED})"]
    lines += [card_line(c) for c in cards]
    if not cards:
        lines.append("No cards." if folder.is_dir() else f"No board yet: {common.posix(folder)} does not exist.")
    common.emit("\n".join(lines))
    return 0


def cmd_add(args: argparse.Namespace) -> int:
    title = args.title.strip()
    if not title:
        raise common.AwError("a card needs a title")
    folder, _is_old, _root = resolve()
    board = load(folder)
    status = SUGGESTED if args.suggest else args.status
    if status and not is_known_status(board["config"], status):
        raise common.AwError(f'no column "{status}": the columns are {", ".join(column_ids(board["config"]))}')
    kind = args.kind or TASK
    epic = _epic_of(board, args.epic)["id"] if args.epic else ""
    sprint = _sprint_of(board["config"], args.sprint)["id"] if args.sprint else ""
    twin = find_duplicate(board, title, args.ref if kind == GATE else None)
    if twin is not None and not args.allow_duplicate:
        common.emit(f"Already on the kanban board as card {twin['id']} ({twin['status']}); nothing added.")
        return 1
    card = add_card(folder, title, status, kind=kind, priority=args.priority or "normal", labels=_list(args.labels),
                    skills=_list(args.skills), owner=(args.owner or "").strip(), ref=(args.ref or "").strip(),
                    needs=(args.needs or "").strip(), epic=epic, sprint=sprint, source=_source(args), body=_body(args))
    common.emit(card_json(card) if args.json else f"Added card {card['id']} [{card['status']}]: {card['title']}",
                args.json)
    return 0


def cmd_move(args: argparse.Namespace) -> int:
    folder, _is_old, _root = resolve()
    card = move_card(folder, args.id, args.status)
    common.emit(f"Card {card['id']} is now in {card['status']}.")
    return 0


def cmd_owe(args: argparse.Namespace) -> int:
    title, ref, needs = args.title.strip(), args.ref.strip(), args.needs.strip()
    if not title or not ref or not needs:
        raise common.AwError("a gate needs a title, what it is owed for (--ref) and what running it needs (--needs)")
    folder, _is_old, _root = resolve()
    board = load(folder)
    twin = find_duplicate(board, title, ref)
    if twin is not None:
        common.emit(f"Already owed as card {twin['id']} ({twin['status']}); nothing added.")
        return 1
    active = active_sprint(board["config"])  # an owed gate stays in view: it joins the sprint the board shows
    card = add_card(folder, title, None, kind=GATE, ref=ref, needs=needs, owner=(args.owner or "").strip(),
                    sprint=active["id"] if active else "", source=_source(args), body=_body(args))
    common.emit(card_json(card) if args.json else
                f"Owed as gate card {card['id']}: {card['title']} (for {ref}; needs {needs}). "
                f"Settle it with: aw kanban settle {card['id']} --evidence \"…\"", args.json)
    return 0


def cmd_settle(args: argparse.Namespace) -> int:
    evidence = (args.evidence or "").strip()
    if not evidence:
        raise common.AwError("a gate is settled with its evidence: the command that ran and what it showed")
    folder, _is_old, _root = resolve()
    card = settle_gate(folder, args.id, evidence, common.agent_name())
    common.emit(f"Gate {card['id']} is settled and in {card['status']}.")
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    if args.epic is None and args.sprint is None:
        raise common.AwError("nothing to change: give --epic or --sprint")
    folder, _is_old, _root = resolve()
    card = plan_card(folder, args.id, args.epic, args.sprint)
    common.emit(f"Card {card['id']}: epic {card['epic'] or 'none'}, sprint {card['sprint'] or 'none'}.")
    return 0


def cmd_epics(args: argparse.Namespace) -> int:
    folder, _is_old, _root = resolve()
    board = load(folder)
    epics = open_epics(board)
    if args.json:
        common.emit([dict(card_json(e), progress=dict(zip(("done", "total"), epic_progress(board, e["id"]))))
                     for e in epics], True)
        return 0
    lines = [f"{e['id']} {progress_bar(*epic_progress(board, e['id']))}: {e['title']}" for e in epics]
    common.emit("\n".join(lines) if lines else 'No open epics. Add one: aw kanban add "<goal>" --kind epic')
    return 0


def cmd_sprint(args: argparse.Namespace) -> int:
    folder, _is_old, _root = resolve()
    action = args.sprint_command
    if action == "new":
        title = args.title.strip()
        if not title:
            raise common.AwError("a sprint needs a title")
        sprint = add_sprint(folder, title, (args.goal or "").strip(), (args.end or "").strip())
        common.emit(f"Planned sprint {sprint['id']}: {sprint['title']}. Start it: aw kanban sprint start {sprint['id']}")
    elif action == "start":
        sprint = start_sprint(folder, args.id)
        common.emit(f"Sprint {sprint['id']} \"{sprint['title']}\" is active.")
    elif action == "close":
        sprint, nxt = close_sprint(folder, args.id)
        closed = sprint["closed"]
        common.emit(f"Sprint {sprint['id']} closed: {closed['done']} done card(s) archived, {closed['rolled']} "
                    f"unfinished card(s) to {'sprint ' + nxt['id'] if nxt else 'the backlog'}.")
    else:
        board = load(folder)
        if args.json:
            common.emit(board["config"]["sprints"], True)
            return 0
        lines = []
        for s in board["config"]["sprints"]:
            count = sum(1 for c in board["cards"] if c["sprint"] == s["id"] and c["status"] != ARCHIVED)
            lines.append(sprint_line(s) + (f" · {count} card(s)" if s["state"] != "closed" else
                                           f" · {s['closed']['done']} done, {s['closed']['rolled']} rolled on"
                                           if s["closed"] else ""))
        common.emit("\n".join(lines) if lines else 'No sprints. Plan one: aw kanban sprint new "<title>"')
    return 0


def cmd_lint(args: argparse.Namespace) -> int:
    return common.report(findings(), args.json, "kanban")  # the one findings document of every aw check


def _guarded(func: Any) -> Any:
    def run(args: argparse.Namespace) -> int:
        try:
            return func(args)
        except common.AwError as e:
            print(f"aw kanban: {e}", file=sys.stderr)
            return 2
    return run


def register(subparsers: Any) -> None:
    parser = subparsers.add_parser(
        "kanban", help="the task board: list, add, move, plan, epics, sprint, owe, settle, lint",
        description="The project's kanban board, for agents and scripts: the same cards the /kanban pane shows. "
                    "Cards live in the main working tree's kanban folder, so every worktree works one board.")
    sub = parser.add_subparsers(dest="kanban_command", metavar="<action>")

    p = sub.add_parser("list", help="the cards: id, column, kind, owner, title")
    p.add_argument("--json", action="store_true")
    p.add_argument("--status", help="only the cards of this column (or suggested, archived)")
    p.add_argument("--kind", help="only cards of this kind: task or gate")
    p.add_argument("--all", action="store_true", help="every card, archived ones too")
    p.add_argument("--scope", help="sprint (the active one, the default), backlog (no sprint), all, or an epic's id")
    p.set_defaults(func=_guarded(cmd_list))

    def details(p: argparse.ArgumentParser) -> None:
        p.add_argument("--details", help="the card's body, markdown")
        p.add_argument("--from-file", metavar="F", help="read the body from a file (- for stdin)")
        p.add_argument("--owner", help="who works it or can run it")
        p.add_argument("--source", choices=("user", "claude"),
                       help="who wrote the card (default: claude from an agent, else user)")
        p.add_argument("--json", action="store_true")

    p = sub.add_parser("add", help="add a card to the first column")
    p.add_argument("title")
    details(p)
    p.add_argument("--kind", choices=KINDS)
    p.add_argument("--priority", choices=PRIORITIES)
    p.add_argument("--labels", help="comma separated")
    p.add_argument("--skills", help="comma separated: skills the agent that takes the card should use")
    p.add_argument("--ref", help="what the card is for: a pull request, an issue, another card")
    p.add_argument("--needs", help="what doing it needs")
    p.add_argument("--status", help="the column to add it to (default: the first)")
    p.add_argument("--epic", help="the id of the epic card it belongs to")
    p.add_argument("--sprint", help="the sprint it is planned into: an id, or active")
    p.add_argument("--suggest", action="store_true", help="add it to the Suggested lane, for the owner to accept")
    p.add_argument("--allow-duplicate", action="store_true", help="add it although an open card has this title")
    p.set_defaults(func=_guarded(cmd_add))

    p = sub.add_parser("move", help="move a card to another column (starts nothing)")
    p.add_argument("id")
    p.add_argument("status", help="a column id, or suggested, or archived")
    p.set_defaults(func=_guarded(cmd_move))

    p = sub.add_parser("plan", help="put a card in an epic or a sprint (none takes it out)")
    p.add_argument("id")
    p.add_argument("--epic", help="an epic's card id, or none")
    p.add_argument("--sprint", help="a sprint id, active, or none")
    p.set_defaults(func=_guarded(cmd_plan))

    p = sub.add_parser("epics", help="the open epics with their progress")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_guarded(cmd_epics))

    p = sub.add_parser("sprint", help="plan, start and close sprints")
    p.set_defaults(func=_guarded(cmd_sprint), sprint_command="list", json=False)
    ssub = p.add_subparsers(dest="sprint_command", metavar="<list|new|start|close>")
    q = ssub.add_parser("list", help="the sprints")
    q.add_argument("--json", action="store_true")
    q = ssub.add_parser("new", help="plan a sprint")
    q.add_argument("title")
    q.add_argument("--goal", help="what the sprint is for, in a sentence")
    q.add_argument("--end", help="its last day, YYYY-MM-DD")
    q = ssub.add_parser("start", help="make a planned sprint the active one")
    q.add_argument("id")
    q = ssub.add_parser("close", help="archive its done cards, roll the rest to the next planned sprint or the backlog")
    q.add_argument("id", nargs="?")

    p = sub.add_parser("owe", help="record a gate that is owed: a check still to be run")
    p.add_argument("title")
    p.add_argument("--ref", required=True, help="what it is owed for: the pull request, issue or card")
    p.add_argument("--needs", required=True, help='what running it needs: "the main checkout", "a free GPU"')
    details(p)
    p.set_defaults(func=_guarded(cmd_owe))

    p = sub.add_parser("settle", help="settle an owed gate with its evidence; it moves to done")
    p.add_argument("id")
    p.add_argument("--evidence", required=True, help="the command that ran and what it showed")
    p.set_defaults(func=_guarded(cmd_settle))

    p = sub.add_parser("lint", help="check the cards (exit 0 clean, 1 warnings)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=_guarded(cmd_lint))

    parser.set_defaults(func=lambda _args: (parser.print_help(), 2)[1])
