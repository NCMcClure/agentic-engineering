# write-like-me

A Claude Code plugin that reshapes how Claude writes **human-facing prose**
(emails, docs, READMEs, reports, posts, messages) so it sounds like *you*
instead of like a language model. Code, commit messages, and PR descriptions
are deliberately out of scope.

## How it works

1. **An always-on profile.** `~/.claude/rules/write-like-me.md` (overridable
   via `WLM_PROFILE`) is a tightly line-budgeted voice profile that Claude Code
   loads into every session as one of your own rules, and reloads after a
   compaction. Your tone, rhythm, vocabulary, and formatting habits, written
   as actionable instructions. `scripts/wlm/profile-budget.mjs` owns and
   enforces the budget.
2. **Skills** for the deep guidance, loaded on demand (the table below).
3. **Reflective hooks** that learn from you:
   - `UserPromptSubmit` spots style feedback ("too formal", "not my voice",
     "stop using em-dashes"), records it, and reminds Claude to honor it now.
   - `Stop`: when feedback is pending (max once per session, at least an hour
     apart), has Claude fork a subagent that folds it into the profile as an
     in-place revision to the relevant section, logging old → new to a
     changelog so any revision can be reversed. Auto-applied, always
     reviewable.
   - `SessionStart`: a one-line nudge to calibrate if no profile exists (at
     most once a day).

The hooks and the budget script run on Node 22, no dependencies. On a machine
without Node the hooks switch themselves off and say so once per session.

## Install

```bash
# from Claude Code
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install write-like-me@agentic-engineering
```

Then run `/write-like-me:calibrate` once.

## Skills

| Skill | Invocation | Does |
|---|---|---|
| `write-like-me` | automatic on prose tasks | drafts in your voice; self-checks against the AI-tells catalog |
| `calibrate` | `/write-like-me:calibrate` | builds the profile from writing samples + a short interview |
| `audit` | `/write-like-me:audit` or "does this sound AI?" | scans existing text for tell clusters, offers a rewrite |
| `review` | `/write-like-me:review` | shows/prunes/reverts the profile, pauses learning |

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
pass `--keep-data` on the CLI to preserve it). The profile is yours to keep;
remove it by hand if you want it gone:

```bash
rm ~/.claude/rules/write-like-me.md
```

## The tells catalog

The catalog Claude checks drafts against is
[`skills/write-like-me/references/ai-tells.md`](skills/write-like-me/references/ai-tells.md):
a lexical framework (style-word categories plus the spoken-register test,
rather than a decaying word list), structural/rhetorical patterns
(rule-of-three runs, negative parallelism, hedging, uniform rhythm),
formatting tells, and the honest caveats (tells decay once publicized, single
signals are unreliable, and only *co-occurring clusters* mean much). Primary
sources (2024–2026 detection research) are cited in the catalog's footer.
