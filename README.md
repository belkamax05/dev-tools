# dev-tools

Reusable terminal building blocks shared by the sibling repos in `~/dev` — colour and
formatting helpers, process/install utilities, a config store, and a full terminal-UI kit:
components, hooks, theming, and the mouse/alternate-screen layer under them — plus the apps
built on them, whose executables live in `bin/` — one shim per app, calling its
`apps/<app>/src/run.ts`:

| App | What it is |
| --- | --- |
| `dev-tools` / `devi` | the launcher: a picker over every app below, plus aliases ([README](apps/devi/README.md)) |
| `giti` | git dashboard and commands |
| `agenti` | `.agents` / `AGENTS.md` kept in step across AI IDEs |
| `porti` | listening ports — watch, inspect, stop ([README](apps/porti/README.md)) |
| `processi` | the process table, btop-style — sort, scope to a folder, stop ([README](apps/processi/README.md)) |
| `pkgi` | the current folder's npm packages — updates, versions, notes, compare ([README](apps/pkgi/README.md)) |
| `bmi` | bookmarks, raindrop-style — groups, tags, fuzzy search, page previews ([README](apps/bmi/README.md)) |
| `envi` | environment variables — the shell's, `.env` files and your own, layered like dotenv; shell hook and library ([README](apps/envi/README.md)) |

Three ways to get them on `PATH`, all defined once in `nix/`:

- `.envrc`: direnv, only while you're inside the repo (run `direnv allow` once). With Nix
  it's `use nix` (`shell.nix`); without Nix it only adds `bin/`.
- `include`, sourced from your shell rc, puts them in every shell. With Nix it builds the same
  environment as a profile under `.cache/nix/`, rebuilt only when `nix/` changes (see
  `nix/lib/activate.sh`). Without Nix, or with `DEV_TOOLS_NIX=0`, it only adds `bin/`.
- `nix-shell`, for a throwaway shell.

The Nix side (`nix/packages/*.nix`: latest bun from nixos-unstable, git-subrepo) is also an *env module*
(`nix/module.nix`). A repo that embeds dev-tools composes it with its own module through
`nix/lib/mk-env.nix`, and the embedding repo's packages win on a name clash. See
the embedding repo's own `nix/env.nix`.

The Nix *shell* (`nix-shell`, direnv) also installs npm packages on entry: every folder an env
module lists under `install` gets `pkgi install --nix --if-changed` — node_modules built in the Nix
store from the lockfile of the manager `packageManager` names (`nix/lib/node-modules.nix`), so the
same lockfile is always the same store path, and nothing at all happens while `node_modules` is
already the build of the current one. dev-tools' own `env.nix` lists this repo; an embedding repo
lists its own root. `include`'s global profile never installs. `DEV_TOOLS_AUTO_INSTALL=0` opts
out.

## Layout

```
libs/
├── config/color/     Palette, standard variants, ANSI style codes
├── terminal-canvas/  Pixels in a terminal: PNG decode, braille/half-block/ASCII canvases,
│                     kitty/sixel/iTerm2 encoders, capability probe — see its README
├── types/            Default-exported interfaces (ExecResult, PickerItem, InkRender, …)
├── ui/
│   ├── app/          runTuiApp — own the terminal, mount an app, put it all back
│   ├── components/   The component library (Box, Bar, PickList, HintBar, …)
│   ├── dialogs/      Entry points a foreign repo calls — data in, value out (pickCommand)
│   ├── hooks/        useViewport, useClickable, useScrollWindow, …
│   ├── providers/    TuiThemeProvider — theme tables and resolved colours
│   ├── terminal/     Mouse reporting, alternate screen, OSC background, stdin filter
│   ├── theme/        Breakpoints, chrome prices, display rules, palettes, sizes, timings
│   └── utils/        renderInkImmediate — mount an Ink app and carry on
└── utils/
    ├── color/        hexToRgb, rgbToAnsi, terminalColor
    ├── config/       configHome, createConfigStore
    ├── format/       formatArg, formatCommand, formatColor
    ├── install/      brew, ensureInstalled
    ├── picker/       Pure picker logic (filtering, resolving group children)
    └── process/      exec, listProcesses, stopProcess
```

## Two ways to consume this, and which one you get

Everything here is imported from source through a tsconfig `paths` entry rather than as an npm
dependency, because these libs are separate git repos:

```jsonc
"paths": {
  "@/dev-tools/*": ["../dev-tools/libs/*"]
}
```

What you may import depends on whether you share this lib's copy of `react` and `ink`.

**Workspace members** may import and render **anything**, components included. Bun's isolated
linker points every member's `node_modules/react` and `node_modules/ink` at one physical copy in
the root store, so a component authored here is reconciled by the same React the consumer is
using and its hooks find their dispatcher. There are two ways to be one:

- this repo's own `apps/*` (`giti`, `agenti`, `porti`, `processi`, `pkgi`, `bmi`, `envi`, `devi`), with this repo as
  the workspace root —
  `bun install` here;
- a repo that checks this one out as a git submodule at `libs/dev-tools` and lists it in its
  own `workspaces`.

**Anything outside the workspace** installs its own `react` and `ink` and therefore does **not**
share a copy. A component authored here would be mounted by a reconciler holding a *different*
React, and every hook in it would throw. Such a consumer is limited to:

- `ui/dialogs/*` — which mount and tear down a complete Ink tree with *this* lib's ink, and
  exchange plain data with the caller (see `PickerItem`) — the way to use this from an app with
  its own React;
- `ui/terminal/*`, `ui/theme/*`, and everything under `utils/` — no React in any of it;
- `ui/app/runTuiApp` and `ui/utils/renderInkImmediate` — both take the caller's own `render` as
  an argument for exactly this reason.

To move a repo into the first column, add this repo as a submodule, list it in that repo's
`workspaces`, delete its `node_modules`, and re-run `bun install` there. Expect to have to *declare* a
dependency or two it was getting by accident: a flat install hoists a package's transitive deps
to the top level, and the isolated linker does not.

## The UI kit

```tsx
import { render } from 'ink';
import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import TuiThemeProvider from '@/dev-tools/ui/providers/TuiThemeProvider';
import { createTheme } from '@/dev-tools/ui/theme';

const theme = createTheme({ sizes: { app: { minWidth: 64, minHeight: 16 } } });

await runTuiApp(
  <TuiThemeProvider theme={theme} palette="midnight">
    <App />
  </TuiThemeProvider>,
  { render },
);
```

`runTuiApp` owns the terminal: it enters the alternate screen *and homes the cursor* (every
hit-box in `useClickable` is computed against an app starting at row 1), turns mouse reporting on,
hands Ink a stdin with the mouse reports filtered out, and puts all three back on the way out —
including on a signal.

**Anything that reads the terminal's replies — a graphics probe, a colour query — must finish
before `runTuiApp` is called.** Once the input filter and Ink own stdin, a reply is not a reply,
it is a handful of garbage keystrokes delivered to whichever view is listening.

### Building blocks

Beyond `AppShell`/`ListDetail`/`PickList`, pieces that more than one app needs live here, not in
one app:

- `components/Toolbar`: a row of buttons, each `{ hotkey, label, onPress, tone?, disabled?, isOn? }`.
  Clicking one and pressing its hotkey do the same thing. The view still binds the key with its
  own `useInput`.
- `components/LinkRow`: a clickable path or URL line.
- `hooks/usePrompt`: a one-line `confirm(message, onYes)` / `ask(message, onSubmit)` that takes
  the keyboard while it is open. Render `prompt.line` in place of the view's header.
- `hooks/useLoader(load, deps)`: `{ data, isLoading, error, reload }` for async reads.
- `app/runTuiSession`: `runTuiApp` in a loop, for apps that hand the terminal to another
  program (`$EDITOR`, `git commit`) and come back afterwards, with mouse reporting restored.
- `utils/system/editFile`: use `getEditor` to open in the detected IDE (Antigravity or Devin),
  falling back to `$EDITOR` then `vi`.
- `utils/system/{revealPath,openUrl}`: open in the file manager or browser
  (`remoteWebUrl` turns a git remote into its web URL).

### Theme

`theme` answers "how big" and `colors` answers "what colour", and components ask rather than
deciding. Nothing reads `stdout.columns` or compares against a threshold itself; it calls
`useViewport()` and reads the answer.

- `breakpoints` — named tiers per axis, the media-query analogue. Both axes are first-class
  because rows decide more than columns in a TUI: nothing scrolls, so content that does not fit
  pushes the frame past the bottom of the terminal and every frame after that draws on top of
  itself.
- `chrome` — what the furniture costs in rows, so a list can be sliced to what is actually left.
  A part that sheds its frame on a short terminal is priced as a pair.
- `display` — `display: none` under a media query, as a table. `barBorders` is the one rule the
  shared components read for themselves.
- `palettes` — ten colour *roles* and the themes that fill them in. `classic` is written in ANSI
  names on purpose: it resolves to the user's own palette, so an app in it looks like part of the
  terminal it was launched from.

`createTheme(overrides)` merges an app's tables over the defaults; state only what changes. In
`display`, an override's **key order is preserved** — that order is the order elements are shed as
the terminal shrinks, and `hiddenLabels` reports them in it.

### Mouse

Ink has no mouse layer. `ui/terminal/mouse` owns the protocol end — SGR mode (`?1006`), the only
encoding that survives past column 223 — and `useClickable` does hit-testing by measuring the
element per event, because the layout moves with the terminal size.

```tsx
const ref = useRef<DOMElement>(null);
const { isHovered } = useClickable(ref, { onClick: () => setTab(id) });
```

Hover has to be *drawn*, not left to the cursor shape: only kitty can change that (OSC 22), so on
every other terminal a highlight is the only feedback a pointer gets.

Use `useHoveredId` when several elements report hover into one place. Each element only knows
whether the pointer is on *itself*, and moving right-to-left across a row delivers the leaver's
`false` after the newcomer's `true` — so clearing on any `false` throws away the id just set.

## Dialogs: plain data in, a value out

`ui/dialogs/*` mount and tear down a complete Ink tree and hand back what the user picked. This is
the boundary a repo with its own React must stay on:

```ts
import pickCommand from '@/dev-tools/ui/dialogs/pickCommand';

const selection = await pickCommand({
  items: [{ value: 'status', label: 'status', description: 'Show repository status' }],
  title: 'giti TUI',
  commandPrefix: 'giti',
});
//? `undefined` when the user backed out with Ctrl+C
```

A row is a `PickerItem`. Give it `children` (an array, or a thunk to defer the work) to make it a
folder the picker descends into, and `runnable: true` for a folder that Enter should run instead
of open. `value` has to be unique across the whole tree, so one flat map turns a pick back into
whatever the caller wants to do with it.

## Commands

```sh
bun install
bun test
bunx tsc --noEmit
bun run lint      # biome check .
bun run format    # biome check --write --unsafe .
bun run check:nix # evaluate + build nix/ against real Nix (skips without Nix)
```
