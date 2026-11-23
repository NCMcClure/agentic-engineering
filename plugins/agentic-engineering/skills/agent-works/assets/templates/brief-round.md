# Round <date>: <what this round is for>

<!-- Copy to the briefs folder as rounds/<date>-<slug>.md and fill it. 80 lines at most. Only what this round adds to the common brief: never repeat that brief or the root AGENTS.md. -->

Read after the root AGENTS.md and the common brief. <One paragraph: what the owner asked for, in the owner's words
where they matter, and what state the work is in today, with links to the cards and the decisions.>

## Who does what

| Agent | Card | Task | Workspace | Needs exclusively |
|---|---|---|---|---|
| `<name>` | <id> | <one line> | <worktree path, or "main checkout"> | <a lock, a counter, the main checkout; or nothing> |

The main checkout belongs to `<name>` for this round. Nobody else switches its branch or edits its files.

## Collisions

<Files or modules that two tasks touch, and how that is settled: who goes first, who merges the other's change in,
what each says in a note before starting. "None" if the cut is clean.>

## Must not move

<What every task leaves as it is unless it says so in its report: a baseline, a public interface, the behaviour of
a mode that is not being worked on.>

## Shared in this round

- **Counters:** <names; who is likely to claim each>
- **Locks:** <which resources will be contended, and how many agents want each. Expect to wait; plan the runs.>
- **Disk and time:** <free space to keep, the longest run anyone should start without a note>

## Rulings of this round

<Decisions the owner made for this round that override older text, one line each, with the date. A ruling that
binds beyond the round becomes a decision record or a rule in the root AGENTS.md before the round closes.>

## Integration

<Who runs the integration pass after the merges, on which checkout, and what it runs once: the gates the tasks
owe, the whole suite. Merges happen in this order: <order, or "any">.>

## Closing the round

The round is closed when every card is in review or done, every owed gate is settled or has an owner and a date,
every claim is landed or released, and what the round learned is in memory. This file then stays as the record.
