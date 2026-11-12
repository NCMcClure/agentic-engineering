# Provenance

Where this discipline comes from and what code-diet changed. Borrowed stays
labeled as borrowed.

## Origin

The core discipline is evolved from **ponytail** (MIT, Copyright (c) 2026
DietrichGebert), https://github.com/DietrichGebert/ponytail. Inherited from
ponytail's `skills/ponytail/SKILL.md` and `skills/ponytail-review/SKILL.md`:

- the 7-rung ladder (YAGNI, reuse-in-codebase, stdlib, native platform,
  installed dep, one line, minimum that works);
- the safety carve-outs (never cut trust-boundary validation, data-loss error
  handling, security, accessibility);
- root-cause-not-symptom bug fixing (enumerate every caller, one guard where
  they route through);
- the one-runnable-check rule (the smallest check behind non-trivial logic, no
  new framework);
- output discipline (code first, at most 3 lines of notes);
- the review tag vocabulary (`delete:` / `stdlib:` / `native:` / `yagni:` /
  `shrink:`) and the verbose-against-right calibration, carried by code-diet's
  `review-diet` skill.

## What code-diet changed

- **Debt marker renamed and re-homed.** Ponytail's `ponytail:` comment became
  `debt: <ceiling>, <upgrade trigger>`, and the grammar moved out of prose into
  a single checker, `scripts/debt.mjs`. The ladder points at that script
  instead of restating the convention.
- **Intensity modes removed.** Ponytail's lite/full/ultra levels, the
  `/ponytail lite|full|ultra` switch, and the "stop ponytail / normal mode"
  language are gone. Code-diet ships one discipline.
- **Persona and boundaries trimmed.** The "lazy senior developer" framing and
  the persistence/boundaries sections collapse to a single sentence of intent;
  the discipline is the ladder, not a character.
- **The always-on form is one priced line.** The ladder a session carries is a
  single line in `hooks/critical.json`, held under a character cap and printed
  only where the repo has opted in to the plugins.
- **Rung 2 reaches past the repo.** `reuse-first` searches this repo and the
  other checkouts the person lists; `capture-reusable` asks the same question
  the other way round.
