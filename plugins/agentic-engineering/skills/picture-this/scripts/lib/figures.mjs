// Finding a figure by the name a person gives it: one of the repo's figures,
// a draft in a round (round/draft), or a fixture shipped with the studio.
import fs from "node:fs";
import path from "node:path";
import { PtError } from "./args.mjs";

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const names = (dir) => (isDir(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "kit").map((e) => e.name).sort() : []);

/** A figure folder as the studio knows it, or null when it holds no figure.tsx. */
function entry(dir, id, kind) {
  if (!fs.existsSync(path.join(dir, "figure.tsx"))) return null;
  let model = null;
  try { model = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8")); } catch { /* reported by whoever needs it */ }
  return { id, kind, dir, model };
}

/** Every figure in a repo: its own, then its drafts. */
export function listFigures(at) {
  const found = names(at.figures).map((name) => entry(path.join(at.figures, name), name, "figure"));
  for (const round of names(at.drafts)) {
    for (const name of names(path.join(at.drafts, round))) found.push(entry(path.join(at.drafts, round, name), `${round}/${name}`, "draft"));
  }
  return found.filter(Boolean);
}

/**
 * The figure a name means. A name with no slash is one of the repo's figures;
 * `round/draft` is a draft; `fixture/name` is one shipped with the studio; a
 * path to a folder inside the drafts or figures folder works too.
 */
export function findFigure(at, name, { fixtures = null } = {}) {
  if (!name) throw new PtError("which figure? give its name, or round/draft for a draft");
  const asPath = path.resolve(name);
  for (const [root, kind] of [[at.figures, "figure"], [at.drafts, "draft"]]) {
    const rel = path.relative(root, asPath);
    if (isDir(asPath) && rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      const found = entry(asPath, rel.split(path.sep).join("/"), kind);
      if (found) return found;
    }
  }
  const parts = name.split("/").filter(Boolean);
  let found = null;
  if (parts.length === 1) found = entry(path.join(at.figures, parts[0]), parts[0], "figure");
  else if (parts.length === 2 && parts[0] === "fixture" && fixtures) found = entry(path.join(fixtures, parts[1]), name, "fixture");
  else if (parts.length === 2) found = entry(path.join(at.drafts, parts[0], parts[1]), name, "draft");
  if (!found) {
    const known = listFigures(at).map((f) => f.id);
    throw new PtError(`no figure '${name}'${known.length ? `: this repo has ${known.join(", ")}` : ": this repo has no figures yet"}`);
  }
  return found;
}
