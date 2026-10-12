#!/usr/bin/env python3
"""PreToolUse hook of agent-works: stops the mistakes agents make more than once, before the tool runs.

It reads the hook's JSON on stdin (tool_name, tool_input, cwd) and answers on stdout; no answer = the call goes ahead.
A project without .agents/agent-works.json is left alone at once, before anything is imported, and a failure of the
hook itself never blocks anything (any exception: exit 0, no output).

Rules (the config is documented in core/references/guard-config.md):
  staging-blanket        git add -A / -u / . / :/ and git commit -a
  staging-owner-files    a git add / stage / commit whose pathspecs reach one of guard.ownerFiles: the file, a folder
                         above it, a glob, after cd or git -C; and a pathspec the guard cannot read
  owner-file-edit        Edit / Write of one of guard.ownerFiles
  generated-file         Edit / Write of a path matching guard.generated
  default-branch-commit  git commit while on one of guard.defaultBranch.names (the branch of the checkout the commit
                         runs in: after `cd`, `pushd`, `git -C`; a folder the guard cannot resolve gives no finding)
  force-push             git push --force / -f / +refspec
  resource-lock          a command matching resources.<name>.match runs inside `aw lock run <name> … -- <command>` or
                         by the agent that holds the lock
  run-budget             a command matching runs[].match that names more than `free` items needs its reason
  <id>                   the project's own guard.rules

The resource and run rules read the commands that can start something: not the readers, and not the commands that
only handle files (`git add <script>`, `cp`, `mv`, `rm`), unless the entry says "matchFileCommands". The project's
rules also read what a command sets in its environment (`X=v cmd`, `env X=v cmd`, `export X=v`, `$env:X = "v"`).

A coordination aid, not a security boundary: the rules read the command text and the caller names itself. Commands are
read the way a shell reads them (quotes, here-documents, here-strings, $(…)), so the words of a commit message, an
echo or a search are never taken for a command.

    python -B guard.py --explain '<command>' [--cwd DIR] [--tool Bash] [--file PATH] [--json]
"""
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.dirname(HERE)
CLI_DIR = os.path.join(PLUGIN_ROOT, "cli")
CONFIG_PARTS = (".agents", "agent-works.json")

re = None  # set by _init(): the fast exit must not pay for it
json = None

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
SHELL_TOOLS = ("Bash", "PowerShell")

# Commands that only read, print or move about: their arguments may quote anything.
READERS = {"gh", "grep", "egrep", "fgrep", "rg", "ag", "cat", "bat", "echo", "ls", "head", "tail", "printf", "wc",
           "awk", "less", "more", "type", "dir", "which", "where", "command", "file", "stat", "tree", "jq", "sort",
           "uniq", "cut", "diff", "cmp", "findstr", "get-content", "gc", "select-string", "sls", "write-output",
           "write-host", "get-childitem", "gci", "test-path", "get-item", "measure-object", "select-object",
           "cd", "chdir", "pushd", "popd", "set-location", "push-location", "pop-location", "sl", "true", "false",
           "sleep", "pwd", "date", "whoami", "tasklist", "ps", "get-process"}
GIT_READERS = {"log", "show", "diff", "grep", "status", "ls-files", "ls-tree", "blame", "rev-parse", "rev-list",
               "describe", "shortlog", "cat-file", "name-rev", "whatchanged", "reflog", "for-each-ref", "merge-base",
               "diff-tree", "show-ref", "ls-remote", "check-ignore", "var", "help", "version", "config",
               # not readers, but their arguments are prose (a message) or handled by the staging rules
               "commit", "tag", "notes"}
# Commands that only handle the files they name: naming a script is not running it. Asked by the resource and run
# rules alone; a project's own rules still read them.
FILE_COMMANDS = {"cp", "mv", "rm", "mkdir", "rmdir", "touch", "chmod", "chown", "ln", "tee", "sed", "copy-item", "cpi",
                 "move-item", "mi", "remove-item", "ri", "rename-item", "rni", "new-item", "ni", "set-content",
                 "add-content", "clear-content", "out-file", "del", "erase", "copy", "move", "ren", "rename", "rd", "md",
                 "code", "vi", "vim", "nano", "notepad"}
GIT_STARTERS = {"bisect", "rebase", "submodule", "filter-branch", "difftool", "mergetool"}  # these can run a command
LEADERS = ("&", "!", "env", "export", "time", "nohup", "call")
GIT_VALUE_OPTS = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix")
ASSIGN = r"^[A-Za-z_][A-Za-z0-9_]*="


def _init():
    global re, json
    if re is None:
        import json as _json
        import re as _re
        re, json = _re, _json
    if CLI_DIR not in sys.path:
        sys.path.insert(0, CLI_DIR)


def config_root(cwd):
    """The folder holding .agents/agent-works.json at or above cwd, or None. os.path only: this is the fast exit."""
    here = os.path.abspath(cwd)
    while True:
        if os.path.isfile(os.path.join(here, *CONFIG_PARTS)):
            return here
        up = os.path.dirname(here)
        if up == here:
            return None
        here = up


# ------------------------------------------------------------------------------------------------- command parsing

def shell_words(command):
    """A command as segments of words, read the way a shell does (bash and PowerShell).

    A quoted string, a here-document, a PowerShell here-string and a `$(…)` stay one word (or none), whatever `;`,
    `|` or line breaks they hold. The rules read words, so a word of a message never passes for a command or a path.
    """
    _init()
    state = {"c": command}
    segments, words = [], []
    cur = [None]

    def add(text):
        cur[0] = (cur[0] or "") + text

    def end_word():
        if cur[0] is not None:
            words.append(cur[0])
        cur[0] = None

    def end_segment():
        end_word()
        if words:
            segments.append(list(words))
        del words[:]

    def cut_heredoc(i):
        # At "<<WORD": takes the operator and the body out of the command; the rest of the operator's line stays.
        c = state["c"]
        m = re.match(r"<<-?[ \t]*([\"']?)([A-Za-z_]\w*)\1", c[i:i + 80])
        if not m:
            return False
        line_end = c.find("\n", i)
        e = None
        if line_end >= 0:
            e = re.compile(r"\n[ \t]*" + re.escape(m.group(2)) + r"[ \t]*\r?(?=\n|\Z)").search(c, line_end)
        state["c"] = (c[:i] + (c[i + len(m.group(0)):line_end] if line_end >= 0 else c[i + len(m.group(0)):])
                      + (c[e.end():] if e else ""))
        return True

    def subst_end(i):
        # At the "(" of "$(": the index after its ")".
        depth, j = 0, i
        while j < len(state["c"]):
            c = state["c"]
            ch = c[j]
            if ch == "'":
                e = c.find("'", j + 1)
                j = len(c) if e < 0 else e + 1
            elif ch == '"':
                j = quote_end(j)
            elif ch == "<" and c[j + 1:j + 2] == "<" and cut_heredoc(j):
                continue
            else:
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        return j + 1
                j += 1
        return len(state["c"])

    def quote_end(i):
        # At an opening double quote: the index after the closing one.
        j = i + 1
        while j < len(state["c"]):
            c = state["c"]
            ch = c[j]
            if ch == "\\" or (ch == "`" and c[j + 1:j + 2] == '"'):
                j += 2
            elif ch == "$" and c[j + 1:j + 2] == "(":
                j = subst_end(j + 1)
            elif ch == '"':
                return j + 1
            else:
                j += 1
        return len(state["c"]) + 1

    i = 0
    while i < len(state["c"]):
        c = state["c"]
        ch = c[i]
        d = c[i + 1:i + 2]
        if ch == "\n" or ch == ";":
            end_segment()
            i += 1
        elif (ch == "&" and d == "&") or (ch == "|" and d == "|"):
            end_segment()
            i += 2
        elif ch == "|":
            end_segment()
            i += 1
        elif ch in " \t\r":
            end_word()
            i += 1
        elif ch in "\\`" and d in ("\n", "\r"):  # a continued line
            i += 3 if d == "\r" else 2
        elif ch == "@" and d in ("'", '"') and re.match(r"\r?\n", c[i + 2:i + 4]):  # PowerShell here-string
            e = c.find("\n" + d + "@", i + 2)
            add(re.sub(r"^\r?\n", "", c[i + 2:] if e < 0 else c[i + 2:max(e, i + 2)]))
            i = len(c) if e < 0 else e + 3
        elif ch == "'":
            e = c.find("'", i + 1)
            add(c[i + 1:] if e < 0 else c[i + 1:e])
            i = len(c) if e < 0 else e + 1
        elif ch == '"':
            e = quote_end(i)
            add(state["c"][i + 1:e - 1])
            i = e
        elif ch == "$" and d == "(":
            e = subst_end(i + 1)
            add(state["c"][i:e])
            i = e
        elif ch == "<" and d == "<" and cut_heredoc(i):
            continue
        else:
            add(ch)
            i += 1
    end_segment()
    return segments


def base_name(word):
    w = word.replace("\\", "/").rsplit("/", 1)[-1].lower()
    return w[:-4] if w.endswith(".exe") else w


def split_lead(segment):
    """(the leading `VAR=value` / env / export / call-operator words, the command's words), without subshell brackets."""
    words = list(segment)
    if words:
        words[0] = words[0].lstrip("({")
        if "(" not in words[-1]:
            words[-1] = words[-1].rstrip(")}")
    words = [w for w in words if w]
    k = 0
    while k < len(words) and (words[k] in LEADERS or re.match(ASSIGN, words[k])):
        k += 1
    return words[:k], words[k:]


def command_words(segment):
    """The segment without subshell brackets, the call operator and leading `VAR=value` / env / export prefixes."""
    return split_lead(segment)[1]


def ps_assignment(words):
    """(`X`, the value) of a PowerShell `$env:X = "v"` / `$env:X="v"` segment, else None."""
    m = re.match(r"^\$env:([A-Za-z_]\w*)$", words[0], re.I) if words else None
    if m and len(words) >= 2 and words[1] == "=":
        return m.group(1), " ".join(words[2:])
    m = re.match(r"^\$env:([A-Za-z_]\w*)=(.*)$", words[0], re.I | re.S) if words else None
    return (m.group(1), " ".join([m.group(2)] + words[1:])) if m else None


def assignments(segments):
    """Environment variables a command sets in its own text: `X=v cmd`, `export X=v`, `set X=v`, `$env:X = "v"`."""
    out = {}
    for seg in segments:
        words = list(seg)
        if words and words[0].lstrip("({") in ("export", "set", "env"):
            words = words[1:]
        m = re.match(r"^\$env:([A-Za-z_]\w*)$", words[0], re.I) if words else None
        if m and len(words) >= 3 and words[1] == "=":
            out[m.group(1)] = " ".join(words[2:])
            continue
        m = re.match(r"^\$env:([A-Za-z_]\w*)=(.*)$", words[0], re.I | re.S) if words else None
        if m:
            out[m.group(1)] = m.group(2)
            continue
        for w in words:
            m = re.match(r"^([A-Za-z_]\w*)=(.*)$", w.lstrip("({"), re.S)
            if not m:
                break
            out[m.group(1)] = m.group(2)
    return out


def git_verb(words):
    """(index of the git word, index of its sub-command, the folder -C names or None); (-1, -1, None) without git."""
    g = next((k for k, w in enumerate(words) if re.match(r"^(.*[\\/])?git(\.exe)?$", w, re.I)), -1)
    if g < 0:
        return -1, -1, None
    i, at = g + 1, None
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-C":
            at = (at or []) + [words[i + 1] if i + 1 < len(words) else ""]
        if words[i] in GIT_VALUE_OPTS:
            i += 1
        i += 1
    return g, i, at


def is_reader(words):
    """True when the command only reads or prints, so its arguments may quote anything."""
    if not words:
        return True
    first = base_name(words[0])
    if first.startswith("#"):
        return True
    if first == "git":
        _, i, _ = git_verb(words)
        return i >= len(words) or words[i] in GIT_READERS
    if first == "sed":
        return not any(re.match(r"^(-i|--in-place|-[a-zA-Z]*i)", w) for w in words[1:])
    if first == "find":
        return not any(w in ("-exec", "-execdir", "-delete", "-ok") for w in words[1:])
    if first == "aw":
        return True  # the wrapped command of `aw lock run` / `aw lease` is unwrapped before this is asked
    return first in READERS


def handles_files(words):
    """True when the command only handles the files it names (`git add x`, `cp x y`, `rm x`): it starts none of them."""
    if not words:
        return False
    first = base_name(words[0])
    if first == "git":
        _, i, _ = git_verb(words)
        return i >= len(words) or words[i] not in GIT_STARTERS
    if first == "find":
        return not any(w in ("-exec", "-execdir", "-ok") for w in words[1:])
    return first in FILE_COMMANDS


def unwrap(words):
    """`aw lock run R … -- command` and `aw lease R … -- command` -> ({R}, [command words, …]); else (set(), [words]).

    The wrapper holds that lock for the command (the resource is the first plain word after `run`). A command given
    as one quoted shell line is read again as a shell would, so the result is a list of segments.
    """
    held, wrapped = set(), False
    while True:
        k = next((n for n, w in enumerate(words) if base_name(w) in ("aw", "aw.cmd", "aw.py")), -1)
        if k < 0 or "--" not in words[k:]:
            break
        dd = words.index("--", k)
        sub = [w for w in words[k + 1:dd] if w != "--json"]
        if sub[:2] == ["lock", "run"]:
            resource = next((w for w in sub[2:] if not w.startswith("-")), None)
            if resource:
                held.add(resource)
        elif sub[:1] != ["lease"]:
            break
        words, wrapped = words[dd + 1:], True
    if wrapped and len(words) == 1 and re.search(r"\s", words[0]):
        return held, expand(shell_words(words[0]))
    return held, [words] if words else []


def expand(segments):
    """Segments with `bash -c "<line>"` and `powershell -Command "<line>"` replaced by the segments of that line."""
    out = []
    for seg in segments:
        words = command_words(seg)
        first = base_name(words[0]) if words else ""
        inner = None
        if first in ("bash", "sh", "zsh", "dash") or first in ("powershell", "pwsh", "cmd"):
            flags = ("-c", "-lc", "-ic") if first in ("bash", "sh", "zsh", "dash") else ("-command", "-c", "/c")
            for k, w in enumerate(words[1:], 1):
                if w.lower() in flags and k + 1 < len(words):
                    inner = " ".join(words[k + 1:]) if len(words) > k + 2 else words[k + 1]
                    break
        if inner is not None:
            lead = [w for w in seg if re.match(ASSIGN, w)]
            sub = expand(shell_words(inner))
            out.extend([lead + s for s in sub] if lead else sub)
        else:
            out.append(seg)
    return out


def text_of(words):
    return " ".join(words)


def _list(value):
    return [value] if isinstance(value, (str, dict)) else list(value) if isinstance(value, (list, tuple)) else []


def entries(match):
    """A `match` as [(pattern, the pattern's own `unless`)]: each entry is a regex or {"pattern": …, "unless": […]}."""
    out = []
    for m in _list(match):
        if isinstance(m, dict):
            if isinstance(m.get("pattern"), str):
                out.append((m["pattern"], [u for u in _list(m.get("unless")) if isinstance(u, str)]))
        elif isinstance(m, str):
            out.append((m, []))
    return out


def _search(pattern, text):
    try:
        return bool(re.search(pattern, text))
    except re.error:
        return False  # a broken pattern in the config must not block anything


def matches(patterns, text):
    """Does one of the patterns (regexes; of an object entry, its "pattern") match the text?"""
    return any(_search(p, text) for p, _ in entries(patterns))


def fires(match, unless, texts):
    """A `match` against the readings of one command: one entry matches a reading, and neither that entry's own
    `unless` nor the shared `unless` matches any of them."""
    texts = [t for t in texts if t]
    if not texts or any(matches(unless, t) for t in texts):
        return False
    return any(any(_search(p, t) for t in texts) and not any(matches(own, t) for t in texts)
               for p, own in entries(match))


# ----------------------------------------------------------------------------------------- paths and the owner's files

UNKNOWN_DIR = "/~"
ABSOLUTE = r"^([a-zA-Z]:)?/"
GLOB = r"[*?\[]"


def slashes(p):
    """Forward slashes, Git Bash's /e/… as e:/…, and the home folder as a place outside the checkout."""
    p = p.replace("\\", "/")
    p = re.sub(r"^/([a-zA-Z])/", r"\1:/", p)
    return UNKNOWN_DIR + p[1:] if p.startswith("~") else p


def opaque(word):
    """Not a literal name: a variable, a substitution, a PowerShell splat."""
    return bool(re.search(r"[$`]", word) or re.match(r"^@\w", word))


def join_path(dir_, path):
    """`path` as seen from `dir_`, with `.` and `..` resolved. Relative results are relative to the checkout's top."""
    p = slashes(path)
    raw = p if re.match(ABSOLUTE, p) or not dir_ else dir_ + "/" + p
    m = re.match(ABSOLUTE, raw)
    lead = m.group(0) if m else ""
    out = []
    for part in raw[len(lead):].split("/"):
        if not part or part == ".":
            continue
        if part != "..":
            out.append(part)
        elif out and out[-1] != "..":
            out.pop()
        elif not lead:
            out.append("..")
    return lead + "/".join(out)


def readings(path, root):
    """What a path can be, relative to the top of a checkout.

    Inside this checkout: the one answer. Anywhere else (another worktree, a folder the guard could not follow):
    every tail of it, so `<somewhere>/a/b` still counts as `a/b`.
    """
    if not re.match(ABSOLUTE, path) and not path.startswith(".."):
        return [path]
    p, r = path.lower(), slashes(root or "").rstrip("/").lower()
    if r and (p == r or p.startswith(r + "/")):
        return [path[len(r) + 1:]]
    parts = path.split("/")
    return ["/".join(parts[i + 1:]) for i in range(len(parts) - 1)]


def glob_re(glob):
    def esc(chars):
        g = re.sub(chars, lambda m: "\\" + m.group(0), glob)
        g = re.sub(r"\*+", ".*", g).replace("?", "[^/]")
        return "^" + g + "$"
    try:
        return re.compile(esc(r"[.+^${}()|\\]"), re.I)
    except re.error:
        return re.compile(esc(r"[.+^${}()|\\\[\]]"), re.I)


def covers(spec, owner, whole=False):
    """Does a pathspec (relative to the top) take an owner's file? As git matches: the name itself, a folder above
    it, or a glob, whose `*` crosses folders. `whole` is for exclusions: the spec must cover all of an owner's folder,
    where a path inside the folder is enough to take something of it."""
    folder = owner.endswith("/")
    o = (owner[:-1] if folder else owner).lower()
    s = spec.lower()
    if not s:
        return True
    g = re.search(GLOB, s)
    if not g:
        return s == o or o.startswith(s + "/") or (folder and not whole and s.startswith(o + "/"))
    rx, parts = glob_re(s), o.split("/")
    if any(rx.search("/".join(parts[:k + 1])) for k in range(len(parts))):
        return True
    return folder and not whole and s[:g.start()].startswith(o + "/")


COMMIT_VALUES = ("message", "file", "author", "date", "reuse-message", "reedit-message", "fixup", "squash", "template",
                 "cleanup", "trailer", "pathspec-from-file")


def read_staging(verb, args, dir_, root):
    s = {"verb": verb, "all": False, "dry": False, "specs": [], "unseen": [], "include": [], "exclude": []}
    values = ("pathspec-from-file",) if verb == "add" else COMMIT_VALUES
    rest = False
    i = 0
    while i < len(args):
        t = args[i]
        i += 1
        if re.match(r"^(\d?>|<)", t):
            break  # a redirection ends the arguments
        if t == "-":
            continue
        if rest or not t.startswith("-"):
            s["specs"].append(t)
            continue
        if t == "--":
            rest = True
            continue
        if t.startswith("--"):
            eq = t.find("=")
            name = t[2:] if eq < 0 else t[2:eq]
            if name == "all" or (verb == "add" and name in ("update", "no-ignore-removal")):
                s["all"] = True
            elif name == "dry-run":
                s["dry"] = True
            elif name == "pathspec-from-file":
                s["unseen"].append(name)
            if eq < 0 and name in values:
                i += 1
            continue
        for k in range(1, len(t)):
            ch = t[k]
            if verb == "commit" and ch in "mFCct":  # takes a value
                if k == len(t) - 1:
                    i += 1
                break
            if verb == "commit" and ch in "uS":  # an optional value, attached
                break
            if (ch in "Au") if verb == "add" else (ch == "a"):
                s["all"] = True
            if verb == "add" and ch == "n":
                s["dry"] = True
    for spec in s["specs"]:
        if opaque(spec):
            s["unseen"].append(spec)
            continue
        # Pathspec magic: ":/x" and ":(top)x" start at the top, ":!x", ":^x" and ":(exclude)x" take x out.
        path, top, exclude = spec, False, False
        m = re.match(r"^:\(([^)]*)\)(.*)$", spec)
        if m:
            magic = [w.strip() for w in m.group(1).split(",")]
            top, exclude, path = "top" in magic, "exclude" in magic, m.group(2)
        elif spec.startswith(":"):
            k = 1
            while k < len(spec) and spec[k] in "/!^":
                if spec[k] == "/":
                    top = True
                else:
                    exclude = True
                k += 1
            path = spec[k + 1:] if spec[k:k + 1] == ":" else spec[k:]
        s["exclude" if exclude else "include"].append(readings(join_path("" if top else dir_, path), root))
    if s["exclude"] and not s["include"]:
        s["include"].append([""])  # exclusions alone: everything but them
    return s


def start_dir(cwd, root):
    """Where a command starts: relative to the checkout's top inside it (`""` at the top), else the absolute path."""
    here = readings(join_path("", cwd), root or "") if cwd else [""]
    return here[0] if len(here) == 1 else join_path("", cwd or "")


def stagings(command, cwd=None, root=None):
    """Every `git add` / `git stage` / `git commit` of a command, with its pathspecs resolved from where it runs
    ("dir": the folder it runs in, after every `cd`, `pushd` and `git -C` before it; "lead": the words before `git`)."""
    _init()
    root = root or ""
    dir_ = start_dir(cwd, root)
    found = []
    for segment in expand(shell_words(command)):
        # "(cd a && git add b)": the brackets of a subshell are not part of a name.
        words = [w for w in ([segment[0].lstrip("({")] + segment[1:]) if w] if segment else []
        if words and "(" not in words[-1]:
            words[-1] = words[-1].rstrip(")}")
            words = [w for w in words if w]
        first = words[0] if words else ""
        if re.match(r"^(cd|chdir|pushd|Set-Location|Push-Location|sl)$", first, re.I):
            to = next((w for w in words[1:] if not w.startswith("-")), None)
            dir_ = UNKNOWN_DIR if not to or opaque(to) else join_path(dir_, to)
            continue
        if re.match(r"^(popd|Pop-Location)$", first, re.I):
            dir_ = UNKNOWN_DIR
            continue
        if re.match(r"^(echo|printf|grep|rg|gh|Write-Host|Write-Output)$", first, re.I):
            continue  # talking about git
        g, i, dash_c = git_verb(words)
        if g < 0:
            continue
        at = dir_
        for c in dash_c or []:
            at = UNKNOWN_DIR if opaque(c) else join_path(at, c)
        verb = words[i] if i < len(words) else ""
        verb = "add" if verb in ("add", "stage") else "commit" if verb == "commit" else None
        if not verb:
            continue
        s = read_staging(verb, words[i + 1:], at, root)
        s["dir"] = at
        s["lead"] = words[:g]
        if any(re.match(r"^xargs$", w, re.I) for w in words[:g]):
            s["unseen"].append("xargs")
        found.append(s)
    return found


def owner_files_taken(s, owner_files):
    """The owner's files a staging would take."""
    def hit(specs, owner, whole):
        return any(covers(spec, owner, whole) for r in specs for spec in r)
    return [o for o in owner_files if hit(s["include"], o, False) and not hit(s["exclude"], o, True)]


def rel_path(path, root, cwd=None):
    """(the path relative to the checkout's top, True) or (its readings' longest tail, False) when it lies elsewhere."""
    p = slashes(path)
    if not re.match(ABSOLUTE, p):
        base = readings(join_path("", cwd), root) if cwd else [""]
        if len(base) != 1:
            return join_path("", p), False
        p = join_path(base[0], p)
        return p, not p.startswith("..")
    p = join_path("", p)
    r = slashes(root or "").rstrip("/").lower()
    if r and p.lower().startswith(r + "/"):
        return p[len(r) + 1:], True
    return p, False


def owner_file(path, root, cwd, owner_files):
    """The owner's file a path is, or lies in."""
    rel, inside = rel_path(path, root, cwd)
    low = rel.lower()
    for f in owner_files:
        o = f.lower()
        if inside:
            if (low + "/").startswith(o) if o.endswith("/") else low == o:
                return f
        else:  # another checkout: read by its tail
            padded = "/" + low
            if ("/" + o) in (padded + "/") if o.endswith("/") else padded.endswith("/" + o):
                return f
    return None


# ------------------------------------------------------------------------------------------------------------ rules

def decision(kind, rule, message, notice=None):
    d = {"kind": kind, "rule": rule, "message": message}
    if notice:
        d["notice"] = notice
    return d


def _level(value, default):
    v = str(value if value is not None else default).lower()
    return v if v in ("deny", "ask", "warn") else None  # "off", "allow", anything else: the rule is off


BY_PATH = ("Stage the files you changed by their exact paths (`git add <file> <file>`), then `git commit -m …` without "
           "-a and without paths above them.")


def staging_rules(command, cfg, env):
    guard = cfg.get("guard") or {}
    staging = guard.get("staging") or {}
    owners = [str(o).replace("\\", "/") for o in guard.get("ownerFiles") or []]
    blanket, unseen = _level(staging.get("blanket"), "deny"), _level(staging.get("unseen"), "deny")
    owner_list = "\n".join("  " + o for o in owners)
    leave = " Leave the owner's files as they are: do not revert, stash, move or delete them." if owners else ""
    out = []
    for s in stagings(command, env.get("cwd"), env.get("root")):
        if s["dry"]:
            continue
        what = "git add" if s["verb"] == "add" else "git commit"
        whole = s["all"] or any(re.match(r"^(\.|\*|:/)$", p) for p in s["specs"])
        if whole and not s["include"]:
            s["include"].append([""])
        if whole and blanket:
            mine = f" The owner's files (local, never committed):\n{owner_list}\n" if owners else " "
            out.append(decision(blanket, "staging-blanket",
                                "Stage files by path. `git add -A` / `-u` / `git add .` / `git commit -a` take "
                                "everything in the tree with them: the owner's own files and whatever another "
                                f"agent left there.{mine}{BY_PATH}{leave}"))
            continue
        taken = owner_files_taken(s, owners)
        if taken:
            listed = "\n".join("  " + o for o in taken)
            out.append(decision("deny", "staging-owner-files",
                                f"`{what} {' '.join(s['specs'])}` would take the owner's own files with it:\n{listed}\n"
                                "They are local to the owner's machine and never committed. A folder above them, a "
                                f"glob that reaches them and the files themselves are all refused. {BY_PATH}{leave}"))
            continue
        if s["unseen"] and owners and unseen:
            seen = ", ".join(dict.fromkeys(s["unseen"]))
            out.append(decision(unseen, "staging-owner-files",
                                f"The guard cannot see which files `{what}` takes here ({seen}: a variable, a command "
                                "substitution, xargs or --pathspec-from-file), and a list of changed files includes "
                                f"the owner's own:\n{owner_list}\nWrite the paths out. {BY_PATH}{leave}"))
    return out


def git_rules(segments, cfg, env, command=""):
    """force-push and default-branch-commit."""
    db = (cfg.get("guard") or {}).get("defaultBranch") or {}
    names = [str(n) for n in db.get("names") or ["main", "master"]]
    commit, force = _level(db.get("commit"), "warn"), _level(db.get("forcePush"), "ask")
    out = []
    for seg in segments:
        words = command_words(seg)
        if not words or base_name(words[0]) != "git":
            continue
        _, i, dash_c = git_verb(words)
        verb = words[i] if i < len(words) else ""
        args = words[i + 1:]
        if verb == "push" and force:
            forced = any(a.startswith("--force") or re.match(r"^-[a-zA-Z]*f[a-zA-Z]*$", a) or re.match(r"^\+\S", a)
                         for a in args)
            if forced:
                out.append(decision(force, "force-push",
                                    "A force push rewrites a pushed branch: others' work on it, and an open review, "
                                    "can be lost. Merge the default branch in instead."))
    if commit:
        # Where each commit runs is what the staging parser already follows for pathspecs: cd, pushd, git -C.
        start = start_dir(env.get("cwd"), env.get("root"))
        for s in stagings(command, env.get("cwd"), env.get("root")):
            if s["verb"] != "commit" or s["dry"]:
                continue
            if any(not (w in LEADERS or re.match(ASSIGN, w)) for w in s["lead"]):
                continue  # `grep -rn git commit .`: git is not the command
            branch = _branch_in(env, s["dir"], start)
            if branch and branch in names:
                out.append(decision(commit, "default-branch-commit",
                                    f"This commits on `{branch}`. Work goes on a branch: create one, commit there, "
                                    "open a pull request, merge when verified."))
    return out


def _branch_in(env, dir_, start):
    """The branch checked out where a command runs: `dir_` as the staging parser resolved it. None when that folder
    is not known (a variable, `popd`, the home folder) or is no checkout: no finding rather than a false one."""
    try:
        if dir_ == start:
            return env["branch"] if env.get("branch") is not None else _branch_at(env, None)
        if dir_.startswith(UNKNOWN_DIR) or dir_.startswith(".."):
            return None
        import common
        at = dir_ if re.match(ABSOLUTE, dir_) else os.path.join(env.get("root") or "", dir_)
        return common.current_branch(at) if os.path.isdir(at) else None
    except Exception:
        return None


def _branch_at(env, dash_c):
    try:
        import common
        at = env.get("cwd") or os.getcwd()
        for c in dash_c or []:
            at = os.path.join(at, c)
        return common.current_branch(at)
    except Exception:
        return None


def lock_holders(cfg, env, agent=None, names=None):
    """(resource -> the agent holding its lock, the resources `agent` holds). Absent from the first: free.

    Asked of the coordination store (cli/coord/locks.py); when that is absent, the store's documented layout is read
    directly: <aw_home>/locks/<"machine" or the project's id>/<resource>.lock, a JSON object with "agent".
    """
    if isinstance(env.get("locks"), dict):  # given by the caller (tests)
        return env["locks"], {n for n, a in env["locks"].items() if agent and a == agent}
    holders, mine = {}, set()
    try:
        import common
        start = env.get("root") or env.get("cwd")
    except Exception:
        return holders, mine
    try:
        from coord import locks as coord_locks
    except Exception:
        coord_locks = None
    for name in names if names is not None else list(cfg.get("resources") or {}):
        spec = (cfg.get("resources") or {}).get(name) or {}
        held = None
        try:
            if coord_locks is not None:
                held = coord_locks.holder(name, cfg, start)
                if held and coord_locks.holds(agent, name, cfg, start):
                    mine.add(name)
                    coord_locks.refresh(agent, name, cfg, start)  # a holder at work keeps its lock fresh
            else:
                scope = "machine" if spec.get("scope") == "machine" else common.project_id(start)
                held = common.read_json(common.aw_home() / "locks" / scope / f"{name}.lock", None)
                if isinstance(held, dict) and agent and held.get("agent") == agent:
                    mine.add(name)
        except Exception:
            held = None
        if isinstance(held, dict) and held.get("agent"):
            holders[name] = str(held["agent"])
    return holders, mine


def resource_rule(units, cfg, env, agent):
    """units: [(held by a wrapper, command words)]."""
    resources = cfg.get("resources") or {}
    if not resources:
        return []
    needed = []
    for held, words in units:
        text = text_of(words)
        handler = handles_files(words)
        for name, spec in resources.items():
            spec = spec if isinstance(spec, dict) else {}
            if name in held or name in needed or (handler and not spec.get("matchFileCommands")):
                continue
            if fires(spec.get("match"), spec.get("unless"), [text]):
                needed.append(name)
    if not needed:
        return []
    holders, mine = lock_holders(cfg, env, agent, needed)
    missing = [n for n in needed if n not in mine]
    if not missing:
        return []
    order = [n for n in (cfg.get("lockOrder") or []) if n in missing] + [n for n in missing if n not in (cfg.get("lockOrder") or [])]
    first = order[0]
    var = (cfg.get("guard") or {}).get("agentVar") or "AW_AGENT"
    state = ", ".join(f"{n}: {'held by ' + holders[n] if holders.get(n) else 'free'}" for n in order)
    who = f'"{agent}" does not hold the lock' if agent else "it does not say which agent runs it"
    both = f" Needing several, take them in this order: {', '.join(order)}." if len(order) > 1 else ""
    return [decision("deny", "resource-lock",
                     f"This command starts {' and '.join(order)}, of which one runs at a time across agents and "
                     f"worktrees, and {who} ({state}).\n"
                     "The normal way (waits its turn, runs the command, always releases):\n"
                     f'  aw lock run {first} --for "<what, how long>" -- <command>\n'
                     "Several commands under one hold:\n"
                     f'  aw lock acquire {first} --as <name> --for "<what>"\n'
                     f'  {var}=<name> <command>          PowerShell: $env:{var} = "<name>"; <command>\n'
                     f"  aw lock release {first} --as <name>     (also after a failure)\n"
                     f"Hold a lock for the run only, never while thinking or editing.{both} `aw lock status` shows "
                     "who holds what.")]


def _flag_name(word):
    """`--name=v`, `-Name:v`, `--name` -> name, lower case; '' for a word that is no flag."""
    if not word.startswith("-") or re.match(r"^-\d", word):
        return ""
    return re.split(r"[=:]", word.lstrip("-"), maxsplit=1)[0].lower()


def _flag_inline(word):
    m = re.match(r"^-+[^=:]+[=:](.*)$", word, re.S)
    return m.group(1) if m else None


def _norm_flags(flags):
    return {str(f).lstrip("-").lower() for f in flags or []}


def _items(root, items_dir):
    if not items_dir:
        return None
    d = items_dir if os.path.isabs(os.path.expanduser(os.path.expandvars(items_dir))) else os.path.join(root or "", items_dir)
    d = os.path.expanduser(os.path.expandvars(d))
    try:
        return sorted(n for n in os.listdir(d) if not n.startswith("."))
    except OSError:
        return None


def count_run(words, run, root):
    """What a run command asks for: {"dry", "all", "count" (None when the text does not say), "total", "how"}."""
    import fnmatch

    spec = run.get("count") or {}
    start = 0
    for k in range(len(words)):
        if matches(run.get("match"), text_of(words[:k + 1])):  # the patterns alone: where the program's name ends
            start = k + 1
            break
    args = []
    for w in words[start:]:
        if re.match(r"^(\d?>|>>?|<)", w):
            break
        args.append(w)
    dry = _norm_flags(run.get("dryFlags") if run.get("dryFlags") is not None else ["--dry-run", "--list"])
    all_flags = _norm_flags(spec.get("allFlags"))
    group_flag = str(spec.get("groupFlag") or "").lstrip("-").lower()
    match_flag = str(spec.get("matchFlag") or "").lstrip("-").lower()
    value_flags = _norm_flags(spec.get("valueFlags")) | ({group_flag} if group_flag else set()) | ({match_flag} if match_flag else set())
    res = {"dry": False, "all": False, "count": None, "total": None, "how": ""}
    names, groups, narrow = [], [], None
    i = 0
    while i < len(args):
        w = args[i]
        i += 1
        name = _flag_name(w)
        if not name:
            names.extend(n for n in w.split(",") if n)
            continue
        value = None
        if name in value_flags:
            value = _flag_inline(w)
            if value is None and i < len(args):
                value = args[i]
                i += 1
        if name in dry:
            res["dry"] = True
        elif name in all_flags:
            res["all"] = True
        elif group_flag and name == group_flag and value:
            groups.extend(g for g in value.split(",") if g)
        elif match_flag and name == match_flag and value:
            narrow = value
    items = _items(root, spec.get("itemsDir"))
    res["total"] = len(items) if items is not None else None

    def narrowed(picked):
        return [p for p in picked if fnmatch.fnmatchcase(p, narrow)] if narrow else picked

    if res["all"]:
        if items is not None:
            res["count"], res["how"] = len(narrowed(items)), "all" + (f", narrowed by {narrow}" if narrow else "")
        else:
            res["how"] = "all"
    elif groups:
        table = None
        if spec.get("groupsFile"):
            try:
                with open(os.path.join(root or "", spec["groupsFile"]), encoding="utf-8") as f:
                    table = json.load(f)
            except (OSError, ValueError):
                table = None
        if isinstance(table, dict) and items is not None and all(g in table for g in groups):
            picked = []
            for g in groups:
                globs = table[g] if isinstance(table[g], list) else [table[g]]
                yes = [x for x in globs if not str(x).startswith("!")]
                no = [str(x)[1:] for x in globs if str(x).startswith("!")]
                picked += [n for n in items if any(fnmatch.fnmatchcase(n, str(x)) for x in yes)
                           and not any(fnmatch.fnmatchcase(n, x) for x in no)]
            res["count"] = len(set(narrowed(picked)) | set(names))
        res["how"] = "group " + ",".join(groups)
    else:
        res["count"], res["how"] = (len(set(names)) if spec.get("names", True) else 0), "named"
    return res


def run_rule(units, cfg, env, assigned):
    out = []
    for _held, words in units:
        text = text_of(words)
        handler = handles_files(words)
        for run in cfg.get("runs") or []:
            if not isinstance(run, dict) or (handler and not run.get("matchFileCommands")):
                continue
            if not fires(run.get("match"), run.get("unless"), [text]):
                continue
            ask = count_run(words, run, env.get("root"))
            if ask["dry"]:
                continue
            free = int(run.get("free", 3))
            full_at = int(run.get("fullAt", 100))
            n, total = ask["count"], ask["total"]
            unknown = n is None
            full = (ask["all"] and (unknown or not total or n >= 0.8 * total)) or (n is not None and n >= full_at)
            if not full and not unknown and n <= free:
                continue
            var = run.get("reasonVar") or "AW_RUN"
            given = assigned.get(var)  # read from the command's own text, so the reason is on record
            m = re.match(r"^\s*(full|verify)\s*:\s*(.*)$", given or "", re.I | re.S)
            kind = m.group(1).lower() if m else ""
            reason = " ".join(m.group(2).split()) if m else ""
            rid = str(run.get("id") or "run")
            what = ("a run whose size the command does not say" if unknown and not ask["all"] else
                    "everything" if unknown else
                    f"{n} item{'' if n == 1 else 's'}" + (f": everything ({total})" if full and total else ""))
            if m and len(reason) >= 12 and (kind == "full" or not full):
                out.append(decision("warn", "run-budget",
                                    f"Run budget ({rid}): {what} allowed for the stated reason. This is the exception, "
                                    f"not the loop: the next iteration runs {free} or fewer.",
                                    notice=f"Run budget ({rid}): {what} let through — {kind}: {reason}"))
                continue
            need = (f"Everything at once is for ONE pass when the work is finished, never to look at one effect and "
                    f"never between iterations. If this is that pass, say so in the command:\n"
                    f'  bash:        {var}="full: <what is finished and why everything must run>" <command>\n'
                    f'  PowerShell:  $env:{var} = "full: <…>"; <command>'
                    if full else
                    f"More than {free} is not an iteration. If this is the check after the change already works on "
                    f"its own items, say so in the command:\n"
                    f'  bash:        {var}="verify: <what already works and what this run checks>" <command>\n'
                    f'  PowerShell:  $env:{var} = "verify: <…>"; <command>')
            bad = ""
            if given is not None:
                bad = (f"\nThe {var} reason given " +
                       ("must start with \"verify:\" or \"full:\"." if not m else
                        "is too short to be a reason." if len(reason) < 12 else f'is "{kind}", and this run needs "full".'))
            extra = ("\n" + str(run["message"])) if run.get("message") else ""
            out.append(decision("deny", "run-budget",
                                f"Run budget ({rid}): this command asks for {what} ({ask['how'] or 'unknown'}).{bad}\n"
                                f"Run the smallest set that answers the question: 1-{free} items that show the thing "
                                f"you changed, by name.{extra}\n{need}\n"
                                "The reason is logged for the owner. Do not add it to get past this message: narrow "
                                "the run first."))
    return out


def own_vars(cfg):
    """The variables the guard reads itself (an agent's name, a run's reason): their values are prose, not commands."""
    guard = cfg.get("guard") or {}
    names = {"AW_AGENT", "AW_RUN", str(guard.get("agentVar") or "AW_AGENT")}
    names |= {str(a) for a in guard.get("agentVarAliases") or []}
    names |= {str(r.get("reasonVar") or "AW_RUN") for r in cfg.get("runs") or [] if isinstance(r, dict)}
    return names


def rule_texts(lead, words, own):
    """What a project rule reads of one command: [the command alone, the command with what it sets in its
    environment, and for PowerShell's `$env:X = "v"` the same as `X=v`]. The guard's own variables are left out."""
    shown = [w for w in lead if not (re.match(ASSIGN, w) and w.split("=", 1)[0] in own)]
    if not any(re.match(ASSIGN, w) for w in shown):
        shown = []  # `env`, `time` or `&` alone say nothing
    out = [text_of(words), text_of(shown + words)]
    ps = ps_assignment(words)
    if ps:
        out.append(text_of(shown + [f"{ps[0]}={ps[1]}"]))
    return out


def data_rules(unit_texts, segment_texts, cfg, env, file_path=None):
    """The project's own guard.rules. unit_texts / segment_texts: the readings (rule_texts) of every command that is
    no reader / of every segment."""
    out = []
    for rule in (cfg.get("guard") or {}).get("rules") or []:
        if not isinstance(rule, dict):
            continue
        kind = _level(rule.get("decision"), "deny")
        if not kind:
            continue
        when = rule.get("when") or {}
        if when.get("branch"):
            branch = env.get("branch")
            if branch is None:
                branch = env["branch"] = _branch_at(env, None) or ""
            if branch not in when["branch"]:
                continue
        scope = rule.get("scope") or "segment"
        if (scope == "file") != (file_path is not None):
            continue
        if scope == "file":
            texts = [[file_path]]
        else:
            texts = unit_texts if rule.get("skipReaders", True) else segment_texts
            if scope == "command":
                # all segments together, once per reading (a segment without that reading gives its last)
                texts = [["\n".join(t for t in (r[min(k, len(r) - 1)] for r in texts) if t) for k in range(3)]]
        if any(fires(rule.get("match"), rule.get("unless"), list(dict.fromkeys(t))) for t in texts):
            out.append(decision(kind, str(rule.get("id") or "project-rule"), str(rule.get("message") or "A project rule matched this call (guard.rules in .agents/agent-works.json).")))
    return out


def file_rules(path, cfg, env):
    guard = cfg.get("guard") or {}
    rel, inside = rel_path(path, env.get("root"), env.get("cwd"))
    out = []
    for g in guard.get("generated") or []:
        if not isinstance(g, dict) or not g.get("match"):
            continue
        try:
            hit = re.search(str(g["match"]), rel, re.I)
        except re.error:
            hit = None
        if hit:
            how = str(g.get("how") or "It is generated: change its source and run the generator.")
            out.append(decision("deny", "generated-file", f"Do not edit {path} by hand. {how}"))
            break
    level = _level(guard.get("ownerFilesEdit"), "ask")
    owners = [str(o).replace("\\", "/") for o in guard.get("ownerFiles") or []]
    if level and owners and owner_file(path, env.get("root"), env.get("cwd"), owners):
        out.append(decision(level, "owner-file-edit",
                            f"{path} is the owner's own file: agents leave it as it is and never commit it."))
    out += data_rules([], [], cfg, env, file_path=rel)
    return out


def decide_all(tool, tool_input, cfg, env=None):
    """Every decision the rules reach for one tool call, strongest first."""
    _init()
    env = dict(env or {})
    found = []
    if tool in SHELL_TOOLS:
        command = tool_input.get("command")
        if not isinstance(command, str) or not command.strip():
            return []
        segments = expand(shell_words(command))
        assigned = assignments(segments)
        guard = cfg.get("guard") or {}
        agent = next((assigned[v] for v in [guard.get("agentVar") or "AW_AGENT", *(guard.get("agentVarAliases") or [])]
                      if assigned.get(v)), None)
        if agent is None and "agent" in env:
            agent = env["agent"]
        elif agent is None:
            try:
                import common
                agent = common.agent_name(cfg)
            except Exception:
                agent = None
        own = own_vars(cfg)
        units, unit_texts, segment_texts = [], [], []
        for seg in segments:
            lead, words = split_lead(seg)
            mine = ps_assignment(words)
            if mine and mine[0] in own:
                continue  # `$env:AW_RUN = "verify: …"`: a reason or a name, read by `assignments`, never a command
            segment_texts.append(rule_texts(lead, words, own))
            held, inner = unwrap(words)
            if not words:
                unit_texts.append(rule_texts(lead, [], own))  # `export X=v`: no reader, and a rule may be about X
            for sub in inner:
                sub_lead, w = split_lead(sub)
                if w and not is_reader(w):
                    units.append((held, w))
                    unit_texts.append(rule_texts(lead + sub_lead, w, own))
                for name, value in assignments([sub]).items():
                    assigned.setdefault(name, value)
        found += staging_rules(command, cfg, env)
        found += git_rules(segments, cfg, env, command)
        found += resource_rule(units, cfg, env, agent)
        found += run_rule(units, cfg, env, assigned)
        found += data_rules(unit_texts, segment_texts, cfg, env)
    elif tool in EDIT_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path")
        if isinstance(path, str) and path:
            found += file_rules(path, cfg, env)
    order = {"deny": 0, "ask": 1, "warn": 2}
    return sorted(found, key=lambda d: order[d["kind"]])


def decide(tool, tool_input, cfg, env=None):
    """The one decision that is answered: a refusal before a question before a warning. None = the call goes ahead."""
    found = decide_all(tool, tool_input, cfg, env)
    return found[0] if found else None


# --------------------------------------------------------------------------------------------------------- the hook

def read_env(cwd):
    import common

    root = common.repo_root(cwd)  # pathspecs and guard.ownerFiles are relative to the working tree's top
    return {"cwd": cwd, "root": str(root) if root else str(common.project_root(cwd)), "branch": common.current_branch(cwd) or ""}


def log_decision(cfg, env, tool, tool_input, d):
    if not (cfg.get("guard") or {}).get("log", True):
        return
    try:
        import common

        path = common.project_home(env.get("root") or env.get("cwd")) / "guard.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        subject = tool_input.get("command") or tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        line = {"at": common.now_iso(), "decision": d["kind"], "rule": d["rule"], "agent": common.agent_name(cfg),
                "tool": tool, "subject": str(subject)[:600]}
        if d.get("notice"):
            line["notice"] = d["notice"]
        with open(path, "a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(line) + "\n")
    except Exception:
        pass  # the log is a convenience


def answer(d):
    if d["kind"] == "warn":
        out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": d["message"]}}
        if d.get("notice"):
            out["systemMessage"] = d["notice"]
        return out
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": d["kind"],
                                   "permissionDecisionReason": d["message"]}}


def quick_cwd(raw):
    """The payload's "cwd" without a JSON parser, or None when that is not safely possible."""
    at = raw.rfind('"cwd"')
    if at < 0 or (at and raw[at - 1] == chr(92)):
        return None
    rest = raw[at + 5:].lstrip()
    if not rest.startswith(":"):
        return None
    rest = rest[1:].lstrip()
    end = rest.find('"', 1)
    while end > 0 and rest[end - 1] == chr(92) and rest[end - 2] != chr(92):
        end = rest.find('"', end + 1)
    if not rest.startswith('"') or end < 0:
        return None
    value = rest[1:end]
    if chr(92) + "u" in value:
        return None
    return value.replace(chr(92) * 2, chr(92)).replace(chr(92) + "/", "/")


def explain(argv):
    """--explain '<command>' [--cwd DIR] [--tool T] [--file PATH] [--json]: what would be decided, and by which rule."""
    _init()
    import argparse

    import common

    p = argparse.ArgumentParser(prog="guard.py --explain")
    p.add_argument("command", nargs="?", default="")
    p.add_argument("--cwd", default=os.getcwd())
    p.add_argument("--tool", default=None)
    p.add_argument("--file", default=None, help="explain an Edit of this path instead of a command")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(argv)
    cwd = os.path.abspath(a.cwd)
    tool = a.tool or ("Edit" if a.file else "Bash")
    tool_input = {"file_path": a.file} if a.file else {"command": a.command}
    doc = {"tool": tool, "cwd": cwd, "config": None, "decision": "allow", "rule": None, "message": "", "all": []}
    if config_root(cwd) is None:
        doc["message"] = "no .agents/agent-works.json at or above this folder: the guard is inert here"
    else:
        cfg = common.load_config(cwd)
        doc["config"] = cfg.get("_path")
        if cfg.get("_error"):
            doc["message"] = cfg["_error"] + " (the built-in defaults apply)"
        found = decide_all(tool, tool_input, cfg, read_env(cwd))
        doc["all"] = [{"decision": d["kind"], "rule": d["rule"]} for d in found]
        if found:
            doc.update(decision=found[0]["kind"], rule=found[0]["rule"], message=found[0]["message"])
        if tool in SHELL_TOOLS:
            doc["segments"] = expand(shell_words(a.command))
    if a.json:
        json.dump(doc, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        print(f"decision: {doc['decision']}" + (f"   rule: {doc['rule']}" if doc["rule"] else ""))
        if len(doc["all"]) > 1:
            print("also:     " + ", ".join(f"{d['rule']} ({d['decision']})" for d in doc["all"][1:]))
        for seg in doc.get("segments") or []:
            print("segment:  " + " ".join(f"[{w}]" for w in seg))
        if doc["message"]:
            print()
            print(doc["message"])
    return 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--explain":
        return explain(sys.argv[2:])
    try:
        raw = sys.stdin.buffer.read().decode("utf-8", "replace")
        # The fast exit, taken on every tool call of every project that does not use the plugin: no json, no re.
        cwd = quick_cwd(raw)
        if cwd and os.path.isdir(cwd) and config_root(cwd) is None:
            return 0
        _init()
        data = json.loads(raw.lstrip(chr(0xFEFF)))
        cwd = data.get("cwd") or os.getcwd()
        if config_root(cwd) is None:
            return 0
        tool, tool_input = data.get("tool_name") or "", data.get("tool_input") or {}
        if tool not in SHELL_TOOLS and tool not in EDIT_TOOLS:
            return 0
        import common

        cfg = common.load_config(cwd)
        env = read_env(cwd)
        d = decide(tool, tool_input, cfg, env)
        if d:
            log_decision(cfg, env, tool, tool_input, d)
            sys.stdout.write(json.dumps(answer(d)))
    except Exception:
        pass  # fail open: a broken guard must never stop work
    return 0


if __name__ == "__main__":
    sys.exit(main())
