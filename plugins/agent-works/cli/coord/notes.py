"""Short notes between agents: what you merged that others must pull, what you wait for, what you left running.

  aw note "<text>" [--machine] [--as AGENT]
        one line on this project's notes log (--machine: on the machine's, read by every project)
  aw notes [N] [--project P | --all | --machine] [--json]
        the last N notes (default 30) of this project; of project P (its id, its folder name, or a prefix);
        of every project and the machine together; or of the machine alone

A note is one line: budgets.noteChars (200) at most, and a longer one is refused. Detail belongs in a kanban card,
a memory or a file, with the note pointing at it. Logs rotate (one older generation is kept), so a note is not a
record: what must last goes in the project's memory.
"""
from __future__ import annotations

import sys
from typing import Any, Dict, List, Optional, Tuple

from . import common, store

sys.dont_write_bytecode = True


def _rows(project: Optional[str], tag: str) -> List[Dict[str, Any]]:
    rows = []
    for line in store.log_lines(store.note_path(project)):
        stamp, _, rest = line.partition("  ")
        who, _, text = rest.partition("  ")
        rows.append({"at": stamp, "project": project, "where": tag, "agent": who, "text": text})
    return rows


def read(ctx: store.Context, project: Optional[str] = None, everything: bool = False, machine: bool = False) -> List[Dict[str, Any]]:
    known = store.projects()
    if machine:
        return _rows(None, "machine")
    if everything:
        ids = set(known)
        try:
            ids |= {p.name for p in (store.home() / "projects").iterdir() if p.is_dir()}
        except OSError:
            pass
        rows = _rows(None, "machine")
        for pid in sorted(ids):
            rows += _rows(pid, store.project_name(pid, known))
        return sorted(rows, key=lambda r: r["at"])  # ISO stamps sort as text
    if project:
        hits = store.find_project(project)
        if len(hits) != 1:
            raise store.CoordError(f"notes: project '{project}': " + (f"several match ({', '.join(hits)})" if hits else
                                   "none seen on this machine (aw who lists the projects with agents; --all reads every log)"))
        return _rows(hits[0], store.project_name(hits[0], known))
    return _rows(ctx.project, ctx.name)


def cmd_note(a: Any) -> int:
    ctx = store.Context(a.agent)
    text = " ".join(str(a.text).split())
    limit = common.budget(ctx.cfg, "noteChars")
    if not text:
        raise store.CoordError('note: say something: aw note "<text>"')
    if len(text) > limit:
        raise store.CoordError(f"note: {len(text)} characters, and a note is one line of at most {limit} "
                               f"(budgets.noteChars). Put the detail in a kanban card, a memory or a file and point at it.")
    ctx.stamp()
    rotate_at = store.setting(ctx.cfg, "logBytes")
    if a.machine:
        line = store.append_note(None, f"{ctx.agent}@{ctx.name}", text, rotate_at)
    else:
        line = store.append_note(ctx.project, ctx.agent, text, rotate_at)
    store.emit({"line": line, "where": "machine" if a.machine else ctx.project}, a.json, line)
    return 0


def cmd_notes(a: Any) -> int:
    ctx = store.Context()
    rows = read(ctx, a.project, a.all, a.machine)
    rows = rows[-a.n:] if a.n > 0 else []
    mixed = a.all
    lines = [f"{r['at']}  " + (f"[{r['where']}]  " if mixed else "") + f"{r['agent']}  {r['text']}" for r in rows]
    store.emit({"notes": rows}, a.json, "\n".join(lines) if lines else "(no notes)")
    return 0


def register(subparsers: Any) -> None:
    import argparse

    p = subparsers.add_parser("note", help="one line to the other agents of this project (or of the machine)",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("text")
    p.add_argument("--machine", action="store_true", help="write on the machine's log, read by every project")
    p.add_argument("--as", dest="agent", help="the agent's name (default: the agent variable, else session-<pid>)")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_note)

    p = subparsers.add_parser("notes", help="the last notes of this project, another, all of them, or the machine",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("n", nargs="?", type=int, default=30)
    which = p.add_mutually_exclusive_group()
    which.add_argument("--project", help="a project's id, folder name, or a prefix of either")
    which.add_argument("--all", action="store_true", help="every project's notes and the machine's, by time")
    which.add_argument("--machine", action="store_true", help="the machine's notes")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_notes)
