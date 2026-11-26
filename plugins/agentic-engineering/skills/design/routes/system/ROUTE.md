---
name: system
description: "Use when the person wants to declare, change, or see the one design system all their front ends follow: where it lives, at which tag, and what it bans. Reads the system's design-system.json, or interviews for one when the system ships none."
argument-hint: "[<local folder or owner/repo> [--ref <tag>]]"
---

# system

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

`D` below is the data directory the design area names when it loads. Write it out wherever a command says `D`.

A person picks one design system for all their projects. This route records which one in their profile, on this machine and never in a repo: `{ source, ref }`, where the source is a local folder or a GitHub `owner/repo` and the ref a tag or a branch. A GitHub source is read through the person's own `gh` login, so a private system works. Adopting it in a repo is the `adopt` route; this one only says which system.

## Step 1: What is declared

```
node "W/scripts/design.mjs" profile show --data "D"
```

If one is declared and the person only asked to see it, run `node "W/scripts/design.mjs" manifest --data "D"`, summarise it (name, version, the install command, the token files, each banned family, the allow file) and stop.

## Step 2: Where the system lives

With no source in the arguments, ask one question: where the system lives. Recommend the repository the system is developed in, and a tag rather than a branch, so every repo pins a version that does not move under it.

```
node "W/scripts/design.mjs" profile set <folder or owner/repo> --ref <tag> --data "D"
```

## Step 3: Read its description

```
node "W/scripts/design.mjs" manifest --data "D"
```

The system describes itself in `design-system.json` at its root (schema 1: `install`, `entry`, `tokens`, `rules`, `catalog`, `banned`, `allow`). When it prints, summarise it as in Step 1 and you are done. When it says the description is not schema 1, name each problem to the person: the fix belongs in the system's own file.

## Step 4: A system that ships no description

When the source has no `design-system.json`, the best fix is one in the system, if the person can edit it: offer that first. Otherwise interview for each field, **one question at a time**, each with a recommended answer you read out of the system first (its README, its `package.json`, its CSS, its docs):

1. `name` and `version`.
2. `install.kit`: the one command that installs the core kit, with `{ref}` where the tag goes.
3. `install.item`: the command that installs one named item, with `{item}` and `{ref}`.
4. `install.pin`: a sentence on how a consumer records the tag.
5. `entry.css`: the CSS a consumer imports, in the order required.
6. `entry.root`: each one-time root setup step, a sentence each.
7. `tokens`: the files, in the system's repo, where raw colour values may be defined.
8. `rules` and `catalog`: the paths of the usage rules and the component index.
9. `banned.values` (`["color"]` bans raw colours outside the token files) and `banned.classes`: each family a `name` and a regular expression tested against one class's utility, such as `{ "name": "radius", "pattern": "^rounded(-.+)?$" }`.
10. `allow`: the file name a consumer keeps its exceptions in.

Write the answers as one JSON object to a file in your scratch space, then:

```
node "W/scripts/design.mjs" profile manifest <that file> --data "D"
```

It refuses a description that is not schema 1 and says why. The source still serves the rules and the catalog, so `rules` and `catalog` must name files the source has.

*Done when: `node "W/scripts/design.mjs" manifest --data "D"` prints the system's description, from the source or from the profile.*
