#!/usr/bin/env bash
# launch-studio.sh — sync the vendored Workflow Studio app into a persistent
# install home, install deps when the lockfile changes, and start the Vite
# dev server with STUDIO_ROOT pointed at the persistence dir.
#
# Usage: launch-studio.sh <plugin-root> <studio-root> <data-dir>
#   $1  plugin root       (contains app/ — the vendored source, read-only)
#   $2  studio root       (persistence dir for workflow projects)
#   $3  data dir          (persistent install home; app runs from $3/app)
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

if [ ! -f "$APP_RUN/package-lock.json" ] || ! cmp -s "$APP_SRC/package-lock.json" "$APP_RUN/package-lock.json"; then
  echo "Workflow Studio: (re)installing app into $APP_RUN (first run or lockfile changed)..."
  rm -rf "$APP_RUN/src" "$APP_RUN/docs"
  copy_sources
  (cd "$APP_RUN" && npm ci)
else
  # Lockfile unchanged: refresh sources (cheap, ~220KB) without reinstalling.
  rm -rf "$APP_RUN/src" "$APP_RUN/docs"
  copy_sources
fi

# --- Launch -----------------------------------------------------------------
mkdir -p "$STUDIO_ROOT_DIR"
cd "$APP_RUN"
echo "Workflow Studio: starting dev server (STUDIO_ROOT=$STUDIO_ROOT_DIR)..."
STUDIO_ROOT="$STUDIO_ROOT_DIR" exec npm run dev
