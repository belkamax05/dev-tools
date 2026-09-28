# pkgi

The packages of the folder you are in — declared range, installed version, latest on the
registry, deprecation and end-of-life — with updates, any-version picks, notes, and a comparison
against other folders. A terminal dashboard plus commands for scripts. It works on the current
directory: no list of repositories, no project layout assumed.

```sh
pkgi                              # dashboard
pkgi packages|compare|add|settings
pkgi list [--outdated] [--offline] [--json]
pkgi outdated                     # exits 1 when anything is behind — for CI
pkgi update react zod@4.2.0       # keeps each package's section and range style (^, ~, exact)
pkgi add hono [--dev]    pkgi remove left-pad
pkgi compare ../web ../api [--different]
pkgi note react "pinned until the SSR fix lands"   pkgi note react --clear   pkgi notes
pkgi config [--init]              # where everything lives; --init writes pkgi.config.ts
```

Every change to `package.json` is made by the folder's package manager — detected from the
nearest lockfile (a workspace member's is at the root), else `packageManager`, else npm — and in
the dashboard it is handed the terminal, so its output and failures are the real ones.

## Tabs

| Tab | Keys |
| --- | --- |
| 📦 Packages | `u`/Enter update to latest · `U` to the prerelease · `v` pick any version · `A` every minor/patch update at once (majors are left to you) · `n` note · `x` remove · `w` npm page · `o` outdated only · `/` filter · `c` ask the registry now |
| 🔀 Compare | first a picker: tick folders (Space or click) from `pkgi.config.ts`, the ones saved here and the ones found nearby (workspace members, sibling projects); `a` adds a path, `s` saves a found one. Then a row per package with each folder's version: `a`/Enter align every folder to the newest, `u` just this one, `d` only differences, `p` back to the folders |
| 🔍 Add | `/` search the registry · `i`/Enter add · `d` prod/dev · `v` a specific version |
| 🔧 Settings | this folder's settings with where each comes from (`x` drops an override), compare folders (add from the nearby list), theme, and the files below |

Everywhere: `1-4`/`Tab` switch tab, `r` re-read `package.json`, `t` theme, `q` quit.

## pkgi.config.ts

Optional, in the folder pkgi runs in. Every key is optional; `pkgi config --init` writes one with
all of them commented.

```ts
export default {
  stateFile: '.pkgi/state.json',    // keep notes in the repo, to share them via git
  comparePaths: ['../web', '../api'],
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
- **Cache** — registry answers (reused for `cacheHours`) and endoflife.date support windows (a
  week) in `~/.cache/pkgi/`. Safe to delete.
