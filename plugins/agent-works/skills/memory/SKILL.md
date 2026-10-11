---
name: memory
description: Use to read project memory before a task, record a lesson, or update status.
---

# memory

Memory holds the why, the measurements and the lessons, one topic per file, with indexes that a command writes.
The contract is `${CLAUDE_PLUGIN_ROOT}/core/references/memory.md`: read it before your first write in a
repository, and its Consolidation section when a file or folder is over budget.

A plan or a spec is not a memory: those are the but-first-planning plugin's, under `.agents/plan/`.

## Step 1 — Read before working

1. `.agents/memory/INDEX.md`: the folders.
2. The status memory (the one of type `status`): the goal, the current focus, the known issues.
3. The `INDEX.md` of each folder your task touches, then each memory whose line touches it.
4. `aw learn search <words>` before a fight with a tool, a compiler or the machine: another project may have paid
   for the lesson already.

A memory is a claim as of its date. Where it names a file, a flag or a number, check the code; when they differ,
the code wins and you fix the memory.

*Done when: you can name the memories that bear on your task, or say that none does.*

## Step 2 — Decide whether it is a memory

| What you hold | Where it goes |
|---|---|
| A lesson that cost time, a verified fact, a measurement, the reason behind something | a memory: Step 3 |
| True on any project of this machine (a tool, a shell, a compiler, the operating system) | `aw learn add --topic "<line>" --tags a,b --from-file <file>` |
| Work to do, a check to run later | a card: the `kanban` skill |
| A choice that is hard to reverse, or a new term | the `decisions` skill |
| A rule every agent must follow | the root `AGENTS.md`, with the memory as its why |
| What the code or the git log already says; what you did this session | nowhere |

*Done when: each fact you hold has one destination from this table.*

## Step 3 — Write

Search the indexes for the topic first. A memory that covers it is **updated**, not joined by a second one.

```
aw memory new <folder> <slug> --type <decision|learning|report|reference> --description "<what is in it, when it matters>"
aw memory touch <slug>
```

`new` starts the file from the template (`${CLAUDE_PLUGIN_ROOT}/assets/templates/memory-file.md`) and writes the
indexes; add `--about "<line>"` when the folder is new. `touch` is for after you changed a memory's content: it
sets the date, renames the file, fixes links to the old name and rewrites the indexes. Never edit an `INDEX.md`
list or rename a memory by hand.

In the body: the fact or the rule first, then why and how to apply it; absolute dates, exact paths, commands,
measured numbers; other memories as `[[slug]]`. The description is the index line, 160 characters at most.

*Done when: the memory exists under one slug, and `aw memory index --check` exits 0.*

## Step 4 — Update status before you finish

When your session changed where the project stands, edit the status memory and run `aw memory touch project-status`.
It has three sections: Goal, Current focus, Known issues, the last two as links to cards. It has no Done section:
what is done is the git log and the closed cards (`aw status`). A new status memory comes from
`${CLAUDE_PLUGIN_ROOT}/assets/templates/status.md`; the root index from `memory-index.md` in the same folder.

*Done when: Current focus and Known issues match the board, and the file is within its budget.*

## Step 5 — Check

```
aw memory lint
```

Sizes over budget (`MEM_FILE_SIZE`, `MEM_FOLDER_OVER`, `MEM_HOOK_LONG`, `STATUS_SIZE`) are repaired by the
Consolidation steps of the contract; `MEM_SHARED_CANDIDATE` asks whether a memory belongs in the shared learnings.

*Done when: `aw memory lint` reports nothing your change introduced.*
