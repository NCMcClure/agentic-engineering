# The README skeleton

Adapted from standard-readme (https://github.com/RichardLitt/standard-readme/blob/main/spec.md). Each rule below is a `readme-check.mjs` finding; the name in brackets is the finding.

```markdown
# <name>                       or: # <Readable Title> _(<name>)_

<One line, at most 120 characters: what it is.>

<One or more prose paragraphs: why it exists, the problem, who it is for.>

## Security                    optional (or among the repo's own sections)
## Background                  optional
## Install                     required
## Usage                       required
## <the repo's own sections>   any names, only here
## API                         optional
## Maintainers                 optional (or Maintainer)
## Thanks                      optional (or Credits, or Acknowledgements)
## Contributing                required: one to three lines pointing at CONTRIBUTING.md
## License                     required, and last, when a LICENSE sits beside the README
```

## The rules

- **At most 800 words** (`readme-length`). Every whitespace-separated token in the file counts, fenced code included, so a prompt pasted into a text block counts in full. There is no override: depth goes to `docs/` or CONTRIBUTING.md.
- **The title is the name** (`readme-title`). The first non-blank line is a single `# ` heading whose text is the project name. For the root README that is the `readme` block's `name`, else the `project` in `.agents/manifest.json`, else the origin remote's repository name, else the checkout's folder; for an opted-in path it is the containing directory's name. A readable title followed by `_(<name>)_` also passes.
- **A one-liner right after it** (`readme-description`). One line, at most 120 characters, not a quote (`>`) and not a heading. Lines holding only badges may sit between it and the title, with or without a blank line: markdown images inline or by reference, linked or not, and HTML `<img>` or `<a><img></a>`. It is the sentence the repository's description on its forge should repeat, so write them as one.
- **A why** (`readme-why`). At least one more prose paragraph before the first `## `. A list, a table, a quote, or a code block does not count.
- **The sections, by exact name, in order** (`readme-sections`). `Installation` is not `Install`. The repo's own sections (`Deploy`, `Plugins`, `Configuration`) go between Usage and API, never before Install; Security may sit there too. A `## ` line inside a code fence or an HTML comment is not a section, and a closing `#` run counts only after a space, so `# C#` is `C#`. Headings below `## ` are free.
- **No agent plumbing** (`readme-plumbing`). `.agents`, `AGENTS.md`, `CLAUDE.md`, and `.claude` as a path segment, anywhere in the file, code blocks included. `~/.claude/settings.json`, a backticked or bold `AGENTS.md`, `[hub](AGENTS.md#rules)`, and `.agents/scripts` all match; `.claude-plugin/` and `MY-AGENTS.md` do not. A `readme.accept` entry with a why clears one term in one file.
- **Every accept says why** (`readme-accept`). An entry with an empty or missing `why` clears nothing and is a finding itself.
- **There is a README** (`readme-missing`). The root one is always checked.
- **The `readme` block is well formed** (`readme-config`): `name` a string, `paths` a list of globs, `accept` a list of `{path, term, why}`.

## The warnings

`readme-agent-prose` never fails, because both halves are judgment calls:

- a fenced block whose info string is `text`, `prompt`, or empty and that runs past 10 lines: usually a prompt pasted for an agent;
- prose addressed to an agent: "the agent", "your agent", "you are an", "walk me through".

A README that describes what an agent does for the person can keep the phrase; read the line and decide.
