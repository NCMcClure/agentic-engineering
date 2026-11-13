// pt draft: a round of drafts, each on a different archetype, all drawing one model.
//   new     lay a round out: the model, the kit, and one starter per archetype
//   check   is the round still fair: same model in every draft, kit untouched
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { ensureDrafts, layout } from "../lib/config.mjs";
import { PLUGIN_ROOT, repoRoot } from "../lib/home.mjs";
import { checkModel } from "../lib/model-check.mjs";
import { THREE_DIR, apply, drawsIn3d, hasThree, kitFiles, plan } from "../lib/owned.mjs";
import { readModel } from "./model.mjs";

const HELP = `usage: node pt.mjs draft new --model <model.json> --archetypes <a,b,c> [--round <name>] [--require-source] [--repo <dir>] [--json]
       node pt.mjs draft check <round> [--repo <dir>] [--json]
       node pt.mjs draft archetypes

  new          makes a round in the repo's scratch folder: one folder per draft
               (a, b, c ...), each holding the model and its archetype's starter
               figure, and a copy of the kit they all draw with. The drafts are
               laid out exactly as a landed figure is.
  check        every draft still draws the round's model, unchanged; no two share
               an archetype; nobody edited the round's kit
  archetypes   the starters there are to choose from

Exit codes: 0 done, or the round is fair; 1 the model does not pass, or the round is not fair; 2 usage.`;

const posix = (p) => p.split(path.sep).join("/");
const hashOf = (text) => createHash("sha256").update(text).digest("hex");
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The archetypes the plugin ships a starter for, with the line that says when to reach for each. */
export function archetypes(pluginRoot = PLUGIN_ROOT) {
  const dir = path.join(pluginRoot, "starters");
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "figure.tsx"))).map((e) => {
    // The comment at the top of a starter says what it is and when to reach for it.
    const lines = fs.readFileSync(path.join(dir, e.name, "figure.tsx"), "utf8").split("\n").filter((l) => l !== '"use client";');
    const head = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join(" ");
    return { name: e.name, about: head.replace(/^Archetype: /, "") };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function create(opts, { cwd, pluginRoot }) {
  if (!opts.model || !opts.archetypes) throw new PtError(HELP);
  const known = archetypes(pluginRoot).map((a) => a.name);
  const chosen = opts.archetypes.split(",").map((s) => s.trim()).filter(Boolean);
  // A view with no starter of its own is drawn on the blank one and named: blank:exploded, blank:time-grid.
  const starterOf = (name) => (name.startsWith("blank:") ? "blank" : name);
  for (const name of chosen) {
    if (!known.includes(starterOf(name))) throw new PtError(`no archetype '${name}': there is ${known.join(", ")} (and blank:<view> for a view with no starter)`);
    if (name === "blank") throw new PtError("blank needs the view it will draw: blank:<view>, for example blank:exploded or blank:time-grid");
    if (name.startsWith("blank:") && !NAME.test(name.slice(6))) throw new PtError(`'${name.slice(6)}' is not a view name: lowercase words joined by hyphens`);
  }
  if (new Set(chosen).size !== chosen.length) throw new PtError("the same archetype twice: each draft in a round is a different kind of picture");
  if (chosen.length < 2 || chosen.length > 4) throw new PtError(`${chosen.length} archetype${chosen.length === 1 ? "" : "s"}: a round has 2 to 4 drafts, three unless there is a reason`);

  const at = layout(repoRoot(opts.repo, { cwd }));
  const modelFile = path.resolve(cwd, opts.model);
  const model = readModel(modelFile);
  const { errors } = checkModel(model, { repo: at.repo, requireSource: opts.requireSource, requireMethod: true });
  if (errors.length) {
    emit({ ok: false, errors }, opts.json, [...errors.map((e) => `error: ${e}`), "the model does not pass, so no round was made: every draft would draw the same mistake"].join("\n"));
    return 1;
  }

  let round = opts.round;
  if (round) {
    if (!NAME.test(round) || round === "sheets") throw new PtError(`'${round}' is not a round name: lowercase words joined by hyphens`);
    if (fs.existsSync(path.join(at.drafts, round))) throw new PtError(`round '${round}' is already there: pick another name`);
  } else {
    let n = 1;
    while (fs.existsSync(path.join(at.drafts, `round-${n}`))) n += 1;
    round = `round-${n}`;
  }
  ensureDrafts(at.repo);
  const dir = path.join(at.drafts, round);
  // The round draws with the repo's own kit when it has one, edits and all; otherwise with the plugin's.
  const own = fs.existsSync(path.join(at.kit, "kit.json"));
  const kitFrom = own ? at.kit : path.join(pluginRoot, "kit");
  // A round with a 3D draft in it needs the kit's 3D tier; a round without one is not given it. A repo
  // whose own kit has no 3D tier yet borrows the plugin's for the round: drafting adds nothing to the repo.
  const in3d = chosen.some((archetype) => drawsIn3d(path.join(pluginRoot, "starters", archetype, "figure.tsx")));
  const threeFrom = !in3d ? null : hasThree(kitFrom) ? kitFrom : path.join(pluginRoot, "kit");
  apply(kitFrom, path.join(dir, "kit"), plan(kitFrom, path.join(dir, "kit"), { three: threeFrom === kitFrom }));
  if (threeFrom && threeFrom !== kitFrom) fs.cpSync(path.join(threeFrom, THREE_DIR), path.join(dir, "kit", THREE_DIR), { recursive: true });
  const text = JSON.stringify(model, null, 2) + "\n";
  const drafts = chosen.map((archetype, i) => {
    const id = String.fromCharCode(97 + i);
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.copyFileSync(path.join(pluginRoot, "starters", starterOf(archetype), "figure.tsx"), path.join(dir, id, "figure.tsx"));
    fs.writeFileSync(path.join(dir, id, "model.json"), text);
    return { id, archetype, dir: path.join(dir, id) };
  });
  fs.writeFileSync(path.join(dir, "round.json"), JSON.stringify({
    model: hashOf(text),
    kit: own ? posix(path.relative(at.repo, kitFrom)) : "the plugin's",
    ...(threeFrom && threeFrom !== kitFrom ? { three: "the plugin's" } : {}),
    drafts: drafts.map(({ id, archetype }) => ({ id, archetype })),
  }, null, 2) + "\n");

  const rel = (p) => posix(path.relative(at.repo, p));
  emit({ ok: true, round, dir, drafts }, opts.json, [
    `${round}: ${drafts.length} drafts of "${model.title}" in ${rel(dir)}/`,
    ...drafts.map((d) => `  ${round}/${d.id}  ${d.archetype.padEnd(13)} ${rel(d.dir)}/figure.tsx`),
    `lens: ${model.lens}. ${model.mechanism}`,
    `each starts as its archetype's starter, drawing this model: make it this model's picture, then \`sheet ${round}/<id>\``,
    ...(in3d ? ["a 3D draft is in the round: the studio draws it, and nothing is added to the repo unless it is the one landed"] : []),
  ].join("\n"));
  return 0;
}

function check(opts, { cwd, pluginRoot }) {
  const [, name, ...extra] = opts._;
  if (!name || extra.length) throw new PtError(HELP);
  const at = layout(repoRoot(opts.repo, { cwd }));
  const dir = fs.existsSync(path.resolve(cwd, name, "round.json")) ? path.resolve(cwd, name) : path.join(at.drafts, name);
  let round;
  try { round = JSON.parse(fs.readFileSync(path.join(dir, "round.json"), "utf8")); } catch { throw new PtError(`no round '${name}': \`draft new\` makes one`); }
  const problems = [];
  const seen = new Set();
  for (const d of round.drafts) {
    const where = `${path.basename(dir)}/${d.id}`;
    if (seen.has(d.archetype)) problems.push(`${where}: a second ${d.archetype}: each draft is a different kind of picture`);
    seen.add(d.archetype);
    if (!fs.existsSync(path.join(dir, d.id, "figure.tsx"))) problems.push(`${where}: no figure.tsx`);
    let text = null;
    try { text = fs.readFileSync(path.join(dir, d.id, "model.json"), "utf8"); } catch { problems.push(`${where}: no model.json`); }
    if (text !== null && hashOf(text) !== round.model) problems.push(`${where}: its model.json was changed: every draft draws the round's model, so the comparison is about form. To change the model, start a new round`);
  }
  // The kit the round was given, against what is there now: a draft may not restyle it.
  const kitFrom = round.kit === "the plugin's" ? path.join(pluginRoot, "kit") : path.join(at.repo, round.kit);
  const edited = (rel) => `${path.basename(dir)}/kit/${rel} was edited: drafts draw with the kit as it is, and a change to the house style is a change for every figure`;
  if (fs.existsSync(kitFrom)) {
    for (const f of plan(kitFrom, path.join(dir, "kit")).files) {
      if (f.action === "kept") problems.push(edited(f.rel));
      if (f.action === "add") problems.push(`${path.basename(dir)}/kit/${f.rel} is missing`);
    }
  }
  // A 3D tier borrowed from the plugin for the round is held to the plugin's copy.
  if (round.three === "the plugin's") {
    const from = path.join(pluginRoot, "kit");
    for (const rel of kitFiles(from).filter((r) => r.startsWith(THREE_DIR))) {
      const at3 = path.join(dir, "kit", rel);
      if (!fs.existsSync(at3)) problems.push(`${path.basename(dir)}/kit/${rel} is missing`);
      else if (!fs.readFileSync(at3).equals(fs.readFileSync(path.join(from, rel)))) problems.push(edited(rel));
    }
  }
  const ok = problems.length === 0;
  emit({ ok, round: path.basename(dir), drafts: round.drafts, problems }, opts.json, ok
    ? `ok: ${path.basename(dir)} is fair: ${round.drafts.map((d) => `${d.id} ${d.archetype}`).join(", ")}`
    : problems.map((p) => `error: ${p}`).join("\n"));
  return ok ? 0 : 1;
}

export async function run(argv, deps = {}) {
  const ctx = { cwd: deps.cwd ?? process.cwd(), pluginRoot: deps.pluginRoot ?? PLUGIN_ROOT };
  const opts = parseArgs(argv, { model: "string", archetypes: "string", round: "string", "require-source": "bool", repo: "string" });
  if (opts.help) { process.stdout.write(HELP + "\n"); return 0; }
  const [sub] = opts._;
  if (sub === "archetypes" && opts._.length === 1) {
    const all = archetypes(ctx.pluginRoot);
    emit({ archetypes: all }, opts.json, all.map((a) => `${a.name}\n  ${a.about}`).join("\n"));
    return 0;
  }
  if (sub === "new" && opts._.length === 1) return create(opts, ctx);
  if (sub === "check") return check(opts, ctx);
  throw new PtError(HELP);
}
