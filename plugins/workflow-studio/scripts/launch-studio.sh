#!/usr/bin/env bash
# launch-studio.sh — sync the vendored Workflow Studio app into a persistent
# install home, install deps when the lockfile changes, and start the Vite
# dev server with STUDIO_ROOT pointed at the persistence dir.
#
# Usage: launch-studio.sh <plugin-root> <studio-root> <data-dir>
#   $1  plugin root       (contains app/ — the vendored source, read-only)
#   $2  studio root       (persistence dir for workflow projects)
#   $3  data dir          (persistent install home; app runs from $3/app)
#
# Env (optional): WORKFLOW_EXPORT_ROOT or CLAUDE_PROJECT_DIR — the project dir
# Publish is allowed to write into; forwarded to the dev server.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <plugin-root> <studio-root> <data-dir>" >&2
  exit 2
fi

PLUGIN_ROOT="$1"
STUDIO_ROOT_DIR="$2"
DATA_DIR="$3"

# --- Preflight: node + npm present, node >= 20 (Vite 6 requirement) --------
if ! command -v node >/dev/null 2>&1; then
  echo "Error: 'node' was not found on PATH. Workflow Studio needs Node.js 20 or newer." >&2
  echo "Install it from https://nodejs.org/ or via your package manager, then retry." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: 'npm' was not found on PATH. It normally ships with Node.js (20+)." >&2
  echo "Install Node.js from https://nodejs.org/ or via your package manager, then retry." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node.js $(node --version) is too old. Workflow Studio (Vite 6) needs Node 20+." >&2
  echo "Upgrade Node.js, then retry." >&2
  exit 1
fi

APP_SRC="$PLUGIN_ROOT/app"
APP_RUN="$DATA_DIR/app"

if [ ! -d "$APP_SRC" ]; then
  echo "Error: vendored app not found at $APP_SRC — is the plugin installed correctly?" >&2
  exit 1
fi

# --- Already running? The server writes <studio-root>/.studio.lock with its
# --- port; if its /api/health answers, hand back that URL instead of starting
# --- a second instance (which would double the file watcher).
LOCK_FILE="$STUDIO_ROOT_DIR/.studio.lock"
if [ -f "$LOCK_FILE" ]; then
  LOCK_PORT="$(node -e '
    try {
      const l = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (Number.isInteger(l.port)) process.stdout.write(String(l.port));
    } catch {}' "$LOCK_FILE")"
  HEALTH=""
  if [ -n "$LOCK_PORT" ]; then
    HEALTH="$(node -e '
      fetch("http://127.0.0.1:" + process.argv[1] + "/api/health")
        .then((r) => r.json())
        .then((j) => { if (j && j.ok && j.app === "workflow-studio") process.stdout.write("ok"); })
        .catch(() => {});' "$LOCK_PORT" 2>/dev/null || true)"
  fi
  if [ "$HEALTH" = "ok" ]; then
    echo "Workflow Studio is already running."
    echo "  ➜  Local:   http://localhost:$LOCK_PORT/"
    exit 0
  fi
  rm -f "$LOCK_FILE" # stale lock from a dead server
fi

# --- Sync vendored app into the persistent install home --------------------
mkdir -p "$APP_RUN"

copy_sources() {
  cp -R "$APP_SRC/src" "$APP_SRC/docs" "$APP_RUN/"
  cp "$APP_SRC/index.html" \
     "$APP_SRC/vite.config.ts" \
     "$APP_SRC/tsconfig.json" \
     "$APP_SRC/tsconfig.node.json" \
     "$APP_SRC/package.json" \
     "$APP_SRC/package-lock.json" \
     "$APP_RUN/"
}

# The install stamp (lockfile hash) is written ONLY after a successful `npm ci`,
# so a failed/interrupted install retries on the next launch instead of leaving
# a half-installed node_modules that a lockfile compare would call "done".
STAMP_FILE="$APP_RUN/.install-stamp"
LOCK_HASH="$(node -e '
  const c = require("crypto"), f = require("fs");
  process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"));' \
  "$APP_SRC/package-lock.json")"

if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$LOCK_HASH" ]; then
  echo "Workflow Studio: (re)installing app into $APP_RUN (first run or lockfile changed)..."
  rm -f "$STAMP_FILE"
  rm -rf "$APP_RUN/src" "$APP_RUN/docs"
  copy_sources
  (cd "$APP_RUN" && npm ci)
  printf '%s' "$LOCK_HASH" > "$STAMP_FILE"
else
  # Install unchanged: refresh sources (cheap, ~220KB) without reinstalling.
  rm -rf "$APP_RUN/src" "$APP_RUN/docs"
  copy_sources
fi

# --- Launch -----------------------------------------------------------------
mkdir -p "$STUDIO_ROOT_DIR"
cd "$APP_RUN"
EXPORT_ROOT="${WORKFLOW_EXPORT_ROOT:-${CLAUDE_PROJECT_DIR:-}}"
echo "Workflow Studio: starting dev server (STUDIO_ROOT=$STUDIO_ROOT_DIR)..."
STUDIO_ROOT="$STUDIO_ROOT_DIR" WORKFLOW_EXPORT_ROOT="$EXPORT_ROOT" exec npm run dev
