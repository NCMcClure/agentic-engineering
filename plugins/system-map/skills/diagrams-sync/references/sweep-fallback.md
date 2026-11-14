# The sweep without the Workflow tool

`workflows/sweep.js` needs a host with the Workflow tool. In any session without it, run the same seven phases by hand, in order, with the parent session holding what the script would have held. What must not change is who decides and who writes: the plan, the settling, and the config stay with one strong context, and the writers only annotate.

`MAP` is the checker and `SWEEP` the work list: `scripts/system-map.mjs` and `scripts/map-sweep.mjs` at the plugin root, run with `node` from the repo root, as the diagrams-sync skill spells them out. A subagent gets both commands with their real paths: it does not share your context.

## With a subagent tool

1. **Scan, yourself.** `SWEEP --root .` is the work list. Its numbers come from the script; never estimate them.
2. **Plan, yourself.** Read what the repo says about its own layout and the config, and write what the workflow's planner returns: one unit per module with its dir, its entry file (directly in that dir), its id, title, and layer, and a brief for its writer; then the config's new externals, config nodes, excludes, and accepts. Every annotated module keeps its id and entry. Check it as the script does: no two units share a dir, an entry, or an id, and every unowned directory sits under a unit, an exclude, or a `NODE_MISSING` accept. Use the strongest model the host gives you.
3. **Config, yourself.** Apply the delta to `.agents/system-map.json` before any module starts. One writer, always.
4. **Annotate, in parallel.** One subagent per unit, launched in one message, each told its module, the modules nested in it (whose files are not its), the ids it may name, and that it edits only `@system` lines in the files it owns; it runs `SWEEP --unit <dir>` before and after. Where the host lets you pick a model, a small module (at most 3 source files and 4 findings) takes the cheaper one. Then one subagent per module reviews it against its code, adversarially, and its fixes go back to a writer. A reviewer is never the writer it reviews, and a config node's fixes come to you, not to a subagent.
5. **Settle, yourself.** Gather every item the writers and reviewers deferred, and the checker's `LAYER_VIOLATION` and `EGRESS_OUTSIDE_ADAPTER` findings, and decide each: a new layer, an accept with a why, an external, a config change, or a move for the user. Apply all but the moves.
6. **Verify, yourself.** `MAP --write`, then `MAP`, then fix what it reports, until it prints `0 warning` apart from the moves. After three rounds, stop and report what is left.
7. **Critique.** One fresh subagent reads the finished map and the repo's own description of its layout and reports what is wrong with the whole. It edits nothing.

## With no subagents at all

Run the same phases serially, one module at a time. Re-read each module's code before reviewing it rather than trusting what you just wrote, and say in the report that every module was written and reviewed by the same session.

## Either way

Nothing is committed, no node id is renamed, and no code moves. Report what the workflow would: the plan, the modules written and reviewed, the decisions and the moves, what the checker still reports, and the critic's notes.
