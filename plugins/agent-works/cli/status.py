"""aw status: where the project stands, derived from where the facts live. Nothing here is written by hand.

    aw status [--json] [--merges N]

  the board    the active sprint, the open epics with their progress, cards per column of the kanban folder, the
               open ones by title, and the gates still owed
  resources    locks held, leases in force and counters claimed, from the machine-wide store
  done         the last merges on this branch (git log), which is the project's record of what is finished
  status file  the status memory's place and size (its text is the goal and the current focus)

Each part is left out when its source is absent (no board, no coordination store, no git).
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import common


def board(root: Path) -> Optional[Dict[str, Any]]:
    """The kanban board, through cli/kanban.py when it is there, else by reading the cards' frontmatter."""
    try:
        import kanban

        folder, _old, _root = kanban.resolve(root)
        if not folder.is_dir():
            return None
        data = kanban.load(folder)
        columns = [{"id": c.get("id"), "title": c.get("title") or c.get("id")} for c in data["config"].get("columns") or []]
        done = kanban.done_column(data["config"])
        cards = [{"id": c.get("id"), "title": c.get("title"), "status": c.get("status"), "kind": c.get("kind") or "task",
                  "owner": c.get("owner") or "", "needs": c.get("needs") or "", "ref": c.get("ref") or "",
                  "priority": c.get("priority") or "", "updated": c.get("updated") or "",
                  "epic": c.get("epic") or "", "sprint": c.get("sprint") or ""} for c in data["cards"]]
        done_id = (done or {}).get("id")
        active = kanban.active_sprint(data["config"])
        sprint = dict(active, line=kanban.sprint_line(active)) if active else None
        epics = [{"id": e["id"], "title": e["title"], "done": d, "total": t, "bar": kanban.progress_bar(d, t)}
                 for e in kanban.open_epics(data) for d, t in [kanban.epic_progress(data, e["id"])]]
    except Exception:
        cfg = common.load_config(root)
        folder = common.kanban_dir(cfg, common.main_root(root) or root)
        if not folder.is_dir():
            return None
        doc = common.read_json(folder / "board.json", {}) or {}
        columns = [{"id": c.get("id"), "title": c.get("title") or c.get("id")} for c in doc.get("columns") or [] if isinstance(c, dict)]
        done_id = next((c.get("id") for c in doc.get("columns") or [] if isinstance(c, dict) and c.get("done")), "done")
        sprint, epics = None, []
        cards = []
        for p in sorted(folder.glob("*.md")):
            f, _ = common.parse_frontmatter(common.read_text(p, "") or "")
            if f and f.get("id") and f.get("status"):
                cards.append({"id": str(f["id"]), "title": str(f.get("title") or p.stem), "status": str(f["status"]),
                              "kind": str(f.get("kind") or "task"), "owner": str(f.get("owner") or ""),
                              "needs": str(f.get("needs") or ""), "ref": str(f.get("ref") or ""),
                              "priority": str(f.get("priority") or ""), "updated": str(f.get("updated") or ""),
                              "epic": str(f.get("epic") or ""), "sprint": str(f.get("sprint") or "")})
    known = [c["id"] for c in columns]
    for c in cards:
        if c["status"] not in known:
            known.append(c["status"])
            columns.append({"id": c["status"], "title": c["status"]})
    for col in columns:
        col["count"] = sum(1 for c in cards if c["status"] == col["id"])
    gates = [c for c in cards if c["kind"] == "gate" and c["status"] != done_id]
    return {"dir": common.posix(folder), "done": done_id, "columns": columns, "cards": cards, "gates": gates,
            "sprint": sprint, "epics": epics}


def coordination(root: Path) -> Optional[Dict[str, Any]]:
    """Locks, leases and claims of this project and the machine; None when the coordination modules are absent."""
    try:
        from coord import claims, leases, locks, store
    except Exception:
        return None
    out: Dict[str, Any] = {"locks": [], "leases": [], "claims": []}
    project = common.project_id(root)
    try:
        for row in locks.all_locks():
            if row.get("held") and row.get("scope") in ("machine", project):
                out["locks"].append({k: row.get(k) for k in ("resource", "scope", "agent", "project", "for", "since") if row.get(k) is not None})
    except Exception:
        pass
    try:
        out["leases"] = [{k: l.get(k) for k in ("resource", "agent", "project", "share", "mem", "for", "since") if l.get(k) is not None}
                         for l in leases.live(prune=False)]
    except Exception:
        pass
    try:
        for name, counter in sorted(claims.read(project).items()):
            for c in counter.get("claims") or []:
                out["claims"].append({"counter": name, **{k: c.get(k) for k in ("agent", "value", "for", "since") if c.get(k) is not None}})
    except Exception:
        pass
    del store
    return out


def merges(root: Path, n: int = 20) -> Optional[Dict[str, Any]]:
    """The last merges on this branch; a history without merge commits (squash, rebase) gives its last commits."""
    fmt = "--pretty=format:%h%x09%ad%x09%s"
    code, out = common.git(["log", "--merges", "--first-parent", f"-{n}", "--date=short", fmt], root)
    if code != 0:
        return None
    kind = "merges"
    if not out.strip():
        code, out = common.git(["log", "--first-parent", f"-{n}", "--date=short", fmt], root)
        kind = "commits"
    rows = []
    for line in out.splitlines():
        parts = line.split("\t", 2)
        if len(parts) == 3:
            rows.append({"commit": parts[0], "date": parts[1], "subject": parts[2]})
    return {"kind": kind, "rows": rows}


def status_file(root: Path, cfg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    try:
        import memory

        for e in memory.scan(root, cfg)["memories"]:
            if (e["fields"] or {}).get("type") == "status":
                return {"path": e["rel"], "lines": e["lines"], "budget": common.budget(cfg, "statusLines"),
                        "updated": str((e["fields"] or {}).get("updated") or "")}
    except Exception:
        pass
    return None


def collect(root: Path, n: int = 20) -> Dict[str, Any]:
    cfg = common.load_config(root)
    return {"project": common.project_id(root), "root": common.posix(root), "branch": common.current_branch(root),
            "statusFile": status_file(root, cfg), "board": board(root), "coordination": coordination(root),
            "done": merges(root, n)}


def text_of(doc: Dict[str, Any]) -> str:
    lines = [f"{doc['project']}   branch {doc['branch'] or '(detached)'}"]
    s = doc["statusFile"]
    if s:
        lines.append(f"status file: {s['path']} ({s['lines']}/{s['budget']} lines, updated {s['updated'] or '?'})")
    b = doc["board"]
    lines.append("")
    if b:
        lines.append("board: " + ", ".join(f"{c['title']} {c['count']}" for c in b["columns"]))
        sprint = b.get("sprint")
        if sprint:
            lines.append(sprint["line"])
        for e in b.get("epics") or []:
            lines.append(f"  epic {e['id']} {e['bar']}: {e['title']}")
        for col in b["columns"]:
            if col["id"] == b["done"]:
                continue
            # With a sprint active, the cards listed are the sprint's: the rest wait in the backlog.
            for c in [c for c in b["cards"] if c["status"] == col["id"] and c["kind"] not in ("gate", "epic")
                      and (not sprint or c["sprint"] == sprint["id"] or c["status"] == "suggested")][:12]:
                lines.append(f"  [{col['title']}] {c['id']} {c['title']}" + (f"  ({c['owner']})" if c["owner"] else ""))
        if b["gates"]:
            lines.append(f"gates owed: {len(b['gates'])}")
            for g in b["gates"]:
                more = "; ".join(x for x in (f"for {g['ref']}" if g["ref"] else "", f"needs {g['needs']}" if g["needs"] else "") if x)
                lines.append(f"  {g['id']} {g['title']}" + (f"  ({more})" if more else ""))
        else:
            lines.append("gates owed: none")
    else:
        lines.append("board: none here")
    c = doc["coordination"]
    if c:
        lines.append("")
        lines.append("locks: " + (", ".join(f"{l['resource']} held by {l.get('agent')}" + (f" ({l['for']})" if l.get("for") else "")
                                            for l in c["locks"]) or "none held"))
        lines.append("leases: " + (", ".join(f"{l['resource']} by {l.get('agent')}" for l in c["leases"]) or "none"))
        lines.append("claims: " + (", ".join(f"{x['counter']}" + (f"={x['value']}" if x.get("value") is not None else "") + f" by {x.get('agent')}"
                                             for x in c["claims"]) or "none"))
    d = doc["done"]
    if d:
        lines.append("")
        lines.append(f"done (the last {len(d['rows'])} {d['kind']} on this branch):")
        lines += [f"  {r['date']} {r['commit']} {re.sub(r'\\s+', ' ', r['subject'])[:110]}" for r in d["rows"]]
    return "\n".join(lines)


def run(args: argparse.Namespace) -> int:
    doc = collect(common.project_root(), args.merges)
    common.emit(doc, args.json, None if args.json else text_of(doc))
    return 0


def register(subparsers: Any) -> None:
    p = subparsers.add_parser("status", help="derived status: the board, owed gates, locks, claims, recent merges",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--json", action="store_true")
    p.add_argument("--merges", type=int, default=20, metavar="N", help="how many merges to list (default 20)")
    p.set_defaults(func=run)
