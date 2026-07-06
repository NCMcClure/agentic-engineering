# Performance

## GPU-Composited Properties

Only these properties animate without triggering layout or paint:

| Property | Notes |
|----------|-------|
| `transform` | translate, scale, rotate, skew |
| `opacity` | Cheapest animation possible |
| `filter` | blur, brightness, contrast, etc. |
| `clip-path` | Hardware-accelerated reveals |

Everything else (width, height, top, left, padding, margin, border-radius via class) triggers expensive recalculations. `background-color` avoids layout but still repaints every frame — `will-change` does not make it compositor-driven, so prefer crossfading two layers with `opacity`.

## Motion's Performance Model

Motion animates `transform` and `opacity` by default. When you write:

```tsx
animate={{ x: 100, y: 50, scale: 1.1, opacity: 0.5 }}
```

Motion translates `x`, `y`, `scale`, `rotate` into a single `transform` string — one composited operation.

## will-change

```css
.will-animate {
  will-change: transform, opacity;
}
```

**When to use:** Apply just before animation starts, remove after it ends.
**When NOT to use:** Never leave permanently on many elements — each one allocates a GPU layer.

Motion handles this automatically for its own animations.

## Layout Thrashing

The most common performance killer in presentations:

```tsx
// BAD — read triggers synchronous layout after write
element.style.transform = 'translateX(10px)'
const width = element.offsetWidth // Forces layout!
```

### Solution: Batch Reads and Writes

```tsx
// All reads first
const measurements = elements.map(el => el.getBoundingClientRect())

// Then all writes
elements.forEach((el, i) => {
  el.style.transform = `translateX(${measurements[i].width}px)`
})
```

## Animation Frame Budget

At 60fps, each frame has ~16.67ms. At 120fps (ProMotion displays), ~8.33ms.

| Operation | Typical Cost |
|-----------|-------------|
| Transform animation | <1ms |
| Opacity animation | <0.5ms |
| Filter (blur) | 1-3ms |
| Layout (triggered) | 5-20ms |
| Paint (triggered) | 3-15ms |
| React re-render | 2-50ms+ |

### For Presentations

- Slide entrance animations (transform + opacity + filter): Well within budget
- Stagger sequences: Each child adds <1ms — safe for 20+ items
- Background RAF loops: Keep under 4ms per frame
- Avoid: React state updates during scroll (causes re-render + layout)

## MotionValues Bypass React

The key performance insight for Motion:

```tsx
// BAD — causes re-render every frame
const [x, setX] = useState(0)
useEffect(() => { /* animate setX */ }, [])
<div style={{ transform: `translateX(${x}px)` }} />

// GOOD — updates DOM directly, no re-render
const x = useMotionValue(0)
<motion.div style={{ x }} />
```

MotionValues write directly to the DOM on the animation frame. The React tree never re-renders.

## Expensive Patterns to Avoid

### 1. Animating `height` / `width`
```tsx
// BAD — triggers layout every frame
animate={{ height: isOpen ? "auto" : 0 }}

// BETTER — use transform
animate={{ scaleY: isOpen ? 1 : 0 }}
style={{ transformOrigin: "top" }}
```

### 2. Many AnimatePresence Children
Each child in AnimatePresence gets measured on mount/unmount. With 50+ children, this causes jank.

**Fix:** Virtualize or limit visible items.

### 3. Animating `filter` on Large Elements
Blur on a full-viewport element is expensive. Apply blur to smaller sub-elements or use a fixed-size overlay.

### 4. SVG Path Animation on Complex Paths
`pathLength` animation on SVG paths with 1000+ points can stutter.

**Fix:** Simplify paths or use `stroke-dasharray` + `stroke-dashoffset` with will-change.

## Presentation-Specific Optimizations

### Lazy Slide Content
Only render complex content for slides near the active one:

```tsx
{slides.map((slide, i) => (
  <SlideSection key={slide.id}>
    {Math.abs(i - activeIndex) <= 1 ? slide.render() : null}
  </SlideSection>
))}
```

### Disable Off-Screen Animations
Background animations on non-visible slides waste resources:

```tsx
<ConceptTile active={Math.abs(slideIndex - activeIndex) <= 1} />
```

### RAF Loop Guards
```tsx
function useAnimationLoop(callback: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let id: number
    const loop = () => { callback(); id = requestAnimationFrame(loop) }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [enabled])
}
```
