---
name: reuse-first
description: >
  Before building a component, a utility, a parser, a client, or anything else
  that sounds like it might already exist, check what this repo and the other
  checkouts the person has listed already have. Use whenever a task would add
  a dependency, a UI component, or a capability another module plausibly has,
  and whenever the ladder reaches rung 2. To offer something back the other
  way use capture-reusable.
argument-hint: "<the thing, in plain words>"
---

# reuse-first

Rung 2 of the ladder, widened past the file you are in. Re-implementing what already exists costs twice: once to write it, then forever to keep the two in step.

## Step 1: Ask the index

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/reuse-index.mjs" "<the thing in plain words>" --json
```

It searches this repo, then every directory the person has listed under `code-diet.reuse` in git config: a shared component library, a sibling service, a utilities repo. A candidate is a file: its path, its opening comment, and the names it defines. `searched` says where it looked. A listed directory it could not read is named in `skipped`, never dropped, and means "unknown", not "nothing".

Phrase the query the way a person would describe the thing ("a resizable side panel", "sunrise and sunset times"), not the way your code would name it. The index matches paths, names, and opening comments, not bodies: when it comes back empty, one search for the core noun is still worth it before you conclude nothing exists.

`--also <dir>` searches one more directory for this query only. When the person mentions another codebase that might hold the thing, offer them the one-time setup instead of guessing a path:

```
git config --global --add code-diet.reuse <path to that checkout>
```

*Done when: the script exited 0 and `results`, `searched`, and `skipped` have been read.*

## Step 2: Judge each candidate

For each result, one of three verdicts:

- **adopt**: it does the job. Use it as it stands. From another checkout that means through whatever that project publishes (a package, a registry, a documented copy step), never an import that reaches into someone else's tree by path.
- **adapt**: it does most of the job. In this repo, extend it where it lives. From another checkout, take it and extend it here, and say in one line what you extended: that line is the case for offering the extension back.
- **build**: nothing covers it. A normal outcome, not a failure.

Read the candidate before judging it. A description is a claim; the source is the evidence.

*Done when: every result carries exactly one verdict and the chosen one is named.*

## Step 3: Log a deliberate non-reuse

On **build**, append one line to `.agents/reuse-opportunities.md` (create it if absent):

```
- <date> <what you built>. Closest existing: <candidate or "nothing">. Why it did not fit: <one clause>.
```

That file is the input to `/code-diet:capture-reusable` at the end of a session. Without it, the second project that needs the same thing has no way to know the first one already built it.

*Done when: the line exists, or the verdict was adopt or adapt.*
