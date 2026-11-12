// Fixture repos for the live lane and the hook cases: small git repos in the
// shapes a plugin meets in the wild. They are written here as static trees,
// never by running a plugin's own setup, so the same builder describes a repo
// before and after a plugin changes how it sets one up.
//
// A fixture carries one of two generations of marker files:
//   the first   .claude/teamwork.json, .perceptual-loop/, .agents/agent-works.json,
//               .agents/docs-parity.json, .agents/plan/ (`adopted`, `teamwork-only`, `unborn`)
//   the current .agents/manifest.json, .agents/perceptual/, and the same
//               .agents/ files (`standard`, `strict`, `unborn-standard`)
// A plugin that still reads the first is tested on it; one that has moved is
// tested on the current, and on the first to prove it migrates.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "..", "..");

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe", encoding: "utf8" });
const ID = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid"];

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

// The config a repo on the first layout carries, as the plugin's setup wrote it.
const FIRST_LAYOUT = {
  "version": 1,
  "provider": "auto",
  "remote": "origin",
  "baseBranch": "main",
  "protectedBranches": [
    "main",
    "master"
  ],
  "branchPrefixes": [
    "feature/",
    "fix/",
    "chore/"
  ],
  "escapeHatch": "TEAMWORK_ALLOW",
  "test": {
    "command": null,
    "dir": ".",
    "sourcePatterns": [],
    "testPatterns": [],
    "timeoutSeconds": 240
  },
  "build": {
    "command": null,
    "dir": "."
  },
  "lint": {
    "command": null,
    "filePatterns": []
  },
  "junkPatterns": [
    "(^|/)\\.DS_Store$",
    "(^|/)Thumbs\\.db$",
    "(^|/)node_modules/",
    "(^|/)__pycache__/",
    "(^|/)\\.env(\\..*)?$"
  ],
  "secretPatternsExtra": [],
  "coupledFiles": [],
  "docs": {
    "files": [
      "README.md",
      "CLAUDE.md"
    ],
    "watchPatterns": []
  },
  "scan": {
    "maxFileBytes": 524288
  },
  "rules": {
    "blockCommitOnProtected": true,
    "blockPushToProtected": true,
    "blockForcePush": true,
    "blockNoVerify": true,
    "blockSecrets": true,
    "blockJunk": true,
    "requireTestsPass": true,
    "stopGate": true
  }
};

/** The git-guardrail marker: tests pass (`true`), and files under src/ count as source. */
function teamworkMarker(dir) {
  const config = structuredClone(FIRST_LAYOUT);
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

/** The repo-wide marker. `teamwork` is the opt-in block of stricter git rules; without it the defaults apply. */
function manifest(dir, teamwork) {
  writeJson(dir, ".agents/manifest.json", {
    standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main",
    lanes: { unit: "true" }, owned: {}, ...(teamwork ? { teamwork } : {}),
  });
}

/** Every plugin's marker in the current layout. */
function currentMarkers(dir, teamwork) {
  everyMarker(dir);
  fs.rmSync(path.join(dir, ".claude"), { recursive: true, force: true });
  fs.renameSync(path.join(dir, ".perceptual-loop"), path.join(dir, ".agents", "perceptual"));
  manifest(dir, teamwork);
}

const STRICT = { requireTestsPass: true, test: { command: "true", dir: ".", sourcePatterns: ["^src/"], testPatterns: ["^tests/"], timeoutSeconds: 60 } };
const ANSWERS = { portable: "on", unplugged: "off" };

/** Work a session would have to answer for: a changed source file and a stray file at the root. */
function dirty(dir) {
  fs.appendFileSync(path.join(dir, "src", "app.py"), "\n\ndef added():\n    return 2\n");
  write(dir, "scratch.txt", "a scratch file that should not be in the repo\n");
}

// The fixtures the live lane runs a session in. The rest exist for the hook cases.
export const KINDS = ["bare", "outside", "adopted", "teamwork-only", "standard", "portable", "unplugged"];

/**
 * One fixture repo, fresh under root, on a feature branch with one commit.
 *   bare           no remote, no markers
 *   outside        a remote, no markers
 *   adopted        every plugin's marker, a changed source file, a stray root file
 *   teamwork-only  the git-guardrail marker alone, with the same changed and stray files
 *   unborn         the git-guardrail marker in a repo with no commit yet, still on main
 *   standard       every marker in the current layout, with the same changed and stray files
 *   strict         `standard`, plus the opt-in that makes passing tests a hard gate
 *   unborn-standard  the repo-wide marker in a repo with no commit yet, still on main
 *   portable       no markers; the person answered `on`; the same changed and stray files
 *   unplugged      no markers; the person answered `off`; the same changed and stray files
 */
export function makeFixture(root, kind) {
  const dir = path.join(root, kind);
  init(dir);
  if (kind === "unborn") { teamworkMarker(dir); return dir; }
  if (kind === "unborn-standard") { manifest(dir); return dir; }
  if (kind === "outside") git(dir, "remote", "add", "origin", "https://example.invalid/x.git");
  const worked = ["adopted", "teamwork-only", "standard", "strict", "portable", "unplugged"].includes(kind);
  if (worked) write(dir, "src/app.py", "def main():\n    return 1\n");
  if (kind === "adopted") everyMarker(dir);
  if (kind === "teamwork-only") teamworkMarker(dir);
  if (kind === "standard") currentMarkers(dir);
  if (kind === "strict") currentMarkers(dir, STRICT);
  if (kind in ANSWERS) git(dir, "config", "--local", "agentic-engineering.plugins", `${ANSWERS[kind]} fixture 2026-01-01T00:00Z`);
  commit(dir);
  git(dir, "switch", "-q", "-c", "feat/live");
  if (worked) dirty(dir);
  return dir;
}

/** The plugins that owe a fixture of this kind their context: those whose marker it carries, and those that speak wherever a repo has opted in. */
export function adopted(kind) {
  if (["adopted", "standard", "strict"].includes(kind)) return ["agent-works", "agentic-teamwork", "but-first-planning", "code-diet", "docs-parity", "perceptual-loop"];
  if (kind === "teamwork-only" || kind === "portable") return ["agentic-teamwork", "code-diet"];
  return [];
}

/** How the session kernel reads a fixture of this kind, once any older layout has been moved. */
export const MODES = { bare: "none", outside: "none", unplugged: "none", portable: "portable", adopted: "full", "teamwork-only": "full", standard: "full", strict: "full" };
