---
name: adopt
description: "Use to put a repo's web front end on the person's design system: install the kit at the pinned tag, wire its entry CSS and root setup, commit a pin and the rules, and add the check. With --upgrade, moves an adopted repo to a new tag."
argument-hint: "[--upgrade]"
---

# adopt

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

`D` below is the data directory the design area names when it loads, and `P` below is the repo this run works in. Write each out wherever a command says `D` or `P`.

Adoption leaves three things in the repo, all committed: the pin `.agents/design.json` (the system, its version and tag, the token files, what is banned, the allow file, the globs scanned), the rules `.agents/rules/design.md` (the system's own, with a first line naming the version), and the checker `.agents/scripts/design-check.mjs`, which runs on Node alone with no network and no plugin. A web front end only; this route does not touch a native app.

## Step 1: Where things stand

```
node "W/scripts/design.mjs" status --data "D" --root "P"
```

- **No profile:** stop. The person declares their system with the `system` route, which they start; say so.
- **A pin that agrees with the profile:** nothing to adopt. Run the check (Step 7).
- **A pin on another version:** that is an upgrade, below. Go on only with `--upgrade` or the person's yes.

## Step 2: Read the system

```
node "W/scripts/design.mjs" manifest --data "D"
```

Check what `entry.root` takes for granted (a framework version, a CSS toolchain, a provider the root must render) against the repo. Name each one missing and ask before adding it.

## Step 3: Install the kit

Fill `install.kit`'s `{ref}` with the profile's tag, show the person the command, and **ask first**: it writes files into the repo and may need their login to a private registry or repo. Run it in `P` on their yes. A failure stops adoption; report it as it came.

## Step 4: Wire the entry

- Import each file of `entry.css` in the order given, once, in the app's root stylesheet or entry module, before the app's own styles. An import already there is not added twice.
- Do each `entry.root` step once, where the app's root is.

## Step 5: Pin it

Find where the install put the files the manifest's `tokens` names: same file name first, then the same custom properties. Those consumer paths are the pin's tokens.

```
node "W/scripts/design.mjs" pin --tokens <path,path> --data "D" --root "P"
```

Add `--exclude <glob>` for each folder the install wrote the system's own components into (`git status` after Step 3 shows them), and for generated or vendored folders. The system's files are the system's to check: its own gate knows exceptions a pattern list cannot carry, such as the one round dot or the focus outline, so scanning them here reports what the system allows itself. The repo's own code is what the check is for. It writes the pin, the checker and the rules, adds a `design:check` script where there is a `package.json` and a `design` lane where there is an `.agents/manifest.json`, and overwrites nothing. If the repo keeps a hub that lists what `.agents/` holds, add a line for each of the three files.

## Step 6: The person says no

A person who does not want this repo on their system is not asked again: `git config --local agentic-engineering.design off` in `P` stops the session briefing from raising it.

## Step 7: Run the check

```
npm run design:check
```

(or `node .agents/scripts/design-check.mjs` in `P` where there is no `package.json`). What it finds is the list of what is off-system, not a failure of adoption: report it by rule and by file, and offer the `check` route, `/agentic-engineering:design check`, to work through it.

## Upgrade

With `--upgrade`, after the person moved the profile's tag (`profile set <source> --ref <tag>`): run `install.kit` at the new tag (asking first, as in Step 3), then `pin --upgrade` with the same `--data` and `--root`. It moves the pin, keeps its token files and globs unless given new ones, and replaces the checker and the rules. Show the person how the rules changed (`git diff .agents/rules/design.md`), then run the check.

*Done when: `status` says the pin and the profile agree, the checker is current, and the check has run with its findings reported.*
