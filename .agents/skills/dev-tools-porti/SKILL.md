---
name: dev-tools-porti
description: Use porti (dev-tools) to see what is listening on ports and stop it safely — `porti status 3000`, `porti kill`, Docker containers publishing a port, watched ports and a project's `porti.config.ts`. Trigger on "port already in use"/EADDRINUSE, when a dev server won't start, to find what holds a port, or to free one.
---

# porti — listening ports

`porti` lives in `apps/porti` (`bin/porti`). Not tied to a repo.

## Commands

```sh
porti status [3000 5173]          # who holds them; exit 1 when any is taken — start here
porti list [--all] [--json]       # watched ports (--all: every listening port)
porti kill 3000 [--force] [--tree]
porti docker-kill 8080 [--yes]    # docker rm -f the containers publishing it
porti watch 5173 vite   porti unwatch 5173
porti config
porti                             # dashboard: watched|listening|settings
```

## Stopping safely

- Run `porti status <port>` first and tell the user what holds it (pid, command) before killing
  anything that you didn't start yourself.
- `kill`: SIGTERM, wait 2s, SIGKILL. `--force` = SIGKILL now; `--tree` stops children first. Only
  the socket owner is signalled, never its process group (that often includes the user's shell).
- If a watcher restarts it, kill the parent (dashboard `p`, or find it with `processi`).
- `docker-kill` lists containers (stopped ones too) and asks; without a TTY it needs `--yes` —
  only pass `--yes` when the user asked to remove them. Retries once via `sudo docker`.

## Project ports: `porti.config.ts`

Nearest at/above cwd, or `$PORTI_PROJECT_DIR`. Watched alongside the user's list, never written
into it; the project's label wins.

```ts
export default { ports: [{ port: 5173, name: 'web', description: 'Vite dev server' }] };
```

User list: `~/.config/porti/config.json` (`ports`, theme, refresh); state
`~/.local/state/porti/state.json`. Reads `ss -tlnp` on Linux, `lsof` elsewhere; sockets of other
users show as taken without a process unless root.

## Changing porti

`src/run.ts`, `src/core/*`, `src/ui/*`. Verify with `bun test`, `bunx tsc --noEmit`, `bun run lint`
from `apps/porti`.
