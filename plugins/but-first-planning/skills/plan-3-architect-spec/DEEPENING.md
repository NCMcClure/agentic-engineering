<!-- Canonical copy shared across skills. Referenced by plan-3-architect-spec, build-improve-architecture, and build-tdd — keep phase-neutral. -->
# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies.
Assumes the vocabulary in [LANGUAGE.md](LANGUAGE.md) — **module**, **interface**,
**seam**, **adapter**. On built code you're moving real seams; at the spec stage
you're deciding where the seams *will* be, so the eventual implementation has the
right shape from day one.

## Classify the dependencies

When assessing a candidate, classify what the deepened module depends on. The
category determines where the seam belongs and how the module is tested across
it.

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — merge the modules
and test through the new interface directly. No adapter needed (at the spec
stage, note that in the design).

### 2. Local-substitutable

Dependencies with local stand-ins (PGLite for Postgres, an in-memory or temp
filesystem). Deepenable when the stand-in exists. The seam stays internal: tests
run against the stand-in; no port is exposed at the module's external interface.

### 3. Owned-remote (ports & adapters)

Your own services across a network boundary (microservices, internal APIs).
Define a **port** (interface) at the seam; the deep module owns the logic, and
the transport is an injected **adapter** — HTTP/gRPC/queue in production, an
in-memory one in tests. Recommendation shape: *"a port at the seam, with a
production adapter and a test adapter, so the logic stays in one deep module even
though it's deployed across a network."*

### 4. True-external (mock)

Third-party services you don't control (Stripe, Twilio). The module takes the
dependency as an injected port; tests provide a mock adapter. Record the external
contract you're assuming — and consider an ADR if the choice is load-bearing.

## Seam discipline

- **One adapter = a hypothetical seam. Two = a real one.** Don't introduce a port unless at least two adapters justify it (typically production + test). A single-adapter seam is just indirection — and indirection in a spec is even cheaper to remove than in code, so remove it.
- **Internal vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't promote an internal seam to the interface just because tests would use it.

## Testing across the seam

The **interface is the test surface**. Tests assert observable outcomes through
the interface, not internal state, and should survive internal refactors — they
describe behaviour, not implementation. If a test has to change when the
implementation changes, it's testing past the interface.

On built code, replace — don't layer: old unit tests on the shallow modules
become waste once tests exist at the deepened interface, so delete them.

At the spec stage there's no suite yet, so the design's job is to make the
*future* tests obvious. For each deepened module, the spec should be able to
state:

- The interface the tests will sit on (the test surface).
- Which dependencies are substituted, and by what kind of adapter.
- The observable outcomes the tests will assert.

If you can't write those three sentences about a designed module, its shape isn't
settled yet — keep grilling. A design that can articulate its own test surface is
the strongest signal that the architecture is right before any code is written.
