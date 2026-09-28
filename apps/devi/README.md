# devi — `dev-tools`

One entry point for every app in this repository. Installed as two commands, `dev-tools` and
`devi`, which are the same thing.

```sh
dev-tools                          # pick an app (or one of your aliases) from a list
dev-tools porti kill 3000          # = porti kill 3000 — everything after the app is passed on
dev-tools port kill 3000           # the same, through porti's own alias
dev-tools list [--json]            # apps and their aliases
dev-tools alias                    # every alias, what it runs, where it comes from
dev-tools alias kp porti kill      # add one of yours: dev-tools kp 3000 → porti kill 3000
dev-tools alias --remove kp
```

## Apps are discovered

Every folder in `apps/` with a `src/run.ts` is an app, named after its folder — a new one shows
up in the list and becomes a command with no registry to edit. Its `package.json` gives the rest:

```json
{
  "name": "porti",
  "description": "Listening ports — watch, inspect and stop what holds them",
  "dev-tools": { "aliases": ["port", "ports"] }
}
```

For an alias that opens a subcommand or a tab, `aliases` is an object of alias → arguments
instead (an empty string is the app itself) — agenti's:

```json
"dev-tools": { "aliases": { "ai": "", "mcp": "mcp", "mcps": "mcp", "skill": "skills", "skills": "skills" } }
```

so `dev-tools mcp` runs `agenti mcp`, and `dev-tools mcp --user` runs `agenti mcp --user`.

## Aliases

Resolved in this order: an app's own name, then your aliases, then the aliases apps declare. So
yours can override an app's alias, but nothing can hide an app — `dev-tools porti` is porti on
every machine. An alias's target is a command line (an app or another alias, plus arguments), and
whatever follows the alias is appended to it; loops are reported rather than followed.

Yours are kept in `~/.config/devi/config.json`, safe to keep in dotfiles:

```json
{ "aliases": { "kp": "porti kill", "k3": "kp 3000 --force", "up": "pkgi outdated" } }
```
