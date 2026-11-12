# The multi-agent skills on a host that cannot do everything

Three skills lean on something not every host offers: `orchestrate` and `dispatch` start child sessions,
`sync-cards` runs a Workflow script, and `review-card` asks a second reader for a risky diff. Each still works
without it. What must not change is what the missing piece was for: one branch and one worktree per card, the
person's yes before anything starts, a review before anything merges, and the board as the record.

`aw board` below is `node "<plugin root>/scripts/aw.mjs" board`.

## No child sessions (`orchestrate`, `dispatch`)

**The person can open a terminal.** `dispatch` prints `claude -w card-<id> "/agent-works:work-card <id>"` for
them to run, records the card with `aw board bind <id> --terminal`, and waits with a background
`aw board wait --until review --ids <id>` (exit 3 is its timeout: run it again). Findings go under `## Review` in
the card's file, where the child reads them with `aw board show <id>`.

**Nobody can start a session.** Work the cards serially in this one:

1. `git worktree add <path> -b <the card's branch> origin/<base>`, then `aw board bind <id> --serial`.
2. Follow the `work-card` skill with that worktree as the working directory of every command: claim, build
   test-first, push under the grant, open the request, `aw board move <id> review --mr <number>`.
3. Review it as the `review-card` skill says before the next card starts. You wrote the diff, so read it against
   the done criteria as a stranger would, re-run the checks from a clean state, and say in your report that the
   review was your own.
4. `aw board done <id> --merged <sha>`, remove the worktree, take the next ready card.

The parallel set still matters: `aw board propose` gives the order, and a card that waits on another still waits.

**Subagents, but no sessions.** A subagent may build a card in the card's worktree, on the card's branch, with the
brief `aw board brief <id>` prints as its whole prompt. It is not a child session: the person cannot open or steer
it, so say so when you ask for their yes, keep to one subagent per card, and review each diff yourself. The
card-sync hook holds a subagent's stop for the cards it committed to.

## No Workflow tool (`sync-cards`)

Run the script's three phases by hand, in order, the parent holding what the script would have held.

1. **Assess.** `aw board evidence <ids> --json`, in chunks of about 15. Settle a card only when the evidence
   already shows it stands where it is; a card with a request on it is never settled without that request's
   state. For every other card write down what to find out.
2. **Investigate, read-only.** With subagents: one per unsettled card, launched together, each given the card id,
   what to find out, and the states its scope allows; each returns one state, its confidence, and the commands
   that showed it. Without subagents: do the same checks yourself, one card at a time. Nobody changes git state or
   edits a file in this phase.
3. **Confirm and move, one card at a time.** Re-run the one check a thin verdict rests on. Then
   `aw board note <id> "sync: <state>, <the evidence in a line>"` and the move the scope allows. What the scope
   leaves to the person (abandon, archive, accept) is a proposal, never a move. Only the parent writes.

Report as the skill's Step 3 says: applied, proposed, kept, and what could not be checked.

## No second reader (`review-card`)

With subagents, the second reader of a risky diff is a subagent whose prompt holds only the card's done criteria
and the diff: never the child's report, never your own reading. Without them, read the diff once more with the
report closed, criterion by criterion, and either owe an independent look as a gate
(`aw board owe "Independent review of <the request>" --ref <the request> --needs "a second reader"`) or ask the
person to look before it merges. Say which in your report.
