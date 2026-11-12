// The render command a project names in config.json, as the program and
// arguments that get started. It is never handed to a shell: a shot name, a
// folder with a space in it, or a stray `;` in the config cannot become a
// second command. A string is split into words the way a shell would split
// them, quotes respected, and nothing else of a shell is honoured; a project
// that wants a shell says which one, as an argv array (["bash", "-c", "..."]).
import { shellWords } from "../../hooks/shell-words.mjs";
import { PlError } from "./args.mjs";
import { NAME_RX } from "./project.mjs";

// What only a shell can do, by the word that asks for it.
const REDIRECT = /^(?:\d*>>?|\d*<|&>)/;
const EXPANSION = /\$[({A-Za-z_]|`/;
const ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/**
 * Why a render string cannot run as one program and its arguments, or "" when it can.
 * @param {string} template
 * @returns {string}
 */
export function shellOnly(template) {
  const segments = shellWords(template);
  if (segments.length > 1) return "more than one command (&&, ||, ;, | or a line break)";
  const words = segments[0] ?? [];
  const redirect = words.find((w) => REDIRECT.test(w));
  if (redirect) return `a redirection (${redirect})`;
  const expansion = words.find((w) => EXPANSION.test(w));
  if (expansion) return `a shell expansion (${expansion})`;
  return "";
}

/** The fix for a render string that needs a shell, in the words of the config. */
export const shellAdvice = (source, template) =>
  `put that line in a script and name the script, or name the shell yourself as an array: "render": { "${source}": ["bash", "-c", ${JSON.stringify(template)}] }`;

/**
 * The render command of a source for these shots: `argv` to start, `env` to add to the
 * environment (the leading NAME=value words of a string), and `text` to show.
 * `{shots}` as a whole argument becomes one argument per shot; inside an argument it is
 * the names separated by spaces. `{shotsDir}` and `{source}` are filled in where they stand.
 */
export function renderCommand(config, source, shots, dir) {
  const template = config.render?.[source];
  if (!template || (Array.isArray(template) && !template.length)) {
    throw new PlError(`config.json has no render command for '${source}': add render.${source}, or pass --skip-render to compare what is there`);
  }
  const bad = shots.filter((s) => !NAME_RX.test(s));
  if (bad.length) throw new PlError(`refusing to render shot '${bad[0]}': a shot name is one word of letters, digits, '_', '-' and '.'; rename the shot folder`);
  let words, env = {};
  if (typeof template === "string") {
    const why = shellOnly(template);
    if (why) throw new PlError(`render.${source} is started as a program with its arguments, never through a shell, and it holds ${why}.\nEither ${shellAdvice(source, template)}`);
    // the leading NAME=value words (after an optional `env`) are the program's environment, as in a shell
    const all = shellWords(template)[0] ?? [];
    let k = all[0] === "env" ? 1 : 0;
    for (; k < all.length && ASSIGN.test(all[k]); k++) { const m = ASSIGN.exec(all[k]); env[m[1]] = m[2]; }
    words = all.slice(k);
  } else if (Array.isArray(template) && template.every((a) => typeof a === "string")) words = template;
  else throw new PlError(`render.${source} must be a string or an array of strings`);
  if (!words.length) throw new PlError(`render.${source} names no program to start`);
  const fill = (s) => s.replaceAll("{shots}", shots.join(" ")).replaceAll("{shotsDir}", dir).replaceAll("{source}", source);
  const argv = words.flatMap((a) => (a === "{shots}" ? shots : [fill(a)]));
  for (const k of Object.keys(env)) env[k] = fill(env[k]);
  return { argv, env, text: describe(argv, env) };
}

/** One word as a person would type it: plain words as they are, anything else quoted. */
const shown = (w) => (/^[A-Za-z0-9_./:@%+=,\\-]+$/.test(w) ? w : `'${w.replaceAll("'", "'\\''")}'`);

export function describe(argv, env = {}) {
  return [...Object.entries(env).map(([k, v]) => `${k}=${shown(v)}`), ...argv.map(shown)].join(" ");
}

/**
 * What to say when the program could not be started. On Windows a batch file (npm, npx, yarn and other
 * .cmd shims) cannot be started without a shell, so the message names the one-word fix.
 */
export function startFailure(source, argv, error, platform = process.platform) {
  const base = `the render of '${source}' could not start: ${error.message}`;
  if (platform !== "win32" || !["ENOENT", "EINVAL"].includes(error.code)) return base;
  return `${base}\nOn Windows a .cmd or .bat program (npm, npx, yarn) is not started without a shell. Name the shell in config.json `
    + `by putting "cmd", "/c" in front, as an array: "render": { "${source}": ["cmd", "/c", "${argv[0]}", ...] }.`;
}
