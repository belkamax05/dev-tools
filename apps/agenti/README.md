# agenti

One source of truth for AI coding agents — `.agents/` and `AGENTS.md` — kept in step with every
IDE you use: Claude Code, Cursor, Antigravity, Devin, VS Code (Copilot). A terminal dashboard,
plus two commands for scripts and CI.

```sh
agenti                        # dashboard for the repository you are in
agenti --user                 # the same for your user-wide setup (~/.agents → ~/.claude, …)
agenti agents|mcp|skills|health|ide
agenti ide claude-code        # make an IDE the primary one
agenti status [--check] [--json]   # --check exits 1 on drift — for CI
agenti sync [--skills] [--quiet]   # make every IDE match, wherever that is safe unattended
```

The repository is the nearest folder with an `.agents` in it, looking up from the current
directory but never past the git root; without one, the git root.

## What goes where

`.agents/` holds `rules/`, `skills/`, `agents/`, `commands/`, `workflows/`, `settings.json` and
anything else you like. Each IDE reads what it has a place for; the rest shows as unused.

| IDE | rules | skills | agents | commands / workflows | settings.json | instructions |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/rules` | `.claude/skills` | `.claude/agents` | `.claude/commands` | `.claude/settings.json` | `CLAUDE.md` imports `AGENTS.md` |
| Cursor | `.cursor/rules/*.mdc` (generated) | — | — | `.cursor/commands` | — | reads `AGENTS.md` itself |
| Antigravity | `.agent/rules` | — | — | `.agent/workflows` | — | `GEMINI.md` → `AGENTS.md` |
| VS Code | `.github/instructions/*.instructions.md` (generated) | — | — | `.github/prompts/*.prompt.md` (generated) | — | `.github/copilot-instructions.md` → `AGENTS.md` |
| Devin | all of `.agents` mirrored into `.devin` | | | | | reads `AGENTS.md` itself |

Linked entries are relative symlinks, so they work in every clone. Where an IDE needs its own
format, agenti generates a copy with the IDE's front matter and a marker line — edit the source,
not the copy. Rule front matter in `.agents` may use `globs`, `paths` or `applyTo`; all three
mean the same thing. The user scope (`--user`) currently covers Claude Code, whose user folders
mirror the project ones under `~/.claude`.

Nothing is ever overwritten or deleted that `.agents` does not already hold: a file that
differs is reported, and adopting it (IDE → `.agents`) or pushing (`.agents` → IDE) is your
call.

## Tabs

| Tab | Keys |
| --- | --- |
| 🤖 Agents | `Space` link/unlink · `a` adopt · `p` push · `v` preview/diff · `e` edit · `x` delete · `o` reveal · `←/→` fold. The first row is `AGENTS.md` and the IDE's instructions file. |
| 🔌 MCP | `p` to IDE · `a` to reference · `P` all missing · `S` scope (project / local / user) · `y`/`n` approve/deny (Claude Code) · `d` on/off · `x` remove · `i` tools · `s` set token · `e`/`E` edit |
| 🧩 Skills | `/` search · `i` install · `u` update · `x` remove · `e` edit · `G` this repo / user-wide · `R` restore from `skills-lock.json` |
| 🩺 Health | `f` fix · `F` fix all — git hygiene, secrets in shared files, pending MCP approvals, unrestored skills, instructions, stale links, SKILL.md validity, broken links, rule size |
| 💻 IDE | `Space` keep this IDE in step · `Enter` make primary · `l` launch in the repo · `→` into the details (binary, MCP file, config) · `g` logo drawing |

Everywhere: `1-5`/`Tab` switch tab, `[` / `]` switch IDE, `r` refresh, `t` theme, `q` quit.
Deletes, overwrites and mode switches ask first. `e` hands the terminal to `$VISUAL`/`$EDITOR`,
and launching Claude Code hands it the terminal; the dashboard comes back where it was.

## MCP

The reference config is `.agents/mcp_config.json` (or `config/mcp_config.json`). Each IDE's own
scopes are shown one at a time: Claude Code's project `.mcp.json`, plus its local and user
scopes, which are changed only through `claude mcp` since Claude Code owns `~/.claude.json`.
Claude Code will not start a project server until it is approved; agenti shows that and
approves or denies in `.claude/settings.local.json`.

Tokens live in `.env.user` at the repo root. A server's tokens are the `${NAME}` placeholders in
its `args`/`env`/`url`, plus any listed in a top-level `requiredEnv` map in the reference file,
for servers that read them some other way:

```json
{ "requiredEnv": { "issue-tracker": ["TRACKER_TOKEN"] }, "mcpServers": { } }
```

## Where settings are kept

`~/.config/agenti/config.json` (the platform's config home): per repository the IDEs it is kept
in step with (the first is primary); the theme, logo drawing mode and last tab. A bare `agenti`
opens on the last tab used.

## sync, for automation

`agenti sync` makes only changes that need no judgement: links and generated copies that are
missing, generated copies that have gone stale, an instructions file that is missing (or an
import-style one missing its import), and reference MCP servers missing from an IDE's project
file. Anything that differs by hand, or exists only in the IDE, is listed and left. User-scope
MCP files are never touched by sync. `--skills` also reinstalls skills listed in
`skills-lock.json` that are missing. Run it from a post-checkout hook, a repo manager, or CI.

## For other repos

The logic is in `src/core/*`, free of React, and reachable as `@/dev-tools/agenti/core/*`
through the same `paths` convention as `@/dev-tools/giti/*` — see `tsconfig.json`.

## Commands

```sh
bun test
bunx tsc --noEmit
bun run lint
```
