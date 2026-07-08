#!/usr/bin/env bash
#
# Install the But-First-Planning skill suite into a project's (or your global)
# Claude Code skills directory.
#
# Usage:
#   ./install.sh [TARGET_DIR] [--global]
#
#   ./install.sh                 # install into ./.claude/skills (current project)
#   ./install.sh /path/to/repo   # install into that project's .claude/skills
#   ./install.sh --global        # install into ~/.claude/skills (every project)
#
# Remote one-liner:
#   curl -fsSL https://raw.githubusercontent.com/NCMcClure/agentic-engineering/main/plugins/but-first-planning/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/NCMcClure/agentic-engineering/main/plugins/but-first-planning/install.sh | bash -s -- --global
#
# When run via curl|bash (no local checkout next to the script), the installer
# shallow-clones the marketplace repo to fetch the skills. Override with BFP_REPO,
# e.g.  BFP_REPO=myfork/agentic-engineering curl ... | bash
#
set -euo pipefail

REPO="${BFP_REPO:-NCMcClure/agentic-engineering}"
BRANCH="${BFP_BRANCH:-main}"

scope="project"
target=""
for arg in "$@"; do
  case "$arg" in
    --global|-g) scope="global" ;;
    -h|--help)
      sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "install.sh: unknown option '$arg'" >&2; exit 2 ;;
    *) target="$arg" ;;
  esac
done

# --- locate the source skills/ directory -------------------------------------
cleanup=""
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$script_dir" ] && [ -d "$script_dir/skills" ]; then
  src="$script_dir/skills"                       # running from a checkout
else
  command -v git >/dev/null 2>&1 || { echo "install.sh: git is required for remote install" >&2; exit 1; }
  cleanup="$(mktemp -d)"
  echo "Fetching $REPO ($BRANCH)…"
  git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$cleanup" >/dev/null 2>&1
  src="$cleanup/plugins/but-first-planning/skills"
fi
[ -d "$src" ] || { echo "install.sh: could not find a skills/ directory" >&2; exit 1; }

# --- resolve the destination -------------------------------------------------
if [ "$scope" = "global" ]; then
  dest="$HOME/.claude/skills"
else
  dest="${target:-$PWD}/.claude/skills"
fi
mkdir -p "$dest"

# --- copy each skill (overwriting any same-named one) ------------------------
count=0
for d in "$src"/*/; do
  [ -f "$d/SKILL.md" ] || continue            # only real skills
  name="$(basename "$d")"
  rm -rf "$dest/$name"
  cp -R "$d" "$dest/$name"
  echo "  + $name"
  count=$((count + 1))
done

[ -n "$cleanup" ] && rm -rf "$cleanup"

echo ""
echo "Installed $count skills into $dest"
echo "Start a planning workspace with:  /spec-0-init   (run /context or restart the session if the skills don't appear yet)"
