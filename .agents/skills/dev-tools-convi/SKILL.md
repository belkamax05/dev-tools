---
name: dev-tools-convi
description: Use convi (dev-tools) to convert files between formats — Markdown to PDF, saved terminal output (.ansi) to PNG/HTML — and to take terminal screenshots of a command with `convi shot`. Trigger when asked to make a PDF from Markdown, screenshot/capture a command's colored output as an image, render an .ansi capture, or add a new converter to convi.
---

# convi — file converter and terminal screenshots

`convi` lives in `apps/convi` of the dev-tools repo (`bin/convi` is its shim). Also reachable as
`dev-tools convert …`. Paths are relative to the current directory.

## Commands

```sh
convi                                  # help + converter list
convi list [--json]                    # converters
convi browsers [--json]                # which renderer PNGs would use
convi md-to-pdf notes.md               # → notes.pdf next to it
convi md-to-pdf notes out/report       # → out/report.pdf (extension added when missing)
convi notes.md report.pdf              # converter picked from the two extensions
convi out.ansi out.png                 # re-render a saved terminal stream
convi shot bun run validate            # → bun-run-validate.png in cwd
convi shot --output=docs/lint -- bun run lint --fix
convi shot 'bun test | tail -20'       # one quoted arg = a shell line
```

## Converters

| Name | From → to | Needs (never auto-installed) |
| --- | --- | --- |
| `md-to-pdf` | `.md` → `.pdf` | `pandoc`, `weasyprint`; `mermaid-filter` only if the file has a mermaid block |
| `ansi-to-png` | `.ansi` → `.png` | a Chromium-family browser, or Playwright in the project |
| `ansi-to-html` | `.ansi` → `.html` | nothing |

Missing tools are listed with install hints and convi exits — it never runs a package manager.
Tell the user what to install; do not install it behind their back.

## `convi shot` — screenshot a command

`convi shot [flags] [--] <command…>`: flags go before the command (or before `--`).

- Runs the command in cwd with colour forced (`FORCE_COLOR`, `CLICOLOR_FORCE`, `COLORTERM`,
  `TERM=xterm-256color`, `NO_COLOR` removed); stdout+stderr share one pipe so order is kept.
- A failing command still produces the PNG; its exit code is **reported, not propagated**.
  Don't treat a non-zero exit from the command as a convi failure.
- Carriage returns / erase sequences are applied, so spinners collapse to their last frame.

| Flag | Default |
| --- | --- |
| `--output=<file>` | command as file name (`bun-run-validate.png`) in cwd |
| `--title=<text>` | `<folder> — <command>` (file name for a file input) |
| `--prompt=<text>` | the command (no prompt line for a file input) |
| `--label=<text>` | current folder name, before `❯` |
| `--scale=<n>` | `2` |
| `--renderer=<name>` | `auto` \| `chrome` \| `playwright` |
| `--columns=<n>` | `120` (≥ 20), passed as `COLUMNS` |
| `--keep-ansi` | off — also save the raw `.ansi` for re-rendering |

`--title/--prompt/--label/--scale/--renderer` also apply to `ansi-to-png`; the first three to
`ansi-to-html`.

## Rendering

PNGs go through the shared `libs/utils/browser/screenshotHtml`:

- **chrome** — installed browser CLI: `$CHROME_PATH`, then `google-chrome`, `chromium`, `brave`,
  `microsoft-edge`, then macOS apps. Two headless passes (measure, then screenshot) with a
  throwaway profile.
- **playwright** — the project's own Playwright, resolved from cwd, never installed.
- `auto` prefers chrome. If rendering fails, run `convi browsers` first.

## Code map (when changing convi)

- `src/run.ts` — CLI dispatch.
- `src/converters/<name>/index.ts` — one folder per converter exporting a `Converter`
  (`src/converters/types.ts`: `name`, from/to extensions, `tools(job)`, optional `check(job)`,
  `convert(job)`), registered with one line in `src/converters/index.ts`. The name becomes a
  subcommand; the extension pair enables `convi <in> <out>`. `--name=value` flags arrive as
  `job.options`.
- `src/core/captureCommand` (run + capture), `src/core/terminalHtml` (ANSI → window HTML),
  `src/core/renderTerminal`.
- Shared libs: `libs/ui/terminal/ansi/parse`, `libs/utils/browser/{findBrowsers,findPlaywright,screenshotHtml}`,
  `libs/utils/cli/parseFlags`, `libs/utils/format/escapeHtml`.

Verify with `bun test`, `bunx tsc --noEmit`, `bun run lint` from `apps/convi`. Keep
`apps/convi/README.md` in step with behaviour changes.
