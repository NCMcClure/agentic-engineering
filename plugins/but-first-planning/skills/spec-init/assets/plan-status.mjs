#!/usr/bin/env node
// Plan-status funnel: the single deterministic way to read and write the
// completion status of an epic / sprint / issue across every plan surface.
//
// Node 22 stdlib only. Lives beside `verify-plan-tree.mjs` in
// `.agents/plan/plan/` and roots itself the same way.
//
//   plan-status.mjs set   <EE-SS-II> <status> [--evidence "..."] [--cancelled]
//   plan-status.mjs check [<coords>]
//
// `set` mutates ONE issue's status and then deterministically propagates it:
//
//   1. the issue file's `**Status**:` field (and its `## Acceptance criteria` boxes),
//   2. the issue's row in the parent sprint's `## Issues` table,
//   3. the parent `sprint.md` `**Status**:` field (rolled up from its issues),
//   4. the sprint's row in the grandparent `epic.md` `## Sprints` table,
//   5. the `epic.md` `**Status**:` field (rolled up from its sprints),
//   6. the epic's row in `plan/index.md`'s `## Epics` table,
//
// then, when `.agents/plan/tracker.md` declares GitHub or GitLab, moves the
// issue's ticket to match through `tracker.mjs` (close or reopen, the status
// labels, the Project board's Status, a comment carrying a blocked reason).
// Sprint and epic statuses are NEVER set directly: they are always derived
// from their children by `rollup()`.
//
// With `--evidence` on a `done` transition a verified-complete row is appended
// to `.agents/plan/progress/completed/<epic>.md` (build-next-issue's ledger;
// build-sprint builders flip status WITHOUT evidence so unverified rows never
// enter the ledger).
//
// `check` recomputes the rolled-up truth for a node (issue / sprint / epic /
// whole tree) and verifies every surface agrees. It exits 0 only when the node
// rolls up to `done` and all surfaces agree. With a non-done or inconsistent
// node it prints what is off and exits 1.
//
// `--cancelled` marks a done issue as dropped: its ticket closes as not
// planned, and no ledger row is written. A tracker failure (no `gh` or
// `glab`, no network, an `<unassigned>` issue) is a warning, never fatal: the
// markdown surfaces are always written first, so the contract holds offline.
//
// Exit codes: 0 = success / consistent-and-done; 1 = check found not-done or
// drift; 2 = structural failure (bad coords, bad status, malformed table row).
import fs from "node:fs";
import path from "node:path";

const PLAN_ROOT = import.meta.dirname; //            .agents/plan/plan/
const PLAN_DIR = path.dirname(PLAN_ROOT); //         .agents/plan/
const REPO_ROOT = path.dirname(path.dirname(PLAN_DIR)); // the repository
const INDEX_MD = path.join(PLAN_ROOT, "index.md");
const TRACKER_MD = path.join(PLAN_DIR, "tracker.md");
const COMPLETED_DIR = path.join(PLAN_DIR, "progress", "completed");

const STATUSES = ["not-started", "in-progress", "blocked", "done"];

const ISSUE_FILE_RE = /^([0-9]{2})_issue_[A-Z][A-Z0-9-]+\.md$/;
const STATUS_FIELD_RE = /(\*\*Status\*\*:[ \t]*)(\S+)/;
// `**GitHub**:` is the name the field had before 5.0; a tree that still
// carries it is read the same way.
const TRACKER_FIELD_RE = /\*\*(?:Tracker|GitHub)\*\*:[ \t]*(\S+)/;
const H1_RE = /^#\s+(.*?)\s*$/m;
const ACCEPTANCE_SECTION_RE = /(^## Acceptance criteria\s*$)([\s\S]*?)(?=^## |(?![\s\S]))/m;

class Die extends Error {}
const warn = (msg) => process.stderr.write(`WARN: ${msg}\n`);
const die = (msg) => { throw new Die(msg); };

const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const dirs = (p) => fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const files = (p) => fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();

// --------------------------------------------------------------------------
// Coordinate resolution
// --------------------------------------------------------------------------
export function parseCoords(raw) {
  const parts = raw.trim().split(/[-/]/).filter(Boolean);
  for (const p of parts) if (!/^[0-9]{2}$/.test(p)) die(`coordinate part '${p}' is not a two-digit number (got '${raw}')`);
  if (parts.length < 1 || parts.length > 3) die(`coordinates must be EE, EE-SS, or EE-SS-II (got '${raw}')`);
  return parts;
}

const prefixed = (names, nn) => names.filter((n) => n.startsWith(`${nn}-`));

function epicDirFor(ee) {
  const matches = prefixed(dirs(PLAN_ROOT), ee);
  if (!matches.length) die(`no epic directory starting with '${ee}-' under ${PLAN_ROOT}`);
  if (matches.length > 1) die(`ambiguous epic prefix '${ee}-': ${JSON.stringify(matches)}`);
  return path.join(PLAN_ROOT, matches[0]);
}

function sprintDirFor(epicDir, ss) {
  const matches = prefixed(dirs(epicDir), ss);
  if (!matches.length) die(`no sprint directory starting with '${ss}-' under ${path.basename(epicDir)}`);
  if (matches.length > 1) die(`ambiguous sprint prefix '${ss}-': ${JSON.stringify(matches)}`);
  return path.join(epicDir, matches[0]);
}

function issueFileFor(sprintDir, ii) {
  const issuesDir = path.join(sprintDir, "issues");
  if (!isDir(issuesDir)) die(`no issues/ directory under ${path.basename(sprintDir)}`);
  const matches = files(issuesDir).filter((f) => f.startsWith(`${ii}_issue_`));
  if (!matches.length) die(`no issue file starting with '${ii}_issue_' under ${path.basename(sprintDir)}/issues`);
  if (matches.length > 1) die(`ambiguous issue prefix '${ii}_': ${JSON.stringify(matches)}`);
  return path.join(issuesDir, matches[0]);
}

/** [epicDir, sprintDir, issueFile] from coordinates or a direct path. */
function resolveIssuePath(arg) {
  if (arg.endsWith(".md") || arg.includes("/") || arg.includes("\\")) {
    const candidate = path.resolve(arg);
    if (isFile(candidate) && ISSUE_FILE_RE.test(path.basename(candidate))) {
      const sprintDir = path.dirname(path.dirname(candidate));
      return [path.dirname(sprintDir), sprintDir, candidate];
    }
    // Not a real issue path: fall through to coordinate parsing.
  }
  const parts = parseCoords(arg);
  if (parts.length !== 3) die(`\`set\` needs full issue coordinates EE-SS-II (got '${arg}')`);
  const epicDir = epicDirFor(parts[0]);
  const sprintDir = sprintDirFor(epicDir, parts[1]);
  return [epicDir, sprintDir, issueFileFor(sprintDir, parts[2])];
}

// --------------------------------------------------------------------------
// Status reading and roll-up
// --------------------------------------------------------------------------
const readStatusField = (p) => STATUS_FIELD_RE.exec(read(p))?.[2] ?? null;

function issueStatuses(sprintDir) {
  const issuesDir = path.join(sprintDir, "issues");
  const out = [];
  for (const name of files(issuesDir)) {
    if (!ISSUE_FILE_RE.test(name)) continue;
    const s = readStatusField(path.join(issuesDir, name));
    if (s) out.push(s);
  }
  return out;
}

const sprintDirs = (epicDir) => dirs(epicDir).filter((n) => /^\d{2}-/.test(n)).map((n) => path.join(epicDir, n));
const epicDirs = () => dirs(PLAN_ROOT).filter((n) => /^\d{2}-/.test(n)).map((n) => path.join(PLAN_ROOT, n));

function sprintStatuses(epicDir) {
  const out = [];
  for (const sd of sprintDirs(epicDir)) {
    const sm = path.join(sd, "sprint.md");
    if (!exists(sm)) continue;
    const s = readStatusField(sm);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Derive a parent's status from its children's, deterministically.
 * `in-progress` is evaluated BEFORE `blocked`, so a node with any active work
 * reads in-progress rather than being mislabeled blocked; `blocked` is reserved
 * for "something is blocked and nothing is moving".
 */
export function rollup(children) {
  if (!children.length) return "not-started";
  if (children.every((c) => c === "done")) return "done";
  if (children.every((c) => c === "not-started")) return "not-started";
  if (children.some((c) => c === "in-progress")) return "in-progress";
  if (children.some((c) => c === "done") && children.every((c) => c === "done" || c === "not-started")) return "in-progress";
  if (children.some((c) => c === "blocked")) return "blocked";
  return "in-progress";
}

// --------------------------------------------------------------------------
// Markdown rewriting
// --------------------------------------------------------------------------
function setStatusField(text, status) {
  if (!STATUS_FIELD_RE.test(text)) { warn("no `**Status**:` field found to update"); return text; }
  return text.replace(STATUS_FIELD_RE, (_m, lead) => lead + status);
}

/** Tick or untick every checkbox inside the `## Acceptance criteria` section only. */
function setAcceptanceBoxes(text, done) {
  return text.replace(ACCEPTANCE_SECTION_RE, (_m, head, body) =>
    head + (done ? body.replace(/-\s\[\s\]/g, "- [x]") : body.replace(/-\s\[[xX]\]/g, "- [ ]")));
}

/**
 * Rewrite ONLY the trailing Status cell of the table row whose link matches.
 * Splits the matched row on `|` and replaces the last data cell, so adjacent
 * cells (Type, Title, Tracker, counts) are never disturbed.
 */
function setTableCell(text, linkNeedle, status, what) {
  const lines = text.split(/(?<=\n)/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(linkNeedle)) continue;
    const eol = lines[i].endsWith("\n") ? "\n" : "";
    const stripped = eol ? lines[i].slice(0, -1) : lines[i];
    if ((stripped.match(/\|/g) ?? []).length < 3) { warn(`${what}: matched row is not a well-formed table row; skipping`); continue; }
    // cells[0] and the last cell are the empty strings outside the outer pipes.
    const cells = stripped.split("|");
    cells[cells.length - 2] = ` ${status} `;
    lines[i] = cells.join("|") + eol;
    return lines.join("");
  }
  warn(`${what}: no table row containing '${linkNeedle}' found`);
  return lines.join("");
}

const writeIfChanged = (p, next, prev) => { if (next !== prev) fs.writeFileSync(p, next); };

// --------------------------------------------------------------------------
// Tracker (GitHub or GitLab, best effort)
// --------------------------------------------------------------------------
const trackerRef = (issueFile) => TRACKER_FIELD_RE.exec(read(issueFile))?.[1] ?? "";
/** `#42` when the issue is published, else null. */
const publishedRef = (issueFile) => /^#\d+$/.exec(trackerRef(issueFile))?.[0] ?? null;

/**
 * Moves the issue's ticket to match, after the markdown is written. Every
 * failure is a warning. `tracker.mjs` is loaded only when tracker.md names a
 * forge, so a local-markdown workspace needs neither it nor a forge CLI.
 */
async function trackerSync({ issueFile, status, reason, cancelled }, io) {
  if (!exists(TRACKER_MD) || !/#\s*Issue tracker:\s*Git(?:Hub|Lab)/i.test(read(TRACKER_MD))) return;
  let tracker;
  try { tracker = await import("./tracker.mjs"); } catch (e) {
    warn(`tracker.mjs could not be loaded beside this script (${e.code ?? e.message}); the tracker was not updated (markdown already updated)`);
    return;
  }
  const config = tracker.readTracker(read(TRACKER_MD));
  if (config.mode === "local") return;
  const forge = config.mode === "gitlab" ? "GitLab" : "GitHub";
  const num = tracker.refNumber(trackerRef(issueFile));
  if (!num) { warn(`${path.basename(issueFile)}: tracker ref is <unassigned>, publish the sprint (plan-publish) before status syncs to ${forge}`); return; }
  const provider = tracker.providerFor(config, REPO_ROOT, io);
  for (const w of tracker.syncStatus(provider, config, num, status, { reason, cancelled }, io)) warn(`${forge}: ${w} (markdown already updated)`);
}

// --------------------------------------------------------------------------
// Completed ledger
// --------------------------------------------------------------------------
const headingTitle = (p) => H1_RE.exec(read(p))?.[1]?.trim() ?? path.basename(p, ".md");

function appendCompletedRow(epicDir, sprintDir, issueFile, evidence) {
  fs.mkdirSync(COMPLETED_DIR, { recursive: true });
  const ledger = path.join(COMPLETED_DIR, `${path.basename(epicDir)}.md`);
  const issueId = `${path.basename(epicDir).slice(0, 2)}-${path.basename(sprintDir).slice(0, 2)}/${path.basename(issueFile).slice(0, 2)}`;
  const key = publishedRef(issueFile);
  const d = new Date();
  const verified = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cell = evidence.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
  const row = `| ${issueId} | ${headingTitle(issueFile)} | ${key ?? "-"} | ${verified} | ${cell} |\n`;

  if (!exists(ledger)) {
    const header = `# Completed - ${headingTitle(path.join(epicDir, "epic.md"))}\n\n`
      + "Verified-complete issues for this epic (newest last). One row per issue; "
      + "evidence is what convinced the verifier, not a checkmark.\n\n"
      + "| Issue | Title | Tracker ref | Verified | Evidence |\n"
      + "|-------|-------|-------------|----------|----------|\n";
    fs.writeFileSync(ledger, header + row);
    return;
  }

  let text = read(ledger);
  const lines = text.split(/(?<=\n)/);
  const rowPrefix = `| ${issueId} |`;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(rowPrefix)) { // replace an existing row: idempotent
      lines[i] = row;
      fs.writeFileSync(ledger, lines.join(""));
      return;
    }
  }
  if (!text.endsWith("\n")) text += "\n";
  fs.writeFileSync(ledger, text + row);
}

// --------------------------------------------------------------------------
// `set`
// --------------------------------------------------------------------------
async function cmdSet({ coords, status, evidence, cancelled }, io) {
  if (!STATUSES.includes(status)) die(`status must be one of ${JSON.stringify(STATUSES)} (got '${status}')`);
  if (cancelled && status !== "done") die("--cancelled only applies to done");
  if (evidence && status !== "done" && status !== "blocked") warn("--evidence is ignored except on done (ledger) and blocked (tracker comment)");

  const [epicDir, sprintDir, issueFile] = resolveIssuePath(coords);
  const epicMd = path.join(epicDir, "epic.md");

  // 1. issue file: status field and acceptance boxes
  const text = read(issueFile);
  writeIfChanged(issueFile, setAcceptanceBoxes(setStatusField(text, status), status === "done"), text);

  // 2 + 3. sprint table row (by issue filename) and the rolled-up sprint field
  const sprintMd = path.join(sprintDir, "sprint.md");
  let sprintStatus;
  if (exists(sprintMd)) {
    const sText = read(sprintMd);
    const withCell = setTableCell(sText, `(issues/${path.basename(issueFile)})`, status, "sprint Issues table");
    sprintStatus = rollup(issueStatuses(sprintDir));
    writeIfChanged(sprintMd, setStatusField(withCell, sprintStatus), sText);
  } else {
    warn(`${path.basename(sprintDir)}/sprint.md missing; skipping sprint roll-up`);
    sprintStatus = status;
  }

  // 4 + 5. epic Sprints table row (by sprint dir) and the rolled-up epic field
  let epicStatus;
  if (exists(epicMd)) {
    const eText = read(epicMd);
    const withCell = setTableCell(eText, `(${path.basename(sprintDir)}/sprint.md)`, sprintStatus, "epic Sprints table");
    epicStatus = rollup(sprintStatuses(epicDir));
    writeIfChanged(epicMd, setStatusField(withCell, epicStatus), eText);
  } else {
    warn(`${path.basename(epicDir)}/epic.md missing; skipping epic roll-up`);
    epicStatus = sprintStatus;
  }

  // 6. plan index Epics table row (by epic dir)
  if (exists(INDEX_MD)) {
    const iText = read(INDEX_MD);
    writeIfChanged(INDEX_MD, setTableCell(iText, `(${path.basename(epicDir)}/epic.md)`, epicStatus, "index Epics table"), iText);
  } else {
    warn("plan/index.md missing; skipping index update");
  }

  // Completed ledger: only a verified done with evidence, never a cancelled one.
  if (status === "done" && evidence && !cancelled) appendCompletedRow(epicDir, sprintDir, issueFile, evidence);

  const [ee, ss, ii] = [path.basename(epicDir).slice(0, 2), path.basename(sprintDir).slice(0, 2), path.basename(issueFile).slice(0, 2)];
  console.log(`OK: ${ee}-${ss}-${ii} -> ${status}; sprint ${ee}-${ss} -> ${sprintStatus}; epic ${ee} -> ${epicStatus}`);

  // Tracker, after the markdown is durably written.
  await trackerSync({ issueFile, status, reason: status === "blocked" ? evidence : null, cancelled }, io);
  return 0;
}

// --------------------------------------------------------------------------
// `check`
// --------------------------------------------------------------------------
function tableCellStatus(text, linkNeedle) {
  for (const line of text.split("\n")) {
    if (line.includes(linkNeedle) && (line.match(/\|/g) ?? []).length >= 3) {
      const cells = line.replace(/\s+$/, "").split("|");
      return cells[cells.length - 2].trim();
    }
  }
  return null;
}

function checkSprint(sprintDir, problems) {
  const sprintMd = path.join(sprintDir, "sprint.md");
  const truth = rollup(issueStatuses(sprintDir));
  const field = exists(sprintMd) ? readStatusField(sprintMd) : null;
  if (field !== null && field !== truth) problems.push(`${path.basename(sprintDir)}/sprint.md \`**Status**: ${field}\` != rolled-up ${truth}`);
  if (exists(sprintMd)) {
    const sText = read(sprintMd);
    for (const name of files(path.join(sprintDir, "issues"))) {
      if (!ISSUE_FILE_RE.test(name)) continue;
      const cell = tableCellStatus(sText, `(issues/${name})`);
      const fld = readStatusField(path.join(sprintDir, "issues", name));
      if (cell !== null && cell !== fld) problems.push(`${path.basename(sprintDir)}: table cell '${cell}' != ${name} field '${fld}'`);
    }
  }
  return truth;
}

function checkEpic(epicDir, problems) {
  const epicMd = path.join(epicDir, "epic.md");
  const eText = exists(epicMd) ? read(epicMd) : "";
  const childTruths = [];
  for (const sd of sprintDirs(epicDir)) {
    const st = checkSprint(sd, problems);
    childTruths.push(st);
    const cell = tableCellStatus(eText, `(${path.basename(sd)}/sprint.md)`);
    if (cell !== null && cell !== st) problems.push(`${path.basename(epicDir)}: Sprints-table cell '${cell}' for ${path.basename(sd)} != rolled-up ${st}`);
  }
  const truth = rollup(childTruths);
  const field = exists(epicMd) ? readStatusField(epicMd) : null;
  if (field !== null && field !== truth) problems.push(`${path.basename(epicDir)}/epic.md \`**Status**: ${field}\` != rolled-up ${truth}`);
  if (exists(INDEX_MD)) {
    const cell = tableCellStatus(read(INDEX_MD), `(${path.basename(epicDir)}/epic.md)`);
    if (cell !== null && cell !== truth) problems.push(`index Epics-table cell '${cell}' for ${path.basename(epicDir)} != rolled-up ${truth}`);
  }
  return truth;
}

function cmdCheck({ coords }) {
  const problems = [];
  let node, truth;
  if (!coords) {
    truth = rollup(epicDirs().map((ed) => checkEpic(ed, problems)));
    node = "plan tree";
  } else {
    const parts = parseCoords(coords);
    if (parts.length === 1) {
      const ed = epicDirFor(parts[0]);
      truth = checkEpic(ed, problems);
      node = path.basename(ed);
    } else if (parts.length === 2) {
      const ed = epicDirFor(parts[0]);
      const sd = sprintDirFor(ed, parts[1]);
      truth = checkSprint(sd, problems);
      node = `${path.basename(ed)}/${path.basename(sd)}`;
    } else {
      const [, sd, isf] = resolveIssuePath(coords);
      truth = readStatusField(isf) ?? "not-started";
      node = path.basename(isf);
      checkSprint(sd, problems); // surface agreement for the parent sprint
    }
  }

  console.log(`${node}: ${truth}`);
  for (const p of problems) console.log(`DRIFT: ${p}`);
  if (problems.length) return 1;
  if (truth !== "done") { console.log(`NOT DONE: ${node} is '${truth}'`); return 1; }
  return 0;
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------
const USAGE = "usage: plan-status.mjs set <EE-SS-II> <status> [--evidence \"...\"] [--cancelled]\n"
  + "       plan-status.mjs check [<coords>]\n";

/** `io` is the provider's `{ run, env }`: a test hands in a runner in place of gh and glab. */
export async function run(argv, io = {}) {
  const verb = argv[0];
  if (verb === "set") {
    const rest = argv.slice(1);
    let evidence = null;
    let cancelled = false;
    const positional = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--cancelled") { cancelled = true; continue; }
      if (rest[i] === "--evidence") { evidence = rest[++i] ?? null; continue; }
      if (rest[i].startsWith("--evidence=")) { evidence = rest[i].slice("--evidence=".length); continue; }
      positional.push(rest[i]);
    }
    if (positional.length !== 2) die(`\`set\` takes <coords> and <status>\n${USAGE}`);
    return cmdSet({ coords: positional[0], status: positional[1], evidence, cancelled }, io);
  }
  if (verb === "check") {
    const coords = argv.slice(1).find((a) => !a.startsWith("-")) ?? null;
    return cmdCheck({ coords });
  }
  die(`unknown verb '${verb ?? ""}'\n${USAGE}`);
}

// Guarded so a test can import `rollup` and `parseCoords` without running a
// verb. Resolved through realpath: a temp dir reaches the module loader as
// /private/var and argv[1] as /var, and a plain compare would never match.
const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof Die)) throw e;
    process.stderr.write(`ERROR: ${e.message}\n`);
    process.exitCode = 2;
  }
}
