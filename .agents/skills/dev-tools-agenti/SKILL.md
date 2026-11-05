---
name: dev-tools-agenti
description: Use agenti (dev-tools) to keep `.agents/` and `AGENTS.md` in step across AI IDEs (Claude Code, Cursor, Antigravity, Devin, VS Code Copilot) — rules, skills, agents, commands, MCP servers. Trigger when adding/editing a skill, rule or MCP server under `.agents`, when `.claude/` (or `.cursor/`, `.github/instructions`, `.devin`) is out of sync or a skill isn't picked up, when checking drift in CI, or when changing agenti itself.
---

# agenti — one `.agents/` for every AI IDE

`agenti` lives in `apps/agenti` of the dev-tools repo (`bin/agenti`). `.agents/` + `AGENTS.md` is
the **single source of truth**; each IDE folder is derived from it.

## Commands

```sh
agenti                               # dashboard for the repo you're in
agenti --user                        # user scope (~/.agents → ~/.claude, ~/.gemini/config)
agenti agents|mcp|skills|health|settings   # open on a tab (`agenti ide` = settings)
agenti ide claude-code               # make an IDE this repo's primary
agenti status [--check] [--json]     # where things stand; --check exits 1 on drift (CI)
agenti sync [--skills] [--quiet]     # apply every change that needs no judgement
```

The dashboard is interactive (Ink). As an agent, prefer `agenti status --json` to inspect and
`agenti sync` to apply; open the dashboard only for the user.

Repo root = nearest folder containing `.agents`, walking up from cwd but not past the git root;
otherwise the git root.

## Where things go

| `.agents/…` | Claude Code | Cursor | Antigravity | VS Code | Devin |
| --- | --- | --- | --- | --- | --- |
| `rules/` | `.claude/rules` | `.cursor/rules/*.mdc` (generated) | reads itself | `.github/instructions/*.instructions.md` (generated) | mirrored in `.devin` |
| `skills/` | `.claude/skills` | — | reads itself | — | mirrored |
| `agents/` | `.claude/agents` | — | — | — | mirrored |
| `commands/`, `workflows/` | `.claude/commands` | `.cursor/commands` | — | `.github/prompts/*.prompt.md` (generated) | mirrored |
| `settings.json` | `.claude/settings.json` | — | — | — | mirrored |
| `AGENTS.md` | `CLAUDE.md` imports it | read directly | read directly | `.github/copilot-instructions.md` | read directly |

- Linked entries are **relative symlinks**; generated copies carry IDE front matter plus a marker
  line. **Edit the `.agents` source, never the generated copy or the symlink target in `.claude`.**
- Rule front matter may use `globs`, `paths` or `applyTo` — equivalent.
- agenti never overwrites or deletes anything `.agents` doesn't already hold. A differing file is
  reported; adopting (IDE → `.agents`) or pushing (`.agents` → IDE) is the user's call.

## Adding a skill

1. Create `.agents/skills/<name>/SKILL.md` with front matter `name` (= folder name) and a
   `description` that says *when* to trigger.
2. Run `agenti sync` (or `agenti status` to preview) so `.claude/skills/<name>` gets linked.
3. Third-party skills are tracked in `skills-lock.json`; `agenti sync --skills` restores missing
   ones.

## MCP

- Reference config: `.agents/mcp_config.json` (or `config/mcp_config.json`).
- Claude Code project servers go to `.mcp.json` and need approval (stored in
  `.claude/settings.local.json`); local/user scopes are changed only via `claude mcp`.
- Global-only IDE files (`~/.gemini/config/mcp_config.json`, `~/.config/devin/mcp_config.json`,
  `~/.cursor/mcp.json`) are shown inside a repo too and can receive reference servers.
- Tokens: `${NAME}` placeholders resolved from `.env.user` at the repo root; extra ones listed in
  a top-level `requiredEnv: { server: [NAMES] }`. Never write a token into a shared file.

## `sync` semantics

Creates missing links/generated copies, refreshes stale generated copies, writes a missing
instructions file (or its missing import), adds reference MCP servers missing from an IDE's
project file. Hand-edited differences and IDE-only files are listed, not touched. User-scope MCP
files are never touched by sync.

## Settings

`~/.config/agenti/config.json` — per repo the IDEs kept in step (first = primary), theme, logo
mode, last tab.

## Code map (when changing agenti)

- `src/run.ts` — CLI (`status`, `sync`, `ide`, tab names).
- `src/core/*` — React-free logic, importable as `@/dev-tools/agenti/core/*`: `agents`
  (inventory/sync), `ides` (IDE definitions), `formats` (generated copies), `instructions`,
  `mcp`, `skills` (skills-lock), `health`, `repo`, `scope`, `launch`.
- `src/ui/*` — Ink dashboard (`views/{Agents,Mcp,Skills,Health,Settings}View`, `IdeStrip`).
- `src/config/settings` — persisted settings.

Verify with `bun test`, `bunx tsc --noEmit`, `bun run lint` from `apps/agenti`.
