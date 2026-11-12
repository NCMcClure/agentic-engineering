// The live lane's side effects: fixture repos, headless Claude Code sessions,
// and the lens run over their transcripts. Everything here spends model quota
// or touches the disk; the pure reading of the result is measure.mjs.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KINDS, REPO, makeFixture as buildFixture } from "../fixtures.mjs";

export { REPO };
const LENS = path.join(import.meta.dirname, "lens", "context-lens.mjs");
export const MARKETPLACE = "agentic-engineering";

export const MODEL = "haiku";
export const BUDGET_USD = "0.50"; // per claude -p call; three calls per fixture
export const SUBAGENTS = ["general-purpose", "Explore", "perceptual-loop:vision-critic"];
export const FIXTURES = KINDS;

/**
 * The environment a child session gets: the login's, never the host's. A
 * session started from inside Claude Code (the desktop app, another agent)
 * carries CLAUDE_CODE_* and ANTHROPIC_BASE_URL meant for that host, which
 * change the child's tools and endpoint. The keychain login needs only HOME.
 */
export function childEnv(env = process.env) {
  const keep = ["HOME", "PATH", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "TERM"];
  return Object.fromEntries(keep.filter((k) => env[k]).map((k) => [k, env[k]]));
}

/**
 * A --plugin-dir load leaves enabledPlugins empty, so a hook that asks which
 * of its siblings are enabled would see none. The fixture declares them in
 * its local settings, which a hook can read from disk and the session itself
 * does not (--setting-sources project), so Claude Code never loads installed
 * copies beside the checkout's.
 */
function declareEnabled(dir, on = true) {
  const enabledPlugins = Object.fromEntries(fs.readdirSync(path.join(REPO, "plugins"), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => [`${e.name}@${MARKETPLACE}`, on]));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), `${JSON.stringify({ enabledPlugins }, null, 2)}\n`);
}

export function makeFixture(root, kind) {
  const dir = buildFixture(root, kind);
  declareEnabled(dir);
  return dir;
}

/**
 * One headless call, the prompt on stdin: a positional prompt after --resume
 * is not read as one. `--plugin-dir` loads every plugin under the folder for
 * that session only, from the checkout, with no install; `--setting-sources
 * project` keeps the person's own plugins and CLAUDE.md out.
 */
function claude(cwd, prompt, args = []) {
  const r = spawnSync("claude", ["-p", "--model", MODEL, "--setting-sources", "project",
    "--plugin-dir", path.join(REPO, "plugins"), "--output-format", "json", "--max-budget-usd", BUDGET_USD, ...args],
  { cwd, env: childEnv(), input: prompt, encoding: "utf8", timeout: 300_000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* fall through */ }
  if (!out) throw new Error(`claude -p failed in ${cwd}: ${r.stderr || r.stdout || r.error}`);
  if (out.is_error) throw new Error(`claude -p returned an error in ${cwd}: ${out.result}`);
  return out;
}

/** The scripted session: one prompt, a forced compaction, then one prompt that starts each subagent type. */
export function runSession(cwd) {
  const first = claude(cwd, "Reply with one short line: what does README.md say this repo is?", ["--max-turns", "3"]);
  const id = first.session_id;
  const compact = claude(cwd, "/compact", ["--resume", id]);
  const agents = SUBAGENTS.map((t) => `one of subagent_type "${t}"`).join(", ");
  const third = claude(cwd, `Start ${SUBAGENTS.length} subagents in parallel with the Agent tool: ${agents}. Tell each to reply with only the word done and to use no tools. Then reply done.`,
    ["--resume", id, "--max-turns", "5", "--allowedTools", "Agent"]);
  const cost = [first, compact, third].reduce((sum, r) => sum + (r.total_cost_usd ?? 0), 0);
  return { id, cost };
}

/** Claude Code files a session's transcript under its cwd with every non-alphanumeric character dashed. */
export const projectFolder = (claudeDir, cwd) => path.join(claudeDir, "projects", fs.realpathSync(cwd).replace(/[^A-Za-z0-9]/g, "-"));

/** Move a session's transcripts out of the person's ~/.claude into the lane's own lens directory. */
export function collect(cwd, lensDir) {
  const from = projectFolder(path.join(os.homedir(), ".claude"), cwd);
  const to = path.join(lensDir, "projects", path.basename(from));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
  return to;
}

/**
 * A lens directory that attributes hooks to this checkout's plugins: the lens
 * indexes each known marketplace's catalog at its install location, and a
 * --plugin-dir load leaves no cache copy to index.
 */
export function makeLensDir(root) {
  const dir = path.join(root, "lens");
  fs.mkdirSync(path.join(dir, "plugins"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugins", "known_marketplaces.json"), `${JSON.stringify({ [MARKETPLACE]: { installLocation: REPO } })}\n`);
  return dir;
}

/** The lens's JSON report for one transcript. */
export function lens(file, lensDir) {
  const out = execFileSync(process.execPath, [LENS, "report", file, "--json", "--claude-dir", lensDir, "--focus", MARKETPLACE], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out);
}

/** The main transcript's report and each subagent's, keyed by agent type. */
export function readTranscripts(folder, id, lensDir) {
  const main = lens(path.join(folder, `${id}.jsonl`), lensDir);
  const subDir = path.join(folder, id, "subagents");
  const subagents = [];
  for (const name of fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((n) => n.endsWith(".jsonl")) : []) {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(subDir, name.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch { /* no meta */ }
    subagents.push({ agentType: meta.agentType ?? null, report: lens(path.join(subDir, name), lensDir) });
  }
  return { main, subagents };
}

export function claudeVersion() {
  return execFileSync("claude", ["--version"], { env: childEnv(), encoding: "utf8" }).trim().split(" ")[0];
}

export const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "live-lane-"));
