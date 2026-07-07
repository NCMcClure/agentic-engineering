# Report format

Two deliverables, always produced together in the output directory, plus a
chat summary. Everything here is filled from `scan.json` and `score.json` —
no number in any report is computed by hand.

## 1. `scorecard.html` — fill the template, don't rebuild it

Copy `../assets/scorecard-template.html` and fill it. The layout, styling,
and structure are proven; your job is substitution, not generation.

The fill contract (this section is its single source — the template only
points here):

- `{{TOKEN}}` slots take a single value.
- `<template id="tpl-*" data-fill-into="…">` blocks are repeatables: take the
  block's inner HTML once per item, fill its tokens, and place the
  concatenation inside the element whose `id` matches `data-fill-into`.
  Delete the `<template>` tags — and the fill-contract header comment —
  from the final file.
- `data-optional="…"` elements are deleted whole when not applicable (no
  gate cap, no findings, no refuted list, no fixes).
- Color maps live in comments beside each template block (verdict tiers,
  severity badges, cap meters, segment rotation). Follow them exactly.
- `{{COMPOSITE_DASH}}` = score.json's `composite_dash`, verbatim — the
  script pre-computes it; never do the arithmetic yourself.
- Pips: four per check row, `round(grade)` filled.
- The Mermaid component map is the one generated part: one node per
  component, edges skill→script/reference/asset it invokes and hook→skill it
  enforces (from your CS1/CS2 evidence), `orphan` class on anything in
  scan.json's `orphans`.
- Escape `<`, `>`, `&` in quotes/evidence before inserting into HTML.

Top-fixes points come from score.json's `fix_deltas`, verbatim — the script
computes each improvable check's composite gain (sorted, with the verdict it
would reach). Never estimate a delta yourself.

Write the result to `<outdir>/scorecard.html` and open it
(`xdg-open`/`open`, ignore failure in headless environments).

## 2. `report.md` — the linear, diffable form

Same content as the scorecard, plain markdown, this shape:

```markdown
# Plugin evaluation — <name> v<version>

**<COMPOSITE>/100 — <VERDICT>** · evaluated <date> · <source line>
<if capped: > ⚠ Verdict capped by gate: <reason> (uncapped: <tier>)

## Dimensions

| Dim | Score | Weight (norm) | Notes |
|---|---|---|---|
| Skill quality | 79.8 | 30 (33.3) | one-line takeaway |
| Workflow quality | — | N/A | no bundled workflows |
…

## Checks

### SQ — Skill quality (79.8)
| Check | Kind | Grade | Evidence |
|---|---|---|---|
| SQ1 Description quality | judgment | 3.5 | skills/foo: "…quote…" |
…one table per applicable dimension, every check listed, N/A checks marked.

## Context footprint

~<N> est. always-on tokens/turn (chars÷4; `claude plugin details <name>` is
ground truth). Per source: <list>. Cap violations: <list or none>.
On-invoke: <skill: N lines / ~M tokens, flag >500 lines>.

## Findings

### critical / major / minor (grouped, in that order)
- **<title>** (<check>, <file>): <quote> → <recommendation>

<if workflow run: >## Refuted by verification
- <title> — <verifier reasoning>

## Top fixes

1. <fix> — **+<N> pts**<if tier crossed: > → reaches <tier>
```

Omit empty sections. Severity order is always critical → major → minor.

## 3. Chat summary

Five to ten lines, no headers:

- Line 1: `<name> v<version>: <COMPOSITE>/100 — <VERDICT>` (+ gate note if
  capped).
- One line per applicable dimension: score + the single most load-bearing
  observation, in plain words.
- Top 3 fixes with their point deltas.
- The absolute paths of both report files.
