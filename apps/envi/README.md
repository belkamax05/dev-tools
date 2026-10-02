# envi

Environment variables: the shell's, the `.env` files' and your own, layered the way dotenv
does it. It comes as a terminal dashboard, commands for scripts, a shell hook, and a library.
It works from whatever folder you run it in.

```sh
envi                              # dashboard
envi shell|resolved|files|vars|settings   # open it on a tab
envi list [search] [--json] [--reveal]    # what envi sets here, where from, vs the shell
envi shell [search] [--json]      # the current shell's variables, searched by name and value
envi get API_URL                  # one resolved value; exits 1 when unset
envi explain API_URL              # every layer that sets it, and which one wins
envi run -- npm start             # run a command with envi's variables (= envi -- npm start)
envi export [--shell zsh|bash|sh|fish|dotenv|json]   # eval "$(envi export)"
envi hook zsh                     # keep them applied as you cd — see below
envi set KEY=value [--file F | --global]   # .env.user here by default; --global: your vars
envi unset KEY [--file F | --global]
envi files [add|remove|enable|disable <path>]
envi check                        # exits 1 while a required variable is unset
envi init                         # write an env.config.ts template here
envi config                       # where settings are kept
```

`-C <dir>` resolves as if envi ran in `<dir>`.

## Layers

Layers apply in this order, and a later one wins:

1. **Your vars**: `vars` in `~/.config/envi/config.json`. These apply in every folder, under
   everything else, so a project can still override them.
2. **Env files**: your list, read from the current folder. It starts as `.env` then `.env.user`.
   After it come the files each `env.config.ts` adds (see below), relative to that config's folder.
   Any file can be switched off. A missing file is listed, not an error.
3. **`env.config.ts` vars**: every `env.config.ts` from the git root down to the current
   folder, with the root's applied first and nearer ones winning.

Then the shell. A name the shell already exports keeps its value unless `override` is on, the
same rule dotenv uses for `process.env`. The Resolved tab marks each variable:

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
  required: ['DATABASE_URL'],    // `envi check` and the Resolved tab flag these
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

| Tab | Keys |
| --- | --- |
| 🐚 Shell | the exported environment, with `◆` marking what the hook set. `/` searches names and values together (`k:`/`v:` restrict a word to one side). `c` copy · `C` copy `KEY=value` · `s` pin into `.env.user` · `g` pin into your vars |
| 🧩 Resolved | what envi sets: the winning layer, the layers it beat, and the shell's value. Missing required variables are listed first. `/` search · `c` copy · `s` override here (`.env.user`) · `g` set in your vars · `o` open the source · `x` remove from the source |
| 📄 Files | the env files in order, plus each `env.config.ts`. Space switches a file on or off · `a` add · `n` add a variable to it · `e` edit/create · `[`/`]` reorder · `x` unlist |
| 👤 Your vars | `a` add · `n` edit value · `R` rename · `x` delete · `c` copy · `/` search |
| 🔧 Settings | override, expansion, secret name patterns, the hook line to copy, theme, `e` edit the file |

Everywhere: `1-5`/`Tab` switch tab, `r` refresh, `v` reveal secrets, `t` theme, `q` quit.
Every button and row is clickable.

A value is masked when its name contains one of the secret patterns (`TOKEN`, `SECRET`,
`PASSWORD`, `API_KEY`…). Reveal is never saved, so every run starts masked.

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
- `~/.local/state/envi/` holds the last tab and the hook's stamp.

Bun loads `.env` files into `process.env` on its own. To avoid that, `bin/envi` runs Bun with
`--no-env-file`, and on Linux envi reads the environment it was launched with from
`/proc/self/environ`. Without both, the project's `.env` values would look as if the shell had
exported them.
