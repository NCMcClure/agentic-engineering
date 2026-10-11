# Project memory: the contract

`.agents/memory/` is the project's long-term memory: decisions that bind future work, measured facts, lessons that
cost time, and the current status. It is tracked with the repository, so every agent and every person reads the
same thing. Git history records *what* changed. Memory records *why*, what was measured, and what not to try again.

## The tree

```
.agents/memory/
  INDEX.md                         one line per category folder; read first
  project/
    INDEX.md                       one line per memory of this folder
    <date>-project-status.md       the one status memory
  <category>/                      a kebab-case noun for what it holds: build-traps, rendering, dev-environment
    INDEX.md
    <YYYY-MM-DD>-<slug>.md         one topic per file
```

- Memories live in category folders only. The root holds `INDEX.md` and folders.
- A folder is named for its contents, never for a date, a type or a session.
- Folders are one level deep. A folder past its budget (12 memories) splits where it clearly divides, into two
  folders or into a nested one that follows the same rules.
- An emptied folder is deleted.

## Indexes are generated

Every `INDEX.md` is written by `aw memory index`: a heading, **one description line that you write** (what belongs
in this folder), a parent link, then the lists. The line of a memory is
`- [<slug>](<file>) — <type> — <description>`, taken from the memory's frontmatter and sorted by type, then slug.
Never edit the lists. To change a line, change the memory's `description`.

## A memory file

Named `<YYYY-MM-DD>-<slug>.md`:

- **The date** is the day of the last change to its content, and equals `updated`. The newest sorts last, so
  staleness shows in a listing.
- **The slug** is kebab-case, equals `name`, is unique across the whole tree and never changes. It is the memory's
  identity: other memories link to it as `[[slug]]`, and prose refers to "the `slug` memory", never to the dated
  file name.

```markdown
---
name: <slug>
description: <one line, 160 characters at most: what is in here and when it matters>
type: status | decision | learning | report | reference
updated: <YYYY-MM-DD>
---

# <Title>

<Lead with the fact or the rule. For a decision or a learning: why, and how to apply it. Absolute dates, exact
paths, commands, measured numbers.>
```

The `description` is the index line and the only thing a reader sees before deciding to open the file. Say what is
inside and when it is relevant. It is not a summary of the content.

| Type | Holds |
|---|---|
| `status` | Where the project stands. Exactly one memory has it. |
| `decision` | A choice made, with its reasons, that later work must respect. A choice that is hard to reverse gets a decision record instead (`decisions.md`). |
| `learning` | A verified fact or a trap, with how it was established. |
| `report` | The results of an experiment, with its numbers. |
| `reference` | Pointers to source material, or the material itself when it is large. |

Optional `tags: [a, b]`. A memory tagged `machine` or `tooling` is flagged as a candidate for the shared learnings.

## The status memory

One file, slug `project-status`, 120 lines at most, three sections:

- **Goal**: what the project is working towards.
- **Current focus**: what is being worked on now, as links to cards.
- **Known issues**: one line each, as links to cards.

No Done section, no changelog, no lessons. What is done is the git log and the closed cards (`aw status` prints
them). A lesson moves to its own memory, a task to a card. Past three times its budget the file is a critical
finding: nobody reads it any more, and every session pays for it.

## Reading

1. The root `INDEX.md`.
2. The status memory.
3. The `INDEX.md` of each folder your task touches.
4. Each memory whose description touches your task.

A memory is a claim as of its `updated` date. When it names a file, a flag or a number, check that against the
code before relying on it. The code wins: fix the memory. Between two memories the newer wins: reconcile them.

## Writing

- **Start** with `aw memory new <folder> <slug> --type <type> --description "<line>"` (`--about "<line>"` for a
  new folder). It refuses a slug that exists: update that memory instead.
- **After changing a memory's content** run `aw memory touch <slug>`: it sets `updated`, renames the file, fixes
  the links that named the old file, and rewrites the indexes. A typo fix is not a change.
- **Update, do not append a sibling.** Search the indexes for the topic first. Two memories on one topic is the
  duplication this contract exists to prevent.
- **Delete what turned out wrong**, and say why in the commit.
- **Write when** you learned something that was not obvious and cost time, made a choice later work must respect,
  or ran an experiment worth its numbers.
- **Before finishing** a session that changed or learned something: update the status memory (focus and known
  issues only) and touch it.

## What memory does not hold

- What the code or the git log already says: file listings, how a function works, a changelog.
- Tasks. A "next" list is cards.
- Rules. A rule is in the root `AGENTS.md`; memory holds its why.
- Reports of a session. Keep the lasting fact, drop the narrative.
- Secrets, tokens, account identifiers, personal data beyond what the work needs.

## Consolidation

When `aw memory lint` reports sizes (`MEM_FILE_SIZE`, `MEM_FOLDER_OVER`, `MEM_HOOK_LONG`, `STATUS_SIZE`):

1. A long memory covers several topics: split it by topic, one slug each; keep the old slug for the part most
   links mean.
2. A full folder: split it where it divides, describe both folders in their `INDEX.md`.
3. A long description: rewrite it as what and when. The detail is already in the file.
4. An oversized status: delete the Done section, move each lesson to a topic memory, turn each open item into a
   card and leave its link.
5. Merge memories that say the same thing, and delete those the code has since made false.
6. `aw memory index`, then `aw memory lint` and `aw links` until they are quiet.

## Project memory or shared learnings

A lesson that would be true in any repository on this machine (a fact about the operating system, a shell, a
compiler, an engine, a tool) is a **shared learning**: `aw learn add --topic "<line>" --tags a,b --from-file <file>`.
Every project on the machine can then find it with `aw learn search <words>`. A lesson about this project (its
code, design, measurements, its owner's preferences) stays here. `coordination.md` says what must never go into a
shared learning.
