# Changelog

- **0.2.0**: new `context-lens` skill. It reads a Claude Code session transcript back and shows what entered the agent's context, when, and from which plugin: each hook's output and who saw it (the model, the person, or nobody), the skill listing per plugin, the API's token count per request, and what each compaction kept or lost. A terminal report, or a local page with the per-request chart.
- **0.1.1**: the create/evaluate workflows and their skill docs resolve `python3` or `python` instead of hardcoding `python3`, so the scan/scaffold/score commands run where only `python` is installed (e.g. Windows/Git-Bash).
- **0.1.0**: initial release: the six-dimension measurement core (rubric,
  deterministic scanner/scorer, HTML scorecard), create-plugin with
  deterministic scaffolding and an autonomous authoring workflow,
  evaluate-plugin with adversarially-verified autonomous evaluation, and
  improve-plugin's delta-ranked fix loop.
