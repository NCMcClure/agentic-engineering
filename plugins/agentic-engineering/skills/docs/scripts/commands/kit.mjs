// pt init and pt kit: where a repo keeps its figures, and the kit they draw with.
import fs from "node:fs";
import path from "node:path";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { CONFIG_FILE, DEFAULTS, layout, readConfig } from "../lib/config.mjs";
import { PLUGIN_ROOT, repoRoot } from "../lib/home.mjs";
import { THREE_PACKAGES, apply, current, isThree, plan } from "../lib/owned.mjs";

const INIT_HELP = `usage: node pt.mjs init [--figures <dir>] [--stills <dir>] [--mdx <file>] [--repo <dir>] [--json]

Records where this repo keeps its figures, in ${CONFIG_FILE}:

  --figures   the folder figures and the kit live in: beside the site's own
              components when the repo has a React site (${DEFAULTS.figuresDir} otherwise)
  --stills    where README images are written (${DEFAULTS.stillsDir} unless given)
  --mdx       the file that registers MDX components, when figures embed in docs

Run again to change one of them; the others are kept. Exit codes: 0 written, 2 usage.`;

const KIT_HELP = `usage: node pt.mjs kit status|install [--three] [--dry-run] [--repo <dir>] [--json]

  status    is the kit in this repo, and is it the plugin's version?
  install   copy the kit into the repo's figures folder, or bring it up to date.
            A file the repo's people changed is never written over.
  --three   also copy the 3D tier (kit/three/). Its figures need ${THREE_PACKAGES.join(", ")}
            in the site that shows them, so it is copied only when asked for; a
            kit that has it is kept up to date without the flag.

Exit codes: 0 the kit is current (status) or was installed, 1 it is missing or older (status), 2 usage.`;

/** What a repo is told when the 3D tier arrives in it: copying files added no package. */
export const THREE_NOTE = `the 3D tier is in: a figure that uses it needs ${THREE_PACKAGES.join(", ")} where it is shown (stills need nothing: the studio has them)`;

const posix = (p) => p.split(path.sep).join("/");

export async function init(argv, deps = {}) {
  const { cwd = process.cwd() } = deps;
  const opts = parseArgs(argv, { figures: "string", stills: "string", mdx: "string", repo: "string" });
  if (opts.help) { process.stdout.write(INIT_HELP + "\n"); return 0; }
  if (opts._.length) throw new PtError(INIT_HELP);
  const repo = repoRoot(opts.repo, { cwd });
  const before = readConfig(repo);
  const next = {
    version: 1,
    figuresDir: opts.figures ?? before.figuresDir,
    stillsDir: opts.stills ?? before.stillsDir,
    mdxComponents: opts.mdx ?? before.mdxComponents,
  };
  const file = path.join(repo, CONFIG_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  // Read it back through the same checks every other command applies, and put the old one back if it fails them.
  let config;
  try { config = readConfig(repo); } catch (error) {
    if (before.configured) fs.writeFileSync(file, JSON.stringify({ version: 1, figuresDir: before.figuresDir, stillsDir: before.stillsDir, mdxComponents: before.mdxComponents }, null, 2) + "\n");
    else fs.rmSync(file, { force: true });
    throw error;
  }
  emit(config, opts.json, [
    `wrote ${CONFIG_FILE}`,
    `  figures: ${config.figuresDir}/<name>/   (the kit: ${config.figuresDir}/kit/)`,
    `  stills:  ${config.stillsDir}/`,
    `  mdx:     ${config.mdxComponents ?? "not set: figures are imported where they are used"}`,
  ].join("\n"));
  return 0;
}

/** One line per file that is not simply current. */
function report(p, verb) {
  const say = { add: verb.add, update: verb.update, kept: "kept (changed in this repo)" };
  return [
    ...p.files.filter((f) => f.action !== "same").map((f) => `  ${f.rel}: ${say[f.action]}`),
    ...p.gone.map((rel) => `  ${rel}: ${verb.gone}`),
  ];
}

/** Put the kit in a folder, or bring it up to date. Returns the plan that was carried out. */
export function installKit(target, pluginRoot = PLUGIN_ROOT, { dryRun = false, three } = {}) {
  const source = path.join(pluginRoot, "kit");
  // Asked for, the 3D tier goes in; not asked for, a copy keeps what it has.
  const p = plan(source, target, { three: three || undefined });
  if (!dryRun) apply(source, target, p);
  return p;
}

export async function kit(argv, deps = {}) {
  const { cwd = process.cwd(), pluginRoot = PLUGIN_ROOT } = deps;
  const opts = parseArgs(argv, { "dry-run": "bool", three: "bool", repo: "string" });
  if (opts.help) { process.stdout.write(KIT_HELP + "\n"); return 0; }
  const [sub, ...extra] = opts._;
  if (!["status", "install"].includes(sub) || extra.length) throw new PtError(KIT_HELP);
  const at = layout(repoRoot(opts.repo, { cwd }));
  const where = posix(path.relative(at.repo, at.kit));

  if (sub === "status") {
    if (opts.three) throw new PtError(KIT_HELP);
    const p = plan(path.join(pluginRoot, "kit"), at.kit);
    const ok = current(p);
    const head = !p.installed && !fs.existsSync(at.kit)
      ? `the kit is not in this repo: \`kit install\` puts it in ${where}/`
      : ok ? `ok: the kit in ${where}/ is current (${p.version}${p.three ? ", with the 3D tier" : ""})`
        : `the kit in ${where}/ is ${p.installed ?? "an unmarked copy"}; the plugin ships ${p.version}`;
    emit({ ok, dir: at.kit, ...p }, opts.json, [head, ...(ok ? [] : report(p, { add: "missing", update: "older", gone: "no longer shipped" }))].join("\n"));
    return ok ? 0 : 1;
  }

  const p = installKit(at.kit, pluginRoot, { dryRun: opts.dryRun, three: opts.three });
  const changed = p.files.filter((f) => f.action === "add" || f.action === "update").length + p.gone.length;
  const kept = p.files.filter((f) => f.action === "kept").length;
  const arrived = p.files.some((f) => isThree(f.rel) && f.action === "add");
  emit({ ok: true, dir: at.kit, dryRun: opts.dryRun, ...p }, opts.json, [
    opts.dryRun ? `would write the kit (${p.version}) into ${where}/:` : `the kit (${p.version}) is in ${where}/`,
    ...report(p, opts.dryRun ? { add: "would add", update: "would update", gone: "would remove" } : { add: "added", update: "updated", gone: "removed" }),
    ...(changed === 0 && kept === 0 ? ["  nothing to change"] : []),
    ...(arrived && !opts.dryRun ? [THREE_NOTE] : []),
  ].join("\n"));
  return 0;
}
