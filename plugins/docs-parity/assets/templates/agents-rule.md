- **User docs move with the code.** A change that alters anything a user, integrator, or operator sees or
  depends on updates the affected pages in `{{DOCS_ROOT}}` and retakes the affected screenshots (through the
  capture harness, never by hand) in the same change, and the commit or PR body says `Docs: <pages>` or
  `Docs: none, <why>`. The writer contract is `.agents/contracts/docs.md`; `docs_check.py --changed` checks it.
