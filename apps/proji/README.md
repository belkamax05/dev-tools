# proji — a project's commands in one picker

Everything a project lets you run, in one place: its `package.json` scripts plus aliases you
define, with a picker when you don't name one.

```sh
proji                          # picker over this project's aliases and scripts
proji dev --port 3000          # run one; extra words are its arguments
proji run list                 # the explicit form, for a command called list/help
proji -p fe dev                # a project named in proji.config.ts
proji list [--json]
```

Also reachable as `dev-tools proj …` / `dev-tools project …`.

## Where commands come from

In this order. An earlier kind hides a later one with the same name:

1. **Overrides**: commands a calling tool passes in code (see *As a library*).
2. **Aliases**: from the nearest `proji.config.ts`.
3. **Scripts**: the project's `package.json`, run through its own package manager (the
   `packageManager` field, else the lockfile, else npm; detected by pkgi's code).

The project is the nearest folder with a `package.json`.

## `proji.config.ts`

Found in the current folder or above, or in `$PROJI_PROJECT_DIR`. Imported, so it can compute
values.

```ts
export default {
  // aliases for the project this file sits in
  commands: {
    install: 'pkgi install',                         // a shell command; arguments are appended
    check: { script: 'lint:all' },                   // another script, via the package manager
    up: { run: 'docker compose up -d', description: 'Start services' },
  },
  // other projects by name: `proji -p fe` runs in ../dfs-fe with these aliases
  projects: {
    fe: { root: '../dfs-fe', title: 'dfs fe', commands: { lint: { script: 'lint:all' } } },
  },
};
```

## As a library

`runProject` is all of the above for a caller that brings its own commands. dfs's `dfs fe` and
`dfs self` are one call each:

```ts
import runProject from '@/dev-tools/proji/core/project';

process.exitCode = await runProject(
  {
    root: '/path/to/project',
    title: 'dfs fe',
    overrides: [{ name: 'start', description: 'Proxy + dev server', run: (args) => start(args) }],
    aliases: config.projects?.fe?.commands,
  },
  argv,
);
```

An override may have `children` (a group) and no `run` (the picker opens inside it). The
picker is dev-tools' shared `pickCommand` dialog.
