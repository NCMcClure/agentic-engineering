<!-- Canonical copy shared across skills. Referenced by plan-3-architect-spec, build-improve-architecture, and build-tdd — keep phase-neutral. -->
# Language

Shared vocabulary for every suggestion this skill makes. Use these terms exactly
— don't substitute "component," "service," "API," or "boundary." Consistent
language is the whole point.

Everything here applies to designs and to code alike. On built code a **module**
is a function, class, or package; at the spec stage it's a *designed* unit — a
subsystem, a step in a pipeline, a participant in a flow, an entity with
behaviour. Either way it has an interface and an implementation: the interface is
what the rest of the system must know to use it; the implementation is what sits
behind it — the code, or the behaviour the spec describes.

## Terms

**Module**
Anything with an interface and an implementation. Scale-agnostic — a function,
a class, a package, a designed subsystem, or a tier-spanning slice.
_Avoid_: unit, component, service.

**Interface**
Everything a caller must know to use the module correctly: the type/shape of what
goes in and out, plus invariants, ordering constraints, error modes, required
configuration, and performance characteristics.
_Avoid_: API, signature (too narrow — those are just the type-level surface).

**Implementation**
What sits behind the interface — the body of code, or the behaviour the spec
prose and diagrams describe. Distinct from **adapter**: a module can be a small
adapter over a large implementation (a Postgres repo) or a large adapter over a
small one (an in-memory fake). Reach for "adapter" when the seam is the topic;
"implementation" otherwise.

**Depth**
Leverage at the interface — how much behaviour a caller (or test) can exercise
per unit of interface they must learn. **Deep** = much behaviour behind a small
interface. **Shallow** = the interface is nearly as complex as what it hides.
(This is Ousterhout's deep-modules doctrine from *A Philosophy of Software
Design*.)

**Seam** _(Michael Feathers)_
A place where behaviour can be altered without editing in that place — the
*location* at which a module's interface lives. Where to put the seam is its own
design decision, separate from what goes behind it.
_Avoid_: boundary (overloaded with DDD's bounded context).

**Adapter**
A concrete thing satisfying an interface at a seam. Names a *role* (what slot it
fills), not a substance.

**Leverage**
What callers get from depth: more capability per unit of interface learned. One
deep module pays back across N call sites and M tests.

**Locality**
What maintainers get from depth: change, bugs, knowledge, and verification
concentrate in one place instead of spreading across callers. Fix once, fixed
everywhere — and at the spec stage, decide once, decided everywhere.

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small, swappable parts — they just aren't part of its interface. It can have **internal seams** (private, for its own tests) as well as the **external seam** at its interface.
- **To deepen, ask three questions of the interface.** Can the entry points be fewer? Can the parameters be simpler? Can more complexity move behind the interface?
- **The deletion test.** Imagine deleting the module. If the complexity vanishes, it was a pass-through. If it reappears across N callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you'd need to test *past* the interface, the module is the wrong shape.
- **One adapter = a hypothetical seam. Two adapters = a real one.** Don't introduce a seam unless something actually varies across it (typically production + test).

## Relationships

- A **module** has exactly one **interface**.
- **Depth** is measured against that interface.
- A **seam** is where the interface lives; an **adapter** sits at the seam and satisfies it.
- **Depth** produces **leverage** for callers and **locality** for maintainers.

## Rejected framings

- **Depth as a lines-of-implementation-to-lines-of-interface ratio** — rewards padding. Use depth-as-leverage.
- **"Interface" as just a type signature, a language's `interface` keyword, or a list of public methods** — too narrow; interface here is every fact a caller must know.
- **"Boundary"** — overloaded with DDD. Say **seam** or **interface**.
