// The CLI's plumbing: the error every command exits on, a flag parser, and
// the one place output is printed. Node 22 stdlib only.

/** A usage or environment error: the CLI prints the message and exits with `code` (2 unless said). */
export class PtError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = "PtError";
    this.code = code;
  }
}

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Parse argv against a spec of flags: { name: "bool" | "string" | "int" }.
 * Takes `--name value` and `--name=value`; `--` ends the flags. Returns the
 * options under camelCase keys with every positional word in `_`, or
 * `{ help: true }` when `--help` or `-h` was given. Every command also takes
 * `--json`.
 */
export function parseArgs(argv, flags = {}) {
  const spec = { json: "bool", ...flags };
  const opts = { _: [] };
  for (const [name, type] of Object.entries(spec)) opts[camel(name)] = type === "bool" ? false : undefined;
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (word === "--") { opts._.push(...argv.slice(i + 1)); break; }
    if (word === "--help" || word === "-h") return { help: true };
    if (!word.startsWith("--")) { opts._.push(word); continue; }
    const eq = word.indexOf("=");
    const name = eq === -1 ? word.slice(2) : word.slice(2, eq);
    const type = spec[name];
    if (!type) throw new PtError(`unknown option --${name} (see --help)`);
    if (type === "bool") {
      if (eq !== -1) throw new PtError(`--${name} takes no value`);
      opts[camel(name)] = true;
      continue;
    }
    let value;
    if (eq !== -1) value = word.slice(eq + 1);
    else if (i + 1 < argv.length) value = argv[++i];
    else throw new PtError(`--${name} needs a value`);
    if (type === "int") {
      if (!/^-?\d+$/.test(value)) throw new PtError(`--${name} wants a whole number, got '${value}'`);
      value = Number(value);
    }
    opts[camel(name)] = value;
  }
  return opts;
}

/** Print one JSON document (--json) or the human text. */
export function emit(doc, asJson, text) {
  if (asJson) process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
  else if (text) process.stdout.write(text + "\n");
}
