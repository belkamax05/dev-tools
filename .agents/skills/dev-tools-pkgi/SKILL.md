---
name: dev-tools-pkgi
description: Use pkgi (dev-tools) for a folder's npm packages — outdated/EOL/stale checks, updates that keep range style, add/remove, installs from the lockfile, running package.json scripts, comparing versions across folders, dependency reports and per-package notes. Trigger when asked to update, add or remove dependencies, check what is outdated or end-of-life, compare package versions between repos, install deps, or run a script with the project's package manager.
---

# pkgi — the current folder's packages

`pkgi` lives in `apps/pkgi` (`bin/pkgi`). Works on the current directory; every `package.json`
change is made by the folder's own package manager (`packageManager` field, else lockfile, else
npm; a workspace member uses its root's).

## Commands

```sh
pkgi list [--outdated] [--eol] [--offline] [--json] [--verbose]
pkgi outdated                      # exit 1 if anything is behind (CI)
pkgi eol                           # EOL / ending ≤90 days / stale / deprecated; exit 1 if any
pkgi update react zod@4.2.0        # keeps section and range style (^, ~, exact)
pkgi update                        # all minor/patch at once; majors listed, NOT taken
pkgi add hono [--dev]   pkgi remove left-pad
pkgi install [--frozen] [--if-changed] [--silent]
pkgi run <script> [args…]   pkgi start [args…]
pkgi audit   pkgi clear-cache   pkgi clear-modules
pkgi compare ../web ../api [--different]
pkgi report [paths…] [--offline] [--json] [--no-write]
pkgi note react "pinned until SSR fix"   pkgi note react --clear   pkgi notes
pkgi config [--init]
pkgi                               # dashboard: packages|scripts|compare|add|settings
```

Guidance:
- Check before changing: `pkgi list --outdated --json`, and `pkgi notes` — a note often explains
  why a package is pinned. Don't update a noted package without saying so.
- Major updates are deliberate: name them explicitly (`pkgi update pkg@X`) only when asked.
- `install --frozen` = CI-style exact lockfile install; `--if-changed` skips when node_modules was
  installed from this exact lockfile (hash in `node_modules/.pkgi-install.json`).
- `clear-modules` deletes node_modules — confirm first.

## Support verdicts

endoflife.date for products it covers (Node via `@types/node`, React, Next, Angular, Vue, Bun,
pnpm, …; `ENDOFLIFE_PRODUCTS` in `src/core/eol`). Otherwise registry-based `stale`: nothing
published for >730 days, or your exact release older than 365 days. No window = "unknown".

## `pkgi.config.ts` (optional, team defaults)

```ts
export default {
  stateFile: '.pkgi/state.json',   // notes in the repo, shared via git
  comparePaths: ['../web'], reportPaths: ['../web'], reportDir: 'reports',
  showUnstable: false, dependencyTypes: ['dependencies', 'devDependencies'],
  installAs: 'prod', cacheHours: 4, registry: 'https://registry.npmjs.org',
};
```

Resolution: defaults → `pkgi.config.ts` → dashboard toggles for this folder.
`report` with `reportDir` writes `dependencies-report.{json,md}`, keeping first-seen / dropped dates.

## State

Per folder `~/.local/state/pkgi/folders/<name>-<hash>.json` (notes, compare folders) unless
`stateFile`; theme `~/.config/pkgi/config.json`; cache `~/.cache/pkgi/` (safe to delete).

## Changing pkgi

`src/run.ts` CLI, `src/core/*` (manifest, package-manager detection, registry, `eol`), `src/ui/*`.
Its package-manager detection is reused by proji. Verify with `bun test`, `bunx tsc --noEmit`,
`bun run lint` from `apps/pkgi`.
