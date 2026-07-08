#!/usr/bin/env bash
# open-spec: serve the .plan/ spec site (reusing a running instance) and open it.
# Stdlib/CLI only. Serves site + inline-comment API on one port via comments-server.py.
set -euo pipefail

PORT="${SPEC_PORT:-8000}"
URL="http://127.0.0.1:${PORT}/"
API="${URL}__spec_comments__"
ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
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
  echo "No spec site found ($SERVER missing) — run plan-0-init first." >&2
  exit 1
fi

echo "Starting the spec server…"
nohup python3 "$SERVER" --port "$PORT" >"$ROOT/.plan/.comments.log" 2>&1 &

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
