// The CLI's plumbing: the error every command exits 2 on, a flag parser, and
// the one place output is printed. Node 22 stdlib only.

/** A usage or environment error: the CLI prints the message and exits with `code` (2 unless said). */
export class PlError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = "PlError";
    this.code = code;
  }
}

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function convert(name, type, raw) {
  if (type === "int") {
    if (!/^-?\d+$/.test(raw)) throw new PlError(`--${name} wants a whole number, got '${raw}'`);
    return Number(raw);
  }
  if (type === "float") {
    const v = Number(raw);
    if (raw === "" || !Number.isFinite(v)) throw new PlError(`--${name} wants a number, got '${raw}'`);
    return v;
  }
  return raw;
}

/**
 * Parse argv against a spec of flags: { name: { type: "bool"|"string"|"int"|"float", multi?, default? } }.
 * Takes `--name value` and `--name=value`; `--` ends the flags. Returns the options under camelCase keys,
 * with every positional word in `_`, or `{ help: true }` when `--help` or `-h` was given.
 */
export function parseArgs(argv, flags, { positionals = true } = {}) {
  const opts = { _: [] };
  for (const [name, spec] of Object.entries(flags)) {
    opts[camel(name)] = spec.multi ? [...(spec.default ?? [])] : spec.default ?? (spec.type === "bool" ? false : undefined);
  }
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (word === "--") { opts._.push(...argv.slice(i + 1)); break; }
    if (word === "--help" || word === "-h") return { help: true };
    if (!word.startsWith("--") || word === "--") {
      if (!positionals) throw new PlError(`unexpected argument '${word}' (see --help)`);
      opts._.push(word);
      continue;
    }
    const eq = word.indexOf("=");
    const name = eq === -1 ? word.slice(2) : word.slice(2, eq);
    const spec = flags[name];
    if (!spec) throw new PlError(`unknown option --${name} (see --help)`);
    let value;
    if (spec.type === "bool") {
      if (eq !== -1) throw new PlError(`--${name} takes no value`);
      value = true;
    } else {
      if (eq !== -1) value = word.slice(eq + 1);
      else if (i + 1 < argv.length) value = argv[++i];
      else throw new PlError(`--${name} needs a value`);
      value = convert(name, spec.type, value);
    }
    const key = camel(name);
    if (spec.multi) opts[key].push(value);
    else opts[key] = value;
  }
  return opts;
}

/** Print one JSON document (--json) or the human text. */
export function emit(doc, asJson, text) {
  if (asJson) process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
  else if (text !== undefined && text !== null && text !== "") process.stdout.write(text + "\n");
}

/** `KEY=VALUE` words into pairs; anything else is a usage error naming the flag. */
export function pairs(items, flag) {
  return items.map((item) => {
    const at = item.indexOf("=");
    if (at <= 0 || at === item.length - 1) throw new PlError(`${flag} wants KEY=VALUE, got '${item}'`);
    return [item.slice(0, at), item.slice(at + 1)];
  });
}
