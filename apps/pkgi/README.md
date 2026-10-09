# pkgi

The packages of the folder you are in — declared range, installed version, latest on the
registry, deprecation and end-of-life — with updates, any-version picks, notes, and a comparison
against other folders. A terminal dashboard plus commands for scripts. It works on the current
directory: no list of repositories, no project layout assumed.

```sh
pkgi                              # dashboard
pkgi packages|scripts|compare|add|settings
pkgi list [--outdated] [--eol] [--offline] [--json] [--verbose]
pkgi eol                          # past end of life, ending within 90 days, stale or deprecated; exits 1 if any
pkgi outdated                     # exits 1 when anything is behind — for CI
pkgi update react zod@4.2.0       # keeps each package's section and range style (^, ~, exact)
pkgi update                       # every minor/patch update at once; majors are listed, not taken
pkgi install [--frozen | --nix] [--if-changed] [--silent]   # everything, from the lockfile — see Installing
pkgi add hono [--dev]    pkgi remove left-pad
pkgi add                          # no names: the Add tab, to search the registry
pkgi remove                       # no names: tick packages from a list
pkgi run build [args...]    pkgi start [args...]   # package.json scripts, with the folder's manager
pkgi run                          # no script: the Scripts tab, to pick one
pkgi audit    pkgi clear-cache    pkgi clear-modules
pkgi compare ../web ../api [--different]
pkgi report [../web ../api] [--offline] [--json] [--no-write]   # see Reports
pkgi note react "pinned until the SSR fix lands"   pkgi note react --clear   pkgi notes
pkgi config [--init]              # where everything lives; --init writes pkgi.config.ts
```

Every change to `package.json` is made by the folder's package manager — detected from the
nearest folder that names one (a workspace member's is the root), where `package.json`'s
`packageManager` outranks a lockfile beside it, else npm — and in the dashboard it is handed the
terminal, so its output and failures are the real ones.

## Installing

`pkgi install` with no package names is that manager's own install, run at the root it was
detected from: `bun install`, `npm install`, `yarn install`, `pnpm install`.

- `--frozen` installs exactly what the lockfile pins and fails rather than rewrite it
  (`--frozen-lockfile`, `npm ci`, Yarn Berry's `--immutable`), so the versions are the ones a
  plain install from that lockfile gives anyone else. With no lockfile yet it does a plain
  install, which writes the manager's own one.
- `--if-changed` does nothing when `node_modules` was last installed by pkgi from this very
  lockfile — the hash is kept in `node_modules/.pkgi-install.json`, so a pull or branch switch
  that changes the lockfile, or deleting `node_modules`, installs again.
- `--print-watched` installs nothing: it prints that stamp and the lockfile, the files whose
  change (or deletion) means installing again — what the Nix shell hands direnv to watch.
- When `packageManager` pins a version (`bun@1.4.2`) and the manager on `PATH` is another one,
  it says so before installing.

### `--nix`: node_modules as a Nix build of the lockfile

`pkgi install --nix` doesn't install into the folder at all. It reads the lockfile of the detected
manager — `bun.lock`, `package-lock.json`, `pnpm-lock.yaml` or a classic `yarn.lock`
(`src/core/lockfile`) — and hands dev-tools' `nix/lib/node-modules.nix` a manifest: every tarball
it pins with the integrity hash the lockfile records, the workspaces, the files the install reads
(the lockfile, each workspace's `package.json`, patches, manager config) and that manager's own
frozen install. Nix fetches each tarball by that hash, then, in its sandbox and without network,
runs the manager against a local registry serving just those tarballs. The result is a store
path that is a function of the lockfile: the same lockfile gives the same path whether `bun add`,
`pkgi install`, a pull or a checkout wrote it; a different one builds, or finds, its own.

That output is then copied into `node_modules` of the root and of every workspace — copied, not
linked, because workspace links are relative and have to resolve inside the checkout; made
writable, so the manager can still change it. The project's own lifecycle scripts (`preinstall`,
`prepare`, …) run afterwards in the checkout, as a plain install would run them. The builds of the
last five lockfiles stay out of garbage collection (`.cache/pkgi/nix/`), so switching back to a
branch is a copy, not a build.

- The manager the build runs is the one on `PATH`, and it has to come from the Nix store — the
  repo's Nix shell's pinned one — so its version is part of what the output depends on.
- With no lockfile yet, the manager writes one first (`--lockfile-only` and friends).
- Refused, saying why: entries a tarball and hash can't stand for (git or local-path
  dependencies), a binary `bun.lockb`, npm lockfile v1, and Yarn Berry, whose lockfile checksums
  are of Yarn's own zip archives rather than of the registry's tarballs.
- pnpm 11 re-checks a lockfile's publish times against registry metadata before installing; the
  build's copy of `pnpm-workspace.yaml` sets `minimumReleaseAge: 0` for that step only, since the
  tarballs are already hash-verified and pnpm applied the policy when it wrote the lockfile.
- Only this platform's tarballs: a package whose `os`/`cpu` rules out this machine
  (`@nx/nx-win32-x64-msvc` on Linux) is an optional dependency the manager skips, so it isn't
  fetched either.
- Private registries: Nix's sandbox never sees `.npmrc`, so a tarball behind its credentials
  (`//host/path/:_authToken`, `:_auth`, or `:username` + `:_password`, in the project's or your
  `~/.npmrc`) would get a 401. pkgi downloads those itself first with the credentials, checks
  them against the lockfile's hash, and adds them with `nix-store --add-fixed` — at the very path
  the build's fetch resolves to, so Nix finds them already there.
- A failed build is remembered (`.cache/pkgi/nix/*.failed`): `--if-changed` doesn't retry it until
  the lockfile, the install inputs or the credentials change, so a build that can't succeed
  doesn't run again on every direnv load. `pkgi install --nix` by hand always retries.

dev-tools' Nix shells run `pkgi install --nix --if-changed` on entry for the folders their env
modules list under `install`, and under direnv watch the `--print-watched` files, so deleting
`node_modules` or a lockfile that changes installs again at the next prompt — see
`nix/lib/mk-env.nix`. Nothing installs on its own outside a Nix shell.

## Support: end of life and stale packages

Every package gets a support verdict where there is one to give, in the dashboard (each row, the
detail panel, `e` to group all packages by support status), in `pkgi list` (the SUPPORT column),
`pkgi eol` and `pkgi report`:

- **endoflife.date** for what it publishes support windows for — Node (`@types/node`), React and
  its lockstep packages, Next.js, Angular (`@angular/*`), Vue, Nuxt, Svelte, ESLint, Electron,
  Express, Tailwind, Ionic, jQuery, Bootstrap, Ember, Bun, pnpm, Yarn (`ENDOFLIFE_PRODUCTS` in
  `src/core/eol`). `EOL` past the end, `EOL <date>` within 90 days, `→ <month>` when supported.
- **The registry** for everything else (and lines endoflife.date doesn't list): `stale` when the
  package has published nothing for more than 730 days (including prereleases), or when your exact
  installed release was published more than 365 days ago, regardless of the major-version gap.
  No published support window means "unknown", even with recent activity: activity is not a
  support promise. Both checks use per-version npm publish timestamps, never metadata modification
  dates. The full registry document is fetched for packages being assessed; release timestamps
  is cached for a week (`~/.cache/pkgi/release-lines.json`). `c` refreshes it from the registry.
  In EOL/stale mode the detail panel shows package-wide, exact installed-version, and major-line publish dates and ages,
  the major-version gap, and each threshold (major-line activity is context only), with green / amber / gray for below / exceeded / unknown.

## Reports

`pkgi report` puts every package of several folders in one table: the range (and installed
version) in each folder, the latest on the registry, and a status — deprecated, end of life or
ending soon (endoflife.date, judged on the oldest version in use), how far behind. Without paths
it covers `pkgi.config.ts`'s `reportPaths`, else the current folder; a note on a package in this
folder goes in too.

With `reportDir` set, it also writes `dependencies-report.json` and `dependencies-report.md` there
(`--no-write` skips that). The JSON already there is read back first, so each package keeps when
it was first seen, and one no folder declares any more stays in the report with when it was
dropped.

## Tabs

| Tab | Keys |
| --- | --- |
| 📦 Packages | `u`/Enter update to latest · `U` to the prerelease · `v` pick any version · `A` every minor/patch update at once (majors are left to you) · `n` note · `x` remove · `w` npm page · `o` outdated only · `e` EOL/stale mode · `/` filter · `c` ask the registry now |
| 📜 Scripts | `package.json`'s scripts, then its hooks and lifecycle scripts (`prebuild`, `postinstall`…) · Enter run · `a` run with arguments · `/` filter. A script gets the real terminal like any handoff — Ctrl+C stops it, Enter comes back to the list with its result |
| 🔀 Compare | first a picker: tick folders (Space or click) from `pkgi.config.ts`, the ones saved here and the ones found nearby (workspace members, sibling projects); `a` adds a path, `s` saves a found one. Then a row per package with each folder's version: `a`/Enter align every folder to the newest, `u` just this one, `d` only differences, `p` back to the folders |
| 🔍 Add | `/` search the registry · `i`/Enter add · `d` prod/dev · `v` a specific version |
| 🔧 Settings | this folder's settings with where each comes from (`x` drops an override), compare folders (add from the nearby list), theme, and the files below |

Everywhere: `1-5`/`Tab` switch tab, `r` re-read `package.json`, `t` theme, `q` quit.

## pkgi.config.ts

Optional, in the folder pkgi runs in. Every key is optional; `pkgi config --init` writes one with
all of them commented.

```ts
export default {
  stateFile: '.pkgi/state.json',    // keep notes in the repo, to share them via git
  comparePaths: ['../web', '../api'],
  reportPaths: ['../web', '../api'], // what `pkgi report` covers without paths
  reportDir: 'reports',             // where it writes dependencies-report.json / .md
  showUnstable: false,              // offer next/beta/canary as updates
  dependencyTypes: ['dependencies', 'devDependencies'],
  installAs: 'prod',
  cacheHours: 4,
  registry: 'https://registry.npmjs.org',
  // packageManager: 'bun',
};
```

Settings resolve as pkgi's defaults, then `pkgi.config.ts`, then what you toggled in the
dashboard for this folder — so the file is the team's defaults and the dashboard is yours.

## Where state is kept

- **Per folder** — notes, compare folders, dashboard toggles: by default
  `~/.local/state/pkgi/folders/<name>-<hash>.json`, outside the repository, so running pkgi never
  dirties a working tree. A note is about *this* project's `react`, which is why this is per
  folder rather than per user. Set `stateFile` to move it into the repo and commit it to share
  notes with the team (the old web app kept them in a tracked `.settings/package-notes.json`).
- **Per user** — the theme in `~/.config/pkgi/config.json`, the last tab in
  `~/.local/state/pkgi/state.json`.
- **Cache** — registry answers (reused for `cacheHours`), endoflife.date support windows and
  per-major release dates (a week each) in `~/.cache/pkgi/`. Safe to delete.
