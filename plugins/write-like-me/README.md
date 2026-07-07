# write-like-me

A Claude Code plugin that reshapes how Claude writes **human-facing prose** —
emails, docs, READMEs, reports, posts, messages — so it sounds like *you*
instead of like a language model. Code, commit messages, and PR descriptions
are deliberately out of scope.

## How it works — three layers

1. **Always-on profile** — `~/.claude/rules/write-like-me.md`, a ≤60-line
   voice profile Claude Code auto-loads into every session. Your tone, rhythm,
   vocabulary, and formatting habits, written as actionable instructions.
2. **Skills** — deep guidance loaded on demand:
   | Skill | Invocation | Does |
   |---|---|---|
   | `write-like-me` | automatic on prose tasks | drafts in your voice; self-checks against the AI-tells catalog |
   | `calibrate` | `/write-like-me:calibrate` | builds the profile from writing samples + a short interview |
   | `audit` | `/write-like-me:audit` or "does this sound AI?" | scans existing text for tell clusters, offers a rewrite |
   | `review` | `/write-like-me:review` | shows/prunes/reverts the profile, pauses learning |
3. **Reflective hooks** — lightweight Python hooks that learn from you:
   - `UserPromptSubmit` spots style feedback ("too formal", "not my voice",
     "stop using em-dashes"), records it, and reminds Claude to honor it now.
   - `Stop` — when feedback is pending (max once per session, ≥1 h cooldown),
     forks a subagent that folds it into the profile's `## Learned` section
     and logs the diff to a changelog. Auto-applied, always reviewable.
   - `SessionStart` — one-line nudge to calibrate if no profile exists
     (at most once a day).

## Install

```bash
# from Claude Code
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install write-like-me@agentic-engineering
```

Then run `/write-like-me:calibrate` once.

## State on disk

Nothing mutable lives in the plugin install dir (it's replaced on update):

```
~/.claude/rules/write-like-me.md   the profile (single source of truth)
${CLAUDE_PLUGIN_DATA}/             ~/.claude/plugins/data/write-like-me-agentic-engineering/
├── observations.jsonl             pending style-feedback events
├── changelog.md                   dated log of every profile change
├── samples/                       your writing samples (calibrate)
└── state/                         cooldown timestamps, session flags
```

The data dir survives plugin updates. Override locations with `WLM_HOME`
(data dir) and `WLM_PROFILE` (profile path).

## Uninstall / cleanup

Uninstalling the plugin also deletes the data dir (Claude Code prompts first;
pass `--keep-data` on the CLI to preserve it). The profile is yours to keep —
remove it by hand if you want it gone:

```bash
rm ~/.claude/rules/write-like-me.md
```

## Changelog

- **0.2.0** — distilled the bundled research corpus into the catalog itself:
  lexical tells are now categories + tests (word lists decay; the framework
  doesn't), references trimmed, primary citations kept as a footer. Dev-only
  `evals/` dropped. Hooks no longer write bytecode (`python3 -B`).
- **0.1.0** — initial release via the agentic-engineering marketplace; state
  lives under `${CLAUDE_PLUGIN_DATA}`.

## The tells catalog

The catalog Claude checks drafts against is
[`skills/write-like-me/references/ai-tells.md`](skills/write-like-me/references/ai-tells.md)
— a lexical framework (style-word categories plus the spoken-register test,
rather than a decaying word list), structural/rhetorical patterns
(rule-of-three runs, negative parallelism, hedging, uniform rhythm),
formatting tells, and the honest caveats: tells decay once publicized, single
signals are unreliable, and only *co-occurring clusters* mean much. Primary
sources (2024–2026 detection research) are cited in the catalog's footer.
