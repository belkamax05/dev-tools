import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { splitWords } from '../resolve';

/** A built-in alias: a name, and the arguments it puts before whatever is typed after it. */
export interface AppAlias {
  name: string;
  args: string[];
}

export interface AppEntry {
  /** The app's folder name under `apps/`, which is also its command. */
  name: string;
  description: string;
  /** Aliases the app declares for itself in its package.json. */
  aliases: AppAlias[];
  /** Absolute path of its `src/run.ts`. */
  runPath: string;
}

/** `apps/` in this checkout, found from this file rather than from the working directory. */
export const APPS_DIR = resolve(import.meta.dir, '..', '..', '..', '..');

/** The launcher itself — listed nowhere, since picking it would only open it again. */
const SELF = 'devi';

/** Read the `aliases` field in either of its forms; anything malformed is dropped. */
export const parseAliases = (raw: unknown): AppAlias[] => {
  const valid = (name: unknown): name is string =>
    typeof name === 'string' && /^[\w.:-]+$/.test(name);
  if (Array.isArray(raw)) return raw.filter(valid).map((name) => ({ name, args: [] }));
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([name, args]) => valid(name) && typeof args === 'string')
      .map(([name, args]) => ({ name, args: splitWords(args as string) }));
  }
  return [];
};

/** `mcp → agenti mcp`, or just `agent` for an alias of the app itself. */
export const describeAlias = (app: AppEntry, alias: AppAlias): string =>
  alias.args.length ? `${alias.name} → ${app.name} ${alias.args.join(' ')}` : alias.name;

/**
 * Every app in `apps/`, read from each one's `package.json`.
 *
 * Discovered rather than listed, so a new app appears in the picker and becomes a command the
 * moment its folder exists. An app declares its description in the standard `description` field
 * and its built-in aliases under `"dev-tools": { "aliases": ... }` — a list of names for the app
 * itself, or an object of name → arguments for aliases that open a subcommand or a tab
 * (`{ "mcp": "mcp", "agent": "" }`); one without `src/run.ts`
 * (a library, a half-made folder) is skipped.
 */
export const discoverApps = async (appsDir = APPS_DIR): Promise<AppEntry[]> => {
  let names: string[];
  try {
    names = readdirSync(appsDir);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names
      .filter((name) => name !== SELF && !name.startsWith('.'))
      .map(async (name): Promise<AppEntry | undefined> => {
        const runPath = join(appsDir, name, 'src', 'run.ts');
        if (!existsSync(runPath)) return undefined;
        let pkg: { description?: unknown; 'dev-tools'?: { aliases?: unknown } } = {};
        try {
          pkg = await Bun.file(join(appsDir, name, 'package.json')).json();
        } catch {}
        const aliases = parseAliases(pkg['dev-tools']?.aliases);
        return {
          name,
          description: typeof pkg.description === 'string' ? pkg.description : '',
          aliases,
          runPath,
        };
      }),
  );
  return entries
    .filter((entry): entry is AppEntry => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Run an app in this process, as its own `bin/` shim would: its `run` with the arguments.
 *
 * Imported only when chosen, so the launcher never loads the apps it is not running.
 */
export const runApp = async (app: AppEntry, args: string[]): Promise<void> => {
  const module = (await import(app.runPath)) as {
    default?: (...argv: string[]) => Promise<void> | void;
    run?: (...argv: string[]) => Promise<void> | void;
  };
  const run = module.default ?? module.run;
  if (typeof run !== 'function') throw new Error(`${app.runPath} exports no run function`);
  await run(...args);
};
