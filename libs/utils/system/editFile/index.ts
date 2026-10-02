import { spawnSync } from 'node:child_process';

import getEditor from '../getEditor';

/**
 * Open `path` in the user's editor and wait for it to close.
 *
 * The enclosing IDE, then `$EDITOR`, then `vi`. Split on spaces so an editor that
 * needs a flag — `code --wait` — works as it would from a shell; a GUI editor
 * set without its wait flag returns at once, and the dashboard simply reopens.
 * Must only be called with the terminal back in normal mode, which is why the
 * dashboard hands this back to the CLI rather than calling it itself.
 */
export const editFile = (path: string): void => {
  const editor = getEditor();
  const [bin = 'vi', ...args] = editor.split(/\s+/).filter(Boolean);
  // Packaged IDEs can expose a different CLI name from the canonical editor.
  const aliases =
    bin === 'antigravity'
      ? ['antigravity', 'antigravity-ide']
      : bin === 'devin'
        ? ['devin', 'devin-desktop']
        : [bin];
  const command = aliases.find((alias) => Bun.which(alias)) ?? bin;
  spawnSync(command, [...args, path], { stdio: 'inherit' });
};

export default editFile;
