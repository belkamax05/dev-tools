import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { coercePorts, type WatchedPort } from '../settings';

/** The file names looked for, in order. `.ts` is the documented one; the rest are for projects without TS. */
export const PROJECT_CONFIG_NAMES = [
  'porti.config.ts',
  'porti.config.mjs',
  'porti.config.js',
] as const;

/**
 * What a project's `porti.config.ts` may export.
 *
 * ```ts
 * // porti.config.ts
 * export default {
 *   ports: [
 *     { port: 5173, name: 'web', description: 'Vite dev server' },
 *     { port: 6006, name: 'storybook' },
 *   ],
 * };
 * ```
 */
export interface PortiProjectConfig {
  ports?: WatchedPort[];
}

export interface ProjectPortsResult {
  ports: WatchedPort[];
  /** The file they came from, when there is one. */
  path?: string;
  /** Why the file could not be used — reported rather than thrown. */
  error?: string;
}

/** The nearest config file at or above `dir`, the way git finds its repository. */
export const findProjectConfig = (dir: string): string | undefined => {
  let current = resolve(dir);
  while (true) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const candidate = join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/**
 * The ports a project says it uses, from the nearest `porti.config.ts` — watched alongside the
 * user's own list, never written into it.
 *
 * `PORTI_PROJECT_DIR` names the project outright, for a tool that runs porti on behalf of one
 * repository from wherever its user happens to be; otherwise the search starts at `dir`.
 * Imported rather than parsed, so a project can compute its ports (from a shared constants file,
 * say). A file that throws or exports no `ports` costs its ports, not the run.
 */
export const loadProjectPorts = async (
  dir = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<ProjectPortsResult> => {
  const path = findProjectConfig(env.PORTI_PROJECT_DIR || dir);
  if (!path) return { ports: [] };
  try {
    const module = await import(pathToFileURL(path).href);
    const raw = (module.default ?? module.config ?? module) as PortiProjectConfig | undefined;
    //? A missing list means "no project ports", not porti's first-run defaults
    if (!Array.isArray(raw?.ports)) return { ports: [], path, error: 'exports no `ports` list' };
    return { ports: coercePorts(raw.ports), path };
  } catch (error) {
    return { ports: [], path, error: (error as Error).message };
  }
};

/**
 * The user's watched ports plus the project's, one entry per port.
 *
 * Inside a project its own labels win: it knows what runs on its ports, while the user's list is
 * generic (a first run's defaults call 4200 "Angular / Nx" whatever the project serves there).
 * A user's name still shows where the project gives none.
 */
export const mergeWatched = (user: WatchedPort[], project: WatchedPort[]): WatchedPort[] => {
  const merged = new Map<number, WatchedPort>();
  for (const entry of user) merged.set(entry.port, entry);
  for (const entry of project) merged.set(entry.port, { ...merged.get(entry.port), ...entry });
  return [...merged.values()].sort((a, b) => a.port - b.port);
};

export default loadProjectPorts;
