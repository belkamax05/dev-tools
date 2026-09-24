import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Open the folder holding `path` (or `path` itself, when it is a folder) in the
 * desktop's file manager — the web version's "open location".
 *
 * Detached and unreferenced, so the file manager outlives nothing it should
 * not and the TUI never waits on it.
 */
export const revealPath = (path: string): void => {
  let folder = path;
  try {
    if (!statSync(path).isDirectory()) folder = dirname(path);
  } catch {
    folder = dirname(path);
  }
  const command =
    process.platform === 'darwin'
      ? ['open', folder]
      : process.platform === 'win32'
        ? ['explorer', folder]
        : ['xdg-open', folder];
  const [bin = '', ...args] = command;
  spawn(bin, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
};

export default revealPath;
