# AGENTS.md

## What this is

`giti` is a Bun-powered git CLI: a set of opinionated wrappers around `git`, some of them
backed by Ink TUIs. It ships as a `giti` binary on `PATH` plus a `.gitconfig` that maps every
command onto a `git <name>` alias, so the same code is reachable as `giti status`,
`git giti status`, or `git status` (the alias).

This lives at `apps/giti` inside `dev-tools`, as a subproject sharing `dev-tools`'s own libs
directly rather than through a cross-repo alias. It is **not** its own repo: it is a member of
`dev-tools`' own Bun workspace (`apps/*`), which is what gives it the same physical `react`/`ink`
copy as the shared UI components — install from the `dev-tools` root (`bun install` there) and
typecheck from here (`bunx tsc --noEmit`).

## Commands

Only `lint` / `format` are defined as scripts; everything else is run directly:

```sh
bun install                              # per-submodule; node_modules is not shared
bun test                                 # bun:test, 70 tests across 12 files
bunx tsc --noEmit                        # typecheck (no `typecheck` script here)
bun run lint                             # biome check .
bun run format                           # biome check --write --unsafe .
bun scripts/generate-commands.ts     # regenerate .gitconfig-commands
bun bin/giti <command> [args]            # run a command without installing on PATH
bun bin/giti                             # no command → interactive picker
```

Biome is configured and installed **in this lib**, not inherited: the umbrella's `biome.jsonc`
explicitly excludes `libs/**`, so `bun biome check` from the root skips this repo entirely.
Run it from here. The style it enforces is 2-space indent, single quotes, ~100 column lines,
semicolons.

## Execution flow

```
bin/giti (#!/usr/bin/env bun)
  └─ src/cli/index.ts        run(...process.argv.slice(2))
       ├─ no command? src/ui/renderInkCommands → picker returns a name
       └─ dynamic import of src/commands/<name>.ts
            └─ default export: CommandRun = (args: string[]) => void | Promise<void>
```

`src/cli/index.ts` resolves the first argv token straight onto a file path under
`src/commands/`, so a command name maps 1:1 to a filename. Nested names work:
`giti subrepo/install` → `src/commands/subrepo/install.ts`.

Running bare `giti` opens the command picker instead of failing. The picker hands back a name in
exactly the form the dispatcher below it resolves, so there is still only one dispatch path;
backing out with Ctrl+C returns nothing and the CLI exits quietly.

**`CommandRun` takes the arg list as a single array, not spread args.** The CLI calls
`runCmd(args)`. Spreading would hand the command only its first argument. This shape is
deliberate — it mirrors how `shulker-controller`'s dispatch passes arguments.

Commands that need a TUI `await import('../ui/renderInkX')` lazily at the end, so the React/Ink
tree is never loaded for the flag-driven fast paths.

## Git alias wiring (the non-obvious part)

- `.gitconfig` defines `giti = "!giti"` and `i = "!giti"`. Users opt in via a global
  `git config include.path` pointing here; nothing in this repo installs it.
- `.gitconfig-commands` is **generated** — `#! do not edit by hand`. It contains one alias per
  file in `src/commands/**`, built from each module's exported `meta.description`.
- **Adding or renaming a command requires re-running `bun scripts/generate-commands.ts`.**
  Nothing does this automatically.
- Aliases flatten slashes: `subrepo/install` → alias `subrepo-install`, because git config keys
  cannot contain `/`. The generator throws on alias collisions.
- Commands without an exported `meta` still get an alias, just without a description comment.
  Every command carries one today, so a missing description means a new file was added without
  it, not that the generator dropped something.

Known breakage in `.gitconfig` (verify before assuming it works): everything after the
`[include]` block (`st`, `ci`, `co`, `br`, `amend`, `last`, `ps`, `cm`, `sw`, …) parses as
`include.*` keys, **not** aliases — `git config --file .gitconfig --list` confirms it. Those
shortcuts are inert. Also `fc = "!git fast-commit"` points at a command that does not exist
(only `fast-push` does).

Git ignores aliases that shadow built-in commands, which is why `giti git <args>`
(`src/commands/git.ts`) is a safe raw passthrough and never re-enters the wrappers.

## Layout & conventions

```
bin/giti                    entrypoint shim
include                     POSIX sh, prepends bin/ to PATH — dead code here; the umbrella's
                             `giti` command is wired via a `giti()` function in
                             `../../include`, not by sourcing this file
scripts/                    codegen, run directly with bun
src/cli/index.ts            command dispatcher
src/commands/<name>.ts      one file per command; default export + optional `export const meta`
src/ui/renderInkX/index.tsx Ink TUIs; default-export an async render fn that awaits and unmounts
src/ui/renderInkCommands/   the command picker — adapter over dev-tools's shared dialog
src/utils/<name>/index.ts   folder-per-unit, one default export, sibling index.test.ts
src/types/*.ts              interfaces/classes, mostly default-exported
src/config/                 systemConfig / sysPaths mirrors of shulker-controller
```

- **One default export per file**, named the same as its folder. Utilities are
  `src/utils/gitExec/index.ts`, imported as `import gitExec from '../utils/gitExec'`.
- Imports use tsconfig `paths`, not npm: `@/dev-tools/*` → `../../libs/*` (dev-tools's own libs,
  two levels up since this app lives at `dev-tools/apps/giti`), `@/dev-tools/giti/*` → `./src/*`
  — the same alias every outside consumer of this app uses. Bun honours these at runtime; there
  is no symlink and `bun install` will never fix a missing mapping.
- Comments explain *why*. Two recurring markers: `//?` for a rationale note on non-obvious
  behaviour, and JSDoc `@throws` documenting the failure a guard exists to prevent.
- `tsconfig.json` is strict with `noUncheckedIndexedAccess`, so `array[0]` is `T | undefined`.
  Destructuring defaults (`const [hash = '', author = ''] = line.split('|')`) is the idiom used
  throughout.

## The command picker

`giti` with no arguments opens a two-pane browser over `src/commands/**`. Three pieces:

- `src/utils/getCommandEntries` — globs the command modules and imports each one for its `meta`.
  It takes an optional directory so it can be tested against a fixture instead of whichever
  commands happen to exist. `scripts/generate-commands.ts` reads the same listing, so the
  picker and the git aliases can never disagree about what a command is called or does.
- `src/utils/getCommandPickerItems` — folds the flat listing into folders: `subrepo/install`
  becomes an `install` row inside a `subrepo` folder. A leaf's `value` stays the full
  slash-separated name, which is exactly what the dispatcher resolves.
- `src/ui/renderInkCommands` — hands those rows to `@/dev-tools/ui/dialogs/pickCommand` and
  returns the picked name.

**The dialog itself is not giti's.** It lives in `dev-tools` and is shared with
`shulker-controller`, so both CLIs present the same UI. Only plain data crosses that boundary —
never a React element. Each repo resolves `react`/`ink` from its own `node_modules`, so a
component built here would be mounted by a reconciler holding a *different* React copy and its
hooks would find no dispatcher. giti's own `renderInkX` TUIs are unaffected: they render their own
components with giti's own ink, in their own render.

## Running git: always go through the helpers

`gitExec(args, cwd, { stream })` / `gitExecSync(args, cwd)` are the only sanctioned ways to
invoke git. They exist to defuse two silent-corruption bugs:

- `gitSpawnCwd` **throws on an empty `cwd`** instead of letting the child inherit
  `process.cwd()` and operate on whatever repo the shell happens to be in.
- `gitSpawnEnv` **strips repo-scoped git env vars** (`GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_PREFIX`, …) before spawning. Inherited from a hook,
  a rebase, or another repo's tooling, they make git ignore the `cwd` entirely.

`gitExec` **never rejects** — failures come back as `{ exitCode, stderr }`. Check `exitCode`
explicitly, or throw `new GitError(result)`. With `{ stream: true }` stdio is inherited, so
`stdout`/`stderr` come back empty and pagers/editors/colour detection behave normally.

`getWorkingDir()` is the repo path every command passes to `gitExec`. It has a
`setWorkingDir()` injection hook, but **nothing currently calls it** — `bin/giti` does not, so
in practice it returns `process.cwd()`. `src/commands/git.ts` additionally re-joins
`process.env.GIT_PREFIX`, because when reached through a `!` alias git has already chdir'd to
the repo top-level; without it, `git giti git add .` from a subfolder would stage everything.

`getRepoRootDir()` walks up to the nearest `package.json` from *this module's own location* and
deliberately never falls back to `process.cwd()`. It answers "where is giti installed", not
"which repo is the user in" — do not use it as a working directory.

## Command argument convention

Flag-taking commands (`commit`, `push`, `pull`, `switch`) all follow the same three-step shape:

1. A `KNOWN_FLAGS` set splits argv into flags the command understands vs. **passthrough flags**
   forwarded verbatim to git.
2. `node:util`'s `parseArgs` with `strict: false, allowPositionals: true` parses the known ones.
3. A zod schema normalises the result into a typed object with defaults.

The TUI is **skipped whenever a message or any flag is present** — the interactive path is the
zero-argument path. `--yes`/`-y` is a giti-only flag that bypasses the TUI and is never
forwarded to git.

## The vendored families (`subrepo`, `submodule`, `subtree`, `mega`)

Four command folders, one implementation each. `list`, `status`, `diff`, `pull`, `push` and
`clean` ask the same questions of a directory whichever mechanism vendored it, so the *bodies*
live in utils and the command files are three lines of wiring:

- discovery → `getSubrepos` / `getSubmodules` / `getSubtrees`, all returning `Vendored`
  (`src/utils/vendored/index.ts`). All three are **offline**: `.gitrepo` files, `.gitmodules`
  plus gitlinks, and `git-subtree-dir` commit trailers respectively.
- one entry's standing → `getVendoredState`; one entry's pull/push → `pullVendored` /
  `pushVendored`; one mechanism's leftovers → `cleanVendored`.
- printed bodies → `src/utils/vendoredCommands/index.ts` (`runVendoredList`, `runVendoredStatus`,
  `runVendoredDiff`, `runVendoredPull`, `runVendoredPush`, `runVendoredClean`).

`mega/*` is the same operations over **every** context at once: all three mechanisms plus the
repository they are vendored into. `getMegaTree` returns the repo header plus one group per
mechanism (always all three, empty ones included); `src/utils/megaCommands/index.ts` runs the
shared per-entry bodies group by group and prints the grouped report. Its own conventions:

- Every mega command opens with the repo header — name, branch, HEAD, dirty count, origin.
- The repository itself takes part where the operation means something for it: `status`/`diff`
  compare against its tracking branch (`getMegaSelfState`), `pull` fast-forwards it **before** the
  vendored dirs (its pull is what moves the pins), `push` sends it **after** them (publishing pins
  first would point people at commits no remote has). `--no-self` opts out.
- `mega/clean` never touches a working tree — only git bookkeeping under `.git` and the
  `refs/giti/<kind>/*` fetch refs `status` creates.

Adding an operation to one family means adding it to the shared body, not to the command file.

### Flags: giti's own vs. everything else

These families do **not** use the `KNOWN_FLAGS` + `parseArgs` shape above. `src/utils/vendoredArgs`
splits argv into three: the positional directories, the handful of flags giti reads to decide what
to do (`OWN_FLAGS` in `vendoredCommands` — `--no-self`, `--no-fetch`, `--remote=`, `--branch=`,
`--dry-run`), and **everything else, which is forwarded to the git command that actually runs**. A
flag giti has never heard of is passed on, not rejected: `--no-verify` on a `mega/push` means
"skip the hooks" for every push the run makes.

The three mechanisms cannot all take the same flags, so `forwardVendoredFlags(passthrough, target)`
decides per target (`git`, `submodule-update`, `subrepo`, `subtree`) whether each flag is appended
to the command line, delivered as a `-c` setting when git config can produce the same effect
(`--no-verify` → `core.hooksPath=/dev/null`, which `GIT_CONFIG_PARAMETERS` carries into the plain
`git push` inside `git subtree push`), or **reported** via `explainDroppedFlags` — never silently
dropped. Two flags giti supplies itself, `git pull --ff-only` and `git submodule update --merge`,
step aside when the user names their own mode, because git refuses two answers at once.

A value-taking git flag must be written joined (`--depth=1`) or after `--`; a bare `1` would be
read as a directory name.

## The patch workflow

`patch-save` / `patch-apply` / `cancel-all` form a stash replacement built on plain `.patch`
files in the repo root:

- `patch-save` → `git diff HEAD` — **tracked changes only**, untracked files are silently
  excluded.
- `cancel-all` → resets everything to HEAD *including deleting untracked files*, but
  **`*.patch` files are always preserved** so the saved patch survives its own cleanup.
- `patch-apply` → `git apply`, landing changes as unstaged edits.

Anything touching this flow must keep the `*.patch` exclusion; without it `cancel-all` deletes
the patch it is meant to enable restoring from.

## shulker-controller mirrors

`src/config/systemConfig.ts`, `src/config/sysPaths.ts`, `src/types/SystemConfig.ts`, and
`validateUser` are deliberately narrowed copies of `shulker-controller` modules, kept so code
can move between the two repos. They document what was dropped and why in `//?` comments.
`systemConfig.user` is always absent here, which `validateUser` reads as "no rules to fail
against" — it returns valid for every email unless a config is passed in explicitly.

## Testing

`bun:test`, tests as `index.test.ts` siblings of the code they cover. Twelve units are covered
today (`gitSpawnCwd`, `gitSpawnEnv`, `getWorkingDir`, `getCurrentUser`, `getCommandEntries`,
`getCommandPickerItems`, `getMegaTree`, `getMegaSelfState`, `cleanVendored`, `getVendoredState`,
`vendoredArgs`, `vendoredCommands`'s `describeVendored`); commands and Ink UIs have no tests.

The git-touching ones build a throwaway repository under `os.tmpdir()` in `beforeAll` — a bare
"remote" and a clone of it when an upstream is needed — and remove it in `afterAll`, so nothing
asserts against whatever repo the tests happen to run inside.

`getCommandEntries` tests run against a temp fixture directory rather than the real
`src/commands`, so adding or renaming a command does not break them. Only one assertion touches
the live tree, and it just checks the default wiring resolves.

Test names are full sentences describing observable behaviour, not the function under test:

```
(pass) rejects an empty path instead of falling back to the current folder
```

`getCurrentUser` tests hit the real `git config`, so they assert on shape and invariants rather
than fixed values.

## Gotchas

- Adding a command file without regenerating `.gitconfig-commands` means the git alias silently
  does not exist.
- `getWorkingDir`'s doc comment describes a `$(pwd)`-injection scheme that is not wired up;
  trust `process.cwd()` as the actual behaviour.
- `src/utils/gitExec/index.ts` carries a stray `'use server'` directive (the only one in the
  repo) — a leftover, not a signal that anything here runs in a server context.
- Renderers differ in how they end: `renderInkStatus` is a one-shot render that calls
  `process.exit(0)` itself (code after it in the command never runs), while the interactive
  ones (`commit`/`push`/`pull`/`switch`) `await waitUntilExit()`, unmount, then run the git
  command they built.
- `index.ts` referenced by `package.json`'s `module` field does not exist; the real entrypoint
  is `bin/giti`.
- Editing this lib changes behaviour for every consumer immediately — the `@/` aliases point at
  source, so there is no build step and no version bump.
