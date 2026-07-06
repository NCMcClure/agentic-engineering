# Creative Recipes — Bespoke Animation Patterns

A catalog of advanced animation patterns adapted from production work. These are **RECIPES to adapt, not components to import** — each shows the creative concept, an implementation skeleton, and the key Motion/CSS techniques involved. The examples are drawn from presentation slides (where each "showcase" moment is essentially custom software), but the patterns apply to any animated surface: a hero section, an interactive explainer, a product demo, a dashboard, a data story.

## When to Use These

Reach for a creative recipe at the **showcase moments** — the 2-3 spots in a piece that carry the key insight and deserve bespoke, memorable motion. Everyday moments (context, bullets, simple data) should use simpler, polished defaults (the Jakub enter recipe in motion-design). Don't make everything a showcase — the contrast is what makes the showcase land.

## The Creative Process

Before reaching for a recipe, ask:

1. **What's the concept?** (e.g., "knowledge flows through a pipeline")
2. **What makes it visceral?** (e.g., "seeing each stage animate independently, in a loop, with realistic typing and scrolling")
3. **Which recipe is closest?** (e.g., "multi-column state machine")
4. **What do I need to adapt?** (e.g., "change 5 columns to 3, add different content per column")

## Recipe Categories

| Category | Best For | Key Technique |
|----------|----------|---------------|
| [state-machines.md](state-machines.md) | Processes, pipelines, cycles | useEffect + setInterval, phased rendering |
| [svg-choreography.md](svg-choreography.md) | Connections, flows, topology | pathLength, offsetDistance, coordinated motion |
| [streaming-simulations.md](streaming-simulations.md) | Live data, history, feeds | AnimatePresence + prepend/trim pattern |
| [interactive-mocks.md](interactive-mocks.md) | UI demos, product previews | useState + onClick, sliding panels |
| [visual-metaphors.md](visual-metaphors.md) | Abstract concepts, transformations | Convergence/divergence, pulsing, masking |

## Shared Performance Patterns

All recipes share these production-proven techniques:

### Mask gradients for content fade

```tsx
style={{
  maskImage: "linear-gradient(to bottom, black 0%, black 78%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 78%, transparent 100%)",
}}
```

Prevents harsh cut-off at container edges. Use instead of `overflow-hidden` when content streams off-edge.

### will-change during active animations only

Apply `will-change: transform` to elements during their animation lifecycle, not permanently. Permanent will-change wastes GPU memory and can actually degrade performance.

### easeOutBack for springy reveals

```tsx
const easeOutBack: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
```

Gives scale and position animations a subtle overshoot that feels alive. Use for node/badge reveals.

### Material swap over opacity for dimming

Instead of reducing opacity (which makes text unreadable), shift the element's background/text color toward the page background:

```tsx
style={{ color: isActive ? palette.fg : palette.muted }}
```

### Negative animation-delay for mid-cycle appearance

When an element should appear "already running" rather than starting from zero:

```tsx
transition={{ delay: -(totalDuration * 0.3) }}
```

### Explicit transformOrigin for scale animations

Always set `transformOrigin` when using scaleY or scaleX — the default center origin causes elements to shrink toward their middle rather than anchoring to an edge:

```tsx
style={{ transformOrigin: "top" }}
```

## Reference Files (this folder)

- [state-machines.md](state-machines.md) — Multi-phase looped animations
- [svg-choreography.md](svg-choreography.md) — Path drawing and element travel
- [streaming-simulations.md](streaming-simulations.md) — Live data feeds
- [interactive-mocks.md](interactive-mocks.md) — Clickable, scrollable content
- [visual-metaphors.md](visual-metaphors.md) — Convergence, transformation, pipeline animations
