"""Who is running on this machine: agents across projects, with the locks and leases they hold.

  aw who [--json]                         running agents by project, with their locks and leases
  aw agent start [--name N] [--pid P] [--session ID]     register (the SessionStart hook does this)
  aw agent beat  [--name N] [--pid P]     say "still here" (registers when not yet known)
  aw agent stop  [--name N] [--pid P]     leave

An agent is its name (``--name``, else the agent variable, else session-<pid>) in a project, living in a process:
the session's (``--pid``, else ``AW_SESSION_PID``, else ``CLAUDE_PID``, which Claude Code sets for the shells and
hooks it starts, else the nearest ancestor that is not a shell). An entry whose process is gone is dropped by whoever
reads next; an entry without a process id is dropped after coordination.agentStaleMinutes (120) without a beat.
Holders of locks and leases that never registered are listed
too, marked as such.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import common, store

sys.dont_write_bytecode = True


def path() -> Path:
    return store.home() / "agents.jsonl"


def _parse(text: Optional[str]) -> List[Dict[str, Any]]:
    rows = []
    for line in (text or "").splitlines():
        try:
            doc = json.loads(line)
        except ValueError:
            continue
        if isinstance(doc, dict) and doc.get("name"):
            rows.append(doc)
    return rows


def _gone(entry: Dict[str, Any], stale_minutes: float) -> bool:
    if entry.get("pid"):
        return not store.pid_alive(entry.get("pid"))
    return store.age_seconds(entry.get("beat")) > stale_minutes * 60


def _rewrite(change: Callable[[List[Dict[str, Any]]], Any], stale_minutes: float) -> Any:
    p = path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with store.FileLock(p):
        rows = [r for r in _parse(common.read_text(p)) if not _gone(r, stale_minutes)]
        result = change(rows)
        store.write(p, "".join(json.dumps(r) + "\n" for r in rows))
        return result


def live(cfg: Optional[Dict[str, Any]] = None, prune: bool = True) -> List[Dict[str, Any]]:
    """The agents running now. Entries whose process is gone are dropped from the store."""
    stale = store.setting(cfg, "agentStaleMinutes")
    rows = _parse(common.read_text(path()))
    alive = [r for r in rows if not _gone(r, stale)]
    if prune and len(alive) != len(rows):
        try:
            _rewrite(lambda _rows: None, stale)
        except (OSError, store.CoordError):
            pass
    return alive


def _find(rows: List[Dict[str, Any]], name: str, project: str, pid: Optional[int]) -> Optional[Dict[str, Any]]:
    mine = [r for r in rows if r.get("name") == name and r.get("project") == project]
    exact = [r for r in mine if pid is not None and r.get("pid") == pid]
    return exact[0] if exact else (mine[0] if len(mine) == 1 and pid is None else None)


def start(ctx: store.Context, pid: Optional[int] = None, session: Optional[str] = None,
          worktree: Optional[str] = None) -> Dict[str, Any]:
    pid = int(pid) if pid else store.session_pid()
    name, stamp = ctx.agent, store.now()
    tree = worktree or common.posix(common.repo_root(ctx.start) or ctx.root)

    def change(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        entry = _find(rows, name, ctx.project, pid)
        if entry is None:
            entry = {"id": f"{name}@{ctx.project}#{pid}", "name": name, "project": ctx.project,
                     "root": common.posix(ctx.root), "worktree": tree, "pid": pid, "session": session,
                     "started": stamp, "beat": stamp}
            rows.append(entry)
        else:
            entry.update(beat=stamp, worktree=tree, **({"session": session} if session else {}))
        return entry

    ctx.stamp()
    return _rewrite(change, store.setting(ctx.cfg, "agentStaleMinutes"))


def stop(ctx: store.Context, pid: Optional[int] = None) -> bool:
    name = ctx.agent
    pid = int(pid) if pid else None

    def change(rows: List[Dict[str, Any]]) -> bool:
        entry = _find(rows, name, ctx.project, pid) or _find(rows, name, ctx.project, store.session_pid() if pid is None else pid)
        if entry is None:
            return False
        rows.remove(entry)
        return True

    return bool(_rewrite(change, store.setting(ctx.cfg, "agentStaleMinutes")))


def overview(cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Agents, with the locks and leases each holds; holders that never registered are added, marked."""
    from . import leases, locks

    known = store.projects()
    rows = [{**r, "registered": True, "locks": [], "leases": []} for r in live(cfg)]

    def owner(agent: Any, project: Any) -> Dict[str, Any]:
        for r in rows:
            if r.get("name") == agent and r.get("project") == project:
                return r
        entry = {"id": f"{agent}@{project}", "name": agent, "project": project, "registered": False, "locks": [], "leases": []}
        rows.append(entry)
        return entry

    all_locks = [r for r in locks.all_locks() if r.get("held")]
    all_leases = leases.live()
    for lk in all_locks:
        owner(lk.get("agent"), lk.get("project"))["locks"].append(lk)
    for ls in all_leases:
        owner(ls.get("agent"), ls.get("project"))["leases"].append(ls)
    ids = sorted({str(r.get("project")) for r in rows if r.get("project")})
    return {"at": store.now(), "agents": rows, "locks": all_locks, "leases": all_leases,
            "projects": {p: {"name": store.project_name(p, known), "root": (known.get(p) or {}).get("root")} for p in ids}}


def text_of(doc: Dict[str, Any]) -> str:
    from . import leases

    if not doc["agents"]:
        return "nobody: no agent registered, no lock or lease held"
    lines: List[str] = []
    for project, info in sorted(doc["projects"].items(), key=lambda kv: kv[1]["name"].lower()) + [("None", {"name": "?", "root": None})]:
        mine = [r for r in doc["agents"] if str(r.get("project")) == project]
        if not mine:
            continue
        lines.append(f"{info['name']}" + (f"  ({info['root']})" if info.get("root") else ""))
        for r in sorted(mine, key=lambda r: str(r.get("name"))):
            if r.get("registered"):
                lines.append(f"  {r['name']}  pid {r.get('pid') or '?'}, up {store.ago(store.age_seconds(r.get('started')))}, "
                             f"last beat {store.ago(store.age_seconds(r.get('beat')))} ago"
                             + (f", in {r['worktree']}" if r.get("worktree") and r.get("worktree") != info.get("root") else ""))
            else:
                lines.append(f"  {r['name']}  (not registered: seen only through what it holds)")
            for lk in r["locks"]:
                where = "machine" if lk.get("scope") == store.MACHINE else "project"
                lines.append(f"      lock  {lk['resource']} [{where}] for {lk.get('heldMinutes', 0):g} min: \"{lk.get('for') or '?'}\"")
            for ls in r["leases"]:
                lines.append(f"      lease {leases.describe(ls, with_who=False)}")
    return "\n".join(lines)


# ------------------------------------------------------------------------------------------------------- commands

def cmd_who(a: Any) -> int:
    ctx = store.Context()
    doc = overview(ctx.cfg)
    store.emit(doc, a.json, text_of(doc))
    return 0


def cmd_agent(a: Any) -> int:
    ctx = store.Context(a.name)
    if a.action in ("start", "beat"):
        entry = start(ctx, a.pid, a.session)
        store.emit(entry, a.json, f"{entry['name']}: {'registered' if entry['started'] == entry['beat'] else 'still here'} "
                                  f"in {ctx.name} (pid {entry['pid']})")
        return 0
    gone = stop(ctx, a.pid)
    store.emit({"stopped": gone, "name": ctx.agent, "project": ctx.project}, a.json,
               f"{ctx.agent}: {'left' if gone else 'was not registered'}")
    return 0


def register(subparsers: Any) -> None:
    p = subparsers.add_parser("who", help="running agents across projects, with their locks and leases")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_who)

    p = subparsers.add_parser("agent", help="register, beat or leave: start | beat | stop", description=__doc__,
                              formatter_class=__import__("argparse").RawDescriptionHelpFormatter)
    p.add_argument("action", choices=["start", "beat", "stop"])
    p.add_argument("--name", help="the agent's name (default: the agent variable, else session-<pid>)")
    p.add_argument("--pid", type=int, help="the process the agent lives in (default: the session's)")
    p.add_argument("--session", help="the session's id, when the caller knows it")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_agent)
