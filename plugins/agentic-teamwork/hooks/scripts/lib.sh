# agentic-teamwork shared guard library.
# Source this file; do not execute it.
#
# Self-contained on purpose: /teamwork-init copies this exact file into the
# target repository as .githooks/lib-guard.sh so the terminal pre-commit hook
# works without the plugin installed. TW_LIB_VERSION lets session-start and
# /teamwork-audit detect drift between the plugin copy and the repo mirror.

TW_LIB_VERSION="0.1.0"

# Hooks don't inherit an interactive shell PATH; make common tool locations
# findable without disturbing Linux setups (append, and only if present).
[ -d /opt/homebrew/bin ] && export PATH="$PATH:/opt/homebrew/bin"
[ -d /usr/local/bin ] && export PATH="$PATH:/usr/local/bin"

tw_repo_root() {
    if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
        printf '%s' "$CLAUDE_PROJECT_DIR"
    else
        git rev-parse --show-toplevel 2>/dev/null
    fi
}

# Path of the committed config, or nothing when the repo has not opted in.
tw_config() {
    local root
    root=$(tw_repo_root)
    if [ -n "$root" ] && [ -f "$root/.claude/teamwork.json" ]; then
        printf '%s' "$root/.claude/teamwork.json"
    fi
}

# Enabled = the repo opted in AND jq (our only parser) is available.
tw_enabled() {
    [ -n "$(tw_config)" ] && command -v jq >/dev/null 2>&1
}

# tw_cfg <jq-path> <default>: scalar config lookup with a default.
# Null/absent values fall back to the default.
tw_cfg() {
    local path="$1" default="$2" cfg val
    cfg=$(tw_config)
    if [ -z "$cfg" ]; then
        printf '%s' "$default"
        return 0
    fi
    val=$(jq -r "$path // empty" "$cfg" 2>/dev/null) || val=""
    if [ -n "$val" ]; then
        printf '%s' "$val"
    else
        printf '%s' "$default"
    fi
}

# tw_cfg_list <jq-path>: print one array element per line ('' when absent).
tw_cfg_list() {
    local cfg
    cfg=$(tw_config)
    [ -n "$cfg" ] || return 0
    jq -r "($1 // []) | .[]" "$cfg" 2>/dev/null || true
}

# tw_rule <name>: per-rule toggle under .rules; every rule defaults to true,
# only an explicit false disables it (jq's // would swallow false).
tw_rule() {
    local cfg val
    cfg=$(tw_config)
    [ -n "$cfg" ] || return 0
    val=$(jq -r ".rules.$1" "$cfg" 2>/dev/null) || val=""
    [ "$val" != "false" ]
}

# Name of the auditable everything-bypass env var (VAR=1 in the command).
tw_escape_var() {
    tw_cfg '.escapeHatch' 'TEAMWORK_ALLOW'
}

# ---------------------------------------------------------------------------
# Provider map — the single place that knows GitHub from GitLab.
# ---------------------------------------------------------------------------

# "github" | "gitlab" | "" (unknown host and no explicit provider in config).
tw_provider() {
    local p remote url root
    p=$(tw_cfg '.provider' 'auto')
    case "$p" in
        github | gitlab)
            printf '%s' "$p"
            return 0
            ;;
    esac
    root=$(tw_repo_root)
    remote=$(tw_cfg '.remote' 'origin')
    url=$(git -C "${root:-.}" remote get-url "$remote" 2>/dev/null || echo "")
    case "$url" in
        *github*) printf 'github' ;;
        *gitlab*) printf 'gitlab' ;;
        *) printf '' ;;
    esac
}

tw_cli() {
    case "$(tw_provider)" in
        github) printf 'gh' ;;
        gitlab) printf 'glab' ;;
        *) printf '' ;;
    esac
}

tw_pr_noun() {
    case "$(tw_provider)" in
        github) printf 'PR' ;;
        gitlab) printf 'MR' ;;
        *) printf 'PR/MR' ;;
    esac
}

tw_pr_create_cmd() {
    case "$(tw_provider)" in
        github) printf 'gh pr create' ;;
        gitlab) printf 'glab mr create' ;;
        *) printf "your provider's PR/MR create command" ;;
    esac
}

tw_pr_view_cmd() {
    case "$(tw_provider)" in
        github) printf 'gh pr view --web' ;;
        gitlab) printf 'glab mr view --web' ;;
        *) printf "your provider's PR/MR view command" ;;
    esac
}

tw_ci_file() {
    case "$(tw_provider)" in
        github) printf '.github/workflows/ci.yml' ;;
        gitlab) printf '.gitlab-ci.yml' ;;
        *) printf '' ;;
    esac
}

tw_ci_name() {
    case "$(tw_provider)" in
        github) printf 'GitHub Actions' ;;
        gitlab) printf 'GitLab CI' ;;
        *) printf 'CI' ;;
    esac
}

# tw_is_protected <branch>: exact match against protectedBranches
# (default: main, master).
tw_is_protected() {
    local b="$1" list
    list=$(tw_cfg_list '.protectedBranches')
    [ -n "$list" ] || list=$'main\nmaster'
    printf '%s\n' "$list" | grep -qxF "$b"
}

# ---------------------------------------------------------------------------
# Scanners — secrets and junk. Hit output is always file:line, NEVER the token.
# ---------------------------------------------------------------------------

# High-signal secret patterns only — additions here must never fire on
# ordinary source code. Repo-specific formats go in secretPatternsExtra.
TW_SECRET_RE='sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

tw_secret_re() {
    local extra
    extra=$(tw_cfg_list '.secretPatternsExtra' | paste -sd'|' -)
    if [ -n "$extra" ]; then
        printf '%s|%s' "$TW_SECRET_RE" "$extra"
    else
        printf '%s' "$TW_SECRET_RE"
    fi
}

tw_max_scan_bytes() {
    tw_cfg '.scan.maxFileBytes' '524288'
}

# stdin = file content, $1 = label; prints "label:line" per hit, never the token.
_tw_scan_blob() {
    head -c "$(tw_max_scan_bytes)" | grep -nE "$(tw_secret_re)" 2>/dev/null \
        | cut -d: -f1 | while IFS= read -r line; do
            printf '%s:%s\n' "$1" "$line"
        done
}

tw_secret_hits_staged() {
    local root="$1" f
    git -C "$root" diff --cached --name-only --diff-filter=ACM \
        | while IFS= read -r f; do
            git -C "$root" show ":$f" 2>/dev/null | _tw_scan_blob "$f (staged)"
        done
}

tw_secret_hits_worktree() {
    local root="$1" f
    {
        git -C "$root" diff --name-only --diff-filter=ACM
        git -C "$root" ls-files --others --exclude-standard
    } | sort -u | while IFS= read -r f; do
        [ -f "$root/$f" ] || continue
        _tw_scan_blob "$f" < "$root/$f"
    done
}

TW_DEFAULT_JUNK_RE='(^|/)\.DS_Store$|(^|/)Thumbs\.db$|(^|/)node_modules/|(^|/)__pycache__/|(^|/)\.env(\..*)?$'

tw_staged_junk() {
    local root="$1" re
    re=$(tw_cfg_list '.junkPatterns' | paste -sd'|' -)
    [ -n "$re" ] || re="$TW_DEFAULT_JUNK_RE"
    git -C "$root" diff --cached --name-only | grep -E "$re" || true
}

# ---------------------------------------------------------------------------
# Test gate.
# ---------------------------------------------------------------------------

# Runs test.command (else build.command as the "no tests yet" fallback; else
# passes vacuously). Runs via bash -lc in the configured dir, under `timeout`
# when available. Prints the failure tail on stdout; returns 0 on success.
tw_run_tests() {
    local root="$1" cmd dir secs out
    cmd=$(tw_cfg '.test.command' '')
    dir=$(tw_cfg '.test.dir' '.')
    if [ -z "$cmd" ]; then
        cmd=$(tw_cfg '.build.command' '')
        dir=$(tw_cfg '.build.dir' '.')
    fi
    [ -n "$cmd" ] || return 0
    secs=$(tw_cfg '.test.timeoutSeconds' '240')
    if command -v timeout >/dev/null 2>&1; then
        out=$(cd "$root/$dir" 2>/dev/null && timeout "$secs" bash -lc "$cmd" 2>&1) && return 0
    else
        out=$(cd "$root/$dir" 2>/dev/null && bash -lc "$cmd" 2>&1) && return 0
    fi
    printf '%s\n' "${out:-could not run: $cmd (check test.dir in .claude/teamwork.json)}" | tail -40
    return 1
}
