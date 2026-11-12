// Fixture repos for the live lane and the hook cases: small git repos in the
// shapes a plugin meets in the wild. They are written here as static trees,
// never by running a plugin's own setup, so the same builder describes a repo
// before and after a plugin changes how it sets one up.
//
// `layout` names which generation of marker files a fixture carries:
//   v1  .claude/teamwork.json, .perceptual-loop/, .agents/agent-works.json,
//       .agents/docs-parity.json, .agents/plan/
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..");
const PLUGINS = path.join(REPO, "plugins");

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe", encoding: "utf8" });
const ID = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"];
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function write(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const writeJson = (dir, rel, value) => write(dir, rel, `${JSON.stringify(value, null, 2)}\n`);

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  write(dir, "README.md", "# fixture\n\nA scratch repo for the test lanes.\n");
}

function commit(dir, message = "init") {
  git(dir, "add", "-A");
  git(dir, ...ID, "commit", "-q", "--no-verify", "-m", message);
}

/** The git-guardrail marker: tests pass (`true`), and files under src/ count as source. */
function teamworkMarker(dir) {
  const config = readJson(path.join(PLUGINS, "agentic-teamwork", "templates", "teamwork.default.json"));
  config.test = { ...config.test, command: "true", sourcePatterns: ["^src/"], testPatterns: ["^tests/"] };
  writeJson(dir, ".claude/teamwork.json", config);
}

function everyMarker(dir) {
  teamworkMarker(dir);
  writeJson(dir, ".agents/agent-works.json", {
    version: 1, claude: { twins: "generated" }, guard: { ownerFiles: [], generated: [], rules: [] },
    resources: {}, lockOrder: [], runs: [], counters: {},
  });
  writeJson(dir, ".agents/docs-parity.json", {
    target: "docs-folder", docsRoot: "docs", nav: "auto", frontmatter: ["title", "description"], summary: true, pageBudget: 120,
    roots: [{ name: "guide", path: "guide" }],
    images: { dir: "docs/images", themes: ["light", "dark"] },
    capture: "true",
    surfaces: [{ name: "app", code: ["src/**"], pages: ["docs/guide/index.md"], shots: [], group: "app" }],
    accept: [],
  });
  writeJson(dir, ".perceptual-loop/config.json", {
    version: 1, reference: "reference", candidates: ["candidate"], shotsDir: ".perceptual-loop/shots", render: {},
    passes: ["beauty"], regionsFrom: "reference", budget: { free: 3, match: [] },
    metrics: { ssim: true, deltaE: true, edges: true, detail: true },
  });
  write(dir, ".agents/plan/index.md", "# Plan\n\nNo epics yet.\n");
  write(dir, "AGENTS.md", "# fixture\n\n## Layout\n\n- `src/` - the application code.\n- `docs/` - the user guide.\n");
  write(dir, "docs/guide/index.md", "---\ntitle: Guide\ndescription: How to use the fixture app.\n---\n\n# Guide\n\nRun the app.\n");
}

/** Work a session would have to answer for: a changed source file and a stray file at the root. */
function dirty(dir) {
  fs.appendFileSync(path.join(dir, "src", "app.py"), "\n\ndef added():\n    return 2\n");
  write(dir, "scratch.txt", "a scratch file that should not be in the repo\n");
}

export const KINDS = ["bare", "outside", "adopted", "teamwork-only"];

/**
 * One fixture repo, fresh under root, on a feature branch with one commit.
 *   bare           no remote, no markers
 *   outside        a remote, no markers
 *   adopted        every plugin's marker, a changed source file, a stray root file
 *   teamwork-only  the git-guardrail marker alone, with the same changed and stray files
 *   unborn         the git-guardrail marker in a repo with no commit yet, still on main
 */
export function makeFixture(root, kind, { layout = "v1" } = {}) {
  if (layout !== "v1") throw new Error(`fixtures: unknown layout ${layout}`);
  const dir = path.join(root, kind);
  init(dir);
  if (kind === "unborn") { teamworkMarker(dir); return dir; }
  if (kind === "outside") git(dir, "remote", "add", "origin", "https://example.invalid/x.git");
  if (kind === "adopted" || kind === "teamwork-only") {
    write(dir, "src/app.py", "def main():\n    return 1\n");
    if (kind === "adopted") everyMarker(dir); else teamworkMarker(dir);
  }
  commit(dir);
  git(dir, "switch", "-q", "-c", "feat/live");
  if (kind === "adopted" || kind === "teamwork-only") dirty(dir);
  return dir;
}

/** The plugins a fixture of this kind has adopted, by marker. */
export function adopted(kind) {
  if (kind === "adopted") return ["agent-works", "agentic-teamwork", "but-first-planning", "docs-parity", "perceptual-loop"];
  if (kind === "teamwork-only") return ["agentic-teamwork"];
  return [];
}
