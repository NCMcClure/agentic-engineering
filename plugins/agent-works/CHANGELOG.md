# Changelog

- **0.3.0**: **Remote sync carries epics and sprints.** A card's sprint sets its issue's milestone (made when
  missing, due on the sprint's end); a card's epic hangs its issue from the epic's (GitHub sub-issues, GitLab
  group epics), with an `epic:<id>` label where the tracker has neither. Pulls read both back without inventing
  sprints. Cards planned into neither keep the sync hash they had, so turning this on pushes nothing new.
- **0.2.0**: **Epics and sprints on the kanban board**, so the board stays short. A sprint (in `board.json`) is
  the board's default scope while it is active; closing it archives its done cards and rolls the rest on. An epic
  is a card of `kind: epic`; cards join one with `epic:`, and an agent starting one of them gets the epic's goal in
  its prompt (starting the epic itself asks for a breakdown). The pane gains a scope switch (`v`), an Epics view
  (`e`) and a Sprints view (`p`); `list_tasks` lists one scope and counts the rest; a new `plan_task` tool and
  `aw kanban plan|epics|sprint` commands; lint names unknown epics and sprints and an overdue sprint. Remote sync
  leaves both fields local.
- **0.1.5**: docs-parity joins the plugins block: `plugins` may name it, and the root `AGENTS.md` then says when to
  open `docs-sync`, `docs-shots`, `docs-init` and `docs-audit`. `homes.md` names the writer contract's home,
  `.agents/contracts/docs.md`, beside the user docs folder.
- **0.1.4**: **A worktree no longer names the project after itself**: `aw setup --apply` run in a linked worktree
  (`.claude/worktrees/agent-abc123`) titled `.agents/README.md` and a new root `AGENTS.md` with that folder's name,
  and the main checkout then saw the page as different. The name is now the main working tree's folder name, or
  `"name"` in the config when set (also what `aw who`, notes and learnings show; the project's id in the store is
  unchanged). **Accepted findings**: `"accept": [{"code", "path", "why"}]` in the config takes a finding the owner
  decided to keep out of the count and the exit code, in `aw doctor` and in every single check; `aw doctor` says how
  many in one line, `--accepted` and `--json` list each with its why. A critical finding and `CONFIG_INVALID` are
  never accepted, and an entry that matches nothing is `ACCEPT_UNUSED` (info). Run `aw setup --apply` to restamp
  `.agents/README.md`.
- **0.1.3**: Defects found while migrating a real project. **`/kanban` opens the pane again**: the skill that shared
  the command's name is now `kanban-cards` (`agent-works:kanban-cards`; run `aw setup --apply` to refresh the
  § Agent plugins of your root `AGENTS.md`), and the command says so in a toast when the pane cannot open. The guard: a project rule now sees what a command
  sets in its environment (`X= cmd`, `env X= cmd`, `export X=`, `$env:X = ""`), so "never clear this variable" is
  data; resource locks and run budgets no longer take `git add <script>`, `cp`, `mv` or `rm` for running the
  script (`matchFileCommands` restores the raw reading); a `match` entry may carry its own `unless`
  (`{ "pattern", "unless" }`), checked by `aw doctor`; `default-branch-commit` reads the branch of the checkout
  the commit runs in (`cd <worktree> && git commit`). Decisions: `new` titles a record as the folder's latest are
  (`# ADR 0014: Title`); the lint and the index read Status, Sources and
  Date in the ADR line forms (`- **Status:** accepted`), and a hand-written `README.md` index is kept
  (`DEC_INDEX_HANDWRITTEN`, `aw decisions index --adopt`) as memory's are. `aw doctor` finds briefs and hand-overs
  left in scratch folders, git-ignored ones included (`BRIEF_STRAY`, names in `briefs.stray`). `links.files` adds
  the root README to what `aw links` reads. Memory: `index --adopt` no longer carries a `Parent:` link into the
  root index, and a folder index left with its placeholder line is `MEM_INDEX_PLACEHOLDER`. The limits of
  `aw note` (200) and `aw learn add --topic` (120) are in the help, the reference and the refusal.
- **0.1.2**: The root `AGENTS.md` introduces the project's plugins (agent-works, codebase-optimizer,
  perceptual-loop: what each is for, when to open each skill) in a marked § Agent plugins that `aw setup --apply`
  writes and `aw doctor` checks (`ROOT_PLUGINS`), so sessions and sub-agents are primed at start. The list is
  `plugins` in the config.
- **0.1.1**: The git cadence (branch, commit, push, pull request, merge) no longer waits for approval unless the
  owner asked for it: a commit on the default branch is a warning (`guard.defaultBranch.commit`, was `ask`), and
  `setup`, the common brief and the generated `.agents/README.md` say so.
- **0.1.0**: Initial release: one home per fact under `.agents/` with budgets, `aw doctor` and its checks, hub
  verifier and `CLAUDE.md` twins, generated memory and decision indexes, the kanban board (formerly claudeban)
  with owed gates, the agent guard, and machine-wide locks, leases, notes, claims and shared learnings through
  the `aw` CLI.
