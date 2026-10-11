"""Exclusive locks on scarce resources, across agents, worktrees and projects: one holder at a time, a fair queue.

The normal way, one command under one hold (queues, sets the agent variable for the command, kills its process tree
at the limit, and always releases, also after a failure):

  aw lock run RESOURCE --for "what, how long" [--as AGENT] [--max-minutes N] [--wait SECONDS] -- <command ...>

Several commands under one hold:

  aw lock acquire RESOURCE --for "what, how long" [--as AGENT] [--wait SECONDS] [--despite-running]
  <commands>
  aw lock release RESOURCE [--as AGENT]

  aw lock status [RESOURCE] [--all] [--json]      aw lock holder RESOURCE

Scopes. A resource whose config entry says "scope": "machine", and the built-in resources gpu and gpu-exclusive,
lock machine-wide: every project on this machine contends for the one lock. Any other resource locks under the
project (the repository and all its worktrees), so the same name in two projects is two locks. A resource the config
does not declare is locked for the project, ad hoc, with a warning.

Exit codes of acquire and run: 0 = held (run: the command's own exit code); 3 = STILL QUEUED after --wait seconds:
not a failure, the place in the queue is kept for 10 minutes, run the same command again (run prints STILL QUEUED and
does not start the command); 124 = run killed the command at its time limit; 2 = usage error. --wait defaults to
480 s, shorter than a tool's time limit on purpose.

Rules of use:
  - Hold a lock for the run only, never while thinking or editing.
  - Release also after a failure (`run` does it for you).
  - Needing two resources, take them in the order "lockOrder" lists them, so two agents cannot each hold one and
    wait for the other (a warning says so when the order is broken).
  - First come, first served: waiters queue by the time they first asked. A waiter whose command died keeps its
    place for 10 minutes; one that has not polled for 45 s is passed over until it asks again.
  - A long hold must be refreshed: call acquire again with the same name (`run` refreshes by itself). A lock not
    refreshed for coordination.lockStaleMinutes (45) while none of the resource's processes runs is taken over, with
    a note; so is the lock of a `run` whose own process is gone.
  - While the resource's application runs without any lock (the owner's own instance, or a leftover), acquire waits.

Agent names: lower-case letters, digits and '-'. Default: the agent variable of the config (AW_AGENT), else
session-<pid>. A coordination aid between cooperating agents, not a security boundary.

The guard hook imports holder(), holds() and refresh() from here, so everything heavier than os/json is imported
inside the function that needs it.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import common, store

sys.dont_write_bytecode = True

BUILTIN_MACHINE = ("gpu", "gpu-exclusive")
LIVE_S = 45.0    # a waiter that polled within this is in line
KEEP_S = 600.0   # a waiter that stopped polling keeps its place this long
POLL_S = 5.0
DEFAULT_MAX_MINUTES = 30.0
QUEUED = 3  # not 1: a wrapped command's own exit code is most often 1


# ------------------------------------------------------------------------------------------- resources and scopes

def spec_of(resource: str, cfg: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    spec = ((cfg or {}).get("resources") or {}).get(resource)
    return spec if isinstance(spec, dict) else {}


def declared(resource: str, cfg: Optional[Dict[str, Any]]) -> bool:
    return resource in BUILTIN_MACHINE or resource in ((cfg or {}).get("resources") or {})


def is_machine(resource: str, cfg: Optional[Dict[str, Any]]) -> bool:
    return resource in BUILTIN_MACHINE or spec_of(resource, cfg).get("scope") == store.MACHINE


def scope_of(resource: str, cfg: Optional[Dict[str, Any]], start: Any = None, project: Optional[str] = None) -> str:
    """"machine", or the id of the project the resource is locked under."""
    if is_machine(resource, cfg):
        return store.MACHINE
    return project or common.project_id(start)


def scope_dir(scope: str) -> Path:
    return store.locks_root() / scope


def _me(agent: str, project: str, scope: str) -> Dict[str, str]:
    # In the machine scope two projects may each have an agent of the same name: the project is part of who it is.
    return {"agent": agent, "project": project, "scope": scope,
            "key": f"{agent}@{project}" if scope == store.MACHINE else agent}


def _key(doc: Dict[str, Any], scope: str) -> str:
    if scope == store.MACHINE and doc.get("project"):
        return f"{doc.get('agent')}@{doc.get('project')}"
    return str(doc.get("agent"))


def _mine(doc: Optional[Dict[str, Any]], me: Dict[str, str]) -> bool:
    return bool(doc) and _key(doc, me["scope"]) == me["key"]  # type: ignore[arg-type]


def _label(doc: Dict[str, Any], scope: str) -> str:
    if scope == store.MACHINE and doc.get("project"):
        return f"{doc.get('agent')} ({store.project_name(doc.get('project'))})"
    return str(doc.get("agent"))


# ------------------------------------------------------------------------------------------------- the lock file

def read_lock(d: Path, resource: str) -> Optional[Dict[str, Any]]:
    """The lock's record, or None when the resource is free.

    Reads the fields of older lock files as aliases: ``holder`` for ``agent``, ``what`` for ``for``.
    """
    path = d / f"{resource}.lock"
    for attempt in range(3):
        doc = common.read_json(path, None)
        if isinstance(doc, dict):
            if not doc.get("agent") and doc.get("holder"):
                doc["agent"] = doc["holder"]
            if doc.get("for") is None and doc.get("what") is not None:
                doc["for"] = doc["what"]
            if doc.get("agent"):
                doc.setdefault("resource", resource)
                return doc
        if not path.exists():
            return None
        time.sleep(0.01)  # caught while its holder replaced it: look again
    # Caught between its creation and its first write, or damaged: held all the same, if the file is there.
    try:
        stamp = store.iso_at(path.stat().st_mtime)
    except OSError:
        return None
    return {"resource": resource, "agent": "?", "for": "", "since": stamp, "refreshed": stamp}


def refresh_lock(d: Path, resource: str, doc: Dict[str, Any], why: Optional[str] = None) -> Dict[str, Any]:
    doc = {**doc, "refreshed": store.now(), **({"for": why} if why else {})}
    store.write(d / f"{resource}.lock", json.dumps(doc))
    return doc


def _is_stale(doc: Dict[str, Any], stale_minutes: float) -> bool:
    if store.age_seconds(doc.get("refreshed")) > stale_minutes * 60:
        return True
    # A `run` holds the lock in its own process: when that process is gone, nobody is left to release it.
    return bool(doc.get("run")) and doc.get("pid") is not None and not store.pid_alive(doc.get("pid"))


# ------------------------------------------------------------------------------------------------------ the queue

def take_ticket(d: Path, resource: str, key: str) -> None:
    """A ticket: its content is when the agent first asked (its place), its mtime the last poll (its being alive)."""
    q = d / f"{resource}.queue"
    q.mkdir(parents=True, exist_ok=True)
    try:
        with open(q / key, "x", encoding="utf-8") as f:
            f.write(repr(time.time()))
    except FileExistsError:
        try:
            os.utime(q / key)
        except OSError:
            pass
    except OSError:
        pass  # Windows: a ticket of this name is being deleted this instant; the next poll takes a new one


def drop_ticket(d: Path, resource: str, key: str) -> None:
    try:
        (d / f"{resource}.queue" / key).unlink()
    except OSError:
        pass


def queue(d: Path, resource: str, live_s: float = LIVE_S, keep_s: float = KEEP_S) -> List[Dict[str, Any]]:
    """The waiters, first asked first; tickets nobody polled for keep_s are thrown away."""
    rows = []
    try:
        entries = list((d / f"{resource}.queue").iterdir())
    except OSError:
        return []
    for p in entries:
        try:
            st = p.stat()
            idle = time.time() - st.st_mtime
            if idle > keep_s:
                p.unlink()
                continue
            try:
                asked = float(p.read_text(encoding="utf-8"))
            except ValueError:
                asked = st.st_mtime  # caught before its first write
        except OSError:
            continue
        rows.append({"agent": p.name, "asked": asked, "live": idle <= live_s, "idleSeconds": round(idle, 1)})
    return sorted(rows, key=lambda r: (r["asked"], r["agent"]))


# -------------------------------------------------------------------------------------------------------- acquire

def try_acquire(d: Path, resource: str, me: Dict[str, str], why: str, processes: List[str], stale_minutes: float,
                despite_running: bool, extra: Optional[Dict[str, Any]] = None) -> Tuple[bool, str]:
    """One attempt on the lock file. (True, note) when the agent holds it now, else (False, who is in the way)."""
    path = d / f"{resource}.lock"
    scope = me["scope"]
    cur = read_lock(d, resource)
    if cur and _mine(cur, me):
        refresh_lock(d, resource, {**cur, **(extra or {})}, why)
        return True, "refreshed"
    took_over = None
    if cur:
        stale = _is_stale(cur, stale_minutes)
        procs = store.running(sorted({*processes, *(cur.get("processes") or [])})) if stale else []
        if not stale or procs:
            idle = store.age_seconds(cur.get("refreshed"))
            more = f"; not refreshed for {int(idle / 60)} min but {', '.join(procs)} is running" if stale else ""
            return False, f"{_label(cur, scope)} (for: {cur.get('for') or '?'}; since {cur.get('since')}{more})"
        # Take a stale lock over. The rename is the arbiter: of several takers only one moves the file away.
        moved = d / f"{resource}.lock.stale-{os.getpid()}-{time.time_ns()}"
        try:
            os.rename(path, moved)
        except OSError:
            return False, "a stale lock that another agent is taking over"
        was = common.read_json(moved, None)
        if isinstance(was, dict) and was.get("refreshed") != cur.get("refreshed"):
            # Its holder refreshed it between our look and our move: give it back.
            common.exclusive_create(path, json.dumps(was))
            _unlink(moved)
            return False, f"{was.get('agent') or was.get('holder')} (just refreshed)"
        _unlink(moved)
        took_over = cur
    else:
        procs = store.running(processes)
        if procs and not despite_running:
            return False, (f"nobody: {', '.join(procs)} runs without a lock (the owner's own instance, or a leftover) "
                           f"and must exit first; --despite-running takes the lock anyway")
    stamp = store.now()
    doc = {"resource": resource, "scope": scope, "agent": me["agent"], "project": me["project"], "for": why,
           "pid": os.getpid(), "since": stamp, "refreshed": stamp, **({"processes": processes} if processes else {}),
           **(extra or {})}
    # Atomic: of two creators exactly one succeeds.
    if not common.exclusive_create(path, json.dumps(doc)):
        other = read_lock(d, resource)
        return False, (f"{_label(other, scope)} (for: {other.get('for') or '?'})" if other else "another agent, a moment ago")
    if took_over:
        why_stale = (f"not refreshed since {took_over.get('refreshed')}"
                     if store.age_seconds(took_over.get("refreshed")) > stale_minutes * 60 else "its run is gone")
        _note(me, f"took over {resource} from {_label(took_over, scope)}: {why_stale} and no process of it running "
                  f"(was for: {took_over.get('for') or '?'})")
        return True, f"taken over from {_label(took_over, scope)} (stale)"
    return True, ""


def _unlink(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def _note(me: Dict[str, str], text: str) -> None:
    try:
        if me["scope"] == store.MACHINE:
            store.append_note(None, f"{me['agent']}@{store.project_name(me['project'])}", text)
        else:
            store.append_note(me["project"], me["agent"], text)
    except (OSError, store.CoordError):
        pass


def wait_for(d: Path, resource: str, me: Dict[str, str], why: str, processes: List[str], stale_minutes: float,
             a: Any, extra: Optional[Dict[str, Any]] = None) -> Tuple[bool, str]:
    """Queue and poll until the lock is ours or --wait is over. (True, note) or (False, what is in the way)."""
    d.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + max(0.0, a.wait)
    quiet = bool(getattr(a, "json", False))
    said = None
    while True:
        cur = read_lock(d, resource)
        ahead: List[str] = []
        if cur and _mine(cur, me):  # the holder refreshing: no queue
            got, note = try_acquire(d, resource, me, why, processes, stale_minutes, True, extra)
        else:
            take_ticket(d, resource, me["key"])
            live = [r["agent"] for r in queue(d, resource, a.live, a.keep) if r["live"]]
            ahead = live[: live.index(me["key"])] if me["key"] in live else []
            if ahead:  # first come, first served: only the head of the line tries the lock
                got, note = False, f"{_label(cur, me['scope']) if cur else 'nobody'}; in the queue behind {', '.join(ahead)}"
            else:
                got, note = try_acquire(d, resource, me, why, processes, stale_minutes, a.despite_running, extra)
        if got:
            drop_ticket(d, resource, me["key"])
            return True, note
        left = deadline - time.monotonic()
        if left <= 0:
            return False, note
        key = (re.split(r"[ :;(]", note)[0], tuple(ahead))
        if key != said and not quiet:  # one line per change of holder or place, not one per poll
            print(f"{resource}: waiting; held by {note}", file=sys.stderr, flush=True)
            said = key
        time.sleep(min(max(a.poll, 0.05), left))


def still_queued(resource: str, a: Any, note: str) -> int:
    print(f"{resource}: STILL QUEUED after {a.wait:g} s (held by {note}). Not a failure: the place in the queue is "
          f"kept for {a.keep / 60:g} min. Run the same command again.", file=sys.stderr)
    return QUEUED


# -------------------------------------------------------------------------------------- what the guard and others ask

def holder(resource: str, cfg: Optional[Dict[str, Any]], start: Any = None) -> Optional[Dict[str, Any]]:
    """The lock record of a resource as this project sees it (with its ``scope``), or None when it is free."""
    scope = scope_of(resource, cfg, start)
    doc = read_lock(scope_dir(scope), resource)
    return {**doc, "scope": scope} if doc else None


def holds(agent: Optional[str], resource: str, cfg: Optional[Dict[str, Any]], start: Any = None) -> bool:
    """Whether this agent of this project holds the resource right now."""
    if not agent:
        return False
    project = common.project_id(start)
    scope = scope_of(resource, cfg, start, project)
    return _mine(read_lock(scope_dir(scope), resource), _me(agent, project, scope))


def refresh(agent: Optional[str], resource: str, cfg: Optional[Dict[str, Any]], start: Any = None) -> bool:
    """Refresh the lock when this agent holds it (the guard does so when it lets a holder's command through)."""
    if not agent:
        return False
    project = common.project_id(start)
    scope = scope_of(resource, cfg, start, project)
    d = scope_dir(scope)
    cur = read_lock(d, resource)
    if not _mine(cur, _me(agent, project, scope)):
        return False
    try:
        refresh_lock(d, resource, cur)  # type: ignore[arg-type]
    except OSError:
        return False
    return True


def held_by(agent: str, project: str) -> List[str]:
    """The resources this agent of this project holds, in either scope."""
    out = []
    for scope in (store.MACHINE, project):
        d = scope_dir(scope)
        try:
            names = [p.name[:-5] for p in d.iterdir() if p.name.endswith(".lock")]
        except OSError:
            continue
        out += [n for n in names if _mine(read_lock(d, n), _me(agent, project, scope))]
    return sorted(out)


def order_warning(resource: str, held: List[str], order: List[str]) -> Optional[str]:
    """What to say when ``resource`` is asked for while holding one that "lockOrder" puts after it."""
    if resource not in order:
        return None
    late = [h for h in held if h in order and order.index(h) > order.index(resource)]
    if not late:
        return None
    return (f"lock order: {resource} comes before {', '.join(late)} (lockOrder: {' -> '.join(order)}) and you hold "
            f"{', '.join(late)} already. Two agents taking them in different orders wait on each other forever: "
            f"release {', '.join(late)} and take them in order.")


def all_locks(with_queues: bool = False) -> List[Dict[str, Any]]:
    """Every lock held on this machine, in every scope (for `aw who` and `aw sys`): no process probing."""
    rows: List[Dict[str, Any]] = []
    try:
        scopes = sorted(p for p in store.locks_root().iterdir() if p.is_dir())
    except OSError:
        return rows
    for d in scopes:
        names = set()
        try:
            for p in d.iterdir():
                if p.name.endswith(".lock"):
                    names.add(p.name[:-5])
                elif with_queues and p.name.endswith(".queue"):
                    names.add(p.name[:-6])
        except OSError:
            continue
        for name in sorted(names):
            cur = read_lock(d, name)
            waiting = queue(d, name) if with_queues else []
            if not cur and not waiting:
                continue
            row: Dict[str, Any] = {"resource": name, "scope": d.name, "held": bool(cur), "waiting": waiting}
            if cur:
                row.update(agent=cur.get("agent"), project=cur.get("project") or (None if d.name == store.MACHINE else d.name),
                           since=cur.get("since"), refreshed=cur.get("refreshed"), pid=cur.get("pid"),
                           heldMinutes=round(store.age_seconds(cur.get("since")) / 60, 1), **{"for": cur.get("for")})
            rows.append(row)
    return rows


# ------------------------------------------------------------------------------------------------------- commands

def _setup(a: Any) -> Tuple[store.Context, Dict[str, str], Path, Dict[str, Any], List[str]]:
    ctx = store.Context(getattr(a, "agent", None))
    resource = store.check_name(a.resource, "resource name")
    scope = scope_of(resource, ctx.cfg, project=ctx.project)
    me = _me(ctx.agent, ctx.project, scope)
    warnings = []
    if ctx.cfg.get("_error"):
        warnings.append(f"config: {ctx.cfg['_error']} (the defaults are used)")
    return ctx, me, scope_dir(scope), spec_of(resource, ctx.cfg), warnings


def _asking_warnings(a: Any, ctx: store.Context, me: Dict[str, str]) -> List[str]:
    out = []
    if not declared(a.resource, ctx.cfg):
        out.append(f"'{a.resource}' is not declared under \"resources\" in {common.CONFIG_REL}: locked for this "
                   f"project only, ad hoc. Declare it (with \"scope\": \"machine\" if other projects share it).")
    order = [str(x) for x in (ctx.cfg.get("lockOrder") or [])]
    w = order_warning(a.resource, held_by(me["agent"], me["project"]), order)
    if w:
        out.append(w)
    for line in out:
        print(f"aw lock: {line}", file=sys.stderr, flush=True)
    return out


def cmd_acquire(a: Any) -> int:
    ctx, me, d, spec, warnings = _setup(a)
    warnings += _asking_warnings(a, ctx, me)
    ctx.stamp()
    # The pid of a plain hold is the session's: who to look for, not a reason to call the lock stale.
    got, note = wait_for(d, a.resource, me, a.why, list(spec.get("processes") or []),
                         store.setting(ctx.cfg, "lockStaleMinutes"), a, {"pid": store.session_pid(), "run": False})
    store.emit({"resource": a.resource, "scope": me["scope"], "held": got, "agent": me["agent"], "project": me["project"],
                 "note": note, "warnings": warnings}, a.json,
                (f"{a.resource}: held by {me['agent']}" + (f" ({note})" if note else "")) if got else "")
    return 0 if got else still_queued(a.resource, a, note)


def cmd_run(a: Any) -> int:
    command = list(getattr(a, "command_line", None) or [])
    if not command:
        raise store.CoordError("lock run: no command after --")
    ctx, me, d, spec, _ = _setup(a)
    _asking_warnings(a, ctx, me)
    ctx.stamp()
    resource = a.resource
    max_minutes = float(a.max_minutes or spec.get("maxMinutes") or DEFAULT_MAX_MINUTES)
    got, note = wait_for(d, resource, me, a.why, list(spec.get("processes") or []),
                         store.setting(ctx.cfg, "lockStaleMinutes"), a, {"maxMinutes": max_minutes, "run": True,
                                                                         "pid": os.getpid()})
    if not got:
        return still_queued(resource, a, note)
    print(f"{resource}: held by {me['agent']}" + (f" ({note})" if note else "") + f"; limit {max_minutes:g} min",
          file=sys.stderr, flush=True)
    code, timed_out = 1, False
    try:
        import signal

        signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))  # a polite kill still reaches the finally below

        def tick() -> None:
            cur = read_lock(d, resource)
            if _mine(cur, me):
                refresh_lock(d, resource, cur)  # type: ignore[arg-type]

        guard = ctx.cfg.get("guard") or {}
        env = {str(guard.get("agentVar") or "AW_AGENT"): me["agent"], "AW_AGENT": me["agent"]}
        code, timed_out = store.run_child(command, env, max_minutes * 60, tick)
    except OSError as e:
        print(f"{resource}: could not start the command: {e}", file=sys.stderr)
        code = 127
    finally:
        if _mine(read_lock(d, resource), me):
            _unlink(d / f"{resource}.lock")
    if timed_out:
        _note(me, f"{resource}: run killed at its {max_minutes:g} min limit ({a.why})")
        print(f"{resource}: the command ran into its {max_minutes:g} min limit: its process tree was killed", file=sys.stderr)
    print(f"{resource}: released by {me['agent']} (exit {code})", file=sys.stderr)
    return code


def cmd_release(a: Any) -> int:
    _, me, d, _, _ = _setup(a)
    resource = a.resource
    cur = read_lock(d, resource)
    if cur is None:
        store.emit({"resource": resource, "released": False, "holder": None}, a.json, f"{resource}: already free")
        return 0
    if not _mine(cur, me):
        store.emit({"resource": resource, "released": False, "holder": cur.get("agent"), "project": cur.get("project")},
                    a.json, "")
        print(f"{resource}: held by {_label(cur, me['scope'])}, not by {me['agent']}: only the holder releases",
              file=sys.stderr)
        return 1
    _unlink(d / f"{resource}.lock")
    store.emit({"resource": resource, "released": True, "holder": None}, a.json, f"{resource}: released by {me['agent']}")
    return 0


def cmd_holder(a: Any) -> int:
    ctx = store.Context()
    doc = holder(store.check_name(a.resource, "resource name"), ctx.cfg)
    store.emit({"resource": a.resource, "holder": doc.get("agent") if doc else None,
                 "project": doc.get("project") if doc else None, "scope": scope_of(a.resource, ctx.cfg, project=ctx.project)},
                a.json, str(doc.get("agent")) if doc else "")
    return 0 if doc else 1


def status_rows(ctx: store.Context, only: Optional[str] = None, everything: bool = False) -> List[Dict[str, Any]]:
    """The resources this project can see (its own and the machine's; ``everything``: every project's too)."""
    stale_minutes = store.setting(ctx.cfg, "lockStaleMinutes")
    resources = ctx.cfg.get("resources") or {}
    wanted: List[Tuple[str, str]] = []
    for name in [*resources, *BUILTIN_MACHINE]:
        pair = (scope_of(name, ctx.cfg, project=ctx.project), name)
        if pair not in wanted:
            wanted.append(pair)
    found = [(r["scope"], r["resource"]) for r in all_locks(with_queues=True)
             if everything or r["scope"] in (store.MACHINE, ctx.project)]
    wanted += sorted(p for p in found if p not in wanted)
    if only:
        wanted = [p for p in wanted if p[1] == only] or [(scope_of(only, ctx.cfg, project=ctx.project), only)]
    names = sorted({name for _, name in store.process_table().values()})
    rows = []
    for scope, name in wanted:
        d = scope_dir(scope)
        cur = read_lock(d, name)
        spec = spec_of(name, ctx.cfg) if scope in (store.MACHINE, ctx.project) else {}
        prefixes = [str(p).lower() for p in [*(spec.get("processes") or []), *((cur or {}).get("processes") or [])]]
        row: Dict[str, Any] = {"resource": name, "scope": scope, "held": bool(cur),
                               "running": [n for n in names if any(n.lower().startswith(p) for p in prefixes)],
                               "waiting": queue(d, name)}
        if cur:
            held_min = store.age_seconds(cur.get("since")) / 60
            max_min = float(cur.get("maxMinutes") or spec.get("maxMinutes") or DEFAULT_MAX_MINUTES)
            row.update(agent=cur.get("agent"), project=cur.get("project"), since=cur.get("since"),
                       refreshed=cur.get("refreshed"), heldMinutes=round(held_min, 1), maxMinutes=max_min,
                       overdue=held_min > max_min, stale=_is_stale(cur, stale_minutes), **{"for": cur.get("for")})
        rows.append(row)
    return rows


def cmd_status(a: Any) -> int:
    ctx = store.Context()
    only = store.check_name(a.resource, "resource name") if a.resource else None
    rows = status_rows(ctx, only, a.all)
    known = store.projects()
    lines = []
    for r in rows:
        where = "machine" if r["scope"] == store.MACHINE else ("project" if r["scope"] == ctx.project
                                                             else store.project_name(r["scope"], known))
        head = f"{r['resource']} [{where}]"
        run = f"; running: {', '.join(r['running'])}" if r["running"] else ""
        if r["held"]:
            who = r["agent"] + (f" ({store.project_name(r['project'], known)})" if r["scope"] == store.MACHINE and r.get("project") else "")
            flags = (" OVERDUE" if r["overdue"] else "") + (" STALE (not refreshed)" if r["stale"] else "")
            lines.append(f"{head}: held by {who} for {r['heldMinutes']:g} of {r['maxMinutes']:g} min{flags}, "
                         f"since {r['since']}, refreshed {r['refreshed']}, for: {r['for'] or '?'}{run}")
        else:
            unlocked = " (no lock: the owner's own instance, or a leftover)" if r["running"] else ""
            lines.append(f"{head}: free{run}{unlocked}")
        for i, w in enumerate(r["waiting"], 1):
            away = "" if w["live"] else f" (not polling for {w['idleSeconds']:.0f} s: passed over, place kept)"
            lines.append(f"    {i}. {w['agent']} waiting since {store.iso_at(w['asked'])}{away}")
    store.emit({"dir": common.posix(store.locks_root()), "project": ctx.project, "resources": rows}, a.json, "\n".join(lines))
    return 0


def register(subparsers: Any) -> None:
    import argparse

    p = subparsers.add_parser("lock", help="exclusive locks on scarce resources: run, acquire, release, status",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.set_defaults(func=lambda a: (p.print_help(sys.stderr), 2)[1])
    sub = p.add_subparsers(dest="lock_command", metavar="<action>")

    def who(q: Any) -> None:
        q.add_argument("--as", dest="agent", help="the agent's name: lower-case letters, digits and '-' "
                                                 "(default: the agent variable, else session-<pid>)")

    def waiting(q: Any) -> None:
        q.add_argument("resource")
        who(q)
        q.add_argument("--for", dest="why", required=True, help='what the run is and how long it takes ("smoke gate, 2 min")')
        q.add_argument("--wait", type=float, default=480,
                       help="seconds to wait for a turn (default 480, below a tool's time limit); then exit 3 = still "
                            "queued, place kept: run the same command again")
        q.add_argument("--despite-running", action="store_true",
                       help="take a free lock although the application already runs (you started it, or the owner said so)")
        for name, value in (("--poll", POLL_S), ("--live", LIVE_S), ("--keep", KEEP_S)):  # tests shorten them
            q.add_argument(name, type=float, default=value, help=argparse.SUPPRESS)

    q = sub.add_parser("acquire", help="take a resource's lock, queueing for a turn")
    waiting(q)
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_acquire)

    q = sub.add_parser("run", help="acquire, run a command with the agent variable set, always release (the normal way)",
                       epilog="After the options: -- and the command (several arguments = a program and its arguments; "
                              "one quoted argument = a shell line).")
    waiting(q)
    q.add_argument("--max-minutes", type=float,
                   help=f"kill the command's process tree after this long (default: the resource's maxMinutes, else {DEFAULT_MAX_MINUTES:g})")
    store.split_command(q)
    q.set_defaults(func=cmd_run)

    q = sub.add_parser("release", help="give a lock back (only its holder can)")
    q.add_argument("resource")
    who(q)
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_release)

    q = sub.add_parser("status", help="each resource: free or held, by whom, how long against its maximum, who waits")
    q.add_argument("resource", nargs="?")
    q.add_argument("--all", action="store_true", help="also the locks of other projects")
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_status)

    q = sub.add_parser("holder", help="print the holder; exit 0 when held, 1 when free")
    q.add_argument("resource")
    q.add_argument("--json", action="store_true", help="print one JSON document")
    q.set_defaults(func=cmd_holder)
