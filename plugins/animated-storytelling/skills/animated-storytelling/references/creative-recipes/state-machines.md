# State Machines

Multi-phase looped animations that cycle through different content or visual states. The foundation for "living" slides that feel like running software rather than static content.

## Generalized Pattern

### Cycled-Phase Pattern

Drive visual phases from a single timer. Each phase renders different content.

```tsx
import { useEffect, useState } from "react"

type Phase = "alpha" | "beta" | "gamma"
const CYCLE_DURATION = 18 // seconds total
const PHASE_DURATION = 6  // seconds per phase

function CycledContent() {
  const [phase, setPhase] = useState<Phase>("alpha")
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const start = performance.now()
    const id = setInterval(() => {
      const elapsed = (performance.now() - start) / 1000
      const t = elapsed % CYCLE_DURATION
      if (t < 6) setPhase("alpha")
      else if (t < 12) setPhase("beta")
      else setPhase("gamma")
      setTick(t)
    }, 80) // 80ms tick = smooth progress tracking
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <PhaseIndicator current={phase} />
      {phase === "alpha" && <AlphaView progress={tick} />}
      {phase === "beta" && <BetaView progress={tick - 6} />}
      {phase === "gamma" && <GammaView progress={tick - 12} />}
    </div>
  )
}
```

### Independent Column Loops

Multiple columns, each with its own animation cycle and content type:

```tsx
function Pipeline() {
  const stages = [
    { label: "Input", node: <InputColumn /> },
    { label: "Process", node: <ProcessColumn /> },
    { label: "Output", node: <OutputColumn /> },
  ]

  return (
    <div className="flex items-stretch gap-2">
      {stages.map((stage, idx) => (
        <ColumnFrame key={stage.label} label={stage.label} index={idx + 1}>
          {stage.node}
        </ColumnFrame>
      ))}
    </div>
  )
}

function ColumnFrame({ label, index, children }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em]">
          {label}
        </span>
        <span className="font-mono text-[8px]">
          {String(index).padStart(2, "0")}
        </span>
      </div>
      <div className="relative overflow-hidden rounded-xl border" style={{ height: 320 }}>
        {children}
      </div>
    </div>
  )
}
```

### Streaming Text with Progress

Character-count reveal based on elapsed time within a phase:

```tsx
function StreamingText({ text, phaseT, duration }: {
  text: string
  phaseT: number
  duration: number
}) {
  const progress = Math.min(1, phaseT / duration)
  const charCount = Math.floor(text.length * progress)
  return <span>{text.slice(0, charCount)}</span>
}
```

### Ticker-Driven Chat

Items appear at a fixed interval, cycling back to the start:

```tsx
function TickerColumn({ items, intervalMs = 1100 }) {
  const [visible, setVisible] = useState(1)

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(v => v >= items.length ? 1 : v + 1)
    }, intervalMs)
    return () => clearInterval(id)
  }, [])

  return items.slice(0, visible).map((item, idx) => (
    <motion.div
      key={idx}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {item}
    </motion.div>
  ))
}
```

---

## Production Example: WhatLoomIsSlide Pipeline

A 5-column pipeline where each column has completely independent animation logic. From the loom-agent-website presentation:

### Architecture

```tsx
function Pipeline() {
  const stages: { label: string; node: ReactNode }[] = [
    { label: "Prompt", node: <PromptColumn /> },
    { label: "Retrieve", node: <RetrieveColumn /> },
    { label: "Work", node: <WorkColumn /> },
    { label: "Reflect", node: <ReflectColumn /> },
    { label: "Capture", node: <CaptureColumn /> },
  ]

  return (
    <div className="rounded-[2rem] border bg-gruvbox-bg1/70 p-4 shadow-elevated">
      <div className="flex items-stretch gap-2">
        {stages.map((stage, idx) => (
          <div key={stage.label} className="flex flex-1 items-stretch">
            <ColumnFrame label={stage.label} index={idx + 1}>
              {stage.node}
            </ColumnFrame>
            {idx < stages.length - 1 && (
              <div className="flex items-center px-1">
                <ArrowRight size={18} strokeWidth={1.5} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

### PromptColumn — Ticker-Driven Chat

Typed chat entries (user messages, tool calls, assistant replies) appear one at a time every 1.1s, cycling back to 1 when complete:

```tsx
type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "tool"; tool: string; arg: string }
  | { kind: "assistant"; text: string }

const chatScript: ChatEntry[] = [
  { kind: "user", text: "Where did we land on the auth rewrite?" },
  { kind: "tool", tool: "Read", arg: "knowledge/index.md" },
  { kind: "tool", tool: "Read", arg: "project/decisions/index.md" },
  { kind: "tool", tool: "Grep", arg: "'auth rewrite'" },
  { kind: "assistant", text: "JWT, scoped to 15min. See decisions/auth-rewrite.md." },
  { kind: "user", text: "Wire it into the user service next." },
  { kind: "tool", tool: "Read", arg: "technical/services/user.md" },
]

function PromptColumn() {
  const [visible, setVisible] = useState(1)

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(v => v >= chatScript.length ? 1 : v + 1)
    }, 1100)
    return () => clearInterval(id)
  }, [])

  const entries = chatScript.slice(0, visible)

  return (
    <div className="flex h-full flex-col justify-end overflow-hidden px-2 py-2">
      <div className="space-y-1.5">
        {entries.map((entry, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* render based on entry.kind */}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
```

### WorkColumn — Three-Phase Cycle

Cycles through three content types (diff → design doc → messy notes) every 18s. Each phase has its own streaming text animation driven by elapsed time within the phase:

```tsx
function WorkColumn() {
  const [phase, setPhase] = useState<"diff" | "design" | "notes">("diff")
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const start = performance.now()
    const id = setInterval(() => {
      const elapsed = (performance.now() - start) / 1000
      const cycle = 18
      const t = elapsed % cycle
      if (t < 6) setPhase("diff")
      else if (t < 12) setPhase("design")
      else setPhase("notes")
      setTick(t)
    }, 80)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Phase indicator dots */}
      <div className="flex items-center gap-1">
        {(["diff", "design", "notes"] as const).map(p => (
          <span
            key={p}
            className="h-1 w-3 rounded-sm"
            style={{ backgroundColor: p === phase ? palette.accent : palette.border }}
          />
        ))}
      </div>
      {/* Phase content */}
      {phase === "diff" && <DiffView phaseT={tick} />}
      {phase === "design" && <DesignDocView phaseT={tick - 6} />}
      {phase === "notes" && <MessyNotesView phaseT={tick - 12} />}
    </div>
  )
}

function DiffView({ phaseT }: { phaseT: number }) {
  const PER_LINE = 5 / diffLines.length
  const visibleCount = Math.min(diffLines.length, Math.floor(phaseT / PER_LINE) + 1)

  return (
    <div className="font-mono text-[8px] leading-snug">
      {diffLines.slice(0, visibleCount).map((line, idx) => {
        const isCurrent = idx === visibleCount - 1
        const lineProgress = isCurrent
          ? Math.min(1, (phaseT - idx * PER_LINE) / (PER_LINE * 0.85))
          : 1
        const charCount = Math.max(1, Math.floor(line.text.length * lineProgress))
        const bg = line.kind === "+"
          ? `${palette.green}1a`
          : line.kind === "-"
          ? `${palette.red}1a`
          : "transparent"
        return (
          <div key={idx} style={{ backgroundColor: bg }}>
            <span>{line.kind}</span> {line.text.slice(0, charCount)}
          </div>
        )
      })}
    </div>
  )
}
```

### RetrieveColumn — Infinite Scroll Loop

A seamless infinite scroll created by duplicating the content block and animating y from 0% to -50%:

```tsx
function ScrollingCache() {
  const block = (
    <div className="space-y-2 px-2 py-2">
      {cacheEntries.map((entry, idx) => (
        <CacheEntryView entry={entry} key={idx} />
      ))}
    </div>
  )

  return (
    <motion.div
      animate={{ y: ["0%", "-50%"] }}
      transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
      className="absolute inset-x-0 top-0"
    >
      {block}
      {block}
    </motion.div>
  )
}
```

Paired with top/bottom gradient overlays to mask the scroll edges:

```tsx
<div className="pointer-events-none absolute inset-x-0 top-0 h-6"
  style={{ background: `linear-gradient(to bottom, ${palette.bg}, transparent)` }}
/>
<div className="pointer-events-none absolute inset-x-0 bottom-0 h-6"
  style={{ background: `linear-gradient(to top, ${palette.bg}, transparent)` }}
/>
```

### Key Techniques

- **80ms tick interval** provides smooth progress tracking without expensive re-renders
- **`performance.now()` for stable timing** — doesn't drift like accumulated setInterval
- **Phase-relative time** (`tick - 6`) means each phase's animation starts from zero
- **Independent column state** — each column manages its own timer/cycle, no cross-column coordination needed
- **Decorative chrome** (window bars, phase dots, status labels) establishes context without requiring functional code
