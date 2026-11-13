# Delivery

A figure ends up in three places: live in a page, held for a reader who asked
for less motion, and as a still in a README. One component serves all three.

## Where things go

`init` records it in `.agents/picture-this.json`:

- **A repo with a React docs site**: put figures beside the site's own
  components, so the site's build picks them up.

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/pt.mjs" init --figures docs/src/figures --stills docs/public/figures --mdx docs/src/mdx.tsx
  ```

- **A repo with no site**: leave the defaults. Figures live in
  `.agents/picture-this/figures/` and stills go to `docs/figures/`. The repo
  needs no React of its own: the studio brings it.

`land <round>/<draft> --as <name>` copies the chosen draft to
`<figures>/<name>/` and puts the kit in `<figures>/kit/` if it is not there.

## In MDX

Import the figure where it is used:

```mdx
import JobQueue from "@/figures/job-queue/figure";

<JobQueue />
```

Or register it once, so every page can use it by name. In fumadocs that is
the components file:

```tsx
import JobQueue from "./figures/job-queue/figure";

export function getMDXComponents(components) {
  return { ...defaultMdxComponents, JobQueue, ...components };
}
```

Props a page can pass: `audience="technical"`, `autoplay={false}`,
`controls={false}`, `captions={false}`, `theme="dark"`.

Things to know:

- **Next.js**: the kit's files start with `"use client"`, so a figure is a
  client component and can be used from a server page as it is.
- **Server rendering**: a figure renders its hero frame on the server and
  starts playing once it is in view. The flat `card-flow` style draws its
  threads only after the page has measured its cards.
- **Styles**: `stage.tsx` imports `kit.css`. A setup that refuses a CSS import
  from a component (the Next.js pages router) needs `kit.css` imported once,
  globally.
- **Theme**: a figure follows `.dark` or `[data-theme="dark"]` on any
  ancestor. It never reads the system setting itself, so it matches the page.
- **Fonts**: a figure inherits the page's font. For the mono labels, set
  `--pt-font-mono` on the page to the site's mono face.
- **Width**: a figure fills its column, up to its drawn size. Below about
  520 px it scrolls sideways and does not shrink its words.

## In a README

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/pt.mjs" still job-queue
```

writes `<stills>/job-queue.light.png` and `.dark.png` at twice their size and
prints the Markdown:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/figures/job-queue.dark.png">
  <img alt="..." src="docs/figures/job-queue.light.png" width="880">
</picture>
```

GitHub shows the dark image to a reader on a dark theme. A renderer that does
not honour `<picture>` shows the light one, which is why the light one is the
`img`. GitLab is in that second group as far as its documentation says.

`--from <dir>` makes the paths right for a Markdown file that is not at the
repo's root. `--technical` takes the technical captions. `--beat` and `--at`
take a frame other than the hero.

Commit the stills with the figure. Retake them whenever the figure or its
model changes: `export-stills` is the skill for that.
