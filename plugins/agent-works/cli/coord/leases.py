"""Leases: saying what you use of a shared resource, and how much, while you use it.

  aw lease RESOURCE [--share 0..1] [--mem 12GB] [--cpu N] --for "what" -- <command ...>
        the lease lives while the command runs and is gone when it exits, also after a failure
  aw lease RESOURCE [...] --for "what" --hold [--minutes N]
        a lease that stays until released, until its session ends, or for N minutes (default 120)
  aw lease --release ID
  aw leases [--resource R] [--json]

A lease is a declaration, not a lock and not enforcement: several agents may lease the same resource and the leases
add up. `aw sys` prints them beside the live readings and warns when they add up to more than there is (shares over
1, more memory than the device has). Need the resource alone? That is a lock: `aw lock run`.

The resource name is free: gpu, cpu, ram, disk, a port, a licence. `aw lease ... -- <command>` returns the command's
exit code (124 when --max-minutes killed it).
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import common, store

sys.dont_write_bytecode = True

_UNITS = {"": None, "k": 1024, "m": 1024 ** 2, "g": 1024 ** 3, "t": 1024 ** 4}


def path() -> Path:
    return store.home() / "resources.json"


def parse_mem(text: Any) -> int:
    """'12GB', '512 MB', '1.5g' -> bytes (binary units)."""
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)i?b?\s*$", str(text), re.I)
    unit = _UNITS.get(m.group(2).lower()) if m else None
    if not m or unit is None:
        raise store.CoordError(f"memory '{text}': a number and a unit, such as 12GB or 512MB")
    return int(float(m.group(1)) * unit)


def fmt_bytes(n: Any) -> str:
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "?"
    for unit, size in (("TB", 1024 ** 4), ("GB", 1024 ** 3), ("MB", 1024 ** 2)):
        if n >= size:
            return f"{n / size:.1f} {unit}"
    return f"{n / 1024:.0f} KB"


def _gone(lease: Dict[str, Any]) -> bool:
    until = store.parse_iso(lease.get("until")) if lease.get("until") else None
    if until is not None and time.time() > until:
        return True
    return lease.get("pid") is not None and not store.pid_alive(lease.get("pid"))


def _list(doc: Any) -> List[Dict[str, Any]]:
    rows = doc.get("leases") if isinstance(doc, dict) else None
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def live(prune: bool = True) -> List[Dict[str, Any]]:
    """The leases in force. Those whose process is gone or whose time is over are dropped from the store."""
    rows = _list(common.read_json(path(), {}))
    alive = [r for r in rows if not _gone(r)]
    if prune and len(alive) != len(rows):
        def change(doc: Dict[str, Any]) -> None:
            doc["leases"] = [r for r in _list(doc) if not _gone(r)]

        try:
            store.update_json(path(), {"leases": []}, change)
        except (OSError, store.CoordError):
            pass
    return alive


def add(resource: str, agent: str, project: str, why: str, pid: Optional[int], share: Optional[float] = None,
        mem: Optional[int] = None, cpu: Optional[float] = None, until: Optional[str] = None, hold: bool = False) -> Dict[str, Any]:
    lease = {"id": "ls-" + os.urandom(3).hex(), "resource": resource, "agent": agent, "project": project,
             "share": share, "mem": mem, "cpu": cpu, "for": why, "pid": pid, "since": store.now(), "until": until,
             "hold": hold}

    def change(doc: Dict[str, Any]) -> None:
        doc["leases"] = [r for r in _list(doc) if not _gone(r)] + [lease]

    store.update_json(path(), {"leases": []}, change)
    return lease


def remove(lease_id: str) -> Optional[Dict[str, Any]]:
    def change(doc: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        rows = _list(doc)
        hit = next((r for r in rows if r.get("id") == lease_id), None)
        doc["leases"] = [r for r in rows if r is not hit and not _gone(r)]
        return hit

    return store.update_json(path(), {"leases": []}, change)


def describe(lease: Dict[str, Any], known: Optional[Dict[str, Any]] = None, with_who: bool = True,
             with_id: bool = True) -> str:
    parts = [str(lease.get("resource"))]
    if lease.get("share") is not None:
        parts.append(f"share {float(lease['share']):g}")
    if lease.get("mem") is not None:
        parts.append(fmt_bytes(lease["mem"]))
    if lease.get("cpu") is not None:
        parts.append(f"{float(lease['cpu']):g} cpu")
    text = " ".join(parts)
    if with_who:
        text += f"  {lease.get('agent')} ({store.project_name(lease.get('project'), known)})"
    text += f"  for {store.ago(store.age_seconds(lease.get('since')))}"
    if lease.get("until"):
        text += f", until {lease['until']}"
    return text + f': "{lease.get("for") or "?"}"' + (f"  [{lease.get('id')}]" if with_id else "")


def totals(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Per resource: how many leases, and what their shares, memory and processors add up to."""
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        t = out.setdefault(str(r.get("resource")), {"count": 0, "share": 0.0, "mem": 0, "cpu": 0.0})
        t["count"] += 1
        t["share"] = round(t["share"] + float(r.get("share") or 0), 4)
        t["mem"] += int(r.get("mem") or 0)
        t["cpu"] += float(r.get("cpu") or 0)
    return out


# ------------------------------------------------------------------------------------------------------- commands

def cmd_lease(a: Any) -> int:
    ctx = store.Context(a.agent)
    if a.release:
        hit = next((r for r in live() if r.get("id") == a.release), None)
        if hit is None:
            store.emit({"released": False, "id": a.release}, a.json, f"{a.release}: no such lease (already gone)")
            return 0
        if (hit.get("agent"), hit.get("project")) != (ctx.agent, ctx.project):
            store.emit({"released": False, "id": a.release, "agent": hit.get("agent"), "project": hit.get("project")}, a.json)
            print(f"{a.release}: held by {hit.get('agent')} ({store.project_name(hit.get('project'))}), not by "
                  f"{ctx.agent}: only its holder releases a lease", file=sys.stderr)
            return 1
        remove(a.release)
        store.emit({"released": True, "id": a.release}, a.json, f"{a.release}: released")
        return 0

    command = list(getattr(a, "command_line", None) or [])
    if not a.resource:
        raise store.CoordError("lease: name the resource (gpu, cpu, ram, ...), or --release ID")
    resource = store.check_name(a.resource, "resource name")
    if not a.why:
        raise store.CoordError('lease: say what it is for: --for "<what>"')
    if a.share is not None and not 0 <= a.share <= 1:
        raise store.CoordError(f"lease: --share {a.share:g}: a fraction of the resource, 0 to 1")
    if a.cpu is not None and a.cpu < 0:
        raise store.CoordError("lease: --cpu: a number of processors")
    if bool(command) == bool(a.hold):
        raise store.CoordError("lease: either -- <command> (the lease lives while it runs) or --hold (until released)")
    mem = parse_mem(a.mem) if a.mem else None
    ctx.stamp()
    others = [r for r in live() if r.get("resource") == resource]

    if a.hold:
        minutes = float(a.minutes if a.minutes is not None else store.setting(ctx.cfg, "holdMinutes"))
        lease = add(resource, ctx.agent, ctx.project, a.why, store.session_pid(), a.share, mem, a.cpu,
                    store.iso_at(time.time() + minutes * 60), True)
        store.emit({"lease": lease, "others": others}, a.json,
                   f"{lease['id']}: {describe(lease, with_who=False, with_id=False)}\nrelease it with: aw lease --release {lease['id']}")
        _say_others(others)
        return 0

    until = store.iso_at(time.time() + a.max_minutes * 60 + 60) if a.max_minutes else None
    lease = add(resource, ctx.agent, ctx.project, a.why, os.getpid(), a.share, mem, a.cpu, until, False)
    print(f"lease {lease['id']}: {describe(lease, with_who=False, with_id=False)}", file=sys.stderr, flush=True)
    _say_others(others)
    code = 1
    try:
        import signal

        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))  # a polite kill still reaches the finally below
        code, timed_out = store.run_child(command, {"AW_LEASE": lease["id"]}, a.max_minutes * 60 if a.max_minutes else None)
        if timed_out:
            print(f"lease {lease['id']}: the command ran into its {a.max_minutes:g} min limit: its process tree was killed",
                  file=sys.stderr)
    except OSError as e:
        print(f"lease {lease['id']}: could not start the command: {e}", file=sys.stderr)
        code = 127
    finally:
        try:
            remove(lease["id"])
        except (OSError, store.CoordError):
            pass  # its process is gone in a moment, and the next reader drops it
    print(f"lease {lease['id']}: released (exit {code})", file=sys.stderr)
    return code


def _say_others(others: List[Dict[str, Any]]) -> None:
    if not others:
        return
    known = store.projects()
    print(f"also on {others[0].get('resource')} right now:", file=sys.stderr)
    for r in others:
        print(f"  {describe(r, known)}", file=sys.stderr)
    sys.stderr.flush()


def cmd_leases(a: Any) -> int:
    rows = [r for r in live() if not a.resource or r.get("resource") == a.resource]
    rows.sort(key=lambda r: (str(r.get("resource")), str(r.get("since"))))
    known = store.projects()
    lines = [describe(r, known) for r in rows] or ["no leases"]
    for name, t in totals(rows).items():
        if t["count"] > 1:
            extra = (f" share {t['share']:g}" if t["share"] else "") + (f" {fmt_bytes(t['mem'])}" if t["mem"] else "") + (
                f" {t['cpu']:g} cpu" if t["cpu"] else "")
            lines.append(f"  {name}: {t['count']} leases add up to{extra or ' nothing stated'}")
    store.emit({"leases": rows, "totals": totals(rows)}, a.json, "\n".join(lines))
    return 0


def register(subparsers: Any) -> None:
    import argparse

    p = subparsers.add_parser("lease", help="declare shared use of a resource for the length of a command (or --hold)",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("resource", nargs="?")
    p.add_argument("--share", type=float, help="the fraction of the resource you expect to use, 0 to 1")
    p.add_argument("--mem", help="memory you expect to use on it, with a unit: 12GB, 512MB")
    p.add_argument("--cpu", type=float, help="processors you expect to keep busy")
    p.add_argument("--for", dest="why", help="what the use is")
    p.add_argument("--as", dest="agent", help="the agent's name (default: the agent variable, else session-<pid>)")
    p.add_argument("--hold", action="store_true", help="keep the lease after this command returns, until released")
    p.add_argument("--minutes", type=float, help="with --hold: how long the lease lasts at most (default 120)")
    p.add_argument("--max-minutes", type=float, help="with a command: kill its process tree after this long (exit 124)")
    p.add_argument("--release", metavar="ID", help="give a held lease back")
    p.add_argument("--json", action="store_true", help="print one JSON document (not with a command)")
    store.split_command(p)
    p.set_defaults(func=cmd_lease)

    p = subparsers.add_parser("leases", help="the leases in force on this machine")
    p.add_argument("--resource", help="only this resource")
    p.add_argument("--json", action="store_true", help="print one JSON document")
    p.set_defaults(func=cmd_leases)
