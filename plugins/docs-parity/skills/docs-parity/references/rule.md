# User docs

User docs move in the same change as the code. A change that alters anything a user, integrator, or operator sees or depends on (a screen, a label, a flow, a command, a flag, a config key, an endpoint, a permission, an error message, an install or deploy step) updates the pages that describe it and retakes the screenshots it made wrong, in that commit or pull request. Docs that ship later ship wrong.

The session hook carries the short form of this page into every session, and every sub-agent that acts, in a repo that has `.agents/docs-parity.json`. This is the long form.

## The rules

**Say what moved.** The commit message or the pull request body carries one line: `Docs: <pages touched>`, or `Docs: none, <why>`. A refactor with no visible effect is a fine why; "later" is not.

**Ground every claim.** Every command, flag, default, and example on a page was run or read from the built product before it was written. Spec text and issue text are vocabulary, never evidence.

**Screenshots come from the capture harness, never by hand.** A picture is a named shot the harness takes from the built product, on its own port with scratch data, a pinned clock, and a fictional cast. Look at every image you wrote, every theme, before you commit it.

**Write for one reader per page.** User pages carry no code, paths, or env vars; integrator pages carry the public surface; operator pages carry deploy and config; no page cites a source path, and a public page never links into a private one.

**Nothing agent-facing goes in the user docs folder.** The writer contract, the config, and anything else written for agents live under `.agents/`.

## Opting in

A repo with user docs adopts the rule and its checks with `/docs-parity:docs-init`: it writes `.agents/docs-parity.json` (where the docs are and which code each page and shot describes) and the writer contract `.agents/docs-contract.md`. From then on the session hook delivers the rule, the Stop hook tells the agent when a turn leaves the docs behind, and CI can run a copy of `docs-check.mjs` on every pull request. `/docs-parity:docs-sync` brings the docs level with a change. A repo without the config hears nothing from this plugin.
