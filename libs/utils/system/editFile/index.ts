import { spawnSync } from 'node:child_process';

/**
 * Open `path` in the user's editor and wait for it to close.
 *
 * `$VISUAL`, then `$EDITOR`, then `vi`. Split on spaces so an editor that
 * needs a flag — `code --wait` — works as it would from a shell; a GUI editor
 * set without its wait flag returns at once, and the dashboard simply reopens.
 * Must only be called with the terminal back in normal mode, which is why the
 * dashboard hands this back to the CLI rather than calling it itself.
 */
export const editFile = (path: string): void => {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
  const [bin = 'vi', ...args] = editor.split(/\s+/).filter(Boolean);
  spawnSync(bin, [...args, path], { stdio: 'inherit' });
};

export default editFile;
