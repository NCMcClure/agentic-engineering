# Changelog

- **1.0.0**: runs on Node 22, no bash or jq. The repo's marker is `.agents/manifest.json`, and a repo on `.claude/teamwork.json` is moved to it at the next session with every rule it enforced kept. The guard reads a command the way a shell does (chains, `cd`, `git -C`, `bash -c`, PowerShell), asks before a push, allows a repo's first commit, deleting tracked junk and `.env.example`, and judges the work tree the session is in. The briefing returns after a compaction or `/clear`, and what the stop gate finds reaches the agent. The hard test gate, lint on edit and coupled-file reminders are now opt-in under the manifest's `teamwork` block. New skills `bootstrap`, `init-project`, `audit-project`, `ship`, `land` and `tdd` replace `teamwork-init` and `teamwork-audit`.
- **0.1.2**: boundary note: team git guardrails live here, agent-specific guards in agent-works.
- **0.1.1**: README reworded.
- **0.1.0**: Initial release: git-guard, session briefing, edit-check,
  stop-gate; terminal pre-commit mirror; GitHub + GitLab providers;
  `/teamwork-init` and `/teamwork-audit`.
