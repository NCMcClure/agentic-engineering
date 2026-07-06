#!/bin/bash
# PostToolUse hook on Edit|MultiEdit|Write: warn-but-allow feedback
# (agentic-teamwork).
# - configured lint command on files matching lint.filePatterns
#   (exit 2 -> feedback to Claude)
# - reminder when a file in a coupledFiles group is touched
set -uo pipefail

# Fast no-op unless this repo opted in (no jq on this path).
[ -f "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}/.claude/teamwork.json" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

tw_enabled || exit 0

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$FILE" ] || exit 0

ROOT=$(tw_repo_root)
[ -n "$ROOT" ] || exit 0

case "$FILE" in
    "$ROOT"/*) REL="${FILE#"$ROOT"/}" ;;
    *) exit 0 ;; # outside the repo (scratchpad etc.)
esac

CFG=$(tw_config)

# Coupled-files reminder: if REL is in a group, surface the group's message
# and the other members.
coupling=""
GROUPS_N=$(jq '(.coupledFiles // []) | length' "$CFG" 2>/dev/null || echo 0)
for ((g = 0; g < GROUPS_N; g++)); do
    matched=0
    while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        # shellcheck disable=SC2254 # patterns are globs by design
        case "$REL" in $pat) matched=1 ;; esac
    done < <(jq -r ".coupledFiles[$g].files // [] | .[]" "$CFG" 2>/dev/null)
    if [ "$matched" = 1 ]; then
        msg=$(jq -r ".coupledFiles[$g].message // \"These files change together.\"" "$CFG" 2>/dev/null)
        others=$(jq -r ".coupledFiles[$g].files // [] | .[]" "$CFG" 2>/dev/null | grep -vxF "$REL" | paste -sd', ' - || true)
        coupling="Heads up: $REL is part of a coupled-files group${others:+ (also: $others)}. $msg If you changed a name, path, or identifier, update the whole group together."
        break
    fi
done

# Configured lint (non-blocking feedback): only when lint.command is set,
# the file matches lint.filePatterns, and the file still exists.
lint=""
LINT_CMD_TPL=$(tw_cfg '.lint.command' '')
if [ -n "$LINT_CMD_TPL" ] && [ -f "$FILE" ]; then
    lint_match=0
    while IFS= read -r re; do
        [ -n "$re" ] || continue
        printf '%s' "$REL" | grep -qE "$re" && lint_match=1
    done < <(tw_cfg_list '.lint.filePatterns')
    if [ "$lint_match" = 1 ]; then
        LINT_CMD="${LINT_CMD_TPL//\{file\}/$FILE}"
        if ! (cd "$ROOT" && bash -lc "$LINT_CMD" >/dev/null 2>&1); then
            lint="Lint issues in $REL (warning, non-blocking): run \`$LINT_CMD\` and fix them before committing — the pre-commit checks lint these files."
        fi
    fi
fi

if [ -n "$lint" ]; then
    {
        printf '%s\n' "$lint"
        [ -n "$coupling" ] && printf '%s\n' "$coupling"
    } >&2
    exit 2
fi

if [ -n "$coupling" ]; then
    jq -n --arg ctx "$coupling" \
        '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
fi
exit 0
