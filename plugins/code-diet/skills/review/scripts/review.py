#!/usr/bin/env python3
"""Deterministic over-engineering signal scanner for the code-diet review skill.

It LOCATES cut candidates; it never judges (the model does that in SKILL.md
step 2 with references/signals.md). Every count, diff stat, and net-lines
figure is computed here so the skill never re-derives arithmetic in prose.

argv:
  --scope diff|repo   default diff. diff = the working change (staged +
                      unstaged + untracked) vs --base; repo = the whole tree.
  --base <ref>        default HEAD. The diff is computed against this ref;
                      when HEAD has no commit yet the empty tree is used.
  --selftest          run the assert self-check and exit.

stdout: one JSON object
  {"scope": str,
   "diff": {"files": int, "insertions": int, "deletions": int, "net": int}
           | null   (null when scope == "repo"),
   "candidates": [{"kind": str, "file": str, "line": int,
                   "symbol": str, "detail": str}, ...],
   "counts": {<kind>: int}}
  kinds: single-caller-wrapper, dep-duplicates-stdlib, dead-flag,
         uncalled-symbol, single-impl-abstraction.

exit: 0 on success (even with zero candidates); 1 when the cwd is not a git
work tree, git fails, or --base does not resolve (message on stderr).
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

sys.dont_write_bytecode = True

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv",
    ".next", "target", "coverage", ".mypy_cache", ".pytest_cache", ".tox",
    "vendor", ".git-rewrite",
}
SRC_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}
MAX_BYTES = 512 * 1024

# dependency top-level name -> the stdlib / native feature that replaces it.
# debt: hand-kept map, widen when a review keeps missing a common dep.
STDLIB_DUPES = {
    "requests": "urllib.request (stdlib) for simple GETs",
    "six": "Python 3 builtins",
    "ujson": "json (stdlib)",
    "simplejson": "json (stdlib)",
    "pytz": "zoneinfo (stdlib, 3.9+)",
    "toml": "tomllib (stdlib, 3.11+)",
    "attr": "dataclasses (stdlib)",
    "attrs": "dataclasses (stdlib)",
    "dateutil": "datetime.fromisoformat / zoneinfo (stdlib)",
    "lodash": "native Array/Object methods",
    "underscore": "native Array/Object methods",
    "moment": "Intl.DateTimeFormat / Date",
    "left-pad": "String.prototype.padStart",
    "is-array": "Array.isArray",
    "uuid": "crypto.randomUUID()",
    "node-fetch": "native fetch()",
    "isomorphic-fetch": "native fetch()",
    "request": "native fetch()",
    "axios": "native fetch()",
    "querystring": "URLSearchParams",
    "mkdirp": "fs.mkdir(path, {recursive: true})",
    "rimraf": "fs.rm(path, {recursive: true})",
}
ENTRYPOINTS = {"main", "handler", "setup", "teardown", "default", "index"}

PY_DEF = re.compile(r"^(\s*)def\s+([A-Za-z_]\w*)\s*\(")
PY_CLASS = re.compile(r"^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?")
JS_FUNC = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)")
JS_ARROW = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>")
JS_CLASS = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$.]*))?")
CALL = re.compile(r"([A-Za-z_$][\w$]*)\s*\(")
FLAG_PARAM = re.compile(r"([A-Za-z_]\w*)\s*=\s*(?:True|False|true|false)\b")
PY_IMPORT = re.compile(r"^\s*(?:import\s+([A-Za-z_]\w*)|from\s+([A-Za-z_]\w*)[\w.]*\s+import)")
JS_IMPORT = re.compile(r"""(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])""")


def git(args, cwd):
    return subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)


def fail(msg):
    sys.stderr.write(msg.rstrip() + "\n")
    return 1


def should_skip(relpath):
    parts = relpath.replace("\\", "/").split("/")
    if any(p in SKIP_DIRS for p in parts):
        return True
    return relpath.endswith((".min.js", ".d.ts", ".bundle.js"))


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read()
    except OSError:
        return ""


def lang_of(relpath):
    ext = os.path.splitext(relpath)[1]
    if ext == ".py":
        return "py"
    if ext in SRC_EXT:
        return "js"
    return None


def source_files(root):
    r = git(["ls-files"], root)
    u = git(["ls-files", "--others", "--exclude-standard"], root)
    out, seen = [], set()
    for rel in r.stdout.splitlines() + u.stdout.splitlines():
        rel = rel.strip()
        if not rel or rel in seen or should_skip(rel) or lang_of(rel) is None:
            continue
        p = os.path.join(root, rel)
        try:
            if os.path.getsize(p) > MAX_BYTES:
                continue
        except OSError:
            continue
        seen.add(rel)
        out.append(rel)
    return out


def resolve_base(base, root):
    r = git(["rev-parse", "--verify", "--quiet", base + "^{commit}"], root)
    if r.returncode == 0:
        return base
    if base == "HEAD":
        return EMPTY_TREE  # no commits yet: diff against the empty tree
    return None


def diff_stats(base, root):
    r = git(["diff", "--numstat", base], root)
    ins = dels = 0
    files = set()
    for line in r.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            a, d, f = parts[0], parts[1], parts[2]
            if a != "-":
                ins += int(a)
            if d != "-":
                dels += int(d)
            files.add(f)
    for f in git(["ls-files", "--others", "--exclude-standard"], root).stdout.splitlines():
        f = f.strip()
        if f and not should_skip(f):
            ins += read_text(os.path.join(root, f)).count("\n") + 1
            files.add(f)
    return {"files": len(files), "insertions": ins, "deletions": dels, "net": ins - dels}


def changed_lines(base, root):
    r = git(["diff", "--unified=0", base], root)
    result = defaultdict(set)
    cur = None
    for line in r.stdout.splitlines():
        if line.startswith("+++ "):
            p = line[4:].strip()
            cur = p[2:] if p.startswith("b/") else (None if p == "/dev/null" else p)
        elif line.startswith("@@") and cur:
            m = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if m:
                start = int(m.group(1))
                cnt = int(m.group(2) or "1")
                for ln in range(start, start + max(cnt, 1)):
                    result[cur].add(ln)
    for f in git(["ls-files", "--others", "--exclude-standard"], root).stdout.splitlines():
        f = f.strip()
        if f and not should_skip(f):
            n = read_text(os.path.join(root, f)).count("\n") + 1
            result[f] = set(range(1, n + 1))
    return result


def py_block_span(lines, start, indent):
    end = start
    i = start + 1
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped:
            ind = len(lines[i]) - len(lines[i].lstrip())
            if ind <= indent:
                break
            end = i
        i += 1
    return end - start + 1


def js_block_span(lines, start):
    depth = 0
    started = False
    for i in range(start, len(lines)):
        for ch in lines[i]:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}":
                depth -= 1
        if started and depth <= 0:
            return i - start + 1
    return 1


def extract(relpath, text):
    """Return (defs, classes, imports) for one file. Positions are 1-indexed."""
    lines = text.splitlines()
    lang = lang_of(relpath)
    defs, classes, imports = [], [], []
    for idx, line in enumerate(lines):
        if lang == "py":
            m = PY_DEF.match(line)
            if m:
                indent = len(m.group(1))
                span = py_block_span(lines, idx, indent)
                paren = line[line.find("(") + 1:]
                defs.append({"file": relpath, "line": idx + 1, "name": m.group(2),
                             "span": span, "flags": FLAG_PARAM.findall(paren)})
                continue
            m = PY_CLASS.match(line)
            if m:
                indent = len(m.group(1))
                span = py_block_span(lines, idx, indent)
                bases = [b.strip().split("[")[0] for b in (m.group(3) or "").split(",") if b.strip()]
                body = "\n".join(lines[idx:idx + span])
                abstract = (any(b in ("ABC", "ABCMeta", "Protocol") for b in bases)
                            or "@abstractmethod" in body or "NotImplementedError" in body)
                classes.append({"file": relpath, "line": idx + 1, "name": m.group(2),
                                "span": span, "bases": bases, "abstract": abstract})
                continue
            m = PY_IMPORT.match(line)
            if m:
                imports.append({"file": relpath, "line": idx + 1, "mod": m.group(1) or m.group(2)})
        elif lang == "js":
            m = JS_FUNC.match(line) or JS_ARROW.match(line)
            if m:
                span = js_block_span(lines, idx)
                paren = line[line.find("(") + 1:] if "(" in line else ""
                defs.append({"file": relpath, "line": idx + 1, "name": m.group(1),
                             "span": span, "flags": FLAG_PARAM.findall(paren)})
            m = JS_CLASS.match(line)
            if m:
                span = js_block_span(lines, idx)
                bases = [m.group(2)] if m.lastindex and m.group(2) else []
                classes.append({"file": relpath, "line": idx + 1, "name": m.group(1),
                                "span": span, "bases": bases,
                                "abstract": "abstract" in line or bool(bases)})
            for a, b in JS_IMPORT.findall(line):
                spec = a or b
                if spec and not spec.startswith("."):
                    imports.append({"file": relpath, "line": idx + 1, "mod": spec.split("/")[0]})
    return defs, classes, imports


def is_entrypoint(name):
    return (name in ENTRYPOINTS or name.startswith("test")
            or (name.startswith("__") and name.endswith("__")))


def scan(scope, base, root):
    files = source_files(root)
    corpus = {f: read_text(os.path.join(root, f)) for f in files}
    corpus_text = "\n".join(corpus.values())

    call_tally = Counter(CALL.findall(corpus_text))
    all_defs, all_classes, all_imports = [], [], []
    defs_count = Counter()
    subclass_count = Counter()
    flag_default_count = Counter()
    for f, text in corpus.items():
        d, c, im = extract(f, text)
        all_defs += d
        all_classes += c
        all_imports += im
        for x in d:
            defs_count[x["name"]] += 1
            for flag in x["flags"]:
                flag_default_count[flag] += 1
        for x in c:
            for b in x["bases"]:
                subclass_count[b] += 1

    if scope == "repo":
        in_scope = lambda f, ln: True
        diff = None
    else:
        changed = changed_lines(base, root)
        in_scope = lambda f, ln: ln in changed.get(f, ())
        diff = diff_stats(base, root)

    seen = set()
    candidates = []

    def add(kind, f, line, symbol, detail):
        key = (kind, f, line, symbol)
        if key not in seen:
            seen.add(key)
            candidates.append({"kind": kind, "file": f, "line": line,
                               "symbol": symbol, "detail": detail})

    for x in all_classes:
        if not in_scope(x["file"], x["line"]):
            continue
        if x["abstract"] and subclass_count[x["name"]] <= 1:
            n = subclass_count[x["name"]]
            add("single-impl-abstraction", x["file"], x["line"], x["name"],
                f"abstract class, {n} implementation(s), ~{x['span']} lines")

    for x in all_defs:
        if not in_scope(x["file"], x["line"]):
            continue
        for flag in x["flags"]:
            uses = len(re.findall(r"\b" + re.escape(flag) + r"\s*=", corpus_text))
            if uses - flag_default_count[flag] <= 0:
                add("dead-flag", x["file"], x["line"], f"{x['name']}({flag}=)",
                    "flag never overridden at any call site")
        if is_entrypoint(x["name"]):
            continue
        callers = call_tally[x["name"]] - defs_count[x["name"]]
        if callers <= 0:
            add("uncalled-symbol", x["file"], x["line"], x["name"],
                f"no call sites found, ~{x['span']} lines")
        elif callers == 1:
            add("single-caller-wrapper", x["file"], x["line"], x["name"],
                f"one call site, ~{x['span']} lines")

    for x in all_imports:
        if not in_scope(x["file"], x["line"]):
            continue
        if x["mod"] in STDLIB_DUPES:
            add("dep-duplicates-stdlib", x["file"], x["line"], x["mod"],
                STDLIB_DUPES[x["mod"]])

    candidates.sort(key=lambda c: (c["file"], c["line"], c["kind"]))
    counts = Counter(c["kind"] for c in candidates)
    return {"scope": scope, "diff": diff, "candidates": candidates, "counts": dict(counts)}


def selftest():
    sample = (
        "import requests\n"
        "def only_caller_wrapper(x):\n"
        "    return x + 1\n"
        "def never_used(y):\n"
        "    return y\n"
        "def widget(verbose=False):\n"
        "    return only_caller_wrapper(verbose)\n"
        "class Base(ABC):\n"
        "    @abstractmethod\n"
        "    def run(self):\n"
        "        ...\n"
    )
    defs, classes, imports = extract("s.py", sample)
    names = {d["name"] for d in defs}
    assert {"only_caller_wrapper", "never_used", "widget"} <= names, names
    assert any("verbose" in d["flags"] for d in defs), "flag default not parsed"
    assert classes and classes[0]["abstract"], "ABC base not detected abstract"
    assert imports and imports[0]["mod"] == "requests", imports
    tally = Counter(CALL.findall(sample))
    assert tally["only_caller_wrapper"] == 2, tally  # one def + one call
    print("selftest ok")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", choices=["diff", "repo"], default="diff")
    parser.add_argument("--base", default="HEAD")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    cwd = os.getcwd()
    if git(["rev-parse", "--is-inside-work-tree"], cwd).stdout.strip() != "true":
        return fail("not a git work tree: " + cwd)
    root = git(["rev-parse", "--show-toplevel"], cwd).stdout.strip() or cwd

    base = resolve_base(args.base, root)
    if base is None:
        return fail("could not resolve --base " + args.base)

    result = scan(args.scope, base, root)
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
