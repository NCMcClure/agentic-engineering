#!/usr/bin/env python3
"""SessionStart hook of agent-works.

In a project with .agents/agent-works.json:
  - heals the CLAUDE.md twins when claude.twins is "generated" (they are git-ignored, so a fresh checkout or worktree
    has none). When the root twin had to be written, this session started without the project's guidance: one line
    on stdout tells the model to read AGENTS.md now;
  - registers the session in the machine-wide store (aw who), when the coordination modules are there.

Inert without the config; any failure: exit 0, no output.
"""
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
CLI_DIR = os.path.join(os.path.dirname(HERE), "cli")


def config_root(cwd):
    here = os.path.abspath(cwd)
    while True:
        if os.path.isfile(os.path.join(here, ".agents", "agent-works.json")):
            return here
        up = os.path.dirname(here)
        if up == here:
            return None
        here = up


def main():
    try:
        import json

        raw = sys.stdin.buffer.read().decode("utf-8", "replace") if not sys.stdin.isatty() else ""
        try:
            data = json.loads(raw.lstrip(chr(0xFEFF))) if raw.strip() else {}
        except ValueError:
            data = {}
        if not isinstance(data, dict):
            data = {}
        cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else os.getcwd()
        root = config_root(cwd)
        if root is None:
            return 0
        sys.path.insert(0, CLI_DIR)
        import common

        cfg = common.load_config(root)
        lines = []
        try:
            import twins

            if twins.mode_of(cfg) == "generated":
                res = twins.heal(common.project_root(root), cfg, orphans=False)
                if res["root_created"]:
                    lines.append("agent-works: this checkout had no CLAUDE.md, so the project's guidance was not loaded "
                                 "when the session started. Read AGENTS.md at the repository root now, before anything "
                                 "else. (The CLAUDE.md twins were just written; later sessions load it by themselves.)")
        except Exception:
            pass
        try:
            from coord import agents, store

            agents.start(store.Context(start=cwd), session=data.get("session_id") or None)
        except Exception:
            pass
        if lines:
            sys.stdout.write("\n".join(lines) + "\n")
    except Exception:
        pass  # fail open
    return 0


if __name__ == "__main__":
    sys.exit(main())
