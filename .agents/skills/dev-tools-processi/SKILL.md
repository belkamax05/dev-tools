---
name: dev-tools-processi
description: Use processi (dev-tools) to list and stop processes — sortable by CPU/memory, scoped to the current folder (`--here`) or your user, as a tree — with safe kill semantics. Trigger to find leftover dev servers, watchers or test runners started from a project, to see what is eating CPU/memory, or to stop a process (and its children).
---

# processi — the process table

`processi` lives in `apps/processi` (`bin/processi`).

## Commands

```sh
processi list [text] [--sort=cpu|mem|pid|name|time] [--mine | --here] [--tree] [--limit=N] [--json]
processi kill <pid…> [--force] [--tree]
processi                          # dashboard: processes|tree|settings
```

- `--here` keeps processes whose working directory is inside the current folder — the dev
  servers, watchers and test runners started from this project. Best first query:
  `processi list --here --json`.
- `kill`: SIGTERM, then SIGKILL after 2s; `--force` = SIGKILL now; `--tree` stops children first.
- Before killing a pid you didn't start, show the user what it is (name, command, cwd).
- For "port in use", start with `porti status <port>` instead; use processi for the parent/watcher.

Settings: theme and refresh rate (`e` in Settings edits the file).

## Changing processi

`src/run.ts`, `src/core/*`, `src/ui/*`. Verify with `bun test`, `bunx tsc --noEmit`, `bun run lint`
from `apps/processi`.
