# utils-terminal

Reusable terminal building blocks shared by the sibling repos in `~/dev/shulker` — colour and
formatting helpers, process/install utilities, and the interactive Ink dialogs behind the `giti`
and `shulker-controller` command pickers.

Consumers wire it up with a tsconfig `paths` entry rather than an npm dependency, because the
libs are separate git repos:

```jsonc
"paths": {
  "@/utils-terminal/*": ["../utils-terminal/src/*"]
}
```

## Layout

```
src/
├── config/color/     Palette, standard variants, ANSI style codes
├── types/            Default-exported interfaces (ExecResult, PickerItem, InkRender, …)
├── ui/
│   ├── components/   Ink components (CommandPicker, ScrollableSelect)
│   ├── dialogs/      Entry points a consumer calls — data in, value out (pickCommand)
│   ├── hooks/        React hooks backing the components
│   └── utils/        renderInkImmediate — mount an Ink app and carry on
└── utils/
    ├── color/        hexToRgb, rgbToAnsi, terminalColor
    ├── format/       formatArg, formatCommand, formatColor
    ├── install/      brew, ensureInstalled
    ├── picker/       Pure picker logic (filtering, resolving group children)
    └── process/      exec
```

## Dialogs: plain data in, a value out

`ui/dialogs/*` mount and tear down a complete Ink tree and hand back what the user picked:

```ts
import pickCommand from '@/utils-terminal/ui/dialogs/pickCommand';

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

**Never pass a React element across this boundary, and never import these components into another
repo's tree.** Each repo resolves `react` and `ink` from its own `node_modules`, so a component
authored elsewhere would be mounted by a reconciler that shares a *different* React copy, and its
hooks would find no dispatcher. That is the whole reason the dialogs take data instead of
children, and why `PickerItem` exists at all.

`ui/utils/renderInkImmediate` is the one piece that *is* safe to reuse from another repo: it
carries no ink of its own and takes the caller's `render` as an argument.

```tsx
import { render } from 'ink';
import renderInkImmediate from '@/utils-terminal/ui/utils/renderInkImmediate';

await renderInkImmediate(<MyOwnComponent />, { render, clear: true });
```

## Commands

```sh
bun install
bun test
bunx tsc --noEmit
bun run lint      # biome check .
bun run format    # biome check --write --unsafe .
```
