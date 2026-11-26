---
name: check
description: "Use before calling front-end work done in a repo with .agents/design.json, and when its design check fails: read each finding, fix it with the system's own tokens and components, install a missing component from the system, and allow an exception only on the person's yes."
argument-hint: "[paths...]"
---

# check

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

`D` below is the data directory the design area names when it loads, and `P` below is the repo this run works in. Write each out wherever a command says `D` or `P`.

The check holds the source to the system the repo pinned: a raw colour outside the token files, or a class of a banned family (a hand-set radius, say), is off-system. It reads text, so it says nothing about how a page looks: that is `define-success` and `iterate`.

## Step 1: Run it

```
node .agents/scripts/design-check.mjs --json
```

in `P`, with paths to narrow it to the files the work touched. No `.agents/design.json`: the repo is not on a system, and putting it on one is the `adopt` route. Exit 0 is clean; 1 lists findings, each `{ file, line, rule, text, fix }`.

## Step 2: Read the rules

Read `.agents/rules/design.md` once before the first fix: it is the system's own account of which token and which component does what.

## Step 3: Fix each finding with the system

- **`color`:** the token the value stands for. Read the token files the pin names for the one with that role (or, failing that, that value), and use it the way the rules show (`var(--...)`, or the system's utility class).
- **A class family** (`radius`, `shadow`, ...): the system's component carries it. Use the component, or the token class the rules name, and drop the hand-set class.
- **A component the repo lacks:** look it up in the system's catalog (`node "W/scripts/design.mjs" catalog --data "D"`) and install it with the manifest's `install.item`, `{item}` and `{ref}` filled with the name and the pin's tag. Never hand-roll one.
- **A look the system does not have:** that is a new variant in the system, not a restyle where it is used. Tell the person, and leave the finding listed.
- **`allow`:** an exception with no reason, or one that matches nothing now. Give it the person's reason, or delete it.

## Step 4: Allow only on a yes

Some values have to stay (a brand colour from a partner's logo, a chart palette). Ask the person; on their yes, add an entry to the allow file the pin names:

```json
{ "allow": [ { "file": "src/charts/**", "rule": "color", "text": "#0b6e4f", "reason": "the partner's logo colour, fixed by contract" } ] }
```

`text` narrows it to that value; without it, the entry allows the rule in every file the glob matches. An entry with no reason allows nothing.

## Step 5: Run it again

Until it exits 0, or every finding left is on a list the person has: a new variant to add to the system, or an exception waiting for their answer.

*Done when: the check exits 0 in `P`, or each remaining finding is in your report with what it needs.*
