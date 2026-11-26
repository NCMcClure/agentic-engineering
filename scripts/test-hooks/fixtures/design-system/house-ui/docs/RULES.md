# house-ui usage rules

- Colour comes from a token (`var(--house-ink)`, `bg-house-paper`), never a raw value.
- Corners come from the component: no `rounded-*` class at a call site.
- Depth comes from the component: no `shadow-*` class at a call site.
- A look the system lacks is a variant added to the system, not a restyle where it is used.
