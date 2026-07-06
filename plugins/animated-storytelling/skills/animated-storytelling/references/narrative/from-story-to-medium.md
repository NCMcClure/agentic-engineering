# From Storyform to Medium — Practical Rules

Concrete rules for turning an NCP storyform into the actual units of your medium. The worked example is a **slide deck** (the most demanding case — every unit is tightly bounded and ordered), and the component names below are illustrative of a typical presentation toolkit. If you're working in another medium, map the ideas across:

- **slide** → section of an essay, scene in a script, step in an onboarding flow, panel in a web page
- **eyebrow / SlideChrome** → section heading, scene slug, progress indicator
- **template components** (SplitPane, StatCard, etc.) → whatever building blocks your medium offers (figures, callouts, code blocks, charts, pull quotes)

The *structure* — how many units per act, when transitions intensify, which narrative function calls for which treatment, and the complexity tiers — is medium-agnostic.

## Units Per Signpost

Each signpost represents a major section. Allocate units based on importance:

| Signpost Position | Typical Unit Count | Reasoning |
|-------------------|-------------------:|-----------|
| Signpost 1 (setup) | 2-3 | Establish quickly, don't linger |
| Signpost 2 (development) | 3-5 | Main body, most content lives here |
| Signpost 3 (pivot/reveal) | 2-4 | Key turning point, needs space |
| Signpost 4 (resolution) | 2-3 | Conclude decisively, don't drag |

**Total:** 10-15 units for a standard-length piece. Adjust up for longer formats.

## Deriving Eyebrow Text

The eyebrow (small text above the slide title in SlideChrome) communicates position and throughline:

**Format:** `{slide_number} · {throughline_label}`

Map throughlines to short labels:
- Objective Story → Use the topic domain (e.g., "knowledge", "platform", "architecture")
- Main Character → Use "your journey", "the shift", or something audience-centric

**Examples:**
```
01 · knowledge           (OS — setting up the problem)
02 · your journey        (MC — where the audience is)
03 · knowledge           (OS — deepening the problem)
04 · the shift           (MC — challenging assumptions)
05 · mechanism           (OS — revealing the solution)
```

## Transition Selection Based on Beat Relationships

### Between Same-Throughline Beats
Standard cross-fade or directional slide. Content flows naturally.

### Between Different-Throughline Beats (perspective shift)
Use a more pronounced transition to signal the shift:
- Slightly longer duration (500ms vs 400ms)
- Add a subtle scale change (0.98 → 1)
- Or use a direction change (previous slides came from bottom, new throughline comes from right)

### At Signpost Boundaries (act breaks)
Most dramatic transitions:
- Full opacity to 0 and back
- Optional color shift in background
- Longer stagger delays on incoming content
- Consider a "breathing room" slide (minimal content, big title)

## Component Selection by Narrative Function

The storybeat's `narrative_function` determines which template components to use:

### Understanding → Explanatory
- `SplitPane` with text + diagram
- `CodeBlock` with annotations
- `ComparisonTable` for contrasts

### Doing → Active/Demonstrative
- `CodeBlock` with highlighted lines
- Full-bleed screenshot/video
- `Timeline` showing process steps

### Obtaining → Evidence
- `StatCard` grid (2-4 stats with animated counters)
- `Quote` with attribution
- `ComparisonTable` for before/after metrics

### Learning → Progressive
- `BulletList` with staggered reveal
- `Timeline` with sequential highlights
- Numbered steps with `StaggerChildren`

### Conceptualizing → Abstract
- `FullBleed` with metaphor image + overlay text
- `CenteredContent` with single powerful statement
- `ConceptTile` grid for related ideas

### Becoming → Transformative
- `SplitPane` for before/after
- `Timeline` showing evolution
- Animated transition between two states

### Being → Emotional
- `CenteredContent` with large type, minimal words
- `FullBleed` image with mood
- Single `Quote` dominating the slide

### Conceiving → Actionable
- `BulletList` with concrete next steps
- `StatCard` for metrics to track
- `Timeline` for implementation roadmap

## Palette-to-Throughline Mapping

Use color to subtly reinforce throughline shifts:

- **Objective Story slides** — Primary palette (neutral background, accent on key elements)
- **Main Character slides** — Slightly warmer/different background tint
- **Signpost boundaries** — Can introduce the accent color more prominently

This is subtle — a 2-5% shift in background opacity or a different gradient direction. Don't make it jarring.

## Creative Complexity Classification

Not every slide needs bespoke animation. Classify slides into tiers during planning:

### Standard Tier (60-70% of slides)
- Uses template components (BulletList, SplitPane, StatCard, etc.)
- Jakub entrance recipe for all content (opacity + y + blur, spring, 0.45s)
- Stagger sequences for multiple items (60-100ms between)
- Appropriate for: context-setting, bullet points, simple comparisons, quotes, section transitions

### Enhanced Tier (20-30% of slides)
- Uses template components as a base but adds custom behavior
- Examples: AnimatedCounter with custom formatting, CodeBlock with highlighted line transitions, Timeline with animated progress indicators, SplitPane where one side has a scroll-driven reveal
- Appropriate for: evidence slides, process explanations, before/after comparisons, data displays

### Showcase Tier (2-3 slides per presentation)
- Fully bespoke — custom-designed visual experience
- Each is essentially a miniature interactive application
- Examples from production:
  - Multi-column state machine with independent animation loops per column
  - Streaming feed with live item spawning (prepend/trim + AnimatePresence)
  - Interactive UI mock with scrollable panels and clickable thread expansion
  - SVG topology diagram with path-drawing and traveling elements
  - Convergence animation where documents flow into a processing pipeline
- Appropriate for: the key insight, the "aha" moment, the primary evidence, the emotional closer
- See `../creative-recipes/` for implementation patterns

### Tier Assignment Rules

1. The narrative **pivot** slide (where Understanding shifts to Conceiving) is almost always showcase — this is where the audience's mental model changes
2. The **primary evidence** slide (showing the thing works) benefits strongly from showcase treatment — seeing is believing
3. Title and closing CAN be showcase but don't have to be — a simple confident entrance often works better
4. **Never more than 3** showcase slides — each takes significant creative investment and too many overwhelms the audience with novelty
5. If in doubt between enhanced and showcase, start enhanced — you can always upgrade during revision

## Validation Checklist

Before finalizing the plan, verify:

- [ ] Every storybeat has a clear `storytelling` field (= content direction)
- [ ] Signposts alternate between throughlines (no 4+ consecutive same-throughline)
- [ ] At least one "evidence" beat (Obtaining) appears before the conclusion
- [ ] The final 1-2 beats match the dynamic vectors (success→optimistic, change→actionable)
- [ ] Slide count matches user's requested target (±2 is acceptable)
- [ ] Each beat has a suggested component (even if just "CenteredContent")
- [ ] The narrative function variety is reasonable (not all Understanding)
