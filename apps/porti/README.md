# porti

What is listening on your ports, and a way to stop it — a terminal dashboard in the manner of
btop, plus commands for scripts. Works on whatever machine it runs on; nothing is tied to a
repository.

```sh
porti                            # dashboard
porti watched|listening|settings # open it on a tab
porti list [--all] [--json]      # the watched ports (--all: every listening port)
porti status 3000 5173           # who holds them; exits 1 when any is taken
porti kill 3000 [--force] [--tree]
porti watch 5173 vite            # add (or rename) a watched port
porti unwatch 5173
porti config                     # where the watched ports are kept
```

`kill` sends SIGTERM, waits 2s, then SIGKILL; `--force` sends SIGKILL at once and `--tree` stops
the owner's child processes as well (children first). Only the process that holds the socket is
signalled, never its process group — a dev server's group usually includes the shell it was
started from.

## Tabs

| Tab | Keys |
| --- | --- |
| 🎯 Watched | the watched ports, free or taken. `k`/Enter stop · `K` kill now · `g` stop with children · `p` stop the parent (the watcher that restarts it) · `w` unwatch · `n` rename · `a` watch another |
| 📡 Listening | every port something listens on. The same keys, plus `/` filter (port, name or command) and `w` to start watching one |
| 🔧 Settings | watched ports (`a` add, `n` rename, `x` remove, re-add the defaults), theme, refresh rate, `e` edit the file |

Everywhere: `1-3`/`Tab` switch tab, `r` refresh, `P` pause the timer, `t` theme, `q` quit. Every
button and row is clickable. Stopping always asks first, and the port is re-read before the
signal is sent, so a confirmation answered after the port changed hands never kills the
newcomer. The refresh timer stops while a question is on screen.

## Where settings are kept

`~/.config/porti/config.json` — the theme, the refresh rate and `ports`, a list of
`{ "port": 5173, "name": "vite" }` (or bare numbers). A first run watches 3000, 4200 and 8080;
an emptied list stays empty. The last tab is state, in `~/.local/state/porti/state.json`.

## How it reads the ports

`ss -tlnp` on Linux (fast enough to refresh every second), `lsof -iTCP -sTCP:LISTEN` elsewhere,
joined with one `ps` read of the process table. A socket another user owns is listed without a
process unless porti runs as root — the port still shows as taken.
