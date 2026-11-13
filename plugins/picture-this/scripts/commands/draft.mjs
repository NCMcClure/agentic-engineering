// pt draft: a round of drafts, each a different view of one model.
//   new      lay a round out: the model, the kit, and one draft per named view,
//            each on the blank stage unless it names a study to start from
//   check    is the round still fair, and has every draft said what it draws:
//            same model in every draft, kit untouched, each view stated and drawn
//   studies  the worked figures the plugin ships, and the view each one draws
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { ensureDrafts, layout } from "../lib/config.mjs";
import { PLUGIN_ROOT, repoRoot } from "../lib/home.mjs";
import { checkModel } from "../lib/model-check.mjs";
import { THREE_DIR, apply, drawsIn3d, hasThree, kitFiles, plan } from "../lib/owned.mjs";
import { readModel } from "./model.mjs";

const HELP = `usage: node pt.mjs draft new --model <model.json> --views <a,b,c=study> [--round <name>] [--require-source] [--repo <dir>] [--json]
       node pt.mjs draft check <round> [--repo <dir>] [--json]
       node pt.mjs draft studies

  new       makes a round in the repo's scratch folder: one folder per draft
            (a, b, c ...), each holding the model, a figure to draw in, and a
            view.json to state the view in before drawing it; and a copy of the
            kit they all draw with. A view is named for what it draws
            (cutaway, two-runs, gap-chart) and starts on the blank stage.
            <view>=<study> starts it from a study instead, for when that
            study's view is this subject's view. The drafts are laid out
            exactly as a landed figure is.
  check     every draft still draws the round's model, unchanged; no two share
            a view or a study; each has stated its view and drawn it; nobody
            edited the round's kit
  studies   the worked figures there are to learn from, and to start from

Exit codes: 0 done, or the round is fair; 1 the model does not pass, or the round is not fair; 2 usage.`;

const posix = (p) => p.split(path.sep).join("/");
const hashOf = (text) => createHash("sha256").update(text).digest("hex");
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** What a draft starts from when its view names no study. */
export const BLANK = "blank";
/** What a draft says about its view before it is drawn, and the least each may say. */
export const STATEMENT = ["drawn", "moves", "means"];
const STATEMENT_MIN = 20;
const ASKS = {
  drawn: "what is drawn: the shapes on the page and what each one is",
  moves: "what moves, and what that motion says about the subject",
  means: "what each visual property means: position, size, tone, the accent",
};

/** The studies the plugin ships: worked figures, each drawing one view, with the line that says when its view is the right one. */
export function studies(pluginRoot = PLUGIN_ROOT) {
  const dir = path.join(pluginRoot, "studies");
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "figure.tsx"))).map((e) => {
    // The comment at the top of a study says what view it draws and when that view fits.
    const lines = fs.readFileSync(path.join(dir, e.name, "figure.tsx"), "utf8").split("\n").filter((l) => l !== '"use client";');
    const head = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join(" ");
    return { name: e.name, about: head.replace(/^Study: /, "") };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** `cutaway` or `layers=layer-stack`: a view's name, and the study it starts from, if any. */
function parseViews(text, known) {
  const views = text.split(",").map((s) => s.trim()).filter(Boolean).map((word) => {
    const [view, base, ...more] = word.split("=");
    if (more.length || base === "") throw new PtError(`'${word}' is not a view: <view>, or <view>=<study> to start from a study`);
    if (!NAME.test(view)) throw new PtError(`'${view}' is not a view name: lowercase words joined by hyphens, naming what the view draws`);
    if (base === undefined && known.includes(view)) {
      throw new PtError(`'${view}' is a study's name, not a view of this subject: name the view for what it draws, and write <view>=${view} if it should start from that study`);
    }
    if (base !== undefined && !known.includes(base)) throw new PtError(`no study '${base}': there is ${known.join(", ")}. A view with no study starts on the blank stage: leave the =<study> off`);
    return { view, base: base ?? BLANK };
  });
  if (views.length < 2 || views.length > 4) throw new PtError(`${views.length} view${views.length === 1 ? "" : "s"}: a round has 2 to 4 drafts, three unless there is a reason`);
  if (new Set(views.map((v) => v.view)).size !== views.length) throw new PtError("the same view twice: each draft in a round is a different kind of picture");
  const based = views.filter((v) => v.base !== BLANK).map((v) => v.base);
  if (new Set(based).size !== based.length) throw new PtError("the same study twice: two drafts from one study compare shades of one picture");
  return views;
}

async function create(opts, { cwd, pluginRoot }) {
  if (opts.archetypes) throw new PtError("--archetypes is now --views: name each view for what it draws, and add =<study> only where a study's view is the view");
  if (!opts.model || !opts.views) throw new PtError(HELP);
  const known = studies(pluginRoot).map((s) => s.name);
  const chosen = parseViews(opts.views, known);
  const sourceOf = (base) => (base === BLANK ? path.join(pluginRoot, BLANK, "figure.tsx") : path.join(pluginRoot, "studies", base, "figure.tsx"));

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
  const in3d = chosen.some(({ base }) => drawsIn3d(sourceOf(base)));
  const threeFrom = !in3d ? null : hasThree(kitFrom) ? kitFrom : path.join(pluginRoot, "kit");
  apply(kitFrom, path.join(dir, "kit"), plan(kitFrom, path.join(dir, "kit"), { three: threeFrom === kitFrom }));
  if (threeFrom && threeFrom !== kitFrom) fs.cpSync(path.join(threeFrom, THREE_DIR), path.join(dir, "kit", THREE_DIR), { recursive: true });
  const text = JSON.stringify(model, null, 2) + "\n";
  const drafts = chosen.map(({ view, base }, i) => {
    const id = String.fromCharCode(97 + i);
    const figure = fs.readFileSync(sourceOf(base), "utf8");
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, "figure.tsx"), figure);
    fs.writeFileSync(path.join(dir, id, "model.json"), text);
    // The view is stated here, in words, before it is drawn.
    fs.writeFileSync(path.join(dir, id, "view.json"), JSON.stringify({ view, base, drawn: "", moves: "", means: "" }, null, 2) + "\n");
    return { id, view, base, figure: hashOf(figure), dir: path.join(dir, id) };
  });
  fs.writeFileSync(path.join(dir, "round.json"), JSON.stringify({
    model: hashOf(text),
    kit: own ? posix(path.relative(at.repo, kitFrom)) : "the plugin's",
    ...(threeFrom && threeFrom !== kitFrom ? { three: "the plugin's" } : {}),
    drafts: drafts.map(({ id, view, base, figure }) => ({ id, view, base, figure })),
  }, null, 2) + "\n");

  const rel = (p) => posix(path.relative(at.repo, p));
  const from = (base) => (base === BLANK ? "the blank stage" : `the ${base} study`);
  const allStudies = drafts.every((d) => d.base !== BLANK);
  emit({ ok: true, round, dir, drafts }, opts.json, [
    `${round}: ${drafts.length} views of "${model.title}" in ${rel(dir)}/`,
    ...drafts.map((d) => `  ${round}/${d.id}  ${d.view.padEnd(14)} from ${from(d.base).padEnd(22)} ${rel(d.dir)}/figure.tsx`),
    `lens: ${model.lens}. ${model.mechanism}`,
    `state each view in its view.json before drawing it (${STATEMENT.join(", ")}), draw it, then \`sheet ${round}/<id>\``,
    ...(allStudies ? ["every draft starts from a study: a round is rarely all studies. Is each one's view this subject's own, or the nearest template?"] : []),
    ...(in3d ? ["a 3D draft is in the round: the studio draws it, and nothing is added to the repo unless it is the one landed"] : []),
  ].join("\n"));
  return 0;
}

/** A draft's view.json, held to the round's record: the same view, and every part of the statement said. */
function statementOf(dir, d, where, problems) {
  let stated;
  try { stated = JSON.parse(fs.readFileSync(path.join(dir, d.id, "view.json"), "utf8")); } catch { problems.push(`${where}: no readable view.json: it says what the draft draws`); return null; }
  if (stated.view !== d.view || stated.base !== d.base) problems.push(`${where}: its view.json names ${stated.view} from ${stated.base}, and the round made it ${d.view} from ${d.base}: a different view is a new round`);
  const unsaid = STATEMENT.filter((key) => typeof stated[key] !== "string" || stated[key].trim().length < STATEMENT_MIN);
  if (unsaid.length) problems.push(`${where}: its view is not stated. Before drawing, say in view.json ${unsaid.map((key) => `${ASKS[key]} (${key})`).join("; ")}`);
  return unsaid.length ? null : Object.fromEntries(STATEMENT.map((key) => [key, stated[key].trim()]));
}

function check(opts, { cwd, pluginRoot }) {
  const [, name, ...extra] = opts._;
  if (!name || extra.length) throw new PtError(HELP);
  const at = layout(repoRoot(opts.repo, { cwd }));
  const dir = fs.existsSync(path.resolve(cwd, name, "round.json")) ? path.resolve(cwd, name) : path.join(at.drafts, name);
  let round;
  try { round = JSON.parse(fs.readFileSync(path.join(dir, "round.json"), "utf8")); } catch { throw new PtError(`no round '${name}': \`draft new\` makes one`); }
  const problems = [];
  const views = new Set(), bases = new Set();
  const stated = {};
  for (const d of round.drafts) {
    const where = `${path.basename(dir)}/${d.id}`;
    if (views.has(d.view)) problems.push(`${where}: a second ${d.view}: each draft is a different kind of picture`);
    views.add(d.view);
    if (d.base !== BLANK && bases.has(d.base)) problems.push(`${where}: a second draft from the ${d.base} study: two from one study compare shades of one picture`);
    bases.add(d.base);
    stated[d.id] = statementOf(dir, d, where, problems);
    let figure = null;
    try { figure = fs.readFileSync(path.join(dir, d.id, "figure.tsx"), "utf8"); } catch { problems.push(`${where}: no figure.tsx`); }
    if (figure !== null && hashOf(figure) === d.figure) {
      problems.push(d.base === BLANK
        ? `${where}: its figure.tsx is still the blank stage: nothing is drawn yet`
        : `${where}: its figure.tsx is still the ${d.base} study as shipped: a study is where a draft starts, and this model's picture is not drawn yet`);
    }
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
  const from = (base) => (base === BLANK ? "the blank stage" : `the ${base} study`);
  const drafts = round.drafts.map(({ id, view, base }) => ({ id, view, base, ...(stated[id] ?? {}) }));
  emit({ ok, round: path.basename(dir), drafts, problems }, opts.json, ok
    ? [
      `ok: ${path.basename(dir)} is fair: ${drafts.map((d) => `${d.id} ${d.view}`).join(", ")}`,
      // Each view in its own words, to show the person beside its sheet.
      ...drafts.flatMap((d) => [`  ${d.id}  ${d.view}, from ${from(d.base)}`, ...STATEMENT.map((key) => `     ${key}: ${d[key]}`)]),
    ].join("\n")
    : problems.map((p) => `error: ${p}`).join("\n"));
  return ok ? 0 : 1;
}

export async function run(argv, deps = {}) {
  const ctx = { cwd: deps.cwd ?? process.cwd(), pluginRoot: deps.pluginRoot ?? PLUGIN_ROOT };
  const opts = parseArgs(argv, { model: "string", views: "string", archetypes: "string", round: "string", "require-source": "bool", repo: "string" });
  if (opts.help) { process.stdout.write(HELP + "\n"); return 0; }
  const [sub] = opts._;
  if (sub === "studies" && opts._.length === 1) {
    const all = studies(ctx.pluginRoot);
    emit({ studies: all }, opts.json, [
      "Worked figures, each drawing one view. Read one to learn a technique; start a draft from one (<view>=<study>) only when its view is the subject's view.",
      "",
      ...all.map((a) => `${a.name}\n  ${a.about}`),
    ].join("\n"));
    return 0;
  }
  if (sub === "new" && opts._.length === 1) return create(opts, ctx);
  if (sub === "check") return check(opts, ctx);
  throw new PtError(HELP);
}
