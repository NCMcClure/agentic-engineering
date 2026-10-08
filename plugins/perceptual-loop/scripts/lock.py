#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""One instance of a scarce application at a time, across agents, checkouts and git worktrees.

The normal way, one command under one hold (queues fairly, sets PL_AGENT for the command, kills its process tree
at the limit, and always releases, also after a failure):

  lock.py run APP --as AGENT --for "what, how long" [--max-minutes N] [--wait SECONDS] -- <command ...>

Several commands under one hold:

  lock.py acquire APP --as AGENT --for "what, how long" [--wait SECONDS] [--despite-running]
  PL_AGENT=AGENT <command>            (PowerShell: $env:PL_AGENT = "AGENT"; <command>)
  lock.py release APP --as AGENT

  lock.py status | holder APP | note --as AGENT "text" | board [N]

Exit codes of acquire and run: 0 = held (run: the command's own exit code), 3 = STILL QUEUED after --wait seconds:
not a failure, the place in the queue is kept for 10 minutes, run the same command again; 124 = run killed the
command at its time limit; 2 = usage error. --wait defaults to 480 s, shorter than a tool's time limit on purpose.

Rules of use:
  - Hold a lock for the run only, never while thinking or editing.
  - Release also after a failure (`run` does it for you).
  - Needing two applications, take them in the order config.locks.apps lists them, so two agents cannot each
    hold one and wait for the other.
  - First come, first served: waiters queue by the time they first asked. A waiter whose command died keeps its
    place for 10 minutes; one that has not polled for 45 s is passed over until it asks again.
  - A hold longer than config.locks.staleMinutes must be refreshed: call acquire again with the same --as (`run`
    refreshes by itself). A lock not refreshed while none of the application's processes runs is taken over
    (the board says so). status flags a hold beyond its maximum (config.locks.apps.<app>.maxMinutes, else 30).
  - While the application runs without any lock (the owner's own instance, or a leftover), acquire waits too.

Agent names: lower-case letters, digits and '-'. This is a coordination aid between cooperating agents, not a
security boundary: an agent's name is whatever it says it is.

Standard library only; the guard hook imports locks_dir(), read_lock() and refresh_lock() from here, so everything
heavier than os/json is imported inside the function that needs it.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402

AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
APP_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
ISO = "%Y-%m-%dT%H:%M:%SZ"
LIVE_S = 45.0    # a waiter that polled within this is in line; polls come every 15 s
KEEP_S = 600.0   # a waiter that stopped polling keeps its place this long
DEFAULT_MAX_MINUTES = 30.0
QUEUED, TIMED_OUT = 3, 124


# --------------------------------------------------------------------------- where the locks live (shared with the hook)

def main_repo(root: Path) -> Path:
    """The main repository of a checkout: a worktree resolves to the repository it belongs to.

    What `git rev-parse --git-common-dir` answers, read from the files instead (the hook cannot afford a process);
    git itself is asked only when those files cannot be read. No repository at all: the root.
    """
    for p in [root, *root.parents]:
        dot = p / ".git"
        if dot.is_dir():
            return p
        if dot.is_file():
            try:
                gitdir = (p / dot.read_text(encoding="utf-8").partition("gitdir:")[2].strip()).resolve()
                common = gitdir / "commondir"
                if not common.is_file():
                    return p  # a submodule: a project of its own
                c = (gitdir / common.read_text(encoding="utf-8").strip()).resolve()
            except OSError:
                c = _git_common_dir(p)
                if c is None:
                    return p
            return c.parent if c.name == ".git" else c  # a bare repository is its own key
    return root


def _git_common_dir(cwd: Path) -> Path | None:
    import subprocess

    try:
        r = subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=cwd, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    return (cwd / r.stdout.strip()).resolve() if r.returncode == 0 and r.stdout.strip() else None


def project_key(root: Path) -> str:
    import hashlib

    repo = main_repo(root.resolve())
    digest = hashlib.sha1(os.path.normcase(str(repo)).encode("utf-8")).hexdigest()[:10]
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", repo.name)[:40].strip("-") + "-" + digest


def user_base() -> Path:
    # Not pl_common.user_data_dir(): that one prefers CLAUDE_PLUGIN_DATA, which a hook process has and an agent's
    # shell has not, so the hook and `lock.py acquire` would look in two different folders.
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME") or os.path.join(os.path.expanduser("~"), ".local", "state")
    return Path(base) / "perceptual-loop"


def locks_dir(root: Path, config: dict[str, Any]) -> Path:
    explicit = (config.get("locks") or {}).get("dir")
    if explicit:
        p = Path(os.path.expandvars(os.path.expanduser(str(explicit))))
        return p if p.is_absolute() else root / p
    return user_base() / "locks" / project_key(root)


def _read(path: Path) -> dict[str, Any] | None:
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, ValueError):
        return None


def read_lock(d: Path, app: str) -> dict[str, Any] | None:
    """The lock's record, or None when the application is free."""
    path = d / f"{app}.lock"
    doc = _read(path)
    if doc and doc.get("agent"):
        return doc
    # Caught between its creation and its first write, or damaged: held all the same, if the file is there.
    try:
        stamp = time.strftime(ISO, time.gmtime(path.stat().st_mtime))
    except OSError:
        return None
    return {"app": app, "agent": "?", "for": "", "since": stamp, "refreshed": stamp}


def refresh_lock(d: Path, app: str, doc: dict[str, Any], why: str | None = None) -> dict[str, Any]:
    doc = {**doc, "refreshed": now_iso(), **({"for": why} if why else {})}
    tmp = d / f"{app}.lock.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, d / f"{app}.lock")
    return doc


def now_iso() -> str:
    return time.strftime(ISO, time.gmtime())


def age_seconds(stamp: str | None) -> float:
    import calendar

    try:
        return time.time() - calendar.timegm(time.strptime(stamp or "", ISO))
    except (ValueError, TypeError):
        return 0.0


# ------------------------------------------------------------------------------------------------------- processes

def running(prefixes: list[str]) -> list[str]:
    """The running executables whose name starts with one of the prefixes (case ignored)."""
    if not prefixes:
        return []
    import subprocess

    try:
        if os.name == "nt":
            out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=30,
                                 creationflags=0x08000000).stdout  # no console window from a windowless parent
            names = [line.split('","')[0].strip('"') for line in out.splitlines() if line.startswith('"')]
        else:
            out = subprocess.run(["ps", "-A", "-o", "comm="], capture_output=True, text=True, timeout=30).stdout
            names = [os.path.basename(line.strip()) for line in out.splitlines() if line.strip()]
    except (OSError, subprocess.SubprocessError):
        return []  # cannot tell: the lock files alone decide
    low = [p.lower() for p in prefixes]
    return sorted({n for n in names if any(n.lower().startswith(p) for p in low)})


def kill_tree(pid: int) -> None:
    import signal
    import subprocess

    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=30, creationflags=0x08000000)
        else:
            os.killpg(pid, signal.SIGTERM)  # the child leads its own session (start_new_session)
            time.sleep(3)
            os.killpg(pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass


# ------------------------------------------------------------------------------------------------- board and queue

def board_line(d: Path, agent: str, text: str) -> str:
    line = f"{now_iso()}  {agent}  {' '.join(text.split())}"
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "board.log", "a", encoding="utf-8") as f:
        f.write(line + "\n")
    return line


def take_ticket(d: Path, app: str, agent: str) -> None:
    """A ticket: its content is when the agent first asked (its place), its mtime the last poll (its being alive)."""
    q = d / f"{app}.queue"
    q.mkdir(parents=True, exist_ok=True)
    try:
        with open(q / agent, "x", encoding="utf-8") as f:
            f.write(repr(time.time()))
    except FileExistsError:
        os.utime(q / agent)


def drop_ticket(d: Path, app: str, agent: str) -> None:
    (d / f"{app}.queue" / agent).unlink(missing_ok=True)


def queue(d: Path, app: str, live_s: float = LIVE_S, keep_s: float = KEEP_S) -> list[dict[str, Any]]:
    """The waiters, first asked first; tickets nobody polled for keep_s are thrown away."""
    rows = []
    try:
        entries = list((d / f"{app}.queue").iterdir())
    except OSError:
        return []
    for p in entries:
        try:
            st = p.stat()
            idle = time.time() - st.st_mtime
            if idle > keep_s:
                p.unlink(missing_ok=True)
                continue
            try:
                asked = float(p.read_text(encoding="utf-8"))
            except ValueError:
                asked = st.st_mtime  # caught before its first write
        except OSError:
            continue
        rows.append({"agent": p.name, "asked": asked, "live": idle <= live_s, "idleSeconds": round(idle, 1)})
    return sorted(rows, key=lambda r: (r["asked"], r["agent"]))


# --------------------------------------------------------------------------------------------------------- acquire

def try_acquire(d: Path, app: str, agent: str, why: str, processes: list[str], stale_minutes: float,
                despite_running: bool, extra: dict[str, Any] | None = None) -> tuple[bool, str]:
    """One attempt on the lock file. (True, note) when the agent holds it now, else (False, who is in the way)."""
    path = d / f"{app}.lock"
    cur = read_lock(d, app)
    if cur and cur["agent"] == agent:
        refresh_lock(d, app, {**cur, **(extra or {})}, why)
        return True, "refreshed"
    procs = running(processes)
    took_over = None
    if cur:
        idle = age_seconds(cur.get("refreshed"))
        stale = idle > stale_minutes * 60
        if not stale or procs:
            more = f"; not refreshed for {int(idle / 60)} min but {', '.join(procs)} is running" if stale else ""
            return False, f"{cur['agent']} (for: {cur.get('for') or '?'}; since {cur.get('since')}{more})"
        # Take a stale lock over. The rename is the arbiter: of several takers only one moves the file away.
        moved = d / f"{app}.lock.stale-{os.getpid()}-{time.time_ns()}"
        try:
            os.rename(path, moved)
        except OSError:
            return False, "a stale lock that another agent is taking over"
        was = _read(moved)
        if was and was.get("refreshed") != cur.get("refreshed"):
            # Its holder refreshed it between our look and our move: give it back.
            try:
                with open(path, "x", encoding="utf-8") as f:
                    json.dump(was, f)
            except OSError:
                pass
            moved.unlink(missing_ok=True)
            return False, f"{was.get('agent')} (just refreshed)"
        moved.unlink(missing_ok=True)
        took_over = cur
    elif procs and not despite_running:
        return False, (f"nobody: {', '.join(procs)} runs without a lock (the owner's own instance, or a leftover) and "
                       f"must exit first; --despite-running takes the lock anyway")
    stamp = now_iso()
    try:
        with open(path, "x", encoding="utf-8") as f:  # atomic: of two creators exactly one succeeds
            json.dump({"app": app, "agent": agent, "for": why, "since": stamp, "refreshed": stamp, "pid": os.getpid(),
                       **(extra or {})}, f)
    except FileExistsError:
        other = read_lock(d, app)
        return False, f"{other['agent']} (for: {other.get('for') or '?'})" if other else "another agent, a moment ago"
    if took_over:
        board_line(d, agent, f"took over {app} from {took_over['agent']}: not refreshed since {took_over.get('refreshed')} "
                             f"and no process of it running (was for: {took_over.get('for') or '?'})")
        return True, f"taken over from {took_over['agent']} (stale)"
    return True, ""


def wait_for(d: Path, app: str, agent: str, why: str, spec: dict[str, Any], stale_minutes: float, a: Any,
             extra: dict[str, Any] | None = None) -> tuple[bool, str]:
    """Queue and poll until the lock is ours or --wait is over. (True, note) or (False, what is in the way)."""
    d.mkdir(parents=True, exist_ok=True)
    processes = list(spec.get("processes") or [])
    deadline = time.monotonic() + max(0.0, a.wait)
    said = None
    while True:
        cur = read_lock(d, app)
        if cur and cur["agent"] == agent:  # the holder refreshing: no queue
            got, note, ahead = (*try_acquire(d, app, agent, why, processes, stale_minutes, True, extra), [])
        else:
            take_ticket(d, app, agent)
            live = [r["agent"] for r in queue(d, app, a.live, a.keep) if r["live"]]
            ahead = live[: live.index(agent)] if agent in live else []
            if ahead:  # first come, first served: only the head of the line tries the lock
                got, note = False, f"{cur['agent'] if cur else 'nobody'}; in the queue behind {', '.join(ahead)}"
            else:
                got, note = try_acquire(d, app, agent, why, processes, stale_minutes, a.despite_running, extra)
        if got:
            drop_ticket(d, app, agent)
            return True, note
        left = deadline - time.monotonic()
        if left <= 0:
            return False, note
        key = (re.split(r"[ :;(]", note)[0], tuple(ahead))
        if key != said and not a.json:  # one line per change of holder or place, not one per poll
            print(f"{app}: waiting; held by {note}", file=sys.stderr, flush=True)
            said = key
        time.sleep(min(max(a.poll, 0.05), left))


def still_queued(app: str, a: Any, note: str) -> int:
    print(f"{app}: STILL QUEUED after {a.wait:g} s (held by {note}). Not a failure: the place in the queue is kept "
          f"for {a.keep / 60:g} min. Run the same command again.", file=sys.stderr)
    return QUEUED


def run_child(command: list[str], agent: str, max_seconds: float, tick: Any) -> tuple[int, bool]:
    """Run the command with PL_AGENT set; kill its process tree at the limit. (exit code, timed out)."""
    import shutil
    import subprocess

    env = {**os.environ, "PL_AGENT": agent}
    shell = len(command) == 1  # one argument is a shell line, several are a program and its arguments
    argv: Any = command[0] if shell else command
    if not shell and os.name == "nt":
        found = shutil.which(command[0])  # npm is npm.cmd: CreateProcess needs the real file
        argv = [found, *command[1:]] if found else subprocess.list2cmdline(command)
        shell = not found
    proc = subprocess.Popen(argv, shell=shell, env=env, **({} if os.name == "nt" else {"start_new_session": True}))
    start = last = time.monotonic()
    try:
        while True:
            try:
                return proc.wait(timeout=1.0), False
            except subprocess.TimeoutExpired:
                now = time.monotonic()
                if now - start >= max_seconds:
                    kill_tree(proc.pid)
                    return TIMED_OUT, True
                if now - last >= 60:
                    last = now
                    tick()
    finally:
        if proc.poll() is None:  # interrupted: do not leave the application behind
            kill_tree(proc.pid)


# ------------------------------------------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    import argparse

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    ap = argparse.ArgumentParser(prog="lock.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 parents=[common])
    sub = ap.add_subparsers(dest="cmd", required=True)

    def who(p: argparse.ArgumentParser) -> None:
        p.add_argument("--as", dest="agent", default=os.environ.get("PL_AGENT"), required=not os.environ.get("PL_AGENT"),
                       help="the agent's name: lower-case letters, digits and '-' (default: $PL_AGENT)")

    def waiting(p: argparse.ArgumentParser) -> None:
        p.add_argument("app")
        who(p)
        p.add_argument("--for", dest="why", required=True, help='what the run is and how long it takes ("smoke gate, 2 min")')
        p.add_argument("--wait", type=float, default=480,
                       help="seconds to wait for a turn (default 480, below a tool's time limit); then exit 3 = still "
                            "queued, place kept: run the same command again")
        p.add_argument("--despite-running", action="store_true",
                       help="take a free lock although the application already runs (you started it, or the owner said so)")
        for name, value in (("--poll", 15.0), ("--live", LIVE_S), ("--keep", KEEP_S)):  # tests shorten them
            p.add_argument(name, type=float, default=value, help=argparse.SUPPRESS)

    waiting(sub.add_parser("acquire", parents=[common], help="take an application's lock, queueing for a turn"))
    p = sub.add_parser("run", parents=[common], help="acquire, run a command with PL_AGENT set, always release (the normal way)")
    waiting(p)
    p.add_argument("--max-minutes", type=float,
                   help=f"kill the command's process tree after this long (default: config.locks.apps.<app>.maxMinutes, else {DEFAULT_MAX_MINUTES:g})")
    p.epilog = "After the options: -- and the command (several arguments = a program and its arguments; one quoted argument = a shell line)."
    p = sub.add_parser("release", parents=[common], help="give a lock back (only its holder can)")
    p.add_argument("app")
    who(p)
    sub.add_parser("status", parents=[common], help="each application: free or held, by whom, how long against its maximum, who waits")
    p = sub.add_parser("holder", parents=[common], help="print the holder; exit 0 when held, 1 when free")
    p.add_argument("app")
    p = sub.add_parser("note", parents=[common], help="append a line to the shared board")
    who(p)
    p.add_argument("text")
    p = sub.add_parser("board", parents=[common], help="the last N lines of the shared board (default 30)")
    p.add_argument("n", nargs="?", type=int, default=30)
    argv = list(sys.argv[1:] if argv is None else argv)
    command: list[str] = []
    if "--" in argv and "run" in argv[: argv.index("--")]:  # argparse would hand the command's own flags to us
        cut = argv.index("--")
        argv, command = argv[:cut], argv[cut + 1:]
    a = ap.parse_args(argv)

    root = pl.find_root()
    config = pl.load_config(root)
    locks = config.get("locks") or {}
    apps: dict[str, Any] = locks.get("apps") or {}
    stale_minutes = float(locks.get("staleMinutes") or 45)
    d = locks_dir(root, config)

    agent = getattr(a, "agent", None)
    if agent is not None and not AGENT_RE.match(agent):
        pl.fail(f"agent name '{agent}': lower-case letters, digits and '-' only")
    app = getattr(a, "app", None)
    if app is not None:
        if not APP_RE.match(app):
            pl.fail(f"application name '{app}': letters, digits, '_', '.', '-' only")
        if apps and app not in apps:
            pl.fail(f"no application '{app}' in config.locks.apps (have: {', '.join(apps)})")
    spec: dict[str, Any] = (apps.get(app) or {}) if app else {}

    if a.cmd == "acquire":
        got, note = wait_for(d, app, agent, a.why, spec, stale_minutes, a)
        pl.emit({"app": app, "held": got, "agent": agent, "note": note, "dir": str(d)}, a.json,
                (f"{app}: held by {agent}" + (f" ({note})" if note else "")) if got else None)
        return 0 if got else still_queued(app, a, note)

    if a.cmd == "run":
        if not command:
            pl.fail("run: no command after --")
        max_minutes = float(a.max_minutes or spec.get("maxMinutes") or DEFAULT_MAX_MINUTES)
        got, note = wait_for(d, app, agent, a.why, spec, stale_minutes, a, {"maxMinutes": max_minutes, "run": True})
        if not got:
            return still_queued(app, a, note)
        print(f"{app}: held by {agent}" + (f" ({note})" if note else "") + f"; limit {max_minutes:g} min", file=sys.stderr, flush=True)
        code, timed_out = 1, False
        try:
            import signal

            signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))  # a polite kill still reaches the finally below

            def tick() -> None:
                cur = read_lock(d, app)
                if cur and cur["agent"] == agent:
                    refresh_lock(d, app, cur)

            code, timed_out = run_child(command, agent, max_minutes * 60, tick)
        except OSError as e:
            print(f"{app}: could not start the command: {e}", file=sys.stderr)
            code = 127
        finally:
            cur = read_lock(d, app)
            if cur and cur["agent"] == agent:
                (d / f"{app}.lock").unlink(missing_ok=True)
        if timed_out:
            board_line(d, agent, f"{app}: run killed at its {max_minutes:g} min limit ({a.why})")
            print(f"{app}: the command ran into its {max_minutes:g} min limit: its process tree was killed", file=sys.stderr)
        print(f"{app}: released by {agent} (exit {code})", file=sys.stderr)
        return code

    if a.cmd == "release":
        cur = read_lock(d, app)
        if cur is None:
            pl.emit({"app": app, "released": False, "holder": None}, a.json, f"{app}: already free")
            return 0
        if cur["agent"] != agent:
            pl.emit({"app": app, "released": False, "holder": cur["agent"]}, a.json)
            print(f"{app}: held by {cur['agent']}, not by {agent}: only the holder releases", file=sys.stderr)
            return 1
        (d / f"{app}.lock").unlink(missing_ok=True)
        pl.emit({"app": app, "released": True, "holder": None}, a.json, f"{app}: released by {agent}")
        return 0

    if a.cmd == "holder":
        cur = read_lock(d, app)
        pl.emit({"app": app, "holder": cur["agent"] if cur else None}, a.json, cur["agent"] if cur else None)
        return 0 if cur else 1

    if a.cmd == "status":
        names = {p.name.rsplit(".", 1)[0] for p in d.iterdir() if p.name.endswith((".lock", ".queue"))} if d.is_dir() else set()
        rows = []
        for name in [*apps, *sorted(names - set(apps))]:
            cur = read_lock(d, name)
            app_spec = apps.get(name) or {}
            row: dict[str, Any] = {"app": name, "held": bool(cur), "running": running(list(app_spec.get("processes") or [])),
                                   "waiting": queue(d, name)}
            if cur:
                held_min = age_seconds(cur.get("since")) / 60
                max_min = float(cur.get("maxMinutes") or app_spec.get("maxMinutes") or DEFAULT_MAX_MINUTES)
                row.update(agent=cur["agent"], since=cur.get("since"), refreshed=cur.get("refreshed"), **{"for": cur.get("for")},
                           heldMinutes=round(held_min, 1), maxMinutes=max_min, overdue=held_min > max_min,
                           stale=age_seconds(cur.get("refreshed")) > stale_minutes * 60)
            rows.append(row)
        lines = [f"locks: {d}"]
        for r in rows:
            run = f"; running: {', '.join(r['running'])}" if r["running"] else ""
            if r["held"]:
                flags = (" OVERDUE" if r["overdue"] else "") + (" STALE (not refreshed)" if r["stale"] else "")
                lines.append(f"{r['app']}: held by {r['agent']} for {r['heldMinutes']:g} of {r['maxMinutes']:g} min{flags}, "
                             f"since {r['since']}, refreshed {r['refreshed']}, for: {r['for'] or '?'}{run}")
            else:
                unlocked = " (no lock: the owner's own instance, or a leftover)" if r["running"] else ""
                lines.append(f"{r['app']}: free{run}{unlocked}")
            for i, w in enumerate(r["waiting"], 1):
                away = "" if w["live"] else f" (not polling for {w['idleSeconds']:.0f} s: passed over, place kept)"
                lines.append(f"    {i}. {w['agent']} waiting since {time.strftime(ISO, time.gmtime(w['asked']))}{away}")
        if not rows:
            lines.append("no applications configured (config.locks.apps) and no lock held")
        pl.emit({"dir": str(d), "apps": rows}, a.json, "\n".join(lines))
        return 0

    if a.cmd == "note":
        line = board_line(d, agent, a.text)
        pl.emit({"line": line}, a.json, line)
        return 0

    if a.cmd == "board":
        try:
            lines = (d / "board.log").read_text(encoding="utf-8").splitlines()[-max(a.n, 0):] if a.n else []
        except OSError:
            lines = []
        pl.emit({"dir": str(d), "lines": lines}, a.json, "\n".join(lines) if lines else "(the board is empty)")
        return 0
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pl.PlError as e:
        pl.fail(str(e))
