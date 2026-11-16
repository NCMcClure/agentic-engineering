// semantic, keypoints: the two measurements that need trained models. Node has
// none, so each is an optional Python script beside this CLI (semantic.py:
// CLIP and LPIPS through torch; keypoints.py: body, hand and face landmarks
// through mediapipe). These commands find the script and a Python to run it,
// hand the arguments over unchanged, and return its exit code. Nothing else in
// the CLI needs either file: without the script or without Python the command
// exits 2 and says what is missing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PlError } from "../lib/args.mjs";

const EXTRAS = {
  semantic: {
    what: "how alike two pictures are, or a picture and a description, when no pixel lines up (CLIP cosine, LPIPS)",
    needs: "torch, torchvision, open_clip_torch, lpips, numpy and Pillow, and on first use the model weights (about 0.8 GB into the libraries' own caches)",
  },
  keypoints: {
    what: "where a character's joints are, and whether two pictures or clips agree about them (MediaPipe landmarks)",
    needs: "mediapipe, numpy and Pillow, and on first use a landmark model of a few MB into the user's cache",
  },
};

/** The first file named `name` (with a Windows extension where there is one) on PATH, or null. */
function onPath(name, env = process.env) {
  const exts = process.platform === "win32" ? [".exe", ""] : [""];
  for (const dir of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

/**
 * How to start a Python script: PL_PYTHON when set, else `uv run --no-project`, which installs the
 * packages the script's header lists into uv's own cache, else python3 or python as they are.
 * @returns {{argv: string[], how: string} | null}
 */
export function pythonRunner(env = process.env) {
  if (env.PL_PYTHON) return { argv: [env.PL_PYTHON], how: "PL_PYTHON" };
  const uv = onPath("uv", env);
  if (uv) return { argv: [uv, "run", "--no-project"], how: "uv run --no-project (uv installs what the script lists)" };
  for (const name of ["python3", "python"]) {
    const exe = onPath(name, env);
    if (exe) return { argv: [exe, "-B"], how: `${name} (the packages must already be installed for it)` };
  }
  return null;
}

function help(name, script, runner) {
  const { what, needs } = EXTRAS[name];
  return `usage: pl.mjs ${name} <arguments of ${name}.py>

${name}: ${what}.
An optional extra: it runs ${path.basename(script)}, a Python script, and needs Python 3.10 or later with ${needs}.

  script   ${fs.existsSync(script) ? script : `${script}  (not in this install)`}
  runs as  ${runner ? runner.how : "nothing: neither uv nor python3 nor python is on PATH, and PL_PYTHON is not set"}

The script's own options: pl.mjs ${name} -h, or pl.mjs ${name} <subcommand> -h.`;
}

/**
 * Run one extra with these arguments; returns its exit code. `dir` is where the script is looked for and
 * `env` where Python is, so both can be pointed elsewhere.
 */
export function runExtra(name, argv, { dir = path.join(import.meta.dirname, ".."), env = process.env, stdio = "inherit" } = {}) {
  const script = path.join(dir, `${name}.py`);
  const runner = pythonRunner(env);
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    process.stdout.write(help(name, script, runner) + "\n");
    return 0;
  }
  if (!fs.existsSync(script)) {
    throw new PlError(`pl.mjs ${name} needs ${script}, and this install does not have it. It is an optional extra: every other command works without it.`);
  }
  if (!runner) {
    throw new PlError(`pl.mjs ${name} runs a Python script, and no Python was found: neither uv nor python3 nor python is on PATH.\n`
      + `Install uv (it fetches ${EXTRAS[name].needs.split(",")[0]} and the rest on first use) or Python 3.10+ with the packages, or point PL_PYTHON at an interpreter that has them. Every other command works without it.`);
  }
  const r = spawnSync(runner.argv[0], [...runner.argv.slice(1), script, ...argv], { stdio, shell: false, env });
  if (r.error) throw new PlError(`pl.mjs ${name}: ${runner.argv[0]} could not start: ${r.error.message}`);
  return r.status ?? 2;
}

export const semantic = async (argv) => runExtra("semantic", argv);
export const keypoints = async (argv) => runExtra("keypoints", argv);
