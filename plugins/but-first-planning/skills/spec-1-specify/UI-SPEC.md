# UI/UX specification, scaled by posture

A spec that only describes internals leaves the human one way to verify the
system: read logs and trust the tests. The UI/UX content specified here gives
them a second way — **open a surface and look** — and it's what
`plan-0-decompose` turns into `REVIEW` issues (human visual-verification
gates). How much of it the spec carries follows the recorded **UI/UX posture**
(`reference/adr/0002-ui-posture.md`):

- **headless** — no UI/UX content at all. Every behaviour states its command or
  test verification in its own file. Skip the rest of this document.
- **dev-dashboard** — end-users never see a UI, but the spec includes a minimal
  internal dashboard as the verification surface: its screens/panels plus the
  verification-surfaces mapping.
- **existing-design-system** — the product already has a design system. The spec
  captures its tokens/components/conventions as **constraints**, specs each new
  screen/flow in those terms, and carries the verification-surfaces mapping.
- **greenfield-product** — polished UI/UX is a deliverable. The spec carries the
  full category below, plus HTML prototypes under `prototypes/`.

## The UI/UX category

A numbered category like any other (e.g. `03-ui/`), holding up to three files:

- **`design-system.md`** — the visual vocabulary: tokens (color / type /
  spacing as tables), core components (one table each: anatomy, states,
  behaviour), and layout/interaction patterns. Under **existing-design-system**
  this file is *design-constraints*: the **existing** system's tokens,
  components, and conventions captured as constraints new work must satisfy,
  with sources (where the canonical tokens live in the product repo). Under
  **dev-dashboard** keep it minimal — enough that every panel looks and behaves
  the same way, not a brand book.
- **`key-screens.md`** — each screen or flow: purpose, states, a wireframe, and
  which glossary behaviours it exposes. Split into one file per flow when a
  flow outgrows a section (~3+ screens).
- **`verification-surfaces.md`** — **the load-bearing file.** A table mapping
  system behaviour → the surface where a human observes it → what "looks right"
  means (with the spec § that defines it):

  ```markdown
  | Behaviour | Surface | Looks right when |
  |-----------|---------|------------------|
  | Event intake | events panel (`/events`) | submitted event appears in the list with its id (§event-lifecycle) |
  | Validation rejects bad input | same, submit form | rejection shows the stated reason (§validation) |
  ```

  This is what `plan-0-decompose` anchors `REVIEW` issues to. A behaviour with
  no row here can only be verified by reading logs — decide deliberately
  whether that's acceptable.

## Wireframes and mockups

Low-fidelity structure lives inline in the `.md`: a fenced ASCII/box wireframe,
or a mermaid `flowchart` when the layout is really a flow. One screen per
wireframe; annotate states in a caption or list rather than drawing one
wireframe per state.

````markdown
```
┌──────────────────────────────────────────┐
│ Events                        [+ Submit] │
├──────────────────────────────────────────┤
│ #id   type        received     status    │
│ 0142  intake.ok   12:01:22     stored ✓  │
│ 0141  intake.bad  12:00:47     rejected  │  ← rejection reason on hover
└──────────────────────────────────────────┘
```
States: empty (no events yet — show the submit hint), loading, error banner.
````

Anything higher-fidelity than a box sketch is an HTML prototype, not inline
markup — a spec file full of styled HTML stops being readable as a document.

## Prototypes (`greenfield-product`, or opt-in)

Prototypes live in `spec/prototypes/` — one self-contained static `.html` file
each, served verbatim by the spec site. They are **throwaway design artifacts**:
CDN assets only, no build step, no imports from the repo, never referenced by
product code or plan checkpoints. Their job is to make a screen tangible enough
to tweak *before* the build, and to give early `REVIEW` issues something to
compare against.

- Start one by copying `prototypes/prototype-skeleton.html` (scaffolded by
  `spec-0-init`); keep its design-token custom properties mirroring
  `design-system.md` so the two compare line for line.
- Add one line per prototype to `prototypes/index.md`.
- Link it from the spec page it illustrates. To embed instead, use a raw
  iframe — and note the path is computed against the **rendered URL**, not the
  file: with `use_directory_urls`, `03-ui/key-screens.md` renders at
  `03-ui/key-screens/`, so the src needs one extra `../`. MkDocs rewrites `.md`
  links but never raw HTML `src` attributes.

  ```html
  <iframe src="../../prototypes/login-flow.html"
          style="width:100%;height:480px;border:1px solid #d1d5db"></iframe>
  ```

## The test

A UI/UX spec is done when a stranger could open each surface in
`verification-surfaces.md` and say pass/fail per behaviour without asking
anyone. That is exactly what a `REVIEW` issue will ask a human to do — if the
table can't support that walkthrough, the spec isn't done.
