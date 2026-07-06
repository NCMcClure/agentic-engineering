# Layout Animations

## The `layout` Prop

Adding `layout` to a motion component animates all layout changes automatically:

```tsx
<motion.div layout className={isExpanded ? "w-full" : "w-48"} />
```

When the className changes dimensions, Motion uses the FLIP technique (First, Last, Invert, Play) to animate smoothly without triggering continuous layout recalculation.

## What FLIP Animates

- Position changes (element moves in the DOM or grid)
- Size changes (width, height)
- Any CSS that affects the element's bounding box

All animated via `transform` (GPU-composited, no layout thrashing).

## `layoutId` — Shared Element Transitions

When two components in different locations share a `layoutId`, Motion animates between them:

```tsx
// In list view:
<motion.div layoutId={`card-${id}`} className="h-16 w-full" />

// In detail view:
<motion.div layoutId={`card-${id}`} className="h-96 w-full" />
```

Motion automatically animates position, size, and border-radius between the two states.

### For Presentations

Use `layoutId` for:
- Expanding a concept tile into a full slide
- Tab/section indicators that slide between positions
- Before/after comparisons where the same element transforms

## Layout Groups

Coordinate layout animations across sibling components:

```tsx
import { LayoutGroup } from "motion/react"

<LayoutGroup>
  <motion.div layout />
  <motion.div layout />
</LayoutGroup>
```

Without `LayoutGroup`, components animate independently and may overlap during transitions.

## AnimatePresence + Layout

Combining exit animations with layout shifts:

```tsx
<AnimatePresence>
  {items.map(item => (
    <motion.div
      key={item.id}
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
    />
  ))}
</AnimatePresence>
```

When an item exits, remaining items smoothly close the gap (via `layout`).

## Layout Transition Configuration

```tsx
<motion.div
  layout
  transition={{
    layout: { type: "spring", duration: 0.4, bounce: 0 }
  }}
/>
```

Separate `layout` transition from value transitions for fine-tuned control.

## Common Pitfalls

### 1. Don't Animate layout + opacity Exit Together

```tsx
// Problematic — layout shift conflicts with fade out
<motion.div layout exit={{ opacity: 0 }} />
```

The element fading to 0 opacity while the layout is recalculating creates visual glitches.

**Fix:** Use `mode="popLayout"` on AnimatePresence — the exiting element is removed from layout flow immediately.

### 2. Keep layoutId Outside AnimatePresence

If an element with `layoutId` is inside AnimatePresence, the enter/exit animations fire during the layout animation, creating double-motion.

### 3. Border Radius

`border-radius` animates via layout, but only with inline styles:

```tsx
<motion.div layout style={{ borderRadius: 12 }} />
```

Tailwind `rounded-*` classes won't animate via layout — they're applied as class-based styles that FLIP can't track.

## Layout Scroll Correction

By default, layout animations account for scroll position changes. If a parent scrolls during animation:

```tsx
<motion.div layout layoutScroll />
```

`layoutScroll` tells Motion this container scrolls and to correct for it.

## Presentation Use Cases

### Slide Section Indicator
```tsx
{slides.map(slide => (
  <button key={slide.id} onClick={() => goTo(slide)}>
    {activeSlide === slide.id && (
      <motion.div layoutId="active-indicator" className="absolute inset-0 rounded-full bg-accent" />
    )}
    {slide.title}
  </button>
))}
```

### Content Mode Switch
```tsx
<motion.div layoutId={`content-${id}`} className={view === "grid" ? "w-1/3" : "w-full"} />
```
