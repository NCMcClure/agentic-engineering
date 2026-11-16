#!/usr/bin/env node
// spec-open: serve the .agents/plan/ spec site (reusing a running instance) and
// open it in the browser. Node 22 stdlib only.
//
// debt: mkdocs is Python, swap for a Node static site when the spec site gets a
// second maintainer. This launcher starts `comments-server.py`, which fronts
// MkDocs and serves the inline-comment and plan-status APIs on one port.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.SPEC_PORT || "8000";
const URL_ = `http://127.0.0.1:${PORT}/`;
const API = `${URL_}__spec_comments__`;

// No `which`: spawning the binary is the portable probe, and the only two we
// probe answer `--version` on every platform we support.
const has = (bin) => { try { execFileSync(bin, ["--version"], { stdio: "ignore" }); return true; } catch { return false; } };

/** The unique API path confirms OUR front door is up, not a squatter on the port. */
async function serving() {
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch { return false; }
}

function announceAndOpen() {
  console.log(`Spec site: ${URL_}`);
  const opener = process.platform === "darwin" ? ["open", [URL_]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", URL_]]
      : ["xdg-open", [URL_]];
  try {
    const child = spawn(opener[0], opener[1], { detached: true, stdio: "ignore" });
    child.on("error", () => console.log("(open it in your browser)"));
    child.unref();
  } catch { console.log("(open it in your browser)"); }
}

/**
 * Explicit override (SPEC_ROOT or the first argument) wins, then
 * CLAUDE_PROJECT_DIR, then cwd. When that has no workspace, walk up from cwd
 * to find the repo that owns one: covers running from a subdirectory or a
 * multi-repo checkout.
 */
export function findRoot({ env = process.env, arg = process.argv[2], cwd = process.cwd() } = {}) {
  const first = env.SPEC_ROOT || arg || env.CLAUDE_PROJECT_DIR || cwd;
  if (fs.existsSync(path.join(first, ".agents/plan/spec/scripts/comments-server.py"))) return first;
  let d = cwd;
  for (;;) {
    if (fs.existsSync(path.join(d, ".agents/plan"))) return d;
    const up = path.dirname(d);
    if (up === d) return first;
    d = up;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (await serving()) { console.log("Already running."); announceAndOpen(); return 0; }

  const root = findRoot();
  const server = path.join(root, ".agents/plan/spec/scripts/comments-server.py");
  if (!fs.existsSync(server)) {
    console.error(`No spec site found (${server} missing), run spec-init first.`);
    return 1;
  }

  // Windows and Git Bash often have no `python3`.
  const py = has("python3") ? "python3" : has("python") ? "python" : null;
  if (!py) { console.error("No python3 or python on PATH."); return 1; }

  // Fail fast with an actionable message rather than waiting out the cold-start
  // timeout below when the docs toolchain is not installed.
  try { execFileSync(py, ["-c", "import mkdocs"], { stdio: "ignore" }); }
  catch {
    console.error(`Docs toolchain missing: ${py} -m pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin`);
    return 1;
  }

  console.log("Starting the spec server...");
  const log = fs.openSync(path.join(root, ".agents/plan/.comments.log"), "a");
  spawn(py, [server, "--port", PORT], { detached: true, stdio: ["ignore", log, log] }).unref();

  // Up to ~30s: MkDocs cold start behind the proxy.
  for (let i = 0; i < 60; i++) {
    if (await serving()) { announceAndOpen(); return 0; }
    await sleep(500);
  }

  console.error(`Server did not come up within 30s, see ${root}/.agents/plan/.comments.log.`);
  console.error("Docs toolchain missing? pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin");
  return 1;
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) process.exitCode = await main();
