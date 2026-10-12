"""Shared helpers of the agent-works CLI, the hooks and the coordination store.

Standard library only, cheap to import: the guard hook loads this on every tool call.

Import convention: the plugin's ``cli`` directory is on ``sys.path`` (``aw.py`` and the hooks put it there), so modules
write ``import common`` and ``from coord import locks``. ``import cli.common`` gives the same module object (the
aliases at the bottom of this file), so a test may use either spelling.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

sys.dont_write_bytecode = True

CONFIG_REL = ".agents/agent-works.json"
CONFIG_VERSION = 1
OLD_KANBAN_REL = ".agents/board"

DEFAULTS: Dict[str, Any] = {
    "version": CONFIG_VERSION,
    "paths": {
        "memory": ".agents/memory",
        "kanban": ".agents/kanban",
        "briefs": ".agents/briefs",
        "decisions": ".agents/decisions",
        "glossary": ".agents/CONTEXT.md",
        "contracts": ".agents/contracts",
        "plan": ".agents/plan",
        "userDocs": "docs",
    },
    "tasks": {"home": "kanban"},
    "claude": {"twins": "generated"},
    "plugins": ["agent-works", "codebase-optimizer", "perceptual-loop"],  # the ones the root AGENTS.md introduces
    "budgets": {
        "rootAgentsLines": 200,
        "hubLines": 40,
        "contractLines": 120,
        "statusLines": 120,
        "memoryFileLines": 400,
        "memoryFolderFiles": 12,
        "indexHookChars": 160,
        "decisionLines": 150,
        "glossaryRowChars": 300,
        "briefLines": 120,
        "roundBriefLines": 80,
        "noteChars": 200,
    },
    "links": {"roots": [], "files": [], "planned": [], "notChecked": []},
    # names of Markdown files that say "a brief or a hand-over for agents": outside paths.briefs they are BRIEF_STRAY
    "briefs": {"stray": ["*brief*.md", "agent-*.md", "handoff*.md", "handover*.md"]},
    "dup": {"shingleWords": 12, "minWords": 14, "ignore": []},
    "kanban": {
        "staleStartDays": 7,  # a card in progress that nobody touched for this long: KANBAN_STALE_START
        "gateOwedDays": 3,    # a gate owed for this long: GATE_OWED_OLD
    },
    "guard": {
        "agentVar": "AW_AGENT",
        "agentVarAliases": ["PL_AGENT"],
        "ownerFiles": [],
        "ownerFilesEdit": "ask",
        "generated": [],
        "staging": {"blanket": "deny", "unseen": "deny"},
        "defaultBranch": {"names": ["main", "master"], "commit": "warn", "forcePush": "ask"},
        "rules": [],
        "log": True,
    },
    "resources": {},
    "lockOrder": [],
    "runs": [],
    "counters": {},
    "accept": [],  # findings the project decided are fine as they are: [{"code", "path", "why"}]
    "coordination": {
        "lockStaleMinutes": 45,    # a lock not refreshed for this long, with none of its processes running, is taken over
        "agentStaleMinutes": 120,  # an agent entry without a process id is dropped after this long without a beat
        "holdMinutes": 120,        # how long a held lease lasts unless it says otherwise
        "claimHours": 72,          # how long a claim on a counter lasts
        "learningChars": 6000,     # the size cap of one shared learning
        "logBytes": 262144,        # a notes log is rotated beyond this
    },
}

Pathish = Union[str, "os.PathLike[str]", None]


class AwError(Exception):
    """A usage or environment error: the caller prints it and exits 2."""


# --------------------------------------------------------------------------------------------------------- output

def _utf8_stdout() -> None:
    # A Windows console defaults to a legacy code page and raises on the first arrow or dash.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass


def emit(obj: Any, as_json: bool = False, text: Optional[str] = None) -> None:
    """Print one JSON document (``as_json``), else ``text``, else ``obj`` itself when it is a string."""
    _utf8_stdout()
    if as_json:
        json.dump(obj, sys.stdout, indent=2, sort_keys=False, default=str)
        sys.stdout.write("\n")
    elif text is not None:
        print(text)
    elif isinstance(obj, str):
        print(obj)
    else:
        json.dump(obj, sys.stdout, indent=2, sort_keys=False, default=str)
        sys.stdout.write("\n")


def fail(message: str, code: int = 2) -> "Any":
    print(message, file=sys.stderr)
    raise SystemExit(code)


# ----------------------------------------------------------------------------------------------------------- time

def now_iso() -> str:
    """UTC, second precision, ``2026-01-31T12:00:00Z``."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def today() -> str:
    return time.strftime("%Y-%m-%d", time.localtime())


# ---------------------------------------------------------------------------------------------------------- files

def read_text(path: Pathish, default: Optional[str] = None) -> Optional[str]:
    try:
        return Path(path).read_text(encoding="utf-8-sig")  # type: ignore[arg-type]
    except (OSError, UnicodeDecodeError, TypeError):
        return default


def read_json(path: Pathish, default: Any = None) -> Any:
    """The parsed file, or ``default`` when it is missing, unreadable or not JSON."""
    text = read_text(path)
    if text is None:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def atomic_write(path: Pathish, text: str) -> None:
    """Write through a temp file in the same folder and rename: a reader never sees half a file. LF line endings."""
    p = Path(path)  # type: ignore[arg-type]
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    for attempt in range(20):
        try:
            os.replace(tmp, p)
            return
        except PermissionError:
            # Windows: another process has the target open for a moment.
            if attempt == 19:
                try:
                    tmp.unlink()
                except OSError:
                    pass
                raise
            time.sleep(0.01 * (attempt + 1))


def write_json(path: Pathish, doc: Any) -> None:
    atomic_write(path, json.dumps(doc, indent=2) + "\n")


def exclusive_create(path: Pathish, text: str = "") -> bool:
    """Create the file only if it does not exist (O_EXCL). True when this call created it."""
    p = Path(path)  # type: ignore[arg-type]
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(str(p), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    except PermissionError:
        # Windows reports a file that is being deleted as a permission error.
        return False
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return True


def posix(path: Pathish) -> str:
    return str(path).replace("\\", "/")


def rel(path: Pathish, root: Pathish) -> str:
    """``path`` relative to ``root`` with forward slashes; the path itself when it is not under ``root``."""
    try:
        return posix(Path(path).resolve().relative_to(Path(root).resolve()))  # type: ignore[arg-type]
    except (ValueError, OSError, TypeError):
        return posix(path)


# ----------------------------------------------------------------------------------------------- repository roots

def _start(start: Pathish) -> Path:
    p = Path(start) if start else Path(os.getcwd())
    try:
        p = p.resolve()
    except OSError:
        pass
    return p if p.is_dir() or not p.exists() else p.parent


def repo_root(start: Pathish = None) -> Optional[Path]:
    """The working tree's top level: the first ancestor holding ``.git`` (a folder, or a file in a worktree)."""
    here = _start(start)
    for p in [here, *here.parents]:
        if (p / ".git").exists():
            return p
    return None


def git_dir(root: Path) -> Optional[Path]:
    """The git directory of the working tree at ``root`` (follows a worktree's ``.git`` file)."""
    dot = root / ".git"
    if dot.is_dir():
        return dot
    text = read_text(dot)
    if not text:
        return None
    m = re.match(r"\s*gitdir:\s*(.+?)\s*$", text, re.S)
    if not m:
        return None
    g = Path(m.group(1))
    if not g.is_absolute():
        g = root / g
    try:
        return g.resolve()
    except OSError:
        return g


def main_root(start: Pathish = None) -> Optional[Path]:
    """The MAIN working tree of the repository, so every linked worktree resolves to one place.

    Same answer as ``git rev-parse --git-common-dir`` (its parent), read from the files so no process is started.
    Falls back to ``repo_root``.
    """
    root = repo_root(start)
    if root is None:
        return None
    g = git_dir(root)
    if g is None or g == root / ".git":
        return root
    common = read_text(g / "commondir")
    if not common:
        return root  # a submodule: its own repository
    c = Path(common.strip())
    if not c.is_absolute():
        c = g / c
    try:
        c = c.resolve()
    except OSError:
        pass
    if c.name == ".git" and c.parent.is_dir():
        return c.parent
    return root


def git(args: List[str], cwd: Pathish = None, timeout: float = 20.0) -> Tuple[int, str]:
    """Run git read-only. (exit code, stdout); (127, "") when git is absent or the call fails."""
    try:
        r = subprocess.run(["git", *args], cwd=str(cwd) if cwd else None, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=timeout, stdin=subprocess.DEVNULL)
        return r.returncode, r.stdout
    except (OSError, subprocess.SubprocessError):
        return 127, ""


def current_branch(root: Pathish = None) -> Optional[str]:
    """The checked-out branch, read from HEAD without starting git; None when detached or outside a repository."""
    r = repo_root(root)
    g = git_dir(r) if r else None
    head = read_text(g / "HEAD") if g else None
    if not head:
        return None
    m = re.match(r"ref:\s*refs/heads/(.+?)\s*$", head)
    return m.group(1) if m else None


# --------------------------------------------------------------------------------------------------------- config

def find_config(start: Pathish = None) -> Optional[Path]:
    """The nearest ``.agents/agent-works.json`` at or above ``start`` (default: the working directory)."""
    here = _start(start)
    for p in [here, *here.parents]:
        c = p / ".agents" / "agent-works.json"
        if c.is_file():
            return c
    return None


def merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(base)
    for k, v in over.items():
        out[k] = merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def defaults() -> Dict[str, Any]:
    return json.loads(json.dumps(DEFAULTS))


def load_config(start: Pathish = None) -> Dict[str, Any]:
    """The project's config with the defaults merged in. Never raises.

    Extra keys: ``_path`` (the config file, when one was found), ``_root`` (the folder holding ``.agents``) and
    ``_error`` (the file exists but is not a JSON object: the defaults are returned with it).
    """
    cfg = defaults()
    path = find_config(start)
    if path is None:
        return cfg
    cfg["_path"] = str(path)
    cfg["_root"] = str(path.parent.parent)
    text = read_text(path)
    try:
        doc = json.loads(text if text is not None else "")
    except ValueError as e:
        cfg["_error"] = f"{CONFIG_REL} is not valid JSON: {e}"
        return cfg
    if not isinstance(doc, dict):
        cfg["_error"] = f"{CONFIG_REL} must hold a JSON object"
        return cfg
    out = merge(cfg, doc)
    out["_path"], out["_root"] = cfg["_path"], cfg["_root"]
    return out


def project_root(start: Pathish = None) -> Path:
    """Where a project-level tool works: the folder of the config, else the working tree's top, else ``start``."""
    c = find_config(start)
    if c is not None:
        return c.parent.parent
    return repo_root(start) or _start(start)


def config_path(cfg: Dict[str, Any], root: Pathish, key: str) -> Path:
    """A ``paths.<key>`` entry of the config as an absolute path under ``root``."""
    value = (cfg.get("paths") or {}).get(key) or DEFAULTS["paths"][key]
    p = Path(value)
    return p if p.is_absolute() else Path(root) / p  # type: ignore[arg-type]


def kanban_dir(cfg: Dict[str, Any], root: Pathish) -> Path:
    """The kanban folder. The old ``.agents/board`` is honoured while the new folder does not exist."""
    new = config_path(cfg, root, "kanban")
    old = Path(root) / OLD_KANBAN_REL  # type: ignore[arg-type]
    if not new.exists() and (old / "board.json").is_file():
        return old
    return new


def budget(cfg: Dict[str, Any], key: str) -> int:
    try:
        return int((cfg.get("budgets") or {}).get(key, DEFAULTS["budgets"][key]))
    except (TypeError, ValueError):
        return int(DEFAULTS["budgets"][key])


def project_id(start: Pathish = None) -> str:
    """``<main root folder name>-<8 hex of sha1 of its path>``: one id for a repository and all its worktrees."""
    root = main_root(start) or _start(start)
    key = os.path.normcase(str(root)).replace("\\", "/").rstrip("/")
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", root.name).strip("-") or "project"
    return f"{name}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:8]}"


def project_name(start: Pathish = None, cfg: Optional[Dict[str, Any]] = None) -> str:
    """The project's name for people: ``name`` in the config, else the folder name of the MAIN working tree.

    A linked worktree (``.claude/worktrees/agent-abc123``) therefore says the project's name and not its own
    folder's, so what one checkout generates is what every other would. A project kept below the top of a
    repository (its config in a sub-folder) keeps that folder's name. ``project_id`` is not derived from this.
    """
    if cfg is None:
        cfg = load_config(start)
    given = cfg.get("name")
    if isinstance(given, str) and given.strip():
        return given.strip()
    root = project_root(start)
    if (root / ".git").exists():
        root = main_root(root) or root
    return root.name or "project"


def aw_home() -> Path:
    """The machine-wide store: ``AGENT_WORKS_HOME`` or ``~/.agent-works``. Created by the first write, not here."""
    env = os.environ.get("AGENT_WORKS_HOME")
    return Path(env).expanduser() if env else Path.home() / ".agent-works"


def project_home(start: Pathish = None) -> Path:
    """This project's folder in the store: ``<aw_home>/projects/<project_id>``."""
    return aw_home() / "projects" / project_id(start)


def agent_name(cfg: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """The agent's name: the env var named by ``guard.agentVar``, then its aliases, then ``CLAUDE_AGENT_NAME``."""
    guard = (cfg if cfg is not None else load_config()).get("guard") or {}
    names = [guard.get("agentVar") or "AW_AGENT", *(guard.get("agentVarAliases") or []), "CLAUDE_AGENT_NAME"]
    for n in names:
        v = os.environ.get(str(n), "").strip()
        if v:
            return v
    return None


# ------------------------------------------------------------------------------------------------------- findings

LEVELS = ("critical", "warning", "info")


@dataclass
class Finding:
    code: str
    level: str  # critical | warning | info
    path: str = ""
    line: int = 0
    message: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def text(self) -> str:
        where = self.path + (f":{self.line}" if self.line else "")
        return f"{self.level.upper():8} {self.code:22} {where}{' — ' if where else ''}{self.message}"


# Every finding code a check can report. `accept` in the config names one of these; a test holds the list to the code.
CODES = (
    "ACCEPT_UNUSED",
    "BRIEF_SIZE", "BRIEF_STRAY", "BRIEF_UNTRACKED",
    "CLAUDE_CHAIN", "CONFIG_INVALID", "CONTRACT_MISSING", "CONTRACT_STALE",
    "DEC_AMENDED", "DEC_INDEX_HANDWRITTEN", "DEC_INDEX_STALE", "DEC_NUMBER", "DEC_SECTIONS", "DEC_SIZE",
    "DOCS_AGENT_FILE", "DUP_RULE",
    "GATE_OWED_OLD", "GEN_TWIN_MISSING", "GEN_TWIN_ORPHAN", "GLOSSARY_DUP_TERM", "GLOSSARY_MULTI", "GLOSSARY_ROW_LONG",
    "HUB_ISOLATION", "HUB_MISSING", "HUB_MIXED_DIR", "HUB_ROOT_MISSING", "HUB_STALE_CHILD", "HUB_UNLISTED_CHILD",
    "KANBAN_CARD_INVALID", "KANBAN_OLD_FOLDER", "KANBAN_STALE_START", "KANBAN_STATUS_UNKNOWN", "KANBAN_UNTRACKED",
    "LINK_BROKEN",
    "MEM_FILE_SIZE", "MEM_FOLDER_OVER", "MEM_FRONTMATTER", "MEM_HOOK_LONG", "MEM_INDEX_HANDWRITTEN",
    "MEM_INDEX_PLACEHOLDER", "MEM_INDEX_STALE", "MEM_LINK_DANGLING", "MEM_NAME_MISMATCH", "MEM_ROOT_LOOSE",
    "MEM_SHARED_CANDIDATE", "MEM_SLUG_DUP",
    "PATH_MISSING",
    "ROOT_PLUGINS", "ROOT_SIZE", "ROOT_STATUS_PROSE",
    "STATUS_DONE_SECTION", "STATUS_MULTI", "STATUS_SIZE",
    "TASKS_TWO_HOMES",
)
# Never accepted, whatever the config says: a broken config, the report about the list itself, and (by level, in
# `split_accepted`) every critical finding.
NEVER_ACCEPTED = ("CONFIG_INVALID", "ACCEPT_UNUSED")


def _accept_path(value: Any) -> str:
    text = posix(value).strip()
    while text.startswith("./"):
        text = text[2:]
    return text.rstrip("/") or text


def accept_entries(cfg: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """``accept`` of the config as (the entries that hold, what is wrong with the others).

    An entry holds when it is ``{"code": <a finding code>, "path": <an exact path or a glob>, "why": <a reason>}``,
    all three non-empty. Each good entry carries its place in the list as ``index``.
    """
    raw = cfg.get("accept")
    if raw is None:
        return [], []
    if not isinstance(raw, list):
        return [], ["\"accept\" must be a list"]
    good: List[Dict[str, Any]] = []
    bad: List[str] = []
    for i, e in enumerate(raw):
        at = f"accept[{i}]"
        if not isinstance(e, dict):
            bad.append(f"{at}: an entry is {{\"code\": …, \"path\": …, \"why\": …}}, not {json.dumps(e)}")
            continue
        code, path, why = e.get("code"), e.get("path"), e.get("why")
        if not isinstance(code, str) or code not in CODES:
            bad.append(f"{at}: \"code\" {json.dumps(code)} is not a finding code (aw doctor --json lists the codes it found)")
        elif code in NEVER_ACCEPTED:
            bad.append(f"{at}: {code} is never accepted")
        elif not isinstance(path, str) or not path.strip():
            bad.append(f"{at}: \"path\" is the finding's path, or a glob over paths, as a non-empty string")
        elif not isinstance(why, str) or not why.strip():
            bad.append(f"{at}: \"why\" is required: the reason this finding stays, in a sentence")
        else:
            good.append({"index": i, "code": code, "path": _accept_path(path), "why": why.strip()})
    return good, bad


def split_accepted(findings: Iterable[Finding], cfg: Optional[Dict[str, Any]]) -> Tuple[List[Finding], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(the findings that stay, the accepted ones as dicts with their ``why``, the entries with what they met).

    A finding is accepted when an entry names its code and its path (exactly, or as a glob in which ``*`` also
    crosses ``/``). A critical finding is never accepted. Each entry comes back with ``used`` (it took a finding)
    and ``critical`` (it met only findings that cannot be accepted), which is what ACCEPT_UNUSED is made of.
    """
    import fnmatch

    entries, _ = accept_entries(cfg or {})
    entries = [dict(e, used=False, critical=False) for e in entries]
    kept: List[Finding] = []
    accepted: List[Dict[str, Any]] = []
    for f in findings:
        path = _accept_path(f.path)
        hit = next((e for e in entries if e["code"] == f.code and (e["path"] == path or fnmatch.fnmatchcase(path, e["path"]))), None)
        if hit is None or f.code in NEVER_ACCEPTED:
            kept.append(f)
        elif f.level == "critical":
            hit["critical"] = True
            kept.append(f)
        else:
            hit["used"] = True
            accepted.append({**f.to_dict(), "why": hit["why"]})
    return kept, accepted, entries


ACCEPTED_HINT = "aw doctor --accepted lists them"


def accepted_line(accepted: List[Dict[str, Any]]) -> str:
    return f"{len(accepted)} accepted ({ACCEPTED_HINT})"


def exit_for(findings: Iterable[Finding]) -> int:
    """2 with a critical finding, 1 with a warning, else 0 (info never fails a run)."""
    levels = {f.level for f in findings}
    return 2 if "critical" in levels else 1 if "warning" in levels else 0


def sort_findings(findings: Iterable[Finding]) -> List[Finding]:
    return sorted(findings, key=lambda f: (LEVELS.index(f.level) if f.level in LEVELS else 9, f.code, f.path, f.line))


def findings_doc(findings: Iterable[Finding], extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The one JSON shape of every finding list (other plugins read it):
    ``{"summary": {"critical": n, "warning": n, "info": n}, "findings": [{code, level, path, line, message}]}``,
    plus the check's own keys before them."""
    fs = sort_findings(findings)
    doc: Dict[str, Any] = dict(extra or {})
    doc["summary"] = {lv: sum(1 for f in fs if f.level == lv) for lv in LEVELS}
    doc["findings"] = [f.to_dict() for f in fs]
    return doc


def report(findings: Iterable[Finding], as_json: bool = False, title: str = "", extra: Optional[Dict[str, Any]] = None,
           cfg: Optional[Dict[str, Any]] = None) -> int:
    """Print a check's findings the one way every ``aw`` check does, and return its exit code.

    The findings the project accepted (``accept`` in the config; ``cfg``, else the config found from the working
    directory) are taken out first: they are not counted and do not fail the run. In JSON they are listed under
    ``accepted``, a key that is there only when something was accepted.
    """
    fs, accepted, _ = split_accepted(sort_findings(findings), cfg if cfg is not None else load_config())
    code = exit_for(fs)
    counts = {lv: sum(1 for f in fs if f.level == lv) for lv in LEVELS}
    if as_json:
        emit(findings_doc(fs, {**(extra or {}), **({"accepted": accepted} if accepted else {})}), True)
        return code
    lines = [f.text() for f in fs]
    if accepted:
        lines.append(accepted_line(accepted))
    summary = ", ".join(f"{n} {lv}" for lv, n in counts.items() if n) or "clean"
    lines.append(f"{title + ': ' if title else ''}{summary}")
    emit("\n".join(lines))
    return code


# ---------------------------------------------------------------------------------------------------- frontmatter

_FM = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)", re.S)


def _scalar(v: str) -> Any:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [_scalar(x) for x in re.split(r",\s*", inner)] if inner else []
    return v


def parse_frontmatter(text: str) -> Tuple[Optional[Dict[str, Any]], str]:
    """(fields, body) of a Markdown file. Fields is None without a ``---`` block.

    The small subset the agent files use: ``key: value``, inline lists, ``- item`` lists and one level of nesting.
    """
    m = _FM.match(text)
    if not m:
        return None, text
    fields: Dict[str, Any] = {}
    key: Optional[str] = None
    for raw in m.group(1).splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[0] in " \t" and key is not None:
            item = raw.strip()
            if item.startswith("- "):
                if not isinstance(fields.get(key), list):
                    fields[key] = []
                fields[key].append(_scalar(item[2:]))
            elif ":" in item:
                if not isinstance(fields.get(key), dict):
                    fields[key] = {}
                k, _, v = item.partition(":")
                fields[key][k.strip()] = _scalar(v)
            continue
        if ":" not in raw:
            continue
        k, _, v = raw.partition(":")
        key = k.strip()
        fields[key] = _scalar(v) if v.strip() else ""
    return fields, text[m.end():]




# ------------------------------------------------------------------------------------------------------ templates

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = PLUGIN_ROOT / "assets" / "templates"


def template(name: str, **values: Any) -> str:
    """The plugin's template ``assets/templates/<name>`` with its ``{{key}}`` places filled.

    The one way a template is read, and the files are the one copy of each: nothing is kept a second time in code.
    A place nobody filled stays visible as ``{{key}}`` rather than vanishing.
    """
    text = read_text(TEMPLATES / name)
    if text is None:
        raise AwError(f"the plugin's template assets/templates/{name} is missing: the installation is incomplete")
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", str(value))
    return text


PLUGINS_BLOCK = re.compile(r"<!-- agent-works:plugins\b.*?<!-- /agent-works:plugins -->\n?", re.S)


def plugins_block(cfg: Optional[Dict[str, Any]] = None) -> str:
    """The section of the root AGENTS.md that introduces the plugins of ``plugins`` in the config ("" for none).

    Every session, and every sub-agent, loads the root file: this is what primes them to open a skill when its case
    comes up. One copy, the template; a row is kept when its plugin is in the list.
    """
    names = (cfg or {}).get("plugins")
    if names is None:
        names = DEFAULTS["plugins"]
    names = [str(n) for n in names] if isinstance(names, list) else []
    if not names:
        return ""
    out = []
    for line in template("agents-plugins.md").replace("\r\n", "\n").splitlines():
        m = re.match(r"^\| \*\*([^*]+)\*\* \|", line)
        if m and m.group(1) not in names:
            continue
        out.append(line)
    return "\n".join(out) + "\n"


def with_plugins_block(text: str, block: str) -> str:
    """``text`` (a root AGENTS.md) with the plugins section put in or brought up to date, nothing else touched."""
    text = text.replace("\r\n", "\n")
    if PLUGINS_BLOCK.search(text):
        return PLUGINS_BLOCK.sub(lambda _: block, text, count=1)
    if not block:
        return text
    heads = [m.start() for m in re.finditer(r"^## ", text, re.M)]
    if len(heads) >= 2:  # after the first section (what the project is), before the rest
        return text[:heads[1]] + block + "\n" + text[heads[1]:]
    return text + ("" if text.endswith("\n") else "\n") + "\n" + block


def plugin_version() -> str:
    doc = read_json(PLUGIN_ROOT / ".claude-plugin" / "plugin.json", {})
    return str(doc.get("version") or "0.0.0") if isinstance(doc, dict) else "0.0.0"


def line_count(text: str) -> int:
    return text.count("\n") + (1 if text and not text.endswith("\n") else 0)


# ------------------------------------------------------------------- indexes: generated, or written by hand
# An index (a memory folder's INDEX.md, the decisions' README.md) is generated when one of its first lines is the
# marker its command writes. Any other is hand-written, and is never rewritten as a side effect.

def index_kind(index: Pathish, marker: str, within: int = 2) -> str:
    """"missing", "generated" (the marker is one of its first ``within`` lines) or "handwritten"."""
    text = read_text(index)
    if text is None:
        return "missing"
    return "generated" if any(l.strip() == marker for l in text.splitlines()[:within]) else "handwritten"


def lines_lost(have: str, generated: str) -> int:
    """How many lines of an index say something the generated one would not: what generating it loses."""
    keep = {l.strip() for l in generated.splitlines()}
    return sum(1 for l in have.splitlines() if l.strip() and l.strip() not in keep)


def read_raw(path: Pathish) -> Optional[str]:
    """The file's text with its line endings (and a byte order mark) as they are, so a write changes nothing else."""
    try:
        with open(path, "r", encoding="utf-8", newline="") as f:  # type: ignore[arg-type]
            return f.read()
    except (OSError, UnicodeDecodeError):
        return None


def append_list_line(path: Pathish, line: str) -> bool:
    """Add one list line to a hand-written index, after its last list line (at the end when it has none)."""
    raw = read_raw(path)
    if raw is None:
        return False
    nl = "\r\n" if "\r\n" in raw else "\n"
    rows = raw.splitlines(keepends=True)
    last = max((i for i, r in enumerate(rows) if r.startswith(("- [", "* ["))), default=None)
    if last is None:
        gap = "" if not raw else (nl if raw.endswith(("\n", "\r")) else nl + nl)
        atomic_write(path, raw + gap + line + nl)
        return True
    if not rows[last].endswith(("\n", "\r")):
        rows[last] += nl
    rows.insert(last + 1, line + nl)
    atomic_write(path, "".join(rows))
    return True


def markdown_files(root: Pathish) -> List[Path]:
    """The Markdown files of a tree that git knows or would add; without git, a walk that skips dependency folders."""
    root = Path(root)  # type: ignore[arg-type]
    code, out = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"], root)
    if code == 0:
        return sorted({root / l.strip().strip('"') for l in out.splitlines() if l.strip() and (root / l.strip().strip('"')).is_file()})
    skip = {"node_modules", "build", "dist", "target", "out", "vendor", "__pycache__", "venv", ".git"}
    found = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in skip and (not d.startswith(".") or d == ".agents")]
        found += [Path(base) / f for f in files if f.lower().endswith(".md")]
    return sorted(found)


# The same module under both spellings (see the docstring).
sys.modules.setdefault("common", sys.modules[__name__])
sys.modules.setdefault("cli.common", sys.modules[__name__])
