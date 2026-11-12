// init, new-shot, new-success: scaffold the state folder, add shots, start a
// task's success file. Nothing that exists is ever overwritten: each command
// reports what it found and writes only what is absent.
import fs from "node:fs";
import path from "node:path";
import { emit, pairs, parseArgs, PlError } from "../lib/args.mjs";
import { readImage, writePng } from "../lib/image.mjs";
import { isPng } from "../lib/png.mjs";
import { DEFAULT_CONFIG, DIR_NAME, findRoot, loadConfig, NAME_RX, PASS_SUFFIX, passFile, shotPath, stateDir } from "../lib/project.mjs";
import { shellAdvice, shellOnly } from "../lib/render.mjs";

// Starting points, so a first gate is not tripped by the last digit of a float. They are guesses:
// the calibrate-gate skill replaces them with tolerances measured from this project's own noise.
const DEFAULT_TOLERANCES = {
  "*/frame.ssim": 0.01, "*/frame.deltaE": 0.3, "*/frame.deltaENorm": 0.3, "*/frame.exposureEV": 0.03,
  "*/frame.contrast": 0.02, "*/frame.edgeF1": 0.02, "*/frame.edgeRecall": 0.02, "*/frame.edgePrecision": 0.02,
  "*/frame.detailLog2": 0.05, "*/frame.wb.*": 0.01,
  "*/region.*.ssim": 0.02, "*/region.*.deltaENorm": 0.5, "*/region.*.edgeF1": 0.04, "*/region.*.iou": 0.01,
};
const IGNORE = "# shots are large and runs are throwaway; a project that commits its shots deletes that line\nshots/\nruns/\ndecisions/review.html\n";
const HUB_LINE = "- `perceptual/` - perceptual-loop state: `config.json`, `groups.json`, `baseline.json`, `success/`, and `decisions/` are tracked; `shots/` and `runs/` are gitignored. Changed through the plugin's `pl.mjs`, not by hand.";
const TEMPLATE = path.join(import.meta.dirname, "..", "..", "assets", "success-template.md");

const rel = (root, p) => { const r = path.relative(root, p); return r && !r.startsWith("..") && !path.isAbsolute(r) ? r.split(path.sep).join("/") : p; };

function create(file, text, made, kept, root) {
  if (fs.existsSync(file)) { kept.push(rel(root, file)); return; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  made.push(rel(root, file));
}

/** Name the state folder in .agents/AGENTS.md when a repo keeps that list of what .agents/ holds, so the list stays whole. */
function hubLine(root, dir) {
  const hub = path.join(root, ".agents", "AGENTS.md");
  if (path.resolve(dir) !== path.join(root, DIR_NAME) || !fs.existsSync(hub)) return "none";
  const text = fs.readFileSync(hub, "utf8");
  if (/^- `perceptual\/?`/m.test(text)) return "present";
  const lines = text.replace(/\n*$/, "").split("\n");
  const head = lines.findIndex((l) => /^## Layout\s*$/.test(l));
  if (head === -1) lines.push("", "## Layout", "", HUB_LINE);
  else {
    let at = head + 1;
    for (let i = head + 1; i < lines.length && !/^## /.test(lines[i]); i++) if (/^- `/.test(lines[i])) at = i + 1;
    if (at === head + 1) lines.splice(at, 0, "", HUB_LINE);
    else lines.splice(at, 0, HUB_LINE);
  }
  fs.writeFileSync(hub, lines.join("\n") + "\n");
  return "added";
}

const INIT_HELP = `usage: pl.mjs init [--root DIR] [--reference ID] [--candidate ID]... [--render SOURCE=CMD]... [--json]

Scaffold ${DIR_NAME}/: config.json, groups.json, baseline.json, a .gitignore for shots/, runs/
and decisions/review.html, and the success/ and decisions/ folders. Never overwrites.
When .agents/AGENTS.md exists it gains a Layout line naming perceptual/.

  --root DIR           the project root (default: the git root above here, else here)
  --reference ID       the reference source's id (default: reference)
  --candidate ID       a candidate source's id (repeatable; default: candidate)
  --render SOURCE=CMD  the command that renders a source; {shots}, {shotsDir} and {source} are
                       filled in. It is split into words and started as a program with its
                       arguments, never through a shell: a pipeline or a redirection goes in a
                       script, or in config.json as an array that names the shell.`;

export async function init(argv) {
  const opts = parseArgs(argv, { root: { type: "string" }, reference: { type: "string", default: DEFAULT_CONFIG.reference },
    candidate: { type: "string", multi: true }, render: { type: "string", multi: true }, json: { type: "bool" } }, { positionals: false });
  if (opts.help) { emit(null, false, INIT_HELP); return 0; }
  const root = opts.root ? path.resolve(opts.root) : findRoot();
  const candidates = opts.candidate.length ? opts.candidate : [...DEFAULT_CONFIG.candidates];
  for (const id of [opts.reference, ...candidates]) {
    if (!NAME_RX.test(id) || id.includes(".")) throw new PlError(`a source id is a short word without dots (it names files: <source>.png), got '${id}'`);
  }
  if (candidates.includes(opts.reference)) throw new PlError(`'${opts.reference}' cannot be both the reference and a candidate`);
  const render = Object.fromEntries(pairs(opts.render, "--render"));
  const unknown = Object.keys(render).filter((s) => s !== opts.reference && !candidates.includes(s));
  if (unknown.length) throw new PlError(`--render names a source that is neither the reference nor a candidate: ${unknown.join(", ")}`);
  for (const [source, command] of Object.entries(render)) {
    const why = shellOnly(command);
    if (why) throw new PlError(`--render ${source}: a render command is started without a shell, and this one holds ${why}.\nEither ${shellAdvice(source, command)}`);
  }

  const dir = stateDir(root);
  const config = { ...structuredClone(DEFAULT_CONFIG), reference: opts.reference, candidates, render, regionsFrom: opts.reference };
  const baseline = {
    version: 1, tolerances: DEFAULT_TOLERANCES, minRegionArea: 0.002, spread: {}, entries: {},
    notes: { _tolerances: "the starting tolerances are guesses that keep float dust from failing a gate, not measurements: "
      + "render the smoke group several times and run pl.mjs calibrate --write-tolerances (the calibrate-gate skill) to replace them with this project's noise" },
  };
  const made = [], kept = [];
  const dump = (doc) => JSON.stringify(doc, null, 2) + "\n";
  create(path.join(dir, "config.json"), dump(config), made, kept, root);
  create(path.join(dir, "groups.json"), dump({ smoke: [] }), made, kept, root);
  create(path.join(dir, "baseline.json"), dump(baseline), made, kept, root);
  create(path.join(dir, ".gitignore"), IGNORE, made, kept, root);
  for (const folder of ["success", "decisions"]) {
    const p = path.join(dir, folder);
    if (fs.existsSync(p)) kept.push(rel(root, p) + "/");
    else { fs.mkdirSync(p, { recursive: true }); made.push(rel(root, p) + "/"); }
  }
  const hub = hubLine(root, dir);
  const doc = { root, created: made, exists: kept, hubLine: hub };
  const lines = [...made.map((p) => `created  ${p}`), ...kept.map((p) => `exists   ${p}  (left as it is)`)];
  if (hub === "added") lines.push("added    the perceptual/ line to .agents/AGENTS.md, so the hub names the new folder");
  emit(doc, opts.json, lines.join("\n") || "nothing to do");
  return 0;
}

/** `--meta lap=3` is a number, `--meta wet=true` a boolean, anything else the string it is. */
const metaValue = (text) => { try { return JSON.parse(text); } catch { return text; } };

const SHOT_HELP = `usage: pl.mjs new-shot NAME [--meta K=V]... [--from-image SOURCE[.PASS]=PATH]... [--id NAME=RRGGBB]... [--region NAME=x0,y0,x1,y1]... [--json]

Create a shot folder with its shot.json, and copy pictures in under the contract's names.
Name shots <content>__<place-or-state>__<view>, so groups can select them by pattern.

  --meta K=V                       free metadata for shot.json; groups suggest-smoke reads it
  --from-image SOURCE[.PASS]=PATH  a picture as a pass of a source: reference=a.png, candidate.id=ids.png
                                   (passes: ${Object.keys(PASS_SUFFIX).join(", ")}); not a PNG goes through ffmpeg
  --id NAME=RRGGBB                 name a colour of the id pass (writes ids.json)
  --region NAME=x0,y0,x1,y1        a box region in 0..1, for shots without an id or mask pass`;

export async function newShot(argv) {
  const opts = parseArgs(argv, { meta: { type: "string", multi: true }, "from-image": { type: "string", multi: true },
    id: { type: "string", multi: true }, region: { type: "string", multi: true }, json: { type: "bool" } });
  if (opts.help) { emit(null, false, SHOT_HELP); return 0; }
  if (opts._.length !== 1) throw new PlError("new-shot takes one shot name (see --help)");
  const [name] = opts._;
  if (!NAME_RX.test(name)) throw new PlError(`a shot name is letters, digits, '_', '-' and '.', starting with a letter or digit, got '${name}'`);
  const root = findRoot();
  const config = loadConfig(root, { required: true });
  const dir = shotPath(name, root, config);
  const doc = { name, meta: Object.fromEntries(pairs(opts.meta, "--meta").map(([k, v]) => [k, metaValue(v)])) };
  const regions = {};
  for (const [region, box] of pairs(opts.region, "--region")) {
    const v = box.split(",").map(Number);
    if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) throw new PlError(`--region wants NAME=x0,y0,x1,y1 in 0..1, got '${box}'`);
    const [x0, y0, x1, y1] = v;
    if (!(x0 >= 0 && x0 < x1 && x1 <= 1 && y0 >= 0 && y0 < y1 && y1 <= 1)) throw new PlError(`--region ${region}: the box must lie in 0..1 with x0 < x1 and y0 < y1`);
    regions[region] = v;
  }
  if (Object.keys(regions).length) doc.regions = regions;
  const ids = {};
  for (const [id, hex] of pairs(opts.id, "--id")) {
    if (!/^#?[0-9A-Fa-f]{6}$/.test(hex)) throw new PlError(`--id wants NAME=RRGGBB, got '${hex}'`);
    const h = hex.replace(/^#/, "");
    ids[id] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const copies = pairs(opts.fromImage, "--from-image").map(([target, src]) => {
    const [source, pass = "beauty"] = target.split(".", 2);
    if (!(pass in PASS_SUFFIX)) throw new PlError(`--from-image ${target}: no pass '${pass}' (have: ${Object.keys(PASS_SUFFIX).join(", ")})`);
    if (!fs.existsSync(src)) throw new PlError(`--from-image ${target}: no file ${src}`);
    return [path.resolve(src), passFile(dir, source, pass)];
  });

  const made = [], kept = [];
  create(path.join(dir, "shot.json"), JSON.stringify(doc, null, 2) + "\n", made, kept, root);
  if (Object.keys(ids).length) create(path.join(dir, "ids.json"), JSON.stringify(ids, null, 2) + "\n", made, kept, root);
  for (const [src, dst] of copies) {
    if (fs.existsSync(dst)) { kept.push(rel(root, dst)); continue; }
    const buf = fs.readFileSync(src);
    if (isPng(buf)) fs.copyFileSync(src, dst);
    else writePng(dst, readImage(src)); // the contract's files are PNG: anything else is converted on the way in
    made.push(rel(root, dst));
  }
  const lines = [...made.map((p) => `created  ${p}`), ...kept.map((p) => `exists   ${p}  (left as it is)`)];
  emit({ root, shot: name, created: made, exists: kept }, opts.json, lines.join("\n") || "nothing to do");
  return 0;
}

export async function newSuccess(argv) {
  const opts = parseArgs(argv, { json: { type: "bool" } });
  if (opts.help) {
    emit(null, false, "usage: pl.mjs new-success \"<task in a few words>\" [--json]\n\nCopy the success template to success/<slug>.md; the define-success skill fills it in. Never overwrites.");
    return 0;
  }
  const task = opts._.join(" ").trim();
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new PlError("the task needs at least one letter or digit");
  const root = findRoot();
  const file = path.join(stateDir(root), "success", `${slug}.md`);
  const made = [], kept = [];
  create(file, fs.readFileSync(TEMPLATE, "utf8").replaceAll("{{TASK}}", task), made, kept, root);
  emit({ created: made, exists: kept, path: file }, opts.json, made.length ? `created  ${made[0]}` : `exists   ${kept[0]}  (left as it is)`);
  return 0;
}
