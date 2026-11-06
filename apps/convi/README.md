# convi — file format converter, and terminal screenshots

One command for turning a file into another format, plus `shot`: run a command and save what it
printed, colours and all, as a terminal-window PNG.

```sh
convi                              # help and the converter list
convi md-to-pdf notes.md           # → notes.pdf next to it
convi md-to-pdf notes out/report   # → out/report.pdf (extensions are added when missing)
convi notes.md report.pdf          # converter picked by the two extensions
convi shot bun run validate        # → bun-run-validate.png in the current directory
convi shot --output=docs/lint -- bun run lint --fix
convi shot help                    # the shot flags (also --help, -h; `convi shot -- help` runs `help`)
convi out.ansi out.png             # a saved terminal stream, rendered the same way
convi browsers [--json]            # what PNGs would be rendered with
convi list [--json]
```

Paths are relative to the current directory. Also reachable as `dev-tools convert …`.

## Converters

| Name | From → to | Needs |
| --- | --- | --- |
| `md-to-pdf` | `.md` → `.pdf` | `pandoc`, `weasyprint`; `mermaid-filter` only when the file has a mermaid block |
| `ansi-to-png` | `.ansi` → `.png` | a Chromium-family browser, or Playwright in the project |
| `ansi-to-html` | `.ansi` → `.html` | nothing |

## Terminal screenshots

`convi shot [flags] [--] <command…>` runs the command in the current directory and renders its
output as a window: title bar, the command on a prompt line, then everything it printed. Its
flags come before the command (or before `--`); anything after belongs to the command. One
quoted argument is a shell line: `convi shot 'bun test | tail -20'`.

The command's output is piped, so it is told colour is wanted (`FORCE_COLOR`, `CLICOLOR_FORCE`,
`COLORTERM`, `NO_COLOR` removed) and gets `TERM=xterm-256color` — with `TERM=linux`, clack and
similar tools fall back to plain ASCII. stdout and stderr go through one pipe, so they keep their
order. A failing command is fine — a screenshot of an error is often the point — so its exit code
is reported, not passed on.

| Flag | Default |
| --- | --- |
| `--output=<file>` | the command as a file name (`bun-run-validate.png`), in the current directory |
| `--title=<text>` | `<folder> — <command>`; for a file, its name |
| `--prompt=<text>` | the command; no prompt line for a file |
| `--label=<text>` | the current folder's name, before `❯` |
| `--scale=<n>` | `2` — pixels per CSS pixel |
| `--renderer=<name>` | `auto`, `chrome` or `playwright` |
| `--columns=<n>` | `120` — the width the command is told (`COLUMNS`) |
| `--timeout=<seconds>` | none — stop the command (its whole process group, pipelines included) after this long; what it printed by then is still drawn |
| `--term=<name>` | `xterm` (`TERM=xterm-256color`); `kitty` sets `TERM=xterm-kitty`, for tools that only print kitty graphics in kitty |
| `--keep-ansi` | off — also save the raw capture as `.ansi`, to re-render later |

`--title`, `--prompt`, `--label`, `--scale` and `--renderer` work for `ansi-to-png` too (and the
first three for `ansi-to-html`).

What a terminal leaves on screen is what gets drawn: carriage returns, `ESC[G` and the erase
sequences are applied per line, so a spinner's redraws collapse into its last frame. 16, 256 and
true colours, bold, dim, italic, underline, strike-through and inverse are kept; cursor hiding,
window titles and links are dropped.

Pictures sent with the kitty graphics protocol (`ESC _G … ESC \`) are drawn where they were placed:
RGB, RGBA or PNG data, zlib-compressed or not, sent inline or as a file path, in chunks, and shown
straight away (`a=T`) or stored and put later (`a=p`). Asked-for cells (`c=`, `r=`) set the size;
otherwise it is the picture's own pixel size, never wider than `--columns`. This works in
`ansi-to-png` too, whatever `--term` was. A tool that asks the terminal about itself first has
no terminal to ask, as its output is piped; `kitten icat` needs to be told instead:

```sh
convi shot --term=kitty -- kitten icat --stdin=no --transfer-mode=stream \
  --use-window-size=120,40,940,760 picture.png
```

### Rendering: whatever browser is already installed

PNGs are drawn by `utils/browser/screenshotHtml` (shared, in `libs/`), with one of two renderers,
neither of which convi installs:

- **chrome**: the CLI of an installed Chromium-family browser — `$CHROME_PATH`, then
  `google-chrome`, `chromium`, `brave`, `microsoft-edge` on PATH, then the macOS apps. Two headless
  runs: the first lays the page out and reports its size, the second screenshots it at exactly
  that size. A throwaway profile keeps it away from a browser you have open.
- **playwright**: the project's own Playwright (resolved from the current directory, never
  installed or auto-installed), driving the installed Chromium when there is one.

`auto` takes chrome when a browser is found, otherwise Playwright. `convi browsers` shows what was
found and which `auto` would use.

## External tools are never installed for you

A converter declares what it shells out to. convi checks for those tools before starting and,
if any are missing, lists them with how to get each one, then exits. It never runs a package
manager itself. Install them however you install everything else: system packages, Nix (this
machine's dotfiles provide them), `pip`/`npm`.

`md-to-pdf` asks for `mermaid-filter` only when the file actually contains a mermaid code
block, so plain Markdown converts with just pandoc and WeasyPrint. mermaid-filter renders through
puppeteer, which convi launches with `--no-sandbox` (Chromium's sandbox fails in containers
and on some distros).

## Adding a converter

A folder in `src/converters/` exporting a `Converter` (`src/converters/types.ts`: name, from/to
extensions, `tools(job)`, an optional `check(job)` for needs that are not one fixed tool,
`convert(job)`), plus one line in `src/converters/index.ts`. The name makes it a subcommand and
the extension pair makes `convi <input> <output>` find it, with no other registry. `--name=value`
flags reach it as `job.options`.
