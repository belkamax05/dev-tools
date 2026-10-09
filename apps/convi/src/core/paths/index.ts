import { extname } from 'node:path';

/**
 * Give a path the extension it should have, appending it when missing — `notes` → `notes.md`.
 * A different extension is kept as-is (`notes.txt` stays `notes.txt`): the user named that file.
 */
export const withExtension = (path: string, ext: string) =>
  extname(path) ? path : `${path}${ext}`;

/** Swap a path's extension, or append one when it has none — `docs/notes.md` → `docs/notes.pdf`. */
export const replaceExtension = (path: string, ext: string) => {
  const current = extname(path);
  return `${current ? path.slice(0, -current.length) : path}${ext}`;
};
