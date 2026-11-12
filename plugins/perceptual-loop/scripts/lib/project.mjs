// What every command agrees on: where the project and its state are, the
// config, the shots and groups, which shots a selection means, and the flat
// keys the baseline is written in. The words and file shapes are defined in
// references/contract.md.
import fs from "node:fs";
import path from "node:path";
import { PlError } from "./args.mjs";

export const DIR_NAME = path.join(".agents", "perceptual");
// Where the plugin's first layout kept the same files. A repo still on it is read
// in place, so nothing breaks before the session hook has moved the folder.
export const OLD_DIR_NAME = ".perceptual-loop";
export const DEFAULT_CONFIG = {
  version: 1,
  reference: "reference",
  candidates: ["candidate"],
  shotsDir: ".agents/perceptual/shots",
  render: {},
  passes: ["beauty"],
  regionsFrom: null,
  budget: { free: 3, match: [String.raw`pl\.mjs["']?\s+iterate\b`] },
  metrics: { ssim: true, deltaE: true, edges: true, detail: true },
};
export const NAME_RX = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const PASS_SUFFIX = { beauty: "", mask: ".mask", id: ".id", depth: ".depth", albedo: ".albedo" };

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---- project and config ---------------------------------------------------------

/** The first ancestor holding the state folder's config.json (either layout), else the first with a .git, else the start. */
export function findRoot(start = process.cwd()) {
  let here = path.resolve(start), gitRoot = null;
  for (;;) {
    if (isFile(path.join(here, DIR_NAME, "config.json")) || isFile(path.join(here, OLD_DIR_NAME, "config.json"))) return here;
    if (!gitRoot && fs.existsSync(path.join(here, ".git"))) gitRoot = here;
    const up = path.dirname(here);
    if (up === here) return gitRoot ?? path.resolve(start);
    here = up;
  }
}

/** PL_DIR, or the name the variable had before the PL_ prefix covered every one. */
export const envDir = (env = process.env) => env.PL_DIR || env.PERCEPTUAL_LOOP_DIR || "";

/** Whether the root's state still sits in the first layout's folder: a config there, and none in the current one. */
export const onOldLayout = (root) => !isFile(path.join(root, DIR_NAME, "config.json")) && isFile(path.join(root, OLD_DIR_NAME, "config.json"));

/** The state folder: PL_DIR when set, else .agents/perceptual under the root, else the first layout's folder while the repo is still on it. */
export function stateDir(root) {
  const env = envDir();
  if (env) return path.resolve(env);
  return path.join(root, onOldLayout(root) ? OLD_DIR_NAME : DIR_NAME);
}
export const runsDir = (root) => path.join(stateDir(root), "runs");

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const both = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]);
    out[k] = both ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(root, { required = false } = {}) {
  const file = path.join(stateDir(root), "config.json");
  if (!isFile(file)) {
    if (required) throw new PlError(`no ${path.join(DIR_NAME, "config.json")} under ${root}: run pl.mjs init first (the shot-harness skill)`);
    return structuredClone(DEFAULT_CONFIG);
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new PlError(`${file} is not valid JSON: ${e.message}`); }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new PlError(`${file} must hold a JSON object`);
  const config = merge(structuredClone(DEFAULT_CONFIG), doc);
  // a first-layout config that never named its shots folder keeps them beside itself
  if (doc.shotsDir === undefined && !envDir() && onOldLayout(root)) config.shotsDir = `${OLD_DIR_NAME}/shots`;
  return config;
}

const underOld = (rel) => typeof rel === "string" && /^(?:\.[\\/])?\.perceptual-loop(?:[\\/]|$)/.test(rel);

/**
 * A path the config or the review queue names, from the root. One written under the first layout's folder
 * is read from the state folder once that folder has moved, so a file nobody has edited yet still finds its
 * pictures.
 */
export function configPath(root, rel) {
  if (underOld(rel) && !fs.existsSync(path.join(root, OLD_DIR_NAME))) {
    return path.join(stateDir(root), rel.replace(/^(?:\.[\\/])?\.perceptual-loop[\\/]?/, ""));
  }
  return path.resolve(root, rel);
}

/** The config's string values that still name the first layout's folder, as [dotted key, value, the value to write instead]. */
export function oldPathKeys(config, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && value.includes(OLD_DIR_NAME)) out.push([at, value, value.replaceAll(OLD_DIR_NAME, DIR_NAME.split(path.sep).join("/"))]);
    else if (Array.isArray(value)) value.forEach((v, i) => { if (typeof v === "string" && v.includes(OLD_DIR_NAME)) out.push([`${at}[${i}]`, v, v.replaceAll(OLD_DIR_NAME, DIR_NAME.split(path.sep).join("/"))]); });
    else if (value && typeof value === "object") out.push(...oldPathKeys(value, at));
  }
  return out;
}

export function shotsDir(root, config) {
  if (process.env.PL_SHOTS_DIR) return path.resolve(process.env.PL_SHOTS_DIR);
  return configPath(root, config.shotsDir);
}

export const shotPath = (shot, root, config) => path.join(shotsDir(root, config), shot);
export const passFile = (shotDir, source, pass = "beauty") => path.join(shotDir, `${source}${PASS_SUFFIX[pass]}.png`);

// ---- JSON on disk --------------------------------------------------------------------

export function readJson(file, fallback = null) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
  try { return JSON.parse(text); } catch (e) { throw new PlError(`${file} is not valid JSON: ${e.message}`); }
}

/** Write JSON through a temporary file and a rename, so a reader never sees half a file. */
export function writeJson(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ---- shots, groups, selection -----------------------------------------------------------

export function allShots(root, config) {
  const dir = shotsDir(root, config);
  if (!isDir(dir)) return [];
  return fs.readdirSync(dir).filter((n) => isFile(path.join(dir, n, "shot.json"))).sort();
}

export const loadGroups = (root) => readJson(path.join(stateDir(root), "groups.json"), {}) ?? {};

/** Python's fnmatch.translate: `*` and `?` cross every character, `[!...]` negates, an unclosed `[` is literal. */
function translate(pat) {
  let out = "", i = 0;
  const n = pat.length;
  while (i < n) {
    const c = pat[i++];
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else if (c === "[") {
      let j = i;
      if (pat[j] === "!") j++;
      if (pat[j] === "]") j++;
      while (j < n && pat[j] !== "]") j++;
      if (j >= n) { out += "\\["; continue; }
      let body = pat.slice(i, j);
      i = j + 1;
      const negate = body[0] === "!";
      if (negate) body = body.slice(1);
      body = body.replace(/[\\\]\[^]/g, (m) => "\\" + m);
      out += `[${negate ? "^" : ""}${body}]`;
    } else out += c.replace(/[.+^${}()|\\\]\-/]/g, (m) => "\\" + m);
  }
  return new RegExp(`^(?:${out})$`, "s");
}

const patterns = new Map();
export function fnmatch(name, pattern) {
  if (!patterns.has(pattern)) patterns.set(pattern, translate(pattern));
  return patterns.get(pattern).test(name);
}

/** Names matching any plain glob and no '!'-prefixed glob, order kept. */
export function matchGlobs(names, globs) {
  const yes = globs.filter((g) => !g.startsWith("!")), no = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  return names.filter((n) => yes.some((g) => fnmatch(n, g)) && !no.some((g) => fnmatch(n, g)));
}

const isGlob = (s) => /[*?[]/.test(s);

/** The selection flags every command shares: shot names (commas allowed), --shots, --group, --match, --all. */
export const SELECTION_FLAGS = {
  shots: { type: "string", multi: true },
  group: { type: "string" },
  match: { type: "string" },
  all: { type: "bool" },
};
export const selectionOf = (opts) => ({ names: [...opts._, ...(opts.shots ?? [])], group: opts.group, match: opts.match, all: opts.all });
export const hasSelection = (sel) => Boolean(sel.names.length || sel.group || sel.all);

/** The shots a selection means: a group, else --all, else names and globs; --match narrows. */
export function resolveShots({ names = [], group, match, all }, root, config) {
  const have = allShots(root, config);
  let picked;
  if (group) {
    const groups = loadGroups(root);
    if (!(group in groups)) throw new PlError(`no group '${group}' in groups.json (have: ${Object.keys(groups).sort().join(", ") || "none"})`);
    picked = matchGlobs(have, groups[group]);
  } else if (all) picked = [...have];
  else {
    const flat = names.flatMap((raw) => raw.split(",")).filter(Boolean);
    const missing = flat.filter((n) => !have.includes(n) && !isGlob(n));
    if (missing.length) throw new PlError(`no such shot: ${missing.join(", ")}`);
    picked = flat.flatMap((n) => (isGlob(n) ? matchGlobs(have, [n]) : [n]));
  }
  if (match) picked = matchGlobs(picked, [match]);
  return [...new Set(picked)];
}

/** The selected shots; an empty or absent selection is a usage error, never "everything". */
export function selected(sel, root, config) {
  if (!hasSelection(sel)) throw new PlError("no shots selected: name 1-3 shots that show the thing, or use --group NAME / --all");
  const shots = resolveShots(sel, root, config);
  if (!shots.length) throw new PlError("the selection matches no shot (pl.mjs groups list shows the groups)");
  return shots;
}

// ---- flat keys ------------------------------------------------------------------------------

/** metrics.<source>.json to { "<shot>/<source>/frame.ssim": v, "<shot>/<source>/region.<name>.<metric>": v }. */
export function flattenMetrics(doc) {
  const out = {};
  const head = `${doc.shot}/${doc.source}`;
  for (const [k, v] of Object.entries(doc.frame ?? {})) {
    if (typeof v === "number") out[`${head}/frame.${k}`] = v;
    // white balance is three gains: gate each, or a colour cast would never trip the gate
    else if (k === "wb" && Array.isArray(v) && v.length === 3) v.forEach((g, i) => { out[`${head}/frame.wb.${"rgb"[i]}`] = g; });
  }
  for (const [name, reg] of Object.entries(doc.regions ?? {})) {
    for (const [k, v] of Object.entries(reg)) if (typeof v === "number" && k !== "area") out[`${head}/region.${name}.${k}`] = v;
  }
  return out;
}

export function splitKey(key) {
  const a = key.indexOf("/"), b = key.indexOf("/", a + 1);
  return [key.slice(0, a), key.slice(a + 1, b), key.slice(b + 1)];
}

/** 1.5 x the entry's measured spread if it has one, else the most specific matching tolerance pattern. */
export function toleranceFor(key, baseline, fallback = 0) {
  const spread = baseline.spread?.[key];
  if (spread !== undefined && spread !== null) return 1.5 * spread;
  const [, source, metric] = splitKey(key);
  let best = null;
  for (const [pattern, tol] of Object.entries(baseline.tolerances ?? {})) {
    const cut = pattern.indexOf("/");
    const ps = cut === -1 ? pattern : pattern.slice(0, cut), pm = cut === -1 ? "" : pattern.slice(cut + 1);
    if (!fnmatch(source, ps)) continue;
    const rx = new RegExp("^" + pm.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+") + "$");
    if (!rx.test(metric)) continue;
    const score = pattern.replaceAll("*", "").length;
    if (!best || score > best[0]) best = [score, Number(tol)];
  }
  return best ? best[1] : fallback;
}

/** A run folder's name from the clock: YYYYMMDD-HHMMSS. */
export function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
