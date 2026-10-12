"""aw links: the agent files point at things that exist.

    aw links [file.md | folder …] [--json]

  LINK_BROKEN   a relative Markdown link ([text](target), anchors ignored) that resolves to nothing
  PATH_MISSING  a repository path written in code (`src/app/cli.ts`, also inside a command or a fenced block) that is
                not there. A glob (`*`, `{a,b}`) must match something; a path with a placeholder (`<id>`, `…`) is
                checked up to it.

Default targets: the root AGENTS.md, every hub, the Markdown under .agents/, and `links.files`. Links are checked in all of them.
Paths in code are checked in the files that describe the present (hubs, the glossary, decisions,
contracts, briefs) and not in memory, which records what was true on its date, nor in the generated
.agents/README.md, which names homes a project may not have yet. The kanban and plan folders are left
out: cards and plans quote freely, and plans have their own verifiers.

Config (`links` in .agents/agent-works.json):
  files       Markdown files or folders read as well by default, relative to the top (the root README.md); one that
              is not there is skipped
  roots       top-level folders whose paths are checked when written in code (default: every top-level folder git
              tracks, and .agents)
  planned     paths named before they exist; remove an entry when its work lands
  notChecked  build output and look-alike paths that are never checked
"""
from __future__ import annotations

import argparse
import glob as globlib
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import unquote

import common
from common import Finding

LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
CODE_SPAN = re.compile(r"`([^`]+)`")
SKIP_TOP = {"node_modules", "build", "dist", "target", "out", "vendor", "__pycache__", "venv"}


def roots_of(root: Path, cfg: Dict[str, Any]) -> List[str]:
    given = [str(r).strip("/") for r in (cfg.get("links") or {}).get("roots") or [] if str(r).strip("/")]
    if given:
        return given
    code, out = common.git(["ls-files", "--cached", "--others", "--exclude-standard"], root)
    tops = set()
    if code == 0:
        tops = {l.split("/", 1)[0].strip('"') for l in out.splitlines() if "/" in l}
    else:
        try:
            tops = {p.name for p in root.iterdir() if p.is_dir()}
        except OSError:
            tops = set()
    tops = {t for t in tops if t not in SKIP_TOP and (not t.startswith(".") or t == ".agents")}
    if (root / ".agents").is_dir():
        tops.add(".agents")
    return sorted(tops)


def default_targets(root: Path, cfg: Dict[str, Any]) -> List[Path]:
    skip = [common.kanban_dir(cfg, root), common.config_path(cfg, root, "plan"), root / common.OLD_KANBAN_REL]
    files = []
    for md in common.markdown_files(root):
        r = common.rel(md, root)
        if md.name == "AGENTS.md" or r.startswith(".agents/"):
            if not any(s == md or s in md.parents for s in skip):
                files.append(md)
    # links.files: Markdown the project wants read as well (the root README.md, a folder of pages).
    for extra in (cfg.get("links") or {}).get("files") or []:
        try:
            more = expand_targets(root, [str(extra)]) if (root / str(extra)).exists() else []
        except common.AwError:
            more = []
        files += [m for m in more if m not in files]
    return files


def expand_targets(root: Path, targets: Iterable[str]) -> List[Path]:
    out: List[Path] = []
    for t in targets:
        full = (root / t) if not os.path.isabs(t) else Path(t)
        if not full.exists():
            raise common.AwError(f"no such file or folder: {t}")
        if full.is_dir():
            for base, dirs, files in os.walk(full):
                dirs[:] = sorted(d for d in dirs if d not in SKIP_TOP and d != ".git")
                out += [Path(base) / f for f in sorted(files) if f.lower().endswith(".md")]
        else:
            out.append(full)
    return out


def _braces(pattern: str) -> List[str]:
    m = re.search(r"\{([^{}]*)\}", pattern)
    if not m:
        return [pattern]
    return [x for alt in m.group(1).split(",") for x in _braces(pattern[:m.start()] + alt + pattern[m.end():])]


class Checker:
    def __init__(self, root: Path, cfg: Dict[str, Any]):
        self.root = root
        links = cfg.get("links") or {}
        self.planned = [str(p).strip("/") for p in [*(links.get("planned") or []), *(links.get("notChecked") or [])]]
        roots = roots_of(root, cfg)
        self.path_in_code = (re.compile(r"(?:^|[\s\"'(=`])((?:" + "|".join(re.escape(r) for r in roots) + r")/(?:[^\s\"'`),;{]|\{[^}\s]*\})*)")
                             if roots else None)
        memory = common.config_path(cfg, root, "memory")
        self.no_paths = [memory]  # memory records what was true on its date
        self.no_paths_files = [root / ".agents" / "README.md"]  # the generated page names homes that may not exist yet
        self.links = 0
        self.paths = 0

    def is_planned(self, path: str) -> bool:
        return any(path == p or path.startswith(p + "/") for p in self.planned)

    def path_exists(self, written: str) -> bool:
        path = re.sub(r"[.,;:]+$", "", written).rstrip("/")
        if self.is_planned(path):
            return True
        cut = re.search(r"[<…$%]|\.\.\.", path)
        if cut:
            path = path[:cut.start()]
            path = path[:path.rfind("/")] if "/" in path else ""  # "pkg/x/<name>.ts" -> the folder
            if not path or self.is_planned(path):
                return True
        if re.search(r"[*{\[]", path):
            return any(globlib.glob(str(self.root / p), recursive=True) for p in _braces(path))
        return (self.root / path).exists()

    def check(self, file: Path) -> List[Finding]:
        out: List[Finding] = []
        rel = common.rel(file, self.root)
        text = common.read_text(file)
        if text is None:
            return out
        with_paths = (self.path_in_code is not None and file not in self.no_paths_files
                      and not any(d in file.parents for d in self.no_paths))
        fenced = False
        for n, line in enumerate(text.splitlines(), 1):
            if re.match(r"^\s*(```|~~~)", line):
                fenced = not fenced
                continue
            if with_paths:
                for span in ([line] if fenced else CODE_SPAN.findall(line)):
                    for m in self.path_in_code.finditer(span):  # type: ignore[union-attr]
                        self.paths += 1
                        if not self.path_exists(m.group(1)):
                            out.append(Finding("PATH_MISSING", "warning", rel, n, f"no such path: {m.group(1)}"))
            if fenced:
                continue
            for m in LINK.finditer(CODE_SPAN.sub("", line)):
                target = m.group(1)
                if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                    continue  # http:, mailto:, an anchor
                self.links += 1
                path = unquote(target.split("#")[0]).strip("<>")
                full = (self.root / path.lstrip("/")) if path.startswith("/") else (file.parent / path)
                try:
                    in_repo = common.rel(Path(os.path.normpath(full)), self.root)
                except (OSError, ValueError):
                    in_repo = path
                if not Path(os.path.normpath(full)).exists() and not self.is_planned(in_repo):
                    out.append(Finding("LINK_BROKEN", "warning", rel, n, f"broken link: {target}"))
        return out


def findings(root: Path, cfg: Optional[Dict[str, Any]] = None, targets: Optional[List[str]] = None) -> Dict[str, Any]:
    """{"findings", "files", "links", "paths"} for the targets (default: the agent files)."""
    cfg = cfg if cfg is not None else common.load_config(root)
    files = expand_targets(root, targets) if targets else default_targets(root, cfg)
    checker = Checker(root, cfg)
    found: List[Finding] = []
    for f in files:
        found += checker.check(f)
    return {"findings": found, "files": len(files), "links": checker.links, "paths": checker.paths}


def run(args: argparse.Namespace) -> int:
    root = common.project_root()
    res = findings(root, common.load_config(root), args.paths or None)
    extra = {"files": res["files"], "links": res["links"], "paths": res["paths"]}
    return common.report(res["findings"], args.json,
                         f"links: {res['files']} files, {res['links']} relative links, {res['paths']} paths in code", extra)


def register(subparsers: Any) -> None:
    p = subparsers.add_parser("links", help="check the links and paths of the agent files", description=__doc__,
                              formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("paths", nargs="*", help="Markdown files or folders (default: AGENTS.md, every hub, .agents/)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=run)
