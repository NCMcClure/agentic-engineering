# Decisions, the glossary and contracts

Three kinds of agent-facing reference, all under `.agents/` and never under `./docs`, which is for the people who
use the project.

## Decision records

`.agents/decisions/NNNN-slug.md`: one decision per file, numbered in the order made, 150 lines at most.

**A decision deserves a record when at least one holds:**

- it is hard to reverse (a format, a protocol, a dependency, a boundary between modules);
- it is surprising without its context: a later reader would "fix" it;
- it was a real trade-off: something of value was given up, and the next person will ask why.

A choice that is none of these is a line in a commit message or a memory of type `decision`.

Start one with `aw decisions new "<title>"` (`--slug`, `--status`; the default status is `proposed`). It takes the
next number, fills `assets/templates/decision.md` and rewrites the index. The heading follows the folder: the
majority form of its five latest records (`# 0014. Title`, `# ADR 0014: Title`, `# 0014: Title`, `# 0014 - Title`),
and `# NNNN. Title` in an empty folder. The lint and the index read every one of these forms. The five sections, all required:

| Section | Holds |
|---|---|
| **Status** | `proposed`, `accepted`, `superseded by NNNN` or `rejected`, with the date |
| **Sources** | where it comes from: the issue, the measurement, the conversation, the memory. Links. |
| **Context** | what forced a choice: the constraints and the options that were on the table |
| **Decision** | the choice, in the present tense |
| **Consequences** | what follows: what gets easier, what gets harder, what must now hold |

Status and Sources are also read in the common ADR form, as a line above the first `##` section instead of a
section of their own: `- **Status:** accepted`, `**Status**: accepted`, `Status: accepted`, or `status:` in
frontmatter (the same for `Sources` and `Date`; a date is added to the status in the index). Records written that
way pass the lint as they are; nothing rewrites them. Context, Decision and Consequences are always sections.

Measurements and long reasoning belong in a memory that the record links to; the record stays short enough to read
in a minute.

**Supersede, do not amend.** A record is history: later readers need to see what was decided when. A record takes
**one** `## Amendment` section, for a correction that does not change the choice. When the choice changes, write a
new record, set the old one's Status to `superseded by NNNN`, and say in the new one's Context what changed.

The index `.agents/decisions/README.md` is generated: `aw decisions index`. Never edit it. It is generated when
one of its first lines is the marker that command writes. A `README.md` without the marker is **hand-written**
and is kept, as a hand-written memory index is: `aw decisions index` refuses to run over it and says so,
`aw decisions new` adds the new record's one line to it, `aw setup --apply` never touches it, and
`aw decisions lint` reports it as `DEC_INDEX_HANDWRITTEN` (information, not a failure). `aw decisions index
--adopt` replaces it with the generated index: first move what its lines say beyond number, title and status
into the records.

## The glossary

`.agents/CONTEXT.md`: the project's words, each defined once, in a table.

| Term | Meaning | Source |
|---|---|---|
| the word as it is used in code and prose | what it means here, and what it is not confused with | the decision, memory or file that fixes it |

- One glossary per project. One row per term, 300 characters at most: the meaning, not the story. The why goes
  into a decision and the row links to it.
- A new term enters the glossary **in the same change** that introduces it.
- Use the glossary's words everywhere: in code, hubs, memories, cards and briefs. Two words for one thing is a
  finding to fix, not a style choice.

## Contracts

`.agents/contracts/` holds the pages an agent needs to change the project safely: a protocol, a file format, what
an extension must implement, how to add a module of a given kind. A contract describes the present, so it changes
**in the same commit** as the thing it describes. `aw links` checks that the paths and links in it resolve.

A page written for the project's users is not a contract. It goes in `./docs`.

## The checks

`aw decisions lint` reads the records, the index and the glossary:

| Code | Meaning | Fix |
|---|---|---|
| `DEC_NUMBER` | a file not named `NNNN-slug.md`, a number used twice, a heading with another number | rename, renumber the newer one |
| `DEC_SECTIONS` | one of the five sections is missing (Status and Sources may be a line above the first section) | add it; "none" is an answer |
| `DEC_SIZE` | over `budgets.decisionLines` | move measurements and narrative into a memory, link it |
| `DEC_AMENDED` | more than one amendment | write the record that supersedes it |
| `DEC_INDEX_STALE` | the index is missing, or a generated one differs from the records | `aw decisions index` |
| `DEC_INDEX_HANDWRITTEN` (info) | the index was written by hand, and is kept | nothing; to convert it, `aw decisions index --adopt` and read the diff |
| `GLOSSARY_MULTI` | more than one glossary (a root `CONTEXT.md`, one under the user docs) | merge into `.agents/CONTEXT.md` with `git mv`, delete the other |
| `GLOSSARY_DUP_TERM` | a term defined twice | keep one row |
| `GLOSSARY_ROW_LONG` | a row over `budgets.glossaryRowChars` | define the word; the why goes into a decision |

`aw doctor` adds `DOCS_AGENT_FILE` for records or a glossary found under the user docs, with the `git mv` to run,
and `aw links` then finds every link the move broke.
