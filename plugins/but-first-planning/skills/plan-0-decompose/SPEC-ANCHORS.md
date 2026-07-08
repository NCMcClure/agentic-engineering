# Spec anchors

Every issue (and every epic and sprint) links back to the spec section(s) it
realises. These links are **spec anchors**. They are what keeps the plan
grounded in the design: an anchor says "this work exists to make *this* part of
the spec real," which makes the plan auditable, lets a builder read the source of
truth, and lets `spec-4-edit` find exactly which issues a spec change touches.

## Where anchors go

- **Epic** and **sprint** files: in the `**Spec anchors**:` line near the top, as backtick-quoted paths (`` `spec/01-foundations/overview.md` ``). These are for orientation; they don't have to be clickable links.
- **Issue** files: as a real markdown link inside `## What to build`, written `Anchor: [spec/...](relative-path)`. **This one is checked by the verifier** — the link must resolve to a real file.

## The relative path shape (issues)

An issue file lives at:

```
.plan/plan/<epic>/<sprint>/issues/NN_issue_SLUG.md
```

The spec lives at `.plan/spec/...`. So from an issue file, the spec is **four
directories up**, then into `spec/`:

```
issues/  →  ../        (sprint dir)
         →  ../../      (epic dir)
         →  ../../../   (plan/)
         →  ../../../../ (.plan/)
         →  ../../../../spec/<category>/<file>.md
```

So an anchor reads:

```markdown
Anchor: [spec/02-runtime/event-loop.md](../../../../spec/02-runtime/event-loop.md)
```

The link text mirrors the spec-relative path (readable); the link target is the
file-relative path (resolvable). The verifier only checks links in `## What to
build` that contain `spec/`, and resolves them relative to the issue file — so
the `../../../../` prefix has to be right.

## How many anchors

- At least one per issue — the primary spec file the slice realises.
- Add a second or third only when the slice genuinely spans them. Don't anchor an issue to a whole category; anchor it to the specific file whose behaviour it makes real.
- If a slice has no spec anchor, that's a red flag: either the spec is missing the section (go back to `spec-1-specify`), or the slice isn't actually realising the design (reconsider it).

## Anchors enable change propagation

Because anchors are concrete file paths, `spec-4-edit` can answer "I changed
`spec/02-runtime/event-loop.md` — which issues are affected?" by scanning the plan
for anchors pointing at that file. That's only possible if anchors are precise
and kept current. When `spec-4-edit` moves or renames a spec file, it updates the
anchors that point at it (and the verifier catches any it missed, since the link
will stop resolving).
