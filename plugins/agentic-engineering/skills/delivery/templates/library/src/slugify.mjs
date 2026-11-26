// A placeholder with real edge cases, so the template ships a test that can
// actually fail. Replace it with the library's first real function.
export function slugify(input) {
  if (typeof input !== "string") throw new TypeError(`slugify expects a string, got ${typeof input}`);
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
