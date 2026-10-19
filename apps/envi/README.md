# envi

Environment variables: the shell's, the `.env` files' and your own, layered the way dotenv
does it. It comes as a terminal dashboard, commands for scripts, a shell hook, and a library.
It works from whatever folder you run it in.

```sh
envi                              # dashboard
envi values|locations|settings          # open it on a tab
envi list [search] [--json] [--reveal]    # what envi sets here, where from, vs the shell
envi list --resolve [--only K,K]          # the same, op:// read and shown — what `run` hands a command
envi shell [search] [--json]      # the current shell's variables, searched by name and value
envi get API_URL                  # one resolved value; exits 1 when unset
envi explain API_URL              # every layer that sets it, and which one wins
envi run -- npm start             # run a command with envi's variables (= envi -- npm start)
envi use -- npm start             # direnv-style: run a command with envi's variables, or
envi use                          #   alone, print them for $SHELL — eval "$(envi use)"
envi export [--shell zsh|bash|sh|fish|dotenv|json]   # eval "$(envi export)"
envi hook zsh                     # keep them applied as you cd — see below
envi set KEY=value [--to T | --file F | --global | --state]   # where Settings says (.env.user by default)
envi unset KEY [the same flags]                              # T: .env.user, .env, config, state
envi files [add|remove|enable|disable <path>]
envi check                        # exits 1 while a required variable is unset
envi init                         # write an env.config.ts template here
envi config                       # where settings are kept
```

`-C <dir>` resolves as if envi ran in `<dir>`.

## Layers

Layers apply in this order, and a later one wins:

1. **Your vars**: `vars` in `~/.config/envi/config.json`. These apply in every folder, under
   everything else, so a project can still override them. Then **machine vars**: `vars` in
   `~/.local/state/envi/state.json`, the same in every folder but on this machine only (never in
   dotfiles); a machine var beats a var of the same name in your config. `envi set --state` writes
   them.

Where a plain `envi set` (and `dfs env set`) writes is a setting, kept in your config:
`setTarget` is `.env.user` (the default), `.env`, `config` or `state`. Pick it in the Settings
tab; `--to`, `--file`, `--global` and `--state` override it for one call.
2. **Env files**: your list, read from the current folder. It starts as `.env` then `.env.user`.
   After it come the files each `env.config.ts` adds (see below), relative to that config's folder.
   Any file can be switched off. A missing file is listed, not an error.
3. **`env.config.ts` vars**: every `env.config.ts` from the git root down to the current
   folder, with the root's applied first and nearer ones winning.

Then the shell. A name the shell already exports keeps its value unless `override` is on, the
same rule dotenv uses for `process.env`. The Values tab marks each variable:

- `new`: the shell doesn't have it.
- `~ replaces shell`: override is on and envi's value replaces the shell's.
- `= same`: the shell already has the same value.
- `⊘ shell wins`: the shell exports its own value, and it is kept.

Values expand against everything set before them: `$NAME`, `${NAME}`, `${NAME:-fallback}`
(used when NAME is unset or empty) and `${NAME-fallback}` (used only when NAME is unset).

Quoting:

- `"double"` quotes expand variables and take `\n`, `\t` and `\$` escapes.
- `'single'` and `` `backtick` `` quotes are literal.
- Any of the three can span lines.
- An unquoted value ends at ` #`, which starts a comment.

## Workspace config: `env.config.ts`

```ts
export default {
  files: ['.env.shared'],        // read after your list, relative to this file
  disable: ['.env.user'],        // a name (any folder) or a path
  vars: { API_URL: 'http://localhost:${PORT:-3000}' },
  required: ['DATABASE_URL'],    // `envi check` and the Values tab flag these
  override: true,                // optional: this folder's own merge rule
};
```

It can also export a function, sync or async, that receives `{ cwd, root, dir, env }` and returns
the same object. The keys of a `.env.example` (or `.env.sample`, `.env.template`, `.env.dist`)
count as required too.

## Shell hook

```sh
eval "$(envi hook zsh)"      # ~/.zshrc   (or bash in ~/.bashrc)
envi hook fish | source      # ~/.config/fish/config.fish
```

The hook applies envi's variables whenever you `cd`, and takes them away when you leave,
restoring whatever the shell had before. To undo exactly its own changes, it records what it set
in `$ENVI_APPLIED`.

It also re-applies after envi itself changes a file or setting (`envi set`, anything in the
dashboard). For that, it compares a stamp file with `$ENVI_STAMP` before each prompt. Reading the
stamp is a shell builtin, so an idle prompt starts no process. After editing a file in another
editor, run `envi reload`.

## Tabs

| Tab | What it is for |
| --- | --- |
| 🧩 Values | every value here, in one list. First what envi provides — your vars, machine vars, the env files, `env.config.ts` — each with the layer that won (`+` new · `~` replaces shell · `=` same · `⊘` shell wins) and the layers it beat; required variables nothing sets are listed above them. Then, as a second list, what the shell exports that envi leaves alone (`◆` = set by the hook). `/` search names and values (`k:`/`v:` for one side) · `Enter`/`e` edit where it comes from · `c` copy · `y` copy `KEY=value` · `C` copy the secret itself (a reference read first) · `s` set (or, for a shell value, keep) in a place you pick — `Enter` picks the one Settings says · `l` show it in Locations · `o` open its file · `x` remove it from its source |
| 📄 Locations | every place values are kept, in the order envi applies them, each with its values under it: your vars and machine vars (every folder), the env files read here, each `env.config.ts`. `●` wins · `○` overridden. On a place: `a` add a value · `Enter`/`←`/`→` fold · `o` open in the editor · for a file `Space` on/off · `[`/`]` reorder · `x` unlist. On a value: `Enter`/`e` edit · `m` move to another place · `M` copy to another place (as written, so `${HOST}` stays a reference; a place that already sets it asks first) · `R` rename · `x` delete · `c`/`y`/`C` copy · `l` show it in Values. `A` add a file · `/` search |
| 🔧 Settings | where `envi set` writes (`.env.user` here, `.env` here, your vars, machine vars), override, expansion, secret name patterns, the hook line to copy, theme, `e` edit the file |

Everywhere: `1-3`/`Tab` switch tab, `r` refresh, `v` reveal secrets, `t` theme, `q` quit.
Every button and row is clickable. `envi resolved`/`envi vars` (the old tab names) open Values
and Locations.

A value is masked when its name contains one of the secret patterns (`TOKEN`, `SECRET`,
`PASSWORD`, `API_KEY`…). `v` reveals every secret across the whole dashboard at once — a
1Password reference in view is read on the spot, so its secret is one key away — and the toggle is
kept in the state file, so a restart opens the way you left it.

## 1Password references

A value written as `op://vault/item/field`, in your vars or any env file, is a pointer into
1Password. It is shown as it is (never masked: it is not the secret), and read with the
1Password CLI (`op read`) only when a command needs it:

- `envi get KEY`, `envi run …`, `envi use <command>` and `envi list --resolve` read it
  (`list --resolve [--only A,B]` prints the values `run` would hand a command, unmasked); `envi run --only A,B -- cmd`
  hands the command just those variables on top of the shell's, so nothing else is asked for.
- The dashboard, plain `envi list`, `envi export` and the shell hook keep the reference. In the
  dashboard, `v` (reveal secrets) reads the one in view; `C` copies the secret itself.
- As a library, `config()` and `loadEnv()` read references, all of them or just `only: [...]`.
  One that cannot be read is left unset and reported in `resolution.secretErrors`.

`dfs deploy` asks for only the variables `depli.config.ts`'s providers name (`userEnv`,
`tokenEnv`).

## As a library

```ts
import { config, loadEnv, parse, resolveEnv } from '@/dev-tools/envi/index';

await config();                       // like dotenv.config(): envi's layers into process.env
const vars = await loadEnv({ cwd });  // just the variables, as an object
const why = await resolveEnv();       // everything, with sources, layers and missing keys
parse('A=1\nB=${A}2');                // { A: '1', B: '12' }
```

Nothing in it loads React or Ink.

## Where settings are kept

- `~/.config/envi/config.json` holds `files`, `disabled`, `vars`, `override`, `expand`,
  `maskPatterns` and `theme`. Your vars may include tokens, so keep this file out of a public
  dotfiles repository.
- `~/.local/state/envi/` holds the last tab, the reveal toggle, machine vars and the hook's stamp.

Bun loads `.env` files into `process.env` on its own. To avoid that, `bin/envi` runs Bun with
`--no-env-file`, and on Linux envi reads the environment it was launched with from
`/proc/self/environ`. Without both, the project's `.env` values would look as if the shell had
exported them.

In Settings, the Files section exposes both **Settings in $EDITOR** and **State in $EDITOR**. Select a file to see its path and contents description; Enter opens it. Edits are reloaded when the dashboard returns.
