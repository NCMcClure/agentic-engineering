# Scroll-Driven Animations

## useScroll

Tracks scroll progress of a container or viewport:

```tsx
import { useScroll } from "motion/react"

// Track page scroll
const { scrollY, scrollYProgress } = useScroll()

// Track specific element's scroll progress
const { scrollYProgress } = useScroll({
  target: ref,
  offset: ["start end", "end start"]
})

// Track a scrollable container
const { scrollYProgress } = useScroll({
  container: containerRef
})
```

### Offset Configuration

`offset` defines when tracking starts and ends relative to the target and container:

```tsx
offset: ["start end", "end start"]
//       [target container, target container]
```

Values: `"start"`, `"center"`, `"end"`, or pixel/percentage values.

Common offsets:
- `["start end", "end start"]` — Full element traversal through viewport
- `["start start", "end start"]` — Element pinned at top
- `["start 0.8", "start 0.2"]` — Middle portion of viewport

## useTransform

Maps one motion value range to another:

```tsx
import { useTransform } from "motion/react"

const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 0])
const scale = useTransform(scrollYProgress, [0, 1], [0.8, 1])
const y = useTransform(scrollYProgress, [0, 1], [100, 0])
```

Runs on the animation frame — no React re-renders.

### With Functions

```tsx
const rotation = useTransform(scrollYProgress, (v) => v * 360)
```

### Chaining Transforms

```tsx
const scroll = useScroll()
const smoothScroll = useSpring(scroll.scrollYProgress, { stiffness: 100, damping: 30 })
const y = useTransform(smoothScroll, [0, 1], [0, -200])
```

## useMotionValueEvent

React to motion value changes without re-renders:

```tsx
import { useMotionValueEvent } from "motion/react"

useMotionValueEvent(scrollYProgress, "change", (latest) => {
  if (latest > 0.5) setActiveSection("bottom")
})
```

## whileInView (Simplest Approach)

For most presentation content, `whileInView` is the easiest scroll-triggered animation:

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.3 }}
  transition={{ duration: 0.5 }}
/>
```

This triggers when the element enters the viewport — no manual scroll tracking needed.

## Scroll-Linked Opacity (Parallax-Like)

```tsx
function ParallaxSection({ children }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  })
  
  const opacity = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0, 1, 1, 0])
  const y = useTransform(scrollYProgress, [0, 1], [50, -50])

  return (
    <motion.div ref={ref} style={{ opacity, y }}>
      {children}
    </motion.div>
  )
}
```

## Progress Bar (Scroll-Linked)

```tsx
function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  
  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-1 bg-accent origin-left"
      style={{ scaleX: scrollYProgress }}
    />
  )
}
```

## Slide-Specific Scroll Progress

Track how far through a specific slide the user has scrolled:

```tsx
function SlideProgress({ slideRef }) {
  const { scrollYProgress } = useScroll({
    target: slideRef,
    offset: ["start start", "end end"]
  })
  
  // 0 when slide top hits viewport top
  // 1 when slide bottom hits viewport bottom
  return scrollYProgress
}
```

## Performance Notes

- `useScroll` uses a passive scroll listener — no jank
- `useTransform` and `useSpring` compute on the animation frame
- `style={{ x, y, opacity }}` with MotionValues bypasses React — direct DOM updates
- Avoid reading `.get()` on MotionValues inside render — use `useMotionValueEvent` instead
- For many scroll-driven elements, consider `will-change: transform` during active scroll

## Presentation Patterns

### Content Reveal on Scroll

```tsx
<motion.div
  initial={{ opacity: 0, y: 30 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.5 }}
  transition={{ type: "spring", duration: 0.6 }}
/>
```

### Background Color Transition Between Slides

```tsx
const { scrollYProgress } = useScroll({ container: presentationRef })
const bgColor = useTransform(
  scrollYProgress,
  [0, 0.5, 1],
  ["#FAFAFA", "#F0F9FF", "#0A0A0A"]
)
```

### Snap-Scroll with Progress Tracking

The presentation template uses IntersectionObserver (not useScroll) for slide tracking because snap-scroll containers don't emit continuous scroll values between snaps.
