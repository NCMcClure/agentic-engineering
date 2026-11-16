// pt still and pt sheet: pictures of a figure, taken in the studio.
//   still   the hero frame (or any held frame), light and dark, for a README;
//           with --strip the beats in one row, with --gif one loop, moving
//   sheet   every beat side by side, to look a draft over and to show a cold reader
import fs from "node:fs";
import path from "node:path";
import { PtError, emit, parseArgs } from "../lib/args.mjs";
import { ensureDrafts, layout } from "../lib/config.mjs";
import { findFigure } from "../lib/figures.mjs";
import { GIF_MAX_BYTES, GIF_WARN_BYTES, loopFrames, sizeOf } from "../lib/gif.mjs";
import { PLUGIN_ROOT, dataHome, repoRoot } from "../lib/home.mjs";
import { altText, imageSnippet, pictureSnippet, stripAlt } from "../lib/snippet.mjs";
import { capture, ensureServer } from "../lib/studio.mjs";
import { requireStudio } from "./studio.mjs";

const STILL_HELP = `usage: node pt.mjs still <figure> [--strip] [--gif [--dark] [--fps <n>]] [--beat <id>] [--at <0-100>] [--technical] [--width <px>] [--out <dir>] [--from <dir>] [--repo <dir>] [--json]

Takes a figure's still in light and dark, at twice its size, and prints the
Markdown that shows the right one. The frame is the model's hero frame unless
--beat (and --at, a percentage through the beat) says otherwise. Any beat may
be held, the rest beat too: it is where to look at the loop's seam.

With --strip or --gif it writes those instead of the still (give both for both):

  --strip       the beat strip: the told beats in one row, numbered, each held
                at its middle with its caption under it
                (<name>.strip.light.png and <name>.strip.dark.png)
  --gif         one loop of the figure, moving (<name>.gif). Every frame is the
                figure's clock held at that instant, so nothing is recorded.
                Its size is printed; past 5 MB it comes with a warning, and
                past 10 MB, the most GitHub shows, it is not written.
  --dark        with --gif: a dark one too (<name>.dark.gif)
  --fps         with --gif: frames a second, 5 to 30 (15 unless given)

  <figure>      a figure's name, round/draft for a draft, or fixture/<name>
  --technical   the technical captions instead of the plain ones
  --width       the figure's width in CSS px, 520 to 1600: 880 for the still,
                640 for each beat of a strip, 720 for a GIF, unless given
  --out         where to write; a figure's stills go to the repo's stills folder,
                a draft's beside the draft
  --from        the folder of the Markdown file the snippet is for (the repo's root unless given)

Exit codes: 0 every picture written, 1 the figure failed to draw or a GIF was too large to write, 2 usage or environment.`;

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
  const opts = parseArgs(argv, { strip: "bool", gif: "bool", dark: "bool", fps: "int", beat: "string", at: "int", technical: "bool", width: "int", out: "string", from: "string", repo: "string" });
  if (opts.help) { process.stdout.write(STILL_HELP + "\n"); return 0; }
  if (opts._.length !== 1) throw new PtError(STILL_HELP);
  const ctx = prepare(opts, deps, opts._[0]);
  const { at, figure } = ctx;
  // Any beat may be held to look at, the rest beat too: it is where the loop's seam is.
  const beats = figure.model.beats.map((b) => b.id);
  if (opts.beat && !beats.includes(opts.beat)) throw new PtError(`${figure.id} has no beat '${opts.beat}': its beats are ${beats.join(", ")}`);
  if (opts.at !== undefined && (opts.at < 0 || opts.at > 100)) throw new PtError("--at is a percentage through the beat, 0 to 100");
  const width = opts.width ?? 880;
  if (width < 520 || width > 1600) throw new PtError("--width is the figure's width in CSS px, 520 to 1600");

  const name = figure.id.split("/").pop();
  const outDir = opts.out ? path.resolve(opts.out) : figure.kind === "figure" ? at.stills : figure.kind === "draft" ? figure.dir : null;
  if (!outDir) throw new PtError(`${figure.id} is a fixture: say where its stills go with --out`);
  const base = figure.kind === "draft" && !opts.out ? "still" : name;
  if ((opts.dark || opts.fps !== undefined) && !opts.gif) throw new PtError("--dark and --fps go with --gif");
  if (opts.strip || opts.gif) {
    if (opts.beat || opts.at !== undefined) throw new PtError("--beat and --at choose the still's frame: a strip shows every beat at its middle, and a GIF the whole loop");
    return exported(opts, ctx, deps, { outDir, base });
  }
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

/**
 * The README exports that show more than one frame, both made by holding the
 * figure's clock. The strip is a studio page, photographed like any other:
 * the page lays the beats out, so nothing here composes an image. The GIF is
 * the bare frame, photographed once for each instant of one loop.
 */
async function exported(opts, ctx, deps, { outDir, base }) {
  const { at, figure } = ctx;
  const beats = figure.model.beats;
  const told = beats.filter((b) => !b.rest);
  const from = path.resolve(opts.from ?? at.repo);
  const rel = (file) => posix(path.relative(from, file));
  const id = encodeURIComponent(figure.id), audience = opts.technical ? "&audience=technical" : "";
  const shots = [];

  const cell = opts.width ?? 640;
  if (opts.strip) {
    for (const theme of ["light", "dark"]) {
      shots.push({
        url: `/strip?figure=${id}&width=${cell}${audience}&theme=${theme}`,
        selector: "[data-pt-strip]",
        out: path.join(outDir, `${base}.strip.${theme}.png`),
        colorScheme: theme,
        viewport: { width: told.length * (cell + 1) + 49, height: 900 },
      });
    }
  }

  const width = opts.width ?? 720, fps = opts.fps ?? 15;
  let loop = null;
  if (opts.gif) {
    if (fps < 5 || fps > 30) throw new PtError("--fps is frames a second, 5 to 30");
    if (beats.some((b) => !Number.isInteger(b.ms) || b.ms <= 0)) throw new PtError(`${figure.id} has a beat with no length (ms): run \`model check\` on it`);
    loop = loopFrames(beats, fps);
    for (const theme of opts.dark ? ["light", "dark"] : ["light"]) {
      shots.push({
        url: `/frame?figure=${id}&still=1&controls=0&width=${width}${audience}&theme=${theme}`,
        selector: "[data-pt-stage]",
        out: path.join(outDir, theme === "dark" ? `${base}.dark.gif` : `${base}.gif`),
        colorScheme: theme,
        viewport: { width: width + 48, height: 900 },
        // One GIF pixel per CSS pixel: at twice the size a loop weighs about four times as much.
        scale: 1,
        film: { frames: loop.frames, maxBytes: GIF_MAX_BYTES },
      });
    }
  }

  const { status, shots: taken } = await shoot(ctx, shots, deps);
  if (status === 2 || (status !== 0 && !taken.length)) throw new PtError("the camera could not run: is the browser installed? `setup --check` says");
  const result = (shot) => taken.find((t) => t.out === shot.out) ?? { ok: false, errors: ["the camera never got to it"] };
  const errors = failures(taken), warnings = [], lines = [];
  const section = (...text) => { if (lines.length) lines.push(""); lines.push(...text); };

  let strip = null;
  if (opts.strip) {
    const [light, dark] = shots.filter((s) => !s.film);
    if (result(light).ok && result(dark).ok) {
      strip = { light: light.out, dark: dark.out, beats: told.length, width: cell, snippet: pictureSnippet({ light: rel(light.out), dark: rel(dark.out), alt: stripAlt(figure.model) }) };
      section(`wrote ${rel(light.out)}`, `wrote ${rel(dark.out)}`, "", strip.snippet);
    }
  }

  let gif = null;
  if (opts.gif) {
    const seconds = `${(loop.total / 1000).toFixed(1)} s`;
    const lower = `lower --width (now ${width}) or --fps (now ${fps}), or shorten the figure's loop (now ${seconds})`;
    const written = {}, bytes = {}, wrote = [];
    for (const shot of shots.filter((s) => s.film)) {
      const done = result(shot), theme = shot.colorScheme, file = path.basename(shot.out);
      if (done.over) { errors.push(`${file} would be ${sizeOf(done.bytes)}, over GitHub's 10 MB limit for an image, so it was not written: ${lower}`); continue; }
      if (!done.ok) continue;
      written[theme] = shot.out;
      bytes[theme] = done.bytes;
      wrote.push(`wrote ${rel(shot.out)}  (${sizeOf(done.bytes)}: ${loop.frames.length} frames, ${width} px wide, ${fps} a second, one loop of ${seconds})`);
      if (done.bytes > GIF_WARN_BYTES) warnings.push(`${file} is ${sizeOf(done.bytes)}. GitHub shows an image up to 10 MB, but a page loads all of it before it moves: ${lower}`);
    }
    if (written.light) {
      const alt = altText(figure.model);
      const snippet = written.dark ? pictureSnippet({ light: rel(written.light), dark: rel(written.dark), alt, width }) : imageSnippet({ src: rel(written.light), alt, width });
      gif = { ...written, width, fps, frames: loop.frames.length, ms: loop.total, bytes, snippet };
      section(...wrote, ...warnings.map((w) => `warning: ${w}`), "", snippet);
    } else if (wrote.length) section(...wrote);
  }

  const ok = status === 0 && !errors.length;
  if (errors.length) section(...errors.map((e) => `error: ${e}`));
  emit({ ok, figure: figure.id, ...(strip ? { strip } : {}), ...(gif ? { gif } : {}), warnings, errors }, opts.json, lines.join("\n"));
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
