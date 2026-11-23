# Report format

Two deliverables, always produced together in the output directory, plus a
chat summary. Everything here is filled from `scan.json` and `score.json`:
no number in any report is computed by hand.

## 1. `scorecard.html`: fill the template, don't rebuild it

Copy `../assets/scorecard-template.html` and fill it. The layout, styling,
and structure are proven; your job is substitution, not generation.

The fill contract (this section is its single source; the template only
points here):

- `{{TOKEN}}` slots take a single value.
- `<template id="tpl-*" data-fill-into="…">` blocks are repeatables: take the
  block's inner HTML once per item, fill its tokens, and place the
  concatenation inside the element whose `id` matches `data-fill-into`.
  Delete the `<template>` tags and the fill-contract header comment
  from the final file.
- `data-optional="…"` elements are deleted whole when not applicable (no
  gate cap, no findings, no refuted list, no fixes, no measured block).
- Color maps live in comments beside each template block (the gauge,
  verdict tiers, the dimension bar, kind tags, severity badges, cap meters,
  segment rotation). Each names a class or a token the template's stylesheet
  defines. Follow them exactly, and never write a color of your own: no
  green for good, no red for bad.
- `{{COMPOSITE_DASH}}` = score.json's `composite_dash`, verbatim. The
  script pre-computes it; never do the arithmetic yourself.
- `{{RUBRIC}}` = score.json's `rubric`, verbatim. Two scorecards are compared
  only when they carry the same one: a rubric number changes when a check is
  added or an anchor moves.
- `{{SHAPE}}` = scan.json's `components.shape`, then its counts: `plain, 5
  skills`, or `areas, 14 skills over 75 routes`.
- `{{LISTING_ENTRIES}}`, `{{LISTING_DESCRIBED_CHARS}}`,
  `{{LISTING_NAMES_CHARS}}` = scan.json's `context_footprint.listing`:
  `entries`, `described_chars`, `names_only_chars`. Two rows, because a
  plugin is listed two ways: with every description at a large window, by
  name alone at 200k.
- The measured block is filled only when score.json carries `measured`
  (`--score` was run with `--measured <diagnose.json>`; see
  [measuring.md](measuring.md)). `{{MEASURED_COUNTS}}` = its `counts` as
  `2 critical · 3 warnings · 1 note`; `{{MEASURED_SESSION}}` = its
  `session` as `<title or id> · Claude Code <version> · <requests> requests
  · peak <peak_tokens> tokens · <compactions> compactions`; one
  `tpl-measured-item` per entry of its `findings`, in order, the owner
  left empty where it is null. Never fill it from anything else: a session
  you remember is not a measurement.
- Pips: four per check row, `round(grade)` filled.
- The Mermaid component map is the one generated part: one node per
  component, edges skill→script/reference/asset it invokes and hook→skill it
  enforces (from your CS1/CS2 evidence), `orphan` class on anything in
  scan.json's `orphans`.
- Escape `<`, `>`, `&` in quotes/evidence before inserting into HTML.

Top-fixes points come from score.json's `fix_deltas`, verbatim: the script
computes each improvable check's composite gain (sorted, with the verdict it
would reach). Never estimate a delta yourself.

Write the result to `<outdir>/scorecard.html` and open it
(`xdg-open`/`open`, ignore failure in headless environments).

## 2. `report.md`: the linear, diffable form

Same content as the scorecard, plain markdown, this shape:

```markdown
# Plugin evaluation: <name> v<version>

**<COMPOSITE>/100 · <VERDICT>** · rubric <N> · <shape and counts> · evaluated <date> · <source line>
<if capped: > ⚠ Verdict capped by gate: <reason> (uncapped: <tier>)

## Dimensions

| Dim | Score | Weight (norm) | Notes |
|---|---|---|---|
| Skill quality | 79.8 | 30 (33.3) | one-line takeaway |
| Workflow quality | n/a | N/A | no bundled workflows |
…

## Checks

### SQ: Skill quality (79.8)
| Check | Kind | Grade | Evidence |
|---|---|---|---|
| SQ1 Description quality | judgment | 3.5 | skills/foo: "…quote…" |
…one table per applicable dimension, every check listed, N/A checks marked.

## Context footprint

~<N> est. always-on tokens/turn (chars÷4; `claude plugin details <name>` is
ground truth). Per source: <list>. Cap violations: <list or none>.
The listing (scan.json's `context_footprint.listing`): <N> entries, ~<chars>
characters where every description shows, <chars> where only names do.
On-invoke: <skill: N lines / ~M tokens, flag >500 lines, and an area body
over 8,000 characters>.
<if critical lines: >Critical lines: <chars> of 7,500 across <files>.

<if score.json has `measured`: >## Measured in one session

<session line> · <counts>. It moves no grade and no verdict.

- **<CODE>** (<level>, <owner>): <what> → <fix>

## Findings

### critical / major / minor (grouped, in that order)
- **<title>** (<check>, <file>): <quote> → <recommendation>

<if workflow run: >## Refuted by verification
- <title>: <verifier reasoning>

## Top fixes

1. <fix>: **+<N> pts**<if tier crossed: > → reaches <tier>
```

Omit empty sections. Severity order is always critical → major → minor.

## 3. Chat summary

Five to ten lines, no headers:

- Line 1: `<name> v<version>: <COMPOSITE>/100, <VERDICT>` (+ gate note if
  capped).
- One line per applicable dimension: score + the single most load-bearing
  observation, in plain words.
- Top 3 fixes with their point deltas.
- If score.json has `measured`: one line, the counts and the most serious
  finding. If it does not: one line that reach and hook output were not
  measured, since the score reads files.
- The absolute paths of both report files.
