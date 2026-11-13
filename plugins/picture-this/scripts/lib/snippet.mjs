// The Markdown that shows a figure's still: the light image, and the dark one
// where the reader's theme is dark. GitHub honours <picture>; a renderer that
// does not (GitLab, most others) shows the <img>, which is the light still.

const escape = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What the picture says, for someone who cannot see it: the title, then the claim. */
export function altText(model) {
  const title = (model?.title ?? "").trim(), claim = (model?.claim ?? "").trim();
  return [title, claim].filter(Boolean).join(". ").replace(/\.\.$/, ".");
}

/** `light` and `dark` are paths as the Markdown file will reach them, with forward slashes. */
export function pictureSnippet({ light, dark, alt, width }) {
  return [
    "<picture>",
    `  <source media="(prefers-color-scheme: dark)" srcset="${escape(dark)}">`,
    `  <img alt="${escape(alt)}" src="${escape(light)}"${width ? ` width="${width}"` : ""}>`,
    "</picture>",
  ].join("\n");
}
