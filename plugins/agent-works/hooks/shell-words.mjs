// A shell command read the way a shell reads it, for a hook that has to judge a
// command before it runs. Pure functions over strings: no I/O, no imports.
//
// One reading serves bash and PowerShell, since the hook is handed the text and
// not the shell. A quoted string, a here-document, a PowerShell here-string and
// a `$(...)` each stay one word (or none), whatever `;`, `|` or line breaks they
// hold, so a word of a commit message never passes for a command or a path.
//
// What the reading leaves alone, on purpose:
// - A backslash is kept as written, except before a line break: it is a path
//   separator on Windows as often as an escape.
// - The text inside `$(...)` is one opaque word; it is not read as commands.
// - A backtick is PowerShell's escape and line continuation only: a bash
//   `...` substitution is not grouped, so its words are read as words.
// - A here-document is cut only when its delimiter is a plain name (`<<EOF`,
//   `<<-'END'`); with any other delimiter its body is read as commands.

/**
 * One command of a command line.
 * @typedef {object} Segment
 * @property {string[]} words  Its words, unquoted, leading `VAR=value` and brackets included.
 * @property {string} op  The operator that ends it: `&&`, `||`, `;`, `|`, `&`, `"\n"`, or `""` at the end of the line.
 */

/** Words that may stand before a command without being the command. Exact match, case and all. */
export const LEADERS = Object.freeze(["&", "!", "env", "export", "time", "nohup", "call"]);

const POSIX_FLAGS = Object.freeze(["-c", "-lc", "-ic"]);
const WINDOWS_FLAGS = Object.freeze(["-command", "-c", "/c"]);

/** Shells that take a command line as an argument: base name -> the flags (lower case) that introduce the line. */
export const SHELLS = Object.freeze({
  bash: POSIX_FLAGS, sh: POSIX_FLAGS, zsh: POSIX_FLAGS, dash: POSIX_FLAGS,
  powershell: WINDOWS_FLAGS, pwsh: WINDOWS_FLAGS, cmd: WINDOWS_FLAGS,
});

// A variable or delimiter name: an ASCII letter or underscore, then letters and digits of any script.
const NAME = "[A-Za-z_][\\p{L}\\p{N}_]*";
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HEREDOC = new RegExp(`^<<-?[ \\t]*(["']?)(${NAME})\\1`, "u");
const ENV_NAME = new RegExp(`^\\$env:(${NAME})$`, "iu");
const ENV_SET = new RegExp(`^\\$env:(${NAME})=(.*)$`, "isu");
const VAR_SET = new RegExp(`^(${NAME})=(.*)$`, "su");
const SETTERS = ["export", "set", "env"];
const MAX_NESTING = 50; // `bash -c "bash -c ..."` levels read before a line is left as it is

// The folder-changing commands, lower case; the PUSH ones remember where they left.
const CD = ["cd", "chdir", "set-location", "sl"];
const PUSH = ["pushd", "push-location"];
const POP = ["popd", "pop-location"];
// Where an absolute path starts: a drive, a network share, the root.
const ROOT = /^(?:[A-Za-z]:\/?|\/\/|\/)/;
// Options of git itself (before the sub-command) whose value is the next word.
const GIT_VALUE_OPTS = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--attr-source", "--config-env"];

/** The command's segments with the operator after each: the one scan every export below is built on. */
function lex(command) {
  let c = command; // here-document bodies are cut out of this as the scan meets them
  const segments = [];
  let words = [];
  let cur = null; // null: no word is open. "": an empty quoted word is.

  const add = (text) => { cur = (cur ?? "") + text; };
  const endWord = () => {
    if (cur !== null) words.push(cur);
    cur = null;
  };
  const endSegment = (op) => {
    endWord();
    if (words.length) segments.push({ words, op });
    words = [];
  };

  // At "<<WORD" (and not "<<<", which feeds one word and has no body): takes the operator and the body
  // out of the command. The rest of the operator's line stays; a body with no end runs to the end.
  const cutHeredoc = (i) => {
    if (c[i] !== "<" || c[i + 1] !== "<" || c[i + 2] === "<" || c[i - 1] === "<") return false;
    const m = HEREDOC.exec(c.slice(i, i + 80));
    if (!m) return false;
    const lineEnd = c.indexOf("\n", i);
    let after = "";
    if (lineEnd >= 0) {
      const end = new RegExp(`\\n[ \\t]*${m[2]}[ \\t]*\\r?(?=\\n|$)`, "gu");
      end.lastIndex = lineEnd;
      const e = end.exec(c);
      if (e) after = c.slice(e.index + e[0].length);
    }
    c = c.slice(0, i) + c.slice(i + m[0].length, lineEnd >= 0 ? lineEnd : c.length) + after;
    return true;
  };

  // At the "(" of "$(": the index after its ")".
  const substEnd = (i) => {
    let depth = 0;
    let j = i;
    while (j < c.length) {
      const ch = c[j];
      if (ch === "'") {
        const e = c.indexOf("'", j + 1);
        j = e < 0 ? c.length : e + 1;
      } else if (ch === '"') {
        j = quoteEnd(j);
      } else if (cutHeredoc(j)) {
        continue;
      } else {
        if (ch === "(") depth += 1;
        else if (ch === ")" && --depth === 0) return j + 1;
        j += 1;
      }
    }
    return c.length;
  };

  // At an opening double quote: the index after the closing one (one past the end when it never closes).
  const quoteEnd = (i) => {
    let j = i + 1;
    while (j < c.length) {
      const ch = c[j];
      if (ch === "\\" || (ch === "`" && c[j + 1] === '"')) j += 2;
      else if (ch === "$" && c[j + 1] === "(") j = substEnd(j + 1);
      else if (ch === '"') return j + 1;
      else j += 1;
    }
    return c.length + 1;
  };

  // A lone "&" after a command sends it to the background and starts the next one. Before any word it is
  // PowerShell's call operator, and beside a redirection (2>&1, &>out) or a backslash it is part of a word.
  const backgrounds = (i) => (cur !== null || words.length > 0) && c[i + 1] !== ">" && !["<", ">", "\\"].includes(c[i - 1]);

  let i = 0;
  while (i < c.length) {
    const ch = c[i];
    const d = c[i + 1] ?? "";
    if (ch === "\n" || ch === ";") {
      endSegment(ch);
      i += 1;
    } else if ((ch === "&" || ch === "|") && d === ch) {
      endSegment(ch + d);
      i += 2;
    } else if (ch === "|" || (ch === "&" && backgrounds(i))) {
      endSegment(ch);
      i += 1;
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      endWord();
      i += 1;
    } else if ((ch === "\\" || ch === "`") && (d === "\n" || d === "\r")) { // a continued line
      i += d === "\r" ? 3 : 2;
    } else if (ch === "@" && (d === "'" || d === '"') && /^\r?\n/.test(c.slice(i + 2, i + 4))) { // PowerShell here-string
      const e = c.indexOf(`\n${d}@`, i + 2);
      add(c.slice(i + 2, e < 0 ? c.length : e).replace(/^\r?\n/, ""));
      i = e < 0 ? c.length : e + 3;
    } else if (ch === "'") {
      const e = c.indexOf("'", i + 1);
      add(c.slice(i + 1, e < 0 ? c.length : e));
      i = e < 0 ? c.length : e + 1;
    } else if (ch === '"') {
      const e = quoteEnd(i);
      add(c.slice(i + 1, e - 1));
      i = e;
    } else if (ch === "$" && d === "(") {
      const e = substEnd(i + 1);
      add(c.slice(i, e));
      i = e;
    } else if (cutHeredoc(i)) {
      continue;
    } else if (ch === "#" && cur === null) { // a comment: its quotes and operators are prose, up to the line break
      const e = c.indexOf("\n", i);
      i = e < 0 ? c.length : e;
    } else {
      add(ch);
      i += 1;
    }
  }
  endSegment("");
  return segments;
}

/** `text` without its leading run of the characters in `chars`. */
function stripStart(text, chars) {
  let i = 0;
  while (i < text.length && chars.includes(text[i])) i += 1;
  return text.slice(i);
}

/** `text` without its trailing run of the characters in `chars`. */
function stripEnd(text, chars) {
  let i = text.length;
  while (i > 0 && chars.includes(text[i - 1])) i -= 1;
  return text.slice(0, i);
}

/**
 * A segment's words without the brackets of a subshell or a block around them, and how many subshells
 * the segment opens and closes. A last word holding a "(" keeps its ")": it is a call or a `$(...)`.
 */
function brackets(segment) {
  const words = [...segment];
  let opens = 0;
  let closes = 0;
  if (words.length) {
    const first = stripStart(words[0], "({");
    opens = words[0].slice(0, words[0].length - first.length).split("(").length - 1;
    words[0] = first;
    const last = words[words.length - 1];
    if (!last.includes("(")) {
      const kept = stripEnd(last, ")}");
      closes = last.slice(kept.length).split(")").length - 1;
      words[words.length - 1] = kept;
    }
  }
  return { words: words.filter(Boolean), opens, closes };
}

/** How many of the words are leaders or `VAR=value` before the command starts. */
function leadEnd(words, leaders) {
  let k = 0;
  while (k < words.length && (leaders.includes(words[k]) || ASSIGN.test(words[k]))) k += 1;
  return k;
}

/** The command line a segment hands to a shell (`bash -c "<line>"`), or null when it hands none. */
function innerLine(segment, { shells = SHELLS, leaders = LEADERS } = {}) {
  const words = commandWords(segment, leaders);
  const first = words.length ? baseName(words[0]) : "";
  if (!Object.hasOwn(shells, first)) return null;
  for (let k = 1; k + 1 < words.length; k += 1) {
    if (shells[first].includes(words[k].toLowerCase())) {
      return words.length > k + 2 ? words.slice(k + 1).join(" ") : words[k + 1];
    }
  }
  return null;
}

/** One segment as the segments of the line it hands to a shell, or as itself. The last one keeps its operator. */
function expandSegment(segment, options, depth = 0) {
  const inner = depth < MAX_NESTING ? innerLine(segment.words, options) : null;
  if (inner === null) return [segment];
  const lead = segment.words.filter((w) => ASSIGN.test(w));
  const sub = lex(inner).flatMap((s) => expandSegment(s, options, depth + 1));
  return sub.map((s, n) => ({ words: [...lead, ...s.words], op: n === sub.length - 1 ? segment.op : s.op }));
}

/**
 * `to` as seen from the folder `base`, with forward slashes and `.` / `..` resolved; null when the text
 * does not say where that is (a variable, `~` with no home given, a relative path from an unknown folder).
 */
function resolvePath(base, to, home) {
  if (/[$`]/.test(to) || /^@\w/.test(to)) return null;
  const from = base === null ? null : base.replaceAll("\\", "/");
  let p = to.replaceAll("\\", "/");
  if (p === "~" || p.startsWith("~/")) {
    if (!home) return null;
    p = home.replaceAll("\\", "/") + p.slice(1);
  } else if (p.startsWith("~")) {
    return null;
  }
  // From a drive folder, "/c/dir" is how Git Bash spells "c:/dir".
  if (from !== null && /^[A-Za-z]:/.test(from)) p = p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:/");
  if (!ROOT.test(p)) {
    if (from === null) return null;
    if (from) p = `${from}/${p}`;
  }
  let lead = ROOT.exec(p)?.[0] ?? "";
  const parts = [];
  for (const part of p.slice(lead.length).split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.length && parts.at(-1) !== "..") parts.pop();
    else if (!lead) parts.push(".."); // above a relative start; above a root there is nothing
  }
  if (/^[A-Za-z]:$/.test(lead)) lead += "/";
  return lead + parts.join("/");
}

/**
 * A command as segments of words, read the way a shell does (bash and PowerShell). Quotes are removed;
 * a quoted string, a here-string and a `$(...)` stay one word; a here-document body and a comment are dropped.
 * @param {string} command
 * @returns {string[][]}
 */
export function shellWords(command) {
  return lex(command).map((segment) => segment.words);
}

/**
 * A command split on unquoted `&&`, `||`, `;`, `|`, `&` and line breaks, each segment with the operator
 * after it. A `bash -c "<line>"` or `powershell -Command "<line>"` is replaced by the segments of its line.
 * @param {string} command
 * @param {{shells?: Record<string, readonly string[]>, leaders?: readonly string[]}} [options]
 * @returns {Segment[]}
 */
export function splitCommand(command, options) {
  return lex(command).flatMap((segment) => expandSegment(segment, options));
}

/**
 * The program a word names: no folder, lower case, no `.exe`.
 * @param {string} word
 * @returns {string}
 */
export function baseName(word) {
  const name = word.replaceAll("\\", "/").split("/").pop().toLowerCase();
  return name.endsWith(".exe") ? name.slice(0, -4) : name;
}

/**
 * A segment's words in two parts: the leading `VAR=value` and leader words, then the command's own.
 * Subshell and block brackets around the segment are dropped.
 * @param {readonly string[]} segment
 * @param {readonly string[]} [leaders]
 * @returns {{lead: string[], words: string[]}}
 */
export function splitLead(segment, leaders = LEADERS) {
  const { words } = brackets(segment);
  const k = leadEnd(words, leaders);
  return { lead: words.slice(0, k), words: words.slice(k) };
}

/**
 * The command's own words: the segment without brackets, leaders and leading `VAR=value`.
 * @param {readonly string[]} segment
 * @param {readonly string[]} [leaders]
 * @returns {string[]}
 */
export function commandWords(segment, leaders = LEADERS) {
  return splitLead(segment, leaders).words;
}

/**
 * The variable and value of a PowerShell `$env:X = "v"` or `$env:X="v"` segment, else null.
 * @param {readonly string[]} words
 * @returns {{name: string, value: string} | null}
 */
export function psAssignment(words) {
  if (!words.length) return null;
  let m = ENV_NAME.exec(words[0]);
  if (m && words.length >= 2 && words[1] === "=") return { name: m[1], value: words.slice(2).join(" ") };
  m = ENV_SET.exec(words[0]);
  return m ? { name: m[1], value: [m[2], ...words.slice(1)].join(" ") } : null;
}

/**
 * The environment variables a command sets in its own text: `X=v cmd`, `export X=v`, `set X=v`,
 * `$env:X = "v"`. A Map, so a variable named like an object property is only ever a key.
 * @param {readonly (readonly string[])[]} segments  Word lists, as `shellWords` or `expand` give them.
 * @returns {Map<string, string>}
 */
export function assignments(segments) {
  const out = new Map();
  for (const segment of segments) {
    const words = segment.length && SETTERS.includes(stripStart(segment[0], "({")) ? segment.slice(1) : segment;
    if (!words.length) continue;
    let m = ENV_NAME.exec(words[0]);
    if (m && words.length >= 3 && words[1] === "=") {
      out.set(m[1], words.slice(2).join(" "));
      continue;
    }
    m = ENV_SET.exec(words[0]);
    if (m) {
      out.set(m[1], m[2]);
      continue;
    }
    for (const word of words) {
      m = VAR_SET.exec(stripStart(word, "({"));
      if (!m) break;
      out.set(m[1], m[2]);
    }
  }
  return out;
}

/**
 * Word lists with each `bash -c "<line>"` and `powershell -Command "<line>"` replaced by the word lists
 * of that line, nested ones too. The `VAR=value` words of the outer segment lead each inner one.
 * @param {readonly string[][]} segments
 * @param {{shells?: Record<string, readonly string[]>, leaders?: readonly string[]}} [options]
 * @returns {string[][]}
 */
export function expand(segments, options) {
  return segments.flatMap((words) => expandSegment({ words, op: "" }, options).map((segment) => segment.words));
}

/**
 * Peels `<wrapper> <args> -- <command>` off a command's words, repeatedly. `wrapper.names` are the base
 * names of the wrapping program; `wrapper.wraps(args)` may refuse a use of it that runs nothing. Returns
 * the args of each wrapper peeled and the wrapped command as word lists: a command given as one quoted
 * line is read again as a shell would. With nothing to peel, the words come back as the one segment.
 * @param {readonly string[]} words
 * @param {{names: readonly string[], wraps?: (args: string[]) => boolean} | null} [wrapper]
 * @param {{shells?: Record<string, readonly string[]>, leaders?: readonly string[]}} [options]
 * @returns {{wrappers: string[][], segments: string[][]}}
 */
export function unwrap(words, wrapper = null, options) {
  const names = wrapper?.names ?? [];
  const wrappers = [];
  let rest = [...words];
  for (;;) {
    const k = rest.findIndex((w) => names.includes(baseName(w)));
    const dashes = k < 0 ? -1 : rest.indexOf("--", k);
    if (dashes < 0) break;
    const args = rest.slice(k + 1, dashes);
    if (wrapper.wraps && !wrapper.wraps(args)) break;
    wrappers.push(args);
    rest = rest.slice(dashes + 1);
  }
  if (wrappers.length && rest.length === 1 && /\s/.test(rest[0])) {
    return { wrappers, segments: expand(shellWords(rest[0]), options) };
  }
  return { wrappers, segments: rest.length ? [rest] : [] };
}

/**
 * Words as one line of text, for a pattern to search.
 * @param {readonly string[]} words
 * @returns {string}
 */
export function textOf(words) {
  return words.join(" ");
}

/**
 * The git call in a command's words, or null: `at` the index of the `git` word, `dirs` the value of each
 * `-C` in order, `verb` the sub-command ("" when there is none) and `args` the words after it.
 * @param {readonly string[]} words
 * @returns {{at: number, dirs: string[], verb: string, args: string[]} | null}
 */
export function gitCommand(words) {
  const at = words.findIndex((w) => baseName(w) === "git");
  if (at < 0) return null;
  const dirs = [];
  let i = at + 1;
  for (; i < words.length && words[i].startsWith("-"); i += 1) {
    if (words[i] === "-C") dirs.push(words[i + 1] ?? "");
    if (GIT_VALUE_OPTS.includes(words[i])) i += 1;
  }
  return { at, dirs, verb: words[i] ?? "", args: words.slice(i + 1) };
}

/**
 * Each segment with `cwd`, the folder it runs in: a `cd` / `pushd` / `Set-Location` moves the segments
 * after it (`popd` and the end of a `( ... )` subshell move back), a `git -C <path>` moves its own segment
 * only. A moved folder has forward slashes; null once the text no longer says where (`cd $DIR`, `cd -`,
 * `~` with no `home`).
 * @param {readonly Segment[]} segments
 * @param {string | null} cwd  Where the command line starts.
 * @param {{home?: string | null, leaders?: readonly string[]}} [options]
 * @returns {(Segment & {cwd: string | null})[]}
 */
export function trackCwd(segments, cwd, { home = null, leaders = LEADERS } = {}) {
  let dir = cwd ?? null;
  const pushed = []; // where each pushd left
  const subshells = []; // where each open "(" started
  return segments.map((segment) => {
    const { words: bare, opens, closes } = brackets(segment.words);
    const words = bare.slice(leadEnd(bare, leaders));
    for (let n = 0; n < opens; n += 1) subshells.push(dir);
    let here = dir;
    const name = (words[0] ?? "").toLowerCase();
    if (CD.includes(name) || PUSH.includes(name)) {
      if (PUSH.includes(name)) pushed.push(dir);
      const to = words.slice(1).find((w) => !w.startsWith("-"));
      dir = to === undefined ? null : resolvePath(dir, to, home);
    } else if (POP.includes(name)) {
      dir = pushed.length ? pushed.pop() : null;
    } else {
      for (const to of gitCommand(words)?.dirs ?? []) here = resolvePath(here, to, home);
    }
    for (let n = 0; n < closes && subshells.length; n += 1) dir = subshells.pop();
    return { ...segment, cwd: here };
  });
}
