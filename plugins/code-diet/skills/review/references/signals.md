# Per-signal judgment tests

`scripts/review.py` locates candidates by kind; you decide cut or keep. Consult
the row for a candidate's `kind` only when that kind fires. Each row gives the
keep test (when the signal is a false positive) and the cut it earns otherwise.
The tag names below are the ones SKILL.md reports with.

## single-caller-wrapper

A function with exactly one call site. The wrapper earns its keep when it is:

- a **trust boundary** or seam the one caller crosses (a public API surface,
  an adapter isolating a third-party type, an injection point tests stub);
- a **named concept** that makes the caller readable even inlined once
  (`is_business_day(d)` reads better than its guts at the call site);
- **about to get a second caller** in the same change (the diff adds the first).

Otherwise: `yagni:` inline it into its one caller. A wrapper that only forwards
arguments is pure indirection; the call site loses nothing when it disappears.

## single-impl-abstraction

An abstract class / interface / protocol with zero or one implementation. Keep
it when a **second implementation exists in the codebase but the scanner missed
it** (dynamic registration, a plugin loaded by name, an impl in a skipped dir),
or when it is a **published extension point** other packages subclass. Verify
by grepping for subclasses before cutting.

Otherwise: `yagni:` collapse the hierarchy to the one concrete class. One
implementation behind an interface is a prediction nobody paid for yet; the
interface returns for free the day the second impl lands.

## dep-duplicates-stdlib

A dependency whose job the standard library or platform already does. Keep the
dep when it covers **edge cases the task actually hits**: `requests` for
sessions/retries/streaming a real integration needs, `dateutil` for the fuzzy
parsing stdlib refuses. The test is whether *this* code uses the surface that
justifies the dep, not whether the dep is broadly nicer.

Otherwise: `native:` (platform feature) or `stdlib:` (library function), naming
the replacement from the candidate's `detail`. A dependency pulled in for one
call the platform already ships is supply-chain surface and install weight for
nothing.

## dead-flag

A boolean parameter or config whose non-default value no call site ever passes.
Keep it when it is an **externally documented interface**: a public function's
kwarg, a CLI flag, a config key downstream users set out of your sight. Grep
docs and callers outside the repo boundary before cutting.

Otherwise: `delete:` drop the flag and the dead branch, hardcode the value that
actually runs. A switch with one position is a fork in the code that only ever
goes one way.

## uncalled-symbol

A function or method with no call site found. Keep it when it is reachable in a
way the scanner cannot see: an **entry point** (CLI subcommand, route handler,
event callback), a **framework hook** called by name, an **abstract method**
whose callers go through the base, or a symbol **exported for external use**.

Otherwise: `delete:` remove it. Dead code is the cheapest cut there is, and the
line it lived on is one nobody reads again.

---

## Calibration: the finding, verbose vs. right

Inherited from ponytail-review. The wrong shape hedges and asks; the right
shape locates, cuts, and replaces in one line.

Wrong: "This EmailValidator class might be more complex than necessary, have
you considered whether all these validation rules are needed at this stage?"

Right:

- `L12-38: stdlib: 27-line validator class. "@" in email, 1 line; real validation is the confirmation mail.`
- `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`
- `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`
- `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`
- `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

The `shrink:` tag has no scanner signal of its own: it is your call when the
same logic fits in fewer lines. Apply it to any candidate above whose cut is
"same behavior, less code" rather than outright removal.
