#!/usr/bin/env python3
"""PreToolUse hook (shell tools): the render budget, the application locks and the baseline's safety.

It reads the tool input JSON on stdin. A project without .perceptual-loop/config.json is left alone at once, before
anything is imported; a failure of the hook itself never blocks a command (any exception: exit 0, no output).

Rules, each only when the config asks for it (core/references/contract.md):
  budget    a command matching config.budget.match that renders more than config.budget.free shots needs
            PL_RUN="verify: ..." or PL_RUN="full: ..." in its text; allowed large runs go to runs/budget.log
  locks     a command matching config.locks.apps.<app>.match runs inside `lock.py run <app> ... -- <command>`, or
            carries PL_AGENT=<name> where <name> holds the lock
  baseline  `baseline.py update` needs --source and a selection (shots, --shots, --group or --all)

A coordination aid, not a security boundary: the rules read command text and the caller names itself. Text inside
heredocs and here-strings is skipped; quotes are respected when the command is split, so the quoted arguments of
`git commit -m`, `gh ... --body/--title`, `echo` and `lock.py note` never match (their segment is a reader's). A
render command quoted as an argument of some other program still matches; shots that do not exist yet are not
counted; a render hidden in a script or in $(...) behind a reader is not seen.
"""
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.dirname(HERE)
DIR_NAME = ".perceptual-loop"

# Commands that only read or move about: their arguments may quote anything.
READERS = {"git", "gh", "grep", "rg", "cat", "echo", "ls", "sed", "head", "tail", "get-content", "select-string",
           "printf", "write-output", "write-host", "gc", "sls", "findstr", "find", "wc", "awk", "less", "more", "type",
           "cd", "pushd", "popd", "set-location", "dir", "get-childitem", "test-path", "which", "command"}


def config_root(cwd):
    """The folder holding .perceptual-loop/config.json at or above cwd, or None. os.path only: this is the fast exit."""
    env = os.environ.get("PERCEPTUAL_LOOP_DIR")
    if env:
        return cwd if os.path.isfile(os.path.join(env, "config.json")) else None
    here = os.path.abspath(cwd)
    while True:
        if os.path.isfile(os.path.join(here, DIR_NAME, "config.json")):
            return here
        up = os.path.dirname(here)
        if up == here:
            return None
        here = up


# ----------------------------------------------------------------------------------------------------- command text

def strip_bodies(text):
    """The command without the bodies of heredocs and PowerShell here-strings: prose there is not a command."""
    import re

    out, end = [], None
    for line in text.split("\n"):
        if end is not None:
            if (end in ("'@", '"@') and line.lstrip().startswith(end)) or line.strip() == end:
                if end in ("'@", '"@'):
                    out.append(line.lstrip()[2:])  # what follows the terminator is command again
                end = None
            continue
        if line.rstrip().endswith(("@'", '@"')):  # a here-string opens: its quote must not open one for the splitter
            end = line.rstrip()[-1] + "@"
            out.append(line.rstrip()[:-1])
            continue
        out.append(line)
        m = re.search(r"(?<!<)<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1", line)
        if m:
            end = m.group(2)
    return "\n".join(out)


def split_segments(text):
    """Split on newlines, ';', '&&', '||', '|' and '&', outside quotes."""
    segs, buf, quote, i, n = [], [], None, 0, len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if quote:
            if c == "\\" and quote == '"' and nxt:
                buf.append(c + nxt)
                i += 2
                continue
            if c == quote:
                quote = None
            buf.append(c)
        elif c in "\"'":
            quote = c
            buf.append(c)
        elif c in "\\`" and nxt:  # an escaped character, a continued line (bash \, PowerShell `)
            buf.append(" " if nxt == "\n" else c + nxt)
            i += 2
            continue
        elif c in "\n;" or (c in "&|" and not (c == "&" and (nxt == ">" or (buf and buf[-1] == ">")))):  # not 2>&1, &>
            segs.append("".join(buf))
            buf = []
            if c in "&|" and nxt == c:
                i += 1
        else:
            buf.append(c)
        i += 1
    segs.append("".join(buf))
    return [s.strip() for s in segs if s.strip()]


def tokens(seg):
    import re

    return [t[1:-1] if len(t) > 1 and t[0] == t[-1] and t[0] in "\"'" else t
            for t in re.findall(r"\"[^\"]*\"|'[^']*'|[^\s\"']+", seg)]


def command_part(seg):
    """The segment without leading `VAR=value` / `env` prefixes, or '' when it only assigns or comments."""
    import re

    seg = seg.lstrip("({&! \t")
    while True:
        m = re.match(r"(?:env\s+|export\s+)?[A-Za-z_]\w*=(?:\"[^\"]*\"|'[^']*'|[^\s\"']*)*(\s+|$)", seg)
        if not m:
            break
        seg = seg[m.end():]
    if not seg or seg.startswith("#") or re.match(r"\$env:\w+\s*=\s*(?:\"[^\"]*\"|'[^']*'|\S+)\s*$", seg, re.I):
        return ""
    return seg


def first_word(seg):
    import re

    word = re.split(r"\s", seg.lstrip("\"'"), maxsplit=1)[0].strip("\"'").replace("\\", "/").rsplit("/", 1)[-1].lower()
    return word[:-4] if word.endswith(".exe") else word


def matches(patterns, seg):
    import re

    for p in patterns or []:
        try:
            if re.search(p, seg):
                return True
        except re.error:
            continue  # a broken pattern in the config must not block anything
    return False


def flag_value(toks, name):
    """--name V, --name=V, -Name V (PowerShell spelling, case ignored); '' when the flag is absent."""
    for i, t in enumerate(toks):
        low = t.lower().lstrip("-")
        if t.startswith("-") and low == name and i + 1 < len(toks):
            return toks[i + 1]
        if t.startswith("-") and low.startswith(name + "="):
            return t.split("=", 1)[1]
    return ""


def has_flag(toks, *names):
    return any(t.startswith("-") and t.lower().lstrip("-").split("=", 1)[0] in names for t in toks)


# ------------------------------------------------------------------------------------------------------------ rules

def count_shots(seg, pl, root, config):
    """(count, how it was asked) for the shots a render command names, or (None, '') when the text does not say.

    The selection rules of pl_common.resolve_shots: a group, else --all, else names and globs; --match narrows.
    """
    toks = tokens(seg)
    have = pl.all_shots(root, config)
    group, match = flag_value(toks, "group"), flag_value(toks, "match")
    listed = flag_value(toks, "shots")
    values = {group, match, listed} - {""}
    if group:
        groups = pl.load_groups(root)
        if group not in groups:
            return None, ""
        picked, how = pl.match_globs(have, groups[group]), f"--group {group}"
    elif has_flag(toks, "all"):
        picked, how = list(have), "--all"
    else:
        names = [n for t in ([listed] if listed else []) + [t for t in toks if not t.startswith("-") and t not in values]
                 for n in t.split(",") if n]
        known = set(have)
        picked = [s for n in names for s in ([n] if n in known else pl.match_globs(have, [n]) if any(c in n for c in "*?[") else [])]
        how = "named"
        if not picked:
            if not match:
                return None, ""
            picked, how = list(have), ""  # --match alone: a glob over every shot
    if match:
        picked, how = pl.match_globs(picked, [match]), (how + f" --match {match}").strip()
    return len(set(picked)), how


def baseline_update_problem(seg):
    toks = tokens(seg)
    at = next((i for i, t in enumerate(toks) if t.replace("\\", "/").rsplit("/", 1)[-1] == "baseline.py"), None)
    if at is None or "update" not in toks[at + 1:]:
        return None
    rest = toks[toks.index("update", at + 1) + 1:]
    takes_value = {"--source", "--run", "--dir", "--from", "--out", "--note", "--match"}
    positional = [t for i, t in enumerate(rest) if not t.startswith("-") and (i == 0 or rest[i - 1] not in takes_value)]
    missing = []
    if not has_flag(rest, "source"):
        missing.append("--source <one candidate>")
    if not (positional or has_flag(rest, "group", "shots", "all", "all-shots-of-run")):
        missing.append("a selection (shot names, --shots a,b, --group NAME, or --all-shots-of-run said explicitly)")
    return missing or None


def lock_script():
    return os.path.join(PLUGIN_ROOT, "scripts", "lock.py")


def python_word():
    return "python3" if os.path.basename(sys.executable).lower().startswith("python3") else "python"


QUOTED_NOTE = ("(A coordination aid, not a security boundary: the rule reads the command text and the name is self-declared. "
               "If this was only text quoted inside another command, a message or a note, put that text in a file and "
               "pass the file.)")


def unwrap_lock_run(seg):
    """`lock.py run APP ... -- command` -> ({APP, ...}, command): the wrapper holds those locks for the command.

    Any other use of lock.py -> (set(), ''): the lock tool itself is never guarded.
    """
    import re

    held = set()
    while True:
        m = re.search(r"\block\.py[\"']?\s+(?:--json\s+)?run\s+([A-Za-z0-9_.-]+)\s.*?\s--\s+(.*)$", seg, re.S)
        if not m:
            return (held, seg) if held or not re.search(r"\block\.py\b", seg) else (set(), "")
        held.add(m.group(1))
        seg = m.group(2)


def decide(command, root, log=True):
    """The reason to deny this shell command in the project at `root`, or None to let it run."""
    import re
    from pathlib import Path

    sys.path.insert(0, os.path.join(PLUGIN_ROOT, "scripts"))
    import pl_common as pl

    root = Path(root)
    config = pl.load_config(root)
    budget = config.get("budget") or {}
    apps = (config.get("locks") or {}).get("apps") or {}
    segments = split_segments(strip_bodies(command))
    # PL_RUN and PL_AGENT count where a shell would read them, not inside what a reader quotes.
    text = "\n".join(s for s in segments if not (command_part(s) and first_word(command_part(s)) in READERS))

    m = re.search(r"PL_RUN\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|(\S+))", text)
    reason = next((g.strip() for g in (m.groups() if m else ()) if g), "")
    reason_ok = bool(re.match(r"(verify|full):\s*\S", reason))
    m = re.search(r"PL_AGENT\s*=\s*[\"']?([A-Za-z0-9-]+)", text)
    agent = m.group(1) if m else ""

    large = []  # allowed large runs, logged only when nothing denies the command
    for raw in segments:
        seg = command_part(raw)
        if not seg or first_word(seg) in READERS:
            continue
        wrapped, seg = unwrap_lock_run(seg)
        if wrapped:  # the wrapped command: one quoted shell line, or a program and its arguments
            seg = command_part(seg.strip().strip("\"'"))
        if not seg:
            continue

        missing = baseline_update_problem(seg)
        if missing:
            return ("perceptual-loop: `baseline.py update` is always targeted, so that it never rewrites what it was not "
                    f"asked about. Missing: {'; '.join(missing)}.\n"
                    "  baseline.py update --source <candidate> <shot> <shot>     the shots you changed and looked at\n"
                    "  baseline.py update --source <candidate> --group <name>    a group, after its gate was read\n"
                    "Update from a run whose pictures you opened; `baseline.py check` first says what moved.\n" + QUOTED_NOTE)

        if re.search(r"(?<![\w-])--?(dry-?run|list|skip-?render|help|whatif)(?![\w-])", seg, re.I):
            continue  # nothing is rendered and no application starts

        free = int(budget.get("free", 3))
        if matches(budget.get("match"), seg):
            n, how = count_shots(seg, pl, root, config)
            if n is not None and n > free:
                if not reason_ok:
                    said = f' (PL_RUN is "{reason}": it must start with "verify:" or "full:" and say why)' if reason else ""
                    return (f"perceptual-loop budget: this command renders {n} shots ({how}); more than {free} needs its "
                            f"reason in the command{said}.\n"
                            "Run the smallest set that answers the question:\n"
                            f"  - every iteration: 1-{free} shots that show the thing you changed, by name\n"
                            "  - once, when the change already works: one group (--group smoke, or a topical one)\n"
                            "  - once, when the work is finished: the full suite\n"
                            "See what a selection means without rendering: add --dry-run to the same command.\n"
                            "A larger run states its reason where the owner sees it:\n"
                            '  bash:        PL_RUN="verify: <what already works, what this run checks>" <command>\n'
                            '  PowerShell:  $env:PL_RUN = "verify: <...>"; <command>\n'
                            '  whole suite: PL_RUN="full: <what is finished>"\n' + QUOTED_NOTE)
                large.append((n, seg))
            elif n is None and reason_ok:
                large.append(("?", seg))

        for app, spec in apps.items():
            if app in wrapped or not matches((spec or {}).get("match"), seg):
                continue
            import lock as pl_lock

            d = pl_lock.locks_dir(root, config)
            held = pl_lock.read_lock(d, app)
            if agent and held and held.get("agent") == agent:
                try:
                    pl_lock.refresh_lock(d, app, held)  # a holder at work keeps its lock fresh
                except OSError:
                    pass
                continue
            py, script = python_word(), lock_script()
            name = agent or "<agent>"
            why = (f"it carries no PL_AGENT=<name>" if not agent else
                   f"'{agent}' does not hold the lock (held by {held['agent']}, for: {held.get('for') or '?'})" if held else
                   f"'{agent}' does not hold the lock (it is free)")
            return (f"perceptual-loop lock: this command starts '{app}', of which one instance runs at a time across "
                    f"agents and worktrees, and {why}.\n"
                    "The normal way (queues for its turn, runs the command, always releases, kills it at its time limit):\n"
                    f'  {py} -B "{script}" run {app} --as {name} --for "<what, how long>" -- <command>\n'
                    "Exit 3 from it means still queued with the place kept: run the same command again.\n"
                    "Several commands under one hold:\n"
                    f'  {py} -B "{script}" acquire {app} --as {name} --for "<what, how long>"\n'
                    f"  PL_AGENT={name} <command>          PowerShell: $env:PL_AGENT = \"{name}\"; <command>\n"
                    f'  {py} -B "{script}" release {app} --as {name}     (also after a failure)\n'
                    "Hold the lock for the run only, never while thinking or editing. Names: lower-case letters, digits, '-'.\n"
                    + QUOTED_NOTE)

    if large and log:
        import time

        try:
            path = pl.runs_dir(root) / "budget.log"
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as f:
                for n, seg in large:
                    kind, _, why = reason.partition(":")
                    f.write("\t".join([time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), kind, str(n),
                                       " ".join(why.split()), " ".join(seg.split())[:160]]) + "\n")
        except OSError:
            pass
    return None


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


def main():
    try:
        raw = sys.stdin.read()
        # The fast exit, taken on every shell command of every project that does not use the plugin: no json, no re.
        cwd = quick_cwd(raw)
        if cwd and os.path.isdir(cwd) and config_root(cwd) is None:
            return 0
        import json

        data = json.loads(raw.lstrip(chr(0xFEFF)))
        command = (data.get("tool_input") or {}).get("command")
        if not command or not isinstance(command, str):
            return 0
        root = config_root(data.get("cwd") or os.getcwd())
        if root is None:
            return 0
        reason = decide(command, root)
        if reason:
            json.dump({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                              "permissionDecisionReason": reason}}, sys.stdout)
    except Exception:
        pass  # fail open: a broken guard must never stop work
    return 0


if __name__ == "__main__":
    sys.exit(main())
