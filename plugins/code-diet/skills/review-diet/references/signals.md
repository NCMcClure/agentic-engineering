# Per-signal judgment tests

`review-scan.mjs` locates candidates by kind; you decide cut or keep. Read only the row for the kind that fired. Each row gives the keep test (when the signal is a false positive) and the cut it earns otherwise.

## single-caller-wrapper

A function with exactly one call site. It earns its keep when it is:

- a **trust boundary or seam** the caller crosses (a public API surface, an adapter isolating a third-party type, an injection point a test stubs);
- a **named concept** that makes the caller readable even inlined once (`isBusinessDay(d)` reads better than its guts at the call site);
- **about to get a second caller** in the same change.

Otherwise `yagni:` inline it. A wrapper that only forwards arguments is pure indirection; the call site loses nothing when it disappears.

## single-impl-abstraction

An abstract class, interface, or protocol with zero or one implementation. Keep it when a **second implementation exists but the scanner missed it** (dynamic registration, a plugin loaded by name, an implementation in a skipped directory), or when it is a **published extension point** other packages subclass. Grep for subclasses before cutting. In JavaScript and TypeScript the scanner flags any class that `extends` another as the abstract one, so check which of the two is really the abstraction first.

Otherwise `yagni:` collapse it to the one concrete class. One implementation behind an interface is a prediction nobody has paid for; the interface comes back free the day the second implementation lands.

## dep-duplicates-stdlib

A dependency whose job the standard library or the platform already does. Keep it when it covers **edge cases this code actually hits**: a HTTP client for sessions, retries, and streaming a real integration needs; a date library for parsing the standard library refuses. The test is whether *this* code uses the surface that justifies the dependency, not whether the dependency is broadly nicer.

Otherwise `native:` or `stdlib:`, naming the replacement from the candidate's `detail`. A dependency pulled in for one call the platform already ships is supply-chain surface and install weight for nothing.

## dead-flag

A boolean parameter or config value whose non-default no call site ever passes. Keep it when it is an **externally documented interface**: a public function's option, a CLI flag, a config key a consumer sets out of your sight. Check the docs and callers outside this repo before cutting.

Otherwise `delete:` drop the flag and the dead branch and hardcode the value that actually runs. A switch with one position is a fork that only ever goes one way.

## uncalled-symbol

A function or method with no call site found. Keep it when it is reachable in a way the scanner cannot see: an **entry point** (a CLI subcommand, a route handler, an event callback), a **framework hook** called by name, an **abstract method** whose callers go through the base, or a symbol **exported for another package**. In JavaScript, also check for a call through an object literal or a re-export.

Otherwise `delete:` remove it. Dead code is the cheapest cut there is.

## Calibration: the finding, verbose against right

The wrong shape hedges and asks. The right shape locates, cuts, and replaces in one line.

Wrong: "This EmailValidator class might be more complex than necessary, have you considered whether all these validation rules are needed at this stage?"

Right:

- `mail.mjs:L12: stdlib: 27-line validator class. An "@" check is one line; the real validation is the confirmation mail.`
- `app.mjs:L4: native: a date library imported for one format call. Intl.DateTimeFormat, zero dependencies.`
- `repo.mjs:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.`
- `queue.mjs:L52: delete: a retry wrapper around an idempotent local call. Nothing replaces it.`
- `parse.mjs:L30: shrink: a manual loop builds the map. Object.fromEntries(pairs), one line.`

`shrink:` has no scanner signal of its own. It is your call when the same logic fits in fewer lines, and it applies to any candidate whose cut is "same behavior, less code" rather than removal.
