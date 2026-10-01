import { join } from 'node:path';

/** Scripts the package manager runs on its own, at install, pack or publish time. */
export const LIFECYCLE_SCRIPTS = new Set([
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
  'publish',
  'postpublish',
  'prepack',
  'postpack',
  'preversion',
  'version',
  'postversion',
  'dependencies',
]);

export interface Script {
  name: string;
  command: string;
  /**
   * `script` is one to run by name; `hook` runs on its own — a lifecycle script, or the `pre`/`post`
   * of another script, which `run <that script>` runs before or after it.
   */
  kind: 'script' | 'hook';
  /** For a script: its `pre<name>` and `post<name>`, run with it. */
  pre?: string;
  post?: string;
}

export interface ScriptsResult {
  exists: boolean;
  scripts: Script[];
  error?: string;
}

/** Sort and classify a `scripts` object as `package.json` declares it — in its own order. */
export const toScripts = (raw: Record<string, unknown>): Script[] => {
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  const names = new Set(entries.map(([name]) => name));
  const isHookOf = (name: string) =>
    (name.startsWith('pre') && names.has(name.slice(3))) ||
    (name.startsWith('post') && names.has(name.slice(4)));
  return entries.map(([name, command]) => {
    if (LIFECYCLE_SCRIPTS.has(name) || isHookOf(name)) return { name, command, kind: 'hook' };
    return {
      name,
      command,
      kind: 'script',
      ...(names.has(`pre${name}`) ? { pre: `pre${name}` } : {}),
      ...(names.has(`post${name}`) ? { post: `post${name}` } : {}),
    };
  });
};

/** The folder's `package.json` scripts. */
export const readScripts = async (dir: string): Promise<ScriptsResult> => {
  const file = Bun.file(join(dir, 'package.json'));
  if (!(await file.exists())) return { exists: false, scripts: [] };
  try {
    const pkg = (await file.json()) as { scripts?: unknown };
    const raw = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    return { exists: true, scripts: toScripts(raw as Record<string, unknown>) };
  } catch (error) {
    return { exists: true, scripts: [], error: (error as Error).message };
  }
};

/**
 * `a b 'c d'` → ['a', 'b', 'c d']: arguments typed at a prompt, with single or double quotes
 * keeping spaces together. No expansion of any kind — they reach the script as typed.
 */
export const splitArgs = (input: string): string[] => {
  const out: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) out.push(match[1] ?? match[2] ?? match[3] ?? '');
  return out;
};
