# Motion Design — Choosing How an Idea Should Move

Structured guidance for *selecting and implementing* animation. It synthesizes three designer perspectives into actionable rules. The examples lean on slide-based storytelling because it's concrete, but the principles — restraint, purpose, polished entrances, accessible motion — apply to any animated surface: a landing page, an explainer, a UI demo, a data visualization, an app onboarding.

## The Three Perspectives

| Designer | Philosophy | Best For |
|----------|-----------|----------|
| **Emil Kowalski** | Restraint & speed | Navigation chrome, high-frequency interactions, buttons |
| **Jakub Krehel** | Production polish | Entrances/exits, content reveals, professional finish |
| **Jhey Tompkins** | Experimentation & delight | Key reveal moments, creative flourishes, scroll-driven effects |

## Context Weighting

A sensible default weighting for most explanatory/persuasive work:

- **Primary: Jakub** — Every element needs a polished enter/exit. The enter recipe (opacity + translateY + blur) is the backbone.
- **Secondary: Jhey** — Key narrative moments (the "aha," the big reveal, the conclusion) get creative treatment: scroll-driven effects, `@property` animations, stagger patterns.
- **Selective: Emil** — Functional chrome (progress bars, counters, nav feedback) should be fast and invisible. Under 300ms, no bounce.

## Quick Decision Framework

Read "slide" as "the moment/section you're animating":

| Moment Type | Animation Strategy | Duration | Easing |
|------------|-------------------|----------|--------|
| Title/Opening | Dramatic entrance, stagger text | 600-800ms | Spring (bounce: 0.05) |
| Content/Explanation | Standard Jakub recipe | 400-500ms | Spring (bounce: 0) |
| Data/Evidence | Counter animations, chart reveals | 500-700ms | ease-out |
| Comparison | Crossfade or layout animation | 450ms | Spring (bounce: 0) |
| Big Reveal | Full creative treatment (Jhey) | 700-1000ms | Custom bezier or spring |
| Code/Demo | Typewriter + syntax highlight | Varies | linear for typing |
| Closing/CTA | Scale + opacity, confident | 500ms | Spring (bounce: 0.1) |
| Functional chrome | Instant-feeling | 150-300ms | ease-out or linear |

## Golden Rules

1. **Purpose Test** — Every animation must serve orientation, feedback, or continuity. If removing it wouldn't confuse the viewer, question whether it's needed.
2. **10th Interaction Test** — Does it still feel natural the 10th time someone sees it? If it gets tiresome, it's too much.
3. **Subtler Exits** — Exit animations should be subtler than entrances. The viewer's attention is moving forward, not backward.
4. **Accessibility is mandatory** — `prefers-reduced-motion` support via `MotionConfig reducedMotion="user"` (or the CSS media query). No exceptions.
5. **The best animation goes unnoticed** — Unless the purpose IS delight (a creative reveal, a celebration), animation should feel like natural physics, not a show.

## The Enter Animation Recipe (Foundation)

Every content element entering view uses the enter recipe — opacity + a small
y offset + blur, on a bounce-0 spring. The canonical values (and the y-offset
sizing table) live in [jakub-krehel.md](jakub-krehel.md); read them there
rather than working from memory.

For several blocks entering together (bullets, cards, stats), the same recipe
runs through a `staggerChildren` parent — the variants-based orchestration
pattern is in `../motion-api/animation-patterns.md`. Stagger delay: 60-100ms
between items; more than 5 items, reduce to 40-60ms to avoid feeling slow.

## Reference Files (this folder)

- [golden-rules.md](golden-rules.md) — Core principles, purpose test, when NOT to animate
- [emil-kowalski.md](emil-kowalski.md) — Restraint philosophy, speed rules, clip-path
- [jakub-krehel.md](jakub-krehel.md) — Polish recipes, enter/exit, shadow, optical alignment
- [jhey-tompkins.md](jhey-tompkins.md) — Experimentation, @property, scroll-driven, 3D CSS (longest; read when building a showcase moment)
- [accessibility.md](accessibility.md) — prefers-reduced-motion, vestibular safety
- [technical-principles.md](technical-principles.md) — Easing, springs, GPU, timing
