# convi — file format converter

One command for turning a file into another format. `md-to-pdf` is the only converter so far.

```sh
convi                              # help and the converter list
convi md-to-pdf notes.md           # → notes.pdf next to it
convi md-to-pdf notes out/report   # → out/report.pdf (extensions are added when missing)
convi notes.md report.pdf          # converter picked by the two extensions
convi list [--json]
```

Paths are relative to the current directory. Also reachable as `dev-tools convert …`.

## Converters

| Name | From → to | Needs |
| --- | --- | --- |
| `md-to-pdf` | `.md` → `.pdf` | `pandoc`, `weasyprint`; `mermaid-filter` only when the file has a mermaid block |

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
extensions, `tools(job)`, `convert(job)`), plus one line in `src/converters/index.ts`. The name
makes it a subcommand and the extension pair makes `convi <input> <output>` find it, with no
other registry.
