# Jhey Tompkins — Experimentation & Delight

Creative developer known for CSS innovation, playful interactions, and pushing platform boundaries. His work emphasizes what's newly possible rather than what's conventionally safe.

## Core Philosophy

> "CSS can do more than you think. The question isn't 'can we?' but 'should we, and how delightful can we make it?'"

Jhey's approach centers on **platform capabilities** — using native CSS/Web features in creative ways to achieve effects that would otherwise require JavaScript or libraries.

## CSS @property — Type-Safe Custom Properties

The breakthrough: declaring types for CSS variables enables smooth interpolation:

```css
@property --hue {
  initial-value: 0;
  inherits: false;
  syntax: '<number>';
}

.element {
  --hue: 0;
  background: hsl(var(--hue) 70% 50%);
  transition: --hue 0.5s;
}
.element:hover {
  --hue: 180;
}
```

Without `@property`, CSS sees custom properties as strings that swap instantly. With it, the browser interpolates smoothly.

**For presentations:** Use @property for:
- Color transitions between slides (hue rotation in background)
- Progress indicators with smooth value interpolation
- Creative reveals where a single property drives multiple visual changes

## The linear() Easing Function

Enables bounce, elastic, and spring effects in pure CSS:

```css
--bounce: linear(
  0, 0.004, 0.016, 0.035, 0.063, 0.098, 0.141 13.6%, 0.25, 0.391,
  0.563, 0.765, 1, 0.891 40.9%, 0.848, 0.813, 0.785, 0.766, 0.754,
  0.75, 0.754, 0.766, 0.785, 0.813, 0.848, 0.891 68.2%, 1 72.7%,
  0.973, 0.953, 0.941, 0.938, 0.941, 0.953, 0.973, 1
);
```

This replicates spring physics without JavaScript. Use Jake Archibald's linear() generator for custom curves.

## Scroll-Driven Animations

The core insight: scroll-driven animations are tied to scroll **speed**, which feels wrong for most UI. The solution:

### Duration Control Pattern
1. Scroll-driven animation toggles a CSS custom property at a scroll position
2. A separate time-based animation activates via Container Style Query
3. Result: animation triggers at scroll position but runs at fixed duration

**For presentations:** Use this for background effects that activate as the viewer reaches certain slides — the effect runs at consistent speed regardless of how fast they scrolled.

### Progressive Enhancement
```javascript
if (!CSS.supports('animation-timeline', 'scroll()')) {
  // IntersectionObserver fallback
}
```

## Stagger Techniques

### Negative Delays for "Already Running"
```css
.item {
  animation: pulse 2s infinite;
  animation-delay: calc(var(--index) * -0.3s);
}
```

Elements appear mid-animation from the start — creates organic, living patterns without coordinating start times.

### Padded Keyframes for Rhythmic Stagger
```css
@keyframes pop {
  0%, 60% { transform: scale(1); }
  70% { transform: scale(1.1); }
  100% { transform: scale(1); }
}
```

The dead space (0-60%) creates natural stagger when combined with offset delays.

## 3D CSS — Cuboid Thinking

Complex 3D scenes are assemblies of cuboid elements:

```css
.scene { transform-style: preserve-3d; perspective: 1000px; }
.cuboid { transform-style: preserve-3d; }
.cuboid__face--front { transform: translateZ(calc(var(--depth) / 2)); }
.cuboid__face--back { transform: translateZ(calc(var(--depth) / -2)) rotateY(180deg); }
```

**For presentations:** 3D transitions between slides, isometric diagrams, or architectural visualizations. Use sparingly — powerful but heavy.

## Clip-Path Creativity

Beyond simple reveals, clip-path enables:
- **Morphing shapes** — Animate between polygon() values
- **Spotlight effects** — `circle()` that follows cursor/scroll
- **Split-screen reveals** — Complementary clip-paths on stacked elements

## Fill Mode Awareness

`animation-fill-mode` prevents visual glitches:
- `backwards` — Element shows first-keyframe state during delay (prevents flash)
- `forwards` — Element retains final state after completion
- `both` — Combines both

Critical for staggered sequences where delayed elements would otherwise flash their unstyled state before animation begins.

## When Jhey's Approach Applies in Presentations

- **Opening title** — Creative entrance that sets the tone
- **The "aha" slide** — The key insight moment deserves special treatment
- **Data visualization** — Making numbers feel alive
- **Background ambiance** — Continuous subtle effects
- **Closing/CTA** — Memorable exit impression
- **Transition moments** — Between major sections (act breaks)

## When to Hold Back

- Standard content slides (Jakub's recipes are better)
- High-frequency interactions (Emil's restraint applies)
- Dense information slides (animation competes with reading)
- Accessibility-critical content (ensure graceful degradation)

## Concrete Creative Examples (Presentation-Scale)

The proven production examples that used to live here are canonical in
`../creative-recipes/` — read them there, with their generalized patterns and
constants, rather than working from a second copy:

- **Multi-column pipeline with independent loops** →
  [state-machines.md](../creative-recipes/state-machines.md) (the
  phase-cycling pattern and the production pipeline example).
- **SVG path drawing with a traveling element** →
  [svg-choreography.md](../creative-recipes/svg-choreography.md) (path draw,
  offset-path travel, bidirectional variants).
- **Streaming list with prepend/trim** →
  [streaming-simulations.md](../creative-recipes/streaming-simulations.md)
  (spawn cadence, visible-window trim, depth fade, mask gradient).

What this file adds to those recipes is the *techniques* above — @property,
linear() easing, scroll-driven duration control, negative-delay staggers, 3D
cuboids, clip-path — to reach for when adapting a recipe into something the
catalog doesn't already have.
