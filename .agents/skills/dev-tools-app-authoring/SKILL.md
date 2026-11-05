---
name: dev-tools-app-authoring
description: Conventions for building or changing a dev-tools app or shared lib — app layout (`src/run.ts`, `core/`, `ui/`, `config/`), bin shims, package.json aliases, the Ink TUI kit in `libs/ui` (AppShell, tabs, theme, mouse, dialogs), config/state stores, shared hotkeys, tests and docs. Trigger when creating a new app in libs/dev-tools/apps, adding a tab/view/command to an existing one, or adding a helper to libs/.
---

# Building dev-tools apps

dev-tools is a Bun workspace: `apps/*` (one app each) + `libs/*` (shared code, imported as
`@/dev-tools/*` from apps, relative imports inside `libs/`). Bun only — `bun test`, `bunx`, no Node
tooling (see the repo's `CLAUDE.md`).

## App layout

```
apps/<name>/
  package.json        name, description, "dev-tools": { "aliases": [...] }, lint/format scripts
  README.md           user-facing reference — keep in step with behaviour
  tsconfig.json       paths for @/dev-tools/*
  src/run.ts          export default run(...argv): CLI dispatch; lazy-imports the UI
  src/core/*          logic, NO React/Ink — importable by other repos as @/dev-tools/<name>/core/*
  src/config/settings createConfigStore-based settings (+ state)
  src/ui/             App, renderDashboard, theme, types, views/<Tab>View
bin/<name>            #!/usr/bin/env bun — import run from '../apps/<name>/src/run'; await run(...process.argv.slice(2));
```

Also add the bin to the root `package.json` `bin` and a row to the root `README.md` app table.
devi discovers the app automatically from `src/run.ts`.

## Conventions every app follows

- **Commands for scripts + a dashboard.** Bare `<app>` opens the TUI; `<app> <tab>` opens a tab;
  subcommands print plain text and support `--json` where data is returned; exit codes are
  meaningful (`--check`, `outdated`, `status` exit 1 on a problem).
- **Lazy UI.** `run.ts` does `await import('./ui/renderDashboard')` only when the TUI is needed, so
  scripted commands never load React. Without a TTY, print instead of rendering.
- **Destructive actions ask first** (and name what they act on); scripted forms need `--yes`.
- **Never install tools for the user** — check, list what's missing with how to get it, exit.
- **Settings vs state:** `libs/utils/config/createConfigStore` — `kind: 'config'`
  (`~/.config/<app>/config.json`, user choices, dotfile-safe) vs `kind: 'state'`
  (`~/.local/state/<app>/state.json`, last tab, toggles). Settings tab offers "Settings/State in
  $EDITOR" and reset.
- **Project config** is a `<app>.config.ts` found nearest at/above cwd, overridable by an env
  var when a wrapping tool runs the app for a project (`PORTI_PROJECT_DIR`, `DEPLI_PROJECT_DIR`,
  `PROJI_PROJECT_DIR`, `GITI_CONFIG`); may export a function of its context.
- **Hotkeys:** shared meanings come from `libs/config/hotkeys` (`hotkeys.delete`, `edit`, `search`,
  `copy`, `quit`, …) — never a literal for a shared key, never rebind one. Everywhere: `1-N`/`Tab`
  tabs, `r` refresh, `t` theme, `q` quit. Every button/row clickable.

## libs/ui kit (Ink)

- `ui/app/runTuiApp` / `runTuiSession` — alt screen, mouse, background, cleanup; takes the
  caller's `render` (so another repo's ink can drive it).
- `ui/components` — `AppShell`, `AppHeader`, `TabStrip`/`ClickableTab`, `Footer`, `HintBar`,
  `ListDetail`, `ScrollPanel`/`ScrollableSelect`/`Scrollbar`, `PickList`, `Popover`, `Toolbar`,
  `ActionButton`, `ChipRow`, `StatusNote`, `ThemePicker`/`ThemeEditor`, `ClearDataDialog`,
  `GraphicsCanvas`, `TerminalTooSmall`.
- `ui/hooks` — `useClickable`, `useTerminalSize`, `useScrollWindow`, `usePrompt`, `useLoader`,
  `useStatus`, `useThemeSettings`, `useInputGrab`, `useCommandFilter`…
- `ui/providers/TuiThemeProvider`, `ui/theme`, `ui/terminal/*` (ansi parse, mouse, screen, frames).
- `ui/dialogs/pickCommand` — a self-contained Ink tree, safe from repos with their own React.
- `libs/terminal-canvas` — images in the terminal (kitty, sixel, iTerm2, half-block, braille).

## libs/utils

`process/{exec,listProcesses,stopProcess,shellQuote}`, `system/{openUrl,editFile,getEditor,copyToClipboard,revealPath}`,
`config/{configHome,createConfigStore}`, `format/{formatArg,formatColor,formatCommand,escapeHtml}`,
`cli/parseFlags`, `browser/{findBrowsers,findPlaywright,screenshotHtml}`, `install/{ensureInstalled,brew}`,
`picker/*`, `color/*`. Reuse before writing a new helper; a helper two apps need goes here.

## Code style

`<name>/index.ts` folders with `index.test.ts` beside them; `//?` comments explain *why*; Biome
(2-space, single quotes, ~100 cols, semicolons). Verify per app: `bun test`, `bunx tsc --noEmit`,
`bun run lint`. Update the app's README and its `dev-tools-<app>` skill with behaviour changes.
