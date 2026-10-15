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
pkgi install [--frozen] [--if-changed] [--silent]   # everything, from the lockfile — see Installing
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
- When `packageManager` pins a version (`bun@1.4.2`) and the manager on `PATH` is another one,
  it says so before installing.

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

If a registry lookup fails or has no latest version, pkgi falls back to read-only CLI queries:
`bun info <package> dist-tags --json` for Bun projects, otherwise `npm view <package> dist-tags --json`,
then tries the other tool if needed. Commands run in the project directory so project/user registry
and authentication settings apply; an explicit custom pkgi registry is preserved. Each CLI has a
15-second timeout. Successful results are cached per project; `c` refreshes them. If neither lookup
succeeds, the update marker stays `?` and the registry error remains visible.

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
