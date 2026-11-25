// pt model check <file>: is this model.json fit to draw from?
import fs from "node:fs";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { checkModel } from "../lib/model-check.mjs";

const HELP = `usage: node pt.mjs model check <model.json> [--repo <dir>] [--require-source] [--json]

Checks a figure's model: ids are unique and resolve, every entity and flow is
used by a beat, captions fit, the loop is short enough to watch, and the hero
frame names a real beat.

  --repo <dir>        also check that each source (path:line) exists there
  --require-source    a figure drawn from code: every entity and flow names its source

Exit codes: 0 the model is fit to draw from, 1 it is not, 2 usage.`;

/** Read and parse a model file, or say why not. */
export function readModel(file) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { throw new PtError(`cannot read ${file}`); }
  try { return JSON.parse(raw); } catch (e) { throw new PtError(`${file} is not JSON: ${e.message}`, 1); }
}

export async function run(argv) {
  const opts = parseArgs(argv, { repo: "string", "require-source": "bool" });
  if (opts.help) { process.stdout.write(HELP + "\n"); return 0; }
  const [sub, file, ...extra] = opts._;
  if (sub !== "check" || !file || extra.length) throw new PtError(HELP);
  if (opts.requireSource && !opts.repo) opts.repo = process.cwd();
  const model = readModel(file);
  const { errors, warnings } = checkModel(model, { repo: opts.repo ?? null, requireSource: opts.requireSource });
  const ok = errors.length === 0;
  const lines = [
    ...errors.map((e) => `error: ${e}`),
    ...warnings.map((w) => `warning: ${w}`),
    ok ? `ok: ${file} (${model.entities.length} entities, ${model.flows.length} flows, ${model.beats.length - 1} beats)` : `${file}: ${errors.length} error${errors.length === 1 ? "" : "s"}`,
  ];
  emit({ ok, file, errors, warnings }, opts.json, lines.join("\n"));
  return ok ? 0 : 1;
}
