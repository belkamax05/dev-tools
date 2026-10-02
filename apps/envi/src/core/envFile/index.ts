import { existsSync } from 'node:fs';

import { type ParsedDotenv, parseDotenv, quoteValue } from '../parse';

export interface EnvFileRead extends ParsedDotenv {
  path: string;
  exists: boolean;
  /** Why the file exists but could not be read (permissions, a directory). */
  error?: string;
}

/** Read and parse a dotenv file. A missing file is an empty one, flagged — never an error. */
export const readEnvFile = async (path: string): Promise<EnvFileRead> => {
  if (!existsSync(path)) return { path, exists: false, entries: [], errors: [] };
  try {
    return { path, exists: true, ...parseDotenv(await Bun.file(path).text()) };
  } catch (error) {
    return {
      path,
      exists: true,
      entries: [],
      errors: [],
      error: (error as Error).message,
    };
  }
};

const assignmentLine = (key: string) =>
  new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.]/g, '\\.')}\\s*[=:]`);

/**
 * Set `key` in a dotenv file, keeping every other line — comments, order, blank lines — as it was.
 *
 * The *last* assignment is rewritten, since that is the one a reader honours; earlier duplicates
 * are left alone rather than silently deleted. A key the file does not have is appended. A
 * multi-line quoted value being replaced is replaced whole. The file is created when missing.
 */
export const setInEnvFile = async (path: string, key: string, value: string): Promise<void> => {
  const text = existsSync(path) ? await Bun.file(path).text() : '';
  const lines = text.length ? text.replace(/\n$/, '').split('\n') : [];
  const entries = parseDotenv(text).entries.filter((entry) => entry.key === key);
  const last = entries.at(-1);
  const line = `${key}=${quoteValue(value)}`;

  if (last && assignmentLine(key).test(lines[last.line - 1] ?? '')) {
    const span = last.raw.split('\n').length;
    lines.splice(last.line - 1, last.quote ? span : 1, line);
  } else lines.push(line);
  await Bun.write(path, `${lines.join('\n')}\n`);
};

/** Remove every assignment of `key` from a dotenv file. Returns how many were removed. */
export const removeFromEnvFile = async (path: string, key: string): Promise<number> => {
  if (!existsSync(path)) return 0;
  const text = await Bun.file(path).text();
  const lines = text.replace(/\n$/, '').split('\n');
  const entries = parseDotenv(text)
    .entries.filter((entry) => entry.key === key)
    .sort((a, b) => b.line - a.line);
  for (const entry of entries) {
    lines.splice(entry.line - 1, entry.quote ? entry.raw.split('\n').length : 1);
  }
  if (entries.length) await Bun.write(path, lines.length ? `${lines.join('\n')}\n` : '');
  return entries.length;
};

/** Format a whole set of variables as a dotenv file. */
export const formatDotenv = (vars: Record<string, string>): string =>
  Object.entries(vars)
    .map(([key, value]) => `${key}=${quoteValue(value)}\n`)
    .join('');
