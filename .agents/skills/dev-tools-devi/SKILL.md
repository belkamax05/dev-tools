---
name: dev-tools-devi
description: Use devi / `dev-tools` — the single launcher for every dev-tools app — to discover apps, run them by name or alias (`dev-tools port kill 3000`), and manage personal aliases. Trigger when unsure which dev-tools app does something, when an alias like `dev-tools convert` or `dev-tools mcp` needs resolving, or when adding an app alias.
---

# devi — the `dev-tools` launcher

`apps/devi`, installed as both `dev-tools` and `devi` (`bin/dev-tools`, `bin/devi`).

```sh
dev-tools list [--json]          # every app and its aliases — start here to discover
dev-tools <app|alias> [args…]    # everything after is passed on: dev-tools port kill 3000
dev-tools alias                  # every alias, its target and where it comes from
dev-tools alias kp porti kill    # personal alias → dev-tools kp 3000
dev-tools alias --remove kp
dev-tools                        # interactive picker
```

## Apps are discovered

Every `apps/<name>/src/run.ts` is an app named after its folder — no registry. Its `package.json`
supplies `description` and aliases:

```json
"dev-tools": { "aliases": ["port", "ports"] }
"dev-tools": { "aliases": { "ai": "", "mcp": "mcp", "skills": "skills" } }   // alias → args
```

Resolution: app name → personal aliases (`~/.config/devi/config.json`) → app-declared aliases.
Nothing can hide an app's own name. Alias targets may chain; loops are reported.

Current apps: giti, agenti, porti, processi, pkgi, bmi, envi, convi, depli, proji, devi — each has
a `dev-tools-<app>` skill.

## Changing devi

`src/run.ts`, `src/core/*`, `src/config/*`. A new app also needs a `bin/<name>` shim and a `bin`
entry in the root `package.json` — see `dev-tools-app-authoring`.
