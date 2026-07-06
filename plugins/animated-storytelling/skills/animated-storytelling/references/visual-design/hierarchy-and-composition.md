# Hierarchy & Composition — One Thing at a Time

## The Squint Test

Squint at the view until detail dissolves — or blur a screenshot by 8px. What survives is your actual hierarchy, regardless of what you intended. **Exactly one element should dominate.** If two survive at equal strength, they're fighting; if nothing survives, the view is a gray fog and the audience will bounce. Run this test on every view, every time. It takes five seconds and it catches the failure mode behind most "something feels off" complaints: everything is emphasized, so nothing is.

Hierarchy is a ranking, and a ranking needs losers. For one element to matter most, the others must visibly matter less. The discomfort of demoting content you worked hard on is the actual work of composition.

## The Hierarchy Toolkit, Ranked by Strength

Six cues create hierarchy. Use them in this order — reach for the weaker ones first and save the loud ones:

| Rank | Cue | How to use it | Numbers |
|------|-----|---------------|---------|
| 1 | **Size / scale** | Obvious jumps between levels, never timid ones | 1.5–2x between hero and body; a 1.1x difference reads as a mistake, not a rank |
| 2 | **Weight** | Bold for the claim, regular for the support | Skip at least 200 weight units (400 → 600); adjacent weights (400/500) are invisible at small sizes |
| 3 | **Color / contrast** | High contrast for the focal point, muted for support | Focal text near maximum contrast; supporting text 2–3 steps down the ramp |
| 4 | **Position** | Top and left win in LTR; center wins in sparse layouts | First viewport, first column, above the fold |
| 5 | **Whitespace** | Isolation is emphasis — an element alone in space is loud | 2–3x the standard gap around the element you're isolating |
| 6 | **Motion** | The loudest cue there is — a moving element beats everything above | Reserve for the focal point only |

Motion's position at rank 6 is deliberate: it's last because it's strongest. A subtle wiggle in the corner will out-shout your 64px headline. This is why motion decisions must come *after* the visual hierarchy is set — animate anything other than the focal point and you've silently rewritten the hierarchy. See `../motion-design/golden-rules.md`: an animation that doesn't serve the established hierarchy fails the Purpose Test by definition.

**The Two-Cue Rule:** emphasize the focal point with at most two cues (say, size + contrast). Stacking four cues on one element reads as desperation; if it needs four cues to win, the competition around it is too loud — demote the competition instead.

## Reading Gravity

Eyes don't wander randomly; they follow predictable patterns set by content density. Design the layout to cooperate:

| Content type | Pattern | Focal point placement |
|--------------|---------|----------------------|
| Text-heavy (docs, articles, dense slides) | **F-pattern** — down the left edge, scanning right | Top-left; headings and first words carry the scan |
| Sparse / landing / marketing | **Z-pattern** — top-left → top-right → diagonal → bottom-right | Top-left for the claim, bottom-right for the CTA |
| Hero / single-message view | **Center-out** — lock to center, radiate | Dead center; everything else orbits at lower rank |

Pick one pattern per view. A layout that's half F and half Z makes the eye stutter, and the audience experiences that stutter as "hard to read" without knowing why.

## Grids & Alignment

A grid is rhythm the audience feels but never sees. Use a 12-column grid for full pages, 4 or 6 for slides and cards. The specific column count matters less than this: **every edge aligns with another edge, on purpose.**

**One alignment sin breaks trust.** A single element 3px off the grid line reads — subconsciously but reliably — as carelessness, and carelessness in the layout implies carelessness in the argument. Audiences forgive a plain design; they don't forgive a sloppy one.

Deliberate grid breaks are a different thing entirely: an element that escapes the grid *visibly and confidently* (a full-bleed image, a pull-quote hanging into the margin, an oversized number crossing two columns) creates emphasis precisely because everything else obeys. Grid breaks are showcase-tier moves — budget 1–2 per piece, at the moments the narrative has earned them, and pair them with the showcase animation tier. A break only reads as intentional if the rest of the piece is ruthlessly aligned.

## Whitespace as Budget

Whitespace isn't leftover space; it's an allocated resource. Spend it from a scale:

| Step | Value | Typical job |
|------|-------|-------------|
| 1 | 4px | Icon-to-label, tightest pairs |
| 2 | 8px | Within a component |
| 3 | 12px | Between related lines |
| 4 | 16px | Between components in a group |
| 5 | 24px | Between groups |
| 6 | 32px | Between sections within a view |
| 7 | 48px | Major section breaks |
| 8 | 64px+ | Act breaks, hero padding |

Every gap on screen should be one of these values. Freehand gaps (13px, 27px) create the low-grade visual static that audiences read as "cheap" without being able to point at it.

Two principles govern spending:

- **Proximity is grouping.** Elements 8px apart are one thing; 32px apart, two things. If the audience can't tell which caption belongs to which image, the gaps are lying about the structure.
- **Macro-whitespace reads as confidence.** Generous space around a claim says "this can stand on its own." Cramped reads cheap — a view stuffed to the edges signals either anxiety or a template fighting its content. When in doubt, cut an element rather than shrink the gaps.

Whitespace also does motion work: staggered entrances (see the stagger pattern in `../motion-design/overview.md`) are only legible when items have room to arrive into. Stagger a cramped list and it reads as flicker, not choreography.

## When NOT to Apply This

- **Dashboards and reference tables want density.** A monitoring screen or comparison matrix is scanned, not read — generous whitespace there hides information and forces scrolling. Density done on a strict grid with a consistent 4/8px scale is still craft.
- **Hierarchy ≠ minimalism.** The goal is one *dominant* element, not one *total* element. A rich, layered view with a clear winner beats an empty view with no message. Don't confuse deleting content with ranking it.
- **Repeated structures (card grids, feed items) should be deliberately flat** internally — the hierarchy lives at the collection level. Making one card in a uniform grid shout is a bug unless the narrative singled it out.
