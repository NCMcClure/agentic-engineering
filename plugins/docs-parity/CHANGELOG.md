# Changelog

- **1.0.0**: runs on Node 22 alone, with Python gone: `docs-check.mjs` replaces `docs_check.py` (the same
  `.agents/docs-parity.json`, findings, output and exit codes; `--flag=value` and a config found from a
  subfolder are new) and both hooks are `.mjs`. The rule is now one critical line from the shared session
  kernel: it speaks only in a repo that has `.agents/docs-parity.json`, never to read-only agent types, and
  comes back after a compaction or a `/clear`. What the Stop check finds now reaches the agent, once per
  session, instead of only the person, and it judges the work tree the session is in. New `readme` skill and
  `readme-check.mjs` (800 words, standard-readme's sections, no agent plumbing), checked at Stop where the
  config carries a `readme` block. `docs-audit` can be started by the model. The writer contract moves from
  `.agents/contracts/docs.md` to `.agents/docs-contract.md` (the session hook moves it), `docs-init` no longer
  writes the rule into `AGENTS.md`, and references and templates now live under `skills/`.
- **0.1.0**: first release. The `docs-parity`, `docs-init`, `docs-sync`, `docs-shots` and `docs-audit` skills;
  the references (audiences, page shape, targets including wikis, the shot contract, capture recipes per stack,
  the config); `docs_check.py` with tree, `--changed` and `--stale` modes; the session-start kernel and the
  advisory Stop hook.
