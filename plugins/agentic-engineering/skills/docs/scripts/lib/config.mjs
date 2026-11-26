// Where a repo keeps its figures: .agents/picture-this.json, and the defaults
// a repo with no config (and no React app of its own) gets.
import fs from "node:fs";
import path from "node:path";
import { PtError } from "./args.mjs";

export const CONFIG_FILE = ".agents/picture-this.json";
export const DRAFTS_DIR = ".agents/picture-this/drafts";
export const DEFAULTS = { version: 1, figuresDir: ".agents/picture-this/figures", stillsDir: "docs/figures", mdxComponents: null };
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A repo-relative folder, with forward slashes, that stays inside the repo. */
function inside(repo, value, key) {
  if (typeof value !== "string" || !value.trim()) throw new PtError(`${CONFIG_FILE}: ${key} is missing`);
  const rel = path.relative(repo, path.resolve(repo, value));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new PtError(`${CONFIG_FILE}: ${key} '${value}' is not a folder inside the repo`);
  return rel.split(path.sep).join("/");
}

/** The repo's config, or the defaults when it has none. `configured` says which. */
export function readConfig(repo) {
  const file = path.join(repo, CONFIG_FILE);
  let raw = null;
  try { raw = fs.readFileSync(file, "utf8"); } catch { /* no config: the defaults */ }
  let found = {};
  if (raw !== null) {
    try { found = JSON.parse(raw); } catch (e) { throw new PtError(`${CONFIG_FILE} is not JSON: ${e.message}`); }
    if (!found || typeof found !== "object" || Array.isArray(found)) throw new PtError(`${CONFIG_FILE} is not a JSON object`);
    if (found.version !== 1) throw new PtError(`${CONFIG_FILE}: version ${JSON.stringify(found.version)} is not one this plugin reads (1)`);
  }
  const merged = { ...DEFAULTS, ...found };
  return {
    configured: raw !== null,
    version: 1,
    figuresDir: inside(repo, merged.figuresDir, "figuresDir"),
    stillsDir: inside(repo, merged.stillsDir, "stillsDir"),
    mdxComponents: merged.mdxComponents ? inside(repo, merged.mdxComponents, "mdxComponents") : null,
  };
}

/** Every folder a command needs, absolute. */
export function layout(repo, config = readConfig(repo)) {
  const figures = path.join(repo, config.figuresDir);
  return {
    repo,
    config,
    figures,
    kit: path.join(figures, "kit"),
    stills: path.join(repo, config.stillsDir),
    drafts: path.join(repo, DRAFTS_DIR),
    lock: path.join(repo, DRAFTS_DIR, ".studio.lock"),
  };
}

/** A figure's name: kebab-case, and never the kit's folder. */
export function slug(value) {
  if (typeof value !== "string" || !SLUG.test(value) || value === "kit") throw new PtError(`'${value}' is not a figure name: lowercase words joined by hyphens`);
  return value;
}

/** The scratch folder drafts and the studio's lock live in: created ignored, so nothing in it is ever committed. */
export function ensureDrafts(repo) {
  const dir = path.join(repo, DRAFTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return dir;
}
