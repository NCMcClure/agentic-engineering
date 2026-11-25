<!-- agent-works:plugins — written by `aw setup --apply`; change it there, not here -->
## Agent plugins

These areas of the `agentic-engineering` plugin carry this project's ways of working. Each is a skill that takes a route as the
first word of its arguments (`/agentic-engineering:<area> <route>`): call it when its case comes up, and name the ones a task
needs in the brief of every sub-agent you dispatch.

| Area | What it is for | Take its route when |
|---|---|---|
| **agents** | How agents work side by side: the kanban board, a round of work run as subagents or child sessions, briefs, and locks, leases and notes across the machine (the `aw` command). | work outside your change, an owed check, task status (`board`); dispatching agents (`orchestrate`); before a scarce application, a heavy job or a timing run (`coordinate`, `locks`) |
| **harness** | Where each agent-facing fact lives: memory, status, decisions, hubs, the guard, and the doctor that keeps them small (on the same `aw` command). | starting a task or recording a lesson (`memory`); a directory added or moved (`hubs`); a hard-to-reverse choice or a new term (`decisions`); a refused command (`guard`); agent files that bloat or repeat (`doctor`); unsure where something goes (the area alone, with no route) |
| **code** | Keeping the code's shape maintainable as it grows: a tidy tree, files of a readable size, deep modules, each change behind the project's own checks. | a folder or the root sprawls (`organize`); modules are shallow, tangled or hard to test (`deepen`); oversized files or a sweep of the whole codebase (`restructure`) |
| **design** | Work judged by eye or ear, done as a measured loop: success defined first, a few proving shots, the source probed before a fix, an independent verdict, taste questions queued for the owner. | before changing how something looks, moves or sounds (`define-success`); every change-and-check (`iterate`); a difference whose cause is unknown (`probe`); a verdict or the owner's queue (`judge`); a gate that wobbles (`calibrate`); motion (`motion`); sound (`audio`) |
| **docs** | User docs that move in the same change as the code: a writer contract per audience, screenshots made only by the capture harness, and a checker that maps code to pages. | a change touches something a user, integrator or operator sees (`sync`); a page needs a screenshot or a shot is stale (`shots`); "are the docs current" (`audit`); adopting it, which the person asks for (`init`) |

If the `agentic-engineering` plugin is not installed: say so once, and follow this file's rules by hand.
<!-- /agent-works:plugins -->
