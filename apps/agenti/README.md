# agenti

`.agents`, MCP servers and skills for the repository you are in — shulker-controller's web
Agents / IDE MCP / Skills pages as one terminal dashboard, for a single repository.

```sh
agenti                 # dashboard, on the IDE tab the first time in a repo
agenti agents|mcp|skills|ide
agenti ide claude-code # pick the IDE without opening anything
agenti status          # plain-text summary, for scripts
```

The repository is the nearest folder with an `.agents` in it, looking up from the current
directory but never past the git root; without one, the git root. There is no list of repos
and no compare mode — `cd` somewhere else instead.

## Tabs

| Tab | Source of truth | Compared against | Keys |
| --- | --- | --- | --- |
| 🤖 Agents | `.agents/` | the IDE's folder (`.claude/`, `.cursor/`, …) | `Space` link/unlink · `a` adopt · `p` push · `e` edit · `x` delete · `m` link mode · `o` reveal · `←/→` fold |
| 🔌 MCP | `.agents/mcp_config.json`, else `config/mcp_config.json` | the IDE's MCP config | `p` to IDE · `a` to reference · `P` all missing · `d` on/off · `x` remove · `i` list tools · `s` set token · `e`/`E` edit |
| 🧩 Skills | `.agents/skills` via the `skills` CLI | skills.sh | `/` search · `i` install · `u` update · `x` remove · `e` edit |
| 💻 IDE | — | — | `Enter` use for this repo |

Everywhere: `1-4`/`Tab` switch tab, `r` refresh, `t` theme, `q` quit. Deletes, overwrites and
mode switches ask first (`y` to confirm). `e` hands the terminal to `$VISUAL`/`$EDITOR` and the
dashboard comes back where it was.

## Where things are kept

- **IDE choice and theme** — `~/.config/agenti/config.json` (the platform's config home), per
  repository root, never in the repo.
- **Links** — relative symlinks, so they work in every clone when committed.
- **Tokens** — `.env.user` at the repo root. A server's tokens are the `${NAME}` placeholders in
  its `args`/`env`/`url`, plus any listed in a top-level `requiredEnv` map in the reference
  file, for servers that read them some other way:

  ```json
  { "requiredEnv": { "dfs-jira": ["JIRA_PERSONAL_TOKEN"] }, "mcpServers": { } }
  ```

## Differences from the web version

Deliberate, all in the direction of not losing anything:

- Linking never deletes what the IDE folder has of its own. A folder is linked entry by entry
  when the IDE already has one, and a file that differs is skipped and reported instead of
  overwritten. Switching to directory mode is refused while the IDE folder holds anything
  that is not `.agents` content; switching back to granular re-links every entry instead of
  leaving an empty folder.
- Listing skills only seeds hashes into an existing `skills-lock.json`; it never creates one.
- The `skills` CLI gets an argv, not a shell string, so a search query is never shell input.

## For other repos

The logic is in `src/core/*`, free of React, and reachable as `@/dev-tools/agenti/core/*`
through the same `paths` convention as `@/dev-tools/giti/*` — see `tsconfig.json`.

## Commands

```sh
bun test
bunx tsc --noEmit
bun run lint
```
