// lint: a check for agent reports and merge request bodies. A claim needs its
// evidence, and a metric that moved is not a verdict. Code blocks and quoted
// lines are not read. The rules are few on purpose, and a negated, conditional,
// or planned statement ("not verified", "should pass") is left alone.
//
//   metric-verdict    "worse", "regressed", "better" beside a metric, in a sentence that does not say what the picture shows
//   bare-claim        "verified", "works", "passes", "fixed" with no artefact: a path, a command, a count, a test, a commit
//   reference-target  a target set against the reference ("within 10 % of the reference", "get deltaE below 2")
//   no-count          a hint: "all tests pass" with no count
//   no-skipped        a hint: a full pass claimed in a report that never says what was skipped
import fs from "node:fs";
import { emit, parseArgs, PlError } from "../lib/args.mjs";

const HELP = `usage: pl.mjs lint [FILE | -] [--reference-name NAME]... [--window N] [--json]

Read markdown from FILE, or stdin with - (the default), and report each sentence that breaks a rule:

  metric-verdict    a verdict word (worse, regressed, degraded, better) within N words (default 8)
                    of a metric (ssim, deltaE, PSNR, score), where the sentence does not say what the
                    picture shows. The number says the pictures differ, not which is right.
  bare-claim        verified, confirmed, works, passes or fixed with no artefact in the sentence (or
                    the next one, or under a line ending in a colon): a path, a command or name in
                    backticks, a number with a unit, a count, a test name, a commit, a link.
  reference-target  a target set against the reference: look work aims at the candidate being right.
  no-count          (hint) "all tests pass" with no count.
  no-skipped        (hint) a full pass claimed where nothing says what was skipped or not run.

--reference-name names what this project calls its reference (repeatable), for reference-target.
Exit 1 when one of the first three fires, 0 otherwise (hints never fail), 2 on a usage error.`;

const METRIC = /(?<![\w.])(ssim|delta ?e(?:2000|norm)?|Δe(?:2000)?|psnr|lpips|edgef1|edge f1|scores?|metrics?)(?!\w)/gi;
const VERDICT = /\b(worse|worsened|regress(?:ed|es|ion)|degrad(?:ed|es|ation)|better)\b/gi;
const PICTURE = /\b(shows?|showing|visibl[ey]|by eye|looks?|looking at|in the (?:picture|image|frame|sheet|crop|render)s?)\b/i;
// a claim is the word used as a finished fact about the work; "how it works", "render passes" and "a fixed seed" are not
const CLAIM = new RegExp(String.raw`\b(?:(verified|confirmed)`
  + String.raw`|(?:is|are|was|were|now|been|got|gets)\s+(fixed)`
  + String.raw`|^\W*(fixed)\b`
  + String.raw`|(?:it|this|that|which|everything|all|fix|change|feature|now|still|also|import|build|export|page|hook|script)\s+(?:now\s+|still\s+|all\s+)?(works)`
  + String.raw`|(?:tests?|suite|gates?|checks?|build|ci|lint|typecheck|it|this|everything|all|that)\s+(?:now\s+|still\s+|all\s+)?(pass(?:es|ed)?))\b`, "gi");
const HEDGE = /\b(not|never|no|cannot|without|should|must|will|would|could|might|may|to|needs?|once|until|if|when|whether|before|todo|expect(?:ed)?|plan(?:ned)?|hope|assum\w+|how|why|what|can|unless|ensure|check)\b|n't/i;
const ARTIFACT = new RegExp([
  "`[^`]+`", // a command or a name
  String.raw`[\w.-]+[/\\][\w./\\-]+`, // a path
  String.raw`\b[\w-]+\.(?:png|jpe?g|webp|json|jsonl|md|log|txt|html|mp4|webm|wav|mjs|js|ts|tsx|py|cpp|h|ya?ml|toml)\b`,
  String.raw`\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds?|min|minutes?|h|hours?|%|px|fps|hz|db|ev|kb|mb|gb|x|shots?|tests?|checks?|frames?|runs?|files?|cases?|passed|failed|of\s+\d+)(?!\w)`,
  String.raw`\b\d+\s?/\s?\d+\b`, // 31/31
  String.raw`\btest_\w+|\b\w+(?:Test|Spec)\b|\b\w+(?:\.\w+){2,}\b`, // a test name
  String.raw`![0-9]+\b|#\d+\b|\b[0-9a-f]{7,40}\b|https?://\S+`, // a merge request, an issue, a commit, a link
  String.raw`\[[^\]]+\]\([^)]+\)`, // a markdown link
].join("|"), "i");
const TARGET_CUE = /\b(target|goal|aim(?:ing)?|until|must|should|needs? to|get|bring|reach|push|drive|criteri\w+|success|accept\w*|done when|threshold)\b/i;
const THRESHOLD = /(ssim|delta ?e(?:2000|norm)?|Δe(?:2000)?|psnr|lpips|edgef1)\W{0,3}(?:\w+\W+){0,3}?(below|under|above|over|at least|at most|less than|more than|greater than|<=?|>=?|≤|≥)\s*\d/i;
const TOTAL = /\b(?:all|every(?:thing)?)\s+(?:the\s+|of the\s+)?(?:\w+\s+){0,2}?(?:pass(?:es|ed)?|green|succeed(?:s|ed)?|ok)\b|\bno\s+(?:test\s+)?failures\b|\beverything\s+is\s+green\b/i;
const COUNT = /\b\d+\s*(?:of\s+\d+|\/\s*\d+|tests?|checks?|shots?|cases?|passed|pass|gates?|entries|files?|ok)\b|`[^`]+`/i;
const FULL_CLAIM = /\b(full (?:pass|suite|run)|all (?:the )?gates|whole suite|every gate)\b/i;
const SKIPPED = /\b(skipped|not run|did not run|didn't run|not checked|not verified|not tested|not covered|untested|left out|out of scope|owed|nothing (?:was )?skipped)\b/i;

export const FIX = {
  "metric-verdict": "say what changed in the picture and judge that (wrong, less-plausible, more-correct, different-ok); give the number as 'moved from X to Y'",
  "bare-claim": "name the evidence: the command and its result, the file or sheet, the test, the measured number",
  "reference-target": "aim at the candidate being right (the asset shown faithfully, nothing missing); keep the metric as a regression gate against its own baseline",
  "no-count": "give the count and the command: '31 of 31 pass (`npm test`)'",
  "no-skipped": "add what was skipped or not run, or say that nothing was",
};

/** Negated, conditional or planned: one of the four words before the claim says it is not a finished fact. */
const hedged = (before) => HEDGE.test(before.split(/\s+/).filter(Boolean).slice(-4).join(" "));

/** The prose's sentences with their line numbers. A block is a paragraph, a list item, a heading, or a table row. */
export function sentences(text) {
  const blocks = [];
  let cur = [], fence = null;
  const close = () => { if (cur.length) blocks.push(cur); cur = []; };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trimEnd(), no = i + 1;
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) { fence = fence ? null : f[1][0]; close(); return; }
    if (fence || /^\s*>/.test(line) || (/^ {4,}\S/.test(line) && !cur.length)) return;
    const starts = /^\s*(?:[-*+]|\d+[.)])\s+|^\s*#{1,6}\s|^\s*\|/.test(line);
    if (!line.trim() || starts) close();
    if (line.trim()) cur.push([no, line]);
    if (line.trim() && /^\s*(?:#{1,6}\s|\|)/.test(line)) close();
  });
  close();
  const out = [];
  blocks.forEach((block, b) => {
    let joined = "";
    const startsAt = [];
    for (const [no, line] of block) {
      startsAt.push([joined.length, no]);
      joined += line.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|^\s*#{1,6}\s+/, "").trim() + " ";
    }
    // a sentence ends at . ! ? before a space and a capital, a digit or an opening mark; code spans stay whole
    const masked = joined.replace(/`[^`]*`/g, (m) => "\0".repeat(m.length));
    const cuts = [0, ...[...masked.matchAll(/(?<=[.!?])["')\]]?\s+(?=["'(\[`*_]?[A-Z0-9\0])/g)].map((m) => m.index + m[0].length), joined.length];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const piece = joined.slice(cuts[k], cuts[k + 1]), s = piece.trim();
      if (!s) continue;
      const at = cuts[k] + piece.length - piece.trimStart().length;
      const line = startsAt.filter(([off]) => off <= at).at(-1)?.[1] ?? block[0][0];
      out.push({ line, text: s, block: b });
    }
  });
  return out;
}

const near = (a, b, text, window) => {
  const [lo, hi] = a.index < b.index ? [a, b] : [b, a];
  return text.slice(lo.index + lo[0].length, hi.index).split(/\s+/).filter(Boolean).length <= window;
};

/** The findings of one markdown text, by line. */
export function lint(text, { referenceNames = [], window = 8 } = {}) {
  const refs = ["reference", "ref", "original", "mock(?:up)?", "ground truth", ...referenceNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))].join("|");
  const within = new RegExp(String.raw`\bwithin\s+\d+(?:\.\d+)?\s?(?:%|percent|pct)\s+of\s+(?:the\s+)?(?:${refs})\b`, "i");
  const sents = sentences(text);
  const found = [];
  const add = (rule, s, hint = false) => found.push({ line: s.line, rule, hint, sentence: s.text, fix: FIX[rule] });
  sents.forEach((s, i) => {
    const t = s.text;
    if (t.trimEnd().endsWith("?")) return;
    const next = sents[i + 1];
    const verdicts = [...t.matchAll(VERDICT)], metrics = [...t.matchAll(METRIC)];
    if (!PICTURE.test(t) && verdicts.some((v) => !hedged(t.slice(0, v.index)) && metrics.some((m) => near(v, m, t, window)))) add("metric-verdict", s);
    if (within.test(t) || (THRESHOLD.test(t) && TARGET_CUE.test(t) && !/\b(tolerances?|baseline|gate)\b/i.test(t))) add("reference-target", s);
    const claim = [...t.matchAll(CLAIM)].find((m) => {
      const group = m.slice(1).findIndex(Boolean) + 1;
      return !hedged(t.slice(0, m.index + m[0].lastIndexOf(m[group])));
    });
    let bare = false;
    if (claim && !ARTIFACT.test(t)) {
      const follows = next && (next.block === s.block || t.trimEnd().endsWith(":")) && ARTIFACT.test(next.text);
      if (!follows) { bare = true; add("bare-claim", s); }
    }
    const total = t.match(TOTAL);
    if (!bare && total && !COUNT.test(t) && !hedged(t.slice(0, total.index))) add("no-count", s, true);
  });
  if (!SKIPPED.test(text)) {
    const first = sents.find((s) => { const m = s.text.match(FULL_CLAIM); return m && !hedged(s.text.slice(0, m.index)); });
    if (first) add("no-skipped", first, true);
  }
  return found.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

export async function run(argv) {
  const opts = parseArgs(argv, { "reference-name": { type: "string", multi: true }, window: { type: "int", default: 8 }, json: { type: "bool" } });
  if (opts.help) { emit(null, false, HELP); return 0; }
  if (opts._.length > 1) throw new PlError("lint reads one file, or stdin with -");
  const file = opts._[0] ?? "-";
  let text;
  try { text = fs.readFileSync(file === "-" ? 0 : file, "utf8").replace(/^\uFEFF/, ""); } catch (e) { throw new PlError(`cannot read ${file}: ${e.message}`); }
  const found = lint(text, { referenceNames: opts.referenceName, window: opts.window });
  const failing = found.filter((f) => !f.hint);
  const where = file === "-" ? "stdin" : file;
  const lines = found.map((f) => `${where}:${f.line}: ${f.hint ? "hint " : ""}${f.rule}: ${f.sentence}\n    fix: ${f.fix}`);
  lines.push(found.length ? `${failing.length} finding(s), ${found.length - failing.length} hint(s)` : "no findings");
  emit({ findings: found, failing: failing.length, hints: found.length - failing.length }, opts.json, lines.join("\n"));
  return failing.length ? 1 : 0;
}
