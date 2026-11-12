# Changelog

- **1.0.0**: Node 22 throughout, no Python. The three hooks and the budget script are `.mjs`, and a machine without Node gets one line at session start instead of an error on every event. `scripts/wlm/profile_budget.py` is now `scripts/wlm/profile-budget.mjs`, run with `node`: same output, same exit codes. The profile, the feedback ledger and the state files stay where they are and keep their formats. SessionStart is registered for startup, resume, clear and compact. Every hook is silent on empty or malformed stdin (the calibrate nudge used to fire on it).
- **0.3.2**: feedback detection strips harness-injected content (`<task-notification>`/`<system-reminder>` blocks, `[SYSTEM NOTIFICATION - NOT USER INPUT]` lines) before matching, so trigger words quoted in background-task reports no longer log false observations.
- **0.3.1**: the SessionStart / UserPromptSubmit / Stop hooks resolve `python3` or `python` at runtime instead of hardcoding `python3`, so they work on machines (e.g. Windows/Git-Bash) that ship only `python`.
- **0.3.0**: feedback now folds into the profile as in-place revisions to the
  existing sections; the `## Learned` section is gone from the template, the
  refine hook, and the review/calibrate skills. The data-dir changelog's
  old → new record is what keeps auto-revisions reversible.
- **0.2.2**: README reworded.
- **0.2.1**: calibrate and review are now hand-run (`disable-model-invocation`), cutting the always-on listing to ~172 est tokens; the profile line budget lives in and is enforced by scripts/wlm/profile_budget.py; skills reference the WLM_PROFILE-aware resolver instead of hardcoding the path; audit no longer competes with write-like-me on "humanize"/"de-AI".
- **0.2.0**: distilled the bundled research corpus into the catalog itself:
  lexical tells are now categories + tests (word lists decay; the framework
  doesn't), references trimmed, primary citations kept as a footer. Dev-only
  `evals/` dropped. Hooks no longer write bytecode (`python3 -B`).
- **0.1.0**: initial release via the agentic-engineering marketplace; state
  lives under `${CLAUDE_PLUGIN_DATA}`.
