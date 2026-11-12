# The scripted model

Testing anything that calls a model needs a seam where the model is. The seam is a route: production picks a real provider, tests pick a scripted one that answers from a fixture. The code under test does not know the difference, which is the point; a mock installed inside the agent loop tests the mock.

Select it with an environment variable the runtime already reads, for example `MODEL_ROUTE=faux`, and point it at a fixture file.

## The fixture schema

```json
{
  "rules": [
    {
      "match": { "regex": "add a rollback runbook" },
      "steps": [
        { "text": "Writing the rollback runbook.",
          "tools": [{ "name": "write", "args": { "path": "docs/rollback.md", "content": "..." } }] },
        { "tools": [{ "name": "bash", "args": { "command": "git add docs/rollback.md" } }] },
        { "text": "Committed." }
      ]
    }
  ],
  "fallback": { "text": "I do not have a scripted answer for that." }
}
```

- `rules` are tried in order; the first whose `match.regex` hits the prompt wins.
- `steps` are consecutive assistant turns. A step carries `text`, `tools`, or both; each tool call is dispatched through the same tool layer production uses, so a tool bug still fails the test.
- `fallback` answers an unmatched prompt. Make it obviously wrong text so a missing rule shows up as a failed assertion rather than a plausible pass.

## What it is good for

Deterministic behavior: routing, tool dispatch, permission checks, streaming frames, what the UI renders. Everything that is about the wiring rather than the model.

## What it is not good for

Anything that depends on the model actually reasoning. A scripted route cannot tell you whether the prompt works, whether a tool description is discoverable, or whether the loop terminates on a real model. That is the live lane's job, and it is why a repo that calls a model needs both.
