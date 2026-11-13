// pt still and pt sheet: pictures of a figure, taken in the studio.
//   still   the hero frame (or any held frame), light and dark, for a README
//   sheet   every beat side by side, to look a draft over and to show a cold reader
import fs from "node:fs";
import path from "node:path";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { ensureDrafts, layout } from "../lib/config.mjs";
import { findFigure } from "../lib/figures.mjs";
import { PLUGIN_ROOT, dataHome, repoRoot } from "../lib/home.mjs";
import { altText, pictureSnippet } from "../lib/snippet.mjs";
import { capture, ensureServer } from "../lib/studio.mjs";
import { requireStudio } from "./studio.mjs";

const STILL_HELP = `usage: node pt.mjs still <figure> [--beat <id>] [--at <0-100>] [--technical] [--width <px>] [--out <dir>] [--from <dir>] [--repo <dir>] [--json]

Takes a figure's still in light and dark, at twice its size, and prints the
Markdown that shows the right one. The frame is the model's hero frame unless
--beat (and --at, a percentage through the beat) says otherwise.

  <figure>      a figure's name, round/draft for a draft, or fixture/<name>
  --technical   the technical captions instead of the plain ones
  --width       the figure's width in CSS px (880 unless given)
  --out         where to write; a figure's stills go to the repo's stills folder,
                a draft's beside the draft
  --from        the folder of the Markdown file the snippet is for (the repo's root unless given)

Exit codes: 0 both stills written, 1 the figure failed to draw, 2 usage or environment.`;

const SHEET_HELP = `usage: node pt.mjs sheet <figure> [--dark] [--technical] [--out <dir>] [--repo <dir>] [--json]

Lays a figure's beats side by side, each held at its middle, and writes two
pictures: sheet.png with every caption, and sheet.nocap.png with the captions
and the claim left off, which is the one to show a reader who must not be told
what the figure means. What the page complained about goes to checks.json.

Exit codes: 0 both sheets written and nothing complained, 1 a figure failed to draw or logged an error, 2 usage or environment.`;

const posix = (p) => p.split(path.sep).join("/");

/** Everything a picture command needs before it takes one. */
function prepare(opts, deps, wanted) {
  const { env = process.env, cwd = process.cwd(), pluginRoot = PLUGIN_ROOT } = deps;
  const home = dataHome(env);
  const at = layout(repoRoot(opts.repo, { cwd }));
  const studio = requireStudio(home, pluginRoot, { browser: true });
  const figure = findFigure(at, wanted, { fixtures: path.join(studio.app, "fixtures") });
  if (!figure.model) throw new PtError(`${figure.id} has no readable model.json: run \`model check\` on it`);
  ensureDrafts(at.repo);
  return { env, at, studio, figure };
}

/** Run the camera against this repo's studio, starting one for the job if none is running. */
async function shoot({ env, at, studio }, shots, deps) {
  const server = await (deps.server ?? ensureServer)({ at, studio, env, fetch: deps.fetch });
  try { return await (deps.capture ?? capture)({ studio, port: server.port, shots, env, node: deps.node }); } finally { await server.stop(); }
}

const failures = (taken) => taken.flatMap((s) => s.errors.map((e) => `${path.basename(s.out)}: ${e}`));

/** `deps` stands in for the outside world in tests: env, cwd, pluginRoot, server, capture. */
export async function still(argv, deps = {}) {
  const opts = parseArgs(argv, { beat: "string", at: "int", technical: "bool", width: "int", out: "string", from: "string", repo: "string" });
  if (opts.help) { process.stdout.write(STILL_HELP + "\n"); return 0; }
  if (opts._.length !== 1) throw new PtError(STILL_HELP);
  const ctx = prepare(opts, deps, opts._[0]);
  const { at, figure } = ctx;
  const beats = figure.model.beats.filter((b) => !b.rest).map((b) => b.id);
  if (opts.beat && !beats.includes(opts.beat)) throw new PtError(`${figure.id} has no beat '${opts.beat}': its beats are ${beats.join(", ")}`);
  if (opts.at !== undefined && (opts.at < 0 || opts.at > 100)) throw new PtError("--at is a percentage through the beat, 0 to 100");
  const width = opts.width ?? 880;
  if (width < 520 || width > 1600) throw new PtError("--width is the figure's width in CSS px, 520 to 1600");

  const name = figure.id.split("/").pop();
  const outDir = opts.out ? path.resolve(opts.out) : figure.kind === "figure" ? at.stills : figure.kind === "draft" ? figure.dir : null;
  if (!outDir) throw new PtError(`${figure.id} is a fixture: say where its stills go with --out`);
  const base = figure.kind === "draft" && !opts.out ? "still" : name;
  const query = [`figure=${encodeURIComponent(figure.id)}`, "still=1", "controls=0", `width=${width}`,
    ...(opts.beat ? [`beat=${encodeURIComponent(opts.beat)}`] : []),
    ...(opts.at !== undefined ? [`at=${opts.at / 100}`] : []),
    ...(opts.technical ? ["audience=technical"] : [])].join("&");
  const shots = ["light", "dark"].map((theme) => ({
    url: `/frame?${query}&theme=${theme}`,
    selector: "[data-pt-stage]",
    out: path.join(outDir, `${base}.${theme}.png`),
    colorScheme: theme,
    viewport: { width: width + 48, height: 900 },
  }));

  const { status, shots: taken } = await shoot(ctx, shots, deps);
  const problems = failures(taken);
  if (status === 2 || (status !== 0 && !taken.length)) throw new PtError("the camera could not run: is the browser installed? `setup --check` says");
  const from = path.resolve(opts.from ?? at.repo);
  const rel = (file) => posix(path.relative(from, file));
  const [light, dark] = shots.map((s) => s.out);
  const snippet = pictureSnippet({ light: rel(light), dark: rel(dark), alt: altText(figure.model), width });
  const ok = status === 0 && !problems.length;
  emit({ ok, figure: figure.id, light, dark, width, snippet, errors: problems }, opts.json, ok
    ? [`wrote ${rel(light)}`, `wrote ${rel(dark)}`, "", snippet].join("\n")
    : problems.map((p) => `error: ${p}`).join("\n"));
  return ok ? 0 : 1;
}

export async function sheet(argv, deps = {}) {
  const opts = parseArgs(argv, { dark: "bool", technical: "bool", out: "string", repo: "string" });
  if (opts.help) { process.stdout.write(SHEET_HELP + "\n"); return 0; }
  if (opts._.length !== 1) throw new PtError(SHEET_HELP);
  const ctx = prepare(opts, deps, opts._[0]);
  const { at, figure } = ctx;
  const outDir = opts.out ? path.resolve(opts.out) : figure.kind === "draft" ? figure.dir : path.join(at.drafts, "sheets", figure.id.split("/").pop());
  const theme = opts.dark ? "dark" : "light";
  const told = figure.model.beats.filter((b) => !b.rest).length;
  const columns = told > 4 ? 3 : 2, cell = 560;
  const query = `figure=${encodeURIComponent(figure.id)}&theme=${theme}&width=${cell}&columns=${columns}${opts.technical ? "&audience=technical" : ""}`;
  const shots = [["sheet.png", 1], ["sheet.nocap.png", 0]].map(([file, captions]) => ({
    url: `/sheet?${query}&captions=${captions}`,
    selector: "[data-pt-sheet]",
    out: path.join(outDir, file),
    colorScheme: theme,
    viewport: { width: columns * (cell + 24) + 48, height: 900 },
  }));

  const { status, shots: taken } = await shoot(ctx, shots, deps);
  if (status === 2 || (status !== 0 && !taken.length)) throw new PtError("the camera could not run: is the browser installed? `setup --check` says");
  const errors = failures(taken);
  const complaints = [...new Set(taken.flatMap((s) => s.console))];
  const ok = status === 0 && !errors.length && !complaints.length;
  const checks = { figure: figure.id, beats: told, errors, console: complaints };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "checks.json"), JSON.stringify(checks, null, 2) + "\n");
  const rel = (file) => posix(path.relative(at.repo, file));
  emit({ ok, ...checks, sheet: shots[0].out, nocap: shots[1].out }, opts.json, [
    ...errors.map((e) => `error: ${e}`),
    ...complaints.map((c) => `console: ${c}`),
    ...(errors.length ? [] : [`wrote ${rel(shots[0].out)}`, `wrote ${rel(shots[1].out)}  (no captions: the one for a cold reader)`]),
  ].join("\n"));
  return ok ? 0 : 1;
}
