---
name: dev-tools-envi
description: Use envi (dev-tools) to inspect, resolve, set and run with environment variables layered from your config, machine state, `.env` files and `env.config.ts` — including 1Password `op://` references and a direnv-style shell hook. Trigger when a variable is missing or has the wrong value, when asked where an env var comes from, to set/unset one, to run a command with project env, to check required vars, to write `env.config.ts`, or to load env from code via `@/dev-tools/envi`.
---

# envi — layered environment variables

`envi` lives in `apps/envi` of the dev-tools repo (`bin/envi`). It works from whatever folder it
runs in; `-C <dir>` resolves as if run there.

## Commands an agent should reach for

```sh
envi list [search] [--json]          # what envi sets here, its source, vs the shell (secrets masked)
envi get API_URL                     # one resolved value; exit 1 when unset
envi explain API_URL                 # every layer that sets it and which wins — first stop for "wrong value"
envi check                           # exit 1 while a required var is unset
envi run -- npm start                # run with envi's vars (= envi -- npm start)
envi run --only A,B -- cmd           # only those vars on top of the shell (fewer op:// reads)
envi export [--shell zsh|bash|sh|fish|dotenv|json]
envi set KEY=value [--to .env.user|.env|config|state | --file F | --global | --state]
envi unset KEY [same flags]
envi files [add|remove|enable|disable <path>]
envi init                            # env.config.ts template
envi config                          # where settings live
envi shell [search] [--json]         # the current shell's own vars
envi hook zsh|bash|fish              # shell hook source
envi reload                          # after editing a file outside envi
```

`envi` alone (or `envi values|locations|settings`) opens the interactive dashboard — for the user,
not for scripted use.

Safety:
- `envi list` masks secrets (names containing `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY`…).
  Do **not** use `--reveal`, `list --resolve` or `get` on secrets just to look; avoid printing
  secret values into the conversation.
- `envi set` without flags writes to the configured `setTarget` (default `.env.user`, which is
  git-ignored). Use `.env` only when the value is meant to be shared.

## Layers (later wins)

1. **Your vars** — `vars` in `~/.config/envi/config.json` (every folder).
   **Machine vars** — `vars` in `~/.local/state/envi/state.json` (this machine; beats your vars).
2. **Env files** — your list, default `.env` then `.env.user`, plus files each `env.config.ts`
   adds. Any file can be disabled; missing files are listed, not errors.
3. **`env.config.ts` vars** — every one from git root down to cwd; nearer wins.

Then the shell: a name the shell already exports **keeps the shell's value** unless `override`
is on (dotenv rule). Markers: `new`, `~ replaces shell`, `= same`, `⊘ shell wins`. So "my .env
value is ignored" usually means the shell exports it — check with `envi explain`.

Expansion: `$NAME`, `${NAME}`, `${NAME:-fallback}` (unset or empty), `${NAME-fallback}` (unset).
Double quotes expand and take `\n \t \$`; single/backtick quotes are literal; unquoted values end
at ` #`.

## `env.config.ts`

```ts
export default {
  files: ['.env.shared'],          // after your list, relative to this file
  disable: ['.env.user'],          // name or path
  vars: { API_URL: 'http://localhost:${PORT:-3000}' },
  required: ['DATABASE_URL'],      // also every key of .env.example/.sample/.template/.dist
  override: true,
};
```

May also export a (sync/async) function of `{ cwd, root, dir, env }`.

## 1Password

`op://vault/item/field` values are pointers, shown unmasked, read via `op read` only when needed:
`get`, `run`, `use <cmd>`, `list --resolve`, and the library. `list`, `export` and the hook keep
the reference. Unreadable ones are left unset and reported (`resolution.secretErrors`).

## Shell hook

`eval "$(envi hook zsh)"` applies vars on `cd`, removes them on leave (tracked in
`$ENVI_APPLIED`), and re-applies after envi changes something (stamp vs `$ENVI_STAMP`).

## Library

```ts
import { config, loadEnv, parse, resolveEnv } from '@/dev-tools/envi/index';
await config();                        // into process.env, like dotenv.config()
const vars = await loadEnv({ cwd });   // object only
const why = await resolveEnv();        // sources, layers, missing keys
parse('A=1\nB=${A}2');                 // { A: '1', B: '12' }
```

No React/Ink in it. Note: Bun auto-loads `.env`; `bin/envi` runs Bun with `--no-env-file` (and
reads `/proc/self/environ` on Linux) — any wrapper that spawns envi must do the same.

## Code map (when changing envi)

- `src/run.ts` CLI · `src/index.ts` library entry.
- `src/core/{parse,envFile,resolve,locations,onePassword,search,shell}`.
- `src/config/{settings,project}` — user config/state and `env.config.ts` loading.
- `src/ui/*` — Ink dashboard.

Verify with `bun test`, `bunx tsc --noEmit`, `bun run lint` from `apps/envi`.
