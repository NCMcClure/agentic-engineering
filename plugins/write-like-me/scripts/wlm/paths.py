"""Path resolution for write-like-me state.

All mutable state lives outside the plugin cache dir (which is replaced
wholesale on plugin update):

  ${CLAUDE_PLUGIN_DATA}/     data home (override: WLM_HOME) — survives updates
    observations.jsonl       pending style-feedback events
    changelog.md             dated log of profile edits
    samples/                 user writing samples gathered by calibrate
    state/                   timestamps and session flags
  ~/.claude/rules/write-like-me.md   the profile (single source of truth)

Claude Code exports CLAUDE_PLUGIN_DATA to hook processes; it persists across
plugin updates and is deleted on uninstall (unless --keep-data).
"""

import os
from pathlib import Path


def data_home() -> Path:
    env = os.environ.get("WLM_HOME") or os.environ.get("CLAUDE_PLUGIN_DATA")
    if not env:
        raise RuntimeError(
            "write-like-me: neither WLM_HOME nor CLAUDE_PLUGIN_DATA is set"
        )
    return Path(env)


def profile_path() -> Path:
    env = os.environ.get("WLM_PROFILE")
    return Path(env) if env else Path.home() / ".claude" / "rules" / "write-like-me.md"


def observations_path() -> Path:
    return data_home() / "observations.jsonl"


def changelog_path() -> Path:
    return data_home() / "changelog.md"


def samples_dir() -> Path:
    return data_home() / "samples"


def state_dir() -> Path:
    return data_home() / "state"


def ensure_dirs() -> None:
    for d in (data_home(), samples_dir(), state_dir()):
        d.mkdir(parents=True, exist_ok=True)
