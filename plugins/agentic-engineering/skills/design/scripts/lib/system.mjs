// The design system a person picked, and how a repo is put on it.
//
// Three places hold state, and this module is how each is read or made:
//
//   the profile   <data dir>/profile.json, on the machine and never committed:
//                 { source, ref, manifest? }. `source` is a local folder or a
//                 GitHub owner/repo, `ref` a tag or branch (none: the default
//                 branch, or a local folder's work tree). `manifest` is the
//                 whole description, for a system that ships none.
//   the manifest  design-system.json at the system's root (schema 1): how to
//                 install it, its entry CSS and root setup, its token files,
//                 rules and catalog, what is banned, and the allow file name.
//   the pin       .agents/design.json in a repo, committed: everything the
//                 checker needs, so it runs with no network and no plugin.
//
// A GitHub source is read through the person's own `gh` login, so a private
// system works; the fetcher is injected, so no test touches the network.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_INCLUDE, PIN, RULES } from "../../../../lib/design-check.mjs";
import { areaHome } from "../../../../lib/data-home.mjs";

export { PIN, RULES };
export const AREA = "design";
export const MANIFEST_FILE = "design-system.json";
export const CHECKER = ".agents/scripts/design-check.mjs";
/** The checker a repo gets: the route's copy, held hash-equal to lib/design-check.mjs. */
export const CHECKER_ASSET = path.join(import.meta.dirname, "..", "..", "routes", "adopt", "assets", "design-check.mjs");
export const PROFILE_FILE = "profile.json";

/** The area's data directory: `--data` when given, else `${CLAUDE_PLUGIN_DATA}/design`, else null. */
export function dataDir({ data = null, env = process.env } = {}) {
  if (data) return path.resolve(data);
  try { return areaHome(AREA, env); } catch { return null; }
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The profile in a data directory, or null when there is none or it does not parse. */
export function readProfile(dir) {
  if (!dir) return null;
  const p = readJson(path.join(dir, PROFILE_FILE));
  return isObject(p) && (typeof p.source === "string" || isObject(p.manifest)) ? p : null;
}

export function writeProfile(dir, profile) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PROFILE_FILE);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(profile, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

/** A source as written: `{ kind: "local", dir }` for a folder that exists, `{ kind: "github", owner, repo }` for owner/repo, or null. */
export function parseSource(source, cwd = process.cwd()) {
  if (typeof source !== "string" || !source.trim()) return null;
  const local = path.resolve(cwd, source);
  try { if (fs.statSync(local).isDirectory()) return { kind: "local", dir: local }; } catch { /* not a folder here */ }
  const gh = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(source.trim());
  return gh ? { kind: "github", owner: gh[1], repo: gh[2] } : null;
}

/**
 * The default fetcher: one file of a source at a ref, as text, or null when
 * the source has no such file. A local folder is read from its work tree, or
 * from git at the ref; a GitHub repo through `gh api`. Throws when the source
 * cannot be reached at all (no `gh`, not logged in).
 */
export function fetchFile(source, ref, rel, { spawn = spawnSync } = {}) {
  if (source.kind === "local") {
    if (!ref) { try { return fs.readFileSync(path.join(source.dir, rel), "utf8"); } catch { return null; } }
    const r = spawn("git", ["-C", source.dir, "show", `${ref}:${rel}`], { encoding: "utf8" });
    return r.status === 0 ? r.stdout : null;
  }
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const r = spawn("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/${source.owner}/${source.repo}/contents/${rel.split("/").map(encodeURIComponent).join("/")}${query}`], { encoding: "utf8" });
  if (r.error) throw new Error(`gh is not on PATH, so ${source.owner}/${source.repo} cannot be read (${r.error.code ?? r.error.message})`);
  if (r.status === 0) return r.stdout;
  if (/\b404\b|Not Found/i.test(`${r.stderr}${r.stdout}`)) return null;
  throw new Error(`gh api could not read ${source.owner}/${source.repo}: ${String(r.stderr || r.stdout).trim().split("\n")[0]}`);
}

/** What is wrong with a manifest, one sentence each; empty when it is schema 1 whole. */
export function manifestProblems(m) {
  if (!isObject(m)) return ["it is not a JSON object"];
  const out = [];
  const str = (v) => typeof v === "string" && v.trim() !== "";
  const strs = (v) => Array.isArray(v) && v.every(str);
  if (m.schema !== 1) out.push(`schema is ${JSON.stringify(m.schema ?? null)}, expected 1`);
  for (const key of ["name", "version", "rules", "catalog", "allow"]) if (!str(m[key])) out.push(`${key} is not a non-empty string`);
  if (!isObject(m.install) || !str(m.install.kit) || !str(m.install.item) || !str(m.install.pin)) out.push("install needs kit, item and pin, each a string");
  else if (!m.install.item.includes("{item}")) out.push("install.item has no {item} placeholder");
  if (!isObject(m.entry) || !strs(m.entry.css) || !strs(m.entry.root)) out.push("entry needs css and root, each a list of strings");
  if (!strs(m.tokens)) out.push("tokens is not a list of paths");
  if (!isObject(m.banned) || !strs(m.banned.values ?? []) || !Array.isArray(m.banned.classes ?? [])) out.push("banned needs values (a list) and classes (a list of { name, pattern })");
  else {
    for (const v of m.banned.values ?? []) if (v !== "color") out.push(`banned.values names ${JSON.stringify(v)}; the checker knows "color"`);
    for (const [i, c] of (m.banned.classes ?? []).entries()) {
      if (!isObject(c) || !str(c.name) || !str(c.pattern)) { out.push(`banned.classes[${i}] needs a name and a pattern`); continue; }
      try { new RegExp(c.pattern); } catch (e) { out.push(`banned.classes[${i}] (${c.name}) is not a regular expression: ${e.message}`); }
    }
  }
  return out;
}

/**
 * The manifest for a profile: the source's design-system.json at the ref, or
 * the profile's own `manifest` where the source ships none. Returns
 * `{ manifest, from }` (`source` or `profile`); throws with what to do when
 * there is neither.
 */
export function resolveManifest(profile, { fetch = fetchFile, cwd = process.cwd() } = {}) {
  if (!profile) throw new Error("no design system is declared on this machine: the system route of the design area declares one");
  const source = parseSource(profile.source, cwd);
  if (profile.source && !source) throw new Error(`the profile's source ${JSON.stringify(profile.source)} is neither a folder here nor a GitHub owner/repo`);
  const text = source ? fetch(source, profile.ref ?? null, MANIFEST_FILE) : null;
  if (text !== null) {
    let manifest;
    try { manifest = JSON.parse(text); } catch (e) { throw new Error(`${MANIFEST_FILE} in ${profile.source} does not parse: ${e.message}`); }
    return { manifest, from: "source" };
  }
  if (isObject(profile.manifest)) return { manifest: profile.manifest, from: "profile" };
  throw new Error(`${profile.source} has no ${MANIFEST_FILE}${profile.ref ? ` at ${profile.ref}` : ""}, and the profile holds no description: the system route interviews for one`);
}

/**
 * A document the manifest names (`key`: `rules` by default, or `catalog`),
 * read from the same source and ref. Throws when it cannot be found.
 */
export function readDoc(profile, manifest, { fetch = fetchFile, cwd = process.cwd(), key = "rules" } = {}) {
  const rel = manifest[key];
  const source = parseSource(profile?.source, cwd);
  const text = source ? fetch(source, profile.ref ?? null, rel) : null;
  if (text !== null) return text;
  if (path.isAbsolute(rel)) { try { return fs.readFileSync(rel, "utf8"); } catch { /* reported below */ } }
  throw new Error(`the ${key} file ${rel} is not in ${profile?.source ?? "any source"}${profile?.ref ? ` at ${profile.ref}` : ""}`);
}

/** The pin a repo commits, from the manifest, the profile, and what adopt found in the repo. `previous` keeps its scan settings on an upgrade. */
export function buildPin(manifest, profile, { tokens, include, exclude } = {}, previous = null) {
  return {
    schema: 1,
    system: manifest.name,
    version: manifest.version,
    source: profile?.source ?? null,
    ref: profile?.ref ?? null,
    tokens: tokens ?? previous?.tokens ?? [],
    banned: { values: manifest.banned?.values ?? [], classes: manifest.banned?.classes ?? [] },
    allow: manifest.allow,
    include: include ?? previous?.include ?? DEFAULT_INCLUDE,
    exclude: exclude ?? previous?.exclude ?? [],
  };
}

/** The first line of a repo's copy of the rules: which system and version they came from. */
export const rulesHeader = (manifest, profile) =>
  `> The usage rules of ${manifest.name} ${manifest.version}${profile?.source ? ` (${profile.source}${profile.ref ? ` at ${profile.ref}` : ""})` : ""}, copied by the design area's adopt route. Change them in the system; an upgrade replaces this file.`;

/** Whether a folder looks like a web front end: a components.json, or a package.json that depends on a web framework. */
export const FRAMEWORKS = ["react", "vue", "svelte", "solid-js", "astro", "next"];
export function isWebFrontEnd(root) {
  if (!root) return false;
  if (fs.existsSync(path.join(root, "components.json"))) return true;
  const pkg = readJson(path.join(root, "package.json"));
  if (!isObject(pkg)) return false;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  return FRAMEWORKS.some((name) => Object.hasOwn(deps, name));
}
