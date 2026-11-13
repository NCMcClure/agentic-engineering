// pt land: a chosen draft becomes one of the repo's figures.
import fs from "node:fs";
import path from "node:path";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { layout, slug } from "../lib/config.mjs";
import { findFigure } from "../lib/figures.mjs";
import { PLUGIN_ROOT, repoRoot } from "../lib/home.mjs";
import { checkModel } from "../lib/model-check.mjs";
import { installKit } from "./kit.mjs";

const HELP = `usage: node pt.mjs land <draft> --as <name> [--replace] [--repo <dir>] [--json]

Copies a draft's figure.tsx and model.json into the repo's figures folder as
<name>, and puts the kit beside them if it is not there yet. A draft is laid
out exactly as a figure is, so nothing in it is rewritten.

  <draft>     round/draft, or the draft's folder
  --replace   write over a figure of that name (without it, landing on one is refused)

Exit codes: 0 landed, 1 the draft's model does not pass \`model check\`, 2 usage.`;

const posix = (p) => p.split(path.sep).join("/");
const pascal = (name) => name.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");

export async function run(argv, deps = {}) {
  const { cwd = process.cwd(), pluginRoot = PLUGIN_ROOT } = deps;
  const opts = parseArgs(argv, { as: "string", replace: "bool", repo: "string" });
  if (opts.help) { process.stdout.write(HELP + "\n"); return 0; }
  if (opts._.length !== 1 || !opts.as) throw new PtError(HELP);
  const at = layout(repoRoot(opts.repo, { cwd }));
  const name = slug(opts.as);
  const draft = findFigure(at, opts._[0]);
  if (draft.kind !== "draft") throw new PtError(`${draft.id} is already one of the repo's figures: land takes a draft (round/draft)`);
  if (!draft.model) throw new PtError(`${draft.id} has no readable model.json`, 1);
  const { errors } = checkModel(draft.model, { repo: at.repo });
  if (errors.length) {
    emit({ ok: false, errors }, opts.json, [...errors.map((e) => `error: ${e}`), `${draft.id}: its model does not pass, so it is not landed`].join("\n"));
    return 1;
  }
  const to = path.join(at.figures, name);
  if (fs.existsSync(to) && !opts.replace) throw new PtError(`${posix(path.relative(at.repo, to))} is already there: pick another name, or pass --replace to write over it`);

  const kitPlan = installKit(at.kit, pluginRoot);
  fs.mkdirSync(to, { recursive: true });
  for (const file of ["figure.tsx", "model.json"]) fs.copyFileSync(path.join(draft.dir, file), path.join(to, file));

  const rel = (p) => posix(path.relative(at.repo, p));
  const added = kitPlan.files.filter((f) => f.action === "add").length;
  emit({ ok: true, figure: name, dir: to, kit: at.kit, kitAdded: added }, opts.json, [
    `landed ${draft.id} as ${rel(to)}/`,
    ...(added ? [`the kit was added: ${rel(at.kit)}/ (${added} files)`] : []),
    "",
    "To show it in a page:",
    `  import ${pascal(name)} from "<path to>/${rel(to)}/figure";`,
    `  <${pascal(name)} />`,
    `To give a README its picture: \`still ${name}\``,
  ].join("\n"));
  return 0;
}
