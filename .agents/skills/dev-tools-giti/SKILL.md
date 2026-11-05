---
name: dev-tools-giti
description: Use giti (dev-tools) for git work beyond plain git — whole-tree push/pull across subrepos, submodules and subtrees (`send`/`receive`/`mega`), branch overview/compare/cleanup, shared remote stashes, patches, `giti clear` for git-ignored files, refs browsing, repo URLs. Trigger when pushing or pulling a repo that vendors other repos, pushing a git-subrepo (e.g. libs/dev-tools), cleaning branches or ignored files, sharing a stash, or changing giti itself.
---

# giti — opinionated git wrappers

`giti` lives in `apps/giti` (`bin/giti`). Command name = file path under `src/commands/`
(`giti subrepos push` → `subrepos/push.ts`). Anything that isn't a giti command is passed to git
(`giti log -3` = `git log -3`; giti's status is `state`, so `giti status` is git's). Also reachable as
`git <name>` once the user includes `apps/giti/.gitconfig`.

`giti` alone opens the dashboard; `giti <folder>` opens the picker in that folder. As an agent use
explicit commands with flags — TUI screens need a terminal. `giti list [word]` prints every
command with its description.

## Risk levels — read before running

**Destructive / rewrites — only when the user asked for exactly this:**
`send-to` / `push-to` (force-push HEAD into another remote branch) · `cancel-all` (revert all
tracked changes, deletes newly-added staged files) · `cancel-unstaged` · `patch-apply-unsafe` ·
`undo` (soft reset one commit) · `amend` · `branches delete|remove|move` · `cleanup` (merged
branches) · `remotes remove` · `stash remove` (deletes for everyone) · `clear` (deletes ignored
files) · `mega clean`, `subrepos|submodules|subtrees clean`.
Prefer their `--dry-run` / `--list` / `--print` forms first where they exist.

**Pushes to remotes — confirm with the user:** `send`/`push`, `fast-push` (no hooks), `wip`
(commits bypassing hooks), `save --push`, `subrepos|submodules|subtrees push`, `mega commit`.

**Read-only, safe:** `state`, `me`, `hash`, `list`, `print-graph`, `branches list|status|ahead|overview|compare|diff`,
`diverged-from`, `mega list|status|diff`, `subrepos|submodules|subtrees list|status|diff`,
`remotes list|default`, `stash list`, `refs --print`, `url print`, `pages print`, `open --print`.

## Whole-tree transfer

- `giti send [git push flags] [<remote> [<branch>]]` — push every subrepo, submodule and subtree
  upstream, then this repo. No flags → a picker screen; `--yes` skips it; `--no-self` skips this repo.
- `giti receive` (= `pull`) — the same for pulling; `giti sync` fetches all remotes first.
- `giti mega status|diff|list|commit|clean` — the repo plus everything vendored, against real
  upstreams (status fetches first; `--no-fetch`, `--no-self`).
- Per mechanism: `giti subrepos|submodules|subtrees list|status|diff|pull|push|clean`.
  `subrepos push` refuses up front on the conditions that make git-subrepo fail half-way;
  `subrepos install` installs git-subrepo if missing.

## Branches

`branches overview [--base=B]` (ahead/behind/merged/age vs trunk), `branches compare <other>
[--stat|--diff]`, `branches diff` (HTML diff in browser), `branches copy` (another branch's diff
as unstaged changes), `branches switch|move|delete`, `cleanup [--dry-run|--yes]`, `diverged-from`.

## Changes and commits

`mark`/`unmark` (stage/unstage by kind: `--modified`, `--untracked`, `--all`…), `save` (commit TUI;
message/flags skip it when changes are staged), `wip [msg]`, `amend`, `undo`,
`patch-save` / `patch-apply` (unstaged; untracked files excluded from saves).

## Shared remote stashes (`refs/stashes/*`)

`stash list` · `stash save <name> -- <files>` (work tree untouched; `--force` replaces) ·
`stash apply <name> [-- files] [--unstaged]` (stash stays) · `stash remove <name>`.
Bare `giti stash` = dashboard (prints the list without a TTY).

## `giti clear` and `giti.config.ts`

Browses git-ignored files as a tree and deletes the ticked ones. `--list` only prints;
`--select=<glob>` / `--hide=<glob>` add to the config. `giti.config.ts` (`.mjs`/`.js`), nearest
first, or `$GITI_CONFIG`; may export a function of `{ root }`:

```ts
export default { clear: { preselect: ['**/dist', '**/.next'], hide: ['.env*'] } };
```

## Other

`refs` (every ref with object/reflog; `--print`, `--remote`), `url`/`pages`/`open` (repo web pages,
new PR; `print`/`--print` to just print), `remotes add|rename|set-url|default`, `git <args>` raw.

## Changing giti

Read `apps/giti/AGENTS.md` first. Key rules: `CommandRun` gets args as one array; TUIs are lazy
`await import('../ui/renderInkX')`; files starting with `_` aren't commands (`_index.ts` runs for a
bare folder); no command may share a git command's name; after adding/renaming a command run
`bun scripts/generate-commands.ts` (regenerates `.gitconfig-commands`). Verify with `bun test`,
`bunx tsc --noEmit`, `bun run lint` from `apps/giti`.
