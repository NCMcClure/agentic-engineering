// blind: a before and after, relabelled for a critic who must not know which
// is which. A critic that can read "before" in a file name is not blind. This
// copies the two pictures (and an optional reference) to A, B and R in a new
// folder of random name under the OS temp directory, and decides which letter
// is the earlier picture from the comparison's id, so a re-run labels it the
// same way. The key goes to .agents/perceptual/runs/blind/<id>.json, never into
// the folder the critic is pointed at.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit, parseArgs, PlError } from "../lib/args.mjs";
import { findRoot, NAME_RX, readJson, runsDir, writeJson } from "../lib/project.mjs";

const HELP = `usage: pl.mjs blind --id ID --before FILE --after FILE [--reference FILE] [--json]
       pl.mjs blind reveal ID [--json]

Copy the pictures to A.<ext> and B.<ext> (and R.<ext> for --reference) in a new folder under the
OS temp directory, and write the key (which letter is the before) to .agents/perceptual/runs/blind/<ID>.json.
Hand the critic only the picture paths. --json prints {id, images: {A, B, R?}, aIs, key}: aIs is for
you and the critique workflow, never for the critic. reveal prints the key of one comparison.

ID is the comparison's name (usually the shot): letters, digits, '_', '-', '.'.`;

/** Half of all ids put the earlier picture on A: the first byte of sha256(id), even means A is the before. */
export const aIsBefore = (id) => crypto.createHash("sha256").update(id, "utf8").digest()[0] % 2 === 0;

export const keyFile = (root, id) => path.join(runsDir(root), "blind", `${id}.json`);

function checkId(id) {
  if (!id || !NAME_RX.test(id)) throw new PlError(`--id '${id ?? ""}': one word of letters, digits, '_', '-' and '.'`);
  return id;
}

/** Copy the pictures to neutral names in a fresh temp folder and record the key apart from them. */
export function blind(root, id, { before, after, reference = null }) {
  for (const f of [before, after, reference].filter(Boolean)) if (!fs.statSync(f, { throwIfNoEntry: false })?.isFile()) throw new PlError(`no such picture: ${f}`);
  const view = fs.mkdtempSync(path.join(os.tmpdir(), "pl-blind-"));
  const first = aIsBefore(id);
  const ext = (f) => path.extname(f).toLowerCase() || ".png";
  const images = { A: path.join(view, `A${ext(first ? before : after)}`), B: path.join(view, `B${ext(first ? after : before)}`) };
  fs.copyFileSync(first ? before : after, images.A);
  fs.copyFileSync(first ? after : before, images.B);
  if (reference) { images.R = path.join(view, `R${ext(reference)}`); fs.copyFileSync(reference, images.R); }
  const doc = { id, aIs: first ? "before" : "after", images, from: { before: path.resolve(before), after: path.resolve(after), ...(reference ? { reference: path.resolve(reference) } : {}) },
    made: new Date().toISOString() };
  const key = keyFile(root, id);
  writeJson(key, doc);
  return { id, images, aIs: doc.aIs, key };
}

export async function run(argv) {
  if (argv[0] === "reveal") {
    const opts = parseArgs(argv.slice(1), { json: { type: "bool" } });
    if (opts.help) { emit(null, false, HELP); return 0; }
    const id = checkId(opts._[0]);
    const doc = readJson(keyFile(findRoot(), id));
    if (!doc) throw new PlError(`no key for '${id}' (pl.mjs blind --id ${id} ... writes one)`);
    emit(doc, opts.json, `${id}: A is the ${doc.aIs}, B is the ${doc.aIs === "before" ? "after" : "before"}`);
    return 0;
  }
  const opts = parseArgs(argv, { id: { type: "string" }, before: { type: "string" }, after: { type: "string" }, reference: { type: "string" }, json: { type: "bool" } }, { positionals: false });
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (!opts.before || !opts.after) throw new PlError("blind needs --before FILE and --after FILE (see --help)");
  const doc = blind(findRoot(), checkId(opts.id), { before: opts.before, after: opts.after, reference: opts.reference ?? null });
  const lines = [...Object.entries(doc.images).map(([k, v]) => `${k}: ${v}`), `key (not for the critic): ${doc.key}`];
  emit(doc, opts.json, lines.join("\n"));
  return 0;
}
