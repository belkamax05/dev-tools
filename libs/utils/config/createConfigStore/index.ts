import { lstat, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { appConfigDir, appStateDir } from '../configHome';

export interface ConfigStoreOptions<T extends object> {
  /** Names the directory under the platform's config home. */
  appName: string;
  /** What a first run, an unreadable file, or a missing key gets. */
  defaults: T;
  /** File inside the app's directory. Defaults to `config.json`, or `state.json` for state. */
  fileName?: string;
  /**
   * Which base directory the file lives under. `'config'` (the default) is for settings a
   * person chose and may keep in their dotfiles; `'state'` is for what the app remembers by
   * itself between runs — see `stateHome` for why those two must not share a file.
   */
  kind?: 'config' | 'state';
  /**
   * An explicit file, for a store that lives outside the app's own directories — a per-project
   * file whose place a project decides. Overrides `kind` and `fileName` for where it is kept.
   */
  path?: string;
  /**
   * Turn whatever was parsed into a valid `T`.
   *
   * Defaults to taking each key of `defaults` when the stored value has the same
   * `typeof`, which covers the flags and strings a settings screen writes. Pass
   * your own when a value needs validating against something — an id that must
   * name a theme this build actually has, a number with a range.
   */
  coerce?: (raw: Record<string, unknown>, defaults: T) => T;
}

export interface ConfigStore<T extends object> {
  /**
   * The file itself. Worth showing in a settings screen, so it is never a mystery.
   *
   * Resolved on every read rather than once at import. `XDG_CONFIG_HOME` is an
   * environment variable, and a host is entitled to set it after this module has
   * loaded — which every test that redirects the config into a temp directory
   * does. A path captured at import would point at the real home for the rest of
   * the process, and the test would write to the user's actual config.
   */
  readonly path: string;
  readonly directory: string;
  defaults: T;
  load: () => Promise<T>;
  save: (config: T) => Promise<void>;
  /** Whether the file exists, and whether it is a symlink — a stow-managed dotfile. */
  inspect: () => Promise<StoreFileInfo>;
  /**
   * Get rid of what is stored, so the next load is a first run.
   *
   * A plain file is deleted, and its directory too if that leaves it empty. A symlink — a config
   * stowed from dotfiles — is *reset* instead: written back to the defaults through the link.
   * Deleting the link would leave the tracked file as it was and break the stow link, so the
   * next save would create a stray plain file where the link used to be.
   */
  clear: () => Promise<ClearOutcome>;
}

export interface StoreFileInfo {
  path: string;
  exists: boolean;
  linked: boolean;
}

export type ClearOutcome = 'removed' | 'reset' | 'missing';

/**
 * `inspect` and `clear` for any single file, so a store that is not built by `createConfigStore`
 * (one combining two files, say) clears its files exactly the way every other store does.
 */
export const inspectFile = async (path: string): Promise<StoreFileInfo> => {
  try {
    const stat = await lstat(path);
    return { path, exists: true, linked: stat.isSymbolicLink() };
  } catch {
    return { path, exists: false, linked: false };
  }
};

export const clearFile = async (path: string, defaults: object): Promise<ClearOutcome> => {
  const info = await inspectFile(path);
  if (!info.exists) return 'missing';
  if (info.linked) {
    await Bun.write(path, `${JSON.stringify(defaults, null, 2)}\n`);
    return 'reset';
  }
  await rm(path, { force: true });
  //? Only succeeds on an empty directory, which is the point: an app's folder goes with its last
  //? file, and one still holding anything else is left alone
  await rmdir(dirname(path)).catch(() => {});
  return 'removed';
};

/**
 * Coerce each key by the shape of its default.
 *
 * A hand-edited config is the normal case for a file like this, so a key that is
 * missing, misspelled or the wrong type has to leave the app running on its
 * default rather than putting `undefined` into a boolean.
 */
const coerceByType = <T extends object>(raw: Record<string, unknown>, defaults: T): T => {
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = raw[key as string];
    if (value !== undefined && typeof value === typeof defaults[key]) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
};

/**
 * A JSON settings file an app owns, read and written whole.
 *
 * Neither call throws. A missing file is the first run and a corrupt one is not
 * worth refusing to start over — either way the defaults are a working app, and
 * the next save rewrites the file properly. `save` is the one that can fail, and
 * the caller is expected to apply a setting *before* persisting it, so a config
 * directory that cannot be written costs you persistence and not the setting.
 */
export const createConfigStore = <T extends object>({
  appName,
  defaults,
  kind = 'config',
  fileName = kind === 'state' ? 'state.json' : 'config.json',
  coerce = coerceByType,
  path: explicitPath,
}: ConfigStoreOptions<T>): ConfigStore<T> => {
  const directory = () =>
    explicitPath
      ? dirname(explicitPath)
      : kind === 'state'
        ? appStateDir(appName)
        : appConfigDir(appName);
  const path = () => explicitPath ?? join(directory(), fileName);

  return {
    get path() {
      return path();
    },
    get directory() {
      return directory();
    },
    defaults,

    async load() {
      try {
        const parsed: unknown = JSON.parse(await Bun.file(path()).text());
        if (typeof parsed !== 'object' || parsed === null) return { ...defaults };
        return coerce(parsed as Record<string, unknown>, defaults);
      } catch {
        return { ...defaults };
      }
    },

    async save(config: T) {
      //? Trailing newline and two-space indent because this file is meant to be
      //? opened and edited by hand as readily as by a settings screen.
      await Bun.write(path(), `${JSON.stringify(config, null, 2)}\n`);
    },

    inspect: () => inspectFile(path()),
    clear: () => clearFile(path(), defaults),
  };
};

export default createConfigStore;
