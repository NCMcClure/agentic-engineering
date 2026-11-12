#!/usr/bin/env node
// Deterministic scanner and scoring calculator for the workbench.
//
// Scan mode walks a plugin directory and emits one JSON profile to stdout:
// component census, per-skill frontmatter facts, context-footprint estimates,
// hook and workflow static checks, lint findings, mechanical grades, the N/A
// set, and any triggered verdict gates. The grading step (a model, or the
// evaluate workflow) reasons from these facts instead of re-deriving them.
//
// Score mode merges the model's judgment grades with the mechanical ones,
// applies the weight tables below, and emits the composite, the per-dimension
// scores, and the verdict. ALL scoring arithmetic lives here so every path
// produces the same numbers and the model never does scoring math in prose.
//
// Node 22 stdlib only.
//
// Usage:
//   node plugin-scan.mjs <plugin_path>                        # scan
//   node plugin-scan.mjs <plugin_path> --score <grades.json>  # score
//
// Exit 0 with JSON on stdout; 1 with a reason on stderr when the target or the
// grades cannot be used; 2 on a usage error. Paths in the output are relative
// to the plugin root and use forward slashes on every platform.
//
// Honesty notes baked into the output: token counts are chars/4 estimates
// (`claude plugin details <name>` is ground truth for an installed plugin),
// the frontmatter parser is a flat-YAML reader that reports "partial" rather
// than guessing, and workflow checks are regex signals for a grader to
// confirm, never verdicts by themselves.
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// The rubric's numeric skeleton. Check kinds: "m" = mechanical (graded here),
// "j" = judgment (graded by the model against references/rubric.md anchors).
// Weights are relative within their dimension; dimension weights are relative
// within the applicable set (renormalized when a dimension is N/A).
// ---------------------------------------------------------------------------

const DIMENSIONS = {
  SQ: { label: "Skill quality", weight: 30 },
  CS: { label: "Component symbiosis", weight: 15 },
  WQ: { label: "Workflow quality", weight: 10 },
  AN: { label: "Architecture & navigability", weight: 15 },
  CF: { label: "Context-window footprint", weight: 20 },
  MH: { label: "Manifest & distribution hygiene", weight: 10 },
};

// id: [dimension, kind, weight, label]
const CHECKS = {
  SQ1: ["SQ", "j", 3, "Description quality (leading word, one trigger per branch)"],
  SQ2: ["SQ", "j", 2, "Invocation-mode fitness"],
  SQ3: ["SQ", "j", 2, "Information hierarchy & progressive disclosure"],
  SQ4: ["SQ", "j", 2, "Completion criteria checkable + exhaustive"],
  SQ5: ["SQ", "j", 2, "Failure modes: duplication, sediment, sprawl, no-ops"],
  SQ6: ["SQ", "j", 1, "Leading words earning their repetitions"],
  SQ7: ["SQ", "m", 1, "Relative links resolve"],
  SQ8: ["SQ", "m", 1, "Frontmatter carries only the four keys"],
  CS1: ["CS", "j", 2, "Hooks complement skills"],
  CS2: ["CS", "j", 3, "Deterministic offload to scripts"],
  CS3: ["CS", "m", 1, "No orphaned components"],
  CS4: ["CS", "j", 1, "Commands/agents/MCP coherence"],
  CS5: ["CS", "j", 1, "Visualization/report component where warranted"],
  CS6: ["CS", "j", 2, "Asset reuse over regeneration"],
  CS7: ["CS", "m", 1, "Node hook commands sit behind the guard"],
  WQ1: ["WQ", "m", 1, "Workflow meta correctness + phase/title match"],
  WQ2: ["WQ", "m", 1, "Args coercion + resume safety"],
  WQ3: ["WQ", "j", 2, "Model/effort tier intelligence"],
  WQ4: ["WQ", "j", 1, "Pipeline vs parallel correctness"],
  WQ5: ["WQ", "j", 1, "Schemas, null-handling, log coverage"],
  WQ6: ["WQ", "j", 1, "No obvious logic flaws"],
  WQ7: ["WQ", "m", 1, "Workflow call names a subagent fallback"],
  AN1: ["AN", "j", 2, "Tree tells the story"],
  AN2: ["AN", "m", 2, "Self-containment (paths)"],
  AN3: ["AN", "j", 1, "Extensibility"],
  AN4: ["AN", "j", 1, "Single source of truth"],
  AN5: ["AN", "m", 1, "No cruft or never-loaded files"],
  CF1: ["CF", "m", 2, "Passive token footprint"],
  CF2: ["CF", "m", 1, "Description length caps"],
  CF3: ["CF", "j", 2, "Passive cost buys autonomous reach"],
  CF4: ["CF", "m", 1, "On-invoke body size"],
  CF5: ["CF", "j", 1, "Hook context-injection cost"],
  MH1: ["MH", "m", 1, "Manifest completeness"],
  MH2: ["MH", "j", 1, "README answers problem/how/install/skills"],
  MH3: ["MH", "m", 1, "CHANGELOG.md present and current"],
  MH4: ["MH", "j", 1, "Pitch quality"],
  MH5: ["MH", "m", 1, "Shipped scripts run on Node, or declare a debt marker"],
};

// Checks graded once per skill by the model; score mode averages the entries.
const PER_SKILL_CHECKS = ["SQ1", "SQ2", "SQ3", "SQ4", "SQ5", "SQ6"];

const VERDICT_TIERS = [[85, "adopt"], [70, "adopt-with-fixes"], [50, "rework"], [0, "avoid"]];
const TIER_ORDER = ["adopt", "adopt-with-fixes", "rework", "avoid"]; // best to worst

// CF1 bands: estimated always-on tokens to grade.
const PASSIVE_TOKEN_BANDS = [[200, 4], [400, 3], [800, 2], [1500, 1]];

const DESCRIPTION_CAP = 1536;   // combined description + when_to_use, chars
const BODY_LINE_GUIDANCE = 500; // SKILL.md body lines before disclosure should kick in
const BIG_FENCE_LINES = 40;     // fenced blocks this long are extraction candidates
const OVERSTUFFED = 25;         // direct source files in one directory

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build",
  ".next", ".turbo", ".cache"]);

const CRUFT_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const CRUFT_DIRS = new Set(["node_modules", "__pycache__", ".pytest_cache", ".mypy_cache"]);

const ABS_PATH_RE = /(?:^|["'\s(=:])(\/(?:home|Users|fast|mnt\/c\/Users)\/[A-Za-z0-9._-]+[^\s"')]*)/g;
const TEXT_EXTS = new Set([".md", ".sh", ".js", ".mjs", ".cjs", ".json", ".py", ".yml", ".yaml",
  ".ts", ".tsx", ".css", ".txt", ".html"]);
// What counts as a script the plugin ships: the Node extensions, and the ones
// MH5 holds against the stack rule. A file with no extension is judged by its
// shebang.
const NODE_EXTS = new Set([".mjs", ".cjs", ".js"]);
const NON_NODE_EXTS = new Set([".py", ".sh", ".bash", ".zsh", ".ps1", ".rb", ".pl"]);
// Extensions a browser loads. Under an `assets/` directory these are page
// chrome, not plugin tooling, and they are censused in their own list.
const BROWSER_EXTS = new Set([".js"]);
// A non-Node script that carries a `debt: <ceiling>, <trigger>` comment near
// its top is a declared exception: it says why it stays and what would end it.
const DEBT_RE = /(?:#|\/\/|--|;|\/\*|<!--)+\s*debt:\s*\S/;

// Frontmatter fields the harness reads; anything else is noted.
const KNOWN_SKILL_FIELDS = new Set(["name", "description", "when_to_use", "argument-hint", "arguments",
  "disable-model-invocation", "user-invocable", "allowed-tools",
  "disallowed-tools", "model", "effort", "context", "agent", "hooks",
  "paths", "shell", "license", "metadata"]);
// The four SQ8 allows, so a listing costs what its description costs and
// nothing in a skill depends on a field one host version reads and another drops.
const FOUR_KEYS = new Set(["name", "description", "disable-model-invocation", "argument-hint"]);

// CS7: a hook that runs Node sits behind a guard, so a machine without Node
// gets one line at session start instead of an error on every event.
const QUIET_GUARD = "command -v node >/dev/null 2>&1 || exit 0; ";
const LOUD_GUARD_RE = /^command -v node >\/dev\/null 2>&1 \|\| \{ echo '(\{.*?\})'; exit 0; \}; /;
const NODE_CALL_RE = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+\.m?js)"((?: [A-Za-z0-9_./=:-]+)*)$/;

const EST_NOTE = "chars/4 estimate; `claude plugin details <name>` is ground truth when installed";
const USAGE = "usage: node plugin-scan.mjs <plugin_path> [--score <grades.json>]";

class Bail extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

// ---- small helpers -----------------------------------------------------
const tokens = (chars) => Math.floor(chars / 4);
/** Length in characters, an astral one counted once. */
const chars = (s) => { let n = 0; for (const _ of s) n++; return n; };

/**
 * Round half to even at `digits` decimals, judged on the number's exact
 * value. A product like 1.15 * 10 lands on a tie the number itself is not on,
 * and a composite that moves a tenth on that is a different verdict at a tier
 * edge.
 */
function round(value, digits = 0) {
  if (!Number.isFinite(value)) return value;
  const [whole, frac] = Math.abs(value).toFixed(100).split(".");
  const rest = frac.slice(digits);
  let n = BigInt(whole + frac.slice(0, digits));
  const tie = /^50*$/.test(rest);
  if (tie ? n % 2n === 1n : rest[0] >= "5") n += 1n;
  const out = Number(n) / 10 ** digits;
  return value < 0 ? -out : out;
}

const statOf = (p) => { try { return fs.statSync(p); } catch { return null; } };
const isFile = (p) => statOf(p)?.isFile() ?? false;
const isDir = (p) => statOf(p)?.isDirectory() ?? false;

/** One directory's entries as { dirs, files, links }; a link to a directory is named in `links` and never entered. */
function listDir(dir) {
  const out = { dirs: [], files: [], links: [] };
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) out.dirs.push(e.name);
    else if (e.isSymbolicLink() && isDir(path.join(dir, e.name))) out.links.push(e.name);
    else out.files.push(e.name);
  }
  return out;
}

/** Every file under root, skipping SKIP_DIRS: this directory's files, then each subdirectory. */
function* walkFiles(root) {
  const { dirs, files } = listDir(root);
  for (const f of files) yield path.join(root, f);
  for (const d of dirs) if (!SKIP_DIRS.has(d)) yield* walkFiles(path.join(root, d));
}

/** Every directory under root, unfiltered: the cruft sweep must see node_modules. */
function* walkDirs(root) {
  const { dirs, links } = listDir(root);
  for (const d of [...dirs, ...links]) yield path.join(root, d);
  for (const d of dirs) yield* walkDirs(path.join(root, d));
}

const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const countOf = (haystack, needle) => haystack.split(needle).length - 1;
const matchAll = (text, re) => [...text.matchAll(re)];
const findAll = (text, re) => matchAll(text, re).map((m) => (m.length > 1 ? m[1] : m[0]));
const stripQuotes = (s) => s.replace(/^["']+/, "").replace(/["']+$/, "");
const uniqueSorted = (values) => [...new Set(values)].sort();

/** Split on `sep` at most `limit` times; the remainder is the last piece. */
function splitN(text, sep, limit) {
  const out = [];
  let rest = text;
  while (out.length < limit) {
    const i = rest.indexOf(sep);
    if (i === -1) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter: a deliberately naive flat-YAML reader. Handles `key: value`,
// `key: >` / `key: |` block scalars, and quoted strings. Anything nested or
// exotic flips parse_ok to "partial" so the grader knows to look itself.
// ---------------------------------------------------------------------------

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { fields: {}, parseOk: false, order: [] };
  const lines = text.split("\n");
  let end = null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { end = i; break; }
  }
  if (end === null) return { fields: {}, parseOk: "partial", order: [] };
  const fields = {}, order = [];
  let partial = false;
  let i = 1;
  while (i < end) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) { i++; continue; }
    // [\s\S] rather than a dot: a CRLF file's lines still end in \r here.
    const m = /^([A-Za-z0-9_-]+):\s*([\s\S]*)$/.exec(line);
    if (!m) { partial = true; i++; continue; }
    const key = m[1], val = m[2].trim();
    order.push(key);
    if ([">", "|", ">-", "|-"].includes(val)) {
      const block = [];
      i++;
      while (i < end && (!lines[i].trim() || lines[i].startsWith(" ") || lines[i].startsWith("\t"))) {
        block.push(lines[i].trim());
        i++;
      }
      fields[key] = block.filter(Boolean).join(" ");
      continue;
    }
    if (val === "") {
      // nested mapping or sequence: record presence, do not pretend to read it
      fields[key] = true;
      let j = i + 1, nested = false;
      while (j < end && (!lines[j].trim() || /^(\s+)\S/.test(lines[j]))) {
        if (lines[j].trim()) nested = true;
        j++;
      }
      if (nested) { partial = true; i = j; continue; }
    } else {
      fields[key] = stripQuotes(val);
    }
    i++;
  }
  return { fields, parseOk: partial ? "partial" : true, order };
}

const truthy = (val) => ["true", "yes", "1"].includes(String(val).trim().toLowerCase());
const asText = (val) => (val === undefined || val === true ? "" : String(val));

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function findSkillFiles(root) {
  const out = [];
  const skillsDir = path.join(root, "skills");
  if (isDir(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir).sort()) {
      const p = path.join(skillsDir, entry, "SKILL.md");
      if (isFile(p)) out.push(p);
    }
  }
  const rootSkill = path.join(root, "SKILL.md");
  if (isFile(rootSkill)) out.push(rootSkill);
  return out;
}

const MD_LINK_RE = /\[[^\]]*\]\(([^)#\s]+)\)/g;

function scanSkill(root, file) {
  const text = readText(file) ?? "";
  const { fields: fm, parseOk, order } = parseFrontmatter(text);
  let body = text;
  if (text.startsWith("---")) {
    const parts = splitN(text, "\n---", 2);
    if (parts.length >= 2) body = parts[parts.length - 1];
  }
  const bodyLines = countOf(body, "\n") + 1;
  const skillDir = path.dirname(file);

  const desc = asText(fm.description);
  const wtu = asText(fm.when_to_use);
  const combined = chars(desc) + chars(wtu);
  const modelInvoked = !truthy(fm["disable-model-invocation"] ?? "");

  const links = [], broken = [];
  for (const target of findAll(text, MD_LINK_RE)) {
    if (/^(https?:\/\/|mailto:|\$\{|\/)/.test(target)) continue;
    links.push(target);
    const resolved = path.resolve(skillDir, target);
    if (!fs.existsSync(resolved)) broken.push(target);
    else if (!(resolved + path.sep).startsWith(root + path.sep)) broken.push(target + " (escapes plugin root)");
  }

  // sibling support files never mentioned anywhere in the skill dir's text
  const siblings = [...walkFiles(skillDir)].filter((other) => other !== file);
  let mentioned = text;
  for (const other of siblings) {
    if (/\.(md|js|json)$/.test(other)) mentioned += readText(other) ?? "";
  }
  const unlinked = siblings.filter((other) => !mentioned.includes(path.basename(other))).map((other) => rel(root, other)).sort();

  const fences = [];
  for (const m of matchAll(body, /```[^\n]*\n([\s\S]*?)```/g)) {
    const n = countOf(m[1], "\n");
    if (n >= BIG_FENCE_LINES) fences.push(n);
  }

  return {
    name: fm.name ?? path.basename(skillDir),
    path: rel(root, file),
    frontmatter: {
      parse_ok: parseOk,
      fields: order,
      unknown_fields: uniqueSorted(order.filter((k) => !KNOWN_SKILL_FIELDS.has(k))),
      // SQ8: everything beyond name, description, disable-model-invocation, argument-hint.
      extra_fields: uniqueSorted(order.filter((k) => !FOUR_KEYS.has(k))),
    },
    model_invoked: modelInvoked,
    user_invocable: !(String(fm["user-invocable"] ?? "").trim().toLowerCase() === "false"),
    description_chars: chars(desc),
    when_to_use_chars: chars(wtu),
    combined_chars: combined,
    over_1536: combined > DESCRIPTION_CAP,
    body_lines: bodyLines,
    body_chars: chars(body),
    est_passive_tokens: modelInvoked ? tokens(combined) : 0,
    est_body_tokens: tokens(chars(body)),
    big_fenced_blocks: fences,
    md_links: links,
    broken_links: broken,
    sibling_files_unlinked: unlinked,
    // WQ7: a skill that tells the model to call Workflow() has to say what to
    // do where there is no Workflow tool, or its autonomous mode is a dead end.
    mentions_workflow_tool: text.includes("Workflow("),
    names_subagent_fallback: /subagent/i.test(text),
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const CONTEXT_INJECTING_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "UserPromptExpansion"]);

/**
 * How a hook command stands on CS7: whether it runs Node on a script, which
 * guard it opens with (`loud` tells the person Node is missing, `quiet` stays
 * out of the way, null is none), and whether what follows the guard is a
 * plain `node "${CLAUDE_PLUGIN_ROOT}/<file>"` call.
 */
function nodeGuard(command) {
  const runsNode = /\bnode\b/.test(command) && /\.m?js\b/.test(command);
  let guard = null, rest = command;
  const loud = LOUD_GUARD_RE.exec(command);
  if (loud) {
    let said = null;
    try { said = JSON.parse(loud[1]).systemMessage; } catch { /* not a message the host can show */ }
    if (typeof said === "string" && said) { guard = "loud"; rest = command.slice(loud[0].length); }
  } else if (command.startsWith(QUIET_GUARD)) {
    guard = "quiet";
    rest = command.slice(QUIET_GUARD.length);
  }
  return { runsNode, guard, plainCall: NODE_CALL_RE.test(rest) };
}

/** Why a Node hook entry fails CS7, or null when it passes. */
function guardProblem(event, entry) {
  if (!entry.runs_node) return null;
  if (!entry.plain_node_call) return "not a guard followed by node \"${CLAUDE_PLUGIN_ROOT}/<file>\"";
  if (!entry.node_guard) return "no guard for a machine without Node";
  if (event === "SessionStart" && entry.node_guard !== "loud") return "SessionStart needs the guard that tells the person Node is missing";
  if (event === "SessionStart" && !entry.status_message) return "SessionStart command has no statusMessage";
  return null;
}

function scanHooks(root) {
  const file = path.join(root, "hooks", "hooks.json");
  if (!isFile(file)) return { present: false };
  let data;
  try { data = JSON.parse(readText(file) ?? ""); } catch { return { present: true, parse_ok: false }; }
  const hooksObj = data?.hooks ?? data;
  if (typeof hooksObj !== "object" || hooksObj === null || Array.isArray(hooksObj)) {
    return { present: true, parse_ok: false };
  }
  const entries = [], unguarded = [];
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      for (const h of group?.hooks ?? []) {
        const cmd = String(h?.command ?? "");
        const m = /\$\{CLAUDE_PLUGIN_ROOT\}["']?(\/[^\s"']+)/.exec(cmd);
        const { runsNode, guard, plainCall } = nodeGuard(cmd);
        const entry = {
          event,
          matcher: group.matcher ?? "",
          type: h?.type ?? "command",
          command: cmd.slice(0, 200),
          uses_plugin_root: cmd.includes("${CLAUDE_PLUGIN_ROOT}"),
          referenced_file_exists: m ? isFile(path.join(root, m[1].replace(/^\/+/, ""))) : null,
          injects_context: CONTEXT_INJECTING_EVENTS.has(event) || ["prompt", "agent"].includes(h?.type),
          runs_node: runsNode,
          node_guard: guard,
          plain_node_call: plainCall,
          status_message: Boolean(h?.statusMessage),
        };
        const problem = guardProblem(event, entry);
        if (problem) unguarded.push({ event, command: entry.command, problem });
        entries.push(entry);
      }
    }
  }
  return {
    present: true,
    parse_ok: true,
    hook_count: entries.length,
    events: uniqueSorted(entries.map((e) => e.event)),
    entries,
    context_injectors: entries.filter((e) => e.injects_context).length,
    missing_referenced_files: entries.filter((e) => e.referenced_file_exists === false).map((e) => e.command),
    node_commands: entries.filter((e) => e.runs_node).length,
    unguarded_node_commands: unguarded,
  };
}

// ---------------------------------------------------------------------------
// Workflows: regex signals over *.js under any workflows/ directory. These are
// hints for a grader to confirm; a regex cannot judge a barrier.
// ---------------------------------------------------------------------------

function scanWorkflow(root, file) {
  const text = readText(file) ?? "";
  const metaM = /export\s+const\s+meta\s*=/.test(text);
  const metaName = /name:\s*['"]([^'"]+)['"]/.exec(text);
  const phaseTitles = findAll(text, /\{\s*title:\s*['"]([^'"]+)['"]/g);
  const phaseCalls = findAll(text, /(?<!\.)phase\(\s*['"]([^'"]+)['"]/g);
  const titles = new Set(phaseTitles);
  const mismatch = uniqueSorted(phaseCalls.filter((c) => !titles.has(c)));
  const agentCalls = matchAll(text, /\bagent\(/g).length;
  const schemas = matchAll(text, /schema:/g).length;
  const models = {
    haiku: matchAll(text, /model:\s*['"]haiku['"]/g).length,
    sonnet: matchAll(text, /model:\s*['"]sonnet['"]/g).length,
    opus: matchAll(text, /model:\s*['"]opus['"]/g).length,
  };
  models.omitted = Math.max(agentCalls - (models.haiku + models.sonnet + models.opus), 0);
  const parallels = findAll(text, /^.*parallel\(.*$/gm);
  const lines = text.split("\n");
  let justified = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("parallel(") && !lines[i].trim().startsWith("//")) {
      const window = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
      if (window.includes("//")) justified++;
    }
  }
  return {
    path: rel(root, file),
    meta_ok: Boolean(metaM && metaName),
    meta_name: metaName ? metaName[1] : null,
    phase_titles: phaseTitles,
    phase_calls: phaseCalls,
    phase_title_mismatch: mismatch,
    has_args_coercion: /typeof\s+A\s*===\s*['"]string['"]/.test(text) || /JSON\.parse\(\s*args/.test(text),
    uses_date_now: text.includes("Date.now("),
    uses_math_random: text.includes("Math.random("),
    uses_new_date: /new\s+Date\s*\(\s*\)/.test(text),
    agent_calls: agentCalls,
    agent_calls_with_schema: schemas,
    models,
    parallel_calls: parallels.filter((l) => !l.trim().startsWith("//")).length,
    parallel_with_nearby_comment: justified,
    filter_boolean_uses: countOf(text, ".filter(Boolean)"),
    log_calls: matchAll(text, /(?<![.\w])log\(/g).length,
    note: "regex signals for a grader to confirm, not verdicts",
  };
}

// ---------------------------------------------------------------------------
// Lint, tree, README, changelog, manifest
// ---------------------------------------------------------------------------

function scanLint(root, allFiles) {
  const absPaths = [], parentEscapes = [], cruft = [];
  let pluginRootUses = 0, pluginDataUses = 0;
  // Built by concatenation so this scanner never flags its own source, or a
  // plugin that vendors it.
  const escapeNeedle = "${CLAUDE_PLUGIN_ROOT}" + "/..";
  for (const file of allFiles) {
    const base = path.basename(file);
    if (CRUFT_NAMES.has(base)) cruft.push(rel(root, file));
    if (!TEXT_EXTS.has(path.extname(file))) continue;
    const text = readText(file);
    if (text === null) continue;
    pluginRootUses += countOf(text, "${CLAUDE_PLUGIN_ROOT}");
    pluginDataUses += countOf(text, "${CLAUDE_PLUGIN_DATA}");
    text.split("\n").forEach((line, idx) => {
      for (const m of matchAll(line, ABS_PATH_RE)) {
        absPaths.push({ file: rel(root, file), line: idx + 1, match: m[1].slice(0, 120) });
      }
      if (line.includes(escapeNeedle)) {
        parentEscapes.push({ file: rel(root, file), line: idx + 1, match: line.trim().slice(0, 120) });
      }
    });
  }
  for (const dir of walkDirs(root)) {
    if (CRUFT_DIRS.has(path.basename(dir))) cruft.push(rel(root, dir) + "/");
  }
  return {
    absolute_paths: absPaths,
    parent_escapes: parentEscapes,
    plugin_root_uses: pluginRootUses,
    plugin_data_uses: pluginDataUses,
    cruft: uniqueSorted(cruft),
    own_marketplace_json: isFile(path.join(root, ".claude-plugin", "marketplace.json")),
  };
}

function scanTree(root, allFiles) {
  const byTop = {}, dirCounts = {};
  let depth = 0;
  for (const file of allFiles) {
    const parts = rel(root, file).split("/");
    depth = Math.max(depth, parts.length);
    byTop[parts[0]] = (byTop[parts[0]] ?? 0) + 1;
    const d = parts.slice(0, -1).join("/") || ".";
    dirCounts[d] = (dirCounts[d] ?? 0) + 1;
  }
  const overstuffed = Object.entries(dirCounts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, n]) => n > OVERSTUFFED).map(([dir, files]) => ({ dir, files }));
  return { total_files: allFiles.length, max_depth: depth, by_top_dir: byTop, overstuffed_dirs: overstuffed };
}

function scanReadme(root) {
  const file = path.join(root, "README.md");
  if (!isFile(file)) return { present: false };
  const text = readText(file) ?? "";
  const headings = findAll(text, /^#+\s+(.+)$/gm);
  const low = headings.map((h) => h.toLowerCase());
  return {
    present: true,
    lines: countOf(text, "\n") + 1,
    headings,
    has_install_heading: low.some((h) => h.includes("install")),
    // History kept here is history in the wrong place; MH3 reads CHANGELOG.md.
    changelog_section: /^## Changelog\s*$/m.test(text),
  };
}

// History lives in CHANGELOG.md at the plugin root, newest first, so it ships
// with the installed copy and the README stays about using the plugin. The
// top entry is the first bullet, and it opens with the version it describes.
function scanChangelog(root, manifestVersion) {
  const file = path.join(root, "CHANGELOG.md");
  if (!isFile(file)) return { present: false };
  const first = /^[-*] .*$/m.exec(readText(file) ?? "")?.[0] ?? "";
  const topVer = /^[-*] +\**v?(\d+\.\d+\.\d+)/.exec(first)?.[1] ?? null;
  return {
    present: true,
    top_version: topVer,
    matches_manifest: Boolean(topVer && manifestVersion && topVer === manifestVersion),
  };
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function scanManifest(root) {
  const file = path.join(root, ".claude-plugin", "plugin.json");
  if (!isFile(file)) return { present: false, parse_ok: false, missing_fields: ["<file>"] };
  let data = null;
  try { data = JSON.parse(readText(file) ?? ""); } catch { /* reported below */ }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { present: true, parse_ok: false, missing_fields: ["<unparseable>"] };
  }
  const missing = ["name", "version", "description", "author"].filter((f) => !(f in data));
  return {
    present: true,
    parse_ok: true,
    name: data.name ?? null,
    version: data.version ?? null,
    version_semver_ok: SEMVER_RE.test(String(data.version ?? "")),
    description_chars: chars(String(data.description ?? "")),
    author_ok: typeof data.author === "object" && data.author !== null && !Array.isArray(data.author) && "name" in data.author,
    keywords: (data.keywords ?? []).length,
    name_matches_dir: data.name === path.basename(root),
    missing_fields: missing,
  };
}

// ---------------------------------------------------------------------------
// Census + footprint + orphans
// ---------------------------------------------------------------------------

/** The interpreter line of a file with no extension, or "" when it has none. */
const shebangOf = (file) => /^#!(.*)/.exec((readText(file) ?? "").slice(0, 200))?.[1]?.trim() ?? "";

function scanComponents(root, skills, workflows) {
  const countMd = (d) => {
    const p = path.join(root, d);
    return isDir(p) ? fs.readdirSync(p).filter((f) => f.endsWith(".md")).length : 0;
  };
  const scriptFiles = [], browserAssets = [], nonNode = [];
  for (const file of walkFiles(root)) {
    const r = rel(root, file);
    const parts = r.split("/");
    if (r.includes(".claude-plugin")) continue;
    const ext = path.extname(file);
    if (!ext) {
      const shebang = shebangOf(file);
      if (!shebang) continue;
      scriptFiles.push(r);
      if (!/\bnode\b/.test(shebang)) nonNode.push(r);
      continue;
    }
    if (!NODE_EXTS.has(ext) && !NON_NODE_EXTS.has(ext)) continue;
    // A workflow is a component in its own right and is censused separately.
    if (ext === ".js" && parts.includes("workflows")) continue;
    // Browser code an `assets/` directory ships to a page is not a script the
    // plugin runs. It is still censused, in its own list, so it never simply
    // disappears.
    if (BROWSER_EXTS.has(ext) && parts.includes("assets")) { browserAssets.push(r); continue; }
    scriptFiles.push(r);
    if (NON_NODE_EXTS.has(ext)) nonNode.push(r);
  }
  return {
    skills: skills.length,
    commands: countMd("commands"),
    agents: countMd("agents"),
    hooks: isFile(path.join(root, "hooks", "hooks.json")),
    mcp: isFile(path.join(root, ".mcp.json")),
    workflows: workflows.length,
    scripts: scriptFiles.length,
    script_files: scriptFiles.sort(),
    non_node_scripts: nonNode.sort(),
    browser_assets: browserAssets.sort(),
    monitors: isFile(path.join(root, "monitors", "monitors.json")),
    bin: isDir(path.join(root, "bin")),
    assets_or_templates_dirs: uniqueSorted([...walkDirs(root)]
      .filter((d) => ["assets", "templates"].includes(path.basename(d)))
      .map((d) => rel(root, d))),
    output_styles: countMd("output-styles"),
    settings_json: isFile(path.join(root, "settings.json")),
    root_claude_md: isFile(path.join(root, "CLAUDE.md")),
  };
}

function scanAgentsPassive(root) {
  const out = [];
  const agentsDir = path.join(root, "agents");
  if (!isDir(agentsDir)) return out;
  for (const f of fs.readdirSync(agentsDir).sort()) {
    if (!f.endsWith(".md")) continue;
    const { fields } = parseFrontmatter(readText(path.join(agentsDir, f)) ?? "");
    const desc = asText(fields.description);
    out.push({ agent: f, description_chars: chars(desc), est_passive_tokens: tokens(chars(desc)) });
  }
  return out;
}

function buildFootprint(skills, agentsPassive, components) {
  const perSource = [];
  for (const s of skills) {
    if (s.model_invoked) perSource.push({ source: `${s.path} (description)`, tokens: s.est_passive_tokens });
  }
  for (const a of agentsPassive) {
    perSource.push({ source: `agents/${a.agent} (description)`, tokens: a.est_passive_tokens });
  }
  if (components.mcp) perSource.push({ source: ".mcp.json tool names (deferred schemas)", tokens: 30 });
  return {
    passive_tokens_est: perSource.reduce((n, p) => n + p.tokens, 0),
    per_source: perSource,
    cap_violations: skills.filter((s) => s.over_1536).map((s) => s.path),
    on_invoke: skills.map((s) => ({
      skill: s.path,
      body_tokens_est: s.est_body_tokens,
      body_lines: s.body_lines,
      over_500_lines: s.body_lines > BODY_LINE_GUIDANCE,
    })),
    note: EST_NOTE,
  };
}

function scanOrphans(root, allFiles) {
  // A support file is orphaned when no OTHER text file in the plugin mentions
  // its basename or (for code) its module stem. Structural files are exempt:
  // CHANGELOG.md is the history MH3 requires, read by people and the grader,
  // not reached through a link.
  const texts = new Map();
  for (const file of allFiles) {
    if (TEXT_EXTS.has(path.extname(file))) texts.set(file, readText(file) ?? "");
  }
  const corpus = [...texts.values()].join("\n");
  const exempt = new Set(["plugin.json", "README.md", "CHANGELOG.md", "SKILL.md", "hooks.json",
    "marketplace.json", ".gitignore", "LICENSE", "CLAUDE.md",
    "__init__.py", "index.md", "index.html"]);
  const orphans = [];
  for (const file of allFiles) {
    const base = path.basename(file);
    if (exempt.has(base) || rel(root, file).includes(".claude-plugin")) continue;
    const own = texts.get(file) ?? "";
    if (countOf(corpus, base) - countOf(own, base) > 0) continue;
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    // Code modules are commonly referenced by stem: extensionless imports,
    // shell sourcing, package imports. Match the stem.
    if ([".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".sh", ".css"].includes(ext)) {
      const stemRe = new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
      if (matchAll(corpus, stemRe).length - matchAll(own, stemRe).length > 0) continue;
    }
    orphans.push(rel(root, file));
  }
  return orphans.sort();
}

// ---------------------------------------------------------------------------
// Mechanical grades + N/A + gates
// ---------------------------------------------------------------------------

function bandGrade(value, bands, dflt = 0) {
  for (const [limit, grade] of bands) if (value <= limit) return grade;
  return dflt;
}

/** 4 for none, 2 for one, 0 for more: the shape most mechanical checks take. */
const tiered = (n) => (n === 0 ? 4 : n === 1 ? 2 : 0);

function mechanicalGrades(scan) {
  const g = {};

  const broken = scan.skills.reduce((n, s) => n + s.broken_links.length, 0);
  g.SQ7 = { grade: tiered(broken), basis: `${broken} broken relative link(s)` };

  const extra = scan.skills.filter((s) => s.frontmatter.extra_fields.length);
  g.SQ8 = {
    grade: tiered(extra.length),
    basis: `${extra.length} skill(s) with frontmatter beyond name/description/disable-model-invocation/argument-hint: `
      + JSON.stringify(extra.slice(0, 5).map((s) => `${s.path}: ${s.frontmatter.extra_fields.join(", ")}`)),
  };

  const orphanN = scan.orphans.length;
  g.CS3 = {
    grade: orphanN === 0 ? 4 : orphanN <= 2 ? 2 : 0,
    basis: `${orphanN} orphaned file(s): ${JSON.stringify(scan.orphans.slice(0, 5))}`,
  };

  if (scan.hooks.node_commands) {
    const bad = scan.hooks.unguarded_node_commands;
    g.CS7 = {
      grade: tiered(bad.length),
      basis: `${bad.length}/${scan.hooks.node_commands} Node hook command(s) off the guard: `
        + JSON.stringify(bad.slice(0, 5).map((b) => `${b.event}: ${b.problem}`)),
    };
  }

  const wf = scan.workflow_static;
  if (wf.length) {
    const metaBad = wf.filter((w) => !w.meta_ok || w.phase_title_mismatch.length).length;
    g.WQ1 = { grade: tiered(metaBad), basis: `${metaBad}/${wf.length} workflow(s) with meta/phase issues` };
    const clock = wf.filter((w) => w.uses_date_now || w.uses_math_random || w.uses_new_date).length;
    const noCoerce = wf.filter((w) => !w.has_args_coercion).length;
    if (clock) g.WQ2 = { grade: 0, basis: `${clock} workflow(s) use Date.now/Math.random/new Date (breaks resume)` };
    else if (noCoerce) g.WQ2 = { grade: 2, basis: `${noCoerce} workflow(s) without defensive args coercion` };
    else g.WQ2 = { grade: 4, basis: "all workflows coerce args and avoid clock/random" };
  }

  const calling = scan.skills.filter((s) => s.mentions_workflow_tool);
  if (calling.length) {
    const bare = calling.filter((s) => !s.names_subagent_fallback);
    g.WQ7 = {
      grade: tiered(bare.length),
      basis: `${bare.length}/${calling.length} skill(s) call Workflow() with no subagent fallback named: `
        + JSON.stringify(bare.slice(0, 5).map((s) => s.path)),
    };
  }

  const lint = scan.lint;
  const viol = lint.absolute_paths.length + lint.parent_escapes.length;
  g.AN2 = {
    grade: viol === 0 ? 4 : 0,
    basis: `${lint.absolute_paths.length} absolute path(s), ${lint.parent_escapes.length} parent escape(s)`,
  };

  const an5 = lint.cruft.length + (scan.components.root_claude_md ? 1 : 0) + (lint.own_marketplace_json ? 1 : 0);
  g.AN5 = {
    grade: tiered(an5),
    basis: `cruft=${JSON.stringify(lint.cruft)}, root CLAUDE.md=${scan.components.root_claude_md} (never loaded), `
      + `own marketplace.json=${lint.own_marketplace_json}`,
  };

  const passive = scan.context_footprint.passive_tokens_est;
  g.CF1 = { grade: bandGrade(passive, PASSIVE_TOKEN_BANDS), basis: `~${passive} est passive tokens (${EST_NOTE})` };

  const caps = scan.context_footprint.cap_violations.length;
  g.CF2 = { grade: caps === 0 ? 4 : 1, basis: `${caps} skill(s) over the ${DESCRIPTION_CAP}-char combined cap` };

  const over = scan.context_footprint.on_invoke.filter((o) => o.over_500_lines);
  g.CF4 = {
    grade: tiered(over.length),
    basis: `${over.length} SKILL.md bodies over ${BODY_LINE_GUIDANCE} lines: `
      + JSON.stringify(over.slice(0, 3).map((o) => o.skill)),
  };

  const man = scan.manifest;
  if (!man.parse_ok) g.MH1 = { grade: 0, basis: "plugin.json missing or unparseable" };
  else {
    const deductions = man.missing_fields.length + (man.version_semver_ok ? 0 : 1)
      + (man.name_matches_dir ? 0 : 1) + (man.author_ok ? 0 : 1);
    g.MH1 = {
      grade: Math.max(4 - deductions, 0),
      basis: `missing=${JSON.stringify(man.missing_fields)}, semver=${man.version_semver_ok}, `
        + `name==dir=${man.name_matches_dir}, author=${man.author_ok}`,
    };
  }

  const cl = scan.changelog;
  const inReadme = scan.readme.changelog_section === true;
  if (!cl.present) g.MH3 = { grade: 0, basis: `no CHANGELOG.md${inReadme ? " (a README changelog does not count)" : ""}` };
  else if (!cl.matches_manifest) {
    g.MH3 = {
      grade: 2,
      basis: cl.top_version
        ? `CHANGELOG.md top entry (${cl.top_version}) != manifest (${man.version ?? "none"})`
        : "CHANGELOG.md's first entry does not start with a version",
    };
  } else if (inReadme) g.MH3 = { grade: 2, basis: `CHANGELOG.md top ${cl.top_version} == manifest, but the README still carries a "## Changelog" section` };
  else g.MH3 = { grade: 4, basis: `CHANGELOG.md top ${cl.top_version} == manifest` };

  // A declared exception says so in the file itself. One that does not is
  // drift, and that is what MH5 is looking for.
  const offStack = scan.components.non_node_scripts;
  const undeclared = offStack.filter((f) => !DEBT_RE.test((readText(path.join(scan.plugin_path, f)) ?? "").slice(0, 2000)));
  const declared = offStack.filter((f) => !undeclared.includes(f));
  g.MH5 = {
    grade: undeclared.length === 0 ? 4 : 0,
    basis: `${undeclared.length} shipped script(s) that do not run on Node and declare no debt marker: ${JSON.stringify(undeclared.slice(0, 5))}`
      + (declared.length ? `; ${declared.length} declared exception(s): ${JSON.stringify(declared.slice(0, 5))}` : ""),
  };

  return g;
}

function computeNa(scan) {
  const naDims = [], naChecks = [];
  if (!scan.workflow_static.length) naDims.push("WQ");
  if (!scan.hooks.present) naChecks.push("CS1", "CF5");
  const c = scan.components;
  if (!(c.commands || c.agents || c.mcp)) naChecks.push("CS4");
  // CS7 has nothing to judge until a hook runs Node.
  if (!scan.hooks.node_commands) naChecks.push("CS7");
  // WQ7 only means something where a skill reaches for the tool.
  if (!scan.skills.some((s) => s.mentions_workflow_tool)) naChecks.push("WQ7");
  return { dimensions: naDims, checks: naChecks };
}

function computeGates(scan) {
  const gates = [];
  if (!scan.manifest.parse_ok) {
    gates.push({
      id: "manifest", cap: "rework",
      reason: "plugin.json missing or unparseable: the plugin cannot be versioned or safely installed",
    });
  }
  if (scan.lint.absolute_paths.length || scan.lint.parent_escapes.length) {
    gates.push({
      id: "abs-path", cap: "rework",
      reason: "shipped absolute machine paths or parent-dir escapes break cached installs",
    });
  }
  return gates;
}

// ---------------------------------------------------------------------------
// Scan driver
// ---------------------------------------------------------------------------

export function runScan(target) {
  const root = path.resolve(target);
  const allFiles = [...walkFiles(root)].sort();
  const skills = findSkillFiles(root).map((p) => scanSkill(root, p));
  const workflows = allFiles.filter((p) => p.endsWith(".js") && rel(root, p).split("/").includes("workflows"))
    .map((p) => scanWorkflow(root, p));
  const manifest = scanManifest(root);
  const components = scanComponents(root, skills, workflows);
  const agentsPassive = scanAgentsPassive(root);
  const scan = {
    plugin_path: root,
    manifest,
    components,
    skills,
    agents_passive: agentsPassive,
    context_footprint: buildFootprint(skills, agentsPassive, components),
    hooks: scanHooks(root),
    workflow_static: workflows,
    lint: scanLint(root, allFiles),
    tree: scanTree(root, allFiles),
    readme: scanReadme(root),
    changelog: scanChangelog(root, manifest.version),
    orphans: scanOrphans(root, allFiles),
  };
  scan.na = computeNa(scan);
  const naDims = new Set(scan.na.dimensions), naChecks = new Set(scan.na.checks);
  scan.applicable_judgment_checks = Object.entries(CHECKS)
    .filter(([cid, [dim, kind]]) => kind === "j" && !naDims.has(dim) && !naChecks.has(cid))
    .map(([cid]) => cid).sort();
  scan.per_skill_checks = [...PER_SKILL_CHECKS].sort();
  scan.mechanical_grades = mechanicalGrades(scan);
  scan.gates = computeGates(scan);
  return scan;
}

// ---------------------------------------------------------------------------
// Score mode
// ---------------------------------------------------------------------------

const tierFor = (composite) => (VERDICT_TIERS.find(([floor]) => composite >= floor) ?? [0, "avoid"])[1];
const worstTier = (a, b) => (TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b);

function computeFixDeltas(scan, gradesDoc, baseComposite) {
  // For every improvable check, the composite if just that item were raised to
  // grade 4: the hypothetical-regrade loop, owned by the script so no consumer
  // walks it by hand. Per-skill checks get one candidate per entry.
  const candidates = [];
  (gradesDoc.grades ?? []).forEach((entry, i) => {
    if ((entry.grade ?? 4) < 4) candidates.push(["j", i, entry.check, entry.skill]);
  });
  for (const [cid, m] of Object.entries(scan.mechanical_grades)) {
    if (m.grade < 4) candidates.push(["m", null, cid, null]);
  }

  const deltas = [];
  for (const [kind, idx, cid, skill] of candidates) {
    let hypoScan = scan, hypoGrades = gradesDoc;
    if (kind === "j") {
      hypoGrades = structuredClone(gradesDoc);
      hypoGrades.grades[idx].grade = 4;
    } else {
      hypoScan = structuredClone(scan);
      hypoScan.mechanical_grades[cid].grade = 4;
    }
    const hypo = runScore(hypoScan, hypoGrades, false);
    deltas.push({
      check: cid,
      ...(skill ? { skill } : {}),
      kind,
      delta: round(hypo.composite - baseComposite, 1),
      verdict_after: hypo.verdict,
    });
  }
  deltas.sort((a, b) => b.delta - a.delta);
  return deltas;
}

export function runScore(scan, gradesDoc, withDeltas = true) {
  const naDims = new Set(scan.na.dimensions);
  const naChecks = new Set(scan.na.checks);
  const mech = scan.mechanical_grades;

  // collect judgment grades; per-skill checks may have several entries
  const judgment = {};
  for (const entry of gradesDoc.grades ?? []) {
    const cid = entry.check;
    if (!Object.hasOwn(CHECKS, cid ?? "")) throw new Bail(`error: unknown check id in grades.json: ${cid}`);
    const grade = entry.grade;
    if (typeof grade !== "number" || !(grade >= 0 && grade <= 4)) {
      throw new Bail(`error: grade for ${cid} must be a number 0-4, got ${JSON.stringify(grade)}`);
    }
    (judgment[cid] ??= []).push(entry);
  }

  const applicableJ = Object.entries(CHECKS)
    .filter(([cid, [dim, kind]]) => kind === "j" && !naDims.has(dim) && !naChecks.has(cid))
    .map(([cid]) => cid);
  const missing = applicableJ.filter((cid) => !(cid in judgment)).sort();
  if (missing.length) {
    throw new Bail("error: grades.json is missing grades for applicable judgment checks: "
      + missing.join(", ")
      + ". Grade every applicable check (see references/rubric.md) and re-run");
  }

  const dimsOut = [];
  const dimScores = {};
  for (const [dim, dmeta] of Object.entries(DIMENSIONS)) {
    const applicable = !naDims.has(dim);
    const checksOut = [];
    let num = 0, den = 0;
    for (const [cid, [cdim, kind, weight, label]] of Object.entries(CHECKS)) {
      if (cdim !== dim) continue;
      // A mechanical check with no grade had nothing to judge (WQ1 with no workflows).
      if (naChecks.has(cid) || !applicable || (kind === "m" && !(cid in mech))) {
        checksOut.push({ id: cid, label, kind, weight, na: true });
        continue;
      }
      let grade, evidence;
      if (kind === "m") {
        grade = mech[cid].grade;
        evidence = mech[cid].basis;
      } else {
        const entries = judgment[cid];
        grade = entries.reduce((n, e) => n + e.grade, 0) / entries.length;
        evidence = entries.map((e) => (e.skill ? `[${e.skill}] ` : "") + String(e.evidence ?? "")).join("; ").slice(0, 600);
      }
      const points = grade * 25;
      num += points * weight;
      den += weight;
      checksOut.push({ id: cid, label, kind, weight, grade: round(grade, 2), points: round(points, 1), evidence });
    }
    const score = den ? round(num / den, 1) : null;
    dimsOut.push({ id: dim, label: dmeta.label, weight: dmeta.weight, applicable, score, checks: checksOut });
    if (applicable && score !== null) dimScores[dim] = score;
  }

  const totalW = Object.keys(dimScores).reduce((n, d) => n + DIMENSIONS[d].weight, 0);
  for (const d of dimsOut) d.norm_weight = d.applicable ? round(DIMENSIONS[d.id].weight / totalW * 100, 1) : 0;
  const composite = round(Object.entries(dimScores)
    .reduce((n, [d, s]) => n + s * DIMENSIONS[d].weight, 0) / totalW, 1);

  let verdict = tierFor(composite);
  let cappedBy = null;
  const gates = [...scan.gates];
  for (const f of gradesDoc.findings ?? []) {
    if (f.gate === "injection-autoloaded") {
      gates.push({ id: "injection-autoloaded", cap: "avoid", reason: "prompt-injection content in an auto-loaded surface: " + (f.title ?? "") });
    } else if (f.gate === "injection") {
      gates.push({ id: "injection", cap: "rework", reason: "prompt-injection content in an on-invoke surface: " + (f.title ?? "") });
    } else if (f.severity === "critical") {
      gates.push({ id: "critical-finding", cap: "rework", reason: "critical finding: " + (f.title ?? "") });
    }
  }
  for (const gate of gates) {
    const capped = worstTier(verdict, gate.cap);
    if (capped !== verdict) { verdict = capped; cappedBy = gate; }
    else if (verdict === gate.cap && cappedBy === null && tierFor(composite) !== verdict) cappedBy = gate;
  }

  return {
    dimensions: dimsOut,
    composite,
    // pre-computed for the scorecard donut (r=54, circumference 339.292) so the
    // report filler never does arithmetic
    composite_dash: round(composite / 100 * 339.292, 3),
    verdict,
    verdict_uncapped: tierFor(composite),
    verdict_capped_by: cappedBy,
    gates,
    na: scan.na,
    findings: gradesDoc.findings ?? [],
    // each improvable check's composite gain if raised to 4, sorted: consumers
    // rank fixes from here, never by hand
    ...(withDeltas ? { fix_deltas: computeFixDeltas(scan, gradesDoc, composite) } : {}),
    note: EST_NOTE,
  };
}

// ---------------------------------------------------------------------------

function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) { console.log(USAGE); return; }
  let gradesFile = null, target = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--score") {
      gradesFile = argv[++i];
      if (!gradesFile) throw new Bail(`--score needs a grades file\n${USAGE}`, 2);
    }
    else if (a.startsWith("--score=")) gradesFile = a.slice("--score=".length);
    else if (a.startsWith("--")) throw new Bail(`unknown option ${a}\n${USAGE}`, 2);
    else if (target === null) target = a;
    else throw new Bail(`one plugin path at a time, got ${target} and ${a}\n${USAGE}`, 2);
  }
  if (!target) throw new Bail(USAGE, 2);
  if (!isDir(target)) throw new Bail(`error: not a directory: ${target}`);
  const scan = runScan(target);

  if (!gradesFile) { console.log(JSON.stringify(scan, null, 1)); return; }
  let gradesDoc;
  try { gradesDoc = JSON.parse(fs.readFileSync(gradesFile, "utf8")); }
  catch (e) { throw new Bail(`error: cannot read grades file ${gradesFile}: ${e.message}`); }
  if (typeof gradesDoc !== "object" || gradesDoc === null || Array.isArray(gradesDoc)) {
    throw new Bail(`error: grades file ${gradesFile} is not a JSON object with a grades list`);
  }
  console.log(JSON.stringify(runScore(scan, gradesDoc), null, 1));
}

const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(import.meta.filename); } catch { return false; } })();
if (invoked) {
  try { main(process.argv.slice(2)); }
  catch (e) {
    if (!(e instanceof Bail)) throw e;
    console.error(e.message);
    process.exitCode = e.code;
  }
}
