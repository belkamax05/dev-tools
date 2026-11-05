---
name: dev-tools-proji
description: Use proji (dev-tools) to list and run a project's commands — package.json scripts plus aliases from `proji.config.ts`, including named sibling projects (`proji -p fe dev`) — and `runProject` as a library for CLIs that add their own commands. Trigger when asked what commands a project has, to run one through the right package manager, to add a project alias, or to wire a project command group into another CLI.
---

# proji — a project's commands

`proji` lives in `apps/proji` (`bin/proji`). Also `dev-tools proj …` / `dev-tools project …`.
The project is the nearest folder with a `package.json`.

```sh
proji list [--json]            # every command and where it comes from — use this to discover
proji dev --port 3000          # run one; extra words are its arguments
proji run list                 # explicit form, for commands named list/help
proji -p fe dev                # a project named in proji.config.ts
proji                          # dashboard (prints the list without a terminal)
```

## Resolution order (earlier hides later)

1. **Overrides** — passed in code by a calling tool (`runProject`).
2. **Aliases** — nearest `proji.config.ts` (or `$PROJI_PROJECT_DIR`).
3. **Scripts** — `package.json`, run by the project's manager (`packageManager`, lockfile, npm —
   pkgi's detection).

## `proji.config.ts`

```ts
export default {
  commands: {
    install: 'pkgi install',                         // shell command; args appended
    check: { script: 'lint:all' },                   // another script
    up: { run: 'docker compose up -d', description: 'Start services' },
  },
  projects: {
    fe: { root: '../dfs-fe', title: 'dfs fe', commands: { lint: { script: 'lint:all' } } },
  },
};
```

## As a library

```ts
import runProject from '@/dev-tools/proji/core/project';

process.exitCode = await runProject(
  { root, title: 'dfs fe', overrides: [{ name: 'start', description: '…', run: (args) => start(args), command: ['bun', 'start'] }],
    aliases: config.projects?.fe?.commands },
  argv,
);
```

An override may have `children` (a group). Give it `command` (argv) so the dashboard can run it
with the full terminal; `run` is the in-process form for typed commands.

State: theme `~/.config/proji/config.json`; last tab/filter `~/.local/state/proji/state.json`.

## Changing proji

`src/run.ts`, `src/core/*` (`project` is the library entry), `src/ui/*`. Verify with `bun test`,
`bunx tsc --noEmit`, `bun run lint` from `apps/proji`.
