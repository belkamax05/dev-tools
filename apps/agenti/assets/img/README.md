# IDE logos

One 512×512 transparent PNG per IDE, named by its id in `src/core/ides`. Drawn on the IDE tab
by `src/ui/logo` — kitty graphics where the terminal supports them, braille or ASCII otherwise.

| File | Source |
| --- | --- |
| `claude-code.png` | Claude mark from [simple-icons](https://simpleicons.org) 16.32.0 (`claude`), in its brand colour `#D97757` |
| `cursor.png` | Cursor mark from simple-icons 16.32.0 (`cursor`), in its brand black — tinted light at draw time (`monochromeLogo`) |
| `vscode.png` | VS Code's own application icon (`share/icons/hicolor/1024x1024/apps/vscode.png` of the nixpkgs package), downscaled |
| `antigravity.png` | Antigravity's application icon (nixpkgs package), with its dark grid tile keyed out to transparent |
| `devin.png` | Devin Desktop's application icon (nixpkgs package), white tile keyed out — black mark, tinted like Cursor's |

simple-icons has no Antigravity or Devin mark, hence the keyed-out app icons. All are the
vendors' trademarks, used here only to identify the IDE.
