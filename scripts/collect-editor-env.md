Run these commands in a fresh integrated terminal in each IDE, in the same
environment where you normally run dev-tools.

Antigravity:

```sh
cd path/to/dev-tools
bun --no-env-file scripts/collect-editor-env.ts antigravity
```

Devin:

```sh
cd path/to/dev-tools
bun --no-env-file scripts/collect-editor-env.ts devin
```

Optionally capture an ordinary terminal outside both IDEs for comparison:

```sh
cd path/to/dev-tools
bun --no-env-file scripts/collect-editor-env.ts baseline
```

Reports are written to `.cache/editor-env/<label>.json` in this subrepo. The
label is for comparing reports; it is not evidence of which IDE is running.
The script includes every environment variable's name, but exposes values only
for selected terminal/editor identifiers and executable paths. All other values
are redacted. It also records which editor commands are on PATH; an installed
command alone does not identify the current IDE.

`--no-env-file` prevents Bun from adding project dotenv values to the report.
The script never changes the terminal environment or launches an editor.
Tell Codex when both reports are ready. If generated on a different machine,
copy the JSON reports into this subrepo's `.cache/editor-env/` directory or
paste their contents into the chat.
