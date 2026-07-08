<!-- Canonical copy shared across skills. Referenced by spec-3-architect, build-improve-architecture, and build-tdd — keep phase-neutral. -->
# Interface design

When the user wants to explore alternative interfaces for a chosen deepening
candidate, use this parallel sub-agent pattern. Based on "Design It Twice"
(Ousterhout) — your first idea is rarely the best. Uses the vocabulary in
[LANGUAGE.md](LANGUAGE.md): **module**, **interface**, **seam**, **adapter**,
**leverage**. At the spec stage the winning design lands in the spec as the
contract a future implementation will honour; on built code it becomes the
target the refactor drives toward.

## Process

### 1. Frame the problem space

Before spawning sub-agents, write a short user-facing explanation of the problem
space for the chosen candidate:

- The constraints any new interface must satisfy.
- The dependencies it relies on, and their category (see [DEEPENING.md](DEEPENING.md)).
- A rough illustrative sketch (pseudocode, code, or a diagram) to ground the constraints — not a proposal, just a way to make them concrete.

Show this to the user, then proceed to step 2 — they read and think while the
sub-agents work.

### 2. Spawn sub-agents

Spawn 3+ sub-agents in parallel (the Agent tool). Each must produce a **radically
different** interface for the deepened module.

Prompt each with a separate technical brief — the relevant files (spec or
source), coupling details, dependency category from
[DEEPENING.md](DEEPENING.md), and what sits behind the seam. The brief is
independent of the user-facing explanation in step 1. Give each agent a distinct
constraint:

- Agent 1: "Minimise the interface — 1–3 entry points. Maximise leverage per entry point."
- Agent 2: "Maximise flexibility — support many use cases and extension."
- Agent 3: "Optimise for the most common caller — make the default case trivial."
- Agent 4 (if relevant): "Design around ports & adapters for cross-seam dependencies."

Each brief includes the [LANGUAGE.md](LANGUAGE.md) vocabulary and the project's
own glossary terms (the spec glossary, or CONTEXT.md on built code) so designs
name things consistently. Each sub-agent outputs:

1. The interface (shape of inputs/outputs, plus invariants, ordering, error modes).
2. A usage example showing how callers use it.
3. What the implementation hides behind the seam.
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md)).
5. Trade-offs — where leverage is high, where it's thin.

At the spec stage, follow the recorded language posture
(`reference/adr/0001-language-posture.md`). By default (agnostic, or
language-tied-minimal) express the interface as a contract — shapes and
invariants, not a signature in one language. Under a code-forward posture, a
concrete signature or type in the chosen language is welcome alongside the
contract. On built code, always use the codebase's own language and idioms.

### 3. Present, compare, recommend

Present the designs sequentially so the user absorbs each, then compare in prose:
contrast by **depth** (leverage at the interface), **locality** (where change
concentrates), and **seam placement**. Give your own opinionated recommendation —
which is strongest and why, or a hybrid if elements combine well. The user wants
a strong read, not a menu.

### 4. Fold the winner in

At the spec stage, write the winning design into the relevant spec file as the
module's interface contract, add any new terms to the glossary, offer an ADR if
the choice was load-bearing, and run
`python .plan/spec/scripts/verify-spec-tree.py` after editing. On built code, the
winner becomes the refactor's target interface.
