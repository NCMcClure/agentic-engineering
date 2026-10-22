# Audiences: the roots and what each may hold

A docs set that writes for everyone writes for no one. Split it by who reads it, and give each root a list of
what it may contain, so a writer can decide a sentence's home without a judgement call.

## The three roots

| Root | Reads it | Allowed | Never |
|---|---|---|---|
| **Guide** | people who use the product | the product's own words: screens, buttons, menus, what happens, why | code, commands, file or source paths, environment variables, endpoints, internal names |
| **Developers** | people who integrate the product into their own code or tools | the public surface: HTTP, JSON, payloads, SDK calls, CLI commands, curl, webhooks, auth flows they perform | how to run, deploy, configure, or contribute to the product; anything only an operator sees |
| **Admin** (or Operators) | people who run, deploy, configure, or contribute to the product | env var names, config files, deploy steps, CLIs of the repository, backups, keys (who holds them, never the values) | source paths (cite the command or the setting, not the file), secrets |

Rules that hold across roots:

- **A public root never links into a private one.** If the Guide needs an operator's step, it says "ask your
  administrator to ..." The checker reports a link that crosses as `ROOT_LEAK` (critical).
- **No root cites a source path.** A page that needs one is describing the code, which is the code's own docs
  (its hub, its comments), not the product's.
- **Mark the private root private** in the config (`"private": true`), and gate it in the product when the
  docs ship with it (serve the private root only to signed-in operators, and keep it out of search).
- **The same fact is written once,** in the root of the reader who acts on it, and linked from the others where
  the direction allows.

## Fewer roots

Most projects need fewer. Collapse by reader, not by size:

- A CLI or library: one root (its users are its developers). Allowed: commands, flags, code. Never: internals.
- An app with no public API: Guide plus Admin.
- An internal tool its own team runs: Guide plus Admin, or one root with an "Operating it" section.

## Deny patterns

A root's `deny` list in the config makes its "Never" column checkable. Useful starting points for a Guide:

| Catches | Pattern |
|---|---|
| a backticked source path | `` `[^`]*/[^`]*\.(ts|tsx|js|py|rs|cpp|h|go)` `` |
| an environment variable | `\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b` |
| an internal codename | the codename, as a word: `\bProjectX\b` |

Patterns run on the page body outside fenced code blocks (a Developers page's example code is never denied by
accident); a Guide that needs a fenced block has already broken its rule. Keep the list short and real: a
pattern that fires on legitimate prose gets accepted into silence and then catches nothing.

## Real people, real data

No root and no screenshot shows a real person, email, customer, token, or internal-only feature. Use a
fictional cast (`shot-contract.md`), and an `example.invalid` style domain that can never resolve.
