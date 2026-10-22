---
name: docs-sync
description: >
  Bring the user docs level with a code change before it is committed: map the
  diff to the pages and screenshots it affects, rewrite those pages, retake the
  affected capture groups, run the checker, and write the Docs: line. Use after
  (or while) changing a user-visible surface, when the Stop hook or CI reports
  PARITY_MISSING or SHOT_STALE, or when the user says "update the docs for
  this", "sync the docs", or "retake the screenshots".
---

# docs-sync

The in-loop pass. It runs on the change in front of you, not on the whole docs set (that is `docs-audit`),
and it finishes before the commit, so the docs are reviewed in the same pull request as the code.

## Step 1: What moved

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/docs_check.py" --changed HEAD --json
```

`--changed HEAD` compares the working tree (untracked files included) with the last commit; use
`--changed <base>..HEAD` for a branch. Each `PARITY_MISSING` names a surface, its pages and its capture
group. The config's surfaces are a map, not the territory: also read the diff yourself and ask what a reader
of each root (`audiences.md`) would now see differently. A surface the map lacks is a config fix in the same
change.

*Done when: you have a list of pages to edit, pages to add or delete, and capture groups to rerun, or a
reason none is needed.*

## Step 2: Rewrite the pages

Read `.agents/contracts/docs.md` first; it is the project's version of the rules below.

- Describe the product as it is after this change. Rewrite the passage that is now wrong; do not append a
  "New:" note or leave the old behaviour beside the new.
- **Ground every claim.** Run the command, open the screen, call the endpoint, read the default from the
  code. A flag you did not see work does not go in.
- Keep the page shape (`page-shape.md`): frontmatter, the opening summary still true, one topic, under budget.
  A page that outgrows its budget splits by topic, and the nav manifest gains the new page in reading order.
- A new page goes into the nav manifest in reading order; a deleted page leaves it, and every link to it is
  fixed. A page whose audience changed moves to the right root (`audiences.md`), and no public page links
  into a private root.
- Prose in the project's voice. With write-like-me installed, write the prose through it.

## Step 3: Retake the shots

For every affected capture group: change the shot code first if the screen's structure changed (a selector, a
seeded name, a scripted answer), then run the group with the config's `capture` command. Then **look at every
image you wrote, both themes**: the right state, nothing secret or real on screen, cropped to what the text
describes, no spinner, toast or cursor. A new image needs a new shot in the harness, never a hand-made file.
No harness yet: open `docs-shots`. The contract is `shot-contract.md`.

*Done when: every image a changed page embeds was written by the harness in this change, or is unchanged on
screen, and you have looked at each.*

## Step 4: Check and record

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/docs_check.py" --changed HEAD
```

Fix every warning on a file you touched. Derived copies (a handbook generated from the docs, a reference page
generated from `--help`, a wiki mirror built by CI) are regenerated now by their script, not by hand.

Then write the `Docs:` line into the commit message or the pull request body:

```
Docs: guide/exporting.md rewritten for the new Format menu; 3 shots retaken (w2-export).
Docs: none, an internal refactor with no visible change.
```

`Docs: none, ...` is what the checker reads to stand down on a range, so say why.

## Done when

The checker exits 0 on `--changed`, or every remaining finding is accepted with a why; every changed page was
grounded against the built product; every affected shot was retaken and looked at; and the `Docs:` line is in
the commit or the pull request.
