"""The machine-wide store: where it lives, how it is written, and what the machine's processes are.

Layout under ``common.aw_home()`` (``AGENT_WORKS_HOME`` or ``~/.agent-works``):

    agents.jsonl                      one JSON line per running agent
    resources.json                    {"leases": [...]}
    locks/<scope>/<resource>.lock     scope = "machine" or a project id
    locks/<scope>/<resource>.queue/   one ticket per waiter
    projects/<project_id>/notes.log   and claims.json (guard.log is the guard's)
    notes.log                         machine-wide notes
    learnings/<id>-<slug>.md
    projects.json                     {project_id: {root, name, seen}}

Rules of the store: a file is replaced whole through a temp file and a rename, so a reader never sees half of one; a
read-modify-write happens under a lock file that is created exclusively and held for milliseconds, never while a
command runs; an entry whose process is gone is dropped by whoever reads next.

Standard library only, and nothing heavier than os/json at import time: the guard hook imports ``locks``, which
imports this.
"""
from __future__ import annotations

import calendar
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import common

sys.dont_write_bytecode = True

ISO = "%Y-%m-%dT%H:%M:%SZ"
MACHINE = "machine"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
TIMED_OUT = 124
NO_WINDOW = 0x08000000  # Windows: no console window from a windowless parent

# Settings a project may override under "coordination" in .agents/agent-works.json. The defaults are the config's
# (common.DEFAULTS), so the documented schema and the code cannot drift apart.
SETTINGS: Dict[str, float] = dict(common.DEFAULTS["coordination"])


class CoordError(Exception):
    """A usage or environment error of a coordination command: ``aw`` prints it and exits 2."""


def setting(cfg: Optional[Dict[str, Any]], key: str) -> float:
    try:
        return float(((cfg or {}).get("coordination") or {}).get(key, SETTINGS[key]))
    except (TypeError, ValueError):
        return float(SETTINGS[key])


def emit(doc: Any, as_json: bool, text: Optional[str] = None) -> None:
    """One JSON document (``as_json``), else the text; nothing at all when the text is empty."""
    if as_json:
        common.emit(doc, True)
    elif text:
        common.emit(text)


# ------------------------------------------------------------------------------------------------------------ time

def now() -> str:
    return common.now_iso()


def iso_at(stamp: float) -> str:
    return time.strftime(ISO, time.gmtime(stamp))


def parse_iso(stamp: Any) -> Optional[float]:
    try:
        return float(calendar.timegm(time.strptime(str(stamp), ISO)))
    except (ValueError, TypeError):
        return None


def age_seconds(stamp: Any) -> float:
    """Seconds since an ISO stamp; 0 when it cannot be read (an unreadable stamp never makes anything stale)."""
    t = parse_iso(stamp)
    return max(0.0, time.time() - t) if t is not None else 0.0


def ago(seconds: float) -> str:
    seconds = max(0.0, seconds)
    if seconds < 90:
        return f"{seconds:.0f} s"
    if seconds < 5400:
        return f"{seconds / 60:.0f} min"
    return f"{seconds / 3600:.1f} h"


# ----------------------------------------------------------------------------------------------------------- paths

def home() -> Path:
    return common.aw_home()


def locks_root() -> Path:
    return home() / "locks"


def project_dir(project: str) -> Path:
    return home() / "projects" / project


def check_name(value: str, what: str) -> str:
    if not NAME_RE.match(value or ""):
        raise CoordError(f"{what} '{value}': letters, digits, '_', '.', '-' only, at most 64 characters")
    return value


# --------------------------------------------------------------------------------------------- read-modify-write

class FileLock:
    """A short exclusive lock beside ``target`` (``<target>.lk``), for one read-modify-write.

    Created with O_EXCL, so of several processes exactly one holds it; the others retry every few milliseconds. A
    lock file left by a process that died is broken once that process is gone, or after ``stale`` seconds. Never hold
    one across anything slow.
    """

    def __init__(self, target: Path, timeout: float = 15.0, stale: float = 30.0):
        self.path = target.with_name(target.name + ".lk")
        self.timeout = timeout
        self.stale = stale

    def _break_if_dead(self) -> None:
        try:
            age = time.time() - self.path.stat().st_mtime
        except OSError:
            return
        if age < 1.0:
            return
        if age < self.stale:
            text = common.read_text(self.path, "") or ""
            pid = text.split(" ", 1)[0]
            if not pid.isdigit() or pid_alive(int(pid)):
                return
        # The rename is the arbiter: of several breakers only one moves the file away.
        moved = self.path.with_name(f"{self.path.name}.dead-{os.getpid()}-{time.time_ns()}")
        try:
            os.rename(self.path, moved)
            moved.unlink()
        except OSError:
            pass

    def __enter__(self) -> "FileLock":
        deadline = time.monotonic() + self.timeout
        tries = 0
        while True:
            if common.exclusive_create(self.path, f"{os.getpid()} {time.time():.3f}"):
                return self
            tries += 1
            if tries % 25 == 0:
                self._break_if_dead()
            if time.monotonic() > deadline:
                raise CoordError(f"the store is busy: {self.path.name} was held for {self.timeout:g} s. Run the command again.")
            time.sleep(random.uniform(0.004, 0.03))

    def __exit__(self, *exc: Any) -> None:
        for attempt in range(40):
            try:
                self.path.unlink()
                return
            except FileNotFoundError:
                return
            except OSError:  # Windows: a breaker is looking at it this instant
                time.sleep(0.005 * (attempt + 1))


def write(path: Path, text: str) -> None:
    """Replace a file whole (temp file, then rename), waiting out a reader that has it open this instant.

    Windows refuses to replace a file while another process reads it; ``common.atomic_write`` retries for about two
    seconds, and a store under load (many agents, a virus scanner) gets a few such rounds before the error stands.
    """
    for attempt in range(4):
        try:
            common.atomic_write(path, text)
            return
        except PermissionError:
            if attempt == 3:
                raise
            time.sleep(0.05)


def update_json(path: Path, default: Any, change: Callable[[Any], Any]) -> Any:
    """Read ``path`` (``default`` when absent or damaged), let ``change`` edit the document in place, write it back.

    Returns what ``change`` returned. The whole step runs under the file's lock, so concurrent updates never lose
    one another's work.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(path):
        doc = common.read_json(path, None)
        if not isinstance(doc, type(default)):
            doc = json.loads(json.dumps(default))
        result = change(doc)
        write(path, json.dumps(doc, indent=1) + "\n")
        return result


def append_line(path: Path, line: str, max_bytes: Optional[float] = None) -> None:
    """Append one line to a log; beyond ``max_bytes`` the log becomes ``<name>.1`` (one older generation is kept)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    limit = float(max_bytes if max_bytes is not None else SETTINGS["logBytes"])
    with FileLock(path):
        try:
            if path.stat().st_size > limit:
                os.replace(path, path.with_name(path.name + ".1"))
        except OSError:
            pass
        with open(path, "a", encoding="utf-8", newline="\n") as f:
            f.write(line.rstrip("\n") + "\n")


def log_lines(path: Path) -> List[str]:
    """A rotating log's lines, oldest first (the older generation, then the current one)."""
    out: List[str] = []
    for p in (path.with_name(path.name + ".1"), path):
        text = common.read_text(p)
        if text:
            out += [ln for ln in text.splitlines() if ln.strip()]
    return out


# ------------------------------------------------------------------------------------------------------- processes

def _win_process_table() -> Dict[int, Tuple[int, str]]:
    import ctypes
    from ctypes import wintypes

    class Entry(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]

    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
    k.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    for fn in (k.Process32FirstW, k.Process32NextW):
        fn.restype = wintypes.BOOL
        fn.argtypes = [ctypes.c_void_p, ctypes.POINTER(Entry)]
    k.CloseHandle.argtypes = [ctypes.c_void_p]
    snap = k.CreateToolhelp32Snapshot(0x2, 0)
    if not snap or snap == ctypes.c_void_p(-1).value:
        return {}
    table: Dict[int, Tuple[int, str]] = {}
    try:
        e = Entry()
        e.dwSize = ctypes.sizeof(Entry)
        ok = k.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            table[int(e.th32ProcessID)] = (int(e.th32ParentProcessID), e.szExeFile)
            ok = k.Process32NextW(snap, ctypes.byref(e))
    finally:
        k.CloseHandle(snap)
    return table


def process_table() -> Dict[int, Tuple[int, str]]:
    """{pid: (parent pid, executable name)} of the machine; empty when it cannot be read.

    Windows: the process snapshot, with ``tasklist`` as the fallback (names only, no parents). Elsewhere: ``ps``.
    """
    import subprocess

    if os.name == "nt":
        try:
            table = _win_process_table()
            if table:
                return table
        except Exception:
            pass
        try:
            out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=30,
                                 creationflags=NO_WINDOW).stdout
        except (OSError, subprocess.SubprocessError):
            return {}
        table = {}
        for line in out.splitlines():
            cells = [c.strip('"') for c in line.split('","')]
            if len(cells) >= 2 and cells[1].isdigit():
                table[int(cells[1])] = (0, cells[0])
        return table
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,comm="], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    table = {}
    for line in out.splitlines():
        cells = line.split(None, 2)
        if len(cells) == 3 and cells[0].isdigit() and cells[1].isdigit():
            table[int(cells[0])] = (int(cells[1]), os.path.basename(cells[2].strip()))
    return table


def running(prefixes: List[str]) -> List[str]:
    """The running executables whose name starts with one of the prefixes (case ignored)."""
    low = [str(p).lower() for p in prefixes if p]
    if not low:
        return []
    names = {name for _, name in process_table().values()}
    return sorted(n for n in names if any(n.lower().startswith(p) for p in low))


def pid_alive(pid: Any) -> bool:
    """Whether a process with this id exists. Unknown or invalid: False."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True  # someone else's process: it exists
        except OSError:
            return False
    # Windows: never os.kill here (any signal but the console ones terminates the process).
    try:
        import ctypes
        from ctypes import wintypes

        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.OpenProcess.restype = ctypes.c_void_p
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.WaitForSingleObject.restype = wintypes.DWORD
        k.WaitForSingleObject.argtypes = [ctypes.c_void_p, wintypes.DWORD]
        k.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = k.OpenProcess(0x00100000 | 0x1000, False, pid)  # SYNCHRONIZE | QUERY_LIMITED_INFORMATION
        if not handle:
            return ctypes.get_last_error() == 5  # access denied: it exists
        try:
            return k.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT: still running
        finally:
            k.CloseHandle(handle)
    except Exception:
        pass
    import subprocess

    try:
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True,
                             timeout=30, creationflags=NO_WINDOW).stdout
    except (OSError, subprocess.SubprocessError):
        return True  # cannot tell: do not declare anyone dead
    return f'"{pid}"' in out


# Programs that are a means of starting something, not the session an agent lives in.
_LAUNCHERS = {"python", "pythonw", "py", "bash", "sh", "zsh", "fish", "dash", "ksh", "cmd", "powershell", "pwsh",
              "conhost", "env", "aw", "git", "busybox", "winpty", "timeout", "nohup", "sudo", "time", "uv", "login",
              "mintty", "tmux", "screen"}


def _stem(name: str) -> str:
    stem = os.path.basename(name).lower()
    if stem.endswith(".exe"):
        stem = stem[:-4]
    return re.sub(r"[\d.]+$", "", stem)  # python3.12 -> python


def session_pid() -> int:
    """The process an agent's session lives in: what must stay alive for its entries in the store to count.

    ``AW_SESSION_PID`` when set; else ``CLAUDE_PID`` (Claude Code names its own process to the shells and hooks it
    starts) while that process runs; else the nearest ancestor of this command that is not a shell or a launcher
    (the agent tool that started the shell); else the furthest ancestor found.

    The variables come first because ancestry is not reliable everywhere: under Git Bash on Windows a pipe or an
    ``exec`` leaves a process whose parent is already gone, and the walk then ends at a shell that lives for one
    command. A session named after such a process would have a new name with every call.
    """
    env = os.environ.get("AW_SESSION_PID", "").strip()
    if env.isdigit() and int(env) > 0:
        return int(env)
    env = os.environ.get("CLAUDE_PID", "").strip()
    if env.isdigit() and int(env) > 0 and pid_alive(int(env)):
        return int(env)
    table = process_table()
    pid, best, seen = os.getpid(), os.getppid(), set()
    for _ in range(16):
        parent = table.get(pid, (0, ""))[0]
        if parent <= 1 or parent in seen or parent not in table:
            break
        seen.add(parent)
        best = parent
        if _stem(table[parent][1]) not in _LAUNCHERS:
            return parent
        pid = parent
    return best


def kill_tree(pid: int) -> None:
    import signal
    import subprocess

    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, timeout=30,
                           creationflags=NO_WINDOW)
        else:
            os.killpg(pid, signal.SIGTERM)  # the child leads its own session (start_new_session)
            time.sleep(3)
            os.killpg(pid, signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        pass


def run_child(command: List[str], env_extra: Dict[str, str], max_seconds: Optional[float],
              tick: Optional[Callable[[], None]] = None) -> Tuple[int, bool]:
    """Run a command; kill its process tree at the limit. (exit code, timed out).

    Several arguments are a program and its arguments; one argument is a shell line. ``tick`` is called once a minute
    while the command runs (a lock refreshes itself there).
    """
    import shutil
    import subprocess

    env = {**os.environ, **env_extra}
    shell = len(command) == 1
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
                at = time.monotonic()
                if max_seconds is not None and at - start >= max_seconds:
                    kill_tree(proc.pid)
                    return TIMED_OUT, True
                if tick is not None and at - last >= 60:
                    last = at
                    try:
                        tick()
                    except Exception:
                        pass
    finally:
        if proc.poll() is None:  # interrupted: do not leave the command behind
            kill_tree(proc.pid)


def split_command(parser: Any) -> None:
    """Make ``parser`` keep everything after the first ``--`` as ``args.command_line`` instead of parsing it.

    argparse would otherwise hand the wrapped command's own flags to ``aw``. The words after ``--`` are cut off
    before argparse sees them.
    """
    original = parser.parse_known_args

    def parse_known_args(args: Any = None, namespace: Any = None) -> Any:
        words = list(sys.argv[1:] if args is None else args)
        tail: List[str] = []
        if "--" in words:
            cut = words.index("--")
            words, tail = words[:cut], words[cut + 1:]
        ns, extra = original(words, namespace)
        ns.command_line = tail
        return ns, extra

    parser.parse_known_args = parse_known_args


# ------------------------------------------------------------------------------------------- who and which project

class Context:
    """Who is asking and for which project: resolved once per command."""

    def __init__(self, as_agent: Optional[str] = None, start: Any = None):
        self.cfg: Dict[str, Any] = common.load_config(start)
        self.project: str = common.project_id(start)
        root = common.main_root(start)
        self.root: Path = root if root is not None else Path(start or os.getcwd()).resolve()
        self.name: str = self.root.name or self.project
        self._as = as_agent
        self._agent: Optional[str] = None
        self.start = start

    @property
    def agent(self) -> str:
        if self._agent is None:
            self._agent = identity(self.cfg, self._as)
        return self._agent

    def stamp(self) -> None:
        """Note this project in projects.json (cheap: written at most every few hours)."""
        touch_project(self.project, self.root)


def identity(cfg: Optional[Dict[str, Any]] = None, explicit: Optional[str] = None) -> str:
    """The agent's name: ``--as``, else the environment (``common.agent_name``), else ``session-<pid>``.

    A coordination aid between cooperating agents, not a security boundary: a name is whatever its bearer says.
    """
    if explicit:
        if not AGENT_RE.match(explicit):
            raise CoordError(f"agent name '{explicit}': lower-case letters, digits and '-' only")
        return explicit
    name = common.agent_name(cfg)
    if name:
        clean = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")[:64]
        if clean:
            return clean
    return f"session-{session_pid()}"


def projects() -> Dict[str, Dict[str, Any]]:
    doc = common.read_json(home() / "projects.json", {})
    return doc if isinstance(doc, dict) else {}


def touch_project(project: str, root: Path) -> None:
    entry = projects().get(project)
    if isinstance(entry, dict) and entry.get("root") == common.posix(root) and age_seconds(entry.get("seen")) < 6 * 3600:
        return

    def change(doc: Dict[str, Any]) -> None:
        doc[project] = {"root": common.posix(root), "name": root.name or project, "seen": now()}

    try:
        update_json(home() / "projects.json", {}, change)
    except (OSError, CoordError):
        pass  # a list of projects seen is a convenience: never the reason a command fails


def project_name(project: Optional[str], known: Optional[Dict[str, Dict[str, Any]]] = None) -> str:
    if not project:
        return "?"
    entry = (known if known is not None else projects()).get(project)
    if isinstance(entry, dict) and entry.get("name"):
        return str(entry["name"])
    return re.sub(r"-[0-9a-f]{8}$", "", project)


def find_project(text: str) -> List[str]:
    """Project ids matching what a person typed: the id, the folder name, or a prefix of either."""
    known = projects()
    seen = set(known)
    try:
        seen |= {p.name for p in (home() / "projects").iterdir() if p.is_dir()}
    except OSError:
        pass
    low = text.lower()
    exact = [p for p in seen if p.lower() == low or project_name(p, known).lower() == low]
    return sorted(exact or [p for p in seen if p.lower().startswith(low)])


# ----------------------------------------------------------------------------------------------------------- notes

def note_path(project: Optional[str]) -> Path:
    return (project_dir(project) if project else home()) / "notes.log"


def append_note(project: Optional[str], who: str, text: str, max_bytes: Optional[float] = None) -> str:
    """One line on a project's notes log (``project`` None: the machine's). Returns the line."""
    line = f"{now()}  {who}  {' '.join(str(text).split())}"
    append_line(note_path(project), line, max_bytes)
    return line
