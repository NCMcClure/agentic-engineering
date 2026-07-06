# Streaming Simulations

Live data feed effects where items spawn, flow through, and exit — creating the illusion of a continuously running process.

## Generalized Pattern

### The Prepend/Trim Pattern

New items are added to the front of an array, old items are trimmed from the back:

```tsx
import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

const MAX_VISIBLE = 5
const SPAWN_INTERVAL = 1100 // ms

interface StreamItem {
  uid: number
  content: string
}

function StreamingList({ items }: { items: string[] }) {
  const [visible, setVisible] = useState<StreamItem[]>(() =>
    items.slice(0, MAX_VISIBLE).map((content, i) => ({ uid: i, content }))
  )

  useEffect(() => {
    let cursor = MAX_VISIBLE
    let uidCounter = MAX_VISIBLE

    const interval = window.setInterval(() => {
      const nextContent = items[cursor % items.length]
      cursor += 1
      uidCounter += 1
      const incoming: StreamItem = { uid: uidCounter, content: nextContent }
      setVisible(current => [incoming, ...current.slice(0, MAX_VISIBLE - 1)])
    }, SPAWN_INTERVAL)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div
      className="relative flex flex-col gap-2 overflow-hidden"
      style={{
        maskImage: "linear-gradient(to bottom, black 0%, black 78%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 78%, transparent 100%)",
      }}
    >
      <AnimatePresence initial={false}>
        {visible.map((item, index) => (
          <motion.div
            key={item.uid}
            layout
            initial={{ opacity: 0, y: -18, scaleY: 0.6 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: 24, scaleY: 0.7 }}
            transition={{
              layout: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] },
              opacity: { duration: 0.35, ease: "easeOut" },
              y: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] },
              scaleY: { duration: 0.35, ease: "easeOut" },
            }}
            style={{
              transformOrigin: "top",
              opacity: index === 0 ? 1 : Math.max(0.42, 1 - index * 0.09),
            }}
          >
            {item.content}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
```

### Progressive Opacity

Items further from the "head" of the list get progressively dimmer, creating depth:

```tsx
style={{
  opacity: index === 0 ? 1 : Math.max(0.42, 1 - index * 0.09),
}}
```

- Index 0 (newest) = full opacity
- Index 1 = 0.91, Index 2 = 0.82, etc.
- Clamped at 0.42 so nothing disappears entirely

### Pulsing Status Indicator

A "live" dot that pulses to show the stream is active:

```tsx
<motion.span
  className="inline-block h-1.5 w-1.5 rounded-full"
  style={{ backgroundColor: palette.green }}
  animate={{ opacity: [0.3, 1, 0.3] }}
  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
/>
```

### Exit Animation with Scale

Items exit downward with vertical compression, anchored to their top edge:

```tsx
exit={{ opacity: 0, y: 24, scaleY: 0.7 }}
// Combined with:
style={{ transformOrigin: "top" }}
```

This makes items appear to "sink" out of view rather than simply disappearing.

---

## Production Example: GitHistorySlide

A streaming git log that spawns new commits every 1.1 seconds, complete with rich metadata display, mask gradient, and paired digest panel. From the loom-agent-website:

```tsx
import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

interface CommitSeed {
  hash: string
  author: string
  authorColor: string
  date: string
  filename: string
  message: string
  added: number
  removed: number
}

interface VisibleCommit extends CommitSeed {
  uid: number
}

const VISIBLE_COMMITS = 5
const STREAM_INTERVAL_MS = 1100

export function GitHistorySlide() {
  const [visible, setVisible] = useState<VisibleCommit[]>(() =>
    commitSeeds.slice(0, VISIBLE_COMMITS).map((commit, index) => ({
      ...commit,
      uid: index,
    }))
  )

  useEffect(() => {
    let cursor = VISIBLE_COMMITS
    let uidCounter = VISIBLE_COMMITS

    const interval = window.setInterval(() => {
      const nextSeed = commitSeeds[cursor % commitSeeds.length]
      cursor += 1
      uidCounter += 1
      const incoming: VisibleCommit = { ...nextSeed, uid: uidCounter }
      setVisible(current => {
        const trimmed = current.slice(0, VISIBLE_COMMITS - 1)
        return [incoming, ...trimmed]
      })
    }, STREAM_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
      {/* Left: prose + capabilities */}
      <div className="flex flex-col gap-4">
        <p>Every capture is a git commit...</p>
        <ul className="space-y-2">
          {capabilities.map(cap => (
            <li key={cap.label} className="flex items-start gap-3 rounded-2xl border p-3">
              <span className="mt-1 h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: cap.color }} />
              <div>
                <div className="font-display">{cap.label}</div>
                <div className="text-sm">{cap.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Right: streaming terminal */}
      <div className="rounded-[2rem] border bg-gruvbox-bg1/70 px-5 pb-7 pt-5 shadow-elevated">
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.26em]">
            git log knowledge/
          </span>
          <span className="h-px flex-1 bg-gruvbox-bg3/70" />
          <span className="font-mono text-[10px] uppercase">streaming · live</span>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]" style={{ height: 340 }}>
          {/* Terminal panel */}
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-[#282828] p-3 font-mono text-[11px] text-[#ebdbb2]">
            {/* Window chrome dots */}
            <div className="mb-2 flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#cc241d" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#d79921" }} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#98971a" }} />
              <span className="ml-3 text-[9px] uppercase tracking-[0.2em] text-[#7c6f64]">
                ~/projects/my-project · git log
              </span>
            </div>

            {/* Streaming commit list with mask gradient */}
            <div
              className="relative flex flex-1 flex-col gap-2 overflow-hidden"
              style={{
                maskImage: "linear-gradient(to bottom, black 0%, black 78%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 78%, transparent 100%)",
              }}
            >
              <AnimatePresence initial={false}>
                {visible.map((commit, index) => (
                  <motion.div
                    key={commit.uid}
                    layout
                    initial={{ opacity: 0, y: -18, scaleY: 0.6 }}
                    animate={{ opacity: 1, y: 0, scaleY: 1 }}
                    exit={{ opacity: 0, y: 24, scaleY: 0.7 }}
                    transition={{
                      layout: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] },
                      opacity: { duration: 0.35, ease: "easeOut" },
                      y: { duration: 0.45, ease: [0.22, 0.61, 0.36, 1] },
                      scaleY: { duration: 0.35, ease: "easeOut" },
                    }}
                    style={{
                      transformOrigin: "top",
                      opacity: index === 0 ? 1 : Math.max(0.42, 1 - index * 0.09),
                    }}
                    className="flex flex-col gap-0.5"
                  >
                    <div className="flex items-center gap-2 text-[10px]">
                      <span style={{ color: palette.yellow }}>{commit.hash}</span>
                      <span style={{ color: commit.authorColor }}>{commit.author}</span>
                      <span className="text-[#a89984]">{commit.date}</span>
                      {index === 0 && (
                        <span className="ml-1 rounded-sm px-1 text-[8px] uppercase"
                          style={{ backgroundColor: palette.orange, color: "#282828" }}>
                          HEAD
                        </span>
                      )}
                    </div>
                    <div className="text-[10px]">knowledge: {commit.message}</div>
                    <div className="flex items-center gap-2 text-[9px]">
                      <span className="truncate" style={{ color: "#83a598" }}>
                        {commit.filename}
                      </span>
                      <span style={{ color: palette.green }}>+{commit.added}</span>
                      {commit.removed > 0 && (
                        <span style={{ color: palette.red }}>-{commit.removed}</span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Pulsing status indicator */}
            <div className="mt-2 flex items-center gap-1.5 border-t border-[#3c3836] pt-2 text-[9px] text-[#7c6f64]">
              <motion.span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: palette.green }}
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
              <span>watching knowledge/ · stop-hook armed</span>
            </div>
          </div>

          {/* Digest panel (static, paired with streaming) */}
          <div className="flex h-full flex-col gap-2">
            {/* EOD digest card */}
            {/* Derived reports card */}
          </div>
        </div>
      </div>
    </div>
  )
}
```

### Key Techniques

- **`cursor % commitSeeds.length`** wraps around the seed array so the stream never runs out of data
- **`uid` counter is strictly incrementing** — even when cursor wraps, uid doesn't, so AnimatePresence keys stay unique
- **`layout` prop on each item** ensures smooth reflow when items shift position
- **Per-property transitions** give different durations to layout vs opacity vs y for natural feel
- **easeOutBack `[0.22, 0.61, 0.36, 1]`** on layout and y transitions creates subtle overshoot
- **Mask gradient** prevents the hard edge at the bottom where items exit
- **HEAD badge on index 0** reinforces which item is "current" without additional state
- **Terminal chrome** (colored dots, path label) grounds the animation in a recognizable context
