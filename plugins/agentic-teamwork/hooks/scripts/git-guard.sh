#!/bin/bash
# PreToolUse hook on Bash: enforces the team's git rules (agentic-teamwork).
# Hard-blocks: commit on a protected branch, push to a protected branch,
# force-push, --no-verify, secrets or junk in commits, and commits while the
# build/tests are broken. Each block has a per-rule toggle in
# .claude/teamwork.json (rules.*).
# Escape hatch (auditable in the transcript): include <escapeHatch>=1 in the
# command (default TEAMWORK_ALLOW=1).
set -uo pipefail

# Fast no-op unless this repo opted in (no jq on this path).
[ -f "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}/.claude/teamwork.json" ] || exit 0

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HOOK_DIR/lib.sh"

tw_enabled || exit 0 # config present but jq missing -> fail open (session-start warns)

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

ESCAPE_VAR=$(tw_escape_var)
case "$CMD" in *"${ESCAPE_VAR}=1"*) exit 0 ;; esac

ROOT=$(tw_repo_root)
[ -n "$ROOT" ] || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -d "${CWD:-}" ] || CWD="$ROOT"
BRANCH=$(git -C "$CWD" symbolic-ref --short -q HEAD 2>/dev/null || echo "")

deny() {
    jq -n --arg reason "$1" \
        '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
    exit 0
}

on_protected_branch() { tw_is_protected "$BRANCH"; }

PR_NOUN=$(tw_pr_noun)
PR_CREATE=$(tw_pr_create_cmd)
PREFIX=$(tw_cfg_list '.branchPrefixes' | head -n1)
[ -n "$PREFIX" ] || PREFIX="feature/"
TEST_CMD=$(tw_cfg '.test.command' '')
[ -n "$TEST_CMD" ] || TEST_CMD=$(tw_cfg '.build.command' '')
[ -n "$TEST_CMD" ] || TEST_CMD="the team's test command"

# Split compound commands on &&, ||, ;, | and newlines. A segment that doesn't
# start with a git invocation is ignored, so `git log`, `echo "git commit"`, or
# a commit message mentioning git never trips the guard.
SEGMENTS=()
while IFS= read -r seg; do SEGMENTS+=("$seg"); done \
    < <(printf '%s\n' "$CMD" | awk '{gsub(/&&|\|\||;|\|/, "\n"); print}')

GIT_RE='^git([[:space:]]+(-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|--no-pager|--git-dir=[^[:space:]]+|--work-tree=[^[:space:]]+))*[[:space:]]+(commit|push)([[:space:]]|$)'

for seg in "${SEGMENTS[@]}"; do
    seg="${seg#"${seg%%[![:space:]]*}"}"
    # Strip leading `env` and VAR=value prefixes so `FOO=1 git push` is still seen.
    while [[ "$seg" =~ ^(env[[:space:]]+|[A-Za-z_][A-Za-z_0-9]*=[^[:space:]]*[[:space:]]+) ]]; do
        seg="${seg:${#BASH_REMATCH[0]}}"
    done
    [[ "$seg" =~ $GIT_RE ]] || continue
    SUB="${BASH_REMATCH[3]}"
    REST="${seg#*"$SUB"}"
    read -ra TOKENS <<<"$REST" || true

    if [ "$SUB" = "commit" ]; then
        noverify=0 scan_worktree=0
        case "$CMD" in *"git add"*) scan_worktree=1 ;; esac
        for t in "${TOKENS[@]:-}"; do
            case "$t" in
                --no-verify) noverify=1 ;;
                --all) scan_worktree=1 ;;
                --*) ;;
                -[a-zA-Z]*)
                    [[ "$t" == *n* ]] && noverify=1
                    [[ "$t" == *a* ]] && scan_worktree=1
                    ;;
            esac
        done

        if [ "$noverify" = 1 ] && tw_rule blockNoVerify; then
            deny "git commit --no-verify/-n is not allowed: it bypasses the team's pre-commit checks. Run the commit without it and fix whatever the checks report."
        fi

        if on_protected_branch && tw_rule blockCommitOnProtected; then
            deny "Committing directly to $BRANCH is not allowed. Create a branch first (git switch -c ${PREFIX}<topic>) and open a $PR_NOUN with '$PR_CREATE' when the work is ready. See .claude/rules/team-workflow.md."
        fi

        if tw_rule blockJunk; then
            junk=$(tw_staged_junk "$CWD")
            [ -n "$junk" ] && deny "These staged files must never be committed (build artifacts / OS cruft):
$junk
Unstage them (git restore --staged <file>) — .gitignore should cover them; something forced them in."
        fi

        if tw_rule blockSecrets; then
            hits=$(tw_secret_hits_staged "$CWD")
            if [ -z "$hits" ] && [ "$scan_worktree" = 1 ]; then
                hits=$(tw_secret_hits_worktree "$CWD")
            fi
            [ -n "$hits" ] && deny "Possible secrets detected (file:line) — commits with credentials are blocked:
$hits
Secrets belong in a secret manager or an untracked env file, never in the repo. Remove the secret, then retry."
        fi

        if tw_rule requireTestsPass; then
            if ! test_out=$(tw_run_tests "$ROOT"); then
                deny "'$TEST_CMD' must pass before every commit. Current failure:
$test_out
Fix the build/tests, then retry the commit."
            fi
        fi
    else # push
        force=0 noverify=0 targets_protected=0 target_branch=""
        NONFLAG=()
        for t in "${TOKENS[@]:-}"; do
            case "$t" in
                --force|--force-with-lease|--force-with-lease=*|--force-if-includes) force=1 ;;
                --no-verify) noverify=1 ;;
                --*) ;;
                -[a-zA-Z]*) [[ "$t" == *f* ]] && force=1 ;;
                ?*) NONFLAG+=("$t") ;;
            esac
        done

        if [ "$force" = 1 ] && tw_rule blockForcePush; then
            deny "Force-pushing is not allowed on this repo (it rewrites shared history). If you truly need it, ask a maintainer — the escape hatch (${ESCAPE_VAR}=1) is documented in .claude/rules/team-workflow.md."
        fi
        if [ "$noverify" = 1 ] && tw_rule blockNoVerify; then
            deny "git push --no-verify is not allowed: it bypasses the team's checks."
        fi

        if [ ${#NONFLAG[@]} -ge 2 ]; then
            # NONFLAG[0] is the remote; the rest are refspecs.
            for ((i = 1; i < ${#NONFLAG[@]}; i++)); do
                spec="${NONFLAG[$i]}"
                dst="${spec##*:}"
                dst="${dst#+}"
                dst="${dst#refs/heads/}"
                if tw_is_protected "$dst"; then
                    targets_protected=1 target_branch="$dst"
                elif [ "$spec" = "HEAD" ] && on_protected_branch; then
                    targets_protected=1 target_branch="$BRANCH"
                fi
            done
        elif on_protected_branch; then
            targets_protected=1 target_branch="$BRANCH" # bare `git push` (or remote only) while on a protected branch
        fi

        if [ "$targets_protected" = 1 ] && tw_rule blockPushToProtected; then
            deny "Pushing to $target_branch is not allowed — it only moves via reviewed ${PR_NOUN}s. Push your branch (git push -u $(tw_cfg '.remote' 'origin') <branch>) and open a $PR_NOUN with '$PR_CREATE'."
        fi
    fi
done

exit 0
