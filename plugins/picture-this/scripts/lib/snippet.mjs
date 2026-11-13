// The Markdown that shows a figure's still: the light image, and the dark one
// where the reader's theme is dark. GitHub honours <picture>; a renderer that
// does not (GitLab, most others) shows the <img>, which is the light still.

const escape = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What the picture says, for someone who cannot see it: the title, then the claim. */
export function altText(model) {
  const title = (model?.title ?? "").trim(), claim = (model?.claim ?? "").trim();
  return [title, claim].filter(Boolean).join(". ").replace(/\.\.$/, ".");
}

/** What a beat strip says: the title, then the steps it shows, in order. */
export function stripAlt(model) {
  const steps = (model?.beats ?? []).filter((b) => !b.rest).map((b) => (b.title ?? "").trim());
  const title = (model?.title ?? "").trim().replace(/\.$/, "");
  if (!title || !steps.length || steps.some((s) => !s)) return altText(model);
  return `${title}, in ${steps.length} ${steps.length === 1 ? "step" : "steps"}: ${steps.join(", ")}.`;
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
