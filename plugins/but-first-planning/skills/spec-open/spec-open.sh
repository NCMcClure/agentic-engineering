#!/usr/bin/env bash
# spec-open: serve the .plan/ spec site (reusing a running instance) and open it.
# Stdlib/CLI only. Serves site + inline-comment API on one port via comments-server.py.
set -euo pipefail

PORT="${SPEC_PORT:-8000}"
URL="http://127.0.0.1:${PORT}/"
API="${URL}__spec_comments__"

# Interpreter: prefer python3, fall back to python (Windows/Git-Bash has no python3).
PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] || { echo "No python3/python on PATH." >&2; exit 1; }

# Root: explicit override (SPEC_ROOT env or $1) wins, else $CLAUDE_PROJECT_DIR/$PWD.
# If .plan/ isn't there, walk up from cwd to find the repo that owns it — covers
# running from a subdir or a multi-repo workspace (SPEC_ROOT= is the escape hatch).
ROOT="${SPEC_ROOT:-${1:-${CLAUDE_PROJECT_DIR:-$PWD}}}"
if [ ! -f "$ROOT/.plan/spec/scripts/comments-server.py" ]; then
  d="$PWD"
  while [ "$d" != "/" ]; do
    [ -d "$d/.plan" ] && { ROOT="$d"; break; }
    d="$(dirname "$d")"
  done
fi
SERVER="$ROOT/.plan/spec/scripts/comments-server.py"

announce_and_open() {
  echo "Spec site: $URL"
  if command -v xdg-open >/dev/null 2>&1; then (xdg-open "$URL" >/dev/null 2>&1 &)
  elif command -v open >/dev/null 2>&1; then (open "$URL" >/dev/null 2>&1 &)
  elif command -v powershell.exe >/dev/null 2>&1; then (powershell.exe -c "start '$URL'" >/dev/null 2>&1 &)
  else echo "(open it in your browser)"; fi
}

# Already serving? The API path is unique to this server, so it confirms OUR
# front door is up (not just any process squatting on the port).
if curl -sf -o /dev/null "$API" 2>/dev/null; then
  echo "Already running."
  announce_and_open
  exit 0
fi

if [ ! -f "$SERVER" ]; then
  echo "No spec site found ($SERVER missing) — run spec-0-init first." >&2
  exit 1
fi

# Fail fast with an actionable message if the docs toolchain is missing, rather
# than waiting out the 30s cold-start timeout below.
if ! "$PY" -c 'import mkdocs' >/dev/null 2>&1; then
  echo "Docs toolchain missing: $PY -m pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin" >&2
  exit 1
fi

echo "Starting the spec server…"
nohup "$PY" "$SERVER" --port "$PORT" >"$ROOT/.plan/.comments.log" 2>&1 &

# Wait until it responds (up to ~30s: MkDocs cold start behind the proxy).
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "$API" 2>/dev/null; then
    announce_and_open
    exit 0
  fi
  sleep 0.5
done

echo "Server didn't come up within 30s — see $ROOT/.plan/.comments.log." >&2
echo "Docs toolchain missing? pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin" >&2
exit 1
