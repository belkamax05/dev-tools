import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface PackageScript {
  name: string;
  /** The script's command line, as written in package.json. */
  command: string;
}

/** The nearest folder at or above `dir` with a package.json — the project proji works on. */
export const findProjectRoot = (dir: string): string | undefined => {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/**
 * `root`'s package.json scripts, in file order. A missing or unreadable package.json, or one
 * without scripts, is no scripts rather than an error — the overrides may still be worth showing.
 */
export const readScripts = async (root: string): Promise<PackageScript[]> => {
  try {
    const pkg = (await Bun.file(join(root, 'package.json')).json()) as { scripts?: unknown };
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return [];
    return Object.entries(pkg.scripts as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, command]) => ({ name, command }));
  } catch {
    return [];
  }
};
