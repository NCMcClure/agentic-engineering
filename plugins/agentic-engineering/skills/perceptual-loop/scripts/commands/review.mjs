// review: the owner's look questions, answered in one sitting. Agents queue a
// question with its pictures, what differs and why, the options, and a
// recommendation (`add`); `build` writes one self-contained page of the open
// questions; the owner exports decisions.json from it; `apply` turns each
// answer into a ruling file and takes it off the queue.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emit, pairs, parseArgs, PlError } from "../lib/args.mjs";
import { readImage, resize } from "../lib/image.mjs";
import { encodeJpeg } from "../lib/jpeg.mjs";
import { configPath, findRoot, NAME_RX, readJson, stateDir, writeJson } from "../lib/project.mjs";
import { composite } from "../lib/raster.mjs";

const HELP = `usage: pl.mjs review add --id ID --title T --question Q [--context C] --image LABEL=PATH... [--compare]
                          --option ID=LABEL... [--recommend ID] [--default ID] [--evidence LABEL=VALUE]...
                          [--verdict WHO=VERDICT[: NOTE]]... [--replace] [--json]
       pl.mjs review list [--json]
       pl.mjs review build [--out FILE] [--max-width PX] [--quality Q] [--link-images] [--title T] [--json]
       pl.mjs review apply FILE [--json]

The queue is .agents/perceptual/decisions/queue.json. add appends one question: one question the
options answer, the pictures (paths relative to the project root or absolute; --compare marks the
first two as one view, for the page's slider and blink), what differs and why, the options as
actions, and the recommendation. build writes decisions/review.html: every picture laid on grey 128,
scaled down to --max-width (default 1600) and embedded as a JPEG (--quality, default 86), or
referenced in place with --link-images. The page needs no network. Its export is decisions.json:

  { "decidedAt": "<ISO time>", "items": [ { "id": "<id>", "option": "<option id or null>", "note": "<text>" } ] }

apply writes one decisions/<date>-<id>.md per answer (the question, the choice, the note verbatim),
removes the answered questions from the queue, and prints what to do for each.`;

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const TEMPLATE = path.join(import.meta.dirname, "..", "..", "assets", "review-page.html");

export const decisionsDir = (root) => path.join(stateDir(root), "decisions");
const queueFile = (root) => path.join(decisionsDir(root), "queue.json");

export function loadQueue(root) {
  const doc = readJson(queueFile(root), []);
  const items = Array.isArray(doc) ? doc : doc?.items;
  if (!Array.isArray(items)) throw new PlError(`${queueFile(root)} must be a list of questions (see pl.mjs review --help)`);
  return items;
}

const slug = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "item";

/** A picture as a data URI: alpha laid on grey 128, scaled down to maxWidth, JPEG at quality. */
export function embed(file, { maxWidth = 1600, quality = 86, warn = [] } = {}) {
  let img;
  try { img = readImage(file, { alpha: true }); } catch (e) {
    const mime = MIME[path.extname(file).toLowerCase()];
    // a JPEG or WebP with no ffmpeg to read it goes in as it is, at full size
    if (e instanceof PlError && mime && mime !== "image/png") {
      warn.push(`${file}: ${e.message.split(". ")[0]}; embedded as it is, at full size`);
      return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
    }
    warn.push(`unreadable picture ${file}: ${e.message}`);
    return null;
  }
  let flat = composite(img, img.alpha);
  if (flat.width > maxWidth) flat = resize(flat, maxWidth, Math.max(1, Math.round((flat.height * maxWidth) / flat.width)));
  return "data:image/jpeg;base64," + encodeJpeg(flat, { quality }).toString("base64");
}

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Write the page; returns its size and the warnings. */
export function buildPage(root, items, out, { maxWidth = 1600, quality = 86, link = false, title = "Look questions for review", built = new Date() } = {}) {
  const warn = [];
  const pageItems = items.map((item) => ({
    ...Object.fromEntries(["id", "title", "question", "context", "recommended", "defaultOption", "verdicts", "evidence"].map((k) => [k, item[k] ?? null])),
    options: (item.options ?? []).map((o) => ({ id: String(o.id), label: String(o.label ?? o.id) })),
    images: (item.images ?? []).map((im) => {
      // a question queued under the first layout names its pictures in the old folder: they moved with it
      const file = configPath(root, im.path);
      let src = null;
      if (!fs.existsSync(file)) warn.push(`missing picture: ${file}`);
      else if (link) src = path.relative(path.dirname(out), file).split(path.sep).map(encodeURIComponent).join("/");
      else src = embed(file, { maxWidth, quality, warn });
      return { label: String(im.label ?? path.parse(file).name), path: String(im.path), compare: Boolean(im.compare), src };
    }),
  }));
  const storageKey = "pl-review:" + crypto.createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 10);
  // nothing in the data may end the script element it sits in
  const data = JSON.stringify({ storageKey, items: pageItems }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const stamp = built.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const html = fs.readFileSync(TEMPLATE, "utf8").replaceAll("__TITLE__", esc(title)).replace("__BUILT__", stamp).replace("__DATA__", () => data);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return { bytes: Buffer.byteLength(html), warn };
}

function decisionMarkdown(item, option, note, date) {
  const labels = Object.fromEntries((item.options ?? []).map((o) => [String(o.id), String(o.label ?? o.id)]));
  const lines = ["---", `id: ${item.id}`, `option: ${option ?? "null"}`, `date: ${date}`, "---", "", `# ${item.title || item.id}`, "", "## Question", "", String(item.question ?? ""), ""];
  if (item.context) lines.push(String(item.context), "");
  lines.push("## Choice", "");
  if (option) {
    const mark = !item.recommended ? "" : option === item.recommended ? " (the recommendation)" : ` (the recommendation was \`${item.recommended}\`)`;
    lines.push(`\`${option}\`: ${labels[option] ?? "(not one of the options offered)"}${mark}`, "");
  } else lines.push("No option was chosen: the note is the ruling.", "");
  lines.push("Offered: " + Object.entries(labels).map(([k, v]) => `\`${k}\` ${v}`).join("; "), "", "## Note", "", note.trim() ? note : "(none)", "");
  return lines.join("\n");
}

/** Turn an exported decisions.json into ruling files, and shorten the queue by the questions answered. */
export function applyDecisions(root, file) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(doc?.items)) throw new Error("no items list");
  } catch (e) { throw new PlError(`${file}: not a decisions file ({decidedAt, items: [{id, option, note}]}): ${e.message}`); }
  const iso = String(doc.decidedAt ?? "").slice(0, 10);
  const date = /^\d{4}-\d\d-\d\d$/.test(iso) ? iso : new Date().toISOString().slice(0, 10);
  const queue = loadQueue(root);
  const byId = new Map(queue.map((i) => [String(i.id), i]));
  const dir = decisionsDir(root);
  const written = [], unknown = [], lines = [];
  for (const d of doc.items) {
    const item = byId.get(String(d?.id));
    if (!item) { unknown.push(String(d?.id)); continue; }
    const option = d.option ? String(d.option) : null, note = String(d.note ?? "");
    let out = path.join(dir, `${date}-${slug(item.id)}.md`);
    // a second ruling on one question on one day keeps the first
    for (let n = 2; fs.existsSync(out); n++) out = path.join(dir, `${date}-${slug(item.id)}-${n}.md`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(out, decisionMarkdown(item, option, note, date));
    const rel = path.relative(root, out).split(path.sep).join("/");
    const label = (item.options ?? []).find((o) => String(o.id) === option)?.label ?? null;
    let todo;
    if (!option) todo = "no option was chosen: the note is the ruling. Read it; if it does not settle the question, queue a sharper one.";
    else if (label === null) todo = `'${option}' is not one of the options offered: read the note and ask again.`;
    else if (item.recommended && option !== item.recommended) todo = `the owner chose "${label}", not the recommendation (${item.recommended}): change course, and undo work that assumed the recommendation.`;
    else todo = `the owner chose "${label}": carry it out.`;
    if (option && note.trim()) todo += " The note adds instructions: read it.";
    written.push({ id: item.id, option, file: rel, todo });
    lines.push(`- ${item.id}: ${todo}\n    ruling: ${rel} (cite it where the work is reported; a metric does not reopen a ruling)`);
  }
  const done = new Set(written.map((w) => String(w.id)));
  const left = queue.filter((i) => !done.has(String(i.id)));
  if (written.length) writeJson(queueFile(root), left);
  for (const u of unknown) lines.push(`- ${u}: not in the queue (applied already, or from another page): ignored`);
  lines.push(`${written.length} ruling(s) written, ${left.length} question(s) still open${left.length && written.length ? "; pl.mjs review build refreshes the page" : ""}`);
  return { doc: { written, unknown, open: left.map((i) => i.id) }, text: lines.join("\n") };
}

function add(root, opts) {
  if (!opts.id || !NAME_RX.test(opts.id)) throw new PlError(`--id '${opts.id ?? ""}': one word of letters, digits, '_', '-' and '.'`);
  for (const flag of ["title", "question"]) if (!opts[flag]?.trim()) throw new PlError(`review add needs --${flag}`);
  const options = pairs(opts.option, "--option").map(([id, label]) => ({ id, label }));
  const ids = options.map((o) => o.id);
  if (options.length < 2 || new Set(ids).size !== ids.length) throw new PlError("a question needs at least two --option ID=LABEL with different ids");
  for (const [flag, value] of [["--recommend", opts.recommend], ["--default", opts.default]]) {
    if (value && !ids.includes(value)) throw new PlError(`${flag} ${value}: not one of the options (${ids.join(", ")})`);
  }
  const images = pairs(opts.image, "--image").map(([label, p], i) => {
    const full = path.resolve(p);
    if (!fs.statSync(full, { throwIfNoEntry: false })?.isFile()) throw new PlError(`--image ${label}: no file ${full}`);
    const rel = path.relative(root, full);
    const stored = rel.startsWith("..") || path.isAbsolute(rel) ? full : rel.split(path.sep).join("/");
    return { label, path: stored, ...(opts.compare && i < 2 ? { compare: true } : {}) };
  });
  if (opts.compare && images.length < 2) throw new PlError("--compare needs two --image");
  const item = { id: opts.id, title: opts.title, question: opts.question, ...(opts.context ? { context: opts.context } : {}), images, options,
    ...(opts.recommend ? { recommended: opts.recommend } : {}), ...(opts.default ? { defaultOption: opts.default } : {}) };
  if (opts.evidence.length) item.evidence = pairs(opts.evidence, "--evidence").map(([label, value]) => ({ label, value }));
  if (opts.verdict.length) {
    item.verdicts = pairs(opts.verdict, "--verdict").map(([by, v]) => {
      const cut = v.indexOf(":");
      return cut === -1 ? { by, verdict: v.trim() } : { by, verdict: v.slice(0, cut).trim(), note: v.slice(cut + 1).trim() };
    });
  }
  const queue = loadQueue(root);
  if (queue.some((i) => i.id === opts.id) && !opts.replace) throw new PlError(`'${opts.id}' is queued already: --replace changes it`);
  const next = [...queue.filter((i) => i.id !== opts.id), item];
  writeJson(queueFile(root), next);
  return { doc: { queued: opts.id, open: next.length }, text: `queued '${opts.id}' (${next.length} open); pl.mjs review build writes the page` };
}

export async function run(argv) {
  const [verb, ...rest] = argv;
  if (!verb) throw new PlError(HELP);
  if (verb === "--help" || verb === "-h") { emit(null, false, HELP); return 0; }
  const flags = {
    add: { id: { type: "string" }, title: { type: "string" }, question: { type: "string" }, context: { type: "string" }, image: { type: "string", multi: true },
      compare: { type: "bool" }, option: { type: "string", multi: true }, recommend: { type: "string" }, default: { type: "string" },
      evidence: { type: "string", multi: true }, verdict: { type: "string", multi: true }, replace: { type: "bool" }, json: { type: "bool" } },
    list: { json: { type: "bool" } },
    build: { out: { type: "string" }, "max-width": { type: "int", default: 1600 }, quality: { type: "int", default: 86 }, "link-images": { type: "bool" },
      title: { type: "string", default: "Look questions for review" }, json: { type: "bool" } },
    apply: { json: { type: "bool" } },
  }[verb];
  if (!flags) throw new PlError(`unknown review command '${verb}' (add, list, build, apply)`);
  const opts = parseArgs(rest, flags, { positionals: verb === "apply" });
  if (opts.help) { emit(null, false, HELP); return 0; }
  const root = findRoot();
  let result;
  if (verb === "add") result = add(root, opts);
  else if (verb === "list") {
    const queue = loadQueue(root);
    result = { doc: { items: queue }, text: queue.map((i) => `${i.id}: ${i.question}`).join("\n") || "(the queue is empty)" };
  } else if (verb === "apply") {
    if (opts._.length !== 1) throw new PlError("review apply takes the decisions.json the page exported");
    result = applyDecisions(root, path.resolve(opts._[0]));
  } else {
    if (opts.maxWidth < 64) throw new PlError("--max-width wants 64 or more");
    if (opts.quality < 1 || opts.quality > 100) throw new PlError("--quality wants 1 to 100");
    const queue = loadQueue(root);
    const bad = queue.find((i) => !i?.id || !Array.isArray(i.options) || !i.options.length);
    if (bad) throw new PlError(`a queued question has no id or no options: ${JSON.stringify(bad).slice(0, 120)}`);
    const out = opts.out ? path.resolve(opts.out) : path.join(decisionsDir(root), "review.html");
    const { bytes, warn } = buildPage(root, queue, out, { maxWidth: opts.maxWidth, quality: opts.quality, link: opts.linkImages, title: opts.title });
    for (const w of warn) process.stderr.write(`warning: ${w}\n`);
    result = { doc: { page: out, items: queue.length, bytes, warnings: warn },
      text: `${out}: ${queue.length} question(s), ${Math.round(bytes / 1024)} KB. Open it in a browser, export the decisions, then: pl.mjs review apply decisions.json` };
  }
  emit(result.doc, opts.json, result.text);
  return 0;
}
