# processi

The process table as a terminal dashboard in the manner of btop — live CPU, sortable, scoped to
you or to the folder you are in, filterable — with the ways to stop what is in it. Plus two
commands for scripts.

```sh
processi                         # dashboard
processi processes|tree|settings # open it on a tab
processi list [text] [--sort=cpu|mem|pid|name|time] [--mine | --here] [--tree] [--limit=N] [--json]
processi kill <pid...> [--force] [--tree]
```

`--here` keeps the processes whose working directory is inside the current folder — the dev
servers, watchers and test runners you started from this project. `kill` is SIGTERM, then SIGKILL
after 2s; `--force` is SIGKILL at once; `--tree` stops each process's children first.

## Tabs

| Tab | Keys |
| --- | --- |
| 📋 Processes | `s` next sort column · `f` All / Mine / This folder · `/` filter (pid, name, command, user) · `k`/Enter stop · `K` kill now · `g` stop with children · `p` stop the parent |
| 🌳 Tree | the same, drawn under each process's parent |
| 🔧 Settings | theme, refresh rate, `e` edit the file |

Everywhere: `1-3`/`Tab` switch tab, `r` refresh, `P` pause, `t` theme, `q` quit. The scope and
sort chips above the list are clickable. The cursor follows the *process* across refreshes, not
the row position, so a re-sort by CPU never leaves `k` pointing at something else; stopping asks
first either way, naming the pid.

## CPU

On Linux, CPU is what each process used since the previous refresh — read from
`/proc/<pid>/stat`, as top does — not `ps`'s lifetime average, which shows a build that has just
started spinning as nearly idle. macOS's `ps` already reports a recent average and is used as is.

## Where settings are kept

`~/.config/processi/config.json` — theme and refresh rate. The last tab, sort and scope are state,
in `~/.local/state/processi/state.json`.
