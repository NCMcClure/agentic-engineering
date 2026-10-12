<!-- agent-works:plugins — written by `aw setup --apply`; change it there, not here -->
## Agent plugins

These plugins carry this project's ways of working. Their skills load on demand: open one when its case comes up,
and name the ones a task needs in the brief of every sub-agent you dispatch.

| Plugin | What it is for | Open it when |
|---|---|---|
| **agent-works** | Where each agent-facing fact lives and how agents work side by side: memory, status, decisions, the kanban board, briefs, the guard, and locks, leases and notes across the machine (the `aw` command). | starting a task or recording a lesson (`memory`); work outside your change, an owed check, task status (`kanban-cards`); a directory added or moved (`hubs`); a hard-to-reverse choice or a new term (`decisions`); dispatching agents (`orchestrate`); before a scarce application, a heavy job or a timing run (`coordinate`); a refused command (`guard`); agent files that bloat or repeat (`doctor`); unsure where something goes (`agent-works`) |
| **codebase-optimizer** | Keeping the code's shape maintainable as it grows: a tidy tree, files of a readable size, deep modules, each change behind the project's own checks. | a folder or the root sprawls (`codebase-organizer`); modules are shallow, tangled or hard to test (`improve-codebase-architecture`); oversized files or a sweep of the whole codebase (`optimize-codebase`) |
| **perceptual-loop** | Work judged by eye or ear, done as a measured loop: success defined first, a few proving shots, the source probed before a fix, an independent verdict, taste questions queued for the owner. | before changing how something looks, moves or sounds (`define-success`); every change-and-check (`iterate`); a difference whose cause is unknown (`probe-the-source`); a verdict or the owner's queue (`judge-and-queue`); a gate that wobbles (`calibrate-gate`); motion (`check-motion`); sound (`check-audio`) |

A plugin that is not installed: say so once, and follow this file's rules by hand.
<!-- /agent-works:plugins -->
