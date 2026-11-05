---
name: dev-tools-consuming
description: How another repository uses dev-tools — as a subrepo/submodule workspace member or an installed package, the `@/dev-tools/*` path alias, what is safe to import (React-free `core/*` and utils vs Ink components), sharing one react/ink copy, and spawning an app's bin instead of importing its TUI. Trigger when wiring a dev-tools app or lib into another repo's CLI, hitting "invalid hook call"/two-React errors, or deciding import vs spawn.
---

# Consuming dev-tools from another repo

## Ways in

- **Workspace member** — vendored at `libs/dev-tools` (git subrepo or submodule) and listed in the
  host's `workspaces`. Bun's isolated linker shares one physical `react`/`ink`, so anything may be
  imported, components included.
- **Vendored but outside the workspace** — vendored at `libs/dev-tools` but excluded from the
  host's `workspaces` (`"!libs/dev-tools"`), with its own `bun install`. Two React copies: import
  only React-free code and spawn bins for anything with a UI.
- **Installed package** — `bun add github:belkamax05/dev-tools[#ref]` (`@belkamax05/dev-tools`,
  shipped as source; Bun applies each app's own `tsconfig` paths inside `node_modules`). Shares
  react/ink only if the ranges match — check `bun why react` (exactly one version).
- **Global bins** — `bun add -g github:belkamax05/dev-tools`, or put `libs/dev-tools/bin` on PATH
  (`include` / `.envrc`). Agents don't get direnv's PATH — call `<path>/bin/<app>` explicitly.

Path alias in the host `tsconfig`:

```jsonc
"paths": { "@/dev-tools/*": ["./libs/dev-tools/libs/*"] }   // plus per-app aliases, e.g.
// "@/dev-tools/envi/*": ["./libs/dev-tools/apps/envi/src/*"]
```

## Import or spawn?

| Need | Do |
| --- | --- |
| Logic (resolve env, read packages, run a project, list processes) | import React-free `@/dev-tools/<app>/core/*` or the app's library entry (`@/dev-tools/envi/index`, `@/dev-tools/proji/core/project`) |
| Formatting / process / config helpers | import `@/dev-tools/utils/*`, `@/dev-tools/config/*` |
| A whole app or its dashboard | **spawn** its bin: `spawnSync('bun', [bin, ...args], { stdio: 'inherit', cwd })` and exit with its status |
| A picker inside your own Ink app with its own React | `ui/dialogs/*` only (mounts its own Ink tree, exchanges plain data) |
| Components/hooks | only as a workspace member sharing the same react/ink |

Spawning rules:
- Resolve the bin from the alias so layouts don't matter:
  `join(dirname(Bun.resolveSync('@/dev-tools/<app>/run', import.meta.dir)), '../../../bin/<app>')`.
- Run in the user's working directory — apps resolve configs from cwd.
- Pass project context via env (`PORTI_PROJECT_DIR`, `DEPLI_PROJECT_DIR`, `PROJI_PROJECT_DIR`,
  `GITI_CONFIG`, `BMI_WORKSPACE_ROOT`) rather than flags.
- envi must be spawned with `bun --no-env-file` (Bun would otherwise preload `.env`).

## Symptoms

"Invalid hook call" / hooks throwing → two React copies: you imported a component from outside the
shared workspace. Spawn the bin or use `ui/dialogs/*` instead.
